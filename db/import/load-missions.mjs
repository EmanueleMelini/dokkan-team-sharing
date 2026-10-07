#!/usr/bin/env node
// Le missioni Global degli eventi, con i premi, dal database del gioco.
//
// Il wiki non le ha; il datamine (fetch-datamine) si': missions e
// mission_rewards, con i nomi degli oggetti nelle tabelle dei loro tipi.
// Gira dopo load-windows, perche' gli servono due cose sue:
//   - event_game_ref, per sapere di quale evento e' una missione
//     (missions/owner.mjs: EZA, area, o quest per le aree divise);
//   - le run Global, per attaccare ogni missione alla corsa in cui stava.
//
// La corsa (mission.run_id):
//   - una missione che scade nel 2038 non ha una scadenza sua: c'e' ogni
//     volta che l'evento e' aperto, in ogni corsa. run_id nullo, ed
//     ends_at nullo. E' il "permanente" dello schema, per la missione;
//   - una con una fine vera sta nella run Global dello stesso evento che
//     contiene la sua finestra. Se non ce n'e' una, si salta e si elenca:
//     nulla vorrebbe dire "permanente", e sarebbe falso.
// seq e' l'ordine del gioco: priority piu' alta prima (lo stage 1 ha 30014,
// lo stage 2 30013), a parita' l'id.
//
// Idempotente: upsert per game_mission_id, gli id restano. Le missioni del
// gioco che non ci sono piu' nella fotografia restano (sono storia, come le
// run del gioco); quelle ancora nel gioco che le regole non danno piu' a
// nessun evento si tolgono.
//
//   node db/import/load-missions.mjs [--dry-run] [--verbose]
import pg from 'pg'
import { connectionString, describeTarget } from '../env.mjs'
import { gameEnd, gameStart, int, isSentinel, snapshotInfo } from './datamine.mjs'
import { loadMissionData, questAreas } from './missions/data.mjs'
import { owners, refIndex } from './missions/owner.mjs'
import { rewardsOf, slugIndex, summary } from './missions/rewards.mjs'
import { cleanDescription, cleanName, notEnglish } from './missions/text.mjs'
import { writeItems, writeMissions, writeRewards } from './missions/write.mjs'

const DRY = process.argv.includes('--dry-run')
const VERBOSE = process.argv.includes('--verbose')

console.log(`  database: ${describeTarget()}`)
console.log(`  datamine: ${snapshotInfo()}`)

