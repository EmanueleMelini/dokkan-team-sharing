-- =====================================================================
--  Settings: scollegare un provider e cancellare l'account.
--
--  Le FK verso app_user e verso clear sono gia' tutte on delete cascade
--  (0001, 0014, 0016, 0018): cancellare l'utente porta via sessioni,
--  accessi collegati, squadre, assetti, clear con versioni, prove, carte
--  e build, voti e commenti, anche quelli lasciati sui clear degli altri.
--  Resta fuori solo report: target_id e' polimorfico (clear, tip, prova)
--  e non ha FK, quindi una segnalazione sopravviveva al suo bersaglio.
--  I trigger della sezione 1 chiudono il buco per ogni strada che
--  cancella (delete_clear, revisioni, cancellazione dell'account).
--
--  Le due regole stanno qui e non solo nella Server Action, come per gli
--  altri verbi: la riga dell'utente si blocca (for update), cosi' due
--  richieste in parallelo non scollegano entrambe l'ultimo provider.
-- =====================================================================


-- ---------------------------------------------------------------------
--  1. Le segnalazioni se ne vanno con il loro bersaglio
-- ---------------------------------------------------------------------

create index report_by_target on report (target_kind, target_id);

-- Un trigger per tabella, con il tipo come argomento: lo stesso nome di
-- target_kind. Scatta anche dentro le cascate (clear -> versione -> prova).
create function report_target_gone() returns trigger
language plpgsql as $$
begin
  delete from report where target_kind = tg_argv[0] and target_id = old.id;
  return null;
end $$;

create trigger report_target_gone after delete on clear
  for each row execute function report_target_gone('clear');
create trigger report_target_gone after delete on tip
  for each row execute function report_target_gone('tip');
create trigger report_target_gone after delete on clear_proof
  for each row execute function report_target_gone('proof');

-- Quelle gia' orfane (nessuna nei dati di oggi, ma la regola vale da qui).
delete from report r
 where (r.target_kind = 'clear' and not exists (select 1 from clear c where c.id = r.target_id))
    or (r.target_kind = 'tip'   and not exists (select 1 from tip t where t.id = r.target_id))
    or (r.target_kind = 'proof' and not exists (select 1 from clear_proof p where p.id = r.target_id));


-- ---------------------------------------------------------------------
--  2. Scollegare un provider
-- ---------------------------------------------------------------------

-- Si puo' solo se resta almeno un modo di entrare. Il magic link conta
-- come modo solo con un'email verificata: e' l'unico caso in cui il
-- link arriva davvero a chi possiede l'account. Oggi ogni account nasce
-- verificato (validateUserInfo in lib/auth/config.ts, e il magic link
-- verifica da se'), ma la regola non deve dipendere da quell'invariante.
create function unlink_provider(p_user uuid, p_provider text)
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
  select count(*) into v_altri
    from auth_account where user_id = p_user and provider_id <> p_provider;
  if v_altri = 0 and not v_verified then
    raise exception 'e'' l''ultimo modo di entrare: senza, l''account resterebbe chiuso'
      using errcode = '23514', constraint = 'last_sign_in_method';
  end if;
  delete from auth_account where user_id = p_user and provider_id = p_provider;
end $$;


-- ---------------------------------------------------------------------
--  3. Cancellare l'account
-- ---------------------------------------------------------------------

-- La conferma e' l'handle scritto dall'utente: deve essere il SUO (citext,
-- quindi senza badare alle maiuscole). Anche se un id sbagliato arrivasse
-- fin qui, senza l'handle di quell'utente non si cancella niente.
-- Il resto lo fa la cascata; le sessioni spariscono con l'utente, quindi
-- l'uscita e' immediata anche sugli altri dispositivi.
create function delete_account(p_user uuid, p_handle text)
returns void language plpgsql as $$
declare v_handle citext;
begin
  select handle into v_handle from app_user where id = p_user for update;
  if not found then
    raise exception 'utente inesistente' using errcode = '42501', constraint = 'account_missing';
  end if;
  if p_handle is null or v_handle <> btrim(p_handle)::citext then
    raise exception 'l''handle scritto non e'' quello dell''account'
      using errcode = '23514', constraint = 'account_handle_mismatch';
  end if;
  delete from app_user where id = p_user;
end $$;
