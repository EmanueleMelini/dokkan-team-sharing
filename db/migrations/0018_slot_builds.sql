-- =====================================================================
--  Le build degli slot: Hidden Potential ed equipaggiamento, opzionali,
--  dal builder e congelate con la versione del clear.
--
--  Cosa offre il gioco (datamine, Nicholas1006/dokkan-backend):
--    - ogni carta ha una tavola del Hidden Potential con QUATTRO percorsi
--      (potential_squares.route 0-3) che si sbloccano con i doppioni;
--      la stella arcobaleno e' la tavola completa. Il gioco stesso parla
--      di percorsi ("unlocking two Hidden Potential routes"). Per questo
--      il livello e' "quanti percorsi completati", 0-4, e non le stelle
--      0-5 del 0001, che il gioco non ha;
--    - alcune caselle fanno scegliere un'abilita' (Combo Attack, Critical
--      Hit, Evasion, ...: potential_skills). Le scelte sono molte e
--      cambiano da carta a carta, quindi il "percorso" resta un testo
--      breve: il builder suggerisce i nomi del gioco, non li impone;
--    - l'equipaggiamento sono le Skill Orb (equipment_skill_items), con
--      nome inglese e grado bronzo/argento/oro: sono gia' la forma di
--      equipment(id, tier) + equipment_text del 0001, e fino a tre per
--      carta, come slot_equipment.slot_no 1-3. Chi puo' montare quale
--      sfera (esclusive per carta, categoria, tipo) il database non lo
--      controlla: il dato c'e' (equipment_skill_limitations) ma non lo
--      importiamo ancora.
--
--  Forma della build nel payload, per slot, tutta opzionale:
--    "build": { "hp_routes": 0-4|null, "hp_path": text|null (40),
--               "note": text|null (200),
--               "equipment": [id|null, id|null, id|null] (posizione = slot) }
--  Una build senza niente dentro e' come nessuna build: non si salva.
-- =====================================================================


-- ---------------------------------------------------------------------
--  1. I dati del gioco: gradi delle sfere e abilita' del potenziale
-- ---------------------------------------------------------------------

-- 1 bronzo, 2 argento, 3 oro: l'ordine del gioco (grade)
alter table equipment
  add constraint equipment_tier_range check (tier between 1 and 3);

-- Le abilita' del Hidden Potential, solo per suggerire il percorso.
create table potential_skill (
  id    smallint primary key,
  name  text not null
);


-- ---------------------------------------------------------------------
--  2. slot_build: percorsi al posto delle stelle, e i limiti dei testi
--
--  Le righe esistenti (solo la fixture dei test, in sviluppo nessuna)
--  passano da stelle a percorsi: l'arcobaleno (5) e' la tavola completa.
-- ---------------------------------------------------------------------

alter table slot_build rename column hp_stars to hp_routes;
alter table slot_build drop constraint slot_build_hp_stars_check;
update slot_build set hp_routes = least(hp_routes, 4) where hp_routes > 4;
alter table slot_build
  add constraint slot_build_hp_routes_check check (hp_routes between 0 and 4),
  add constraint slot_build_hp_path_len check (char_length(hp_path) <= 40),
  add constraint slot_build_note_len check (char_length(note) <= 200);


-- ---------------------------------------------------------------------
--  3. Le build congelate con la versione
--
--  Come clear_lineup_card (0016): per ogni versione e ogni assetto, la
--  build di ogni slot che ne ha una. Una revisione riscrive il team, non
--  queste righe: le versioni vecchie tengono le loro build.
-- ---------------------------------------------------------------------

create table clear_lineup_build (
  version_id      uuid     not null,
  seq             smallint not null,
  rotation_index  smallint not null,
  pos             smallint not null,
  hp_routes       smallint check (hp_routes between 0 and 4),
  hp_path         text check (char_length(hp_path) <= 40),
  note            text check (char_length(note) <= 200),
  primary key (version_id, seq, rotation_index, pos),
  foreign key (version_id, seq, rotation_index, pos)
    references clear_lineup_card on delete cascade
);

create table clear_lineup_equipment (
  version_id      uuid     not null,
  seq             smallint not null,
  rotation_index  smallint not null,
  pos             smallint not null,
  slot_no         smallint not null check (slot_no between 1 and 3),
  equipment_id    bigint   not null references equipment,
  primary key (version_id, seq, rotation_index, pos, slot_no),
  foreign key (version_id, seq, rotation_index, pos)
    references clear_lineup_build on delete cascade
);
create index clear_lineup_equipment_by_item on clear_lineup_equipment (equipment_id);

