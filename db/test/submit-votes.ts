// Parte di submit.test.mts: voti e commenti sulla versione corrente, e il
// limite per ora di invii e commenti.
import { db } from '@/lib/db'
import { SUBMIT, check, esito, num, one, payload, utente, type Ctx } from '@/db/test/builder-helpers'

const VOTE = 'select vote_clear_version($1::uuid, $2::uuid, $3::smallint) as score'
const COMMENT = 'select comment_clear_version($1::uuid, $2::uuid, $3, $4) as id'

export default async function voti(ctx: Ctx) {
  const { d, autore, altro, clear } = ctx
  const corrente = ctx.v1
  const vecchia = (await one<{ id: string }>(
    'select id::text from clear_version where clear_id = $1 and seq = 1', [clear])).id

  console.log('\n  -- voti sulla versione corrente')
  check('votare torna il punteggio', (await one<{ score: number }>(VOTE, [altro, corrente, 1])).score === 1)
  check('rivotare cambia il valore, non duplica',
    (await one<{ score: number }>(VOTE, [altro, corrente, -1])).score === -1 &&
    await num('select count(*) from clear_vote where version_id = $1', [corrente]) === 1)
  check('0 ritira il voto', (await one<{ score: number }>(VOTE, [altro, corrente, 0])).score === 0 &&
    await num('select count(*) from clear_vote where version_id = $1', [corrente]) === 0)
  check('ritirare un voto che non c\'e\' non e\' un errore', await esito(VOTE, [altro, corrente, 0]) === 'ok')
  let r = await esito(VOTE, [autore, corrente, 1])
  check('il proprio clear non si vota', r === '42501 builder_own_vote', r)
  r = await esito(VOTE, [altro, vecchia, 1])
  check('una versione superata non si vota', r === '23514 builder_version_stale', r)
  r = await esito(VOTE, [altro, corrente, 2])
  check('un voto vale -1, 0 o 1', r === '23514 builder_vote_value', r)
  r = await esito(VOTE, [altro, '00000000-0000-4000-8000-000000000000', 1])
  check('una versione inesistente', r === '23514 builder_version_missing', r)
  r = await esito(VOTE, [ctx.nuovo, corrente, 1])
  check('chi non ha finito /welcome non vota', r === '42501 builder_author', r)
  await db.query("update clear set status = 'hidden' where id = $1", [clear])
  r = await esito(VOTE, [altro, corrente, 1])
  check('un clear nascosto non si vota', r === '23514 builder_version_missing', r)
  await db.query("update clear set status = 'published' where id = $1", [clear])

  console.log('\n  -- commenti sulla versione corrente')
  r = await esito(COMMENT, [altro, corrente, '  Nice rotation.  ', 'en'])
  check('commentare la corrente', r === 'ok', r)
  check('il testo e\' ripulito', (await one<{ body: string }>(
    'select body from clear_comment where version_id = $1', [corrente])).body === 'Nice rotation.')
  check('l\'autore puo\' rispondere', await esito(COMMENT, [autore, corrente, 'Thanks!', null]) === 'ok')
  r = await esito(COMMENT, [altro, corrente, '   ', null])
  check('commento vuoto', r === '23514 builder_comment', r)
  r = await esito(COMMENT, [altro, corrente, 'x'.repeat(1001), null])
  check('commento oltre i 1000 caratteri', r === '23514 builder_comment', r)
  r = await esito(COMMENT, [altro, corrente, 'Hi', 'xx'])
  check('lingua del commento sconosciuta', r === '23514 builder_lang', r)
  r = await esito(COMMENT, [altro, vecchia, 'Late reply', null])
  check('una versione superata non si commenta', r === '23514 builder_version_stale', r)

  console.log('\n  -- il limite per ora')
  const veloce = await utente(ctx.prefisso, 'sub_fast')
  const p = JSON.stringify(payload(d.cards))
  let passati = 0
  for (let i = 0; i < 10; i++) if (await esito(SUBMIT, [veloce, d.run, d.tier, p]) === 'ok') passati++
  check('dieci invii in un\'ora passano', passati === 10, String(passati))
  r = await esito(SUBMIT, [veloce, d.run, d.tier, p])
  check('l\'undicesimo e\' fermato', r === '54000 builder_rate_limit', r)
  await db.query('select delete_clear($1, id) from clear where author_id = $1 limit 1', [veloce])
  r = await esito(SUBMIT, [veloce, d.run, d.tier, p])
  check('cancellarne uno non riapre il limite', r === '54000 builder_rate_limit', r)
  await db.query("update clear_write_log set at = at - interval '61 minutes' where user_id = $1", [veloce])
  r = await esito(SUBMIT, [veloce, d.run, d.tier, p])
  check('passata l\'ora si invia di nuovo', r === 'ok', r)
  check('un altro utente non ne risente', await esito(SUBMIT, [autore, d.run, d.tier, p]) === 'ok')

  for (let i = 0; i < 30; i++) await db.query(COMMENT, [veloce, corrente, `Comment ${i}`, null])
  r = await esito(COMMENT, [veloce, corrente, 'One too many', null])
  check('il trentunesimo commento in un\'ora e\' fermato', r === '54000 builder_rate_limit', r)
}
