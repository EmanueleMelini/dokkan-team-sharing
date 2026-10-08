#!/usr/bin/env node
// Le migrazioni sul disco sono tutte applicate? Esce 1 se no.
// Lo usa prod:update, che non migra da solo.
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { connectionString } from '../env.mjs'
import { ROOT } from './target.mjs'

const files = readdirSync(join(ROOT, 'db', 'migrations')).filter((f) => f.endsWith('.sql'))
  .map((f) => f.replace(/\.sql$/, ''))
const c = new pg.Client({ connectionString: connectionString() })
await c.connect()
const { rows } = await c.query(`select to_regclass('schema_migrations') is not null as ok`)
const applied = rows[0].ok
  ? new Set((await c.query('select version from schema_migrations')).rows.map((r) => r.version))
  : new Set()
await c.end()
const pending = files.filter((v) => !applied.has(v))
if (pending.length) {
  console.error(`\n  migrazioni non applicate: ${pending.join(', ')}`)
  console.error('  lancia prima npm run prod:setup (applica solo le pendenti)\n')
  process.exit(1)
}
console.log(`  schema aggiornato (${files.length} migrazioni)`)
