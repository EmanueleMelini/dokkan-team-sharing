// Le letture vere di lib/profiles.ts, per profiles.test.mts: il profilo
// per handle (maiuscole, forme sbagliate, chi non c'e'), i conteggi che
// contano solo il visibile, la lista dei clear con la pagina del tier.
import { db } from '@/lib/db'
import { clearPage } from '@/lib/queries'
import { listUserClears, resolveHandle, PROFILE_CLEARS_PER_PAGE } from '@/lib/profiles'
import {
  REVISE, SUBMIT, check, dati, esito, num, one, payload, q, utente,
} from '@/db/test/builder-helpers'
import { P } from '@/db/test/profiles-handle'

export const HANDLE_LIB = ['proflib_x', 'proflib_y', 'proflib_z', 'user_proflib0']
const VOTE = 'select vote_clear_version($1::uuid, $2::uuid, $3::smallint)'
const COMMENT = 'select comment_clear_version($1::uuid, $2::uuid, $3, $4) as id'
const vale = (nome: string, got: unknown, atteso: unknown) => {
  const g = JSON.stringify(got), a = JSON.stringify(atteso)
  check(nome, g === a, g === a ? `= ${g}` : `= ${g}, atteso ${a}`)
}
const versione = async (clear: string) =>
  (await one<{ id: string }>('select version_id::text as id from clear_current where id = $1', [clear]))!.id

