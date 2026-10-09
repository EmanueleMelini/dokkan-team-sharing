#!/usr/bin/env bash
# npm run db:test: tutte le verifiche, in fila, su un database di test.
#
#   reset -> schema -> API di scrittura -> account -> id delle carte dal wiki ->
#   configurazione di produzione (pool, TLS, cron, IP) ->
#   import dei dati veri (carte del wiki, poi quelle solo nel gioco) -> query
#   delle pagine (lib/queries.ts vero) -> parametri dell'URL (lib/parametri.ts)
#   -> URL degli eventi (lib/urls.ts) -> filtri dei clear (parametri)
#   -> tag della cache (lib/cache/*)
#   -> builder dei clear (0016, lib/clears*, lib/cards.ts, /api/cards)
#   -> build degli slot (0018, Skill Orb, /api/equipment) -> sfere
#   esclusive (0021)
#   -> settings dell'account (0019: scollegare, cancellare l'account)
#   -> moderazione (0024: segnalazioni, nascosti, sospensioni, registro,
#   letture di /admin, il lato di chi usa il sito) -> tip (0025)
#   -> profili pubblici e cambio di handle (0026) -> temi (0027)
#   -> carte solo nel gioco (load-game-cards) -> skill delle carte (0022)
#   e la pagina della carta -> filtri dei clear
#   -> finestre degli eventi dal
#   gioco (load-windows) -> eventi creati dal gioco (load-game-events) ->
#   stage delle riedizioni -> classificazione (story, SBR, archivi) ->
#   missioni dal gioco (load-missions) -> aggiornamento settimanale
#   (weekly-data)
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
# La configurazione di produzione (lib/db-config.ts, lib/cron.ts, l'header
# dell'IP in lib/auth/env.ts): funzioni pure, poi la rotta /api/cron/purge
# vera. Crea solo l'utente cronpurge_test e lo toglie.
passo "configurazione di produzione" verifica node_ts db/test/prod-config.test.mts
# Gli script di db/prod/: i rifiuti del bersaglio, l'ambiente dei figli
# senza .env.local, la conferma con --yes e prod:backup vero su questo
# database (in una cartella temporanea). Legge soltanto.
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
# L'aggiornamento settimanale (.github/workflows/weekly-data.yml, 0023): i
# limiti di compare.mjs, i controlli sulle sorgenti, il commit del datamine
# e il token, la scelta delle immagini, il mirror, le maschere dei log; poi
# snapshot.mjs vero (un dry-run non scrive), un clear vero e load-events,
# load-game-events e load-missions rilanciati dalla cache senza che i dati
# degli utenti cambino, migrate --check, import_run e la forma del workflow.
# Crea solo weeklytest+weekly_author e il database <test>_mc_test, e li toglie.
passo "aggiornamento settimanale" verifica node_ts db/test/weekly-data.test.mts

riepilogo
if [ "$rosso" -eq 0 ]; then echo "TUTTO VERDE"; else echo "$rosso passi rossi"; exit 1; fi
