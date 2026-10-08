-- delete_account (0019) confrontava l'handle con <>: se l'handle salvato e'
-- NULL il confronto vale NULL, l'if non scatta e l'account si cancella con
-- qualsiasi testo. Dall'app non succede (l'action rifiuta prima e l'id viene
-- dalla sessione), ma la conferma deve reggere anche da sola nel database.
-- "is distinct from" tratta NULL come un valore: un handle mancante non
-- combacia mai.
create or replace function delete_account(p_user uuid, p_handle text)
returns void language plpgsql as $$
declare v_handle citext;
begin
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