const client = new pg.Client({ connectionString: connectionString() })
await client.connect()
try {
  const dm = loadMissionData()
  const ix = refIndex((await client.query(
    `select event_id, game_kind, game_id, related_game_id from event_game_ref`)).rows)
  dm.questAreas = questAreas(ix, dm)
  const runs = new Map()
  for (const r of (await client.query(
    `select id, event_id, starts_at, ends_at from event_run where reg = 'global'`)).rows) {
    const e = Number(r.event_id)
    if (!runs.has(e)) runs.set(e, [])
    runs.get(e).push(r)
  }
  const slugOf = slugIndex((await client.query(
    `select slug, name from reward_item_text where locale = 'en'`)).rows)
  const cards = new Set((await client.query(`select id from card`)).rows.map((r) => Number(r.id)))

  const { own, skipped } = owners(dm.missions, ix, dm)
  const byId = new Map(dm.missions.map((m) => [m.id, m]))
  const items = new Map(), out = []
  for (const [gid, event_id] of own) {
    const m = byId.get(gid)
    const name = cleanName(m.name), description = cleanDescription(m.description)
    if (notEnglish(name + description)) { skipped.push({ id: gid, why: 'testo non inglese' }); continue }
    if (!description) { skipped.push({ id: gid, why: 'senza descrizione' }); continue }
    const starts_at = gameStart(m.start_at)
    const ends_at = isSentinel(m.end_at) ? null : gameEnd(m.end_at)
    let run_id = null
    if (ends_at) {
      const fit = (runs.get(event_id) ?? [])
        .filter((r) => r.starts_at <= starts_at && (r.ends_at == null || ends_at <= r.ends_at))
        .sort((a, b) => b.starts_at - a.starts_at)
      if (!fit.length) { skipped.push({ id: gid, why: 'nessuna corsa la contiene', events: [event_id] }); continue }
      run_id = Number(fit[0].id)
    }
    const rw = rewardsOf(dm, gid)
    if (rw.missing.length) { skipped.push({ id: gid, why: 'premio senza nome', items: rw.missing }); continue }
    if (!rw.rows.length) { skipped.push({ id: gid, why: 'senza premi' }); continue }
    for (const it of rw.items) {
      items.set(`${it.item_type}:${it.item_id}`, {
        ...it, slug: slugOf(it.name), card_id: it.item_type === 'Card' && cards.has(it.item_id) ? it.item_id : null,
      })
    }
    const nameOf = (r) => items.get(`${r.item_type}:${r.item_id}`).name
    out.push({ game_id: int(gid), event_id, run_id, starts_at, ends_at, name, description,
               reward: summary(rw.rows, nameOf), rewards: rw.rows, priority: int(m.priority) ?? 0 })
  }

  // l'ordine del gioco, evento per evento
  const perEvent = new Map()
  for (const m of out) { if (!perEvent.has(m.event_id)) perEvent.set(m.event_id, []); perEvent.get(m.event_id).push(m) }
  for (const ms of perEvent.values()) {
    ms.sort((a, b) => b.priority - a.priority || a.game_id - b.game_id)
    ms.forEach((m, i) => { m.seq = i + 1 })
  }

  const perm = out.filter((m) => m.run_id == null).length
  console.log(`\n  missioni: ${out.length} su ${perEvent.size} eventi`
    + ` (${perm} senza scadenza propria, ${out.length - perm} in una corsa)`)
  console.log(`  premi: ${out.reduce((n, m) => n + m.rewards.length, 0)}, oggetti: ${items.size}`
    + ` (${[...items.values()].filter((i) => i.slug).length} con icona, ${[...items.values()].filter((i) => i.card_id).length} carte nostre)`)
  const why = new Map()
  for (const s of skipped) why.set(s.why, [...(why.get(s.why) ?? []), s])
  console.log(`  saltate: ${skipped.length}`)
  for (const [w, ss] of [...why].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`    ${String(ss.length).padStart(4)}  ${w}`)
    for (const s of ss.slice(0, VERBOSE ? Infinity : 3)) {
      console.log(`            ${s.id}${s.area ? ` area ${s.area}` : ''}${s.events ? ` eventi ${s.events.slice(0, 6).join(', ')}` : ''}${s.items ? ` ${s.items.join(' ')}` : ''}`)
    }
  }

  await client.query('begin')
  const wi = await writeItems(client, items)
  const wm = await writeMissions(client, out)
  const wr = await writeRewards(client, out, wm.ids)
  // le missioni del gioco che le regole non danno piu' a nessuno
  const still = new Set(dm.missions.map((m) => int(m.id)))
  const stale = (await client.query(
    `select id, game_mission_id from mission where imported_from = 'datamine'`)).rows
    .filter((r) => !wm.ids.has(r.game_mission_id))
  const drop = stale.filter((r) => still.has(r.game_mission_id)).map((r) => r.id)
  if (drop.length) await client.query(`delete from mission where id = any($1::bigint[])`, [drop])
  // gli oggetti che nessun premio usa piu'
  const orphan = await client.query(`
    delete from game_item g where not exists
      (select 1 from mission_reward w where w.item_type = g.item_type and w.item_id = g.item_id)`)
  console.log(`\n  scritte: missioni ${wm.inserted} nuove, ${wm.updated} cambiate, testi ${wm.texts};`
    + ` premi ${wr.written} scritti, ${wr.removed} tolti; oggetti ${wi.items}, nomi ${wi.texts}`)
  console.log(`  tolte: ${drop.length} missioni non piu' assegnate, ${orphan.rowCount} oggetti senza premi;`
    + ` ${stale.length - drop.length} uscite dal gioco restano`)
  if (DRY) {
    await client.query('rollback')
    console.log('\n  --dry-run: niente e\' stato scritto')
  } else {
    await client.query('commit')
  }
} catch (err) {
  await client.query('rollback').catch(() => {})
  throw err
} finally {
  await client.end()
}
