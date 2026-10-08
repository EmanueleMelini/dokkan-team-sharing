#!/usr/bin/env node
// Scarica gli asset di gioco e li registra in tabella asset.
//
// Le immagini le ospitiamo noi, quindi qui si scaricano davvero. Fandom
// sa ridimensionare e convertire lato server, e conviene approfittarne:
// l'artwork originale di una carta e' circa 1 MB, a 640px di lato lungo
// in WebP sta in ~120 KB. Su 2500 carte la differenza e' fra 2,5 GB e
// 300 MB, ed e' anche piu' educato verso la loro banda.
//
// Idempotente e ripartibile: se la riga in asset esiste, il file c'e' e
// la dimensione combacia, salta. Interromperlo e rilanciarlo riprende.
//
//   node db/import/fetch-assets.mjs                tutto
//   node db/import/fetch-assets.mjs --only icons   solo le icone
//   node db/import/fetch-assets.mjs --only thumb --limit 50
//   node db/import/fetch-assets.mjs --force        riscarica anche se c'e'
//   node db/import/fetch-assets.mjs --offline      solo righe dai file sul disco
//   node db/import/fetch-assets.mjs --missing      solo i job senza riga in asset
//
// --offline serve per la produzione (db/prod/): le immagini le serve
// Cloudflare, il database deve solo avere le righe in asset e i
// collegamenti. Nessun file si scarica, nessun nome si chiede al wiki;
// cio' che non e' sul disco resta senza immagine e viene contato. Le righe
// gia' presenti si collegano anche se il file qui non c'e'.
//
// --missing serve alla CI settimanale: con ASSET_DIR vuoto chiede al wiki
// solo le immagini che non hanno ancora una riga, cioe' quelle nuove.
// IMPORT_POOL_MAX limita le connessioni (il pooler di Supabase ne ammette
// poche per sessione).
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { connectionString, describeTarget } from '../env.mjs'
import { selectJobs } from './asset-select.mjs'
import { assignCardIds, datamineCards, field, lineField } from './wiki-card.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const CACHE = join(HERE, '.cache', 'wiki-cards.json')
const CACHE_EV = join(HERE, '.cache', 'wiki-events.json')
const CACHE_ITEMS = join(HERE, '.cache', 'wiki-items-template.json')
const ASSET_DIR = process.env.ASSET_DIR ?? join(ROOT, 'public', 'assets')
const API = 'https://dbz-dokkanbattle.fandom.com/api.php'
// chi siamo e perche', in chiaro: e' un import settimanale, non un browser
const UA = 'DokkanTeamSharing/0.1 (+https://github.com/EmanueleMelini/dokkan-team-sharing; weekly import)'

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d }
const ONLY = val('--only', 'all')
const LIMIT = Number(val('--limit', Infinity))
const FORCE = has('--force')
const OFFLINE = has('--offline')
const MISSING = has('--missing')
if (OFFLINE && FORCE) { console.error('\n  --offline e --force insieme non hanno senso\n'); process.exit(1) }
if (MISSING && FORCE) { console.error('\n  --missing e --force insieme non hanno senso\n'); process.exit(1) }
// in un job di GitHub Actions ogni immagine mancata diventa un avviso
const CI = process.env.GITHUB_ACTIONS === 'true'
// --only thumb|art include la rispettiva variante animata;
// --only anim prende solo le animate
const want = (k) => ONLY === 'all' || ONLY === k
  || (ONLY === 'anim' && k.startsWith('anim'))

// larghezze scelte: 256 per la miniatura (nitida a 128 CSS su schermi 2x),
// 640 per l'artwork della pagina carta
const WIDTH = { card_thumb: 256, card_art: 640, type_icon: 128, rarity_icon: 160, item_icon: 128,
                event_banner: 640,
                card_thumb_animated: 0, card_art_animated: 0 }   // 0 = niente trasformazione

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// --------------------------------------------------------------- wiki API

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

