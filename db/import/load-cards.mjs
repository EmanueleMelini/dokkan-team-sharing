#!/usr/bin/env node
// Carica le carte dal wikitext in cache dentro il database.
//
// Idempotente: rilanciarlo aggiorna, non duplica. Le chiavi naturali su
// link_skill_text e category_text (locale, name) sono quello che rende
// possibile riconoscere un link gia' visto invece di crearne un altro.
//
//   node db/import/load-cards.mjs           carica
//   node db/import/load-cards.mjs --dry-run analizza e non scrive niente
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { connectionString, describeTarget } from '../env.mjs'
import { snapshotInfo } from './datamine.mjs'
import { assignCardIds, awakensInto, datamineCards, field, idsByTitle, scalar } from './wiki-card.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
// WIKI_CARDS_CACHE solo per i test: game-cards.test.mts gli passa una
// pagina finta per provare che il wiki prende la riga di una carta del
// datamine sullo stesso id, senza toccare la cache vera.
const CACHE = process.env.WIKI_CARDS_CACHE ?? join(HERE, '.cache', 'wiki-cards.json')
const DRY = process.argv.includes('--dry-run')
const LOCALE = 'en'   // il wiki e' in inglese

// ---------------------------------------------------------------- parsing

// field(), scalar() e l'id della carta stanno in wiki-card.mjs: li usa
// anche fetch-assets, e i due devono vedere la stessa carta.

