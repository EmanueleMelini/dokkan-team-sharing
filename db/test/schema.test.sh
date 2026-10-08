#!/usr/bin/env bash
# Verifica lo schema: lo ricostruisce da zero con le migrazioni, carica i
# dati di prova, e controlla che i vincoli mordano davvero — e per il
# motivo giusto: ogni rifiuto atteso dice quale vincolo deve scattare.
#
# Gira sul database di test (vedi common.sh), mai su quello di sviluppo.
set -uo pipefail
. "$(dirname "$0")/common.sh"
echo "  database dei test: $TEST_TARGET"

# run.sh ha gia' ricreato il database: rifarlo qui costerebbe solo tempo
if [ "${DB_TEST_SENZA_RESET:-}" != 1 ]; then
  node db/reset.mjs --fixture || exit 1
fi
conferma_psql
echo "schema + dati di prova: OK"

TIER3=$(q "select st.id from stage_tier st join stage s on s.id=st.stage_id where s.event_id=5001 and s.seq=3 and st.difficulty='ultra'")
need TIER3

echo "vincoli che devono respingere:"
t "ricorrenze sovrapposte nella stessa regione" \
  "insert into event_run (event_id,reg,starts_at,ends_at) values (5001,'global', now()-interval '1 day', now()+interval '1 day')" \
  fail 'run_no_overlap'
# Sull'assetto incompleto della fixture, in una sola istruzione: il primo
# leader entra, il secondo no. Prima questa prova scriveva in rotazione 2
# posizione 3, che non esiste — e il rifiuto arrivava da rotation_shape,
# non dall'indice dei leader.
t "due leader nello stesso assetto" \
  "insert into lineup_slot values ('b2b2b2b2-0000-0000-0000-000000000002',1,1,1005,'leader'),
                                  ('b2b2b2b2-0000-0000-0000-000000000002',1,2,1002,'leader')" \
  fail 'lineup_one_leader'
t "terza posizione in rotazione 1" \
  "insert into lineup_slot values ('b2b2b2b2-0000-0000-0000-000000000002',1,3,1003,'member')" \
  fail 'rotation_shape'
t "prova con un url che non e' un link" \
  "insert into clear_proof (version_id,kind,url) select id,'video','non-un-url' from clear_version limit 1" \
  fail 'proof_url_http'
t "prova senza url" \
  "insert into clear_proof (version_id,kind) select id,'video' from clear_version limit 1" \
  fail '23502: .*"url"'
t "lingua non esistente in region_locale" \
  "insert into region_locale (reg,locale,official) values ('global','xx',true)" \
  fail 'region_locale_locale_fkey'
# 0025: ogni tip ha un evento (dal tier, se manca), e il tier e' di quell'evento
t "tip senza bersaglio" \
  "insert into tip (author_id,body) values ('11111111-1111-1111-1111-111111111111','Without any target.')" \
  fail '23502: .*"event_id"'
t "tip con il tier di un altro evento" \
  "insert into event (id,kind) values (5003,'zbattle');
   insert into tip (author_id,event_id,stage_tier_id,body) values ('11111111-1111-1111-1111-111111111111',5003,$TIER3,'Tier of another event.')" \
  fail 'tip_tier_in_event'
t "tip con il solo tier: l'evento si deduce" \
  "insert into tip (author_id,stage_tier_id,body) values ('11111111-1111-1111-1111-111111111111',$TIER3,'Only the tier given.');
   delete from tip where body='Only the tier given.' and event_id=5001" \
  ok
t "tip sotto i 10 caratteri" \
  "insert into tip (author_id,event_id,body) values ('11111111-1111-1111-1111-111111111111',5001,'Too short')" \
  fail 'tip_body_len'
t "tip oltre i 500 caratteri" \
  "insert into tip (author_id,event_id,body) values ('11111111-1111-1111-1111-111111111111',5001,repeat('x',501))" \
  fail 'tip_body_len'
t "tip con un link javascript:" \
  "insert into tip (author_id,event_id,body,link_url) values ('11111111-1111-1111-1111-111111111111',5001,'A link that runs code.','javascript:alert(1)')" \
  fail 'tip_link_ok'
t "tip con un provider senza link" \
  "insert into tip (author_id,event_id,body,link_provider) values ('11111111-1111-1111-1111-111111111111',5001,'A provider alone here.','youtube')" \
  fail 'tip_link_provider'
t "tip con uno stato 'flagged'" \
  "insert into tip (author_id,event_id,body,status) values ('11111111-1111-1111-1111-111111111111',5001,'Flagged is not a status.','flagged')" \
  fail 'tip_status_check'
t "la stessa tip due volte (maiuscole e spazi non contano)" \
  "insert into tip (author_id,event_id,body) values ('22222222-2222-2222-2222-222222222222',5001,
     '  ON PHASE 3 the boss seals supers:   without a tank in rotation 1 you skip the turn and lose. ')" \
  fail 'tip_no_duplicate'
