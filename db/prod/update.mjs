#!/usr/bin/env node
// L'aggiornamento settimanale: solo l'import, dalle cache locali appena
// riscaricate con npm run db:fetch. Le migrazioni nuove passano da
// prod:setup (che e' rilanciabile), cosi' questo comando non cambia mai
// lo schema per sbaglio.
//
//   PROD_DATABASE_URL=... PROD_DATABASE_CA_CERT=... npm run prod:update -- --yes
import { PIPELINE, stepNames } from './pipeline.mjs'
import { prepare, runNode } from './target.mjs'

const { env } = prepare('prod:update', stepNames(PIPELINE))
// lo schema deve essere gia' quello del codice: un import su uno schema
// vecchio fallirebbe a meta', meglio dirlo prima
runNode('db/prod/check-schema.mjs', [], env)
for (const [script, args] of PIPELINE) runNode(script, args, env)
console.log('\n  prod:update finito.\n')
