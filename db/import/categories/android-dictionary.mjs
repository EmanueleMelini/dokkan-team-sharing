// Il dizionario incluso nell'app Android (android/app/src/main/assets/
// categories.json): le categorie del gioco con id, nome inglese, nome
// giapponese e alias, dagli stessi dati che load-datamine scrive nel
// database (0037) e che /api/v1/categories serve all'app. Funzioni pure:
// niente database, niente file, niente effetti all'import. Le usano
// export-android.mjs (che legge la cache del datamine e scrive il file) e
// db/test/android-dictionary.test.mjs (il file nel repository deve essere
// uguale a quello che uscirebbe adesso).
//
// LE REGOLE
//   - le categorie sono quelle di card_categories.csv, in ordine di id del
//     gioco (gameId nel file);
//   - il nome giapponese viene dalle missioni dei titoli
//     (japanese-names.mjs). Se manca, resta quello del file di prima per
//     la stessa categoria (l'ultimo nome noto, come in load-datamine),
//     purche' nessun'altra categoria l'abbia preso; senza nessun nome la
//     categoria resta fuori (l'app scarta le voci senza giapponese) e un
//     avviso lo dice;
//   - gli alias sono quelli di aliasesFor (gli stessi dell'API), ma
//     nell'ordine del dizionario dell'app: prima i soprannomi, poi il resto;
//   - l'id e' lo slug a cui puntano recenti e preferiti dentro l'app: non
//     cambia mai. Una categoria gia' nel file di prima tiene il suo (per
//     gameId, o per nome inglese se quella voce il gameId non l'aveva,
//     come la versione 2); una nuova lo prende dal nome inglese con la
//     regola dell'app (DictionaryFormat.uniqueId), mai uno gia' usato;
//   - version resta quella del file di prima se le categorie non cambiano,
//     e sale di uno se cambiano: l'app sostituisce un dizionario mai
//     modificato solo con uno di versione piu' alta.
// Lo stesso input da' sempre lo stesso testo, byte per byte.
import { NICKNAMES, aliasesFor } from './aliases.mjs'

/** Dove sta il file, dalla radice del repository. */
export const ASSET = 'android/app/src/main/assets/categories.json'

/**
 * CategorySearch.normalize dell'app, riscritta: NFKC, minuscolo, apostrofi
 * tolti, ogni altro segno (e ogni gruppo di spazi) diventa uno spazio solo,
 * mai ai bordi. Lettere e cifre come Char.isLetterOrDigit di Kotlin (\p{L}
 * e \p{Nd}). Per i caratteri fuori dal piano base Kotlin vede due surrogati
 * e JavaScript uno: nei nomi del gioco non ce ne sono.
 * @param {string} text
 */
export function normalizeName(text) {
  const folded = String(text ?? '').normalize('NFKC').toLowerCase()
  let out = ''
  let spazio = false
  for (const ch of folded) {
    if (ch === "'" || ch === '’' || ch === '`') continue
    if (/^[\p{L}\p{Nd}]$/u.test(ch)) {
      if (spazio && out) out += ' '
      spazio = false
      out += ch
    } else {
      spazio = true
    }
  }
  return out
}

/**
 * DictionaryFormat.uniqueId dell'app: lo slug del nome inglese ("Goku's
 * Family" -> gokus_family), con _2, _3... se e' gia' preso.
 * @param {string} en
 * @param {Set<string>} taken
 */
