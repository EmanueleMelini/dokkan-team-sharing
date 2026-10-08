-- =====================================================================
--  Carte presenti solo nel database del gioco (load-game-cards.mjs).
--
--  Il wiki ha smesso di creare pagine carta a fine luglio 2026, mentre il
--  gioco ha continuato a uscire: le unita' di agosto-settembre esistono
--  solo nel datamine. Senza di loro nessuno puo' metterle in una squadra.
--
--  Il datamine pero' non ha l'epiteto (e' un'invenzione della pagina del
--  wiki, non un campo del gioco). Inventarlo o ripetere il nome sarebbe
--  un dato falso che poi nessuno distingue da quello vero: NULL dice
--  esattamente "non lo sappiamo ancora". Quando il wiki documenta la
--  carta, load-cards lo scrive sulla stessa riga (stesso id).
-- =====================================================================

alter table card_text alter column epithet drop not null;

-- NULL e' "nessun epiteto"; la stringa vuota sarebbe un secondo modo di
-- dire la stessa cosa, e le query dovrebbero gestirli entrambi.
alter table card_text add constraint card_text_epithet_not_blank
  check (epithet is null or btrim(epithet) <> '');

-- L'indice della ricerca concatenava name || ' ' || epithet: con un
-- epiteto NULL l'espressione diventa NULL e la carta sparirebbe dalla
-- ricerca per nome. Le query che lo usano devono scrivere la stessa
-- espressione, con il coalesce.
drop index card_text_search;
create index card_text_search on card_text
  using gin ((name || ' ' || coalesce(epithet, '')) gin_trgm_ops);
