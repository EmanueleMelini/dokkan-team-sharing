#!/usr/bin/env node
// Inserisce a mano una finestra vera di un evento.
//
// Il wiki da' solo la data di prima uscita, quindi le run importate hanno
// ends_at_known = false e risultano attive per sempre. Questo comando
// crea una run VERA (ends_at_known = true, source = 'manual'), che nessun
// reimport tocca: load-events lavora solo sulle sue (source = 'wiki'), e
// load-windows salta le finestre del gioco che si sovrappongono a questa.
// Una corsa precedente che si accavalla (del gioco o del wiki) si chiude al
// --dal, non si cancella: le run del gioco sono storia che il datamine non
// ridà, e load-windows non la ricreerebbe piu' (tocca la run a mano).
//
// Serve dove il datamine non arriva: Japan, e gli eventi che load-windows
// non riesce a legare.
//
// LE DATE VANNO SCRITTE CON IL FUSO (Z o +02:00). Senza, Postgres le legge
// nel fuso della sessione (Europe/Rome su dokkan_dev), un'ora o due fuori.
// Global programma in UTC: inizia di solito alle 05:00, 06:30 o 08:00 UTC
// e finisce alle 08:00 UTC, la mezzanotte di Los Angeles a UTC-8 fisso
// (il gioco scrive 07:59:59; --al e' il primo istante fuori).
//
//   node db/import/set-event-window.mjs --cerca "red zone"
//   node db/import/set-event-window.mjs --evento 12345 --reg global \
//        --dal 2026-09-05T05:00Z --al 2026-09-20T08:00Z
//   node db/import/set-event-window.mjs --attivi
import pg from 'pg'
import { connectionString, describeTarget } from '../env.mjs'

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }

const client = new pg.Client({ connectionString: connectionString() })
await client.connect()
console.log(`  database: ${describeTarget()}`)

// --cerca: trova l'evento per nome, per sapere quale id passare
if (has('--cerca')) {
  const q = val('--cerca')
  const { rows } = await client.query(`
    select e.id, et.name, e.kind::text as kind,
           (select count(*) from stage s where s.event_id = e.id) as stage,
           (select string_agg(r.reg::text || ' dal ' || to_char(r.starts_at, 'YYYY-MM-DD')
                              || case when r.ends_at_known then ' al ' || coalesce(to_char(r.ends_at, 'YYYY-MM-DD'), 'sempre')
                                      else ' (fine non nota)' end, ', ')
              from event_run r where r.event_id = e.id) as run
    from event e
    join event_text et on et.event_id = e.id and et.locale = 'en'
    where et.name ilike '%' || $1 || '%'
    order by et.name limit 25`, [q])
  if (!rows.length) console.log(`\n  nessun evento con "${q}" nel nome\n`)
  for (const r of rows) {
    console.log(`\n  ${r.id}  ${r.name}`)
    console.log(`        ${r.kind}, ${r.stage} stage`)
    console.log(`        ${r.run ?? 'nessuna ricorrenza'}`)
  }
  await client.end(); process.exit(0)
}

// --attivi: cosa risulta attivo con una finestra VERA
if (has('--attivi')) {
  const { rows } = await client.query(`
    select et.name, r.reg::text,
           to_char(r.starts_at, 'YYYY-MM-DD') as dal,
           coalesce(to_char(r.ends_at, 'YYYY-MM-DD'), '(aperta)') as al
    from event_run r
    join event_text et on et.event_id = r.event_id and et.locale = 'en'
    where r.ends_at_known
      and r.starts_at <= now() and (r.ends_at is null or r.ends_at > now())
    order by r.ends_at`)
  console.log(`\n  eventi attivi con una finestra vera: ${rows.length}`)
  for (const r of rows) console.log(`    ${r.reg.padEnd(7)} ${r.dal} → ${String(r.al).padEnd(10)}  ${r.name}`)
  const { rows: [{ n }] } = await client.query(
    `select count(*)::int as n from event_run where not ends_at_known`)
  console.log(`\n  (piu' ${n} ricorrenze con la fine non nota, del wiki o del gioco: quelle`)
  console.log(`   risultano attive per sempre e vanno prese con le molle)\n`)
  await client.end(); process.exit(0)
}

const id = Number(val('--evento'))
const reg = val('--reg')
const dal = val('--dal')
const al = val('--al')

