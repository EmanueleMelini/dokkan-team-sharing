-- =====================================================================
--  Profili pubblici (/users/<handle>) e cambio dell'handle.
--
--    - gli indici per le letture del profilo per autore (e per la
--      cascata di delete_account, che oggi scorre clear_comment intera);
--    - handle_history: gli handle che un utente ha lasciato restano suoi
--      finche' l'account esiste, e /users/<vecchio> porta a quello nuovo
--      con un 308. Con la cancellazione dell'account la cascata li libera
--      (scelta del proprietario: niente lapidi);
--    - un solo cancello per ogni presa di un handle (handle_assert_free,
--      sotto un lock consultivo per handle): /welcome e il cambio da
--      Settings non possono prendere lo stesso nome in due;
--    - change_handle: un cambio ogni 30 giorni, le sole maiuscole sono
--      libere, rifiutato a chi e' sospeso (user_suspended di 0024). La
--      sessione recente (15 minuti) la chiede la Server Action;
--    - la vista public_profile: l'unico posto da cui il profilo legge gli
--      utenti. Niente email, nome del provider, avatar, ruolo, lingua o
--      motivo della sospensione.
--
--  La sospensione e' di 0024 (suspended_until, user_suspended,
--  builder_assert_author): qui non si ridefinisce niente di suo.
--
--  Ogni rifiuto ha un nome in CONSTRAINT, tradotto da lib/auth/handle.ts
--  (un test controlla che ogni nome di questo file abbia la sua frase).
-- =====================================================================


-- ---------------------------------------------------------------------
--  1. Gli indici per autore
-- ---------------------------------------------------------------------

-- Il conteggio dei commenti di un profilo, e la cascata quando un
-- account si cancella: senza indice entrambi leggono tutta la tabella.
create index comment_by_author on clear_comment (author_id);

-- La lista dei clear di un profilo e' per data, dalla piu' recente: lo
-- stesso indice serve il filtro per autore e l'ordine, senza sort.
drop index clear_by_author;
create index clear_by_author on clear (author_id, created_at desc, id desc);


-- ---------------------------------------------------------------------
--  2. Gli handle lasciati
-- ---------------------------------------------------------------------

-- Una riga per handle (citext: un nome vale per tutte le maiuscole), di
-- un proprietario solo. Va via con l'account: i suoi vecchi nomi tornano
-- liberi, accettato (la pagina del profilo diventa un 404 comunque).
create table handle_history (
  handle     citext primary key,
  user_id    uuid not null references app_user on delete cascade,
  retired_at timestamptz not null default now(),
  constraint handle_history_shape check (handle ~ '^[A-Za-z0-9_]{3,24}$')
);
create index handle_history_by_user on handle_history (user_id, retired_at desc);

-- L'ultimo cambio vero (non quelli di sole maiuscole): da qui i 30 giorni.
-- Null per chi non l'ha mai cambiato, anche dopo /welcome.
alter table app_user add column handle_changed_at timestamptz;


-- ---------------------------------------------------------------------
--  3. Un cancello per ogni presa di un handle
-- ---------------------------------------------------------------------

-- Il lock consultivo per handle, fino alla fine della transazione. Il
-- controllo "nessun altro lo usa" e la scrittura avvengono sotto lo
-- stesso lock: due richieste per lo stesso nome passano una alla volta, e
-- la seconda vede la prima. La chiave e' in minuscolo, come citext.
-- L'unique su app_user.handle e la PK di handle_history restano l'ultima
-- difesa.
create function handle_lock(p citext) returns void
language sql as $fn$
  select pg_advisory_xact_lock(hashtextextended('handle:' || lower(p::text), 0));
$fn$;

-- Forma, nomi riservati (0014), poi l'handle attuale o lasciato di un
-- altro. Gli errori sono quelli di complete_onboarding (23514 forma e
-- riservato), piu' handle_taken con 23505: lo stesso codice del vincolo
-- unique che usciva prima, cosi' chi guardava solo il codice continua a
-- funzionare. I propri nomi lasciati non contano: si possono riprendere.
create function handle_assert_free(p_user uuid, p_handle citext) returns void
language plpgsql as $fn$
begin
  if p_handle is null or p_handle !~ '^[A-Za-z0-9_]{3,24}$' then
    raise exception 'handle non valido: 3-24 tra lettere, cifre e _'
      using errcode = '23514', constraint = 'handle_shape';
  end if;
  if handle_reserved(p_handle) then
    raise exception 'handle riservato: %', p_handle
      using errcode = '23514', constraint = 'handle_reserved';
  end if;
  perform handle_lock(p_handle);
  if exists (select 1 from app_user where handle = p_handle and id is distinct from p_user)
     or exists (select 1 from handle_history where handle = p_handle and user_id is distinct from p_user) then
    raise exception 'handle gia'' preso: %', p_handle
      using errcode = '23505', constraint = 'handle_taken';
  end if;
end $fn$;

