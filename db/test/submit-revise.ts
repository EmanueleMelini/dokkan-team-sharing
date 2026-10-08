// Parte di submit.test.mts: gli assetti congelati con la versione, la
// revisione dal builder (i voti e i commenti restano sulla vecchia), chi
// puo' rivedere e cancellare.
import { db } from '@/lib/db'
import {
  REVISE, SUBMIT, check, copia, esito, messaggio, num, one, q, slots, type Ctx,
} from '@/db/test/builder-helpers'

export default async function revisioni(ctx: Ctx) {
  const { d, autore, altro, clear, v1, base } = ctx

  console.log('\n  -- gli assetti congelati')
  let m = await messaggio("update clear_lineup set label = 'x' where version_id = $1", [ctx.v1])
  check('clear_lineup non si modifica', /non si modificano/.test(m), m)
  m = await messaggio('update clear_lineup_card set card_id = $2 where version_id = $1', [v1, d.cards[7]])
  check('clear_lineup_card non si modifica', /non si modificano/.test(m), m)
  m = await messaggio('delete from clear_lineup_card where version_id = $1', [v1])
  check('clear_lineup_card non si cancella', /non si cancellano/.test(m), m)
  m = await messaggio('delete from clear_lineup where version_id = $1 and seq = 2', [v1])
  check('un cambio non si toglie', /non si cancellano/.test(m), m)
  m = await messaggio("insert into clear_lineup (version_id, seq, label) values ($1, 3, 'later')", [v1])
  check('un cambio non si aggiunge dopo', /solo insieme alla loro versione/.test(m), m)
  m = await messaggio(
    `insert into clear_lineup_card (version_id, seq, rotation_index, pos, card_id, role)
     values ($1, 2, 3, 3, $2, 'member')`, [v1, d.cards[1]])
  check('una carta non si aggiunge dopo', /solo insieme alla loro versione|duplicate|duplicat/.test(m), m)
  check('gli assetti della v1 sono intatti', await num(
    'select count(*) from clear_lineup_card where version_id = $1', [v1]) === 14)

  console.log('\n  -- voti e commenti sulla v1, poi la revisione')
  await db.query('select vote_clear_version($1, $2, 1::smallint)', [altro, v1])
  await db.query("select comment_clear_version($1, $2, 'Works for me.')", [altro, v1])
  // l'esito di un controllo dei link: deve seguire la prova che resta
  await db.query("update clear_proof set last_checked_at = now(), is_reachable = true where version_id = $1", [v1])
  const team = (await one<{ t: string }>('select team_id::text as t from clear where id = $1', [clear])).t

  const nuovo = copia(base)
  nuovo.lineups = [{ label: null, note: null, slots: slots([d.cards[7], ...d.cards.slice(1, 7)]) }]
  nuovo.turns = 9
  nuovo.proofs = [...base.proofs, { kind: 'screenshot', url: 'https://i.imgur.com/builder.png' }]
  let r = await esito(REVISE, [altro, clear, 'mine now', JSON.stringify(nuovo)])
  check('un altro non puo\' rivedere', r === '42501 builder_not_yours', r)
  r = await esito(REVISE, [autore, clear, '   ', JSON.stringify(nuovo)])
  check('la revisione vuole un motivo', r === '23514 builder_change_note', r)
  r = await esito(REVISE, [autore, clear, 'x'.repeat(301), JSON.stringify(nuovo)])
  check('motivo oltre i 300 caratteri', r === '23514 builder_change_note', r)
  r = await esito(REVISE, [autore, clear, 'Fix', JSON.stringify({ ...nuovo, turns: 0 })])
  check('una revisione con il payload sbagliato e\' rifiutata', r === '23514 builder_turns', r)
  check('e non crea versioni', await num('select count(*) from clear_version where clear_id = $1', [clear]) === 1)

  const v2 = (await one<{ id: string }>(REVISE, [autore, clear, 'Dropped the rotation change.', JSON.stringify(nuovo)])).id
  check('la revisione torna la versione nuova', !!v2 && v2 !== v1)
  const vv = await q<{ id: string; seq: number; is_current: boolean; change_note: string | null; turns: number }>(
    'select id::text, seq, is_current, change_note, turns from clear_version where clear_id = $1 order by seq', [clear])
  check('v1 non e\' piu\' corrente, v2 si', vv.length === 2 && !vv[0].is_current && vv[1].is_current &&
    vv[1].id === v2 && vv[1].change_note === 'Dropped the rotation change.' && vv[1].turns === 9)
  check('il voto resta sulla v1', await num('select count(*) from clear_vote where version_id = $1', [v1]) === 1 &&
    await num('select score from clear_version where id = $1', [v1]) === 1)
  check('la v2 parte da zero voti', await num('select score from clear_version where id = $1', [v2]) === 0)
  check('il commento resta sulla v1', await num('select count(*) from clear_comment where version_id = $1', [v1]) === 1 &&
    await num('select count(*) from clear_comment where version_id = $1', [v2]) === 0)
  check('la v1 tiene i suoi due assetti', await num('select count(*) from clear_lineup where version_id = $1', [v1]) === 2 &&
    await num('select count(*) from clear_lineup_card where version_id = $1 and card_id = $2', [v1, d.cards[7]]) === 1)
  check('la v2 ha un assetto solo, con il leader nuovo', await num(
    'select count(*) from clear_lineup where version_id = $1', [v2]) === 1 &&
    await num("select count(*) from clear_card where version_id = $1 and role = 'leader' and card_id = $2", [v2, d.cards[7]]) === 1)
  check('clear_card della v1 non cambia', await num(
    "select count(*) from clear_card where version_id = $1 and role = 'leader' and card_id = $2", [v1, d.cards[0]]) === 1)
  check('il team e\' lo stesso, riscritto', (await one<{ t: string }>('select team_id::text as t from clear where id = $1', [clear])).t === team &&
    await num('select count(*) from lineup where team_id = $1', [team]) === 1)
  const prove = await q<{ url: string; is_reachable: boolean | null }>(
    'select url, is_reachable from clear_proof where version_id = $1 order by url', [v2])
  check('le prove della v2 sono quelle del payload', prove.length === 2, JSON.stringify(prove))
  check('la prova rimasta porta il suo controllo, la nuova no',
    prove.find((p) => p.url === base.proofs[0].url)?.is_reachable === true &&
    prove.find((p) => p.url.includes('imgur'))?.is_reachable === null)

  console.log('\n  -- un team usato da due clear non si riscrive')
  const altroClear = (await one<{ id: string }>(SUBMIT, [autore, d.run, d.tier, JSON.stringify(base)])).id
  await db.query('update clear set team_id = $2 where id = $1', [altroClear, team])
  await db.query(REVISE, [autore, altroClear, 'Shared team test.', JSON.stringify(base)])
  const t2 = (await one<{ t: string }>('select team_id::text as t from clear where id = $1', [altroClear])).t
  check('il clear rivisto prende un team nuovo', t2 !== team)
  check('il team condiviso resta com\'era', await num('select count(*) from lineup where team_id = $1', [team]) === 1)

  console.log('\n  -- cancellazione')
  r = await esito('select delete_clear($1, $2)', [altro, clear])
  check('un altro non puo\' cancellare', r === '42501', r)
  r = await esito('select delete_clear($1, $2)', [autore, clear])
  check('l\'autore cancella', r === 'ok', r)
  check('in cascata: versioni, assetti congelati, voti, commenti', await num(
    `select (select count(*) from clear_version where clear_id = $1)
          + (select count(*) from clear_lineup where version_id in ($2, $3))
          + (select count(*) from clear_lineup_card where version_id in ($2, $3))
          + (select count(*) from clear_vote where version_id in ($2, $3))
          + (select count(*) from clear_comment where version_id in ($2, $3))`, [clear, v1, v2]) === 0)
  check('la cancellazione non azzera il limite per ora', await num(
    "select count(*) from clear_write_log where user_id = $1 and kind = 'submit'", [autore]) >= 4)
  ctx.clear = altroClear
  ctx.v1 = (await one<{ id: string }>(
    'select id::text from clear_version where clear_id = $1 and is_current', [altroClear])).id
}
