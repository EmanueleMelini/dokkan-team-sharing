-- =====================================================================
--  Da dove viene una ricorrenza, e quale evento del gioco e' un evento
--  nostro.
--
--  Fin qui ends_at_known faceva due mestieri: "la fine e' nota" e "questa
--  run l'ha scritta il wiki, il reimport la puo' rifare". Con le finestre
--  dal database del gioco i due si separano: una run del gioco puo' avere
--  la fine NON nota (missioni che scadono nel 2038, vedi load-windows) e
--  non per questo e' del wiki. Quindi la provenienza diventa una colonna.
--
--  Precedenza: manual > game > wiki. Ogni import tocca solo le sue:
--    wiki    load-events: la prima uscita, fine mai nota
--    game    load-windows: la finestra dal datamine Global
--    manual  set-event-window, la fixture, chi inserisce a mano
-- =====================================================================

alter table event_run add column source text;

-- Oggi le uniche run con la fine nota le ha scritte set-event-window (o
-- la fixture), e tutte le altre il wiki.
update event_run set source = case when ends_at_known then 'manual' else 'wiki' end;

alter table event_run
  alter column source set not null,
  -- chi inserisce senza dirlo e' una persona o un test, non un import:
  -- 'manual' e' anche il valore che nessun import tocca
  alter column source set default 'manual',
  add constraint run_source check (source in ('wiki', 'manual', 'game')),
  -- il wiki non da' mai la fine: una run del wiki "chiusa" dal gioco ha
  -- ends_at (il limite superiore) ma resta con la fine non nota
  add constraint run_wiki_end_unknown check (source <> 'wiki' or not ends_at_known);


-- Quale area (evento normale) o z_battle_stage (EZA) del database Global
-- corrisponde a un nostro evento. Gli eventi hanno il pageid del wiki come
-- id, e il gioco non lo conosce: questa tabella e' il ponte, ricostruito a
-- ogni import da load-windows. Un'area appartiene al massimo a un evento
-- (la chiave primaria); un evento puo' averne piu' d'una (le riedizioni
-- con un id nuovo e le stesse quest).
create table event_game_ref (
  event_id    bigint not null references event on delete cascade,
  game_kind   text   not null check (game_kind in ('area', 'z_battle_stage')),
  game_id     int    not null,
  -- la chiave che ha deciso (banner, name, stage, title, boss+news,
  -- sibling) e tutte quelle che confermano: serve a rivedere un caso
  via         text   not null,
  keys        text[] not null,
  confidence  text   not null check (confidence in ('high', 'medium')),
  primary key (game_kind, game_id)
);
create index event_game_ref_by_event on event_game_ref (event_id);
