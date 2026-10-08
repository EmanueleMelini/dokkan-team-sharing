// Verifica le build degli slot (migrazione 0018): la validazione in SQL,
// le build scritte nel team e congelate con la versione (anche negli
// assetti successivi), la revisione che non tocca le build vecchie, le
// letture per le pagine e il builder, i validatori della Server Action,
// lo stato del form, l'import delle sfere e /api/equipment.
//
// Gira sul database di test (npm run db:test). Crea solo utenti
// buildtest+...@example.invalid, che toglie alla fine con tutto quello che
// hanno scritto.
import { db } from '@/lib/db'
import {
  SUBMIT, check, copia, dati, esito, guardia, num, one, payload, q, stato, utente, type Payload,
} from '@/db/test/builder-helpers'
import revisione, { type BuildCtx } from '@/db/test/builds-revise'
import pure from '@/db/test/builds-pure'

guardia()
const P = 'buildtest'
let ctx: BuildCtx | null = null

/** Il payload base con le build: 1.1 completa, 2.2 solo nota, nel cambio 3.3 una sfera nello slot 2. */
function conBuild(base: Payload, orbs: number[]): Payload {
  const p = copia(base)
  p.lineups[0].slots[0].build = { hp_routes: 4, hp_path: 'Critical Hit', note: 'Needs the crit for phase 3.', equipment: [orbs[0], orbs[1], orbs[2]] }
  p.lineups[0].slots[3].build = { note: 'Any build works.' }
  p.lineups[1].slots[6].build = { equipment: [null, orbs[1]] }
  return p
}

