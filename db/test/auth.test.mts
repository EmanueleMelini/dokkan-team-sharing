// Verifica gli account (migrazione 0014 e lib/auth/config.ts): i vincoli e
// i verbi SQL dell'accesso, poi better-auth vero sulla pool di lib/db.ts,
// con un mittente che cattura i magic link invece di mandarli.
//
// Gira sul database di test (npm run db:test). Ogni utente che crea ha
// un'email @example.invalid e se ne va alla fine, anche se qualcosa fallisce.
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { createAuth } from '@/lib/auth/config'
import { readAuthEnv } from '@/lib/auth/env'
import { FRESH_SESSION_SECONDS, isFreshSession } from '@/lib/auth/fresh'
import { suggestHandle } from '@/lib/auth/handle'
import { safeNext } from '@/lib/auth/safe-next'
import { db } from '@/lib/db'

let fails = 0
let passes = 0
function check(nome: string, ok: boolean, dettaglio = ''): boolean {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nome}${dettaglio ? `  (${dettaglio})` : ''}`)
  if (ok) passes++
  else fails++
  return ok
}

const url = process.env.TEST_DATABASE_URL ?? ''
let nomeDb = ''
try { nomeDb = decodeURIComponent(new URL(url).pathname.slice(1)) } catch { /* resta vuoto */ }
if (!nomeDb.endsWith('_test') || process.env.DATABASE_URL !== url) {
  console.error('\n  mi fermo: DATABASE_URL e TEST_DATABASE_URL devono puntare allo stesso database *_test')
  console.error('  (lancialo dentro  npm run db:test)\n')
  process.exit(2)
}

const q = async <T = Record<string, unknown>,>(text: string, params: unknown[] = []) =>
  (await db.query(text, params)).rows as T[]
const one = async <T = Record<string, unknown>,>(text: string, params: unknown[] = []) =>
  (await q<T>(text, params))[0]

/** Il codice e il vincolo dell'errore Postgres, o 'ok'. */
async function esito(text: string, params: unknown[] = []): Promise<string> {
  try { await db.query(text, params); return 'ok' }
  catch (e) {
    if (e instanceof pg.DatabaseError) return `${e.code}${e.constraint ? ' ' + e.constraint : ''}`
    throw e
  }
}

const SUFFISSO = '@example.invalid'
const email = (n: string) => `authtest+${n}${SUFFISSO}`
async function utente(handle: string, onboarded = false): Promise<string> {
  const r = await one<{ id: string }>(
    `insert into app_user (handle, email, onboarded_at) values ($1, $2, ${onboarded ? 'now()' : 'null'}) returning id`,
    [handle, email(handle)])
  return r.id
}

// L'inizio del giro: le righe di auth_verification e auth_rate_limit non
// hanno un utente da cui riconoscerle, si riconoscono dall'ora.
const T0 = (await one<{ t: Date }>('select clock_timestamp() as t')).t
await db.query("delete from auth_verification where identifier like 'authtest-%'")
await db.query("delete from auth_rate_limit where key like 'test:%' or key like '10.9.%'")

try {
  // ------------------------------------------------------------ app_user
  console.log('\n  -- app_user')
  const nonCompleti = await one<{ n: string }>('select count(*) as n from app_user where onboarded_at is null')
  check('gli utenti creati da SQL (fixture, test) sono gia\' completi', nonCompleti.n === '0', `${nonCompleti.n} non completi`)
  const fixture = await one<{ n: string }>(
    "select count(*) as n from app_user where handle in ('ematanoia','wickedmain','whalepuller')")
  check('gli handle della fixture ci sono ancora (la migrazione non li ha toccati)', fixture.n === '3', fixture.n)
  for (const h of ['abc', 'A_b_9'.padEnd(24, 'x')]) {
    const r = await esito('insert into app_user (handle, email) values ($1, $2)', [h, email('ok' + h.length)])
    check(`handle_shape accetta ${h}`, r === 'ok', r)
  }
  for (const h of ['a', 'ab', 'bad-name', 'has space', 'x'.repeat(25), 'àccento']) {
    const r = await esito('insert into app_user (handle, email) values ($1, $2)', [h, email('shape' + h.length)])
    check(`handle_shape rifiuta ${JSON.stringify(h)}`, r === '23514 handle_shape', r)
  }

  // ------------------------------------------------- complete_onboarding
  console.log('\n  -- complete_onboarding')
  const nuovo = await utente('user_aaaa0001')
  const altro = await utente('user_aaaa0002')
  let r = await esito("select complete_onboarding($1, 'admin', 'global')", [nuovo])
  check('rifiuta un handle riservato', r === '23514 handle_reserved', r)
  r = await esito("select complete_onboarding($1, 'user_mine', 'global')", [nuovo])
  check('rifiuta il prefisso degli handle provvisori', r === '23514 handle_reserved', r)
  r = await esito("select complete_onboarding($1, 'no-dash', 'global')", [nuovo])
  check('rifiuta un handle malformato', r === '23514 handle_shape', r)
  r = await esito("select complete_onboarding($1, 'EMATANOIA', 'global')", [nuovo])
  check('rifiuta un handle preso (anche con maiuscole diverse)', r === '23505 app_user_handle_key', r)
  r = await esito("select complete_onboarding($1, 'fresh_one', 'japan')", [nuovo])
  const dopo = await one<{ handle: string; reg: string; fatto: boolean }>(
    'select handle, reg, onboarded_at is not null as fatto from app_user where id = $1', [nuovo])
  check('la prima volta riesce', r === 'ok' && dopo.handle === 'fresh_one' && dopo.reg === 'japan' && dopo.fatto,
    `${r} ${JSON.stringify(dopo)}`)
  r = await esito("select complete_onboarding($1, 'second_try', 'global')", [nuovo])
  check('la seconda volta no: 23514 already_onboarded', r === '23514 already_onboarded', r)
  r = await esito("select complete_onboarding($1, 'ghost_user', 'global')", ['00000000-0000-4000-8000-000000000000'])
  check('un utente inesistente: 23514', r === '23514 already_onboarded', r)

  // ------------------------------------------------- note_email_send
  console.log('\n  -- note_email_send')
  const e1 = email('cooldown')
  const manda = async () => (await one<{ ok: boolean }>('select note_email_send($1) as ok', [e1])).ok
  check('il primo invio passa', await manda())
  check('un secondo entro 60 s no', !(await manda()))
  check('anche con un\'altra grafia (citext)', !(await one<{ ok: boolean }>('select note_email_send($1) as ok', [e1.toUpperCase()])).ok)
  await q("update auth_email_send set sent_at = now() - interval '2 minutes' where email = $1", [e1])
  check('dopo 60 s passa (2 in 15 min)', await manda())
  await q("update auth_email_send set sent_at = now() - interval '3 minutes' where email = $1 and sent_at > now() - interval '1 minute'", [e1])
  check('il terzo in 15 minuti passa', await manda())
  await q("update auth_email_send set sent_at = now() - interval '4 minutes' where email = $1 and sent_at > now() - interval '1 minute'", [e1])
  check('il quarto in 15 minuti no', !(await manda()))
  await q("update auth_email_send set sent_at = sent_at - interval '15 minutes' where email = $1", [e1])
  check('passati 15 minuti si riparte', await manda())

  // ------------------------------------------------- auth_rate_consume
  console.log('\n  -- auth_rate_consume')
  const k = 'test:' + randomBytes(4).toString('hex')
  const consuma = () => one<{ allowed: boolean; retry_after: number | null }>(
    'select * from auth_rate_consume($1, 60, 3)', [k])
  const tre = [await consuma(), await consuma(), await consuma()]
  check('3 richieste nella finestra passano', tre.every((x) => x.allowed && x.retry_after === null))
  const quarta = await consuma()
  check('la quarta no, con un "riprova tra" sensato', !quarta.allowed && quarta.retry_after! >= 1 && quarta.retry_after! <= 60,
    JSON.stringify(quarta))
  await q("update auth_rate_limit set window_start = now() - interval '61 seconds' where key = $1", [k])
  check('finita la finestra si riparte', (await consuma()).allowed)

  // ------------------------------------------- sessioni, account, pulizia
  console.log('\n  -- sessioni, account, cascata, pulizia')
  await q(`insert into auth_session (token, user_id, expires_at) values
             ('tok-live-' || $2, $1, now() + interval '1 day'), ('tok-old-' || $2, $1, now() - interval '1 second')`,
          [altro, randomBytes(4).toString('hex')])
  await q("insert into auth_account (account_id, provider_id, user_id) values ('discord-1', 'discord', $1)", [altro])
  r = await esito("insert into auth_account (account_id, provider_id, user_id) values ('discord-2', 'discord', $1)", [altro])
  check('un solo account per provider per utente', r === '23505 auth_account_user_id_provider_id_key', r)
  r = await esito("insert into auth_account (account_id, provider_id, user_id) values ('discord-1', 'discord', $1)", [nuovo])
  check('lo stesso account del provider non va a due utenti', r === '23505 auth_account_provider_id_account_id_key', r)
  r = await esito("insert into auth_account (account_id, provider_id, user_id, access_token) values ('g-1', 'google', $1, 'secret')", [altro])
  check('nessun token del provider si salva', r === '23514 auth_account_no_secrets', r)
  await q(`insert into auth_verification (identifier, value, expires_at) values
             ('authtest-live', '{}', now() + interval '5 minutes'), ('authtest-old', '{}', now() - interval '1 second')`)
  await q(`insert into auth_email_send (email, sent_at) values ($1, now() - interval '2 days')`, [email('purge')])
  const tolte = await one<{ n: number }>('select purge_auth_expired() as n')
  const resta = await one<{ s: string; v: string; e: string }>(
    `select (select count(*) from auth_session where user_id = $1) as s,
            (select count(*) from auth_verification where identifier like 'authtest-%') as v,
            (select count(*) from auth_email_send where email = $2) as e`, [altro, email('purge')])
  check('purge_auth_expired toglie solo le righe scadute', tolte.n >= 3 && resta.s === '1' && resta.v === '1' && resta.e === '0',
    `${tolte.n} tolte, ${JSON.stringify(resta)}`)
  await q('delete from app_user where id = $1', [altro])
  const orfani = await one<{ n: string }>(
    `select (select count(*) from auth_session where user_id = $1) + (select count(*) from auth_account where user_id = $1) as n`, [altro])
  check('cancellare l\'utente porta via sessioni e account', orfani.n === '0', orfani.n)

  // ------------------------------------------------------ suggestHandle
  console.log('\n  -- suggestHandle')
  {
    const casi: [string | null, string][] = [
      ['ŁełeMims01', 'LeleMims01'],          // Ł e ł non hanno un accento da togliere
      ['lelemims01', 'lelemims01'],
      ['Renée Dupont', 'Renee_Dupont'],        // l'accento si toglie, non diventa _
      ['Søren Øst', 'Soren_Ost'],
      ['Straße', 'Strasse'],
      ['some.user', 'some_user'],              // lo username Discord ammette il punto
      ['  __Goku!!__  ', 'Goku'],
      ['悟空', ''],                              // niente di traslitterabile: nessun suggerimento
      ['ab', ''],                              // troppo corto
      ['user_42abcd', ''],                     // prefisso degli handle provvisori
      ['A'.repeat(30), 'A'.repeat(24)],
      [null, ''],
    ]
    for (const [dato, atteso] of casi) {
      const v = suggestHandle(dato)
      check(`suggestHandle(${JSON.stringify(dato)}) = ${JSON.stringify(atteso)}`, v === atteso, v)
      if (v) check(`  ${JSON.stringify(v)} rispetta la regola dell'handle`, /^[A-Za-z0-9_]{3,24}$/.test(v))
    }
  }

  // ------------------------------------------------------------ safeNext
  console.log('\n  -- safeNext')
  const casi: [unknown, string][] = [
    ['/events/728100', '/events/728100'], ['/events?page=2', '/events?page=2'], ['//evil.example', '/'],
    ['/\\evil.example', '/'], ['https://evil.example/x', '/'], ['javascript:alert(1)', '/'], ['events', '/'],
    ['/a\nLocation: x', '/'], ['/login?next=/x', '/'], ['/welcome', '/'], [undefined, '/'], [42, '/'],
  ]
  for (const [dato, atteso] of casi) check(`safeNext(${JSON.stringify(dato)}) = ${atteso}`, safeNext(dato) === atteso, safeNext(dato))

  // ------------------------------------------------------------ readAuthEnv
  console.log('\n  -- readAuthEnv')
  const base = { BETTER_AUTH_URL: 'https://x.example', BETTER_AUTH_SECRET: 's'.repeat(32) }
  const lancia = (e: Record<string, string>) => { try { readAuthEnv(e); return '' } catch (x) { return String(x) } }
  check('in produzione senza RESEND_API_KEY non parte', lancia({ ...base, NODE_ENV: 'production' }).includes('RESEND_API_KEY'))
  check('durante next build si', lancia({ ...base, NODE_ENV: 'production', NEXT_PHASE: 'phase-production-build' }) === '')
  check('in sviluppo senza chiave si (link nel file di sviluppo)', lancia({ ...base, NODE_ENV: 'development' }) === '')
  check('senza BETTER_AUTH_SECRET no', lancia({ BETTER_AUTH_URL: base.BETTER_AUTH_URL }).includes('BETTER_AUTH_SECRET'))
  const soloMeta = readAuthEnv({ ...base, DISCORD_CLIENT_ID: 'id', GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'sec' })
  check('un provider e\' attivo solo con entrambe le variabili', Object.keys(soloMeta.providers).join() === 'google',
    Object.keys(soloMeta.providers).join())

  // ---------------------------------------------- better-auth, magic link
  console.log('\n  -- better-auth: magic link')
  const BASE = 'http://localhost:3999'
  const env = readAuthEnv({ NODE_ENV: 'test', BETTER_AUTH_URL: BASE, BETTER_AUTH_SECRET: randomBytes(32).toString('base64') })
  const inviati: { email: string; url: string }[] = []
  const auth = createAuth({ env, sendMagicLink: async (m) => { inviati.push(m) } })
  let ip = 1
  const chiedi = (indirizzo: string, extra: Record<string, unknown> = {}, daIp = `10.9.0.${ip++}`) =>
    auth.handler(new Request(`${BASE}/api/auth/sign-in/magic-link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE, 'x-forwarded-for': daIp },
      body: JSON.stringify({ email: indirizzo, callbackURL: '/welcome?next=/events', ...extra }),
    }))
  const apri = (link: string) => auth.handler(new Request(link, { headers: { 'x-forwarded-for': `10.9.1.${ip++}` } }))

  const em = email('magic')
  let res = await chiedi(em)
  const link = inviati.at(-1)
  check('la richiesta risponde 200 e il link parte', res.status === 200 && link?.email === em, `${res.status}`)
  const token = new URL(link!.url).searchParams.get('token')!
  const salvati = await q<{ identifier: string; scade: number }>(
    "select identifier, extract(epoch from expires_at - now())::int as scade from auth_verification where identifier like 'magic-link:%' and created_at >= $1", [T0])
  check('il token e\' salvato come hash, non in chiaro', salvati.length > 0 && salvati.every((s) => !s.identifier.includes(token)))
  check('e scade in 10 minuti', salvati.every((s) => s.scade > 590 && s.scade <= 600), salvati.map((s) => s.scade).join(','))

  res = await apri(link!.url)
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0]
  check('il link porta a /welcome con il cookie di sessione', res.status === 302
    && res.headers.get('location') === `${BASE}/welcome?next=/events` && cookie.startsWith('dts.session_token='),
    `${res.status} ${res.headers.get('location')}`)
  const sess = await auth.api.getSession({ headers: new Headers({ cookie }) })
  check('la sessione e\' dell\'utente nuovo, verificato e non ancora completo', sess?.user.email === em
    && sess.user.emailVerified === true && sess.user.onboardedAt == null && /^user_[0-9a-f]{8}$/.test(String(sess.user.handle)),
    JSON.stringify({ h: sess?.user.handle, o: sess?.user.onboardedAt, v: sess?.user.emailVerified }))
  const riga = await one<{ onboarded_at: Date | null; role: string; reg: string }>(
    'select onboarded_at, role, reg from app_user where email = $1', [em])
  check('nel database: onboarded_at nullo, ruolo e regione di default', riga?.onboarded_at === null
    && riga.role === 'member' && riga.reg === 'global', JSON.stringify(riga))

  res = await apri(link!.url)
  check('lo stesso link una seconda volta: INVALID_TOKEN', res.status === 302
    && (res.headers.get('location') ?? '').includes('error=INVALID_TOKEN'), res.headers.get('location') ?? '')

  await q("delete from auth_email_send where email = $1", [em])
  await chiedi(em)
  await q("update auth_verification set expires_at = now() - interval '1 second' where identifier like 'magic-link:%' and created_at >= $1", [T0])
  res = await apri(inviati.at(-1)!.url)
  check('un link scaduto non vale', res.status === 302 && (res.headers.get('location') ?? '').includes('error='),
    res.headers.get('location') ?? '')

  console.log('\n  -- better-auth: limiti e regole')
  const prima = inviati.length
  res = await chiedi(em)
  check('un altro invio alla stessa email entro 60 s: stessa risposta, nessun link', res.status === 200 && inviati.length === prima,
    `${res.status}, ${inviati.length - prima} inviati`)
  const stessoIp = '10.9.2.1'
  const codici: number[] = []
  for (let i = 0; i < 4; i++) codici.push((await chiedi(email(`ip${i}`), {}, stessoIp)).status)
  check('dallo stesso IP: 3 richieste al minuto, la quarta 429', codici.join(',') === '200,200,200,429', codici.join(','))
  res = await chiedi(email('evil'), { callbackURL: 'https://evil.example/steal' })
  check('un callbackURL di un altro sito e\' rifiutato', res.status === 403, `${res.status}`)
  res = await auth.handler(new Request(`${BASE}/api/auth/sign-in/magic-link`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example', 'x-forwarded-for': '10.9.3.1' },
    body: JSON.stringify({ email: email('origin') }) }))
  check('una richiesta da un altro origin e\' rifiutata', res.status === 403, `${res.status}`)
  res = await auth.handler(new Request(`${BASE}/api/auth/sign-up/email`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: BASE, 'x-forwarded-for': '10.9.3.2' },
    body: JSON.stringify({ email: email('pw'), password: 'correct horse battery', name: 'x' }) }))
  const pw = await one<{ n: string }>('select count(*) as n from app_user where email = $1', [email('pw')])
  check('l\'accesso con password non esiste', res.status >= 400 && pw.n === '0', `${res.status} ${await res.text()}`)

  const valida = auth.options.user!.validateUserInfo!
  const oauth = { method: 'oauth', oauth: { providerId: 'discord' } } as const
  check('un account nuovo con email non verificata e\' rifiutato',
    (await valida({ user: { email: email('nv'), emailVerified: false }, source: { ...oauth, action: 'create-user' } }))?.error === 'email_not_verified')
  check('con email verificata passa',
    (await valida({ user: { email: email('v'), emailVerified: true }, source: { ...oauth, action: 'create-user' } })) === undefined)

  const actx = await auth.$context
  const u = await one<{ id: string }>('select id from app_user where email = $1', [em])
  const acc = await actx.internalAdapter.createAccount({
    userId: u.id, providerId: 'twitch', accountId: 'tw-1', accessToken: 'at', refreshToken: 'rt', idToken: 'it' })
  const salvato = await one<Record<string, unknown>>(
    "select access_token, refresh_token, id_token from auth_account where provider_id = 'twitch' and user_id = $1", [u.id])
  check('i token del provider sono azzerati prima di salvare', !!acc && salvato.access_token === null
    && salvato.refresh_token === null && salvato.id_token === null, JSON.stringify(salvato))

  // ---------------------------------------- sessione fresca (lib/auth/fresh.ts)
  console.log('\n  -- sessione fresca: 15 minuti per scollegare, collegare, cancellare')
  {
    const ora = Date.now()
    const min = (m: number) => new Date(ora - m * 60_000)
    check('isFreshSession: appena nata si', isFreshSession(min(0), ora))
    check('isFreshSession: 14 min si', isFreshSession(min(14), ora))
    check('isFreshSession: 15 min esatti no', !isFreshSession(min(15), ora))
    check('isFreshSession: 16 min no', !isFreshSession(min(16), ora))
    check('isFreshSession: senza data o con una data illeggibile no', !isFreshSession(null) && !isFreshSession('nope'))
    check('better-auth usa la stessa soglia (freshAge)', actx.sessionConfig.freshAge === FRESH_SESSION_SECONDS,
      String(actx.sessionConfig.freshAge))

    // Le sessioni vere di dokkan_test: quella aperta dal magic link sopra.
    const nata = async () => (await auth.api.getSession({ headers: new Headers({ cookie }) }))?.session.createdAt
    const invecchia = (m: number) => q(
      `update auth_session set created_at = now() - make_interval(mins => $2) where user_id = $1`, [u.id, m])
    const collega = (c: string) => auth.handler(new Request(`${BASE}/api/auth/link-social`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE, cookie: c, 'x-forwarded-for': `10.9.4.${ip++}` },
      body: JSON.stringify({ provider: 'discord', callbackURL: '/settings' }),
    }))
    const codice = async (r: Response) => { try { return String((await r.json()).code ?? '') } catch { return '' } }

    check('la sessione appena aperta dal magic link e\' fresca', isFreshSession(await nata()))
    res = await collega(cookie)
    let c = await codice(res)
    check('  e /link-social non la ferma per l\'eta\'', c !== 'SESSION_NOT_FRESH', `${res.status} ${c}`)

    await invecchia(14)
    check('nata 14 minuti fa (auth_session.created_at): ancora fresca', isFreshSession(await nata()))
    await invecchia(16)
    const vecchia = await auth.api.getSession({ headers: new Headers({ cookie }) })
    check('nata 16 minuti fa: si resta dentro, ma non e\' piu\' fresca', !!vecchia && !isFreshSession(vecchia.session.createdAt),
      String(vecchia?.session.createdAt))
    res = await collega(cookie)
    c = await codice(res)
    check('  e /link-social risponde 403 SESSION_NOT_FRESH', res.status === 403 && c === 'SESSION_NOT_FRESH', `${res.status} ${c}`)

    // Rientrare da dentro (la pagina /settings/sign-in): un nuovo magic link
    // aperto con il vecchio cookie ancora nel browser da' una sessione nuova.
    await q('delete from auth_email_send where email = $1', [em])
    const next = '/welcome?next=' + encodeURIComponent('/settings')
    res = await auth.handler(new Request(`${BASE}/api/auth/sign-in/magic-link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE, cookie, 'x-forwarded-for': `10.9.4.${ip++}` },
      body: JSON.stringify({ email: em, callbackURL: next }),
    }))
    const nuovo = inviati.at(-1)
    check('da dentro si chiede un altro link', res.status === 200 && nuovo?.email === em && nuovo.url !== link!.url, `${res.status}`)
    res = await auth.handler(new Request(nuovo!.url, { headers: { cookie, 'x-forwarded-for': `10.9.4.${ip++}` } }))
    const cookie2 = (res.headers.get('set-cookie') ?? '').split(';')[0]
    check('  aprirlo con il vecchio cookie porta a /welcome?next=/settings con un cookie nuovo', res.status === 302
      && res.headers.get('location') === `${BASE}/welcome?next=/settings` && cookie2.startsWith('dts.session_token=') && cookie2 !== cookie,
      `${res.status} ${res.headers.get('location')}`)
    const fresca = await auth.api.getSession({ headers: new Headers({ cookie: cookie2 }) })
    check('  la sessione nuova e\' dello stesso utente ed e\' fresca', fresca?.user.id === u.id && isFreshSession(fresca.session.createdAt))
    res = await collega(cookie2)
    c = await codice(res)
    check('  e /link-social la lascia passare', c !== 'SESSION_NOT_FRESH', `${res.status} ${c}`)
  }
} catch (e) {
  check('nessuna eccezione inattesa', false, e instanceof Error ? e.stack ?? e.message : String(e))
} finally {
  await db.query("delete from app_user where email like 'authtest+%@example.invalid'")
  await db.query("delete from auth_email_send where email like 'authtest+%@example.invalid'")
  await db.query("delete from auth_verification where identifier like 'authtest-%' or created_at >= $1", [T0])
  await db.query("delete from auth_rate_limit where key like 'test:%' or key like '10.9.%'")
  await db.end()
}

console.log(`\n  ${passes} PASS, ${fails} FAIL`)
process.exit(fails ? 1 : 0)
