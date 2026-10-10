#!/usr/bin/env node
// Pubblica public/assets su Cloudflare Pages (progetto dokkants-assets).
//
//   npx wrangler login           una volta, apre il browser
//   npm run assets:deploy        conta i file e controlla i limiti
//   npm run assets:deploy -- --yes   pubblica davvero
//
// Pages carica solo i file nuovi o cambiati (confronta gli hash), quindi
// rilanciarlo dopo un db:assets costa poco. I limiti del piano gratuito
// sono per deploy: 20.000 file e 25 MiB per file. Oltre, wrangler
// fallisce a meta': meglio fermarsi prima e dire quale file. I limiti, e
// il budget degli artwork animati, stanno in db/import/asset-limits.mjs:
// gli stessi della CI (db/prod/storage.mjs).
import { spawnSync } from 'node:child_process'
import { readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PAGES_MAX_FILE_BYTES, PAGES_MAX_FILES, avvisiSpazio, kindOfKey, mib as mibOf, rapportoSpazio } from '../db/import/asset-limits.mjs'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const DIR = join(ROOT, 'public', 'assets')
const WRANGLER = 'wrangler@4.148.0'   // fissato: un aggiornamento non cambia il deploy sotto i piedi
const PROJECT = 'dokkants-assets'
const MAX_FILES = PAGES_MAX_FILES
const MAX_BYTES = PAGES_MAX_FILE_BYTES

// Le chiavi non cambiano mai di significato (cards/<id>/thumb.webp), quindi
// un anno di cache e immutable: il browser non ricontrolla. Il prezzo:
// un'immagine riscaricata con --force sotto la stessa chiave arriva a chi
// l'aveva gia' solo quando la sua cache scade.
const HEADERS = `/*
  Cache-Control: public, max-age=31536000, immutable
  X-Content-Type-Options: nosniff
`

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.isFile()) out.push({ path: p, size: statSync(p).size })
  }
  return out
}

let files
try { files = walk(DIR) } catch {
  console.error(`\n  ${relative(ROOT, DIR)} non c'e': scarica le immagini con npm run db:assets\n`)
  process.exit(1)
}
writeFileSync(join(DIR, '_headers'), HEADERS)
files = files.filter((f) => !f.path.endsWith('/_headers'))

const total = files.reduce((a, f) => a + f.size, 0)
const big = files.filter((f) => f.size > MAX_BYTES)
const largest = files.reduce((a, f) => (f.size > a.size ? f : a), { size: 0, path: '' })
const mib = (b) => (b / 1024 / 1024).toFixed(1)
console.log(`\n  ${files.length} file (limite ${MAX_FILES}), ${(total / 1e9).toFixed(2)} GB in tutto`)
console.log(`  il piu' grande: ${relative(DIR, largest.path)}, ${mib(largest.size)} MiB (limite 25 MiB)`)
console.log(`  _headers scritto: Cache-Control public, max-age=31536000, immutable`)

// per kind, e gli avvisi dall'80% (dei file o del budget degli animati)
const perTipo = {}
for (const f of files) {
  const kind = kindOfKey(relative(DIR, f.path).split('\\').join('/')) ?? 'other'
  perTipo[kind] ??= { files: 0, bytes: 0 }
  perTipo[kind].files++; perTipo[kind].bytes += f.size
}
const spazio = rapportoSpazio({ files: files.length, perTipo, piuGrande: largest.size })
for (const r of spazio.righe) console.log(`    ${r.kind.padEnd(20)} ${String(r.files).padStart(6)} file  ${mibOf(r.bytes).padStart(7)} MiB`)
for (const a of avvisiSpazio(spazio)) console.log(`  attenzione: ${a}`)

if (files.length + 1 > MAX_FILES || big.length) {
  if (big.length) for (const f of big) console.error(`  oltre 25 MiB: ${relative(DIR, f.path)} (${mib(f.size)} MiB)`)
  if (files.length + 1 > MAX_FILES) console.error(`  troppi file per un deploy di Pages: ${files.length + 1}`)
  console.error('\n  Non pubblico: Cloudflare rifiuterebbe il deploy.\n')
  process.exit(1)
}

const args = ['--yes', WRANGLER, 'pages', 'deploy', 'public/assets', '--project-name', PROJECT, '--branch', 'main']
console.log(`  comando: npx ${args.slice(1).join(' ')}`)
if (!process.argv.includes('--yes')) {
  console.log('\n  Niente e\' stato pubblicato. Fatto npx wrangler login, rilancia con --yes.\n')
  process.exit(2)
}
const r = spawnSync('npx', args, { stdio: 'inherit', cwd: ROOT })
process.exit(r.status ?? 1)