// risolve i nomi File: negli url veri, 50 alla volta
async function resolve(files) {
  const out = new Map()
  for (let i = 0; i < files.length; i += 50) {
    const b = await api({ action: 'query', prop: 'imageinfo', iiprop: 'url|size|dimensions|mime',
                          titles: files.slice(i, i + 50).map((f) => 'File:' + f).join('|') })
    for (const p of b.query?.pages ?? []) {
      const name = p.title.replace(/^File:/, '')
      const ii = p.imageinfo?.[0]
      // l'url di Fandom e' .../File.png/revision/latest?cb=... e il
      // ridimensionamento si innesta DOPO /revision/latest, non prima:
      // via solo la query string.
      if (ii) out.set(name, ii.url.split('?')[0].replace(/\/$/, ''))
    }
    process.stdout.write(`\r    risolti ${out.size}/${files.length}`)
    await sleep(150)
  }
  console.log()
  return out
}

// ------------------------------------------------------- misura immagini

// Nessuna libreria: le dimensioni si leggono dall'intestazione del file.
// Serve per dare a <img> width e height e non far ballare il layout.
function dimensions(buf) {
  if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16)
    if (chunk === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) }
    if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff }
    if (chunk === 'VP8L') {
      const b = buf.readUInt32LE(21)
      return { width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) }
    }
  }
  if (buf.length > 24 && buf.toString('hex', 0, 8) === '89504e470d0a1a0a') {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }   // PNG IHDR
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {              // JPEG SOF
    let o = 2
    while (o + 9 < buf.length) {
      if (buf[o] !== 0xff) { o++; continue }
      const m = buf[o + 1]
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { height: buf.readUInt16BE(o + 5), width: buf.readUInt16BE(o + 7) }
      }
      o += 2 + buf.readUInt16BE(o + 2)
    }
  }
  return { width: null, height: null }
}

const EXT = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif' }

// Un artwork animato pesa fra i 9 e i 33 MB, ed e' inservibile in pagina.
// Fandom non sa darne un fotogramma statico: il suo ridimensionatore
// converte un WebP animato da 9 MB in un GIF da 33. Il fotogramma si
// estrae qui, con ffmpeg: 32 MB diventano 40 KB.
const isAnimated = (buf, ct) =>
  ct === 'image/gif' || (ct === 'image/webp' && buf.toString('latin1', 0, 4096).includes('ANIM'))

function flatten(buf, width) {
  const src = join(tmpdir(), `dts-in-${process.pid}-${Math.random().toString(36).slice(2)}`)
  const out = src + '.webp'
  try {
    writeFileSync(src, buf)
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src,
      '-frames:v', '1', '-vf', `scale='min(${width},iw)':-1`,
      '-c:v', 'libwebp', '-quality', '82', out], { stdio: 'pipe' })
    return { buf: readFileSync(out), ct: 'image/webp' }
  } finally {
    for (const f of [src, out]) { try { rmSync(f) } catch { /* non c'era */ } }
  }
}

async function download(baseUrl, width, raw = false, attempt = 1) {
  // raw = il file come sta, senza trasformazioni. Serve in due casi
  // opposti: gli APNG di cui vogliamo l'animazione intatta, e le versioni
  // animate che il ridimensionatore di Fandom peggiorerebbe (un WebP
  // animato da 9 MB gli esce come GIF da 33).
  const u = raw ? baseUrl : `${baseUrl}/scale-to-width-down/${width}?format=webp`
  const res = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'image/webp,image/*' } })
  // Il ridimensionamento lo fa Fandom al volo e a volte va in timeout:
  // 504 e 502 sono transitori, non "il file non c'e'". Si ritenta.
  if ([502, 503, 504, 429].includes(res.status) && attempt <= 4) {
    await sleep(800 * 2 ** attempt)
    return download(baseUrl, width, raw, attempt + 1)
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  let buf = Buffer.from(await res.arrayBuffer())
  let ct = (res.headers.get('content-type') ?? '').split(';')[0].trim()
  if (!raw && isAnimated(buf, ct)) ({ buf, ct } = flatten(buf, width))
  return { buf, ct, url: u }
}

// ------------------------------------------------------------- lavoro

const { pages } = JSON.parse(readFileSync(CACHE, 'utf8'))
// I nomi dei file nel wikitext arrivano in forme diverse: con underscore
// invece degli spazi, e a volte percent-encoded ("HQ%2B" per "HQ+").
// MediaWiki normalizza gli underscore, non le percentuali: le decodifichiamo
// noi, altrimenti quei file non si risolvono.
const normalizeFile = (n) => {
  let t = n.replace(/_/g, ' ').replace(/\s+/g, ' ').trim()   // anche i doppi spazi
  if (/%[0-9A-Fa-f]{2}/.test(t)) { try { t = decodeURIComponent(t) } catch { /* lasciamolo com'e' */ } }
  return t.charAt(0).toUpperCase() + t.slice(1)
}
const fileIn = (s) => { const m = (s ?? '').match(/\[\[\s*[Ff]ile:\s*([^\]|]+?)\s*(?:\||\]\])/); return m ? normalizeFile(m[1]) : null }

