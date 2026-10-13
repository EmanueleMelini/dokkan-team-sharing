#!/usr/bin/env bash
# npm run db:test: tutte le verifiche, in fila, su un database di test.
#
#   reset -> schema -> API di scrittura -> account -> id delle carte dal wiki
#   (anche le pagine abbozzate) -> immagini (i job anche senza pagina, la
#   CDN, la provenienza, i limiti di spazio, la cornice delle miniature)
#   -> fonti fresche e copia del
#   datamine -> configurazione di produzione (pool, TLS, cron, IP) ->
#   import dei dati veri (carte del wiki, poi quelle solo nel gioco) -> query
#   delle pagine (lib/queries.ts vero) -> parametri dell'URL (lib/parametri.ts)
#   -> URL degli eventi (lib/urls.ts) -> filtri dei clear (parametri)
#   -> PWA (public/sw.js, offline.html, manifest)
#   -> tag della cache (lib/cache/*)
#   -> builder dei clear (0016, lib/clears*, lib/cards.ts, /api/cards)
#   -> build degli slot (0018, Skill Orb, /api/equipment) -> sfere
#   esclusive (0021)
#   -> settings dell'account (0019: scollegare, cancellare l'account)
#   -> moderazione (0024: segnalazioni, nascosti, sospensioni, registro,
#   letture di /admin, il lato di chi usa il sito) -> tip (0025)
#   -> profili pubblici e cambio di handle (0026) -> temi (0027) ->
#   versione del sito, Global o Japan (0035: i redirect di next.config.ts,
#   lo specchio per le Server Action, l'interruttore, il cookie) e la sua
#   interfaccia (l'interruttore, gli avvisi, i colori nei temi) ->
#   segnaposto delle immagini (lib/segnaposto.ts, i contrasti nei temi)
#   -> menu a scelta (components/scelta: la ricerca, i testi di prima, dove
#   si apre l'elenco, i contrasti, nessun <select> fuori dalla forma nativa)
#   -> notifiche nel sito (0028) e il loro lato app (lib/notify)
#   -> digest email (0029: budget, selezione, disiscrizione) e il suo lato
#   app (lib/notify: token, testi, cron, one-click)
#   -> push del browser (0031: host ammessi, dispositivi, claim, tetti, esiti)
#   e il loro lato app (lib/notify: endpoint, payload, mittente, sw.js, giro)
#   -> attivita' del sito per gli admin (0032: il feed, una push per
#   azione, mai per email)
#   -> carte solo nel gioco (load-game-cards) -> skill delle carte (0022)
#   e la pagina della carta -> filtri dei clear
#   -> finestre degli eventi dal
#   gioco (load-windows) -> eventi creati dal gioco (load-game-events) ->
#   stage delle riedizioni -> classificazione (story, SBR, archivi) ->
#   missioni dal gioco (load-missions) -> aggiornamento settimanale e giro
#   giornaliero delle immagini (weekly-data, daily-images, 0033, 0034)
#
# Gira su dokkan_test, o su TEST_DATABASE_URL se c'e' (il nome deve finire
# per _test): il database di sviluppo non si tocca. Prima db:test lo
# ricreava, e dopo ogni giro di test le carte importate non c'erano piu'.
#
# Un passo che prepara i dati (reset, import) se fallisce ferma tutto: le
# verifiche dopo misurerebbero un database a meta'. Una suite rossa invece
# non ferma le altre, cosi' alla fine si vede tutto quello che non va.
set -uo pipefail
. "$(dirname "$0")/common.sh"

echo "  database dei test: $TEST_TARGET"
echo

esiti=()
rosso=0
passo () { # nome, tipo (prepara|verifica), comando...
  local nome=$1 tipo=$2; shift 2
  printf '\n== %s\n' "$nome"
  if "$@"; then
    esiti+=("  ok     $nome")
  else
    esiti+=("  ROSSO  $nome")
    rosso=$((rosso+1))
    if [ "$tipo" = prepara ]; then
      printf '\n  %s e'"'"' fallito: mi fermo, il resto girerebbe su dati sbagliati\n' "$nome"
      riepilogo; exit 1
    fi
  fi
}
riepilogo () {
  printf '\n== riepilogo (%s)\n' "$TEST_TARGET"
  printf '%s\n' ${esiti[@]+"${esiti[@]}"}
}

