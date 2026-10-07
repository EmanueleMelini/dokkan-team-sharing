-- =====================================================================
--  Gli eventi che il wiki non documenta, presi dal database del gioco.
--
--  Il wiki ha smesso di scrivere pagine di eventi a inizio 2025: da li' in
--  poi l'unica fonte e' il datamine Global (load-game-events). Questi eventi
--  non hanno banner (il datamine da' solo il percorso del file, che nessuno
--  ospita) e nemmeno una descrizione. Servono due cose allo schema.
-- =====================================================================

-- 1. Un'immagine di ripiego: la carta del boss principale. L'interfaccia la
--    usa come copertina quando banner_key e' nullo. Si tiene la carta e non
--    un'immagine: la miniatura e l'artwork li ha gia' la carta, e cambiano
--    con lei. Se la carta sparisce, l'evento resta, senza copertina.
alter table event add column cover_card_id bigint references card(id) on delete set null;

-- 2. Chi ha deciso un legame con il gioco. Fino a qui li scriveva solo
--    load-windows, ricavandoli dalle pagine del wiki, e li ricostruiva a ogni
--    giro cancellando quelli che non ritrovava. Ora ne scrive anche
--    load-game-events: l'area di un evento creato dal gioco, e le riedizioni
--    che riconosce dai dati del gioco (stesso nome, stessi boss) anche quando
--    l'evento e' del wiki. Ognuno dei due tocca solo i suoi:
--      wiki  load-windows, da game-map.mjs
--      game  load-game-events
--    Le righe che ci sono oggi sono tutte di load-windows.
alter table event_game_ref add column source text not null default 'wiki'
  constraint event_game_ref_source check (source in ('wiki', 'game'));

-- 3. Una Super EZA e' un evento a se', ma pende da un'EZA Normal
--    (z_battle_stages.related_z_battle_stage_id). Si tiene l'id dello stage
--    e non l'evento: l'EZA Normal puo' essere del wiki o del gioco, e il suo
--    evento si trova con lo stesso ponte, game_kind = 'z_battle_stage'.
alter table event_game_ref add column related_game_id int;
