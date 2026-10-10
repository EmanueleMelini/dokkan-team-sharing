// Verifica le carte che esistono solo nel datamine (load-game-cards,
// db/import/game-cards.mjs, migrazione 0015): le regole di scelta su righe
// finte, la scelta sul CSV vero (le 45 attese e le 13 scartate, ognuna
// col suo motivo), le righe scritte con l'epiteto NULL, l'arricchimento di
// load-datamine (link, categorie, risvegli), un secondo giro che non
// cambia niente, la pagina abbozzata che load-cards riconosce (1034150) e
// il giorno in cui il wiki documenta una di queste carte.
//
// Gira sul database di test dopo l'import dalle cache (npm run db:test).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { decodeElement, decodeRarity, loadTable } from '../import/datamine.mjs'
import { pickGameCards } from '../import/game-cards.mjs'

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
    male.length ? `${male.length} su ${righe.length} non tornano, per esempio ${JSON.stringify(male[0])}` : `${righe.length} righe`)
}
async function sezione(titolo: string, fn: () => Promise<void> | void) {
  console.log(`\n${titolo}`)
  try {
    await fn()
  } catch (err) {
    check(`${titolo}: interrotta da un errore`, false, (err as Error).message.split('\n')[0])
  }
}

// ------------------------------------------------- regole su righe finte

// Una riga di cards.csv con i soli campi che la scelta legge.
type Csv = Record<string, string>
const riga = (id: number, extra: Partial<Csv> = {}): Csv => ({
  id: String(id), name: 'Test Unit', element: '12', rarity: '4',
  passive_skill_set_id: '1.0', link_skill1_id: '1.0',
  leader_skill_set_id: `${Math.floor(id / 10)}.0`, open_at: '2026-09-01 05:00:00', ...extra,
})
const OGGI = new Date('2026-10-08T00:00:00Z')
const ids = (rows: Csv[], covered: number[] = []) =>
  pickGameCards(rows, new Set(covered), OGGI).cards.map((c: { id: number }) => c.id)

await sezione('regole della scelta (righe finte)', () => {
  check('una unita\' uscita senza pagina entra', ids([riga(1990010)]).join() === '1990010')
  check('base e Z-awakened sono una carta sola, con l\'id della base',
    ids([riga(1990010), riga(1990011)]).join() === '1990010')
  const { cards } = pickGameCards([riga(1990010, { element: '2', rarity: '3' }), riga(1990011, { element: '22', rarity: '4' })], new Set(), OGGI)
  check('la forma base prende la classe dalla Z-awakened, tipo e rarita\' dalla base',
    cards[0]?.type === 'INT' && cards[0]?.cls === 'Extreme' && cards[0]?.rarity === 'SSR', JSON.stringify(cards[0]))
  check('nome ripulito dagli spazi', pickGameCards([riga(1990010, { name: ' Goku  (GT)  ' })], new Set(), OGGI).cards[0]?.name === 'Goku (GT)')
  check('la data Global e\' il giorno UTC di open_at',
    pickGameCards([riga(1990010, { open_at: '2026-09-29 13:00:00' })], new Set(), OGGI).cards[0]?.global_release === '2026-09-29')
  check('2038 = non uscita su Global: fuori', ids([riga(1990010, { open_at: '2038-01-01 00:00:00' })]).length === 0)
  check('annunciata ma non ancora uscita: fuori', ids([riga(1990010, { open_at: '2026-10-20 05:00:00' })]).length === 0)
  check('senza passiva ne\' link e\' un oggetto: fuori',
    ids([riga(1990010, { passive_skill_set_id: '', link_skill1_id: '' })]).length === 0)
  check('solo la passiva basta', ids([riga(1990010, { link_skill1_id: '' })]).length === 1)
  check('prefissi 4, 7, 9 e id lunghi: fuori',
    ids([riga(4990010), riga(7990010), riga(9990010), riga(50003011)]).length === 0)
  check('unita\' gia\' coperta dal wiki (anche con l\'id Z-awakened): fuori',
    ids([riga(1990010), riga(1990020)], [1990011]).join() === '1990020')
  check('data minima del lancio (2015-10-30): fuori', ids([riga(1990010, { open_at: '2015-10-30 00:00:00' })]).length === 0)
  check('ristampa (stesso set leader, nome, tipo e rarita\' di un\'altra unita\'): fuori',
    ids([riga(1990010), riga(1990520, { leader_skill_set_id: '199001.0' })], [1990010]).length === 0)
  check('set leader condiviso ma tipo diverso (le Metal Cooler): dentro',
    ids([riga(1990010), riga(1990520, { leader_skill_set_id: '199001.0', element: '13' })], [1990010]).join() === '1990520')
  check('classe non decifrabile da nessuna forma: fuori', ids([riga(1990010, { element: '3' })]).length === 0)
})

