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
//   node db/import/fetch-assets.mjs --missing --report esito.json
//   node db/import/fetch-assets.mjs --plan piano.json   solo il piano, niente download
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
//
// --plan (implica --missing) serve al giro giornaliero delle immagini
// (daily-images.yml), sulla produzione: legge in una transazione read only,
// chiede all'API del wiki quali file esistono e quanto pesano, scrive il
// piano in JSON ed esce prima di scaricare. Nessun file, nessuna riga: e'
// quello che il giro mostra quando WEEKLY_APPLY e' spento. --report scrive
// invece, a giro finito, quanto e' successo (scaricati, sfidati, mancanti):
// lo leggono i riepiloghi della CI.
//
// Con ASSET_MANIFEST ogni download aggiunge una riga JSON (chiave, fonte,
// URL, checksum) a quel file, che sta fuori da ASSET_DIR e non si
// pubblica. L'adozione dal disco lo rilegge: in produzione la riga di
// asset prende cosi' lo stesso source_url del giro di prova (0033).
//
// Le miniature ferme (0034): ogni riga card_thumb scritta qui, scaricata o
// adottata dal disco, porta asset.frame, la cornice misurata dai pixel del
// file (asset-cornice.mjs). Le righe che restano come sono non si misurano:
// il giro di prova (senza i file) e la produzione (con l'albero intero)
// cosi' scrivono lo stesso. Fra le due miniature di una carta, la ferma
// (cards/<id>/thumb) e quella con la cornice (cards/<id>/thumb-framed),
// card.thumb_key prende quella che dice miniaturaVincente (asset-jobs.mjs).
//
// Un 403 della CDN del wiki e' un controllo anti-bot (Cloudflare): al primo
// si smette di scaricare, il resto si conta come "sfidato" e lo riprova il
// giro di domani. Mai un altro User-Agent, mai un aggiramento. I 5xx, i 429
// e i timeout invece si ritentano (asset-select.mjs: esitoHttp).
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { connectionString, describeTarget } from '../env.mjs'
import { cardJobs, cartaDellaFerma, collegaMiniature, normalizeFile } from './asset-jobs.mjs'
import { cornice } from './asset-cornice.mjs'
import { ANIM_ART_BUDGET, AVVISO_PCT, decisioneAnimato, mib } from './asset-limits.mjs'
import {
  ASSET_ADOTTA_SQL, ASSET_SCARICA_SQL, MAX_RITENTI, attesaRitento, esitoHttp, provenienza, selectJobs, siMuove,
} from './asset-select.mjs'
import { assignCardIds, datamineCards, field } from './wiki-card.mjs'

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
const PLAN = has('--plan') ? val('--plan', '') : null
const REPORT = val('--report', null)
const MISSING = has('--missing') || PLAN !== null
const MANIFEST = process.env.ASSET_MANIFEST || null
if (OFFLINE && FORCE) { console.error('\n  --offline e --force insieme non hanno senso\n'); process.exit(1) }
if (MISSING && FORCE) { console.error('\n  --missing e --force insieme non hanno senso\n'); process.exit(1) }
// il piano non scrive: niente che possa scaricare o toccare il database
if (PLAN !== null && (!PLAN || PLAN.startsWith('--'))) { console.error('\n  --plan vuole il file del piano\n'); process.exit(1) }
if (PLAN && (OFFLINE || has('--flatten-existing'))) { console.error('\n  --plan e\' solo lettura: niente --offline ne\' --flatten-existing\n'); process.exit(1) }
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

// Un errore che dice cosa e' successo: esito e' quello di esitoHttp
const errore = (msg, esito) => Object.assign(new Error(msg), { esito })