passo "reset del database di test" prepara node db/reset.mjs --fixture
passo "schema e vincoli" verifica env DB_TEST_SENZA_RESET=1 ./db/test/schema.test.sh
passo "API di scrittura" verifica ./db/test/write_api.test.sh
# Gli account (0014): vincoli e verbi SQL, poi better-auth vero sulla pool
# di lib/db.ts con un mittente che cattura i magic link. Prima degli
# import: non dipende dalle carte, e crea solo utenti che poi toglie.
passo "account" verifica node_ts db/test/auth.test.mts
# Funzioni pure, niente database: come load-cards e fetch-assets ricavano
# l'id di una carta dalla pagina del wiki (db/import/wiki-card.mjs).
passo "id delle carte dal wiki" verifica node db/test/wiki-card.test.mjs
# Funzioni pure: i job di fetch-assets anche per le carte senza pagina (i
# nomi per convenzione del wiki), le risposte della CDN e i ritenti, la
# provenienza (0033), i limiti di spazio (db/import/asset-limits.mjs) e la
# cornice delle miniature (0034): il job thumb-framed delle LR, quale
# miniatura va in card.thumb_key, il solo personaggio riconosciuto dai
# pixel (le maschere di db/test/fixture/cornici, e con ffmpeg file veri).
passo "immagini: job, limiti, provenienza, cornice" verifica node db/test/assets.test.mjs
# Funzioni pure e richieste finte: le soglie di db/prod/freshness.mjs (il
# gioco andato avanti e il datamine no) e i nomi dell'archivio privato del
# datamine; push su un repo ops non privato non carica niente, e senza
# OPS_ARCHIVE_TOKEN dice una notice ed esce 0.
passo "freschezza delle fonti e archivio del datamine" verifica node db/test/fonti.test.mjs
# La configurazione di produzione (lib/db-config.ts, lib/cron.ts, l'header
# dell'IP in lib/auth/env.ts): funzioni pure, poi la rotta /api/cron/purge
# vera. Crea solo l'utente cronpurge_test e lo toglie.
passo "configurazione di produzione" verifica node_ts db/test/prod-config.test.mts
# Gli script di db/prod/: i rifiuti del bersaglio, l'ambiente dei figli
# senza .env.local, la conferma con --yes e prod:backup vero su questo
# database (in una cartella temporanea). Legge soltanto: harden (anche su
# una funzione creata dopo) gira in una transazione annullata.
passo "script di produzione" verifica node_ts db/test/prod-scripts.test.mts
# Le cache locali, nessuna rete. fetch-assets resta fuori: senza
# --offline interroga il wiki, e con --offline dipenderebbe da cosa c'e'
# in public/assets su questa macchina. Le verifiche delle query non
# dipendono dalle chiavi immagine.
passo "import carte (cache)" prepara node db/import/load-cards.mjs
# Le unita' uscite su Global che il wiki non ha ancora: dopo load-cards
# (il wiki vince) e prima di load-datamine, che le arricchisce.
passo "import carte dal gioco (cache)" prepara node db/import/load-game-cards.mjs
passo "import eventi (cache)" prepara node db/import/load-events.mjs
passo "import datamine (cache)" prepara node db/import/load-datamine.mjs
passo "import eventi dal gioco (cache)" prepara node db/import/load-game-events.mjs
passo "import finestre (cache)" prepara node db/import/load-windows.mjs
passo "import missioni (cache)" prepara node db/import/load-missions.mjs
# Le Skill Orb e le abilita' del Hidden Potential per le build (0018).
passo "import equipaggiamento (cache)" prepara node db/import/load-equipment.mjs
passo "query delle pagine" verifica node_ts db/test/queries.test.mts
passo "parametri dell'URL" verifica node_ts db/test/parametri.test.mts
# Gli URL degli eventi (lib/urls.ts): la grammatica dei percorsi e i link
# che il sito costruisce. Funzioni pure, niente database.
passo "URL degli eventi" verifica node_ts db/test/urls.test.mts
# I filtri della lista dei clear (lib/clears/filtri.ts) e i loro URL
# (lib/urls.ts filteredClearsHref, clearListHref): valori sbagliati che
# valgono "non impostato", l'URL canonico, la guardia dei moduli puri.
# Funzioni pure, niente database.
passo "filtri dei clear (parametri)" verifica node_ts db/test/filtri.test.mts
# La PWA (fase 1): public/sw.js in node:vm (quali richieste intercetta,
# la pagina offline senza rete, install e activate, niente in cache oltre
# /offline.html), la pagina offline uguale a quella generata e autonoma,
# il manifest con le misure vere delle icone, gli header di sw.js e chi
# vede l'invito a installare. Funzioni pure e file, niente database.
passo "PWA" verifica node_ts db/test/pwa.test.mts
# La cache (lib/cache/*): i tag di ogni scrittura, i tag ammessi,
# /api/revalidate con una funzione finta al posto di next/cache, e la
# guardia che tiene lib/queries.ts, lib/clears.ts, lib/cards.ts,
# lib/equipment.ts, lib/tips.ts, lib/card-page.ts e lib/card-art.ts senza
# 'use cache'. Funzioni pure.
passo "cache: tag e /api/revalidate" verifica node_ts db/test/cache-tags.test.mts
# Il builder dei clear (0016): invio e revisione in una transazione, gli
# assetti congelati, chi puo' cosa, il limite per ora, voti e commenti.
# Dopo gli import (servono carte e ricorrenze vere) e dopo le query delle
# pagine, che contano i clear della fixture: crea solo utenti
# submittest+/clearslib+ e li toglie, con tutto quello che hanno scritto.
passo "builder dei clear (SQL)" verifica node_ts db/test/submit.test.mts
passo "builder dei clear (lib, azioni, /api/cards)" verifica node_ts db/test/clears-lib.test.mts
# Lo stato del builder nel browser: funzioni pure, il payload deve passare
# lo stesso controllo della Server Action.
passo "builder dei clear (stato del form)" verifica node_ts db/test/builder-stato.test.mts
# Le build degli slot (0018): validazione SQL, build congelate con la
# versione, la revisione che non tocca le vecchie, letture, validatori,
# stato del form e /api/equipment. Crea solo utenti buildtest+ e li toglie.
passo "build degli slot" verifica node_ts db/test/builds.test.mts
# Le Skill Orb esclusive (0021): le regole del gioco lette in JS e
# importate sulle nostre carte, il rifiuto in invio e revisione per tipo,
# categoria, lista e nome, e la ricerca filtrata per la carta dello slot.
# Crea solo l'utente orbtest+orb_author e lo toglie.
passo "sfere esclusive" verifica node_ts db/test/orbs.test.mts
# Settings (0019): scollegare un provider solo se resta un modo di
# entrare, e cancellare l'account con tutto quello che ha scritto (ogni
# FK verso app_user e i clear a cascata, le segnalazioni col bersaglio),
# senza toccare gli altri. Crea solo utenti settingstest+ e li toglie.
passo "settings dell'account" verifica node_ts db/test/account-settings.test.mts
# La moderazione (0024): segnalare, il trigger sui commenti, chi modera,
# nascondere e rimostrare con le letture vere di lib/queries.ts e
# lib/clears.ts, archiviare, la sospensione (ferma le scritture, non
# delete_clear e delete_account), il registro solo in aggiunta, i ruoli
# da script (db:role, prod:role) e la conservazione. Crea solo utenti
# modtest+ e li toglie; le righe del registro restano, per costruzione.
passo "moderazione" verifica node_ts db/test/moderation.test.mts
# Le letture di /admin (lib/moderation/queries.ts vero): la coda per
# bersaglio, i nascosti, la ricerca degli handle, i sospesi, il registro.
# Crea solo utenti modadm+ e li toglie.
passo "moderazione (area admin)" verifica node_ts db/test/moderation-admin.test.mts
# La moderazione dal lato di chi usa il sito: la sospensione letta dalla
# sessione, la sezione user di /api/me, il form di Report e i rifiuti veri
# di report_content come frasi. Crea solo utenti modapp+ e li toglie.
passo "moderazione (lato utente)" verifica node_ts db/test/moderation-app.test.mts
# Le tip (0025): il bersaglio (l'evento, e il tier solo se e' di quell'evento),
# lunghezze e link (accorciatori rifiutati con proof_host), il tetto di 3 per
# bersaglio, i doppioni, i limiti per ora, la modifica che tiene i voti, la
# cancellazione con voti e segnalazioni, il voto solo "helpful", la
# sospensione, report_content e mod_set_tip_status, le letture vere di
# lib/tips.ts e della coda di /admin. Crea solo utenti tiptest+ e li toglie.
passo "tip" verifica node_ts db/test/tips.test.mts
# I profili pubblici e il cambio di handle (0026): la vista public_profile
# con le sole colonne pubbliche, gli indici per autore, change_handle (forma,
# riservati, nomi presi o lasciati, 30 giorni, le sole maiuscole, riprendere
# il proprio nome), la corsa sotto il lock consultivo, /welcome che rifiuta i
# nomi lasciati da altri, la sospensione che nasconde il profilo, la
# cancellazione che libera i nomi, e le letture vere di lib/profiles.ts
# (conteggi, lista, pagina del tier). Crea solo utenti profiletest+ e li toglie.
passo "profili pubblici" verifica node_ts db/test/profiles.test.mts
# I temi (0027): i blocchi [data-theme] di app/globals.css (17 token,
# color-scheme, contrasti WCAG: testo e tipi 4.5:1, campo 3:1, i bordi
# delle card sui neri, STR e PHY con la deuteranopia in Alto contrasto),
# che coincidano con lib/tema/temi.ts e col vincolo app_user_theme, lo
# script del <head> su un document finto, e set_theme. Crea solo utenti
# themetest+ e li toglie.
passo "temi" verifica node_ts db/test/temi.test.mts
# La versione del sito, Global o Japan (lib/versione, 0035): i redirect di
# next.config.ts nel valutatore di Next (chi va dove col cookie
# dts_version=japan, cosa non si tocca mai, _rsc che passa, nessun giro),
# seguiVersione che dice le stesse cose (per i redirect delle Server
# Action; anche con le maiuscole, coi matcher del router vero), il gemello
# dell'interruttore, il cookie e lo script del <head> su un document
# finto, set_region e cambiaVersione col database, e le guardie sui file:
# ogni redirect delle azioni letto col parser di TypeScript, con la sua
# controprova. Crea solo utenti versiontest+ e li toglie.
passo "versione del sito" verifica node_ts db/test/versione.test.mts
# L'interfaccia della versione (lib/versione/interruttore.ts,
# components/versione): quale versione mostra un URL e quando il cambio
# porta al gemello, il riallineamento con l'account una volta per scheda,
# il redirect di un'azione come lo riconosce Next, i testi degli avvisi e
# i blocchi della carta, i contrasti nei temi, e le guardie sui file (la
# variante japan:, il controllo a segmenti, il burger, l'header accanto a
# Events, il tag JP, Settings, gli avvisi statici, i chip Version tolti,
# "Japan version"). Funzioni pure e file, niente database.
passo "versione del sito (interfaccia)" verifica node_ts db/test/versione-ui.test.mts
# I segnaposto delle immagini (lib/segnaposto.ts, components/segnaposto.tsx):
# la scelta, l'iniziale, i colori del marchio con i contrasti in tutti i
# temi, e niente icone del wiki; le miniature che non si deformano (ogni
# next/image con le misure fissate ha un object-fit) e la cornice disegnata
# attorno a una miniatura nuda (0034). Funzioni pure e file, niente database.
passo "segnaposto delle immagini" verifica node_ts db/test/segnaposto.test.mts
# I menu a scelta (lib/scelta.ts, components/scelta): il combobox di
# Headless UI al posto di ogni <select>. La ricerca (accenti, maiuscole,
# tutta larghezza, a capo, l'ordine), i testi e i valori di ogni menu
# uguali agli <option> di prima, dove si apre l'elenco (la tastiera del
# telefono, 320px, i dialog), i contrasti in tutti i temi, la guardia
# sui <select> (col parser di TypeScript, con la controprova) e quelle su
# Headless (un file, solo con import()), i name del form dei filtri, le
# etichette, modal e anchor. Funzioni pure e file, niente database.
passo "menu a scelta (componente)" verifica node_ts db/test/scelta.test.mts
# Le notifiche nel sito (0028): i trigger su commenti, registro della
# moderazione e segnalazioni (il destinatario giusto e nessun altro, mai a
# se stessi, mai a chi segnala ne' a chi e' segnalato, il sospeso che
# riceve ancora le sue), l'accorpamento finche' non e' letta, render con il
# contenuto nascosto, il pallino (notif_last_at > notif_seen_at),
# dts.silent in seed, fixture e import, le preferenze, le cascate e la
# conservazione. Crea solo utenti notiftest+ e li toglie.
passo "notifiche" verifica node_ts db/test/notifiche.test.mts
# Il lato app delle notifiche (fase 2): lib/notify/kinds.ts uguale a
# notification_kinds(), il pallino (hasUnread, /api/me), gli href e i
# testi della lista su righe vere (mai il testo dei post), lib/notify/
# queries.ts, i giorni della privacy e le guardie su robots, pagina, rotta
# e menu. Crea solo utenti notifapp+ e li toglie.
passo "notifiche (app)" verifica node_ts db/test/notifiche-app.test.mts
# Il digest email (0029), lato SQL: il budget (i login contati e mai
# rifiutati, i tetti di notify nel giorno e nel mese dentro i totali, la
# pausa di 24 ore dopo un 429), digest_due (chi lo riceve, i +N di voti e
# Helpful, la moderazione generica e mai testi, motivi o note, niente
# digest vuoti, la priorita' e il tetto per giro), uno al giorno con
# digest_mark_sent, la casella di Settings e la disiscrizione dal link
# senza sessione. Il budget gira in una transazione annullata. Crea solo
# utenti digesttest+ e li toglie.
passo "digest email (SQL)" verifica node_ts db/test/digest.test.mts
# Il lato app del digest (lib/notify): la firma dei link di disiscrizione
# derivata da BETTER_AUTH_SECRET e la revoca, i testi con i +N e la
# moderazione generica, gli header RFC 8058, il mittente su file (mai in
# produzione), il conteggio dei login che non fallisce e non trattiene,
# un giro con un mittente finto (priorita', budget, pausa, idempotenza),
# le rotte vere /api/cron/digest e il one-click senza cookie, e le guardie
# su pagina, Settings, vercel.json e privacy. Nessuna email parte: niente
# RESEND_API_KEY, i log in una cartella temporanea. Crea solo utenti
# digestapp+ e li toglie.
passo "digest email (app)" verifica node_ts db/test/digest-app.test.mts
# Le push del browser (0031), lato SQL: la lista chiusa degli host (anche
# nel CHECK della tabella) e le chiavi, i dispositivi (tetto di 5, lo stesso
# endpoint che passa all'ultimo account, l'uscita che toglie solo il
# proprio), la prova una al minuto, push_claim (preferenza e dispositivo,
# coalescenza di 30 minuti, i tetti per destinatario, autore e coppia,
# l'account giovane o sospeso, il contenuto nascosto, skip locked, mai il
# testo dei post), push_report (404 e 410 tolgono, tre errori di fila
# tolgono, 413 e 429 no), purge_push e le cascate. Crea solo utenti
# pushtest+ e li toglie.
passo "push del browser (SQL)" verifica node_ts db/test/push.test.mts
# Le push del browser, lato app senza database: lib/notify/endpoint.ts
# contro gli stessi casi del SQL, le chiavi VAPID, i gruppi di Settings,
# testo e payload (512 byte, mai il testo dei post), il mittente vero
# contro un servizio push locale (corpo decifrato con RFC 8291, token
# VAPID verificato) e public/sw.js in node:vm (push e clic).
passo "push del browser (app)" verifica node_ts db/test/push-app.test.mts
# Un giro vero di lib/notify/push.ts sul database (claim, invii con un
# mittente finto, push_report), la prova e le letture di Settings. Crea
# solo utenti pushrun+ e li toglie.
passo "push del browser (giro)" verifica node_ts db/test/push-run.test.mts
# Il feed dell'attivita' del sito per gli admin (0032): spento per difetto e
# solo per gli admin, una riga per azione a chi l'ha acceso e a nessun altro,
# mai a se stessi, le esclusioni (chi e' segnalato, l'autore moderato, i
# ruoli da script, dts.silent), le scritture che non cambiano niente, una
# cancellazione che e' un'azione sola, l'accorpamento, il rollback, nessun
# handle dopo la cancellazione dell'account, render, testi e link veri, il
# limite per famiglia e il pallino che si spegne oltre quel limite (con
# quante azioni non mostrate), push_claim con una push per azione e senza
# tetti (mai chi segnala), anche la prima persa da un giro non riuscito ma
# non gli arretrati di chi accende la push dopo, il link alla pagina di
# /admin di chi e' sospeso, il digest che non lo manda mai e chi smette di
# essere admin, anche con una segnalazione nello stesso istante.
# Crea solo utenti attivitatest+ e li toglie.
passo "attivita' del sito" verifica node_ts db/test/attivita.test.mts
# Rilancia load-game-cards e load-datamine, e prova il passaggio al wiki
# con una pagina finta su 1034200 (poi rimette la carta com'era).
passo "carte dal gioco" verifica node_ts db/test/game-cards.test.mts
# La pagina della carta (0022): i vincoli di card_skill, set_prefers_animated
# e le skill che load-cards scrive dalla cache vera (EZA, note con nome,
# testi di card_text ripuliti, un secondo giro che non cambia niente).
# Rilancia load-cards, poi load-game-cards e load-datamine come sopra.
# Crea solo utenti cardpagetest+ e la carta finta 1999990, e li toglie.
passo "pagina della carta (dati)" verifica node_ts db/test/card-page.test.mts
# La pagina della carta, lato pagina: le letture vere di lib/card-page.ts
# (catena, link, categorie, i clear che usano la carta con la pagina del
# loro tier secondo ORDINE_CLEAR, la forma Z), le skill per livello e
# lib/card-art.ts (quale artwork, la scelta per carta nel localStorage).
# Crea solo utenti cardpageui+ con i loro clear, e li toglie.
passo "pagina della carta (pagina)" verifica node_ts db/test/card-page-ui.test.mts
# I filtri della lista dei clear: listClears con i filtri, countClears,
# getClearFacets, cardLabels e categoryName di lib/queries.ts, confrontati
# con un modello in JS (ogni assetto conta, il leader e' quello di partenza,
# mono ignora la classe, la categoria vuole ogni carta, turns esclude i
# clear senza turni, i tre ordini, Japan e nascosti fuori, valori legati).
# Crea solo utenti filterstest+ con i loro clear su un tier senza clear, e
# li toglie.
passo "filtri dei clear" verifica node_ts db/test/filters.test.mts
# Per ultima: rilancia load-windows e set-event-window, e ritocca qualche
# run per provarli (rimettendole come le ha trovate).
passo "finestre dal gioco" verifica node_ts db/test/windows.test.mts
# Dopo le finestre: rilancia load-game-events, load-events e load-windows
# e controlla che un secondo giro non cambi niente.
passo "eventi dal gioco" verifica node_ts db/test/game-events.test.mts
# Gli stage che le riedizioni aggiungono (0017): Looming Menace e il suo
# stage 4, le Extreme Z-Area, gli archivi senza doppioni. Rilancia
# load-game-events, load-events e load-windows; ritocca solo dentro
# transazioni che annulla.
passo "stage delle riedizioni" verifica node_ts db/test/rerun-stages.test.mts
# Il tipo dei remake della storia, le pagine della Super Battle Road e gli
# archivi delle edizioni (legami per quest): rilancia load-events e
# load-windows, e ritocca una run e un clear (rimettendoli a posto).
passo "classificazione" verifica node_ts db/test/classification.test.mts
# Per ultima davvero: le suite prima ritoccano le run, e le missioni ci
# puntano. Rilancia load-missions, poi confronta un evento con i CSV,
# controlla corse, premi e nomi, e che un secondo giro non cambi niente.
passo "missioni" verifica node_ts db/test/missions.test.mts
# L'aggiornamento settimanale (.github/workflows/weekly-data.yml, 0023) e
# il giro giornaliero delle immagini (daily-images.yml): i limiti di
# compare.mjs, i controlli sulle sorgenti, il commit del datamine e il
# token, la scelta delle immagini, il mirror, le maschere dei log, la
# guardia della cache di Actions (cache-check.mjs: solo fonti pubbliche); poi
# snapshot.mjs vero (un dry-run non scrive), un clear vero e load-events,
# load-game-events e load-missions rilanciati dalla cache senza che i dati
# degli utenti cambino, migrate --check, import_run (i giri delle sole
# immagini non sono "l'ultimo import"), le immagini mancanti anche senza
# pagina, i vincoli della provenienza (0033, in transazioni annullate) e la
# forma dei due workflow (permessi job per job, i passi Decide eseguiti
# davvero).
# Crea solo weeklytest+weekly_author e il database <test>_mc_test, e li toglie.
passo "aggiornamento settimanale" verifica node_ts db/test/weekly-data.test.mts

riepilogo
if [ "$rosso" -eq 0 ]; then echo "TUTTO VERDE"; else echo "$rosso passi rossi"; exit 1; fi
