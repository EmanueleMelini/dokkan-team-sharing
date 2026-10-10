-- =====================================================================
--  Il digest email giornaliero (fase 3 del piano PWA e notifiche).
--
--  Decisioni del proprietario:
--    - l'email e' SOLO un digest al giorno, opt-in e spento per difetto:
--      nessuna email immediata, nemmeno per la moderazione;
--    - voti sui clear e Helpful sulle tip compaiono solo come "+N";
--    - la moderazione si dice in forma generica (al massimo handle ed
--      evento): mai il testo dei post, il motivo della sospensione o la
--      nota del moderatore;
--    - il budget non rifiuta e non ritarda MAI le email di accesso: 'auth'
--      si conta e basta, 'notify' ha i suoi tetti (40 al giorno, 1200 al
--      mese) dentro i totali (60 al giorno, 2400 al mese), e al primo 429
--      di Resend il digest si ferma per 24 ore. Il login no.
--
--  Il piano gratuito di Resend (100 al giorno, 3000 al mese) e' condiviso
--  con i magic link: i nostri tetti stanno sotto, con margine, perche'
--  non sappiamo se il mese di Resend e' quello solare o il ciclo di
--  fatturazione, e perche' un digest in piu' non vale un login perso.
--
--  Qui c'e' solo la contabilita' e la selezione. Chi manda (il cron
--  /api/cron/digest), i testi e la firma dei link di disiscrizione stanno
--  nell'app: la firma usa una chiave derivata da BETTER_AUTH_SECRET, e
--  notify_token_v qui sotto e' la parte che si puo' revocare per utente.
-- =====================================================================


-- ---------------------------------------------------------------------
--  1. Il budget: email_quota, i tetti, email_budget_consume
-- ---------------------------------------------------------------------

-- Un contatore per giorno (UTC) e tipo. Niente indirizzi, niente utenti:
-- serve solo a sapere quante email sono partite. Si tiene 40 giorni
-- (purge_email_quota), abbastanza per il mese in corso.
create table email_quota (
  day   date not null,
  kind  text not null constraint email_quota_kind_check check (kind in ('auth', 'notify')),
  n     integer not null default 0 constraint email_quota_n_check check (n >= 0),
  primary key (day, kind)
);

-- I tetti in un posto solo: li leggono il cron, i test e (a parole) la
-- privacy. Cambiarli e' una migrazione, non una variabile d'ambiente: il
-- proprietario non deve configurare niente.
create function email_budget_caps(
  out notify_day int, out total_day int, out notify_month int, out total_month int
) language sql immutable as $fn$
  select 40, 60, 1200, 2400;
$fn$;

-- La riga di stato del digest: una sola, con l'interruttore automatico.
-- Il check sull'id impedisce la seconda riga.
create table notify_state (
  id            boolean primary key default true constraint notify_state_one check (id),
  paused_until  timestamptz,
  -- un codice breve di Resend (daily_quota_exceeded, rate_limit_exceeded...),
  -- mai un indirizzo o il testo di un'email
  paused_reason text constraint notify_state_reason_length check (char_length(paused_reason) <= 60),
  updated_at    timestamptz not null default now()
);
insert into notify_state (id) values (true);

-- Conta p_n email di tipo p_kind e torna quante se ne possono mandare.
--
--   'auth'    torna sempre p_n: si conta e basta. lib/auth/email.ts la
--             chiama in try/catch, cosi' nemmeno un errore del contatore
--             ferma un login. Non prende il lock di notify_state: un
--             magic link non aspetta mai il cron.
--   'notify'  torna da 0 a p_n: quante stanno sotto TUTTI i tetti
--             (notify del giorno < 40, totale del giorno < 60, notify del
--             mese < 1200, totale del mese < 2400). 0 durante la pausa.
--             Conta solo quelle che concede: chi ne chiede 40 e ne ottiene
--             12 manda le prime 12, e le altre aspettano domani.
--
-- Il lock FOR UPDATE su notify_state mette in fila due cron sovrapposti:
-- leggono i totali e scrivono uno dopo l'altro, mai entrambi sotto il
-- tetto con lo stesso conteggio. Un login che conta nel frattempo puo'
-- far sforare il totale di uno o due: va bene, 'auth' non si rifiuta mai,
-- e i tetti stanno sotto quelli di Resend proprio per questo.
--
-- Giorno e mese sono in UTC, come il cron.
create function email_budget_consume(p_kind text, p_n int default 1)
returns int language plpgsql as $fn$
declare
  v_day   date := (now() at time zone 'UTC')::date;
  v_month date := date_trunc('month', (now() at time zone 'UTC'))::date;
  v_cap   record;
  v_pause timestamptz;
  v_nd int; v_td int; v_nm int; v_tm int;
  v_ok int;
