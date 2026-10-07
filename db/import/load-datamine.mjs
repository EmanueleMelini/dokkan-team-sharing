#!/usr/bin/env node
// Arricchisce le carte con i dati autorevoli del gioco.
//
// SORGENTE: i CSV di Nicholas1006/dokkan-backend, che versiona in git il
// database UFFICIALE Global esportato tabella per tabella, con commit
// automatici settimanali. Non il private server dokkan-eclipse: quello
// serve un database suo, potenzialmente modificato, ed e' anche la
// categoria di progetti che Bandai colpisce davvero.
//
// COSA FA: le 2632 carte che abbiamo dal wiki hanno gia' l'id VERO del
// gioco (verificato: 2632 su 2632 presenti nel datamine), quindi questo
// import non le sostituisce — le corregge dove il gioco e' autorevole:
// tipo, classe, rarita', link skill, categorie, catene di risveglio.
//
// COSA NON TOCCA, e perche':
//   epiteto        nel database del gioco NON C'E'. E' l'unico contributo
//                  insostituibile del wiki, ed e' come la community
//                  identifica una carta.
//   hp/atk/def     misurano cose DIVERSE. Il gioco da' il massimo di
//                  livello (per la LR 1007470: 8782/8414/3658), il wiki il
//                  valore a potenziale pieno (15800/15100/8220). Il secondo
//                  e' quello che i giocatori confrontano. Sovrascrivere
//                  cambierebbe in silenzio il significato della colonna.
//
// ADOTTA GLI ID DEL GIOCO per categorie e link skill: i nostri erano
// numeri che avevo assegnato io scorrendo il wiki, arbitrari. Quelli del
// datamine sono i veri, quindi le tabelle si ricostruiscono.
//
//   node db/import/load-datamine.mjs [--dry-run]
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { connectionString, describeTarget } from '../env.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIR = join(HERE, '.cache', 'datamine')
const DRY = process.argv.includes('--dry-run')
const LOCALE = 'en'

// ------------------------------------------------------------------ csv

// Un parser minimo ma corretto: i campi possono essere fra apici doppi e
// contenere virgole, apici raddoppiati e ritorni a capo. Le descrizioni
// delle skill li contengono, quindi uno split(',') non basta.
function parseCsv(text) {
  const rows = []
  let row = [], field = '', quoted = false, i = 0
  while (i < text.length) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue }
        quoted = false; i++; continue
      }
      field += ch; i++; continue
    }
    if (ch === '"') { quoted = true; i++; continue }
    if (ch === ',') { row.push(field); field = ''; i++; continue }
    if (ch === '\r') { i++; continue }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue }
    field += ch; i++
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  const head = rows.shift()
  return rows.filter((r) => r.length === head.length)
              .map((r) => Object.fromEntries(head.map((h, k) => [h, r[k]])))
}

const load = (name) => {
  const p = join(DIR, `${name}.csv`)
  if (!existsSync(p)) {
    console.error(`\n  manca ${p.replace(process.cwd() + '/', '')}`)
    console.error(`  scaricali con: npm run db:datamine:fetch\n`)
    process.exit(1)
  }
  return parseCsv(readFileSync(p, 'utf8'))
}

const int = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : null }

// ------------------------------------------------- decodifica del gioco

// Verificato incrociando 2632 carte con i dati del wiki:
//   element 0-4    tipo giusto, classe NON ancora definita (forme base)
//   element 10-14  Super   AGL TEQ INT STR PHY   (99-100% di accordo)
//   element 20-24  Extreme AGL TEQ INT STR PHY   (99-100% di accordo)
// Le 20-24 sono le unita' Extreme, non carte nemico: era il mio errore.
const TYPES = ['AGL', 'TEQ', 'INT', 'STR', 'PHY']
const decodeElement = (raw) => {
  const e = int(raw)
  if (e === null) return null
  const band = Math.floor(e / 10), idx = e % 10
  if (idx > 4) return null
  if (band === 1) return { type: TYPES[idx], cls: 'Super' }
  if (band === 2) return { type: TYPES[idx], cls: 'Extreme' }
  return { type: TYPES[idx], cls: null }      // forma base, classe ignota
}

// Verificato al 100% su tutte le rarita'
const RARITY = ['N', 'R', 'SR', 'SSR', 'UR', 'LR']
const decodeRarity = (raw) => RARITY[int(raw)] ?? null

