// Quali immagini chiedere al wiki per ogni carta: i job di fetch-assets.
// Puro, niente database ne' rete: lo prova db/test/assets.test.mjs.
//
// Una carta entra perche' sta in tabella card, non perche' ha una pagina.
// I nomi dei file vengono dalla sua pagina quando c'e' (il [[File:]]
// scritto, o l'URL dell'APNG incollato), e in ogni caso dalla convenzione
// con cui il wiki salva le immagini delle carte: "Card <id> thumb.png",
// "Card <id> artwork.png". Le carte senza pagina (solo nel datamine) hanno
// solo la convenzione: misurato il 2026-10-10, il wiki aveva la miniatura
// di 34 delle 46 e l'artwork di 31, e noi non gliele chiedevamo.
//
// La miniatura ferma ha due job (0034). Il primo, cards/<id>/thumb, e'
// quello di sempre: il file scritto sulla pagina, poi "Card <id> thumb.png".
// Il secondo, cards/<id>/thumb-framed, e' la miniatura con la cornice presa
// dall'APNG (il suo primo fotogramma, appiattito come ogni animato): serve
// alle LR, perche' sul wiki "Card <id> thumb.png" di una LR e' il solo
// personaggio, senza cornice, badge del tipo ne' logo (Module:Thumb compone
// la miniatura nel browser, a strati). Quale dei due va in card.thumb_key
// lo decide miniaturaVincente. Una chiave nuova e non una sovrascritta: i
// file stanno in cache un anno, immutable (public/assets/_headers).
import { keyIndex } from './asset-select.mjs'
import { lineField } from './wiki-card.mjs'

// I nomi dei file nel wikitext arrivano in forme diverse: con underscore
// invece degli spazi, e a volte percent-encoded ("HQ%2B" per "HQ+").
// MediaWiki normalizza gli underscore, non le percentuali: le decodifichiamo
// noi, altrimenti quei file non si risolvono.
export const normalizeFile = (n) => {
  let t = n.replace(/_/g, ' ').replace(/\s+/g, ' ').trim()   // anche i doppi spazi
  if (/%[0-9A-Fa-f]{2}/.test(t)) { try { t = decodeURIComponent(t) } catch { /* lasciamolo com'e' */ } }
  return t.charAt(0).toUpperCase() + t.slice(1)
}
export const fileIn = (s) => { const m = (s ?? '').match(/\[\[\s*[Ff]ile:\s*([^\]|]+?)\s*(?:\||\]\])/); return m ? normalizeFile(m[1]) : null }

