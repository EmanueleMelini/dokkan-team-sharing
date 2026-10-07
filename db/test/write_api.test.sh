#!/usr/bin/env bash
# Prova invio, revisione, voti e commenti sul modello versionato.
# Presuppone un database gia' costruito da db/test/schema.test.sh, sullo
# stesso database di test (vedi common.sh), mai su quello di sviluppo.
set -uo pipefail
. "$(dirname "$0")/common.sh"
echo "  database dei test: $TEST_TARGET"
conferma_psql

U=11111111-1111-1111-1111-111111111111   # ematanoia, proprietario del team A
V=22222222-2222-2222-2222-222222222222   # wickedmain, proprietario del team B
LIN_A=a1a1a1a1-0000-0000-0000-000000000001
LIN_A2=a2a2a2a2-0000-0000-0000-000000000002   # secondo assetto del team A, creato qui sotto
LIN_B2=b2b2b2b2-0000-0000-0000-000000000002   # assetto incompleto
eq "la fixture: i due autori" "select count(*) from app_user where id in ('$U','$V')" 2
# la run e lo stage sono dello stesso evento, come vogliono le FK di clear
RUN=$(q "select id from event_run where event_id=5001 and reg='global' and starts_at<=now()
         order by starts_at desc limit 1")
TIER=$(q "select st.id from stage_tier st join stage s on s.id=st.stage_id
          where s.event_id=5001 and s.seq=3 and st.difficulty='ultra'")
# La ricorrenza futura se la crea da se': prima la prendeva da quella che
# schema.test.sh lascia come effetto collaterale, e senza quella il
# rifiuto "non ancora iniziata" passava per un errore di sintassi.
RUN_FUT=$(q "insert into event_run (event_id,reg,starts_at,ends_at)
             values (5001,'global', now()+interval '60 days', now()+interval '67 days') returning id")
need RUN TIER RUN_FUT

# un secondo assetto completo del team A: stessa squadra, un pezzo scambiato
prep "insert into lineup (id,team_id,seq,label,note) values
  ('$LIN_A2','aaaaaaaa-0000-0000-0000-000000000001',3,'turni corretti','Scambio il tank.');
 insert into lineup_slot (lineup_id,rotation_index,pos,card_id,role) values
  ('$LIN_A2',1,1,1001,'leader'),('$LIN_A2',1,2,1002,'member'),
  ('$LIN_A2',2,1,1008,'member'),('$LIN_A2',2,2,1004,'member'),
  ('$LIN_A2',3,1,1005,'member'),('$LIN_A2',3,2,1006,'member'),
  ('$LIN_A2',3,3,1001,'friend');"

echo "invio: intestazione + versione 1"
C=$(q "select submit_clear('$U'::uuid, $RUN, $TIER, '$LIN_A'::uuid, false,false,14::smallint,'Primo tentativo.','en')")
need C
V1=$(q "select id from clear_version where clear_id='$C' and is_current")
need V1
eq "una intestazione"           "select count(*) from clear where id='$C'" 1
eq "una versione, la numero 1"  "select seq from clear_version where clear_id='$C'" 1
eq "ed e' la corrente"          "select is_current::text from clear_version where id='$V1'" true
eq "sette righe cercabili"      "select count(*) from clear_card where version_id='$V1'" 7
eq "punteggio a zero"           "select score from clear_version where id='$V1'" 0
eq "regione dedotta dalla run"  "select reg::text from clear_current where id='$C'" global
eq "nessuna revisione"          "select revised::text from clear_reputation where clear_id='$C'" false

echo "l'invariante: snapshot e righe della VERSIONE dicono la stessa cosa"
eq "differenza vuota in un verso" \
  "select count(*) from (
     select (s->>'rot')::int r,(s->>'pos')::int p,(s->>'card_id')::bigint c,s->>'role' ro
       from clear_version, jsonb_array_elements(lineup_snapshot->'slots') s where id='$V1'
     except
     select rotation_index,pos,card_id,role::text from clear_card where version_id='$V1') d" 0
eq "e vuota anche nell'altro" \
  "select count(*) from (
     select rotation_index,pos,card_id,role::text from clear_card where version_id='$V1'
     except
     select (s->>'rot')::int,(s->>'pos')::int,(s->>'card_id')::bigint,s->>'role'
       from clear_version, jsonb_array_elements(lineup_snapshot->'slots') s where id='$V1') d" 0

echo "LO SCENARIO: la versione 1 prende molti voti, poi l'autore corregge"
prep "insert into app_user (handle,email)
      select 'votante'||g, 'v'||g||'@example.com' from generate_series(1,12) g"
prep "do \$\$ declare u record; begin
        for u in select id from app_user where handle like 'votante%' loop
          perform vote_clear(u.id, '$V1'::uuid, 1::smallint);
        end loop; end \$\$;"
prep "select add_clear_comment((select id from app_user where handle='votante1'),
                               '$V1'::uuid, 'Great clear, which rotation?', 'en')"
eq "la v1 ha 12 voti"           "select score from clear_version where id='$V1'" 12
eq "e un commento"              "select count(*) from clear_comment where version_id='$V1'" 1

