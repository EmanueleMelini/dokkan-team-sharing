-- =====================================================================
--  Da dove viene un asset.
--
--  0004 aveva source_url "per rifetch e attribuzione", mai riempito: le
--  6246 righe di oggi sono state riadottate dal disco dopo un db:reset.
--  Ora la provenienza e' una colonna, come event_run.source (0010):
--    source      la fonte. Oggi una sola, 'wiki': fetch-assets chiede
--                tutto al wiki (l'API per i nomi, la sua CDN per i file).
--    source_url  il file originale sulla CDN del wiki, senza
--                ridimensionamento (lo decide il kind) e senza query string.
--
--  Il riempimento dice solo quello che e' certo. 'wiki' si': fetch-assets
--  e' l'unico che scrive asset e chiede solo al wiki. L'URL no: quale dei
--  candidati avesse risposto (il file della pagina o quello per
--  convenzione, l'artwork o il bg) non si sa piu', e resta null.
--
--  Niente default: chi scrive una riga deve dire da dove viene. Una fonte
--  nuova (il gioco, i nostri file) e' una migrazione, non un valore libero.
-- =====================================================================

alter table asset add column source text;

update asset set source = 'wiki';

alter table asset
  alter column source set not null,
  add constraint asset_source check (source in ('wiki')),
  -- un URL del wiki sta sulla sua CDN (static, o vignette, il nome vecchio
  -- che 136 pagine scrivono ancora) o sul suo dominio: un link incollato a
  -- mano su una pagina non diventa una provenienza
  add constraint asset_source_url_wiki check (
    source <> 'wiki' or source_url is null
    or source_url ~ '^https://(static\.wikia\.nocookie\.net|vignette\.wikia\.nocookie\.net|dbz-dokkanbattle\.fandom\.com)/');
