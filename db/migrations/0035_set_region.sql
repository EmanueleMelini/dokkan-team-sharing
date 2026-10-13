-- =====================================================================
--  La versione del sito (Global o Japan) salvata sull'account.
--
--  Il sito ha un interruttore solo per tutte le pagine: il menu (burger e
--  header), Settings e /welcome. Lo stato vero sta nel cookie dts_version
--  (japan, oppure nessun cookie per Global), che i redirect di
--  next.config.ts leggono nel routing: le pagine pubbliche restano uguali
--  per tutti e in cache. Questa funzione lo porta sull'account, cosi' un
--  accesso da un altro dispositivo ritrova la stessa versione (l'hook dopo
--  l'accesso in lib/auth/config.ts riscrive il cookie da app_user.reg,
--  come il tema).
--
--  La colonna c'e' gia': app_user.reg (0001, scelta a /welcome da
--  complete_onboarding, 0014). E' anche il "Plays Global/Japan" pubblico
--  del profilo (public_profile, 0026): cambiare versione cambia quella
--  riga, e l'azione invalida il profilo solo quando cambia davvero.
--
--  Si applica PRIMA del codice che la chiama (setVersionAction): il codice
--  di prima non la conosce, quindi niente si rompe sopra.
-- =====================================================================

-- Un verbo e non un update dall'app, come set_theme (0027): l'id arriva
-- dalla sessione, e chi non ha finito l'onboarding non ha ancora un
-- profilo (la sua scelta resta solo sul dispositivo, poi la prende
-- /welcome). Una preferenza e non un contenuto: la sospensione non la
-- ferma. Ritorna se qualcosa e' cambiato: false per la stessa regione,
-- senza toccare updated_at. Un valore fuori dall'enum lo rifiuta il cast
-- (22P02); null lo rifiuta region_missing.
--
-- Il trigger del feed degli admin (activity_app_user, 0032) guarda solo
-- handle e onboarded_at: cambiare versione non e' un'azione del feed.
create function set_region(p_user uuid, p_reg region) returns boolean
language plpgsql as $$
declare
  v_prima region;
begin
  if p_reg is null then
    raise exception 'regione mancante' using errcode = '23514', constraint = 'region_missing';
  end if;
  select reg into v_prima from app_user
   where id = p_user and onboarded_at is not null
   for update;
  if not found then
    raise exception 'utente inesistente o senza onboarding'
      using errcode = 'P0002', constraint = 'user_not_found';
  end if;
  if v_prima = p_reg then
    return false;
  end if;
  update app_user set reg = p_reg, updated_at = now() where id = p_user;
  return true;
end $$;