-- complete_onboarding (0014), ridefinita: il controllo dell'handle passa
-- dal cancello comune, cosi' un nuovo iscritto non prende il nome che un
-- altro ha lasciato. Stessi codici e nomi: handle_shape e handle_reserved
-- (23514), already_onboarded (23514); un handle preso e' 23505 come prima,
-- ora con il nome handle_taken.
create or replace function complete_onboarding(p_user uuid, p_handle citext, p_reg region)
returns void language plpgsql as $fn$
begin
  perform handle_assert_free(p_user, p_handle);
  update app_user
     set handle = p_handle, reg = coalesce(p_reg, 'global'),
         onboarded_at = now(), updated_at = now()
   where id = p_user and onboarded_at is null;
  if not found then
    raise exception 'utente gia'' completo o inesistente'
      using errcode = '23514', constraint = 'already_onboarded';
  end if;
end $fn$;


-- ---------------------------------------------------------------------
--  4. Il cambio dell'handle
-- ---------------------------------------------------------------------

-- Da Settings, con una sessione recente (la controlla l'azione, come per
-- scollegare un provider o cancellare l'account). L'ordine dei controlli:
--   - l'utente deve esistere, avere finito /welcome e non essere sospeso:
--     cambiare nome non deve servire a sfuggire a una sospensione;
--   - lo stesso handle, maiuscole comprese, non e' un cambio;
--   - forma, riservati, nome di un altro (il cancello comune);
--   - le sole maiuscole (Goku -> GOKU) sono libere: niente storico,
--     niente attesa, perche' l'URL e i link restano gli stessi;
--   - un cambio vero ogni 30 giorni: ogni nome lasciato resta riservato
--     per sempre, e senza attesa uno solo potrebbe occuparne a decine;
--   - il nome lasciato va in handle_history, e un proprio nome lasciato
--     si puo' riprendere (la sua riga si toglie).
-- La riga dell'utente e' bloccata (for update): due cambi dello stesso
-- utente non leggono entrambi la stessa data dell'ultimo cambio.
create function change_handle(p_user uuid, p_handle citext) returns void
language plpgsql as $fn$
declare
  v_handle  citext;
  v_onboard timestamptz;
  v_changed timestamptz;
begin
  select handle, onboarded_at, handle_changed_at into v_handle, v_onboard, v_changed
    from app_user where id = p_user for update;
  if not found or v_onboard is null then
    raise exception 'utente inesistente o senza handle'
      using errcode = '42501', constraint = 'handle_change_forbidden';
  end if;
  if user_suspended(p_user) then
    raise exception 'account sospeso: l''handle non si cambia'
      using errcode = '42501', constraint = 'account_suspended';
  end if;
  if v_handle::text = p_handle::text then
    raise exception 'e'' gia'' il tuo handle'
      using errcode = '23514', constraint = 'handle_unchanged';
  end if;
  perform handle_assert_free(p_user, p_handle);
  if v_handle = p_handle then
    update app_user set handle = p_handle, updated_at = now() where id = p_user;
    return;
  end if;
  if v_changed > now() - interval '30 days' then
    raise exception 'un cambio ogni 30 giorni: il prossimo dal %', v_changed + interval '30 days'
      using errcode = '23514', constraint = 'handle_cooldown';
  end if;
  delete from handle_history where user_id = p_user and handle = p_handle;
  -- Il conflitto non puo' venire da un altro utente (il nome era di
  -- questo): resta per una riga rimasta da un ripristino a mano.
  insert into handle_history (handle, user_id) values (v_handle, p_user)
    on conflict (handle) do update set user_id = excluded.user_id, retired_at = now();
  update app_user set handle = p_handle, handle_changed_at = now(), updated_at = now()
   where id = p_user;
end $fn$;


-- ---------------------------------------------------------------------
--  5. La vista pubblica
-- ---------------------------------------------------------------------

-- L'unico posto da cui lib/profiles.ts legge gli utenti: le colonne sono
-- un elenco chiuso, e un test controlla che restino queste. Un utente che
-- non ha finito /welcome (handle provvisorio user_xxxx) o e' sospeso non
-- c'e': il suo profilo e' un 404 come quello di chi non esiste, cosi' la
-- sospensione non si legge da fuori.
--
-- handle resta citext: il filtro p.handle = $1 usa l'unique di app_user
-- e non bada alle maiuscole (/users/GOKU trova Goku, e la pagina porta
-- alla forma giusta).
--
-- I conteggi sono sottoquery per riga: le pagine leggono la vista per un
-- utente solo (solo il build ne ordina tutta, per i 20 profili da
-- prerenderizzare), e gli indici per autore la tengono leggera. Se un
-- giorno servisse una classifica, i conteggi andrebbero materializzati. Contano solo i contenuti visibili:
--   - clears: i clear pubblicati;
--   - upvotes: i +1 su tutte le versioni dei clear pubblicati (mai i -1:
--     un profilo non diventa una gogna);
--   - comments: i commenti pubblicati su clear pubblicati.
create view public_profile as
select u.id,
       u.handle,
       u.reg,
       u.created_at as joined_at,
       (select count(*) from clear c
         where c.author_id = u.id and c.status = 'published')::int as clears,
       (select count(*) from clear c
          join clear_version cv on cv.clear_id = c.id
          join clear_vote v on v.version_id = cv.id
         where c.author_id = u.id and c.status = 'published' and v.value = 1)::int as upvotes,
       (select count(*) from clear_comment m
          join clear_version cv on cv.id = m.version_id
          join clear c on c.id = cv.clear_id
         where m.author_id = u.id and m.status = 'published' and c.status = 'published')::int as comments
from app_user u
where u.onboarded_at is not null and not user_suspended(u.id);