// ------------------------------------------------------------ il bersaglio

const url = process.env.TEST_DATABASE_URL ?? ''
let nomeDb = ''
try { nomeDb = decodeURIComponent(new URL(url).pathname.slice(1)) } catch { /* resta vuoto */ }
if (!nomeDb.endsWith('_test')) {
  console.error('\n  mi fermo: TEST_DATABASE_URL deve puntare a un database il cui nome finisce per _test')
  console.error('  (lancialo dentro  npm run db:test)\n')
  process.exit(2)
}
console.log(`\n  database: ${nomeDb}`)
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
const script = (nome: string, env: Record<string, string> = {}) =>
  execFileSync(process.execPath, [new URL(`../import/${nome}`, import.meta.url).pathname],
    { env: { ...process.env, DATABASE_URL: url, ...env }, encoding: 'utf8' })

// Gli attesi, scritti sul datamine del 2026-10-02 (commit 86e8684). Un
// aggiornamento puo' aggiungere carte nuove, ma queste devono restare.
// 1034150 non c'e' piu': ha una pagina abbozzata sul wiki, e load-cards la
// riconosce dal nome, dal tipo, dalla classe e dalla rarita' (wiki-card.mjs).
const ATTESE = [
  1020410, 1030310, 1031350, 1032710, 1032770, 1033720, 1033950, 1033960, 1033970, 1033990,
  1034000, 1034010, 1034020, 1034030, 1034050, 1034060, 1034070, 1034080, 1034090, 1034100,
  1034110, 1034120, 1034130, 1034140, 1034160, 1034170, 1034180, 1034190, 1034200,
  1034270, 1034400, 1034410, 1034420, 1034430, 1034540, 1034550, 1034560, 1034610, 1034620,
  1034630, 1034640, 1034650, 1034660, 1034690, 1034700,
]
const SCARTATE: Record<number, RegExp> = {
  1001870: /data minima/, 1002230: /data minima/, 1002540: /data minima/, 1002550: /data minima/, 1003910: /data minima/,
  1031770: /copia di 1031760/, 1031780: /copia di 1032160/, 1031790: /copia di 1032170/,
  1031800: /copia di 1032180/, 1031810: /copia di 1032190/,
  1032520: /copia di 1012360/, 1034460: /copia di 1026250/, 1034480: /copia di 1028790/,
}
const csv = loadTable('cards')
const csvById = new Map(csv.map((r: Csv) => [r.id, r]))

await sezione('la scelta sul datamine vero', async () => {
  const covered = new Set((await righe('select id from card where wiki_title is not null')).map((r) => Number(r.id)))
  const { cards, skipped } = pickGameCards(csv, covered)
  const scelte = new Set(cards.map((c: { id: number }) => c.id))
  tutte('le 45 attese sono scelte', ATTESE, (id) => scelte.has(id))
  check('1034150 no: ha la pagina abbozzata', !scelte.has(1034150) && covered.has(1034150))
  const perId = new Map(skipped.map((s: { id: number; why: string }) => [s.id, s.why]))
  tutte('le 13 scartate lo sono, col loro motivo', Object.entries(SCARTATE),
    ([id, re]) => re.test(perId.get(Number(id)) ?? ''))
  tutte('nessuna scelta ha gia\' una pagina wiki', cards, (c: { id: number }) => !covered.has(c.id))
  check('la stessa unita\' del wiki (1016581) non rientra con l\'id base 1016580', !scelte.has(1016580))
})

