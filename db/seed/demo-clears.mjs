#!/usr/bin/env node
// Clear dimostrativi su un evento VERO, per poter guardare la pagina
// popolata invece che sempre vuota.
//
// Non fa parte di db:refresh: si lancia a mano con `npm run db:demo` e si
// toglie con `--pulisci`. I dati di prova in db/seed/ restano quelli
// finti, cosi' i test restano deterministici.
//
// Usa submit_clear(), quindi e' anche una prova che la funzione di
// scrittura regga su carte ed eventi reali e non solo sulla fixture.
import pg from 'pg'
import { connectionString, describeTarget } from '../env.mjs'

const PULISCI = process.argv.includes('--pulisci')
const c = new pg.Client({ connectionString: connectionString() })
await c.connect()
console.log(`  database: ${describeTarget()}`)

// handle distinti da quelli della fixture, che occupa gia' ematanoia e
// wickedmain e ha un vincolo di unicita' sul campo
const UTENTI = [
  ['11111111-0000-4000-8000-000000000001', 'demo_rotation', 'demo1@example.invalid'],
  ['11111111-0000-4000-8000-000000000002', 'demo_wicked',   'demo2@example.invalid'],
  ['11111111-0000-4000-8000-000000000003', 'demo_f2p',      'demo3@example.invalid'],
]

try {
  await c.query('begin')

  if (PULISCI) {
    const { rowCount } = await c.query(
      `delete from clear where author_id = any($1::uuid[])`, [UTENTI.map((u) => u[0])])
    await c.query(`delete from team where owner_id = any($1::uuid[])`, [UTENTI.map((u) => u[0])])
    await c.query(`delete from app_user where id = any($1::uuid[])`, [UTENTI.map((u) => u[0])])
    await c.query('commit')
    console.log(`  rimossi ${rowCount} clear dimostrativi e i loro autori\n`)
    await c.end(); process.exit(0)
  }

  // un evento vero e recente, con una difficolta' su cui appoggiare i clear
  const { rows: ev } = await c.query(`
    select e.id, et.name, st.id as tier_id, s.seq, st.difficulty::text as diff, r.id as run_id
    from event e
    join event_text et on et.event_id = e.id and et.locale = 'en'
    join stage s on s.event_id = e.id
    join stage_tier st on st.stage_id = s.id
    join event_run r on r.event_id = e.id and r.reg = 'global' and r.starts_at <= now()
    where e.kind = 'zbattle' and e.wiki_title is not null
    order by r.starts_at desc, s.seq desc
    limit 1`)
  if (!ev.length) throw new Error('nessun evento reale trovato: hai lanciato npm run db:import?')
  const target = ev[0]
  console.log(`  evento: ${target.name}`)
  console.log(`  difficolta': stage ${target.seq} (${target.diff})\n`)

  for (const [id, handle, email] of UTENTI) {
    await c.query(
      `insert into app_user (id, handle, email, reg, locale) values ($1,$2,$3,'global','en')
       on conflict (id) do update set handle = excluded.handle`, [id, handle, email])
  }

  // squadre fatte di carte VERE, scelte fra le LR con immagine
  const { rows: pool } = await c.query(`
    select c.id from card c
    join card_text ct on ct.card_id = c.id and ct.locale = 'en'
    where c.rarity = 'LR' and c.thumb_key is not null
    order by c.id desc limit 40`)
  if (pool.length < 21) throw new Error('troppe poche carte LR con immagine')

  const SQUADRE = [
    { utente: 0, carte: pool.slice(0, 6),   turni: 11, noItems: true,  deathless: true,
      nota: 'No items, no deaths. Swapped the tank into rotation 1 on phase 3.',
      prove: [{ kind: 'video', url: 'https://youtu.be/esempio-uno' }] },
    { utente: 1, carte: pool.slice(6, 12),  turni: 14, noItems: true,  deathless: false,
      nota: 'Lost the floater on the revive, still cleared.',
      prove: [{ kind: 'screenshot', url: 'https://i.imgur.com/esempio-due.png' }] },
    { utente: 2, carte: pool.slice(12, 18), turni: 23, noItems: false, deathless: false,
      nota: 'Pure F2P box, took two items. It is doable.', prove: [] },
  ]

  for (const s of SQUADRE) {
    const [owner, handle] = [UTENTI[s.utente][0], UTENTI[s.utente][1]]
    const { rows: [team] } = await c.query(
      `insert into team (owner_id, name, note, lang) values ($1,$2,$3,'en') returning id`,
      [owner, `${handle}'s team`, s.nota])
    const { rows: [lineup] } = await c.query(
      `insert into lineup (team_id, seq, label) values ($1, 1, 'assetto unico') returning id`,
      [team.id])

    // 7 slot in 2+2+3; leader e friend sono la stessa carta, com'e' normale
    const slots = [
      [1, 1, s.carte[0], 'leader'], [1, 2, s.carte[1], 'member'],
      [2, 1, s.carte[2], 'member'], [2, 2, s.carte[3], 'member'],
      [3, 1, s.carte[4], 'member'], [3, 2, s.carte[5], 'member'],
      [3, 3, s.carte[0], 'friend'],
    ]
    for (const [rot, pos, card, role] of slots) {
      await c.query(
        `insert into lineup_slot (lineup_id, rotation_index, pos, card_id, role)
         values ($1,$2,$3,$4,$5::slot_role)`, [lineup.id, rot, pos, card.id, role])
    }

    await c.query(
      `select submit_clear($1::uuid, $2::bigint, $3::bigint, $4::uuid,
                           $5, $6, $7::smallint, $8, 'en', $9::jsonb) as id`,
      [owner, target.run_id, target.tier_id, lineup.id,
       s.noItems, s.deathless, s.turni, s.nota, JSON.stringify(s.prove)])
    console.log(`  ${handle.padEnd(12)} ${s.turni} turni  ${s.noItems ? 'no-item ' : ''}`
                + `${s.deathless ? 'deathless ' : ''}${s.prove.length ? 'con prova' : 'senza prova'}`)
  }

  // qualche voto, cosi' l'ordinamento ha qualcosa da ordinare
  const { rows: vers } = await c.query(
    `select v.id from clear_version v join clear cl on cl.id = v.clear_id
     where cl.author_id = any($1::uuid[]) and v.is_current order by v.created_at`,
    [UTENTI.map((u) => u[0])])
  for (let i = 0; i < vers.length; i++) {
    for (let j = 0; j < UTENTI.length; j++) {
      if (i === j) continue                       // nessuno vota il proprio
      await c.query(`select vote_clear($1::uuid, $2::uuid, $3::smallint)`,
                    [UTENTI[j][0], vers[i].id, i === 0 ? 1 : i === 1 ? 1 : -1])
    }
  }

  await c.query('commit')
  console.log(`\n  fatto. Pagina: /events/${target.id}\n`)
} catch (err) {
  await c.query('rollback')
  console.error(`\n  non fatto: ${err.message}\n`)
  await c.end(); process.exit(1)
}
await c.end()
