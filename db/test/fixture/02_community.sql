-- ---- tre team, quattro assetti ----
insert into team (id,owner_id,name,note,lang) values
 ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Mixed types, tank on rot 2','Team of convenience, what I had.','en'),
 ('bbbbbbbb-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','Wicked Bloodline full','Pure category, no off-category units.','en'),
 ('cccccccc-0000-0000-0000-000000000003','33333333-3333-3333-3333-333333333333','WB senza banner','Built before the new banner dropped.','en');

insert into lineup (id,team_id,seq,label,note) values
 ('a1a1a1a1-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',1,'assetto unico',null),
 ('b1b1b1b1-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002',1,'fasi 1-2','Parto con il tank in rot 1.'),
 ('b2b2b2b2-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000002',2,'dalla fase 3','Il boss sigilla i super: sposto il damage dealer in rot 1 e tengo il tank per il revive.'),
 ('c1c1c1c1-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000003',1,'assetto unico',null);

-- 7 unità in 2+2+3. Leader e friend possono essere la stessa carta.
insert into lineup_slot (lineup_id,rotation_index,pos,card_id,role) values
 ('a1a1a1a1-0000-0000-0000-000000000001',1,1,1001,'leader'),
 ('a1a1a1a1-0000-0000-0000-000000000001',1,2,1002,'member'),
 ('a1a1a1a1-0000-0000-0000-000000000001',2,1,1003,'member'),
 ('a1a1a1a1-0000-0000-0000-000000000001',2,2,1004,'member'),
 ('a1a1a1a1-0000-0000-0000-000000000001',3,1,1005,'member'),
 ('a1a1a1a1-0000-0000-0000-000000000001',3,2,1006,'member'),
 ('a1a1a1a1-0000-0000-0000-000000000001',3,3,1001,'friend'),

 ('b1b1b1b1-0000-0000-0000-000000000001',1,1,1002,'leader'),
 ('b1b1b1b1-0000-0000-0000-000000000001',1,2,1001,'member'),
 ('b1b1b1b1-0000-0000-0000-000000000001',2,1,1004,'member'),
 ('b1b1b1b1-0000-0000-0000-000000000001',2,2,1005,'member'),
 ('b1b1b1b1-0000-0000-0000-000000000001',3,1,1006,'member'),
 ('b1b1b1b1-0000-0000-0000-000000000001',3,2,1007,'member'),
 ('b1b1b1b1-0000-0000-0000-000000000001',3,3,1002,'friend'),

 ('c1c1c1c1-0000-0000-0000-000000000001',1,1,1001,'leader'),
 ('c1c1c1c1-0000-0000-0000-000000000001',1,2,1002,'member'),
 ('c1c1c1c1-0000-0000-0000-000000000001',2,1,1004,'member'),
 ('c1c1c1c1-0000-0000-0000-000000000001',2,2,1005,'member'),
 ('c1c1c1c1-0000-0000-0000-000000000001',3,1,1008,'member'),
 ('c1c1c1c1-0000-0000-0000-000000000001',3,2,1009,'member'),
 ('c1c1c1c1-0000-0000-0000-000000000001',3,3,1001,'friend');

-- build opzionali, solo su alcuni slot
insert into equipment (id,tier) values (9001,3);
insert into equipment_text (equipment_id,locale,name,effect) values
 (9001,'en','Warrior''s Shield','DEF +15%'), (9001,'ja','戦士の盾','DEF +15%');
insert into slot_build (lineup_id,rotation_index,pos,hp_stars,hp_path,note) values
 ('b1b1b1b1-0000-0000-0000-000000000001',1,1,5,'rainbow, ramo difesa','Senza rainbow non regge la terza fase.'),
 ('b1b1b1b1-0000-0000-0000-000000000001',2,2,4,'ramo attacco',null);
insert into slot_equipment (lineup_id,rotation_index,pos,slot_no,equipment_id) values
 ('b1b1b1b1-0000-0000-0000-000000000001',1,1,1,9001);

-- ---- tre clear, inseriti passando dalla funzione vera ----
-- Usare submit_clear() invece di insert a mano vuol dire che la fixture
-- prova la funzione ogni volta che si carica.

do $fx$
declare
  v_run   bigint;
  v_tier  bigint;
  v_c1 uuid; v_c2 uuid; v_c3 uuid;
  v_v1 uuid; v_v2 uuid; v_v3 uuid;
begin
  select id into v_run from event_run
   where event_id = 5001 and reg = 'global' and starts_at <= now()
   order by starts_at desc limit 1;

  select st.id into v_tier
  from stage_tier st join stage s on s.id = st.stage_id
  where s.event_id = 5001 and s.seq = 3 and st.difficulty = 'ultra';

  -- team misto, con item, una prova su imgur
  v_c1 := submit_clear(
    '11111111-1111-1111-1111-111111111111', v_run, v_tier,
    'a1a1a1a1-0000-0000-0000-000000000001',
    false, false, 14::smallint, 'Cleared with two items, rot 2 struggled.', 'en',
    '[{"kind":"screenshot","url":"https://i.imgur.com/esempio1.png"}]'::jsonb);

  -- Wicked Bloodline puro, no item, nessun KO, prova doppia
  v_c2 := submit_clear(
    '22222222-2222-2222-2222-222222222222', v_run, v_tier,
    'b1b1b1b1-0000-0000-0000-000000000001',
    true, true, 9::smallint, 'No items, no deaths. Rotation swap on phase 3.', 'en',
    '[{"kind":"screenshot","url":"https://i.imgur.com/esempio2.png"},
      {"kind":"video","url":"https://www.youtube.com/watch?v=esempio"}]'::jsonb);

  -- senza unità del banner nuovo, e senza nessuna prova
  v_c3 := submit_clear(
    '33333333-3333-3333-3333-333333333333', v_run, v_tier,
    'c1c1c1c1-0000-0000-0000-000000000001',
    true, false, 12::smallint, 'No units from the new banner.', 'en');

  select id into v_v1 from clear_version where clear_id = v_c1 and is_current;
  select id into v_v2 from clear_version where clear_id = v_c2 and is_current;
  select id into v_v3 from clear_version where clear_id = v_c3 and is_current;

  -- voti: sempre su una versione. Nessun update a mano del punteggio.
  perform vote_clear('11111111-1111-1111-1111-111111111111', v_v2,  1::smallint);
  perform vote_clear('33333333-3333-3333-3333-333333333333', v_v2,  1::smallint);
  perform vote_clear('11111111-1111-1111-1111-111111111111', v_v3,  1::smallint);
  perform vote_clear('22222222-2222-2222-2222-222222222222', v_v1, -1::smallint);

  perform add_clear_comment('33333333-3333-3333-3333-333333333333', v_v2,
    'Which rotation did you swap on phase 3?', 'en');

  -- un link gia' verificato e uno gia' caduto, per provare il controllore
  update clear_proof set is_reachable = true,  last_checked_at = now()
   where provider = 'youtube';
  update clear_proof set is_reachable = false, last_checked_at = now()
   where version_id = v_v1;
end $fx$;

insert into tip (id,author_id,event_id,body,lang) values
 ('ffffffff-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222',5001,
  'On phase 3 the boss seals supers: without a tank in rotation 1 you skip the turn and lose.','en');
insert into tip_vote (tip_id,user_id,value) values
 ('ffffffff-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',1);
