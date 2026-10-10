-- =====================================================================
--  L'attivita' del sito per gli admin.
--
--  Decisione del proprietario: in Settings un admin puo' accendere, ed e'
--  spento per difetto, una notifica per OGNI azione degli altri utenti sul
--  sito. Il testo dice il minimo: chi, cosa e dove ("alice posted a clear",
--  "Extreme Z-Battle: X, Level 10"), mai il testo di un post.
--
--  Un tipo nuovo, 'site_activity', solo per gli admin come reports_open:
--    - l'interruttore e' la riga notification_pref(site_activity, 'list'):
--      per gli altri tipi la lista non ha preferenze ed e' sempre accesa,
--      qui senza la riga non si scrive niente. Settings accende insieme
--      'list' e 'push'. L'email mai: il budget di Resend protegge i login;
--    - le righe le scrivono, come in 0028, i trigger e le funzioni di
--      scrittura, nella stessa transazione: se la scrittura torna indietro,
--      torna indietro anche la notifica. L'app non le crea mai;
--    - una riga per (admin, gruppo) finche' non e' letta, come le altre:
--      il gruppo e' azione e bersaglio ("4 vote changes on a clear"), e
--      data.n conta le azioni. La push non ne perde nessuna: una push per
--      azione, dal giro che parte dopo la scrittura stessa, col totale e
--      l'ultima azione; sul dispositivo prende il posto di quella di prima
--      dello stesso gruppo (push_claim, sotto);
--    - le azioni sono quelle di site_activity_actions(). Restano fuori le
--      proprie azioni (mai a se stessi), gli accessi, le letture, le
--      impostazioni personali, gli import, il seed e la fixture
--      (dts.silent), le cascate (una cancellazione e' UNA azione, non i
--      voti e i commenti che si porta via) e le scritture che non cambiano
--      niente (lo stesso voto due volte, una modifica identica).
--
--  Privacy, le regole di 0028 piu' queste:
--    - data puo' tenere SOLO il codice dell'azione, il conteggio e due id
--      dei dati di gioco (evento e tier di un contenuto cancellato): lo
--      impone un CHECK. Handle, nomi e stato si ricalcolano a ogni lettura;
--    - chi segnala non compare mai: la riga di una segnalazione non lo
--      tiene nemmeno come attore. Chi e' segnalato non riceve niente
--      nemmeno da questo tipo;
--    - chi smette di essere admin perde il consenso e le righe del feed
--      (activity_role_lost), anche se in quel momento qualcuno scriveva
--      (activity_upsert ricontrolla il ruolo sotto lock): se torna admin,
--      lo riaccende lui;
--    - dopo la cancellazione di un account non resta il suo handle: l'attore
--      va a null ("Someone"), le righe su di lui (subject_id) e sui suoi
--      contenuti se ne vanno a cascata, e "An account was deleted" non lo
--      nomina. Nessun handle si salva mai come testo, nemmeno quello
--      lasciato con un cambio.
--
--  L'ordine dei lock. Ogni azione blocca le righe di app_user degli admin
--  iscritti (il pallino, come notify_upsert), in ordine di id, e tiene il
--  lock fino al commit. Le funzioni di chi scrive le prendono PRIMA di
--  toccare il contenuto (voti, cancellazioni, commenti, revisioni): due
--  scritture sullo stesso clear vanno in fila nello stesso ordine e non si
--  incrociano. Restano possibili, rarissimi, i giri con un moderatore (che
--  ha gia' la sua riga da mod_assert) o con la riga di chi cambia handle o
--  modifica una tip: Postgres ne annulla uno con 40P01, e sql() di
--  lib/db.ts riprova l'istruzione una volta.
--
--  create or replace tiene proprietario e permessi delle funzioni che
--  esistono gia'; quelle nuove le sistema harden in produzione.
-- =====================================================================


-- ---------------------------------------------------------------------
--  1. Il tipo nuovo
--
--  In coda alla lista, come lo ripete lib/notify/kinds.ts. I check sono
--  letterali, come in 0028. Per site_activity i canali sono 'list' (il
--  consenso) e 'push'; per gli altri tipi restano 'push' ed 'email'.
-- ---------------------------------------------------------------------

create or replace function notification_kinds()
returns text[] language sql immutable as $fn$
  select array['clear_comment', 'content_hidden', 'content_unhidden',
               'suspended', 'suspension_lifted', 'reports_open', 'site_activity'];
$fn$;

alter table notification drop constraint notification_kind_check;
alter table notification add constraint notification_kind_check check (kind in (
  'clear_comment', 'content_hidden', 'content_unhidden',
  'suspended', 'suspension_lifted', 'reports_open', 'site_activity'));

alter table notification_pref drop constraint notification_pref_kind_check;
alter table notification_pref add constraint notification_pref_kind_check check (kind in (
  'clear_comment', 'content_hidden', 'content_unhidden',
  'suspended', 'suspension_lifted', 'reports_open', 'site_activity'));

alter table notification_pref drop constraint notification_pref_channel_check;
alter table notification_pref add constraint notification_pref_channel_check
  check (channel in ('push', 'email', 'list'));
alter table notification_pref add constraint notification_pref_channel_kind check (
  case when kind = 'site_activity' then channel in ('list', 'push')
       else channel in ('push', 'email') end);


-- ---------------------------------------------------------------------
--  2. Le azioni, e cosa puo' stare in data
--
--  Le ripete lib/notify/attivita.ts (SITE_ACTIVITY_ACTIONS), e un test
--  controlla che coincidano con questa e con il check qui sotto.
--
--  data di una riga site_activity: {a, n, event?, tier?}. a e' l'ultima
--  azione del gruppo, n quante ne ha contate finche' non e' letta, event e
--  tier dicono dove stava un clear o una tip cancellati. Nient'altro: niente
--  testo, niente handle, niente motivi.
-- ---------------------------------------------------------------------

create function site_activity_actions()
returns text[] language sql immutable as $fn$
  select array['clear_posted', 'clear_revised', 'clear_deleted', 'comment_posted',
               'clear_upvoted', 'clear_downvoted', 'clear_unvoted',
               'tip_posted', 'tip_edited', 'tip_deleted', 'tip_helpful', 'tip_unhelpful',
               'report', 'user_joined', 'handle_changed', 'account_deleted',
               'mod_hide', 'mod_unhide', 'mod_dismiss', 'mod_suspend', 'mod_unsuspend'];
$fn$;

-- coalesce: un CHECK che vale null passa, e data senza 'a' (o con un tipo
-- strano) deve essere rifiutata, non lasciata passare.
alter table notification add constraint notification_activity_data check (
  kind <> 'site_activity' or (
    jsonb_typeof(data) = 'object'
    and coalesce(data ->> 'a', '') in (
      'clear_posted', 'clear_revised', 'clear_deleted', 'comment_posted',
      'clear_upvoted', 'clear_downvoted', 'clear_unvoted',
      'tip_posted', 'tip_edited', 'tip_deleted', 'tip_helpful', 'tip_unhelpful',
      'report', 'user_joined', 'handle_changed', 'account_deleted',
      'mod_hide', 'mod_unhide', 'mod_dismiss', 'mod_suspend', 'mod_unsuspend')
    and coalesce(jsonb_typeof(data -> 'n'), '') = 'number'
    and coalesce(jsonb_typeof(data -> 'event'), 'number') = 'number'
    and coalesce(jsonb_typeof(data -> 'tier'), 'number') = 'number'
    and (data - 'a' - 'n' - 'event' - 'tier') = '{}'::jsonb));


-- ---------------------------------------------------------------------
--  3. Di chi parla una riga: subject_id
--
--  L'utente su cui e' l'azione (chi si e' iscritto, chi ha cambiato handle,
--  chi e' stato sospeso). A cascata: cancellato l'account, le righe su di
--  lui spariscono, e con loro ogni traccia del suo handle. L'indice serve
--  alla cascata, come notification_by_clear.
-- ---------------------------------------------------------------------

alter table notification add column subject_id uuid references app_user on delete cascade;
create index notification_by_subject on notification (subject_id) where subject_id is not null;

-- Chi ha acceso il feed: a ogni scrittura del sito si cercano qui, e
-- l'indice parziale tiene la ricerca a un'occhiata a poche righe.
create index notification_pref_site_activity on notification_pref (user_id)
  where kind = 'site_activity' and channel = 'list';


-- ---------------------------------------------------------------------
--  4. Le forme di lettura e di push
--
--  action e subject_handle in coda, e per la lista subject_public (il
--  profilo di subject_handle si vede: il link). Le funzioni che tornano
--  queste forme (notification_rows, push_claim, e digest_due che le legge)
--  si ridefiniscono qui sotto; notification_render e notification_list
--  fanno select * e non cambiano.
-- ---------------------------------------------------------------------

alter type notification_view add attribute action text, add attribute subject_handle citext,
  add attribute subject_public boolean;
alter type push_job add attribute action text, add attribute subject_handle citext;


-- ---------------------------------------------------------------------
--  5. La scrittura: activity_upsert e activity_note
--
--  activity_upsert e' notify_upsert per una riga di attivita': prima il
--  pallino (e il lock sulla riga dell'admin, nell'ordine di
--  mark_notifications_read), poi la riga, nuova o la non letta del gruppo
--  con l'ultimo attore, l'ultima azione e n + 1. I riferimenti non cambiano:
--  lo stesso gruppo e' lo stesso bersaglio.
--
--  clock_timestamp() e non now() per updated_at: una scrittura che ha
--  aspettato il lock di push_claim finisce sempre con updated_at dopo il
--  suo pushed_at, quindi il giro dopo la manda. Con now() (l'inizio della
--  transazione) potrebbe restare prima, e l'azione si perderebbe.
--
--  Il ruolo si ricontrolla qui, nell'update della riga dell'admin: se ha
--  dovuto aspettare il lock (una retrocessione in corso), Postgres rilegge
--  la versione nuova della riga, e chi non e' piu' admin non riceve
--  niente. activity_note lo controlla gia' col suo for no key update;
--  notify_report invece sceglie gli admin senza lock, e senza questo
--  controllo una segnalazione nello stesso istante di una retrocessione
--  lascerebbe una riga del feed a chi non lo e' piu'.
-- ---------------------------------------------------------------------

create function activity_upsert(
  p_admin uuid, p_actor uuid, p_action text, p_group text,
  p_clear uuid default null, p_comment uuid default null, p_tip uuid default null,
  p_subject uuid default null, p_data jsonb default '{}'::jsonb
) returns bigint language plpgsql as $fn$
declare v_id bigint;
begin
  if current_setting('dts.silent', true) = 'on' then
    return null;
  end if;
  if p_admin is null or p_admin = p_actor then
    return null;
  end if;
  update app_user
     set notif_last_at = greatest(clock_timestamp(), coalesce(notif_seen_at, '-infinity') + interval '1 microsecond')
   where id = p_admin and role = 'admin';
  if not found then
    return null;
  end if;
  insert into notification as x
         (recipient_id, kind, group_key, actor_id, clear_id, comment_id, tip_id, subject_id, data, updated_at)
  values (p_admin, 'site_activity', p_group, p_actor, p_clear, p_comment, p_tip, p_subject,
          coalesce(p_data, '{}'::jsonb) || jsonb_build_object('a', p_action, 'n', 1), clock_timestamp())
  on conflict (recipient_id, group_key) where read_at is null
  do update set updated_at = clock_timestamp(),
                actor_id   = excluded.actor_id,
                data       = excluded.data || jsonb_build_object('n', coalesce((x.data ->> 'n')::int, 1) + 1)
  returning id into v_id;
  return v_id;
end $fn$;

-- Chi riceve: gli admin con il feed acceso, con l'handle, non sospesi,
-- tranne chi agisce (mai a se stessi) e quelli in p_skip (l'autore di un
-- contenuto moderato, che ha gia' la sua notifica o non deve sapere di
-- essere stato segnalato, e chi cancella il proprio account). array_remove:
-- un null nell'array farebbe valere null il confronto, e salterebbe tutti.
--
-- Le righe degli admin si bloccano in ordine di id, anche quelle in p_skip
-- (solo il lock, nessuna riga): cosi' la moderazione del contenuto di un
-- admin prende la sua riga nello stesso ordine di un voto, e non dopo come
-- farebbe da sola notify_moderation_action. Torna quante righe ha scritto.
create function activity_note(
  p_actor uuid, p_action text, p_group text,
  p_clear uuid default null, p_comment uuid default null, p_tip uuid default null,
  p_subject uuid default null, p_data jsonb default '{}'::jsonb, p_skip uuid[] default null
) returns int language plpgsql as $fn$
declare
  v_admin uuid;
  v_skip  uuid[] := array_remove(coalesce(p_skip, '{}'::uuid[]), null);
  v_n     int := 0;
begin
  if current_setting('dts.silent', true) = 'on' then
    return 0;
  end if;
  for v_admin in
    select u.id from app_user u
     where u.id in (select p.user_id from notification_pref p
                     where p.kind = 'site_activity' and p.channel = 'list')
       and u.role = 'admin' and u.onboarded_at is not null
       and (u.suspended_until is null or u.suspended_until <= now())
       and u.id is distinct from p_actor
     order by u.id
       for no key update of u
  loop
    if v_admin = any (v_skip) then
      continue;
    end if;
    perform activity_upsert(v_admin, p_actor, p_action, p_group,
                            p_clear, p_comment, p_tip, p_subject, p_data);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $fn$;


-- ---------------------------------------------------------------------
--  6. I trigger
--
--  Per le scritture che creano o cambiano una riga sola: un clear o una
--  tip nuovi (nessun altro li vede ancora, quindi l'ordine dei lock non
--  conta), la modifica di una tip, la moderazione e l'account. Voti,
--  cancellazioni, commenti e revisioni stanno invece nelle funzioni, sotto:
--  li' l'azione si scrive prima di toccare il contenuto, e una
--  cancellazione non conta i voti e i commenti che porta via.
--
--  L'ordine alfabetico dei trigger e' voluto: Postgres li esegue per nome,
--  e activity_moderation_action viene prima di notify_moderation_action,
--  cosi' le righe degli admin si bloccano prima di quella dell'autore del
--  contenuto (un test lo controlla).
-- ---------------------------------------------------------------------

create function activity_clear()
returns trigger language plpgsql as $fn$
begin
  if current_setting('dts.silent', true) = 'on' then
    return null;
  end if;
  perform activity_note(new.author_id, 'clear_posted', 'act:clear_posted:' || new.id, p_clear => new.id);
  return null;
end $fn$;

create trigger activity_clear after insert on clear
  for each row execute function activity_clear();

create function activity_tip()
returns trigger language plpgsql as $fn$
begin
  if current_setting('dts.silent', true) = 'on' then
    return null;
  end if;
  perform activity_note(new.author_id, 'tip_posted', 'act:tip_posted:' || new.id, p_tip => new.id);
  return null;
end $fn$;

create trigger activity_tip after insert on tip
  for each row execute function activity_tip();

-- edited_at lo tocca solo edit_tip, e solo quando testo o link cambiano
-- (0025): il punteggio (tip_vote_sync) e la moderazione non lo toccano.
create function activity_tip_edit()
returns trigger language plpgsql as $fn$
begin
  if current_setting('dts.silent', true) = 'on' then
    return null;
  end if;
  perform activity_note(new.author_id, 'tip_edited', 'act:tip_edited:' || new.id, p_tip => new.id);
  return null;
end $fn$;

create trigger activity_tip_edit after update of edited_at on tip
  for each row when (new.edited_at is distinct from old.edited_at)
  execute function activity_tip_edit();

-- La moderazione degli altri admin, dal registro: un trigger solo copre
-- clear, commenti, tip e sospensioni, come notify_moderation_action.
-- L'attore e' il moderatore (lui non riceve niente); l'autore del
-- contenuto riceve gia' la sua notifica (o, per dismiss, non deve sapere
-- di essere stato segnalato) e resta fuori. 'set_role' viene da uno script
-- (moderator_id null): niente. Motivo, nota e fine della sospensione non
-- si copiano mai.
create function activity_moderation_action()
returns trigger language plpgsql as $fn$
declare
  v_action  text;
  v_clear   uuid;
  v_comment uuid;
  v_tip     uuid;
  v_subject uuid;
