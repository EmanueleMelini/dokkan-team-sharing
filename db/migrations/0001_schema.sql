-- =====================================================================
--  Dokkan clear index — schema PostgreSQL
--
--  Due assi tenuti separati, perché sono cose diverse:
--    REGIONE (region)  = quale versione del gioco: global | japan.
--                        Cambia i DATI: le date, gli eventi, cosa esiste.
--    LINGUA  (locale)  = in che lingua leggi il sito: en | ja | it | ...
--                        Cambia solo il TESTO, non i dati.
--  Un italiano legge in italiano i dati della Global. Confonderli
--  significa non poter più fare quella cosa.
--
--  Convenzione: testo localizzato in tabelle *_text, una riga per lingua.
-- =====================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists citext;     -- handle/email case-insensitive
create extension if not exists btree_gist; -- exclude constraint su event_run
create extension if not exists pg_trgm;    -- ricerca carte per nome


-- ---------------------------------------------------------------------
--  0. I DUE ASSI
-- ---------------------------------------------------------------------

create type region as enum ('global','japan');

-- Un testo può essere quello ufficiale del gioco, o una traduzione fatta
-- da noi / dalla community. Chi legge ha diritto di sapere quale dei due.
create type text_source as enum ('official','community');

-- Da dove è entrata una riga di dati di gioco. Serve per sapere cosa
-- andrà riverificato il giorno che la pipeline automatica esiste.
create type data_source as enum ('datamine','dataset','manual');

create table locale (
  code          text primary key,          -- 'en', 'ja', ...
  label         text not null,             -- "English"
  native_label  text                       -- "日本語"
);

-- Le lingue disponibili NON sono le stesse nelle due regioni: si segue
-- il gioco. Japan esce solo in giapponese, e l'inglese lì è una nostra
-- traduzione; Global ha le lingue che il gioco stesso pubblica.
-- È una tabella e non una regola scritta nel codice, così il giorno che
-- il gioco aggiunge una lingua si aggiunge una riga.
create table region_locale (
  reg       region  not null,
  locale    text    not null references locale on delete cascade,
  official  boolean not null,   -- true = lingua del gioco in quella regione
                                -- false = traduzione nostra / della community
  primary key (reg, locale)
);


-- ---------------------------------------------------------------------
--  1. UTENTI
-- ---------------------------------------------------------------------

create table app_user (
  id          uuid primary key default gen_random_uuid(),
  handle      citext not null unique,
  email       citext not null unique,
  reg         region not null default 'global',   -- che versione gioca
  locale      text   not null default 'en' references locale,
  role        text   not null default 'member'
                     check (role in ('member','editor','admin')),
  created_at  timestamptz not null default now()
);


-- ---------------------------------------------------------------------
--  2. DATI DI GIOCO  (importati, mai scritti dagli utenti)
-- ---------------------------------------------------------------------

create type unit_type  as enum ('AGL','TEQ','INT','STR','PHY');
create type unit_class as enum ('Super','Extreme');
create type rarity     as enum ('N','R','SR','SSR','UR','LR');

-- Fatti indipendenti dalla lingua. Niente nomi qui.
create table card (
  id            bigint primary key,            -- id del gioco
  type          unit_type  not null,
  class         unit_class not null,
  rarity        rarity     not null,
  eza_level     smallint not null default 0,   -- 0 = nessuna EZA
  is_seza       boolean  not null default false,
  hp            int,
  atk           int,
  def           int,
  art_url       text,
  awakens_from  bigint references card(id),    -- catena di dokkan awakening
  imported_from data_source not null default 'manual',
  imported_at   timestamptz not null default now()
);
create index card_by_type on card (type, class, rarity);

create table card_text (
  card_id       bigint not null references card on delete cascade,
  locale        text   not null references locale on delete cascade,
  name          text not null,                 -- "Vegeta"
  epithet       text not null,                 -- "Pride of the Saiyan Prince"
  leader_skill  text,
  passive       text,
  super_attack  text,
  source        text_source not null default 'official',
  primary key (card_id, locale)
);
-- ricerca carta per nome nel team builder, per lingua
create index card_text_search on card_text
  using gin ((name || ' ' || epithet) gin_trgm_ops);