const url = connectionString()
console.log(`  database: ${describeTarget()}`)
// Un pool e non un Client: i worker scaricano in parallelo e ognuno
// scrive la sua riga in asset. Su un Client solo, node-postgres mette in
// coda le query e avvisa che in pg@9 non lo fara' piu'.
const pool = new pg.Pool({ connectionString: url, max: Number(process.env.IMPORT_POOL_MAX) || 10 })
const client = { query: (...a) => pool.query(...a) }

// L'URL diretto dei thumb animati: certe pagine (quasi tutte le LR) non
// scrivono un [[File:...]] ma incollano l'URL dell'APNG. Da li' si ricava
// sia l'URL da usare, sia il nome del file statico corrispondente.
const directUrlIn = (s) => {
  const m = (s ?? '').match(/https?:\/\/[^\s|\]]+/)
  return m ? m[0].split('?')[0] : null
}

// Solo le carte che sono davvero in tabella: quelle scartate dall'import
// non devono portarsi dietro un'immagine orfana.
//
// Il criterio e' wiki_title, NON imported_from: i nomi dei file immagine
// si ricavano dal wikitext, quindi la domanda giusta e' "questa carta ha
// una pagina wiki", non "da dove vengono i suoi dati". Prima filtravo su
// imported_from='wiki' e quando load-datamine ha riscritto quel campo a
// 'datamine' le immagini collegate sono crollate da 2632 a 1371, in
// silenzio.
const { rows: known } = await client.query('select id from card where wiki_title is not null')
const knownIds = new Set(known.map((r) => Number(r.id)))

