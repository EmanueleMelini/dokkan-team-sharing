-- =====================================================================
--  Account: le tabelle di better-auth (lib/auth/auth.ts) e i verbi SQL
--  dell'accesso.
--
--  app_user resta l'unica tabella delle persone: better-auth la usa come
--  sua tabella "user" con i campi rimappati, cosi' l'id uuid su cui
--  pendono clear, voti e commenti non cambia e non nasce un secondo
--  archivio di utenti. Le tabelle sotto le scriviamo a mano (non con la
--  CLI di better-auth): i nomi in snake_case li mappa la configurazione.
--  Gli id sono uuid generati dal database (generateId: 'uuid').
-- =====================================================================

-- 1. app_user: le colonne che better-auth si aspetta.
--    display_name e' il suo "name" (il nome del provider, non mostrato:
--    in pagina si vede l'handle). onboarded_at nullo = l'utente non ha
--    ancora scelto handle e regione. Il default now() vale per chi nasce
--    da SQL (fixture, seed, test): e' gia' completo. better-auth invece
--    lo crea con onboarded_at esplicitamente nullo (hook in auth.ts).
alter table app_user add column display_name   text        not null default '';
alter table app_user add column email_verified boolean     not null default false;
alter table app_user add column image          text;
alter table app_user add column updated_at     timestamptz not null default now();
alter table app_user add column onboarded_at   timestamptz default now();
update app_user set onboarded_at = created_at, updated_at = created_at;

-- La forma dell'handle: finisce negli URL e accanto ai clear. Tutti gli
-- handle esistenti (fixture, demo, votanteN) la rispettano.
alter table app_user add constraint handle_shape
  check (handle ~ '^[A-Za-z0-9_]{3,24}$');