// La CDN delle immagini del wiki. vignette e' il nome vecchio, e 136 pagine
// lo scrivono ancora negli URL degli APNG: e' lo stesso archivio, con gli
// stessi percorsi.
export const WIKI_CDN_HOSTS = new Set(['static.wikia.nocookie.net', 'vignette.wikia.nocookie.net'])
const CDN_FILE = /^https:\/\/(?:static|vignette)\.wikia\.nocookie\.net\/dbz-dokkanbattle\/images\/[0-9a-f]\/[0-9a-f]{2}\/([^/?#]+)/

// L'URL diretto dei thumb animati: certe pagine (quasi tutte le LR) non
// scrivono un [[File:...]] ma incollano l'URL dell'APNG. Vale solo se e'
// sulla CDN del wiki: un link a un altro sito incollato su una pagina non
// diventa un'immagine nostra (prima si scaricava qualsiasi https).
export const directUrlIn = (s) => {
  const m = (s ?? '').match(/https?:\/\/[^\s|\]]+/)
  if (!m) return null
  const u = m[0].split('?')[0]
  return CDN_FILE.test(u) ? u : null
}

// Il nome File: di un URL della CDN: .../images/c/cf/Card_1014470_thumb_apng.png/revision/latest
// -> "Card 1014470 thumb apng.png". Serve a chiedere la dimensione del
// file animato prima di scaricarlo (il tetto di asset-limits.mjs).
export function fileFromUrl(url) {
  const m = String(url ?? '').match(CDN_FILE)
  if (!m) return null
  let name = m[1]
  try { name = decodeURIComponent(name) } catch { /* resta com'e' */ }
  return normalizeFile(name)
}

// La convenzione dei nomi del wiki. Il bg resta fra gli artwork come sulle
// pagine: una regola sola per chi ha la pagina e per chi no. Niente
// convenzione per le versioni animate: delle 46 carte senza pagina nessuna
// aveva un APNG sul wiki, e i due trovati in tutto sono gia' scritti sulle
// pagine. thumbApng e' solo la fonte della miniatura con la cornice (il job
// thumb-framed, mai thumb-animated): 171 dei 172 APNG che le pagine
// dichiarano hanno quel nome, e per una LR senza |thumb apng e' il solo
// nome da provare prima di accontentarsi del personaggio nudo.
export const CONVENZIONE = {
  thumb: (id) => [`Card ${id} thumb.png`],
  thumbApng: (id) => [`Card ${id} thumb apng.png`],
  art: (id) => [`Card ${id} artwork.png`, `Card ${id} bg.png`],
}

const unici = (a) => [...new Set(a.filter(Boolean))]

/**
 * Il job della miniatura con la cornice: il primo fotogramma dell'APNG
 * della pagina (o del suo nome per convenzione), che fetch-assets scarica
 * ridimensionato e, se si muove, appiattisce. quiet senza l'URL della
 * pagina: il nome per convenzione puo' non esserci, e si riprova al giro dopo.
 * @param {number} id
 * @param {string | null} anim l'URL dell'APNG scritto sulla pagina
 */
const jobCornice = (id, anim) => ({
  kind: 'card_thumb', files: unici([fileFromUrl(anim), ...CONVENZIONE.thumbApng(id)]),
  keyBase: `cards/${id}/thumb-framed`, card: id, col: 'thumb_key', cornice: true,
  directUrl: anim, quiet: !anim,
})

/**
 * I job delle carte. Ogni job porta piu' candidati: il file scritto sulla
 * pagina quando c'e', poi i nomi per convenzione. Vince il primo che il
 * wiki risolve; se nessuno, l'URL diretto.
 *
 * quiet: la pagina non dichiara nessun file ne' URL per quel job (o la
 * pagina non c'e'). Se il wiki non ha il file per convenzione e' normale,
 * non un avviso: lo si richiede al giro dopo. Un file dichiarato che non
 * si risolve invece avvisa, perche' puo' essere il parser che si e' rotto.
 *
 * La miniatura con la cornice (cards/<id>/thumb-framed) si chiede quando:
 *   - la pagina ha |thumb apng ma nessun |thumb ferma;
 *   - la carta e' LR e la pagina non dichiara un |thumb ferma (un
 *     {{ThumbLR|...}} non e' un file: sono gli strati del wiki), o la
 *     pagina non c'e';
 *   - la miniatura ferma che abbiamo e' misurata nuda (spoglie: asset.frame
 *     false sulla riga di cards/<id>/thumb).
 * Allora l'APNG lo prende lei, e la ferma non lo usa piu' come ripiego (lo
 * stesso file non si scarica due volte). Un |thumb dichiarato resta primo:
 * niente cornice, a meno che non sia misurato nudo.
 *
 * @param {{ pages: { pageid: number, wikitext: string }[], ids: Map<number, { id: number | null }>,
 *           cardIds: Set<number>, rarity?: Map<number, string>, spoglie?: Set<number>,
 *           still?: boolean, thumbs?: boolean, arts?: boolean }} x
 *   rarity: la rarita' di ogni carta (card.rarity); spoglie: le carte la cui
 *   miniatura ferma e' nuda; still: le immagini ferme (non con --only
 *   anim); thumbs/arts: quali
 */
export function cardJobs({ pages, ids, cardIds, rarity = new Map(), spoglie = new Set(), still = true, thumbs = true, arts = true }) {
  const jobs = []
  const conPagina = new Set()
  for (const p of pages) {
    const id = ids.get(p.pageid)?.id
    if (!id || !cardIds.has(id)) continue
    conPagina.add(id)
    const w = p.wikitext
    // I campi immagine si leggono sulla loro riga (lineField): un
    // "|artwork =" vuoto non deve prendersi la riga dopo.
    if (thumbs) {
      const dichiarato = fileIn(lineField(w, 'thumb'))
      const anim = directUrlIn(lineField(w, 'thumb apng'))
      if (still) {
        const conCornice = (!dichiarato && (anim || rarity.get(id) === 'LR')) || spoglie.has(id)
        jobs.push({ kind: 'card_thumb', files: unici([dichiarato, ...CONVENZIONE.thumb(id)]),
                    keyBase: `cards/${id}/thumb`, card: id, col: 'thumb_key',
                    directUrl: conCornice ? null : anim,
                    quiet: conCornice ? !dichiarato : !dichiarato && !anim })
        if (conCornice) jobs.push(jobCornice(id, anim))
      }
      if (anim) {
        jobs.push({ kind: 'card_thumb_animated', files: unici([fileFromUrl(anim)]), raw: true,
                    keyBase: `cards/${id}/thumb-animated`, card: id, col: 'thumb_animated_key',
                    directUrl: anim, quiet: false })
      }
    }
    if (arts) {
      const art = fileIn(lineField(w, 'artwork')), bg = fileIn(lineField(w, 'bg'))
      const anim = directUrlIn(lineField(w, 'artwork apng'))
      if (still) {
        jobs.push({ kind: 'card_art', files: unici([art, bg, ...CONVENZIONE.art(id)]),
                    keyBase: `cards/${id}/art`, card: id, col: 'art_key',
                    directUrl: anim, quiet: !art && !bg && !anim })
      }
      if (anim) {
        jobs.push({ kind: 'card_art_animated', files: unici([fileFromUrl(anim)]), raw: true,
                    keyBase: `cards/${id}/art-animated`, card: id, col: 'art_animated_key',
                    directUrl: anim, quiet: false })
      }
    }
  }
  // Le carte senza pagina: solo i nomi per convenzione, solo le ferme. Una
  // LR prova prima l'APNG per convenzione (la cornice), poi il personaggio.
  if (still) {
    for (const id of [...cardIds].filter((x) => !conPagina.has(x)).sort((a, b) => a - b)) {
      if (thumbs) {
        jobs.push({ kind: 'card_thumb', files: CONVENZIONE.thumb(id), keyBase: `cards/${id}/thumb`,
                    card: id, col: 'thumb_key', directUrl: null, quiet: true })
        if (rarity.get(id) === 'LR' || spoglie.has(id)) jobs.push(jobCornice(id, null))
      }
      if (arts) jobs.push({ kind: 'card_art', files: CONVENZIONE.art(id), keyBase: `cards/${id}/art`,
                            card: id, col: 'art_key', directUrl: null, quiet: true })
    }
  }
  return jobs
}

/**
 * Quale miniatura ferma va in card.thumb_key, fra le due della stessa carta
 * (cards/<id>/thumb e cards/<id>/thumb-framed): quella con la cornice, se
 * c'e' e non e' misurata nuda (null, non misurata, vale come incorniciata);
 * altrimenti la ferma; altrimenti quella che c'e'. frame e' asset.frame.
 * @template {{ key: string, frame?: boolean | null }} M
 * @param {{ ferma?: M | null, cornice?: M | null }} x
 * @returns {M | null}
 */
export function miniaturaVincente({ ferma = null, cornice = null }) {
  if (cornice && cornice.frame !== false) return cornice
  return ferma ?? cornice ?? null
}

/** L'id della carta di una chiave della miniatura ferma (cards/<id>/thumb.<ext>), o null. */
export function cartaDellaFerma(key) {
  const m = /^cards\/(\d+)\/thumb\.[a-z0-9]+$/i.exec(String(key ?? ''))
  return m ? Number(m[1]) : null
}

/**
 * I collegamenti di card.thumb_key alla fine di un giro di fetch-assets. Per
 * ogni carta con almeno un risultato in questo giro, fra i suoi job della
 * miniatura ferma (cards/<id>/thumb e, se chiesto, cards/<id>/thumb-framed)
 * quello di miniaturaVincente. Un job che --missing ha tolto (la riga c'e'
 * gia') prende chiave e cornice dalla riga di asset: le righe rimaste come
 * sono non si rimisurano, cosi' il giro di prova e la produzione decidono
 * allo stesso modo. Un job non chiesto in questo giro non conta.
 *
 * @param {{ jobs: { keyBase: string, card?: number, col?: string, cornice?: boolean }[],
 *           results: { keyBase: string, key: string, col?: string, frame?: boolean | null }[],
 *           have: Map<string, { frame?: boolean | null }> }} x
 * @returns {{ coppie: [number, string][], conCornice: number, nude: number }}
 */
export function collegaMiniature({ jobs, results, have }) {
  const idx = keyIndex(have.keys())
  const fatti = new Map(results.filter((r) => r.col === 'thumb_key').map((r) => [r.keyBase, r]))
  /** @type {Map<number, { ferma: { key: string, frame: boolean | null } | null, cornice: { key: string, frame: boolean | null } | null, qui: boolean }>} */
  const perCarta = new Map()
  for (const j of jobs) {
    if (j.col !== 'thumb_key' || j.card == null) continue
    const x = perCarta.get(j.card) ?? { ferma: null, cornice: null, qui: false }
    const r = fatti.get(j.keyBase)
    const key = r?.key ?? idx.get(j.keyBase) ?? null
    // frame di un risultato: quello appena scritto (anche null); di una
    // riga rimasta com'era: quello in tabella
    const m = key ? { key, frame: r && 'frame' in r ? (r.frame ?? null) : (have.get(key)?.frame ?? null) } : null
    if (j.cornice) x.cornice = m
    else x.ferma = m
    if (r) x.qui = true
    perCarta.set(j.card, x)
  }
  const coppie = []
  let conCornice = 0, nude = 0
  for (const [id, x] of perCarta) {
    if (!x.qui) continue
    const v = miniaturaVincente(x)
    if (!v) continue
    coppie.push([id, v.key])
    if (v.frame === false) nude++
    else if (v === x.cornice) conCornice++
  }
  return { coppie, conCornice, nude }
}
