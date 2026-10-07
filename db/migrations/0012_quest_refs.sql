-- =====================================================================
--  Un legame per quest, per le aree che il wiki divide in piu' pagine.
--
--  La chiave primaria di event_game_ref (game_kind, game_id) vuole che
--  un'area sia di un evento solo, ed e' giusto per quasi tutte. Due
--  famiglie no:
--    Super Battle Road   due aree del gioco (710, 720), 90 e 85 piani, e
--                        nel wiki una pagina ogni dieci piani (15 pagine);
--    archivi             1737 Ultimate Red Zone e 1738 Supreme Magnificent
--                        Battle raccolgono le edizioni vecchie, ognuna gia'
--                        evento a se', come quest "<Edizione> Stage N".
--  Allargare la chiave avrebbe reso ambiguo ogni altro legame. Invece la
--  riga scende di un livello: game_kind = 'quest', game_id = id della
--  quest. Una quest sta in una pagina sola, quindi la chiave regge com'e'.
--  Le scrive load-windows (source = 'wiki', via 'range' o 'archive'), e le
--  finestre si calcolano dalle quest: vedi db/import/quest-refs.mjs.
-- =====================================================================

alter table event_game_ref drop constraint event_game_ref_game_kind_check;
alter table event_game_ref add constraint event_game_ref_game_kind_check
  check (game_kind in ('area', 'z_battle_stage', 'quest'));
