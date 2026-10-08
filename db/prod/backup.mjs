#!/usr/bin/env node
// Copia del database di produzione sul tuo disco: Supabase Free non fa
// backup, quindi questi sono gli unici.
//
//   PROD_DATABASE_URL=... PROD_DATABASE_CA_CERT=... npm run prod:backup -- --yes
//
// pg_dump dello schema public (le nostre tabelle; auth, storage e gli
// altri schemi di Supabase non sono nostri) in backups/<ora UTC>.sql.gz,
// tenendo le ultime 8 copie.
import { spawn } from 'node:child_process'
import { createWriteStream, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import { dumpArgs, pickPgDump, serverInfo, splitPassword } from './pgdump.mjs'
import { ROOT, prepare } from './target.mjs'

const KEEP = 8
// BACKUP_DIR serve ai test: la rotazione non deve toccare le copie vere
const DIR = process.env.BACKUP_DIR ? resolve(process.env.BACKUP_DIR) : join(ROOT, 'backups')

const { url, env } = prepare('prod:backup', ['pg_dump -n public', `backups/, ultime ${KEEP}`])

const { major: serverMajor } = await serverInfo(url)
const found = pickPgDump(serverMajor)
if (!found) {
  console.error(`\n  nessun pg_dump >= ${serverMajor} (la versione del server).`)
  console.error(`  Installa Postgres.app ${serverMajor} o indica il binario con PG_DUMP=/percorso/pg_dump\n`)
  process.exit(1)
}
const { bin, major } = found
console.log(`  server ${serverMajor}, uso ${bin} (${major})`)

const { url: dumpUrl, env: dumpEnv } = splitPassword(url, env)

// Il dump contiene le email degli utenti: cartella e file leggibili solo
// dal proprietario, non dagli altri account della macchina.
mkdirSync(DIR, { recursive: true, mode: 0o700 })
const stamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-')
const final = join(DIR, `${stamp}.sql.gz`)
// dentro il progetto il percorso relativo, fuori (BACKUP_DIR) quello intero
const show = (p) => (relative(ROOT, p).startsWith('..') ? p : relative(ROOT, p))
const partial = `${final}.partial`

const child = spawn(bin, dumpArgs(dumpUrl), { env: dumpEnv, stdio: ['ignore', 'pipe', 'inherit'] })
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
