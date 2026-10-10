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
// convenzione per gli animati: delle 46 carte senza pagina nessuna aveva
// un APNG sul wiki, e i due trovati in tutto sono gia' scritti sulle pagine.
export const CONVENZIONE = {
  thumb: (id) => [`Card ${id} thumb.png`],
  art: (id) => [`Card ${id} artwork.png`, `Card ${id} bg.png`],
}

const unici = (a) => [...new Set(a.filter(Boolean))]

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
 * @param {{ pages: { pageid: number, wikitext: string }[], ids: Map<number, { id: number | null }>,
 *           cardIds: Set<number>, still?: boolean, thumbs?: boolean, arts?: boolean }} x
 *   still: le immagini ferme (non con --only anim); thumbs/arts: quali
 */
export function cardJobs({ pages, ids, cardIds, still = true, thumbs = true, arts = true }) {
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
        jobs.push({ kind: 'card_thumb', files: unici([dichiarato, ...CONVENZIONE.thumb(id)]),
                    keyBase: `cards/${id}/thumb`, card: id, col: 'thumb_key',
                    directUrl: anim, quiet: !dichiarato && !anim })
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
  // Le carte senza pagina: solo i nomi per convenzione, solo le ferme.
  if (still) {
    for (const id of [...cardIds].filter((x) => !conPagina.has(x)).sort((a, b) => a - b)) {
      if (thumbs) jobs.push({ kind: 'card_thumb', files: CONVENZIONE.thumb(id), keyBase: `cards/${id}/thumb`,
                              card: id, col: 'thumb_key', directUrl: null, quiet: true })
      if (arts) jobs.push({ kind: 'card_art', files: CONVENZIONE.art(id), keyBase: `cards/${id}/art`,
                            card: id, col: 'art_key', directUrl: null, quiet: true })
    }
  }
  return jobs
}
