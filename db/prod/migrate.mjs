// Solo lo schema della produzione: le migrazioni pendenti, poi harden.
//
//   PROD_DATABASE_URL=... PROD_DATABASE_CA_CERT=... npm run prod:migrate -- --yes
//
// Per portare online una migrazione nuova senza rifare l'import. prod:setup
// rifa' anche tutta la fila degli importer dalle cache di questo Mac, che
// possono essere piu' vecchie dei dati con cui la CI ha gia' aggiornato la
// produzione: un import cosi' riporterebbe indietro missioni e finestre.
// harden subito dopo, come in setup: un oggetto nuovo non deve restare
// raggiungibile dalla Data API di Supabase. Tutti e due sono idempotenti.
import { stepNames } from './pipeline.mjs'
import { prepare, runNode } from './target.mjs'

const STEPS = [['db/migrate.mjs', []], ['db/prod/harden.mjs', []]]
const { env } = prepare('prod:migrate', stepNames(STEPS))
for (const [script, args] of STEPS) runNode(script, args, env)
console.log('\n  prod:migrate finito.\n')