begin
  if p_kind is null or p_kind not in ('auth', 'notify') then
    raise exception 'tipo di email sconosciuto: %', p_kind
      using errcode = '23514', constraint = 'email_quota_kind';
  end if;
  if p_n is null or p_n < 1 or p_n > 100 then
    raise exception 'da 1 a 100 email per volta, non %', p_n
      using errcode = '23514', constraint = 'email_quota_n';
  end if;

  if p_kind = 'auth' then
    insert into email_quota as q (day, kind, n) values (v_day, 'auth', p_n)
    on conflict (day, kind) do update set n = q.n + excluded.n;
    return p_n;
  end if;

  select paused_until into v_pause from notify_state where id for update;
  if v_pause > now() then
    return 0;
  end if;

  select * into v_cap from email_budget_caps();
  select coalesce(sum(n) filter (where kind = 'notify' and day = v_day), 0),
         coalesce(sum(n) filter (where day = v_day), 0),
         coalesce(sum(n) filter (where kind = 'notify'), 0),
         coalesce(sum(n), 0)
    into v_nd, v_td, v_nm, v_tm
    from email_quota
   where day >= v_month and day <= v_day;

  v_ok := greatest(0, least(p_n,
                            v_cap.notify_day - v_nd, v_cap.total_day - v_td,
                            v_cap.notify_month - v_nm, v_cap.total_month - v_tm));
  if v_ok > 0 then
    insert into email_quota as q (day, kind, n) values (v_day, 'notify', v_ok)
    on conflict (day, kind) do update set n = q.n + excluded.n;
  end if;
  return v_ok;
end $fn$;

-- Quante ne sono partite oggi e nel mese, e la pausa: per il log del cron
-- e per i test. Legge e basta.
create function email_budget_usage(
  out notify_day int, out total_day int, out notify_month int, out total_month int,
  out paused_until timestamptz
) language sql stable as $fn$
  select coalesce(sum(q.n) filter (where q.kind = 'notify' and q.day = (now() at time zone 'UTC')::date), 0)::int,
         coalesce(sum(q.n) filter (where q.day = (now() at time zone 'UTC')::date), 0)::int,
         coalesce(sum(q.n) filter (where q.kind = 'notify'), 0)::int,
         coalesce(sum(q.n), 0)::int,
         (select s.paused_until from notify_state s where s.id and s.paused_until > now())
    from email_quota q
   where q.day >= date_trunc('month', (now() at time zone 'UTC'))::date
     and q.day <= (now() at time zone 'UTC')::date;
$fn$;


-- ---------------------------------------------------------------------
--  2. L'interruttore automatico
--
--  Al primo 429 (o quota_exceeded) di Resend il cron chiama notify_pause:
--  24 ore senza digest. Una pausa gia' piu' lunga non si accorcia. Si
--  ferma il digest e basta: email_budget_consume('auth') non la guarda.
--  Torna la fine della pausa.
-- ---------------------------------------------------------------------

create function notify_pause(p_reason text, p_hours int default 24)
returns timestamptz language plpgsql as $fn$
declare v_until timestamptz;
begin
  update notify_state
     set paused_until  = greatest(coalesce(paused_until, now()),
                                  now() + make_interval(hours => least(greatest(coalesce(p_hours, 24), 1), 168))),
         paused_reason = left(p_reason, 60),
         updated_at    = now()
   where id
  returning paused_until into v_until;
  return v_until;
end $fn$;

-- null se il digest non e' in pausa, altrimenti fino a quando.
create function notify_paused_until()
returns timestamptz language sql stable as $fn$
  select paused_until from notify_state where id and paused_until > now();
$fn$;

