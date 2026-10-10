// Verifica le push del browser (migrazione 0031), lato SQL: la lista chiusa
// degli host (anche nel CHECK della tabella), le chiavi, i dispositivi (il
// tetto di 5, lo stesso endpoint che passa all'ultimo account, l'uscita che
// toglie solo il proprio), la notifica di prova una al minuto, push_claim
// (preferenza e dispositivo, la coalescenza di 30 minuti, i tetti per
// destinatario, autore e coppia, l'account giovane o sospeso, il contenuto
// nascosto, skip locked, mai il testo dei post), push_report (404 e 410
// tolgono, tre errori di fila tolgono, 413 e 429 no), la conservazione e
// le cascate con l'account.
//
// Gira sul database di test (npm run db:test). Crea solo utenti
// pushtest+...@example.invalid e li toglie alla fine, anche se qualcosa
// fallisce: dispositivi, registro e notifiche se ne vanno con loro.
import { createECDH, randomBytes } from 'node:crypto'
import type pg from 'pg'
import { db } from '@/lib/db'
import { TABLES } from '../prod/tables.mjs'
import {
  SUBMIT, check, dati, esito, guardia, num, one, payload, q, stato, utente, type Dati,
} from '@/db/test/builder-helpers'
import { ENDPOINT_BUONI, ENDPOINT_CATTIVI } from '@/db/test/push-endpoints'

guardia()
const P = 'pushtest'

const OK = 'select push_endpoint_ok($1) as ok'
const SUB = 'select push_subscribe($1::uuid, $2, $3, $4, $5)::text as id'
const UNSUB = 'select push_unsubscribe($1::uuid, $2) as ok'
const REMOVE = 'select push_device_remove($1::uuid, $2::uuid) as ok'
const DEVICES = 'select * from push_devices($1::uuid)'
const TEST = 'select * from push_test($1::uuid, $2)'
const CLAIM = 'select * from push_claim($1)'
const REPORT_PUSH = 'select * from push_report($1::jsonb)'
const PURGE = 'select * from purge_push($1)'
const PREF = 'select set_notification_pref($1::uuid, $2, $3, $4) as on'
const COMMENT = 'select comment_clear_version($1::uuid, $2::uuid, $3) as id'
const HIDE_CLEAR = 'select mod_set_clear_status($1::uuid, $2::uuid, $3, null) as n'
const HIDE_COMMENT = 'select mod_set_comment_status($1::uuid, $2::uuid, $3, null) as n'
const REPORT = 'select report_content($1::uuid, $2, $3::uuid, $4, $5) as id'

const SEGRETO = 'Secret comment body PUSH-ZXQW'

type Device = { id: string; endpoint: string; p256dh: string; auth: string }
type Job = {
  notification_id: string; recipient_id: string; kind: string; group_key: string; n: number
  actor_handle: string | null; target: string; event_name: string | null; stage_seq: number | null
  stage_name: string | null; difficulty: string | null; until: Date | null; devices: Device[]
}

const id = async (text: string, params: unknown[]) => (await one<{ id: string }>(text, params)).id
const versione = async (clear: string) =>
  (await one<{ id: string }>('select id::text from clear_version where clear_id = $1 and is_current', [clear])).id
/** Le chiavi di un'iscrizione vera: un punto P-256 non compresso e 16 byte di auth. */
function chiavi() {
  const e = createECDH('prime256v1')
  e.generateKeys()
  return { p256dh: e.getPublicKey('base64url'), auth: randomBytes(16).toString('base64url') }
}
let nEndpoint = 0
const endpoint = (host = 'fcm.googleapis.com') => `https://${host}/fcm/send/${P}-${++nEndpoint}-${randomBytes(6).toString('hex')}`
/** Iscrive un dispositivo nuovo e torna l'endpoint. */
async function iscrivi(user: string, label: string | null = 'Chrome on Android', ep = endpoint()) {
  const k = chiavi()
  await db.query(SUB, [user, ep, k.p256dh, k.auth, label])
  return ep
}
const nostri = new Set<string>()
/** push_claim ristretto ai nostri destinatari (il claim e' globale). */
const claim = async (limit = 50) =>
  (await q<Job>(CLAIM, [limit])).filter((j) => nostri.has(j.recipient_id))