begin
  if current_setting('dts.silent', true) = 'on' then
    return null;
  end if;
  v_action := case new.action
    when 'hide'      then 'mod_hide'
    when 'unhide'    then 'mod_unhide'
    when 'dismiss'   then 'mod_dismiss'
    when 'suspend'   then 'mod_suspend'
    when 'unsuspend' then 'mod_unsuspend'
  end;
  if v_action is null then
    return null;
  end if;
  if new.target_kind = 'clear' then
    select id into v_clear from clear where id = new.target_id;
    if v_clear is null then return null; end if;
  elsif new.target_kind = 'comment' then
    select m.id, v.clear_id into v_comment, v_clear
      from clear_comment m join clear_version v on v.id = m.version_id
     where m.id = new.target_id;
    if v_comment is null then return null; end if;
  elsif new.target_kind = 'tip' then
    select id into v_tip from tip where id = new.target_id;
    if v_tip is null then return null; end if;
  elsif new.target_kind = 'user' then
    select id into v_subject from app_user where id = new.target_id;
    if v_subject is null then return null; end if;
  else
    return null;
  end if;
  perform activity_note(new.moderator_id, v_action,
                        'act:mod:' || new.action || ':' || new.target_kind || ':' || new.target_id,
                        v_clear, v_comment, v_tip, v_subject, '{}'::jsonb, array[new.target_author_id]);
  return null;
