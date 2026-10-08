-- =====================================================================
--  Il builder dei clear: l'invio dal sito in UNA transazione.
--
--  Le funzioni del 0002 lavorano su un assetto gia' salvato (team,
--  lineup, lineup_slot): il sito invece ha in mano un modulo intero.
--  Qui lo si riceve come jsonb, lo si valida, si creano team, assetti e
--  slot, e poi si chiama submit_clear / revise_clear: le regole di quelle
--  (assetto completo, ricorrenza iniziata, prove, revisione motivata)
--  restano scritte in un posto solo.
--
--  Ogni rifiuto del builder porta un nome nel campo CONSTRAINT
--  dell'errore (builder_*): il sito traduce il nome in una frase, invece
--  di dipendere dal testo del messaggio.
--
--  Forma del payload:
--    { "lineups": [ { "label": text|null, "note": text|null,
--                     "slots": [ {"rot":1,"pos":1,"card_id":1012340,
--                                 "role":"leader"|"member"|"friend"} x7 ] } x1-4 ],
--      "no_items": bool, "deathless": bool, "turns": 1-99|null,
--      "note": text|null, "lang": "en"|"ja"|null,
--      "proofs": [ {"kind":"screenshot"|"video","url":"https://..."} x0-3 ] }
-- =====================================================================


-- ---------------------------------------------------------------------
--  1. Gli assetti successivi, congelati con la versione
--
--  lineup_snapshot ne fotografa uno solo, e clear_card spiana solo
--  quello: i cambi a meta' evento sparivano. Qui ci sono TUTTI gli
--  assetti della versione (anche il #1, cosi' una sola query li legge
--  in ordine), mentre clear_card resta com'e' e continua a servire le
--  pagine e i filtri per carta sull'assetto di partenza.
-- ---------------------------------------------------------------------

create table clear_lineup (
  version_id  uuid     not null references clear_version on delete cascade,
  seq         smallint not null check (seq between 1 and 4),
  label       text,
  note        text,
  primary key (version_id, seq)
);

create table clear_lineup_card (
  version_id      uuid     not null,
  seq             smallint not null,
  rotation_index  smallint not null,
  pos             smallint not null,
  card_id         bigint   not null references card,
  role            slot_role not null,
  primary key (version_id, seq, rotation_index, pos),
  foreign key (version_id, seq) references clear_lineup on delete cascade
);
create index clear_lineup_card_by_card on clear_lineup_card (card_id);

-- Lo stesso patto di clear_version: scritte una volta, mai piu'.
--   update  mai;
--   insert  solo nella transazione che ha creato la versione (created_at
--           e' il now() della transazione: dopo, now() e' un altro);
--   delete  solo in cascata, quando la versione non c'e' piu'. Il
--           trigger della cascata vede gia' la versione cancellata.
create or replace function clear_lineup_is_frozen() returns trigger
language plpgsql as $fn$
begin
  if tg_op = 'UPDATE' then
    raise exception 'gli assetti di una versione non si modificano: crea una revisione'
      using errcode = '23514';
  elsif tg_op = 'INSERT' then
    if not exists (select 1 from clear_version
                   where id = new.version_id and created_at = now()) then
      raise exception 'gli assetti si scrivono solo insieme alla loro versione'
        using errcode = '23514';
    end if;
    return new;
  else
    if exists (select 1 from clear_version where id = old.version_id) then
      raise exception 'gli assetti di una versione non si cancellano: si cancella il clear'
        using errcode = '23514';
    end if;
    return old;
  end if;
end $fn$;

create trigger clear_lineup_frozen
before insert or update or delete on clear_lineup
for each row execute function clear_lineup_is_frozen();

create trigger clear_lineup_card_frozen
before insert or update or delete on clear_lineup_card
for each row execute function clear_lineup_is_frozen();


-- ---------------------------------------------------------------------
--  2. Il freno agli abusi: un registro delle scritture per utente
--
--  Contare i clear dell'ultima ora non basta: cancellarli azzererebbe il
--  conto. Il registro resta anche dopo la cancellazione del clear, e se
--  ne va solo con l'utente.
-- ---------------------------------------------------------------------