const jobs = []
if (want('thumb') || want('art') || ONLY === 'anim') {
  // L'id lo decide wiki-card.mjs, lo stesso codice di load-cards: le carte
  // che hanno l'id dal campo |ID (le Metal Cooler, le LR senza un file col
  // numero) qui altrimenti non si riconoscerebbero, e resterebbero senza
  // immagini. I campi immagine si leggono sulla loro riga (lineField): un
  // "|artwork =" vuoto non deve prendersi la riga dopo.
  const ids = assignCardIds(pages, datamineCards())
  for (const p of pages) {
    const id = ids.get(p.pageid)?.id
    if (!id || !knownIds.has(id)) continue
    // Ogni job porta piu' candidati: il [[File:]] scritto sulla pagina
    // quando c'e', e in ogni caso i nomi per convenzione ricavati
    // dall'id. Vince il primo che il wiki riesce a risolvere.
    if (want('thumb') || ONLY === 'anim') {
      const files = [fileIn(lineField(p.wikitext, 'thumb')),
                     `Card ${id} thumb.png`].filter(Boolean)
      if (ONLY !== 'anim') jobs.push({ kind: 'card_thumb', files, keyBase: `cards/${id}/thumb`,
                  card: id, col: 'thumb_key',
                  directUrl: directUrlIn(lineField(p.wikitext, 'thumb apng')) })
      const animT = directUrlIn(lineField(p.wikitext, 'thumb apng'))
      if (animT && (want('thumb') || ONLY === 'anim')) jobs.push({ kind: 'card_thumb_animated', files: [], raw: true,
                             keyBase: `cards/${id}/thumb-animated`, card: id,
                             col: 'thumb_animated_key', directUrl: animT })
    }
    if (want('art') || ONLY === 'anim') {
      const files = [fileIn(lineField(p.wikitext, 'artwork')), fileIn(lineField(p.wikitext, 'bg')),
                     `Card ${id} artwork.png`, `Card ${id} bg.png`].filter(Boolean)
      if (ONLY !== 'anim') jobs.push({ kind: 'card_art', files, keyBase: `cards/${id}/art`,
                  card: id, col: 'art_key',
                  directUrl: directUrlIn(lineField(p.wikitext, 'artwork apng')) })
      const animA = directUrlIn(lineField(p.wikitext, 'artwork apng'))
      if (animA && (want('art') || ONLY === 'anim')) jobs.push({ kind: 'card_art_animated', files: [], raw: true,
                             keyBase: `cards/${id}/art-animated`, card: id,
                             col: 'art_animated_key', directUrl: animA })
    }
  }
}
// I banner degli eventi: il nome del file sta nel template Events, e
// gli id sono i pageid del wiki, gli stessi che usa load-events.
if (want('banners') && existsSync(CACHE_EV)) {
  const { rows: evs } = await client.query(
    'select id, wiki_title from event where wiki_title is not null')
  const byTitle = new Map(evs.map((r) => [r.wiki_title, Number(r.id)]))
  const { pages: evPages } = JSON.parse(readFileSync(CACHE_EV, 'utf8'))
  for (const p of evPages) {
    const id = byTitle.get(p.title)
    if (!id) continue
    const f = (field(p.wikitext, 'Event Image') ?? '')
      .replace(/\[\[File:/i, '').replace(/[|\]].*$/, '').trim()
    if (!f) continue
    jobs.push({ kind: 'event_banner', files: [normalizeFile(f)],
                keyBase: `events/${id}/banner`, event: id, evCol: 'banner_key' })
  }
}

// Gli oggetti che gli eventi danno come drop: il template ItemsEvent e'
// un grande switch nome -> immagini, e da li' si ricava un'icona per
// ciascuno. Sono i drop mostrati sulle pagine evento (orb, pesi, medaglie),
// NON i premi delle missioni: quelli il wiki non li ha.
// Il template si tiene in cache: --offline lo rilegge da li'. Se la
// cache manca si scarica una volta il solo testo (una richiesta), perche'
// senza i nomi degli oggetti le missioni restano senza icone.
async function itemsTemplate() {
  if (OFFLINE && existsSync(CACHE_ITEMS)) return JSON.parse(readFileSync(CACHE_ITEMS, 'utf8')).content
  const b = await api({ action: 'query', prop: 'revisions', rvprop: 'content',
                        rvslots: 'main', titles: 'Template:ItemsEvent' })
  const content = b.query?.pages?.[0]?.revisions?.[0]?.slots?.main?.content ?? ''
  if (content) writeFileSync(CACHE_ITEMS, JSON.stringify({ fetched_at: new Date().toISOString(), content }))
  return content
}
if (want('items')) {
  const src = await itemsTemplate()
  // ogni ramo dello switch: |<Nome>=...[[File:<icona>|...
  const branches = src.split(/\|(?=[A-Z][^=|{}]{2,30}=)/).slice(1)
  const seen = new Set()
  for (const br of branches) {
    const name = br.slice(0, br.indexOf('=')).trim()
    const file = br.match(/\[\[File:\s*([^\]|]+?)\s*[|\]]/i)?.[1]
    if (!name || !file || seen.has(name)) continue
    seen.add(name)
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    jobs.push({ kind: 'item_icon', files: [normalizeFile(file)],
                keyBase: `icons/item/${slug}`, item: { slug, name } })
  }
  console.log(`  ${seen.size} oggetti trovati nel template ItemsEvent`)
}

if (want('icons')) {
  const CLS = { Super: 'S', Extreme: 'E' }
  for (const type of ['AGL', 'TEQ', 'INT', 'STR', 'PHY']) {
    for (const cls of ['Super', 'Extreme']) {
      jobs.push({ kind: 'type_icon', files: [`${CLS[cls]}${type} icon.png`],
                  keyBase: `icons/type/${CLS[cls]}${type}`, typeIcon: { type, cls } })
    }
  }
  // N..UR seguono la convenzione "<rarita'> icon.png"; LR no, sta sotto
  // in due versioni (vedi migrazione 0005).
  for (const rarity of ['N', 'R', 'SR', 'SSR', 'UR']) {
    jobs.push({ kind: 'rarity_icon', files: [`${rarity} icon.png`],
                keyBase: `icons/rarity/${rarity}`, rarityIcon: rarity })
  }
  // LR: la statica per le liste, l'animata per la pagina della carta
  jobs.push({ kind: 'rarity_icon', files: ['LR logo apng.png'],
              keyBase: 'icons/rarity/LR', rarityIcon: 'LR' })
  jobs.push({ kind: 'rarity_icon', files: ['LR logo apng.png'], raw: true,
              keyBase: 'icons/rarity/LR-animated', rarityAnimated: 'LR' })
  jobs.push({ kind: 'item_icon', files: ['Stone.png'], keyBase: 'icons/item/dragon-stone',
              item: { slug: 'dragon-stone', name: 'Dragon Stone' } })
  jobs.push({ kind: 'item_icon', files: ['Zeni.png'], keyBase: 'icons/item/zeni',
              item: { slug: 'zeni', name: 'Zeni' } })
}

// Riparazione: gli asset animati salvati prima che ci fosse il flatten.
// Si convertono dal file locale, senza riscaricare niente.
if (has('--flatten-existing')) {
  const { rows } = await client.query(`
    select key, kind, source_url from asset
    where kind <> 'rarity_icon' and (content_type = 'image/gif' or width is null)
    order by key`)
  console.log(`  ${rows.length} asset animati da appiattire`)
  let fixed = 0, before = 0, after = 0
  for (const r of rows) {
    const oldPath = join(ASSET_DIR, r.key)
    if (!existsSync(oldPath)) { console.log(`    manca sul disco: ${r.key}`); continue }
    const src = readFileSync(oldPath)
    before += src.length
    const { buf, ct } = flatten(src, WIDTH[r.kind] ?? 640)
    after += buf.length
    const key = r.key.replace(/\.[^.]+$/, '.webp')
    writeFileSync(join(ASSET_DIR, key), buf)
    const { width, height } = dimensions(buf)
    const tx0 = await pool.connect()
    try {
      await tx0.query('begin')
      await tx0.query(`
        insert into asset (key, kind, content_type, byte_size, width, height, checksum, source_url, fetched_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8, now())
        on conflict (key) do update set
          content_type = excluded.content_type, byte_size = excluded.byte_size,
          width = excluded.width, height = excluded.height, checksum = excluded.checksum`,
        [key, r.kind, ct, buf.length, width, height,
         createHash('sha256').update(buf).digest('hex'), r.source_url])
      if (key !== r.key) {
        await tx0.query('update card set art_key = $1 where art_key = $2', [key, r.key])
        await tx0.query('update card set thumb_key = $1 where thumb_key = $2', [key, r.key])
        await tx0.query('delete from asset where key = $1', [r.key])
      }
      await tx0.query('commit')
      if (key !== r.key) rmSync(oldPath)
      fixed++
    } catch (err) {
      await tx0.query('rollback'); console.log(`    ${r.key}: ${err.message}`)
    } finally { tx0.release() }
    if (fixed % 20 === 0) process.stdout.write(`\r    ${fixed}/${rows.length}`)
  }
  console.log(`\r    ${fixed} appiattiti: da ${(before / 1e6).toFixed(0)} MB a ${(after / 1e6).toFixed(1)} MB`)
  await pool.end()
  process.exit(0)
}

// quali sono gia' a posto
const { rows: existing } = await client.query('select key, byte_size, source_url from asset')
const have = new Map(existing.map((r) => [r.key, r]))

const { todo, kept, dropped } = selectJobs(jobs, have.keys(), { missing: MISSING, offline: OFFLINE })
if (MISSING) console.log(`  --missing: ${dropped} hanno gia' la riga, restano ${todo.length}`)
const capped = todo.slice(0, LIMIT === Infinity ? todo.length : LIMIT)
console.log(`  ${capped.length} asset da considerare${capped.length < todo.length ? ` (di ${todo.length}, --limit)` : ''}` +
            (kept.length ? `, ${kept.length} gia' in tabella (collegati senza guardare il disco)` : ''))

// Quali mancano davvero: se il file e' sul disco non serve chiedere al
// wiki dove sta. Su un db:reset questo evita 2430 richieste inutili.
const onDisk = (job) => {
  const dir = join(ASSET_DIR, dirname(job.keyBase))
  if (!existsSync(dir)) return false
  const want = job.keyBase.split('/').pop() + '.'
  return readdirSync(dir).some((f) => f.startsWith(want))
}
const needsWiki = OFFLINE ? [] : FORCE ? capped : capped.filter((j) => !onDisk(j))
const files = [...new Set(needsWiki.flatMap((j) => j.files))]
console.log(OFFLINE ? '  offline: niente da chiedere al wiki'
  : `  ${capped.length - needsWiki.length} gia' sul disco, ${files.length} file da risolvere sul wiki`)
const urls = files.length ? await resolve(files) : new Map()
const orfani = needsWiki.filter((j) => !j.files.some((f) => urls.has(f)) && !j.directUrl)
if (orfani.length) console.log(`  senza nessuna immagine: ${orfani.length} (${orfani.slice(0, 3).map((j) => j.keyBase).join(', ')})`)
if (CI && orfani.length) console.log(`::warning::${orfani.length} images have no source on the wiki (first: ${orfani.slice(0, 5).map((j) => j.keyBase).join(', ')})`)

let done = 0, skipped = kept.length, adoptedN = 0, failed = 0, bytes = 0
const results = [...kept]

// Il file c'e' sul disco ma la riga in asset no. Succede a ogni db:reset,
// che ricrea il database ma non tocca public/assets. Riscaricare mezzo
// giga per ricostruire delle righe che si possono ricavare dal file
// stesso e' spreco: lo si riadotta.
async function adoptFromDisk(job) {
  const dir = join(ASSET_DIR, dirname(job.keyBase))
  if (!existsSync(dir)) return null
  const want = job.keyBase.split('/').pop() + '.'
  const found = readdirSync(dir).find((f) => f.startsWith(want))
  if (!found) return null
  const key = `${dirname(job.keyBase)}/${found}`
  const buf = readFileSync(join(ASSET_DIR, key))
  if (!buf.length) return null
  const ext = found.split('.').pop()
  const ct = Object.entries(EXT).find(([, e]) => e === ext)?.[0] ?? 'application/octet-stream'
  const { width, height } = dimensions(buf)
  await client.query(`
    insert into asset (key, kind, content_type, byte_size, width, height, checksum, source_url, fetched_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8, now())
    on conflict (key) do update set
      kind = excluded.kind, content_type = excluded.content_type,
      byte_size = excluded.byte_size, width = excluded.width, height = excluded.height,
      checksum = excluded.checksum`,
    [key, job.kind, ct, buf.length, width, height,
     createHash('sha256').update(buf).digest('hex'), null])
  return key
}

async function run(job) {
  // il primo candidato che il wiki ha risolto; se nessuno, l'URL diretto
  const base = job.files.map((f) => urls.get(f)).find(Boolean) ?? job.directUrl
  try {
    // se la riga c'e' e il file su disco combacia, non si riscarica
    const guess = [...have.keys()].find((k) => k.startsWith(job.keyBase + '.'))
    if (!FORCE && guess) {
      const p = join(ASSET_DIR, guess)
      if (existsSync(p) && statSync(p).size === have.get(guess).byte_size) {
        skipped++; results.push({ ...job, key: guess }); return
      }
    }
    if (!FORCE) {
      const adopted = await adoptFromDisk(job)
      if (adopted) { adoptedN++; results.push({ ...job, key: adopted }); return }
    }
    if (OFFLINE) { failed++; return }   // non e' sul disco: qui non si scarica
    if (!base) { failed++; return }
    const { buf, ct, url: from } = await download(base, WIDTH[job.kind], Boolean(job.raw))
    const key = `${job.keyBase}.${EXT[ct] ?? 'bin'}`
    const dest = join(ASSET_DIR, key)
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, buf)
    const { width, height } = dimensions(buf)
    await client.query(`
      insert into asset (key, kind, content_type, byte_size, width, height, checksum, source_url, fetched_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8, now())
      on conflict (key) do update set
        kind = excluded.kind, content_type = excluded.content_type,
        byte_size = excluded.byte_size, width = excluded.width, height = excluded.height,
        checksum = excluded.checksum, source_url = excluded.source_url, fetched_at = now()`,
      [key, job.kind, ct, buf.length, width, height,
       createHash('sha256').update(buf).digest('hex'), from])
    bytes += buf.length; done++
    results.push({ ...job, key })
  } catch (err) {
    failed++
    // un 403 della CDN del wiki non si ritenta (download() ritenta solo i
    // 5xx e i 429): insistere e' cio' che fa salire un controllo anti-bot
    if (CI && failed <= 40) console.log(`::warning::image not downloaded: ${job.keyBase} (${err.message})`)
    else if (failed <= 8) console.log(`\n    ${job.files[0]}: ${err.message}`)
  }
}

