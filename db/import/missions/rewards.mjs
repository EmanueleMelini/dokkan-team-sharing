// I premi delle missioni: mission_rewards dice (item_type, item_id,
// quantity), il nome sta nella tabella del tipo (data.mjs, ITEM_TABLES).
import { int } from '../datamine.mjs'
import { oneLine } from '../game-events/data.mjs'

// I tipi senza tabella del nome. Sono valute e capienze, e il nome lo
// scriviamo noi: per questo vanno come 'community', non 'official'.
// Per i Point l'id e' un pacchetto di points (id 11 = 1 Dragon Stone,
// 10003 = 1000 Zeni): quantity * amount e' il totale.
const FIXED = {
  'Point::Stone': 'Dragon Stone',
  'Point::Zeni': 'Zeni',
  'Point::GashaPoint': 'Friend Points',
  'Point::ExchangePoint': 'Baba Points',
  Dragonball: 'Dragon Ball',
  'StatusExtension::CardCapacity': 'Box Capacity',
  'StatusExtension::TeamCostCapacity': 'Team Cost',
}

// Il nome per confrontarlo con quello delle icone di reward_item: senza il
// tipo fra quadre ("Z-Sword [AGL]"), parentesi e trattini ("Weight (10t)"
// e' "Weight 10t"). Solo uguaglianza: un'icona sbagliata e' peggio di
// nessuna.
const key = (s) => s.replace(/\s*\[[A-Z]{3}\]\s*$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '')

// item(dm, r) -> { item_type, item_id, name, source, amount } | null se il nome non c'e'
export function item(dm, r) {
  const type = r.item_type, id = int(r.item_id)
  if (FIXED[type]) {
    const amount = type.startsWith('Point::') ? int(dm.points.get(id)?.amount) : 1
    if (!amount) return null
    return { item_type: type, item_id: id, name: FIXED[type], source: 'community', amount }
  }
  const raw = dm.itemName[type]?.get(id)
  if (!raw || !oneLine(raw)) return null
  return { item_type: type, item_id: id, name: oneLine(raw), source: 'official', amount: 1 }
}

// rewardsOf(dm, missionId) -> { rows: [{seq, item_type, item_id, quantity}], items, missing }
export function rewardsOf(dm, missionId) {
  const rows = [], items = [], missing = []
  let seq = 0
  for (const r of dm.rewardsByMission.get(missionId) ?? []) {
    const it = item(dm, r)
    if (!it) { missing.push(`${r.item_type}:${int(r.item_id)}`); continue }
    const quantity = int(r.quantity) * it.amount
    if (!(quantity > 0)) { missing.push(`${r.item_type}:${int(r.item_id)} x${r.quantity}`); continue }
    rows.push({ seq: ++seq, item_type: it.item_type, item_id: it.item_id, quantity })
    items.push(it)
  }
  return { rows, items, missing }
}

// La riga riassunto per mission_text.reward, in inglese come i nomi:
// "Dragon Stone x5, Elder Kai x2" e oltre tre premi "and N more".
export function summary(rows, nameOf) {
  const fmt = (r) => `${nameOf(r)} x${r.quantity.toLocaleString('en-US')}`
  if (rows.length <= 3) return rows.map(fmt).join(', ')
  return rows.slice(0, 3).map(fmt).join(', ') + ` and ${rows.length - 3} more`
}

// Le icone: slug di reward_item per nome uguale. names = [{slug, name}].
export function slugIndex(names) {
  const ix = new Map()
  for (const { slug, name } of names) if (!ix.has(key(name))) ix.set(key(name), slug)
  return (name) => ix.get(key(name)) ?? null
}