create table clear_write_log (
  user_id  uuid not null references app_user on delete cascade,
  kind     text not null check (kind in ('submit','revise','comment')),
  at       timestamptz not null default now()
);
create index clear_write_log_by_user on clear_write_log (user_id, kind, at);

-- I limiti per ora: dati, non numeri sparsi nel codice.
create or replace function clear_write_limit(p_kind text)
returns int language sql immutable as $fn$
  select case p_kind when 'submit' then 10 when 'revise' then 20 when 'comment' then 30 end;
$fn$;

-- Conta e registra in un colpo. Il lock consultivo per utente mette in
-- fila due richieste simultanee: senza, entrambe leggerebbero 9 e
-- passerebbero tutte e due.
create or replace function note_clear_write(p_user uuid, p_kind text)
returns void language plpgsql as $fn$
declare v_n int;
begin
  perform pg_advisory_xact_lock(hashtextextended('clear_write:' || p_user::text, 0));
  delete from clear_write_log where user_id = p_user and at < now() - interval '1 day';
  select count(*) into v_n from clear_write_log
  where user_id = p_user and kind = p_kind and at > now() - interval '1 hour';
  if v_n >= clear_write_limit(p_kind) then
    raise exception 'troppe scritture (%) nell''ultima ora: massimo %', p_kind, clear_write_limit(p_kind)
      using errcode = '54000', constraint = 'builder_rate_limit';
  end if;
  insert into clear_write_log (user_id, kind) values (p_user, p_kind);
end $fn$;


-- ---------------------------------------------------------------------
--  3. La validazione del payload
--
--  Il sito valida gia' il modulo, ma una Server Action e' un endpoint
--  pubblico: il database rifa' tutto, e da' a ogni rifiuto il suo nome.
-- ---------------------------------------------------------------------

create or replace function builder_fail(p_constraint text, p_msg text)
returns void language plpgsql as $fn$
begin
  raise exception '%', p_msg using errcode = '23514', constraint = p_constraint;
end $fn$;

-- Un numero intero JSON (niente 1.5, niente "3" come stringa).
create or replace function builder_int(p jsonb)
returns bigint language sql immutable as $fn$
  select case when jsonb_typeof(p) = 'number' and p::text ~ '^-?[0-9]{1,15}$'
              then p::text::bigint end;
$fn$;