-- Lo stesso patto (e la stessa funzione) di clear_lineup e
-- clear_lineup_card: scritte con la versione, mai modificate, cancellate
-- solo in cascata con lei.
create trigger clear_lineup_build_frozen
before insert or update or delete on clear_lineup_build
for each row execute function clear_lineup_is_frozen();

create trigger clear_lineup_equipment_frozen
before insert or update or delete on clear_lineup_equipment
for each row execute function clear_lineup_is_frozen();


-- ---------------------------------------------------------------------
--  4. La validazione delle build
--
--  submit_clear_from_builder e revise_clear_from_builder (0016) restano
--  come sono: chiamano builder_check_payload, builder_write_team e
--  builder_freeze_lineups per nome. Quelle del 0016 si rinominano e le
--  nuove le chiamano prima di fare la loro parte, cosi' le regole del
--  0016 restano scritte una volta sola.
-- ---------------------------------------------------------------------

alter function builder_check_payload(jsonb) rename to builder_check_payload_0016;
alter function builder_write_team(uuid, jsonb) rename to builder_write_team_0016;
alter function builder_freeze_lineups(uuid, uuid) rename to builder_freeze_lineups_0016;

-- Vero se la build dice qualcosa. Una build tutta vuota non si salva:
-- per chi legge il clear e' identica a nessuna build.
create or replace function builder_build_present(b jsonb)
returns boolean language sql immutable as $fn$
  select coalesce(jsonb_typeof(b) = 'object' and (
       coalesce(jsonb_typeof(b->'hp_routes'), 'null') <> 'null'
    or nullif(btrim(coalesce(b->>'hp_path', '')), '') is not null
    or nullif(btrim(coalesce(b->>'note', '')), '') is not null
    or (jsonb_typeof(b->'equipment') = 'array'
        and exists (select 1 from jsonb_array_elements(b->'equipment') e
                    where jsonb_typeof(e) <> 'null'))), false);
$fn$;

create or replace function builder_check_build(p_seq int, b jsonb)
returns void language plpgsql stable as $fn$
declare v_routes bigint; v_path text; v_note text; e jsonb; v_id bigint;
begin
  if b is null or jsonb_typeof(b) = 'null' then return; end if;
  if jsonb_typeof(b) <> 'object' then
    perform builder_fail('builder_build', format('build non valida nell''assetto %s', p_seq));
  end if;

  if coalesce(jsonb_typeof(b->'hp_routes'), 'null') <> 'null' then
    v_routes := builder_int(b->'hp_routes');
    if v_routes is null or v_routes not between 0 and 4 then
      perform builder_fail('builder_build_routes',
        format('percorsi del Hidden Potential da 0 a 4 nell''assetto %s', p_seq));
    end if;
  end if;
  v_path := builder_text(b->'hp_path', 'builder_build_path');
  if char_length(v_path) > 40 then
    perform builder_fail('builder_build_path', format('percorso oltre i 40 caratteri nell''assetto %s', p_seq));
  end if;
  v_note := builder_text(b->'note', 'builder_build_note');
  if char_length(v_note) > 200 then
    perform builder_fail('builder_build_note', format('nota della build oltre i 200 caratteri nell''assetto %s', p_seq));
  end if;

  if coalesce(jsonb_typeof(b->'equipment'), 'null') <> 'null' then
    if jsonb_typeof(b->'equipment') <> 'array' or jsonb_array_length(b->'equipment') > 3 then
      perform builder_fail('builder_build_equipment', format('al massimo tre sfere per carta nell''assetto %s', p_seq));
    end if;
    for e in select * from jsonb_array_elements(b->'equipment') loop
      continue when jsonb_typeof(e) = 'null';   -- uno slot lasciato vuoto
      v_id := builder_int(e);
      if v_id is null or not exists (select 1 from equipment where id = v_id) then
        perform builder_fail('builder_build_equipment',
          format('sfera inesistente nell''assetto %s: %s', p_seq, e));
      end if;
    end loop;
  end if;
end $fn$;

create or replace function builder_check_payload(p jsonb)
returns void language plpgsql stable as $fn$
declare s jsonb;
begin
  -- prima tutto il 0016: dopo, assetti e slot hanno la forma giusta
  perform builder_check_payload_0016(p);
  for i in 1 .. jsonb_array_length(p->'lineups') loop
    for s in select * from jsonb_array_elements(p->'lineups'->(i - 1)->'slots') loop
      perform builder_check_build(i, s->'build');
    end loop;
  end loop;
end $fn$;


-- ---------------------------------------------------------------------
--  5. Dal payload al team, e dal team alla versione
-- ---------------------------------------------------------------------

