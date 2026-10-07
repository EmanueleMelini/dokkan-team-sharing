-- L'icona di rarita' LR e' un APNG animato: sul wiki e' "LR logo apng.png",
-- 181x151 e 397 KB, e il template la richiama con un URL fisso invece che
-- con la sintassi normale dei file (per questo non salta fuori cercando
-- "LR icon").
--
-- Qualunque ridimensionamento di Fandom la appiattisce in un WebP statico
-- da 13 KB. Le due versioni servono a cose diverse: la statica in una
-- lista dove l'icona compare centinaia di volte, l'animata sulla pagina
-- della carta dove ha senso che si muova. Le teniamo entrambe e lascia
-- che l'interfaccia scelga, invece di decidere qui.
alter table rarity_icon add column animated_asset_key text
  references asset(key) on delete set null;