-- Un testo opzionale: null se manca o e' vuoto, altrimenti ripulito.
-- Un valore che non e' una stringa e' un errore, non un null.
create or replace function builder_text(p jsonb, p_constraint text)
returns text language plpgsql stable as $fn$
begin
  if p is null or jsonb_typeof(p) = 'null' then return null; end if;
  if jsonb_typeof(p) <> 'string' then
    perform builder_fail(p_constraint, 'atteso un testo');
  end if;
  return nullif(btrim(p #>> '{}'), '');
end $fn$;

create or replace function builder_check_lineup(p_seq int, p jsonb)
returns void language plpgsql stable as $fn$
declare
  v_label text; v_note text; s jsonb; v_rot bigint; v_pos bigint; v_card bigint;
  v_seen text[] := '{}'; v_leaders int := 0; v_friends int := 0;
begin
  if jsonb_typeof(p) is distinct from 'object' then
    perform builder_fail('builder_payload', format('assetto %s non valido', p_seq));
  end if;
  v_label := builder_text(p->'label', 'builder_lineup_label');
  v_note  := builder_text(p->'note',  'builder_lineup_note');
  -- il #1 e' la squadra di partenza; i cambi devono dire cosa sono
  if p_seq > 1 and v_label is null then
    perform builder_fail('builder_lineup_label', format('il cambio %s non ha un nome', p_seq));
  end if;
  if char_length(v_label) > 40 then
    perform builder_fail('builder_lineup_label', format('nome dell''assetto %s troppo lungo', p_seq));
  end if;
  if char_length(v_note) > 500 then
    perform builder_fail('builder_lineup_note', format('nota dell''assetto %s troppo lunga', p_seq));
  end if;

  if jsonb_typeof(p->'slots') is distinct from 'array' or jsonb_array_length(p->'slots') <> 7 then
    perform builder_fail('builder_shape', format('l''assetto %s deve avere 7 unita''', p_seq));
  end if;
  for s in select * from jsonb_array_elements(p->'slots') loop
    v_rot  := builder_int(s->'rot');
    v_pos  := builder_int(s->'pos');
    v_card := builder_int(s->'card_id');
    -- 2+2+3: lo stesso check di lineup_slot, detto prima e con un nome
    if v_rot is null or v_pos is null or not (
         (v_rot in (1,2) and v_pos between 1 and 2) or (v_rot = 3 and v_pos between 1 and 3)) then
      perform builder_fail('builder_shape', format('posizione non valida nell''assetto %s', p_seq));
    end if;
    if (v_rot || '.' || v_pos) = any (v_seen) then
      perform builder_fail('builder_shape', format('posizione ripetuta nell''assetto %s', p_seq));
    end if;
    v_seen := v_seen || (v_rot || '.' || v_pos);
    case s->>'role'
      when 'leader' then v_leaders := v_leaders + 1;
      when 'friend' then v_friends := v_friends + 1;
      when 'member' then null;
      else perform builder_fail('builder_role', format('ruolo non valido nell''assetto %s', p_seq));
    end case;
    if v_card is null or not exists (select 1 from card where id = v_card) then
      perform builder_fail('builder_card', format('carta inesistente nell''assetto %s: %s', p_seq, s->'card_id'));
    end if;
  end loop;
  -- leader e friend possono essere la stessa carta: si contano i ruoli
  if v_leaders <> 1 or v_friends <> 1 then
    perform builder_fail('builder_role', format('l''assetto %s vuole un leader e un friend', p_seq));
  end if;
end $fn$;

create or replace function builder_check_payload(p jsonb)
returns void language plpgsql stable as $fn$
declare
  v_n int; v_turns bigint; v_note text; v_lang text; e jsonb; v_url text;
begin
  if jsonb_typeof(p) is distinct from 'object' then
    perform builder_fail('builder_payload', 'payload non valido');
  end if;

  if jsonb_typeof(p->'lineups') is distinct from 'array' then
    perform builder_fail('builder_lineup_count', 'mancano gli assetti');
  end if;
  v_n := jsonb_array_length(p->'lineups');
  if v_n not between 1 and 4 then
    perform builder_fail('builder_lineup_count', format('da 1 a 4 assetti, non %s', v_n));
  end if;
  for i in 1 .. v_n loop
    perform builder_check_lineup(i, p->'lineups'->(i - 1));
  end loop;

  if coalesce(jsonb_typeof(p->'no_items'), 'boolean') <> 'boolean'
  or coalesce(jsonb_typeof(p->'deathless'), 'boolean') <> 'boolean' then
    perform builder_fail('builder_flags', 'no_items e deathless sono vero o falso');
  end if;

  if p->'turns' is not null and jsonb_typeof(p->'turns') <> 'null' then
    v_turns := builder_int(p->'turns');
    if v_turns is null or v_turns not between 1 and 99 then
      perform builder_fail('builder_turns', 'i turni vanno da 1 a 99');
    end if;
  end if;

  v_note := builder_text(p->'note', 'builder_note');
  if char_length(v_note) > 2000 then
    perform builder_fail('builder_note', 'nota oltre i 2000 caratteri');
  end if;

  v_lang := builder_text(p->'lang', 'builder_lang');
  if v_lang is not null and not exists (select 1 from locale where code = v_lang) then
    perform builder_fail('builder_lang', format('lingua sconosciuta: %s', v_lang));
  end if;

  if p->'proofs' is not null and jsonb_typeof(p->'proofs') <> 'null' then
    if jsonb_typeof(p->'proofs') <> 'array' or jsonb_array_length(p->'proofs') > 3 then
      perform builder_fail('builder_proof_count', 'al massimo 3 prove');
    end if;
    for e in select * from jsonb_array_elements(p->'proofs') loop
      if e->>'kind' is null or e->>'kind' not in ('screenshot','video') then
        perform builder_fail('builder_proof_kind', 'una prova e'' uno screenshot o un video');
      end if;
      v_url := e->>'url';
      -- solo https: un http si apre in chiaro, e il player lo bloccherebbe
      if jsonb_typeof(e->'url') is distinct from 'string'
      or v_url !~* '^https://[^/\s]+' or v_url ~ '\s' or char_length(v_url) > 500 then
        perform builder_fail('builder_proof_url', 'il link di una prova deve iniziare con https://');
      end if;
      -- la regola degli host resta quella di proof_provider (0002):
      -- qui le si da' solo un nome
      begin
        perform proof_provider(v_url);
      exception when check_violation then
        perform builder_fail('builder_proof_host', format('host non ammesso: %s', v_url));
      end;
    end loop;
    if (select count(distinct e2->>'url') from jsonb_array_elements(p->'proofs') e2)
       <> jsonb_array_length(p->'proofs') then
      perform builder_fail('builder_proof_url', 'la stessa prova due volte');
    end if;
  end if;
end $fn$;


-- ---------------------------------------------------------------------
--  4. Dal payload al team, e dal team agli assetti congelati
-- ---------------------------------------------------------------------

-- Scrive assetti e slot in un team vuoto. Torna l'assetto #1, quello
-- che submit_clear / revise_clear fotografano e spianano in clear_card.
create or replace function builder_write_team(p_team uuid, p jsonb)
returns uuid language plpgsql as $fn$
declare v_first uuid; v_lineup uuid; l jsonb;
begin
  for i in 1 .. jsonb_array_length(p->'lineups') loop
    l := p->'lineups'->(i - 1);
    insert into lineup (team_id, seq, label, note)
    values (p_team, i, builder_text(l->'label', 'builder_lineup_label'),
            builder_text(l->'note', 'builder_lineup_note'))
    returning id into v_lineup;
    insert into lineup_slot (lineup_id, rotation_index, pos, card_id, role)
    select v_lineup, (s->>'rot')::smallint, (s->>'pos')::smallint,
           (s->>'card_id')::bigint, (s->>'role')::slot_role
    from jsonb_array_elements(l->'slots') s;
    if i = 1 then v_first := v_lineup; end if;
  end loop;
  return v_first;
end $fn$;

-- Il nome di un team nato dal builder: il leader del primo assetto. Il
-- sito non chiede un nome, e un team senza nome non si riconosce.
create or replace function builder_team_name(p jsonb)
returns text language sql stable as $fn$
  select coalesce(left(ct.name, 80), 'Team')
  from jsonb_array_elements(p->'lineups'->0->'slots') s
  left join card_text ct on ct.card_id = (s->>'card_id')::bigint and ct.locale = 'en'
  where s->>'role' = 'leader'
  limit 1;
$fn$;

-- Copia nella versione TUTTI gli assetti del team, come sono adesso.
-- Va chiamata nella transazione che ha creato la versione (il trigger
-- lo impone).
create or replace function builder_freeze_lineups(p_version uuid, p_team uuid)
returns void language sql as $fn$
  insert into clear_lineup (version_id, seq, label, note)
  select p_version, l.seq, l.label, l.note from lineup l where l.team_id = p_team;
  insert into clear_lineup_card (version_id, seq, rotation_index, pos, card_id, role)
  select p_version, l.seq, ls.rotation_index, ls.pos, ls.card_id, ls.role
  from lineup l join lineup_slot ls on ls.lineup_id = l.id
  where l.team_id = p_team;
$fn$;

-- Le prove del payload come le vuole submit_clear: solo kind e url.
create or replace function builder_proofs(p jsonb)
returns jsonb language sql immutable as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('kind', e->>'kind', 'url', e->>'url')), '[]'::jsonb)
  from jsonb_array_elements(coalesce(nullif(p->'proofs', 'null'::jsonb), '[]'::jsonb)) e;