end $fn$;

create trigger activity_moderation_action after insert on moderation_action
  for each row when (new.action <> 'set_role' and new.moderator_id is not null)
  execute function activity_moderation_action();

-- L'account: un iscritto nuovo che ha scelto l'handle (complete_onboarding)
-- e un cambio di handle (change_handle, anche le sole maiuscole: il
-- confronto e' sul testo, citext le nasconderebbe). L'handle vecchio non si
-- salva: la riga dice quello di adesso, letto da subject_id.
create function activity_app_user()
returns trigger language plpgsql as $fn$
begin
  if current_setting('dts.silent', true) = 'on' or new.onboarded_at is null then
    return null;
  end if;
  if old.onboarded_at is null then
    perform activity_note(new.id, 'user_joined', 'act:joined:' || new.id, p_subject => new.id);
  elsif old.handle::text is distinct from new.handle::text then
    perform activity_note(new.id, 'handle_changed', 'act:handle:' || new.id, p_subject => new.id);
  end if;
  return null;
end $fn$;

create trigger activity_app_user after update of handle, onboarded_at on app_user
  for each row when (old.onboarded_at is distinct from new.onboarded_at
                     or old.handle::text is distinct from new.handle::text)
  execute function activity_app_user();


-- ---------------------------------------------------------------------
--  7. Le funzioni di scrittura, con l'azione dentro
--
--  I corpi sono quelli dell'ultima versione (fra parentesi), copiati, con
--  in piu' la chiamata ad activity_note PRIMA di toccare il contenuto.
--  Un rifiuto dopo (il clear non tuo, la versione vecchia) annulla anche
--  l'azione: e' la stessa transazione.
-- ---------------------------------------------------------------------

-- Una revisione (0002). L'azione prima di spegnere la versione corrente:
-- chi vota su quella versione nello stesso istante prende gli stessi lock
-- nello stesso ordine.
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

  perform activity_note(p_author, 'clear_revised', 'act:clear_revised:' || p_clear, p_clear => p_clear);

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

-- Cancellare un clear (0002): UNA azione. Evento e tier si leggono prima,
-- perche' dopo la riga non c'e' piu': sono gli unici dati che la notifica
-- tiene. I voti e i commenti che la cascata porta via non contano.
create or replace function delete_clear(p_author uuid, p_clear uuid)
returns void language plpgsql as $fn$
declare
  v_event bigint;
  v_tier  bigint;
begin
  select event_id, stage_tier_id into v_event, v_tier
    from clear where id = p_clear and author_id = p_author;
  if found then
    perform activity_note(p_author, 'clear_deleted', 'act:clear_deleted:' || p_clear,
                          p_data => jsonb_strip_nulls(jsonb_build_object('event', v_event, 'tier', v_tier)));
  end if;
  delete from clear where id = p_clear and author_id = p_author;
  if not found then
    raise exception 'clear inesistente o non tuo' using errcode = '42501';
  end if;
end $fn$;

-- Il voto dal sito (0016). Un'azione solo se il valore cambia davvero:
-- rivotare lo stesso valore, o ritirare un voto che non c'e', non scrive.
-- Il proprio clear non si vota (lo rifiuta vote_clear): niente azione.
-- Il gruppo e' il clear, non la versione.
create or replace function vote_clear_version(p_user uuid, p_version uuid, p_value smallint)
returns int language plpgsql as $fn$
declare
  v_score  int;
  v_clear  uuid;
  v_author uuid;
  v_old    smallint;
begin
  perform builder_assert_author(p_user);
  if p_value is null or p_value not in (-1, 0, 1) then
    perform builder_fail('builder_vote_value', 'un voto vale -1, 0 (ritirato) o 1');
  end if;
  perform builder_assert_current(p_version);
  select c.id, c.author_id into v_clear, v_author
    from clear_version v join clear c on c.id = v.clear_id where v.id = p_version;
  select value into v_old from clear_vote where version_id = p_version and user_id = p_user;
  if v_old is distinct from nullif(p_value, 0) and v_author is distinct from p_user then
    perform activity_note(p_user,
                          case p_value when 1 then 'clear_upvoted' when -1 then 'clear_downvoted' else 'clear_unvoted' end,
                          'act:clear_vote:' || v_clear, p_clear => v_clear);
  end if;
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

-- Un commento dal sito (0016). L'azione prima del commento, quindi prima
-- di notify_clear_comment: le righe degli admin si bloccano prima di
-- quella dell'autore del clear. Il gruppo e' il clear, come per lui.
-- L'autore del clear, se e' un admin col feed acceso, riceve anche la
-- riga del feed: clear_comment parla del suo clear, e la sua push ha la
-- coalescenza e i tetti di 0031 (niente push da un account nuovo); il
-- feed dice l'azione, e non ne deve perdere nessuna.
create or replace function comment_clear_version(
  p_user uuid, p_version uuid, p_body text, p_lang text default null
) returns uuid language plpgsql as $fn$
declare
  v_clear uuid;
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
  select c.id into v_clear
    from clear_version v join clear c on c.id = v.clear_id where v.id = p_version;
  perform activity_note(p_user, 'comment_posted', 'act:comment:' || v_clear, p_clear => v_clear);
  return add_clear_comment(p_user, p_version, p_body, p_lang);
end $fn$;

-- Cancellare una tip (0025): come delete_clear. Chi e' sospeso puo'
-- ancora farlo, e l'azione si conta lo stesso.
create or replace function delete_tip(p_user uuid, p_tip uuid)
returns bigint language plpgsql as $fn$
declare
  v_event bigint;
  v_tier  bigint;
begin
  select event_id, stage_tier_id into v_event, v_tier
    from tip where id = p_tip and author_id = p_user;
  if found then
    perform activity_note(p_user, 'tip_deleted', 'act:tip_deleted:' || p_tip,
                          p_data => jsonb_strip_nulls(jsonb_build_object('event', v_event, 'tier', v_tier)));
  end if;
  delete from tip where id = p_tip and author_id = p_user returning event_id into v_event;
  if not found then
    perform tip_fail('tip_not_yours', 'tip inesistente o non tua', '42501');
  end if;
  return v_event;
end $fn$;

-- Helpful (0025): un'azione solo se lo stato cambia, prima della
-- scrittura. Due 1 di fila, o uno 0 senza voto, non scrivono.
create or replace function vote_tip(p_user uuid, p_tip uuid, p_value smallint)
returns int language plpgsql as $fn$
declare
  v_author uuid;
  v_status text;
  v_score  int;
  v_had    boolean;
begin
  perform builder_assert_author(p_user);
  if p_value is null or p_value not in (0, 1) then
    perform tip_fail('tip_vote_value', 'un voto su una tip vale 1, o 0 per ritirarlo');
  end if;
  select author_id, status into v_author, v_status from tip where id = p_tip;
  if not found or v_status <> 'published' then
    perform tip_fail('tip_missing', format('tip inesistente o nascosta: %s', p_tip));
  end if;
  if v_author = p_user then
    perform tip_fail('tip_own_vote', 'non si vota la propria tip', '42501');
  end if;
  v_had := exists (select 1 from tip_vote where tip_id = p_tip and user_id = p_user);
  if (p_value = 1) <> v_had then
    perform activity_note(p_user, case when p_value = 1 then 'tip_helpful' else 'tip_unhelpful' end,
                          'act:tip_vote:' || p_tip, p_tip => p_tip);
  end if;
  if p_value = 1 then
    insert into tip_vote (tip_id, user_id, value) values (p_tip, p_user, 1)
    on conflict (tip_id, user_id) do nothing;
  else
    delete from tip_vote where tip_id = p_tip and user_id = p_user;
  end if;
  select score into v_score from tip where id = p_tip;
  return v_score;
end $fn$;

-- Cancellare l'account (0020). L'azione per prima, prima del lock sulla
-- propria riga: le righe degli admin si bloccano prima, come per ogni
-- altra scrittura. Nessun attore e nessun soggetto: "An account was
-- deleted", senza handle. Chi cancella resta fuori (p_skip), anche se e'
-- un admin col feed acceso. Un handle sbagliato annulla tutto, azione
-- compresa. I clear, le tip, i voti e i commenti che la cascata porta via
-- non sono azioni: le loro righe se ne vanno con loro.
create or replace function delete_account(p_user uuid, p_handle text)
returns void language plpgsql as $$
declare v_handle citext;
begin
  perform activity_note(null, 'account_deleted', 'act:account_deleted', p_skip => array[p_user]);
  select handle into v_handle from app_user where id = p_user for update;
  if not found then
    raise exception 'utente inesistente' using errcode = '42501', constraint = 'account_missing';
  end if;
  if p_handle is null or v_handle is null
     or v_handle is distinct from btrim(p_handle)::citext then
    raise exception 'l''handle scritto non e'' quello dell''account'
      using errcode = '23514', constraint = 'account_handle_mismatch';
  end if;
  delete from app_user where id = p_user;
end $$;

-- Una segnalazione nuova (0028): nello stesso giro degli admin, in ordine
-- di id, reports_open e (per chi ha il feed) l'azione 'report'. Le stesse
-- esclusioni: chi segnala e chi e' segnalato. L'azione non tiene chi
-- segnala, nemmeno come attore (reports_open si', per i tetti delle push
-- di 0031): mai a se stessi lo garantisce gia' il giro, che lo salta. Il
-- bersaglio e' una FK vera, quindi la riga se ne va con il contenuto, come
-- le segnalazioni (report_target_gone). 'proof' non si segnala piu' dal
-- sito (report_content lo rifiuta): niente azione. Il giro legge ruolo e
-- feed senza lock, come in 0028: un admin retrocesso nel frattempo lo
-- scarta activity_upsert, che ricontrolla il ruolo sulla riga bloccata.
create or replace function notify_report()
returns trigger language plpgsql as $fn$
declare
  v_target_author uuid;
  v_admin         record;
  v_clear         uuid;
  v_comment       uuid;
  v_tip           uuid;
  v_ok            boolean := false;
begin
  if current_setting('dts.silent', true) = 'on' or new.status <> 'open' then
    return null;
  end if;
  v_target_author := report_target_author(new.target_kind, new.target_id);
  if new.target_kind = 'clear' then
    select id into v_clear from clear where id = new.target_id;
    v_ok := v_clear is not null;
  elsif new.target_kind = 'comment' then
    select m.id, v.clear_id into v_comment, v_clear
      from clear_comment m join clear_version v on v.id = m.version_id
     where m.id = new.target_id;
    v_ok := v_comment is not null;
  elsif new.target_kind = 'tip' then
    select id into v_tip from tip where id = new.target_id;
    v_ok := v_tip is not null;
  end if;
  for v_admin in
    select u.id,
           exists (select 1 from notification_pref p
                    where p.user_id = u.id and p.kind = 'site_activity' and p.channel = 'list') as feed
      from app_user u
     where u.role = 'admin' and u.onboarded_at is not null
       and (u.suspended_until is null or u.suspended_until <= now())
       and u.id <> new.reporter_id
       and u.id is distinct from v_target_author
     order by u.id
  loop
    perform notify_upsert(v_admin.id, 'reports_open', 'reports_queue', new.reporter_id);
    if v_admin.feed and v_ok then
      perform activity_upsert(v_admin.id, null, 'report',
                              'act:report:' || new.target_kind || ':' || new.target_id,
                              v_clear, v_comment, v_tip);
    end if;
  end loop;
  return null;
end $fn$;


-- ---------------------------------------------------------------------
--  8. La lettura: notification_rows (0028)
--
--  p_limit vale ora per famiglia: le notifiche personali e quelle del
--  feed hanno ognuna le loro p_limit piu' recenti, cosi' il feed di un
--  admin non spinge mai fuori dalla lista (e dal digest) i commenti sui
--  suoi clear. La lista ne mostra quindi fino al doppio.
--
--  Per site_activity:
--    n               data.n, le azioni contate finche' non e' letta;
--    actor_handle    l'handle di adesso dell'attore ("Someone" se se n'e'
--                    andato), ma MAI per 'report': chi segnala non si dice
--                    (la riga non lo tiene, e qui lo si spegne lo stesso);
--    target          'profile' per iscrizioni, handle e sospensioni,
--                    'none' per un account cancellato, altrimenti 'tip',
--                    'comment' o 'clear' dalle FK e dall'azione;
--    evento e tier   dal contenuto, o da data per uno cancellato;
--    visible         il destinatario e' ancora admin (contenuti e soggetti
--                    spariti portano via la riga da soli);
--    action          data.a, l'ultima azione del gruppo;
--    subject_handle  l'handle di adesso di subject_id;
--    subject_public  il suo profilo si vede (public_profile di 0026: non
--                    chi e' sospeso), quindi il link va li'; altrimenti
--                    la sua pagina di /admin, perche' il profilo sarebbe
--                    un 404. null senza subject_id.
--  Gli altri tipi restano come in 0028 (action, subject_handle e
--  subject_public null).
--
--  Una riga sola (p_id, cioe' notification_render: push_claim a ogni job,
--  la rotta /notifications/<id>) si prende per chiave primaria, nel primo
--  ramo. I due rami delle famiglie girano solo per la lista: p_id is null
--  non tocca nessuna colonna, e Postgres lo valuta una volta sola (anche
--  nel piano generico, che push_claim puo' riusare da un job all'altro)
--  senza leggere le righe del destinatario. Con (p_id is null or n.id = p_id) dentro ogni ramo,
--  il piano generico scorrerebbe tutte le notifiche di ogni famiglia per
--  trovarne una.
-- ---------------------------------------------------------------------

create or replace function notification_rows(p_user uuid, p_id bigint, p_limit int)
returns setof notification_view language sql stable as $fn$
  with scelte as (
    select n.id from notification n
     where n.id = p_id and n.recipient_id = p_user
    union all
    (select n.id from notification n
      where p_id is null and n.recipient_id = p_user and n.kind <> 'site_activity'
      order by n.updated_at desc, n.id desc
      limit greatest(least(coalesce(p_limit, 50), 200), 1))
    union all
    (select n.id from notification n
      where p_id is null and n.recipient_id = p_user and n.kind = 'site_activity'
      order by n.updated_at desc, n.id desc
      limit greatest(least(coalesce(p_limit, 50), 200), 1))
  )
  select x.id, x.kind, x.created_at, x.updated_at, x.read_at,
         case x.kind when 'clear_comment' then cm.n when 'reports_open' then rp.n
                     when 'site_activity' then coalesce((x.data ->> 'n')::int, 1) else 1 end,
         case when x.kind = 'site_activity' then case when x.data ->> 'a' <> 'report' then au.handle end
              else cm.actor_handle end,
         case when x.kind = 'site_activity' then
                case when x.data ->> 'a' in ('user_joined', 'handle_changed', 'mod_suspend', 'mod_unsuspend') then 'profile'
                     when x.data ->> 'a' = 'account_deleted' then 'none'
                     when x.tip_id is not null or left(x.data ->> 'a', 4) = 'tip_' then 'tip'
                     when x.comment_id is not null then 'comment'
                     else 'clear' end
              when x.kind in ('suspended', 'suspension_lifted') then 'account'
              when x.kind = 'reports_open' then 'reports'
              when x.tip_id is not null then 'tip'
              when x.comment_id is not null then 'comment'
              else 'clear' end,
         x.clear_id, x.comment_id, x.tip_id,
         coalesce(c.event_id, t.event_id, ad.event_id),
         r.reg,
         coalesce(c.stage_tier_id, t.stage_tier_id, ad.tier_id),
         et.name, s.seq, sx.name, st.difficulty::text,
         case when x.tip_id is not null then t.status = 'published'
              when x.comment_id is not null then m.status = 'published' and c.status = 'published'
              when x.clear_id is not null then c.status = 'published'
         end,
         case x.kind
           when 'clear_comment' then c.status = 'published' and cm.n > 0
           when 'reports_open'  then ru.role = 'admin' and rp.n > 0
           when 'site_activity' then ru.role = 'admin'
           else true
         end,
         (x.data ->> 'until')::timestamptz,
         case when x.kind = 'site_activity' then x.data ->> 'a' end,
         su.handle,
         case when su.id is not null then exists (select 1 from public_profile pp where pp.id = su.id) end
    from scelte
    join notification x on x.id = scelte.id
    join app_user ru on ru.id = x.recipient_id
    left join app_user au      on au.id = x.actor_id and x.kind = 'site_activity'
    left join app_user su      on su.id = x.subject_id
    -- dove stava un contenuto cancellato: solo id dei dati di gioco (il CHECK)
    cross join lateral (
      select case when x.kind = 'site_activity' then (x.data ->> 'event')::bigint end as event_id,
             case when x.kind = 'site_activity' then (x.data ->> 'tier')::bigint end as tier_id
    ) ad
    left join clear c          on c.id = x.clear_id
    left join clear_comment m  on m.id = x.comment_id
    left join tip t            on t.id = x.tip_id
    left join event_run r      on r.id = c.run_id
    left join event_text et    on et.event_id = coalesce(c.event_id, t.event_id, ad.event_id) and et.locale = 'en'
    left join stage_tier st    on st.id = coalesce(c.stage_tier_id, t.stage_tier_id, ad.tier_id)
    left join stage s          on s.id = st.stage_id
    left join stage_text sx    on sx.stage_id = s.id and sx.locale = 'en'
    left join lateral (
      select count(*)::int as n,
             (array_agg(u.handle order by k.created_at desc, k.id desc))[1] as actor_handle
        from clear_comment k
        join clear_version kv on kv.id = k.version_id
        join app_user u on u.id = k.author_id
       where kv.clear_id = x.clear_id and k.status = 'published'
         and k.author_id <> x.recipient_id
         and k.created_at >= x.created_at
         and k.created_at <= coalesce(x.read_at, 'infinity')
    ) cm on x.kind = 'clear_comment'
    left join lateral (
      select count(*)::int as n
        from report o
       where o.status = 'open'
         and o.created_at >= x.created_at
         and o.created_at <= coalesce(x.read_at, 'infinity')
         and o.reporter_id <> x.recipient_id
         and report_target_author(o.target_kind, o.target_id) is distinct from x.recipient_id
    ) rp on x.kind = 'reports_open'
   order by x.updated_at desc, x.id desc;
$fn$;


-- ---------------------------------------------------------------------
--  8b. Aprire la lista: mark_list_read
--
--  /notifications segna lette le non lette che mostra, e il pallino si
--  spegne solo quando non ne resta nessuna (mark_notifications_read). Le
--  non lette oltre le p_limit piu' recenti di una famiglia pero' non si
--  mostrano mai: restavano non lette, e il pallino acceso a ogni visita,
--  fino alla pulizia dei 90 giorni. Col feed di un sito attivo bastano 50
--  gruppi nuovi fra due visite.
--
--  Qui, sotto lo stesso lock, si segnano lette anche quelle: oltre le
--  p_limit di ogni famiglia, nell'ordine di notification_rows. Poi
--  mark_notifications_read fa il resto come prima: le mostrate (p_ids) e
--  il pallino. Una notifica nata fra la lista e questa chiamata, o una di
--  quelle oltre il limite toccata nel frattempo, va in cima alla sua
--  famiglia, non oltre il limite: resta non letta, col pallino acceso, e
--  si vede alla visita dopo (e la sua push parte).
--
--  Torna quante ne ha segnate in tutto (marked) e, perche' il feed non
--  ne salti nessuna in silenzio, quante azioni del feed ha segnato lette
--  senza che la pagina le mostrasse (unseen_actions, la somma dei loro
--  data.n; non contano quelle in p_ids, che la pagina ha mostrato anche se
--  nel frattempo sono scivolate oltre il limite). La pagina lo dice sotto
--  la sezione Site activity. Per le personali non serve: 50 gruppi non
--  letti sono 50 clear commentati, o 50 post moderati, fra due visite.
-- ---------------------------------------------------------------------

create function mark_list_read(p_user uuid, p_ids bigint[], p_limit int,
                               out marked int, out unseen_actions int)
language plpgsql as $fn$
begin
  -- il lock di mark_notifications_read e di notify_upsert, prima delle righe
  perform 1 from app_user where id = p_user for update;
  with oltre as (
    update notification set read_at = greatest(clock_timestamp(), created_at)
     where id in (
       select f.id from (
         select n.id, n.read_at,
                row_number() over (partition by n.kind = 'site_activity'
                                   order by n.updated_at desc, n.id desc) as k
           from notification n
          where n.recipient_id = p_user) f
        where f.read_at is null and f.k > greatest(least(coalesce(p_limit, 50), 200), 1))
    returning id, kind, data
  )
  select count(*)::int,
         coalesce(sum(coalesce((data ->> 'n')::int, 1))
                    filter (where kind = 'site_activity' and not (id = any (coalesce(p_ids, '{}'::bigint[])))), 0)::int
    into marked, unseen_actions
    from oltre;
  marked := marked + mark_notifications_read(p_user, p_ids);
end $fn$;


-- ---------------------------------------------------------------------
--  9. Le preferenze (0028)
--
--  I canali per tipo: site_activity solo 'list' (il consenso al feed) e
--  'push', gli altri solo 'push' ed 'email'. Accendere reports_open o
--  site_activity e' solo per gli admin; spegnere si puo' sempre.
-- ---------------------------------------------------------------------

create or replace function set_notification_pref(p_user uuid, p_kind text, p_channel text, p_on boolean)
returns boolean language plpgsql as $fn$
declare v_role text;
begin
  select role into v_role from app_user where id = p_user and onboarded_at is not null;
  if not found then
    raise exception 'utente inesistente o senza onboarding'
      using errcode = 'P0002', constraint = 'user_not_found';
  end if;
  if p_kind is null or not (p_kind = any (notification_kinds())) then
    raise exception 'tipo di notifica sconosciuto: %', p_kind
      using errcode = '23514', constraint = 'notification_pref_kind';
  end if;
  if p_channel is null or p_channel not in ('push', 'email', 'list') then
    raise exception 'canale sconosciuto: %', p_channel
      using errcode = '23514', constraint = 'notification_pref_channel';
  end if;
  if (p_kind = 'site_activity' and p_channel = 'email') or (p_kind <> 'site_activity' and p_channel = 'list') then
    raise exception 'il canale % non vale per %', p_channel, p_kind
      using errcode = '23514', constraint = 'notification_pref_channel';
  end if;
  if p_on is null then
    raise exception 'acceso o spento, non null'
      using errcode = '23514', constraint = 'notification_pref_value';
  end if;
  if p_on and p_kind in ('reports_open', 'site_activity') and v_role <> 'admin' then
    raise exception '% e'' solo per gli admin', p_kind
      using errcode = '42501', constraint = 'notification_pref_admin_only';
  end if;
  if p_on then
    insert into notification_pref (user_id, kind, channel) values (p_user, p_kind, p_channel)
    on conflict do nothing;
  else
    delete from notification_pref where user_id = p_user and kind = p_kind and channel = p_channel;
  end if;
  return p_on;
end $fn$;


-- ---------------------------------------------------------------------
--  10. Le push (0031): push_claim
--
--  Il corpo di 0031, con tre differenze per site_activity:
--    - nessuna coalescenza: una riga gia' mandata e toccata dopo riparte
--      al giro dopo, cioe' a quello che kickPush fa partire dopo la
--      scrittura stessa, con il totale e l'ultima azione. Una push per
--      azione, quindi, e nessuna aspetta la scrittura di qualcun altro (non
--      c'e' un cron delle push). Lo stesso tag prende il posto della
--      notifica di prima sul dispositivo, senza suonare di nuovo (sw.js non
--      chiede renotify), e il Topic fa lo stesso col telefono spento: cento
--      voti di fila sullo stesso clear lasciano una notifica sola, con il
--      totale. Se un giro non riesce (un errore nell'after()), quello che
--      doveva mandare (la prima push di una riga, o il resto di una gia'
--      mandata) lo prende il primo giro dopo, fino a pending_hours
--      dall'ultima azione, anche oltre la finestra dei fresh_minutes. Con i
--      30 minuti di 0031 le azioni di un gruppo gia' mandato aspetterebbero,
--      e oltre la finestra di 10 si perderebbero in silenzio. Una riga mai
--      mandata pero' solo se all'ultima azione la push del feed era gia'
--      accesa e un dispositivo c'era gia': altrimenti il suo giro non
--      l'avrebbe mandata comunque, e accendere la push (o iscrivere un
--      dispositivo) non deve rovesciare sul telefono un giorno di feed. Per
--      lei vale la finestra dei fresh_minutes, come per gli altri tipi;
--    - niente tetto per destinatario e nessuna riga in push_sent: il feed
--      non consuma le 20 push al giorno dei commenti, della moderazione e
--      delle segnalazioni (e non tocca app_user, quindi niente incroci col
--      lock di mark_notifications_read);
--    - pushed_at = clock_timestamp(), come updated_at di activity_upsert.
--  I tetti per attore restano solo per clear_comment e reports_open: il
--  feed deve dire all'admin anche degli account nuovi o sospesi (quelli
--  usa e getta sono proprio cio' che un moderatore vuole vedere), e un
--  tetto per attore zittirebbe le sue azioni in silenzio. Il costo di una
--  scrittura resta piccolo: tocca un gruppo per admin iscritto, e un
--  giro manda al massimo p_limit notifiche, ognuna a 5 dispositivi.
-- ---------------------------------------------------------------------

-- Il tetto del feed, come push_caps (0031): cambiarlo e' una migrazione.
--   pending_hours  fino a quando, dall'ultima azione, quello che un giro
--                  non e' riuscito a mandare (la prima push di una riga, o
--                  il resto di una gia' mandata) aspetta il giro dopo
create function activity_push_caps(out pending_hours int)
language sql immutable as $fn$
  select 24;
$fn$;

-- Le righe del feed non lette con qualcosa da mandare (mai mandate, o
-- toccate dopo l'ultima push): il claim le cerca anche oltre la finestra
-- di notification_unread_fresh, nelle ultime pending_hours. Ci sono anche
-- quelle mai mandate di chi ha solo la lista o nessun dispositivo, che il
-- claim scarta: restano poche, il feed e' solo degli admin che l'hanno
-- acceso, e le altre le toglie il giro dopo la scrittura.
create index notification_activity_pending on notification (updated_at)
  where read_at is null and kind = 'site_activity' and (pushed_at is null or pushed_at < updated_at);

create or replace function push_claim(p_limit int default 20)
returns setof push_job language plpgsql as $fn$
declare
  k         record;
  f         record;
  x         record;
  r         notification_view;
  a         record;
  j         push_job;
  v_limit   int := greatest(least(coalesce(p_limit, 20), 100), 1);
  v_taken   int := 0;
  v_actor   uuid;
  v_feed    boolean;
begin
  select * into k from push_caps();
  select * into f from activity_push_caps();
  for x in
    select n.id, n.recipient_id, n.kind, n.group_key, n.actor_id
      from notification n
     where n.read_at is null
       and ((n.updated_at > now() - make_interval(mins => k.fresh_minutes)
             and (n.pushed_at is null
                  or (n.kind <> 'site_activity' and n.pushed_at < n.updated_at
                      and n.pushed_at <= now() - make_interval(mins => k.coalesce_minutes))))
            -- il feed, fino a pending_hours (l'indice sopra): il resto di una
            -- riga gia' mandata, subito; una mai mandata solo se all'ultima
            -- azione la push e un dispositivo c'erano gia' (il suo giro
            -- doveva mandarla e non c'e' riuscito)
            or (n.kind = 'site_activity'
                and n.updated_at > now() - make_interval(hours => f.pending_hours)
                and (n.pushed_at < n.updated_at
                     or (n.pushed_at is null
                         and exists (select 1 from notification_pref p
                                      where p.user_id = n.recipient_id and p.kind = 'site_activity'
                                        and p.channel = 'push' and p.created_at <= n.updated_at)
                         and exists (select 1 from push_subscription s
                                      where s.user_id = n.recipient_id and s.created_at <= n.updated_at)))))
       and exists (select 1 from notification_pref p
                    where p.user_id = n.recipient_id and p.kind = n.kind and p.channel = 'push')
       and exists (select 1 from push_subscription s where s.user_id = n.recipient_id)
     order by n.updated_at, n.id
     -- qualcuna cade nei filtri: se ne guardano di piu' di quante se ne tengono
     limit v_limit * 4
       for update of n skip locked
  loop
    exit when v_taken >= v_limit;
    v_feed := x.kind = 'site_activity';

    if not v_feed and (select count(*) from push_sent s
         where s.recipient_id = x.recipient_id and s.sent_at > now() - interval '24 hours') >= k.recipient_day then
      continue;
    end if;

    v_actor := null;
    if x.kind in ('clear_comment', 'reports_open') and x.actor_id is not null then
      select u.created_at, u.suspended_until into a from app_user u where u.id = x.actor_id;
      if a.created_at > now() - make_interval(hours => k.actor_age_hours)
         or a.suspended_until > now() then
        continue;
      end if;
      if (select count(*) from push_sent s
           where s.actor_id = x.actor_id and s.sent_at > now() - interval '1 hour') >= k.actor_hour
         or (select count(*) from push_sent s
              where s.actor_id = x.actor_id and s.recipient_id = x.recipient_id
                and s.sent_at > now() - interval '1 hour') >= k.pair_hour then
        continue;
      end if;
      v_actor := x.actor_id;
    end if;

    select * into r from notification_render(x.recipient_id, x.id);
    if not found or not r.visible then
      continue;
    end if;

    select jsonb_agg(jsonb_build_object('id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)
                     order by s.created_at, s.id)
      into j.devices
      from push_subscription s where s.user_id = x.recipient_id;
    if j.devices is null then
      continue;
    end if;

    if v_feed then
      update notification set pushed_at = clock_timestamp() where id = x.id;
    else
      update notification set pushed_at = now() where id = x.id;
      insert into push_sent (recipient_id, actor_id) values (x.recipient_id, v_actor);
    end if;
    v_taken := v_taken + 1;

    j.notification_id := x.id;
    j.recipient_id    := x.recipient_id;
    j.kind            := x.kind;
    j.group_key       := x.group_key;
    j.n               := r.n;
    j.actor_handle    := r.actor_handle;
    j.target          := r.target;
    j.event_name      := r.event_name;
    j.stage_seq       := r.stage_seq;
    j.stage_name      := r.stage_name;
    j.difficulty      := r.difficulty;
    j.until           := r.until;
    j.action          := r.action;
    j.subject_handle  := r.subject_handle;
    return next j;
  end loop;
end $fn$;


-- ---------------------------------------------------------------------
--  11. Il digest (0029): digest_due senza il feed
--
--  Il corpo di 0029 con una riga in piu' negli items: site_activity non va
--  MAI per email. Il budget di Resend e' condiviso con i magic link, e il
--  feed di un sito attivo lo consumerebbe da solo.
-- ---------------------------------------------------------------------

create or replace function digest_due(p_limit int default 40, p_upto timestamptz default null)
returns table (
  user_id uuid, email citext, handle citext, token_v int,
  is_admin boolean, has_moderation boolean,
  since timestamptz, upto timestamptz, day text,
  votes int, helpful int, items jsonb
) language sql stable as $fn$
  with w as (
    select least(coalesce(p_upto, now() - interval '1 minute'), now()) as upto,
           (now() at time zone 'UTC')::date as day
  ),
  u as (
    select a.id, a.email, a.handle, a.notify_token_v, a.role = 'admin' as is_admin,
           a.notify_digest_at,
           greatest(a.notify_digest_at, a.notify_digest_on_at) as since
      from app_user a, w
     where a.notify_digest_on_at is not null
       and a.email_verified
       and a.onboarded_at is not null
       and (a.notify_digest_day is null or a.notify_digest_day < w.day)
  ),
  c as (
    select u.*, w.upto, w.day, it.items, it.has_moderation, vo.votes, he.helpful
      from u cross join w
      left join lateral (
        select jsonb_agg(jsonb_build_object(
                 'id', r.id,
                 'kind', r.kind,
                 'target', r.target,
                 'n', r.n,
                 'actor_handle', case when r.kind = 'clear_comment' then r.actor_handle end,
                 'event_name', case when r.target in ('clear', 'comment', 'tip') then r.event_name end,
                 'stage_seq', case when r.kind = 'clear_comment' then r.stage_seq end,
                 'stage_name', case when r.kind = 'clear_comment' then r.stage_name end,
                 'difficulty', case when r.kind = 'clear_comment' then r.difficulty end,
                 'updated_at', r.updated_at)
               order by r.updated_at desc, r.id desc) as items,
               bool_or(r.kind in ('content_hidden', 'content_unhidden', 'suspended', 'suspension_lifted'))
                 as has_moderation
          from notification_rows(u.id, null, 200) r
         where r.read_at is null and r.visible
           and r.kind <> 'site_activity'
           and r.updated_at > u.since and r.updated_at <= w.upto
      ) it on true
      left join lateral (
        select count(*)::int as votes
          from (select distinct v.clear_id, cv.user_id
                  from clear k
                  join clear_version v on v.clear_id = k.id
                  join clear_vote cv on cv.version_id = v.id
                 where k.author_id = u.id and k.status = 'published'
                   and cv.value = 1 and cv.user_id <> u.id
                   and cv.voted_at > u.since and cv.voted_at <= w.upto) d
      ) vo on true
      left join lateral (
        select count(*)::int as helpful
          from tip t join tip_vote tv on tv.tip_id = t.id
         where t.author_id = u.id and t.status = 'published'
           and tv.value = 1 and tv.user_id <> u.id
           and tv.voted_at > u.since and tv.voted_at <= w.upto
      ) he on true
  )
  select c.id, c.email, c.handle, c.notify_token_v, c.is_admin, coalesce(c.has_moderation, false),
         c.since, c.upto, c.day::text, c.votes, c.helpful, coalesce(c.items, '[]'::jsonb)
    from c
   where c.items is not null or c.votes > 0 or c.helpful > 0
   order by c.is_admin desc, coalesce(c.has_moderation, false) desc,
            c.notify_digest_at asc nulls first, c.id
   limit least(greatest(coalesce(p_limit, 40), 1), 100);
$fn$;


-- ---------------------------------------------------------------------
--  12. Chi smette di essere admin: activity_role_lost
--
--  Il feed e' solo per gli admin, e Settings mostra la sua casella solo a
--  loro: chi torna membro non la vedrebbe piu', e non potrebbe ritirare un
--  consenso rimasto. Quindi, quando il ruolo smette di essere 'admin'
--  (set_user_role o qualsiasi altro update), se ne vanno le sue
--  preferenze di site_activity e le righe del feed che aveva: da membro
--  non le vede, e non devono tornare se torna admin. Tornato admin, il
--  feed riparte solo se lo riaccende. Una segnalazione che arriva mentre
--  il ruolo cambia non ne lascia una nuova: la scarta activity_upsert.
--
--  reports_open resta com'era in 0028 e 0031, fuori da questa migrazione:
--  la sua preferenza push rimane, ma a un membro non arriva niente (le
--  righe non sono visibili, e push_claim salta quelle non visibili), e se
--  torna admin le push delle segnalazioni ripartono da sole.
--
--  Il pallino acceso da righe che non ci sono piu' lo spegne la visita
--  dopo a /notifications, come per un contenuto sparito. Nessun dts.silent:
--  un consenso si ritira sempre.
-- ---------------------------------------------------------------------

create function activity_role_lost()
returns trigger language plpgsql as $fn$
begin
  delete from notification_pref where user_id = new.id and kind = 'site_activity';
  delete from notification where recipient_id = new.id and kind = 'site_activity';
  return null;
end $fn$;

create trigger activity_role_lost after update of role on app_user
  for each row when (old.role = 'admin' and new.role is distinct from 'admin')
  execute function activity_role_lost();
