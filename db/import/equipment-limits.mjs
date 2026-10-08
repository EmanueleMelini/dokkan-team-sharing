// Le regole delle Skill Orb esclusive (0021), dal datamine alle nostre
// carte. Funzioni pure: load-equipment le chiama con le tabelle del
// gioco e con gli id che il database ha gia' (carte e categorie).
import { int } from './datamine.mjs'

const TYPES = ['AGL', 'TEQ', 'INT', 'STR', 'PHY']
const CLASSES = ['Super', 'Extreme']

// element_bitpattern: i bit 0-4 sono il tipo con qualunque classe
// ("Skill Orb (AGL)", 31 = tutti), 12-16 Super e 17-21 Extreme, nello
// stesso ordine AGL..PHY ("Skill Orb (Super AGL)" = 4096). Verificato sui
// nomi delle sfere di ogni valore che il gioco usa. Un bit fuori da
// questi e' una regola che non sappiamo leggere: null.
export function decodeElementBits(bits) {
  if (!Number.isInteger(bits) || bits <= 0) return null
  const out = []
  for (let b = 0; b < 22; b++) {
    if (!(bits & (1 << b))) continue
    if (b < 5) for (const c of CLASSES) out.push([TYPES[b], c])
    else if (b >= 12 && b < 17) out.push([TYPES[b - 12], 'Super'])
    else if (b >= 17) out.push([TYPES[b - 17], 'Extreme'])
    else return null
  }
  if (bits >= 1 << 22) return null
  // AGL (bit 0) e Super AGL (bit 12) insieme darebbero la coppia due volte
  const seen = new Set()
  return out.filter(([t, c]) => !seen.has(t + c) && seen.add(t + c))
}

/**
 * Da un id del gioco all'id della nostra carta: le nostre stanno sotto
 * l'id della base (x...0), il gioco nomina spesso la forma Z-awakened
 * (x...1). Null se la carta non l'abbiamo.
 */
export function ourCard(id, have) {
  if (id == null) return null
  if (have.has(id)) return id
  return id % 10 === 1 && have.has(id - 1) ? id - 1 : null
}

const parse = (s) => { try { return JSON.parse(s) } catch { return null } }

/**
 * Le regole per sfera: Map(equipment_id -> { kind, types?, categories?,
 * cards? }), con le carte gia' risolte sulle nostre. Le sfere con una
 * regola illeggibile restano fuori, e si contano in `unreadable`.
 */
export function buildLimits({ items, limitations, cards, uniqueSets, haveCards, haveCategories }) {
  const bySet = new Map()
  for (const l of limitations) {
    const set = int(l.equipment_skill_limitation_set_id)
    if (set != null) bySet.set(set, l)
  }
  // card_unique_info_set -> le nostre carte con quel nome
  const infoToCards = new Map()
  for (const c of cards) {
    const info = int(c.card_unique_info_id), our = ourCard(int(c.id), haveCards)
    if (info == null || our == null) continue
    if (!infoToCards.has(info)) infoToCards.set(info, new Set())
    infoToCards.get(info).add(our)
  }
  const setToInfos = new Map()
  for (const r of uniqueSets) {
    const set = int(r.card_unique_info_set_id), info = int(r.card_unique_info_id)
    if (set == null || info == null) continue
    if (!setToInfos.has(set)) setToInfos.set(set, [])
    setToInfos.get(set).push(info)
  }

  const limits = new Map()
  let unreadable = 0
  for (const it of items) {
    const id = int(it.id), set = int(it.equipment_skill_limitation_set_id)
    if (id == null) continue
    const l = set == null ? null : bySet.get(set)
    if (!l) continue                    // nessuna regola: si monta su tutte
    const cond = parse(l.conditions) ?? {}
    const kind = String(l.type).replace(/^EquipmentSkillLimitation::/, '')
    let rule = null
    if (kind === 'ElementLimitation') {
      const types = decodeElementBits(cond.element_bitpattern)
      if (types) rule = { kind: 'type', types }
    } else if (kind === 'CardCategoryLimitation' && Array.isArray(cond.card_category_ids)) {
      rule = { kind: 'category', categories: [...new Set(cond.card_category_ids)].filter((c) => haveCategories.has(c)) }
    } else if (kind === 'CardLimitation' && Array.isArray(cond.card_ids)) {
      rule = { kind: 'card', cards: [...new Set(cond.card_ids.map((c) => ourCard(c, haveCards)).filter((c) => c != null))] }
    } else if (kind === 'CardUniqueInfoSetLimitation' && Array.isArray(cond.card_unique_info_set_ids)) {
      const ours = new Set()
      for (const s of cond.card_unique_info_set_ids)
        for (const info of setToInfos.get(s) ?? [])
          for (const c of infoToCards.get(info) ?? []) ours.add(c)
      rule = { kind: 'name', cards: [...ours] }
    }
    if (rule) limits.set(id, rule)
    else unreadable++
  }
  return { limits, unreadable }
}
