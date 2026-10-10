// Verifica il digest email (migrazione 0029), lato SQL: il budget (i magic
// link contati e mai rifiutati, i tetti di 'notify' nel giorno e nel mese
// dentro i totali, la pausa di 24 ore che ferma il digest e non il login),
// la selezione (chi lo riceve, cosa contiene con i +N di voti e Helpful,
// la moderazione in forma generica, niente digest vuoti, l'ordine di
// priorita' e il tetto per giro), la contabilita' dopo l'invio (uno al
// giorno, la finestra che riparte), la casella di Settings e la
// disiscrizione dal link (senza sessione, la versione che revoca).
//
// Gira sul database di test (npm run db:test). Crea solo utenti
// digesttest+...@example.invalid e li toglie alla fine, anche se qualcosa
// fallisce. Il budget si prova dentro una transazione che si annulla:
// email_quota e notify_state restano come prima.
import type pg from 'pg'
import { db } from '@/lib/db'
import { TABLES } from '../prod/tables.mjs'
import {
  SUBMIT, check, dati, esito, num, one, payload, q, stato, utente, guardia, type Dati,
} from '@/db/test/builder-helpers'

guardia()
const P = 'digesttest'

const CONSUME = 'select email_budget_consume($1, $2) as n'
const USAGE = 'select * from email_budget_usage()'
const DUE = 'select *, upto::text as upto_txt from digest_due($1, $2::timestamptz)'
// upto = adesso lo calcola Postgres: un ISO di JavaScript ha solo i millesimi, mentre voted_at = now()
// ha i microsecondi, e un voto nello stesso millesimo della selezione restava fuori (test instabile).
const DUE_NOW = 'select *, upto::text as upto_txt from digest_due($1, clock_timestamp())'
const MARK = 'select digest_mark_sent($1::uuid[], $2::timestamptz, $3::date) as n'
const DIGEST = 'select set_email_digest($1::uuid, $2) as on'
const UNSUB = 'select notify_unsubscribe($1::uuid, $2) as ok'
const ROTATE = 'select notify_rotate_token($1::uuid) as v'
const COMMENT = 'select comment_clear_version($1::uuid, $2::uuid, $3) as id'
const VOTE = 'select vote_clear_version($1::uuid, $2::uuid, $3::smallint)'
const POST_TIP = 'select post_tip($1::uuid, $2::bigint, $3::bigint, $4, null)::text as id'
const VOTE_TIP = 'select vote_tip($1::uuid, $2::uuid, 1::smallint)'
const HIDE_CLEAR = 'select mod_set_clear_status($1::uuid, $2::uuid, $3, $4) as n'
const SUSPEND = 'select mod_suspend_user($1::uuid, $2::uuid, $3::timestamptz, $4) as until'
const REPORT = 'select report_content($1::uuid, $2, $3::uuid, $4, $5) as id'

type Item = {
  id: number; kind: string; target: string; n: number; actor_handle: string | null
  event_name: string | null; stage_seq: number | null; stage_name: string | null; difficulty: string | null
}
type Due = {
  user_id: string; email: string; handle: string; token_v: number; is_admin: boolean
  has_moderation: boolean; since: Date; upto: Date; upto_txt: string; day: string; votes: number; helpful: number; items: Item[]
}

const id = async (text: string, params: unknown[]) => (await one<{ id: string }>(text, params)).id
const versione = async (clear: string) =>
  (await one<{ id: string }>('select id::text from clear_version where clear_id = $1 and is_current', [clear])).id
/** Un utente di prova con l'email verificata (il digest la vuole). */
const verificato = async (handle: string) => {
  const u = await utente(P, handle)
  await db.query('update app_user set email_verified = true where id = $1', [u])
  return u
}
/** digest_due ristretto ai nostri utenti, con upto = adesso (senza il minuto di ritardo). */
const dovuti = async (limit = 100, upto: string | null = 'now') =>
  (await (upto === 'now' ? q<Due>(DUE_NOW, [limit]) : q<Due>(DUE, [limit, upto])))
    .filter((r) => r.email.startsWith(`${P}+`))
