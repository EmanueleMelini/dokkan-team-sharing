// Lo specchio Japan (db/import/mirror-japan.mjs, migrazione 0036): le date
// Japan da D in poi copiate dalle finestre Global del gioco, e le uscite
// Japan delle carte.
//
// Gira sul database di test DOPO l'import dalle cache (lo prepara
// npm run db:test, che ha gia' lanciato lo specchio): rilancia
// mirror-japan, load-events, load-windows e set-event-window come processi
// veri, e ritocca qualche run per mettere in scena i casi (una run del
// wiki della stessa uscita, una finestra a mano, un clear Japan, le uscite
// di una carta come se solo il gioco la conoscesse). Le regole diverse da
// quelle vere arrivano con --rules, la data Japan del wiki cambiata con una
// copia della cache (WIKI_EVENTS_CACHE), che leggono load-events e lo
// specchio come nel giro vero. Alla fine le run toccate tornano
// equivalenti a come le ha trovate (con id nuovi per le copie tolte e
// rimesse).
//
// Gli eventi dei casi si scelgono sui dati, con la forma che serve: se
// nessuno ha quella forma la verifica e' rossa, non verde per caso.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { isSentinel, loadTable } from '../import/datamine.mjs'
import { wikiJapanRelease } from '../import/game-map.mjs'
import { RULES, TOL, japanDay } from '../import/japan-mirror/rules.mjs'

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
const quando = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 16) + 'Z' : String(d))
const stesso = (a: unknown, b: unknown) =>
  a === null || b === null ? a === b : new Date(a as string).getTime() === new Date(b as string).getTime()

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
function lancia(nome: string, args: string[] = [], env: Record<string, string> = {}): string {
  return execFileSync(process.execPath, [script(nome), ...args],
    { env: { ...process.env, DATABASE_URL: url, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}
// "    invariate      462" -> 462
const conta = (out: string, etichetta: string) => Number(out.match(new RegExp(`${etichetta}\\s+(\\d+)`))?.[1] ?? NaN)
const ricorrenze = (out: string) => out.match(/ricorrenze Japan:[\s\S]*?scambiate[^\n]*/)?.[0].replace(/\s+/g, ' ') ?? out.slice(-300)

async function sezione(titolo: string, fn: () => Promise<void>) {
  console.log(`\n${titolo}`)
  try {
    await fn()
  } catch (err) {
    check(`${titolo}: interrotta da un errore`, false, (err as Error).message.split('\n')[0])
  }
}

// le run Japan di un evento, in ordine
const runsJp = (ev: number | string) => righe(`
  select id::text, source, starts_at, ends_at, ends_at_known from event_run
  where event_id = $1 and reg = 'japan' order by starts_at`, [ev])
const descrivi = (rs: Riga[]) => rs.map((r) => `${r.id} ${r.source} ${quando(r.starts_at)}→${quando(r.ends_at)}`
  + `${r.ends_at_known ? '' : ' (fine non nota)'}`).join('; ')

const D = RULES.since
// open_at di ogni carta del datamine ('2025-01-28 21:00:00', UTC), come lo
// legge lo specchio per il giorno giapponese delle carte del gioco
const aperte = new Map(loadTable('cards').filter((r: Riga) => r.open_at && !isSentinel(r.open_at))
  .map((r: Riga) => [String(r.id), String(r.open_at)]))
const istante = (t: string) => `${t.replace(' ', 'T')}Z`
const AUTORE = '11111111-1111-1111-1111-111111111111'   // dalla fixture
const tmp = mkdtempSync(join(tmpdir(), 'dokkan-japan-mirror-'))
const regole = (nome: string, r: object) => { const p = join(tmp, `${nome}.json`); writeFileSync(p, JSON.stringify(r)); return p }

// Una copia della cache del wiki con la data Japan di un evento cambiata:
// la leggono lo specchio e load-events (WIKI_EVENTS_CACHE, solo per i test).
// Senza una riga JPdate (o con il template su una riga sola, che load-events
// non legge) se ne aggiunge una in fondo, a inizio riga come la legge lui.
const CACHE = new URL('../import/.cache/wiki-events.json', import.meta.url).pathname
const pagineWiki = new Map((JSON.parse(readFileSync(CACHE, 'utf8')).pages as Riga[]).map((p) => [p.pageid, p.wikitext]))
const MESI = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dataWiki = (d: Date) => `${d.getUTCDate()} ${MESI[d.getUTCMonth()]} ${d.getUTCFullYear()}`
const mezzanotte = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
function cacheCon(ev: number, jp: Date): string | null {
  const raw = JSON.parse(readFileSync(CACHE, 'utf8'))
  const p = raw.pages.find((x: Riga) => x.pageid === ev)
  if (!p) return null
  const riga = /^\|\s*JPdate\s*=.*$/m
  p.wikitext = riga.test(p.wikitext) ? p.wikitext.replace(riga, `|JPdate = ${dataWiki(jp)}`) : `${p.wikitext}\n|JPdate = ${dataWiki(jp)}`
  const f = join(tmp, `wiki-events-${ev}.json`)
  writeFileSync(f, JSON.stringify(raw))
  return f
}

// La fotografia di run e uscite, id compresi: un giro che non deve cambiare
// niente la lascia identica. Gli istanti come testo con i microsecondi: una
// Date si ferma al millisecondo, e non vedrebbe una copia che perde i
// microsecondi della sua run Global a mano (e li riprende al giro dopo).
const foto = async () => JSON.stringify(await righe(`
  select id, event_id, reg, to_char(starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') as starts_at,
         to_char(ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') as ends_at, ends_at_known, source
  from event_run order by id`))
  + JSON.stringify(await righe(`select card_id, reg, released_at::text, source from card_release order by card_id, reg`))
// Il giro settimanale degli eventi: load-events, load-windows, lo specchio.
// La cache del wiki di prova la leggono load-events e lo specchio
// (load-windows legge solo le date Global, che restano quelle).
function settimana(env: Record<string, string>): { eventi: string, specchio: string } {
  const eventi = lancia('load-events.mjs', [], env)
  lancia('load-windows.mjs')
  return { eventi, specchio: lancia('mirror-japan.mjs', [], env) }
}
const wikiRun = (out: string) => out.match(/ricorrenze \(prima uscita[^\n]*/)?.[0] ?? ''

// Gli eventi del wiki con la forma piu' semplice: la run del wiki chiusa
// all'inizio di una sola copia, con la fine nota; una sola finestra Global
// da D; nessun clear; una data Japan nella pagina.
async function eventiWikiSemplici(): Promise<Riga[]> {
  const rs = await righe(`
    select e.id::int as ev, w.id::text as wiki, w.starts_at as jp, m.id::text as copia,
           m.starts_at, m.ends_at, m.ends_at_known
    from event e
    join event_run w on w.event_id = e.id and w.reg = 'japan' and w.source = 'wiki' and w.ends_at is not null
    join event_run m on m.event_id = e.id and m.reg = 'japan' and m.source = 'mirror'
                    and m.starts_at = w.ends_at and m.ends_at is not null and m.ends_at_known
    where e.imported_from = 'wiki' and w.starts_at < $1::timestamptz
      and (select count(*) from event_run x where x.event_id = e.id and x.reg = 'japan') = 2
      and (select count(*) from event_run x where x.event_id = e.id and x.reg = 'global' and x.source = 'game'
             and x.starts_at >= $1::timestamptz) = 1
      and not exists (select 1 from clear c join event_run x on x.id = c.run_id where x.event_id = e.id)
    order by e.id`, [D])
  const pagine = new Map((JSON.parse(readFileSync(CACHE, 'utf8')).pages as Riga[]).map((p) => [p.pageid, p.wikitext]))
  return rs.filter((r) => /^\|\s*JPdate\s*=.*$/m.test(pagine.get(r.ev) ?? ''))
}

try {
  // le suite prima possono aver rifatto le finestre Global: si riparte allineati
  const primo = lancia('mirror-japan.mjs')
  check('lo specchio gira e dice su quale database scrive', /database: .*_test/.test(primo) && /\n {2}fatto\./.test(primo),
        ricorrenze(primo))
  // le finestre saltate per una run a mano gia' prima dei casi: la fixture
  // (5001) ha una finestra Global a mano che tocca la sua run Japan a mano
  const saltateDiBase = conta(primo, 'saltate, c\'e\' una finestra a mano')

  await sezione('i vincoli della 0036', async () => {
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
    await db.query('begin')
    try {
      await db.query(`insert into event_run (event_id, reg, starts_at, ends_at, ends_at_known, source)
                      values (5001, 'japan', '2001-01-01Z', '2001-01-02Z', true, 'mirror')`)
      check('una copia su Japan: accettata', true)
    } catch (err) {
      check('una copia su Japan: accettata', false, (err as Error).message)
    } finally {
      await db.query('rollback')
    }
    await rifiuta('una provenienza che non esiste: rifiutata', `
      insert into event_run (event_id, reg, starts_at, source) values (5001, 'japan', '2001-01-01Z', 'altro')`, 'run_source')
    await rifiuta('una copia su Global: rifiutata', `
      insert into event_run (event_id, reg, starts_at, source) values (5001, 'global', '2001-01-01Z', 'mirror')`, 'run_mirror_japan')
    await rifiuta('una run del gioco su Japan: rifiutata', `
      insert into event_run (event_id, reg, starts_at, source) values (5001, 'japan', '2001-01-01Z', 'game')`, 'run_game_global')

    const col = (await righe(`select column_default, is_nullable from information_schema.columns
                              where table_schema = 'public' and table_name = 'card_release' and column_name = 'source'`))[0]
    check('card_release.source esiste, not null, per difetto manual',
          col?.is_nullable === 'NO' && /^'manual'/.test(col?.column_default ?? ''), JSON.stringify(col))
    await rifiuta('un\'uscita con una provenienza che non esiste: rifiutata', `
      update card_release set source = 'altro' where card_id = 1001 and reg = 'japan'`, 'card_release_source')
    await rifiuta('un\'uscita Global dello specchio: rifiutata', `
      update card_release set source = 'mirror' where card_id = 1001 and reg = 'global'`, 'card_release_mirror_japan')
    await rifiuta('un\'uscita Japan del gioco: rifiutata', `
      update card_release set source = 'game' where card_id = 1001 and reg = 'japan'`, 'card_release_game_global')
    const fixture = await righe(`select distinct source from card_release where card_id between 1001 and 1010`)
    check('le uscite della fixture, scritte senza provenienza, sono manual',
          fixture.length === 1 && fixture[0].source === 'manual', JSON.stringify(fixture))
    const perFonte = await righe(`select reg::text, source, count(*)::int as n from card_release group by 1, 2 order by 1, 2`)
    check('uscite del wiki, del gioco (solo Global), dello specchio (solo Japan) e a mano',
          perFonte.some((r) => r.reg === 'global' && r.source === 'game' && r.n > 0)
            && perFonte.some((r) => r.reg === 'japan' && r.source === 'mirror' && r.n > 0)
            && ['global', 'japan'].every((g) => perFonte.some((r) => r.reg === g && r.source === 'wiki' && r.n > 1000)),
          perFonte.map((r) => `${r.reg} ${r.source} ${r.n}`).join(', '))

    // Il riempimento si prova sul file vero, su tabelle con le colonne di
    // prima: in uno schema a parte, dentro una transazione che si annulla.
    const migrazione = readFileSync(new URL('../migrations/0036_japan_mirror.sql', import.meta.url), 'utf8')
    await db.query('begin')
    try {
      await db.query(`create schema prova_0036;
        create table prova_0036.event_run (
          id bigserial primary key, event_id bigint not null, reg public.region not null,
          starts_at timestamptz not null, ends_at timestamptz, ends_at_known boolean not null default true,
          source text not null default 'manual',
          constraint run_source check (source in ('wiki', 'manual', 'game')));
        create table prova_0036.card (id bigint primary key, wiki_title text, imported_from public.data_source not null);
        create table prova_0036.card_release (card_id bigint references prova_0036.card, reg public.region not null,
          released_at date, primary key (card_id, reg));
        insert into prova_0036.card values (1, 'Una pagina', 'wiki'), (2, 'Una pagina, corretta dal gioco', 'datamine'),
                                           (3, null, 'datamine'), (4, null, 'manual');
        insert into prova_0036.card_release values (1, 'japan', '2020-01-01'), (1, 'global', '2020-06-01'),
          (2, 'global', '2021-01-01'), (3, 'global', '2026-09-01'), (3, 'japan', '2026-09-01'), (4, 'japan', '2026-01-15');
        set local search_path = prova_0036, public`)
      await db.query(migrazione)
      const r = await righe(`select card_id::int as c, reg::text, source from prova_0036.card_release order by 1, 2`)
      check('riempimento: pagina del wiki -> wiki, solo gioco -> game su Global e manual su Japan, il resto manual',
            r.map((x) => `${x.c} ${x.reg} ${x.source}`).join(', ')
              === '1 global wiki, 1 japan wiki, 2 global wiki, 3 global game, 3 japan manual, 4 japan manual', JSON.stringify(r))
    } finally {
      await db.query('rollback')
    }
  })

  // Le finestre Global del gioco e quelle a mano (set-event-window --reg
  // global): la fixture ne ha una da D (5001, 200 giorni fa) che non tocca
  // la run Japan a mano, e una che la tocca e si salta.
  await sezione('ogni finestra Global del gioco (o a mano) da D ha la sua copia, identica', async () => {
    const globali = await righe(`
      select g.event_id::text, g.starts_at, g.ends_at, g.ends_at_known, g.source,
             (select count(*)::int from event_run m where m.event_id = g.event_id and m.reg = 'japan' and m.source = 'mirror'
                and m.starts_at = g.starts_at and m.ends_at is not distinct from g.ends_at
                and m.ends_at_known = g.ends_at_known) as copie,
             exists (select 1 from event_run x where x.event_id = g.event_id and x.reg = 'japan' and x.source = 'manual'
                       and (tstzrange(x.starts_at, coalesce(x.ends_at, 'infinity'))
                              && tstzrange(g.starts_at, coalesce(g.ends_at, 'infinity'))
                            or abs(extract(epoch from x.starts_at - g.starts_at)) <= 2 * 86400)) as tocca_a_mano
      from event_run g where g.reg = 'global' and g.source in ('game', 'manual') and g.starts_at >= $1::timestamptz`, [D])
    // Le eccezioni scritte a mano (rules.mjs: globalOnly, skipWindows) non
    // si copiano: escono dal conto, e le loro finestre non hanno copie.
    // Cosi' aggiungerne una non chiede di riscrivere questa verifica.
    // Lo stesso per le finestre che toccano una run Japan a mano: vince lei.
    const eccezione = (g: Riga) => RULES.globalOnly.some((x) => String(x.event) === g.event_id)
      || RULES.skipWindows.some((x) => String(x.event) === g.event_id && Math.abs(Date.parse(x.start) - g.starts_at.getTime()) <= TOL)
      || g.tocca_a_mano
    const attese = globali.filter((g) => !eccezione(g))
    const escluse = globali.filter(eccezione)
    check('piu\' di 200 finestre Global da D, tolte le eccezioni delle regole', attese.length > 200,
          `${attese.length}, eccezioni ${escluse.length}`)
    tutte('ognuna ha una copia Japan con lo stesso inizio, la stessa fine e la stessa fine nota', attese, (g) => g.copie === 1)
    if (escluse.length) tutte('...e le finestre delle eccezioni nessuna', escluse, (g) => g.copie === 0)
    const aMano = attese.filter((g) => g.source === 'manual')
    tutte('...anche quelle a mano (5001 nella fixture), con la copia identica', aMano, (g) => g.copie === 1)
    const copie = await righe(`
      select m.id::text, m.event_id::text, m.starts_at,
             exists (select 1 from event_run g where g.event_id = m.event_id and g.reg = 'global' and g.source in ('game', 'manual')
                       and g.starts_at = m.starts_at and g.ends_at is not distinct from m.ends_at
                       and g.ends_at_known = m.ends_at_known) as ha_globale
      from event_run m where m.reg = 'japan' and m.source = 'mirror'`)
    tutte('...e ogni copia ha la sua finestra Global (nessuna copia di troppo)', copie, (m) => m.ha_globale)
    check('nessuna copia prima di D', copie.every((m) => m.starts_at.getTime() >= Date.parse(D)),
          `${copie.filter((m) => m.starts_at.getTime() < Date.parse(D)).length}`)
    const prima = Number(await valore(`select count(*) from event_run where reg = 'global' and source = 'game'
                                       and starts_at < $1::timestamptz and starts_at >= $1::timestamptz - interval '10 days'`, [D]))
    check('le finestre Global dei giorni prima di D ci sono, e non si copiano (la rimessa in lista del 2024-12-27)', prima > 100, `${prima}`)
    const chiuse = await righe(`
      select w.id::text, exists (select 1 from event_run m where m.event_id = w.event_id and m.reg = 'japan'
                                   and m.source = 'mirror' and m.starts_at = w.ends_at) as alla_copia
      from event_run w where w.reg = 'japan' and w.source = 'wiki' and w.ends_at is not null`)
    tutte('ogni run Japan del wiki chiusa finisce dove comincia una copia, con la fine non nota', chiuse, (w) => w.alla_copia)
    check('nessuna run del gioco su Japan', Number(await valore(`select count(*) from event_run where reg = 'japan' and source = 'game'`)) === 0)
  })

  await sezione('le uscite Japan delle carte', async () => {
    const uscite = await righe(`
      select g.card_id::text, g.released_at::text as glb, g.source as gs, j.released_at::text as jp, j.source
      from card_release g left join card_release j on j.card_id = g.card_id and j.reg = 'japan'
      where g.reg = 'global' and g.released_at >= '2025-01-01'`)
    // le carte solo Global delle regole (globalOnlyCards) restano senza
    const soloGlobal = new Set(RULES.globalOnlyCards.map((c) => String(c.card)))
    tutte('ogni carta uscita su Global da D ha anche un\'uscita Japan (tolte quelle solo Global delle regole)',
          uscite.filter((u) => !soloGlobal.has(u.card_id)), (u) => u.jp !== null)
    const copiate = uscite.filter((u) => u.source === 'mirror')
    check('dallo specchio le carte del gioco senza pagina (45 del 2026 e una del 2025)', copiate.length >= 40, `${copiate.length}`)
    // il giorno giapponese: per le carte del gioco quello di open_at (dalle
    // 15:00 UTC il giorno dopo), per le altre il giorno Global
    const giornoJp = (u: Riga) => {
      const t = u.gs === 'game' ? aperte.get(u.card_id) : undefined
      return t && t.slice(0, 10) === u.glb ? japanDay(istante(t)) : u.glb
    }
    tutte('una copia ha la data Global, sul calendario giapponese', copiate, (u) => u.jp === giornoJp(u))
    const vecchie = Number(await valore(`
      select count(*) from card_release j join card_release g on g.card_id = j.card_id and g.reg = 'global'
      where j.reg = 'japan' and j.source = 'mirror' and g.released_at < '2025-01-01'`))
    check('nessuna copia per una carta uscita su Global prima di D', vecchie === 0, `${vecchie}`)
    const soloGl = Number(await valore(`
      select count(*) from card_release g where g.reg = 'global' and g.released_at < '2025-01-01'
        and not exists (select 1 from card_release j where j.card_id = g.card_id and j.reg = 'japan')`))
    check('le carte solo Global di prima di D restano senza data Japan', soloGl > 0, `${soloGl}`)

    // la precedenza: un'uscita Japan del wiki (o a mano) non si tocca
    const c = copiate[0]
    if (!check('c\'e\' una carta con l\'uscita Japan copiata', !!c)) return
    try {
      // come la scrive load-cards il giorno che il wiki dice la data Japan
      await db.query(`update card_release set source = 'wiki', released_at = released_at + 3 where card_id = $1 and reg = 'japan'`, [c.card_id])
      const out = lancia('mirror-japan.mjs')
      const r = (await righe(`select released_at::text as d, source from card_release where card_id = $1 and reg = 'japan'`, [c.card_id]))[0]
      check('la data Japan del wiki resta, diversa da quella Global', r?.source === 'wiki' && r.d !== c.glb
              && /nuove dallo specchio\s+0\n\s+aggiornate\s+0\n/.test(out.slice(out.indexOf('uscite Japan delle carte'))), JSON.stringify(r))
      await db.query(`update card_release set source = 'mirror' where card_id = $1 and reg = 'japan'`, [c.card_id])
      lancia('mirror-japan.mjs')
      check('una copia con la data sbagliata si aggiorna', (await valore(`
        select released_at::text from card_release where card_id = $1 and reg = 'japan'`, [c.card_id])) === c.glb)
      // l'uscita Global che va prima di D: la copia si toglie
      await db.query(`update card_release set released_at = '2024-12-20' where card_id = $1 and reg = 'global'`, [c.card_id])
      const via = lancia('mirror-japan.mjs')
      check('l\'uscita Global prima di D: la copia si toglie', conta(via.slice(via.indexOf('uscite Japan delle carte')), 'tolte, la regola non le vuole piu\'') === 1
              && Number(await valore(`select count(*) from card_release where card_id = $1 and reg = 'japan'`, [c.card_id])) === 0)
    } finally {
      await db.query(`update card_release set released_at = $2 where card_id = $1 and reg = 'global'`, [c.card_id, c.glb])
      lancia('mirror-japan.mjs')
    }
    const r = (await righe(`select released_at::text as d, source from card_release where card_id = $1 and reg = 'japan'`, [c.card_id]))[0]
    check('rimessa: di nuovo la copia con la data Global', r?.source === 'mirror' && r.d === c.glb, JSON.stringify(r))
  })

  // Una carta che solo il gioco conosce, uscita su Global dalle 15:00 UTC:
  // a Tokyo e' gia' il giorno dopo. Oggi non ce n'e' (le 46 copiate escono
  // prima), quindi si mette in scena con una carta del wiki uscita a
  // quell'ora (il lotto del decimo anniversario giapponese, 2025-01-28 alle
  // 21:00 UTC, sul wiki JP 29 Jan 2025): come se non avesse la pagina, con
  // l'uscita Global che le darebbe load-game-cards (il giorno UTC di
  // open_at) e senza quella Japan.
  await sezione('una carta del gioco uscita dalle 15:00 UTC: il giorno giapponese', async () => {
    const tardi = [...aperte].filter(([, t]) => Date.parse(istante(t)) >= Date.parse(D) && japanDay(istante(t)) !== t.slice(0, 10))
    const [t] = await righe(`
      select g.card_id::text, g.released_at::text as glb, g.source as gs, j.released_at::text as jp, j.source as js
      from card_release g join card_release j on j.card_id = g.card_id and j.reg = 'japan'
      where g.reg = 'global' and g.source = 'wiki' and j.source = 'wiki' and g.card_id = any($1::bigint[])
      order by g.card_id limit 1`, [tardi.map(([id]) => id)])
    if (!check('una carta del wiki uscita su Global da D, dalle 15:00 UTC', !!t)) return
    const open = aperte.get(t.card_id) ?? ''
    const utc = open.slice(0, 10), tokyo = japanDay(istante(open))
    try {
      await db.query(`update card_release set source = 'game', released_at = $2 where card_id = $1 and reg = 'global'`, [t.card_id, utc])
      await db.query(`delete from card_release where card_id = $1 and reg = 'japan'`, [t.card_id])
      const out = lancia('mirror-japan.mjs')
      const r = (await righe(`select released_at::text as d, source from card_release where card_id = $1 and reg = 'japan'`, [t.card_id]))[0]
      check(`open_at ${open} UTC: l'uscita Japan copiata e' il ${tokyo}, non il ${utc}`, r?.source === 'mirror' && r.d === tokyo
              && tokyo !== utc && out.includes(`${t.card_id}: Global ${utc}, Japan ${tokyo}`), JSON.stringify(r))
      const di = lancia('mirror-japan.mjs')
      check('...e il giro dopo la lascia com\'e\'', /uscite Japan delle carte[\s\S]*?aggiornate\s+0\n/.test(di)
              && (await valore(`select released_at::text from card_release where card_id = $1 and reg = 'japan'`, [t.card_id])) === tokyo)
    } finally {
      await db.query(`update card_release set source = $2, released_at = $3 where card_id = $1 and reg = 'global'`, [t.card_id, t.gs, t.glb])
      await db.query(`insert into card_release (card_id, reg, released_at, source) values ($1, 'japan', $2, $3)
                      on conflict (card_id, reg) do update set released_at = excluded.released_at, source = excluded.source`, [t.card_id, t.jp, t.js])
      lancia('mirror-japan.mjs')
    }
    const r = await righe(`select reg::text, released_at::text as d, source from card_release where card_id = $1 order by reg`, [t.card_id])
    check('rimessa com\'era: le due uscite del wiki', JSON.stringify(r) === JSON.stringify([
      { reg: 'global', d: t.glb, source: t.gs }, { reg: 'japan', d: t.jp, source: t.js }]), JSON.stringify(r))
  })

  await sezione('una regola che cambia: le copie se ne vanno, la run del wiki si riapre', async () => {
    const [e] = await eventiWikiSemplici()
    if (!check('un evento del wiki con la run chiusa da una copia', !!e)) return
    const prima = await runsJp(e.ev)
    const tutteLeCopie = Number(await valore(`select count(*) from event_run where reg = 'japan' and source = 'mirror'`))
    try {
      const out = lancia('mirror-japan.mjs', ['--rules', regole('solo-global', { globalOnly: [{ event: e.ev, why: 'prova: solo Global' }] })])
      const r = await runsJp(e.ev)
      check('esclusa e detta', out.includes(`esclusa (globalOnly): ${e.ev} `), out.match(/esclusa[^\n]*/)?.[0])
      check('nessuna copia per l\'evento solo Global', !r.some((x) => x.source === 'mirror'), descrivi(r))
      check('la run del wiki si riapre, stesso id, fine non nota', r.length === 1 && r[0].id === e.wiki && r[0].ends_at === null
              && !r[0].ends_at_known && conta(out, 'del wiki riaperte \\(non comincia piu\' niente\\)') === 1, descrivi(r))
      check('le altre copie non si toccano', Number(await valore(`select count(*) from event_run where reg = 'japan' and source = 'mirror'`))
              === tutteLeCopie - 1 && conta(out, 'copie tolte, la regola non le vuole piu\'') === 1)
    } finally {
      lancia('mirror-japan.mjs')
    }
    const dopo = await runsJp(e.ev)
    check('rimessa la regola: la run del wiki si richiude (stesso id) e la copia torna',
          dopo.length === 2 && dopo[0].id === e.wiki && stesso(dopo[0].ends_at, e.starts_at) && dopo[1].source === 'mirror'
            && stesso(dopo[1].starts_at, prima[1].starts_at) && stesso(dopo[1].ends_at, prima[1].ends_at), descrivi(dopo))
  })

  await sezione('la run del wiki della stessa uscita diventa la copia, e ci ritorna', async () => {
    const e = (await eventiWikiSemplici())[1]
    if (!check('un secondo evento del wiki con la run chiusa da una copia', !!e)) return
    // il wiki dice che su Japan e' uscito il giorno (UTC) della finestra Global
    const jp = mezzanotte(e.starts_at)
    const cache = cacheCon(e.ev, jp)
    if (!check('la copia della cache con la data Japan nuova', !!cache) || !cache) return
    const env = { WIKI_EVENTS_CACHE: cache }
    try {
      // com'era prima dello specchio, con la data nuova: la run del wiki aperta
      await db.query(`delete from event_run where id = $1`, [e.copia])
      await db.query(`update event_run set starts_at = $2, ends_at = null where id = $1`, [e.wiki, jp])
      const out = lancia('mirror-japan.mjs', [], env)
      let r = await runsJp(e.ev)
      check('adottata: stesso id, ora copia, con la finestra Global', r.length === 1 && r[0].id === e.wiki && r[0].source === 'mirror'
              && stesso(r[0].starts_at, e.starts_at) && stesso(r[0].ends_at, e.ends_at) && r[0].ends_at_known
              && conta(out, 'del wiki diventate copie \\(stessa uscita\\)') === 1, descrivi(r))
      lancia('load-events.mjs', [], env)
      r = await runsJp(e.ev)
      check('load-events non ricrea la run del wiki adottata', r.length === 1 && r[0].id === e.wiki, descrivi(r))
      // la copia che finisce prima della data del wiki (una finestra corta):
      // la blocca la clausola della stessa uscita, non la sovrapposizione
      await db.query(`update event_run set starts_at = $2, ends_at = $3 where id = $1`,
                     [e.wiki, new Date(jp.getTime() - 86_400_000), new Date(jp.getTime() - 3_600_000)])
      const ev = lancia('load-events.mjs', [], env)
      r = await runsJp(e.ev)
      check('...nemmeno quando la copia finisce prima della data del wiki', r.length === 1 && /nuove 0, spostate 0/.test(ev),
            `${descrivi(r)}; ${ev.match(/ricorrenze[^\n]*/)?.[0]}`)
      lancia('mirror-japan.mjs', [], env)
      r = await runsJp(e.ev)
      check('lo specchio la rimette sulla finestra, stesso id', r.length === 1 && r[0].id === e.wiki && stesso(r[0].starts_at, e.starts_at), descrivi(r))
      // l'evento diventa solo Global: la copia torna la run del wiki, non sparisce
      const via = lancia('mirror-japan.mjs', ['--rules', regole('solo-global-2', { globalOnly: [{ event: e.ev, why: 'prova: solo Global' }] })], env)
      r = await runsJp(e.ev)
      check('non piu\' voluta: torna la run del wiki, stesso id, dalla data del wiki, aperta', r.length === 1 && r[0].id === e.wiki
              && r[0].source === 'wiki' && stesso(r[0].starts_at, jp) && r[0].ends_at === null && !r[0].ends_at_known
              && conta(via, 'copie tornate run del wiki') === 1 && conta(via, 'copie tolte, la regola non le vuole piu\'') === 0, descrivi(r))
      lancia('mirror-japan.mjs', [], env)
      r = await runsJp(e.ev)
      check('rimessa la regola: adottata di nuovo, stesso id', r.length === 1 && r[0].id === e.wiki && r[0].source === 'mirror', descrivi(r))
    } finally {
      await db.query(`delete from event_run where event_id = $1 and reg = 'japan' and id <> $2`, [e.ev, e.wiki])
      await db.query(`update event_run set source = 'wiki', starts_at = $2, ends_at = null, ends_at_known = false where id = $1`, [e.wiki, e.jp])
      lancia('load-events.mjs')
      lancia('mirror-japan.mjs')
    }
    const dopo = await runsJp(e.ev)
    check('rimessa com\'era: la run del wiki (stesso id) chiusa all\'inizio della copia',
          dopo.length === 2 && dopo[0].id === e.wiki && dopo[0].source === 'wiki' && stesso(dopo[0].starts_at, e.jp)
            && stesso(dopo[0].ends_at, e.starts_at) && dopo[1].source === 'mirror' && stesso(dopo[1].ends_at, e.ends_at), descrivi(dopo))
  })

  // Il wiki che vince, attraverso load-events come nel giro vero: prima
  // servivano due giri (load-events gira prima dello specchio, e finche' la
  // copia di prima c'e' non puo' mettere la run del wiki alla sua data).
  await sezione('una data Japan del wiki da D in poi vince, in un giro solo', async () => {
    const e = (await eventiWikiSemplici())[2]
    if (!check('un terzo evento del wiki con la run chiusa da una copia', !!e)) return
    // il wiki dice che su Japan e' uscito dieci giorni dopo la fine della finestra Global
    const jp = mezzanotte(new Date(e.ends_at.getTime() + 10 * 86_400_000))
    const cache = cacheCon(e.ev, jp)
    if (!check('la copia della cache con la data Japan nuova', !!cache) || !cache) return
    const env = { WIKI_EVENTS_CACHE: cache }
    try {
      const { eventi, specchio } = settimana(env)
      check('load-events da solo non la sposta: la copia la chiude prima della data', /nuove 0, spostate 0/.test(wikiRun(eventi)), wikiRun(eventi))
      check('il conflitto si dice', conta(specchio, 'finestre in conflitto, non copiate') === 1
              && specchio.includes(`conflitto ${e.ev} `) && specchio.includes('vince il wiki'), specchio.match(/ {6}conflitto[^\n]*/)?.[0])
      const r = await runsJp(e.ev)
      check('in un giro solo: la copia se ne va, e la run del wiki (stesso id) sta alla data del wiki, aperta, fine non nota',
            r.length === 1 && r[0].id === e.wiki && r[0].source === 'wiki' && stesso(r[0].starts_at, jp) && r[0].ends_at === null
              && !r[0].ends_at_known && conta(specchio, 'del wiki messe alla data Japan del wiki') === 1
              && conta(specchio, 'del wiki riaperte \\(non comincia piu\' niente\\)') === 0, descrivi(r))
      const f = await foto()
      const di = settimana(env)
      check('il giro dopo non cambia niente, id compresi', (await foto()) === f && /nuove 0, spostate 0/.test(wikiRun(di.eventi))
              && conta(di.specchio, 'del wiki messe alla data Japan del wiki') === 0, `${wikiRun(di.eventi)}; ${ricorrenze(di.specchio)}`)
    } finally {
      lancia('load-events.mjs')
      lancia('mirror-japan.mjs')
    }
    const dopo = await runsJp(e.ev)
    check('con la cache vera torna come prima: la run del wiki (stesso id) chiusa all\'inizio della copia',
          dopo.length === 2 && dopo[0].id === e.wiki && stesso(dopo[0].starts_at, e.jp) && stesso(dopo[0].ends_at, e.starts_at)
            && dopo[1].source === 'mirror' && stesso(dopo[1].starts_at, e.starts_at), descrivi(dopo))
  })

  // Un evento del wiki la cui sola run Japan e' una copia aperta, e una data
  // Japan che il wiki aggiunge dopo l'inizio della copia: load-events non
  // puo' creare la run (la copia si sovrappone), e senza il passo del wiki
  // l'evento restava una settimana senza run Japan.
  const soloCopia = await righe(`
    select e.id::int as ev, m.id::text as copia, m.starts_at,
           (select t.id::text from stage_tier t where t.event_id = e.id order by t.id limit 1) as tier
    from event e join event_run m on m.event_id = e.id and m.reg = 'japan' and m.source = 'mirror' and m.ends_at is null
    where e.imported_from = 'wiki' and m.starts_at < now() - interval '30 days'
      and (select count(*) from event_run x where x.event_id = e.id and x.reg = 'japan') = 1
      and exists (select 1 from stage_tier t where t.event_id = e.id)
      and not exists (select 1 from clear c join event_run x on x.id = c.run_id where x.event_id = e.id)
    order by e.id`)
  const pagine = new Map((JSON.parse(readFileSync(CACHE, 'utf8')).pages as Riga[]).map((p) => [p.pageid, p.wikitext]))
  const senzaData = soloCopia.filter((x) => !wikiJapanRelease(pagine.get(x.ev)))
  const datoA = (x: Riga) => mezzanotte(new Date(x.starts_at.getTime() + 12 * 86_400_000))
  const copiaDiNuovo = async (x: Riga, nome: string) => {
    const r = await runsJp(x.ev)
    check(nome, r.length === 1 && r[0].source === 'mirror' && stesso(r[0].starts_at, x.starts_at) && r[0].ends_at === null, descrivi(r))
    return r[0]?.id as string | undefined
  }

  await sezione('una data Japan del wiki dopo una copia aperta: la copia diventa la run del wiki', async () => {
    const x = senzaData[0]
    if (!check('un evento del wiki senza data Japan, con la sola copia aperta', !!x)) return
    const jp = datoA(x)
    const cache = cacheCon(x.ev, jp)
    if (!check('la copia della cache con una data Japan dodici giorni dopo la copia', !!cache) || !cache) return
    const env = { WIKI_EVENTS_CACHE: cache }
    try {
      const { eventi, specchio } = settimana(env)
      check('load-events non la puo\' creare: la copia aperta si sovrappone alla data', /nuove 0, spostate 0/.test(wikiRun(eventi)), wikiRun(eventi))
      const r = await runsJp(x.ev)
      check('in un giro solo: la copia diventa la run del wiki (stesso id) alla data del wiki, aperta, fine non nota',
            r.length === 1 && r[0].id === x.copia && r[0].source === 'wiki' && stesso(r[0].starts_at, jp) && r[0].ends_at === null
              && !r[0].ends_at_known && conta(specchio, 'del wiki messe alla data Japan del wiki') === 1
              && conta(specchio, 'copie tolte, la regola non le vuole piu\'') === 0 && specchio.includes(`conflitto ${x.ev} `), descrivi(r))
      const f = await foto()
      const di = settimana(env)
      check('il giro dopo non cambia niente, id compresi', (await foto()) === f && /nuove 0, spostate 0/.test(wikiRun(di.eventi)),
            `${wikiRun(di.eventi)}; ${ricorrenze(di.specchio)}`)
    } finally {
      lancia('load-events.mjs')
      lancia('mirror-japan.mjs')
    }
    await copiaDiNuovo(x, 'con la cache vera torna la copia aperta (la run del wiki, senza data, se ne va)')
  })

  await sezione('una data Japan del wiki dentro una copia con clear Japan', async () => {
    const x = senzaData[1]
    if (!check('un secondo evento del wiki senza data Japan, con la sola copia aperta', !!x)) return
    const jp = datoA(x)
    const cache = cacheCon(x.ev, jp)
    if (!check('la copia della cache con una data Japan dodici giorni dopo la copia', !!cache) || !cache) return
    const env = { WIKI_EVENTS_CACHE: cache }
    let clear = ''
    let copia = x.copia as string
    try {
      // un clear di oggi, quindi dopo la data del wiki: la copia si chiude
      // alla data, e le righe si scambiano (il clear resta nella sua corsa)
      clear = await valore(`insert into clear (author_id, run_id, stage_tier_id, event_id) values ($1, $2, $3, $4)
                            returning id::text`, [AUTORE, copia, x.tier, x.ev])
      const { specchio } = settimana(env)
      let r = await runsJp(x.ev)
      check('i clear dopo la data: la riga della copia diventa la run del wiki alla data (stesso id), aperta',
            r.length === 1 && r[0].id === copia && r[0].source === 'wiki' && stesso(r[0].starts_at, jp) && r[0].ends_at === null
              && conta(specchio, 'scambiate per tenere i clear nella loro corsa') === 1
              && specchio.includes(`la run ${copia} diventa la run del wiki alla sua data`), descrivi(r))
      check('...il clear punta alla stessa run, e sta dentro la sua corsa', Number(await valore(`
        select count(*) from clear c join event_run x on x.id = c.run_id
        where c.id = $1 and x.id = $2 and c.created_at >= x.starts_at and c.created_at < coalesce(x.ends_at, 'infinity')`,
        [clear, copia])) === 1 && !/clear Japan scritti fuori/.test(specchio))
      let f = await foto()
      let di = settimana(env)
      check('...il giro dopo non cambia niente, id compresi', (await foto()) === f
              && conta(di.specchio, 'scambiate per tenere i clear nella loro corsa') === 0, ricorrenze(di.specchio))

      // si rimette la copia, e il clear va prima della data del wiki: la
      // copia si chiude alla data e resta per il clear, la run del wiki parte li'
      await db.query(`delete from clear where id = $1`, [clear])
      clear = ''
      lancia('load-events.mjs')
      lancia('mirror-japan.mjs')
      copia = (await copiaDiNuovo(x, 'senza clear, con la cache vera: di nuovo la copia aperta')) ?? ''
      clear = await valore(`insert into clear (author_id, run_id, stage_tier_id, event_id, created_at) values ($1, $2, $3, $4, $5)
                            returning id::text`, [AUTORE, copia, x.tier, x.ev, new Date(x.starts_at.getTime() + 86_400_000)])
      const due = settimana(env)
      r = await runsJp(x.ev)
      check('il clear prima della data: la copia (stesso id) si chiude alla data del wiki, fine non nota, e la run del wiki parte li\'',
            r.length === 2 && r[0].id === copia && r[0].source === 'mirror' && stesso(r[0].ends_at, jp) && !r[0].ends_at_known
              && r[1].source === 'wiki' && stesso(r[1].starts_at, jp) && r[1].ends_at === null
              && conta(due.specchio, 'copie con clear chiuse prima di un\'altra run') === 1
              && conta(due.specchio, 'scambiate per tenere i clear nella loro corsa') === 0, descrivi(r))
      f = await foto()
      di = settimana(env)
      check('...il giro dopo non cambia niente, e la copia resta per il clear ("  tengo la run")', (await foto()) === f
              && new RegExp(`^  tengo la run ${copia} \\(evento ${x.ev}, japan\\)`, 'm').test(di.specchio), di.specchio.match(/^ {2}tengo[^\n]*/m)?.[0])
    } finally {
      if (clear) await db.query(`delete from clear where id = $1`, [clear])
      lancia('load-events.mjs')
      lancia('mirror-japan.mjs')
    }
    await copiaDiNuovo(x, 'tolto il clear, con la cache vera: di nuovo la copia aperta')
  })

  await sezione('una finestra a mano vince sullo specchio', async () => {
    const [e] = await righe(`
      select e.id::text as ev, m.id::text, m.starts_at, m.ends_at, m.ends_at_known from event e
      join event_run m on m.event_id = e.id and m.reg = 'japan' and m.source = 'mirror'
      where e.imported_from = 'datamine' and m.ends_at > m.starts_at + interval '4 days'
        and (select count(*) from event_run x where x.event_id = e.id and x.reg = 'japan') = 1
        and not exists (select 1 from clear c where c.run_id = m.id)
      order by e.id limit 1`)
    if (!check('un evento del gioco con una sola copia lunga piu\' di quattro giorni', !!e)) return
    const al = e.ends_at.toISOString()
    let manuale = ''
    try {
      // qualche ora dopo la data Global: e' la stessa uscita
      const dal = new Date(e.starts_at.getTime() + 5 * 3_600_000).toISOString()
      const out = lancia('set-event-window.mjs', ['--evento', e.ev, '--reg', 'japan', '--dal', dal, '--al', al])
      let r = await runsJp(e.ev)
      manuale = r.find((x) => x.source === 'manual')?.id ?? ''
      check('set-event-window: la copia della stessa uscita diventa la run a mano sul posto (stesso id)',
            r.length === 1 && r[0].id === e.id && r[0].source === 'manual' && stesso(r[0].starts_at, dal)
              && out.includes(`la run ${e.id} (mirror`), descrivi(r))
      const imp = lancia('mirror-japan.mjs')
      r = await runsJp(e.ev)
      check('lo specchio salta la finestra e lo dice', conta(imp, 'saltate, c\'e\' una finestra a mano') === saltateDiBase + 1
              && imp.includes(`tocca la run a mano ${e.id}`), imp.match(/ {6}\d+[^\n]*tocca la run a mano[^\n]*/)?.[0])
      check('la run a mano e\' intatta, e nessuna copia le si sovrappone', r.length === 1 && r[0].source === 'manual'
              && stesso(r[0].starts_at, dal), descrivi(r))
      // tolta la run a mano, la copia torna (con un id nuovo)
      await db.query(`delete from event_run where id = $1`, [manuale])
      manuale = ''
      lancia('mirror-japan.mjs')
      // tre giorni dopo: e' un'altra corsa, la copia si chiude al --dal
      const [m] = await runsJp(e.ev)
      const dal2 = new Date(e.starts_at.getTime() + 3 * 86_400_000).toISOString()
      const out2 = lancia('set-event-window.mjs', ['--evento', e.ev, '--reg', 'japan', '--dal', dal2, '--al', al])
      r = await runsJp(e.ev)
      manuale = r.find((x) => x.source === 'manual')?.id ?? ''
      check('tre giorni dopo: la copia si chiude al --dal, con la fine non nota', r.length === 2 && r[0].id === m?.id
              && r[0].source === 'mirror' && stesso(r[0].ends_at, dal2) && !r[0].ends_at_known
              && out2.includes(`chiusa al --dal la run ${m?.id} (mirror`), descrivi(r))
      const imp2 = lancia('mirror-japan.mjs')
      const r2 = await runsJp(e.ev)
      check('lo specchio la lascia com\'e\': ne\' tolta ne\' girata, e salta la finestra',
            JSON.stringify(r2) === JSON.stringify(r) && conta(imp2, 'saltate, c\'e\' una finestra a mano') === saltateDiBase + 1
              && conta(imp2, 'copie lasciate com\'erano \\(a mano, conflitto\\)') === 1, descrivi(r2))
      await db.query(`delete from event_run where id = $1`, [manuale])
      manuale = ''
      lancia('mirror-japan.mjs')
      const r3 = await runsJp(e.ev)
      check('tolta la run a mano, la copia si riapre sulla finestra Global, stesso id', r3.length === 1 && r3[0].id === m?.id
              && stesso(r3[0].starts_at, e.starts_at) && stesso(r3[0].ends_at, e.ends_at) && r3[0].ends_at_known, descrivi(r3))
    } finally {
      if (manuale) await db.query(`delete from event_run where id = $1`, [manuale])
      lancia('mirror-japan.mjs')
    }
  })

  await sezione('una copia con un clear Japan resta, e lo specchio lo dice', async () => {
    const [e] = await righe(`
      select e.id::text as ev, m.id::text, m.starts_at, m.ends_at,
             (select t.id::text from stage_tier t where t.event_id = e.id order by t.id limit 1) as tier
      from event e join event_run m on m.event_id = e.id and m.reg = 'japan' and m.source = 'mirror'
      where e.imported_from = 'datamine'
        and (select count(*) from event_run x where x.event_id = e.id and x.reg = 'japan') = 1
        and exists (select 1 from stage_tier t where t.event_id = e.id)
      order by e.id offset 1 limit 1`)
    if (!check('un evento del gioco con una copia e una difficolta\'', !!e)) return
    let clear = ''
    try {
      clear = await valore(`insert into clear (author_id, run_id, stage_tier_id, event_id) values ($1, $2, $3, $4)
                            returning id::text`, [AUTORE, e.id, e.tier, e.ev])
      const out = lancia('mirror-japan.mjs', ['--rules', regole('solo-global-3', { globalOnly: [{ event: Number(e.ev), why: 'prova: solo Global' }] })])
      const r = await runsJp(e.ev)
      check('la copia resta, intatta', r.length === 1 && r[0].id === e.id && r[0].source === 'mirror' && stesso(r[0].starts_at, e.starts_at), descrivi(r))
      check('una riga "  tengo la run", quella che conta il giro settimanale',
            new RegExp(`^  tengo la run ${e.id} \\(evento ${e.ev}, japan\\)`, 'm').test(out)
              && (out.match(/^ {2}tengo /gm) ?? []).length === 1, out.match(/^ {2}tengo[^\n]*/m)?.[0])
      const di = lancia('mirror-japan.mjs')
      const r2 = await runsJp(e.ev)
      check('rimessa la regola: la stessa copia, invariata', r2.length === 1 && r2[0].id === e.id
              && !/^ {2}tengo /m.test(di), descrivi(r2))
    } finally {
      if (clear) await db.query(`delete from clear where id = $1`, [clear])
    }
  })

  // Il builder ("When you cleared it") lascia attaccare un clear a una run
  // qualunque gia' cominciata, anche a una run del wiki chiusa da anni: il
  // clear (created_at di oggi) resta fuori dalla sua corsa, sulla corsa che
  // si e' scelta. 612048: la run del wiki del 2020 chiusa all'inizio della
  // prima copia (luglio 2025), e una seconda copia aperta, in corso, senza
  // clear. Lo scambio guardava ogni run chiusa con la fine non nota a ogni
  // giro, e portava la riga scelta nella copia in corso: la run del 2020
  // tornava con un id nuovo e senza il clear, e il giro non lo diceva piu'.
  // Ora scambia solo le righe che il piano ha appena chiuso lasciando fuori
  // dei clear della loro corsa.
  await sezione('un clear di oggi su una run del wiki gia\' chiusa, scelta nel builder: niente scambio', async () => {
    const [e] = await righe(`
      select e.id::text as ev, w.id::text as wiki,
             (select t.id::text from stage_tier t where t.event_id = e.id order by t.id limit 1) as tier
      from event e
      join event_run w on w.event_id = e.id and w.reg = 'japan' and w.source = 'wiki' and w.ends_at is not null and not w.ends_at_known
      join event_run m on m.event_id = e.id and m.reg = 'japan' and m.source = 'mirror' and m.starts_at = w.ends_at
      join event_run g on g.event_id = e.id and g.reg = 'japan' and g.source = 'mirror' and g.starts_at > m.starts_at
                      and g.starts_at <= now() - interval '1 day' and (g.ends_at is null or g.ends_at > now() + interval '1 day')
      where e.imported_from = 'wiki' and exists (select 1 from stage_tier t where t.event_id = e.id)
        and not exists (select 1 from clear c join event_run x on x.id = c.run_id where x.event_id = e.id)
      order by (e.id = 612048) desc, e.id limit 1`)
    if (!check('un evento del wiki con la run chiusa dalla prima copia e una copia dopo in corso (612048)', !!e, e?.ev)) return
    let clear = ''
    try {
      const prima = await runsJp(e.ev)
      // created_at per difetto: now(), dentro la copia in corso
      clear = await valore(`insert into clear (author_id, run_id, stage_tier_id, event_id) values ($1, $2, $3, $4)
                            returning id::text`, [AUTORE, e.wiki, e.tier, e.ev])
      const { eventi, specchio } = settimana({})
      const r = await runsJp(e.ev)
      check('load-events, load-windows e lo specchio non scambiano niente: le run dell\'evento identiche, id compresi',
            JSON.stringify(r) === JSON.stringify(prima) && conta(specchio, 'scambiate per tenere i clear nella loro corsa') === 0,
            `${descrivi(r)}; ${ricorrenze(specchio)}; ${wikiRun(eventi)}`)
      check('il clear resta sulla run scelta, fuori dalla sua corsa, e il giro lo dice',
            Number(await valore(`select count(*) from clear where id = $1 and run_id = $2`, [clear, e.wiki])) === 1
              && conta(specchio, 'clear Japan scritti fuori dalla loro run') === 1
              && !new RegExp(`^  tengo la run ${e.wiki} `, 'm').test(specchio), specchio.match(/clear Japan scritti fuori[^\n]*/)?.[0])
      const di = settimana({})
      check('...e il giro dopo lo stesso', JSON.stringify(await runsJp(e.ev)) === JSON.stringify(prima)
              && conta(di.specchio, 'scambiate per tenere i clear nella loro corsa') === 0)
    } finally {
      if (clear) await db.query(`delete from clear where id = $1`, [clear])
    }
  })

  // Tre eventi del wiki con la forma semplice, diversi da quelli dei casi
  // sopra, con la copia che parte dopo la mezzanotte UTC (il giorno della
  // copia, a mezzanotte, e' prima del suo inizio) e una difficolta' per un clear.
  const semplici = (await eventiWikiSemplici()).slice(3).filter((x) => x.starts_at.getUTCHours() > 0)
  const tierDi = (ev: number) => valore(`select id::text from stage_tier where event_id = $1 order by id limit 1`, [ev])

  // 88853: la data Japan del wiki passa da 1 Apr 2017 a 16 Oct 2025, il
  // giorno della finestra Global delle 05:00. load-events sposta la run del
  // wiki alla data, e la copia che c'e' gia' la chiude cinque ore dopo:
  // restava un pezzetto di run del wiki per sempre, dove un import da zero
  // ha una run sola (la run del wiki adottata). Lo specchio le riunisce.
  await sezione('la data Japan del wiki arriva al giorno di una copia che c\'e\' gia\': una run sola', async () => {
    const e = semplici[0]
    if (!check('un evento del wiki con la run chiusa da una copia che parte dopo la mezzanotte UTC', !!e)) return
    const jp = mezzanotte(e.starts_at)
    const cache = cacheCon(e.ev, jp)
    if (!check('la copia della cache con la data Japan al giorno della copia', !!cache) || !cache) return
    const env = { WIKI_EVENTS_CACHE: cache }
    try {
      const { eventi, specchio } = settimana(env)
      check('load-events sposta la run del wiki alla data, e la copia la chiude poche ore dopo', /nuove 0, spostate 1,/.test(wikiRun(eventi)),
            wikiRun(eventi))
      const r = await runsJp(e.ev)
      check('nello stesso giro una run sola: la run del wiki (stesso id) prende la finestra, la copia di prima se ne va',
            r.length === 1 && r[0].id === e.wiki && r[0].source === 'mirror' && stesso(r[0].starts_at, e.starts_at)
              && stesso(r[0].ends_at, e.ends_at) && r[0].ends_at_known
              && conta(specchio, 'di cui al posto della copia che c\'era') === 1
              && conta(specchio, 'copie tolte, la regola non le vuole piu\'') === 0, descrivi(r))
      const f = await foto()
      const di = settimana(env)
      check('...il giro dopo non cambia niente, id compresi', (await foto()) === f && /nuove 0, spostate 0/.test(wikiRun(di.eventi)),
            `${wikiRun(di.eventi)}; ${ricorrenze(di.specchio)}`)
    } finally {
      settimana({})
    }
    // la data vera, prima di D: la run del wiki rinasce (la copia tiene l'id
    // che era della run del wiki: e' la riga dei clear della finestra)
    const dopo = await runsJp(e.ev)
    check('con la cache vera torna come prima: la run del wiki alla sua data, chiusa all\'inizio della copia, e la copia',
          dopo.length === 2 && dopo[0].source === 'wiki' && stesso(dopo[0].starts_at, e.jp) && stesso(dopo[0].ends_at, e.starts_at)
            && !dopo[0].ends_at_known && dopo[1].id === e.wiki && dopo[1].source === 'mirror' && stesso(dopo[1].ends_at, e.ends_at), descrivi(dopo))
  })

  // 88853 dopo l'adozione (la run del wiki e' la copia), e la data del wiki
  // che torna a 1 Apr 2017: load-events non puo' creare la run del wiki (la
  // copia si sovrappone a [data, infinito)), e lo specchio guardava solo le
  // date da D. La run Japan del 2017 si perdeva per sempre.
  await sezione('dopo un\'adozione la data Japan del wiki torna prima di D: la run del wiki rinasce', async () => {
    const e = semplici[1]
    if (!check('un secondo evento del wiki con la run chiusa da una copia', !!e)) return
    const jp = mezzanotte(e.starts_at)
    const cache = cacheCon(e.ev, jp)
    if (!check('la copia della cache con la data Japan al giorno della copia', !!cache) || !cache) return
    try {
      // com'e' dopo un import da zero con la data nuova: la run del wiki adottata
      await db.query(`delete from event_run where id = $1`, [e.copia])
      await db.query(`update event_run set starts_at = $2, ends_at = null where id = $1`, [e.wiki, jp])
      lancia('mirror-japan.mjs', [], { WIKI_EVENTS_CACHE: cache })
      let r = await runsJp(e.ev)
      if (!check('adottata: la sola run Japan e\' la copia, con l\'id della run del wiki',
                 r.length === 1 && r[0].id === e.wiki && r[0].source === 'mirror', descrivi(r))) return
      const { eventi, specchio } = settimana({})
      check('load-events non la puo\' creare: la copia si sovrappone a [data, infinito)', /nuove 0, spostate 0/.test(wikiRun(eventi)),
            wikiRun(eventi))
      r = await runsJp(e.ev)
      check('nello stesso giro la run del wiki rinasce alla sua data, chiusa all\'inizio della copia, fine non nota; la copia resta (stesso id)',
            r.length === 2 && r[0].source === 'wiki' && stesso(r[0].starts_at, e.jp) && stesso(r[0].ends_at, e.starts_at) && !r[0].ends_at_known
              && r[1].id === e.wiki && r[1].source === 'mirror' && stesso(r[1].starts_at, e.starts_at) && stesso(r[1].ends_at, e.ends_at)
              && conta(specchio, 'del wiki messe alla data Japan del wiki') === 1, descrivi(r))
      const f = await foto()
      const di = settimana({})
      check('...il giro dopo non cambia niente, id compresi', (await foto()) === f, `${wikiRun(di.eventi)}; ${ricorrenze(di.specchio)}`)
    } finally {
      settimana({})
    }
  })

  // 707351: un conflitto "vince il wiki" (una data Japan del 2025 dopo la
  // copia) mette la run del wiki a quella data; la copia ha un clear e
  // resta. Poi il wiki torna alla data vera (31 May 2021): load-events non
  // la puo' spostare, la copia si sovrappone, e la run restava aperta al
  // 2025 per sempre (l'evento in corso su Japan).
  await sezione('una data Japan del wiki che vince e poi torna prima di D: la run del wiki non resta aperta', async () => {
    const e = semplici[2]
    const tier = e ? await tierDi(e.ev) : null
    if (!check('un terzo evento del wiki con la run chiusa da una copia, e una difficolta\'', !!e && !!tier)) return
    const jp = mezzanotte(new Date(e.ends_at.getTime() + 18 * 86_400_000))
    const cache = cacheCon(e.ev, jp)
    if (!check('la copia della cache con una data Japan diciotto giorni dopo la copia', !!cache) || !cache) return
    let clear = ''
    try {
      clear = await valore(`insert into clear (author_id, run_id, stage_tier_id, event_id, created_at) values ($1, $2, $3, $4, $5)
                            returning id::text`, [AUTORE, e.copia, tier, e.ev, new Date(e.starts_at.getTime() + 3_600_000)])
      const uno = settimana({ WIKI_EVENTS_CACHE: cache })
      let r = await runsJp(e.ev)
      check('vince il wiki: la run del wiki (stesso id) alla data, aperta; la copia resta per il clear',
            r.length === 2 && r[0].id === e.copia && r[0].source === 'mirror' && r[1].id === e.wiki && r[1].source === 'wiki'
              && stesso(r[1].starts_at, jp) && r[1].ends_at === null
              && new RegExp(`^  tengo la run ${e.copia} \\(evento ${e.ev}, japan\\)`, 'm').test(uno.specchio), descrivi(r))
      const due = settimana({})
      check('la data vera: load-events non la puo\' spostare (la copia si sovrappone a [data, infinito))',
            /nuove 0, spostate 0/.test(wikiRun(due.eventi)), wikiRun(due.eventi))
      r = await runsJp(e.ev)
      check('nello stesso giro la run del wiki (stesso id) torna alla sua data, chiusa all\'inizio della copia, fine non nota; la copia col clear resta',
            r.length === 2 && r[0].id === e.wiki && r[0].source === 'wiki' && stesso(r[0].starts_at, e.jp) && stesso(r[0].ends_at, e.starts_at)
              && !r[0].ends_at_known && r[1].id === e.copia && r[1].source === 'mirror' && stesso(r[1].starts_at, e.starts_at)
              && stesso(r[1].ends_at, e.ends_at) && r[1].ends_at_known && !/^ {2}tengo /m.test(due.specchio), descrivi(r))
      const f = await foto()
      const di = settimana({})
      check('...il giro dopo non cambia niente, id compresi', (await foto()) === f, `${wikiRun(di.eventi)}; ${ricorrenze(di.specchio)}`)
    } finally {
      if (clear) await db.query(`delete from clear where id = $1`, [clear])
      settimana({})
    }
  })

  // set-event-window --reg global corregge una data Global: la run del
  // gioco diventa a mano sul posto, o si chiude al --dal e la segue una run
  // a mano. Lo specchio copiava solo le run del gioco: la copia Japan si
  // toglieva o restava tagliata, e la run del wiki si riapriva senza fine.
  // Ora una finestra Global a mano da D si copia come una del gioco.
  await sezione('una data Global corretta a mano (set-event-window --reg global) vale anche per Japan', async () => {
    const [e] = await righe(`
      select e.id::text as ev, g.id::text as gid, g.starts_at, g.ends_at, g.ends_at_known, m.id::text as copia
      from event e
      join event_run g on g.event_id = e.id and g.reg = 'global' and g.source = 'game' and g.starts_at >= $1::timestamptz
      join event_run m on m.event_id = e.id and m.reg = 'japan' and m.source = 'mirror' and m.starts_at = g.starts_at
      where e.imported_from = 'datamine' and g.ends_at > g.starts_at + interval '4 days' and g.ends_at_known
        and (select count(*) from event_run x where x.event_id = e.id and x.reg = 'global') = 1
        and (select count(*) from event_run x where x.event_id = e.id and x.reg = 'japan') = 1
        and not exists (select 1 from clear c where c.run_id in (g.id, m.id))
      order by e.id desc limit 1`, [D])
    if (!check('un evento del gioco con una sola corsa Global da D e la sua copia', !!e)) return
    const al = new Date(e.ends_at.getTime() + 86_400_000)
    const rimetti = () => db.query(`update event_run set source = 'game', starts_at = $2, ends_at = $3, ends_at_known = $4 where id = $1`,
                                   [e.gid, e.starts_at, e.ends_at, e.ends_at_known])
    let aMano = ''
    try {
      // la stessa corsa, con la fine corretta: la run del gioco diventa a mano sul posto
      const out = lancia('set-event-window.mjs', ['--evento', e.ev, '--reg', 'global', '--dal', e.starts_at.toISOString(), '--al', al.toISOString()])
      check('set-event-window --reg global: la run del gioco diventa la run a mano, stesso id', out.includes(`la run ${e.gid} (game`), out.slice(-200))
      const imp = lancia('mirror-japan.mjs')
      let r = await runsJp(e.ev)
      check('lo specchio la copia: la copia (stesso id) prende la fine corretta; nessuna copia tolta, nessuna run del wiki riaperta',
            r.length === 1 && r[0].id === e.copia && r[0].source === 'mirror' && stesso(r[0].starts_at, e.starts_at) && stesso(r[0].ends_at, al)
              && r[0].ends_at_known && conta(imp, 'copie aggiornate') === 1 && conta(imp, 'copie tolte, la regola non le vuole piu\'') === 0
              && conta(imp, 'del wiki riaperte \\(non comincia piu\' niente\\)') === 0, descrivi(r))
      await rimetti()
      lancia('mirror-japan.mjs')
      // tre giorni dopo: e' un'altra corsa, la run del gioco si chiude al --dal
      const dal = new Date(e.starts_at.getTime() + 3 * 86_400_000)
      lancia('set-event-window.mjs', ['--evento', e.ev, '--reg', 'global', '--dal', dal.toISOString(), '--al', al.toISOString()])
      aMano = (await valore(`select id::text from event_run where event_id = $1 and reg = 'global' and source = 'manual'`, [e.ev])) ?? ''
      const imp2 = lancia('mirror-japan.mjs')
      r = await runsJp(e.ev)
      check('chiusa al --dal e a mano dopo: la copia (stesso id) si chiude al --dal, fine non nota, e la finestra a mano ha la sua copia',
            r.length === 2 && r[0].id === e.copia && stesso(r[0].ends_at, dal) && !r[0].ends_at_known && r[1].source === 'mirror'
              && stesso(r[1].starts_at, dal) && stesso(r[1].ends_at, al) && r[1].ends_at_known
              && conta(imp2, 'nuove dallo specchio') === 1 && conta(imp2, 'copie tolte, la regola non le vuole piu\'') === 0, descrivi(r))
      const f = await foto()
      lancia('mirror-japan.mjs')
      check('...il giro dopo non cambia niente, id compresi', (await foto()) === f)
    } finally {
      if (aMano) await db.query(`delete from event_run where id = $1`, [aMano])
      await rimetti()
      lancia('mirror-japan.mjs')
    }
    const dopo = await runsJp(e.ev)
    check('rimessa la run del gioco: la copia (stesso id) di nuovo uguale', dopo.length === 1 && dopo[0].id === e.copia
            && stesso(dopo[0].ends_at, e.ends_at) && dopo[0].ends_at_known === e.ends_at_known, descrivi(dopo))
  })

  // set-event-window --reg global con il --dal dentro una finestra in corso:
  // la run del gioco si chiude al --dal (fine non nota) e la segue una run a
  // mano. La copia Japan con i clear va alla finestra chiusa (stesso inizio),
  // e la copia della run a mano nasce nuova: i clear Japan scritti dopo il
  // --dal restavano per sempre sulla copia chiusa, fuori dalla loro corsa.
  // Lo scambio di righe ora vale anche per una copia: la riga dei clear
  // prende la finestra a mano, uguale al microsecondo (il --dal ne ha), e la
  // finestra chiusa ha una copia nuova.
  await sezione('una data Global corretta a mano dentro una finestra in corso: i clear Japan restano nella loro corsa', async () => {
    const [e] = await righe(`
      select e.id::text as ev, g.id::text as gid, g.starts_at, g.ends_at, g.ends_at_known, m.id::text as copia,
             (select t.id::text from stage_tier t where t.event_id = e.id order by t.id limit 1) as tier
      from event e
      join event_run g on g.event_id = e.id and g.reg = 'global' and g.source = 'game' and g.starts_at >= $1::timestamptz
      join event_run m on m.event_id = e.id and m.reg = 'japan' and m.source = 'mirror' and m.starts_at = g.starts_at
      where e.imported_from = 'datamine' and g.ends_at > g.starts_at + interval '4 days' and g.ends_at_known
        and (select count(*) from event_run x where x.event_id = e.id and x.reg = 'global') = 1
        and (select count(*) from event_run x where x.event_id = e.id and x.reg = 'japan') = 1
        and exists (select 1 from stage_tier t where t.event_id = e.id)
        and not exists (select 1 from clear c where c.run_id in (g.id, m.id))
      order by e.id desc offset 1 limit 1`, [D])
    if (!check('un evento del gioco con una sola corsa Global da D, la sua copia e una difficolta\'', !!e)) return
    // il --dal con i microsecondi, come una run a mano scritta con now()
    const dal = new Date(e.starts_at.getTime() + 86_400_000).toISOString().replace('Z', '456Z')
    const al = new Date(e.ends_at.getTime() + 86_400_000)
    const rimetti = () => db.query(`update event_run set source = 'game', starts_at = $2, ends_at = $3, ends_at_known = $4 where id = $1`,
                                   [e.gid, e.starts_at, e.ends_at, e.ends_at_known])
    let clear = '', aMano = ''
    try {
      clear = await valore(`insert into clear (author_id, run_id, stage_tier_id, event_id, created_at) values ($1, $2, $3, $4, $5::timestamptz + interval '1 hour')
                            returning id::text`, [AUTORE, e.copia, e.tier, e.ev, dal])
      const sew = lancia('set-event-window.mjs', ['--evento', e.ev, '--reg', 'global', '--dal', dal, '--al', al.toISOString()])
      aMano = (await valore(`select id::text from event_run where event_id = $1 and reg = 'global' and source = 'manual'`, [e.ev])) ?? ''
      check('set-event-window --reg global lo dice: il clear Japan della copia e\' dopo il --dal',
            sew.includes(`attenzione: 1 clear Japan della copia ${e.copia} sono dal --dal in poi`), sew.match(/attenzione[^\n]*/g)?.join(' | ') ?? sew.slice(-300))
      const out = lancia('mirror-japan.mjs')
      const r = await runsJp(e.ev)
      const dentro = Number(await valore(`
        select count(*) from clear c join event_run x on x.id = c.run_id
        where c.id = $1 and x.id = $2 and c.created_at >= x.starts_at and c.created_at < coalesce(x.ends_at, 'infinity')`, [clear, e.copia]))
      const uguale = Number(await valore(`
        select count(*) from event_run m join event_run g on g.id = $2
        where m.id = $1 and m.source = 'mirror' and m.starts_at = g.starts_at and m.ends_at is not distinct from g.ends_at
          and m.ends_at_known = g.ends_at_known`, [e.copia, aMano]))
      check('la riga del clear (stesso id) prende la finestra a mano, uguale al microsecondo; il clear sta nella sua corsa',
            dentro === 1 && uguale === 1 && conta(out, 'scambiate per tenere i clear nella loro corsa') === 1 && !/clear Japan scritti fuori/.test(out),
            `${descrivi(r)}; ${ricorrenze(out)}`)
      check('...e la finestra chiusa al --dal ha una copia nuova, chiusa al --dal con la fine non nota',
            r.length === 2 && r[0].id !== e.copia && r[0].source === 'mirror' && stesso(r[0].starts_at, e.starts_at) && !r[0].ends_at_known
              && r[1].id === e.copia, descrivi(r))
      const f = await foto()
      const di = lancia('mirror-japan.mjs')
      check('...il giro dopo non cambia niente, id e microsecondi compresi', (await foto()) === f && conta(di, 'copie aggiornate') === 0
              && conta(di, 'scambiate per tenere i clear nella loro corsa') === 0, ricorrenze(di))
      // La correzione si annulla (il --dal di nuovo all'inizio del gioco: la
      // run del gioco diventa a mano sul posto, quella a mano si toglie). La
      // finestra rimessa intera prendeva il pezzetto senza clear (il piu'
      // vicino), la copia del clear la bloccava, e restavano tutte e due per
      // sempre, con un conflitto. Ora la prende la copia del clear.
      lancia('set-event-window.mjs', ['--evento', e.ev, '--reg', 'global', '--dal', e.starts_at.toISOString(), '--al', al.toISOString()])
      const annulla = lancia('mirror-japan.mjs')
      const r2 = await runsJp(e.ev)
      check('annullata: una copia sola, la riga del clear (stesso id) con la finestra intera; il pezzetto si toglie',
            r2.length === 1 && r2[0].id === e.copia && stesso(r2[0].starts_at, e.starts_at) && stesso(r2[0].ends_at, al) && r2[0].ends_at_known
              && conta(annulla, 'copie con clear che riprendono la finestra') === 1 && !/clear Japan scritti fuori/.test(annulla)
              && !new RegExp(`conflitto ${e.ev} `).test(annulla), `${descrivi(r2)}; ${ricorrenze(annulla)}`)
      const f2 = await foto()
      lancia('mirror-japan.mjs')
      check('...il giro dopo non cambia niente', (await foto()) === f2)
    } finally {
      if (clear) await db.query(`delete from clear where id = $1`, [clear])
      if (aMano) await db.query(`delete from event_run where id = $1`, [aMano])
      await rimetti()
      lancia('mirror-japan.mjs')
    }
    const dopo = await runsJp(e.ev)
    check('rimessa la run del gioco: una copia sola, uguale', dopo.length === 1 && dopo[0].source === 'mirror' && stesso(dopo[0].starts_at, e.starts_at)
            && stesso(dopo[0].ends_at, e.ends_at) && dopo[0].ends_at_known === e.ends_at_known, descrivi(dopo))
  })

  // Una copia con un clear Japan, e la sua finestra Global che si sposta
  // (cinque ore dopo, come quando il datamine corregge un inizio): la copia
  // segue la finestra (stesso id), come load-windows fa con una run del
  // gioco, e il clear scritto nella prima ora resta fuori dalla sua run: lo
  // specchio lo conta, da rivedere a mano, come load-windows su Global.
  // Prima la copia teneva le date vecchie (chiusa all'inizio della finestra,
  // con una copia nuova accanto, e "tengo ... fissa"): Japan aveva una
  // corsa che Global non ha.
  await sezione('una copia con un clear Japan segue la sua finestra Global, e il clear fuori si conta', async () => {
    const [e] = await righe(`
      select e.id::text as ev, g.id::text as gid, g.starts_at, g.ends_at, g.ends_at_known, m.id::text as copia,
             (select t.id::text from stage_tier t where t.event_id = e.id order by t.id limit 1) as tier
      from event e
      join event_run g on g.event_id = e.id and g.reg = 'global' and g.source = 'game' and g.starts_at >= $1::timestamptz
      join event_run m on m.event_id = e.id and m.reg = 'japan' and m.source = 'mirror' and m.starts_at = g.starts_at
      where e.imported_from = 'datamine' and g.ends_at > g.starts_at + interval '4 days' and g.ends_at_known
        and (select count(*) from event_run x where x.event_id = e.id and x.reg = 'global') = 1
        and (select count(*) from event_run x where x.event_id = e.id and x.reg = 'japan') = 1
        and exists (select 1 from stage_tier t where t.event_id = e.id)
        and not exists (select 1 from clear c where c.run_id in (g.id, m.id))
      order by e.id desc offset 2 limit 1`, [D])
    if (!check('un terzo evento del gioco con una sola corsa Global da D, la sua copia e una difficolta\'', !!e)) return
    const fuoriTutti = async () => Number(await valore(`
      select count(*) from clear c join event_run r on r.id = c.run_id
      where r.reg = 'japan' and (c.created_at < r.starts_at or c.created_at >= coalesce(r.ends_at, 'infinity'))`))
    const prima = await fuoriTutti()
    const dopo5 = new Date(e.starts_at.getTime() + 5 * 3_600_000)
    let clear = ''
    try {
      clear = await valore(`insert into clear (author_id, run_id, stage_tier_id, event_id, created_at) values ($1, $2, $3, $4, $5)
                            returning id::text`, [AUTORE, e.copia, e.tier, e.ev, new Date(e.starts_at.getTime() + 3_600_000)])
      await db.query(`update event_run set starts_at = $2 where id = $1`, [e.gid, dopo5])
      const out = lancia('mirror-japan.mjs')
      const r = await runsJp(e.ev)
      check('la copia (stesso id) segue la finestra: il nuovo inizio, la stessa fine; una copia sola',
            r.length === 1 && r[0].id === e.copia && r[0].source === 'mirror' && stesso(r[0].starts_at, dopo5) && stesso(r[0].ends_at, e.ends_at)
              && r[0].ends_at_known === e.ends_at_known && conta(out, 'copie aggiornate') === 1 && conta(out, 'nuove dallo specchio') === 0,
            `${descrivi(r)}; ${ricorrenze(out)}`)
      check('...il clear resta sulla sua run, fuori, e il giro lo conta; nessun conflitto, nessun tengo',
            Number(await valore(`select count(*) from clear where id = $1 and run_id = $2`, [clear, e.copia])) === 1
              && await fuoriTutti() === prima + 1 && conta(out, 'clear Japan scritti fuori dalla loro run') === prima + 1
              && !new RegExp(`conflitto ${e.ev} `).test(out) && !new RegExp(`^  tengo la run ${e.copia} `, 'm').test(out),
            out.match(/clear Japan scritti fuori[^\n]*/)?.[0])
      const f = await foto()
      lancia('mirror-japan.mjs')
      check('...il giro dopo non cambia niente, id compresi', (await foto()) === f)
    } finally {
      if (clear) await db.query(`delete from clear where id = $1`, [clear])
      await db.query(`update event_run set starts_at = $2 where id = $1`, [e.gid, e.starts_at])
      lancia('mirror-japan.mjs')
    }
    const dopo = await runsJp(e.ev)
    check('rimessa la finestra: la copia (stesso id) di nuovo uguale', dopo.length === 1 && dopo[0].id === e.copia
            && stesso(dopo[0].starts_at, e.starts_at) && stesso(dopo[0].ends_at, e.ends_at), descrivi(dopo))
  })

  // Il primo giro in produzione: i clear Japan stanno sulle run del wiki
  // aperte (prima dello specchio erano le run Japan attive). Lo specchio
  // chiude la run del wiki all'inizio della prima copia, e un clear scritto
  // durante una replica dopo (la seconda copia) restava sulla run del wiki
  // chiusa: lo scambio guardava solo la copia subito dopo. Si rimette
  // l'evento com'era prima dello specchio: la run del wiki aperta, senza
  // copie.
  await sezione('al primo giro i clear Japan di una replica successiva vanno nella sua copia', async () => {
    const [e] = (await righe(`
      select e.id::int as ev, w.id::text as wiki, w.starts_at as jp, c1.id::text as c1, c1.starts_at as s1,
             c2.id::text as c2, c2.starts_at as s2, c2.ends_at as e2,
             (select t.id::text from stage_tier t where t.event_id = e.id order by t.id limit 1) as tier
      from event e
      join event_run w on w.event_id = e.id and w.reg = 'japan' and w.source = 'wiki' and w.ends_at is not null
      join event_run c1 on c1.event_id = e.id and c1.reg = 'japan' and c1.source = 'mirror' and c1.starts_at = w.ends_at
      join event_run c2 on c2.event_id = e.id and c2.reg = 'japan' and c2.source = 'mirror' and c2.starts_at > c1.starts_at
                       and c2.ends_at is not null
      where e.imported_from = 'wiki' and w.starts_at < $1::timestamptz and exists (select 1 from stage_tier t where t.event_id = e.id)
        and (select count(*) from event_run x where x.event_id = e.id and x.reg = 'japan') = 3
        and not exists (select 1 from clear c join event_run x on x.id = c.run_id where x.event_id = e.id)
      order by e.id`, [D])).filter((r) => wikiJapanRelease(pagineWiki.get(r.ev)) != null)
    if (!check('un evento del wiki con la run chiusa dalla prima copia, e una seconda copia', !!e)) return
    let clear = ''
    try {
      // com'era prima del primo giro: la run del wiki aperta, nessuna copia
      await db.query(`delete from event_run where id = any($1::bigint[])`, [[e.c1, e.c2]])
      await db.query(`update event_run set ends_at = null where id = $1`, [e.wiki])
      clear = await valore(`insert into clear (author_id, run_id, stage_tier_id, event_id, created_at) values ($1, $2, $3, $4, $5::timestamptz + interval '1 hour')
                            returning id::text`, [AUTORE, e.wiki, e.tier, e.ev, e.s2])
      const out = lancia('mirror-japan.mjs')
      const r = await runsJp(e.ev)
      const ora = r.find((x) => x.id === e.wiki)
      check('la run del clear (stesso id) diventa la copia della seconda finestra; la prima finestra ha la sua copia',
            ora?.source === 'mirror' && stesso(ora.starts_at, e.s2) && stesso(ora.ends_at, e.e2)
              && r.some((x) => x.source === 'mirror' && x.id !== e.wiki && stesso(x.starts_at, e.s1))
              && conta(out, 'scambiate per tenere i clear nella loro corsa') === 1 && !/clear Japan scritti fuori/.test(out),
            `${descrivi(r)}; ${ricorrenze(out)}`)
      const tratto = r.find((x) => x.source === 'wiki')
      check('...e il tratto del wiki rientra come run nuova, chiusa all\'inizio della prima copia',
            !!tratto && tratto.id !== e.wiki && stesso(tratto.starts_at, e.jp) && stesso(tratto.ends_at, e.s1) && !tratto.ends_at_known, descrivi(r))
      const f = await foto()
      const di = lancia('mirror-japan.mjs')
      check('...il giro dopo non cambia niente, id compresi', (await foto()) === f && conta(di, 'scambiate per tenere i clear nella loro corsa') === 0)
    } finally {
      if (clear) await db.query(`delete from clear where id = $1`, [clear])
      lancia('mirror-japan.mjs')
    }
  })

  // Il primo giro, con i clear della run del wiki aperta scritti in due
  // repliche diverse: nessuna copia li contiene tutti, e chiudere la run del
  // wiki ne lascerebbe fuori qualcuno. La regola dei clear la ferma: resta
  // aperta, le finestre che la chiuderebbero sono conflitti, e il giro lo
  // dice a ogni giro ("  tengo la run"). Prima la chiudeva, e il giro diceva
  // solo i clear rimasti fuori.
  await sezione('al primo giro una run del wiki con i clear in due repliche resta com\'e\'', async () => {
    const [e] = (await righe(`
      select e.id::int as ev, w.id::text as wiki, c1.id::text as c1, c1.starts_at as s1, c2.id::text as c2, c2.starts_at as s2,
             (select t.id::text from stage_tier t where t.event_id = e.id order by t.id limit 1) as tier
      from event e
      join event_run w on w.event_id = e.id and w.reg = 'japan' and w.source = 'wiki' and w.ends_at is not null
      join event_run c1 on c1.event_id = e.id and c1.reg = 'japan' and c1.source = 'mirror' and c1.starts_at = w.ends_at and c1.ends_at is not null
      join event_run c2 on c2.event_id = e.id and c2.reg = 'japan' and c2.source = 'mirror' and c2.starts_at > c1.starts_at
                       and c2.ends_at is not null
      where e.imported_from = 'wiki' and w.starts_at < $1::timestamptz and exists (select 1 from stage_tier t where t.event_id = e.id)
        and (select count(*) from event_run x where x.event_id = e.id and x.reg = 'japan') = 3
        and not exists (select 1 from clear c join event_run x on x.id = c.run_id where x.event_id = e.id)
      order by e.id desc`, [D])).filter((r) => wikiJapanRelease(pagineWiki.get(r.ev)) != null)
    if (!check('un altro evento del wiki con la run chiusa dalla prima copia, e una seconda copia', !!e)) return
    const clear: string[] = []
    try {
      await db.query(`delete from event_run where id = any($1::bigint[])`, [[e.c1, e.c2]])
      await db.query(`update event_run set ends_at = null where id = $1`, [e.wiki])
      for (const s of [e.s1, e.s2]) {
        clear.push(await valore(`insert into clear (author_id, run_id, stage_tier_id, event_id, created_at) values ($1, $2, $3, $4, $5::timestamptz + interval '1 hour')
                                 returning id::text`, [AUTORE, e.wiki, e.tier, e.ev, s]))
      }
      const out = lancia('mirror-japan.mjs')
      const r = await runsJp(e.ev)
      check('la run del wiki (stesso id) resta aperta, con i due clear dentro; nessuna copia, nessuno scambio',
            r.length === 1 && r[0].id === e.wiki && r[0].ends_at === null && conta(out, 'scambiate per tenere i clear nella loro corsa') === 0
              && !/clear Japan scritti fuori/.test(out), `${descrivi(r)}; ${ricorrenze(out)}`)
      check('...detto: due conflitti contro di lei, e "  tengo la run"',
            (out.match(new RegExp(`conflitto ${e.ev} [^\n]*contro la run ${e.wiki} \\(wiki\\)`, 'g')) ?? []).length === 2
              && new RegExp(`^  tengo la run ${e.wiki} \\(evento ${e.ev}, japan\\)`, 'm').test(out), out.match(/^ {2}tengo[^\n]*/m)?.[0])
      const f = await foto()
      const di = lancia('mirror-japan.mjs')
      check('...il giro dopo non cambia niente, e lo dice ancora', (await foto()) === f && new RegExp(`^  tengo la run ${e.wiki} `, 'm').test(di))
    } finally {
      if (clear.length) await db.query(`delete from clear where id = any($1::uuid[])`, [clear])
      lancia('mirror-japan.mjs')
    }
    const dopo = await runsJp(e.ev)
    check('senza i clear: di nuovo la run del wiki chiusa dalla prima copia, e le due copie', dopo.length === 3 && dopo[0].id === e.wiki
            && stesso(dopo[0].ends_at, e.s1) && dopo[1].source === 'mirror' && dopo[2].source === 'mirror', descrivi(dopo))
  })

  // Il primo giro, con la data Japan del wiki il giorno dopo l'inizio della
  // prima finestra (la stessa uscita: 712682 esce su Global alle 21:00 UTC,
  // gia' il giorno dopo a Tokyo) e un clear Japan nella replica dopo, sulla
  // run del wiki aperta. Il piano non la adotta (il clear resterebbe fuori),
  // la prima finestra e' un conflitto contro di lei (ci comincia dentro),
  // la chiude all'inizio della replica, e lo scambio porta la sua riga nella
  // copia della replica; il suo tratto rientra come run del wiki, che la
  // prima finestra adotta solo al piano dopo. Prima quel piano era la
  // settimana dopo: il giro non era idempotente, e per una settimana Japan
  // non aveva la copia della prima finestra. Ora lo specchio ripianifica
  // gli eventi toccati nella stessa transazione (anche con --dry-run, che
  // poi annulla tutto).
  await sezione('i passi dello specchio: il tratto della run del wiki scambiata si adotta nello stesso giro', async () => {
    const tutti = (await righe(`
      select e.id::int as ev, w.id::text as wiki, c1.starts_at as s1, c1.ends_at as e1, c2.starts_at as s2, c2.ends_at as e2,
             (select t.id::text from stage_tier t where t.event_id = e.id order by t.id limit 1) as tier
      from event e
      join event_run w on w.event_id = e.id and w.reg = 'japan' and w.source = 'wiki' and w.ends_at is not null
      join event_run c1 on c1.event_id = e.id and c1.reg = 'japan' and c1.source = 'mirror' and c1.starts_at = w.ends_at
                       and c1.ends_at > c1.starts_at + interval '3 days' and c1.ends_at_known
      join event_run c2 on c2.event_id = e.id and c2.reg = 'japan' and c2.source = 'mirror' and c2.starts_at > c1.ends_at
                       and c2.ends_at is not null
      where e.imported_from = 'wiki' and w.starts_at < $1::timestamptz and exists (select 1 from stage_tier t where t.event_id = e.id)
        and (select count(*) from event_run x where x.event_id = e.id and x.reg = 'japan') = 3
        and not exists (select 1 from clear c join event_run x on x.id = c.run_id where x.event_id = e.id)
      order by (e.id = 712682) desc, e.id`, [D])).filter((r) => wikiJapanRelease(pagineWiki.get(r.ev)) != null)
    // (anche uno dei due eventi dei casi del primo giro qui sopra: li hanno
    // rimessi nella stessa forma)
    const e = tutti[0]
    if (!check('un evento del wiki con la run chiusa dalla prima copia (lunga), e una seconda copia (712682)', !!e, e?.ev)) return
    const jp = new Date(mezzanotte(e.s1).getTime() + 86_400_000)
    const cache = cacheCon(e.ev, jp)
    if (!check('la copia della cache con la data Japan il giorno dopo l\'inizio della prima finestra', !!cache) || !cache) return
    const env = { WIKI_EVENTS_CACHE: cache }
    let clear = ''
    try {
      // com'era prima del primo giro: la run del wiki aperta alla data, nessuna copia
      await db.query(`delete from event_run where event_id = $1 and reg = 'japan' and source = 'mirror'`, [e.ev])
      await db.query(`update event_run set starts_at = $2, ends_at = null where id = $1`, [e.wiki, jp])
      clear = await valore(`insert into clear (author_id, run_id, stage_tier_id, event_id, created_at) values ($1, $2, $3, $4, $5::timestamptz + interval '1 hour')
                            returning id::text`, [AUTORE, e.wiki, e.tier, e.ev, e.s2])
      lancia('load-events.mjs', [], env)
      lancia('load-windows.mjs')
      const f0 = await foto()
      const prova = lancia('mirror-japan.mjs', ['--dry-run'], env)
      check('--dry-run: dice i passi (lo scambio, poi l\'adozione) e non scrive niente',
            conta(prova, 'passi \\(gli eventi toccati si ripianificano\\)') === 3 && conta(prova, 'scambiate per tenere i clear nella loro corsa') === 1
              && conta(prova, 'del wiki diventate copie \\(stessa uscita\\)') === 1 && /--dry-run: niente e' stato scritto/.test(prova)
              && (await foto()) === f0, ricorrenze(prova))
      const out = lancia('mirror-japan.mjs', [], env)
      const r = await runsJp(e.ev)
      const dentro = Number(await valore(`
        select count(*) from clear c join event_run x on x.id = c.run_id
        where c.id = $1 and x.id = $2 and c.created_at >= x.starts_at and c.created_at < coalesce(x.ends_at, 'infinity')`, [clear, e.wiki]))
      check('nello stesso giro: la riga del clear (stesso id) e\' la copia della replica, il tratto adottato dalla prima finestra; come da zero',
            r.length === 2 && r.every((x) => x.source === 'mirror') && stesso(r[0].starts_at, e.s1) && stesso(r[0].ends_at, e.e1) && r[0].id !== e.wiki
              && r[1].id === e.wiki && stesso(r[1].starts_at, e.s2) && stesso(r[1].ends_at, e.e2) && dentro === 1
              && !new RegExp(`conflitto ${e.ev} `).test(out) && !/attenzione: lo specchio cambia ancora/.test(out),
            `${descrivi(r)}; ${ricorrenze(out)}`)
      const f = await foto()
      const di = settimana(env)
      check('...il giro dopo non cambia niente, id compresi', (await foto()) === f, `${wikiRun(di.eventi)}; ${ricorrenze(di.specchio)}`)
    } finally {
      if (clear) await db.query(`delete from clear where id = $1`, [clear])
      settimana({})
    }
    const dopo = await runsJp(e.ev)
    check('con la cache vera: la run del wiki alla sua data, chiusa all\'inizio della prima copia, e le due copie',
          dopo.length === 3 && dopo[0].source === 'wiki' && stesso(dopo[0].ends_at, e.s1) && dopo[1].source === 'mirror' && stesso(dopo[1].starts_at, e.s1)
            && dopo[2].source === 'mirror' && stesso(dopo[2].starts_at, e.s2), descrivi(dopo))
  })

  // 88853 con un clear Japan sulla copia: la copia non si puo' togliere, e la
  // run del wiki portata alla data da load-events restava un pezzetto di
  // cinque ore accanto a lei, per sempre. Ora resta la copia, e la run del
  // wiki (senza clear) si toglie: come un import da zero, una run sola.
  await sezione('la data Japan del wiki al giorno di una copia con un clear Japan: resta la copia, la run del wiki se ne va', async () => {
    const e = semplici[3]
    const tier = e ? await tierDi(e.ev) : null
    if (!check('un quarto evento del wiki con la run chiusa da una copia, e una difficolta\'', !!e && !!tier)) return
    const jp = mezzanotte(e.starts_at)
    const cache = cacheCon(e.ev, jp)
    if (!check('la copia della cache con la data Japan al giorno della copia', !!cache) || !cache) return
    const env = { WIKI_EVENTS_CACHE: cache }
    let clear = ''
    try {
      clear = await valore(`insert into clear (author_id, run_id, stage_tier_id, event_id, created_at) values ($1, $2, $3, $4, $5)
                            returning id::text`, [AUTORE, e.copia, tier, e.ev, new Date(e.starts_at.getTime() + 3_600_000)])
      const { eventi, specchio } = settimana(env)
      check('load-events sposta la run del wiki alla data, e la copia la chiude poche ore dopo', /nuove 0, spostate 1,/.test(wikiRun(eventi)),
            wikiRun(eventi))
      const r = await runsJp(e.ev)
      check('nello stesso giro una run sola: la copia col clear (stesso id); la run del wiki se ne va',
            r.length === 1 && r[0].id === e.copia && r[0].source === 'mirror' && stesso(r[0].starts_at, e.starts_at)
              && conta(specchio, 'del wiki tolte, la copia ha dei clear') === 1 && conta(specchio, 'copie tolte, la regola non le vuole piu\'') === 0,
            `${descrivi(r)}; ${ricorrenze(specchio)}`)
      const f = await foto()
      const di = settimana(env)
      check('...il giro dopo non cambia niente, id compresi', (await foto()) === f && /nuove 0, spostate 0/.test(wikiRun(di.eventi)),
            `${wikiRun(di.eventi)}; ${ricorrenze(di.specchio)}`)
    } finally {
      if (clear) await db.query(`delete from clear where id = $1`, [clear])
      settimana({})
    }
    const dopo = await runsJp(e.ev)
    check('con la cache vera torna come prima: la run del wiki alla sua data, chiusa all\'inizio della copia (stesso id)',
          dopo.length === 2 && dopo[0].source === 'wiki' && stesso(dopo[0].starts_at, e.jp) && stesso(dopo[0].ends_at, e.starts_at)
            && dopo[1].id === e.copia, descrivi(dopo))
  })

  // La stessa, con il clear sulla run del wiki scritto durante la copia
  // (fuori dalla corsa della run del wiki: un clear scelto nel builder).
  // load-events non la sposta (ha un clear), e lo specchio la riunisce alla
  // copia della stessa uscita: il clear non e' della sua corsa, quindi la
  // regola dei clear non la ferma, e ci finisce dentro. Una run sola, come
  // da zero: prima lo scambio dava alla run del clear la finestra, e il suo
  // pezzetto di cinque ore rientrava come run del wiki, che il giro dopo
  // toglieva.
  await sezione('la data Japan del wiki al giorno di una copia, con un clear Japan sulla run del wiki: una run sola', async () => {
    const e = semplici[4]
    const tier = e ? await tierDi(e.ev) : null
    if (!check('un quinto evento del wiki con la run chiusa da una copia, e una difficolta\'', !!e && !!tier)) return
    const jp = mezzanotte(e.starts_at)
    const cache = cacheCon(e.ev, jp)
    if (!check('la copia della cache con la data Japan al giorno della copia', !!cache) || !cache) return
    const env = { WIKI_EVENTS_CACHE: cache }
    let clear = ''
    try {
      clear = await valore(`insert into clear (author_id, run_id, stage_tier_id, event_id, created_at) values ($1, $2, $3, $4, $5)
                            returning id::text`, [AUTORE, e.wiki, tier, e.ev, new Date(e.starts_at.getTime() + 3_600_000)])
      const { specchio } = settimana(env)
      const r = await runsJp(e.ev)
      check('nello stesso giro una run sola: la run del clear (stesso id) prende la finestra, riunita alla copia',
            r.length === 1 && r[0].id === e.wiki && r[0].source === 'mirror' && stesso(r[0].starts_at, e.starts_at)
              && conta(specchio, 'di cui al posto della copia che c\'era') === 1 && !/clear Japan scritti fuori/.test(specchio),
            `${descrivi(r)}; ${ricorrenze(specchio)}`)
      const f = await foto()
      const di = settimana(env)
      check('...il giro dopo non cambia niente, id compresi', (await foto()) === f, `${wikiRun(di.eventi)}; ${ricorrenze(di.specchio)}`)
    } finally {
      if (clear) await db.query(`delete from clear where id = $1`, [clear])
      settimana({})
    }
    const dopo = await runsJp(e.ev)
    check('con la cache vera: la run del wiki rinasce alla sua data, chiusa all\'inizio della copia',
          dopo.length === 2 && dopo[0].source === 'wiki' && stesso(dopo[0].starts_at, e.jp) && stesso(dopo[0].ends_at, e.starts_at)
            && dopo[1].source === 'mirror' && stesso(dopo[1].starts_at, e.starts_at), descrivi(dopo))
  })

  // 707351: un conflitto "vince il wiki" (|JPdate = 20 Dec 2025) porta la
  // run del wiki al 2025-12-20, aperta, e la copia senza clear se ne va. Poi
  // un clear Japan sulla run del wiki (il 2026-01-10, dentro la sua corsa), e
  // il wiki torna alla data vera (31 May 2021). load-events la spostava al
  // 2021 (aperta: il clear restava dentro), e lo specchio la chiudeva
  // all'inizio della copia del 2025-11-18: il clear finiva fuori, e nessuna
  // riga "tengo". Ora load-events non la sposta (ha dei clear), lo specchio
  // nemmeno (lascerebbe fuori il clear): resta al 2025-12-20, alla data ne
  // nasce una nuova chiusa all'inizio della copia, e il giro lo dice a ogni
  // giro. Quando il clear se ne va, se ne va anche lei.
  const caso707 = semplici.find((x) => x.ev === 707351) ?? semplici[5]
  await sezione('una run del wiki con un clear non si sposta se il clear ne resterebbe fuori (707351)', async () => {
    const e = caso707
    const tier = e ? await tierDi(e.ev) : null
    if (!check('707351 (o un altro evento del wiki con la forma semplice), e una difficolta\'', !!e && !!tier, e?.ev)) return
    const vince = cacheCon(e.ev, new Date('2025-12-20T00:00:00Z'))
    if (!check('la copia della cache con la data Japan al 20 Dec 2025', !!vince) || !vince) return
    let clear = '', nuova = ''
    try {
      settimana({ WIKI_EVENTS_CACHE: vince })
      let r = await runsJp(e.ev)
      if (!check('vince il wiki: la run del wiki (stesso id) al 2025-12-20, aperta, e nessuna copia', r.length === 1 && r[0].id === e.wiki
                 && stesso(r[0].starts_at, '2025-12-20T00:00:00Z') && r[0].ends_at === null, descrivi(r))) return
      clear = await valore(`insert into clear (author_id, run_id, stage_tier_id, event_id, created_at) values ($1, $2, $3, $4, '2026-01-10T00:00:00Z')
                            returning id::text`, [AUTORE, e.wiki, tier, e.ev])
      const { eventi, specchio } = settimana({})
      r = await runsJp(e.ev)
      nuova = r.find((x) => x.source === 'wiki' && x.id !== e.wiki)?.id ?? ''
      check('load-events non la sposta: ha dei clear (lo dice)', /nuove 0, spostate 0, tolte 0, lasciate allo specchio \(Japan, con dei clear\) 1/.test(wikiRun(eventi)),
            wikiRun(eventi))
      check('lo specchio nemmeno: resta al 2025-12-20 col suo clear dentro; alla data una run del wiki nuova chiusa all\'inizio della copia; la copia',
            r.length === 3 && !!nuova && stesso(r[0].starts_at, e.jp) && stesso(r[0].ends_at, e.starts_at) && !r[0].ends_at_known
              && r[1].source === 'mirror' && stesso(r[1].starts_at, e.starts_at) && stesso(r[1].ends_at, e.ends_at)
              && r[2].id === e.wiki && stesso(r[2].starts_at, '2025-12-20T00:00:00Z') && r[2].ends_at === null
              && !/clear Japan scritti fuori/.test(specchio), `${descrivi(r)}; ${ricorrenze(specchio)}`)
      check('...e lo dice: "  tengo la run"', new RegExp(`^  tengo la run ${e.wiki} \\(evento ${e.ev}, japan\\)`, 'm').test(specchio),
            specchio.match(/^ {2}tengo[^\n]*/m)?.[0])
      const f = await foto()
      const di = settimana({})
      check('...il giro dopo non cambia niente, e lo dice ancora', (await foto()) === f
              && new RegExp(`^  tengo la run ${e.wiki} `, 'm').test(di.specchio), `${wikiRun(di.eventi)}; ${ricorrenze(di.specchio)}`)
      // Poi il clear si toglie (o si sposta a mano). La run ferma restava
      // aperta al 2025-12-20 per sempre (load-events non la tocca: la run
      // alla data gli basta), e l'evento in corso su Japan, senza nessuna
      // riga che lo dicesse. Ora si toglie nello stesso giro: come da zero.
      await db.query(`delete from clear where id = $1`, [clear])
      clear = ''
      const via = settimana({})
      r = await runsJp(e.ev)
      check('tolto il clear, la run ferma (senza clear) si toglie nello stesso giro; resta la run alla data e la copia, come da zero',
            r.length === 2 && r[0].id === nuova && stesso(r[0].starts_at, e.jp) && stesso(r[0].ends_at, e.starts_at) && !r[0].ends_at_known
              && r[1].source === 'mirror' && stesso(r[1].starts_at, e.starts_at)
              && conta(via.specchio, 'del wiki tolte, un\'altra e\' alla data') === 1 && !/^ {2}tengo /m.test(via.specchio),
            `${descrivi(r)}; ${ricorrenze(via.specchio)}`)
      const f2 = await foto()
      const ancora = settimana({})
      check('...il giro dopo non cambia niente', (await foto()) === f2, `${wikiRun(ancora.eventi)}; ${ricorrenze(ancora.specchio)}`)
    } finally {
      // senza il clear il giro toglie da solo la run del wiki in piu'
      if (clear) await db.query(`delete from clear where id = $1`, [clear])
      settimana({})
    }
    const dopo = await runsJp(e.ev)
    check('rimessa com\'era: la run del wiki alla sua data, chiusa all\'inizio della copia, e la copia',
          dopo.length === 2 && dopo[0].source === 'wiki' && stesso(dopo[0].starts_at, e.jp) && stesso(dopo[0].ends_at, e.starts_at)
            && dopo[1].source === 'mirror' && stesso(dopo[1].starts_at, e.starts_at), descrivi(dopo))
  })

  // Il wiki non da' piu' la data Japan, e la run del wiki (aperta, la run
  // Japan attiva prima dello specchio) ha un clear scritto durante la
  // finestra Global: lo specchio la chiude all'inizio della copia, e lo
  // scambio porta la sua riga nella copia. Il suo tratto di prima rientrava
  // come run del wiki, e load-events lo toglieva la settimana dopo (il wiki
  // non lo da' piu'): un import da zero non ha la run del wiki.
  await sezione('senza la data Japan del wiki lo scambio non rimette il tratto della run del wiki', async () => {
    const e = semplici.find((x, i) => i >= 5 && x.ev !== caso707?.ev)
    const tier = e ? await tierDi(e.ev) : null
    if (!check('un altro evento del wiki con la forma semplice, e una difficolta\'', !!e && !!tier, e?.ev) || !e) return
    const raw = JSON.parse(readFileSync(CACHE, 'utf8'))
    const p = raw.pages.find((x: Riga) => x.pageid === e.ev)
    p.wikitext = p.wikitext.replace(/^\|\s*JPdate\s*=.*$/m, '')
    const cache = join(tmp, `wiki-events-${e.ev}-senza.json`)
    writeFileSync(cache, JSON.stringify(raw))
    let clear = ''
    try {
      // com'era prima dello specchio: la run del wiki aperta, nessuna copia
      await db.query(`delete from event_run where id = $1`, [e.copia])
      await db.query(`update event_run set ends_at = null where id = $1`, [e.wiki])
      clear = await valore(`insert into clear (author_id, run_id, stage_tier_id, event_id, created_at) values ($1, $2, $3, $4, $5)
                            returning id::text`, [AUTORE, e.wiki, tier, e.ev, new Date(e.starts_at.getTime() + 3_600_000)])
      const { eventi, specchio } = settimana({ WIKI_EVENTS_CACHE: cache })
      const r = await runsJp(e.ev)
      check('load-events la tiene (ha un clear), lo specchio la chiude e la scambia: una run sola, la copia (stesso id)',
            new RegExp(`^  tengo la run ${e.wiki} \\(evento ${e.ev}, japan\\)`, 'm').test(eventi)
              && r.length === 1 && r[0].id === e.wiki && r[0].source === 'mirror' && stesso(r[0].starts_at, e.starts_at)
              && conta(specchio, 'scambiate per tenere i clear nella loro corsa') === 1 && !/clear Japan scritti fuori/.test(specchio),
            `${descrivi(r)}; ${ricorrenze(specchio)}`)
      const f = await foto()
      const di = settimana({ WIKI_EVENTS_CACHE: cache })
      check('...il giro dopo non cambia niente (load-events non toglie niente)', (await foto()) === f && /tolte 0/.test(wikiRun(di.eventi)),
            `${wikiRun(di.eventi)}; ${ricorrenze(di.specchio)}`)
    } finally {
      if (clear) await db.query(`delete from clear where id = $1`, [clear])
      settimana({})
    }
    const dopo = await runsJp(e.ev)
    check('con la cache vera: la run del wiki rinasce alla sua data, chiusa all\'inizio della copia',
          dopo.length === 2 && dopo[0].source === 'wiki' && stesso(dopo[0].starts_at, e.jp) && stesso(dopo[0].ends_at, e.starts_at)
            && dopo[1].source === 'mirror' && stesso(dopo[1].starts_at, e.starts_at), descrivi(dopo))
  })

  await sezione('un secondo giro non cambia niente', async () => {
    const prima = await foto()
    const copie = Number(await valore(`select count(*) from event_run where reg = 'japan' and source = 'mirror'`))
    const out = lancia('mirror-japan.mjs')
    check('lo specchio: tutto invariato', conta(out, 'invariate') === copie && conta(out, 'nuove dallo specchio') === 0
            && conta(out, 'copie aggiornate') === 0 && conta(out, 'copie tolte, la regola non le vuole piu\'') === 0
            && conta(out, 'del wiki chiuse all\'inizio di una copia') === 0 && conta(out, 'del wiki riaperte \\(non comincia piu\' niente\\)') === 0,
          ricorrenze(out))
    check('run e uscite identiche, id compresi', (await foto()) === prima)
    lancia('load-events.mjs')
    lancia('load-windows.mjs')
    lancia('mirror-japan.mjs')
    check('anche dopo load-events + load-windows + mirror-japan', (await foto()) === prima)
  })

  await sezione('--dry-run e regole sbagliate', async () => {
    const tutte = `select count(*) from event_run where reg = 'japan' and source = 'mirror'`
    const n = Number(await valore(tutte))
    const out = lancia('mirror-japan.mjs', ['--dry-run', '--rules', regole('niente', { since: '2100-01-01T00:00:00Z' })])
    check('--dry-run con un D lontano: direbbe di togliere tutte le copie, e non scrive niente',
          conta(out, 'copie tolte, la regola non le vuole piu\'') === n && /--dry-run: niente e' stato scritto/.test(out)
            && Number(await valore(tutte)) === n, `${conta(out, 'copie tolte, la regola non le vuole piu\'')} su ${n}`)
    let errore = ''
    try {
      lancia('mirror-japan.mjs', ['--rules', regole('sbagliate', { globalOnly: [{ event: 12 }] })])
    } catch (err) {
      errore = String((err as { stderr?: string }).stderr ?? err)
    }
    check('una regola senza motivo ferma il giro, prima di scrivere', /regole sbagliate/.test(errore) && /manca il motivo/.test(errore)
            && Number(await valore(tutte)) === n, errore.split('\n').find((l) => /globalOnly/.test(l)))
  })
} finally {
  rmSync(tmp, { recursive: true, force: true })
  await db.end()
}

console.log(fails ? `\n  ${passes} verdi, ${fails} rosse\n` : `\n  ${passes} verifiche, TUTTO VERDE\n`)
process.exit(fails ? 1 : 0)