// Una richiesta GET con i ritenti: i transitori (5xx, 429, timeout, rete)
// con attese che raddoppiano, gli altri subito all'indietro. leggi() legge
// il corpo dentro lo stesso tentativo: un timeout a meta' e' transitorio.
async function getConRitenti(u, headers, timeoutMs, leggi) {
  for (let n = 0; ; n++) {
    let res, corpo
    try {
      res = await fetch(u, { headers, signal: AbortSignal.timeout(timeoutMs) })
      if (res.ok) corpo = await leggi(res)
    } catch (err) {
      if (n < MAX_RITENTI) { await sleep(attesaRitento(n + 1)); continue }
      throw errore(`rete: ${err.name}`, 'transitorio')
    }
    const esito = esitoHttp(res.status)
    if (esito === 'ok') return { res, corpo }
    await res.body?.cancel().catch(() => {})
    if (esito === 'transitorio' && n < MAX_RITENTI) {
      await sleep(attesaRitento(n + 1, res.headers.get('retry-after'))); continue
    }
    throw errore(`HTTP ${res.status}`, esito)
  }
}

async function api(params, attempt = 1) {
  const u = new URL(API)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v))
  u.searchParams.set('format', 'json'); u.searchParams.set('formatversion', '2')
  u.searchParams.set('maxlag', '5')
  const { corpo: b } = await getConRitenti(u, { 'User-Agent': UA }, 30000, (r) => r.json())
  if (b.error?.code === 'maxlag' && attempt <= 5) { await sleep(2000 * attempt); return api(params, attempt + 1) }
  if (b.error) throw new Error(`${b.error.code}: ${b.error.info}`)
  return b
}

// Se l'API del wiki ha risposto 403 (un controllo anti-bot), o non ha
// risposto nemmeno dopo i ritenti: da li' non le si chiede piu' niente in
// questo giro, e cio' che resta da risolvere e' "sfidato", non "assente".
// Il giro dopo riprova; un altro errore invece ferma lo script.
let apiSfidata = false, apiFerma = false
function sfidaApi(err) {
  if (err.esito !== 'sfida' && err.esito !== 'transitorio') throw err
  if (!apiFerma) {
    const perche = err.esito === 'sfida' ? '403 (anti-bot challenge)' : `no answer (${err.message})`
    console.log(CI ? `::warning::the wiki API answered ${perche}: the rest waits for the next run`
                   : `\n  l'API del wiki: ${perche}, il resto aspetta il prossimo giro`)
  }
  if (err.esito === 'sfida') apiSfidata = true
  apiFerma = true
}

