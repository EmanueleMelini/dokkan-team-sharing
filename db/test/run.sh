#!/usr/bin/env bash
# npm run db:test: tutte le verifiche, in fila, su un database di test.
#
#   reset -> schema -> API di scrittura -> account -> id delle carte dal wiki ->
#   import dei dati veri (carte del wiki, poi quelle solo nel gioco) -> query
#   delle pagine (lib/queries.ts vero) -> parametri dell'URL (lib/parametri.ts)
#   -> builder dei clear (0016, lib/clears*, lib/cards.ts, /api/cards)
#   -> carte solo nel gioco (load-game-cards) -> finestre degli eventi dal
#   gioco (load-windows) -> eventi creati dal gioco (load-game-events) ->
#   classificazione (story, SBR, archivi) -> missioni dal gioco (load-missions)
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
# Le cache locali, nessuna rete. fetch-assets resta fuori: anche con le
# immagini sul disco interroga il wiki (il template degli oggetti a ogni
# giro completo, e ogni file che non trova), quindi non e' un passo
# offline. Le verifiche delle query non dipendono dalle chiavi immagine.
passo "import carte (cache)" prepara node db/import/load-cards.mjs
# Le unita' uscite su Global che il wiki non ha ancora: dopo load-cards
# (il wiki vince) e prima di load-datamine, che le arricchisce.
passo "import carte dal gioco (cache)" prepara node db/import/load-game-cards.mjs
passo "import eventi (cache)" prepara node db/import/load-events.mjs
passo "import datamine (cache)" prepara node db/import/load-datamine.mjs
passo "import eventi dal gioco (cache)" prepara node db/import/load-game-events.mjs
passo "import finestre (cache)" prepara node db/import/load-windows.mjs
passo "import missioni (cache)" prepara node db/import/load-missions.mjs
passo "query delle pagine" verifica node_ts db/test/queries.test.mts
passo "parametri dell'URL" verifica node_ts db/test/parametri.test.mts
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
# Rilancia load-game-cards e load-datamine, e prova il passaggio al wiki
# con una pagina finta su 1034200 (poi rimette la carta com'era).
passo "carte dal gioco" verifica node_ts db/test/game-cards.test.mts
# Per ultima: rilancia load-windows e set-event-window, e ritocca qualche
# run per provarli (rimettendole come le ha trovate).
passo "finestre dal gioco" verifica node_ts db/test/windows.test.mts
# Dopo le finestre: rilancia load-game-events, load-events e load-windows
# e controlla che un secondo giro non cambi niente.
passo "eventi dal gioco" verifica node_ts db/test/game-events.test.mts
# Il tipo dei remake della storia, le pagine della Super Battle Road e gli
# archivi delle edizioni (legami per quest): rilancia load-events e
# load-windows, e ritocca una run e un clear (rimettendoli a posto).
passo "classificazione" verifica node_ts db/test/classification.test.mts
# Per ultima davvero: le suite prima ritoccano le run, e le missioni ci
# puntano. Rilancia load-missions, poi confronta un evento con i CSV,
# controlla corse, premi e nomi, e che un secondo giro non cambi niente.
passo "missioni" verifica node_ts db/test/missions.test.mts

riepilogo
if [ "$rosso" -eq 0 ]; then echo "TUTTO VERDE"; else echo "$rosso passi rossi"; exit 1; fi