const sent = async (where: string, params: unknown[]) => num(`select count(*) from push_sent where ${where}`, params)
/** Un utente di prova con l'account vecchio di due giorni (sopra actor_age_hours). */
async function vecchio(handle: string) {
  const u = await utente(P, handle)
  await db.query(`update app_user set created_at = now() - interval '2 days' where id = $1`, [u])
  nostri.add(u)
  return u
}

async function regole() {
  console.log('\n  -- tabelle, tetti, classificazione (0031)')
  const caps = await one<Record<string, number>>('select * from push_caps()')
  check('i tetti: 5 dispositivi, 10 min freschi, 30 min di coalescenza, 20 al giorno, 10 l\'ora per autore, 1 per coppia, 24 h di eta\', 60 s di prova',
    JSON.stringify(caps) === JSON.stringify({ devices: 5, fresh_minutes: 10, coalesce_minutes: 30, recipient_day: 20,
      actor_hour: 10, pair_hour: 1, actor_age_hours: 24, test_seconds: 60 }), JSON.stringify(caps))
  const fk = await q<{ t: string; c: string; del: string }>(
    `select conrelid::regclass::text as t, conname as c, confdeltype::text as del from pg_constraint
      where contype = 'f' and conrelid in ('push_subscription'::regclass, 'push_sent'::regclass) order by 1, 2`)
  check('push_subscription e push_sent: ogni FK verso app_user e\' a cascata',
    fk.length === 3 && fk.every((f) => f.del === 'c'), fk.map((f) => `${f.c}=${f.del}`).join(', '))
  const T = TABLES as Record<string, { class: string }>
  check('db/prod/tables.mjs: push_subscription e push_sent sono dati degli utenti',
    T.push_subscription?.class === 'user' && T.push_sent?.class === 'user')
  check('endpoint unico', await num(`select count(*) from pg_constraint where conname = 'push_subscription_endpoint_unique' and contype = 'u'`) === 1)
}

async function endpoints(u: string) {
  console.log('\n  -- la lista chiusa degli host (push_endpoint_ok e il CHECK)')
  const male: string[] = []
  for (const e of ENDPOINT_BUONI) if (!(await one<{ ok: boolean }>(OK, [e])).ok) male.push(e)
  check('gli host dei browser passano (FCM, Mozilla, Apple, WNS con sottodominio, :443)', male.length === 0, male.join(' '))
  const passati: string[] = []
  for (const e of ENDPOINT_CATTIVI) if ((await one<{ ok: boolean }>(OK, [e])).ok) passati.push(e)
  check('rifiutati: http, senza percorso, maiuscole, altre porte, suffissi e userinfo, IP, frammento, spazi, non ASCII, oltre 1024',
    passati.length === 0, passati.join(' '))
  check('null non passa', (await one<{ ok: boolean | null }>(OK, [null])).ok === false)
  check('esattamente 1024 caratteri passano, 1025 no',
    (await one<{ ok: boolean }>(OK, [`https://fcm.googleapis.com/${'a'.repeat(1024 - 27)}`])).ok &&
    !(await one<{ ok: boolean }>(OK, [`https://fcm.googleapis.com/${'a'.repeat(1025 - 27)}`])).ok)
  const k = chiavi()
  check('il CHECK della tabella morde anche senza il verbo',
    await esito(`insert into push_subscription (user_id, endpoint, p256dh, auth) values ($1, $2, $3, $4)`,
      [u, 'https://evil.example/x', k.p256dh, k.auth]) === '23514 push_subscription_endpoint_check')
  check('il verbo dice push_endpoint', await esito(SUB, [u, 'https://169.254.169.254/latest', k.p256dh, k.auth, null]) === '23514 push_endpoint')
}

