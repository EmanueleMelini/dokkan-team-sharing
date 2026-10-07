#!/usr/bin/env node
// Scarica il wikitext di tutte le pagine carta dal wiki Fandom.
//
// Sorgente: l'API MediaWiki pubblica di dbz-dokkanbattle.fandom.com.
// E' la sorgente A MONTE da cui derivano gli altri dataset in giro (quelli
// che ho trovato sono fermi al 2023), ed e' un'API documentata con i suoi
// limiti, non uno scraping di HTML.
//
// L'enumerazione passa da chi include Template:Characters: sono esattamente
// le pagine carta, senza dover indovinare nomi di categorie.
//
// Il contenuto del wiki e' CC BY-SA: va attribuito. Vedi README.
//
//   node db/import/fetch-wiki.mjs            scarica tutto (usa la cache)
//   node db/import/fetch-wiki.mjs --count    conta e si ferma
//   node db/import/fetch-wiki.mjs --fresh    ignora la cache
//   node db/import/fetch-wiki.mjs --limit 200
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CACHE = join(HERE, '.cache', 'wiki-cards.json')
const API = 'https://dbz-dokkanbattle.fandom.com/api.php'
const UA = 'DokkanTeamSharing/0.1 (progetto personale, import una volta)'

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const num = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? Number(argv[i + 1]) : d }
const LIMIT = num('--limit', Infinity)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function api(params, attempt = 1) {
  const url = new URL(API)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
  url.searchParams.set('format', 'json')
  url.searchParams.set('formatversion', '2')
  url.searchParams.set('maxlag', '5')          // buona educazione verso il server
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (res.status === 503 || res.status === 429) {
    if (attempt > 5) throw new Error(`il server continua a rifiutare (${res.status})`)
    const wait = 1000 * 2 ** attempt
    console.log(`    server occupato (${res.status}), riprovo fra ${wait} ms`)
    await sleep(wait)
    return api(params, attempt + 1)
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} su ${url}`)
  const body = await res.json()
  if (body.error) {
    if (body.error.code === 'maxlag' && attempt <= 5) {
      await sleep(2000 * attempt); return api(params, attempt + 1)
    }
    throw new Error(`${body.error.code}: ${body.error.info}`)
  }
  return body
}

if (has('--count')) {
  let total = 0, cont = {}
  do {
    const b = await api({ action: 'query', list: 'embeddedin', eititle: 'Template:Characters',
                          einamespace: 0, eilimit: 500, ...cont })
    total += b.query.embeddedin.length
    cont = b.continue ?? null
    process.stdout.write(`\r  pagine trovate: ${total}`)
    if (cont) await sleep(150)
  } while (cont)
  console.log(`\n  totale pagine che includono Template:Characters: ${total}`)
  process.exit(0)
}

if (existsSync(CACHE) && !has('--fresh')) {
  const cached = JSON.parse(readFileSync(CACHE, 'utf8'))
  console.log(`  cache: ${cached.pages.length} pagine, scaricate il ${cached.fetched_at}`)
  console.log(`  (--fresh per riscaricare)`)
  process.exit(0)
}

const pages = []
let cont = {}
let batch = 0
do {
  const b = await api({
    action: 'query',
    generator: 'embeddedin', geititle: 'Template:Characters',
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
  if (pages.length >= LIMIT) break
  if (cont) await sleep(200)          // ~5 richieste al secondo, non di piu'
} while (cont)

console.log()
mkdirSync(dirname(CACHE), { recursive: true })
writeFileSync(CACHE, JSON.stringify({
  source: API,
  license: 'CC BY-SA (contenuto del wiki) — attribuzione richiesta',
  fetched_at: new Date().toISOString(),
  pages,
}, null, 0))
console.log(`  salvate in ${CACHE.replace(process.cwd() + '/', '')} (${(readFileSync(CACHE).length / 1e6).toFixed(1)} MB)`)
