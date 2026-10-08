-- =====================================================================
--  Moderazione: segnalazioni, contenuti nascosti, sospensioni, registro.
--
--  Il modello per ogni tipo di contenuto degli utenti (clear e commenti
--  qui, tip in 0025):
--    - status 'published' | 'hidden', e ogni lettura pubblica filtra
--      'published' anche sul genitore (un commento su un clear nascosto
--      resta nascosto). 'flagged' esiste in clear.status ma non si scrive
--      mai: nessuna lista lo mostrerebbe, e un contenuto sparirebbe in
--      silenzio. Niente nascondimento automatico dopo N segnalazioni: tre
--      account finti basterebbero a togliere qualsiasi clear;
--    - report_content che accetta il tipo, con i motivi ammessi in
--      report_reasons() (gli stessi di lib/moderation/reasons.ts);
--    - il trigger report_target_gone, per non lasciare segnalazioni orfane;
--    - mod_set_<tipo>_status, che scrive il registro e chiude le
--      segnalazioni aperte.
--
--  Modera solo role = 'admin', non sospeso (mod_assert). Il primo admin
--  nasce solo da script (set_user_role, db/admin/set-role.mjs): dal sito
--  i ruoli non si cambiano.
--
--  La sospensione ferma le scritture (invio, revisione, voti, commenti,
--  segnalazioni, tip) dall'unico cancello, builder_assert_author. Non
--  ferma l'accesso, la lettura, le impostazioni, delete_clear e
--  delete_account: chi e' sospeso deve poter cancellare i propri dati.
--
--  Ogni rifiuto ha un nome in CONSTRAINT, tradotto da
--  lib/moderation/errors.ts.
-- =====================================================================


-- ---------------------------------------------------------------------
--  1. Lo stato dei commenti, come quello dei clear
-- ---------------------------------------------------------------------

alter table clear_comment add column status text not null default 'published'
  constraint clear_comment_status_check check (status in ('published', 'hidden'));


-- ---------------------------------------------------------------------
--  2. Le segnalazioni: motivi a codice, stato, chi le ha chiuse
-- ---------------------------------------------------------------------

alter table report drop constraint report_target_kind_check;
alter table report add constraint report_target_kind_check
  check (target_kind in ('clear', 'comment', 'tip', 'proof'));

-- Il motivo era testo libero (0001): quello vecchio diventa il dettaglio
-- di un 'other'. La tabella oggi e' vuota, ma la migrazione regge anche
-- con delle righe.
alter table report add column details text
  constraint report_details_length check (char_length(details) <= 500);
update report set details = left(reason, 500), reason = 'other'
 where reason not in ('fake_proof', 'wrong_stage', 'wrong_info', 'spam', 'offensive', 'personal_info', 'other');
-- L'unione dei motivi di ogni tipo: quali valgono per quale tipo lo dice
-- report_reasons(), qui sotto.
alter table report add constraint report_reason_check
  check (reason in ('fake_proof', 'wrong_stage', 'wrong_info', 'spam', 'offensive', 'personal_info', 'other'));

alter table report add column status text not null default 'open'
  constraint report_status_check check (status in ('open', 'dismissed', 'actioned'));
alter table report add column resolved_by uuid references app_user on delete set null;
update report set status = 'dismissed' where resolved_at is not null;
-- Una sola aperta per persona e bersaglio: le copie piu' vecchie si
-- chiudono prima di creare l'indice (nessuna nei dati di oggi).
update report r set status = 'dismissed', resolved_at = now()
 where r.status = 'open'
   and exists (select 1 from report o
                where o.status = 'open' and o.reporter_id = r.reporter_id
                  and o.target_kind = r.target_kind and o.target_id = r.target_id
                  and (o.created_at, o.id) > (r.created_at, r.id));