// risolve i nomi File: negli url veri e nel loro peso, 50 alla volta
async function resolve(files) {
  const out = new Map()
  for (let i = 0; i < files.length && !apiFerma; i += 50) {
    let b
    try {
      b = await api({ action: 'query', prop: 'imageinfo', iiprop: 'url|size|dimensions|mime',
                      titles: files.slice(i, i + 50).map((f) => 'File:' + f).join('|') })
    } catch (err) { sfidaApi(err); break }
    for (const p of b.query?.pages ?? []) {
      const name = p.title.replace(/^File:/, '')
      const ii = p.imageinfo?.[0]
      // l'url di Fandom e' .../File.png/revision/latest?cb=... e il
      // ridimensionamento si innesta DOPO /revision/latest, non prima:
      // via solo la query string. size e' il file originale: per gli
      // animati, che si scaricano cosi' come sono, e' il peso vero.
      if (ii) out.set(name, { url: ii.url.split('?')[0].replace(/\/$/, ''), size: Number(ii.size) || null })
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
// estrae qui, con ffmpeg: 32 MB diventano 40 KB. Lo stesso controllo di
// siMuove, che riconosce anche un APNG (acTL): la miniatura con la cornice
// viene da un APNG, e se il ridimensionatore lo restituisse com'e' un
// fotogramma fermo deve uscirne comunque.
const isAnimated = (buf, ct) => ct === 'image/gif' || siMuove(buf.subarray(0, 65536))

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

async function download(baseUrl, width, raw = false) {
  // raw = il file come sta, senza trasformazioni. Serve in due casi
  // opposti: gli APNG di cui vogliamo l'animazione intatta, e le versioni
  // animate che il ridimensionatore di Fandom peggiorerebbe (un WebP
  // animato da 9 MB gli esce come GIF da 33).
  const u = raw ? baseUrl : `${baseUrl}/scale-to-width-down/${width}?format=webp`
  // Il ridimensionamento lo fa Fandom al volo e a volte va in timeout:
  // 504 e 502 sono transitori, non "il file non c'e'". Si ritenta, con un
  // minuto al massimo per tentativo. Un 403 no: torna 'sfida' a chi chiama.
  const { res, corpo } = await getConRitenti(u, { 'User-Agent': UA, Accept: 'image/webp,image/*' }, 60000,
    async (r) => Buffer.from(await r.arrayBuffer()))
  let buf = corpo
  let ct = (res.headers.get('content-type') ?? '').split(';')[0].trim()
  if (!raw && isAnimated(buf, ct)) ({ buf, ct } = flatten(buf, width))
  return { buf, ct, url: u }
}

// ------------------------------------------------------------- lavoro

const { pages } = JSON.parse(readFileSync(CACHE, 'utf8'))
// normalizeFile, fileIn e i nomi per convenzione stanno in asset-jobs.mjs

const url = connectionString()
console.log(`  database: ${describeTarget()}`)
// Un pool e non un Client: i worker scaricano in parallelo e ognuno
// scrive la sua riga in asset. Su un Client solo, node-postgres mette in
// coda le query e avvisa che in pg@9 non lo fara' piu'.
// Con --plan una connessione sola, in una transazione read only: anche
// per sbaglio, da qui non parte una scrittura.
const pool = PLAN ? null : new pg.Pool({ connectionString: url, max: Number(process.env.IMPORT_POOL_MAX) || 10 })
const ro = PLAN ? new pg.Client({ connectionString: url }) : null
if (ro) { await ro.connect(); await ro.query('begin transaction read only') }
const client = { query: (...a) => (ro ?? pool).query(...a) }

// Le carte che sono davvero in tabella, tutte: quelle scartate dall'import
// non devono portarsi dietro un'immagine orfana. Una carta qualifica perche'
// c'e', non perche' ha una pagina: i nomi dei suoi file vengono dalla
// pagina quando c'e', altrimenti dalla convenzione del wiki (asset-jobs.mjs).
// Prima si chiedevano solo le carte con wiki_title, e le 46 solo del
// datamine restavano senza immagini anche se il wiki le aveva.
//
// Mai imported_from: quando load-datamine ha riscritto quel campo a
// 'datamine' le immagini collegate erano crollate da 2632 a 1371, in
// silenzio.
//
// La 0034 prima di tutto: senza asset.frame le letture qui sotto e le
// scritture delle righe fallirebbero a meta' giro. Lo stesso controllo vale
// per il piano, che gira sulla produzione prima del giro di prova.
const { rows: [{ n: conFrame }] } = await client.query(`
  select count(*)::int as n from information_schema.columns
  where table_schema = current_schema() and table_name = 'asset' and column_name = 'frame'`)
if (!conFrame) {
  console.error('\n  manca asset.frame: applica prima la migrazione 0034 (npm run db:up, in produzione npm run prod:migrate -- --yes)\n')
  if (ro) { await ro.query('rollback'); await ro.end() } else await pool.end()
  process.exit(1)
}
const { rows: known } = await client.query('select id, rarity::text as rarity from card')
const cardIds = new Set(known.map((r) => Number(r.id)))
// la rarita' (una LR chiede anche la miniatura con la cornice) e le carte
// la cui miniatura ferma e' misurata nuda (asset-jobs.mjs, cardJobs)
const rarity = new Map(known.map((r) => [Number(r.id), r.rarity]))
const { rows: nude } = await client.query(`select key from asset where kind = 'card_thumb' and frame = false`)
const spoglie = new Set(nude.map((r) => cartaDellaFerma(r.key)).filter((id) => id != null))

const jobs = []
const thumbs = want('thumb') || ONLY === 'anim'
const arts = want('art') || ONLY === 'anim'
if (thumbs || arts) {
  // L'id lo decide wiki-card.mjs, lo stesso codice di load-cards: le carte
  // che hanno l'id dal campo |ID (le Metal Cooler, le LR senza un file col
  // numero) o da una pagina abbozzata qui altrimenti non si
  // riconoscerebbero, e prenderebbero solo i nomi per convenzione.
  const ids = assignCardIds(pages, datamineCards())
  jobs.push(...cardJobs({ pages, ids, cardIds, rarity, spoglie, still: ONLY !== 'anim', thumbs, arts }))
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
// Il piano lo legge dalla cache e non la riscrive.
async function itemsTemplate() {
  if ((OFFLINE || PLAN) && existsSync(CACHE_ITEMS)) return JSON.parse(readFileSync(CACHE_ITEMS, 'utf8')).content
  let b
  try {
    b = await api({ action: 'query', prop: 'revisions', rvprop: 'content',
                    rvslots: 'main', titles: 'Template:ItemsEvent' })
  } catch (err) { sfidaApi(err); return '' }
  const content = b.query?.pages?.[0]?.revisions?.[0]?.slots?.main?.content ?? ''
  if (content && !PLAN) writeFileSync(CACHE_ITEMS, JSON.stringify({ fetched_at: new Date().toISOString(), content }))
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
// Si convertono dal file locale, senza riscaricare niente. Le versioni
// animate delle carte sono escluse: devono muoversi, e appiattirle le
// lasciava collegate come animate ma ferme (82 artwork e 171 miniature).
if (has('--flatten-existing')) {
  const { rows } = await client.query(`
    select key, kind, source, source_url from asset
    where kind not in ('rarity_icon', 'card_thumb_animated', 'card_art_animated')
      and (content_type = 'image/gif' or width is null)
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
        insert into asset (key, kind, content_type, byte_size, width, height, checksum, source, source_url, fetched_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
        on conflict (key) do update set
          content_type = excluded.content_type, byte_size = excluded.byte_size,
          width = excluded.width, height = excluded.height, checksum = excluded.checksum`,
        [key, r.kind, ct, buf.length, width, height,
         createHash('sha256').update(buf).digest('hex'), r.source, r.source_url])
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
const { rows: existing } = await client.query('select key, byte_size, source_url, frame from asset')
const have = new Map(existing.map((r) => [r.key, r]))
const rigaDi = (job) => [...have.keys()].find((k) => k.startsWith(job.keyBase + '.'))

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

// il primo candidato che il wiki ha risolto ([nome, { url, size }]); se
// nessuno, l'URL diretto della pagina
const sceltoPer = (job) => job.files.map((f) => (urls.has(f) ? [f, urls.get(f)] : null)).find(Boolean) ?? null
const fonteDi = (job) => sceltoPer(job)?.[1].url ?? job.directUrl ?? null

// Senza nessuna fonte. Se la pagina dichiarava un file e' un avviso (il
// file e' sparito, o il parser si e' rotto); se c'erano solo i nomi per
// convenzione e' normale: il wiki non ha ancora l'immagine, e il giro dopo
// la richiede (costa un paio di richieste all'API). Con l'API sfidata non
// si sa: si conta come sfidato, non come mancante.
const orfani = apiFerma ? [] : needsWiki.filter((j) => !fonteDi(j))
const muti = orfani.filter((j) => j.quiet), rumorosi = orfani.filter((j) => !j.quiet)
const sfidatiApi = apiFerma ? needsWiki.filter((j) => !fonteDi(j)).length : 0
const carteMute = new Set(muti.map((j) => j.card ?? j.keyBase)).size
if (rumorosi.length) console.log(`  senza nessuna immagine: ${rumorosi.length} (${rumorosi.slice(0, 3).map((j) => j.keyBase).join(', ')})`)
if (CI && rumorosi.length) console.log(`::warning::${rumorosi.length} images have no source on the wiki (first: ${rumorosi.slice(0, 5).map((j) => j.keyBase).join(', ')})`)
if (muti.length) console.log(`  ${carteMute} cards have no file on the wiki yet (${muti.length} images, retried every run)`)

// Il budget degli artwork animati (asset-limits.mjs): i byte gia' in
// tabella, e quanto pesava la riga che un --force sostituirebbe.
const ANIMATI = new Set(['card_thumb_animated', 'card_art_animated'])
const { rows: [{ n: animIniziale }] } = await client.query(
  `select coalesce(sum(byte_size), 0)::bigint as n from asset where kind = 'card_art_animated'`)
let totaleAnim = Number(animIniziale)
const vecchioAnim = (job) => {
  if (job.kind !== 'card_art_animated') return 0
  const k = rigaDi(job)
  return k ? Number(have.get(k).byte_size) || 0 : 0
}

// --plan: cosa si scaricherebbe, e quanto pesa. Il peso e' quello degli
// originali sul wiki: le immagini ferme arrivano ridimensionate, quindi e'
// un limite superiore. Poi si esce: niente download, niente scritture.
if (PLAN) {
  let simulato = totaleAnim
  let oltreTetto = 0, oltreBudget = 0
  const piano = []
  for (const j of needsWiki) {
    const base = fonteDi(j)
    if (!base) continue
    const scelto = sceltoPer(j)
    const size = scelto?.[1].size ?? null
    if (ANIMATI.has(j.kind)) {
      const d = decisioneAnimato(j.kind, size, simulato - vecchioAnim(j))
      if (d === 'oltre-il-tetto') { oltreTetto++; continue }
      if (d === 'oltre-il-budget') { oltreBudget++; continue }
      if (j.kind === 'card_art_animated' && size) simulato += size
    }
    // framed: la miniatura con la cornice, il cui size e' quello dell'APNG
    // originale (qualche MB); arriva come un fermo ridimensionato di 30 KB
    piano.push({ keyBase: j.keyBase, kind: j.kind, file: scelto?.[0] ?? null, size, quiet: Boolean(j.quiet),
                 ...(j.cornice ? { framed: true } : {}) })
  }
  writeFileSync(PLAN, JSON.stringify({
    taken_at: new Date().toISOString(), jobs: piano,
    missing_quiet: muti.length, missing_quiet_cards: carteMute, missing_loud: rumorosi.length,
    over_cap: oltreTetto, over_budget: oltreBudget, api_challenged: apiSfidata, api_unavailable: apiFerma && !apiSfidata,
    challenged: sfidatiApi,
  }, null, 1) + '\n')
  const peso = piano.reduce((n, j) => n + (j.size ?? 0), 0)
  console.log(`  piano: ${piano.length} file da scaricare (${(peso / 1e6).toFixed(1)} MB al massimo), ` +
              `${muti.length + rumorosi.length} senza file sul wiki, ${oltreTetto + oltreBudget} oltre i limiti` +
              `${apiFerma ? ', API ferma' : ''}: niente scaricato, niente scritto`)
  await ro.query('rollback')
  await ro.end()
  process.exit(0)
}

let done = 0, skipped = kept.length, adoptedN = 0, failed = 0, bytes = 0
let senzaFonte = 0, sfidati = sfidatiApi, transitori = 0, oltreTetto = 0, oltreBudget = 0
// Il primo 403 della CDN accende l'interruttore: da li' nessun download
// parte piu' (le adozioni dal disco si'), e il resto aspetta domani.
let sfidaCdn = false
const results = [...kept]

// I primi 64 KB del file bastano a siMuove. Un file che qui non c'e' non si
// puo' controllare: null, e chi chiama lascia il collegamento com'e'.
function muoveSulDisco(key) {
  const p = join(ASSET_DIR, key)
  if (!existsSync(p)) return null
  const fd = openSync(p, 'r')
  try {
    const testa = Buffer.alloc(65536)
    return siMuove(testa.subarray(0, readSync(fd, testa, 0, testa.length, 0)))
  } finally { closeSync(fd) }
}

// Il manifesto dei download (ASSET_MANIFEST), letto una volta: chiave ->
// { source, source_url, checksum }. Una riga rotta si ignora.
let manifesto = null
function voceManifest(key) {
  if (!MANIFEST) return null
  if (!manifesto) {
    manifesto = new Map()
    if (existsSync(MANIFEST)) {
      for (const line of readFileSync(MANIFEST, 'utf8').split('\n')) {
        if (!line.trim()) continue
        try { const v = JSON.parse(line); if (v?.key) manifesto.set(v.key, v) } catch { /* riga rotta */ }
      }
    }
  }
  return manifesto.get(key) ?? null
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

// Il file c'e' sul disco ma la riga in asset no. Succede a ogni db:reset,
// che ricrea il database ma non tocca public/assets. Riscaricare mezzo
// giga per ricostruire delle righe che si possono ricavare dal file
// stesso e' spreco: lo si riadotta. La provenienza: 'wiki', e l'URL solo
// se il manifesto ha questo stesso file; una riga che l'URL lo sapeva gia'
// non lo perde. Una miniatura ferma si misura (la cornice, 0034).
const frameDi = (kind, buf) => (kind === 'card_thumb' ? cornice(buf) : null)

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
  const checksum = sha256(buf)
  const prov = provenienza({ voceManifest: voceManifest(key), checksum })
  const frame = frameDi(job.kind, buf)
  await client.query(ASSET_ADOTTA_SQL,
    [key, job.kind, ct, buf.length, width, height, checksum, prov.source, prov.source_url, frame])
  // quello che la riga dice ora: una misura non riuscita tiene la vecchia (coalesce)
  return { key, frame: frame ?? have.get(key)?.frame ?? null }
}

// Un animato oltre il tetto o il budget: si salta, la versione ferma e'
// un altro job e resta
function oltre(decisione, job, size) {
  if (decisione === 'oltre-il-tetto') oltreTetto++
  else oltreBudget++
  const perche = decisione === 'oltre-il-tetto' ? 'over the per-file cap' : 'over the animated art budget'
  const msg = `${job.keyBase}: ${size ? `${mib(size)} MiB` : 'size unknown'}, ${perche} (db/import/asset-limits.mjs)`
  console.log(CI ? `::notice::animated image skipped: ${msg}` : `\n    saltato: ${msg}`)
}

async function run(job) {
  const scelto = sceltoPer(job)
  const base = scelto?.[1].url ?? job.directUrl
  let riservati = 0
  try {
    // se la riga c'e' e il file su disco combacia, non si riscarica
    const guess = rigaDi(job)
    if (!FORCE && guess) {
      const p = join(ASSET_DIR, guess)
      if (existsSync(p) && statSync(p).size === have.get(guess).byte_size) {
        skipped++; results.push({ ...job, key: guess }); return
      }
    }
    if (!FORCE) {
      const adopted = await adoptFromDisk(job)
      if (adopted) { adoptedN++; results.push({ ...job, ...adopted }); return }
    }
    if (OFFLINE) { failed++; return }   // non e' sul disco: qui non si scarica
    if (!base) { if (!apiFerma) senzaFonte++; return }   // gia' contati sopra
    // il tetto degli animati prima di scaricare, se il wiki ha detto il peso
    const size = scelto?.[1].size ?? null
    if (ANIMATI.has(job.kind)) {
      const d = decisioneAnimato(job.kind, size, totaleAnim - vecchioAnim(job))
      if (d !== 'ok') { oltre(d, job, size); return }
      if (job.kind === 'card_art_animated' && size) { riservati = size - vecchioAnim(job); totaleAnim += riservati }
    }
    if (sfidaCdn) { sfidati++; totaleAnim -= riservati; return }
    const { buf, ct, url: from } = await download(base, WIDTH[job.kind], Boolean(job.raw))
    // senza il peso dal wiki (un URL diretto che non e' un File:) il tetto
    // si guarda ora: costa un download, ma il file non entra
    if (ANIMATI.has(job.kind) && !size) {
      const d = decisioneAnimato(job.kind, buf.length, totaleAnim - vecchioAnim(job))
      if (d !== 'ok') { oltre(d, job, buf.length); return }
      if (job.kind === 'card_art_animated') { riservati = buf.length - vecchioAnim(job); totaleAnim += riservati }
    }
    const key = `${job.keyBase}.${EXT[ct] ?? 'bin'}`
    const dest = join(ASSET_DIR, key)
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, buf)
    const { width, height } = dimensions(buf)
    const checksum = sha256(buf)
    const prov = provenienza({ scaricatoDa: from })
    const frame = frameDi(job.kind, buf)
    await client.query(ASSET_SCARICA_SQL,
      [key, job.kind, ct, buf.length, width, height, checksum, prov.source, prov.source_url, frame])
    if (MANIFEST) appendFileSync(MANIFEST, JSON.stringify({ key, ...prov, checksum, byte_size: buf.length }) + '\n')
    bytes += buf.length; done++
    results.push({ ...job, key, frame })
  } catch (err) {
    totaleAnim -= riservati
    // Un 403 della CDN e' un controllo anti-bot: non si ritenta (insistere
    // e' cio' che lo fa salire) e non si scarica piu' niente in questo giro
    if (err.esito === 'sfida') {
      sfidati++
      if (!sfidaCdn) {
        console.log(CI ? `::warning::the wiki CDN answered 403 (anti-bot challenge) on ${job.keyBase}: no more downloads in this run, the next run retries`
                       : `\n    la CDN del wiki ha risposto 403 (controllo anti-bot) su ${job.keyBase}: smetto di scaricare, si riprova al prossimo giro`)
      }
      sfidaCdn = true
      return
    }
    failed++
    if (err.esito === 'transitorio') transitori++
    if (CI && failed <= 40) console.log(`::warning::image not downloaded: ${job.keyBase} (${err.message})`)
    else if (failed <= 8) console.log(`\n    ${job.files[0] ?? job.keyBase}: ${err.message}`)
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
console.log(`\r    ${capped.length}/${capped.length}  scaricati ${done}, ripresi dal disco ${adoptedN}, saltati ${skipped}, ${OFFLINE ? 'non sul disco' : 'falliti'} ${failed}` +
            `${senzaFonte ? `, senza file sul wiki ${senzaFonte}` : ''}${sfidati ? `, sfidati ${sfidati}` : ''}` +
            `${oltreTetto + oltreBudget ? `, oltre i limiti ${oltreTetto + oltreBudget}` : ''}, ${(bytes / 1e6).toFixed(1)} MB          `)

// L'avviso quando questo giro porta gli artwork animati oltre l'80% del budget
const soglia = ANIM_ART_BUDGET * AVVISO_PCT / 100
if (CI && Number(animIniziale) < soglia && totaleAnim >= soglia) {
  console.log(`::warning::animated art now at ${mib(totaleAnim)} MiB, over ${AVVISO_PCT}% of the ${mib(ANIM_ART_BUDGET)} MiB budget (db/import/asset-limits.mjs)`)
}

// --report: i numeri per i riepiloghi della CI, prima dei collegamenti
if (REPORT) {
  writeFileSync(REPORT, JSON.stringify({
    resolved: needsWiki.filter((j) => fonteDi(j)).length, downloaded: done, bytes,
    challenged: sfidati, transient_failed: transitori,
    missing_quiet: muti.length, missing_quiet_cards: carteMute, missing_loud: rumorosi.length,
    over_cap: oltreTetto, over_budget: oltreBudget, api_challenged: apiSfidata, api_unavailable: apiFerma && !apiSfidata,
  }) + '\n')
}

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
  for (const r of results) if (r.col && r.col !== 'thumb_key') cardCols[r.col].push([r.card, r.key])
  // La miniatura ferma: fra i due job di ogni carta, quello che dice
  // miniaturaVincente (asset-jobs.mjs, collegaMiniature)
  {
    const m = collegaMiniature({ jobs, results, have })
    cardCols.thumb_key.push(...m.coppie)
    if (m.conCornice || m.nude) console.log(`  card.thumb_key: ${m.conCornice} con la cornice dall'APNG, ${m.nude} ancora nude (la cornice la disegna il sito)`)
  }
  // Un "animato" che non si muove si scollega (siMuove in asset-select).
  // Senza il file su questo disco (--offline in produzione) non si puo'
  // sapere: il collegamento resta com'e'.
  // Solo i file che ci sono si giudicano: nel giro di prova della CI le
  // immagini non stanno sul disco, e ricollegarle lo faceva divergere dalla
  // produzione, dove invece si scollegano.
  for (const col of ['thumb_animated_key', 'art_animated_key']) {
    const esito = new Map(cardCols[col].map(([id, k]) => [id, muoveSulDisco(k)]))
    const fermi = [...esito].filter(([, v]) => v === false).map(([id]) => id)
    const ignoti = [...esito.values()].filter((v) => v === null).length
    cardCols[col] = cardCols[col].filter(([id]) => esito.get(id) === true)
    if (ignoti) console.log(`  card.${col}: ${ignoti} senza file su questo disco, lasciate come sono`)
    if (!fermi.length) continue
    await tx.query(`update card set ${col} = null where id = any($1::bigint[])`, [fermi])
    console.log(`  card.${col}: ${fermi.length} non animati, scollegati`)
  }
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
