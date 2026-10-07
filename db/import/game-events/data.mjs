// Le tabelle del datamine che servono a load-game-events, gia' indicizzate,
// e le letture che ne fanno le altre parti (classify, build).
//
// Tutto in sola lettura sulla cache di fetch-datamine: niente rete.
import { int, isPreLaunch, isSentinel, loadTable } from '../datamine.mjs'

// La data di partenza fittizia che il gioco mette alle quest degli archivi
// e di molte aree vecchie: non e' un'uscita.
export const PLACEHOLDER = '2015-10-30 00:00:00'
// Il wiki ha smesso di scrivere pagine di eventi qui: l'ultima uscita Global
// che documenta e' del 2025-01-19. Da questa data in poi un'area attiva e
// non legata e' un buco del wiki, prima lo e' solo se nessuno l'ha legata.
export const CUTOFF = '2025-01-20 00:00:00'

export const oneLine = (s) => (s ?? '').replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim()
const push = (m, k, v) => { if (k == null) return; if (!m.has(k)) m.set(k, []); m.get(k).push(v) }

export function loadData() {
  const t = {
    areas: loadTable('areas'), quests: loadTable('quests'), missions: loadTable('missions'),
    maps: loadTable('sugoroku_maps'), enemyInfo: loadTable('sugoroku_map_enemy_informations'),
    skills: loadTable('enemy_skills'), cards: loadTable('cards'),
    zStages: loadTable('z_battle_stages'), zViews: loadTable('z_battle_stage_views'),
    zEnemies: loadTable('z_battle_enemies'), zCards: loadTable('z_battle_enemy_card_escalations'),
    zSkills: loadTable('z_battle_enemy_skill_escalations'),
    zRewards: loadTable('z_battle_first_reward_level_ranges'), zCheck: loadTable('z_battle_check_points'),
  }
  const d = { t }
  d.area = new Map(t.areas.map((a) => [int(a.id), a]))
  d.questsByArea = new Map()
  for (const q of t.quests) push(d.questsByArea, int(q.area_id), q)
  for (const qs of d.questsByArea.values()) qs.sort((a, b) => int(a.id) - int(b.id))
  d.mapsByQuest = new Map()
  for (const m of t.maps) push(d.mapsByQuest, int(m.quest_id), m)
  for (const ms of d.mapsByQuest.values()) ms.sort((a, b) => int(a.id) - int(b.id))
  d.info = new Map(t.enemyInfo.map((r) => [int(r.sugoroku_map_id), r.enemy_info]))
  d.skill = new Map(t.skills.map((s) => [int(s.id), s]))
  d.cardName = new Map(t.cards.map((c) => [int(c.id), oneLine(c.name)]))
  d.cardType = new Map(t.cards.map((c) => [int(c.id), c]))
  d.missionsByArea = new Map()
  d.missionsByStage = new Map()
  for (const m of t.missions) {
    if (!validMission(m)) continue
    push(d.missionsByArea, int(m.area_id), m)
    if (int(m.z_battle_stage_id)) push(d.missionsByStage, int(m.z_battle_stage_id), m)
  }
  d.zStage = new Map(t.zStages.map((s) => [int(s.id), s]))
  d.zView = new Map(t.zViews.map((v) => [int(v.z_battle_stage_id), v]))
  d.zEnemiesByStage = new Map()
  for (const e of t.zEnemies) push(d.zEnemiesByStage, int(e.z_battle_stage_id), e)
  d.zCardsByType = new Map()
  for (const r of t.zCards) push(d.zCardsByType, r.escalation_type, r)
  d.zSkillsByType = new Map()
  for (const r of t.zSkills) push(d.zSkillsByType, r.escalation_type, r)
  d.zMaxReward = new Map()
  for (const r of t.zRewards) {
    const s = int(r.z_battle_stage_id)
    d.zMaxReward.set(s, Math.max(d.zMaxReward.get(s) ?? 0, int(r.level)))
  }
  d.zCheckByStage = new Map()
  for (const r of t.zCheck) push(d.zCheckByStage, int(r.z_battle_stage_id), r)
  return d
}

// Le stesse regole di load-windows: le missioni cancellate, quelle rimaste
// dal giapponese e quelle che finiscono quando iniziano non dicono niente.
export const validMission = (m) => m.type !== 'Mission::DeletedMission' && !isSentinel(m.start_at)
  && !isPreLaunch(m.start_at) && !isPreLaunch(m.end_at) && m.start_at < m.end_at

const realStart = (s) => s && s !== PLACEHOLDER && !isSentinel(s) && !isPreLaunch(s)

// Quando un'area si e' vista su Global: le partenze vere delle quest e
// delle missioni (la prima, e se ce n'e' una dopo il taglio).
export function areaActivity(d, id) {
  const qs = d.questsByArea.get(id) ?? []
  const ms = d.missionsByArea.get(id) ?? []
  const starts = [...qs.map((q) => q.start_at).filter(realStart), ...ms.map((m) => m.start_at)].sort()
  const active = starts.some((s) => s >= CUTOFF) || ms.some((m) => !isSentinel(m.end_at) && m.end_at >= CUTOFF)
  return { first: starts[0] ?? null, active,
           nq: qs.length, nph: qs.filter((q) => q.start_at === PLACEHOLDER).length }
}

export const parseInfo = (d, mapId) => {
  const s = d.info.get(mapId)
  if (!s) return null
  try { return JSON.parse(s) } catch { return null }
}

// I nemici dell'ultimo round dell'ultima battaglia di una mappa: il boss.
// null quando il gioco nasconde i nemici (battles: null).
export function lastRound(d, mapId) {
  const j = parseInfo(d, mapId)
  const battles = j?.battles
  if (!battles?.length) return null
  const rounds = battles.at(-1).rounds ?? []
  return (rounds.at(-1)?.enemies ?? []).filter((e) => e.card_id)
}

// Tutte le carte nemiche di un'area, per "base" a cinque cifre: la
// conferma "stessi boss" di una riedizione (la stessa di game-map.mjs).
export const baseOf = (id) => Math.floor((id % 100000) / 10)
export function areaBosses(d, id) {
  const out = new Set()
  let hidden = 0
  for (const q of d.questsByArea.get(id) ?? []) {
    for (const m of d.mapsByQuest.get(int(q.id)) ?? []) {
      const j = parseInfo(d, int(m.id))
      if (j && !j.battles) { hidden++; continue }
      for (const b of j?.battles ?? []) for (const r of b.rounds ?? []) {
        for (const e of r.enemies ?? []) if (e.card_id) out.add(baseOf(Number(e.card_id)))
      }
    }
  }
  return { bosses: out, hidden }
}