// Le unita' giocabili hanno id a 7 cifre; quelle piu' lunghe (50003011,
// 501023491) sono boss e varianti interne.
const isPlayable = (c) => String(c.id).length === 7

// ------------------------------------------------------------- lettura

console.log(`  sorgente: CSV di Nicholas1006/dokkan-backend (database ufficiale Global)`)
const cards = load('cards')
const cats = load('card_categories')
const cardCats = load('card_card_categories')
const links = load('link_skills')
const routes = load('card_awakening_routes')
console.log(`  cards ${cards.length}  categorie ${cats.length}  legami ${cardCats.length}`)
console.log(`  link skill ${links.length}  risvegli ${routes.length}\n`)

const byId = new Map(cards.map((c) => [String(c.id), c]))
const classed = cards.filter((c) => isPlayable(c) && decodeElement(c.element)?.cls)
console.log(`  unita' giocabili con classe definita: ${classed.length}`)

if (DRY) {
  const s = byId.get('1007470')
  if (s) {
    const e = decodeElement(s.element)
    console.log(`\n  campione (id 1007470):`)
    console.log(`    ${s.name}  ${e.type} ${e.cls}  ${decodeRarity(s.rarity)}`)
    console.log(`    hp/atk/def del gioco (max livello): ${s.hp_max}/${s.atk_max}/${s.def_max}`)
    const ls = [1,2,3,4,5,6,7].map((n) => s[`link_skill${n}_id`]).filter((x) => x && int(x))
    const lname = (id) => links.find((l) => int(l.id) === int(id))?.name ?? `?${id}`
    console.log(`    link: ${ls.map(lname).join(', ')}`)
  }
  console.log('\n  --dry-run: non ho scritto niente')
  process.exit(0)
}

// ----------------------------------------------------------- scrittura

console.log(`  database: ${describeTarget()}`)
const client = new pg.Client({ connectionString: connectionString() })
await client.connect()
const chunks = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n))

