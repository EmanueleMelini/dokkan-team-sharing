// Verifica le finestre Global importate dal database del gioco
// (db/import/load-windows.mjs) e la provenienza delle run (migrazione 0010).
//
// Gira sul database di test DOPO l'import dalle cache (lo prepara
// npm run db:test): rilancia load-windows, load-events e set-event-window
// come processi veri, e ritocca qualche run per mettere in scena i casi
// (una run del wiki da adottare, una da chiudere, una finestra a mano).
// Alla fine le run toccate tornano equivalenti a come le ha trovate.
//
// Gli attesi delle finestre sono scritti a mano, letti nel CSV a occhio, e
// prima di usarli si controlla che la cache dica ancora quelle date: se la
// cache cambia, la verifica e' rossa e dice perche', non verde per caso.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { loadTable } from '../import/datamine.mjs'
import { wikiGlobalRelease } from '../import/game-map.mjs'

let fails = 0
let passes = 0
function check(nome: string, ok: boolean, dettaglio = ''): boolean {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nome}${dettaglio ? `  (${dettaglio})` : ''}`)
  if (ok) passes++
  else fails++
  return ok
}
// Una lista vuota non prova niente: [].every() e' sempre vero.
function tutte<T>(nome: string, righe: T[], ok: (x: T) => boolean): boolean {
  if (righe.length === 0) return check(nome, false, 'nessuna riga da verificare')
  const male = righe.filter((x) => !ok(x)).length
  return check(nome, male === 0, male ? `${male} righe su ${righe.length} non tornano` : `${righe.length} righe`)
}
const quando = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 16) + 'Z' : String(d))
const stesso = (d: unknown, iso: string | null) =>
  iso === null ? d === null : d instanceof Date && d.getTime() === new Date(iso).getTime()

// ------------------------------------------------------------ il bersaglio

// La stessa regola delle altre suite: TEST_DATABASE_URL, nome che finisce
// per _test. I processi figli lo ricevono come DATABASE_URL.
const url = process.env.TEST_DATABASE_URL ?? ''
let nomeDb = ''
try { nomeDb = decodeURIComponent(new URL(url).pathname.slice(1)) } catch { /* resta vuoto */ }
if (!nomeDb.endsWith('_test')) {
  console.error('\n  mi fermo: TEST_DATABASE_URL deve puntare a un database il cui nome finisce per _test')
  console.error('  (lancialo dentro  npm run db:test)\n')
  process.exit(2)
}
{
  const u = new URL(url)
  console.log(`  database: ${u.hostname}:${u.port || 5432}/${nomeDb} come ${u.username || '(default)'}`)
}

const db = new pg.Client({ connectionString: url })
await db.connect()
// Le righe di pg non hanno tipo, e qui si leggono colonne diverse a ogni
// query: tiparle una per una non proverebbe niente in piu'.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Riga = Record<string, any>
const righe = async (text: string, params: unknown[] = []): Promise<Riga[]> => (await db.query(text, params)).rows
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const valore = async (text: string, params: unknown[] = []): Promise<any> => {
  const r = (await db.query(text, params)).rows[0]
  return r ? Object.values(r)[0] : undefined
}

const script = (nome: string) => new URL(`../import/${nome}`, import.meta.url).pathname
function lancia(nome: string, args: string[] = [], dbUrl = url): string {
  return execFileSync(process.execPath, [script(nome), ...args],
    { env: { ...process.env, DATABASE_URL: dbUrl }, encoding: 'utf8' })
}
// "    invariate      462" -> 462, dall'output di load-windows
const conta = (out: string, etichetta: string) => Number(out.match(new RegExp(`${etichetta}\\s+(\\d+)`))?.[1] ?? NaN)

async function sezione(titolo: string, fn: () => Promise<void>) {
  console.log(`\n${titolo}`)
  try {
    await fn()
  } catch (err) {
    check(`${titolo}: interrotta da un errore`, false, (err as Error).message.split('\n')[0])
  }
}

// le run Global di un evento, in ordine
const runs = (ev: number) => righe(`
  select r.id::text, r.source, r.starts_at, r.ends_at, r.ends_at_known, es.status
  from event_run r join event_status es on es.run_id = r.id
  where r.event_id = $1 and r.reg = 'global' order by r.starts_at`, [ev])
const descrivi = (rs: Riga[]) => rs.map((r) => `${r.id} ${r.source} ${quando(r.starts_at)}→${quando(r.ends_at)}`
  + `${r.ends_at_known ? '' : ' (fine non nota)'} ${r.status}`).join('; ')

// I casi scelti. Gli stage EZA si leggono in z_battle_stages, le aree in
// missions (area_id); gli orari attesi sono gia' convertiti: UTC, e la fine
// come primo minuto fuori (07:59:59 -> 08:00).
const BROLY_INT = 384646   // EZA 8, conclusa nel 2018: la prima uscita del wiki
const BROLY = 458966       // EZA 15: stesso titolo di 8, la distingue il boss
const ETERNAL = 540835     // EZA 26, permanente dal 2024-12-27
const CARNAGE = 3566       // area 503: dicembre 2024, e in corso fino al 20 ottobre 2026
const TYRANT = 701738      // area 562: una sola corsa, marzo 2023
const DESPAIR_OLD = 7750   // area 321: la vecchia edizione, tre corse fra il 2018 e il 2019
const KORIN = 467          // area 120: una sola missione, giapponese, dal 2015-04-01 al 2038
const JIREN = 406976       // EZA 10: la riga dello stage dice maggio 2018, le missioni settembre
const BARDOCK = 698372     // aree 727 e poi 789, riaperta il 2024-05-31 con una quest in piu'
const PAN = 18261          // aree 135 e poi 1202, riaperta il 2025-08-08 con una quest sola
const MEMORIAL = 725073    // area 1306: apre il 2024-07-07, aggiunge stage il 07-18 e il 08-05, tutto 2038
const STAGGERED = 718641   // area 1303: apre il 2023-07-07 (la data del wiki), aggiunge stage il 07-18
const AUTORE = '11111111-1111-1111-1111-111111111111'   // dalla fixture

const zStages = new Map(loadTable('z_battle_stages').map((s: Riga) => [Number(s.id), s]))
const missioniDi = (area: number) => {
  const t = new Map<string, number>()
  for (const m of loadTable('missions') as Riga[]) {
    if (Number(m.area_id) !== area) continue
    const k = `${m.start_at} -> ${m.end_at}`
    t.set(k, (t.get(k) ?? 0) + 1)
  }
  return [...t.keys()].sort().join(' | ')
}
// la cache e' ancora quella su cui sono scritti gli attesi?
function cacheDice(nome: string, got: string, atteso: string): boolean {
  return check(`cache: ${nome}`, got === atteso,
               got === atteso ? got : `dice "${got}", gli attesi sono scritti per "${atteso}": aggiornali`)
}

try {
  await sezione('provenienza delle run (migrazione 0010)', async () => {
    const col = (await righe(`select column_default, is_nullable from information_schema.columns
                              where table_schema = 'public' and table_name = 'event_run' and column_name = 'source'`))[0]
    check('event_run.source esiste, not null, per difetto manual',
          col?.is_nullable === 'NO' && /^'manual'/.test(col?.column_default ?? ''), JSON.stringify(col))

    const rifiuta = async (nome: string, sql: string, vincolo: string) => {
      await db.query('begin')
      try {
        await db.query(sql)
        check(nome, false, 'accettato, atteso un rifiuto')
      } catch (err) {
        const e = err as { constraint?: string; message: string }
        check(nome, e.constraint === vincolo, e.constraint ?? e.message)
      } finally {
        await db.query('rollback')
      }
    }
    await rifiuta('una provenienza che non esiste: rifiutata', `
      insert into event_run (event_id, reg, starts_at, source) values (5001, 'japan', '2001-01-01Z', 'altro')`, 'run_source')
    await rifiuta('una run del wiki con la fine nota: rifiutata', `
      insert into event_run (event_id, reg, starts_at, ends_at, ends_at_known, source)
      values (5001, 'japan', '2001-01-01Z', '2001-01-02Z', true, 'wiki')`, 'run_wiki_end_unknown')

    // Il riempimento si prova sul file vero, su una tabella con le colonne di
    // prima: in uno schema a parte, dentro una transazione che si annulla.
    const migrazione = readFileSync(new URL('../migrations/0010_run_source.sql', import.meta.url), 'utf8')
    await db.query('begin')
    try {
      await db.query(`create schema prova_0010;
        create table prova_0010.event_run (
          id bigserial primary key, event_id bigint not null references public.event,
          reg public.region not null, starts_at timestamptz not null, ends_at timestamptz,
          ends_at_known boolean not null default true);
        insert into prova_0010.event_run (event_id, reg, starts_at, ends_at, ends_at_known) values
          (5001, 'global', '2020-01-01Z', null, false),
          (5001, 'japan',  '2020-01-01Z', '2020-01-08Z', true);
        set local search_path = prova_0010, public`)
      await db.query(migrazione)
      const r = await righe(`select ends_at_known, source from prova_0010.event_run order by id`)
      check('riempimento: fine non nota -> wiki, fine nota -> manual',
            r.length === 2 && r[0].source === 'wiki' && r[1].source === 'manual', JSON.stringify(r))
    } finally {
      await db.query('rollback')
    }

    const fixture = await righe(`select distinct source from event_run where event_id = 5001`)
    check('le run della fixture, scritte senza provenienza, sono manual',
          fixture.length === 1 && fixture[0].source === 'manual', JSON.stringify(fixture))
    const wikiNote = Number(await valore(`select count(*) from event_run where source = 'wiki' and ends_at_known`))
    check('nessuna run del wiki con la fine nota', wikiNote === 0, `${wikiNote}`)
    const perFonte = await righe(`select source, count(*)::int as n from event_run group by 1 order by 1`)
    check('ci sono run del gioco, del wiki e a mano',
          ['game', 'manual', 'wiki'].every((s) => perFonte.some((r) => r.source === s && r.n > 0)), JSON.stringify(perFonte))
  })

  await sezione('Japan non si tocca', async () => {
    const giapponesi = await righe(`
      select r.source, r.ends_at, r.ends_at_known from event_run r join event e on e.id = r.event_id
      where r.reg = 'japan' and e.imported_from = 'wiki'`)
    tutte('ogni run Japan di un evento del wiki e\' ancora quella del wiki, aperta', giapponesi,
          (r) => r.source === 'wiki' && r.ends_at === null && r.ends_at_known === false)
    check('nessuna run del gioco su Japan',
          Number(await valore(`select count(*) from event_run where reg = 'japan' and source = 'game'`)) === 0)
  })

  await sezione('il legame con il gioco', async () => {
    const [tot, legati] = (await righe(`
      select count(*)::int as tot,
             count(*) filter (where exists (select 1 from event_game_ref g where g.event_id = e.id))::int as legati
      from event e where e.imported_from = 'wiki'`)).map((r) => [r.tot, r.legati])[0]
    check('piu\' del 90% degli eventi del wiki legato a un\'area o a un\'EZA', tot > 0 && legati / tot > 0.9,
          `${legati} su ${tot}`)
    const eza = (await righe(`
      select count(*)::int as tot,
             count(*) filter (where exists (select 1 from event_game_ref g
                                            where g.event_id = e.id and g.game_kind = 'z_battle_stage'))::int as legati
      from event e where e.imported_from = 'wiki' and e.kind = 'zbattle'`))[0]
    check('le EZA legate a uno stage, quasi tutte', eza.tot > 100 && eza.legati / eza.tot > 0.95, `${eza.legati} su ${eza.tot}`)

    // casi visti a occhio: nome dell'area, quest, banner e boss coincidono
    const attesi: [number, string, number, string][] = [
      [728100, 'z_battle_stage', 165, 'l\'EZA dei clear dimostrativi'],
      [BROLY_INT, 'z_battle_stage', 8, 'Saiyan Outcast Broly (INT): il titolo dice 8 o 15, il boss 8'],
      [BROLY, 'z_battle_stage', 15, 'Saiyan Outcast Broly: il titolo dice 8 o 15, il boss 15'],
      [705308, 'area', 564, 'banner, nome, stage e boss'],
      [724258, 'area', 778, 'banner, nome, stage e boss'],
      [717507, 'area', 586, 'il nome di uno stage sul wiki e\' sbagliato: decidono banner e nome'],
      [DESPAIR_OLD, 'area', 321, 'la pagina (Discontinued): stesse quest della 371, ma il suo banner e i suoi boss dicono 321'],
      [569060, 'area', 713, 'nome e stage, che sul wiki portano la variante fra parentesi'],
      [1302, 'area', 306, 'perde la 364 col remake e ritrova la sua: stesse quest e il suo banner'],
      [BARDOCK, 'area', 789, 'riaperta con un id nuovo e "Grand Opening" in piu\', dove la 727 finisce'],
      [PAN, 'area', 1202, 'riaperta con una sola delle due quest, il giorno dopo la fine della 135'],
      [708590, 'area', 619, 'la 608 riaperta il 2026-08-29 con "Extreme Stage" in piu\''],
    ]
    for (const [ev, kind, id, perche] of attesi) {
      const g = await righe(`select game_kind, game_id from event_game_ref where event_id = $1`, [ev])
      check(`${ev} -> ${kind} ${id} (${perche})`, g.some((x) => x.game_kind === kind && x.game_id === id),
            g.map((x) => `${x.game_kind} ${x.game_id}`).join(', ') || 'nessun legame')
    }
    const g576 = await righe(`select game_id from event_game_ref where event_id = 576084 and game_kind = 'area'`)
    check('576084 (la riedizione del 2020) non ha la 321 della vecchia edizione',
          g576.length > 0 && !g576.some((x) => x.game_id === 321), g576.map((x) => x.game_id).join(', '))
    const soloNonLegati = Number(await valore(`
      select count(*) from event_run r where r.source = 'game'
        and not exists (select 1 from event_game_ref g where g.event_id = r.event_id)`))
    check('nessuna run del gioco su un evento senza legame', soloNonLegati === 0, `${soloNonLegati}`)
  })

  await sezione('finestre: conclusa, permanente, in corso', async () => {
    const z8 = zStages.get(8), z26 = zStages.get(26)
    if (cacheDice('EZA 8', `${z8?.start_at} -> ${z8?.end_at}`, '2018-08-16 05:00:00 -> 2018-08-28 04:59:59')) {
      const r = await runs(BROLY_INT)
      check(`${BROLY_INT} su Global: una run sola, del gioco, conclusa il 28/08/2018 alle 05:00 UTC`,
            r.length === 1 && r[0].source === 'game' && stesso(r[0].starts_at, '2018-08-16T05:00Z')
              && stesso(r[0].ends_at, '2018-08-28T05:00Z') && r[0].ends_at_known && r[0].status === 'past',
            descrivi(r))
    }
    if (cacheDice('EZA 26', `${z26?.start_at} -> ${z26?.end_at}`, '2024-12-27 02:00:00 -> 2038-01-01 00:00:00')) {
      const r = await runs(ETERNAL)
      const [w, g] = r
      check(`${ETERNAL}: la run del wiki chiusa all'inizio della permanenza, fine non nota`,
            r.length === 2 && w.source === 'wiki' && stesso(w.ends_at, '2024-12-27T02:00Z')
              && w.ends_at_known === false && w.status === 'past', descrivi(r))
      check(`${ETERNAL}: permanente dal 27/12/2024 (fine nulla ma nota), attiva`,
            r.length === 2 && g.source === 'game' && stesso(g.starts_at, '2024-12-27T02:00Z')
              && g.ends_at === null && g.ends_at_known === true && g.status === 'active', descrivi(r))
    }
    if (cacheDice('area 321', missioniDi(321), '2018-02-22 06:30:00 -> 2018-03-12 05:59:59 | '
                  + '2018-12-12 06:30:00 -> 2019-01-09 05:59:59 | 2019-11-12 06:30:00 -> 2019-12-09 05:59:59')) {
      const r = await runs(DESPAIR_OLD)
      check(`${DESPAIR_OLD}: wiki chiusa al 22/02/2018, poi tre corse del gioco, l'ultima conclusa il 09/12/2019`,
            r.length === 4 && r[0].source === 'wiki' && stesso(r[0].ends_at, '2018-02-22T06:30Z') && r[0].status === 'past'
              && r.slice(1).every((x) => x.source === 'game' && x.ends_at_known && x.status === 'past')
              && stesso(r[3].starts_at, '2019-11-12T06:30Z') && stesso(r[3].ends_at, '2019-12-09T06:00Z'), descrivi(r))
    }
    if (cacheDice('area 120', missioniDi(120), '2015-04-01 15:00:00 -> 2038-01-01 00:00:00')) {
      const r = await runs(KORIN)
      check(`${KORIN}: la missione giapponese non fa una corsa, resta la run del wiki dal 25/07/2015 (mezzanotte UTC)`,
            r.length === 1 && r[0].source === 'wiki' && stesso(r[0].starts_at, '2015-07-25T00:00Z'), descrivi(r))
    }
    const prima = Number(await valore(`
      select count(*) from event_run where reg = 'global' and source <> 'manual' and starts_at < '2015-07-01Z'`))
    check('nessuna run Global prima del lancio (luglio 2015)', prima === 0, `${prima}`)
    const z10 = zStages.get(10)
    if (cacheDice('EZA 10', `${z10?.start_at} -> ${z10?.end_at}`, '2018-05-21 06:30:00 -> 2018-06-06 05:59:59')) {
      const r = await runs(JIREN)
      check(`${JIREN}: la corsa delle missioni dello stage, 13/09 -> 11/10/2018, non quella vecchia della riga`,
            r.length === 1 && r[0].source === 'game' && stesso(r[0].starts_at, '2018-09-13T05:00Z')
              && stesso(r[0].ends_at, '2018-10-11T06:00Z') && r[0].ends_at_known && r[0].status === 'past', descrivi(r))
    }
    if (cacheDice('area 789', missioniDi(789), '2024-05-31 06:30:00 -> 2038-01-01 00:00:00')) {
      const r = await runs(BARDOCK)
      const u = r[r.length - 1]
      check(`${BARDOCK}: la 727 e la 789 sono una corsa sola dal 26/08/2021, in corso, fine non nota`,
            r.length === 2 && u.source === 'game' && stesso(u.starts_at, '2021-08-26T06:00Z') && u.ends_at === null
              && !u.ends_at_known && u.status === 'active', descrivi(r))
    }
    if (cacheDice('area 1202', missioniDi(1202), '2025-08-08 01:00:00 -> 2038-01-01 00:00:00')) {
      const r = await runs(PAN)
      const [a, b] = r
      check(`${PAN}: conclusa il 07/08/2025, di nuovo in corso dal giorno dopo`,
            r.length === 2 && a.source === 'game' && stesso(a.ends_at, '2025-08-07T15:00Z') && a.status === 'past'
              && b.source === 'game' && stesso(b.starts_at, '2025-08-08T01:00Z') && b.ends_at === null
              && b.status === 'active', descrivi(r))
    }
    if (cacheDice('area 503', missioniDi(503),
                  '2024-12-12 05:00:00 -> 2024-12-26 14:59:59 | 2026-10-05 05:00:00 -> 2026-10-20 07:59:59')) {
      const r = await runs(CARNAGE)
      check(`${CARNAGE}: wiki chiusa al 12/12/2024, poi le due corse del gioco`,
            r.length === 3 && r[0].source === 'wiki' && stesso(r[0].ends_at, '2024-12-12T05:00Z')
              && r[1].source === 'game' && stesso(r[1].starts_at, '2024-12-12T05:00Z') && stesso(r[1].ends_at, '2024-12-26T15:00Z')
              && r[2].source === 'game' && stesso(r[2].starts_at, '2026-10-05T05:00Z') && stesso(r[2].ends_at, '2026-10-20T08:00Z')
              && r[2].ends_at_known, descrivi(r))
      // lo stato atteso si ricava dall'ora: oggi e' in corso, dopo il 20 no
      const fine = new Date('2026-10-20T08:00Z')
      const atteso = Date.now() < fine.getTime() ? 'active' : 'past'
      check(`${CARNAGE}: ${atteso === 'active' ? 'in corso, con la fine nota' : 'conclusa'} (fino al ${quando(fine)})`,
            r.length === 3 && r[2].status === atteso && r[1].status === 'past' && r[0].status === 'past', descrivi(r))
    }
  })

  await sezione('la run del wiki tiene il suo id, e i clear restano dove sono', async () => {
    // Si rimettono due eventi come li lascia load-events, con un clear sopra
    // la run del wiki, e si rilancia l'import.
    const adottata = (await runs(BROLY_INT))[0]
    const [chiusa, permanente] = await runs(ETERNAL)
    if (!check('i due eventi di partenza ci sono', !!adottata && !!chiusa && !!permanente)) return
    const tier = async (ev: number) => valore(`select id::text from stage_tier where event_id = $1 order by id limit 1`, [ev])
    const [tA, tB] = [await tier(BROLY_INT), await tier(ETERNAL)]
    const uscita = (ev: number) => {
      const p = (JSON.parse(readFileSync(new URL('../import/.cache/wiki-events.json', import.meta.url), 'utf8'))
        .pages as Riga[]).find((x) => x.pageid === ev)
      return wikiGlobalRelease(p?.wikitext)
    }
    const rel = uscita(BROLY_INT)
    if (!check('la data Global del wiki di 384646', rel instanceof Date, quando(rel))) return
    check('nessun clear sulla run permanente che si toglie',
          Number(await valore(`select count(*) from clear where run_id = $1`, [permanente.id])) === 0)

    const clear: string[] = []
    try {
      await db.query(`update event_run set source = 'wiki', starts_at = $2, ends_at = null, ends_at_known = false
                      where id = $1`, [adottata.id, rel])
      await db.query(`delete from event_run where id = $1`, [permanente.id])
      await db.query(`update event_run set ends_at = null where id = $1`, [chiusa.id])
      for (const [run, t, ev] of [[adottata.id, tA, BROLY_INT], [chiusa.id, tB, ETERNAL]]) {
        clear.push(await valore(`insert into clear (author_id, run_id, stage_tier_id, event_id)
                                 values ($1, $2, $3, $4) returning id::text`, [AUTORE, run, t, ev]))
      }
      const out = lancia('load-windows.mjs')
      check('l\'import: una run adottata, una chiusa, una nuova',
            conta(out, 'del wiki diventate del gioco \\(stessa uscita\\)') === 1
              && conta(out, 'chiuse all\'inizio di una corsa piu\' recente') === 1
              && conta(out, 'nuove dal gioco') === 1
              && conta(out, 'scambiate per tenere i clear nella loro corsa') === 1, out.match(/ricorrenze Global:[\s\S]*?invariate\s+\d+/)?.[0].replace(/\s+/g, ' '))

      const a = (await runs(BROLY_INT))[0]
      check('adottata: stesso id, ora del gioco, con la finestra vera',
            a?.id === adottata.id && a.source === 'game' && stesso(a.starts_at, '2018-08-16T05:00Z')
              && stesso(a.ends_at, '2018-08-28T05:00Z'), descrivi(await runs(BROLY_INT)))
      const b = await runs(ETERNAL)
      // il clear e' di oggi: la sua run diventa la corsa permanente, sul posto
      check('chiusa e scambiata: la run del clear, stesso id, e\' la corsa permanente in cui e\' stato scritto',
            b.length === 2 && b[1]?.id === chiusa.id && b[1].source === 'game' && b[1].ends_at === null
              && b[1].ends_at_known === true && b[1].status === 'active', descrivi(b))
      check('...e il tratto del wiki rientra come run nuova, chiusa all\'inizio della permanenza',
            b[0]?.id !== chiusa.id && b[0]?.source === 'wiki' && stesso(b[0].ends_at, '2024-12-27T02:00Z')
              && b[0].ends_at_known === false, descrivi(b))
      const dove = await righe(`select id::text, run_id::text, stage_tier_id::text from clear where id = any($1::uuid[]) order by run_id`, [clear])
      check('i due clear puntano ancora alle stesse run e alle stesse difficolta\'',
            dove.length === 2 && dove.some((c) => c.run_id === adottata.id && c.stage_tier_id === tA)
              && dove.some((c) => c.run_id === chiusa.id && c.stage_tier_id === tB), JSON.stringify(dove))

      // com'era dokkan_dev: la run gia' divisa da un giro precedente, con il
      // clear di oggi sul tratto chiuso del wiki
      await db.query(`delete from clear where id = any($1::uuid[])`, [clear])
      const tratto = b[0]
      const c3 = await valore(`insert into clear (author_id, run_id, stage_tier_id, event_id)
                               values ($1, $2, $3, $4) returning id::text`, [AUTORE, tratto.id, tB, ETERNAL])
      clear.push(c3)
      const out2 = lancia('load-windows.mjs')
      const b2 = await runs(ETERNAL)
      const sta = Number(await valore(`select count(*) from clear where id = $1 and run_id = $2 and stage_tier_id = $3`,
                                      [c3, tratto.id, tB]))
      check('run gia\' divisa: lo scambio porta la run del clear sulla corsa in corso, senza toccare il clear',
            conta(out2, 'scambiate per tenere i clear nella loro corsa') === 1 && b2.length === 2
              && b2[1].id === tratto.id && b2[1].source === 'game' && b2[1].status === 'active'
              && b2[0].source === 'wiki' && b2[0].ends_at_known === false && sta === 1, descrivi(b2))
    } finally {
      await db.query(`delete from clear where id = any($1::uuid[])`, [clear])
    }
  })

  await sezione('una finestra a mano vince sul gioco', async () => {
    const prima = await runs(TYRANT)
    const gioco = prima.find((r) => r.source === 'game')
    if (!check(`${TYRANT}: la corsa del gioco di marzo 2023`, !!gioco && stesso(gioco.starts_at, '2023-03-01T06:30Z')
               && stesso(gioco.ends_at, '2023-03-18T06:00Z'), descrivi(prima))) return
    let manuale: Riga | undefined
    try {
      // proprio il comando, con le date in UTC esplicito
      const out = lancia('set-event-window.mjs', ['--evento', String(TYRANT), '--reg', 'global',
                                                  '--dal', '2023-03-01T06:30Z', '--al', '2023-03-18T06:00Z'])
      manuale = (await runs(TYRANT)).find((r) => r.source === 'manual')
      check('set-event-window: la finestra a mano c\'e\', ha tolto quella del gioco',
            !!manuale && stesso(manuale.starts_at, '2023-03-01T06:30Z') && stesso(manuale.ends_at, '2023-03-18T06:00Z')
              && manuale.ends_at_known && !(await runs(TYRANT)).some((r) => r.source === 'game'),
            out.match(/rimosse \d+/)?.[0] ?? descrivi(await runs(TYRANT)))
      const imp = lancia('load-windows.mjs')
      check('load-windows salta la finestra e lo dice', conta(imp, 'saltate, c\'e\' una finestra a mano') === 1
              && imp.includes(`${TYRANT} `), imp.match(/saltate[^\n]*\n[^\n]*/)?.[0])
      const dopo = await runs(TYRANT)
      check('la run a mano e\' intatta, e nessuna del gioco le si sovrappone',
            dopo.some((r) => r.id === manuale!.id && r.source === 'manual' && stesso(r.starts_at, '2023-03-01T06:30Z')
                             && stesso(r.ends_at, '2023-03-18T06:00Z'))
              && !dopo.some((r) => r.source === 'game'), descrivi(dopo))
    } finally {
      if (manuale) await db.query(`delete from event_run where id = $1`, [manuale.id])
      lancia('load-windows.mjs')
    }
    const rimessa = await runs(TYRANT)
    check('tolta la run a mano, la corsa del gioco rientra',
          rimessa.some((r) => r.source === 'game' && stesso(r.starts_at, '2023-03-01T06:30Z')), descrivi(rimessa))
  })

  // Se il wiki corregge la data, load-events sposta anche una run del wiki
  // chiusa dal gioco, confrontandola col suo tratto (prima la confrontava
  // con l'infinito, e le corse del gioco che la seguono la bloccavano).
  await sezione('load-events sposta una run del wiki chiusa', async () => {
    const w = (await runs(CARNAGE))[0]
    if (!check(`${CARNAGE}: c'e' la run del wiki chiusa`, w?.source === 'wiki' && w.ends_at !== null, descrivi(w ? [w] : []))) return
    await db.query(`update event_run set starts_at = starts_at + interval '1 day' where id = $1`, [w.id])
    lancia('load-events.mjs')
    const dopo = (await runs(CARNAGE))[0]
    check('rimessa alla data del wiki, stesso id', dopo?.id === w.id && stesso(dopo.starts_at, w.starts_at.toISOString()),
          descrivi(dopo ? [dopo] : []))
  })

  // Le aperture a stage scaglionati: la corsa aperta parte dal primo blocco
  // 2038, non dall'ultimo. E lo stato lasciato dalla regola di prima (corsa
  // datata dall'ultimo blocco) si riassorbe tenendo gli id.
  await sezione('apertura a stage scaglionati', async () => {
    const m1306 = missioniDi(1306)
    if (!check('cache: area 1306 apre il 2024-07-07 06:30 con missioni 2038 e aggiunge stage il 08-05',
               m1306.startsWith('2024-07-07 06:30:00 -> 2038-01-01 00:00:00') && m1306.includes('2024-08-05'),
               m1306.slice(0, 120))) return
    const m = await runs(MEMORIAL)
    check(`${MEMORIAL}: una sola corsa del gioco, aperta dal 2024-07-07T06:30Z`,
          m.length === 1 && m[0].source === 'game' && stesso(m[0].starts_at, '2024-07-07T06:30Z')
            && m[0].ends_at === null && m[0].status === 'active', descrivi(m))
    const s0 = await runs(STAGGERED)
    check(`${STAGGERED}: la run del wiki del 07-07 diventa la corsa, non si spezza al 07-18`,
          s0.length === 1 && s0[0].source === 'game' && s0[0].ends_at === null
            && quando(s0[0].starts_at).startsWith('2023-07-07'), descrivi(s0))
    if (m.length !== 1 || s0.length !== 1) return
    await db.query(`update event_run set starts_at = '2024-08-05T06:30Z' where id = $1`, [m[0].id])
    await db.query(`update event_run set source = 'wiki', ends_at = '2023-07-18T00:00Z' where id = $1`, [s0[0].id])
    const { rows: [g] } = await db.query(`
      insert into event_run (event_id, reg, starts_at, ends_at, ends_at_known, source)
      values ($1, 'global', '2023-07-18T00:00Z', null, false, 'game') returning id::text`, [STAGGERED])
    const out = lancia('load-windows.mjs')
    const m2 = await runs(MEMORIAL), s2 = await runs(STAGGERED)
    check('load-windows riassorbe la corsa del 07-18 nella run del 07-07, e lo dice',
          Number(out.match(/riassorbite \(stessa corsa, dall'ultimo blocco\)\s+(\d+)/)?.[1]) === 1
            && s2.length === 1 && s2[0].id === s0[0].id && s2[0].source === 'game' && s2[0].ends_at === null
            && stesso(s2[0].starts_at, s0[0].starts_at.toISOString()) && !s2.some((r) => r.id === g.id), descrivi(s2))
    check(`${MEMORIAL}: la corsa datata al 08-05 torna al 07-07, stesso id`,
          m2.length === 1 && m2[0].id === m[0].id && stesso(m2[0].starts_at, '2024-07-07T06:30Z'), descrivi(m2))
  })

  await sezione('set-event-window chiude la corsa precedente, non la cancella', async () => {
    const prima = await runs(PAN)
    const aperta = prima.at(-1)
    if (!check(`${PAN}: l'ultima corsa del gioco e' aperta dal 2025-08-08T01:00Z`, aperta?.source === 'game'
               && aperta.ends_at === null && stesso(aperta.starts_at, '2025-08-08T01:00Z'), descrivi(prima)) || !aperta) return
    let manuale: Riga | undefined
    try {
      const out = lancia('set-event-window.mjs', ['--evento', String(PAN), '--reg', 'global',
                                                  '--dal', '2026-10-01T05:00Z', '--al', '2026-10-15T08:00Z'])
      const dopo = await runs(PAN)
      manuale = dopo.find((r) => r.source === 'manual')
      const chiusa = dopo.find((r) => r.id === aperta.id)
      check('la corsa del gioco resta, chiusa al --dal con la fine non nota, e lo dice',
            !!chiusa && chiusa.source === 'game' && stesso(chiusa.ends_at, '2026-10-01T05:00Z') && !chiusa.ends_at_known
              && out.includes(`chiusa al --dal la run ${aperta.id} (game`), descrivi(dopo))
      check('la run a mano c\'e\', e la corsa del 2016 e\' intatta',
            !!manuale && stesso(manuale.starts_at, '2026-10-01T05:00Z') && stesso(manuale.ends_at, '2026-10-15T08:00Z')
              && manuale.ends_at_known && manuale.status === 'active' && dopo.length === prima.length + 1
              && dopo[0].id === prima[0].id && stesso(dopo[0].ends_at, prima[0].ends_at.toISOString()), descrivi(dopo))
      lancia('load-windows.mjs')
      const ancora = (await runs(PAN)).find((r) => r.id === aperta.id)
      check('load-windows la lascia chiusa (tocca la run a mano)', !!ancora && stesso(ancora.ends_at, '2026-10-01T05:00Z'),
            descrivi(ancora ? [ancora] : []))
    } finally {
      if (manuale) await db.query(`delete from event_run where id = $1`, [manuale.id])
      lancia('load-windows.mjs')
    }
    const rimessa = await runs(PAN)
    check('tolta la run a mano, la corsa del gioco si riapre con lo stesso id',
          rimessa.length === prima.length && rimessa.at(-1)?.id === aperta.id && rimessa.at(-1)?.ends_at === null, descrivi(rimessa))

    // la run del wiki della stessa uscita diventa la run a mano sul posto
    const wk = await righe(`
      select r.event_id::int as ev, r.id::text, r.starts_at from event_run r
      where r.reg = 'global' and r.source = 'wiki' and r.ends_at is null
        and not exists (select 1 from event_game_ref g where g.event_id = r.event_id)
        and not exists (select 1 from event_run o where o.event_id = r.event_id and o.reg = 'global' and o.id <> r.id)
        and not exists (select 1 from clear c where c.run_id = r.id)
      order by r.event_id limit 1`)
    if (!check('un evento senza legame, con una sola run del wiki aperta', wk.length === 1)) return
    const { ev, id, starts_at } = wk[0]
    const dal = new Date(starts_at.getTime() + 5 * 3_600_000).toISOString()
    try {
      lancia('set-event-window.mjs', ['--evento', String(ev), '--reg', 'global', '--dal', dal,
                                      '--al', new Date(starts_at.getTime() + 14 * 86_400_000).toISOString()])
      const r = await runs(ev)
      check(`${ev}: la run del wiki diventa la run a mano, stesso id`, r.length === 1 && r[0].id === id
              && r[0].source === 'manual' && stesso(r[0].starts_at, dal) && r[0].ends_at_known, descrivi(r))
    } finally {
      await db.query(`update event_run set source = 'wiki', starts_at = $2, ends_at = null, ends_at_known = false
                      where id = $1`, [id, starts_at])
    }
  })

  // GLBdate e JPdate sono giorni UTC: la run parte a mezzanotte UTC, con
  // qualunque fuso abbia la sessione che importa
  await sezione('le date del wiki sono la mezzanotte UTC', async () => {
    const tot = Number(await valore(`select count(*) from event_run where source = 'wiki'`))
    const fuori = Number(await valore(`
      select count(*) from event_run where source = 'wiki' and starts_at <> date_trunc('day', starts_at, 'UTC')`))
    check('ogni run del wiki (Global e Japan) inizia a mezzanotte UTC', tot > 500 && fuori === 0, `${fuori} su ${tot}`)
    const tutte = `select id::text, event_id::text, reg::text, starts_at, ends_at, ends_at_known, source from event_run order by id`
    const prima = await righe(tutte)
    const out = lancia('load-events.mjs', [], `${url}?options=${encodeURIComponent('-c TimeZone=America/New_York')}`)
    const dopo = await righe(tutte)
    check('load-events con la sessione a New York non sposta niente', /nuove 0, spostate 0/.test(out)
            && JSON.stringify(prima) === JSON.stringify(dopo), out.match(/nuove \d+, spostate \d+/)?.[0])
  })

  await sezione('un secondo giro non cambia niente', async () => {
    const foto = async () => JSON.stringify(await righe(`
      select r.id, r.event_id, r.reg, r.starts_at, r.ends_at, r.ends_at_known, r.source from event_run r order by r.id`))
      + JSON.stringify(await righe(`select * from event_game_ref order by game_kind, game_id`))
    const prima = await foto()
    const out = lancia('load-windows.mjs')
    check('load-windows: tutto invariato', conta(out, 'invariate') > 400 && conta(out, 'nuove dal gioco') === 0
            && conta(out, 'chiuse all\'inizio di una corsa piu\' recente') === 0
            && conta(out, 'del gioco aggiornate') === 0 && conta(out, 'del wiki diventate del gioco \\(stessa uscita\\)') === 0
            && /nuovi 0, cambiati 0, tolti 0/.test(out), `invariate ${conta(out, 'invariate')}`)
    check('run e legami identici, id compresi', (await foto()) === prima)
    // e il giro completo: load-events non ricrea le run del wiki adottate
    lancia('load-events.mjs')
    lancia('load-windows.mjs')
    check('anche dopo load-events + load-windows', (await foto()) === prima)
  })

  await sezione('lo stato su Global', async () => {
    const stato = await righe(`
      with u as (
        select distinct on (es.event_id) es.event_id, es.status, r.ends_at, r.ends_at_known
        from event_status es join event_run r on r.id = es.run_id
        join event e on e.id = es.event_id
        where es.reg = 'global' and e.imported_from = 'wiki'
        order by es.event_id, case es.status when 'active' then 0 when 'upcoming' then 1 else 2 end,
                 case when es.status = 'upcoming' then es.starts_at end asc nulls last, es.starts_at desc)
      select status, (ends_at is null) as aperta, ends_at_known as nota, count(*)::int as n from u group by 1, 2, 3`)
    const n = (f: (r: Riga) => boolean) => stato.filter(f).reduce((a, r) => a + r.n, 0)
    console.log(`        ${stato.map((r) => `${r.status}${r.aperta ? (r.nota ? ' permanente' : ' fine non nota') : ' con la fine'}: ${r.n}`).join(', ')}`)
    check('piu\' di cento eventi conclusi (prima: nessuno)', n((r) => r.status === 'past') > 100, `${n((r) => r.status === 'past')}`)
    check('piu\' di cento EZA permanenti', n((r) => r.status === 'active' && r.aperta && r.nota) > 100)
    check('gli attivi senza una fine nota sono meno di prima (tutti)',
          n((r) => r.status === 'active' && !r.nota) < n(() => true) * 0.75,
          `${n((r) => r.status === 'active' && !r.nota)} su ${n(() => true)}`)
  })
} finally {
  await db.end()
}

console.log(fails ? `\n  ${passes} verdi, ${fails} rosse\n` : `\n  ${passes} verifiche, TUTTO VERDE\n`)
process.exit(fails ? 1 : 0)
