#!/usr/bin/env bash
# npm run db:test: tutte le verifiche, in fila, su un database di test.
#
#   reset -> schema -> API di scrittura -> import dei dati veri -> query
#   delle pagine (lib/queries.ts vero) -> parametri dell'URL (lib/parametri.ts)
#   -> finestre degli eventi dal gioco (load-windows)
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
# Le cache locali, nessuna rete. fetch-assets resta fuori: anche con le
# immagini sul disco interroga il wiki (il template degli oggetti a ogni
# giro completo, e ogni file che non trova), quindi non e' un passo
# offline. Le verifiche delle query non dipendono dalle chiavi immagine.
passo "import carte (cache)" prepara node db/import/load-cards.mjs
passo "import eventi (cache)" prepara node db/import/load-events.mjs
passo "import datamine (cache)" prepara node db/import/load-datamine.mjs
passo "import finestre (cache)" prepara node db/import/load-windows.mjs
passo "query delle pagine" verifica node_ts db/test/queries.test.mts
passo "parametri dell'URL" verifica node_ts db/test/parametri.test.mts
# Per ultima: rilancia load-windows e set-event-window, e ritocca qualche
# run per provarli (rimettendole come le ha trovate).
passo "finestre dal gioco" verifica node_ts db/test/windows.test.mts

riepilogo
if [ "$rosso" -eq 0 ]; then echo "TUTTO VERDE"; else echo "$rosso passi rossi"; exit 1; fi
