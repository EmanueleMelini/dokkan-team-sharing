// Le scritture delle categorie di load-datamine (piano in plan.mjs), dentro
// la transazione del chiamante: niente begin/commit qui. Lo usa anche il
// test sul database, che lo chiama con missioni ritoccate in una
// transazione che poi annulla.
import { extractJapaneseNames } from './japanese-names.mjs'
import { LINGUE, planCategories, planLines } from './plan.mjs'

/** @param {import('pg').ClientBase} client */
export async function readCurrent(client) {
  const ids = (await client.query('select id from category order by id')).rows.map((r) => r.id)
  const text = (await client.query(
    `select category_id, locale, name, source::text as source from category_text
     where locale = any($1::text[]) order by category_id, locale`, [LINGUE])).rows
  const aliases = (await client.query(
    'select category_id, alias, kind from category_alias order by category_id, alias')).rows
  return { ids, text, aliases }
}

/**
 * @param {import('pg').ClientBase} client
 * @param {ReturnType<typeof planCategories>} plan
 */
export async function writePlan(client, plan) {
  // 1. gli id: i nuovi, poi i tolti (con la cascata su testi, alias,
  //    legami con le carte e regole delle sfere: la categoria non c'e' piu')
  if (plan.insertIds.length) {
    await client.query('insert into category (id) select unnest($1::smallint[])', [plan.insertIds])
  }
  if (plan.deleteIds.length) {
    await client.query('delete from category where id = any($1::smallint[])', [plan.deleteIds])
  }
  // 2. i nomi: prima via tutte le righe che cambiano, poi le nuove, per
  //    unique (locale, name) quando un nome passa da un id a un altro
  const td = plan.text.delete, ti = plan.text.insert
  if (td.length) {
    await client.query(`
      delete from category_text t
      using unnest($1::smallint[], $2::text[]) as d(category_id, locale)
      where t.category_id = d.category_id and t.locale = d.locale`,
      [td.map((r) => r.category_id), td.map((r) => r.locale)])
  }
  if (ti.length) {
    await client.query(`
      insert into category_text (category_id, locale, name, source)
      select * from unnest($1::smallint[], $2::text[], $3::text[], $4::text_source[])`,
      [ti.map((r) => r.category_id), ti.map((r) => r.locale), ti.map((r) => r.name), ti.map((r) => r.source)])
  }
  // 3. gli alias
  const ad = plan.aliases.delete, ai = plan.aliases.insert
  if (ad.length) {
    await client.query(`
      delete from category_alias a
      using unnest($1::smallint[], $2::text[]) as d(category_id, alias)
      where a.category_id = d.category_id and a.alias = d.alias`,
      [ad.map((r) => r.category_id), ad.map((r) => r.alias)])
  }
  if (ai.length) {
    await client.query(`
      insert into category_alias (category_id, alias, kind)
      select * from unnest($1::smallint[], $2::text[], $3::text[])`,
      [ai.map((r) => r.category_id), ai.map((r) => r.alias), ai.map((r) => r.kind)])
  }
}

/**
 * Il passo intero: legge lo stato, fa il piano, scrive. Torna il piano e
 * le righe del log.
 * @param {import('pg').ClientBase} client
 * @param {{ categories: Record<string, string>[], missions: Iterable<Record<string, string>> }} csv
 *   le righe di card_categories.csv e missions.csv
 */
export async function applyCategories(client, { categories, missions }) {
  const datamine = categories
    .map((c) => ({ id: Number(c.id), name: c.name }))
    .filter((c) => Number.isInteger(c.id) && c.id > 0 && c.name)
  const plan = planCategories({ datamine, japanese: extractJapaneseNames(missions), current: await readCurrent(client) })
  await writePlan(client, plan)
  return { plan, lines: planLines(plan) }
}
