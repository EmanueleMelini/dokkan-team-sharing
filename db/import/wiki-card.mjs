// Lettura delle pagine carta del wiki: i campi del template Characters e,
// soprattutto, l'id della carta.
//
// Sta qui e non dentro gli script perche' load-cards e fetch-assets devono
// ricavare l'id con LO STESSO codice. Quando ognuno aveva il suo, bastava
// che load-cards importasse una carta che fetch-assets non riconosceva per
// lasciarla senza immagini: fetch-assets salta gli id che non sono in
// tabella, e le cinque Metal Cooler avrebbero appeso le loro a una carta sola.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { DM_DIR, loadTable } from './datamine.mjs'

const esc = (k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Il valore grezzo del campo: tutto quello che segue "|chiave =" fino a
// fine riga. Grezzo perche' il wikitext e' scritto a mano e mette piu'
// parametri sulla stessa riga separati da "|" — e i link skill sono
// scritti PROPRIO con quella sintassi ([[Pagina|Etichetta]]), quindi
// tagliare al primo "|" li distruggerebbe.
//
// Il \s* dopo "=" scavalca anche l'a capo, e va bene cosi' per i testi:
// 23 pagine scrivono la descrizione della passiva sulla riga dopo.
export const field = (txt, key) => {
  const m = txt.match(new RegExp('^\\|\\s*' + esc(key) + '\\s*=\\s*(.*)$', 'mi'))
  const v = m ? m[1].trim() : null
  return v || null
}

// Lo stesso, ma solo sulla riga del campo. Per le immagini e per |ID lo
// scavalcamento di field() e' un errore: un "|artwork =" vuoto si prendeva
// la riga dopo, e su 1033060 l'artwork diventava l'immagine della frase
// della super ("Card 1033060 sp phrase.png"); un "|thumb apng =" vuoto si
// prendeva "|thumb link = ...", e l'id saltava fuori per caso.
export const lineField = (txt, key) => {
  const m = txt.match(new RegExp('^\\|[ \\t]*' + esc(key) + '[ \\t]*=[ \\t]*(.*)$', 'mi'))
  const v = m ? m[1].trim() : null
  return v || null
}

// Per i valori semplici (rarita', tipo, date, statistiche): qui si', il
// }} di chiusura e un eventuale secondo parametro sulla riga vanno via.
// Non contengono mai wikilink, quindi tagliare al "|" e' sicuro.
export const scalar = (txt, key) => {
  const v = field(txt, key)
  if (!v) return null
  const t = v.replace(/\}\}.*$/, '').replace(/\|\s*[A-Za-z][\w ]*=.*$/, '').trim()
  return t || null
}

// "Card 1004610 thumb.png", "Card_1014470_artwork_apng.png": l'id del
// gioco sta nel nome del file
export const cardIdFrom = (s) => {
  const m = (s ?? '').match(/Card[ _](\d+)[ _](?:thumb|bg|artwork)/i)
  return m ? Number(m[1]) : null
}

// L'id dalle immagini della pagina, la fonte primaria: e' il nome con cui
// il wiki salva i file, ed e' quasi sempre giusto. "thumb link" conta: le
// LR con {{ThumbLR}} e l'APNG vuoto hanno il nome del file solo li'.
export const imageCardId = (w) =>
  cardIdFrom(lineField(w, 'thumb')) ?? cardIdFrom(lineField(w, 'thumb apng'))
  ?? cardIdFrom(lineField(w, 'thumb link')) ?? cardIdFrom(lineField(w, 'artwork'))
  ?? cardIdFrom(lineField(w, 'artwork link'))

// |ID e' il numero che il gioco mostra: la prima cifra, poi il resto
// allargato a 5 cifre, poi lo 0 della forma base. "1461" -> 1004610,
// "11569" -> 1015690, "13219" -> 1032190. Le pagine con due versioni della
// stessa carta ne elencano due, ognuna dietro la sua miniatura.
export function idFieldIds(w) {
  const v = lineField(w, 'ID')
  if (!v) return []
  return [...v.replace(/\[\[[^\]]*\]\]/g, ' ').matchAll(/\b(\d{7}|(\d)(\d{3,5}))\b/g)]
    .map((m) => Number(m[2] ? m[2] + m[3].padStart(5, '0') + '0' : m[1]))
}

// Le righe del datamine per id carta (solo le 7 cifre: le piu' lunghe
// sono boss). null se il datamine non e' stato scaricato: allora l'id da
// |ID non si puo' verificare e non si usa.
export function datamineCards() {
  if (!existsSync(join(DM_DIR, 'cards.csv'))) return null
  return new Map(loadTable('cards').filter((c) => c.id.length === 7).map((c) => [c.id, c]))
}

const DM_TYPES = ['AGL', 'TEQ', 'INT', 'STR', 'PHY']
const DM_RARITY = ['N', 'R', 'SR', 'SSR', 'UR', 'LR']