// otto in parallelo: sono file statici su CDN, non chiamate all'API
const CONC = 8
const queue = [...capped]
await Promise.all(Array.from({ length: CONC }, async () => {
  while (queue.length) {
    await run(queue.shift())
    const n = done + skipped - kept.length + adoptedN + failed
    // il contatore che si riscrive solo su un terminale: in un log di CI sarebbero migliaia di righe
    if (process.stdout.isTTY && n % 50 === 0) process.stdout.write(`\r    ${n}/${capped.length}  scaricati ${done}, dal disco ${adoptedN}, saltati ${skipped}, falliti ${failed}, ${(bytes / 1e6).toFixed(0)} MB`)
  }
}))
console.log(`\r    ${capped.length}/${capped.length}  scaricati ${done}, ripresi dal disco ${adoptedN}, saltati ${skipped}, ${OFFLINE ? 'non sul disco' : 'falliti'} ${failed}, ${(bytes / 1e6).toFixed(1)} MB          `)

// --------------------------------------------------- collegamenti

// la transazione finale deve stare su una connessione sola
const tx = await pool.connect()
await tx.query('begin')
try {
  const evCols = { banner_key: [] }
  for (const r of results) if (r.evCol) evCols[r.evCol].push([r.event, r.key])
  for (const [col, pairs] of Object.entries(evCols)) {
    if (!pairs.length) continue
    await tx.query(`update event set ${col} = m.k
      from (select * from unnest($1::bigint[], $2::text[]) as t(id, k)) m
      where event.id = m.id`, [pairs.map((p) => p[0]), pairs.map((p) => p[1])])
    console.log(`  event.${col}: ${pairs.length} collegati`)
  }

  const cardCols = { thumb_key: [], art_key: [], thumb_animated_key: [], art_animated_key: [] }
  for (const r of results) if (r.col) cardCols[r.col].push([r.card, r.key])
  for (const [col, pairs] of Object.entries(cardCols)) {
    if (!pairs.length) continue
    await tx.query(`update card set ${col} = m.k
      from (select * from unnest($1::bigint[], $2::text[]) as t(id, k)) m
      where card.id = m.id`, [pairs.map((p) => p[0]), pairs.map((p) => p[1])])
    console.log(`  card.${col}: ${pairs.length} collegate`)
  }
  const ti = results.filter((r) => r.typeIcon)
  if (ti.length) {
    await tx.query(`insert into type_icon (type, class, asset_key)
      select * from unnest($1::unit_type[], $2::unit_class[], $3::text[])
      on conflict (type, class) do update set asset_key = excluded.asset_key`,
      [ti.map((r) => r.typeIcon.type), ti.map((r) => r.typeIcon.cls), ti.map((r) => r.key)])
    console.log(`  icone tipo+classe: ${ti.length}`)
  }
  const ri = results.filter((r) => r.rarityIcon)
  if (ri.length) {
    await tx.query(`insert into rarity_icon (rarity, asset_key)
      select * from unnest($1::rarity[], $2::text[])
      on conflict (rarity) do update set asset_key = excluded.asset_key`,
      [ri.map((r) => r.rarityIcon), ri.map((r) => r.key)])
    console.log(`  icone rarita': ${ri.length}`)
  }
  const ra = results.filter((r) => r.rarityAnimated)
  if (ra.length) {
    await tx.query(`update rarity_icon set animated_asset_key = m.k
      from (select * from unnest($1::rarity[], $2::text[]) as t(r, k)) m
      where rarity_icon.rarity = m.r`,
      [ra.map((r) => r.rarityAnimated), ra.map((r) => r.key)])
    console.log(`  icone rarita' animate: ${ra.length}`)
  }

  const it = results.filter((r) => r.item)
  for (const r of it) {
    await tx.query(`insert into reward_item (slug, asset_key) values ($1,$2)
      on conflict (slug) do update set asset_key = excluded.asset_key`, [r.item.slug, r.key])
    await tx.query(`insert into reward_item_text (slug, locale, name) values ($1,'en',$2)
      on conflict (slug, locale) do update set name = excluded.name`, [r.item.slug, r.item.name])
  }
  if (it.length) console.log(`  oggetti premio: ${it.length}`)
  await tx.query('commit')
} catch (err) {
  await tx.query('rollback')
  console.error(`\n  collegamento fallito: ${err.message}\n`)
  tx.release(); await pool.end(); process.exit(1)
}
tx.release()
await pool.end()
console.log('\n  fatto.')
