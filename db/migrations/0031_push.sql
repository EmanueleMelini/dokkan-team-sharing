-- =====================================================================
--  Le push del browser (fase 4 del piano PWA e notifiche).
--
--  Decisioni del proprietario:
--    - le push sono opt-in e spente per difetto: partono solo per i tipi
--      con una riga notification_pref(kind, 'push') (0028) e solo verso i
--      dispositivi iscritti qui;
--    - il testo sulla schermata di blocco non porta MAI il testo dei post:
--      lo compone l'app da notification_render, come la lista del sito.
--
--  Qui ci sono i dispositivi, i tetti contro lo spam e la contabilita'.
--  Chi manda e' l'app (lib/notify/push.ts, web-push), con after() subito
--  dopo la scrittura della community, best effort e senza ritentativi:
--    1. push_claim: UNA chiamata, in autocommit, che sceglie le notifiche
--       da mandare, le segna (pushed_at) e torna i dispositivi;
--    2. il client pg si rilascia, e solo dopo si chiamano i servizi push.
--       Con 5 connessioni per istanza, un client tenuto aperto durante le
--       chiamate HTTP (fino a 5 s ciascuna) affamerebbe /api/me;
--    3. push_report: UNA chiamata con gli esiti di tutti gli invii.
--  Una push persa non torna: la lista nel sito e il digest la recuperano.
--
--  Contro l'SSRF l'endpoint lo sceglie il browser, e il server ci fa una
--  POST: solo https, porta 443, host in una lista chiusa. La stessa regola
--  sta in lib/notify/endpoint.ts, e un test controlla che coincidano.
-- =====================================================================


-- ---------------------------------------------------------------------
--  1. Le regole: gli host ammessi e i tetti
-- ---------------------------------------------------------------------

-- I servizi push dei browser: Chrome ed Edge su Android (FCM), Firefox
-- (due host di Mozilla), Safari e iOS (Apple), Edge su Windows (WNS, con
-- un sottodominio per regione). Niente userinfo, niente IP, niente porte
-- diverse da 443, host in minuscolo (i browser lo danno cosi'), solo i
-- caratteri di un URL (RFC 3986) senza frammento, e al massimo 1024.
-- E' anche il CHECK della tabella: una funzione immutabile cambiata dopo
-- non rivaliderebbe le righe gia' scritte, ma allargare la lista non ne
-- ha bisogno, e restringerla si fa con una migrazione che cancella.
create function push_endpoint_ok(p_endpoint text)
returns boolean language sql immutable as $fn$
  select p_endpoint is not null
     and char_length(p_endpoint) <= 1024
     and p_endpoint ~ ('^https://('
           'fcm\.googleapis\.com'
           '|updates\.push\.services\.mozilla\.com'
           '|push\.services\.mozilla\.com'
           '|web\.push\.apple\.com'
           '|([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+notify\.windows\.com'
         ')(:443)?/[-A-Za-z0-9._~:/?@!$&''()*+,;=%]*$');
$fn$;

-- I tetti in un posto solo, come email_budget_caps (0029): cambiarli e'
-- una migrazione, non una variabile d'ambiente.
--   devices          dispositivi per utente
--   fresh_minutes    si mandano solo notifiche toccate da poco: il claim
--                    gira subito dopo la scrittura, e una notifica vecchia
--                    che non e' partita resta alla lista e al digest
--   coalesce_minutes per notifica (cioe' per destinatario e gruppo, per
--                    esempio un clear): una push al massimo ogni 30
--                    minuti; i commenti nel mezzo si sommano nella riga e
--                    la push dopo mostra il totale
--   recipient_day    push per destinatario in 24 ore, poi solo lista e digest
--   actor_hour       push che un autore fa partire in un'ora, in tutto
--   pair_hour        push dallo stesso autore allo stesso destinatario in
--                    un'ora
--   actor_age_hours  un account piu' giovane non fa partire push (gli
--                    account usa e getta per lo spam)
--   test_seconds     la notifica di prova di Settings: una al minuto
create function push_caps(
  out devices int, out fresh_minutes int, out coalesce_minutes int, out recipient_day int,
  out actor_hour int, out pair_hour int, out actor_age_hours int, out test_seconds int
) language sql immutable as $fn$
  select 5, 10, 30, 20, 10, 1, 24, 60;
$fn$;


-- ---------------------------------------------------------------------
--  2. Le tabelle
-- ---------------------------------------------------------------------

