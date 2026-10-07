-- =====================================================================
--  Le missioni degli eventi, dal database del gioco (load-missions).
--
--  Il wiki non le ha (3 pagine su 608), il datamine Global si': missions
--  con area_id o z_battle_stage_id, e i premi in mission_rewards. Allo
--  schema del 0001 mancano tre cose: una chiave naturale per reimportare
--  senza cambiare id, la finestra della missione, e i premi come dato
--  invece che come testo.
-- =====================================================================

-- 1. La chiave del gioco. Nullable: una missione scritta a mano non ce
--    l'ha. Unica: una missione del gioco sta in un evento solo.
alter table mission add column game_mission_id integer unique;
alter table mission add column imported_from data_source not null default 'manual';

-- 2. La finestra della missione stessa, che non e' quella della corsa: una
--    missione puo' arrivare a corsa iniziata (uno stage aggiunto a meta').
--    ends_at nullo = nessuna scadenza propria (2038 nel gioco): la missione
--    c'e' ogni volta che l'evento e' aperto, ed e' anche il caso in cui
--    run_id e' nullo. Le date sono UTC, come quelle di event_run.
alter table mission add column starts_at timestamptz;
alter table mission add column ends_at timestamptz;
alter table mission add constraint mission_window
  check (ends_at is null or starts_at is null or ends_at > starts_at);

-- La corsa deve essere dello stesso evento: la FK del 0001 guarda solo
-- l'id, e una missione attaccata alla run di un altro evento passerebbe.
alter table mission add constraint mission_run_same_event
  foreign key (run_id, event_id) references event_run (id, event_id) on delete cascade;

-- 3. Il titolo breve, quello della lista nel gioco ("Clear Stage 4 on
--    Z-HARD 30 times under special cond."); description resta il testo
--    intero. reward resta un riassunto da leggere, i premi veri sono sotto.
alter table mission_text add column name text;

-- 4. Gli oggetti dei premi come li conosce il gioco: (tipo, id), con il
--    nome che sta nella tabella di quel tipo. Si tengono a parte dalle
--    missioni perche' sono pochi e ripetuti (lo stesso Dragon Stone in
--    migliaia di premi). reward_item e' l'icona, quando ne abbiamo una
--    (sono i 29 drop del wiki): un nome uguale, non un'ipotesi. card_id
--    quando il premio e' una carta che abbiamo.
create table game_item (
  item_type  text    not null,               -- 'Point::Stone', 'TrainingItem', 'Card'...
  item_id    integer not null,
  reward_item_slug text references reward_item on delete set null,
  card_id    bigint  references card on delete set null,
  primary key (item_type, item_id)
);

create table game_item_text (
  item_type  text    not null,
  item_id    integer not null,
  locale     text    not null references locale on delete cascade,
  name       text    not null,
  source     text_source not null default 'official',
  primary key (item_type, item_id, locale),
  foreign key (item_type, item_id) references game_item on delete cascade
);

-- quantity e' il totale: per i Point (dragon stone, zeni) il gioco scrive
-- un pacchetto (points.amount) per un numero di volte, e qui sono gia'
-- moltiplicati. seq e' l'ordine del gioco (mission_rewards.id).
create table mission_reward (
  mission_id bigint   not null references mission on delete cascade,
  seq        smallint not null,
  item_type  text     not null,
  item_id    integer  not null,
  quantity   bigint   not null check (quantity > 0),
  primary key (mission_id, seq),
  foreign key (item_type, item_id) references game_item
);
create index mission_reward_by_item on mission_reward (item_type, item_id);
