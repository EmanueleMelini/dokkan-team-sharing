#!/usr/bin/env node
// Prima messa online del database: migrazioni, poi l'import completo.
//
//   PROD_DATABASE_URL=... PROD_DATABASE_CA_CERT=... npm run prod:setup -- --yes
//
// Si puo' rilanciare: le migrazioni applicano solo le pendenti e gli
// importer sono idempotenti. Non cancella niente e non crea utenti.
import { PIPELINE, stepNames } from './pipeline.mjs'
import { prepare, runNode } from './target.mjs'

// harden subito dopo le migrazioni: le tabelle appena create non devono
// restare un momento leggibili dalla Data API di Supabase
const STEPS = [['db/migrate.mjs', []], ['db/prod/harden.mjs', []], ...PIPELINE]
const { env } = prepare('prod:setup', stepNames(STEPS))
for (const [script, args] of STEPS) runNode(script, args, env)
console.log('\n  prod:setup finito.\n')
