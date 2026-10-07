// A quale dei nostri eventi appartiene una missione del gioco.
//
// Il gioco lo dice con missions.area_id e z_battle_stage_id, e il ponte con
// i nostri eventi e' event_game_ref (le righe di load-windows e di
// load-game-events). Tre strade, nell'ordine:
//   z_battle_stage  le missioni di un'EZA;
//   area            quelle di un'area legata a un evento;
//   quest           le aree che sono di piu' eventi (Super Battle Road,
//                   archivi, migrazione 0012): decide la quest delle mappe
//                   nelle condizioni, o, per le "completa queste missioni",
//                   l'evento delle missioni elencate.
// Non si indovina mai: una missione che non arriva a un evento solo resta
// fuori, con il motivo.
import { int } from '../datamine.mjs'
import { validMission } from '../game-events/data.mjs'

export const cond = (m) => {
  try { return JSON.parse(m.conditions || '{}') ?? {} } catch { return {} }
}

// I legami per tipo: Map game_id -> event_id.
export function refIndex(rows) {
  const ix = { area: new Map(), z_battle_stage: new Map(), quest: new Map(), superOf: new Map() }
  for (const r of rows) {
    ix[r.game_kind]?.set(int(r.game_id), Number(r.event_id))
    // Super EZA: lo stage Normal da cui pende -> lo stage Super
    if (r.game_kind === 'z_battle_stage' && r.related_game_id != null) {
      ix.superOf.set(int(r.related_game_id), int(r.game_id))
    }
  }
  return ix
}

// Gli eventi che le condizioni nominano: le mappe (per la loro quest, o
// l'area della quest), le aree e le EZA. Un id che non e' nostro non conta.
function namedEvents(c, ix, dm) {
  const out = new Set()
  for (const mp of c.sugoroku_map_ids ?? []) {
    const q = dm.mapQuest.get(mp)
    const ev = ix.quest.get(q) ?? ix.area.get(dm.questArea.get(q))
    if (ev) out.add(ev)
  }
  for (const id of c.quest_ids ?? []) { const ev = ix.quest.get(id); if (ev) out.add(ev) }
  for (const a of c.area_ids ?? []) { const ev = ix.area.get(a); if (ev) out.add(ev) }
  for (const z of c.z_battle_ids ?? []) { const ev = ix.z_battle_stage.get(z); if (ev) out.add(ev) }
  return out
}

// owners(missions, ix, dm) -> { own: Map(mission id -> event_id), skipped: [{id, why, ...}] }
export function owners(missions, ix, dm) {
  const own = new Map(), skipped = [], pending = []
  const skip = (m, why, extra = {}) => skipped.push({ id: m.id, area: int(m.area_id), why, ...extra })
  for (const m of missions) {
    const a = int(m.area_id), z = int(m.z_battle_stage_id)
    if (!a && !z) continue
    const ez = ix.z_battle_stage.get(z), ea = ix.area.get(a)
    if (!ez && !ea && !dm.questAreas.has(a)) continue // area o EZA che non e' nostra
    // dopo il filtro sul legame: le cancellate e le giapponesi di aree
    // non nostre non sono affar nostro, e non si contano
    if (m.type === 'Mission::DeletedMission') { skip(m, 'cancellata'); continue }
    if (!validMission(m)) { skip(m, 'senza finestra Global'); continue }
    if (ez && ea && ez !== ea) { skip(m, 'area ed EZA di due eventi', { events: [ea, ez] }); continue }
    const c = cond(m)
    let ev = ez ?? ea
    // Le missioni di una Super EZA stanno sullo stage Normal
    // (z_battle_stage_id) e nominano lo stage Super nelle condizioni
    // ("at Lv. SUPER"): sono della Super, che da noi e' un evento a se'.
    const sup = ix.superOf.get(z)
    if (ez && sup && (c.z_battle_ids ?? []).includes(sup)) ev = ix.z_battle_stage.get(sup)
    if (!ev) {
      const evs = namedEvents(c, ix, dm)
      if (evs.size === 1) ev = [...evs][0]
      else if (evs.size > 1) { skip(m, 'quest di piu\' eventi', { events: [...evs] }); continue }
      else if (c.mission_ids?.length) { pending.push(m); continue }
      else { skip(m, 'quest senza evento'); continue }
    }
    // Le campagne: missioni appese a un'area che chiedono stage di un altro
    // dei nostri eventi ("Go Forth!": un'area e sei eventi). Di nessuno.
    const others = [...namedEvents(c, ix, dm)].filter((e) => e !== ev)
    if (others.length) { skip(m, 'campagna su piu\' eventi', { events: [ev, ...others] }); continue }
    own.set(m.id, ev)
  }
  // "Completa tutte le missioni degli stage 8-15": l'evento di quelle.
  for (const m of pending) {
    const evs = new Set(cond(m).mission_ids.map((id) => own.get(String(id))).filter(Boolean))
    if (evs.size === 1) own.set(m.id, [...evs][0])
    else skip(m, evs.size ? 'completa missioni di piu\' eventi' : 'quest senza evento', { events: [...evs] })
  }
  return { own, skipped }
}