// Le leader skill sul wiki scrivono i tipi come icone, non come testo:
// "[[File:TEQ icon.png|30px]] & [[File:INT icon.png|30px]] Type ATK +30%".
// Buttare via i File lascerebbe "& Type ATK +30%", che non dice niente.
// Quindi le icone dei tipi e del Ki tornano testo prima di pulire.
const ICON = /\[\[File:\s*(AGL|TEQ|INT|STR|PHY|Ki|Rainbow|Orb)[ _]?icon[^\]]*\]\]/gi
const clean = (s) => (s ?? '')
  .replace(ICON, (_, k) => k.toUpperCase())
  .replace(/\[\[File:[^\]]*\]\]/gi, '')
  .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
  .replace(/\[\[([^\]]+)\]\]/g, '$1')
  .replace(/\{\{[^}]*\}\}/g, '')
  .replace(/<[^>]+>/g, '')
  .replace(/'''?/g, '')
  .replace(/\s+/g, ' ')
  .trim()

const wikiLinks = (s) => [...(s ?? '').matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)]
  .map((m) => (m[2] ?? m[1]).trim())
  .filter((n) => n && !/^File:/i.test(n))

const MONTHS = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6,
                 jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 }

function parseDate(raw) {
  if (!raw) return null
  const t = raw.replace(/^prior to\s+/i, '').trim()
  if (/^n\/?a$/i.test(t)) return null
  const m = t.match(/^(\d{1,2})\s+([A-Za-z]+)\.?\s+(\d{4})$/)
  if (!m) return null
  const mo = MONTHS[m[2].slice(0, 3).toLowerCase()]
  if (!mo) return null
  return `${m[3]}-${String(mo).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`
}

function parseType(raw) {
  if (!raw) return { skip: 'tipo assente' }
  const t = raw.trim().toUpperCase()
  if (t.startsWith('ITEM')) return { skip: "e' un oggetto di supporto, non un'unita'" }
  let m = t.match(/^(AGL|TEQ|INT|STR|PHY)-(S|E)$/)            // formato nuovo
  if (m) return { type: m[1], cls: m[2] === 'S' ? 'Super' : 'Extreme' }
  m = t.match(/^(S|E)(AGL|TEQ|INT|STR|PHY)$/)                  // formato vecchio
  if (m) return { type: m[2], cls: m[1] === 'S' ? 'Super' : 'Extreme' }
  return { skip: `tipo non riconosciuto: "${raw}"` }
}

const RARITIES = new Set(['N', 'R', 'SR', 'SSR', 'UR', 'LR'])
const int = (s) => { const n = Number(String(s ?? '').replace(/[,\s]/g, '')); return Number.isFinite(n) && n > 0 ? Math.round(n) : null }

// assigned: l'id deciso da assignCardIds; byTitle: titolo -> id, per la
// catena di risveglio
function parseCard(page, assigned, byTitle) {
  const w = page.wikitext
  const bad = (why) => ({ skipped: { title: page.title, why } })

  const ty = parseType(scalar(w, 'type'))
  if (ty.skip) return bad(ty.skip)

  const { id, from, why } = assigned
  if (!id) return bad(why)

  const rarity = (scalar(w, 'rarity') ?? '').toUpperCase()
  if (!RARITIES.has(rarity)) return bad(`rarita' non riconosciuta: "${rarity}"`)

  const name = clean(scalar(w, 'name2'))
  const epithet = clean(scalar(w, 'name1'))
  if (!name || !epithet) return bad('nome o epiteto mancante')

  return {
    card: {
      id,
      type: ty.type,
      cls: ty.cls,
      rarity,
      has_eza: Boolean(field(w, 'JPdateEZA') || field(w, 'GLBdateEZA')),
      is_seza: Boolean(field(w, 'EZA SA 15')),
      hp: int(scalar(w, 'HP max')),
      atk: int(scalar(w, 'ATK max')),
      def: int(scalar(w, 'DEF max')),
      wiki_title: page.title,
    },
    text: { name, epithet,
            leader_skill: clean(field(w, 'LS description')) || null,
            passive:      clean(field(w, 'PS description')) || null,
            super_attack: clean(field(w, 'SA description')) || null },
    releases: [
      { reg: 'japan',  released_at: parseDate(scalar(w, 'JPdate')) },
      { reg: 'global', released_at: parseDate(scalar(w, 'GLBdate')) },
    ].filter((r) => r.released_at),
    links: [...new Set(wikiLinks(field(w, 'Link skill')))],
    cats:  [...new Set(wikiLinks(field(w, 'Category')))],
    awakens_into: awakensInto(w, byTitle),
    id_from: from,
  }
}

// ---------------------------------------------------------------- analisi

const raw = JSON.parse(readFileSync(CACHE, 'utf8'))
console.log(`  sorgente: ${raw.source}`)
console.log(`  scaricata il ${raw.fetched_at}, ${raw.pages.length} pagine`)

// Il datamine serve a verificare gli id presi dal campo |ID: senza, quelle
// pagine restano fuori come prima, e lo si dice.
const dm = datamineCards()
console.log(dm ? `  datamine per verificare |ID: ${snapshotInfo()}\n`
               : `  datamine assente: gli id dal campo |ID non si usano (node db/import/fetch-datamine.mjs)\n`)

const assigned = assignCardIds(raw.pages, dm)
const byTitle = idsByTitle(raw.pages, assigned)
const parsed = raw.pages.map((p) => parseCard(p, assigned.get(p.pageid), byTitle))
const skipped = parsed.filter((p) => p.skipped).map((p) => p.skipped)
const cards = parsed.filter((p) => p.card)

console.log(`  carte utilizzabili: ${cards.length}`)
console.log(`  scartate: ${skipped.length}`)
const byReason = new Map()
for (const s of skipped) {
  const k = s.why.replace(/"[^"]*"/, '"..."').replace(/id \d+ condiviso.*/, 'id condiviso fra piu\' pagine')
    .replace(/\|ID \d+/, '|ID')
  byReason.set(k, (byReason.get(k) ?? 0) + 1)
}
for (const [why, n] of [...byReason].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(n).padStart(4)}  ${why}`)
}
// Quelle che hanno l'id solo grazie a |ID: poche, e conviene vederle.
const viaId = cards.filter((c) => c.id_from === 'ID')
console.log(`  id dal campo |ID (verificati sul datamine): ${viaId.length}`)
if (DRY) for (const c of viaId) console.log(`    ${c.card.id}  ${c.card.wiki_title}`)

// La distribuzione dice se il parsing e' sano: in Dokkan una carta ha
// 5-7 link skill. Se comparissero degli 1 o dei 2, vorrebbe dire che
// stiamo troncando la lista da qualche parte.
const tally = (a) => { const m = new Map(); for (const v of a) m.set(v, (m.get(v) ?? 0) + 1); return [...m].sort((x, y) => x[0] - y[0]) }
console.log(`\n  link per carta:      ${tally(cards.map((c) => c.links.length)).map(([k, n]) => `${k}→${n}`).join('  ')}`)
console.log(`  categorie per carta: ${tally(cards.map((c) => c.cats.length)).map(([k, n]) => `${k}→${n}`).join('  ')}`)
const noLinks = cards.filter((c) => c.links.length === 0)
if (noLinks.length) console.log(`  senza link: ${noLinks.length} (${noLinks.slice(0, 3).map((c) => c.card.wiki_title).join('; ')})`)

const allLinks = [...new Set(cards.flatMap((c) => c.links))].sort()
const allCats  = [...new Set(cards.flatMap((c) => c.cats))].sort()
console.log(`\n  link skill distinte: ${allLinks.length}`)
console.log(`  categorie distinte:  ${allCats.length}`)
console.log(`  con EZA: ${cards.filter((c) => c.card.has_eza).length}`)
console.log(`  uscite su Global: ${cards.filter((c) => c.releases.some((r) => r.reg === 'global')).length}`)
console.log(`  solo su Japan:    ${cards.filter((c) => !c.releases.some((r) => r.reg === 'global')).length}`)

if (DRY) {
  const sample = cards.find((c) => c.card.wiki_title === 'Pride Regained Super Saiyan Vegeta') ?? cards[0]
  console.log('\n  campione:')
  console.log('   ', JSON.stringify({ ...sample.card, ...sample.text,
    links: sample.links, cats: sample.cats, releases: sample.releases,
    awakens_into: sample.awakens_into }, null, 1).replace(/\n/g, '\n    ').slice(0, 1200))
  console.log('\n  --dry-run: non ho scritto niente')
  process.exit(0)
}

// ---------------------------------------------------------------- scrittura

const url = connectionString()
console.log(`  database: ${describeTarget()}`)
const client = new pg.Client({ connectionString: url })
await client.connect()

async function ensureLookup(table, textTable, idCol, names) {
  const { rows } = await client.query(
    `select ${idCol} as id, name from ${textTable} where locale = $1`, [LOCALE])
  const byName = new Map(rows.map((r) => [r.name, r.id]))
  let next = rows.length ? Math.max(...rows.map((r) => r.id)) + 1 : 1
  const fresh = names.filter((n) => !byName.has(n))
  for (const n of fresh) {
    const id = next++
    await client.query(`insert into ${table} (id) values ($1) on conflict do nothing`, [id])
    await client.query(
      `insert into ${textTable} (${idCol}, locale, name) values ($1, $2, $3)
       on conflict (locale, name) do nothing`, [id, LOCALE, n])
    byName.set(n, id)
  }
  return { byName, added: fresh.length }
}

const chunks = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n))

try {
  await client.query('begin')

  const L = await ensureLookup('link_skill', 'link_skill_text', 'link_id', allLinks)
  const C = await ensureLookup('category',   'category_text',   'category_id', allCats)
  console.log(`\n  link skill: ${L.added} nuove`)
  console.log(`  categorie:  ${C.added} nuove`)

  for (const part of chunks(cards, 400)) {
    const c = part.map((x) => x.card)
    await client.query(`
      insert into card (id, type, class, rarity, is_seza, has_eza, hp, atk, def,
                        wiki_title, imported_from, imported_at)
      select * from unnest($1::bigint[], $2::unit_type[], $3::unit_class[], $4::rarity[],
                           $5::boolean[], $6::boolean[], $7::int[], $8::int[], $9::int[],
                           $10::text[], $11::data_source[], $12::timestamptz[])
      on conflict (id) do update set
        type = excluded.type, class = excluded.class, rarity = excluded.rarity,
        is_seza = excluded.is_seza, has_eza = excluded.has_eza,
        hp = excluded.hp, atk = excluded.atk, def = excluded.def,
        wiki_title = excluded.wiki_title,
        imported_from = excluded.imported_from, imported_at = excluded.imported_at`,
      [c.map(x=>x.id), c.map(x=>x.type), c.map(x=>x.cls), c.map(x=>x.rarity),
       c.map(x=>x.is_seza), c.map(x=>x.has_eza), c.map(x=>x.hp), c.map(x=>x.atk),
       c.map(x=>x.def), c.map(x=>x.wiki_title), c.map(()=>'wiki'), c.map(()=>new Date())])

    const t = part.map((x) => ({ id: x.card.id, ...x.text }))
    await client.query(`
      insert into card_text (card_id, locale, name, epithet, leader_skill, passive, super_attack, source)
      select * from unnest($1::bigint[], $2::text[], $3::text[], $4::text[],
                           $5::text[], $6::text[], $7::text[], $8::text_source[])
      on conflict (card_id, locale) do update set
        name = excluded.name, epithet = excluded.epithet,
        leader_skill = excluded.leader_skill, passive = excluded.passive,
        super_attack = excluded.super_attack, source = excluded.source`,
      [t.map(x=>x.id), t.map(()=>LOCALE), t.map(x=>x.name), t.map(x=>x.epithet),
       t.map(x=>x.leader_skill), t.map(x=>x.passive), t.map(x=>x.super_attack),
       t.map(()=>'official')])
  }
  console.log(`  carte scritte: ${cards.length}`)

  const rel = cards.flatMap((c) => c.releases.map((r) => ({ id: c.card.id, ...r })))
  for (const part of chunks(rel, 1000)) {
    await client.query(`
      insert into card_release (card_id, reg, released_at)
      select * from unnest($1::bigint[], $2::region[], $3::date[])
      on conflict (card_id, reg) do update set released_at = excluded.released_at`,
      [part.map(x=>x.id), part.map(x=>x.reg), part.map(x=>x.released_at)])
  }
  console.log(`  date di uscita: ${rel.length}`)

  // link e categorie: si sostituiscono in blocco, cosi' se una carta ne
  // perde uno sul wiki lo perde anche qui
  const ids = cards.map((c) => c.card.id)
  await client.query('delete from card_link     where card_id = any($1::bigint[])', [ids])
  await client.query('delete from card_category where card_id = any($1::bigint[])', [ids])

  const cl = cards.flatMap((c) => c.links.map((n) => ({ card: c.card.id, link: L.byName.get(n) })).filter((x) => x.link))
  for (const part of chunks(cl, 2000)) {
    await client.query(`insert into card_link (card_id, link_id)
      select * from unnest($1::bigint[], $2::smallint[]) on conflict do nothing`,
      [part.map(x=>x.card), part.map(x=>x.link)])
  }
  const cc = cards.flatMap((c) => c.cats.map((n) => ({ card: c.card.id, cat: C.byName.get(n) })).filter((x) => x.cat))
  for (const part of chunks(cc, 2000)) {
    await client.query(`insert into card_category (card_id, category_id)
      select * from unnest($1::bigint[], $2::smallint[]) on conflict do nothing`,
      [part.map(x=>x.card), part.map(x=>x.cat)])
  }
  console.log(`  legami carta-link: ${cl.length}`)
  console.log(`  legami carta-categoria: ${cc.length}`)

  // la catena di dokkan awakening: la pagina della carta base indica la
  // sua evoluzione, quindi la relazione si scrive sulla carta risvegliata.
  // Secondo passaggio, perche' serve che entrambe esistano.
  const chain = cards.filter((c) => c.awakens_into).map((c) => ({ from: c.card.id, into: c.awakens_into }))
  const { rowCount } = await client.query(`
    update card set awakens_from = m.from_id
    from (select * from unnest($1::bigint[], $2::bigint[]) as t(into_id, from_id)) m
    where card.id = m.into_id and card.id <> m.from_id`,
    [chain.map(x=>x.into), chain.map(x=>x.from)])
  console.log(`  catene di awakening collegate: ${rowCount} su ${chain.length} indicate`)

  await client.query('commit')
  console.log('\n  fatto.')
} catch (err) {
  await client.query('rollback')
  console.error(`\n  import fallito, niente e' stato scritto: ${err.message}\n`)
  await client.end()
  process.exit(1)
}
await client.end()