-- La stessa carta esce prima su Japan e dopo su Global: non è una carta
-- diversa, è la stessa con due date. Una riga per regione dove esiste.
create table card_release (
  card_id      bigint not null references card on delete cascade,
  reg          region not null,
  released_at  date,
  primary key (card_id, reg)
);

create table link_skill (id smallint primary key);
create table link_skill_text (
  link_id  smallint not null references link_skill on delete cascade,
  locale   text     not null references locale on delete cascade,
  name     text not null,
  effect   text,
  source        text_source not null default 'official',
  primary key (link_id, locale)
);
create table card_link (
  card_id bigint   not null references card on delete cascade,
  link_id smallint not null references link_skill on delete cascade,
  primary key (card_id, link_id)
);
create index card_link_by_link on card_link (link_id);

create table category (id smallint primary key);
create table category_text (
  category_id smallint not null references category on delete cascade,
  locale      text     not null references locale on delete cascade,
  name        text not null,
  source        text_source not null default 'official',
  primary key (category_id, locale)
);
create table card_category (
  card_id     bigint   not null references card on delete cascade,
  category_id smallint not null references category on delete cascade,
  primary key (card_id, category_id)
);
create index card_category_by_cat on card_category (category_id);

create table equipment (id bigint primary key, tier smallint);
create table equipment_text (
  equipment_id bigint not null references equipment on delete cascade,
  locale       text   not null references locale on delete cascade,
  name         text not null,
  effect       text,
  source        text_source not null default 'official',
  primary key (equipment_id, locale)
);


-- ---------------------------------------------------------------------
--  3. EVENTI, STAGE, MISSIONI
-- ---------------------------------------------------------------------

create type event_kind as enum (
  'story','db_story','challenge','zbattle','growth','bonus','limited',
  'quest','dokkan_frontier','ultimate_clash','world_tournament',
  'pettan','burst'
);

create table event (
  id              bigint primary key,
  kind            event_kind not null,
  banner_art_url  text,
  imported_from   data_source not null default 'manual',
  imported_at     timestamptz not null default now()
);
create index event_by_kind on event (kind);

create table event_text (
  event_id             bigint not null references event on delete cascade,
  locale               text   not null references locale on delete cascade,
  name                 text not null,
  official_description text,          -- il testo ufficiale, come da gioco
  source        text_source not null default 'official',
  primary key (event_id, locale)
);

-- Un evento torna più volte, e torna in momenti diversi su Global e su
-- Japan. Lo stato attivo/futuro/passato NON è una colonna: è una
-- finestra temporale, e si calcola. La regione vive QUI, perché è la
-- singola esecuzione a essere di una regione, non l'evento in astratto.
create table event_run (
  id         bigserial primary key,
  event_id   bigint not null references event on delete cascade,
  reg        region not null,
  starts_at  timestamptz not null,
  ends_at    timestamptz,             -- null = permanente
  constraint run_window check (ends_at is null or ends_at > starts_at),
  -- due esecuzioni dello stesso evento nella stessa regione non
  -- possono sovrapporsi (su regioni diverse sì, ed è normale)
  constraint run_no_overlap exclude using gist (
    event_id with =,
    reg      with =,
    tstzrange(starts_at, coalesce(ends_at, 'infinity')) with &&
  ),
  unique (id, event_id)              -- bersaglio della FK composita da clear
);
create index event_run_window on event_run (reg, starts_at, ends_at);

create view event_status as
select
  r.id as run_id, e.id as event_id, e.kind, r.reg, r.starts_at, r.ends_at,
  case
    when now() <  r.starts_at then 'upcoming'
    when r.ends_at is null or now() < r.ends_at then 'active'
    else 'past'
  end as status
from event e
join event_run r on r.event_id = e.id;

create table stage (
  id        bigserial primary key,
  event_id  bigint not null references event on delete cascade,
  seq       smallint not null,
  unique (event_id, seq),
  unique (id, event_id)              -- bersaglio della FK composita
);

