-- =====================================================================
--  La cornice delle miniature delle carte.
--
--  Sul wiki la miniatura di una LR non e' un file solo: Module:Thumb la
--  compone nel browser a strati (la cornice "Frame SSR <tipo> thumb.png",
--  la spirale, i raggi, "Card <id> thumb.png", il logo "LR icon thumb.png"
--  e l'icona del tipo). "Card <id> thumb.png" di una LR e' quindi il solo
--  personaggio, senza cornice, badge del tipo ne' logo LR, e fetch-assets,
--  che lo prende per convenzione, lo collegava cosi'. Misurato su
--  dokkan_dev il 2026-10-13: 179 delle 183 miniature LR, tutte 250x250.
--
--  frame dice com'e' il file di una miniatura (kind card_thumb):
--    true   ha la cornice del gioco;
--    false  e' il solo personaggio (lo strato nudo): il sito gli disegna
--           attorno una cornice sua (components/segnaposto.tsx, CorniceCarta);
--    null   non misurato, o non e' una miniatura: vale come incorniciata.
--  Lo misura fetch-assets dai pixel (db/import/asset-cornice.mjs: l'alfa
--  della striscia in basso della cornice e quanto del riquadro e' pieno),
--  solo quando scrive la riga: un download o un'adozione dal disco.
--
--  Il riempimento qui sotto non puo' leggere i pixel: usa LR + 250x250, che
--  sul file misurato coincide con le 179 nude (0 falsi, 0 mancati). La
--  produzione serve gli stessi file (stessi checksum), quindi le stesse 179.
--  Una riga che sfuggisse resterebbe null: nessuna cornice disegnata, come
--  prima.
--
--  Si applica PRIMA del codice che la legge (asset_bare nelle pagine, frame
--  nelle scritture di fetch-assets): e' l'ordine contrario della 0033. La
--  colonna e' nullable e senza default, quindi il codice di prima continua
--  a funzionare sopra.
-- =====================================================================

alter table asset add column frame boolean;

alter table asset add constraint asset_frame_card_thumb check (frame is null or kind = 'card_thumb');

update asset a set frame = false
  from card c
 where c.thumb_key = a.key and a.kind = 'card_thumb' and c.rarity = 'LR'
   and a.width = 250 and a.height = 250;

-- Se la miniatura di una chiave e' lo strato nudo: false anche per una
-- chiave null, senza riga o mai misurata. Le query delle pagine la chiamano
-- accanto a ogni thumb_key (lib/queries.ts, lib/cards.ts, lib/clears.ts,
-- lib/card-page.ts, lib/profiles.ts): la risposta e' la stessa per tutti,
-- come l'HTML in cache.
create function asset_bare(p_key text) returns boolean
  language sql stable
  as $$ select coalesce((select a.frame = false from asset a where a.key = p_key), false) $$;
