#!/usr/bin/env node
// L'equipaggiamento per le build del builder (0018), dal datamine Global.
//
//   - equipment / equipment_text: le Skill Orb (equipment_skill_items),
//     con il nome inglese del gioco, la descrizione (chi puo' montarle)
//     e il grado: bronzo 1, argento 2, oro 3;
//   - potential_skill: le abilita' del Hidden Potential (Combo Attack,
//     Critical Hit, ...), che il builder suggerisce come percorso;
//   - equipment_limit*: chi puo' montare quale sfera (0021), tradotto
//     sulle nostre carte da equipment-limits.mjs. Si riscrive tutto a
//     ogni giro: nessuno punta a queste righe, e una carta importata dopo
//     entra cosi' nelle regole per nome e per lista.
//
// Idempotente: aggiorna solo le righe cambiate e non cancella sfere,
// perche' una build congelata in un clear ci punta per sempre. Solo cache
// di fetch-datamine: niente rete.
//
//   node db/import/load-equipment.mjs
import pg from 'pg'
import { connectionString, describeTarget } from '../env.mjs'
import { int, loadTable, snapshotInfo } from './datamine.mjs'
import { buildLimits } from './equipment-limits.mjs'

const GRADE = { bronze: 1, silver: 2, gold: 3 }

// I testi del gioco vanno a capo a meta' frase per lo schermo del
// telefono: qui diventano una riga sola.
const pulito = (s) => (s ?? '').replace(/\s+/g, ' ').trim()

console.log(`  database: ${describeTarget()}`)
console.log(`  datamine: ${snapshotInfo()}`)

const sfere = []
let senzaGrado = 0
const items = loadTable('equipment_skill_items')
for (const r of items) {
  const id = int(r.id)
  const tier = GRADE[r.grade]
  const name = pulito(r.name)
  if (id == null || !name) continue
  // un grado nuovo che non conosciamo: meglio fuori che con un tier inventato
  if (!tier) { senzaGrado++; continue }
  sfere.push({ id, tier, name, effect: pulito(r.description) || null })
}
const abilita = loadTable('potential_skills')
  .map((r) => ({ id: int(r.id), name: pulito(r.name) }))
  .filter((r) => r.id != null && r.name)

// Un'impronta di tutte le regole, per dire se un giro ha cambiato qualcosa
// anche se le riscrive tutte.
const IMPRONTA = `select md5(coalesce(string_agg(r, '|' order by r), '')) as h from (
  select l.equipment_id || ':' || l.kind || ':' || coalesce((
    select string_agg(t.type || ' ' || t.class, ',' order by t.type, t.class) from equipment_limit_type t
    where t.equipment_id = l.equipment_id), '') || ':' || coalesce((
    select string_agg(x.category_id::text, ',' order by x.category_id) from equipment_limit_category x
    where x.equipment_id = l.equipment_id), '') || ':' || coalesce((
    select string_agg(x.card_id::text, ',' order by x.card_id) from equipment_limit_card x
    where x.equipment_id = l.equipment_id), '') as r
  from equipment_limit l) z`

async function scriviRegole(client, limits, nelGioco) {
  const prima = (await client.query(IMPRONTA)).rows[0].h
  // solo le sfere che ci sono davvero (quelle col grado sconosciuto no)
  const regole = [...limits].filter(([id]) => nelGioco.has(id))
  await client.query('delete from equipment_limit')
  const col = (f) => regole.flatMap(([id, r]) => f(r).map((v) => [id, v]))
  const tipi = col((r) => r.types ?? []), cat = col((r) => r.categories ?? []), carte = col((r) => r.cards ?? [])
  await client.query(
    'insert into equipment_limit (equipment_id, kind) select * from unnest($1::bigint[], $2::text[])',
    [regole.map(([id]) => id), regole.map(([, r]) => r.kind)])
  await client.query(
    `insert into equipment_limit_type (equipment_id, type, class)
     select * from unnest($1::bigint[], $2::unit_type[], $3::unit_class[])`,
    [tipi.map((x) => x[0]), tipi.map((x) => x[1][0]), tipi.map((x) => x[1][1])])
  await client.query(
    'insert into equipment_limit_category (equipment_id, category_id) select * from unnest($1::bigint[], $2::smallint[])',
    [cat.map((x) => x[0]), cat.map((x) => x[1])])
  await client.query(
    'insert into equipment_limit_card (equipment_id, card_id) select * from unnest($1::bigint[], $2::bigint[])',
    [carte.map((x) => x[0]), carte.map((x) => x[1])])
  const dopo = (await client.query(IMPRONTA)).rows[0].h
  const conta = {}
  for (const [, r] of regole) conta[r.kind] = (conta[r.kind] ?? 0) + 1
  return {
    righe: regole.length,
    perTipo: Object.entries(conta).map(([k, n]) => `${n} ${k}`).join(', '),
    // una regola che non ammette nessuna delle nostre carte
    vuote: regole.filter(([, r]) => r.kind !== 'type' && !(r.categories ?? r.cards).length).length,
    cambiato: prima !== dopo,
  }
}

