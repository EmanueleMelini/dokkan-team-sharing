// Quali immagini fetch-assets deve davvero lavorare, cosa vuol dire una
// risposta della CDN del wiki, e da dove viene un asset. Pura, per i test.
//
// Una riga in asset ha chiave <keyBase>.<estensione> (cards/1/thumb.webp):
// per ogni job si cerca la riga col suo prefisso.

// indice prefisso -> chiave, cosi' 6000 job contro 6000 righe non sono
// 36 milioni di startsWith
export function keyIndex(keys) {
  /** @type {Map<string, string>} */
  const idx = new Map()
  for (const k of keys) {
    for (let i = k.indexOf('.'); i > 0; i = k.indexOf('.', i + 1)) {
      const base = k.slice(0, i)
      if (!idx.has(base)) idx.set(base, k)
    }
  }
  return idx
}

/**
 * --missing: solo i job senza riga (la CI chiede al wiki solo le immagini
 * nuove, non le 6000 che stanno gia' su Cloudflare).
 * --offline: un job con la riga si collega e basta, anche se il file non e'
 * su questo disco. In produzione i file stanno su Cloudflare Pages, non qui:
 * prima finivano contati come "falliti" e senza collegamento.
 *
 * @template {{ keyBase: string }} J
 * @param {J[]} jobs
 * @param {Iterable<string>} haveKeys
 * @param {{ missing?: boolean, offline?: boolean }} [opts]
 * @returns {{ todo: J[], kept: (J & { key: string })[], dropped: number }}
 */
export function selectJobs(jobs, haveKeys, { missing = false, offline = false } = {}) {
  const idx = keyIndex(haveKeys)
  const todo = [], kept = []
  let dropped = 0
  for (const j of jobs) {
    const key = idx.get(j.keyBase)
    if (key && missing) { dropped++; continue }
    if (key && offline) { kept.push({ ...j, key }); continue }
    todo.push(j)
  }
  return { todo, kept, dropped }
}

/**
 * Se un file immagine si muove davvero, dai suoi primi byte: GIF, WebP con
 * il blocco ANIM, PNG con acTL (APNG). Il campo "apng" del wiki a volte
 * punta a un'immagine ferma (un WebP VP8 semplice, piu' piccolo
 * dell'artwork): collegata come animata, la pagina della carta offrirebbe
 * "Animated" per mostrare un'immagine immobile e peggiore.
 *
 * @param {Uint8Array} testa i primi byte del file (64 KB bastano)
 */
export function siMuove(testa) {
  const s = Buffer.from(testa.buffer, testa.byteOffset, testa.byteLength).toString('latin1')
  if (s.startsWith('GIF8')) return true
  if (s.startsWith('RIFF') && s.slice(8, 12) === 'WEBP') return s.includes('ANIM')
  if (s.startsWith('\x89PNG')) return s.includes('acTL')
  return false
}

// ------------------------------------------------- le risposte della CDN

/**
 * Cosa vuol dire una risposta HTTP del wiki, per chi scarica.
 *   'sfida'       403: la CDN (Cloudflare) ha messo un controllo anti-bot.
 *                 Non si ritenta e non si aggira: si riprova domani;
 *   'assente'     404 e 410: il file non c'e';
 *   'transitorio' timeout, troppe richieste, il ridimensionatore di Fandom
 *                 che va in 502/504: si ritenta con pazienza;
 *   'errore'      il resto.
 * @param {number} status
 * @returns {'ok' | 'sfida' | 'assente' | 'transitorio' | 'errore'}
 */
export function esitoHttp(status) {
  if (status >= 200 && status < 300) return 'ok'
  if (status === 403) return 'sfida'
  if (status === 404 || status === 410) return 'assente'
  if ([408, 425, 429, 500, 502, 503, 504].includes(status)) return 'transitorio'
  return 'errore'
}

// Quante volte si ritenta un file dopo il primo tentativo: le attese sono
// 1,6 / 3,2 / 6,4 / 12,8 secondi, come prima.
export const MAX_RITENTI = 4
export const ATTESA_MAX_MS = 60_000