try {
  await client.query('begin')

  // quali carte abbiamo: si arricchiscono solo quelle, non si inseriscono
  // le altre — senza epiteto sarebbero righe inservibili nel builder
  const { rows: mine } = await client.query('select id from card')
  const ids = mine.map((r) => String(r.id)).filter((id) => byId.has(id))
  console.log(`\n  nostre carte: ${mine.length}, di cui nel datamine: ${ids.length}`)
  const absent = mine.length - ids.length
  if (absent) console.log(`  (${absent} non nel datamine: sono le carte finte dei dati di prova)`)

  // 1. categorie e link skill: si adottano gli id del gioco
  await client.query('delete from card_category')
  await client.query('delete from card_link')
  await client.query('delete from category_text')
  await client.query('delete from category')
  await client.query('delete from link_skill_text')
  await client.query('delete from link_skill')

  const cat = cats.filter((c) => int(c.id) && c.name)
  await client.query(`insert into category (id) select unnest($1::smallint[])`, [cat.map((c) => int(c.id))])
  await client.query(`
    insert into category_text (category_id, locale, name, source)
    select * from unnest($1::smallint[], $2::text[], $3::text[], $4::text_source[])`,
    [cat.map((c) => int(c.id)), cat.map(() => LOCALE), cat.map((c) => c.name), cat.map(() => 'official')])
  console.log(`  categorie con gli id del gioco: ${cat.length}`)

  const lk = links.filter((l) => int(l.id) && l.name)
  await client.query(`insert into link_skill (id) select unnest($1::smallint[])`, [lk.map((l) => int(l.id))])
  await client.query(`
    insert into link_skill_text (link_id, locale, name, effect, source)
    select * from unnest($1::smallint[], $2::text[], $3::text[], $4::text[], $5::text_source[])`,
    [lk.map((l) => int(l.id)), lk.map(() => LOCALE), lk.map((l) => l.name),
     lk.map((l) => l.description || null), lk.map(() => 'official')])
  console.log(`  link skill con gli id del gioco: ${lk.length}`)

  // 2. le carte: dati autorevoli, epiteto intatto
  let fixedType = 0, noClass = 0
  for (const part of chunks(ids, 500)) {
    const rows = part.map((id) => {
      const c = byId.get(id)
      const e = decodeElement(c.element)
      if (e && !e.cls) noClass++
      return { id: Number(id), type: e?.type ?? null, cls: e?.cls ?? null,
               rarity: decodeRarity(c.rarity), name: c.name }
    }).filter((r) => r.type && r.cls && r.rarity)
    fixedType += rows.length
    await client.query(`
      update card set type = m.t, class = m.c, rarity = m.r,
                      imported_from = 'datamine', imported_at = now()
      from (select * from unnest($1::bigint[], $2::unit_type[], $3::unit_class[],
                                 $4::rarity[]) as t(id, t, c, r)) m
      where card.id = m.id`,
      [rows.map(r=>r.id), rows.map(r=>r.type), rows.map(r=>r.cls), rows.map(r=>r.rarity)])
    // il nome del personaggio dalla fonte autorevole; l'epiteto resta quello del wiki
    await client.query(`
      update card_text set name = m.n
      from (select * from unnest($1::bigint[], $2::text[]) as t(id, n)) m
      where card_text.card_id = m.id and card_text.locale = $3`,
      [rows.map(r=>r.id), rows.map(r=>r.name), LOCALE])
  }
  console.log(`  carte corrette: ${fixedType}`)
  if (noClass) console.log(`  (${noClass} con element 0-4, classe non definita nel gioco: lasciate come stavano)`)

  // 3. i link: sette colonne denormalizzate sulla carta
  const wanted = new Set(ids)
  const validLink = new Set(lk.map((l) => int(l.id)))
  const cl = []
  for (const id of ids) {
    const c = byId.get(id)
    for (let n = 1; n <= 7; n++) {
      const l = int(c[`link_skill${n}_id`])
      if (l && validLink.has(l)) cl.push([Number(id), l])
    }
  }
  for (const part of chunks(cl, 5000)) {
    await client.query(`insert into card_link (card_id, link_id)
      select * from unnest($1::bigint[], $2::smallint[]) on conflict do nothing`,
      [part.map(p=>p[0]), part.map(p=>p[1])])
  }
  console.log(`  legami carta-link: ${cl.length}`)

  // 4. le categorie
  const validCat = new Set(cat.map((c) => int(c.id)))
  const cc = cardCats
    .filter((r) => wanted.has(String(r.card_id)) && validCat.has(int(r.card_category_id)))
    .map((r) => [Number(r.card_id), int(r.card_category_id)])
  for (const part of chunks(cc, 5000)) {
    await client.query(`insert into card_category (card_id, category_id)
      select * from unnest($1::bigint[], $2::smallint[]) on conflict do nothing`,
      [part.map(p=>p[0]), part.map(p=>p[1])])
  }
  console.log(`  legami carta-categoria: ${cc.length}`)

  // 5. le catene di risveglio.
  //
  //    Attenzione: perche' una catena si colleghi servono ENTRAMBI i capi
  //    fra le nostre carte, e le nostre sono quasi tutte forme finali —
  //    la forma pre-risveglio spesso non ha una pagina wiki e quindi non
  //    ce l'abbiamo. Su 6979 rotte del gioco se ne collegano pochissime.
  //    Quindi qui si AGGIUNGE soltanto: le catene che il wiki ha ricavato
  //    dal "dokkan thumb" NON si toccano. (Prima le azzeravo e ne ho
  //    perse 1064 in un colpo: le rotte del gioco diventano utili solo
  //    importando anche le 9427 carte giocabili, non le nostre 2632.)
  const chain = routes
    .filter((r) => wanted.has(String(r.card_id)) && wanted.has(String(r.awaked_card_id))
                   && r.card_id !== r.awaked_card_id)
    .map((r) => [Number(r.awaked_card_id), Number(r.card_id)])
  const { rowCount } = chain.length ? await client.query(`
    update card set awakens_from = m.from_id
    from (select distinct on (into_id) * from unnest($1::bigint[], $2::bigint[])
            as t(into_id, from_id) order by into_id, from_id) m
    where card.id = m.into_id and card.awakens_from is null`,
    [chain.map(c=>c[0]), chain.map(c=>c[1])]) : { rowCount: 0 }
  console.log(`  catene di risveglio aggiunte dal gioco: ${rowCount} (su ${chain.length} utilizzabili`
              + ` delle ${routes.length} totali; le altre hanno un capo fuori dalle nostre carte)`)

  await client.query('commit')
  console.log('\n  fatto.')
} catch (err) {
  await client.query('rollback')
  console.error(`\n  import fallito, niente e' stato scritto: ${err.message}\n`)
  await client.end(); process.exit(1)
}
await client.end()