const di = async (user: string) => (await dovuti()).find((r) => r.user_id === user)

async function regole() {
  console.log('\n  -- tabelle, colonne, tetti (0029)')
  const caps = await one<Record<string, number>>('select * from email_budget_caps()')
  check('i tetti: notify 40 al giorno e 1200 al mese, totali 60 e 2400',
    caps.notify_day === 40 && caps.total_day === 60 && caps.notify_month === 1200 && caps.total_month === 2400,
    JSON.stringify(caps))
  const col = await q<{ c: string; ty: string; d: string | null }>(
    `select column_name as c, data_type as ty, column_default as d from information_schema.columns
      where table_name = 'app_user' and column_name like 'notify\\_%' order by 1`)
  check('app_user: notify_digest_on_at, notify_digest_at, notify_digest_day, notify_token_v',
    col.map((r) => r.c).join(',') === 'notify_digest_at,notify_digest_day,notify_digest_on_at,notify_token_v' &&
    col.find((r) => r.c === 'notify_token_v')?.d === '1', col.map((r) => `${r.c}:${r.ty}`).join(','))
  check('notify_state: una riga sola, e il check impedisce la seconda',
    await num('select count(*) from notify_state') === 1 &&
    await esito('insert into notify_state (id) values (false)') === '23514 notify_state_one')
  const fk = await num(`select count(*) from pg_constraint where contype = 'f'
                          and conrelid in ('email_quota'::regclass, 'notify_state'::regclass)`)
  check('email_quota e notify_state non puntano a nessun utente (niente FK nuove verso app_user)', fk === 0)
  check('db/prod/tables.mjs: email_quota e notify_state sono dati degli utenti',
    (TABLES as Record<string, { class: string }>).email_quota?.class === 'user' &&
    (TABLES as Record<string, { class: string }>).notify_state?.class === 'user')
  const nuovo = await one<{ on: Date | null; v: number }>(
    'select notify_digest_on_at as on, notify_token_v as v from app_user where id = $1', [await utente(P, 'dg_default')])
  check('un utente nuovo ha il digest spento e i link alla versione 1', nuovo.on === null && nuovo.v === 1)
  // il feed degli admin (0032) non va mai per email: lo prova sulle righe vere db/test/attivita.test.mts
  const src = (await one<{ s: string }>(`select prosrc as s from pg_proc where proname = 'digest_due'`)).s
  check('digest_due tiene fuori site_activity dagli items', /r\.kind <> 'site_activity'/.test(src))
}

