#!/usr/bin/env bash
# npm run db:test:queries: solo le verifiche delle query delle pagine, per
# girarle di nuovo in fretta dopo un  npm run db:test  (che prepara il
# database di test con la fixture e i dati importati).
#
# Stesso bersaglio e stessa barriera sul nome di tutte le altre suite.
set -uo pipefail
. "$(dirname "$0")/common.sh"
echo "  database dei test: $TEST_TARGET"
node_ts db/test/queries.test.mts