C_V2=$(q "select revise_clear('$U'::uuid,'$C'::uuid,'$LIN_A2'::uuid,
          'Avevo sbagliato i turni: erano 11, non 14.', false,false,11::smallint,
          'Primo tentativo, turni corretti.','en')")
need C_V2
eq "ora ci sono due versioni"   "select count(*) from clear_version where clear_id='$C'" 2
eq "una sola corrente"          "select count(*) from clear_version where clear_id='$C' and is_current" 1
eq "ed e' la 2"                 "select seq from clear_version where id='$C_V2'" 2
eq "la v1 tiene i suoi 12 voti" "select score from clear_version where id='$V1'" 12
eq "la v2 parte da zero"        "select score from clear_version where id='$C_V2'" 0
eq "il commento resta sulla v1" "select count(*) from clear_comment where version_id='$V1'" 1
eq "la v2 non ne ha"            "select count(*) from clear_comment where version_id='$C_V2'" 0
eq "il sito mostra la v2"       "select version_seq::text||' con '||score||' voti' from clear_current where id='$C'" '2 con 0 voti'
eq "e sa che c'e' una storia"   "select current_score||' su questa, '||lifetime_score||' in tutto, '||versions||' versioni'
                                 from clear_reputation where clear_id='$C'" '0 su questa, 12 in tutto, 2 versioni'
eq "con il motivo scritto"      "select change_note from clear_version where id='$C_V2'" 'Avevo sbagliato i turni: erano 11, non 14.'
eq "i turni corretti"           "select turns from clear_current where id='$C'" 11
eq "le prove sono passate alla v2" \
  "select count(*) from clear_proof where version_id='$C_V2'" 0
eq "sette righe nuove per la v2" "select count(*) from clear_card where version_id='$C_V2'" 7
eq "e quelle della v1 restano"   "select count(*) from clear_card where version_id='$V1'" 7

echo "il meta conta solo le versioni correnti"
eq "la v1 non entra nelle statistiche" \
  "select count(*) from clear_card cc
    join clear_version v on v.id=cc.version_id
   where v.id='$V1' and v.is_current" 0

echo "il congelamento di una versione"
t "cambiare i turni della v1"     "update clear_version set turns=3 where id='$V1'" \
  fail 'una versione non si modifica'
t "cambiare lo snapshot"          "update clear_version set lineup_snapshot='{}'::jsonb where id='$V1'" \
  fail 'una versione non si modifica'
t "cambiare la nota"              "update clear_version set note='riscritta' where id='$V1'" \
  fail 'una versione non si modifica'
t "cambiare il motivo"            "update clear_version set change_note='altro' where id='$C_V2'" \
  fail 'una versione non si modifica'
t "cambiare il numero di versione" "update clear_version set seq=9 where id='$C_V2'" \
  fail 'una versione non si modifica'
echo "  ...ma cio' che deve restare scrivibile funziona:"
t "il trigger dei voti scrive"    "select vote_clear('$V'::uuid,'$C_V2'::uuid,1::smallint)" ok
eq "e il punteggio e' cambiato"   "select score from clear_version where id='$C_V2'" 1

echo "il congelamento dell'intestazione"
t "cambiare la difficolta'"       "update clear set stage_tier_id=1 where id='$C'" \
  fail 'intestazione di un clear non cambia'
t "cambiare l'autore"             "update clear set author_id='$V' where id='$C'" \
  fail 'intestazione di un clear non cambia'
t "la moderazione puo' nascondere" "update clear set status='hidden' where id='$C'" ok
prep "update clear set status='published' where id='$C'"

echo "quello che la revisione deve rifiutare"
t "revisione senza motivo"        "select revise_clear('$U'::uuid,'$C'::uuid,'$LIN_A'::uuid,'')" \
  fail 'una revisione deve dire perch'
t "revisione del clear di un altro" "select revise_clear('$V'::uuid,'$C'::uuid,'$LIN_A'::uuid,'mio ora')" \
  fail 'clear inesistente o non tuo'
t "revisione con assetto non tuo" "select revise_clear('$U'::uuid,'$C'::uuid,'b1b1b1b1-0000-0000-0000-000000000001'::uuid,'x')" \
  fail 'assetto inesistente o non tuo'
t "due versioni correnti a forza" "update clear_version set is_current=true where id='$V1'" \
  fail 'clear_one_current'

echo "quello che l'invio deve rifiutare"
t "assetto di un altro utente"    "select submit_clear('$U'::uuid, $RUN, $TIER, 'b1b1b1b1-0000-0000-0000-000000000001'::uuid)" \
  fail 'assetto inesistente o non tuo'
t "assetto incompleto"            "select submit_clear('$V'::uuid, $RUN, $TIER, '$LIN_B2'::uuid)" \
  fail 'assetto incompleto'
t "ricorrenza non ancora iniziata" "select submit_clear('$U'::uuid, $RUN_FUT, $TIER, '$LIN_A'::uuid)" \
  fail 'non ancora iniziata'