-- chiusa se e solo se ha la data di chiusura (resolved_by puo' tornare
-- null: l'admin che l'ha chiusa ha cancellato l'account)
alter table report add constraint report_resolved_consistent
  check ((status = 'open') = (resolved_at is null));

create unique index report_one_open on report (reporter_id, target_kind, target_id) where status = 'open';
create index report_queue on report (created_at) where status = 'open';

-- I commenti adesso sono un bersaglio: come clear, tip e prove (0019).
-- Scatta anche nella cascata clear -> versione -> commento.
create trigger report_target_gone after delete on clear_comment
  for each row execute function report_target_gone('comment');
delete from report r
 where r.target_kind = 'comment'
   and not exists (select 1 from clear_comment m where m.id = r.target_id);


-- ---------------------------------------------------------------------
--  3. La sospensione
--
--  suspended_until null = non sospeso, 'infinity' = a tempo indeterminato.
--  Il motivo lo vede l'utente sospeso (il banner), le note dei moderatori
--  no.
-- ---------------------------------------------------------------------

alter table app_user
  add column suspended_until timestamptz,
  add column suspension_reason text
    constraint app_user_suspension_reason_length check (char_length(suspension_reason) <= 300);

create or replace function user_suspended(p uuid)
returns boolean language sql stable as $fn$
  select coalesce((select suspended_until > now() from app_user where id = p), false);
$fn$;


-- ---------------------------------------------------------------------
--  4. Il registro della moderazione, solo in aggiunta
--
--  Nessuna FK verso il bersaglio: il registro sopravvive al contenuto che
--  descrive, con l'id e basta (mai il testo). Gli handle sono una copia:
--  restano leggibili anche dopo che l'account se n'e' andato.
-- ---------------------------------------------------------------------

create table moderation_action (
  id                bigint generated always as identity primary key,
  moderator_id      uuid references app_user on delete set null,
  moderator_handle  citext,   -- copia; null = uno script (set_user_role)
  action            text not null
                    constraint moderation_action_action_check
                    check (action in ('hide', 'unhide', 'dismiss', 'suspend', 'unsuspend', 'set_role')),
  target_kind       text not null
                    constraint moderation_action_target_kind_check
                    check (target_kind in ('clear', 'comment', 'tip', 'user')),
  target_id         uuid not null,
  target_author_id  uuid references app_user on delete set null,
  reports_closed    int  not null default 0,
  note              text constraint moderation_action_note_length check (char_length(note) <= 500),
  detail            jsonb not null default '{}'::jsonb,   -- {until, reason, role...}, mai il contenuto
  created_at        timestamptz not null default now()
);
create index moderation_action_by_target on moderation_action (target_kind, target_id, created_at desc);
create index moderation_action_recent on moderation_action (created_at desc);
-- la storia di un utente: le azioni sui suoi contenuti e su di lui
create index moderation_action_by_author on moderation_action (target_author_id, created_at desc);

-- Niente UPDATE ne' DELETE. L'unica eccezione e' la cascata on delete set
-- null delle due FK (e' un UPDATE anche lei): passa solo se cambiano
-- moderator_id o target_author_id, e solo verso null.
create or replace function moderation_action_append_only()
returns trigger language plpgsql as $fn$
begin
  if tg_op = 'UPDATE'
     and (new.moderator_id is null or new.moderator_id = old.moderator_id)
     and (new.target_author_id is null or new.target_author_id = old.target_author_id)
     and to_jsonb(new) - 'moderator_id' - 'target_author_id'
       = to_jsonb(old) - 'moderator_id' - 'target_author_id' then
    return new;
  end if;
  raise exception 'il registro della moderazione non si modifica e non si cancella'
    using errcode = '23514', constraint = 'moderation_action_append_only';
end $fn$;

create trigger moderation_action_append_only before update or delete on moderation_action
  for each row execute function moderation_action_append_only();
create trigger moderation_action_no_truncate before truncate on moderation_action
  for each statement execute function moderation_action_append_only();


-- ---------------------------------------------------------------------
--  5. Il registro delle scritture: segnalazioni e tip
--
--  'tip' e 'tip_edit' si definiscono gia' qui, con i loro limiti, cosi'
--  0025 non deve ridefinire di nuovo il check e la funzione.
-- ---------------------------------------------------------------------

alter table clear_write_log drop constraint clear_write_log_kind_check;
alter table clear_write_log add constraint clear_write_log_kind_check
  check (kind in ('submit', 'revise', 'comment', 'report', 'tip', 'tip_edit'));

create or replace function clear_write_limit(p_kind text)
returns int language sql immutable as $fn$
  select case p_kind
    when 'submit' then 10 when 'revise' then 20 when 'comment' then 30
    when 'report' then 10 when 'tip' then 10 when 'tip_edit' then 30 end;
$fn$;


-- ---------------------------------------------------------------------
--  6. Il cancello di ogni scrittura: anche la sospensione
--
--  Stessa firma e stesso builder_author di 0016; in piu' account_suspended.
--  Lo chiamano submit, revise, voti, commenti, report_content e le tip.
-- ---------------------------------------------------------------------

create or replace function builder_assert_author(p_author uuid)
returns void language plpgsql stable as $fn$
declare v_until timestamptz;
begin
  select suspended_until into v_until
    from app_user where id = p_author and onboarded_at is not null;
  if not found then
    raise exception 'utente inesistente o senza handle'
      using errcode = '42501', constraint = 'builder_author';
  end if;
  if v_until > now() then
    raise exception 'account sospeso fino a %', v_until
      using errcode = '42501', constraint = 'account_suspended';
  end if;
end $fn$;


-- ---------------------------------------------------------------------
--  7. Chi modera
-- ---------------------------------------------------------------------

-- Un admin con l'handle, non sospeso. La riga si blocca: due azioni dello
-- stesso moderatore vanno in fila, e un cambio di ruolo a meta' si vede.
-- Torna l'handle, la copia che finisce nel registro.
create or replace function mod_assert(p_mod uuid)
returns citext language plpgsql as $fn$
declare
  v_handle citext;
  v_role   text;
  v_until  timestamptz;
begin
  select handle, role, suspended_until into v_handle, v_role, v_until
    from app_user where id = p_mod and onboarded_at is not null for update;
  if not found or v_role <> 'admin' or v_until > now() then
    raise exception 'non e'' un moderatore'
      using errcode = '42501', constraint = 'mod_not_allowed';
  end if;
  return v_handle;
end $fn$;

-- La nota del moderatore: ripulita, al massimo 500 caratteri, vuota = null.
create or replace function mod_note(p_note text)
returns text language plpgsql immutable as $fn$
declare v text := nullif(btrim(p_note), '');
begin
  if char_length(v) > 500 then
    raise exception 'nota oltre i 500 caratteri'
      using errcode = '23514', constraint = 'mod_note';
  end if;
  return v;
end $fn$;


-- ---------------------------------------------------------------------
--  8. Segnalare
-- ---------------------------------------------------------------------

-- I motivi ammessi per ogni tipo. Li ripete lib/moderation/reasons.ts, e
-- un test controlla che siano gli stessi. 'proof' non ha motivi: una
-- prova falsa si segnala sul clear ("Proof is fake...").
create or replace function report_reasons(p_kind text)
returns text[] language sql immutable as $fn$
  select case p_kind
    when 'clear'   then array['fake_proof', 'wrong_stage', 'spam', 'offensive', 'personal_info', 'other']
    when 'comment' then array['spam', 'offensive', 'personal_info', 'other']
    when 'tip'     then array['wrong_info', 'spam', 'offensive', 'personal_info', 'other']
  end;
$fn$;

-- Il bersaglio deve esistere ed essere visibile (anche il clear di un
-- commento), e non essere tuo. Un'altra segnalazione aperta della stessa
-- persona sullo stesso bersaglio torna il suo id senza contare per il
-- limite: ripetersi non e' un abuso. Torna l'id della segnalazione.
create or replace function report_content(
  p_user uuid, p_kind text, p_target uuid, p_reason text, p_details text
) returns uuid language plpgsql as $fn$
declare
  v_author  uuid;
  v_details text := nullif(btrim(p_details), '');
  v_id      uuid;
begin
  perform builder_assert_author(p_user);
  -- 'tip' arriva con 0025, che ridefinisce questa funzione
  if p_kind is null or p_kind not in ('clear', 'comment') then
    raise exception 'tipo di bersaglio non segnalabile: %', p_kind
      using errcode = '23514', constraint = 'report_kind';
  end if;
  if p_kind = 'clear' then
    select c.author_id into v_author
      from clear c where c.id = p_target and c.status = 'published';
  else
    select m.author_id into v_author
      from clear_comment m
      join clear_version v on v.id = m.version_id
      join clear c on c.id = v.clear_id
     where m.id = p_target and m.status = 'published' and c.status = 'published';
  end if;
  if v_author is null then
    raise exception 'bersaglio inesistente o non visibile: % %', p_kind, p_target
      using errcode = '23514', constraint = 'report_target_missing';
  end if;
  if v_author = p_user then
    raise exception 'non si segnala un proprio contenuto'
      using errcode = '23514', constraint = 'report_own';
  end if;
  if p_reason is null or not (p_reason = any (report_reasons(p_kind))) then
    raise exception 'motivo non ammesso per %: %', p_kind, p_reason
      using errcode = '23514', constraint = 'report_reason';
  end if;
  if (p_reason = 'other' and v_details is null) or char_length(v_details) > 500 then
    raise exception 'dettagli mancanti (per "other") o oltre i 500 caratteri'
      using errcode = '23514', constraint = 'report_details';
  end if;

  -- lo stesso lucchetto di note_clear_write: il controllo del doppione e
  -- il conteggio stanno in fila con le altre scritture di questo utente
  perform pg_advisory_xact_lock(hashtextextended('clear_write:' || p_user::text, 0));
  select id into v_id from report
   where reporter_id = p_user and target_kind = p_kind and target_id = p_target and status = 'open';
  if found then
    return v_id;
  end if;
  begin
    perform note_clear_write(p_user, 'report');
  exception when sqlstate '54000' then
    raise exception 'troppe segnalazioni nell''ultima ora: massimo %', clear_write_limit('report')
      using errcode = '54000', constraint = 'report_rate_limit';
  end;
  insert into report (reporter_id, target_kind, target_id, reason, details)
  values (p_user, p_kind, p_target, p_reason, v_details)
  returning id into v_id;
  return v_id;
end $fn$;


-- ---------------------------------------------------------------------
--  9. Nascondere e rimostrare
--
--  Idempotenti: se lo stato e' gia' quello chiesto non fanno niente e
--  tornano 0 (due moderatori sullo stesso clear). Nascondere chiude come
--  'actioned' le segnalazioni aperte; rimostrare no (non ce ne sono: un
--  bersaglio nascosto non si segnala). Tornano quante ne hanno chiuse.
-- ---------------------------------------------------------------------

create or replace function mod_status(p_status text)
returns void language plpgsql immutable as $fn$
begin
  if p_status is null or p_status not in ('published', 'hidden') then
    raise exception 'stato non previsto: %', p_status
      using errcode = '23514', constraint = 'mod_status';
  end if;
end $fn$;

-- Chiude le segnalazioni aperte su un bersaglio e torna quante.
create or replace function mod_close_reports(p_mod uuid, p_kind text, p_target uuid, p_status text)
returns int language plpgsql as $fn$
declare v_n int;
begin
  update report set status = p_status, resolved_by = p_mod, resolved_at = now()
   where target_kind = p_kind and target_id = p_target and status = 'open';
  get diagnostics v_n = row_count;
  return v_n;
end $fn$;

create or replace function mod_set_clear_status(p_mod uuid, p_clear uuid, p_status text, p_note text)
returns int language plpgsql as $fn$
declare
  v_handle citext := mod_assert(p_mod);
  v_note   text := mod_note(p_note);
  v_old    text;
  v_author uuid;
  v_n      int := 0;
begin
  perform mod_status(p_status);
  select status, author_id into v_old, v_author from clear where id = p_clear for update;
  if not found then
    raise exception 'clear inesistente: %', p_clear
      using errcode = '23514', constraint = 'mod_target_missing';
  end if;
  if v_old = p_status then
    return 0;
  end if;
  update clear set status = p_status where id = p_clear;
  if p_status = 'hidden' then
    v_n := mod_close_reports(p_mod, 'clear', p_clear, 'actioned');
  end if;
  insert into moderation_action
    (moderator_id, moderator_handle, action, target_kind, target_id, target_author_id, reports_closed, note)
  values (p_mod, v_handle, case p_status when 'hidden' then 'hide' else 'unhide' end,
          'clear', p_clear, v_author, v_n, v_note);
  return v_n;
end $fn$;

create or replace function mod_set_comment_status(p_mod uuid, p_comment uuid, p_status text, p_note text)
returns int language plpgsql as $fn$
declare
  v_handle citext := mod_assert(p_mod);
  v_note   text := mod_note(p_note);
  v_old    text;
  v_author uuid;
  v_clear  uuid;
  v_n      int := 0;
begin
  perform mod_status(p_status);
  select m.status, m.author_id, v.clear_id into v_old, v_author, v_clear
    from clear_comment m join clear_version v on v.id = m.version_id
   where m.id = p_comment for update of m;
  if not found then
    raise exception 'commento inesistente: %', p_comment
      using errcode = '23514', constraint = 'mod_target_missing';
  end if;
  if v_old = p_status then
    return 0;
  end if;
  update clear_comment set status = p_status where id = p_comment;
  if p_status = 'hidden' then
    v_n := mod_close_reports(p_mod, 'comment', p_comment, 'actioned');
  end if;
  -- il clear nel dettaglio: e' un id, serve a ritrovare la pagina
  insert into moderation_action
    (moderator_id, moderator_handle, action, target_kind, target_id, target_author_id, reports_closed, note, detail)
  values (p_mod, v_handle, case p_status when 'hidden' then 'hide' else 'unhide' end,
          'comment', p_comment, v_author, v_n, v_note, jsonb_build_object('clear_id', v_clear));
  return v_n;
end $fn$;


-- ---------------------------------------------------------------------
--  10. Archiviare le segnalazioni senza toccare il contenuto
--
--  Dopo, la stessa persona puo' segnalare di nuovo: l'indice unico vale
--  solo per quelle aperte. Senza segnalazioni aperte non scrive niente.
-- ---------------------------------------------------------------------

create or replace function mod_dismiss_reports(p_mod uuid, p_kind text, p_target uuid, p_note text)
returns int language plpgsql as $fn$
declare
  v_handle citext := mod_assert(p_mod);
  v_note   text := mod_note(p_note);
  v_author uuid;
  v_n      int;
begin
  if p_kind is null or p_kind not in ('clear', 'comment', 'tip') then
    raise exception 'tipo di bersaglio non previsto: %', p_kind
      using errcode = '23514', constraint = 'mod_kind';
  end if;
  v_n := mod_close_reports(p_mod, p_kind, p_target, 'dismissed');
  if v_n = 0 then
    return 0;
  end if;
  v_author := case p_kind
    when 'clear'   then (select author_id from clear where id = p_target)
    when 'comment' then (select author_id from clear_comment where id = p_target)
    when 'tip'     then (select author_id from tip where id = p_target)
  end;
  insert into moderation_action
    (moderator_id, moderator_handle, action, target_kind, target_id, target_author_id, reports_closed, note)
  values (p_mod, v_handle, 'dismiss', p_kind, p_target, v_author, v_n, v_note);
  return v_n;
end $fn$;


-- ---------------------------------------------------------------------
--  11. Sospendere e riattivare
--
--  Non si sospende se stessi ne' un altro admin: un admin compromesso non
--  puo' togliere di mezzo gli altri. Le sessioni restano: il blocco e'
--  nel cancello delle scritture, e vale dalla richiesta dopo.
-- ---------------------------------------------------------------------

-- p_until null = a tempo indeterminato. Risospendere sovrascrive (si
-- allunga o si accorcia). Torna la data effettiva.
create or replace function mod_suspend_user(p_mod uuid, p_user uuid, p_until timestamptz, p_reason text)
returns timestamptz language plpgsql as $fn$
declare
  v_handle citext := mod_assert(p_mod);
  v_until  timestamptz := coalesce(p_until, 'infinity'::timestamptz);
  v_reason text := nullif(btrim(p_reason), '');
  v_role   text;
begin
  if p_user = p_mod then
    raise exception 'un moderatore non sospende se stesso'
      using errcode = '42501', constraint = 'mod_suspend_forbidden';
  end if;
  select role into v_role from app_user where id = p_user for update;
  if not found then
    raise exception 'utente inesistente: %', p_user
      using errcode = '23514', constraint = 'mod_user_missing';
  end if;
  if v_role = 'admin' then
    raise exception 'un admin non si sospende'
      using errcode = '42501', constraint = 'mod_suspend_forbidden';
  end if;
  if v_until <= now() then
    raise exception 'la sospensione deve finire nel futuro: %', v_until
      using errcode = '23514', constraint = 'mod_suspend_until';
  end if;
  if char_length(v_reason) > 300 then
    raise exception 'motivo oltre i 300 caratteri'
      using errcode = '23514', constraint = 'mod_suspend_reason';
  end if;
  update app_user set suspended_until = v_until, suspension_reason = v_reason where id = p_user;
  insert into moderation_action
    (moderator_id, moderator_handle, action, target_kind, target_id, target_author_id, detail)
  values (p_mod, v_handle, 'suspend', 'user', p_user, p_user,
          jsonb_build_object('until', v_until, 'reason', v_reason));
  return v_until;
end $fn$;

-- Torna false se non era sospeso (una sospensione gia' scaduta si
-- ripulisce senza scrivere nel registro).
create or replace function mod_unsuspend_user(p_mod uuid, p_user uuid, p_note text)
returns boolean language plpgsql as $fn$
declare
  v_handle citext := mod_assert(p_mod);
  v_note   text := mod_note(p_note);
  v_until  timestamptz;
begin
  select suspended_until into v_until from app_user where id = p_user for update;
  if not found then
    raise exception 'utente inesistente: %', p_user
      using errcode = '23514', constraint = 'mod_user_missing';
  end if;
  update app_user set suspended_until = null, suspension_reason = null
   where id = p_user and (suspended_until is not null or suspension_reason is not null);
  if v_until is null or v_until <= now() then
    return false;
  end if;
  insert into moderation_action
    (moderator_id, moderator_handle, action, target_kind, target_id, target_author_id, note, detail)
  values (p_mod, v_handle, 'unsuspend', 'user', p_user, p_user, v_note,
          jsonb_build_object('was_until', v_until));
  return true;
end $fn$;


-- ---------------------------------------------------------------------
--  12. I ruoli: solo da script
--
--  Mai esposta al sito: la chiama db/admin/set-role.mjs (npm run db:role,
--  prod:role). Nel registro moderator_id e' null. Lo stesso ruolo di prima
--  non scrive niente. Torna il ruolo di prima.
-- ---------------------------------------------------------------------

create or replace function set_user_role(p_handle citext, p_role text)
returns text language plpgsql as $fn$
declare
  v_id  uuid;
  v_old text;
begin
  if p_role is null or p_role not in ('member', 'editor', 'admin') then
    raise exception 'ruolo non previsto: %', p_role
      using errcode = '23514', constraint = 'role_invalid';
  end if;
  select id, role into v_id, v_old from app_user where handle = btrim(p_handle)::citext for update;
  if not found then
    raise exception 'nessun utente con handle %', p_handle
      using errcode = '23514', constraint = 'role_user_missing';
  end if;
  if v_old = p_role then
    return v_old;
  end if;
  update app_user set role = p_role where id = v_id;
  insert into moderation_action (action, target_kind, target_id, target_author_id, detail)
  values ('set_role', 'user', v_id, v_id, jsonb_build_object('from', v_old, 'role', p_role));
  return v_old;
end $fn$;


-- ---------------------------------------------------------------------
--  13. La conservazione: le segnalazioni chiuse se ne vanno dopo 180 giorni
--
--  Le chiama il cron giornaliero (/api/cron/purge). Il testo delle
--  segnalazioni puo' contenere dati personali; il registro resta per
--  sempre, ma tiene solo id e handle. Torna quante ne ha cancellate.
-- ---------------------------------------------------------------------

create or replace function purge_resolved_reports(p_days int default 180)
returns int language plpgsql as $fn$
declare v_n int;
begin
  delete from report
   where status <> 'open' and resolved_at < now() - make_interval(days => greatest(p_days, 1));
  get diagnostics v_n = row_count;
  return v_n;
end $fn$;
