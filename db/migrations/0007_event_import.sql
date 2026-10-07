-- =====================================================================
--  Aggiustamenti richiesti dai dati reali degli eventi del wiki.
-- =====================================================================

-- 1. Il wiki usa sei difficolta': Normal, Hard, Z-Hard, Super, Super2,
--    Super3. Avevo previsto 'ultra' e 'dokkan' (che restano, la fixture
--    li usa) ma non super3, che e' 337 righe.
alter type difficulty add value if not exists 'super3';

-- 2. Un tipo per gli eventi che non si riescono a classificare. Sono 30
--    su 608, e inventare una categoria plausibile sarebbe peggio che
--    dire "non lo so".
alter type event_kind add value if not exists 'other';

-- 3. Il titolo della pagina wiki. Per gli eventi conta piu' che per le
--    carte: le carte hanno un id di gioco dentro il nome dell'immagine,
--    gli eventi NON ce l'hanno da nessuna parte. Quindi event.id qui e'
--    il pageid del wiki — stabile e riproducibile, ma non l'id del
--    gioco. Il giorno che arriva un datamine, gli id degli eventi vanno
--    rimappati passando da wiki_title: e' l'unica chiave che i due lati
--    hanno in comune.
alter table event add column wiki_title text unique;

-- 4. Il wiki da' UNA data di prima uscita per regione, non le finestre
--    delle ricorrenze. Una run con ends_at nullo, nel nostro modello,
--    significa "permanente": vero per gli eventi story e le EZA, falso
--    per quelli a tempo. Invece di far finta, lo si dichiara: la fine
--    non e' nota. La view event_status continua a dire 'active', e
--    l'interfaccia puo' aggiungere "fine non nota" invece di mentire.
alter table event_run add column ends_at_known boolean not null default true;
