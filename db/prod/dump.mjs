#!/usr/bin/env node
// Il dump della produzione per la CI settimanale: e' insieme il backup
// (cifrato con age prima di diventare un artifact) e la sorgente del giro
// di prova. Formato custom (-Fc), per pg_restore. Solo lettura.
//
//   PROD_DATABASE_URL=... PROD_DATABASE_CA_CERT=... node db/prod/dump.mjs --out prod.dump --yes
//
// Accanto scrive <out>.extensions.json: in quale schema stanno le nostre
// estensioni in produzione (su Supabase spesso in "extensions"), perche'
// il database del giro di prova le deve avere nello stesso posto, o il
// ripristino dei tipi qualificati fallisce.
//
// Il file in chiaro contiene email e sessioni degli utenti: resta nella
// cartella temporanea del runner, leggibile solo dal proprietario, e non
// si carica mai cosi' com'e'.
import { spawnSync } from 'node:child_process'
import { renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dumpArgs, pickPgDump, serverInfo, splitPassword } from './pgdump.mjs'
import { prepare } from './target.mjs'

const argv = process.argv.slice(2)
const out = argv[argv.indexOf('--out') + 1]
if (!argv.includes('--out') || !out) { console.error('  uso: dump.mjs --out <file> --yes'); process.exit(1) }

const { url, env } = prepare('prod:dump', ['pg_dump -Fc -n public', out])
const { major, extensions } = await serverInfo(url)
const found = pickPgDump(major)
if (!found) { console.error(`\n  nessun pg_dump >= ${major}\n`); process.exit(1) }
console.log(`  server ${major}, uso ${found.bin} (${found.major})`)

const { url: dumpUrl, env: dumpEnv } = splitPassword(url, env)
const partial = `${out}.partial`
writeFileSync(partial, '', { mode: 0o600 })
const r = spawnSync(found.bin, [...dumpArgs(dumpUrl), '--format', 'custom', '--file', partial],
  { env: dumpEnv, stdio: ['ignore', 'inherit', 'inherit'] })
if (r.status !== 0) {
  rmSync(partial, { force: true })
  console.error(`\n  pg_dump e' uscito con ${r.status ?? r.signal}\n`)
  process.exit(1)
}
renameSync(partial, out)
writeFileSync(`${out}.extensions.json`, JSON.stringify({ server_major: major, extensions }) + '\n')
console.log(`  scritto ${out} (${(statSync(out).size / 1e6).toFixed(1)} MB), estensioni: ` +
            extensions.map((e) => `${e.extname} in ${e.nspname}`).join(', '))