export async function letture() {
  console.log('\n  -- resolveHandle')
  const d = await dati()
  const [x, y, z] = await Promise.all(HANDLE_LIB.slice(0, 3).map((h) => utente(P, h)))
  await utente(P, 'user_proflib0', false)
  // Il limite di 10 invii per ora vale anche qui: per i test si svuota il
  // registro degli utenti della suite.
  const libera = (u: string) => db.query('delete from clear_write_log where user_id = $1', [u])
  const invia = async (u: string, run = d.run, tier = d.tier) => {
    const r = await one<{ id: string }>(SUBMIT, [u, run, tier, JSON.stringify(payload(d.cards))])
    await libera(u)
    return r!.id
  }

  const r = await resolveHandle('proflib_x')
  check('l\'handle esatto', r?.kind === 'found' && r.profile.handle === 'proflib_x')
  if (r?.kind === 'found') {
    vale('solo le colonne pubbliche', Object.keys(r.profile).sort(),
      ['clears', 'comments', 'handle', 'joined_at', 'reg', 'upvotes'])
    check('joined_at e\' una data', r.profile.joined_at instanceof Date)
  }
  const maiuscole = await resolveHandle('PROFLIB_X')
  check('le maiuscole diverse lo trovano, con la forma salvata (la pagina fa il 308)',
    maiuscole?.kind === 'found' && maiuscole.profile.handle === 'proflib_x')
  for (const s of ['ab', 'a-b', 'x'.repeat(25), '%27', '', "x' or 1=1--", 'proflib x']) {
    vale(`"${s.slice(0, 12)}": null`, await resolveHandle(s), null)
  }
  vale('un handle che non c\'e\': null', await resolveHandle('proflib_nobody'), null)
  vale('chi non ha finito /welcome: null', await resolveHandle('user_proflib0'), null)
  vale('un valore che non e\' testo: null', await resolveHandle(42), null)

  console.log('\n  -- i conteggi')
  // 22 clear di x nello stesso tier: due pagine. Gli ultimi due nella
  // stessa transazione, con la stessa data: vince l'id piu' alto.
  const ids: string[] = []
  for (let i = 0; i < 20; i++) ids.push(await invia(x))
  const c = await db.connect()
  try {
    await c.query('begin')
    for (let i = 0; i < 2; i++) ids.push((await c.query(SUBMIT, [x, d.run, d.tier, JSON.stringify(payload(d.cards))])).rows[0].id)
    await c.query('commit')
  } finally {
    c.release()
  }
  await libera(x)
  const nascosto = await invia(x)
  const segnalato = await invia(x)
  await db.query(`update clear set status = 'hidden' where id = $1`, [nascosto])
  await db.query(`update clear set status = 'flagged' where id = $1`, [segnalato])
  // altri clear nello stesso tier, per la pagina
  const altri = [await invia(y), await invia(y), await invia(z)]

  // voti: +1 su v1, revisione, +1 su v2 (due), -1 su un altro (non conta),
  // +1 su un clear nascosto (non conta)
  const [primo, secondo] = ids
  await db.query(VOTE, [y, await versione(primo), 1])
  check('la revisione riesce', await esito(REVISE, [x, primo, 'Swapped the friend.', JSON.stringify(payload(d.cards))]) === 'ok')
  await libera(x)
  await db.query(VOTE, [z, await versione(primo), 1])
  await db.query(VOTE, [y, await versione(secondo), -1])
  await db.query(`update clear set status = 'published' where id = $1`, [nascosto])
  await db.query(VOTE, [z, await versione(nascosto), 1])
  await db.query(`update clear set status = 'hidden' where id = $1`, [nascosto])
  await db.query(VOTE, [x, await versione(altri[0]), 1])

  // commenti di x: uno su un clear pubblicato, uno nascosto dalla
  // moderazione, uno su un clear che poi si nasconde
  await one(COMMENT, [x, await versione(altri[0]), 'Great rotation.', 'en'])
  const tolto = (await one<{ id: string }>(COMMENT, [x, await versione(altri[1]), 'Nice one.', 'en']))!.id
  await db.query(`update clear_comment set status = 'hidden' where id = $1`, [tolto])
  await one(COMMENT, [x, await versione(altri[2]), 'Thanks for sharing.', 'en'])
  await db.query(`update clear set status = 'hidden' where id = $1`, [altri[2]])
  await db.query('delete from clear_write_log where user_id = any($1::uuid[])', [[x, y, z]])

  const p = await resolveHandle('proflib_x')
  const prof = p?.kind === 'found' ? p.profile : null
  vale('clears: solo i pubblicati (non nascosto, non segnalato)', prof?.clears, ids.length)
  vale('upvotes: i +1 su tutte le versioni, mai i -1 ne\' quelli dei nascosti', prof?.upvotes, 2)
  vale('comments: solo i pubblicati su clear pubblicati', prof?.comments, 1)
  check('gli eventi per i tag della cache: quello dei clear', p?.kind === 'found' && p.eventIds.includes(String(
    (await one<{ e: string }>('select event_id::text as e from clear where id = $1', [primo]))!.e)))
  return { d, x, ids, nascosto, segnalato, altri, invia }
}

type Contesto = Awaited<ReturnType<typeof letture>>