const client = new pg.Client({ connectionString: connectionString() })
await client.connect()
try {
  await client.query('begin')
  const haveCards = new Set((await client.query('select id::int from card')).rows.map((r) => r.id))
  const haveCategories = new Set((await client.query('select id from category')).rows.map((r) => r.id))
  const { limits, unreadable } = buildLimits({
    items, limitations: loadTable('equipment_skill_limitations'),
    cards: loadTable('cards'), uniqueSets: loadTable('card_unique_info_set_relations'), haveCards, haveCategories,
  })
  const eq = await client.query(
    `insert into equipment (id, tier)
     select * from unnest($1::bigint[], $2::smallint[])
     on conflict (id) do update set tier = excluded.tier
       where equipment.tier is distinct from excluded.tier
     returning (xmax = 0) as nuova`,
    [sfere.map((s) => s.id), sfere.map((s) => s.tier)],
  )
  const tx = await client.query(
    `insert into equipment_text (equipment_id, locale, name, effect, source)
     select id, 'en', name, effect, 'official' from unnest($1::bigint[], $2::text[], $3::text[]) t(id, name, effect)
     on conflict (equipment_id, locale) do update set name = excluded.name, effect = excluded.effect
       where (equipment_text.name, equipment_text.effect) is distinct from (excluded.name, excluded.effect)
     returning (xmax = 0) as nuova`,
    [sfere.map((s) => s.id), sfere.map((s) => s.name), sfere.map((s) => s.effect)],
  )
  const ps = await client.query(
    `insert into potential_skill (id, name)
     select * from unnest($1::smallint[], $2::text[])
     on conflict (id) do update set name = excluded.name
       where potential_skill.name is distinct from excluded.name
     returning id`,
    [abilita.map((a) => a.id), abilita.map((a) => a.name)],
  )
  // le abilita' non hanno riferimenti: quelle sparite dal gioco si tolgono
  const via = await client.query(
    'delete from potential_skill where not (id = any ($1::smallint[]))', [abilita.map((a) => a.id)])
  const fuori = await client.query(
    'select count(*)::int as n from equipment where not (id = any ($1::bigint[]))', [sfere.map((s) => s.id)])
  const regole = await scriviRegole(client, limits, new Set(sfere.map((s) => s.id)))
  await client.query('commit')

  const nuove = (r) => r.rows.filter((x) => x.nuova).length
  console.log(`  sfere: ${sfere.length} nel gioco, ${nuove(eq)} nuove, ${eq.rowCount - nuove(eq)} con il grado cambiato`)
  console.log(`  nomi:  ${nuove(tx)} nuovi, ${tx.rowCount - nuove(tx)} cambiati`)
  if (senzaGrado) console.log(`  attenzione: ${senzaGrado} sfere con un grado sconosciuto, lasciate fuori`)
  if (fuori.rows[0].n) console.log(`  ${fuori.rows[0].n} sfere nel database non sono piu' nel gioco (restano: le build ci puntano)`)
  console.log(`  regole delle sfere: ${regole.righe} (${regole.perTipo}), ${regole.vuote} senza carte nostre;`
              + ` ${regole.cambiato ? 'cambiate' : 'nessun cambio'}`)
  if (unreadable) console.log(`  attenzione: ${unreadable} sfere con una regola che non so leggere: restano montabili da tutte`)
  console.log(`  abilita' del Hidden Potential: ${abilita.length} (${ps.rowCount} scritte, ${via.rowCount} tolte)`)
} catch (err) {
  await client.query('rollback').catch(() => {})
  console.error(`\n  load-equipment e' fallito: ${err.message}\n`)
  process.exitCode = 1
} finally {
  await client.end()
}