-- Un dispositivo (un browser su una macchina) iscritto alle push. Le
-- chiavi sono quelle di PushSubscription.toJSON(), in base64url senza
-- padding: p256dh e' un punto P-256 non compresso (65 byte, il primo
-- 0x04, quindi 87 caratteri che iniziano con B e una lettera A-P), auth
-- sono 16 byte (22 caratteri). label e' scelta dal client e grossolana
-- ("Chrome on Android"): mai lo user agent intero.
create table push_subscription (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references app_user on delete cascade,
  endpoint    text not null
              constraint push_subscription_endpoint_unique unique
              constraint push_subscription_endpoint_check check (push_endpoint_ok(endpoint)),
  p256dh      text not null constraint push_subscription_p256dh_check check (p256dh ~ '^B[A-P][A-Za-z0-9_-]{85}$'),
  auth        text not null constraint push_subscription_auth_check check (auth ~ '^[A-Za-z0-9_-]{22}$'),
  label       text constraint push_subscription_label_check
              check (label is null or (char_length(label) between 1 and 60 and label !~ '[[:cntrl:]]')),
  created_at  timestamptz not null default now(),
  -- l'ultima volta che il browser l'ha confermata (iscrizione o resync)
  seen_at     timestamptz not null default now(),
  -- l'ultimo 2xx di un servizio push, e l'ultimo codice HTTP (0 = rete o timeout)
  last_ok_at  timestamptz,
  last_status smallint constraint push_subscription_status_check check (last_status between 0 and 599),
  -- errori di fila; al terzo il dispositivo se ne va (un 2xx azzera)
  failures    smallint not null default 0 constraint push_subscription_failures_check check (failures >= 0),
  -- l'ultima notifica di prova chiesta da Settings
  test_at     timestamptz
);
create index push_subscription_by_user on push_subscription (user_id, created_at);

-- Il registro delle push partite, per i tetti per destinatario e per
-- autore. Una riga per notifica mandata (non per dispositivo). Nessun
-- testo e nessun endpoint: chi, a chi, quando. actor_id e' null per la
-- moderazione (il moderatore non ha tetti). Si tiene 2 giorni (purge_push):
-- il tetto piu' lungo e' di 24 ore. A cascata con entrambi gli account.
create table push_sent (
  id            bigint generated always as identity primary key,
  recipient_id  uuid not null references app_user on delete cascade,
  actor_id      uuid references app_user on delete cascade,
  sent_at       timestamptz not null default now()
);
create index push_sent_by_recipient on push_sent (recipient_id, sent_at);
create index push_sent_by_actor on push_sent (actor_id, sent_at) where actor_id is not null;
create index push_sent_by_time on push_sent (sent_at);


-- ---------------------------------------------------------------------
--  3. I verbi dei dispositivi
--
--  Sempre con p_user dalla sessione (Server Action con
--  requireOnboardedUser), come set_theme: l'utente non arriva mai dal form.
-- ---------------------------------------------------------------------

-- Iscrive questo dispositivo, o lo conferma (il resync del client, una
-- volta al giorno e a ogni visita di Settings, richiama questa con la
-- stessa iscrizione). Lo stesso endpoint su un altro account passa
-- all'ultimo che si iscrive: e' lo stesso browser, e chi l'aveva prima non
-- deve piu' ricevere niente su quella macchina (un PC condiviso). Le
-- chiavi accettano il padding '=' e lo tolgono. Il tetto di 5 rifiuta il
-- sesto invece di togliere il piu' vecchio: Settings mostra la lista e
-- "Remove", e un dispositivo vivo non sparisce senza che l'utente lo veda.
-- Il lock sulla riga dell'utente mette in fila due iscrizioni insieme,
-- cosi' il tetto non si supera. Torna l'id del dispositivo.
create function push_subscribe(p_user uuid, p_endpoint text, p_p256dh text, p_auth text, p_label text default null)
returns uuid language plpgsql as $fn$
declare
  v_p256dh text := rtrim(btrim(coalesce(p_p256dh, '')), '=');
  v_auth   text := rtrim(btrim(coalesce(p_auth, '')), '=');
  v_label  text := nullif(left(btrim(regexp_replace(coalesce(p_label, ''), '[[:cntrl:]]+', ' ', 'g')), 60), '');
  v_id     uuid;
