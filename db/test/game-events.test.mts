// Verifica gli eventi creati dal database del gioco (load-game-events) e la
// migrazione 0011.
//
// Gira sul database di test DOPO l'import dalle cache (lo prepara
// npm run db:test, che ha gia' lanciato load-game-events e load-windows):
// controlla id, tipi, un evento nuovo con stage, difficolta' e finestra, le
// riedizioni attaccate a un evento che c'era gia', Million Arena come un
// evento solo, una Super EZA legata alla sua Normal, che un secondo giro
// non cambi niente e che il wiki non crei un doppione.
//
// Come in windows.test.mts, prima di usare un atteso si controlla che la
// cache dica ancora quello su cui e' scritto: se la cache cambia, la
// verifica e' rossa e dice perche', non verde per caso.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { int, loadTable } from '../import/datamine.mjs'
// int() di datamine.mjs restituisce null per un campo vuoto; qui servono
// numeri da confrontare e ordinare, e un -1 non combacia con nessun id
const num = (v: unknown): number => int(v) ?? -1
import { DIFF } from '../import/game-events/build.mjs'
import { heldByGame } from '../import/game-events/wiki-guard.mjs'

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

async function sezione(titolo: string, fn: () => Promise<void>) {
  console.log(`\n${titolo}`)
  try {
    await fn()
  } catch (err) {
    check(`${titolo}: interrotta da un errore`, false, (err as Error).message.split('\n')[0])
  }
}

const areas = new Map((loadTable('areas') as Riga[]).map((a) => [num(a.id), a]))
const quests = loadTable('quests') as Riga[]
const maps = loadTable('sugoroku_maps') as Riga[]
const missions = loadTable('missions') as Riga[]
const zStages = new Map((loadTable('z_battle_stages') as Riga[]).map((s) => [num(s.id), s]))
const questsOf = (area: number) => quests.filter((q) => num(q.area_id) === area).sort((a, b) => num(a.id) - num(b.id))
const mapsOf = (quest: number) => maps.filter((m) => num(m.quest_id) === quest)
function cacheDice(nome: string, got: string, atteso: string): boolean {
  return check(`cache: ${nome}`, got === atteso,
               got === atteso ? got : `dice "${got}", gli attesi sono scritti per "${atteso}": aggiornali`)
}

// un evento con nome, stage e difficolta'
async function evento(id: number) {
  const e = (await righe(`
    select e.id::text, e.kind::text, e.imported_from::text, e.wiki_title, e.banner_key, e.cover_card_id::text,
           t.name, t.official_description, t.source::text
    from event e left join event_text t on t.event_id = e.id and t.locale = 'en' where e.id = $1`, [id]))[0]
  const stages = await righe(`
    select s.seq, x.name, t.difficulty::text as d, t.sta_cost, t.exp, t.zeni, n.boss_note
    from stage s left join stage_text x on x.stage_id = s.id and x.locale = 'en'
    join stage_tier t on t.stage_id = s.id
    left join stage_tier_text n on n.stage_tier_id = t.id and n.locale = 'en'
    where s.event_id = $1 order by s.seq, t.difficulty`, [id])
  const runs = await righe(`
    select starts_at, ends_at, ends_at_known, source from event_run
    where event_id = $1 and reg = 'global' order by starts_at`, [id])
  return { e, stages, runs }
}