if (!Number.isInteger(id) || !['global', 'japan'].includes(reg) || !dal) {
  console.error(`
  uso:
    --cerca "<testo>"                     cerca l'evento e mostra il suo id
    --attivi                              elenca le finestre vere attive
    --evento <id> --reg global|japan --dal <data> [--al <data>]

  le date accettano il formato ISO, con il fuso: 2026-09-12T08:00Z
  (senza fuso valgono nel fuso della sessione Postgres, non in UTC)
  senza --al la finestra resta aperta ma dichiarata NOTA (evento permanente)
`)
  await client.end(); process.exit(2)
}

try {
  await client.query('begin')
  const { rows: ev } = await client.query(`
    select et.name from event e
    join event_text et on et.event_id = e.id and et.locale = 'en'
    where e.id = $1`, [id])
  if (!ev.length) throw new Error(`l'evento ${id} non esiste`)

  // Il vincolo di esclusione non tollera sovrapposizioni nella stessa
  // regione. Quello che si accavalla e':
  //   - una corsa precedente, del gioco o del wiki, iniziata prima del --dal
  //     (per il wiki oltre i due giorni di tolleranza della sua data, come in
  //     load-windows): si chiude al --dal con la fine non nota;
  //   - la stessa corsa (la run del wiki della stessa uscita, una del gioco
  //     che inizia dentro la finestra, una a mano che si sta correggendo): la
  //     prima diventa la run a mano sul posto, tenendo l'id (clear e missioni
  //     la puntano), le altre si tolgono. Se una di quelle ha dei clear la
  //     chiave esterna ferma tutto, e non cambia niente.
  const TOL = 2 * 86_400_000
  const { rows: [{ from }] } = await client.query(`select $1::timestamptz as from`, [dal])
  const { rows: over } = await client.query(`
    select r.id, r.source::text as source, r.starts_at, r.ends_at,
           (select count(*)::int from clear c where c.run_id = r.id) as clears
    from event_run r
    where r.event_id = $1 and r.reg = $2::region
      and tstzrange(r.starts_at, coalesce(r.ends_at, 'infinity'))
          && tstzrange($3::timestamptz, coalesce($4::timestamptz, 'infinity'))
    order by r.starts_at`, [id, reg, dal, al ?? null])
  const earlier = (r) => r.source !== 'manual' && r.starts_at < from
    && !(r.source === 'wiki' && from - r.starts_at <= TOL)
  const close = over.filter(earlier)
  const same = over.filter((r) => !earlier(r))
  const keep = same.find((r) => r.clears > 0) ?? same[0]
  const iso = (d) => (d ? d.toISOString().slice(0, 16) + 'Z' : 'aperta')
  const descr = (r) => `${r.id} (${r.source}, ${iso(r.starts_at)} → ${iso(r.ends_at)})`
  const log = []

  for (const r of close) {
    await client.query(`update event_run set ends_at = $2, ends_at_known = false where id = $1`, [r.id, from])
    log.push(`chiusa al --dal la run ${descr(r)}, fine non nota`)
    const { rows: [{ n }] } = await client.query(
      `select count(*)::int as n from clear where run_id = $1 and created_at >= $2`, [r.id, from])
    if (n) log.push(`  attenzione: ${n} clear della run ${r.id} restano fuori dalla sua finestra`)
  }
  for (const r of same) {
    if (r === keep) continue
    await client.query(`delete from event_run where id = $1`, [r.id])
    log.push(`tolta la run ${descr(r)}`)
  }
  if (keep) {
    await client.query(`
      update event_run set starts_at = $2::timestamptz, ends_at = $3::timestamptz,
                           ends_at_known = true, source = 'manual'
      where id = $1`, [keep.id, dal, al ?? null])
    log.push(`la run ${descr(keep)} diventa questa, a mano (stesso id)`)
  } else {
    await client.query(`
      insert into event_run (event_id, reg, starts_at, ends_at, ends_at_known, source)
      values ($1, $2::region, $3::timestamptz, $4::timestamptz, true, 'manual')`,
      [id, reg, dal, al ?? null])
  }

  await client.query('commit')
  console.log(`\n  ${ev[0].name}`)
  console.log(`  ${reg}: ${dal} → ${al ?? '(aperta, permanente)'}`)
  for (const s of log) console.log(`  ${s}`)
  const { rows: [st] } = await client.query(
    `select status from event_status where event_id = $1 and reg = $2::region
       and starts_at = $3::timestamptz`, [id, reg, dal])
  console.log(`  stato adesso: ${st?.status ?? '?'}\n`)
} catch (err) {
  await client.query('rollback')
  console.error(`\n  non fatto: ${err.message}\n`)
  await client.end(); process.exit(1)
}
await client.end()