/** Il budget, in una transazione che si annulla alla fine. */
async function budget() {
  console.log('\n  -- email_budget_consume: auth mai rifiutato, i tetti di notify, la pausa')
  const c: pg.PoolClient = await db.connect()
  const n = async (kind: string, k = 1) => Number((await c.query(CONSUME, [kind, k])).rows[0].n)
  const uso = async () => (await c.query(USAGE)).rows[0] as Record<string, number | Date | null>
  const err = async (text: string, params: unknown[]) => {
    await c.query('savepoint s')
    try { await c.query(text, params); await c.query('release savepoint s'); return 'ok' }
    catch (e) { await c.query('rollback to savepoint s'); const x = e as pg.DatabaseError; return `${x.code} ${x.constraint ?? ''}`.trim() }
  }
  try {
    await c.query('begin')
    await c.query('delete from email_quota')
    await c.query('update notify_state set paused_until = null, paused_reason = null')
    check('tipo sconosciuto: email_quota_kind', await err(CONSUME, ['spam', 1]) === '23514 email_quota_kind')
    check('quantita\' fuori da 1..100: email_quota_n', await err(CONSUME, ['notify', 0]) === '23514 email_quota_n' &&
      await err(CONSUME, ['auth', 101]) === '23514 email_quota_n')

    check('notify: 30 su 30 chieste', await n('notify', 30) === 30)
    check('notify: ne chiede 30, ne passano 10 (tetto di 40 al giorno)', await n('notify', 30) === 10)
    check('notify: oltre il tetto del giorno, 0', await n('notify') === 0)
    check('auth: sempre contato e concesso, anche oltre ogni tetto', await n('auth', 100) === 100 && await n('auth') === 1)
    const u = await uso()
    check('usage: notify 40, totale 141 oggi', u.notify_day === 40 && u.total_day === 141, JSON.stringify(u))

    // il totale del giorno: con 55 login, ne restano 5 a notify anche sotto il suo tetto
    await c.query('delete from email_quota')
    await n('auth', 55)
    check('notify: il totale di 60 al giorno conta i login (55 auth, 5 notify)', await n('notify', 40) === 5)

    // i tetti del mese: righe dei giorni prima, nel mese (solo se oggi non e' il primo)
    await c.query('delete from email_quota')
    const ieri = (await c.query(
      `select (now() at time zone 'UTC')::date - 1 as d,
              date_trunc('month', now() at time zone 'UTC')::date <= (now() at time zone 'UTC')::date - 1 as nel_mese`)).rows[0]
    if (ieri.nel_mese) {
      await c.query(`insert into email_quota (day, kind, n) values ($1, 'notify', 1190)`, [ieri.d])
      check('notify: il tetto di 1200 al mese (1190 ieri, ne passano 10)', await n('notify', 40) === 10)
      await c.query('delete from email_quota')
      await c.query(`insert into email_quota (day, kind, n) values ($1, 'auth', 2390)`, [ieri.d])
      check('notify: il totale di 2400 al mese conta i login (2390 ieri, ne passano 10)', await n('notify', 40) === 10)
    } else {
      check('i tetti del mese: oggi e\' il primo del mese, provati solo col mese scorso', true)
    }
    await c.query('delete from email_quota')
    await c.query(`insert into email_quota (day, kind, n)
                   values (date_trunc('month', now() at time zone 'UTC')::date - 1, 'notify', 5000)`)
    check('il mese scorso non conta', await n('notify', 40) === 40)

    console.log('\n  -- notify_pause: 24 ore, il digest si ferma e il login no')
    await c.query('delete from email_quota')
    const fine = (await c.query(`select notify_pause('daily_quota_exceeded') as t`)).rows[0].t as Date
    const ore = (fine.getTime() - Date.now()) / 3600e3
    check('la pausa dura 24 ore', ore > 23.9 && ore <= 24.01, ore.toFixed(3))
    check('in pausa notify riceve 0, e non conta niente', await n('notify', 10) === 0 &&
      (await uso()).notify_day === 0)
    check('in pausa auth passa e conta', await n('auth') === 1 && (await uso()).total_day === 1)
    check('notify_paused_until e usage la vedono',
      (await c.query('select notify_paused_until() as t')).rows[0].t?.getTime() === fine.getTime() &&
      ((await uso()).paused_until as Date)?.getTime() === fine.getTime())
    await c.query(`update notify_state set paused_until = now() + interval '48 hours'`)
    const lunga = (await c.query('select paused_until as t from notify_state')).rows[0].t as Date
    const dopo = (await c.query(`select notify_pause('rate_limit_exceeded') as t`)).rows[0].t as Date
    check('un secondo 429 non accorcia una pausa piu\' lunga', dopo.getTime() === lunga.getTime())
    check('il motivo e\' un codice breve (al massimo 60 caratteri)',
      (await c.query('select paused_reason as r from notify_state')).rows[0].r === 'rate_limit_exceeded')
    await c.query(`update notify_state set paused_until = now() - interval '1 second'`)
    check('a pausa finita notify riparte', await n('notify', 3) === 3 &&
      (await c.query('select notify_paused_until() as t')).rows[0].t === null)

    console.log('\n  -- purge_email_quota: oltre 40 giorni')
    await c.query(`insert into email_quota (day, kind, n) values
                     ((now() at time zone 'UTC')::date - 41, 'auth', 1),
                     ((now() at time zone 'UTC')::date - 39, 'auth', 1)`)
    const tolte = Number((await c.query('select purge_email_quota() as n')).rows[0].n)
    check('toglie i giorni oltre i 40 e lascia gli altri', tolte === 1 &&
      Number((await c.query(`select count(*) from email_quota where day = (now() at time zone 'UTC')::date - 39`)).rows[0].count) === 1)
  } finally {
    await c.query('rollback')
    c.release()
  }
}

