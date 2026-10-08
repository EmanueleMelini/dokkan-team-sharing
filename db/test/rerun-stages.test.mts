// Verifica gli stage che le riedizioni aggiungono a un evento che c'e' gia'
// (load-game-events, game-events/rerun-stages.mjs, migrazione 0017).
//
// Gira sul database di test DOPO l'import dalle cache: 552139 Looming
// Menace prende lo stage 4 dalla riedizione 616, una Extreme Z-Area
// riproposta il suo "Extreme Stage", un archivio non ripete lo stage che
// l'area dell'edizione ha gia' aggiunto, nessun evento ha due stage con lo
// stesso nome, gli stage propri non si muovono, e un secondo giro (anche
// dopo load-events e load-windows) non cambia niente.
//
// Prima di usare un atteso si controlla che la cache dica ancora quello su
// cui e' scritto: se la cache cambia, la verifica e' rossa e dice perche'.
import { execFileSync } from 'node:child_process'
import pg from 'pg'
import { int, loadTable } from '../import/datamine.mjs'
import { DIFF } from '../import/game-events/build.mjs'
import { makeRoom, writeRerunStages } from '../import/game-events/write-rerun.mjs'

let fails = 0
let passes = 0
function check(nome: string, ok: boolean, dettaglio = ''): boolean {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nome}${dettaglio ? `  (${dettaglio})` : ''}`)
  if (ok) passes++
  else fails++
  return ok
}

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

// la cache: quest e mappe, per gli attesi
const quests = new Map((loadTable('quests') as Riga[]).map((q) => [int(q.id), q]))
const allMaps = loadTable('sugoroku_maps') as Riga[]
const mapsOf = (questId: number) => allMaps
  .filter((m) => int(m.quest_id) === questId).sort((a, b) => (int(a.id) ?? 0) - (int(b.id) ?? 0))

// gli stage di un evento, in ordine, con le difficolta'
const stagesOf = (ev: number) => righe(`
  select s.id, s.seq, s.game_quest_id, x.name,
         coalesce(json_agg(json_build_object('id', t.id, 'difficulty', t.difficulty, 'sta', t.sta_cost,
                  'exp', t.exp, 'zeni', t.zeni, 'note', n.boss_note) order by t.difficulty)
                  filter (where t.id is not null), '[]') as tiers
  from stage s left join stage_text x on x.stage_id = s.id and x.locale = 'en'
  left join stage_tier t on t.stage_id = s.id
  left join stage_tier_text n on n.stage_tier_id = t.id and n.locale = 'en'
  where s.event_id = $1 group by s.id, x.name order by s.seq`, [ev])

// Lo stage aggiunto da una quest: in coda, col nome del gioco, e una
// difficolta' per mappa con stamina, exp e zeni della mappa.
async function aggiunto(ev: number, questId: number, nome: string) {
  const q = quests.get(questId)
  const maps = mapsOf(questId)
  if (!check(`cache: la quest ${questId} si chiama "${nome}" e ha delle mappe`, q?.name === nome && maps.length > 0,
             `${JSON.stringify(q?.name)}, ${maps.length} mappe`)) return
  const st = await stagesOf(ev)
  const mine = st.filter((s) => s.game_quest_id === questId)
  const own = st.filter((s) => s.game_quest_id == null)
  check(`evento ${ev}: uno stage dalla quest ${questId}`, mine.length === 1, `${mine.length}`)
  const s = mine[0]
  if (!s) return
  check(`evento ${ev}: si chiama "${nome}" e sta dopo gli stage propri`,
        s.name === nome && own.every((o) => o.seq < s.seq), `seq ${s.seq}, propri ${own.map((o) => o.seq).join(',')}`)
  const want = maps.map((m) => ({ difficulty: DIFF[(int(m.id) ?? 0) % 10], sta: int(m.act), exp: int(m.user_exp), zeni: int(m.zeni) }))
  const got = s.tiers.map((t: Riga) => ({ difficulty: t.difficulty, sta: t.sta, exp: t.exp, zeni: t.zeni }))
  const ord = (a: Riga[]) => JSON.stringify([...a].sort((x, y) => x.difficulty.localeCompare(y.difficulty)))
  check(`evento ${ev}: le difficolta' sono quelle delle mappe (sugoroku_maps.id % 10, act, user_exp, zeni)`,
        ord(got) === ord(want), `${ord(got)} contro ${ord(want)}`)
  check(`evento ${ev}: ogni difficolta' ha la nota sul boss`,
        s.tiers.length > 0 && s.tiers.every((t: Riga) => /^Boss: /.test(t.note ?? '')),
        s.tiers.map((t: Riga) => t.note).join(' | '))
}

