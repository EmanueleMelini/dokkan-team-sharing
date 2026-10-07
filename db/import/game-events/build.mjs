// Dalle righe del gioco alle nostre: nome, stage, difficolta' con stamina,
// exp e zeni, note sul boss, e la carta da usare come copertina.
//
// Le note hanno lo stesso formato di quelle che load-events ricava dal wiki
// per le EZA ("Damage reduction -X%; Immune to: ..."), cosi' il sito le
// mostra uguali; davanti c'e' il nome del boss, che il wiki mette in una
// colonna a parte e qui non ha altro posto.
import { int } from '../datamine.mjs'
import { lastRound, oneLine } from './data.mjs'

// sugoroku_maps.id % 10 e' la difficolta' con cui la mappa e' nata, e non
// cambia piu'. Sui 427 eventi del wiki gia' legati coincide con le
// difficolta' del wiki in 1747 stage su 1788; la colonna `difficulty` solo
// in 1516, perche' il 2025-09-17 il gioco ha declassato 479 mappe vecchie
// (Super 2 -> 3, Super 3 -> 4) e da allora mostra quell'etichetta. Per
// codice, contro la difficolta' del wiki con la stessa stamina: 3 -> super
// 167 volte (super2 8), 4 -> super2 157 (super 2), 5 -> super3 196.
export const DIFF = ['normal', 'hard', 'z_hard', 'super', 'super2', 'super3']

// enemy_skills.efficacy_type: 7 riduzione danni (eff_value1 = %), 10 niente
// stordimento, 14 niente sigillo, 13 niente calo di ATK/DEF (eff_value1:
// 1 ATK, 2 DEF, 3 entrambe). 18 "Disable Interruption" non si mappa sul
// "Disable Action" del wiki (non tornano in 1921 livelli su 2911): fuori.
// L'ordine e' quello di load-events.
const IMMUNITY = ['Stun', 'Seal Super Attack', 'Lower ATK', 'Lower DEF']
function effects(d, skillIds) {
  let dr = null
  const immune = new Set()
  for (const sid of skillIds) {
    const s = d.skill.get(Number(sid))
    if (!s) continue
    const t = int(s.efficacy_type), v = Number(s.eff_value1)
    if (t === 7 && v > 0 && v < 100) dr = Math.max(dr ?? 0, v)
    else if (t === 10) immune.add('Stun')
    else if (t === 14) immune.add('Seal Super Attack')
    else if (t === 13) {
      if (v === 1 || v === 3) immune.add('Lower ATK')
      if (v === 2 || v === 3) immune.add('Lower DEF')
    }
  }
  return { dr, immune }
}
const pct = (v) => String(Math.round(v * 10) / 10)
function note(names, { dr, immune }) {
  const bits = []
  if (names.length) bits.push(`Boss: ${names.join(' & ')}`)
  if (dr != null) bits.push(`Damage reduction -${pct(dr)}%`)
  const im = IMMUNITY.filter((x) => immune.has(x))
  if (im.length) bits.push(`Immune to: ${im.join(', ')}`)
  return bits.join('; ') || null
}

// Una carta nemica e' una variante di quella giocabile: prima la carta di
// cui usa la grafica (cards.resource_id: 9031621 -> 1031621), poi la stessa
// carta senza l'ultima cifra, poi la "base" a cinque cifre (9026411 ->
// 1026410). Vale solo una carta che abbiamo: niente copertina e' meglio di
// una che punta nel vuoto.
export function cardFor(d, enemyId, ours) {
  const e = Number(enemyId)
  if (!e) return null
  const res = Number(d.cardType.get(e)?.resource_id) || 0
  for (const c of [Math.floor(res / 10) * 10, Math.floor(e / 10) * 10, 1_000_000 + Math.floor((e % 100_000) / 10) * 10]) {
    if (ours.has(c)) return c
  }
  return null
}
const enemyName = (d, id) => d.cardName.get(Number(id)) || null

// ------------------------------------------------------------ aree

// Le aree di una famiglia (Million Arena) mettono gli stage uno dopo
// l'altro; un nome gia' usato prende la parentesi del nome dell'area
// ("Preliminary (Single Player)"), o non si distinguerebbe.
const suffixOf = (name) => name.match(/\(([^)]*)\)\s*$/)?.[1] ?? name
function areaStages(d, ev) {
  const stages = []
  for (const areaId of [ev.game_id, ...[...ev.members].sort((a, b) => a - b)]) {
    for (const q of d.questsByArea.get(areaId) ?? []) {
      const tiers = []
      for (const m of d.mapsByQuest.get(int(q.id)) ?? []) {
        const difficulty = DIFF[int(m.id) % 10]
        if (!difficulty || tiers.some((t) => t.difficulty === difficulty)) continue
        const boss = lastRound(d, int(m.id))
        const names = [...new Set((boss ?? []).map((e) => enemyName(d, e.card_id)).filter(Boolean))]
        const fx = effects(d, (boss?.[0]?.enemy_skill_ids ?? []))
        tiers.push({ difficulty, sta_cost: int(m.act), exp: int(m.user_exp), zeni: int(m.zeni),
                     note: boss ? note(names, fx) : null, boss: boss ?? [] })
      }
      if (!tiers.length) continue
      let name = oneLine(q.name) || `Stage ${stages.length + 1}`
      if (stages.some((s) => s.name === name)) name += ` (${suffixOf(oneLine(d.area.get(areaId).name))})`
      stages.push({ seq: stages.length + 1, name, tiers })
    }
  }
  return stages
}