type Mondo = {
  d: Dati; eventId: string
  autore: string; admin: string; modded: string; sospeso: string; vecchio: string; vuoto: string
  spento: string; nonver: string; v1: string; v2: string; v3: string
  clearA: string; vA: string; clearM: string; clearV2: string; clearSpento: string; clearVecchio: string; tip: string
}

/** Come in notifiche.test.mts: un tier su una run gia' iniziata e otto carte uscite. */
async function datiMinimi(): Promise<Dati> {
  try { return await dati() } catch { /* nessuna ricorrenza futura: va bene lo stesso */ }
  const base = await one<{ run: string; tier: string }>(
    `select r.id::text as run, st.id::text as tier
       from event_run r join stage_tier st on st.event_id = r.event_id
      where r.starts_at <= now() order by r.event_id, r.id, st.id limit 1`)
  const cards = (await q<{ id: string }>(
    `select c.id::text from card c join card_release r on r.card_id = c.id and r.reg = 'global'
      where r.released_at <= current_date order by c.id limit 8`)).map((r) => Number(r.id))
  return { run: base.run, tier: base.tier, futura: '', altraRun: '', cards }
}

// I testi che non devono MAI finire nel digest: li cerchiamo nel JSON.
const SEGRETI = {
  commento: 'Secret comment body ASDF',
  commento2: 'Another secret comment QWER',
  nota: 'Moderator note ZXCV',
  motivo: 'Suspension reason POIU',
  dettagli: 'Report details LKJH',
  tip: 'Secret tip body MNBV for the boss.',
}

async function mondo(): Promise<Mondo> {
  const d = await datiMinimi()
  const eventId = (await one<{ e: string }>('select event_id::text as e from event_run where id = $1', [d.run])).e
  const [autore, admin, modded, sospeso, vecchio, vuoto, spento, nonver] = [
    await verificato('dg_autore'), await verificato('dg_admin'), await verificato('dg_modded'),
    await verificato('dg_sospeso'), await verificato('dg_vecchio'), await verificato('dg_vuoto'),
    await verificato('dg_spento'), await utente(P, 'dg_nonver')]
  const [v1, v2, v3] = [await utente(P, 'dg_v1'), await utente(P, 'dg_v2'), await utente(P, 'dg_v3')]
  await db.query(`update app_user set role = 'admin' where id = $1`, [admin])
  const clear = async (u: string) => id(SUBMIT, [u, d.run, d.tier, JSON.stringify(payload(d.cards))])
  const clearA = await clear(autore)
  const clearM = await clear(modded)
  const clearV2 = await clear(v2)
  const clearSpento = await clear(spento)
  const clearVecchio = await clear(vecchio)
  const tip = await id(POST_TIP, [autore, eventId, d.tier, SEGRETI.tip])
  return {
    d, eventId, autore, admin, modded, sospeso, vecchio, vuoto, spento, nonver, v1, v2, v3,
    clearA, vA: await versione(clearA), clearM, clearV2, clearSpento, clearVecchio, tip,
  }
}