-- La conservazione, dal cron giornaliero come purge_notifications.
create function purge_email_quota(p_days int default 40)
returns int language plpgsql as $fn$
declare v_n int;
begin
  delete from email_quota
   where day < (now() at time zone 'UTC')::date - greatest(coalesce(p_days, 40), 32);
  get diagnostics v_n = row_count;
  return v_n;
end $fn$;


-- ---------------------------------------------------------------------
--  3. Le colonne su app_user
--
--    notify_digest_on_at  null = digest spento (il default). Altrimenti
--                         quando e' stato acceso: e' il consenso, e il
--                         primo digest parte da li', non dal passato (chi
--                         lo accende non riceve "+500 votes" di mesi fa)
--    notify_digest_at     fin dove e' arrivato l'ultimo digest inviato:
--                         il prossimo riparte da qui
--    notify_digest_day    il giorno (UTC) dell'ultimo invio: uno al giorno
--    notify_token_v       la versione dei link di disiscrizione. La firma
--                         la include: alzarla invalida i link vecchi di
--                         quell'utente e di nessun altro
--
--  Le legge solo il cron e Settings: niente additionalFields di
--  better-auth, la sessione non ne ha bisogno.
-- ---------------------------------------------------------------------

alter table app_user
  add column notify_digest_on_at timestamptz,
  add column notify_digest_at    timestamptz,
  add column notify_digest_day   date,
  add column notify_token_v      integer not null default 1
    constraint app_user_notify_token_v_check check (notify_token_v >= 1);

-- Il cron cerca solo chi ha il digest acceso: pochi, rispetto a tutti.
create index app_user_digest_on on app_user (notify_digest_at) where notify_digest_on_at is not null;

-- Un indirizzo cambiato invalida i link di disiscrizione mandati a quello
-- vecchio: chi ha ancora in mano una vecchia email non deve poter toccare
-- le impostazioni del nuovo indirizzo. WHEN tiene fuori tutti gli altri
-- update di better-auth.
create function notify_email_changed()
returns trigger language plpgsql as $fn$
begin
  new.notify_token_v := old.notify_token_v + 1;
  return new;
end $fn$;

create trigger notify_email_changed before update of email on app_user
  for each row when (old.email is distinct from new.email)
  execute function notify_email_changed();


-- ---------------------------------------------------------------------
--  4. I verbi: accendere, spegnere, disiscriversi, revocare i link
-- ---------------------------------------------------------------------

-- La casella "Daily email digest" di Settings. L'id arriva dalla
-- sessione. Accendere vuole l'email verificata (un digest a un indirizzo
-- non nostro sarebbe spam a nome del sito); spegnere si puo' sempre.
-- Accendere due volte non sposta il consenso. Torna lo stato salvato.
create function set_email_digest(p_user uuid, p_on boolean)
returns boolean language plpgsql as $fn$
declare v_verified boolean;
begin
  select email_verified into v_verified from app_user where id = p_user and onboarded_at is not null;
  if not found then
    raise exception 'utente inesistente o senza onboarding'
      using errcode = 'P0002', constraint = 'user_not_found';
  end if;
  if p_on is null then
    raise exception 'acceso o spento, non null'
      using errcode = '23514', constraint = 'notify_digest_value';
  end if;
  if p_on and not v_verified then
    raise exception 'il digest vuole un''email verificata'
      using errcode = '42501', constraint = 'email_not_verified';
  end if;
  update app_user
     set notify_digest_on_at = case when p_on then coalesce(notify_digest_on_at, now()) end
   where id = p_user;
  return p_on;
end $fn$;

-- La disiscrizione dal link dell'email (la pagina e il one-click RFC
-- 8058). L'app ha gia' verificato la firma; qui si controlla che la
-- versione sia quella attuale. Puo' SOLO spegnere: il digest e le
-- eventuali preferenze email per tipo. Niente onboarding richiesto,
-- niente sessione. true = link valido (anche se era gia' spento: il
-- secondo clic dice lo stesso del primo), false = utente o versione
-- sbagliati.
create function notify_unsubscribe(p_user uuid, p_token_v int)
returns boolean language plpgsql as $fn$
begin
  update app_user set notify_digest_on_at = null
   where id = p_user and notify_token_v = p_token_v;
  if not found then
    return false;
  end if;
  delete from notification_pref where user_id = p_user and channel = 'email';
  return true;
end $fn$;