begin
  perform 1 from app_user where id = p_user and onboarded_at is not null for update;
  if not found then
    raise exception 'utente inesistente o senza onboarding'
      using errcode = 'P0002', constraint = 'user_not_found';
  end if;
  if not push_endpoint_ok(p_endpoint) then
    raise exception 'endpoint push non ammesso'
      using errcode = '23514', constraint = 'push_endpoint';
  end if;
  if v_p256dh !~ '^B[A-P][A-Za-z0-9_-]{85}$' or v_auth !~ '^[A-Za-z0-9_-]{22}$' then
    raise exception 'chiavi push non valide'
      using errcode = '23514', constraint = 'push_keys';
  end if;
  if (select count(*) from push_subscription where user_id = p_user and endpoint <> p_endpoint)
       >= (select devices from push_caps()) then
    raise exception 'troppi dispositivi'
      using errcode = '54000', constraint = 'push_device_limit';
  end if;
  insert into push_subscription (user_id, endpoint, p256dh, auth, label)
  values (p_user, p_endpoint, v_p256dh, v_auth, v_label)
  on conflict (endpoint) do update set
    user_id     = excluded.user_id,
    p256dh      = excluded.p256dh,
    auth        = excluded.auth,
    label       = coalesce(excluded.label, push_subscription.label),
    seen_at     = now(),
    -- un altro account, o chiavi nuove: e' un'iscrizione nuova, la storia
    -- di consegna di prima non vale piu'
    created_at  = case when push_subscription.user_id = excluded.user_id then push_subscription.created_at else now() end,
    failures    = case when push_subscription.user_id = excluded.user_id
                        and push_subscription.p256dh = excluded.p256dh
                        and push_subscription.auth = excluded.auth then push_subscription.failures else 0 end,
    last_ok_at  = case when push_subscription.user_id = excluded.user_id then push_subscription.last_ok_at end,
    last_status = case when push_subscription.user_id = excluded.user_id then push_subscription.last_status end,
    test_at     = case when push_subscription.user_id = excluded.user_id then push_subscription.test_at end
  returning id into v_id;
  return v_id;
end $fn$;

-- Toglie questo dispositivo (l'uscita dall'account, l'interruttore in
-- Settings). Non chiede l'onboarding: l'uscita deve funzionare sempre.
-- Solo le righe di p_user: l'endpoint di un altro account resta. Torna
-- true se ha tolto qualcosa.
create function push_unsubscribe(p_user uuid, p_endpoint text)
returns boolean language sql as $fn$
  with d as (delete from push_subscription where user_id = p_user and endpoint = p_endpoint returning 1)
  select exists (select 1 from d);
$fn$;

-- "Remove" nella lista dei dispositivi di Settings (anche un altro browser).
create function push_device_remove(p_user uuid, p_id uuid)
returns boolean language sql as $fn$
  with d as (delete from push_subscription where user_id = p_user and id = p_id returning 1)
  select exists (select 1 from d);
$fn$;

-- La lista di Settings, la piu' vecchia prima. L'endpoint serve al client
-- per riconoscere "this device" (lo confronta con getSubscription()): e'
-- dell'utente stesso, ma le chiavi non escono da qui.
create function push_devices(p_user uuid)
returns table (id uuid, label text, endpoint text, created_at timestamptz, seen_at timestamptz,
               last_ok_at timestamptz, failures smallint)
language sql stable as $fn$
  select s.id, s.label, s.endpoint, s.created_at, s.seen_at, s.last_ok_at, s.failures
    from push_subscription s where s.user_id = p_user
   order by s.created_at, s.id;
$fn$;

-- La notifica di prova di Settings, su questo dispositivo: torna la riga
-- con le chiavi da passare a web-push, o niente se l'endpoint non e' di
-- p_user. Una al minuto per utente, su tutti i suoi dispositivi.
create function push_test(p_user uuid, p_endpoint text)
returns table (id uuid, endpoint text, p256dh text, auth text)
language plpgsql as $fn$
begin
  perform 1 from app_user u where u.id = p_user for update;
  if exists (select 1 from push_subscription s
              where s.user_id = p_user
                and s.test_at > now() - make_interval(secs => (select test_seconds from push_caps()))) then
    raise exception 'una notifica di prova al minuto'
      using errcode = '54000', constraint = 'push_test_rate';
  end if;
  return query
    update push_subscription s set test_at = now()
     where s.user_id = p_user and s.endpoint = p_endpoint
    returning s.id, s.endpoint, s.p256dh, s.auth;
end $fn$;


