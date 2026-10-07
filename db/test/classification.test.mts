// Verifica la classificazione degli eventi che il wiki divide o raccoglie
// diversamente dal gioco: il tipo dei remake della storia (load-events), le
// pagine della Super Battle Road e gli archivi delle edizioni (legami per
// quest, migrazione 0012, db/import/quest-refs.mjs, dentro load-windows).
//
// Gira sul database di test dopo l'import dalle cache (npm run db:test).
// Come in windows.test.mts, prima di usare un atteso si controlla che la
// cache dica ancora quello su cui e' scritto. Rilancia load-events e
// load-windows: alla fine il database torna com'era.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { loadTable } from '../import/datamine.mjs'

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
  const male = righe.filter((x) => !ok(x))
  return check(nome, male.length === 0,
    male.length ? `${male.length} righe su ${righe.length} non tornano, per esempio ${JSON.stringify(male[0])}` : `${righe.length} righe`)
}
const stesso = (d: unknown, iso: string | null) =>
  iso === null ? d === null : d instanceof Date && d.getTime() === new Date(iso).getTime()
const quando = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 16).replace('T', ' ') : 'aperta')

// ------------------------------------------------------------ il bersaglio

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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Riga = Record<string, any>
const righe = async (text: string, params: unknown[] = []): Promise<Riga[]> => (await db.query(text, params)).rows
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const valore = async (text: string, params: unknown[] = []): Promise<any> => {
  const r = (await db.query(text, params)).rows[0]
  return r ? Object.values(r)[0] : undefined
}
const script = (nome: string) => new URL(`../import/${nome}`, import.meta.url).pathname
const lancia = (nome: string) => execFileSync(process.execPath, [script(nome)],
  { env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' })
const conta = (out: string, etichetta: string) => Number(out.match(new RegExp(`${etichetta}\\s+(\\d+)`))?.[1] ?? NaN)

async function sezione(titolo: string, fn: () => Promise<void>) {
  console.log(`\n${titolo}`)
  try {
    await fn()
  } catch (err) {
    check(`${titolo}: interrotta da un errore`, false, (err as Error).message.split('\n')[0])
  }
}

const runs = (ev: number) => righe(`
  select r.id::text, r.source, r.starts_at, r.ends_at, r.ends_at_known, es.status
  from event_run r join event_status es on es.run_id = r.id
  where r.event_id = $1 and r.reg = 'global' order by r.starts_at`, [ev])
const descrivi = (rs: Riga[]) => rs.map((r) => `${r.id} ${r.source} ${quando(r.starts_at)}→${quando(r.ends_at)}`
  + `${r.ends_at_known ? '' : ' (fine non nota)'} ${r.status}`).join('; ')

const pages = (JSON.parse(readFileSync(new URL('../import/.cache/wiki-events.json', import.meta.url), 'utf8'))
  .pages as Riga[])
const areas = new Map((loadTable('areas') as Riga[]).map((a) => [Number(a.id), a]))
const quests = new Map((loadTable('quests') as Riga[]).map((q) => [Number(q.id), q]))
const AUTORE = '11111111-1111-1111-1111-111111111111'   // dalla fixture

// I sei 'other' che restano: quattro "Limit Events" (una famiglia del wiki
// che il sito non ha fra i tipi; il gioco li mette nella categoria 8, che
// anche load-game-events tiene 'other') e due pagine senza navigazione ne'
// categorie (727138, 727287).
const OTHER = [4285, 5467, 56171, 648656, 727138, 727287]

try {
  await sezione('il tipo dei remake della storia', async () => {
    const dbStory = pages.filter((p) => /\{\{\s*Dragon Ball Story Nav/i.test(p.wikitext)).map((p) => Number(p.pageid))
    if (!check('cache: 15 pagine con la navigazione "Dragon Ball Story Nav"', dbStory.length === 15, `${dbStory.length}`)) return
    const k = await righe(`select id::int, kind::text from event where id = any($1::bigint[])`, [dbStory])
    tutte('sono tutte story', k, (r) => r.kind === 'story')
    // la stessa cosa dal lato del gioco: ogni evento legato a un'area DbStory
    // (categoria 9000), del wiki o creato da load-game-events, e' story
    const cat9000 = [...areas.values()].filter((a) => a.category === '9000').map((a) => Number(a.id))
    const legati = await righe(`
      select e.id::int, e.kind::text, e.imported_from::text as da, g.game_id from event_game_ref g
      join event e on e.id = g.event_id where g.game_kind = 'area' and g.game_id = any($1::int[])`, [cat9000])
    check('ci sono eventi DbStory sia del wiki sia del gioco',
          legati.some((r) => r.da === 'wiki') && legati.some((r) => r.da === 'datamine'), `${legati.length}`)
    tutte('ogni evento legato a un\'area DbStory e\' story', legati, (r) => r.kind === 'story')

    const cats = (id: number) => (pages.find((p) => Number(p.pageid) === id)?.wikitext ?? '')
      .match(/\[\[Category:[^\]]+\]\]/g)?.join(' ') ?? ''
    if (check('cache: 710308 e 2542 si riconoscono solo dalle categorie',
              /Story Events/.test(cats(710308)) && /Special Events/.test(cats(2542)))) {
      const r = await righe(`select id::int, kind::text from event where id in (710308, 2542) order by id`)
      check('710308 story, 2542 limited', r.length === 2 && r[0].kind === 'limited' && r[1].kind === 'story', JSON.stringify(r))
    }
    const altri = (await righe(`select id::int from event where kind = 'other' and imported_from = 'wiki' order by id`)).map((r) => r.id)
    check('restano other solo i sei attesi', JSON.stringify(altri) === JSON.stringify(OTHER), altri.join(', '))

    // stabile: un altro giro di load-events non rimette 'other'
    const prima = await righe(`select id::text, kind::text from event order by id`)
    lancia('load-events.mjs')
    const dopo = await righe(`select id::text, kind::text from event order by id`)
    check('un secondo load-events non cambia nessun tipo', JSON.stringify(prima) === JSON.stringify(dopo),
          `${prima.length} eventi`)
  })

  // l'ora del gioco e' UTC senza ora legale: '2018-02-14 06:30:00' -> Z
  const utc = (s: string) => `${s.replace(' ', 'T')}Z`

  await sezione('Super Battle Road: una pagina, dieci piani', async () => {
    const ok = check('cache: le due aree e le partenze che smentiscono il wiki',
      areas.get(710)?.name === 'Super Battle Road' && areas.get(720)?.name === 'Extreme Super Battle Road'
        && quests.get(710081)?.start_at === '2024-07-18 06:30:00' && quests.get(720051)?.start_at === '2024-04-02 06:30:00')
    if (!ok) return
    const sbr = await righe(`select id::int, wiki_title from event where wiki_title ~ '^(Extreme )?Super Battle Road \\d+ - \\d+$' order by id`)
    if (!check('15 pagine SBR nel wiki', sbr.length === 15, `${sbr.length}`)) return
    check('nessun legame per area su 710 e 720',
          Number(await valore(`select count(*) from event_game_ref where game_kind = 'area' and game_id in (710, 720)`)) === 0)
    const atteso: Riga[] = [], trovato: Riga[] = []
    for (const e of sbr) {
      const m = e.wiki_title.match(/^(Extreme )?Super Battle Road (\d+) - (\d+)$/)
      const area = m[1] ? 720 : 710
      const ids = [...quests.keys()].filter((q) => q >= area * 1000 + Number(m[2]) && q <= area * 1000 + Number(m[3])).sort()
      const prima = ids.map((q) => quests.get(q)!.start_at as string).sort()[0]
      const refs = (await righe(`select game_id from event_game_ref where event_id = $1 and game_kind = 'quest' and via = 'range'
                                 order by game_id`, [e.id])).map((r) => r.game_id)
      atteso.push({ id: e.id, refs: ids.join(','), start: utc(prima) })
      const rs = await runs(e.id)
      trovato.push({ id: e.id, refs: refs.join(','), rs })
    }
    tutte('ogni pagina ha le quest del suo intervallo', trovato, (t) => t.refs === atteso.find((a) => a.id === t.id)!.refs)
    tutte('una sola run Global: del gioco, permanente, dal primo piano dell\'intervallo, in corso', trovato, (t) =>
      t.rs.length === 1 && t.rs[0].source === 'game' && t.rs[0].ends_at === null && t.rs[0].ends_at_known === true
        && stesso(t.rs[0].starts_at, atteso.find((a) => a.id === t.id)!.start) && t.rs[0].status === 'active')
    // 81 - 90: il wiki dice 2023-11-10 (la data di 71 - 80), il gioco 2024-07-18
    const r81 = trovato.find((t) => t.id === 726811)?.rs ?? []
    check('81 - 90: la run del wiki e\' la stessa uscita, niente tratto chiuso prima', r81.length === 1
            && stesso(r81[0].starts_at, '2024-07-18T06:30Z'), descrivi(r81))
  })

  await sezione('gli archivi: le edizioni restano in gioco', async () => {
    const ok = check('cache: l\'archivio apre il 2026-01-22, Artificial Life Forms entra il 2026-02-26',
      (loadTable('missions') as Riga[]).some((m) => m.id === '31597' && Number(m.area_id) === 1737 && m.start_at === '2026-01-22 05:00:00')
        && quests.get(1737080)?.start_at === '2026-02-26 08:00:00' && quests.get(1737001)?.start_at === '2015-10-30 00:00:00')
    if (!ok) return
    const gruppi = await righe(`
      select event_id::int, count(*)::int as n, min(game_id) as da from event_game_ref
      where game_kind = 'quest' and via = 'archive' group by event_id order by event_id`)
    check('17 edizioni: 13 in Ultimate Red Zone, 4 in Supreme Magnificent Battle', gruppi.length === 17
            && gruppi.filter((g) => g.da < 1738000).length === 13, `${gruppi.length}`)
    const legate = Number(await valore(`select count(*) from event_game_ref where game_kind = 'quest' and via = 'archive'`))
    const movie = Number(await valore(`select count(*) from event_game_ref where game_kind = 'quest' and game_id between 1738015 and 1738021`))
    check('legate tutte le quest degli archivi tranne Movie Edition di 1738 (area 797, nessun evento)',
          legate === 85 + 32 - 7 && movie === 0, `${legate}, Movie Edition ${movie}`)
    const casi: Riga[] = []
    for (const g of gruppi) casi.push({ id: g.event_id, rs: await runs(g.event_id) })
    const da = (id: number) => (id === 1_000_001_736 ? '2026-02-26T08:00Z' : '2026-01-22T05:00Z')
    tutte('ogni edizione ha la sua corsa permanente dall\'apertura dell\'archivio, in corso', casi, (c) => {
      const p = c.rs.at(-1)
      return !!p && p.source === 'game' && p.ends_at === null && p.ends_at_known === true
        && stesso(p.starts_at, da(c.id)) && p.status === 'active'
    })
    tutte('le corse di prima finiscono, non dopo, dove comincia l\'archivio', casi, (c) =>
      c.rs.slice(0, -1).every((r) => r.ends_at instanceof Date && r.ends_at.getTime() <= new Date(da(c.id)).getTime()))
    const gt = casi.find((c) => c.id === 712688)?.rs ?? []
    check('GT Edition: la run del wiki del 2022 chiusa senza fine nota, poi la permanenza', gt.length === 2
            && gt[0].source === 'wiki' && stesso(gt[0].starts_at, '2022-07-07T00:00Z') && stesso(gt[0].ends_at, '2026-01-22T05:00Z')
            && gt[0].ends_at_known === false, descrivi(gt))
  })

  await sezione('una run a mano vince, e i clear restano nella loro corsa', async () => {
    const GT = 712688
    const prima = await runs(GT)
    const perm = prima.at(-1)
    if (!check('GT Edition di partenza: wiki chiusa e permanente', prima.length === 2 && perm?.ends_at === null, descrivi(prima))) return
    let manuale = ''
    try {
      // al posto della permanenza, una finestra scritta a mano: il gioco la salta
      await db.query(`delete from event_run where id = $1`, [perm.id])
      manuale = await valore(`insert into event_run (event_id, reg, starts_at, ends_at, ends_at_known, source)
        values ($1, 'global', '2026-01-22T05:00Z', '2026-03-01T00:00Z', true, 'manual') returning id::text`, [GT])
      const out = lancia('load-windows.mjs')
      const dopo = await runs(GT)
      check('load-windows salta la finestra a mano e lo dice', conta(out, 'saltate, c\'e\' una finestra a mano') === 1
              && out.includes(`${GT} `), out.match(/saltate[^\n]*\n[^\n]*/)?.[0])
      check('la run a mano e\' intatta, e nessuna del gioco le si sovrappone',
            dopo.some((r) => r.id === manuale && r.source === 'manual' && stesso(r.ends_at, '2026-03-01T00:00Z'))
              && !dopo.some((r) => r.source === 'game'), descrivi(dopo))
    } finally {
      if (manuale) await db.query(`delete from event_run where id = $1`, [manuale])
      lancia('load-windows.mjs')
    }
    const rimessa = await runs(GT)
    check('tolta la run a mano, la permanenza rientra', rimessa.length === 2 && rimessa[1].source === 'game'
            && rimessa[1].ends_at === null && stesso(rimessa[1].starts_at, '2026-01-22T05:00Z'), descrivi(rimessa))

    // un clear di oggi sulla run del wiki chiusa: le due righe si scambiano,
    // e il clear resta sulla sua run, che ora e' la corsa in cui e' stato scritto
    const chiusa = rimessa[0]
    const tier = await valore(`select id::text from stage_tier where event_id = $1 order by id limit 1`, [GT])
    let clear = ''
    try {
      clear = await valore(`insert into clear (author_id, run_id, stage_tier_id, event_id)
                            values ($1, $2, $3, $4) returning id::text`, [AUTORE, chiusa.id, tier, GT])
      const out = lancia('load-windows.mjs')
      const b = await runs(GT)
      const sta = Number(await valore(`select count(*) from clear where id = $1 and run_id = $2`, [clear, chiusa.id]))
      check('scambio: la run del clear e\' la permanenza, il tratto del wiki rientra, il clear non si muove',
            conta(out, 'scambiate per tenere i clear nella loro corsa') === 1 && b.length === 2 && sta === 1
              && b[1].id === chiusa.id && b[1].source === 'game' && b[1].ends_at === null && b[1].ends_at_known === true
              && b[0].source === 'wiki' && stesso(b[0].ends_at, '2026-01-22T05:00Z'), descrivi(b))
      const out2 = lancia('load-windows.mjs')
      check('...e un altro giro non lo cancella', (await runs(GT)).some((r) => r.id === chiusa.id)
              && conta(out2, 'nuove dal gioco') === 0, descrivi(await runs(GT)))
    } finally {
      if (clear) await db.query(`delete from clear where id = $1`, [clear])
    }
  })

  await sezione('un secondo giro non cambia niente', async () => {
    const prima = await righe(`select id::text, event_id::text, starts_at, ends_at, ends_at_known, source from event_run order by id`)
    const out = lancia('load-windows.mjs')
    const dopo = await righe(`select id::text, event_id::text, starts_at, ends_at, ends_at_known, source from event_run order by id`)
    check('legami per quest: nessuno nuovo, cambiato o tolto', /legami scritti: \d+\s+nuovi 0, cambiati 0, tolti 0/.test(out),
          out.match(/legami scritti:[^\n]*/)?.[0])
    check('run: nessuna cambiata', JSON.stringify(prima) === JSON.stringify(dopo)
            && conta(out, 'nuove dal gioco') === 0 && conta(out, 'del gioco aggiornate') === 0, `${dopo.length} run`)
    check('nessuna quest in due eventi (la chiave primaria regge)', Number(await valore(`
      select count(*) from (select game_id from event_game_ref where game_kind = 'quest' group by 1 having count(*) > 1) x`)) === 0)
  })
} finally {
  await db.end()
}

console.log(fails ? `\n  ${passes} verdi, ${fails} rosse\n` : `\n  ${passes} verifiche, TUTTO VERDE\n`)
process.exit(fails ? 1 : 0)
