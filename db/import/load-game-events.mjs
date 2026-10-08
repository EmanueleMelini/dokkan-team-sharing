#!/usr/bin/env node
// Gli eventi Global che il wiki non documenta, presi dal database del gioco.
//
// Il wiki ha smesso di scrivere pagine di eventi a inizio 2025 (l'ultima
// uscita Global che ha e' del 2025-01-19): da li' in poi la sola fonte e' il
// datamine (fetch-datamine). Questo script:
//
//   1. classifica le aree e le EZA che load-windows non ha legato a un
//      evento del wiki (game-events/classify.mjs): evento nuovo, riedizione
//      di un evento che c'e' gia', o niente (capitoli della storia, archivi,
//      categorie di cui non sappiamo il tipo);
//   2. crea gli eventi nuovi con imported_from = 'datamine' e un id che un
//      pageid del wiki non raggiunge mai: 1000000000 + id dell'area,
//      2000000000 + id dello stage EZA (Normal e Super). Nome inglese, stage
//      e difficolta' dal gioco (game-events/build.mjs), niente descrizione
//      ne' banner: il datamine non li ha;
//   3. scrive il legame in event_game_ref con source = 'game': per gli
//      eventi nuovi e per le riedizioni, che si attaccano all'evento che
//      c'e' gia' (wiki o gioco). Cosi' load-windows, che va lanciato DOPO,
//      da' a tutti le loro finestre;
//   4. riempie event.cover_card_id (migrazione 0011): il boss principale,
//      se la carta e' nella tabella card. Anche per gli eventi del wiki con
//      un legame, perche' costa uguale.
//
// Se un giorno il wiki scrive la pagina di un evento che qui e' gia' del
// gioco, load-events la salta e lo dice: vedi la fusione nel README.
//
//   node db/import/load-game-events.mjs [--dry-run] [--verbose]
import pg from 'pg'
import { connectionString, describeTarget } from '../env.mjs'
import { snapshotInfo } from './datamine.mjs'
import { loadData } from './game-events/data.mjs'
import { classify } from './game-events/classify.mjs'
import { buildEvent, coverOf } from './game-events/build.mjs'
import { writeEvents, writeRefs, writeStages, writeWikiCovers } from './game-events/write.mjs'
import { wikiRefs } from './game-events/wiki-refs.mjs'

const DRY = process.argv.includes('--dry-run')
const VERBOSE = process.argv.includes('--verbose')
const tally = (a) => { const m = new Map(); for (const v of a) m.set(v, (m.get(v) ?? 0) + 1); return [...m].sort((x, y) => y[1] - x[1]) }

console.log(`  database: ${describeTarget()}`)
console.log(`  sorgente: datamine Global, ${snapshotInfo()}`)
const d = loadData()

const client = new pg.Client({ connectionString: connectionString() })
await client.connect()
const { rows: [mig] } = await client.query(`
  select exists (select 1 from information_schema.columns
                 where table_name = 'event_game_ref' and column_name = 'source') as ok`)
if (!mig.ok) {
  console.error('\n  manca la migrazione 0011 (event_game_ref.source, event.cover_card_id):')
  console.error('  applicala con  node db/migrate.mjs\n')
  await client.end(); process.exit(1)
}

