-- =====================================================================
--  Gli asset di gioco, ospitati da noi.
--
--  Il database tiene la CHIAVE, non l'URL: 'cards/1002240/thumb.webp'.
--  L'URL lo compone l'applicazione mettendoci davanti ASSET_BASE_URL.
--  Cosi' passare dal disco locale a un object storage e' una variabile
--  d'ambiente, non una UPDATE su cinquemila righe.
--
--  Nota: questa e' l'unica categoria di immagini che ospitiamo. Le prove
--  dei clear restano link esterni — sono contenuto degli utenti, e non
--  ospitarle e' una scelta deliberata. Gli asset di gioco sono un'altra
--  cosa: sono il vocabolario visivo del sito, e devono essere veloci e
--  non spariti.
-- =====================================================================

create type asset_kind as enum (
  'card_thumb', 'card_art', 'type_icon', 'rarity_icon', 'item_icon', 'event_banner'
);

create table asset (
  key           text primary key,        -- il percorso nello storage
  kind          asset_kind not null,
  content_type  text not null,
  byte_size     int  not null check (byte_size > 0),
  width         int,
  height        int,
  checksum      text not null,           -- sha256: se non cambia, non si riscarica
  source_url    text,                    -- da dove viene, per rifetch e attribuzione
  fetched_at    timestamptz not null default now()
);
create index asset_by_kind on asset (kind);

-- La carta perde art_url e guadagna due chiavi: la miniatura per le liste
-- e il team builder, l'artwork per la pagina della carta.
alter table card drop column art_url;
alter table card add column thumb_key text references asset(key) on delete set null;
alter table card add column art_key   text references asset(key) on delete set null;

-- Il gioco mostra un'icona per la COPPIA tipo+classe (Super AGL e Extreme
-- AGL sono due icone diverse), quindi la chiave e' composta: dieci righe.
create table type_icon (
  type       unit_type  not null,
  class      unit_class not null,
  asset_key  text not null references asset(key) on delete cascade,
  primary key (type, class)
);

create table rarity_icon (
  rarity     rarity primary key,
  asset_key  text not null references asset(key) on delete cascade
);

-- Gli oggetti dei premi delle missioni: dragon stone, zeni, medaglie.
-- La tabella c'e' ma si riempie con l'import degli eventi, perche' e' da
-- li' che si sa quali oggetti servono. Oggi mission.reward e' testo
-- libero: collegarlo a queste righe e' parte di quel lavoro.
create table reward_item (
  slug       text primary key,           -- 'dragon-stone'
  asset_key  text references asset(key) on delete set null
);

create table reward_item_text (
  slug    text not null references reward_item on delete cascade,
  locale  text not null references locale on delete cascade,
  name    text not null,
  primary key (slug, locale)
);

alter table event drop column banner_art_url;
alter table event add column banner_key text references asset(key) on delete set null;