export async function lista(ctx: Contesto) {
  console.log('\n  -- listUserClears')
  const { d, x, ids, nascosto, segnalato } = ctx
  const p1 = await listUserClears('proflib_x')
  const p2 = await listUserClears('PROFLIB_X', { offset: PROFILE_CLEARS_PER_PAGE })
  vale('pagina 1: venti', p1.length, PROFILE_CLEARS_PER_PAGE)
  vale('pagina 2: il resto (anche con le maiuscole diverse)', p2.length, ids.length - PROFILE_CLEARS_PER_PAGE)
  const tutti = [...p1, ...p2].map((c) => c.id)
  check('nessun nascosto ne\' segnalato', !tutti.includes(nascosto) && !tutti.includes(segnalato))
  const atteso = await q<{ id: string }>(
    `select id::text from clear where author_id = $1 and status = 'published' order by created_at desc, id desc`, [x])
  vale('dal piu\' recente, a parita\' di data l\'id piu\' alto', tutti, atteso.map((r) => r.id))
  const pari = await q<{ id: string }>(
    `select id::text from clear where id = any($1::uuid[]) order by id desc`, [ids.slice(20, 22)])
  vale('i due della stessa transazione: id desc', tutti.slice(0, 2), pari.map((r) => r.id))

  const reg = (await one<{ reg: string }>('select reg::text from event_run where id = $1', [d.run]))!.reg as 'global' | 'japan'
  const sbagliate: string[] = []
  for (const c of [...p1, ...p2]) {
    const vera = await clearPage(c.tier_id, reg, c.id)
    if (vera !== c.page) sbagliate.push(`${c.id}: ${c.page} invece di ${vera}`)
  }
  check('la pagina di ogni clear e\' quella della lista dell\'evento (ORDINE_CLEAR)', sbagliate.length === 0, sbagliate[0] ?? '')
  check('con piu\' di 20 clear nel tier qualcuno sta a pagina 2', [...p1, ...p2].some((c) => c.page === 2))
  const riga = p1[0]
  check('una riga ha evento, tier, stage e data', !!riga.event_name && /^\d+$/.test(riga.tier_id) &&
    riga.created_at instanceof Date && riga.reg === reg)
  vale('la squadra di partenza: le sette carte, leader prima', [riga.cards.length, riga.cards[0]?.role, riga.cards.at(-1)?.role],
    [7, 'leader', 'friend'])
  check('...con miniatura e nome', riga.cards.every((k) => 'thumb_key' in k && 'name' in k && /^\d+$/.test(k.card_id)))
  // il tipo serve al segnaposto di una carta senza miniatura (riga-clear.tsx)
  const tipi = new Map((await db.query<{ id: string; type: string }>(
    'select id::text, type::text from card where id = any($1::bigint[])', [riga.cards.map((k) => k.card_id)])).rows
    .map((r) => [r.id, r.type]))
  check('...e il tipo della carta, uno dei cinque', riga.cards.length > 0 && riga.cards.every((k) =>
    ['AGL', 'TEQ', 'INT', 'STR', 'PHY'].includes(k.type) && k.type === tipi.get(k.card_id)),
    riga.cards.map((k) => `${k.card_id}:${k.type}`).join(' '))
  const rivisto = [...p1, ...p2].find((c) => c.id === ids[0])
  vale('il clear rivisto ha due versioni', rivisto?.versions, 2)

  console.log('\n  -- una regione e un evento senza nome inglese')
  const jp = await one<{ run: string; tier: string }>(
    `select r.id::text as run, st.id::text as tier from event_run r join stage_tier st on st.event_id = r.event_id
     where r.reg = 'japan' and r.starts_at <= now() order by r.id, st.id limit 1`)
  if (jp) {
    const idJp = await ctx.invia(x, jp.run, jp.tier)
    const c = (await listUserClears('proflib_x', { limit: 1 }))[0]
    check('un clear della versione giapponese ha reg japan, e la sua pagina', c?.id === idJp && c.reg === 'japan' &&
      c.page === await clearPage(jp.tier, 'japan', idJp))
    const evento = (await one<{ e: string }>('select event_id::text as e from clear where id = $1', [idJp]))!.e
    const testo = await one<{ r: unknown }>(
      `select row_to_json(t) as r from event_text t where event_id = $1 and locale = 'en'`, [evento])
    await db.query(`delete from event_text where event_id = $1 and locale = 'en'`, [evento])
    try {
      vale('senza nome inglese: "Event <id>"', (await listUserClears('proflib_x', { limit: 1 }))[0]?.event_name, `Event ${evento}`)
    } finally {
      if (testo) {
        await db.query(`insert into event_text select * from json_populate_record(null::event_text, $1::json)`,
          [JSON.stringify(testo.r)])
      }
    }
    check('il nome inglese e\' tornato', !testo || await num(
      `select count(*) from event_text where event_id = $1 and locale = 'en'`, [evento]) === 1)
  }
  vale('un handle non valido: lista vuota', await listUserClears('a-b'), [])
  vale('un handle che non c\'e\': lista vuota', await listUserClears('proflib_nobody'), [])
}