create table stage_text (
  stage_id  bigint not null references stage on delete cascade,
  locale    text   not null references locale on delete cascade,
  name      text not null,
  source        text_source not null default 'official',
  primary key (stage_id, locale)
);

create type difficulty as enum (
  'normal','hard','z_hard','super','super2','ultra','dokkan'
);

-- Lo stesso stage a difficoltà diversa ha costi, drop e boss diversi:
-- è questo il livello a cui si aggancia un clear, non lo stage nudo.
-- event_id è denormalizzato da stage per poter chiudere il diamante
-- di integrità su clear (vedi sotto).
create table stage_tier (
  id          bigserial primary key,
  stage_id    bigint not null,
  event_id    bigint not null,
  difficulty  difficulty not null,
  sta_cost    smallint,
  ll_rate     numeric(4,2),
  zeni        int,
  exp         int,
  unique (stage_id, difficulty),
  unique (id, event_id),             -- bersaglio della FK composita
  foreign key (stage_id, event_id) references stage (id, event_id) on delete cascade
);

create table stage_tier_text (
  stage_tier_id  bigint not null references stage_tier on delete cascade,
  locale         text   not null references locale on delete cascade,
  boss_note      text,
  source        text_source not null default 'official',
  primary key (stage_tier_id, locale)
);

create table mission (
  id        bigserial primary key,
  event_id  bigint not null references event on delete cascade,
  run_id    bigint references event_run on delete cascade, -- null = permanente
  seq       smallint
);
create index mission_by_event on mission (event_id);

create table mission_text (
  mission_id   bigint not null references mission on delete cascade,
  locale       text   not null references locale on delete cascade,
  description  text not null,
  reward       text,
  source        text_source not null default 'official',
  primary key (mission_id, locale)
);


-- ---------------------------------------------------------------------
--  4. TEAM  (scritti dagli utenti, modificabili nel tempo)
-- ---------------------------------------------------------------------

