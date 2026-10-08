#!/usr/bin/env node
// Copia del database di produzione sul tuo disco: Supabase Free non fa
// backup, quindi questi sono gli unici.
//
//   PROD_DATABASE_URL=... PROD_DATABASE_CA_CERT=... npm run prod:backup -- --yes
//
// pg_dump dello schema public (le nostre tabelle; auth, storage e gli
// altri schemi di Supabase non sono nostri) in backups/<ora UTC>.sql.gz,
// tenendo le ultime 8 copie.
import { execFileSync, spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import pg from 'pg'
import { ROOT, prepare } from './target.mjs'

const KEEP = 8
// BACKUP_DIR serve ai test: la rotazione non deve toccare le copie vere
const DIR = process.env.BACKUP_DIR ? resolve(process.env.BACKUP_DIR) : join(ROOT, 'backups')

const { url, env } = prepare('prod:backup', ['pg_dump -n public', `backups/, ultime ${KEEP}`])

// La versione del server decide il pg_dump: uno piu' vecchio del server
// si rifiuta, uno uguale o piu' nuovo va bene. Si preferisce quello della
// stessa versione (Postgres.app 15 su questa macchina).
const c = new pg.Client({ connectionString: url })
await c.connect()
const serverMajor = Math.floor(Number((await c.query('show server_version_num')).rows[0].server_version_num) / 10000)
await c.end()

function candidates() {
  const out = []
  if (process.env.PG_DUMP) out.push(process.env.PG_DUMP)
  const app = '/Applications/Postgres.app/Contents/Versions'
  if (existsSync(app)) for (const v of readdirSync(app)) out.push(join(app, v, 'bin', 'pg_dump'))
  out.push('pg_dump')
  return out
}
const majorOf = (bin) => {
  try {
    const m = execFileSync(bin, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).match(/(\d+)\.\d+/)
    return m ? Number(m[1]) : null
  } catch { return null }
}
const found = [...new Set(candidates())].map((bin) => ({ bin, major: majorOf(bin) }))
  .filter((x) => x.major != null && x.major >= serverMajor)
  .sort((a, b) => (a.major - serverMajor) - (b.major - serverMajor))
if (!found.length) {
  console.error(`\n  nessun pg_dump >= ${serverMajor} (la versione del server).`)
  console.error(`  Installa Postgres.app ${serverMajor} o indica il binario con PG_DUMP=/percorso/pg_dump\n`)
  process.exit(1)
}
const { bin, major } = found[0]
console.log(`  server ${serverMajor}, uso ${bin} (${major})`)

// La password non va sulla riga di comando (si vede in ps): passa da
// PGPASSWORD, e l'URL resta senza.
const u = new URL(url)
const dumpEnv = { ...env }
if (u.password) { dumpEnv.PGPASSWORD = decodeURIComponent(u.password); u.password = '' }

// Il dump contiene le email degli utenti: cartella e file leggibili solo
// dal proprietario, non dagli altri account della macchina.
mkdirSync(DIR, { recursive: true, mode: 0o700 })
const stamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-')
const final = join(DIR, `${stamp}.sql.gz`)
// dentro il progetto il percorso relativo, fuori (BACKUP_DIR) quello intero
const show = (p) => (relative(ROOT, p).startsWith('..') ? p : relative(ROOT, p))
const partial = `${final}.partial`

// Le estensioni dello schema si dichiarano una per una: con --schema
// pg_dump le lascerebbe fuori, e il dump non si ripristinerebbe su un
// database vuoto (citext, btree_gist e pg_trgm servono alle tabelle).
const EXT = ['pgcrypto', 'citext', 'btree_gist', 'pg_trgm'].flatMap((e) => ['--extension', e])
const child = spawn(bin, ['--dbname', u.href, '--schema', 'public', ...EXT, '--no-owner', '--no-privileges'],
  { env: dumpEnv, stdio: ['ignore', 'pipe', 'inherit'] })
const exited = new Promise((res) => child.on('close', (code) => res(code)))
try {
  await pipeline(child.stdout, createGzip({ level: 9 }), createWriteStream(partial, { mode: 0o600 }))
} catch (err) {
  console.error(`\n  scrittura fallita: ${err.message}`)
}
const code = await exited
if (code !== 0) {
  rmSync(partial, { force: true })
  console.error(`\n  pg_dump e' uscito con ${code}: nessuna copia nuova, le vecchie restano.\n`)
  process.exit(1)
}
// solo una copia completa prende il nome definitivo, e solo dopo si
// tolgono le vecchie
renameSync(partial, final)
console.log(`  scritto ${show(final)} (${(statSync(final).size / 1e6).toFixed(1)} MB)`)

const all = readdirSync(DIR).filter((f) => /^\d{4}-\d\d-\d\dT[\d-]+Z\.sql\.gz$/.test(f)).sort()
for (const f of all.slice(0, Math.max(0, all.length - KEEP))) {
  rmSync(join(DIR, f))
  console.log(`  tolto il vecchio ${f}`)
}
console.log(`  in ${show(DIR)} ${Math.min(all.length, KEEP)} copie\n`)