try {
  const d = await dati()
  // sfere che tutte le carte del payload possono montare: le esclusive
  // (0021) le prova orbs.test.mts
  const orbs = (await q<{ id: string }>(
    `select (select min(id) from equipment e where tier = t
              and (select bool_and(equipment_fits(e.id, c)) from unnest($1::bigint[]) c))::text as id
     from generate_series(3, 1, -1) t`, [d.cards])).map((r) => Number(r.id))
  check('ci sono sfere dei tre gradi (load-equipment)', orbs.length === 3 && orbs.every((x) => x > 0), orbs.join())
  check('le sfere hanno il nome inglese del gioco', await num(
    "select count(*) from equipment_text where locale = 'en' and name like '%Skill Orb%'") > 8000)
  check('le abilita\' del Hidden Potential ci sono', await num('select count(*) from potential_skill') === 7)
  const autore = await utente(P, 'build_author')
  const altro = await utente(P, 'build_other')
  const base = payload(d.cards)
  const pieno = conBuild(base, orbs)

  console.log('\n  -- invio con le build')
  const clear = (await one<{ id: string }>(SUBMIT, [autore, d.run, d.tier, JSON.stringify(pieno)])).id
  const v1 = (await one<{ id: string }>('select id::text from clear_version where clear_id = $1 and is_current', [clear])).id
  const righe = await q<{ seq: number; r: number; p: number; hp: number | null; path: string | null; note: string | null; eq: string | null }>(
    `select b.seq, b.rotation_index as r, b.pos as p, b.hp_routes as hp, b.hp_path as path, b.note,
            (select string_agg(e.slot_no || ':' || e.equipment_id, ',' order by e.slot_no) from clear_lineup_equipment e
              where (e.version_id, e.seq, e.rotation_index, e.pos) = (b.version_id, b.seq, b.rotation_index, b.pos)) as eq
     from clear_lineup_build b where b.version_id = $1 order by 1, 2, 3`, [v1])
  check('tre build congelate, nei posti giusti', righe.map((x) => `${x.seq}.${x.r}.${x.p}`).join() === '1.1.1,1.2.2,2.3.3',
    JSON.stringify(righe))
  check('la build completa con tre sfere per slot', righe[0]?.hp === 4 && righe[0]?.path === 'Critical Hit' &&
    righe[0]?.eq === `1:${orbs[0]},2:${orbs[1]},3:${orbs[2]}`)
  check('la build con la sola nota', righe[1]?.hp === null && righe[1]?.note === 'Any build works.' && righe[1]?.eq === null)
  check('nel cambio la sfera resta nello slot 2', righe[2]?.eq === `2:${orbs[1]}`, righe[2]?.eq ?? '')
  const snap = await one<{ s: Record<string, unknown> }>(
    `select s from clear_version, jsonb_array_elements(lineup_snapshot->'slots') s
     where id = $1 and (s->>'rot')::int = 1 and (s->>'pos')::int = 1`, [v1])
  check('lo snapshot del #1 ha la build', snap?.s.hp_routes === 4 && snap?.s.hp_path === 'Critical Hit' &&
    JSON.stringify(snap?.s.equipment) === JSON.stringify([1, 2, 3].map((k, i) => ({ id: orbs[i], slot: k }))),
    JSON.stringify(snap?.s))
  check('il team ha le build in slot_build e slot_equipment', await num(
    `select count(*) from slot_build b join lineup l on l.id = b.lineup_id join clear c on c.team_id = l.team_id
     where c.id = $1`, [clear]) === 3 && await num(
    `select count(*) from slot_equipment e join lineup l on l.id = e.lineup_id join clear c on c.team_id = l.team_id
     where c.id = $1`, [clear]) === 4)

  console.log('\n  -- build vuote e build assenti')
  const vuote = copia(base)
  vuote.lineups[0].slots[0].build = {}
  vuote.lineups[0].slots[1].build = { hp_routes: null, hp_path: '   ', note: '', equipment: [null, null] }
  vuote.lineups[0].slots[2].build = null
  const cv = (await one<{ id: string }>(SUBMIT, [autore, d.run, d.tier, JSON.stringify(vuote)])).id
  check('una build vuota non si salva', await num(
    'select count(*) from clear_lineup_build b join clear_version v on v.id = b.version_id where v.clear_id = $1', [cv]) === 0)
  const zero = copia(base)
  zero.lineups[0].slots[0].build = { hp_routes: 0 }
  const cz = (await one<{ id: string }>(SUBMIT, [autore, d.run, d.tier, JSON.stringify(zero)])).id
  check('0 percorsi e\' un valore, non un vuoto', await num(
    `select count(*) from clear_lineup_build b join clear_version v on v.id = b.version_id
     where v.clear_id = $1 and b.hp_routes = 0`, [cz]) === 1)

  console.log('\n  -- i rifiuti delle build')
  const rompi = (b: unknown, i = 0, l = 0) => {
    const p = copia(base)
    p.lineups[l].slots[i].build = b
    return JSON.stringify(p)
  }
  const prima = await num('select count(*) from clear where author_id = $1', [autore])
  const casi: [string, string, string][] = [
    ['build come testo', rompi('rainbow'), 'builder_build'],
    ['build come array', rompi([4]), 'builder_build'],
    ['5 percorsi', rompi({ hp_routes: 5 }), 'builder_build_routes'],
    ['-1 percorsi', rompi({ hp_routes: -1 }), 'builder_build_routes'],
    ['percorsi 2.5', rompi({ hp_routes: 2.5 }), 'builder_build_routes'],
    ['percorsi come testo', rompi({ hp_routes: '2' }), 'builder_build_routes'],
    ['percorso di 41 caratteri', rompi({ hp_path: 'x'.repeat(41) }), 'builder_build_path'],
    ['percorso come numero', rompi({ hp_path: 3 }), 'builder_build_path'],
    ['nota di 201 caratteri', rompi({ note: 'x'.repeat(201) }), 'builder_build_note'],
    ['quattro sfere', rompi({ equipment: orbs.concat(orbs[0]) }), 'builder_build_equipment'],
    ['sfera inesistente', rompi({ equipment: [999999999] }), 'builder_build_equipment'],
    ['sfera come testo', rompi({ equipment: [String(orbs[0])] }), 'builder_build_equipment'],
    ['sfere non in un array', rompi({ equipment: orbs[0] }), 'builder_build_equipment'],
    ['nel cambio, sul floater', rompi({ hp_routes: 9 }, 6, 1), 'builder_build_routes'],
  ]
  for (const [nome, p, vincolo] of casi) {
    const e = await esito(SUBMIT, [autore, d.run, d.tier, p])
    check(`rifiuta: ${nome}`, e === `23514 ${vincolo}`, e)
  }
  check('nessun rifiuto ha lasciato un clear', await num('select count(*) from clear where author_id = $1', [autore]) === prima)
  const forma = copia(pieno)
  forma.lineups[0].slots = forma.lineups[0].slots.slice(0, 6)
  check('le regole del 0016 vengono prima delle build', await esito(SUBMIT, [autore, d.run, d.tier, JSON.stringify(forma)]) ===
    '23514 builder_shape')
  check('le funzioni del 0016 ci sono ancora, rinominate', await num(
    `select count(*) from pg_proc where proname in
       ('builder_check_payload_0016', 'builder_write_team_0016', 'builder_freeze_lineups_0016')`) === 3)

  ctx = { d, autore, altro, clear, v1, base, pieno, orbs, prefisso: P }
} catch (e) {
  check('nessuna eccezione inattesa', false, e instanceof Error ? e.stack ?? e.message : String(e))
}

for (const [nome, parte] of [['revisione e letture', revisione], ['validatori, stato, rotta', pure]] as const) {
  if (!ctx) break
  try { await parte(ctx) }
  catch (e) { check(`nessuna eccezione inattesa (${nome})`, false, e instanceof Error ? e.stack ?? e.message : String(e)) }
}

try {
  await db.query(`delete from app_user where email like '${P}+%@example.invalid'`)
  check('pulizia: nessun utente di prova rimasto', await num(
    `select count(*) from app_user where email like '${P}+%@example.invalid'`) === 0)
} finally {
  await db.end()
}

console.log(`\n  ${stato.passes} PASS, ${stato.fails} FAIL`)
process.exit(stato.fails ? 1 : 0)