// Una fotografia di tutti gli stage di tutti gli eventi, id compresi: un
// secondo giro deve lasciarla uguale.
const foto = () => valore(`select md5(string_agg(x, '|' order by x)) from (
  select concat_ws(',', s.id, s.event_id, s.seq, s.game_quest_id, x.name, t.id, t.difficulty, t.sta_cost, t.exp, t.zeni, n.boss_note) as x
  from stage s left join stage_text x on x.stage_id = s.id and x.locale = 'en'
  left join stage_tier t on t.stage_id = s.id
  left join stage_tier_text n on n.stage_tier_id = t.id and n.locale = 'en') q`)

try {
  await sezione('migrazione 0017', async () => {
    const col = (await righe(`select data_type, is_nullable from information_schema.columns
                              where table_name = 'stage' and column_name = 'game_quest_id'`))[0]
    check('stage.game_quest_id: integer, nullabile', col?.data_type === 'integer' && col?.is_nullable === 'YES', JSON.stringify(col))
    check('unico per (evento, quest)', (await valore(`select count(*)::int from pg_constraint
      where conname = 'stage_event_id_game_quest_id_key' and contype = 'u'`)) === 1)
  })

  await sezione('Looming Menace (552139) prende lo stage 4 dalla riedizione 616', async () => {
    const ref = await valore(`select via from event_game_ref where event_id = 552139 and game_kind = 'area' and game_id = 616`)
    check('l\'area 616 e\' legata a 552139 come riedizione', ref === 'rerun', String(ref))
    const st = await stagesOf(552139)
    const own = st.filter((s) => s.game_quest_id == null)
    check('i tre stage del wiki restano i primi, senza quest',
          own.length === 3 && own.map((s) => s.seq).join() === '1,2,3', st.map((s) => `${s.seq}:${s.name}`).join(' / '))
    check('in tutto quattro stage', st.length === 4, `${st.length}`)
    check('lo stage 4 e\' quello della quest 616004', st[3]?.seq === 4 && st[3]?.game_quest_id === 616004)
    await aggiunto(552139, 616004, 'Extreme Stage')
  })

  await sezione('le Extreme Z-Area riproposte: il loro Extreme Stage', async () => {
    // 614 e' la riedizione di 339306, con un "Extreme Stage" che il wiki non ha
    const ev = Number(await valore(`select event_id from event_game_ref where game_kind = 'area' and game_id = 614`))
    check('l\'area 614 e\' legata a 339306', ev === 339306, String(ev))
    await aggiunto(339306, 614004, 'Extreme Stage')
    // 52097 ha gia' dal wiki lo stage 4 ([VS. Extreme AGL]): la quest 613004
    // e' quello (per ordine), e si aggiunge solo il Super Extreme Stage
    const st = await stagesOf(52097)
    check('52097: niente "Extreme Stage" in piu\' (lo stage 4 del wiki e\' quello)',
          !st.some((s) => s.game_quest_id === 613004), st.map((s) => `${s.seq}:${s.name}`).join(' / '))
    await aggiunto(52097, 613005, 'Super Extreme Stage')
  })

  await sezione('un archivio non ripete lo stage dell\'edizione', async () => {
    // 712687 ha 7 stage dal wiki; l'area dell'edizione 771 ne ha 8, e
    // l'archivio 1737 ripropone gli stessi 8 come "Movie Edition Stage N"
    const st = await stagesOf(712687)
    await aggiunto(712687, 771008, 'Movie Boss Rush')
    check('712687: nessuno stage dall\'archivio 1737', !st.some((s) => int(quests.get(s.game_quest_id)?.area_id) === 1737), st.map((s) => `${s.seq}:${s.name}`).join(' / '))
    check('712687: otto stage', st.length === 8, `${st.length}`)
  })

  await sezione('un evento del gioco con la sua riedizione (1708 + 1747)', async () => {
    const st = await stagesOf(1_000_001_708)
    check('lo stage proprio resta il primo', st[0]?.seq === 1 && st[0]?.game_quest_id == null, JSON.stringify(st[0]?.name))
    await aggiunto(1_000_001_708, 1747002, 'The Gendarmerie Closing In!')
  })

  await sezione('nessun doppione', async () => {
    const dup = await righe(`
      select s.event_id, x.name, count(*)::int as n from stage s
      join stage_text x on x.stage_id = s.id and x.locale = 'en'
      where s.event_id in (select event_id from stage where game_quest_id is not null)
      group by 1, 2 having count(*) > 1`)
    check('negli eventi con stage delle riedizioni nessun nome si ripete', dup.length === 0, JSON.stringify(dup.slice(0, 3)))
    const n = await valore(`select count(*)::int from stage where game_quest_id is not null`)
    check('ci sono stage delle riedizioni', n > 0, `${n}`)
    const senza = await valore(`select count(*)::int from stage s where game_quest_id is not null
                                and not exists (select 1 from stage_tier t where t.stage_id = s.id)`)
    check('ognuno ha almeno una difficolta\'', senza === 0, `${senza} senza`)
  })

  await sezione('se la fonte dell\'evento vuole il suo seq, lo stage si sposta in coda', async () => {
    // in una transazione che si annulla: il wiki che scrive uno stage 4 per 552139
    const prima = (await stagesOf(552139)).find((s) => s.game_quest_id === 616004)
    await db.query('begin')
    try {
      const n = await makeRoom(db, [{ ev: 552139, seq: 4 }])
      const dopo = (await stagesOf(552139)).find((s) => s.game_quest_id === 616004)
      check('makeRoom ne sposta uno', n === 1, `${n}`)
      check('stesso id e stesse difficolta\', al seq 5', dopo?.id === prima?.id && dopo?.seq === 5
            && JSON.stringify(dopo?.tiers) === JSON.stringify(prima?.tiers), `seq ${dopo?.seq}`)
      check('il seq 4 e\' libero', (await valore(`select count(*)::int from stage where event_id = 552139 and seq = 4`)) === 0)
    } finally {
      await db.query('rollback')
    }
  })

  await sezione('uno stage che il piano non da\' piu\' se ne va (senza clear ne\' tip)', async () => {
    await db.query('begin')
    try {
      const r = await writeRerunStages(db, [])
      check('senza piano: tolti tutti, e niente scritto', r.stages === 0 && r.stageGone > 0
            && (await valore(`select count(*)::int from stage where game_quest_id is not null`)) === 0, JSON.stringify(r))
      check('gli stage propri restano', (await stagesOf(552139)).length === 3)
    } finally {
      await db.query('rollback')
    }
  })

  await sezione('un secondo giro non cambia niente', async () => {
    const prima = await foto()
    const out = lancia('load-game-events.mjs')
    const riga = out.split('\n').find((l) => /stage delle riedizioni/.test(l)) ?? ''
    console.log(`      ${riga.trim()}`)
    check('load-game-events: niente di nuovo, cambiato o tolto',
          /stage delle riedizioni [1-9]\d* su \d+ eventi: nuovi 0, tolti 0, nomi scritti o cambiati 0; difficolta' \d+: nuove 0, cambiate 0, tolte 0; note 0/.test(riga))
    check('la fotografia e\' uguale', (await foto()) === prima)
    // il wiki rilanciato non toglie gli stage delle riedizioni, e il giro
    // dopo non li ricrea con un altro id
    lancia('load-events.mjs')
    check('dopo load-events gli stage delle riedizioni ci sono ancora', (await foto()) === prima)
    lancia('load-game-events.mjs')
    lancia('load-windows.mjs')
    check('anche dopo load-events + load-game-events + load-windows', (await foto()) === prima)
  })
} finally {
  await db.end()
}

console.log(fails ? `\n  ${passes} verdi, ${fails} rosse\n` : `\n  ${passes} verifiche, TUTTO VERDE\n`)
process.exit(fails ? 1 : 0)
