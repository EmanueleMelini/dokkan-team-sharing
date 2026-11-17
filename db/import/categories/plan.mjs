// Il piano delle categorie di load-datamine: cosa scrivere in category,
// category_text ('en' e 'ja') e category_alias (0037) perche' il database
// torni col datamine. Funzione pura: lo stato di prima entra come dato, le
// scritture escono come elenco, e write.mjs le esegue in quell'ordine.
//
// Prima l'import cancellava tutto e reinseriva: category_text perdeva ogni
// riga che non fosse 'en', e la cascata svuotava equipment_limit_category
// (che load-equipment ricostruiva sei passi dopo) anche quando le
// categorie non cambiavano. Ora si tocca solo cio' che cambia:
//   - gli id nuovi del datamine si aggiungono, quelli spariti si tolgono
//     (e allora la cascata e' giusta: la categoria non c'e' piu');
//   - i nomi 'en' sono quelli del datamine;
//   - i nomi 'ja' vengono dalle missioni dei titoli (japanese-names.mjs).
//     Un id senza nome dalle missioni tiene l'ultimo nome noto, se c'e': il
//     log lo dice con la riga "  attenzione: categorie senza nome
//     giapponese: ..." (anche per gli id che un nome non l'hanno mai
//     avuto), e il giro settimanale la mette in "Needs attention";
//   - gli alias si ricalcolano da aliases.mjs.
// Un nome giapponese per un id che il datamine non ha si ignora (la FK lo
// rifiuterebbe), con un problema.
//
// unique (locale, name) su category_text: un nome puo' passare da un id a
// un altro (due categorie che si scambiano i nomi, un nome corretto).
// Per questo le righe che cambiano si cancellano tutte prima di inserire
// quelle nuove, nella stessa transazione: le scritture qui sotto sono gia'
// in quell'ordine. Le lingue diverse da 'en' e 'ja' non si toccano.
import { aliasesFor, initialsAlias } from './aliases.mjs'

export const LINGUE = ['en', 'ja']
export const MARCA_SENZA_GIAPPONESE = 'attenzione: categorie senza nome giapponese:'

const chiave = (id, locale) => `${id}|${locale}`

/**
 * @typedef {{ category_id: number, locale: string, name: string, source: string }} Testo
 * @typedef {{ category_id: number, alias: string, kind: 'initials' | 'nickname' }} Alias
 * @param {{
 *   datamine: { id: number, name: string }[],
 *   japanese: { names: Map<number, string>, problems: { msg: string }[] },
 *   current: { ids: number[], text: Testo[], aliases: Alias[] },
 * }} input
 */
