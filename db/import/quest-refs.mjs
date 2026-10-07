// I legami per quest (game_kind = 'quest', migrazione 0012): le aree del
// gioco che il wiki divide in piu' pagine, e le loro finestre.
//
// Due famiglie, ognuna con la sua regola e due chiavi, come in game-map:
//
//   range    Super Battle Road. Un'area per modalita' (710, 720), un piano
//            per quest; il wiki ha una pagina ogni dieci piani, "Super Battle
//            Road 11 - 20". La pagina prende le quest dalla 11a alla 20a
//            dell'area con lo stesso nome, se i nomi dei suoi stage sono
//            quelli delle quest (almeno meta': il wiki ne scrive a volte meno,
//            81 - 90 ne ha 5).
//   archive  gli archivi 1737 Ultimate Red Zone e 1738 Supreme Magnificent
//            Battle. Ripropongono le edizioni vecchie come "GT Edition Stage
//            3": la quest va all'evento dell'area "Ultimate Red Zone [GT
//            Edition]", se i boss delle quest con quel prefisso sono quelli
//            dell'edizione (misurato: 1.00 per tutte).
//
// Le finestre. Le due famiglie non chiudono mai: SBR aggiunge piani alla
// stessa area dal 2018 (l'ultimo nel 2026) e i primi sono ancora li', con le
// missioni del 2018; gli archivi esistono per tenere in gioco le edizioni
// finite. Quindi, finche' l'area e' accesa (l'ultimo blocco di missioni non
// scade, come per le aree normali), la quest e' una corsa PERMANENTE, dalla
// sua partenza vera. Le quest degli archivi hanno quasi tutte la partenza
// fittizia (2015-10-30): per loro vale l'apertura dell'archivio, la prima
// missione che parla solo delle sue mappe (le missioni piu' vecchie sono
// quelle delle edizioni, trasferite con la loro data e le mappe di prima).
import { gameStart, int, isPreLaunch, isSentinel } from './datamine.mjs'
import { norm } from './game-map.mjs'

const PLACEHOLDER = '2015-10-30 00:00:00'
const oneLine = (s) => (s ?? '').replace(/\s*\n\s*/g, ' ').trim()
const realStart = (s) => !!s && s !== PLACEHOLDER && !isSentinel(s) && !isPreLaunch(s)
// lo stesso filtro di load-windows: missioni cancellate, giapponesi o vuote
const validMission = (m) => m.type !== 'Mission::DeletedMission' && !isSentinel(m.start_at)
  && !isPreLaunch(m.start_at) && !isPreLaunch(m.end_at) && m.start_at < m.end_at
// il nome di uno stage senza la variante che il wiki scrive fra parentesi
const stageKey = (s) => norm((s ?? '').replace(/\s*\([^)]*\)\s*$/, ''))
const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v) }

function index(dm) {
  const questsByArea = new Map()
  for (const q of dm.quests) push(questsByArea, int(q.area_id), q)
  for (const qs of questsByArea.values()) qs.sort((a, b) => int(a.id) - int(b.id))
  const areaByName = new Map()
  for (const a of dm.areas) if (/EventArea/.test(a.type)) push(areaByName, norm(oneLine(a.name)), a)
  const questOfMap = new Map(dm.sugorokuMaps.map((m) => [int(m.id), int(m.quest_id)]))
  const mapsByQuest = new Map()
  for (const m of dm.sugorokuMaps) push(mapsByQuest, int(m.quest_id), int(m.id))
  const info = new Map(dm.sugorokuEnemies.map((r) => [int(r.sugoroku_map_id), r.enemy_info]))
  const missionsByArea = new Map()
  for (const m of dm.missions) if (int(m.area_id) != null && validMission(m)) push(missionsByArea, int(m.area_id), m)
  return { questsByArea, areaByName, questOfMap, mapsByQuest, info, missionsByArea,
           quest: new Map(dm.quests.map((q) => [int(q.id), q])) }
}

// I nemici di una quest per "base" a cinque cifre (come game-map e classify)
function bossesOf(ix, questIds) {
  const out = new Set()
  for (const q of questIds) for (const mapId of ix.mapsByQuest.get(q) ?? []) {
    let j = null
    try { j = JSON.parse(ix.info.get(mapId) ?? 'null') } catch { /* nemici illeggibili */ }
    for (const b of j?.battles ?? []) for (const r of b.rounds ?? []) {
      for (const e of r.enemies ?? []) if (e.card_id) out.add(Math.floor((Number(e.card_id) % 100000) / 10))
    }
  }
  return out
}
const cover = (A, B) => { if (!A.size || !B.size) return 0; let i = 0; for (const x of A) if (B.has(x)) i++; return i / A.size }

/**
 * events:   gli eventi del wiki come li da' wikiRefs: [{ id, wiki_title, name, stages }]
 * areaRefs: i legami per area gia' decisi, del wiki e del gioco: [{ game_id, event_id }]
 * Ritorna { refs, skipped, ix }:
 *   refs     [{ event_id, game_kind: 'quest', game_id, via, keys, confidence, area }]
 *   skipped  [{ area, what, why }], per il riepilogo
 */
