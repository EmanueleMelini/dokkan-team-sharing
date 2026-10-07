#!/usr/bin/env node
// Le finestre Global degli eventi, dal database del gioco.
//
// Il wiki da' solo la prima uscita, quindi ogni evento importato risultava
// attivo per sempre. Il datamine Global (fetch-datamine) ha le finestre,
// ma non per evento: le ha per MISSIONE e per EZA, e i suoi eventi hanno
// id che il wiki non conosce. Questo script:
//
//   1. lega i nostri eventi alle aree e alle EZA del gioco (game-map.mjs)
//      e scrive il legame in event_game_ref, ricostruito a ogni giro (le
//      sue righe, source = 'wiki': quelle di load-game-events restano, e
//      danno le finestre anche agli eventi creati dal gioco);
//   2. ricava le finestre di ogni area/EZA:
//        area  le missioni con missions.area_id = area (non i legami dentro
//              `conditions`, che portano le campagne di piu' eventi). Ogni
//              gruppo di missioni con la stessa fine vera e' una corsa, dal
//              suo primo inizio (una corsa puo' aggiungere uno stage a
//              meta'); le fasi che si toccano sono la stessa corsa. Alcune
//              repliche hanno missioni nuove e restano nella fotografia
//              accanto alla corsa attuale (l'area 503 ha dicembre 2024 e
//              ottobre 2026): sono storia vera, e si tengono. Se l'ultimo
//              blocco scade tutto nel 2038, si sa quando e' iniziato e non
//              quando finisce: fine NON nota, non permanente (la Brief
//              Breather di aprile ha missioni 2038).
//        EZA   z_battle_stages.start_at/end_at, la finestra in lista. Qui
//              il 2038 vuol dire davvero "per sempre": permanente, fine nota.
//              Il Portale dei Ricordi (eventkagi_*, a chiavi) non e' "attivo".
//   3. le riconcilia con le run Global che ci sono, una per una.
//
// Il database del gioco e' una fotografia: ogni giro SOVRASCRIVE la corsa
// precedente di un'area con la nuova. Quindi le run del gioco si
// accumulano, non si cancellano mai: la storia esiste solo qui.
//
// Precedenza manual > game > wiki, e ogni passo tiene gli id (i clear
// puntano a event_run senza cascata):
//   - una finestra che tocca una run a mano (set-event-window) si salta;
//   - la run del wiki della stessa uscita (inizio a meno di due giorni, o
//     dentro la finestra) diventa la run del gioco, sul posto;
//   - una run piu' vecchia che si sovrappone (wiki, o una del gioco rimasta
//     aperta) si chiude all'inizio della finestra, con la fine non nota:
//     e' finita in un momento che non sappiamo, non dopo quello;
//   - altrimenti la finestra entra come run nuova, source = 'game';
//   - i clear restano sulla corsa in cui sono stati scritti: se la run
//     chiusa li porta tutti dentro la corsa che la segue, le due righe si
//     scambiano (vedi il passo 4).
// Japan non si tocca: il datamine e' quello Global.
//
//   node db/import/load-windows.mjs [--dry-run] [--verbose]
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { connectionString, describeTarget } from '../env.mjs'
import { gameEnd, gameStart, int, isPreLaunch, isSentinel, loadTable, snapshotInfo } from './datamine.mjs'
import { wikiGlobalRelease } from './game-map.mjs'
import { wikiRefs } from './game-events/wiki-refs.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const DRY = process.argv.includes('--dry-run')
const VERBOSE = process.argv.includes('--verbose')
// La data del wiki e' un giorno (la mezzanotte UTC, vedi load-events), la
// finestra un istante UTC: 342 prime uscite su 378 cadono entro due giorni.
const TOL = 2 * 86_400_000
// Due blocchi di missioni 2038 a meno di un mese l'uno dall'altro sono la
// stessa apertura a stage scaglionati: gli stacchi misurati sono 7-28
// giorni, poi si salta a 33, 50 e oltre (riaperture vere).
const STEP = 31 * 86_400_000