/**
 * L'attesa prima del ritento n (da 1): raddoppia da 1,6 s, rispetta un
 * Retry-After piu' lungo (secondi o data HTTP), mai oltre 60 s.
 * @param {number} n
 * @param {string | number | null} [retryAfter]
 * @param {number} [ora] millisecondi, per le date HTTP
 */
export function attesaRitento(n, retryAfter = null, ora = Date.now()) {
  let chiesta = 0
  if (retryAfter != null && retryAfter !== '') {
    const s = Number(retryAfter)
    if (Number.isFinite(s)) chiesta = Math.max(0, s * 1000)
    else {
      const t = Date.parse(String(retryAfter))
      if (Number.isFinite(t)) chiesta = Math.max(0, t - ora)
    }
  }
  return Math.min(ATTESA_MAX_MS, Math.max(800 * 2 ** n, chiesta))
}

// ------------------------------------------------- da dove viene un asset

// Le sole fonti che un source_url puo' nominare (lo stesso controllo del
// vincolo asset_source_url_wiki, migrazione 0033)
const HOST_WIKI = new Set(['static.wikia.nocookie.net', 'vignette.wikia.nocookie.net', 'dbz-dokkanbattle.fandom.com'])

/**
 * L'URL del file originale: senza query string e senza il
 * ridimensionamento (che si ricava dal kind, vedi WIDTH in fetch-assets).
 * null se non e' un URL del wiki.
 * @param {string | null | undefined} u
 */
export function urlDiOrigine(u) {
  if (!u) return null
  let x
  try { x = new URL(u) } catch { return null }
  if (x.protocol !== 'https:' || !HOST_WIKI.has(x.hostname)) return null
  const path = x.pathname.replace(/\/scale-to-width-down\/\d+\/?$/, '').replace(/\/+$/, '')
  return `${x.origin}${path}`
}

/**
 * La provenienza di una riga di asset (0033). Oggi la fonte e' una sola,
 * il wiki. L'URL si scrive solo se e' certo:
 *   - un download: l'URL da cui e' arrivato il file, ripulito;
 *   - un file adottato dal disco: l'URL della voce del manifest
 *     (ASSET_MANIFEST) con lo stesso checksum, altrimenti null.
 * @param {{ scaricatoDa?: string | null,
 *           voceManifest?: { source?: string, source_url?: string | null, checksum?: string } | null,
 *           checksum?: string | null }} [x]
 * @returns {{ source: 'wiki', source_url: string | null }}
 */
export function provenienza({ scaricatoDa = null, voceManifest = null, checksum = null } = {}) {
  if (scaricatoDa) return { source: 'wiki', source_url: urlDiOrigine(scaricatoDa) }
  const v = voceManifest
  if (v && checksum && v.checksum === checksum && (v.source ?? 'wiki') === 'wiki') {
    return { source: 'wiki', source_url: urlDiOrigine(v.source_url) }
  }
  return { source: 'wiki', source_url: null }
}

// Le scritture di una riga di asset in fetch-assets, qui perche' i test le
// provino cosi' come sono (weekly-data.test.mts). I parametri, in ordine:
// key, kind, content_type, byte_size, width, height, checksum, source,
// source_url.
//
// Un file adottato dal disco non sa sempre da dove viene: un URL gia' noto
// resta (coalesce), un db:reset seguito da una riadozione non lo cancella.
export const ASSET_ADOTTA_SQL = `
  insert into asset (key, kind, content_type, byte_size, width, height, checksum, source, source_url, fetched_at)
  values ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
  on conflict (key) do update set
    kind = excluded.kind, content_type = excluded.content_type,
    byte_size = excluded.byte_size, width = excluded.width, height = excluded.height,
    checksum = excluded.checksum, source = excluded.source,
    source_url = coalesce(excluded.source_url, asset.source_url)`

// Un download invece sa da dove viene il file appena scritto
export const ASSET_SCARICA_SQL = `
  insert into asset (key, kind, content_type, byte_size, width, height, checksum, source, source_url, fetched_at)
  values ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
  on conflict (key) do update set
    kind = excluded.kind, content_type = excluded.content_type,
    byte_size = excluded.byte_size, width = excluded.width, height = excluded.height,
    checksum = excluded.checksum, source = excluded.source, source_url = excluded.source_url,
    fetched_at = now()`
