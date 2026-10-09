-- =====================================================================
--  Le notifiche nel sito (fase 2 del piano PWA e notifiche).
--
--  In v1 si notificano tre cose, decise dal proprietario:
--    - clear_comment: un commento sul mio clear (a chi l'ha pubblicato);
--    - la moderazione dei miei contenuti: content_hidden,
--      content_unhidden, suspended, suspension_lifted;
--    - reports_open: le segnalazioni aperte, solo agli admin.
--  Voti e Helpful NON scrivono righe: il digest email (fase 3) li conta da
--  clear_vote.voted_at e tip_vote.voted_at. Cosi' un voto non tocca mai
--  app_user, e il pallino del menu resta gratis.
--
--  Le righe le scrivono i trigger, nella stessa transazione della
--  scrittura della community: se il commento torna indietro, torna
--  indietro anche la notifica. Nessun codice dell'app le crea.
--
--  Regole che valgono ovunque:
--    - mai a se stessi (l'attore e' il destinatario: niente);
--    - chi segnala non riceve niente, e chi viene segnalato non riceve MAI
--      niente: non deve sapere che e' stato segnalato, ne' da chi (l'orario
--      basterebbe a tradirlo);
--    - chi e' sospeso continua a ricevere quelle sui propri contenuti;
--    - il testo dei post non si copia mai qui: render ricalcola tutto
--      dalle tabelle vere, e un commento nascosto smette di contare;
--    - dts.silent = 'on' spegne tutto (seed, fixture, import).
--
--  Il pallino nel menu: app_user.notif_last_at > notif_seen_at. Le due
--  colonne le legge gia' la sessione di better-auth (additionalFields):
--  /api/me non fa query in piu'.
-- =====================================================================


-- ---------------------------------------------------------------------
--  1. I tipi
--
--  Li ripete lib/notify/kinds.ts, e un test controlla che coincidano
--  (come report_reasons e i temi). Il check e' letterale: una funzione
--  cambiata dopo non rivaliderebbe le righe gia' scritte.
-- ---------------------------------------------------------------------

create function notification_kinds()
returns text[] language sql immutable as $fn$
  select array['clear_comment', 'content_hidden', 'content_unhidden',
               'suspended', 'suspension_lifted', 'reports_open'];
$fn$;


-- ---------------------------------------------------------------------
--  2. Le tabelle
-- ---------------------------------------------------------------------

-- Una riga per (destinatario, gruppo) finche' non e' letta: gli eventi
-- nuovi dello stesso gruppo la toccano (updated_at, l'ultimo attore) e
-- basta. Dopo la lettura, l'evento dopo apre una riga nuova.
--
-- Le FK verso i contenuti sono vere e a cascata (non un target_id
-- polimorfico come report): un contenuto cancellato porta via le sue
-- notifiche, senza tracce. actor_id va a null con l'account dell'attore.
create table notification (
  id            bigint generated always as identity primary key,
  recipient_id  uuid not null references app_user on delete cascade,
  kind          text not null
                constraint notification_kind_check check (kind in (
                  'clear_comment', 'content_hidden', 'content_unhidden',
                  'suspended', 'suspension_lifted', 'reports_open')),
  group_key     text not null constraint notification_group_length check (char_length(group_key) <= 200),
  actor_id      uuid references app_user on delete set null,
  clear_id      uuid references clear on delete cascade,
  comment_id    uuid references clear_comment on delete cascade,
  tip_id        uuid references tip on delete cascade,
  -- solo dati che non sono testo dei post: per ora la fine di una
  -- sospensione ({until}). Il motivo della sospensione e la nota del
  -- moderatore non ci finiscono mai.
  data          jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  read_at       timestamptz,
  -- la consegna push della fase 4 (coalescenza e tetti per attore)
  pushed_at     timestamptz,
  constraint notification_read_after check (read_at is null or read_at >= created_at)
);
-- l'accorpamento: una sola non letta per gruppo
create unique index notification_one_unread on notification (recipient_id, group_key) where read_at is null;
-- la lista di /notifications
create index notification_by_recipient on notification (recipient_id, updated_at desc, id desc);
-- i tetti per attore della fase 4, e la FK set null quando l'attore se ne va
create index notification_by_actor on notification (actor_id, pushed_at) where actor_id is not null;
-- le cascate dai contenuti: senza indice, cancellare un clear leggerebbe tutta la tabella
create index notification_by_clear   on notification (clear_id)   where clear_id is not null;
create index notification_by_comment on notification (comment_id) where comment_id is not null;
create index notification_by_tip     on notification (tip_id)     where tip_id is not null;

-- Push ed email: una riga presente vuol dire acceso. Senza righe e'
-- tutto spento, quindi il default non costa niente. La lista nel sito non
-- ha preferenze: e' sempre accesa. Le righe le usano le fasi 3 e 4.
create table notification_pref (
  user_id  uuid not null references app_user on delete cascade,
  kind     text not null
           constraint notification_pref_kind_check check (kind in (
             'clear_comment', 'content_hidden', 'content_unhidden',
             'suspended', 'suspension_lifted', 'reports_open')),
  channel  text not null constraint notification_pref_channel_check check (channel in ('push', 'email')),
  created_at timestamptz not null default now(),
  primary key (user_id, kind, channel)
);

-- Il pallino. notif_last_at lo mette notify_upsert, notif_seen_at
-- mark_notifications_read. null = mai.
alter table app_user
  add column notif_last_at timestamptz,
  add column notif_seen_at timestamptz;

-- Il digest della fase 3 conta i nuovi Helpful dall'ultimo invio. La
-- colonna c'e' gia' da 0025 (con il voto solo +1): "if not exists" la
-- rende una garanzia, non una seconda colonna.
alter table tip_vote add column if not exists voted_at timestamptz not null default now();


-- ---------------------------------------------------------------------
--  3. Chi e' l'autore di un bersaglio segnalato
--
--  report.target_id e' polimorfico. Serve a non avvisare mai chi viene
--  segnalato, nemmeno se e' un admin. null se il bersaglio non c'e' piu'.
-- ---------------------------------------------------------------------

create function report_target_author(p_kind text, p_target uuid)
returns uuid language sql stable as $fn$
  select case p_kind
    when 'clear'   then (select author_id from clear where id = p_target)
    when 'comment' then (select author_id from clear_comment where id = p_target)
    when 'tip'     then (select author_id from tip where id = p_target)
    when 'proof'   then (select c.author_id from clear_proof p
                           join clear_version v on v.id = p.version_id
                           join clear c on c.id = v.clear_id
                          where p.id = p_target)
  end;
$fn$;


-- ---------------------------------------------------------------------
--  4. La scrittura: notify_upsert
--
--  La chiamano solo i trigger qui sotto. Esce subito con dts.silent = 'on'
--  (set local nella transazione di seed, fixture e import), con un
--  destinatario mancante, o quando l'attore e' il destinatario.
--
--  Poi l'upsert sull'indice parziale: o una riga nuova, o la non letta
--  dello stesso gruppo con updated_at e l'ultimo attore. I riferimenti ai
--  contenuti non cambiano: lo stesso gruppo e' lo stesso bersaglio.
--
--  Prima di tutto app_user.notif_last_at, per il pallino: e' anche il lock
--  sulla riga del destinatario, preso PRIMA della notifica come fa
--  mark_notifications_read. Cosi' le due vanno in fila sulla stessa riga e
--  non si incrociano (niente deadlock sulla riga accorpata). Il valore e'
--  sempre dopo notif_seen_at: se la lista e' stata segnata letta un attimo
--  prima, con un now() piu' recente del nostro, il pallino si riaccende
--  comunque. Il lock dura quanto la transazione: va bene per commenti e
--  moderazione, e per questo i voti non passano da qui.
--
--  Torna l'id della notifica, o null se non ha scritto.
-- ---------------------------------------------------------------------

create function notify_upsert(
  p_user uuid, p_kind text, p_group text, p_actor uuid,
  p_clear uuid default null, p_comment uuid default null, p_tip uuid default null,
  p_data jsonb default '{}'::jsonb
) returns bigint language plpgsql as $fn$
declare v_id bigint;
begin
  if current_setting('dts.silent', true) = 'on' then
    return null;
  end if;
  if p_user is null or p_user = p_actor then
    return null;
  end if;
  update app_user
     set notif_last_at = greatest(clock_timestamp(), coalesce(notif_seen_at, '-infinity') + interval '1 microsecond')
   where id = p_user;
  insert into notification (recipient_id, kind, group_key, actor_id, clear_id, comment_id, tip_id, data)
  values (p_user, p_kind, p_group, p_actor, p_clear, p_comment, p_tip, coalesce(p_data, '{}'::jsonb))
  on conflict (recipient_id, group_key) where read_at is null
  do update set updated_at = now(), actor_id = excluded.actor_id, data = excluded.data
  returning id into v_id;
  return v_id;
end $fn$;


-- ---------------------------------------------------------------------
--  5. I trigger
--
--  AFTER ... FOR EACH ROW, nella transazione della scrittura. Nessuno
--  legge il testo della riga: solo id e autori.
-- ---------------------------------------------------------------------

-- Un commento sul clear di un altro, pubblicato. Commentare il proprio
-- clear (la risposta dell'autore) non avvisa nessuno. Il gruppo e' il
-- clear, non la versione: "3 new comments on your clear". comment_id
-- resta null: il conteggio e l'ultimo autore li ricalcola render, cosi'
-- un commento cancellato o nascosto smette di contare senza portarsi via
-- la notifica degli altri.
create function notify_clear_comment()
returns trigger language plpgsql as $fn$
declare
  v_clear  uuid;
  v_author uuid;
  v_status text;
begin
  if current_setting('dts.silent', true) = 'on' or new.status <> 'published' then
    return null;
  end if;
  select c.id, c.author_id, c.status into v_clear, v_author, v_status
    from clear_version v join clear c on c.id = v.clear_id
   where v.id = new.version_id;
  if v_status = 'published' then
    perform notify_upsert(v_author, 'clear_comment', 'comments:' || v_clear, new.author_id, v_clear);
  end if;
  return null;
end $fn$;

create trigger notify_clear_comment after insert on clear_comment
  for each row execute function notify_clear_comment();

-- La moderazione dei miei contenuti e del mio account, dal registro
-- (0024): ogni mod_* scrive li', quindi un trigger solo copre clear,
-- commenti, tip e sospensioni. 'dismiss' NON avvisa: direbbe all'autore
-- che qualcuno l'ha segnalato. 'set_role' viene da uno script.
-- La fine naturale di una sospensione non scrive il registro: in v1 non
-- avvisa. Il motivo della sospensione e la nota non si copiano: la data
-- di fine si' (data.until), e il motivo l'interessato lo legge dal banner.
create function notify_moderation_action()
returns trigger language plpgsql as $fn$
declare
  v_kind    text;
  v_clear   uuid;
  v_comment uuid;
  v_tip     uuid;
  v_data    jsonb := '{}'::jsonb;
begin
  if current_setting('dts.silent', true) = 'on' or new.target_author_id is null then
    return null;
  end if;
  v_kind := case new.action
    when 'hide'      then 'content_hidden'
    when 'unhide'    then 'content_unhidden'
    when 'suspend'   then 'suspended'
    when 'unsuspend' then 'suspension_lifted'
  end;
  if v_kind is null then
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
    if new.action = 'suspend' then
      v_data := jsonb_strip_nulls(jsonb_build_object('until', new.detail -> 'until'));
    end if;
  end if;
  perform notify_upsert(new.target_author_id, v_kind, 'mod:' || v_kind || ':' || new.target_id,
                        new.moderator_id, v_clear, v_comment, v_tip, v_data);
  return null;
end $fn$;

create trigger notify_moderation_action after insert on moderation_action
  for each row execute function notify_moderation_action();

-- Una segnalazione nuova: a ogni admin con l'handle e non sospeso, tranne
-- chi ha segnalato e chi e' segnalato (anche un admin puo' esserlo). Un
-- gruppo solo per admin, 'reports_queue': "3 open reports". Gli admin si
-- prendono in ordine di id, cosi' due segnalazioni insieme bloccano le
-- righe di app_user nello stesso ordine.
create function notify_report()
returns trigger language plpgsql as $fn$
declare
  v_target_author uuid;
  v_admin         uuid;
begin
  if current_setting('dts.silent', true) = 'on' or new.status <> 'open' then
    return null;
  end if;
  v_target_author := report_target_author(new.target_kind, new.target_id);
  for v_admin in
    select u.id from app_user u
     where u.role = 'admin' and u.onboarded_at is not null
       and (u.suspended_until is null or u.suspended_until <= now())
       and u.id <> new.reporter_id
       and u.id is distinct from v_target_author
     order by u.id
  loop
    perform notify_upsert(v_admin, 'reports_open', 'reports_queue', new.reporter_id);
  end loop;
  return null;
end $fn$;

create trigger notify_report after insert on report
  for each row execute function notify_report();


-- ---------------------------------------------------------------------
--  6. La lettura: notification_render e notification_list
--
--  L'unica lettura per la lista, la rotta /notifications/<id> e (poi) push
--  ed email. Sempre con p_user dalla sessione: una notifica di un altro
--  non esiste. Niente si fida della riga salvata: il conteggio, l'handle
--  attuale dell'attore, l'evento e lo stato del contenuto si leggono ora.
--
--  Colonne:
--    n                 clear_comment: i commenti pubblicati di altri sul
--                      clear da created_at (fino a read_at, se letta);
--                      reports_open: le segnalazioni ancora aperte nate da
--                      created_at, senza le proprie e quelle sui propri
--                      contenuti; gli altri tipi: 1
--    actor_handle      solo clear_comment: l'autore dell'ultimo di quei
--                      commenti. Mai il moderatore, mai chi segnala
--    target            'clear' | 'comment' | 'tip' | 'account' | 'reports'
--    reg               la regione della run del clear (le tip non l'hanno)
--    content_visible   il contenuto (e il suo clear) e' pubblicato ora;
--                      null per account e reports
--    visible           la notifica si mostra e si invia ancora:
--                      clear_comment solo con il clear pubblicato e n > 0;
--                      reports_open solo a un admin e con n > 0; la
--                      moderazione e l'account sempre (riguardano i miei
--                      contenuti, e se il contenuto se ne va la riga sparisce)
--    until             suspended: la fine della sospensione ('infinity' =
--                      a tempo indeterminato)
--  I nomi sono in inglese (locale 'en'), come il sito.
-- ---------------------------------------------------------------------

-- La forma di una riga, comune a render e list.
create type notification_view as (
  id               bigint,
  kind             text,
  created_at       timestamptz,
  updated_at       timestamptz,
  read_at          timestamptz,
  n                int,
  actor_handle     citext,
  target           text,
  clear_id         uuid,
  comment_id       uuid,
  tip_id           uuid,
  event_id         bigint,
  reg              region,
  tier_id          bigint,
  event_name       text,
  stage_seq        smallint,
  stage_name       text,
  difficulty       text,
  content_visible  boolean,
  visible          boolean,
  until            timestamptz
);

create function notification_rows(p_user uuid, p_id bigint, p_limit int)
returns setof notification_view language sql stable as $fn$
  select x.id, x.kind, x.created_at, x.updated_at, x.read_at,
         case x.kind when 'clear_comment' then cm.n when 'reports_open' then rp.n else 1 end,
         cm.actor_handle,
         case when x.kind in ('suspended', 'suspension_lifted') then 'account'
              when x.kind = 'reports_open' then 'reports'
              when x.tip_id is not null then 'tip'
              when x.comment_id is not null then 'comment'
              else 'clear' end,
         x.clear_id, x.comment_id, x.tip_id,
         coalesce(c.event_id, t.event_id),
         r.reg,
         coalesce(c.stage_tier_id, t.stage_tier_id),
         et.name, s.seq, sx.name, st.difficulty::text,
         case when x.tip_id is not null then t.status = 'published'
              when x.comment_id is not null then m.status = 'published' and c.status = 'published'
              when x.clear_id is not null then c.status = 'published'
         end,
         case x.kind
           when 'clear_comment' then c.status = 'published' and cm.n > 0
           when 'reports_open'  then ru.role = 'admin' and rp.n > 0
           else true
         end,
         (x.data ->> 'until')::timestamptz
    from notification x
    join app_user ru on ru.id = x.recipient_id
    left join clear c          on c.id = x.clear_id
    left join clear_comment m  on m.id = x.comment_id
    left join tip t            on t.id = x.tip_id
    left join event_run r      on r.id = c.run_id
    left join event_text et    on et.event_id = coalesce(c.event_id, t.event_id) and et.locale = 'en'
    left join stage_tier st    on st.id = coalesce(c.stage_tier_id, t.stage_tier_id)
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
   where x.recipient_id = p_user and (p_id is null or x.id = p_id)
   order by x.updated_at desc, x.id desc
   limit greatest(least(coalesce(p_limit, 50), 200), 1);
$fn$;

-- Una notifica sola, o nessuna riga se non e' di p_user.
create function notification_render(p_user uuid, p_id bigint)
returns setof notification_view language sql stable as $fn$
  select * from notification_rows(p_user, p_id, 1) where p_id is not null;
$fn$;

-- Le ultime p_limit (50 per difetto, al massimo 200), le piu' recenti
-- prima. La pagina le divide in New (read_at null) ed Earlier.
create function notification_list(p_user uuid, p_limit int default 50)
returns setof notification_view language sql stable as $fn$
  select * from notification_rows(p_user, null, p_limit);
$fn$;


-- ---------------------------------------------------------------------
--  7. Segnare lette
--
--  p_ids null = tutte le non lette; altrimenti solo quelle (di p_user: le
--  altre si ignorano in silenzio). Torna quante ne ha segnate.
--  notif_seen_at spegne il pallino: si aggiorna quando non resta nessuna
--  non letta. Cosi' aprire una notifica sola da un link (la rotta
--  /notifications/<id>) non nasconde le altre, e aprire la lista, che
--  segna quelle mostrate, lo spegne. Va avanti anche con zero righe: una
--  notifica che e' sparita col suo contenuto non tiene il pallino acceso.
-- ---------------------------------------------------------------------

create function mark_notifications_read(p_user uuid, p_ids bigint[] default null)
returns int language plpgsql as $fn$
declare v_n int;
begin
  -- il lock di notify_upsert, nello stesso ordine: una notifica che
  -- arriva adesso o e' gia' visibile al controllo qui sotto, o aspetta e
  -- poi mette notif_last_at dopo il nostro notif_seen_at
  perform 1 from app_user where id = p_user for update;
  -- clock_timestamp e non now(): una notifica nata dopo l'inizio di questa
  -- transazione ha created_at piu' recente di now()
  update notification set read_at = greatest(clock_timestamp(), created_at)
   where recipient_id = p_user and read_at is null
     and (p_ids is null or id = any (p_ids));
  get diagnostics v_n = row_count;
  if not exists (select 1 from notification where recipient_id = p_user and read_at is null) then
    -- mai prima di notif_last_at: con il lock preso e nessuna non letta,
    -- tutto quello che e' arrivato fin qui e' visto
    update app_user set notif_seen_at = greatest(clock_timestamp(), notif_last_at) where id = p_user;
  end if;
  return v_n;
end $fn$;


-- ---------------------------------------------------------------------
--  8. Le preferenze di push ed email (le usano le fasi 3 e 4)
--
--  Un verbo per casella, come set_theme: l'id arriva dalla sessione.
--  reports_open solo per gli admin. Accendere due volte non scrive due
--  righe. Torna lo stato salvato.
-- ---------------------------------------------------------------------

create function set_notification_pref(p_user uuid, p_kind text, p_channel text, p_on boolean)
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
  if p_channel is null or p_channel not in ('push', 'email') then
    raise exception 'canale sconosciuto: %', p_channel
      using errcode = '23514', constraint = 'notification_pref_channel';
  end if;
  if p_on is null then
    raise exception 'acceso o spento, non null'
      using errcode = '23514', constraint = 'notification_pref_value';
  end if;
  if p_on and p_kind = 'reports_open' and v_role <> 'admin' then
    raise exception 'reports_open e'' solo per gli admin'
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
--  9. La conservazione
--
--  Dal cron giornaliero (/api/cron/purge), come purge_resolved_reports:
--  le lette dopo 30 giorni dalla lettura, le non lette dopo 90 senza
--  eventi nuovi (updated_at). I giorni li ripete lib/legale.ts per la
--  privacy. Torna quante ne ha cancellate.
-- ---------------------------------------------------------------------

create function purge_notifications(p_read_days int default 30, p_unread_days int default 90)
returns int language plpgsql as $fn$
declare v_n int;
begin
  delete from notification
   where (read_at is not null and read_at < now() - make_interval(days => greatest(p_read_days, 1)))
      or (read_at is null and updated_at < now() - make_interval(days => greatest(p_unread_days, 1)));
  get diagnostics v_n = row_count;
  return v_n;
end $fn$;
