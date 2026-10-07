-- =====================================================================
--  Invio, revisione e voto di un clear
--
--  Il modello è versionato. Tre livelli, tre regole:
--
--    clear           l'intestazione. Chi, quale stage, quale difficoltà,
--                    quale ricorrenza. NON cambia mai: correggere questo
--                    non è una revisione, è un altro clear.
--    clear_version   come l'hai chiuso: assetto, item, morti, turni, nota.
--                    Una versione, creata, non si tocca più.
--    voti e commenti stanno sulla VERSIONE. È il perno: correggere un
--                    clear non porta con sé i voti che aveva preso, e non
--                    li cancella. Restano dove erano, leggibili.
--
--  Il buco del "cancello e reinserisco per ripulire i voti negativi" si
--  chiude da sé: non serve più cancellare per correggere, e chi guarda
--  vede che la versione con 500 voti non è quella che sta leggendo.
-- =====================================================================


-- ---------------------------------------------------------------------
--  Host delle prove: dato, non codice
--
--  embed  = lo incorporiamo (player YouTube, immagine)
--  link   = lo mostriamo come collegamento e basta
--  refuse = non lo accettiamo. Gli accorciatori stanno qui: dietro un
--           bit.ly non si sa cosa ci sia, e lo scopri quando è tardi.
--  Un host non in tabella vale 'link': si accetta, non si incorpora.
-- ---------------------------------------------------------------------

create table proof_host (
  host      text primary key,
  provider  text,
  policy    text not null check (policy in ('embed','link','refuse'))
);

insert into proof_host (host, provider, policy) values
  ('youtube.com',     'youtube',    'embed'),
  ('m.youtube.com',   'youtube',    'embed'),
  ('youtu.be',        'youtube',    'embed'),
  ('imgur.com',       'imgur',      'embed'),
  ('i.imgur.com',     'imgur',      'embed'),
  ('streamable.com',  'streamable', 'embed'),
  ('i.redd.it',       'reddit',     'embed'),
  ('preview.redd.it', 'reddit',     'embed'),
  ('twitch.tv',       'twitch',     'link'),
  ('drive.google.com','drive',      'link'),
  -- accorciatori e host opachi: rifiutati
  ('bit.ly',      null, 'refuse'),
  ('tinyurl.com', null, 'refuse'),
  ('t.co',        null, 'refuse'),
  ('is.gd',       null, 'refuse'),
  ('shorturl.at', null, 'refuse');

create or replace function proof_provider(p_url text)
returns text language plpgsql stable as $fn$
declare
  v_host text;
  v_row  proof_host;
begin
  v_host := lower(substring(p_url from '^https?://(?:www\.)?([^/:?#]+)'));
  if v_host is null or v_host = '' then
    raise exception 'link non valido: %', p_url using errcode = '23514';
  end if;
  select * into v_row from proof_host where host = v_host;
  if v_row.policy = 'refuse' then
    raise exception 'host non ammesso (accorciatore o host opaco): %', v_host
      using errcode = '23514';
  end if;
  return v_row.provider;   -- null se l'host non è in tabella
end $fn$;


