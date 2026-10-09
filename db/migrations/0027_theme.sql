-- =====================================================================
--  Il tema del sito scelto dall'account.
--
--  Il tema si applica solo nel browser (lo script nel <head> del layout
--  legge localStorage 'dts:tema'): le pagine pubbliche restano uguali per
--  tutti e in cache. Questa colonna serve a portarlo da un dispositivo
--  all'altro: /api/me lo restituisce, e ViewerProvider lo applica e lo
--  copia in localStorage se e' diverso.
--
--  null vuol dire "System": segue il sistema operativo (chiaro o scuro).
--  Gli id sono quelli di lib/tema/temi.ts e dei blocchi [data-theme] di
--  app/globals.css: un test (temi.test.mts) controlla che le tre liste
--  coincidano.
-- =====================================================================

alter table app_user add column theme text
  constraint app_user_theme check (theme in (
    'light', 'dark',
    'notte-agl', 'giada-teq', 'nebulosa-int', 'brace-str', 'sabbia-phy',
    'lr-oro', 'oled', 'alto-contrasto'
  ));

-- Un verbo e non un update dall'app, come set_prefers_animated (0022):
-- l'id arriva dalla sessione, e chi non ha finito l'onboarding non ha
-- ancora un profilo da configurare. null toglie la scelta (System).
-- Un id sconosciuto lo rifiuta il vincolo app_user_theme (23514).
-- Ritorna il valore salvato.
create function set_theme(p_user uuid, p_theme text) returns text
language plpgsql as $$
begin
  update app_user set theme = p_theme, updated_at = now()
   where id = p_user and onboarded_at is not null;
  if not found then
    raise exception 'utente inesistente o senza onboarding'
      using errcode = 'P0002', constraint = 'user_not_found';
  end if;
  return p_theme;
end $$;