$fn$;

-- Chi scrive deve esistere e aver finito /welcome: e' l'unico posto in
-- cui il database lo sa, il resto si fida del p_author.
create or replace function builder_assert_author(p_author uuid)
returns void language plpgsql stable as $fn$
begin
  if not exists (select 1 from app_user where id = p_author and onboarded_at is not null) then
    raise exception 'utente inesistente o senza handle'
      using errcode = '42501', constraint = 'builder_author';
  end if;
end $fn$;


-- ---------------------------------------------------------------------
--  5. Gli ingressi del builder
-- ---------------------------------------------------------------------

create or replace function submit_clear_from_builder(
  p_author uuid, p_run bigint, p_tier bigint, p_payload jsonb
) returns uuid language plpgsql as $fn$
declare
  v_team uuid; v_lineup uuid; v_clear uuid; v_version uuid; v_starts timestamptz;
begin
  perform builder_assert_author(p_author);
  perform note_clear_write(p_author, 'submit');
  perform builder_check_payload(p_payload);

  if not exists (select 1 from stage_tier where id = p_tier) then
    perform builder_fail('builder_tier', format('difficolta'' inesistente: %s', p_tier));
  end if;
  -- La ricorrenza deve essere dello stesso evento della difficolta'. Lo
  -- garantirebbe la FK composita su clear, ma con un errore senza nome.
  select r.starts_at into v_starts
  from event_run r join stage_tier st on st.event_id = r.event_id
  where r.id = p_run and st.id = p_tier;
  if v_starts is null then
    perform builder_fail('builder_run', 'la ricorrenza non e'' di questo evento');
  end if;
  -- "iniziata" lo controlla anche submit_clear: qui gli si da' un nome
  if v_starts > now() then
    perform builder_fail('builder_run_not_started', 'la ricorrenza non e'' ancora iniziata');
  end if;

  insert into team (owner_id, name) values (p_author, builder_team_name(p_payload))
  returning id into v_team;
  v_lineup := builder_write_team(v_team, p_payload);

  v_clear := submit_clear(
    p_author, p_run, p_tier, v_lineup,
    coalesce((p_payload->>'no_items')::boolean, false),
    coalesce((p_payload->>'deathless')::boolean, false),
    (p_payload->>'turns')::smallint,
    builder_text(p_payload->'note', 'builder_note'),
    builder_text(p_payload->'lang', 'builder_lang'),
    builder_proofs(p_payload));

  select id into v_version from clear_version where clear_id = v_clear and is_current;
  perform builder_freeze_lineups(v_version, v_team);
  return v_clear;