try {
  await sezione('migrazione 0011', async () => {
    const col = async (t: string, c: string) => (await righe(`
      select data_type, is_nullable, column_default from information_schema.columns
      where table_schema = 'public' and table_name = $1 and column_name = $2`, [t, c]))[0]
    const cover = await col('event', 'cover_card_id')
    check('event.cover_card_id: bigint, nullable', cover?.data_type === 'bigint' && cover?.is_nullable === 'YES', JSON.stringify(cover))
    const fk = await valore(`
      select confrelid::regclass::text from pg_constraint
      where conrelid = 'event'::regclass and contype = 'f' and conkey = array[(
        select attnum from pg_attribute where attrelid = 'event'::regclass and attname = 'cover_card_id')]`)
    check('event.cover_card_id punta a card', fk === 'card', String(fk))
    const src = await col('event_game_ref', 'source')
    check("event_game_ref.source: not null, per difetto 'wiki'", src?.is_nullable === 'NO' && /^'wiki'/.test(src?.column_default ?? ''), JSON.stringify(src))
    await db.query('begin')
    try {
      await db.query(`update event_game_ref set source = 'boh' where game_id = (select min(game_id) from event_game_ref)`)
      check('source fuori da wiki/game: rifiutato', false, 'accettato')
    } catch (err) {
      check('source fuori da wiki/game: rifiutato', (err as { constraint?: string }).constraint === 'event_game_ref_source')
    } finally { await db.query('rollback') }
    const rel = await col('event_game_ref', 'related_game_id')
    check('event_game_ref.related_game_id: int, nullable', rel?.data_type === 'integer' && rel?.is_nullable === 'YES')
  })

  await sezione('gli id e le righe degli eventi del gioco', async () => {
    const evs = await righe(`
      select e.id::text, e.kind::text, e.wiki_title, e.banner_key, t.name, t.official_description, t.source::text,
             g.game_kind, g.game_id, g.source as ref_source
      from event e left join event_text t on t.event_id = e.id and t.locale = 'en'
      left join event_game_ref g on g.event_id = e.id and g.via = 'game'
      where e.imported_from = 'datamine'`)
    check('ci sono eventi dal gioco (piu\' di 150)', evs.length > 150, `${evs.length}`)
    tutte('id = 1000000000 + area, 2000000000 + stage EZA, con il legame via game', evs, (e) =>
      e.game_kind === 'area' ? Number(e.id) === 1_000_000_000 + e.game_id
        : e.game_kind === 'z_battle_stage' && Number(e.id) === 2_000_000_000 + e.game_id)
    tutte('nessun titolo del wiki, banner, descrizione; nome inglese ufficiale', evs, (e) =>
      e.wiki_title === null && e.banner_key === null && e.official_description === null
      && !!e.name && !/\n/.test(e.name) && e.source === 'official' && e.ref_source === 'game')
    tutte('le EZA sono zbattle, le aree no', evs, (e) => (e.game_kind === 'z_battle_stage') === (e.kind === 'zbattle'))
    tutte('ogni evento del gioco ha almeno uno stage con una difficolta\'', await righe(`
      select e.id, count(t.id)::int as n from event e left join stage_tier t on t.event_id = e.id
      where e.imported_from = 'datamine' group by e.id`), (r) => r.n > 0)
    tutte('ogni evento del gioco ha una run Global', await righe(`
      select e.id, exists (select 1 from event_run r where r.event_id = e.id and r.reg = 'global') as ok
      from event e where e.imported_from = 'datamine'`), (r) => r.ok)
    tutte('la copertina e\' una carta che abbiamo', await righe(`
      select e.id, e.cover_card_id, exists (select 1 from card c where c.id = e.cover_card_id) as ok
      from event e where e.cover_card_id is not null`), (r) => r.ok)
    const conCopertina = await valore(`select count(*)::int from event where imported_from = 'datamine' and cover_card_id is not null`)
    check('la maggior parte degli eventi del gioco ha la copertina', conCopertina > evs.length * 0.8, `${conCopertina} su ${evs.length}`)
  })

  await sezione('i tipi, e cosa non diventa un evento', async () => {
    // categoria dell'area -> tipo atteso (la tabella di classify.mjs)
    for (const [area, cat, kind] of [[1777, '20', 'challenge'], [934, '9000', 'story'], [1213, '2', 'limited'],
                                     [1314, '7', 'story'], [1512, '10', 'challenge']] as const) {
      if (!cacheDice(`categoria dell'area ${area}`, String(areas.get(area)?.category), cat)) continue
      const k = await valore('select kind::text from event where id = $1', [1_000_000_000 + area])
      check(`area ${area} (categoria ${cat}) -> ${kind}`, k === kind, String(k))
    }
    const nessuno = await righe(`select id::text from event where id = any($1::bigint[])`,
      [[38, 39, 40, 41, 42, 1737, 1738, 807, 710, 720].map((a) => 1_000_000_000 + a)])
    check('nessun evento per i capitoli della storia, gli archivi, la categoria 27 e le Super Battle Road',
          nessuno.length === 0, nessuno.map((r) => r.id).join(', '))
    const kinds = await righe(`select distinct kind::text as k from event where imported_from = 'datamine'`)
    tutte('solo tipi che la lista del sito conosce', kinds,
          (r) => ['challenge', 'zbattle', 'limited', 'story', 'bonus', 'other'].includes(r.k))
  })

  await sezione('un evento nuovo: area 1777, Crush Their Ambition! Vs. Babidi\'s Army', async () => {
    const qs = questsOf(1777)
    cacheDice('le quest dell\'area 1777', qs.map((q) => `${q.id} ${q.name}`).join(' | '),
              '1777001 Stage 1 | 1777002 Stage 2 | 1777003 Stage 3 | 1777004 Stage 4')
    cacheDice('le mappe di 1777004', mapsOf(1777004).map((m) => `${m.id}/${m.act}`).join(' '), '17770045/0')
    const ms = [...new Set(missions.filter((m) => num(m.area_id) === 1777).map((m) => `${m.start_at} -> ${m.end_at}`))].join(' | ')
    cacheDice('le missioni dell\'area 1777', ms, '2026-10-02 08:00:00 -> 2026-10-20 07:59:59')
    const { e, stages, runs } = await evento(1_000_001_777)
    check('esiste, dal gioco, challenge', e?.imported_from === 'datamine' && e?.kind === 'challenge', JSON.stringify(e))
    check('il nome', e?.name === "Crush Their Ambition! Vs. Babidi's Army", e?.name)
    check('4 stage, Stage 1..4, una difficolta\' Super 3 ciascuno a 0 STA',
          stages.map((s) => `${s.seq} ${s.name} ${s.d} ${s.sta_cost}`).join(' | ')
            === '1 Stage 1 super3 0 | 2 Stage 2 super3 0 | 3 Stage 3 super3 0 | 4 Stage 4 super3 0',
          stages.map((s) => `${s.seq} ${s.name} ${s.d} ${s.sta_cost}`).join(' | '))
    const n4 = stages.find((s) => s.seq === 4)?.boss_note ?? ''
    check('la nota del boss dello stage 4, nel formato del wiki col nome davanti',
          n4 === 'Boss: Majin Vegeta; Damage reduction -70%; Immune to: Stun, Seal Super Attack, Lower ATK, Lower DEF', n4)
    check('la finestra Global: 2026-10-02 08:00 -> 10-20 08:00 UTC, dal gioco',
          runs.length === 1 && stesso(runs[0].starts_at, '2026-10-02T08:00:00Z')
            && stesso(runs[0].ends_at, '2026-10-20T08:00:00Z') && runs[0].ends_at_known && runs[0].source === 'game',
          JSON.stringify(runs))
    check('la copertina e\' una carta che abbiamo', !!e?.cover_card_id, String(e?.cover_card_id))
  })

  await sezione('exp e zeni: area 1213, Dragon Ball Xenoverse 2', async () => {
    cacheDice('le mappe di 1213001', mapsOf(1213001).map((m) => `${m.id}/${m.act}/${m.user_exp}/${m.zeni}`).join(' '),
              '12130010/8/1600/2500 12130012/15/9900/6000')
    const { stages } = await evento(1_000_001_213)
    const s1 = stages.filter((s) => s.seq === 1).map((s) => `${s.d}/${s.sta_cost}/${s.exp}/${s.zeni}`).join(' ')
    check('stage 1: Normal 8 STA, Z-Hard 15 STA, con exp e zeni', s1 === 'normal/8/1600/2500 z_hard/15/9900/6000', s1)
  })

  await sezione('le riedizioni vanno sull\'evento che c\'e\' gia\'', async () => {
    const ref = (await righe(`select event_id::text, via, source, confidence from event_game_ref where game_kind = 'area' and game_id = 1226`))[0]
    check('area 1226 -> evento del wiki 721748 (area 259), via rerun, dal gioco',
          ref?.event_id === '721748' && ref?.via === 'rerun' && ref?.source === 'game', JSON.stringify(ref))
    check('nessun evento 1000001226', !(await valore('select count(*)::int from event where id = 1000001226')))
    const q = questsOf(1226).map((x) => x.start_at)
    cacheDice('la partenza delle quest di 1226', [...new Set(q)].join(' '), '2026-09-13 04:30:00')
    const { runs } = await evento(721748)
    check('721748 ha la corsa del 2026-09-13 04:30 UTC, fine non nota (area senza missioni)',
          runs.some((r) => stesso(r.starts_at, '2026-09-13T04:30:00Z') && r.ends_at === null && !r.ends_at_known),
          runs.map((r) => `${r.starts_at?.toISOString()}→${r.ends_at?.toISOString?.() ?? null}`).join('; '))
    const ref47 = (await righe(`select event_id::text, via from event_game_ref where game_kind = 'area' and game_id = 1747`))[0]
    check('area 1747 -> l\'evento creato da 1708, uscito prima del taglio', ref47?.event_id === '1000001708' && ref47?.via === 'rerun', JSON.stringify(ref47))
    const { runs: r08 } = await evento(1_000_001_708)
    check('1708 ha due corse: dicembre 2024 e agosto 2026 (quella di 1747)', r08.length === 2
          && r08[0].starts_at.toISOString().startsWith('2024-12') && r08[1].starts_at.toISOString().startsWith('2026-08'),
          r08.map((r) => r.starts_at.toISOString()).join(', '))
    for (const [area, ev] of [[291, '628060'], [292, '274178'], [285, '561817']] as const) {
      const r = await valore(`select event_id::text from event_game_ref where game_kind = 'area' and game_id = $1`, [area])
      check(`area vecchia ${area} -> evento del wiki ${ev}`, r === ev, String(r))
    }
  })

  await sezione('Million Arena: quattro aree, un evento', async () => {
    const refs = await righe(`select game_id, event_id::text, via from event_game_ref where game_kind = 'area' and game_id in (1717, 1718, 1719, 1721) order by 1`)
    check('le quattro aree puntano a 1000001717', refs.length === 4 && refs.every((r) => r.event_id === '1000001717'),
          refs.map((r) => `${r.game_id}:${r.event_id}:${r.via}`).join(' '))
    check('nessun evento per 1718, 1719, 1721',
          !(await valore('select count(*)::int from event where id in (1000001718, 1000001719, 1000001721)')))
    const { e, stages } = await evento(1_000_001_717)
    check('si chiama Million Arena', e?.name === 'Million Arena', e?.name)
    const nomi = stages.map((s) => s.name)
    check('sei stage, nomi tutti diversi', nomi.length === 6 && new Set(nomi).size === 6, nomi.join(' | '))
  })

  await sezione('EZA: la Normal 214 e la Super 711', async () => {
    cacheDice('lo stage 711', `${zStages.get(711)?.type} ${zStages.get(711)?.related_z_battle_stage_id}`, 'ZBattleStage::Super 6.0')
    const sup = await evento(2_000_000_711)
    check('la Super 711 e\' un evento a se\', zbattle', sup.e?.kind === 'zbattle' && sup.e?.imported_from === 'datamine', JSON.stringify(sup.e))
    check('nome con "Super" davanti', sup.e?.name === 'Super Extreme Z-Battle: Surpassing All Perfect Cell', sup.e?.name)
    const ref = (await righe(`select related_game_id, source from event_game_ref where game_kind = 'z_battle_stage' and game_id = 711`))[0]
    check('il legame ricorda la Normal (stage 6)', ref?.related_game_id === 6 && ref?.source === 'game', JSON.stringify(ref))
    const normal = await valore(`select e.imported_from::text from event_game_ref g join event e on e.id = g.event_id
                                 where g.game_kind = 'z_battle_stage' and g.game_id = 6`)
    check('e la Normal 6 ha il suo evento (del wiki)', normal === 'wiki', String(normal))
    check('un livello, 25 STA (il checkpoint)', sup.stages.length === 1 && sup.stages[0].d === 'eza_level' && sup.stages[0].sta_cost === 25,
          JSON.stringify(sup.stages))
    check('aperta per sempre dal 2025-02-17', sup.runs.length === 1 && sup.runs[0].ends_at === null && sup.runs[0].ends_at_known,
          JSON.stringify(sup.runs))

    const eza = await evento(2_000_000_214)
    check('214: 10 livelli', eza.stages.length === 10 && eza.stages.every((s) => s.d === 'eza_level'), `${eza.stages.length}`)
    check('214: stamina solo al checkpoint (livello 10, 15 STA)',
          eza.stages.filter((s) => s.sta_cost != null).map((s) => `${s.seq}:${s.sta_cost}`).join() === '10:15')
    check('214: livello 1', eza.stages[0]?.boss_note === 'Boss: Buu (Super); Damage reduction -70%; Immune to: Stun', eza.stages[0]?.boss_note)
    check('214: livello 10', eza.stages[9]?.boss_note === 'Boss: Buu (Super); Damage reduction -90%; Immune to: Stun, Seal Super Attack, Lower ATK, Lower DEF',
          eza.stages[9]?.boss_note)
    check('214: in lista dal 2026-10-05 05:00 al 10-20 08:00 UTC',
          eza.runs.length === 1 && stesso(eza.runs[0].starts_at, '2026-10-05T05:00:00Z') && stesso(eza.runs[0].ends_at, '2026-10-20T08:00:00Z'),
          JSON.stringify(eza.runs))
  })

  await sezione('la difficolta\' dal codice della mappa, contro il wiki', async () => {
    // sugoroku_maps.id % 10 -> la difficolta': su questi eventi del wiki
    // (tutti i codici, 0-5) coincide stage per stage con quella che load-events
    // ha letto dalla pagina. Gli stage si appaiano per posizione; quelli che
    // una riedizione ha aggiunto (game_quest_id, 52097 dall'area 613) non
    // sono del wiki e restano fuori.
    for (const [ev, area] of [[477, 411], [18261, 135], [52097, 602], [75370, 527], [709319, 760], [712688, 770]] as const) {
      const wiki = await righe(`select s.seq, string_agg(t.difficulty::text, ',' order by t.difficulty::text) as d
        from stage s join stage_tier t on t.stage_id = s.id where s.event_id = $1 and s.game_quest_id is null
        group by s.seq order by s.seq`, [ev])
      const qs = questsOf(area)
      const game = qs.map((q) => [...new Set(mapsOf(num(q.id)).map((m) => DIFF[num(m.id) % 10]))].sort().join(','))
      check(`evento ${ev} (area ${area})`, wiki.length > 0 && wiki.length === game.length && wiki.every((w, i) => w.d === game[i]),
            `wiki ${wiki.map((w) => w.d).join(' | ')}; gioco ${game.join(' | ')}`)
    }
  })

  await sezione('niente doppioni col wiki', async () => {
    const dup = await righe(`select game_kind, game_id, count(distinct event_id)::int as n from event_game_ref group by 1, 2 having count(distinct event_id) > 1`)
    check('ogni area/EZA e\' di un evento solo', dup.length === 0, JSON.stringify(dup.slice(0, 3)))
    // le quest degli archivi le lega load-windows (source 'wiki') anche agli
    // eventi del gioco, le edizioni: non sono aree contese, e restano fuori
    const wikiHeld = await valore(`select count(*)::int from event_game_ref g join event e on e.id = g.event_id
                                   where e.imported_from = 'datamine' and g.source <> 'game' and g.game_kind <> 'quest'`)
    check('nessun legame del wiki su un evento del gioco', wikiHeld === 0, String(wikiHeld))
    // la guardia di load-events: una pagina "nuova" che ritrova un'area gia'
    // di un evento del gioco. 709063 e' legata all'area 221: fingiamo che
    // l'area sia di un evento del gioco, e che la pagina non sia ancora nel db.
    const cache = JSON.parse(readFileSync(new URL('../import/.cache/wiki-events.json', import.meta.url), 'utf8'))
    const page = cache.pages.find((p: Riga) => p.pageid === 709063)
    const area = await valore(`select game_id from event_game_ref where event_id = 709063 and game_kind = 'area' and source = 'wiki' order by 1 limit 1`)
    const stages = (await righe(`select x.name from stage s join stage_text x on x.stage_id = s.id and x.locale = 'en'
                                 where s.event_id = 709063 order by s.seq`)).map((r) => ({ name: r.name }))
    const fresh = [{ event: { id: 709063, kind: 'limited', wiki_title: page?.title }, text: { name: page?.title }, stages }]
    const hit = heldByGame(fresh, cache.pages, [{ game_kind: 'area', game_id: area, event_id: 1_000_000_000 + area }])
    check('load-events salterebbe la pagina 709063 se la sua area fosse del gioco', hit.get(709063)?.game_id === area,
          `area ${area}, trovato ${JSON.stringify(hit.get(709063) ?? null)}`)
    const nessuno = heldByGame(fresh, cache.pages, [{ game_kind: 'area', game_id: 1777, event_id: 1_000_001_777 }])
    check('e non la salta per un\'area che non c\'entra', nessuno.size === 0)
  })

  await sezione('un secondo giro non cambia niente', async () => {
    // una fotografia di tutto quello che load-game-events scrive, id compresi
    const foto = async () => valore(`select md5(string_agg(x, '|' order by x)) from (
      select concat_ws(',', e.id, e.kind, e.cover_card_id, case when e.imported_from = 'datamine' then e.imported_at end, t.name) as x
        from event e join event_text t on t.event_id = e.id where e.imported_from = 'datamine' or e.cover_card_id is not null
      union all select concat_ws(',', g.game_kind, g.game_id, g.event_id, g.via, g.keys::text, g.confidence, g.source, g.related_game_id)
        from event_game_ref g
      union all select concat_ws(',', t.id, t.stage_id, s.seq, x.name, t.difficulty, t.sta_cost, t.exp, t.zeni, n.boss_note)
        from stage_tier t join stage s on s.id = t.stage_id join event e on e.id = t.event_id
        left join stage_text x on x.stage_id = s.id left join stage_tier_text n on n.stage_tier_id = t.id
        where e.imported_from = 'datamine'
      union all select concat_ws(',', r.id, r.event_id, r.starts_at, r.ends_at, r.ends_at_known, r.source)
        from event_run r join event e on e.id = r.event_id where e.imported_from = 'datamine') q`)
    const prima = await foto()
    const quanti = await valore(`select count(*)::int from event`)
    const out = lancia('load-game-events.mjs')
    console.log(out.split('\n').filter((l) => /^ {4}(eventi|legami|stage|difficolta'|copertine)/.test(l)).map((l) => `      ${l.trim()}`).join('\n'))
    check('load-game-events: niente di nuovo ne\' di cambiato',
          /eventi\s+nuovi 0, cambiati 0, nomi scritti o cambiati 0/.test(out) && /legami\s+\d+: nuovi 0, cambiati 0, tolti 0/.test(out)
          && /stage\s+\d+: nuovi 0, tolti 0, nomi scritti o cambiati 0/.test(out)
          && /difficolta'\s+\d+: nuove 0, cambiate 0, tolte 0; note scritte o cambiate 0/.test(out)
          && /copertine del wiki cambiate 0/.test(out))
    check('stampa il database su cui scrive', /database: .*_test/.test(out))
    check('la fotografia e\' uguale', (await foto()) === prima)
    lancia('load-windows.mjs')
    check('anche dopo load-windows', (await foto()) === prima)
    // il wiki rilanciato non crea doppioni ne' tocca gli eventi del gioco
    lancia('load-events.mjs')
    lancia('load-game-events.mjs')
    lancia('load-windows.mjs')
    check('anche dopo load-events + load-game-events + load-windows', (await foto()) === prima)
    check('e il numero di eventi non cambia', (await valore(`select count(*)::int from event`)) === quanti)
  })

  await sezione('lo stato su Global, con gli eventi del gioco', async () => {
    const stato = await righe(`
      with u as (
        select distinct on (es.event_id) es.event_id, es.status, r.ends_at, r.ends_at_known
        from event_status es join event_run r on r.id = es.run_id
        join event e on e.id = es.event_id
        where es.reg = 'global' and e.imported_from = 'datamine'
        order by es.event_id, case es.status when 'active' then 0 when 'upcoming' then 1 else 2 end,
                 case when es.status = 'upcoming' then es.starts_at end asc nulls last, es.starts_at desc)
      select status, (ends_at is null) as aperta, ends_at_known as nota, count(*)::int as n from u group by 1, 2, 3`)
    console.log(`        ${stato.map((r) => `${r.status}${r.aperta ? (r.nota ? ' permanente' : ' fine non nota') : ' con la fine'}: ${r.n}`).join(', ')}`)
    const n = (f: (r: Riga) => boolean) => stato.filter(f).reduce((a, r) => a + r.n, 0)
    check('ci sono eventi del gioco conclusi, in corso con la fine e permanenti',
          n((r) => r.status === 'past') > 0 && n((r) => r.status === 'active' && !r.aperta) > 0
          && n((r) => r.status === 'active' && r.aperta && r.nota) > 0)
  })
} finally {
  await db.end()
}

console.log(fails ? `\n  ${passes} verdi, ${fails} rosse\n` : `\n  ${passes} verifiche, TUTTO VERDE\n`)
process.exit(fails ? 1 : 0)