console.log(`  database: ${describeTarget()}`)
console.log(`  sorgente: datamine Global, ${snapshotInfo()}`)

const wiki = JSON.parse(readFileSync(join(HERE, '.cache', 'wiki-events.json'), 'utf8'))
const pages = new Map(wiki.pages.map((p) => [p.pageid, p.wikitext]))
const dm = {
  areas: loadTable('areas'), quests: loadTable('quests'), missions: loadTable('missions'),
  areaTabs: loadTable('area_tabs'),
  sugorokuMaps: loadTable('sugoroku_maps'), sugorokuEnemies: loadTable('sugoroku_map_enemy_informations'),
  zStages: loadTable('z_battle_stages'), zViews: loadTable('z_battle_stage_views'),
  zEnemies: loadTable('z_battle_enemies'), zEscalations: loadTable('z_battle_enemy_card_escalations'),
}

// ------------------------------------------------------------ le finestre

const missionsByArea = new Map()
for (const m of dm.missions) {
  const a = int(m.area_id)
  if (a == null) continue
  if (!missionsByArea.has(a)) missionsByArea.set(a, [])
  missionsByArea.get(a).push(m)
}
const validMission = (m) => m.type !== 'Mission::DeletedMission' && !isSentinel(m.start_at)
  && !isPreLaunch(m.start_at) && !isPreLaunch(m.end_at) && m.start_at < m.end_at
const missionsByStage = new Map()
for (const m of dm.missions) {
  const z = int(m.z_battle_stage_id)
  if (!z || !validMission(m)) continue
  if (!missionsByStage.has(z)) missionsByStage.set(z, [])
  missionsByStage.get(z).push(m)
}
const areasWithQuests = new Set(dm.quests.filter((q) => !isSentinel(q.start_at)).map((q) => int(q.area_id)))
// la prima partenza vera delle quest di un'area (2015-10-30 e' la data
// fittizia degli archivi): serve solo agli eventi del gioco, sotto
const questStart = new Map()
for (const q of dm.quests) {
  const s = q.start_at, a = int(q.area_id)
  if (!s || s === '2015-10-30 00:00:00' || isSentinel(s) || isPreLaunch(s)) continue
  if (!questStart.has(a) || s < questStart.get(a)) questStart.set(a, s)
}
const stageById = new Map(dm.zStages.map((s) => [int(s.id), s]))
const max = (a) => a.reduce((x, y) => (y > x ? y : x))

// Le finestre di un'area: [{ start, end (esclusiva, null = aperta), known,
// kind }], oppure { none } col motivo.
// fromQuests: per i legami di load-game-events. Un evento del wiki senza
// missioni tiene la run del wiki; uno creato dal gioco non ne ha nessuna, e
// una riedizione attaccata dal gioco (1226, 1219-1223) senza missioni non
// darebbe nessun segno di essere tornata. Allora vale la partenza delle
// quest: si sa quando e' iniziata, non quando finisce.
function areaWindows(id, fromQuests = false) {
  // le missioni cancellate, quelle ereditate dal giapponese e quelle che
  // finiscono quando iniziano (o prima) non dicono niente sull'evento. Una
  // riga giapponese puo' anche essere ancora accesa: l'area 120 ha una
  // missione dal 2015-04-01 che scade nel 2038, e senza il filtro sull'inizio
  // Korin Tower risultava su Global da prima del lancio.
  const ms = (missionsByArea.get(id) ?? []).filter(validMission)
  if (!ms.length && fromQuests && questStart.has(id)) {
    return [{ start: gameStart(questStart.get(id)), end: null, known: false, kind: 'open' }]
  }
  if (!ms.length) return { none: areasWithQuests.has(id) ? 'area con sole quest' : 'area spenta o senza quest' }
  const firstStart = new Map()   // fine vera -> primo inizio con quella fine
  for (const m of ms) {
    if (isSentinel(m.end_at)) continue
    const s = firstStart.get(m.end_at)
    if (s == null || m.start_at < s) firstStart.set(m.end_at, m.start_at)
  }
  const ws = [...firstStart].map(([end, start]) =>
    ({ start: gameStart(start), end: gameEnd(end), known: true, kind: 'window' }))
  // l'ultimo blocco senza scadenza: e' iniziato, e non si sa quando finisce.
  // E non e' iniziato con l'ultimo blocco: si risale ai blocchi 2038 di
  // prima finche' lo stacco resta sotto il mese e nessuna fine vera cade in
  // mezzo. Il Super Warrior Memorial (area 1306) apre il 07-07 con 11
  // missioni e aggiunge stage il 07-18 e il 08-05: partire dal 08-05
  // lasciava scoperto un mese. Uno stacco lungo (area 404: 2016, poi 2023)
  // e' una riapertura, e conta da li'.
  const last = max(ms.map((m) => m.start_at))
  if (ms.filter((m) => m.start_at === last).every((m) => isSentinel(m.end_at))) {
    const realEnds = ms.filter((m) => !isSentinel(m.end_at)).map((m) => m.end_at)
    const batches = [...new Set(ms.filter((m) => isSentinel(m.end_at)).map((m) => m.start_at))].sort().reverse()
    let from = last
    for (const p of batches) {
      if (p >= from) continue
      if (gameStart(from) - gameStart(p) > STEP || realEnds.some((e) => e > p && e <= from)) break
      from = p
    }
    ws.push({ start: gameStart(from), end: null, known: false, kind: 'open' })
  }
  // al minuto una finestra di pochi secondi diventa vuota: era spenta
  const ok = mergeWindows(ws.filter((w) => w.end == null || w.end > w.start))
  return ok.length ? ok : { none: 'finestre vuote' }
}