async function casella(m: Mondo) {
  console.log('\n  -- set_email_digest: la casella di Settings, spenta per difetto')
  check('senza email verificata non si accende: email_not_verified',
    await esito(DIGEST, [m.nonver, true]) === '42501 email_not_verified')
  check('ma si spegne sempre', await esito(DIGEST, [m.nonver, false]) === 'ok')
  check('senza onboarding: user_not_found',
    await esito(DIGEST, [await utente(P, 'dg_nuovo', false), true]) === 'P0002 user_not_found')
  check('null non e\' un valore: notify_digest_value', await esito(DIGEST, [m.autore, null]) === '23514 notify_digest_value')
  const on = async (u: string) =>
    (await one<{ t: Date | null }>('select notify_digest_on_at as t from app_user where id = $1', [u])).t
  for (const u of [m.autore, m.admin, m.modded, m.sospeso, m.vecchio, m.vuoto]) await db.query(DIGEST, [u, true])
  const prima = await on(m.autore)
  await db.query(DIGEST, [m.autore, true])
  check('accesa: il consenso ha un orario, e riaccendere non lo sposta',
    prima !== null && (await on(m.autore))?.getTime() === prima.getTime())
  await db.query(DIGEST, [m.vuoto, false])
  check('spenta: notify_digest_on_at torna null', (await on(m.vuoto)) === null)
  await db.query(DIGEST, [m.vuoto, true])
  // per le prove di priorita' e di finestra: tutti accesi da un'ora
  await db.query(`update app_user set notify_digest_on_at = now() - interval '1 hour'
                   where id = any($1::uuid[])`, [[m.autore, m.admin, m.modded, m.sospeso, m.vecchio, m.vuoto]])
  // chi non ha l'email verificata o l'onboarding non riceve, anche con la colonna accesa a mano
  await db.query(`update app_user set notify_digest_on_at = now() - interval '1 hour' where id = $1`, [m.nonver])
}

async function attivita(m: Mondo) {
  // commenti di altri sul clear dell'autore (l'ultimo e' di v2), e sul clear di chi ha il digest spento
  await id(COMMENT, [m.v1, m.vA, SEGRETI.commento])
  await id(COMMENT, [m.v2, m.vA, SEGRETI.commento2])
  await id(COMMENT, [m.v1, await versione(m.clearSpento), SEGRETI.commento])
  await id(COMMENT, [m.v1, await versione(m.clearVecchio), SEGRETI.commento])
  // un commento sul clear che poi verra' nascosto: la notifica diventa invisibile
  await id(COMMENT, [m.v3, await versione(m.clearM), SEGRETI.commento])
  // un commento anche a nonver: ha la colonna accesa a mano, ma l'email non verificata
  const clearNonver = await id(SUBMIT, [m.nonver, m.d.run, m.d.tier, JSON.stringify(payload(m.d.cards))])
  await id(COMMENT, [m.v1, await versione(clearNonver), SEGRETI.commento])

  // voti: due +1 contano, un -1 no, un +1 di prima dell'accensione no
  await db.query(VOTE, [m.v1, m.vA, 1])
  await db.query(VOTE, [m.v2, m.vA, 1])
  await db.query(VOTE, [m.v3, m.vA, -1])
  await db.query(VOTE, [m.admin, m.vA, 1])
  await db.query(`update clear_vote set voted_at = now() - interval '2 hours' where version_id = $1 and user_id = $2`,
    [m.vA, m.admin])
  // Helpful: due contano, uno di prima dell'accensione no
  for (const u of [m.v1, m.v2, m.v3]) await db.query(VOTE_TIP, [u, m.tip])
  await db.query(`update tip_vote set voted_at = now() - interval '2 hours' where tip_id = $1 and user_id = $2`,
    [m.tip, m.v3])

  // moderazione: un clear nascosto con una nota, una sospensione con un motivo
  await db.query(HIDE_CLEAR, [m.admin, m.clearM, 'hidden', SEGRETI.nota])
  await db.query(SUSPEND, [m.admin, m.sospeso, new Date(Date.now() + 86400e3).toISOString(), SEGRETI.motivo])
  // una segnalazione di v3 (che non commenta nulla di visibile): agli admin
  await db.query(REPORT, [m.v3, 'clear', m.clearV2, 'spam', SEGRETI.dettagli])
}

