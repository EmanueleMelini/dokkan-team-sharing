-- La fixture dei test: un evento finto (5001), carte e categorie finte,
-- tre utenti. Le lingue e le regioni non stanno qui ma nella migrazione
-- 0009, perché servono a ogni database e non solo ai test.

insert into category (id) values (1),(2),(3);
insert into category_text (category_id,locale,name,source) values
 (1,'en','Wicked Bloodline','official'), (1,'ja','邪悪な血統','official'),
 (2,'en','Pure Saiyans','official'),     (2,'ja','純粋サイヤ人','official'),
 (3,'en','Realm of Gods','official'),    (3,'ja','神の領域','official');

insert into card (id,type,class,rarity,hp,atk,def,imported_from) values
 (1001,'AGL','Super','LR',22000,18000,12000,'dataset'),
 (1002,'INT','Extreme','LR',21000,19000,11000,'dataset'),
 (1003,'STR','Super','UR',15000,13000,9000,'dataset'),
 (1004,'TEQ','Super','UR',16000,12000,10000,'dataset'),
 (1005,'PHY','Super','LR',20000,17000,12500,'dataset'),
 (1006,'AGL','Super','LR',21500,18500,12800,'dataset'),
 (1007,'STR','Super','LR',20500,18800,11900,'dataset'),
 (1008,'TEQ','Extreme','LR',21800,18200,12200,'dataset'),
 (1009,'INT','Extreme','LR',20900,17600,12000,'dataset'),
 (1010,'AGL','Super','LR',23000,20000,13500,'datamine');

insert into card_text (card_id,locale,name,epithet,source) values
 (1001,'en','Vegeta','Pride of the Saiyan Prince','official'),
 (1002,'en','Frieza (Final Form)','Supreme Ruler''s Vicious Power','official'),
 (1003,'en','Goku','Determined to Fight','official'),
 (1004,'en','Piccolo','Exceptional Wisdom','official'),
 (1005,'en','Gohan','Unyielding Dedication','official'),
 (1006,'en','Trunks','Bonds of Father and Son','official'),
 (1007,'en','Bardock','Fated Rebellion','official'),
 (1008,'en','Cell (Perfect Form)','Ultimate Perfection','official'),
 (1009,'en','Majin Buu','Chaotic Appetite','official'),
 -- una carta ancora solo su Japan: giapponese ufficiale, inglese tradotto da noi
 (1001,'ja','ベジータ','サイヤ人の王子の誇り','official'),
 (1002,'ja','フリーザ（最終形態）','最強支配者の凶悪なる力','official'),
 -- carta ancora esclusiva Japan: il giapponese è ufficiale,
 -- l'inglese è la NOSTRA traduzione, e il sito lo dichiara
 (1010,'ja','孫悟空（身勝手の極意）','極限の境地','official'),
 (1010,'en','Goku (Ultra Instinct)','The Ultimate Realm','community');

-- la stessa carta esce prima su Japan: una carta, due date
insert into card_release (card_id,reg,released_at)
select id,'japan', date '2026-01-15' from card;             -- Japan, sei mesi avanti
insert into card_release (card_id,reg,released_at)
select id,'global', date '2026-07-15' from card where id <> 1010;  -- 1010 non e' ancora uscita su Global

-- tutti Wicked Bloodline tranne 1003
insert into card_category (card_id,category_id) select id, 1 from card where id not in (1003,1010);

insert into event (id,kind,imported_from) values (5001,'challenge','manual');
insert into event_text (event_id,locale,name,official_description,source) values
 (5001,'en','Ultimate Red Zone: Frieza','Face Frieza in an unprecedented battle.','official'),
 (5001,'ja','超激戦 レッドゾーン フリーザ','前代未聞の戦いでフリーザに挑む。','official');

-- Global: una run chiusa e una in corso. Japan: una run in corso che si
-- sovrappone a quella Global — legittimo, sono regioni diverse.
insert into event_run (event_id,reg,starts_at,ends_at) values
 (5001,'global', now() - interval '200 days', now() - interval '190 days'),
 (5001,'global', now() - interval '3 days',   now() + interval '4 days'),
 (5001,'japan',  now() - interval '5 days',   now() + interval '2 days');

insert into stage (event_id,seq) values (5001,1),(5001,2),(5001,3);
insert into stage_text (stage_id,locale,name)
select s.id,'en', (array['The Tyrant Returns','Final Form','Maximum Power'])[s.seq]
from stage s where s.event_id=5001;
insert into stage_text (stage_id,locale,name)
select s.id,'ja', (array['暴君の再来','最終形態','最大パワー'])[s.seq]
from stage s where s.event_id=5001;

insert into stage_tier (stage_id,event_id,difficulty,sta_cost,ll_rate,zeni,exp)
select s.id, s.event_id, 'z_hard', 30, 1.6, 6000, 45000 from stage s where s.event_id=5001;
insert into stage_tier (stage_id,event_id,difficulty,sta_cost,ll_rate,zeni,exp)
select s.id, s.event_id, 'ultra', 45, 2.0, 12000, 90000 from stage s where s.event_id=5001 and s.seq=3;

insert into stage_tier_text (stage_tier_id,locale,boss_note)
select st.id,'en','3-phase boss: seals supers below 50% HP.'
from stage_tier st join stage s on s.id=st.stage_id where s.event_id=5001 and st.difficulty='ultra';

insert into mission (event_id,run_id,seq)
select 5001, (select id from event_run where event_id=5001 and reg='global' order by starts_at desc limit 1), 1;
insert into mission_text (mission_id,locale,description,reward)
select m.id,'en','Clear Stage 3 (Ultra) without items','x5 Dragon Stones' from mission m;

insert into app_user (id,handle,email,reg,locale) values
 ('11111111-1111-1111-1111-111111111111','ematanoia','a@example.com','global','en'),
 ('22222222-2222-2222-2222-222222222222','wickedmain','b@example.com','global','en'),
 ('33333333-3333-3333-3333-333333333333','whalepuller','c@example.com','global','en');