t "accorciatore bit.ly"           "select submit_clear('$U'::uuid, $RUN, $TIER, '$LIN_A'::uuid,false,false,null,null,null,
                                    '[{\"kind\":\"screenshot\",\"url\":\"https://bit.ly/abc\"}]'::jsonb)" \
  fail 'host non ammesso'
t "url che non e' un url"         "select submit_clear('$U'::uuid, $RUN, $TIER, '$LIN_A'::uuid,false,false,null,null,null,
                                    '[{\"kind\":\"screenshot\",\"url\":\"chissa\"}]'::jsonb)" \
  fail 'link non valido'
t "turni a zero"                  "select submit_clear('$U'::uuid, $RUN, $TIER, '$LIN_A'::uuid,false,false,0::smallint)" \
  fail 'clear_version_turns_check'

echo "host: riconosciuti, sconosciuti, rifiutati"
CH=$(q "select submit_clear('$V'::uuid, $RUN, $TIER, 'b1b1b1b1-0000-0000-0000-000000000001'::uuid,
        true,true,7::smallint,'Con prove.','en',
        '[{\"kind\":\"video\",\"url\":\"https://youtu.be/aaa\"},
          {\"kind\":\"screenshot\",\"url\":\"https://qualchesito.example/x.png\"}]'::jsonb)")
need CH
VH=$(q "select version_id from clear_current where id='$CH'")
need VH
eq "youtube riconosciuto"       "select provider from clear_proof where version_id='$VH' and kind='video'" youtube
eq "host sconosciuto accettato" "select coalesce(provider,'(vuoto)') from clear_proof where version_id='$VH' and kind='screenshot'" '(vuoto)'

echo "le prove: aggiunta libera, rimozione finche' nessuno ha votato"
P=$(q "select add_clear_proof('$V'::uuid,'$VH'::uuid,'screenshot','https://i.imgur.com/zzz.png')")
need P
eq "prova aggiunta"             "select count(*) from clear_proof where version_id='$VH'" 3
t "toglierla, nessun voto"      "select remove_clear_proof('$V'::uuid,'$P'::uuid)" ok
eq "tolta"                      "select count(*) from clear_proof where version_id='$VH'" 2
P2=$(q "select add_clear_proof('$V'::uuid,'$VH'::uuid,'screenshot','https://i.imgur.com/www.png')")
need P2
prep "select vote_clear('$U'::uuid,'$VH'::uuid,1::smallint)"
t "toglierla dopo i voti"       "select remove_clear_proof('$V'::uuid,'$P2'::uuid)" \
  fail 'ricevuto voti'
t "aggiungere al clear di un altro" "select add_clear_proof('$U'::uuid,'$VH'::uuid,'video','https://youtu.be/no')" \
  fail 'versione inesistente o non tua'
t "revisione con le prove portate avanti" \
  "select revise_clear('$V'::uuid,'$CH'::uuid,'b1b1b1b1-0000-0000-0000-000000000001'::uuid,'Nota piu chiara.')" ok
eq "le tre prove sono sulla v2" \
  "select count(*) from clear_proof p join clear_version v on v.id=p.version_id
    where v.clear_id='$CH' and v.is_current" 3

echo "i voti"
t "votare il proprio clear"     "select vote_clear('$V'::uuid,'$VH'::uuid,1::smallint)" \
  fail 'non si vota il proprio clear'
prep "select vote_clear('$U'::uuid,'$VH'::uuid,-1::smallint)"
eq "rivotare aggiorna, non duplica" \
  "select count(*)::text||' voto, punteggio '||(select score from clear_version where id='$VH')
    from clear_vote where version_id='$VH'" '1 voto, punteggio -1'

echo "cancellazione: porta via tutto in cascata"
t "cancellare il clear di un altro" "select delete_clear('$V'::uuid,'$C'::uuid)" \
  fail 'clear inesistente o non tuo'
prep "select delete_clear('$U'::uuid,'$C'::uuid)"
eq "intestazione sparita"       "select count(*) from clear where id='$C'" 0
eq "versioni sparite"           "select count(*) from clear_version where clear_id='$C'" 0
eq "righe sparite"              "select count(*) from clear_card where version_id in ('$V1','$C_V2')" 0
eq "voti spariti"               "select count(*) from clear_vote where version_id in ('$V1','$C_V2')" 0
eq "commenti spariti"           "select count(*) from clear_comment where version_id in ('$V1','$C_V2')" 0

echo "niente e' rimasto sporco"
eq "ogni versione ha 7 righe" \
  "select count(*) from (select version_id from clear_card group by version_id having count(*)<>7) d" 0
eq "ogni versione ha 7 slot nello snapshot" \
  "select count(*) from clear_version where jsonb_array_length(lineup_snapshot->'slots')<>7" 0
eq "ogni clear ha esattamente una versione corrente" \
  "select count(*) from clear c where (select count(*) from clear_version v
    where v.clear_id=c.id and v.is_current)<>1" 0
eq "nessun punteggio fuori sincrono" \
  "select count(*) from clear_version cv where cv.score <>
    (select coalesce(sum(value),0) from clear_vote v where v.version_id=cv.id)" 0

[ "$fails" -eq 0 ] && echo "TUTTO VERDE" || { echo "$fails verifiche rosse"; exit 1; }