end $fn$;

-- Una revisione dal builder. Torna l'id della versione nuova.
--
-- Il team: se lo usa solo questo clear (il caso del builder, che ne crea
-- uno per invio) si riscrive al posto; se manca o lo usa anche un altro
-- clear se ne crea uno nuovo, cosi' rivedere un clear non cambia la
-- squadra di un altro. Le versioni vecchie non ne risentono: hanno gia'
-- snapshot, clear_card e clear_lineup*.
--
-- Le prove sono quelle del payload, per intero: il modulo di modifica
-- parte da quelle della versione corrente. Una prova che resta si porta
-- dietro l'esito dell'ultimo controllo del link.
create or replace function revise_clear_from_builder(
  p_author uuid, p_clear uuid, p_change_note text, p_payload jsonb
) returns uuid language plpgsql as $fn$
declare
  v_team uuid; v_lineup uuid; v_old uuid; v_new uuid; v_shared boolean;
begin
  perform builder_assert_author(p_author);
  select c.team_id into v_team from clear c where c.id = p_clear and c.author_id = p_author;
  if not found then
    raise exception 'clear inesistente o non tuo'
      using errcode = '42501', constraint = 'builder_not_yours';
  end if;
  perform note_clear_write(p_author, 'revise');

  if p_change_note is null or btrim(p_change_note) = '' then
    perform builder_fail('builder_change_note', 'una revisione deve dire perche'' esiste');
  end if;
  if char_length(btrim(p_change_note)) > 300 then
    perform builder_fail('builder_change_note', 'motivo della revisione oltre i 300 caratteri');
  end if;
  perform builder_check_payload(p_payload);

  select exists (select 1 from clear where team_id = v_team and id <> p_clear)
      or not exists (select 1 from team where id = v_team and owner_id = p_author)
    into v_shared;
  if v_team is null or v_shared then
    insert into team (owner_id, name) values (p_author, builder_team_name(p_payload))
    returning id into v_team;
  else
    delete from lineup where team_id = v_team;   -- gli slot vanno in cascata
    update team set name = builder_team_name(p_payload), updated_at = now() where id = v_team;
  end if;
  v_lineup := builder_write_team(v_team, p_payload);

  select id into v_old from clear_version where clear_id = p_clear and is_current;
  v_new := revise_clear(
    p_author, p_clear, v_lineup, p_change_note,
    coalesce((p_payload->>'no_items')::boolean, false),
    coalesce((p_payload->>'deathless')::boolean, false),
    (p_payload->>'turns')::smallint,
    builder_text(p_payload->'note', 'builder_note'),
    builder_text(p_payload->'lang', 'builder_lang'),
    false);

  insert into clear_proof (version_id, kind, url, provider, last_checked_at, is_reachable)
  select v_new, e->>'kind', e->>'url', proof_provider(e->>'url'),
         old.last_checked_at, old.is_reachable
  from jsonb_array_elements(builder_proofs(p_payload)) e
  left join lateral (
    select p.last_checked_at, p.is_reachable from clear_proof p
    where p.version_id = v_old and p.url = e->>'url' limit 1
  ) old on true;

  perform builder_freeze_lineups(v_new, v_team);
  return v_new;