async function dispositivi(u: string, altro: string) {
  console.log('\n  -- push_subscribe, push_unsubscribe, push_device_remove, push_devices')
  const k = chiavi()
  check('senza onboarding: user_not_found',
    await esito(SUB, [await utente(P, 'ps_nuovo', false), endpoint(), k.p256dh, k.auth, null]) === 'P0002 user_not_found')
  check('utente che non c\'e\': user_not_found',
    await esito(SUB, ['00000000-0000-4000-8000-000000000000', endpoint(), k.p256dh, k.auth, null]) === 'P0002 user_not_found')
  const cattive: [string, string][] = [
    ['A' + k.p256dh.slice(1), k.auth], [k.p256dh.slice(0, 86), k.auth], [k.p256dh + 'A', k.auth],
    ['BQ' + k.p256dh.slice(2), k.auth], [k.p256dh.replace(/.$/, '+'), k.auth],
    [k.p256dh, k.auth.slice(0, 21)], [k.p256dh, k.auth + 'AA'], [k.p256dh, k.auth.replace(/^./, '/')], ['', ''],
  ]
  const passate = []
  for (const [p, a] of cattive) if (await esito(SUB, [u, endpoint(), p, a, null]) !== '23514 push_keys') passate.push(`${p}/${a}`)
  check('chiavi sbagliate (non 0x04, lunghezze, base64 non url, vuote): push_keys', passate.length === 0, passate.join(' '))
  check('chiavi null: push_keys', await esito(SUB, [u, endpoint(), null, null, null]) === '23514 push_keys')

  const ep = endpoint()
  const primo = await id(SUB, [u, ep, k.p256dh + '=', k.auth + '==', '  Firefox\u0007 on\nWindows  '])
  const riga = await one<Record<string, unknown>>('select * from push_subscription where id = $1', [primo])
  check('il padding si toglie, la label si ripulisce dai caratteri di controllo',
    riga.p256dh === k.p256dh && riga.auth === k.auth && riga.label === 'Firefox  on Windows', String(riga.label))
  check('label lunga: tagliata a 60, vuota: null',
    (await one<{ l: string }>(`select label as l from push_subscription where id = $1::uuid`,
      [await id(SUB, [u, endpoint(), k.p256dh, k.auth, 'x'.repeat(80)])])).l.length === 60 &&
    (await one<{ l: string | null }>(`select label as l from push_subscription where id = $1::uuid`,
      [await id(SUB, [u, endpoint(), k.p256dh, k.auth, '   '])])).l === null)

  await db.query(`update push_subscription set seen_at = now() - interval '3 days', failures = 2, last_ok_at = now() - interval '1 day'
                   where id = $1`, [primo])
  const di_nuovo = await id(SUB, [u, ep, k.p256dh, k.auth, null])
  const dopo = await one<Record<string, Date | number | string | null>>('select * from push_subscription where id = $1', [primo])
  check('il resync con lo stesso endpoint: stessa riga, seen_at rinnovato, label e storia tenute',
    di_nuovo === primo && (dopo.seen_at as Date).getTime() > Date.now() - 60e3 && dopo.label === 'Firefox  on Windows' &&
    dopo.failures === 2 && dopo.last_ok_at !== null && (dopo.created_at as Date).getTime() === (riga.created_at as Date).getTime())
  const k2 = chiavi()
  await db.query(SUB, [u, ep, k2.p256dh, k2.auth, null])
  check('chiavi nuove sullo stesso endpoint: aggiornate, errori azzerati',
    (await one<{ p: string; f: number }>('select p256dh as p, failures as f from push_subscription where id = $1', [primo]))
      .p === k2.p256dh && (await num('select failures from push_subscription where id = $1', [primo])) === 0)

  await db.query(`update push_subscription set test_at = now() where id = $1`, [primo])
  const passato = await id(SUB, [altro, ep, k2.p256dh, k2.auth, 'Shared PC'])
  const mossa = await one<Record<string, unknown>>('select * from push_subscription where endpoint = $1', [ep])
  check('lo stesso endpoint su un altro account passa all\'ultimo, con la storia azzerata',
    passato === primo && mossa.user_id === altro && mossa.label === 'Shared PC' && mossa.last_ok_at === null &&
    mossa.test_at === null && mossa.last_status === null &&
    await num('select count(*) from push_subscription where endpoint = $1', [ep]) === 1)
  check('push_unsubscribe dell\'account di prima non tocca quella dell\'altro',
    (await one<{ ok: boolean }>(UNSUB, [u, ep])).ok === false &&
    await num('select count(*) from push_subscription where endpoint = $1', [ep]) === 1)
  check('push_device_remove di un altro utente: false', (await one<{ ok: boolean }>(REMOVE, [u, primo])).ok === false)
  check('push_unsubscribe del proprietario: true, e la riga se ne va',
    (await one<{ ok: boolean }>(UNSUB, [altro, ep])).ok === true &&
    await num('select count(*) from push_subscription where endpoint = $1', [ep]) === 0)
  check('push_unsubscribe di nuovo: false, nessun errore', (await one<{ ok: boolean }>(UNSUB, [altro, ep])).ok === false)

  await db.query('delete from push_subscription where user_id = $1', [u])
  const eps: string[] = []
  for (let i = 0; i < 5; i++) eps.push(await iscrivi(u, `Device ${i}`))
  const k3 = chiavi()
  check('il sesto dispositivo: push_device_limit', await esito(SUB, [u, endpoint(), k3.p256dh, k3.auth, null]) === '54000 push_device_limit')
  check('al tetto, il resync di uno dei 5 passa', await esito(SUB, [u, eps[0], k3.p256dh, k3.auth, null]) === 'ok')
  const lista = await q<Record<string, unknown>>(DEVICES, [u])
  check('push_devices: 5, il piu\' vecchio prima, con l\'endpoint e senza chiavi',
    lista.length === 5 && lista[0].label === 'Device 0' && lista[0].endpoint === eps[0] &&
    !('p256dh' in lista[0]) && !('auth' in lista[0]), Object.keys(lista[0] ?? {}).join(','))
  check('push_device_remove del proprio: true', (await one<{ ok: boolean }>(REMOVE, [u, lista[4].id])).ok === true)
  check('dopo il Remove il sesto entra', await esito(SUB, [u, endpoint(), k3.p256dh, k3.auth, null]) === 'ok')
  check('push_devices di un altro utente non mostra i miei', (await q(DEVICES, [altro])).length === 0)

  console.log('\n  -- push_test: la notifica di prova, una al minuto')
  const t = await q<Device>(TEST, [u, eps[1]])
  check('torna il dispositivo con le chiavi', t.length === 1 && t[0].endpoint === eps[1] && t[0].p256dh.length === 87)
  check('subito dopo, anche da un altro dispositivo: push_test_rate', await esito(TEST, [u, eps[2]]) === '54000 push_test_rate')
  await db.query(`update push_subscription set test_at = now() - interval '61 seconds' where user_id = $1`, [u])
  check('dopo un minuto riparte', (await q(TEST, [u, eps[2]])).length === 1)
  await db.query(`update push_subscription set test_at = null where user_id = $1`, [u])
  check('l\'endpoint di un altro utente: nessuna riga', (await q(TEST, [altro, eps[1]])).length === 0)
  await db.query('delete from push_subscription where user_id = $1', [u])
}