export function planCategories({ datamine, japanese, current }) {
  const nomeEn = new Map([...datamine].sort((a, b) => a.id - b.id).map((c) => [c.id, c.name]))
  const ids = [...nomeEn.keys()]
  const prima = new Set(current.ids)
  const insertIds = ids.filter((id) => !prima.has(id))
  const deleteIds = [...prima].filter((id) => !nomeEn.has(id)).sort((a, b) => a - b)
  const problems = [...japanese.problems]

  const ignored = [...japanese.names].filter(([id]) => !nomeEn.has(id))
    .sort(([a], [b]) => a - b).map(([id, name]) => ({ id, name }))
  for (const x of ignored) {
    problems.push({ kind: 'senza_categoria', id: x.id,
                    msg: `nome giapponese 「${x.name}」 per la categoria ${x.id}, che il datamine non ha: lo ignoro` })
  }

  // le righe di oggi delle categorie che restano (quelle tolte se ne vanno
  // con la cascata)
  /** @type {Map<string, Testo>} */
  const oggi = new Map()
  for (const r of current.text) {
    if (LINGUE.includes(r.locale) && nomeEn.has(r.category_id)) oggi.set(chiave(r.category_id, r.locale), r)
  }

  /** @type {Map<string, Testo>} */
  const voluti = new Map()
  for (const [id, name] of nomeEn) voluti.set(chiave(id, 'en'), { category_id: id, locale: 'en', name, source: 'official' })
  const nuovi = new Set()
  for (const id of ids) {
    const name = japanese.names.get(id)
    if (name == null) continue
    voluti.set(chiave(id, 'ja'), { category_id: id, locale: 'ja', name, source: 'official' })
    nuovi.add(name)
  }
  /** @type {{ id: number, name_en: string, kept: string | null }[]} */
  const missingJa = []
  for (const id of ids) {
    if (japanese.names.has(id)) continue
    const vecchio = oggi.get(chiave(id, 'ja'))
    if (vecchio && nuovi.has(vecchio.name)) {
      // il nome che teneva ora e' di un'altra categoria, per le missioni
      problems.push({ kind: 'nome_preso', id,
                      msg: `categoria ${id}: il suo ultimo nome 「${vecchio.name}」 ora e' di un'altra categoria, resta senza` })
      missingJa.push({ id, name_en: nomeEn.get(id), kept: null })
      continue
    }
    if (vecchio) voluti.set(chiave(id, 'ja'), { ...vecchio })
    missingJa.push({ id, name_en: nomeEn.get(id), kept: vecchio?.name ?? null })
  }

  const uguale = (a, b) => !!a && !!b && a.name === b.name && a.source === b.source
  const ordina = (a, b) => a.category_id - b.category_id || (a.locale < b.locale ? -1 : a.locale > b.locale ? 1 : 0)
  const textDelete = [...oggi.values()].filter((r) => !uguale(r, voluti.get(chiave(r.category_id, r.locale))))
    .sort(ordina).map((r) => ({ category_id: r.category_id, locale: r.locale }))
  const textInsert = [...voluti.values()].filter((r) => !uguale(r, oggi.get(chiave(r.category_id, r.locale)))).sort(ordina)

  /** @type {Alias[]} */
  const aliasVoluti = []
  for (const [id, name] of nomeEn) {
    const ini = initialsAlias(name)
    for (const alias of aliasesFor(id, name)) aliasVoluti.push({ category_id: id, alias, kind: alias === ini ? 'initials' : 'nickname' })
  }
  const ka = (a) => `${a.category_id}|${a.alias}|${a.kind}`
  const aliasOggi = current.aliases.filter((a) => nomeEn.has(a.category_id))
  const setOggi = new Set(aliasOggi.map(ka)), setVoluti = new Set(aliasVoluti.map(ka))
  const ordinaAlias = (a, b) => a.category_id - b.category_id || (a.alias < b.alias ? -1 : a.alias > b.alias ? 1 : 0)
  const aliasDelete = aliasOggi.filter((a) => !setVoluti.has(ka(a))).sort(ordinaAlias)
    .map((a) => ({ category_id: a.category_id, alias: a.alias }))
  const aliasInsert = aliasVoluti.filter((a) => !setOggi.has(ka(a)))

  const conta = (locale, fn) => [...voluti.values()].filter((r) => r.locale === locale && fn(r)).length
  const cambiati = (locale) => textInsert.filter((r) => r.locale === locale && oggi.has(chiave(r.category_id, locale))).length
  return {
    ids, insertIds, deleteIds,
    text: { delete: textDelete, insert: textInsert },
    aliases: { delete: aliasDelete, insert: aliasInsert },
    counts: {
      en: conta('en', () => true), ja: conta('ja', () => true),
      jaFromMissions: conta('ja', (r) => japanese.names.has(r.category_id)),
      enChanged: cambiati('en'), jaChanged: cambiati('ja'),
      jaAdded: textInsert.filter((r) => r.locale === 'ja' && !oggi.has(chiave(r.category_id, 'ja'))).length,
      aliases: aliasVoluti.length,
      initials: aliasVoluti.filter((a) => a.kind === 'initials').length,
      nicknames: aliasVoluti.filter((a) => a.kind === 'nickname').length,
      aliasesChanged: aliasDelete.length + aliasInsert.length,
    },
    missingJa, ignored, problems,
  }
}

/**
 * Le righe del log di load-datamine, nello stile dello script. La riga con
 * MARCA_SENZA_GIAPPONESE c'e' solo se qualche categoria e' senza nome dalle
 * missioni: il giro settimanale la cerca.
 * @param {ReturnType<typeof planCategories>} plan
 * @returns {string[]}
 */
export function planLines(plan) {
  const c = plan.counts
  const out = [
    `  categorie con gli id del gioco: ${plan.ids.length} (nuove ${plan.insertIds.length}, tolte ${plan.deleteIds.length})`,
    `  nomi giapponesi delle categorie: ${c.ja}, ${c.jaFromMissions} dalle missioni dei titoli` +
      ` (nuovi ${c.jaAdded}, cambiati ${c.jaChanged}); nomi inglesi cambiati: ${c.enChanged}`,
    `  alias delle categorie: ${c.aliases} (iniziali ${c.initials}, soprannomi ${c.nicknames}; righe cambiate ${c.aliasesChanged})`,
  ]
  for (const p of plan.problems) out.push(`    (${p.msg})`)
  if (plan.missingJa.length) {
    out.push(`  ${MARCA_SENZA_GIAPPONESE} ${plan.missingJa.map((m) => `${m.id} ${m.name_en}`).join(', ')}`)
    const tenuti = plan.missingJa.filter((m) => m.kept != null).map((m) => m.id)
    const senza = plan.missingJa.filter((m) => m.kept == null).map((m) => m.id)
    out.push(`    (${[tenuti.length ? `resta l'ultimo nome noto: ${tenuti.join(', ')}` : '',
                     senza.length ? `nessun nome giapponese: ${senza.join(', ')}` : ''].filter(Boolean).join('; ')})`)
  }
  return out
}