-- Revoca i link di disiscrizione gia' mandati a quell'utente. Torna la
-- versione nuova, null se l'utente non c'e'.
create function notify_rotate_token(p_user uuid)
returns int language sql as $fn$
  update app_user set notify_token_v = notify_token_v + 1 where id = p_user returning notify_token_v;
$fn$;


-- ---------------------------------------------------------------------
--  5. La selezione: digest_due
--
--  Chi riceve il digest oggi, gia' in ordine, al massimo p_limit (40 per
--  difetto, da 1 a 100). Una riga per utente, e solo per chi ha qualcosa:
--  un digest vuoto non parte mai.
--
--  Chi: digest acceso, email verificata, onboarding fatto, nessun digest
--  gia' partito oggi (UTC). Il sospeso lo riceve ancora, come riceve
--  ancora le notifiche sui suoi contenuti (0028): e' l'unico che sa della
--  sua sospensione, e la riga dice solo che c'e' un aggiornamento
--  sull'account, mai il motivo.
--
--  Cosa, nella finestra (since, upto]:
--    since  = l'ultimo digest o, se e' piu' recente, l'accensione;
--    upto   = p_upto, per difetto un minuto fa: una scrittura iniziata
--             prima di upto ma non ancora committata ha un orario <= upto
--             che il prossimo giro non guarderebbe piu'. Il minuto la
--             lascia al giro dopo invece di perderla;
--    items  = le notifiche non lette e ancora visibili (notification_rows
--             di 0028, con i conteggi ricalcolati ora) toccate nella
--             finestra, le piu' recenti prima, in forma generica: tipo,
--             conteggio, l'handle solo per i commenti, l'evento (e il
--             tier solo per i commenti). Per la moderazione al massimo
--             l'evento; per l'account e le segnalazioni niente. Mai testo
--             dei post, mai motivo o nota, mai chi modera o chi segnala;
--    votes  = i +1 di altri sui suoi clear pubblicati, votati nella
--             finestra, una volta per (clear, votante) anche su piu'
--             versioni. Mai chi ha votato;
--    helpful= gli Helpful di altri sulle sue tip pubblicate, nella finestra.
--
--  Ordine: gli admin, poi chi ha moderazione nel digest, poi chi aspetta
--  da piu' tempo (mai ricevuto prima di tutti). Chi non entra nei p_limit
--  (o nel budget) resta per domani: la sua finestra non si sposta.
--
--  day e' il giorno UTC di oggi, come testo 'YYYY-MM-DD' (un date
--  diventerebbe in node un Date a mezzanotte locale, e il giorno
--  scivolerebbe): la chiave di idempotenza dell'invio (digest:<user>:<day>)
--  e il p_day di digest_mark_sent.
-- ---------------------------------------------------------------------

create function digest_due(p_limit int default 40, p_upto timestamptz default null)
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
--  6. Dopo l'invio: digest_mark_sent
--
--  Il cron la chiama con chi e' partito davvero (Resend ha risposto ok),
--  con upto e day della riga di digest_due. La finestra del prossimo
--  digest riparte da upto; day blocca un secondo digest oggi. Non torna
--  mai indietro: un giro vecchio che arriva tardi non riapre la finestra.
--  Se la chiamata fallisce dopo un invio riuscito, il giro dopo (stesso
--  giorno) riprende l'utente, e la chiave di idempotenza di Resend
--  (digest:<user>:<day>) evita la seconda email. Torna quanti ne ha segnati.
-- ---------------------------------------------------------------------

create function digest_mark_sent(p_users uuid[], p_upto timestamptz, p_day date)
returns int language plpgsql as $fn$
declare v_n int;
begin
  if p_upto is null or p_upto > now() then
    raise exception 'upto deve essere nel passato'
      using errcode = '23514', constraint = 'digest_upto';
  end if;
  if p_day is null or p_day > (now() at time zone 'UTC')::date then
    raise exception 'day deve essere oggi o prima'
      using errcode = '23514', constraint = 'digest_day';
  end if;
  update app_user
     set notify_digest_at  = greatest(notify_digest_at, p_upto),
         notify_digest_day = greatest(notify_digest_day, p_day)
   where id = any (coalesce(p_users, '{}'));
  get diagnostics v_n = row_count;
  return v_n;
end $fn$;