function stageWindows(id) {
  const z = stageById.get(id)
  if (!z?.start_at || isSentinel(z.start_at) || isPreLaunch(z.end_at)) return { none: 'EZA spenta' }
  if (isSentinel(z.end_at)) return [{ start: gameStart(z.start_at), end: null, known: true, kind: 'permanent' }]
  // La riga tiene solo l'ultima messa in lista. Se le missioni dello stage
  // partono dopo la sua fine, la riga e' rimasta indietro e la corsa vera e'
  // quella delle missioni: l'EZA di Jiren (stage 10) ha nella riga
  // 2018-05-21 → 06-06, prima perfino dell'uscita giapponese, e nelle
  // missioni 2018-09-13 05:00 → 10-11, le 21:00 PST del wiki Global. Succede
  // solo li' (misurato sul datamine di ottobre 2026).
  const later = new Map()   // fine vera -> primo inizio con quella fine
  for (const m of missionsByStage.get(id) ?? []) {
    if (isSentinel(m.end_at) || m.start_at < z.end_at) continue
    const s = later.get(m.end_at)
    if (s == null || m.start_at < s) later.set(m.end_at, m.start_at)
  }
  const ws = later.size
    ? [...later].map(([end, start]) => ({ start: gameStart(start), end: gameEnd(end), known: true, kind: 'window' }))
    : [{ start: gameStart(z.start_at), end: gameEnd(z.end_at), known: true, kind: 'window' }]
  const ok = mergeWindows(ws.filter((w) => w.end > w.start))
  return ok.length ? ok : { none: 'EZA spenta' }
}

// Finestre che si sovrappongono o si toccano sono la stessa corsa: le fasi
// di un'area (missioni a blocchi di due settimane, o giornaliere), o le
// aree di uno stesso evento (le riedizioni, le rotazioni per tipo). E il
// vincolo run_no_overlap non ne vuole due sovrapposte.
function mergeWindows(ws) {
  const out = []
  for (const w of [...ws].sort((a, b) => a.start - b.start)) {
    const cur = out.at(-1)
    if (cur && (cur.end == null || w.start <= cur.end)) {
      const end = cur.end == null || w.end == null ? null : (w.end > cur.end ? w.end : cur.end)
      // aperta e nota solo se ogni pezzo aperto e' permanente
      cur.known = (cur.end != null || cur.known) && (w.end != null || w.known)
      cur.end = end
      cur.kind = end == null ? (cur.known ? 'permanent' : 'open') : 'window'
      cur.wikiWrong ||= w.wikiWrong
    } else out.push({ ...w })
  }
  return out
}