async function selezione(m: Mondo) {
  console.log('\n  -- digest_due: chi, cosa, in che forma')
  check('con il minuto di ritardo per difetto, le scritture dell\'ultimo minuto aspettano il giro dopo',
    (await dovuti(100, null)).length === 0)
  const tutti = await dovuti()
  const a = tutti.find((r) => r.user_id === m.autore)
  check('l\'autore lo riceve: un commento accorpato (2, l\'ultimo di dg_v2) con evento e tier',
    a?.items.length === 1 && a.items[0].kind === 'clear_comment' && a.items[0].n === 2 &&
    a.items[0].actor_handle === 'dg_v2' && !!a.items[0].event_name && a.items[0].stage_seq !== null &&
    !!a.items[0].difficulty, JSON.stringify(a?.items))
  check('+N voti: due +1 di altri, non il -1, non quello di prima dell\'accensione', a?.votes === 2, String(a?.votes))
  check('+N Helpful: due, non quello di prima dell\'accensione', a?.helpful === 2, String(a?.helpful))
  check('la riga ha email, handle, versione dei link, finestra e giorno UTC',
    a?.email === `${P}+dg_autore@example.invalid` && a.handle === 'dg_autore' && a.token_v === 1 &&
    a.since < a.upto && a.day === (await one<{ d: string }>(`select ((now() at time zone 'UTC')::date)::text as d`)).d &&
    a.is_admin === false && a.has_moderation === false, JSON.stringify({ ...a, items: undefined }))

  const mo = tutti.find((r) => r.user_id === m.modded)
  check('clear nascosto: content_hidden generico (target ed evento, niente tier, niente handle)',
    mo?.has_moderation === true && mo.items.length === 1 && mo.items[0].kind === 'content_hidden' &&
    mo.items[0].target === 'clear' && !!mo.items[0].event_name && mo.items[0].stage_seq === null &&
    mo.items[0].stage_name === null && mo.items[0].actor_handle === null, JSON.stringify(mo?.items))
  check('il commento sul clear nascosto non entra (notifica non piu\' visibile)',
    !mo?.items.some((i) => i.kind === 'clear_comment'))
  const so = tutti.find((r) => r.user_id === m.sospeso)
  check('il sospeso lo riceve: suspended, sull\'account, senza evento e senza data',
    so?.has_moderation === true && so.items.length === 1 && so.items[0].kind === 'suspended' &&
    so.items[0].target === 'account' && so.items[0].event_name === null && !('until' in so.items[0]),
    JSON.stringify(so?.items))
  const ad = tutti.find((r) => r.user_id === m.admin)
  check('l\'admin: reports_open con il conteggio e nient\'altro',
    ad?.is_admin === true && ad.items.length === 1 && ad.items[0].kind === 'reports_open' && ad.items[0].n === 1 &&
    ad.items[0].event_name === null && ad.items[0].actor_handle === null, JSON.stringify(ad?.items))
  check('il vecchio lo riceve (un commento)', tutti.some((r) => r.user_id === m.vecchio))
  check('niente digest vuoti: chi l\'ha acceso senza novita\' non c\'e\'', !tutti.some((r) => r.user_id === m.vuoto))
  check('chi non l\'ha acceso non c\'e\', anche con notifiche', !tutti.some((r) => r.user_id === m.spento))
  check('chi non ha l\'email verificata non c\'e\', anche con la colonna accesa',
    !tutti.some((r) => r.user_id === m.nonver))
  check('chi commenta, vota o segnala non c\'e\'', !tutti.some((r) => [m.v1, m.v2, m.v3].includes(r.user_id)))

  const json = JSON.stringify(tutti)
  const trovati = Object.entries(SEGRETI).filter(([, s]) => json.includes(s)).map(([k]) => k)
  check('mai il testo dei post, la nota del moderatore, il motivo della sospensione, i dettagli della segnalazione',
    trovati.length === 0, trovati.join(','))
  const nItem = JSON.stringify(tutti.map((r) => r.items))
  check('negli item mai l\'handle di chi modera o di chi segnala',
    !nItem.includes('dg_admin') && !nItem.includes('dg_v3'), nItem)
  const chiavi = new Set(tutti.flatMap((r) => r.items.flatMap((i) => Object.keys(i))))
  check('gli item hanno solo le chiavi generiche',
    [...chiavi].sort().join(',') === 'actor_handle,difficulty,event_name,id,kind,n,stage_name,stage_seq,target,updated_at',
    [...chiavi].sort().join(','))

  console.log('\n  -- l\'ordine: admin, poi moderazione, poi chi aspetta da piu\' tempo')
  // modded ha ricevuto due giorni fa, sospeso mai: tra i due prima sospeso
  await db.query(`update app_user set notify_digest_at = now() - interval '2 days',
                    notify_digest_day = (now() at time zone 'UTC')::date - 2 where id = $1`, [m.modded])
  let ordine = (await dovuti()).map((r) => r.handle)
  check('admin, sospeso (mai), modded (2 giorni fa), poi autore e vecchio (mai, per id)',
    ordine.slice(0, 3).join(',') === 'dg_admin,dg_sospeso,dg_modded' &&
    ordine.slice(3).sort().join(',') === 'dg_autore,dg_vecchio', ordine.join(','))
  await db.query(`update app_user set notify_digest_at = now() - interval '1 day',
                    notify_digest_day = (now() at time zone 'UTC')::date - 1 where id = $1`, [m.autore])
  await db.query(`update app_user set notify_digest_at = now() - interval '5 days',
                    notify_digest_day = (now() at time zone 'UTC')::date - 5 where id = $1`, [m.vecchio])
  ordine = (await dovuti()).map((r) => r.handle)
  check('senza moderazione, il piu\' vecchio prima (5 giorni fa prima di ieri)',
    ordine.join(',') === 'dg_admin,dg_sospeso,dg_modded,dg_vecchio,dg_autore', ordine.join(','))
  const due = (await q<Due>(DUE_NOW, [2])).map((r) => r.handle)
  check('p_limit: i primi due per priorita\'', due.join(',') === 'dg_admin,dg_sospeso', due.join(','))
  check('la finestra parte dall\'accensione se e\' piu\' recente dell\'ultimo digest',
    (await di(m.autore))?.votes === 2)

  await db.query('select mark_notifications_read($1::uuid, null)', [m.vecchio])
  check('una notifica letta non entra: il vecchio, senza altro, esce', (await di(m.vecchio)) === undefined)
}