try {
  await client.query('begin')
  // I legami del wiki, calcolati come li scrivera' load-windows (non letti:
  // su un database appena ricreato non ci sono ancora), e gli eventi del
  // wiki rimasti senza, che si possono ritrovare per nome.
  const { events: wikiEvents, refs } = await wikiRefs(client)
  const linked = new Set(refs.map((r) => r.event_id))
  const wiki = wikiEvents.filter((e) => !linked.has(e.id)).map((e) => ({ id: e.id, name: e.name }))
  // id -> ha una miniatura: la copertina preferisce le carte con immagine
  const { rows: cardRows } = await client.query('select id::text, thumb_key is not null as img from card')
  const ours = new Map(cardRows.map((r) => [Number(r.id), r.img]))

  // ---------------------------------------------------------- analisi
  const { events, attach, skipped } = classify(d, refs, wiki)
  const built = events.map((e) => buildEvent(d, e, ours))
  const area = built.filter((e) => e.game_kind === 'area'), eza = built.filter((e) => e.game_kind !== 'area')
  console.log(`\n  eventi dal gioco: ${built.length}`)
  console.log(`    aree ${area.length} (${tally(area.map((e) => e.kind)).map(([k, n]) => `${k} ${n}`).join(', ')}),` +
              ` di cui uscite prima del taglio e tornate dopo ${area.filter((e) => e.old).length},` +
              ` in famiglia ${area.filter((e) => e.members.length).map((e) => `${e.game_id}+${e.members.join('+')}`).join(' ') || 'nessuna'}`)
  console.log(`    EZA ${eza.length}: Normal ${eza.filter((e) => e.related == null).length}, Super ${eza.filter((e) => e.related != null).length}`)
  console.log(`    stage ${built.reduce((a, e) => a + e.stages.length, 0)},` +
              ` difficolta' ${built.reduce((a, e) => a + e.stages.reduce((b, s) => b + s.tiers.length, 0), 0)},` +
              ` con copertina ${built.filter((e) => e.cover).length}`)
  const noBoss = area.filter((e) => e.stages.every((s) => s.tiers.every((t) => !t.note)))
  if (noBoss.length) console.log(`    senza nessun boss (il gioco nasconde i nemici): ${noBoss.map((e) => e.game_id).join(', ')}`)
  console.log(`  riedizioni legate a un evento che c'e' gia': ${attach.length}`)
  for (const a of attach) console.log(`    area ${String(a.game_id).padStart(4)} -> evento ${a.event_id}  (${a.why})`)
  console.log(`  saltate: ${skipped.length}`)
  for (const [cls, n] of tally(skipped.map((s) => `${s.game_kind === 'area' ? 'area' : 'EZA'}: ${s.cls}`))) console.log(`    ${String(n).padStart(4)}  ${cls}`)
  for (const s of skipped.filter((x) => VERBOSE || x.game_kind === 'area')) console.log(`         ${s.game_kind === 'area' ? 'area' : 'EZA'} ${s.game_id}: ${s.why}`)

  // il ponte: l'area (o l'EZA) dell'evento, le sorelle della famiglia, le riedizioni
  const gameRefs = [
    ...built.map((e) => ({ event_id: e.id, game_kind: e.game_kind, game_id: e.game_id, via: 'game',
                           keys: ['datamine'], confidence: 'high', related: e.related })),
    ...built.flatMap((e) => e.members.map((m) => ({ event_id: e.id, game_kind: 'area', game_id: m, via: 'family',
                                                     keys: ['name'], confidence: 'high' }))),
    ...attach.map((a) => ({ event_id: a.event_id, game_kind: 'area', game_id: a.game_id, via: 'rerun',
                            keys: a.keys, confidence: 'medium' })),
  ]

  // la copertina degli eventi del wiki: l'EZA, o l'area legata con le
  // chiavi forti (non una sorella) con l'id piu' basso
  const primary = new Map()
  for (const r of [...refs].sort((a, b) => a.game_id - b.game_id)) {
    if (r.game_kind === 'area' && r.via === 'sibling') continue
    const cur = primary.get(r.event_id)
    if (!cur || (r.game_kind === 'z_battle_stage' && cur.game_kind !== 'z_battle_stage')) primary.set(r.event_id, r)
  }
  const covers = [...primary].map(([id, r]) => ({ id, cover: coverOf(d, r.game_kind, r.game_id, ours) }))
  console.log(`  copertine per gli eventi del wiki: ${covers.filter((c) => c.cover).length} su ${covers.length} legati`)

  // ---------------------------------------------------------- scrittura
  const ev = await writeEvents(client, built)
  const rf = await writeRefs(client, gameRefs)
  const sg = await writeStages(client, ev.evs)
  const wc = await writeWikiCovers(client, covers)
  // Eventi del gioco che questo giro non produce piu' (per esempio perche'
  // load-windows ha legato la loro area a una pagina del wiki). Senza niente
  // degli utenti sopra se ne vanno; con un clear o un tip restano, e si
  // dicono: si fondono a mano, vedi il README.
  const { rows: orphans } = await client.query(`
    select e.id, exists (select 1 from clear c where c.event_id = e.id)
                 or exists (select 1 from tip p where p.event_id = e.id
                            or p.stage_tier_id in (select id from stage_tier t where t.event_id = e.id)) as used
    from event e where e.imported_from = 'datamine' and not (e.id = any($1::bigint[]))`,
    [ev.evs.map((e) => e.id)])
  await client.query('delete from event where id = any($1::bigint[])', [orphans.filter((o) => !o.used).map((o) => o.id)])

  console.log(`\n  scritto:`)
  console.log(`    eventi        nuovi ${ev.created}, cambiati ${ev.updated}, nomi scritti o cambiati ${ev.texts}` +
              (ev.taken ? `, saltati (id occupato) ${ev.taken}` : ''))
  console.log(`    legami        ${rf.written}: nuovi ${rf.created}, cambiati ${rf.changed}, tolti ${rf.gone}` +
              (rf.held ? `, gia' del wiki ${rf.held}` : ''))
  console.log(`    stage         ${sg.stages}: nuovi ${sg.stageNew}, tolti ${sg.stageGone}, nomi scritti o cambiati ${sg.named}`)
  console.log(`    difficolta'   ${sg.tiers}: nuove ${sg.tierNew}, cambiate ${sg.tierChanged}, tolte ${sg.tierGone}; note scritte o cambiate ${sg.notes}`)
  console.log(`    copertine del wiki cambiate ${wc}`)
  if (orphans.length) {
    console.log(`    eventi del gioco non piu' prodotti: tolti ${orphans.filter((o) => !o.used).length}` +
                `, tenuti perche' hanno clear o tip ${orphans.filter((o) => o.used).map((o) => o.id).join(', ') || 'nessuno'}`)
  }

  if (DRY) {
    await client.query('rollback')
    console.log('\n  --dry-run: niente e\' stato scritto')
  } else {
    await client.query('commit')
    console.log('\n  fatto. Ora load-windows, per le finestre.')
  }
} catch (err) {
  await client.query('rollback')
  console.error(`\n  import fallito, niente e' stato scritto: ${err.message}\n`)
  await client.end(); process.exit(1)
}
await client.end()
