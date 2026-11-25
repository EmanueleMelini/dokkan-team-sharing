-- =====================================================================
--  Le passkey: un altro modo di entrare, accanto al link per email e ai
--  provider OAuth.
--
--  Le gestisce il plugin passkey di better-auth (@better-auth/passkey,
--  lib/auth/config.ts), con WebAuthn sul nostro server: la chiave privata
--  resta sul dispositivo o nel gestore di password dell'utente (iCloud,
--  Google, Bitwarden, ...), qui c'e' solo la chiave pubblica. Nessun
--  servizio esterno.
--
--  Una passkey si aggiunge solo da Settings, a un account che esiste gia'
--  e con una sessione fresca, come collegare un provider: non crea
--  account. Se ne va con l'account (cascata). Toglierla passa solo da
--  delete_passkey (sotto): la rotta di better-auth e' spenta (config.ts).
--
--  Si applica PRIMA del codice che la usa (npm run prod:migrate): senza
--  la tabella il codice nuovo si ferma a check-schema e a migrate --check.
--  E il codice va su main subito dopo, nella stessa seduta: il main di
--  prima non ha auth_passkey in db/prod/tables.mjs, e lo snapshot del
--  giro settimanale o di quello delle immagini si fermerebbe sulla tabella
--  senza classe. Mai a cavallo di un giro programmato.
-- =====================================================================

create table auth_passkey (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references app_user on delete cascade,
  -- l'id della credenziale (base64url), che il browser rimanda a ogni
  -- accesso. WebAuthn lo vuole al massimo di 1023 byte.
  credential_id  text not null unique,
  -- La chiave pubblica COSE in base64. Una vera sta sotto i 1500
  -- caratteri (ES256 ~104, RSA-4096 ~704, RSA-8192 ~1400). SimpleWebAuthn
  -- non ne limita la misura, quindi senza tetto una chiave finta di
  -- qualche MB entrerebbe a ogni registrazione. Il plugin la rifiuta gia'
  -- prima (config.ts, CHIAVE_MAX_BYTE): questo e' il limite vero.
  public_key     text not null,
  -- Il contatore delle firme: WebAuthn lo vuole a 32 bit senza segno (per
  -- le passkey sincronizzate resta 0), quindi bigint. pg da' i bigint come
  -- stringhe e better-auth lo passa cosi' com'e' a SimpleWebAuthn, che pero'
  -- lo usa solo in > e <=, dove JavaScript converte la stringa in numero.
  counter        bigint not null default 0,
  -- singleDevice (una chiave hardware) o multiDevice (sincronizzata)
  device_type    text not null,
  backed_up      boolean not null,
  -- usb, nfc, ble, internal, hybrid: li dichiara il browser
  transports     text,
  -- il modello del gestore (AAGUID): Settings ne ricava il nome
  aaguid         text,
  -- un'etichetta scelta dall'utente: oggi il sito non la chiede
  name           text,
  created_at     timestamptz not null default now(),
  constraint auth_passkey_shape check (
    counter between 0 and 4294967295
    and device_type in ('singleDevice', 'multiDevice')
    and char_length(credential_id) between 1 and 1400
    and char_length(public_key) between 1 and 4096
    and (transports is null or char_length(transports) <= 200)
    and (aaguid is null or char_length(aaguid) <= 64)
    and (name is null or char_length(name) <= 64))
);
create index auth_passkey_by_user on auth_passkey (user_id);


-- ---------------------------------------------------------------------
--  Scollegare un provider: ora conta anche le passkey
-- ---------------------------------------------------------------------

-- La regola della 0019 (resta almeno un modo di entrare), con le passkey
-- tra i modi che restano. Il resto e' identico.
create or replace function unlink_provider(p_user uuid, p_provider text)
returns void language plpgsql as $$
declare
  v_verified boolean;
  v_altri    int;
begin
  select email_verified into v_verified from app_user where id = p_user for update;
  if not found then
    raise exception 'utente inesistente' using errcode = '42501', constraint = 'account_missing';
  end if;
  if not exists (select 1 from auth_account where user_id = p_user and provider_id = p_provider) then
    raise exception 'provider non collegato: %', p_provider
      using errcode = '23514', constraint = 'provider_not_linked';
  end if;
  select (select count(*) from auth_account where user_id = p_user and provider_id <> p_provider)
       + (select count(*) from auth_passkey where user_id = p_user)
    into v_altri;
  if v_altri = 0 and not v_verified then
    raise exception 'e'' l''ultimo modo di entrare: senza, l''account resterebbe chiuso'
      using errcode = '23514', constraint = 'last_sign_in_method';
  end if;
  delete from auth_account where user_id = p_user and provider_id = p_provider;
end $$;


-- ---------------------------------------------------------------------
--  Togliere una passkey
-- ---------------------------------------------------------------------

-- Solo una passkey dell'utente, e solo se resta un modo di entrare: un
-- provider collegato, un'altra passkey o l'email verificata. Il lock
-- sulla riga dell'utente e' lo stesso di unlink_provider e delete_account:
-- due rimozioni insieme si mettono in fila e la seconda vede cosa resta.
-- Aggiungere non chiede il lock: una passkey in piu' non chiude nessuno.
create function delete_passkey(p_user uuid, p_passkey uuid)
returns void language plpgsql as $$
declare
  v_verified boolean;
  v_altri    int;
begin
  select email_verified into v_verified from app_user where id = p_user for update;
  if not found then
    raise exception 'utente inesistente' using errcode = '42501', constraint = 'account_missing';
  end if;
  if not exists (select 1 from auth_passkey where id = p_passkey and user_id = p_user) then
    raise exception 'passkey non trovata' using errcode = '23514', constraint = 'passkey_not_found';
  end if;
  select (select count(*) from auth_account where user_id = p_user)
       + (select count(*) from auth_passkey where user_id = p_user and id <> p_passkey)
    into v_altri;
  if v_altri = 0 and not v_verified then
    raise exception 'e'' l''ultimo modo di entrare: senza, l''account resterebbe chiuso'
      using errcode = '23514', constraint = 'last_sign_in_method';
  end if;
  delete from auth_passkey where id = p_passkey and user_id = p_user;
end $$;