t "voto -1 su una tip" \
  "insert into tip_vote (tip_id,user_id,value) values ('ffffffff-0000-0000-0000-000000000001','33333333-3333-3333-3333-333333333333',-1)" \
  fail 'tip_vote_value_check'
t "finestra evento invertita" \
  "insert into event_run (event_id,reg,starts_at,ends_at) values (5001,'global', now()+interval '400 days', now()+interval '399 days')" \
  fail 'run_window'
t "voto con valore 0" \
  "insert into clear_vote select id,'33333333-3333-3333-3333-333333333333',0,now() from clear_version limit 1" \
  fail 'clear_vote_value_check'
t "lingua inesistente" \
  "insert into card_text (card_id,locale,name,epithet) values (1001,'xx','a','b')" \
  fail 'card_text_locale_fkey'
# il diamante: run e stage devono appartenere allo stesso evento
t "clear con run di un evento e stage di un altro" \
  "insert into event (id,kind) values (5002,'zbattle');
   insert into event_run (id,event_id,reg,starts_at) values (99001,5002,'global',now()-interval '1 day');
   insert into clear (author_id,run_id,stage_tier_id,event_id)
   values ('11111111-1111-1111-1111-111111111111',99001,$TIER3,5001)" \
  fail 'clear_run_id_event_id_fkey'

echo "casi che devono passare:"
# le due righe nella stessa istruzione: now() e' lo stesso, quindi la
# finestra e' identica davvero (prima si inseriva solo quella Japan)
t "stessa finestra su Japan e Global" \
  "insert into event_run (event_id,reg,starts_at,ends_at) values
     (5001,'japan',  now()+interval '30 days', now()+interval '37 days'),
     (5001,'global', now()+interval '30 days', now()+interval '37 days')" ok
t "secondo assetto dello stesso team" \
  "insert into lineup_slot values ('b2b2b2b2-0000-0000-0000-000000000002',1,1,1005,'leader'),('b2b2b2b2-0000-0000-0000-000000000002',1,2,1002,'member')" ok
t "stessa carta come leader e come friend" \
  "insert into lineup (id,team_id,seq) values ('e1e1e1e1-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',2);
   insert into lineup_slot values ('e1e1e1e1-0000-0000-0000-000000000001',1,1,1002,'leader'),('e1e1e1e1-0000-0000-0000-000000000001',3,3,1002,'friend')" ok

echo "il punteggio lo tiene il database:"
V2=$(q "select version_id from clear_current where turns=9")
need V2
eq "due voti positivi" \
  "select score from clear_version where id='$V2'" 2
prep "delete from clear_vote where version_id='$V2' and user_id='33333333-3333-3333-3333-333333333333'"
eq "dopo aver toltone uno" \
  "select score from clear_version where id='$V2'" 1
prep "update clear_vote set value=-1 where version_id='$V2'"
eq "dopo averlo ribaltato" \
  "select score from clear_version where id='$V2'" -1
prep "update clear_vote set value=1 where version_id='$V2'"
eq "nessun punteggio fuori sincrono, su nessuna versione" \
  "select count(*) from clear_version cv where cv.score <> (select coalesce(sum(value),0) from clear_vote v where v.version_id=cv.id)" 0
eq "idem sui tip" \
  "select count(*) from tip t where t.score <> (select coalesce(sum(value),0) from tip_vote v where v.tip_id=t.id)" 0

echo "la regione del clear si deduce, non si copia:"
eq "clear su run Global" "select count(*) from clear_current where reg='global'" 3

echo "prove: link opzionali, e i morti si vedono"
eq "clear con almeno una prova viva" \
  "select count(*) from clear_current where has_proof" 1
eq "clear senza nessuna prova" \
  "select count(*) from clear_current where not has_proof" 2
eq "link marcati caduti" \
  "select count(*) from clear_proof where is_reachable is false" 1
eq "in coda per il controllo (mai visti, non morti)" \
  "select count(*) from clear_proof where last_checked_at is null and is_reachable is not false" 1

echo "lingua: si segue il gioco"
eq "lingue ufficiali su Global" \
  "select string_agg(locale,',' order by locale) from region_locale where reg='global' and official" en
eq "su Japan l'inglese e' una traduzione nostra" \
  "select official::text from region_locale where reg='japan' and locale='en'" false
eq "testi marcati come traduzione della community" \
  "select count(*) from card_text where source='community'" 1
eq "la carta esclusiva Japan non esiste su Global" \
  "select count(*) from card_release where card_id=1010 and reg='global'" 0

[ "$fails" -eq 0 ] && echo "TUTTO VERDE" || { echo "$fails verifiche rosse"; exit 1; }