-- 2. Le sessioni nel database, non in un JWT: si revocano subito (uscita,
--    ban) e cancellare l'utente le porta via con la cascata.
create table auth_session (
  id          uuid primary key default gen_random_uuid(),
  token       text not null unique,
  user_id     uuid not null references app_user on delete cascade,
  expires_at  timestamptz not null,
  ip_address  text,
  user_agent  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index auth_session_by_user on auth_session (user_id);
create index auth_session_expiry  on auth_session (expires_at);

-- 3. Gli accessi collegati: uno per provider. La chiave e' l'id stabile
--    del provider (account_id), mai l'email o lo username, che cambiano.
--    I token del provider non servono (ci basta l'identita'): auth.ts li
--    azzera prima di ogni scrittura, e il vincolo lo garantisce anche se
--    un aggiornamento di better-auth cambiasse strada. password resta
--    sempre nulla: l'accesso con password non c'e'.
create table auth_account (
  id                        uuid primary key default gen_random_uuid(),
  account_id                text not null,
  provider_id               text not null,
  user_id                   uuid not null references app_user on delete cascade,
  access_token              text,
  refresh_token             text,
  id_token                  text,
  access_token_expires_at   timestamptz,
  refresh_token_expires_at  timestamptz,
  scope                     text,
  password                  text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (provider_id, account_id),
  unique (user_id, provider_id),
  constraint auth_account_no_secrets check (
    access_token is null and refresh_token is null and id_token is null and password is null)
);
create index auth_account_by_user on auth_account (user_id);

-- 4. Valori a scadenza: lo state/PKCE di OAuth e i token del magic link
--    (salvati come hash, monouso, 10 minuti).
create table auth_verification (
  id          uuid primary key default gen_random_uuid(),
  identifier  text not null,
  value       text not null,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index auth_verification_by_identifier on auth_verification (identifier);
create index auth_verification_expiry        on auth_verification (expires_at);

-- 5. Il limite per IP. better-auth ha una sua tabella per questo, ma
--    legge last_request (bigint) come numero e pg lo restituisce come
--    stringa: il conto del "riprova tra" verrebbe sbagliato. Qui il
--    conteggio e' una sola istruzione atomica (auth_rate_consume), che
--    auth.ts usa come customStorage.
create table auth_rate_limit (
  key           text primary key,
  count         integer     not null,
  window_start  timestamptz not null
);

-- 6. Gli invii del magic link per indirizzo, per la pausa per email: il
--    limite per IP non ferma chi bersaglia una casella da tanti IP.
create table auth_email_send (
  email    citext      not null,
  sent_at  timestamptz not null default now()
);
create index auth_email_send_by_email on auth_email_send (email, sent_at);


-- ---------------------------------------------------------------------
--  I verbi
-- ---------------------------------------------------------------------

-- Gli handle che sembrerebbero del sito, o che coincidono con un
-- percorso. Il prefisso user_ e' quello degli handle provvisori che
-- auth.ts assegna alla prima entrata: sceglierlo farebbe collidere un
-- iscritto futuro.
create function handle_reserved(p_handle citext) returns boolean
language sql immutable as $$
  select lower(p_handle::text) in (
           'admin','administrator','mod','moderator','staff','support','help',
           'api','auth','login','logout','signin','signout','signup','register',
           'welcome','settings','account','accounts','profile','me','user','users',
           'events','event','clear','clears','team','teams','new','edit','delete',
           'root','system','null','undefined','dokkan','official','anonymous')
      or lower(p_handle::text) like 'user\_%'
$$;

-- La prima entrata: handle e regione scelti dall'utente. Una volta sola:
-- se l'utente e' gia' completo (o non esiste) non cambia niente e lo dice
-- con 23514. Un handle preso esce come 23505 dal vincolo unique.
create function complete_onboarding(p_user uuid, p_handle citext, p_reg region)
returns void language plpgsql as $$
begin
  if p_handle is null or p_handle !~ '^[A-Za-z0-9_]{3,24}$' then
    raise exception 'handle non valido: 3-24 tra lettere, cifre e _'
      using errcode = '23514', constraint = 'handle_shape';
  end if;
  if handle_reserved(p_handle) then
    raise exception 'handle riservato: %', p_handle
      using errcode = '23514', constraint = 'handle_reserved';
  end if;
  update app_user
     set handle = p_handle, reg = coalesce(p_reg, 'global'),
         onboarded_at = now(), updated_at = now()
   where id = p_user and onboarded_at is null;
  if not found then
    raise exception 'utente gia'' completo o inesistente'
      using errcode = '23514', constraint = 'already_onboarded';
  end if;
end $$;

-- La pausa per email del magic link: falso se a quell'indirizzo e' gia'
-- partito un link negli ultimi 60 secondi, o 3 negli ultimi 15 minuti.
-- Altrimenti registra l'invio e risponde vero. Il lock consultivo sulla
-- email chiude la corsa tra due richieste simultanee, che leggerebbero
-- entrambe "nessun invio" e passerebbero tutte e due.
create function note_email_send(p_email citext) returns boolean
language plpgsql as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('auth_email_send:' || lower(p_email::text), 0));
  if exists (select 1 from auth_email_send
              where email = p_email and sent_at > now() - interval '60 seconds')
     or (select count(*) from auth_email_send
          where email = p_email and sent_at > now() - interval '15 minutes') >= 3 then
    return false;
  end if;
  insert into auth_email_send (email) values (p_email);
  return true;
end $$;

-- Una richiesta contro il limite di una chiave (IP + percorso), in una
-- finestra fissa di p_window secondi: conta e decide in un'istruzione,
-- cosi' due richieste insieme non leggono lo stesso conto vecchio.
create function auth_rate_consume(p_key text, p_window integer, p_max integer,
                                  out allowed boolean, out retry_after integer)
language plpgsql as $$
declare
  r auth_rate_limit;
  w interval := make_interval(secs => p_window);
begin
  insert into auth_rate_limit as t (key, count, window_start)
  values (p_key, 1, now())
  on conflict (key) do update
     set count        = case when t.window_start <= now() - w then 1 else t.count + 1 end,
         window_start = case when t.window_start <= now() - w then now() else t.window_start end
  returning * into r;
  allowed := r.count <= p_max;
  retry_after := case when allowed then null
                      else greatest(1, ceil(extract(epoch from r.window_start + w - now())))::integer end;
end $$;

-- Pulizia da lanciare ogni giorno (o all'avvio): sessioni e valori
-- scaduti, invii piu' vecchi di un giorno, finestre di limite finite da
-- piu' di un'ora. Restituisce quante righe ha tolto, per il log.
create function purge_auth_expired() returns integer
language plpgsql as $$
declare n integer; tot integer := 0;
begin
  delete from auth_session      where expires_at < now();            get diagnostics n = row_count; tot := tot + n;
  delete from auth_verification where expires_at < now();            get diagnostics n = row_count; tot := tot + n;
  delete from auth_email_send   where sent_at < now() - interval '1 day'; get diagnostics n = row_count; tot := tot + n;
  delete from auth_rate_limit   where window_start < now() - interval '1 hour'; get diagnostics n = row_count; tot := tot + n;
  return tot;
end $$;