create or replace function builder_write_team(p_team uuid, p jsonb)
returns uuid language plpgsql as $fn$
declare v_first uuid;
begin
  v_first := builder_write_team_0016(p_team, p);
  -- l'assetto n del team e' l'elemento n-1 di lineups (0016)
  insert into slot_build (lineup_id, rotation_index, pos, hp_routes, hp_path, note)
  select l.id, (s->>'rot')::smallint, (s->>'pos')::smallint,
         builder_int(s->'build'->'hp_routes')::smallint,
         builder_text(s->'build'->'hp_path', 'builder_build_path'),
         builder_text(s->'build'->'note', 'builder_build_note')
  from lineup l
  cross join lateral jsonb_array_elements(p->'lineups'->(l.seq - 1)->'slots') s
  where l.team_id = p_team and builder_build_present(s->'build');

  -- la posizione nell'array e' lo slot della sfera: [null, 812] = slot 2
  insert into slot_equipment (lineup_id, rotation_index, pos, slot_no, equipment_id)
  select l.id, (s->>'rot')::smallint, (s->>'pos')::smallint, e.n::smallint, builder_int(e.v)
  from lineup l
  cross join lateral jsonb_array_elements(p->'lineups'->(l.seq - 1)->'slots') s
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(s->'build'->'equipment') = 'array'
         then s->'build'->'equipment' else '[]'::jsonb end) with ordinality e(v, n)
  where l.team_id = p_team and jsonb_typeof(e.v) <> 'null';
  return v_first;
end $fn$;

-- Copia nella versione anche le build. Una sfera senza riga in
-- slot_build (un team non scritto dal builder) si porta dietro una build
-- vuota: clear_lineup_equipment la vuole come padre.
create or replace function builder_freeze_lineups(p_version uuid, p_team uuid)
returns void language sql as $fn$
  select builder_freeze_lineups_0016(p_version, p_team);
  insert into clear_lineup_build (version_id, seq, rotation_index, pos, hp_routes, hp_path, note)
  select p_version, l.seq, ls.rotation_index, ls.pos, b.hp_routes, b.hp_path, b.note
  from lineup l
  join lineup_slot ls on ls.lineup_id = l.id
  left join slot_build b
    on (b.lineup_id, b.rotation_index, b.pos) = (ls.lineup_id, ls.rotation_index, ls.pos)
  where l.team_id = p_team
    and (b.lineup_id is not null or exists (
      select 1 from slot_equipment e
      where (e.lineup_id, e.rotation_index, e.pos) = (ls.lineup_id, ls.rotation_index, ls.pos)));
  insert into clear_lineup_equipment (version_id, seq, rotation_index, pos, slot_no, equipment_id)
  select p_version, l.seq, e.rotation_index, e.pos, e.slot_no, e.equipment_id
  from lineup l join slot_equipment e on e.lineup_id = l.id
  where l.team_id = p_team;
$fn$;


-- ---------------------------------------------------------------------
--  6. Lo snapshot dell'assetto #1, con le build nuove
--
--  Il corpo del 0002 legge sb.hp_stars, che non c'e' piu'. Le sfere ora
--  dicono anche lo slot: [null, 812] e [812] non sono la stessa build.
-- ---------------------------------------------------------------------

create or replace function take_lineup_snapshot(p_lineup uuid)
returns jsonb language sql stable as $fn$
  select jsonb_build_object(
    'lineup_id',  l.id,
    'lineup_seq', l.seq,
    'label',      l.label,
    'note',       l.note,
    'taken_at',   now(),
    'slots', (
      select jsonb_agg(
        jsonb_build_object(
          'rot',        ls.rotation_index,
          'pos',        ls.pos,
          'role',       ls.role,
          'card_id',    ls.card_id,
          'hp_routes',  sb.hp_routes,
          'hp_path',    sb.hp_path,
          'build_note', sb.note,
          'slot_note',  ls.note,
          'orbs', (
            select jsonb_agg(o.orb_name order by o.slot_no)
            from slot_orb o
            where (o.lineup_id, o.rotation_index, o.pos)
                = (ls.lineup_id, ls.rotation_index, ls.pos)
          ),
          'equipment', (
            select jsonb_agg(jsonb_build_object('slot', e.slot_no, 'id', e.equipment_id)
                             order by e.slot_no)
            from slot_equipment e
            where (e.lineup_id, e.rotation_index, e.pos)
                = (ls.lineup_id, ls.rotation_index, ls.pos)
          )
        ) order by ls.rotation_index, ls.pos
      )
      from lineup_slot ls
      left join slot_build sb
        on (sb.lineup_id, sb.rotation_index, sb.pos)
         = (ls.lineup_id, ls.rotation_index, ls.pos)
      where ls.lineup_id = l.id
    )
  )
  from lineup l where l.id = p_lineup;
$fn$;
