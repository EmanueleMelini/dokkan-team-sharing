-- =====================================================================
--  Gli stage che una riedizione aggiunge a un evento che c'e' gia'.
--
--  Una riedizione si lega all'evento di prima (event_game_ref), ma il
--  gioco a volte le da' uno stage in piu': 552139 Looming Menace ha 3
--  stage dal wiki, la riedizione 616 un quarto ("Extreme Stage"), e le
--  missioni dicono "Clear Stage 4". Quegli stage li scrive
--  load-game-events (game-events/rerun-stages.mjs) sugli eventi del wiki e
--  su quelli del gioco, in coda agli stage che l'evento ha gia'.
--
--  game_quest_id e' la quest del gioco da cui viene lo stage, e ne fa due
--  cose insieme:
--    - la chiave naturale per rifarlo: (evento, quest) ritrova lo stesso
--      stage, con lo stesso id, anche se il suo seq e' cambiato;
--    - il segno di chi l'ha scritto: load-events e writeStages non lo
--      tolgono come "stage che la loro fonte non da' piu'", e se la loro
--      fonte vuole il suo seq lo spostano in coda invece di sovrascriverlo.
--  Nullo per tutti gli altri stage, che restano dell'import del loro evento.
-- =====================================================================

alter table stage add column game_quest_id integer;
alter table stage add constraint stage_event_id_game_quest_id_key unique (event_id, game_quest_id);
comment on column stage.game_quest_id is
  'quest del gioco di uno stage aggiunto da una riedizione (load-game-events); nullo per gli stage propri dell''evento';