end $fn$;


-- ---------------------------------------------------------------------
--  6. Voti e commenti dal sito: sempre sulla versione CORRENTE
--
--  vote_clear e add_clear_comment (0002) accettano qualunque versione, e
--  le verifiche del 0002 ci contano. Il sito pero' mostra la corrente: se
--  il clear e' stato rivisto mentre la pagina era aperta, il voto
--  finirebbe su un assetto che chi vota non ha visto. Meglio dirlo.
--
--  Decisioni:
--    - il proprio clear non si vota (la regola resta quella di vote_clear);
--    - un voto per utente e versione: rivotare cambia il valore, 0 lo
--      ritira;
--    - commentare il proprio clear si puo': e' il modo di rispondere.
-- ---------------------------------------------------------------------

create or replace function builder_assert_current(p_version uuid)
returns void language plpgsql stable as $fn$
declare v_current boolean;
begin
  select v.is_current into v_current
  from clear_version v join clear c on c.id = v.clear_id
  where v.id = p_version and c.status = 'published';
  if v_current is null then
    raise exception 'versione inesistente: %', p_version
      using errcode = '23514', constraint = 'builder_version_missing';
  end if;
  if not v_current then
    perform builder_fail('builder_version_stale', 'il clear e'' stato rivisto: ricarica la pagina');
  end if;
end $fn$;

-- Torna il punteggio aggiornato della versione.
create or replace function vote_clear_version(p_user uuid, p_version uuid, p_value smallint)
returns int language plpgsql as $fn$
declare v_score int;
begin
  perform builder_assert_author(p_user);
  if p_value is null or p_value not in (-1, 0, 1) then
    perform builder_fail('builder_vote_value', 'un voto vale -1, 0 (ritirato) o 1');
  end if;
  perform builder_assert_current(p_version);
  if p_value = 0 then
    delete from clear_vote where version_id = p_version and user_id = p_user;
  else
    begin
      perform vote_clear(p_user, p_version, p_value);
    exception when insufficient_privilege then
      raise exception 'non si vota il proprio clear'
        using errcode = '42501', constraint = 'builder_own_vote';
    end;
  end if;
  select score into v_score from clear_version where id = p_version;
  return v_score;
end $fn$;

create or replace function comment_clear_version(
  p_user uuid, p_version uuid, p_body text, p_lang text default null
) returns uuid language plpgsql as $fn$
begin
  perform builder_assert_author(p_user);
  perform builder_assert_current(p_version);
  if p_body is null or btrim(p_body) = '' then
    perform builder_fail('builder_comment', 'commento vuoto');
  end if;
  if char_length(btrim(p_body)) > 1000 then
    perform builder_fail('builder_comment', 'commento oltre i 1000 caratteri');
  end if;
  if p_lang is not null and not exists (select 1 from locale where code = p_lang) then
    perform builder_fail('builder_lang', format('lingua sconosciuta: %s', p_lang));
  end if;
  perform note_clear_write(p_user, 'comment');
  return add_clear_comment(p_user, p_version, p_body, p_lang);
end $fn$;