type Mondo = {
  d: Dati; autore: string; c1: string; c2: string; c3: string; giovane: string; admin: string; reporter: string
  clearA: string; vA: string
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

async function mondo(): Promise<Mondo> {
  const d = await datiMinimi()
  const [autore, c1, c2, c3, reporter] = [await vecchio('ps_autore'), await vecchio('ps_c1'), await vecchio('ps_c2'),
    await vecchio('ps_c3'), await vecchio('ps_reporter')]
  const giovane = await utente(P, 'ps_giovane')
  const admin = await utente(P, 'ps_admin')
  nostri.add(giovane).add(admin)
  await db.query(`update app_user set role = 'admin' where id = $1`, [admin])
  const clearA = await id(SUBMIT, [autore, d.run, d.tier, JSON.stringify(payload(d.cards))])
  return { d, autore, c1, c2, c3, giovane, admin, reporter, clearA, vA: await versione(clearA) }
}

async function consegna(m: Mondo) {
  console.log('\n  -- push_claim: preferenza, dispositivo, coalescenza')
  const commenta = (u: string, body = SEGRETO) => id(COMMENT, [u, m.vA, body])
  const letto = () => db.query('select mark_notifications_read($1::uuid, null)', [m.autore])
  const sblocca = () => db.query(`update notification set pushed_at = pushed_at - interval '31 minutes'
                                   where recipient_id = $1 and pushed_at is not null`, [m.autore])
  const azzera = () => db.query('delete from push_sent where recipient_id = any ($1::uuid[]) or actor_id = any ($1::uuid[])', [[...nostri]])
  const mie = async () => (await claim()).filter((j) => j.recipient_id === m.autore)

  check('nessun dispositivo e nessuna preferenza: niente', (await commenta(m.c1)) !== '' && (await mie()).length === 0)
  const d1 = await iscrivi(m.autore, 'Chrome on Android')
  const d2 = await iscrivi(m.autore, 'Firefox on Windows')
  check('due dispositivi ma la preferenza spenta: niente', (await mie()).length === 0)
  await db.query(PREF, [m.autore, 'clear_comment', 'push', true])
  const [j] = await mie()
  const handle = (u: string) => one<{ h: string }>('select handle::text as h from app_user where id = $1', [u]).then((r) => r.h)
  check('preferenza accesa: una push, con i dati del testo e i due dispositivi',
    j?.kind === 'clear_comment' && j.n === 1 && j.actor_handle === await handle(m.c1) && j.target === 'clear' &&
    j.group_key === `comments:${m.clearA}` && j.devices.length === 2 &&
    j.devices.map((x) => x.endpoint).join() === [d1, d2].join() && j.devices.every((x) => x.p256dh.length === 87 && x.auth.length === 22),
    JSON.stringify({ ...j, devices: j?.devices.length }))
  check('mai il testo del commento', !JSON.stringify(j).includes(SEGRETO))
  check('la notifica e\' segnata (pushed_at) e il registro ha la riga autore -> destinatario',
    await num('select count(*) from notification where id = $1 and pushed_at is not null', [j?.notification_id]) === 1 &&
    await sent('recipient_id = $1 and actor_id = $2', [m.autore, m.c1]) === 1)
  check('un secondo claim senza novita\': niente', (await mie()).length === 0)
  await commenta(m.c2)
  check('un altro commento entro 30 minuti: si somma e non parte', (await mie()).length === 0)
  await sblocca()
  const [j2] = await mie()
  check('dopo 30 minuti: parte con il totale e l\'ultimo autore', j2?.n === 2 && j2.actor_handle === await handle(m.c2),
    JSON.stringify({ n: j2?.n, a: j2?.actor_handle }))

  console.log('\n  -- i tetti per coppia, autore e destinatario')
  await commenta(m.c1)
  await sblocca()
  check('lo stesso autore verso lo stesso destinatario entro un\'ora: niente', (await mie()).length === 0)
  await db.query(`update push_sent set sent_at = sent_at - interval '61 minutes' where actor_id = $1`, [m.c1])
  check('dopo un\'ora riparte', (await mie()).length === 1)

  await azzera(); await letto()
  await commenta(m.giovane)
  check('un account di meno di 24 ore non fa partire push', (await mie()).length === 0)
  await db.query(`update app_user set created_at = now() - interval '25 hours' where id = $1`, [m.giovane])
  check('a 25 ore si\'', (await mie()).length === 1)

  await azzera(); await letto()
  await commenta(m.c2)
  await db.query(`update app_user set suspended_until = now() + interval '1 day' where id = $1`, [m.c2])
  check('l\'autore sospeso dopo il commento: niente', (await mie()).length === 0)
  await db.query(`update app_user set suspended_until = null where id = $1`, [m.c2])
  check('tolta la sospensione, parte', (await mie()).length === 1)

  await azzera(); await letto()
  await db.query(`insert into push_sent (recipient_id, actor_id) select $1, $2 from generate_series(1, 10)`, [m.c3, m.c1])
  await commenta(m.c1)
  check('un autore con 10 push nell\'ultima ora (verso altri): niente', (await mie()).length === 0)
  await db.query(`update push_sent set sent_at = now() - interval '61 minutes' where recipient_id = $1`, [m.c3])
  check('fuori dall\'ora, parte', (await mie()).length === 1)

  await azzera(); await letto()
  await db.query(`insert into push_sent (recipient_id, actor_id, sent_at)
                  select $1, null, now() - interval '23 hours' from generate_series(1, 20)`, [m.autore])
  await commenta(m.c2)
  check('un destinatario con 20 push in 24 ore: niente', (await mie()).length === 0)
  await db.query(`update push_sent set sent_at = now() - interval '25 hours' where recipient_id = $1 and actor_id is null`, [m.autore])
  check('oltre le 24 ore, parte', (await mie()).length === 1)

  console.log('\n  -- contenuto nascosto, letta, vecchia, skip locked, limite')
  await azzera(); await letto()
  const nascosto = await commenta(m.c3)
  await db.query(HIDE_COMMENT, [m.admin, nascosto, 'hidden'])
  check('l\'unico commento nascosto prima dell\'invio: non parte (render dice visible false)', (await mie()).length === 0)
  await letto()
  await commenta(m.c3)
  await letto()
  check('una notifica gia\' letta non parte', (await mie()).length === 0)
  await commenta(m.c3)
  await db.query(`update notification set updated_at = now() - interval '11 minutes' where recipient_id = $1 and read_at is null`, [m.autore])
  check('una notifica toccata piu\' di 10 minuti fa resta alla lista', (await mie()).length === 0)

  await azzera(); await letto()
  await commenta(m.c3)
  const c: pg.PoolClient = await db.connect()
  try {
    await c.query('begin')
    await c.query('select id from notification where recipient_id = $1 and read_at is null for update', [m.autore])
    check('una riga bloccata da un altro claim si salta (skip locked), senza aspettare', (await mie()).length === 0)
    await c.query('rollback')
  } finally { c.release() }
  check('sbloccata, parte', (await mie()).length === 1)

  console.log('\n  -- moderazione e segnalazioni')
  await azzera(); await letto()
  await db.query(PREF, [m.autore, 'content_hidden', 'push', true])
  await db.query(HIDE_CLEAR, [m.admin, m.clearA, 'hidden'])
  const [mod] = await mie()
  check('il clear nascosto: content_hidden parte, anche se il moderatore ha l\'account nuovo',
    mod?.kind === 'content_hidden' && mod.target === 'clear' && mod.actor_handle === null, JSON.stringify(mod ?? null))
  check('la moderazione non conta per l\'attore (actor_id null nel registro)',
    await sent('recipient_id = $1 and actor_id is null', [m.autore]) === 1)
  await db.query(HIDE_CLEAR, [m.admin, m.clearA, 'published'])
  check('content_unhidden senza preferenza: niente', (await mie()).length === 0)

  await db.query(PREF, [m.admin, 'reports_open', 'push', true])
  await iscrivi(m.admin, 'Safari on Mac')
  await db.query(REPORT, [m.reporter, 'clear', m.clearA, 'spam', null])
  await db.query(REPORT, [m.c1, 'clear', m.clearA, 'spam', null])
  const rep = (await claim(1)).filter((x) => x.recipient_id === m.admin)
  check('due segnalazioni accorpate: una push "2 open reports" all\'admin, senza handle',
    rep.length === 1 && rep[0].kind === 'reports_open' && rep[0].n === 2 && rep[0].actor_handle === null,
    JSON.stringify(rep.map((x) => ({ k: x.kind, n: x.n }))))
  check('p_limit 1: una sola notifica per giro', (await q(CLAIM, [1])).length <= 1)
  return { d1, d2 }
}

async function esiti(m: Mondo, eps: { d1: string; d2: string }) {
  console.log('\n  -- push_report: gli esiti degli invii')
  const riga = async (ep: string) => (await q<{ id: string; failures: number; last_status: number | null; last_ok_at: Date | null }>(
    'select id::text, failures, last_status, last_ok_at from push_subscription where endpoint = $1', [ep]))[0]
  const report = async (r: unknown) => one<{ ok: number; failed: number; removed: number }>(REPORT_PUSH, [JSON.stringify(r)])
  const a = await riga(eps.d1)
  const b = await riga(eps.d2)
  await db.query('update push_subscription set failures = 2 where id = $1', [a.id])
  const r1 = await report([{ id: a.id, status: 201 }, { id: b.id, status: 410 }])
  const a1 = await riga(eps.d1)
  check('201: last_ok_at, errori a 0; 410: il dispositivo se ne va',
    r1.ok === 1 && r1.removed === 1 && r1.failed === 0 && a1.failures === 0 && a1.last_status === 201 &&
    a1.last_ok_at !== null && (await riga(eps.d2)) === undefined, JSON.stringify(r1))
  const r404 = await report([{ id: (await riga(await iscrivi(m.autore))).id, status: 404 }])
  check('404: tolto anche lui', r404.removed === 1)

  const c = await riga(await iscrivi(m.autore, 'Edge'))
  const ep = (await one<{ e: string }>('select endpoint as e from push_subscription where id = $1', [c.id])).e
  await report([{ id: c.id, status: 429 }])
  await report([{ id: c.id, status: 413 }])
  const c1 = await riga(ep)
  check('429 e 413 non contano come errori del dispositivo (resta il codice)', c1.failures === 0 && c1.last_status === 413)
  const f1 = await report([{ id: c.id, status: 500 }])
  const f2 = await report([{ id: c.id, status: 0 }])
  check('500 e la rete (0): un errore in piu\' ciascuno', f1.failed === 1 && f2.failed === 1 && (await riga(ep)).failures === 2)
  const f3 = await report([{ id: c.id, status: 403 }])
  check('al terzo errore di fila (403) il dispositivo se ne va', f3.failed === 1 && f3.removed === 1 && (await riga(ep)) === undefined)

  const x = await riga(eps.d1)
  await db.query('update push_subscription set failures = 2 where id = $1', [x.id])
  const mix = await report([{ id: x.id, status: 500 }, { id: x.id, status: 201 }])
  check('lo stesso dispositivo due volte, un errore e un 201: vince il 201',
    mix.ok === 1 && mix.failed === 0 && (await riga(eps.d1)).failures === 0)
  check('un id che non c\'e\' piu\' si ignora',
    JSON.stringify(await report([{ id: '00000000-0000-4000-8000-000000000000', status: 201 }])) ===
      JSON.stringify({ ok: 0, failed: 0, removed: 0 }))
  check('un array vuoto: tutto a 0', (await report([])).ok === 0)
  const forme: unknown[] = [{}, [1], [{ id: 'x', status: 200 }], [{ id: x.id, status: '200' }], [{ id: x.id, status: 600 }],
    [{ id: x.id, status: 2.5 }], [{ id: x.id, status: -1 }], [{ id: x.id }]]
  const passate: string[] = []
  for (const f of forme) if (await esito(REPORT_PUSH, [JSON.stringify(f)]) !== '22023 push_report_shape') passate.push(JSON.stringify(f))
  check('forme sbagliate: push_report_shape', passate.length === 0, passate.join(' '))
  check('null: push_report_shape', await esito(REPORT_PUSH, [null]) === '22023 push_report_shape')
  const ultimo = await report([{ id: x.id, status: 404 }, { id: x.id, status: 201 }])
  check('404 insieme a un 201: l\'iscrizione e\' sparita, vince il 404', ultimo.removed === 1 && (await riga(eps.d1)) === undefined)
}

async function conservazione(m: Mondo) {
  console.log('\n  -- purge_push: 90 giorni senza vedersi, il registro dopo 2 giorni')
  const vivo = await iscrivi(m.c1, 'Alive')
  const morto = await iscrivi(m.c1, 'Gone')
  const riuscito = await iscrivi(m.c1, 'Pushed')
  await db.query(`update push_subscription set created_at = now() - interval '200 days', seen_at = now() - interval '91 days'
                   where endpoint = any ($1)`, [[morto, riuscito]])
  await db.query(`update push_subscription set last_ok_at = now() - interval '5 days' where endpoint = $1`, [riuscito])
  await db.query(`insert into push_sent (recipient_id, sent_at) values ($1, now() - interval '3 days'), ($1, now() - interval '1 day')`, [m.c1])
  const r = await one<{ devices: number; sent: number }>(PURGE, [90])
  const resta = (await q<{ e: string }>('select endpoint as e from push_subscription where user_id = $1', [m.c1])).map((x) => x.e)
  check('se ne va solo il dispositivo che non si vede da 91 giorni (un invio riuscito tiene vivo)',
    r.devices >= 1 && resta.includes(vivo) && resta.includes(riuscito) && !resta.includes(morto), JSON.stringify(r))
  check('il registro: via quello di 3 giorni, resta quello di ieri',
    r.sent >= 1 && await sent(`recipient_id = $1 and sent_at < now() - interval '2 days'`, [m.c1]) === 0 &&
    await sent('recipient_id = $1', [m.c1]) >= 1)

  console.log('\n  -- le cascate con l\'account')
  await db.query(`insert into push_sent (recipient_id, actor_id) values ($1, $2)`, [m.c2, m.c1])
  await db.query('delete from app_user where id = $1', [m.c1])
  check('cancellato l\'account: i suoi dispositivi e le righe del registro, come destinatario e come autore',
    await num('select count(*) from push_subscription where user_id = $1', [m.c1]) === 0 &&
    await sent('recipient_id = $1 or actor_id = $1', [m.c1]) === 0)
  nostri.delete(m.c1)
}

async function pulizia() {
  // prima i clear, come in digest.test.mts: in una cascata sola il trigger
  // dei voti ricalcolerebbe il punteggio di un clear gia' cancellato
  const tutti = `(select id from app_user where email like $1)`
  await db.query(`delete from clear where author_id in ${tutti}`, [`${P}+%@example.invalid`])
  await db.query('delete from app_user where email like $1', [`${P}+%@example.invalid`])
}

try {
  await pulizia()
  await regole()
  const u = await vecchio('ps_disp')
  const altro = await vecchio('ps_altro')
  await endpoints(u)
  await dispositivi(u, altro)
  const m = await mondo()
  const eps = await consegna(m)
  await esiti(m, eps)
  await conservazione(m)
} finally {
  await pulizia()
  check('nessun utente di prova resta', await num('select count(*) from app_user where email like $1', [`${P}+%@example.invalid`]) === 0)
  await db.end()
}

console.log(`\n  ${stato.passes} PASS, ${stato.fails} FAIL`)
process.exit(stato.fails ? 1 : 0)