-- ---------------------------------------------------------------------
--  IL CONGELAMENTO, imposto dal database
--
--  Sull'intestazione restano scrivibili status (moderazione) e team_id
--  (che diventa null se l'autore cancella il team). Su una versione
--  restano score (lo scrive il trigger dei voti) e is_current (lo cambia
--  una revisione). Tutto il resto, se qualcuno prova a toccarlo, alza un
--  errore — non importa da dove arrivi: API, script, o SQL a mano.
-- ---------------------------------------------------------------------

create or replace function clear_header_is_frozen() returns trigger
language plpgsql as $fn$
begin
  if new.author_id     <> old.author_id
  or new.run_id        <> old.run_id
  or new.stage_tier_id <> old.stage_tier_id
  or new.event_id      <> old.event_id
  or new.created_at    <> old.created_at then
    raise exception 'l''intestazione di un clear non cambia: se hai sbagliato stage o difficoltà, è un altro clear'
      using errcode = '23514';
  end if;
  return new;
end $fn$;

create trigger clear_header_frozen
before update on clear
for each row execute function clear_header_is_frozen();


create or replace function clear_version_is_frozen() returns trigger
language plpgsql as $fn$
begin
  if new.clear_id        <> old.clear_id
  or new.seq             <> old.seq
  or new.lineup_snapshot <> old.lineup_snapshot
  or new.no_items    is distinct from old.no_items
  or new.deathless   is distinct from old.deathless
  or new.turns       is distinct from old.turns
  or new.note        is distinct from old.note
  or new.lang        is distinct from old.lang
  or new.change_note is distinct from old.change_note
  or new.created_at      <> old.created_at then
    raise exception 'una versione non si modifica: creane una nuova con revise_clear()'
      using errcode = '23514';
  end if;
  return new;
end $fn$;

create trigger clear_version_frozen
before update on clear_version
for each row execute function clear_version_is_frozen();


-- ---------------------------------------------------------------------
--  Due aiutanti condivisi: usati sia dall'invio sia dalla revisione,
--  così le due strade non possono divergere.
-- ---------------------------------------------------------------------

-- Verifica che l'assetto sia tuo e completo. Torna il team.
create or replace function assert_lineup_usable(p_author uuid, p_lineup uuid)
returns uuid language plpgsql stable as $fn$
declare v_team uuid; v_slots int;
begin
  select l.team_id into v_team
  from lineup l join team t on t.id = l.team_id
  where l.id = p_lineup and t.owner_id = p_author;

  if v_team is null then
    raise exception 'assetto inesistente o non tuo: %', p_lineup
      using errcode = '42501';
  end if;

  -- Sette righe bastano a dimostrare la forma 2+2+3: il check su
  -- lineup_slot limita a 2+2+3 il massimo di posizioni possibili,
  -- quindi sette righe distinte non possono stare diversamente.
  select count(*) into v_slots from lineup_slot where lineup_id = p_lineup;
  if v_slots <> 7 then
    raise exception 'assetto incompleto: % unità su 7', v_slots
      using errcode = '23514';
  end if;
  if not exists (select 1 from lineup_slot where lineup_id = p_lineup and role = 'leader')
  or not exists (select 1 from lineup_slot where lineup_id = p_lineup and role = 'friend') then
    raise exception 'assetto senza leader o senza friend' using errcode = '23514';
  end if;

  return v_team;
end $fn$;

-- Fotografa un assetto, build comprese. È la stessa query che alimenta
-- clear_card: per questo le due non possono raccontare cose diverse.
create or replace function take_lineup_snapshot(p_lineup uuid)
returns jsonb language sql stable as $fn$
  select jsonb_build_object(
    'lineup_id',  l.id,
    'lineup_seq', l.seq,
    'label',      l.label,
    'note',       l.note,
    'taken_at',   now(),
    'slots', (
      select jsonb_agg(
        jsonb_build_object(
          'rot',       ls.rotation_index,
          'pos',       ls.pos,
          'role',      ls.role,
          'card_id',   ls.card_id,
          'hp_stars',  sb.hp_stars,
          'hp_path',   sb.hp_path,
          'slot_note', ls.note,
          'orbs', (
            select jsonb_agg(o.orb_name order by o.slot_no)
            from slot_orb o
            where (o.lineup_id, o.rotation_index, o.pos)
                = (ls.lineup_id, ls.rotation_index, ls.pos)
          ),
          'equipment', (
            select jsonb_agg(e.equipment_id order by e.slot_no)
            from slot_equipment e
            where (e.lineup_id, e.rotation_index, e.pos)
                = (ls.lineup_id, ls.rotation_index, ls.pos)
          )
        ) order by ls.rotation_index, ls.pos
      )
      from lineup_slot ls
      left join slot_build sb
        on (sb.lineup_id, sb.rotation_index, sb.pos)
         = (ls.lineup_id, ls.rotation_index, ls.pos)
      where ls.lineup_id = l.id
    )
  )
  from lineup l where l.id = p_lineup;
$fn$;


-- ---------------------------------------------------------------------
--  submit_clear: l'intestazione, la versione 1, le sette righe, le prove
--  p_proofs ha la forma [{"kind":"screenshot","url":"..."}]
--  Torna l'id del clear.
-- ---------------------------------------------------------------------

create or replace function submit_clear(
  p_author     uuid,
  p_run        bigint,
  p_tier       bigint,
  p_lineup     uuid,
  p_no_items   boolean  default false,
  p_deathless  boolean  default false,
  p_turns      smallint default null,
  p_note       text     default null,
  p_lang       text     default null,
  p_proofs     jsonb    default '[]'::jsonb
) returns uuid language plpgsql as $fn$
declare
  v_clear uuid; v_version uuid; v_team uuid; v_event bigint;
begin
  v_team := assert_lineup_usable(p_author, p_lineup);

  -- la ricorrenza esiste e non è nel futuro: non si può aver chiuso
  -- un evento che non è ancora iniziato
  select r.event_id into v_event
  from event_run r where r.id = p_run and r.starts_at <= now();
  if v_event is null then
    raise exception 'ricorrenza inesistente o non ancora iniziata: %', p_run
      using errcode = '23514';
  end if;
  -- che ricorrenza e stage siano dello stesso evento lo garantiscono
  -- le due FK composite su clear: qui non serve ricontrollarlo

  insert into clear (author_id, run_id, stage_tier_id, event_id, team_id)
  values (p_author, p_run, p_tier, v_event, v_team)
  returning id into v_clear;

  insert into clear_version (clear_id, seq, lineup_snapshot,
                             no_items, deathless, turns, note, lang, is_current)
  values (v_clear, 1, take_lineup_snapshot(p_lineup),
          p_no_items, p_deathless, p_turns, p_note, p_lang, true)
  returning id into v_version;

  insert into clear_card (version_id, rotation_index, pos, card_id, role)
  select v_version, ls.rotation_index, ls.pos, ls.card_id, ls.role
  from lineup_slot ls where ls.lineup_id = p_lineup;

  -- proof_provider rifiuta gli accorciatori e l'intera transazione cade
  -- con loro: meglio un errore chiaro all'invio che un link opaco
  -- salvato per sempre.
  insert into clear_proof (version_id, kind, url, provider)
  select v_version, e->>'kind', e->>'url', proof_provider(e->>'url')
  from jsonb_array_elements(p_proofs) as e;

  return v_clear;
end $fn$;


-- ---------------------------------------------------------------------
--  revise_clear: una versione nuova. La vecchia resta, con i suoi voti
--  e i suoi commenti attaccati.
--
--  p_change_note è OBBLIGATORIA: chi legge ha diritto di sapere perché
--  la versione è cambiata, altrimenti la storia è illeggibile.
--  Le prove si portano avanti per difetto — documentano la partita, che
--  non è cambiata — e l'autore può togliere quelle sbagliate finché la
--  versione nuova non ha ancora preso voti.
-- ---------------------------------------------------------------------

create or replace function revise_clear(
  p_author       uuid,
  p_clear        uuid,
  p_lineup       uuid,
  p_change_note  text,
  p_no_items     boolean  default false,
  p_deathless    boolean  default false,
  p_turns        smallint default null,
  p_note         text     default null,
  p_lang         text     default null,
  p_carry_proofs boolean  default true
) returns uuid language plpgsql as $fn$
declare
  v_team uuid; v_old uuid; v_new uuid; v_seq smallint;
begin
  if p_change_note is null or btrim(p_change_note) = '' then
    raise exception 'una revisione deve dire perché esiste' using errcode = '23514';
  end if;

  if not exists (select 1 from clear where id = p_clear and author_id = p_author) then
    raise exception 'clear inesistente o non tuo' using errcode = '42501';
  end if;

  v_team := assert_lineup_usable(p_author, p_lineup);

  select id, seq into v_old, v_seq
  from clear_version where clear_id = p_clear and is_current;

  -- prima si spegne la corrente, poi si accende la nuova: l'indice
  -- unico parziale non tollera due correnti nemmeno per un istante
  update clear_version set is_current = false where id = v_old;

  insert into clear_version (clear_id, seq, lineup_snapshot, no_items,
                             deathless, turns, note, lang, change_note, is_current)
  values (p_clear, v_seq + 1, take_lineup_snapshot(p_lineup), p_no_items,
          p_deathless, p_turns, p_note, p_lang, btrim(p_change_note), true)
  returning id into v_new;

  insert into clear_card (version_id, rotation_index, pos, card_id, role)
  select v_new, ls.rotation_index, ls.pos, ls.card_id, ls.role
  from lineup_slot ls where ls.lineup_id = p_lineup;

  if p_carry_proofs then
    insert into clear_proof (version_id, kind, url, provider, last_checked_at, is_reachable)
    select v_new, kind, url, provider, last_checked_at, is_reachable
    from clear_proof where version_id = v_old;
  end if;

  -- il team può essere cambiato con la revisione
  update clear set team_id = v_team where id = p_clear;

  return v_new;
end $fn$;


-- ---------------------------------------------------------------------
--  Cancellazione: non serve più a correggere (per quello c'è la
--  revisione), serve solo a far sparire un clear. Porta via versioni,
--  righe, prove, voti e commenti in cascata.
-- ---------------------------------------------------------------------

create or replace function delete_clear(p_author uuid, p_clear uuid)
returns void language plpgsql as $fn$
begin
  delete from clear where id = p_clear and author_id = p_author;
  if not found then
    raise exception 'clear inesistente o non tuo' using errcode = '42501';
  end if;
end $fn$;


-- ---------------------------------------------------------------------
--  Prove: si aggiungono a una versione. Si togliono finché quella
--  versione non ha ancora preso voti — dopo, è stata giudicata anche
--  per quello che mostrava.
-- ---------------------------------------------------------------------

create or replace function add_clear_proof(
  p_author uuid, p_version uuid, p_kind text, p_url text
) returns uuid language plpgsql as $fn$
declare v_id uuid;
begin
  if not exists (
    select 1 from clear_version v join clear c on c.id = v.clear_id
    where v.id = p_version and c.author_id = p_author
  ) then
    raise exception 'versione inesistente o non tua' using errcode = '42501';
  end if;
  insert into clear_proof (version_id, kind, url, provider)
  values (p_version, p_kind, p_url, proof_provider(p_url))
  returning id into v_id;
  return v_id;
end $fn$;

create or replace function remove_clear_proof(p_author uuid, p_proof uuid)
returns void language plpgsql as $fn$
declare v_version uuid; v_votes int;
begin
  select p.version_id into v_version
  from clear_proof p
  join clear_version v on v.id = p.version_id
  join clear c on c.id = v.clear_id
  where p.id = p_proof and c.author_id = p_author;

  if v_version is null then
    raise exception 'prova inesistente o non tua' using errcode = '42501';
  end if;

  select count(*) into v_votes from clear_vote where version_id = v_version;
  if v_votes > 0 then
    raise exception 'questa versione ha già ricevuto voti: crea una revisione'
      using errcode = '23514';
  end if;

  delete from clear_proof where id = p_proof;
end $fn$;


-- ---------------------------------------------------------------------
--  Voti e commenti: sempre su una versione, mai sul clear.
--  Il proprio clear non si vota.
-- ---------------------------------------------------------------------

create or replace function vote_clear(
  p_user uuid, p_version uuid, p_value smallint
) returns void language plpgsql as $fn$
begin
  if exists (
    select 1 from clear_version v join clear c on c.id = v.clear_id
    where v.id = p_version and c.author_id = p_user
  ) then
    raise exception 'non si vota il proprio clear' using errcode = '42501';
  end if;

  insert into clear_vote (version_id, user_id, value)
  values (p_version, p_user, p_value)
  on conflict (version_id, user_id)
    do update set value = excluded.value, voted_at = now();
end $fn$;

create or replace function add_clear_comment(
  p_author uuid, p_version uuid, p_body text, p_lang text default null
) returns uuid language plpgsql as $fn$
declare v_id uuid;
begin
  if btrim(coalesce(p_body,'')) = '' then
    raise exception 'commento vuoto' using errcode = '23514';
  end if;
  insert into clear_comment (version_id, author_id, body, lang)
  values (p_version, p_author, btrim(p_body), p_lang)
  returning id into v_id;
  return v_id;
end $fn$;