// la copertina: il boss della difficolta' piu' alta dell'ultimo stage, o
// di quello prima se l'ultimo non ha una carta che conosciamo
function areaCover(d, stages, ours) {
  for (const s of [...stages].reverse()) {
    const t = s.tiers.reduce((a, b) => (DIFF.indexOf(b.difficulty) > DIFF.indexOf(a.difficulty) ? b : a))
    for (const e of t.boss) { const c = cardFor(d, e.card_id, ours); if (c) return c }
  }
  return null
}

// ------------------------------------------------------------ EZA

// Il nome come lo scrive il wiki per le 152 EZA che ha: "Extreme Z-Battle:
// <soprannome> <nome>" (143 uguali, 150 a meno di maiuscole e punteggiatura),
// solo il nome quando il soprannome e' "Extreme Z-Battle". Le Super
// prendono il "Super" davanti, come nel gioco: il soprannome e' spesso
// quello della Normal, e due eventi con lo stesso nome non si distinguono.
export function ezaName(d, id) {
  const v = d.zView.get(id)
  const nick = oneLine(v?.enemy_nickname), name = oneLine(v?.enemy_name)
  const body = !nick || /^extreme z-battle$/i.test(nick) ? name : `${nick} ${name}`
  return `${/Super$/.test(d.zStage.get(id)?.type) ? 'Super ' : ''}Extreme Z-Battle: ${body}`
}

// Livelli: l'ultimo premio del primo completamento meno uno (la riga in piu'
// e' il "N+" che si rigioca): torna col wiki in 148 EZA su 152. Le Super
// hanno un livello solo, e una riga sola.
export function ezaLevels(d, id) {
  const max = d.zMaxReward.get(id) ?? 0
  return max > 1 ? max - 1 : max
}

function ezaStages(d, id) {
  const n = ezaLevels(d, id)
  const enemies = [...(d.zEnemiesByStage.get(id) ?? [])].sort((a, b) => int(a.ordinal_num) - int(b.ordinal_num))
  const upTo = (rows, lv) => (rows ?? []).filter((r) => int(r.level) <= lv)
  const sta = new Map((d.zCheckByStage.get(id) ?? []).map((r) => [int(r.level), int(r.act)]))
  const stages = []
  for (let lv = 1; lv <= n; lv++) {
    const here = enemies.filter((e) => (int(e.start_level) ?? 1) <= lv)
    const cards = here.map((e) => upTo(d.zCardsByType.get(e.card_escalation_type), lv)
      .sort((a, b) => int(a.level) - int(b.level)).at(-1)?.card_id).filter(Boolean)
    const names = [...new Set(cards.map((c) => enemyName(d, c)).filter(Boolean))]
    // la riduzione danni: vale l'ultima arrivata; le immunita' si sommano.
    // Del primo nemico, come la colonna del wiki.
    const rows = here[0] ? upTo(d.zSkillsByType.get(here[0].skill_escalation_type), lv) : []
    const lastLv = Math.max(0, ...rows.filter((r) => int(d.skill.get(int(r.enemy_skill_id))?.efficacy_type) === 7).map((r) => int(r.level)))
    const fx = effects(d, rows.filter((r) => int(d.skill.get(int(r.enemy_skill_id))?.efficacy_type) !== 7 || int(r.level) === lastLv)
      .map((r) => r.enemy_skill_id))
    // la stamina c'e' solo per i checkpoint (rigiocare il livello 5, 10...)
    stages.push({ seq: lv, name: `Level ${lv}`, cards,
                  tiers: [{ difficulty: 'eza_level', sta_cost: sta.get(lv) ?? null, exp: null, zeni: null, note: note(names, fx) }] })
  }
  return stages
}

function ezaCover(d, id, stages, ours) {
  const res = cardFor(d, d.zView.get(id)?.enemy_resource_id, ours)
  if (res) return res
  for (const c of stages[0]?.cards ?? []) { const x = cardFor(d, c, ours); if (x) return x }
  return null
}

// ------------------------------------------------------------ insieme

/** ev: un evento di classify(); ours: Set degli id in card. */
export function buildEvent(d, ev, ours) {
  if (ev.game_kind === 'z_battle_stage') {
    const stages = ezaStages(d, ev.game_id)
    return { ...ev, name: ezaName(d, ev.game_id), stages, cover: ezaCover(d, ev.game_id, stages, ours) }
  }
  const stages = areaStages(d, ev)
  // una famiglia si chiama come la gara, senza la fase: "Million Arena"
  const full = oneLine(d.area.get(ev.game_id).name)
  const name = ev.members.length ? full.replace(/\s*\([^)]*\)\s*$/, '') || full : full
  return { ...ev, name, stages, cover: areaCover(d, stages, ours) }
}

// La copertina di un evento del wiki, dal legame che load-windows ha gia'
// trovato: stessa regola, sull'area o sull'EZA.
export function coverOf(d, gameKind, gameId, ours) {
  const ev = { game_kind: gameKind, game_id: gameId, members: [] }
  return gameKind === 'z_battle_stage'
    ? ezaCover(d, gameId, ezaStages(d, gameId), ours)
    : areaCover(d, areaStages(d, ev), ours)
}
