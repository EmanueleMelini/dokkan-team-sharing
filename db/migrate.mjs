#!/usr/bin/env node
// Runner di migrazioni, SQL-first.
//
// Applica in ordine i file db/migrations/NNNN_*.sql non ancora applicati,
// ognuno in una sua transazione. Tiene traccia in schema_migrations, con
// il checksum: se un file gia' applicato viene modificato, si ferma e lo
// dice — perche' una migrazione applicata e poi cambiata e' il modo piu'
// rapido di avere due database diversi che credono di essere uguali.
//
//   node db/migrate.mjs           applica le pendenti
//   node db/migrate.mjs --status  elenca e non tocca niente
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { connectionString, describeTarget } from './env.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIR = join(HERE, 'migrations')

const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16)

function onDisk() {
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => {
      const sql = readFileSync(join(DIR, file), 'utf8')
      return { version: file.replace(/\.sql$/, ''), file, sql, checksum: sha(sql) }
    })
}

console.log(`  database: ${describeTarget()}`)
const client = new pg.Client({ connectionString: connectionString() })
await client.connect()

await client.query(`
  create table if not exists schema_migrations (
    version     text primary key,
    checksum    text        not null,
    applied_at  timestamptz not null default now(),
    duration_ms integer     not null
  )`)

const { rows: applied } = await client.query(
  'select version, checksum from schema_migrations order by version')
const seen = new Map(applied.map((r) => [r.version, r.checksum]))
const files = onDisk()

// un file applicato che e' cambiato sotto i piedi: si ferma qui
for (const m of files) {
  const was = seen.get(m.version)
  if (was && was !== m.checksum) {
    console.error(`\n  ${m.file} e' stato modificato dopo essere stato applicato.`)
    console.error(`  checksum nel database ${was}, sul disco ${m.checksum}.`)
    console.error(`  Non lo riapplico: aggiungi una migrazione nuova, o ricrea`)
    console.error(`  il database con  npm run db:reset  se sei in sviluppo.\n`)
    await client.end()
    process.exit(1)
  }
}
for (const version of seen.keys()) {
  if (!files.some((m) => m.version === version)) {
    console.warn(`  attenzione: ${version} risulta applicata ma il file non c'e' piu'`)
  }
}

const pending = files.filter((m) => !seen.has(m.version))

if (process.argv.includes('--status')) {
  for (const m of files) {
    console.log(`  ${seen.has(m.version) ? 'applicata' : 'PENDENTE '}  ${m.version}`)
  }
  console.log(`\n  ${files.length} migrazioni, ${pending.length} da applicare`)
  await client.end()
  process.exit(0)
}

if (pending.length === 0) {
  console.log('  niente da applicare, il database e\' aggiornato')
  await client.end()
  process.exit(0)
}

for (const m of pending) {
  const t0 = Date.now()
  try {
    await client.query('begin')
    await client.query(m.sql)
    const ms = Date.now() - t0
    await client.query(
      'insert into schema_migrations (version, checksum, duration_ms) values ($1,$2,$3)',
      [m.version, m.checksum, ms])
    await client.query('commit')
    console.log(`  applicata  ${m.version}  (${ms} ms)`)
  } catch (err) {
    await client.query('rollback')
    console.error(`\n  ${m.file} e' fallita, niente e' stato applicato di questa migrazione:`)
    console.error(`  ${err.message}\n`)
    await client.end()
    process.exit(1)
  }
}

await client.end()