export function uniqueId(en, taken) {
  const base = normalizeName(en).replaceAll(' ', '_') || 'category'
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}_${n}`)) n++
  return `${base}_${n}`
}

/** Prima i soprannomi (nel loro ordine), poi gli altri alias di aliasesFor. */
function aliasesInAppOrder(id, en) {
  const tutti = aliasesFor(id, en)
  const soprannomi = (NICKNAMES[id] ?? []).map((a) => String(a).trim().toLowerCase()).filter((a) => tutti.includes(a))
  return [...new Set([...soprannomi, ...tutti])]
}

const s = (v) => JSON.stringify(v)

/** Una voce per riga, come il file scritto a mano della versione 2. */
function riga(c) {
  return `{ "id": ${s(c.id)}, "gameId": ${c.gameId}, "en": ${s(c.en)}, "jp": ${s(c.jp)}, "aliases": [${c.aliases.map(s).join(', ')}] }`
}

/** @param {{ version: number, categories: object[] }} dictionary */
export function encodeDictionary(dictionary) {
  const righe = dictionary.categories.map((c) => `    ${riga(c)}`).join(',\n')
  return `{\n  "version": ${dictionary.version},\n  "categories": [\n${righe}\n  ]\n}\n`
}

/**
 * @typedef {{ id: string, gameId: number, en: string, jp: string, aliases: string[] }} AppCategory
 * @param {{
 *   categories: { id: number | string, name: string }[],
 *   japaneseNames: Map<number, string>,
 *   previous?: { version?: number, categories?: { id?: string, gameId?: number, en?: string, jp?: string }[] } | null,
 * }} input
 *   categories: le righe di card_categories.csv; japaneseNames: names di
 *   extractJapaneseNames; previous: il file di prima, gia' letto (o null).
 * @returns {{ dictionary: { version: number, categories: AppCategory[] }, text: string, warnings: string[] }}
 */
export function buildAndroidDictionary({ categories, japaneseNames, previous = null }) {
  const warnings = []
  const giochi = categories
    .map((r) => ({ gameId: Number(r.id), en: String(r.name ?? '').trim() }))
    .filter((c) => Number.isInteger(c.gameId) && c.gameId > 0 && c.en)
    .sort((a, b) => a.gameId - b.gameId)
  const visti = new Set()
  const elenco = giochi.filter((c) => (visti.has(c.gameId) ? false : visti.add(c.gameId)))

  const prima = Array.isArray(previous?.categories) ? previous.categories : []
  const primaPerGioco = new Map()
  const primaPerNome = new Map()
  for (const p of prima) {
    if (typeof p?.id !== 'string' || !p.id) continue
    if (Number.isInteger(p.gameId) && p.gameId > 0) {
      if (!primaPerGioco.has(p.gameId)) primaPerGioco.set(p.gameId, p)
    } else {
      const nome = normalizeName(p.en)
      if (nome && !primaPerNome.has(nome)) primaPerNome.set(nome, p)
    }
  }
  const vecchia = (c) => primaPerGioco.get(c.gameId) ?? primaPerNome.get(normalizeName(c.en)) ?? null

  // i nomi giapponesi: dalle missioni, poi l'ultimo noto se nessuno l'ha preso
  const dalleMissioni = new Set(elenco.map((c) => japaneseNames.get(c.gameId)).filter(Boolean))
  const conNome = []
  for (const c of elenco) {
    const jp = japaneseNames.get(c.gameId)?.trim()
    if (jp) { conNome.push({ ...c, jp }); continue }
    const ultimo = vecchia(c)?.jp?.trim()
    if (ultimo && !dalleMissioni.has(ultimo)) {
      warnings.push(`categoria ${c.gameId} ${c.en}: le missioni non danno il nome giapponese, resta l'ultimo noto 「${ultimo}」`)
      conNome.push({ ...c, jp: ultimo })
      continue
    }
    warnings.push(ultimo
      ? `categoria ${c.gameId} ${c.en}: il suo ultimo nome 「${ultimo}」 ora e' di un'altra categoria, resta fuori dal dizionario`
      : `categoria ${c.gameId} ${c.en}: nessun nome giapponese, resta fuori dal dizionario`)
  }

  // gli slug: quelli di prima non cambiano, i nuovi non ne riprendono uno usato
  const presi = new Set(prima.map((p) => p?.id).filter((id) => typeof id === 'string' && id))
  const tenuti = new Map()
  for (const c of conNome) {
    const p = vecchia(c)
    if (p && !tenuti.has(p.id)) tenuti.set(p.id, c.gameId)
  }
  const slug = new Map([...tenuti].map(([id, gameId]) => [gameId, id]))
  for (const c of conNome) {
    if (slug.has(c.gameId)) continue
    const id = uniqueId(c.en, presi)
    presi.add(id)
    slug.set(c.gameId, id)
  }

  const out = conNome.map((c) => ({
    id: slug.get(c.gameId), gameId: c.gameId, en: c.en, jp: c.jp, aliases: aliasesInAppOrder(c.gameId, c.en),
  }))

  const usate = new Set(conNome.map(vecchia).filter(Boolean))
  for (const p of prima) {
    if (p && !usate.has(p)) warnings.push(`voce ${p.id ?? '?'} (${p.en ?? '?'}) del file di prima: non e' piu' nel dizionario`)
  }

  const voce = (c) => s([c?.id ?? null, c?.gameId ?? null, c?.en ?? null, c?.jp ?? null, Array.isArray(c?.aliases) ? c.aliases : []])
  const stesse = prima.length === out.length && prima.every((p, i) => voce(p) === voce(out[i]))
  const versionePrima = Number.isInteger(previous?.version) ? previous.version : 0
  const version = previous ? (stesse ? versionePrima : versionePrima + 1) : 1
  const dictionary = { version, categories: out }
  return { dictionary, text: encodeDictionary(dictionary), warnings }
}