// |ID e' scritto a mano e ha i suoi refusi: "Root of All Evil Babidi"
// darebbe 1263700, che nel gioco non esiste. Un id da li' vale solo se il
// gioco lo conosce e con lo stesso tipo e la stessa rarita' della pagina
// (della forma base o di quella risvegliata, la x...1: una SR che si
// risveglia diventa SSR).
function mismatch(dm, id, w) {
  const rows = [dm.get(String(id)), dm.get(String(id + 1))].filter(Boolean)
  if (!rows.length) return 'non esiste nel datamine'
  const type = (lineField(w, 'type') ?? '').toUpperCase().match(/AGL|TEQ|INT|STR|PHY/)?.[0]
  if (type && !rows.some((r) => DM_TYPES[Number(r.element) % 10] === type)) return `nel gioco non e' ${type}`
  const rarity = (lineField(w, 'rarity') ?? '').toUpperCase()
  if (rarity && !rows.some((r) => DM_RARITY[Number(r.rarity)] === rarity)) return `nel gioco non e' ${rarity}`
  return null
}

// L'id di ogni pagina, deciso guardando TUTTE le pagine insieme: serve
// sapere quali id dalle immagini sono condivisi.
//
//   1. l'id dalle immagini, se e' solo di quella pagina;
//   2. altrimenti |ID, verificato sul datamine: e' cio' che separa le
//      cinque Metal Cooler che usano il thumb di una sola, e che recupera
//      le pagine senza un'immagine col numero (LR con {{ThumbLR}}, thumb a
//      carosello delle Goku Black clone). Un id gia' preso dalle immagini
//      di un'altra pagina non si ruba: vince l'immagine;
//   3. un id che resta su piu' pagine non identifica una carta: una pagina
//      con l'immagine condivisa e senza un |ID buono resta fuori, e cosi'
//      due pagine con lo stesso |ID. Meglio dirlo che importarne una a caso.
//
// Ritorna pageid -> { id, from: 'immagine' | 'ID' } oppure { id: null, why }.
export function assignCardIds(pages, dm) {
  const fromImage = pages.map((p) => imageCardId(p.wikitext))
  const seen = new Map()
  for (const id of fromImage) if (id) seen.set(id, (seen.get(id) ?? 0) + 1)

  const out = new Map()
  pages.forEach((p, i) => {
    const t = fromImage[i]
    if (t && seen.get(t) === 1) { out.set(p.pageid, { id: t, from: 'immagine' }); return }
    let why = null
    for (const id of idFieldIds(p.wikitext)) {
      if (id !== t && seen.get(id) === 1) { why = `|ID ${id} e' l'id di un'altra pagina`; continue }
      if (!dm) { why = `|ID ${id} non verificabile: manca il datamine (fetch-datamine.mjs)`; continue }
      const bad = mismatch(dm, id, p.wikitext)
      if (bad) { why = `|ID ${id} ${bad}`; continue }
      out.set(p.pageid, { id, from: 'ID' }); return
    }
    const base = t ? `id ${t} condiviso con altre ${seen.get(t) - 1} pagine`
                   : 'nessun id carta ricavabile da immagini o |ID'
    out.set(p.pageid, { id: null, why: why ? `${base}; ${why}` : base })
  })

  const pagesOf = new Map()
  for (const r of out.values()) if (r.id) pagesOf.set(r.id, (pagesOf.get(r.id) ?? 0) + 1)
  for (const [pageid, r] of out) {
    const n = pagesOf.get(r.id)
    if (n > 1) out.set(pageid, { id: null, why: `id ${r.id} condiviso con altre ${n - 1} pagine` })
  }
  return out
}

// Il titolo come lo legge MediaWiki: underscore e spazi sono lo stesso, e
// l'iniziale minuscola di un link porta alla stessa pagina
const titleKey = (t) => {
  const s = t.replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// La carta in cui si risveglia (dokkan awakening). Il link=Titolo della
// miniatura vince sul nome del file: le cinque SR Metal Cooler mostrano
// tutte "Card 1015680 thumb <tipo>.png", ma ognuna punta alla pagina SSR
// del suo tipo, che ha il suo id.
export function awakensInto(w, idByTitle) {
  const v = lineField(w, 'dokkan thumb')
  const link = v?.match(/\|\s*link\s*=\s*([^|\]]+)/i)?.[1]
  return (link && idByTitle.get(titleKey(link))) ?? cardIdFrom(v)
}

// titolo della pagina -> id, per awakensInto
export const idsByTitle = (pages, ids) =>
  new Map(pages.filter((p) => ids.get(p.pageid)?.id).map((p) => [titleKey(p.title), ids.get(p.pageid).id]))

// I testi delle skill (template letto come MediaWiki, note, EZA): stanno
// in wiki-skills.mjs, qui si riesportano per chi importa da questo modulo.
export { baseTexts, cleanSkill, inlineField, refsOf, skillsFromPage, templateParams } from './wiki-skills.mjs'