-- ---------------------------------------------------------------------
--  4. La scelta: push_claim
--
--  Una sola chiamata (in autocommit, va bene col pooler in transaction
--  mode). Prende le notifiche toccate negli ultimi fresh_minutes, non
--  lette, con la preferenza push accesa e almeno un dispositivo, e le
--  blocca con skip locked: due after() insieme si dividono le righe e
--  nessuna parte due volte. Poi, una per una, i filtri:
--    - la coalescenza: mai mandata, o mandata da piu' di coalesce_minutes
--      e toccata dopo l'ultima push;
--    - il destinatario sotto recipient_day push in 24 ore;
--    - per i tipi che nascono dalla community (clear_comment e
--      reports_open, dove l'attore e' chi commenta o chi segnala):
--      l'attore con un account di piu' di actor_age_hours, non sospeso,
--      sotto actor_hour push in un'ora e sotto pair_hour verso questo
--      destinatario. La moderazione non ha tetti per attore: l'attore e'
--      il moderatore, e un giro di pulizia non deve zittire nessuno;
--    - notification_render dice visible: il clear e' ancora pubblicato e
--      il conteggio non e' 0 (un commento nascosto nel frattempo non
--      parte), reports_open solo a un admin.
--  Chi passa riceve pushed_at = now() e una riga in push_sent, nella
--  stessa transazione: i conteggi del giro dopo, e delle righe dopo in
--  questo giro, la vedono gia'. Chi non passa resta com'e' (nessun
--  pushed_at): un tetto che si libera fra un minuto la lascia partire se
--  e' ancora fresca. Due claim insieme per lo stesso destinatario possono
--  superare un tetto di qualche push (ognuno conta prima del commit
--  dell'altro): e' accettato, i tetti sono contro lo spam, non contabilita'.
--
--  Torna, per ogni notifica, i dati del testo (gli stessi della lista,
--  ricalcolati ora) e i dispositivi con le chiavi, in un jsonb. L'app
--  compone titolo e corpo, manda, poi chiama push_report una volta.
-- ---------------------------------------------------------------------

-- Le candidate: non lette e toccate da poco. Senza, ogni claim (cioe' ogni
-- commento) leggerebbe tutta la tabella.
create index notification_unread_fresh on notification (updated_at) where read_at is null;

create type push_job as (
  notification_id bigint,
  recipient_id    uuid,
  kind            text,
  group_key       text,
  n               int,
  actor_handle    citext,
  target          text,
  event_name      text,
  stage_seq       smallint,
  stage_name      text,
  difficulty      text,
  until           timestamptz,
  -- [{ "id": uuid, "endpoint": text, "p256dh": text, "auth": text }]
  devices         jsonb
);

create function push_claim(p_limit int default 20)
returns setof push_job language plpgsql as $fn$
declare
  k         record;
  x         record;
  r         notification_view;
  a         record;
  j         push_job;
  v_limit   int := greatest(least(coalesce(p_limit, 20), 100), 1);
  v_taken   int := 0;
  v_actor   uuid;
begin
  select * into k from push_caps();
  for x in
    select n.id, n.recipient_id, n.kind, n.group_key, n.actor_id
      from notification n
     where n.read_at is null
       and n.updated_at > now() - make_interval(mins => k.fresh_minutes)
       and (n.pushed_at is null
            or (n.pushed_at < n.updated_at and n.pushed_at <= now() - make_interval(mins => k.coalesce_minutes)))
       and exists (select 1 from notification_pref p
                    where p.user_id = n.recipient_id and p.kind = n.kind and p.channel = 'push')
       and exists (select 1 from push_subscription s where s.user_id = n.recipient_id)
     order by n.updated_at, n.id
     -- qualcuna cade nei filtri: se ne guardano di piu' di quante se ne tengono
     limit v_limit * 4
       for update of n skip locked
  loop
    exit when v_taken >= v_limit;

    if (select count(*) from push_sent s
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

    update notification set pushed_at = now() where id = x.id;
    insert into push_sent (recipient_id, actor_id) values (x.recipient_id, v_actor);
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
    return next j;
  end loop;
end $fn$;


-- ---------------------------------------------------------------------
--  5. Dopo gli invii: push_report
--
--  Una sola chiamata con gli esiti: [{ "id": <dispositivo>, "status":
--  <HTTP, 0 = rete o timeout> }]. Per dispositivo (puo' comparire piu'
--  volte, se il giro aveva due notifiche per lo stesso utente):
--    - 404 o 410: l'iscrizione non esiste piu', si cancella;
--    - un 2xx: last_ok_at, e gli errori di fila tornano a 0;
--    - 413 (il payload: un nostro bug) e 429 (troppe richieste): non sono
--      colpa del dispositivo, si annota il codice e basta;
--    - tutto il resto (400, 401, 403 con le chiavi VAPID cambiate, 5xx, la
--      rete): un errore in piu'; al terzo di fila il dispositivo se ne va.
--      Se il browser e' vivo, il resync del client lo iscrive di nuovo.
--  Un dispositivo che nel frattempo non c'e' piu' si ignora. Torna quanti
--  ok, quanti errori e quanti dispositivi tolti.
-- ---------------------------------------------------------------------

create function push_report(p_results jsonb, out ok int, out failed int, out removed int)
language plpgsql as $fn$
declare
  v_n        int;
  v_gone     uuid[];
  v_good     uuid[];
  v_good_st  smallint[];
  v_bad      uuid[];
  v_bad_st   smallint[];
  v_other    uuid[];
  v_other_st smallint[];
begin
  if p_results is null or jsonb_typeof(p_results) <> 'array' then
    raise exception 'push_report vuole un array'
      using errcode = '22023', constraint = 'push_report_shape';
  end if;
  -- case e non or: l'ordine dei controlli e' garantito, e il cast a int
  -- arriva solo dopo la forma (un '2.5' darebbe un errore di cast)
  if exists (select 1 from jsonb_array_elements(p_results) e
              where case when jsonb_typeof(e) <> 'object' then true
                         when coalesce(e ->> 'id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then true
                         when coalesce(jsonb_typeof(e -> 'status'), '') <> 'number' then true
                         when (e ->> 'status') !~ '^[0-9]{1,3}$' then true
                         else (e ->> 'status')::int > 599 end) then
    raise exception 'push_report: ogni esito e'' {id, status}'
      using errcode = '22023', constraint = 'push_report_shape';
  end if;

  -- per dispositivo: sparito (404/410), riuscito, errore che conta, e
  -- l'ultimo codice. Niente tabella temporanea: array, una lettura sola.
  select coalesce(array_agg(id) filter (where gone), '{}'),
         coalesce(array_agg(id) filter (where not gone and good), '{}'),
         coalesce(array_agg(st_good) filter (where not gone and good), '{}'),
         coalesce(array_agg(id) filter (where not gone and not good and bad), '{}'),
         coalesce(array_agg(st) filter (where not gone and not good and bad), '{}'),
         coalesce(array_agg(id) filter (where not gone and not good and not bad), '{}'),
         coalesce(array_agg(st) filter (where not gone and not good and not bad), '{}')
    into v_gone, v_good, v_good_st, v_bad, v_bad_st, v_other, v_other_st
    from (select (e ->> 'id')::uuid as id,
                 bool_or((e ->> 'status')::int in (404, 410)) as gone,
                 bool_or((e ->> 'status')::int between 200 and 299) as good,
                 bool_or((e ->> 'status')::int not between 200 and 299
                         and (e ->> 'status')::int not in (404, 410, 413, 429)) as bad,
                 max((e ->> 'status')::int)::smallint as st,
                 max((e ->> 'status')::int) filter (where (e ->> 'status')::int between 200 and 299)::smallint as st_good
            from jsonb_array_elements(p_results) e
           group by 1) g;

  delete from push_subscription where id = any (v_gone);
  get diagnostics removed = row_count;

  update push_subscription s set last_ok_at = now(), failures = 0, last_status = g.st
    from unnest(v_good, v_good_st) as g(id, st) where s.id = g.id;
  get diagnostics ok = row_count;

  update push_subscription s set failures = least(s.failures + 1, 32767), last_status = b.st
    from unnest(v_bad, v_bad_st) as b(id, st) where s.id = b.id;
  get diagnostics failed = row_count;

  update push_subscription s set last_status = o.st
    from unnest(v_other, v_other_st) as o(id, st) where s.id = o.id;

  delete from push_subscription where id = any (v_bad) and failures >= 3;
  get diagnostics v_n = row_count;
  removed := removed + v_n;
end $fn$;


-- ---------------------------------------------------------------------
--  6. La conservazione
--
--  Dal cron giornaliero (/api/cron/purge), come purge_notifications:
--    - un dispositivo che non si vede da p_days giorni (nessun resync,
--      nessun invio riuscito: il browser non c'e' piu');
--    - il registro push_sent dopo 2 giorni (il tetto piu' lungo e' 24 ore).
--  I giorni li ripete lib/legale.ts per la privacy.
-- ---------------------------------------------------------------------

create function purge_push(p_days int default 90, out devices int, out sent int)
language plpgsql as $fn$
begin
  delete from push_subscription
   where greatest(created_at, seen_at, coalesce(last_ok_at, '-infinity'))
         < now() - make_interval(days => greatest(coalesce(p_days, 90), 1));
  get diagnostics devices = row_count;
  delete from push_sent where sent_at < now() - interval '2 days';
  get diagnostics sent = row_count;
end $fn$;
