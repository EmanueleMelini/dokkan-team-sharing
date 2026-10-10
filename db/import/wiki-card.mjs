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
import { gameUnits, pickGameCards, unitOf } from './game-cards.mjs'

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

// Nome ed epiteto. I testi delle skill no: li pulisce cleanSkill
// (wiki-skills.mjs), che tiene gli a capo e mette le note <ref> da parte.
//
// Le leader skill sul wiki scrivono i tipi come icone, non come testo:
// "[[File:TEQ icon.png|30px]] & [[File:INT icon.png|30px]] Type ATK +30%".
// Buttare via i File lascerebbe "& Type ATK +30%", che non dice niente.
// Quindi le icone dei tipi e del Ki tornano testo prima di pulire.
// Sta qui e non in load-cards perche' anche il riconoscimento delle pagine
// abbozzate (sotto) deve leggere il nome come lo scrive load-cards.
const ICON = /\[\[File:\s*(AGL|TEQ|INT|STR|PHY|Ki|Rainbow|Orb)[ _]?icon[^\]]*\]\]/gi
export const cleanText = (s) => (s ?? '')
  .replace(ICON, (_, k) => k.toUpperCase())
  .replace(/\[\[File:[^\]]*\]\]/gi, '')
  .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
  .replace(/\[\[([^\]]+)\]\]/g, '$1')
  .replace(/\{\{[^}]*\}\}/g, '')
  .replace(/<[^>]+>/g, '')
  .replace(/'''?/g, '')
  .replace(/\s+/g, ' ')
  .trim()

// Il nome per confrontare wiki e datamine: il datamine scrive "A/\nB" dove
// il wiki scrive "A/B" (3 nomi su 2295 diversi solo per questo).
export const nameKey = (s) => cleanText(s).replace(/\s*\/\s*/g, '/')

const MONTHS = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6,
                 jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 }

// "29 Sep 2026" -> "2026-09-29"; "prior to ..." e "N/A" come li scrive il wiki
export function parseDate(raw) {
  if (!raw) return null
  const t = raw.replace(/^prior to\s+/i, '').trim()
  if (/^n\/?a$/i.test(t)) return null
  const m = t.match(/^(\d{1,2})\s+([A-Za-z]+)\.?\s+(\d{4})$/)
  if (!m) return null
  const mo = MONTHS[m[2].slice(0, 3).toLowerCase()]
  if (!mo) return null
  return `${m[3]}-${String(mo).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`
}

export function parseType(raw) {
  if (!raw) return { skip: 'tipo assente' }
  const t = raw.trim().toUpperCase()
  if (t.startsWith('ITEM')) return { skip: "e' un oggetto di supporto, non un'unita'" }
  let m = t.match(/^(AGL|TEQ|INT|STR|PHY)-(S|E)$/)            // formato nuovo
  if (m) return { type: m[1], cls: m[2] === 'S' ? 'Super' : 'Extreme' }
  m = t.match(/^(S|E)(AGL|TEQ|INT|STR|PHY)$/)                  // formato vecchio
  if (m) return { type: m[2], cls: m[1] === 'S' ? 'Super' : 'Extreme' }
  return { skip: `tipo non riconosciuto: "${raw}"` }
}

export const RARITIES = new Set(['N', 'R', 'SR', 'SSR', 'UR', 'LR'])

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

// Una pagina abbozzata: nessun id dalle immagini e nessun |ID, ma nome,
// tipo, classe e rarita' scritti. Il wiki le crea cosi' per le carte
// appena uscite ("Transcendent Existence Buu (Kid)", 1034150), e prima le
// scartavamo. Si cerca la carta fra quelle che il gioco ha e nessuna
// pagina nomina (le stesse regole di load-game-cards: niente copie, niente
// date minime del lancio, niente carte non ancora uscite), su segnali
// esatti: il nome, il tipo, la classe e la rarita'. Se la pagina ha
// GLBdate, deve stare entro un giorno dall'uscita Global del datamine (il
// giorno UTC di open_at coincide con GLBdate 2183 volte su 2282, e sbaglia
// di uno 78). Il costo no: coincide solo 1124 volte su 2295.
//
// Unica fra le candidate non basta: deve esserlo nel gioco intero. Se
// un'altra unita' del datamine ha la stessa firma (gameUnits: anche la
// gemella non ancora uscita, con la data finta del 2038; una copia; una
// carta che ha gia' la sua pagina), la pagina potrebbe essere di quella, o
// di una carta che il datamine non ha ancora. Con GLBdate una rivale si
// esclude solo se TUTTE le sue date sono note e lontane; senza GLBdate
// nessuna si esclude, e la firma deve bastare da sola.
//
// Ambigua o a meta': fuori, e lo si dice. Mai una carta a caso.
const GIORNO = 86_400_000
const entroUnGiorno = (a, b) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) <= GIORNO

/**
 * @param {{ wikitext: string }} page
 * @param {{ id: number, name: string, type: string, cls: string, rarity: string, global_release: string }[]} candidates
 *   le carte uscite che nessuna pagina nomina (pickGameCards)
 * @param {ReturnType<typeof gameUnits>} units  tutte le unita' del datamine (gameUnits)
 * @returns {{ id: number, from: 'abbozzo', global_release: string } | { id: null, why: string }}
 */
export function matchStub(page, candidates, units) {
  if (!Array.isArray(units)) throw new Error("matchStub: servono tutte le unita' del datamine (gameUnits)")
  const w = page.wikitext
  const name = nameKey(scalar(w, 'name2'))
  const ty = parseType(scalar(w, 'type'))
  const rarity = (scalar(w, 'rarity') ?? '').toUpperCase()
  if (!name || ty.skip || !RARITIES.has(rarity)) {
    return { id: null, why: "pagina abbozzata senza nome, tipo o rarita' leggibili" }
  }
  const glb = parseDate(scalar(w, 'GLBdate'))
  const omonime = candidates.filter((c) => nameKey(c.name) === name)
  const ids = (a) => a.map((c) => c.id).join(', ')
  if (!omonime.length) return { id: null, why: `nessuna carta solo del datamine con nome "${name}"` }
  const esatte = omonime.filter((c) => c.type === ty.type && c.cls === ty.cls && c.rarity === rarity)
  if (!esatte.length) {
    return { id: null, why: `"${name}" c'e' nel datamine (${ids(omonime)}) ma con tipo, classe o rarita' diversi` }
  }
  const datate = glb ? esatte.filter((c) => entroUnGiorno(glb, c.global_release)) : esatte
  if (!datate.length) {
    return { id: null, why: `"${name}" (${ids(esatte)}): GLBdate ${glb} lontana dall'uscita Global del datamine` +
                           ` (${esatte.map((c) => c.global_release).join(', ')})` }
  }
  if (datate.length > 1) return { id: null, why: `pagina abbozzata ambigua: ${ids(datate)}` }

  const scelta = datate[0]
  // una classe che non si sa (solo la forma base, element 0-4) non esclude;
  // la rarita' e' quella della base, come la scrive il wiki
  const stessaFirma = (u) => u.names.some((n) => nameKey(n) === name) && u.types.includes(ty.type)
    && (!u.classes.length || u.classes.includes(ty.cls)) && u.rarity === rarity
    && (!glb || u.days.some((d) => d === null || entroUnGiorno(glb, d)))
  const rivali = units.filter((u) => unitOf(u.id) !== unitOf(scelta.id) && stessaFirma(u))
  if (rivali.length) {
    return { id: null, why: `pagina abbozzata ambigua: ${scelta.id} e ${ids(rivali)} nel datamine` +
                           ` (anche non uscite o con una pagina) hanno lo stesso nome, tipo, classe e rarita'` +
                           (glb ? ` e una data vicina a GLBdate ${glb}, o non nota` : ', e la pagina non ha GLBdate') }
  }
  return { id: scelta.id, from: 'abbozzo', global_release: scelta.global_release }
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
//      due pagine con lo stesso |ID. Meglio dirlo che importarne una a caso;
//   4. una pagina abbozzata (niente immagini col numero, niente |ID) prende
//      l'unica carta solo del datamine con lo stesso nome, tipo, classe e
//      rarita' (matchStub), se nessun'altra unita' del gioco ha la stessa
//      firma. Serve il datamine, e un id che nessun'altra pagina nomina,
//      nemmeno con un'immagine condivisa o un |ID rifiutato. Due abbozzi
//      sulla stessa carta restano fuori tutti e due (il 3).
//
// now: la data di oggi, per le carte annunciate ma non ancora uscite (i
// test la fissano).
//
// Ritorna pageid -> { id, from: 'immagine' | 'ID' | 'abbozzo' } oppure { id: null, why }.
export function assignCardIds(pages, dm, { now = new Date() } = {}) {
  const fromImage = pages.map((p) => imageCardId(p.wikitext))
  const seen = new Map()
  for (const id of fromImage) if (id) seen.set(id, (seen.get(id) ?? 0) + 1)

  const out = new Map()
  const abbozzi = []
  pages.forEach((p, i) => {
    const t = fromImage[i]
    if (t && seen.get(t) === 1) { out.set(p.pageid, { id: t, from: 'immagine' }); return }
    let why = null
    const daID = idFieldIds(p.wikitext)
    for (const id of daID) {
      if (id !== t && seen.get(id) === 1) { why = `|ID ${id} e' l'id di un'altra pagina`; continue }
      if (!dm) { why = `|ID ${id} non verificabile: manca il datamine (fetch-datamine.mjs)`; continue }
      const bad = mismatch(dm, id, p.wikitext)
      if (bad) { why = `|ID ${id} ${bad}`; continue }
      out.set(p.pageid, { id, from: 'ID' }); return
    }
    const base = t ? `id ${t} condiviso con altre ${seen.get(t) - 1} pagine`
                   : 'nessun id carta ricavabile da immagini o |ID'
    out.set(p.pageid, { id: null, why: why ? `${base}; ${why}` : base })
    if (!t && !daID.length) abbozzi.push(p)
  })

  if (dm && abbozzi.length) {
    // ogni id che una pagina nomina, anche quelli rifiutati sopra
    const nominati = new Set(fromImage.filter(Boolean))
    for (const p of pages) for (const id of idFieldIds(p.wikitext)) nominati.add(id)
    for (const r of out.values()) if (r.id) nominati.add(r.id)
    const rows = [...dm.values()]
    const candidates = pickGameCards(rows, nominati, now).cards
    const units = gameUnits(rows)
    for (const p of abbozzi) {
      const r = matchStub(p, candidates, units)
      out.set(p.pageid, r.id ? r : { id: null, why: `${out.get(p.pageid).why}; ${r.why}` })
    }
  }

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
