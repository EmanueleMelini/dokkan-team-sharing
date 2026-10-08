#!/usr/bin/env node
// Scarica il wikitext delle pagine evento dal wiki Fandom.
// Stessa impostazione di fetch-wiki.mjs: enumerazione da chi include
// Template:Events, cache su disco, richieste educate.
//
//   node db/import/fetch-events.mjs           scarica (usa la cache)
//   node db/import/fetch-events.mjs --count   conta e si ferma
//   node db/import/fetch-events.mjs --fresh   ignora la cache
import { mkdirSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CACHE = join(HERE, '.cache', 'wiki-events.json')
const API = 'https://dbz-dokkanbattle.fandom.com/api.php'
// chi siamo e perche', in chiaro: e' un import settimanale, non un browser
const UA = 'DokkanTeamSharing/0.1 (+https://github.com/EmanueleMelini/dokkan-team-sharing; weekly import)'
const has = (f) => process.argv.includes(f)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function api(params, attempt = 1) {
  const u = new URL(API)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v))
  u.searchParams.set('format', 'json'); u.searchParams.set('formatversion', '2')
  u.searchParams.set('maxlag', '5')
  const res = await fetch(u, { headers: { 'User-Agent': UA } })
  if ((res.status === 503 || res.status === 429) && attempt <= 5) {
    await sleep(1000 * 2 ** attempt); return api(params, attempt + 1)
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const b = await res.json()
  if (b.error?.code === 'maxlag' && attempt <= 5) { await sleep(2000 * attempt); return api(params, attempt + 1) }
  if (b.error) throw new Error(`${b.error.code}: ${b.error.info}`)
  return b
}

if (has('--count')) {
  let total = 0, cont = {}
  do {
    const b = await api({ action: 'query', list: 'embeddedin', eititle: 'Template:Events',
                          einamespace: 0, eilimit: 500, ...cont })
    total += b.query.embeddedin.length
    cont = b.continue ?? null
    if (cont) await sleep(150)
  } while (cont)
  console.log(`  pagine che includono Template:Events: ${total}`)
  process.exit(0)
}

if (existsSync(CACHE) && !has('--fresh')) {
  const c = JSON.parse(readFileSync(CACHE, 'utf8'))
  console.log(`  cache: ${c.pages.length} pagine, scaricate il ${c.fetched_at} (--fresh per riscaricare)`)
  process.exit(0)
}

const pages = []
let cont = {}, batch = 0
do {
  const b = await api({
    action: 'query',
    generator: 'embeddedin', geititle: 'Template:Events',
    geinamespace: 0, geilimit: 50,
    prop: 'revisions', rvprop: 'content', rvslots: 'main',
    ...cont,
  })
  for (const p of b.query?.pages ?? []) {
    const wikitext = p.revisions?.[0]?.slots?.main?.content
    if (wikitext) pages.push({ pageid: p.pageid, title: p.title, wikitext })
  }
  cont = b.continue ?? null
  batch++
  process.stdout.write(`\r  scaricate ${pages.length} pagine (${batch} richieste)`)
  if (cont) await sleep(200)
} while (cont)

console.log()
mkdirSync(dirname(CACHE), { recursive: true })
// prima un file a parte, poi il nome vero: un giro interrotto a meta'
// della scrittura lascia la cache vecchia intera, non una troncata
writeFileSync(CACHE + '.partial', JSON.stringify({
  source: API,
  license: 'CC BY-SA (contenuto del wiki) — attribuzione richiesta',
  fetched_at: new Date().toISOString(),
  pages,
}, null, 0))
renameSync(CACHE + '.partial', CACHE)
console.log(`  salvate in ${CACHE.replace(process.cwd() + '/', '')} (${(readFileSync(CACHE).length / 1e6).toFixed(1)} MB)`)