create table team (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references app_user on delete cascade,
  name        text not null,
  note        text,
  lang        text references locale,       -- lingua in cui è scritta la nota
  visibility  text not null default 'public'
              check (visibility in ('public','unlisted','private')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index team_by_owner on team (owner_id);

-- Un team può avere più assetti. Il #1 è quello iniziale; i successivi
-- sono i cambi dichiarati a metà evento, ognuno con il suo perché.
create table lineup (
  id       uuid primary key default gen_random_uuid(),
  team_id  uuid not null references team on delete cascade,
  seq      smallint not null,     -- 1 = assetto di partenza
  label    text,                  -- "fase 2", "dopo la trasformazione"
  note     text,                  -- perché si cambia, cosa si swappa
  unique (team_id, seq)
);

create type slot_role as enum ('leader','member','friend');

-- 7 unità in 3 rotazioni: 2 + 2 + 3.
create table lineup_slot (
  lineup_id       uuid not null references lineup on delete cascade,
  rotation_index  smallint not null check (rotation_index between 1 and 3),
  pos             smallint not null check (pos between 1 and 3),
  card_id         bigint not null references card,
  role            slot_role not null default 'member',
  note            text,
  primary key (lineup_id, rotation_index, pos),
  constraint rotation_shape check (
    (rotation_index in (1,2) and pos <= 2) or (rotation_index = 3 and pos <= 3)
  )
);
create unique index lineup_one_leader on lineup_slot (lineup_id) where role = 'leader';
create unique index lineup_one_friend on lineup_slot (lineup_id) where role = 'friend';

-- Le build sono opzionali e appartengono allo SLOT, non alla carta:
-- la stessa carta è buildata diversamente in due team diversi.
create table slot_build (
  lineup_id       uuid not null,
  rotation_index  smallint not null,
  pos             smallint not null,
  hp_stars        smallint check (hp_stars between 0 and 5),  -- 5 = rainbow
  hp_path         text,
  note            text,
  primary key (lineup_id, rotation_index, pos),
  foreign key (lineup_id, rotation_index, pos) references lineup_slot on delete cascade
);

create table slot_orb (
  lineup_id       uuid not null,
  rotation_index  smallint not null,
  pos             smallint not null,
  slot_no         smallint not null check (slot_no between 1 and 6),
  orb_name        text not null,
  primary key (lineup_id, rotation_index, pos, slot_no),
  foreign key (lineup_id, rotation_index, pos) references lineup_slot on delete cascade
);

create table slot_equipment (
  lineup_id       uuid not null,
  rotation_index  smallint not null,
  pos             smallint not null,
  slot_no         smallint not null check (slot_no between 1 and 3),
  equipment_id    bigint not null references equipment,
  primary key (lineup_id, rotation_index, pos, slot_no),
  foreign key (lineup_id, rotation_index, pos) references lineup_slot on delete cascade
);


-- ---------------------------------------------------------------------
--  5. CLEAR  (il ponte: qui i dati di gioco incontrano la community)
--
--  Un clear è versionato. L'intestazione dice COSA si afferma di aver
--  chiuso e non cambia mai: quello non è correggibile, è un altro clear.
--  Le versioni dicono COME, e una correzione è una versione nuova.
--
--  Perché non immutabile e non modificabile: perché voti e commenti si
--  attaccano alla VERSIONE. Se la v1 ha preso 500 voti e poi l'autore
--  corregge, quei 500 restano dov'erano — non seguono la modifica e non
--  si azzerano con una cancellazione. Il buco del "cancella e reinserisci
--  per ripulire i voti negativi" si chiude da sé: correggere non cancella
--  niente, e la storia resta leggibile.
-- ---------------------------------------------------------------------

create table clear (
  id             uuid   primary key default gen_random_uuid(),
  author_id      uuid   not null references app_user on delete cascade,

  -- run_id è NOT NULL: anche il contenuto permanente ha una sua
  -- esecuzione (con ends_at nullo). Così la REGIONE del clear si deduce
  -- dalla ricorrenza e non va copiata qui: una verità, un posto.
  run_id         bigint not null,
  stage_tier_id  bigint not null,
  event_id       bigint not null,

  team_id        uuid   references team on delete set null,
  status         text   not null default 'published'
                        check (status in ('published','hidden','flagged')),
  created_at     timestamptz not null default now(),

  -- Le due FK composite chiudono il diamante: la ricorrenza e lo stage
  -- di un clear DEVONO appartenere allo stesso evento. Senza questo si
  -- possono inserire clear che dicono "chiuso lo stage 3 di Frieza
  -- durante la run del World Tournament", e non lo scopri mai.
  foreign key (run_id, event_id)        references event_run  (id, event_id),
  foreign key (stage_tier_id, event_id) references stage_tier (id, event_id)
);
create index clear_by_tier   on clear (stage_tier_id) where status = 'published';
create index clear_by_run    on clear (run_id);
create index clear_by_author on clear (author_id);


-- Una versione, una volta creata, non si tocca più: lo impone un trigger
-- (vedi submit.sql). Restano scrivibili score e is_current, e nient'altro.
create table clear_version (
  id               uuid   primary key default gen_random_uuid(),
  clear_id         uuid   not null references clear on delete cascade,
  seq              smallint not null,

  -- Snapshot immutabile: l'assetto e le build come erano al momento
  -- dell'invio di QUESTA versione.
  lineup_snapshot  jsonb  not null,

  no_items         boolean not null default false,
  deathless        boolean not null default false,
  turns            smallint check (turns > 0),
  note             text,
  lang             text references locale,
  change_note      text,    -- perché questa versione esiste. Null sulla prima.

  score            int     not null default 0,   -- voti DI QUESTA versione
  is_current       boolean not null default true,
  created_at       timestamptz not null default now(),

  unique (clear_id, seq)
);
-- una sola versione corrente per clear, imposto dall'indice
create unique index clear_one_current on clear_version (clear_id) where is_current;
create index version_by_clear on clear_version (clear_id, seq desc);
create index version_current_score on clear_version (score desc) where is_current;


-- Lo snapshot della versione, spianato in righe: è l'unica forma in cui
-- si può filtrare "clear SENZA questa carta" o "solo unità di questa
-- categoria". Appartiene alla VERSIONE, perché descrive quell'assetto.
-- La PK non contiene card_id perché leader e friend possono essere la
-- stessa carta.
create table clear_card (
  version_id      uuid not null references clear_version on delete cascade,
  rotation_index  smallint not null,
  pos             smallint not null,
  card_id         bigint not null references card,
  role            slot_role not null,
  primary key (version_id, rotation_index, pos)
);
create index clear_card_by_card on clear_card (card_id);


-- Solo link: il sito non ospita file. L'utente incolla un URL a
-- YouTube, Imgur o dove preferisce, e la prova è opzionale — un clear
-- senza prova entra comunque, vale solo meno per chi lo guarda.
-- Appartiene alla versione: una prova documenta quell'esecuzione.
--
-- Il prezzo di questa scelta è il link rot: fra un anno una parte di
-- questi URL sarà morta. Non si può evitare, si può però smettere di
-- mostrare un rettangolo rotto: le tre colonne di controllo servono a
-- un job periodico che marca i link caduti, così l'interfaccia può
-- dirlo invece di fingere.
create table clear_proof (
  id               uuid primary key default gen_random_uuid(),
  version_id       uuid not null references clear_version on delete cascade,
  kind             text not null check (kind in ('screenshot','video')),
  url              text not null,
  provider         text,          -- 'youtube','imgur',... dedotto dall'host
  last_checked_at  timestamptz,
  is_reachable     boolean,       -- null = mai controllato
  added_at         timestamptz not null default now(),
  constraint proof_url_http check (url ~* '^https?://')
);
create index proof_by_version on clear_proof (version_id);
-- la coda del controllore: prima i mai controllati, e mai i già morti
create index proof_to_recheck on clear_proof (last_checked_at nulls first)
  where is_reachable is not false;


-- La vista che il sito legge: l'intestazione più la versione corrente.
-- La regione non sta su clear: si legge dalla ricorrenza.
create view clear_current as
select
  c.id, c.author_id, c.event_id, c.run_id, c.stage_tier_id, c.team_id, c.status,
  c.created_at,
  r.reg, st.difficulty, s.seq as stage_seq,
  v.id as version_id, v.seq as version_seq, v.lineup_snapshot,
  v.no_items, v.deathless, v.turns, v.note, v.lang, v.change_note,
  v.score, v.created_at as version_created_at,
  -- una prova che c'è ed è ancora raggiungibile: serve a ordinare i
  -- clear provati prima di quelli sulla fiducia
  exists (
    select 1 from clear_proof p
    where p.version_id = v.id and p.is_reachable is not false
  ) as has_proof
from clear c
join clear_version v on v.clear_id = c.id and v.is_current
join event_run r     on r.id  = c.run_id
join stage_tier st   on st.id = c.stage_tier_id
join stage s         on s.id  = st.stage_id;




-- ---------------------------------------------------------------------
--  6. VOTI, TIPS, MODERAZIONE
-- ---------------------------------------------------------------------

-- Il voto è di una VERSIONE, non del clear: è il perno di tutto il
-- modello. Un utente può votare due versioni diverse dello stesso clear,
-- e non è un errore — sono due cose diverse che ha giudicato.
create table clear_vote (
  version_id  uuid not null references clear_version on delete cascade,
  user_id     uuid not null references app_user on delete cascade,
  value       smallint not null check (value in (-1, 1)),
  voted_at    timestamptz not null default now(),
  primary key (version_id, user_id)
);
create index vote_by_user on clear_vote (user_id);

-- La reputazione, tenuta separata dal punteggio.
--   current_score  = i voti della versione che si sta guardando
--   lifetime_score = quelli di tutte le versioni, storia compresa
-- Il sito mostra il primo, e il secondo accanto quando le versioni sono
-- più di una: "3 voti su questa versione, 503 in totale su 2 versioni".
-- Sommarli e basta ingannerebbe — quei 500 erano per un altro assetto.
create view clear_reputation as
select
  c.id as clear_id,
  cur.seq                        as current_seq,
  cur.score                      as current_score,
  agg.versions,
  agg.lifetime_score,
  agg.lifetime_votes,
  (agg.versions > 1)             as revised
from clear c
join clear_version cur on cur.clear_id = c.id and cur.is_current
join lateral (
  select count(*) as versions,
         coalesce(sum(v.score), 0) as lifetime_score,
         (select count(*) from clear_vote vv
           join clear_version v2 on v2.id = vv.version_id
          where v2.clear_id = c.id) as lifetime_votes
  from clear_version v where v.clear_id = c.id
) agg on true;

-- Con la versione congelata, commentare è l'unico modo di aggiungere
-- qualcosa a un clear dopo. Il commento sta sulla versione: così resta
-- attaccato a ciò di cui parlava, anche dopo una correzione.
create table clear_comment (
  id          uuid primary key default gen_random_uuid(),
  version_id  uuid not null references clear_version on delete cascade,
  author_id   uuid not null references app_user on delete cascade,
  body        text not null,
  lang        text references locale,
  created_at  timestamptz not null default now()
);
create index comment_by_version on clear_comment (version_id, created_at);

create table tip (
  id             uuid primary key default gen_random_uuid(),
  author_id      uuid not null references app_user on delete cascade,
  event_id       bigint references event on delete cascade,
  stage_tier_id  bigint references stage_tier on delete cascade,
  body           text not null,
  lang           text references locale,
  score          int  not null default 0,      -- mantenuto dal trigger
  created_at     timestamptz not null default now(),
  constraint tip_has_target check (event_id is not null or stage_tier_id is not null)
);
create index tip_by_event on tip (event_id, score desc);

create table tip_vote (
  tip_id   uuid not null references tip on delete cascade,
  user_id  uuid not null references app_user on delete cascade,
  value    smallint not null check (value in (-1, 1)),
  primary key (tip_id, user_id)
);

create table report (
  id           uuid primary key default gen_random_uuid(),
  reporter_id  uuid not null references app_user on delete cascade,
  target_kind  text not null check (target_kind in ('clear','tip','proof')),
  target_id    uuid not null,
  reason       text not null,
  resolved_at  timestamptz,
  created_at   timestamptz not null default now()
);


-- ---------------------------------------------------------------------
--  7. PUNTEGGI: la copia la tiene allineata il database, non il codice
--
--  clear_version.score e tip.score sono copie di sum(value) sui voti. Servono
--  perché ordinare 50.000 clear per "più votati" non può ricalcolare la
--  somma a ogni caricamento. Ma una copia che il codice deve ricordarsi
--  di aggiornare è una copia che prima o poi divergerà — e nessuno se ne
--  accorge, perché il numero sbagliato sembra un numero.
--  Con il trigger la copia non può divergere: qualunque strada scriva un
--  voto (API, script, SQL a mano), il punteggio si aggiorna.
-- ---------------------------------------------------------------------

create or replace function clear_recalc_score(p_version uuid)
returns void language sql as $fn$
  update clear_version set score = (
    select coalesce(sum(value), 0) from clear_vote where version_id = p_version
  ) where id = p_version;
$fn$;

create or replace function clear_vote_sync() returns trigger
language plpgsql as $fn$
begin
  if tg_op in ('DELETE','UPDATE') then perform clear_recalc_score(old.version_id); end if;
  if tg_op in ('INSERT','UPDATE') then perform clear_recalc_score(new.version_id); end if;
  return null;
end $fn$;

create trigger clear_vote_score
after insert or update or delete on clear_vote
for each row execute function clear_vote_sync();

create or replace function tip_recalc_score(p_tip uuid)
returns void language sql as $fn$
  update tip set score = (
    select coalesce(sum(value), 0) from tip_vote where tip_id = p_tip
  ) where id = p_tip;
$fn$;

create or replace function tip_vote_sync() returns trigger
language plpgsql as $fn$
begin
  if tg_op in ('DELETE','UPDATE') then perform tip_recalc_score(old.tip_id); end if;
  if tg_op in ('INSERT','UPDATE') then perform tip_recalc_score(new.tip_id); end if;
  return null;
end $fn$;

create trigger tip_vote_score
after insert or update or delete on tip_vote
for each row execute function tip_vote_sync();