async function invio(m: Mondo) {
  console.log('\n  -- digest_mark_sent: uno al giorno, la finestra riparte da upto')
  const a = (await di(m.autore))!
  const oggi = a.day
  check('upto nel futuro: digest_upto', await esito(MARK, [[m.autore], new Date(Date.now() + 60e3).toISOString(), oggi]) ===
    '23514 digest_upto')
  check('un giorno futuro: digest_day', await esito(MARK, [[m.autore], a.upto_txt, '2999-01-01']) ===
    '23514 digest_day')
  check('segna chi e\' partito: 1', (await one<{ n: number }>(MARK, [[m.autore], a.upto_txt, oggi])).n === 1)
  check('lo stesso giorno non riparte (idempotente per giorno)', (await di(m.autore)) === undefined)
  await id(COMMENT, [m.v3, m.vA, 'A third comment after the digest.'])
  check('nemmeno con una novita\' dopo', (await di(m.autore)) === undefined)
  const salvato = await one<{ at: Date; day: string }>(
    'select notify_digest_at as at, notify_digest_day::text as day from app_user where id = $1', [m.autore])
  check('notify_digest_at = upto, notify_digest_day = oggi',
    salvato.at.getTime() === a.upto.getTime() && salvato.day === oggi)
  await db.query(MARK, [[m.autore], new Date(a.upto.getTime() - 3600e3).toISOString(), '2000-01-01'])
  const dopo = await one<{ at: Date; day: string }>(
    'select notify_digest_at as at, notify_digest_day::text as day from app_user where id = $1', [m.autore])
  check('un giro vecchio che arriva tardi non riapre la finestra',
    dopo.at.getTime() === a.upto.getTime() && dopo.day === oggi)

  // il giorno dopo: si finge spostando il giorno dell'ultimo invio
  await db.query(`update app_user set notify_digest_day = (now() at time zone 'UTC')::date - 1 where id = $1`, [m.autore])
  const domani = await di(m.autore)
  check('il giorno dopo riparte da upto: la notifica accorpata toccata dopo, i voti vecchi no',
    domani?.since.getTime() === a.upto.getTime() && domani.items.length === 1 &&
    domani.items[0].kind === 'clear_comment' && domani.votes === 0 && domani.helpful === 0,
    JSON.stringify({ ...domani, email: undefined }))
  await db.query(VOTE, [m.v3, m.vA, 1])
  check('un -1 cambiato in +1 dopo l\'ultimo digest conta', (await di(m.autore))?.votes === 1)
}