const statoCarte = async () => (await righe(`
  select (select count(*) from card)::int carte, (select count(*) from card_text)::int testi,
         (select count(*) from card_release)::int uscite, (select count(*) from card_link)::int link,
         (select count(*) from card_category)::int categorie,
         (select count(*) from card where awakens_from is not null)::int risvegli,
         (select count(*) from card where wiki_title is null and imported_from = 'datamine')::int solo_gioco`))[0]

// Tutto quello che il passaggio al wiki tocca su 1034200, per vedere che
// torna com'era (imported_at a parte, che e' l'ora del giro).
const riga1034200 = async () => (await righe(`
  select c.type::text, c.class::text, c.rarity::text, c.imported_from::text, c.wiki_title, c.hp,
         c.has_eza, c.awakens_from::text, t.name, t.epithet, t.passive, t.source::text,
         (select json_agg(r.reg || ' ' || r.released_at order by r.reg) from card_release r where r.card_id = c.id) uscite,
         (select json_agg(l.link_id order by l.link_id) from card_link l where l.card_id = c.id) link,
         (select json_agg(k.category_id order by k.category_id) from card_category k where k.card_id = c.id) cat,
         (select json_agg(e.id order by e.id) from event e where e.cover_card_id = c.id) copertine
  from card c join card_text t on t.card_id = c.id and t.locale = 'en' where c.id = 1034200`))[0]

await sezione('le righe scritte', async () => {
  const rs = await righe(`
    select c.id::int, c.type::text, c.class::text cls, c.rarity::text, c.imported_from::text src,
           c.wiki_title, c.hp, t.name, t.epithet, t.leader_skill, t.passive,
           (select released_at::text from card_release r where r.card_id = c.id and r.reg = 'global') glb,
           (select count(*) from card_release r where r.card_id = c.id and r.reg = 'japan')::int jp
    from card c join card_text t on t.card_id = c.id and t.locale = 'en'
    where c.id = any($1::bigint[])`, [ATTESE])
  check('ci sono tutte le 45, una riga ciascuna', rs.length === ATTESE.length, `${rs.length}`)
  tutte('epiteto NULL, niente wiki_title, imported_from datamine', rs,
    (r) => r.epithet === null && r.wiki_title === null && r.src === 'datamine')
  tutte('niente statistiche ne\' testi delle skill inventati', rs,
    (r) => r.hp === null && r.leader_skill === null && r.passive === null)
  tutte('nome inglese del gioco', rs, (r) => r.name === csvById.get(String(r.id))?.name.replace(/\s+/g, ' ').trim())
  tutte('tipo e rarita\' con la decodifica di load-datamine', rs, (r) => {
    const c = csvById.get(String(r.id))!
    const z = csvById.get(String(r.id + 1))
    const cls = decodeElement(c.element)?.cls ?? decodeElement(z?.element)?.cls
    return r.type === decodeElement(c.element)?.type && r.cls === cls && r.rarity === decodeRarity(c.rarity)
  })
  tutte('uscita Global = giorno di open_at, nessuna data Japan inventata', rs,
    (r) => r.glb === csvById.get(String(r.id))?.open_at.slice(0, 10) && r.jp === 0)
  check('le carte del wiki hanno tutte l\'epiteto',
    Number(await valore(`select count(*) from card c join card_text t on t.card_id = c.id
                         where c.wiki_title is not null and t.epithet is null`)) === 0)
  check('nessun epiteto vuoto: NULL e\' l\'unico modo di dire "non c\'e\'"',
    Number(await valore(`select count(*) from card_text where btrim(epithet) = ''`)) === 0)
})