export function questRefs(events, dm, areaRefs) {
  const ix = index(dm)
  const refs = [], skipped = []
  const taken = new Set()
  const add = (r) => { if (taken.has(r.game_id)) return; taken.add(r.game_id); refs.push(r) }
  const unique = (name) => { const as = ix.areaByName.get(norm(name)) ?? []; return as.length === 1 ? as[0] : null }

  // range: "Super Battle Road 11 - 20"
  for (const e of events) {
    const m = (e.wiki_title ?? '').match(/^(.*?)\s+(\d+)\s*-\s*(\d+)$/)
    const a = m && unique(m[1])
    if (!a) continue
    const qs = (ix.questsByArea.get(int(a.id)) ?? []).slice(Number(m[2]) - 1, Number(m[3]))
    // Extreme 1 - 10 ripete i nomi della Super ("[VS. Extreme AGL] Super
    // Battle Road"), il gioco li tronca ("[VS. Extreme AGL]"): vale anche
    // il nome della quest come inizio di quello dello stage
    const names = qs.map((q) => stageKey(oneLine(q.name))).filter(Boolean)
    const stages = (e.stages ?? []).map(stageKey).filter(Boolean)
    const hit = stages.filter((s) => names.some((n) => s === n || s.startsWith(`${n} `))).length
    if (!qs.length || hit * 2 < stages.length || !stages.length) {
      skipped.push({ area: int(a.id), what: `${e.id} ${e.wiki_title}`, why: `stage in comune con le quest ${hit} su ${stages.length}` })
      continue
    }
    for (const q of qs) add({ event_id: e.id, game_kind: 'quest', game_id: int(q.id), via: 'range',
      keys: ['range', 'stage'], confidence: 'high', area: int(a.id) })
  }

  // archive: "GT Edition Stage 3" dentro "Ultimate Red Zone"
  const eventOfArea = new Map(areaRefs.map((r) => [Number(r.game_id), Number(r.event_id)]))
  for (const [areaId, qs] of ix.questsByArea) {
    const hub = dm.areas.find((a) => int(a.id) === areaId)
    if (!hub || !/EventArea/.test(hub.type)) continue
    const byPrefix = new Map()
    for (const q of qs) {
      const m = oneLine(q.name).match(/^(.*\S)\s+Stage\s+(\d+)$/)
      if (m) push(byPrefix, m[1], int(q.id))
    }
    for (const [prefix, ids] of byPrefix) {
      const ed = unique(`${oneLine(hub.name)} [${prefix}]`)
      if (!ed) continue
      const what = `${prefix} (area ${int(ed.id)})`
      const ev = eventOfArea.get(int(ed.id))
      if (ev == null) { skipped.push({ area: areaId, what, why: 'l\'edizione non ha un evento' }); continue }
      const edQuests = (ix.questsByArea.get(int(ed.id)) ?? []).map((q) => int(q.id))
      const c = cover(bossesOf(ix, ids), bossesOf(ix, edQuests))
      if (c < 0.5) { skipped.push({ area: areaId, what, why: `boss in comune ${c.toFixed(2)}` }); continue }
      for (const id of ids) add({ event_id: ev, game_kind: 'quest', game_id: id, via: 'archive',
        keys: ['name', 'boss'], confidence: 'high', area: areaId })
    }
  }
  return { refs, skipped, ix }
}

// L'apertura di un archivio: la prima missione che parla solo delle sue
// mappe. 1737 e 1738 aprono il 2026-01-22 05:00 (non ci sono nella
// fotografia del 2025-12-26, ci sono in quella del 2026-03-23).
function opening(ix, areaId) {
  let first = null
  for (const m of ix.missionsByArea.get(areaId) ?? []) {
    let maps = []
    try { maps = JSON.parse(m.conditions || '{}').sugoroku_map_ids ?? [] } catch { /* condizioni illeggibili */ }
    if (!maps.length || !maps.every((id) => int(ix.quest.get(ix.questOfMap.get(int(id)))?.area_id) === areaId)) continue
    if (first == null || m.start_at < first) first = m.start_at
  }
  return first
}

// Le finestre di una quest legata: [{ start, end: null, known: true, kind:
// 'permanent', sameRelease }] oppure { none } col motivo. sameRelease: la
// pagina del wiki E' quella fetta dell'area (range), quindi la sua run e'
// la stessa uscita anche se la data del wiki sbaglia; per gli archivi no,
// la run del wiki e' l'edizione originale, che l'archivio segue.
export function questWindows(ix, questId, via) {
  const q = ix.quest.get(questId)
  if (!q) return { none: 'quest sparita' }
  const area = int(q.area_id)
  const ms = ix.missionsByArea.get(area) ?? []
  if (!ms.length) return { none: 'area senza missioni' }
  const last = ms.reduce((x, m) => (m.start_at > x ? m.start_at : x), '')
  if (!ms.filter((m) => m.start_at === last).every((m) => isSentinel(m.end_at))) return { none: 'area spenta' }
  const start = realStart(q.start_at) ? q.start_at : opening(ix, area)
  if (!start) return { none: 'nessuna partenza vera' }
  return [{ start: gameStart(start), end: null, known: true, kind: 'permanent', sameRelease: via === 'range' }]
}