async function disiscrizione(m: Mondo) {
  console.log('\n  -- notify_unsubscribe: dal link, senza sessione, solo spegnere')
  const v = async (u: string) => (await one<{ v: number }>('select notify_token_v as v from app_user where id = $1', [u])).v
  await db.query(`select set_notification_pref($1::uuid, 'clear_comment', 'email', true)`, [m.autore])
  await db.query(`select set_notification_pref($1::uuid, 'clear_comment', 'push', true)`, [m.autore])
  check('versione sbagliata: false, e non spegne niente', (await one<{ ok: boolean }>(UNSUB, [m.autore, 2])).ok === false &&
    (await di(m.autore)) !== undefined)
  check('utente che non c\'e\': false',
    (await one<{ ok: boolean }>(UNSUB, ['00000000-0000-4000-8000-000000000000', 1])).ok === false)
  check('versione giusta: true', (await one<{ ok: boolean }>(UNSUB, [m.autore, 1])).ok === true)
  check('il digest e\' spento e l\'autore esce dalla selezione', (await di(m.autore)) === undefined &&
    (await one<{ t: Date | null }>('select notify_digest_on_at as t from app_user where id = $1', [m.autore])).t === null)
  check('se ne vanno le preferenze email, non quelle push',
    await num(`select count(*) from notification_pref where user_id = $1 and channel = 'email'`, [m.autore]) === 0 &&
    await num(`select count(*) from notification_pref where user_id = $1 and channel = 'push'`, [m.autore]) === 1)
  check('il secondo clic dice lo stesso del primo', (await one<{ ok: boolean }>(UNSUB, [m.autore, 1])).ok === true)
  check('il link non riaccende niente: resta spento', (await di(m.autore)) === undefined)

  const nuova = (await one<{ v: number }>(ROTATE, [m.autore])).v
  check('notify_rotate_token: la versione sale, il link vecchio non vale piu\'', nuova === 2 &&
    (await one<{ ok: boolean }>(UNSUB, [m.autore, 1])).ok === false &&
    (await one<{ ok: boolean }>(UNSUB, [m.autore, 2])).ok === true)
  check('notify_rotate_token di un utente che non c\'e\': null',
    (await one<{ v: number | null }>(ROTATE, ['00000000-0000-4000-8000-000000000000'])).v === null)
  const prima = await v(m.vuoto)
  await db.query('update app_user set display_name = $2 where id = $1', [m.vuoto, 'Someone'])
  check('un update che non tocca l\'email non cambia la versione', (await v(m.vuoto)) === prima)
  await db.query('update app_user set email = $2 where id = $1', [m.vuoto, `${P}+dg_vuoto2@example.invalid`])
  check('cambiare l\'email alza la versione (i link mandati al vecchio indirizzo non valgono)',
    (await v(m.vuoto)) === prima + 1)
}

async function pulizia() {
  // prima i clear, come in filters.test.mts: in una cascata sola il trigger
  // dei voti ricalcolerebbe il punteggio di un clear gia' cancellato
  const nostri = `(select id from app_user where email like $1)`
  await db.query(`delete from clear where author_id in ${nostri}`, [`${P}+%@example.invalid`])
  await db.query('delete from app_user where email like $1', [`${P}+%@example.invalid`])
}

try {
  await pulizia()
  await regole()
  await budget()
  const m = await mondo()
  await casella(m)
  await attivita(m)
  await selezione(m)
  await invio(m)
  await disiscrizione(m)
} finally {
  await pulizia()
  await db.end()
}

console.log(`\n  ${stato.passes} PASS, ${stato.fails} FAIL`)
process.exit(stato.fails ? 1 : 0)