// ------------------------------------------------------------ scrittura

const client = new pg.Client({ connectionString: connectionString() })
await client.connect()

const time = (d) => (d == null ? null : d.getTime())
const day = (d) => (d == null ? 'aperta' : d.toISOString().slice(0, 16).replace('T', ' '))
const overlaps = (r, w) => r.starts_at < (w.end ?? Infinity) && w.start < (r.ends_at ?? Infinity)
const tally = (a) => { const m = new Map(); for (const v of a) m.set(v, (m.get(v) ?? 0) + 1); return m }

// Lo stato di ogni evento su Global come lo mostra la lista del sito: la
// ricorrenza in corso, se no la prossima, se no l'ultima conclusa.
const STATUS_SQL = `
  with u as (
    select distinct on (es.event_id) es.event_id, es.status, r.ends_at_known
    from event_status es join event_run r on r.id = es.run_id
    where es.reg = 'global'
    order by es.event_id,
             case es.status when 'active' then 0 when 'upcoming' then 1 else 2 end,
             case when es.status = 'upcoming' then es.starts_at end asc nulls last,
             es.starts_at desc)
  select status, ends_at_known as known, count(*)::int as n from u group by 1, 2`
async function statusNow() {
  const { rows } = await client.query(STATUS_SQL)
  const n = (s, k) => rows.filter((r) => r.status === s && (k == null || r.known === k)).reduce((a, r) => a + r.n, 0)
  return `attivi ${n('active')} (fine nota ${n('active', true)}), in arrivo ${n('upcoming')}, conclusi ${n('past')}`
}