await sezione('vincoli della 0015', async () => {
  let errore = ''
  try {
    await db.query(`update card_text set epithet = ' ' where card_id = 1034200 and locale = 'en'`)
  } catch (err) { errore = (err as Error).message }
  check('un epiteto di soli spazi viene rifiutato', /card_text_epithet_not_blank/.test(errore), errore)
  const piano = await righe(`select indexdef from pg_indexes where indexname = 'card_text_search'`)
  check('l\'indice di ricerca regge l\'epiteto NULL (coalesce)', /coalesce\(epithet/i.test(piano[0]?.indexdef ?? ''), piano[0]?.indexdef)
})

await sezione('arricchite da load-datamine', async () => {
  const rs = await righe(`
    select c.id::int,
           (select count(*) from card_link l where l.card_id = c.id)::int link,
           (select count(*) from card_category k where k.card_id = c.id)::int cat
    from card c where c.id = any($1::bigint[])`, [ATTESE])
  tutte('ogni carta ha i suoi link skill', rs, (r) => r.link >= 4)
  tutte('ogni carta ha le sue categorie', rs, (r) => r.cat >= 1)
  const l = await righe(`select link_id::int from card_link where card_id = 1034200 order by 1`)
  const attesi = [1, 2, 3, 4, 5, 6, 7].map((n) => Number(csvById.get('1034200')![`link_skill${n}_id`]))
    .filter((x) => x > 0).sort((a, b) => a - b)
  check('i link di 1034200 sono quelli del gioco', l.map((r) => r.link_id).join() === attesi.join(), l.map((r) => r.link_id).join())
  // Le rotte del gioco vanno fra forme Z-awakened (1034131 -> 1034141):
  // qui devono arrivare sulle basi, che sono le nostre carte.
  const catene: [number, number][] = [[1034140, 1034130], [1034150, 1034140], [1034200, 1034190],
    [1031360, 1031350], [1032770, 1032760], [1033970, 1033960]]
  const af = new Map((await righe(`select id::int, awakens_from::int af from card where id = any($1::bigint[])`,
    [catene.map((c) => c[0])])).map((r) => [r.id, r.af]))
  tutte('catene di risveglio dal gioco sulle nuove carte', catene, ([into, from]) => af.get(into) === from)
})

// La pagina abbozzata del wiki (730530): niente immagini, |ID ne' date, ma
// nome, tipo, classe e rarita' di una sola carta solo del datamine.
// load-cards le da' l'id, e i dati del wiki (epiteto, skill); l'uscita
// Global la prende dal datamine, perche' la pagina non la dice.
await sezione('la pagina abbozzata (1034150)', async () => {
  const [r] = await righe(`
    select c.wiki_title, c.type::text, c.class::text cls, c.rarity::text, c.awakens_from::int af,
           t.name, t.epithet, t.passive,
           (select released_at::text from card_release r where r.card_id = c.id and r.reg = 'global') glb,
           (select count(*) from card_release r where r.card_id = c.id and r.reg = 'japan')::int jp
    from card c join card_text t on t.card_id = c.id and t.locale = 'en' where c.id = 1034150`)
  check('wiki_title ed epiteto dalla pagina', r?.wiki_title === 'Transcendent Existence Buu (Kid)'
    && r?.epithet === 'Transcendent Existence' && r?.name === 'Buu (Kid)', JSON.stringify(r))
  check('LR INT Extreme, come nel gioco', r?.rarity === 'LR' && r?.type === 'INT' && r?.cls === 'Extreme')
  check('le skill del wiki', /Activates the Entrance Animation/.test(r?.passive ?? ''), (r?.passive ?? '').slice(0, 60))
  check('l\'uscita Global dal datamine (la pagina non ha GLBdate), nessuna data Japan inventata',
    r?.glb === '2026-09-29' && r?.jp === 0, `${r?.glb} / ${r?.jp}`)
  check('si risveglia ancora da 1034140', r?.af === 1034140, `${r?.af}`)
})

await sezione('un secondo giro non cambia niente', async () => {
  const prima = await statoCarte()
  script('load-game-cards.mjs')
  script('load-datamine.mjs')
  const dopo = await statoCarte()
  check('stessi conteggi dopo load-game-cards + load-datamine', JSON.stringify(prima) === JSON.stringify(dopo),
    `${JSON.stringify(prima)} -> ${JSON.stringify(dopo)}`)
})

// Il giorno che il wiki pubblica la pagina: load-cards con una cache fatta
// della sola pagina finta di 1034200. Deve prendere la stessa riga (niente
// doppione), riempire l'epiteto, e load-game-cards non deve piu' toccarla.
await sezione('il wiki documenta una carta del datamine', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dokkan-game-cards-'))
  const cache = join(dir, 'wiki-cards.json')
  const wikitext = [
    '{{Characters', '|thumb = Card 1034200 thumb.png', '|name1 = Test Epithet From The Wiki',
    '|name2 = Super Saiyan 3 Goku', '|type = INT-S', '|rarity = LR', '|GLBdate = 29 Sep 2026',
    '|HP max = 20000', '|Link skill = [[Super Saiyan]]', '}}',
  ].join('\n')
  writeFileSync(cache, JSON.stringify({ source: 'test', fetched_at: '2026-10-08',
    pages: [{ pageid: 999999001, title: 'Test Page Super Saiyan 3 Goku', wikitext }] }))
  const prima = await statoCarte()
  const primaRiga = await riga1034200()
  try {
    script('load-cards.mjs', { WIKI_CARDS_CACHE: cache })
    const r = (await righe(`select c.wiki_title, c.imported_from::text src, c.hp, t.epithet, t.name
                            from card c join card_text t on t.card_id = c.id and t.locale = 'en'
                            where c.id = 1034200`))[0]
    check('stessa riga: epiteto, titolo e statistiche dal wiki',
      r?.epithet === 'Test Epithet From The Wiki' && r?.wiki_title === 'Test Page Super Saiyan 3 Goku'
      && r?.src === 'wiki' && r?.hp === 20000, JSON.stringify(r))
    const ora = await statoCarte()
    check('nessun doppione: le carte sono le stesse', ora.carte === prima.carte && ora.testi === prima.testi,
      `${prima.carte} -> ${ora.carte}`)
    const covered = new Set((await righe('select id from card where wiki_title is not null')).map((x) => Number(x.id)))
    check('la scelta la vede coperta e non la prende piu\'',
      !pickGameCards(csv, covered).cards.some((c: { id: number }) => c.id === 1034200))
    script('load-game-cards.mjs')
    const r2 = (await righe(`select c.wiki_title, t.epithet from card c join card_text t on t.card_id = c.id
                             where c.id = 1034200 and t.locale = 'en'`))[0]
    check('e non riscrive la carta del wiki', r2?.epithet === 'Test Epithet From The Wiki' && !!r2?.wiki_title)
  } finally {
    // Rimessa com'era, SENZA cancellarla: event.cover_card_id la perderebbe
    // (on delete set null) e la suite degli eventi dopo vedrebbe un evento
    // cambiato. Si tolgono a mano i campi che solo il wiki scrive, poi la
    // pipeline vera rifa' il resto (tipo, nome, link, categorie, risveglio).
    rmSync(dir, { recursive: true, force: true })
    await db.query(`update card set wiki_title = null, hp = null, atk = null, def = null,
                      is_seza = false, has_eza = false where id = 1034200`)
    await db.query(`update card_text set epithet = null, leader_skill = null, passive = null,
                      super_attack = null where card_id = 1034200`)
    script('load-game-cards.mjs')
    script('load-datamine.mjs')
  }
  const dopo = await statoCarte()
  check('rimessa com\'era', JSON.stringify(prima) === JSON.stringify(dopo), `${JSON.stringify(prima)} -> ${JSON.stringify(dopo)}`)
  const dopoRiga = await riga1034200()
  check('1034200 identica a prima, anche come copertina degli eventi', JSON.stringify(primaRiga) === JSON.stringify(dopoRiga),
    `${JSON.stringify(primaRiga)} -> ${JSON.stringify(dopoRiga)}`)
  check('1034200 di nuovo senza epiteto',
    (await valore(`select epithet from card_text where card_id = 1034200 and locale = 'en'`)) === null)
})

await db.end()
console.log(`\n  ${passes} pass, ${fails} fail`)
process.exit(fails ? 1 : 0)
