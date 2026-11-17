// Le categorie dopo load-datamine (db/import/categories/, migrazione 0037),
// sul database di test: un nome inglese per categoria e uno giapponese per
// ognuna che ha le missioni dei titoli (99 e 99 sulla fotografia di
// ottobre 2026; i conti vengono dalla cache, non sono scritti qui), gli
// alias di aliasesFor, i vincoli di category_alias, un secondo giro di load-datamine
// che non riscrive nessuna riga (xmin compreso) e non svuota
// equipment_limit_category, l'ultimo nome noto, e il primo giro in
// produzione (solo nomi inglesi, nessun alias) dentro i limiti di
// db/prod/limits.json senza allow_deletions.
//
// L'ultimo nome noto si prova con applyCategories (write.mjs), lo stesso
// passo che load-datamine esegue, chiamato qui con missions.csv senza le
// missioni dei titoli di una categoria, dentro una transazione che poi si
// annulla: niente variabili d'ambiente nell'import per puntare a un
// datamine finto, e il SQL vero fa le scritture vere. Il piano su stati
// finti lo prova db/test/category-names.test.mjs.
//
// Gira dopo l'import dalle cache (npm run db:test); rilancia load-datamine
// una volta. Non crea utenti.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { loadTable } from '../import/datamine.mjs'
import { compare } from '../prod/compare.mjs'
import { takeSnapshot } from '../prod/snapshot.mjs'
import { aliasesFor, initialsAlias } from '../import/categories/aliases.mjs'
import { extractJapaneseNames } from '../import/categories/japanese-names.mjs'
import { MARCA_SENZA_GIAPPONESE } from '../import/categories/plan.mjs'
import { applyCategories } from '../import/categories/write.mjs'

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
const num = async (text: string, params: unknown[] = []): Promise<number> => Number(Object.values((await righe(text, params))[0] ?? {})[0])
const script = (nome: string) =>
  execFileSync(process.execPath, [new URL(`../import/${nome}`, import.meta.url).pathname],
    { env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' })

const categorie = loadTable('card_categories')
const missioni = loadTable('missions')
const giapponesi = extractJapaneseNames(missioni).names
const nomeEn = new Map(categorie.map((c: Riga) => [Number(c.id), c.name as string]))
// quanti nomi aspettarsi: uno inglese per categoria, uno giapponese per
// ognuna che le missioni dei titoli nominano (un datamine piu' recente puo'
// portare categorie nuove)
const N_EN = nomeEn.size
const N_JA = [...giapponesi.keys()].filter((id) => nomeEn.has(id)).length

// Tutto quello che load-datamine scrive o potrebbe portare via con la
// cascata, con xmin: una riga riscritta uguale ha un xmin nuovo.
const fotografia = async () => JSON.stringify({
  category: await righe('select xmin::text, id from category order by id'),
  category_text: await righe('select xmin::text, category_id, locale, name, source from category_text order by category_id, locale'),
  category_alias: await righe('select xmin::text, category_id, alias, kind from category_alias order by category_id, alias'),
  equipment_limit_category: await righe(
    'select xmin::text, equipment_id::text, category_id from equipment_limit_category order by equipment_id, category_id'),
})

await sezione('dopo l\'import', async () => {
  const ids = (await righe('select id from category order by id')).map((r) => r.id)
  check('le categorie sono quelle del datamine', JSON.stringify(ids) === JSON.stringify([...nomeEn.keys()].sort((a, b) => a - b)),
    `${ids.length} categorie`)
  const testi = await righe(`select category_id, locale, name, source::text from category_text order by category_id, locale`)
  const en = testi.filter((r) => r.locale === 'en'), ja = testi.filter((r) => r.locale === 'ja')
  check(`${N_EN} nomi inglesi e ${N_JA} giapponesi, nient'altro`, en.length === N_EN && ja.length === N_JA && testi.length === N_EN + N_JA,
    `${en.length} en, ${ja.length} ja, ${testi.length} in tutto`)
  tutte('i nomi inglesi sono quelli del datamine', en, (r) => r.name === nomeEn.get(r.category_id) && r.source === 'official')
  tutte('i nomi giapponesi sono quelli delle missioni dei titoli, ufficiali', ja,
    (r) => r.name === giapponesi.get(r.category_id) && r.source === 'official')
  check('...e la fixture (邪悪な血統 sulla 1, 純粋サイヤ人 sulla 2) non c\'e\' piu\'',
    ja.find((r) => r.category_id === 1)?.name === 'フュージョン' && ja.find((r) => r.category_id === 17)?.name === '純粋サイヤ人')
  const alias = await righe('select category_id, alias, kind from category_alias order by category_id, alias collate "C"')
  tutte('gli alias di ogni categoria sono quelli di aliasesFor', [...nomeEn], ([id, en]) =>
    JSON.stringify(alias.filter((a) => a.category_id === id).map((a) => a.alias)) === JSON.stringify(aliasesFor(id, en)))
  tutte('...col tipo: initials le iniziali generate, nickname gli altri', alias,
    (a) => a.kind === (a.alias === initialsAlias(nomeEn.get(a.category_id) ?? '') ? 'initials' : 'nickname'))
  check('equipment_limit_category ha le regole delle sfere per categoria (load-equipment)',
    await num('select count(*) from equipment_limit_category') > 0)
})

await sezione('i vincoli di category_alias (0037)', async () => {
  const rifiuto = async (sql: string, atteso: RegExp) => {
    await db.query('begin')
    try { await db.query(sql); return 'accettato' } catch (e) { return atteso.test((e as Error).message) ? 'ok' : (e as Error).message }
    finally { await db.query('rollback') }
  }
  check('un alias maiuscolo e\' rifiutato', await rifiuto(`insert into category_alias values (1, 'Fu', 'nickname')`, /category_alias_form/) === 'ok')
  check('...anche con uno spazio ai bordi o vuoto', await rifiuto(`insert into category_alias values (1, ' fu', 'nickname')`, /category_alias_form/) === 'ok' &&
    await rifiuto(`insert into category_alias values (1, '', 'nickname')`, /category_alias_form/) === 'ok')
  check('un tipo che non e\' initials o nickname e\' rifiutato', await rifiuto(`insert into category_alias values (1, 'fu', 'other')`, /category_alias_kind_check/) === 'ok')
  check('una categoria che non c\'e\' e\' rifiutata', await rifiuto(`insert into category_alias values (32000, 'fu', 'nickname')`, /category_alias_category_id_fkey/) === 'ok')
  check('lo stesso alias due volte sulla stessa categoria e\' rifiutato', await rifiuto(
    `insert into category_alias values (23, 'tb', 'initials')`, /category_alias_pkey/) === 'ok')
  await db.query('begin')
  try {
    await db.query('delete from category where id = 23')
    check('togliere una categoria toglie i suoi alias', await num('select count(*) from category_alias where category_id = 23') === 0 &&
      await num(`select count(*) from category_alias where alias = 'tb'`) === 1)
  } finally { await db.query('rollback') }
})

let prima = ''
await sezione('un secondo giro di load-datamine non cambia niente', async () => {
  prima = await fotografia()
  const out = script('load-datamine.mjs')
  const dopo = await fotografia()
  check('nessuna riga di category, category_text, category_alias ed equipment_limit_category riscritta (xmin compreso)', prima === dopo,
    prima === dopo ? '' : 'fotografie diverse')
  check('...ed equipment_limit_category non si e\' svuotata', JSON.parse(dopo).equipment_limit_category.length > 0)
  check('il log: nessuna categoria nuova o tolta', out.includes(`  categorie con gli id del gioco: ${N_EN} (nuove 0, tolte 0)`), out.match(/.*categorie con.*/)?.[0])
  check('...nessun nome cambiato', out.includes(`  nomi giapponesi delle categorie: ${N_JA}, ${N_JA} dalle missioni dei titoli (nuovi 0, cambiati 0); nomi inglesi cambiati: 0`),
    out.match(/.*nomi giapponesi.*/)?.[0])
  check('...nessun alias cambiato', /  alias delle categorie: \d+ \(iniziali \d+, soprannomi \d+; righe cambiate 0\)/.test(out), out.match(/.*alias delle.*/)?.[0])
  // la riga "attenzione" c'e' solo se qualche categoria e' senza nome dalle missioni
  check(N_JA === N_EN ? '...e nessuna riga "attenzione"' : '...e la riga "attenzione" per le categorie senza nome',
    out.includes(MARCA_SENZA_GIAPPONESE) === (N_JA < N_EN))
})

await sezione('l\'ultimo nome noto (applyCategories in una transazione annullata)', async () => {
  // le missioni dei titoli della 7 (Resurrected Warriors) spariscono
  const delle7 = (r: Riga) => r.mission_category_id === '5' && /^「[^」]+」カテゴリ/.test(r.description) &&
    [...new Set(JSON.parse(r.conditions).all_card_category_ids)].join() === '7'
  const senza7 = missioni.filter((r: Riga) => !delle7(r))
  check('la cache ha le tre missioni dei titoli della 7', missioni.length - senza7.length === 3)
  const ja7 = () => righe(`select xmin::text, name from category_text where category_id = 7 and locale = 'ja'`)
  const marca = (lines: string[]) => lines.find((l) => l.startsWith(`  ${MARCA_SENZA_GIAPPONESE}`))
  await db.query('begin')
  try {
    const prima7 = await ja7()
    let r = await applyCategories(db, { categories: categorie, missions: senza7 })
    const dopo7 = await ja7()
    check('senza missioni la 7 tiene il suo nome, senza riscriverlo', dopo7.length === 1 && dopo7[0].name === '復活戦士' &&
      dopo7[0].xmin === prima7[0]?.xmin, JSON.stringify(dopo7))
    check('...la riga "attenzione" la nomina', marca(r.lines) === '  attenzione: categorie senza nome giapponese: 7 Resurrected Warriors', marca(r.lines))
    check('...e dice che tiene l\'ultimo nome', r.lines.includes('    (resta l\'ultimo nome noto: 7)'), r.lines.join(' | '))

    await db.query(`delete from category_text where category_id = 7 and locale = 'ja'`)
    r = await applyCategories(db, { categories: categorie, missions: senza7 })
    check('senza missioni e senza un nome di prima: nessun nome, e la riga lo dice', (await ja7()).length === 0 &&
      marca(r.lines) === '  attenzione: categorie senza nome giapponese: 7 Resurrected Warriors' &&
      r.lines.includes('    (nessun nome giapponese: 7)'), r.lines.join(' | '))

    r = await applyCategories(db, { categories: categorie, missions: missioni })
    check('le missioni tornano, e torna il nome', (await ja7())[0]?.name === '復活戦士' && !marca(r.lines))

    // una categoria nuova senza missioni dei titoli (l'id dopo l'ultimo del
    // datamine), e la 99 sparita dal datamine
    const nuovo = Math.max(...nomeEn.keys()) + 1
    const regole = await num('select count(*) from equipment_limit_category where category_id <> 99')
    const nuove = [...categorie.filter((c: Riga) => c.id !== '99'), { id: String(nuovo), name: 'Test Category Helper' }]
    r = await applyCategories(db, { categories: nuove, missions: missioni })
    const tNuovo = await righe('select locale, name from category_text where category_id = $1 order by locale', [nuovo])
    check(`la categoria nuova (${nuovo}) entra col nome inglese e le iniziali, senza giapponese`,
      JSON.stringify(tNuovo) === JSON.stringify([{ locale: 'en', name: 'Test Category Helper' }]) &&
      JSON.stringify(await righe('select alias, kind from category_alias where category_id = $1', [nuovo])) === JSON.stringify([{ alias: 'tch', kind: 'initials' }]),
      JSON.stringify(tNuovo))
    check('...e la riga "attenzione" la nomina', marca(r.lines) === `  attenzione: categorie senza nome giapponese: ${nuovo} Test Category Helper`, marca(r.lines))
    check('la 99 se ne va con testi, alias e legami', await num('select count(*) from category where id = 99') === 0 &&
      await num('select count(*) from category_text where category_id = 99') === 0 &&
      await num('select count(*) from category_alias where category_id = 99') === 0 &&
      await num('select count(*) from card_category where category_id = 99') === 0)
    check('...e il suo nome giapponese, che le missioni hanno ancora, si ignora', r.plan.ignored.some((x: { id: number }) => x.id === 99) &&
      r.lines.some((l) => l.includes('categoria 99') && l.includes('lo ignoro')))
    check('...ma le regole delle sfere delle altre categorie restano tutte',
      await num('select count(*) from equipment_limit_category') === regole && regole > 0, `${regole} regole`)
  } finally { await db.query('rollback') }
  check('annullata la transazione, tutto come prima', await fotografia() === prima)
})

await sezione('il primo giro in produzione, dentro i limiti (transazione annullata)', async () => {
  const LIMITS = JSON.parse(readFileSync(new URL('../prod/limits.json', import.meta.url), 'utf8'))
  type Tabella = { table: string, before: number, after: number, added: number, removed: number, changed: number }
  await db.query('begin')
  try {
    // la produzione prima di questo codice: solo i nomi inglesi, nessun alias
    await db.query(`delete from category_text where locale = 'ja'`)
    await db.query('delete from category_alias')
    const before = await takeSnapshot(db, { inTransaction: true, contentOnly: true })
    const r = await applyCategories(db, { categories: categorie, missions: missioni })
    const after = await takeSnapshot(db, { inTransaction: true, contentOnly: true })
    const esito = compare(before, after, LIMITS, { userTables: 'ignore' }) as unknown as
      { ok: boolean, violations: { table: string, rule: string }[], tables: Tabella[] }
    check('nessun limite violato, senza allow_deletions', esito.ok && esito.violations.length === 0,
      esito.violations.map((v) => `${v.table} ${v.rule}`).join(', '))
    const t = Object.fromEntries(esito.tables.map((x) => [x.table, x]))
    const ct = t.category_text, ca = t.category_alias
    const conti = (x?: Tabella) => (x ? `${x.before} -> ${x.after}: +${x.added} -${x.removed} ~${x.changed}` : 'manca')
    check(`category_text: ${N_JA} righe aggiunte (le giapponesi), nessuna tolta o cambiata`,
      ct?.added === N_JA && ct.removed === 0 && ct.changed === 0 && ct.after === N_EN + N_JA, conti(ct))
    check('category_alias: da vuota a tutti gli alias', ca?.before === 0 && ca.added === r.plan.counts.aliases && ca.added > 0,
      conti(ca))
    const altre = esito.tables.filter((x) => !['category_text', 'category_alias'].includes(x.table))
    tutte('nessun\'altra tabella di gioco cambia', altre, (x) => !x.added && !x.removed && !x.changed)
  } finally { await db.query('rollback') }
  check('annullata la transazione, tutto come prima', await fotografia() === prima)
})

await db.end()
console.log(`\n  ${passes} PASS, ${fails} FAIL`)
process.exit(fails ? 1 : 0)
