#!/usr/bin/env node
// Aggiunge le unita' uscite su Global che il wiki non ha ancora documentato.
//
// PERCHE': il wiki ha smesso di creare pagine carta a fine luglio 2026, il
// gioco no. Le carte di agosto-settembre esistono solo nel datamine, e
// senza una riga in card nessuno puo' usarle in una squadra.
//
// COSA SCRIVE: nome (inglese, dal gioco), tipo, classe, rarita' con la
// stessa decodifica di load-datamine, la data di uscita Global. NIENTE
// epiteto (il gioco non ce l'ha: resta NULL, migrazione 0015), niente
// statistiche (il gioco da' il massimo di livello, il wiki il potenziale
// pieno: mischiarli cambierebbe il significato della colonna), niente
// testi delle skill e niente immagini.
//
// ORDINE: dopo load-cards (il wiki vince: le carte con una pagina non si
// toccano) e prima di load-datamine, che poi da' anche a queste link,
// categorie e catene di risveglio.
//
// IL GIORNO CHE IL WIKI LE DOCUMENTA: load-cards fa upsert sullo stesso
// id e riempie l'epiteto; da li' in poi questo script la vede coperta e
// la lascia stare. Non nasce un doppione.
//
//   node db/import/load-game-cards.mjs [--dry-run]
import pg from 'pg'
import { connectionString, describeTarget } from '../env.mjs'
import { loadTable, snapshotInfo } from './datamine.mjs'
import { pickGameCards, unitOf } from './game-cards.mjs'

const DRY = process.argv.includes('--dry-run')
const LOCALE = 'en'

console.log(`  sorgente: datamine, ${snapshotInfo()}`)
const rows = loadTable('cards')
console.log(`  database: ${describeTarget()}`)
const client = new pg.Client({ connectionString: connectionString() })
await client.connect()

try {
  const { rows: wiki } = await client.query('select id from card where wiki_title is not null')
  const covered = new Set(wiki.map((r) => Number(r.id)))
  const { cards, skipped } = pickGameCards(rows, covered)
  console.log(`  carte con pagina wiki: ${covered.size}`)
  console.log(`  uscite su Global senza pagina, da aggiungere: ${cards.length}`)
  console.log(`  scartate: ${skipped.length}`)
  const byWhy = new Map()
  for (const s of skipped) {
    const k = s.why.replace(/\d{7}/, '...')
    byWhy.set(k, [...(byWhy.get(k) ?? []), s.id])
  }
  for (const [why, ids] of byWhy) console.log(`    ${String(ids.length).padStart(3)}  ${why}: ${ids.join(' ')}`)

  // Le righe che questo script aveva scritto e che ora non sceglie piu':
  // se il wiki ha documentato l'unita' con un altro id, qui c'e' un
  // doppione. Non si cancellano da sole, perche' una squadra potrebbe
  // gia' usarle: si segnalano, e la decisione resta a mano.
  const { rows: mine } = await client.query(
    `select c.id::text, t.name from card c left join card_text t on t.card_id = c.id and t.locale = $1
     where c.wiki_title is null and c.imported_from = 'datamine'`, [LOCALE])
  const picked = new Set(cards.map((c) => String(c.id)))
  const coveredUnits = new Set([...covered].map(unitOf))
  const stale = mine.filter((r) => !picked.has(r.id) && coveredUnits.has(unitOf(r.id)))
  for (const s of stale) console.log(`  ATTENZIONE: ${s.id} ${s.name} ora ha una pagina wiki con un altro id`)

  if (DRY) {
    for (const c of cards) console.log(`    ${c.id}  ${c.rarity.padEnd(3)} ${c.type} ${c.cls.padEnd(7)} ${c.global_release}  ${c.name}`)
    console.log('\n  --dry-run: non ho scritto niente')
  } else {
    await write(cards)
    console.log('\n  fatto.')
  }
} catch (err) {
  await client.query('rollback').catch(() => {})
  console.error(`\n  import fallito, niente e' stato scritto: ${err.message}\n`)
  await client.end(); process.exit(1)
}
await client.end()

async function write(cards) {
  const col = (k) => cards.map((c) => c[k])
  await client.query('begin')
  // I "where wiki_title is null" e "where epithet is null" sono la
  // garanzia che una carta del wiki non venga mai riscritta da qui, anche
  // se un giorno la scelta sbagliasse.
  const { rowCount: nc } = await client.query(`
    insert into card (id, type, class, rarity, imported_from, imported_at)
    select id, t, c, r, 'datamine', now()
    from unnest($1::bigint[], $2::unit_type[], $3::unit_class[], $4::rarity[]) as m(id, t, c, r)
    on conflict (id) do update set
      type = excluded.type, class = excluded.class, rarity = excluded.rarity,
      imported_from = excluded.imported_from, imported_at = excluded.imported_at
    where card.wiki_title is null`,
    [col('id'), col('type'), col('cls'), col('rarity')])
  const { rowCount: nt } = await client.query(`
    insert into card_text (card_id, locale, name, epithet, source)
    select id, $3, n, null, 'official' from unnest($1::bigint[], $2::text[]) as m(id, n)
    on conflict (card_id, locale) do update set name = excluded.name
    where card_text.epithet is null`,
    [col('id'), col('name'), LOCALE])
  const { rowCount: nr } = await client.query(`
    insert into card_release (card_id, reg, released_at)
    select id, 'global', d from unnest($1::bigint[], $2::date[]) as m(id, d)
    on conflict (card_id, reg) do update set released_at = excluded.released_at`,
    [col('id'), col('global_release')])
  await client.query('commit')
  console.log(`\n  carte scritte: ${nc}, testi: ${nt}, date di uscita: ${nr}`)
}
