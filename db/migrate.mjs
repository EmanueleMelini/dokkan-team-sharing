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
//   node db/migrate.mjs --check   come --status, ma esce 4 se ci sono
//                                 pendenti (1 se un file applicato e' cambiato)
//
// --check serve alla CI settimanale, che non migra mai da sola: se la
// produzione e' indietro rispetto al codice si ferma e lo dice, e le DDL
// restano un gesto a mano (npm run prod:migrate).
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

const READ_ONLY = process.argv.includes('--status') || process.argv.includes('--check')
// in sola lettura la tabella non si crea: un database senza e' "tutto pendente"
const { rows: [{ exists }] } = await client.query(`select to_regclass('schema_migrations') is not null as exists`)
if (!READ_ONLY) await client.query(`
  create table if not exists schema_migrations (
    version     text primary key,
    checksum    text        not null,
    applied_at  timestamptz not null default now(),
    duration_ms integer     not null
  )`)

const { rows: applied } = exists || !READ_ONLY ? await client.query(
  'select version, checksum from schema_migrations order by version') : { rows: [] }
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

if (READ_ONLY) {
  const check = process.argv.includes('--check')
  for (const m of files) {
    // con --check solo le pendenti: l'elenco intero e' rumore nel log
    if (!check || !seen.has(m.version)) console.log(`  ${seen.has(m.version) ? 'applicata' : 'PENDENTE '}  ${m.version}`)
  }
  console.log(`\n  ${files.length} migrazioni, ${pending.length} da applicare`)
  await client.end()
  if (check && pending.length) {
    console.error('  il database e\' indietro rispetto al codice: lancia prima npm run prod:migrate -- --yes')
    process.exit(4)
  }
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
