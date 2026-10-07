// Verifica le missioni importate dal gioco (load-missions, migrazione 0013):
// i conteggi, un evento noto riga per riga contro i CSV, le corse, i premi
// con il loro nome, le regole di appartenenza (Super EZA, campagne) e che
// un secondo giro non cambi niente.
//
// Gira sul database di test dopo l'import dalle cache (npm run db:test),
// per ultima: le suite prima ritoccano le run, quindi rilancia lei
// load-missions prima di guardare. Come le altre, prima di usare un atteso
// controlla che la cache dica ancora quello su cui e' scritto.
import { execFileSync } from 'node:child_process'
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
const lancia = () => execFileSync(process.execPath, [new URL('../import/load-missions.mjs', import.meta.url).pathname],
  { env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' })

async function sezione(titolo: string, fn: () => Promise<void>) {
  console.log(`\n${titolo}`)
  try {
    await fn()
  } catch (err) {
    check(`${titolo}: interrotta da un errore`, false, (err as Error).message.split('\n')[0])
  }
}

// I CSV, per gli attesi
const missions = loadTable('missions')
const byGid = new Map(missions.map((m: Riga) => [Number(m.id), m]))
const rewards = loadTable('mission_rewards')
const points = new Map(loadTable('points').map((p: Riga) => [Number(p.id), Number(p.amount)]))
const rewardsOf = (gid: number) => rewards.filter((r: Riga) => Number(r.mission_id) === gid)
  .sort((a: Riga, b: Riga) => Number(a.id) - Number(b.id))
  .map((r: Riga) => `${r.item_type}:${Number(r.item_id)}:${Number(r.quantity) * (r.item_type.startsWith('Point::') ? points.get(Number(r.item_id))! : 1)}`)

// Le suite prima ritoccano run e clear: si riparte da un giro pulito.
const primo = lancia()
console.log(primo.split('\n').filter((l) => /missioni:|premi:|saltate:/.test(l)).join('\n'))

try {
  await sezione('conteggi', async () => {
    const [c] = await righe(`
      select count(*)::int n, count(distinct event_id)::int ev, count(run_id)::int in_run,
             count(*) filter (where game_mission_id is null)::int senza_gid
        from mission where imported_from = 'datamine'`)
    // 7720 missioni su 642 eventi con la fotografia del 2026-10-02: le soglie
    // lasciano spazio a una fotografia nuova, non a un import a meta'
    check('missioni del gioco: piu\' di 7000', c.n > 7000, `${c.n}`)
    check('eventi con missioni: piu\' di 600', c.ev > 600, `${c.ev}`)
    check('una parte sta in una corsa, una no', c.in_run > 1000 && c.n - c.in_run > 1000, `${c.in_run} in una corsa`)
    check('ogni missione del gioco ha il suo id', c.senza_gid === 0)
    check('ogni missione ha il testo inglese, nome e descrizione', Number(await valore(`
      select count(*) from mission m left join mission_text t on t.mission_id = m.id and t.locale = 'en'
       where m.imported_from = 'datamine' and (t.name is null or t.description = '' or t.reward is null)`)) === 0)
    check('ogni missione ha almeno un premio', Number(await valore(`
      select count(*) from mission m where m.imported_from = 'datamine'
         and not exists (select 1 from mission_reward w where w.mission_id = m.id)`)) === 0)
    check('seq: 1..n per evento, senza buchi', Number(await valore(`
      select count(*) from (select event_id, count(*) n, max(seq) mx, count(distinct seq) d
        from mission where imported_from = 'datamine' group by 1) x where n <> mx or n <> d`)) === 0)
  })

  // 552139 "Looming Menace", aree 605 e 616: tre missioni del 2020 con
  // una fine vera (la corsa di aprile) e tre del 2026 senza scadenza.
  await sezione('un evento noto: 552139 Looming Menace, contro i CSV', async () => {
    const EV = 552139
    const atteso = missions.filter((m: Riga) => ['605.0', '616.0'].includes(m.area_id)
      && m.type !== 'Mission::DeletedMission' && m.start_at >= '2015-07-01' && !m.start_at.startsWith('2038'))
    const cache = byGid.get(12840)
    if (!check('la cache ha ancora la 12840 (area 605, fino al 2020-05-07)', cache?.area_id === '605.0'
               && cache?.end_at === '2020-05-06 23:59:59', JSON.stringify(cache?.end_at))) return
    const ms = await righe(`
      select m.game_mission_id gid, m.seq, m.run_id::text, m.starts_at, m.ends_at, t.name, t.reward,
             r.starts_at r_start, r.ends_at r_end
        from mission m join mission_text t on t.mission_id = m.id and t.locale = 'en'
        left join event_run r on r.id = m.run_id
       where m.event_id = $1 order by m.seq`, [EV])
    check('le stesse missioni delle aree 605/616', JSON.stringify(ms.map((m) => m.gid).sort())
          === JSON.stringify(atteso.map((m: Riga) => Number(m.id)).sort()), ms.map((m) => m.gid).join(' '))
    const ordine = [...atteso].sort((a: Riga, b: Riga) => Number(b.priority) - Number(a.priority) || Number(a.id) - Number(b.id))
    check('seq nell\'ordine del gioco (priority piu\' alta prima, poi id)',
          JSON.stringify(ms.map((m) => m.gid)) === JSON.stringify(ordine.map((m: Riga) => Number(m.id))))
    for (const m of ms) {
      const got = (await righe(`select item_type, item_id, quantity from mission_reward where mission_id =
        (select id from mission where game_mission_id = $1) order by seq`, [m.gid]))
        .map((r) => `${r.item_type}:${r.item_id}:${r.quantity}`)
      check(`${m.gid}: premi come in mission_rewards (Point per points.amount)`, JSON.stringify(got) === JSON.stringify(rewardsOf(m.gid)), got.join(' '))
    }
    const m1 = ms.find((m) => m.gid === 12840)
    check('12840: "Dragon Stone x20", nella corsa che finisce il 2020-05-07 00:00 UTC', m1?.reward === 'Dragon Stone x20'
          && m1?.r_end?.toISOString() === '2020-05-07T00:00:00.000Z' && m1?.ends_at?.toISOString() === '2020-05-07T00:00:00.000Z',
          `${m1?.reward}, ${m1?.r_end?.toISOString()}`)
    tutte('le missioni 2038 non hanno corsa ne\' fine', ms.filter((m) => byGid.get(m.gid)?.end_at.startsWith('2038')),
          (m) => m.run_id === null && m.ends_at === null)
  })

  await sezione('le corse', async () => {
    tutte('run_id nullo se e solo se la missione non ha una fine sua', await righe(`
      select game_mission_id, run_id, ends_at from mission where imported_from = 'datamine'`),
          (m) => (m.run_id === null) === (m.ends_at === null))
    tutte('la finestra della missione sta dentro la sua run Global', await righe(`
      select m.game_mission_id, m.starts_at, m.ends_at, r.reg, r.starts_at rs, r.ends_at re
        from mission m join event_run r on r.id = m.run_id and r.event_id = m.event_id
       where m.imported_from = 'datamine'`),
          (m) => m.reg === 'global' && m.rs <= m.starts_at && (m.re === null || m.ends_at <= m.re))
  })

  await sezione('i premi hanno un nome', async () => {
    check('ogni premio porta a un oggetto con il nome inglese', Number(await valore(`
      select count(*) from mission_reward w left join game_item_text t
          on (t.item_type, t.item_id) = (w.item_type, w.item_id) and t.locale = 'en'
       where coalesce(t.name, '') = ''`)) === 0)
    check('nessun oggetto senza premi', Number(await valore(`
      select count(*) from game_item g where not exists
        (select 1 from mission_reward w where (w.item_type, w.item_id) = (g.item_type, g.item_id))`)) === 0)
    tutte('le carte premio che abbiamo puntano a card', await righe(`
      select g.item_id, g.card_id from game_item g where g.item_type = 'Card' and exists (select 1 from card c where c.id = g.item_id)`),
          (g) => Number(g.card_id) === Number(g.item_id))
  })

  await sezione('a chi appartiene una missione', async () => {
    check('nessuna missione del gioco in due eventi', Number(await valore(`
      select count(*) from (select game_mission_id from mission where game_mission_id is not null
        group by 1 having count(distinct event_id) > 1) x`)) === 0)
    const ref = new Map((await righe(`select game_id, event_id::text from event_game_ref where game_kind = 'area'`))
      .map((r) => [r.game_id, r.event_id]))
    const suArea = (await righe(`select game_mission_id gid, event_id::text ev from mission where imported_from = 'datamine'`))
      .map((m) => ({ gid: m.gid, ev: String(m.ev), area: Number(byGid.get(m.gid)?.area_id) || null }))
      .filter((m) => m.area && ref.has(m.area))
    tutte('una missione su un\'area legata sta nell\'evento di quell\'area', suArea, (m) => m.ev === ref.get(m.area))
    // 23350: z_battle_stage_id 1 (l'EZA Normal), condizioni z_battle_ids [701]
    if (check('la cache ha ancora la 23350 sullo stage 1 con z_battle_ids [701]', byGid.get(23350)?.z_battle_stage_id === '1.0'
              && JSON.parse(byGid.get(23350)?.conditions ?? '{}').z_battle_ids?.[0] === 701)) {
      const ev = await valore(`select m.event_id = r.event_id from mission m join event_game_ref r
        on r.game_kind = 'z_battle_stage' and r.game_id = 701 where m.game_mission_id = 23350`)
      check('23350 (Lv. SUPER) sta nella Super EZA, non nell\'EZA Normal', ev === true)
    }
    // 4030: area 331 ("Go Forth!"), condizioni con stage di un altro nostro evento
    check('4030, campagna di "Go Forth!" su piu\' eventi: fuori', byGid.has(4030)
          && Number(await valore(`select count(*) from mission where game_mission_id = 4030`)) === 0)
    check('le cancellate restano fuori', Number(await valore(`select count(*) from mission
      where game_mission_id = any($1::int[])`, [missions.filter((m: Riga) => m.type === 'Mission::DeletedMission')
        .map((m: Riga) => Number(m.id))])) === 0)
  })

  await sezione('i testi', async () => {
    tutte('niente istruzioni per il client ({cards: ...}) ne\' giapponese', await righe(`
      select m.game_mission_id, t.name, t.description from mission m join mission_text t on t.mission_id = m.id`),
          (t) => !/\{\s*cards/.test(t.name + t.description) && !/[぀-ヿ一-鿿]/.test(t.name + t.description))
    const d = await valore(`select t.description from mission m join mission_text t on t.mission_id = m.id
      where m.game_mission_id = 23351`)
    check('23351: righe dello schermo unite, la nota con l\'asterisco a parte, il token tolto',
          d === 'Win the Extreme Z-Battle "Mystery Super Technique" at Lv. SUPER with at least 3 "Sworn Enemies"'
            + ' Category characters on your team!\n* Friends do not count.', JSON.stringify(d))
  })

  await sezione('idempotenza e righe che non tornano', async () => {
    const prima = await righe(`select id::text, game_mission_id, event_id::text, run_id::text, seq from mission order by id`)
    const out = lancia()
    check('secondo giro: niente scritto', /missioni 0 nuove, 0 cambiate, testi 0; premi 0 scritti, 0 tolti; oggetti 0, nomi 0/.test(out),
          out.match(/scritte:[^\n]*/)?.[0])
    const dopo = await righe(`select id::text, game_mission_id, event_id::text, run_id::text, seq from mission order by id`)
    check('stessi id, eventi, corse e ordine', JSON.stringify(prima) === JSON.stringify(dopo), `${dopo.length} missioni`)
    // una missione ancora nel gioco che le regole non danno a nessuno si
    // toglie; una uscita dal gioco resta (e' storia)
    await db.query(`insert into mission (game_mission_id, event_id, seq, imported_from)
      values (4030, 552139, 99, 'datamine'), (999999999, 552139, 98, 'datamine')`)
    const out2 = lancia()
    check('la 4030 rimessa a mano si toglie, la 999999999 resta', Number(await valore(`
      select count(*) from mission where game_mission_id = 4030`)) === 0 && Number(await valore(`
      select count(*) from mission where game_mission_id = 999999999`)) === 1, out2.match(/tolte:[^\n]*/)?.[0])
    await db.query(`delete from mission where game_mission_id = 999999999`)
  })
  // Le icone le registra fetch-assets, che nei test non gira: si mettono
  // qui le due che servono (se mancano), si rilancia e si tolgono.
  await sezione('le icone dei premi (reward_item)', async () => {
    const messe = (await righe(`
      with v(slug, name) as (values ('dragon-stone', 'Dragon Stone'), ('z-sword', 'Z Sword')),
           i as (insert into reward_item (slug) select slug from v on conflict do nothing returning slug)
      insert into reward_item_text (slug, locale, name) select v.slug, 'en', v.name from v join i using (slug)
      returning slug`)).map((r) => r.slug)
    lancia()
    const [st] = await righe(`select reward_item_slug, t.name, t.source from game_item g
      join game_item_text t using (item_type, item_id) where g.item_type = 'Point::Stone' and g.item_id = 11`)
    check('Point::Stone 11: Dragon Stone, con l\'icona dragon-stone, nome scritto da noi', st?.reward_item_slug === 'dragon-stone'
          && st?.name === 'Dragon Stone' && st?.source === 'community', JSON.stringify(st))
    const [zs] = await righe(`select reward_item_slug, t.name, t.source from game_item g
      join game_item_text t using (item_type, item_id) where g.item_type = 'TrainingItem' and t.name = 'Z-Sword [AGL]'`)
    check('"Z-Sword [AGL]": icona z-sword, nome ufficiale', zs?.reward_item_slug === 'z-sword' && zs?.source === 'official',
          JSON.stringify(zs))
    await db.query(`delete from reward_item where slug = any($1::text[])`, [messe])
  })
} finally {
  await db.end()
}

console.log(fails ? `\n  ${passes} verdi, ${fails} rosse\n` : `\n  ${passes} verifiche, TUTTO VERDE\n`)
process.exit(fails ? 1 : 0)