try {
  // gli eventi del wiki e i loro legami, con le stesse regole che usa
  // load-game-events prima di questo script (game-events/wiki-refs.mjs)
  const { events, refs, unmatched } = await wikiRefs(client, pages, dm)
  const evById = new Map(events.map((e) => [e.id, e]))

  const kinds = [...tally(events.map((e) => e.kind))].sort((a, b) => b[1] - a[1])
  const mappedIds = new Set(refs.map((r) => r.event_id))
  const confOf = new Map(refs.map((r) => [r.event_id, r.confidence]))
  console.log(`\n  eventi del wiki: ${events.length}, legati al gioco: ${mappedIds.size}` +
              `  (high ${[...confOf.values()].filter((c) => c === 'high').length},` +
              ` medium ${[...confOf.values()].filter((c) => c === 'medium').length})`)
  console.log(`    ${kinds.map(([k, n]) => `${k} ${events.filter((e) => e.kind === k && mappedIds.has(e.id)).length}/${n}`).join('  ')}`)
  console.log(`    aree ${refs.filter((r) => r.game_kind === 'area').length}` +
              ` (di cui riedizioni ${refs.filter((r) => r.via === 'sibling').length}),` +
              ` EZA ${refs.filter((r) => r.game_kind === 'z_battle_stage').length}`)
  console.log(`  non legati: ${unmatched.length}`)
  for (const u of unmatched.sort((a, b) => a.reason.localeCompare(b.reason))) {
    console.log(`    ${String(u.ev.id).padStart(7)}  ${u.ev.wiki_title}  — ${u.reason}`)
  }

  await client.query('begin')
  const before = await statusNow()

  // 1. il ponte, aggiornato per differenza: un giro uguale non cambia niente
  const { rows: refRows } = await client.query(`
    insert into event_game_ref (event_id, game_kind, game_id, via, keys, confidence)
    select d.event_id, d.game_kind, d.game_id, d.via, string_to_array(d.keys, ','), d.confidence
    from unnest($1::bigint[], $2::text[], $3::int[], $4::text[], $5::text[], $6::text[])
         as d(event_id, game_kind, game_id, via, keys, confidence)
    on conflict (game_kind, game_id) do update set
      event_id = excluded.event_id, via = excluded.via, keys = excluded.keys, confidence = excluded.confidence
    where event_game_ref.source = 'wiki'
      and (event_game_ref.event_id, event_game_ref.via, event_game_ref.keys, event_game_ref.confidence)
          is distinct from (excluded.event_id, excluded.via, excluded.keys, excluded.confidence)
    returning (xmax = 0) as inserted`,
    [refs.map((r) => r.event_id), refs.map((r) => r.game_kind), refs.map((r) => r.game_id),
     refs.map((r) => r.via), refs.map((r) => r.keys.join(',')), refs.map((r) => r.confidence)])
  // Le righe di load-game-events (source = 'game': gli eventi creati dal
  // gioco e le riedizioni che riconosce lui) non si toccano, e una che il
  // wiki rivendica resta del gioco: lo si dice, e la fusione e' a mano.
  const { rows: gameHeld } = await client.query(`
    select g.game_kind, g.game_id, g.event_id, d.event_id as wiki_event
    from event_game_ref g join unnest($1::text[], $2::int[], $3::bigint[]) as d(k, id, event_id)
      on d.k = g.game_kind and d.id = g.game_id
    where g.source = 'game' and g.event_id <> d.event_id`,
    [refs.map((r) => r.game_kind), refs.map((r) => r.game_id), refs.map((r) => r.event_id)])
  for (const r of gameHeld) {
    console.log(`  ${r.game_kind} ${r.game_id}: il wiki lo lega a ${r.wiki_event}, ma e' gia' dell'evento ${r.event_id} (dal gioco)`)
  }
  const { rowCount: refGone } = await client.query(`
    delete from event_game_ref g
    where g.source = 'wiki' and not exists (select 1 from unnest($1::text[], $2::int[]) as d(k, id)
                      where d.k = g.game_kind and d.id = g.game_id)`,
    [refs.map((r) => r.game_kind), refs.map((r) => r.game_id)])
  console.log(`  legami scritti: ${refs.length}   nuovi ${refRows.filter((r) => r.inserted).length},` +
              ` cambiati ${refRows.filter((r) => !r.inserted).length}, tolti ${refGone}`)

  // 2. le finestre per evento
  const windows = new Map()   // event_id -> [finestre fuse]
  const noWindow = [], earlier = [], wikiWrong = []
  // tutti i legami, anche quelli del gioco: gli eventi creati da
  // load-game-events e le riedizioni che ha attaccato prendono le finestre qui
  const { rows: allRefs } = await client.query(`
    select event_id::text, game_kind, game_id, via, confidence, source from event_game_ref`)
  const refsByEvent = new Map()
  for (const r of allRefs) {
    r.event_id = Number(r.event_id)
    if (!refsByEvent.has(r.event_id)) refsByEvent.set(r.event_id, [])
    refsByEvent.get(r.event_id).push(r)
  }
  const fromGame = allRefs.filter((r) => r.source === 'game')
  console.log(`  legami scritti da load-game-events: ${fromGame.length}, su ${new Set(fromGame.map((r) => r.event_id)).size} eventi` +
              ` (${new Set(fromGame.filter((r) => evById.has(r.event_id)).map((r) => r.event_id)).size} del wiki, riedizioni)`)
  for (const [id, rs] of refsByEvent) {
    const per = rs.map((r) => ({ r, w: r.game_kind === 'area' ? areaWindows(r.game_id, r.source === 'game') : stageWindows(r.game_id) }))
    let ok = per.filter((x) => !x.w.none).flatMap((x) => x.w.map((w) => ({ ...w, ref: x.r })))
    // Una finestra finita prima della prima uscita Global (secondo il wiki)
    // non e' di questo evento: e' l'edizione precedente, che il wiki tiene
    // in un'altra pagina, "(Discontinued)": game-map gliela da' quando la
    // riconosce (7750 ha l'area 321), e qui resta la rete di sicurezza.
    // Tranne quando e' l'ultima corsa
    // che il gioco conosce e il legame e' sicuro: allora e' la data del wiki
    // a essere sbagliata, e la sua run diventa questa. Oggi non scatta per
    // nessuno (l'EZA di Jiren, che la faceva scattare, aveva la riga dello
    // stage vecchia: vedi stageWindows); resta come rete.
    const rel = wikiGlobalRelease(pages.get(id))
    if (rel && ok.length) {
      const latest = ok.reduce((a, b) => (b.start > a.start ? b : a))
      ok = ok.filter((w) => {
        if (w.end == null || w.end - rel > -TOL) return true
        const text = `${id} ${evById.get(id)?.wiki_title}: ${w.ref.game_kind === 'area' ? 'area' : 'EZA'} ${w.ref.game_id}` +
                     ` ${day(w.start)} → ${day(w.end)}, uscito su Global il ${day(rel).slice(0, 10)}`
        if (w === latest && w.ref.via !== 'sibling' && w.ref.confidence === 'high') {
          w.wikiWrong = true; wikiWrong.push(text); return true
        }
        earlier.push(text)
        return false
      })
    }
    if (ok.length) windows.set(id, mergeWindows(ok))
    else noWindow.push({ id, why: per.find((x) => x.w.none)?.w.none ?? 'edizione precedente' })
  }
  const lastKind = (id) => windows.get(id).at(-1).kind
  const withWin = [...windows.keys()]
  const nWin = [...windows.values()].reduce((a, ws) => a + ws.length, 0)
  console.log(`\n  finestre dal gioco (solo Global): ${nWin} su ${withWin.length} eventi; l'ultima di ogni evento e':`)
  console.log(`    con inizio e fine          ${withWin.filter((id) => lastKind(id) === 'window').length}`)
  console.log(`    permanenti (EZA in lista)  ${withWin.filter((id) => lastKind(id) === 'permanent').length}`)
  console.log(`    iniziate, fine non nota    ${withWin.filter((id) => lastKind(id) === 'open').length}   (missioni che scadono nel 2038)`)
  for (const [why, n] of tally(noWindow.map((x) => x.why))) console.log(`    senza finestra             ${n}   (${why}: resta la run del wiki)`)
  if (earlier.length) console.log(`    scartate, finite prima della prima uscita Global: ${earlier.length}`)
  for (const s of earlier) console.log(`      ${s}`)
  if (wikiWrong.length) console.log(`    tenute contro la data del wiki (ultima corsa, legame sicuro): ${wikiWrong.length}`)
  for (const s of wikiWrong) console.log(`      ${s}`)

  // 3. la riconciliazione, evento per evento
  const { rows: runRows } = await client.query(`
    select r.id, r.event_id, r.source, r.starts_at, r.ends_at, r.ends_at_known
    from event_run r where r.reg = 'global' and r.event_id = any($1::bigint[])
    order by r.event_id, r.starts_at`, [withWin])
  // le run che un clear (senza cascata) o una missione (con) puntano: non si cancellano
  const { rows: pinned } = await client.query(`
    select run_id as id from clear where run_id is not null
    union select run_id from mission where run_id is not null`)
  const pinnedRuns = new Set(pinned.map((r) => String(r.id)))
  const runsOf = new Map()
  for (const r of runRows) {
    const id = Number(r.event_id)
    if (!runsOf.has(id)) runsOf.set(id, [])
    runsOf.get(id).push(r)
  }

  const n = { adopted: 0, updated: 0, unchanged: 0, inserted: 0, closed: 0, absorbed: 0 }
  const skipped = [], conflicts = [], oddities = []
  const label = (id) => `${id} ${evById.get(id)?.wiki_title ?? '(dal gioco)'}`

  for (const [id, ws] of windows) {
    const runs = runsOf.get(id) ?? []
    for (const w of ws) {
      // con la data del wiki smentita, la sua run aperta e' questa corsa
      const over = runs.filter((r) => overlaps(r, w)
        || (w.wikiWrong && r.source === 'wiki' && r.ends_at == null && r.starts_at >= w.end))
      const manual = over.find((r) => r.source === 'manual')
      if (manual) {
        skipped.push(`${label(id)}: ${day(w.start)} → ${day(w.end)} tocca la run a mano ${manual.id}`)
        continue
      }
      // la stessa corsa (target) o una precedente da chiudere
      const same = [], close = [], absorb = []
      let conflict = null
      for (const r of over) {
        const d = r.starts_at - w.start
        if (r.source === 'game' ? Math.abs(d) <= TOL : d >= -TOL) same.push(r)
        else if (d < 0) close.push(r)
        // una run del gioco che inizia dentro la finestra e finisce come lei e'
        // la stessa corsa datata dall'ultimo blocco (la regola di prima sulle
        // aperture a stage scaglionati): si riassorbe, se non ha clear sopra
        else if (time(r.ends_at) === time(w.end) && r.ends_at_known === w.known && !pinnedRuns.has(String(r.id))) absorb.push(r)
        else conflict = r   // una run del gioco che inizia DOPO: la fotografia e' tornata indietro
      }
      // senza un'altra run della stessa uscita, la riassorbita fa da bersaglio (tiene l'id)
      if (!same.length && absorb.length) same.push(absorb.shift())
      const target = same.length < 2 ? same[0]
        : [...same].sort((a, b) => (a.source === 'game' ? 0 : 1) - (b.source === 'game' ? 0 : 1)
                                   || Math.abs(a.starts_at - w.start) - Math.abs(b.starts_at - w.start))[0]
      for (const r of same) {
        if (r === target) continue
        if (r.starts_at < w.start) close.push(r)
        else conflict = r
      }
      if (conflict) {
        conflicts.push(`${label(id)}: ${day(w.start)} → ${day(w.end)} contro la run ${conflict.id}` +
                       ` (${conflict.source}, ${day(conflict.starts_at)} → ${day(conflict.ends_at)})`)
        continue
      }

      // prima si tolgono le riassorbite: il vincolo non vuole il bersaglio sopra di loro
      for (const r of absorb) {
        await client.query(`delete from event_run where id = $1`, [r.id])
        runs.splice(runs.indexOf(r), 1)
        n.absorbed++
      }
      for (const r of close) {
        await client.query(`update event_run set ends_at = $2, ends_at_known = false where id = $1`, [r.id, w.start])
        r.ends_at = w.start; r.ends_at_known = false
        n.closed++
      }
      if (target) {
        const equal = target.source === 'game' && time(target.starts_at) === time(w.start)
          && time(target.ends_at) === time(w.end) && target.ends_at_known === w.known
        if (equal) { n.unchanged++; continue }
        await client.query(`
          update event_run set source = 'game', starts_at = $2, ends_at = $3, ends_at_known = $4
          where id = $1`, [target.id, w.start, w.end, w.known])
        if (target.source === 'wiki') n.adopted++; else n.updated++
        Object.assign(target, { source: 'game', starts_at: w.start, ends_at: w.end, ends_at_known: w.known })
      } else {
        const { rows: [ins] } = await client.query(`
          insert into event_run (event_id, reg, starts_at, ends_at, ends_at_known, source)
          values ($1, 'global', $2, $3, $4, 'game') returning id`, [id, w.start, w.end, w.known])
        runs.push({ id: ins.id, event_id: id, source: 'game', starts_at: w.start, ends_at: w.end, ends_at_known: w.known })
        n.inserted++
        // il gioco dice che l'ultima corsa e' finita prima della prima uscita del wiki
        const late = runs.find((r) => r.source === 'wiki' && w.end != null && r.starts_at >= w.end)
        if (late) oddities.push(`${label(id)}: finestra ${day(w.start)} → ${day(w.end)}, ma il wiki dice uscito il ${day(late.starts_at)}`)
      }
    }
  }

  // 4. Il sito aggancia un clear alla run attiva quando lo si scrive, quindi
  // created_at sta dentro la sua run. Chiudere la run del wiki rompe questa
  // regola per i clear scritti dopo l'inizio della corsa del gioco (i tre
  // dimostrativi di 728100, del 2026, finivano su una run chiusa nel 2025).
  // Allora le due righe si scambiano: la run dei clear diventa la corsa del
  // gioco, con lo stesso id (nessun clear si tocca), e il tratto chiuso
  // rientra come run del wiki nuova. La riga del gioco che si toglie non ha
  // ne' clear ne' missioni (che andrebbero via in cascata), e il suo
  // contenuto resta nell'altra: la storia non perde niente.
  const { rows: swaps } = await client.query(`
    select r.id as rid, g.id as gid, r.event_id
    from event_run r
    join event_run g on g.event_id = r.event_id and g.reg = r.reg and g.source = 'game' and g.starts_at = r.ends_at
    where r.reg = 'global' and r.source = 'wiki' and r.ends_at is not null and not r.ends_at_known
      and r.event_id = any($1::bigint[])
      and exists (select 1 from clear c where c.run_id = r.id)
      and not exists (select 1 from clear c where c.run_id = r.id
                      and not (c.created_at >= g.starts_at and c.created_at < coalesce(g.ends_at, 'infinity')))
      and not exists (select 1 from clear c where c.run_id = g.id)
      and not exists (select 1 from mission m where m.run_id in (r.id, g.id))
    order by r.id`, [withWin])
  for (const x of swaps) {
    const { rows: [g] } = await client.query(`
      delete from event_run where id = $1 returning starts_at, ends_at, ends_at_known`, [x.gid])
    const { rows: [w] } = await client.query(`
      update event_run r set source = 'game', starts_at = $2, ends_at = $3, ends_at_known = $4
      from (select starts_at, ends_at from event_run where id = $1) old
      where r.id = $1 returning old.starts_at, old.ends_at`, [x.rid, g.starts_at, g.ends_at, g.ends_at_known])
    await client.query(`
      insert into event_run (event_id, reg, starts_at, ends_at, ends_at_known, source)
      values ($1, 'global', $2, $3, false, 'wiki')`, [x.event_id, w.starts_at, w.ends_at])
  }
  const { rows: [fuori] } = await client.query(`
    select count(*)::int as n from clear c join event_run r on r.id = c.run_id
    where r.reg = 'global' and (c.created_at < r.starts_at or c.created_at >= coalesce(r.ends_at, 'infinity'))`)

  console.log(`\n  ricorrenze Global:`)
  console.log(`    del wiki diventate del gioco (stessa uscita)  ${n.adopted}`)
  console.log(`    chiuse all'inizio di una corsa piu' recente   ${n.closed}`)
  console.log(`    nuove dal gioco                              ${n.inserted}`)
  console.log(`    del gioco aggiornate                         ${n.updated}`)
  console.log(`    invariate                                    ${n.unchanged}`)
  console.log(`    saltate, c'e' una finestra a mano            ${skipped.length}`)
  console.log(`    riassorbite (stessa corsa, dall'ultimo blocco) ${n.absorbed}`)
  console.log(`    in conflitto, lasciate come sono             ${conflicts.length}`)
  console.log(`    scambiate per tenere i clear nella loro corsa ${swaps.length}`)
  for (const x of swaps) console.log(`      ${label(Number(x.event_id))}: la run ${x.rid} diventa la corsa del gioco (era la ${x.gid})`)
  if (fuori.n) console.log(`    clear scritti fuori dalla loro run          ${fuori.n}   (da rivedere a mano)`)
  for (const s of [...skipped, ...conflicts]) console.log(`      ${s}`)
  if (oddities.length) {
    console.log(`    finestre prima della prima uscita del wiki   ${oddities.length}   (legame o data del wiki da rivedere)`)
    for (const s of VERBOSE ? oddities : oddities.slice(0, 5)) console.log(`      ${s}`)
    if (!VERBOSE && oddities.length > 5) console.log(`      ... (--verbose per tutte)`)
  }

  const after = await statusNow()
  console.log(`\n  stato su Global (una ricorrenza per evento, come la lista del sito):`)
  console.log(`    prima  ${before}`)
  console.log(`    dopo   ${after}`)

  if (DRY) {
    await client.query('rollback')
    console.log('\n  --dry-run: niente e\' stato scritto')
  } else {
    await client.query('commit')
    console.log('\n  fatto.')
  }
} catch (err) {
  await client.query('rollback')
  console.error(`\n  import fallito, niente e' stato scritto: ${err.message}\n`)
  await client.end(); process.exit(1)
}
await client.end()
