// Verifica il lato app del digest email (fase 3, 0029): il token di
// disiscrizione (firma derivata da BETTER_AUTH_SECRET, revoca con la
// versione), i testi e gli header dell'email (lib/notify/digest.ts, +N e
// moderazione generica, niente trattini lunghi), il mittente su file in
// sviluppo e mai in produzione (lib/notify/send.ts), il conteggio dei
// login che non fallisce e non trattiene mai (lib/notify/budget.ts e
// lib/auth/email.ts), un giro del cron (lib/notify/run.ts) con un mittente
// finto (priorita', budget, pausa, idempotenza), le rotte vere
// /api/cron/digest e /api/notifications/unsubscribe (senza cookie), e le
// guardie sui file (pagina, Settings, vercel.json, privacy).
//
// Gira sul database di test (npm run db:test). Nessuna email parte:
// RESEND_API_KEY si toglie dall'ambiente e il mittente di sviluppo scrive
// in una cartella temporanea. Crea solo utenti digestapp+...@example.invalid
// e li toglie alla fine; email_quota e notify_state tornano come prima.
import { createHmac, randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { check, guardia, stato } from '@/db/test/builder-helpers'

guardia()
// Prima di importare lib/: nessuna chiave di Resend (niente parte davvero),
// e la cartella temporanea dei log di sviluppo e' nostra.
delete process.env.RESEND_API_KEY
delete process.env.EMAIL_NOTIFY_FROM
const CARTELLA = mkdtempSync(join(tmpdir(), 'digestapp-'))
process.env.TMPDIR = CARTELLA
const SEGRETO = randomBytes(32).toString('base64')
const BASE = 'http://digestapp.localhost:3999'
process.env.BETTER_AUTH_URL = BASE
process.env.BETTER_AUTH_SECRET = SEGRETO
const CRON = 'c'.repeat(24) + '-digestapp'
process.env.CRON_SECRET = CRON

const { NOTIFY_SECRET_MIN_LENGTH, signUnsubscribeToken, verifyUnsubscribeToken } = await import('@/lib/notify/token')
const { DIGEST_MAX_ITEMS, digestDayLabel, digestLine, renderDigest, unsubscribeUrls } = await import('@/lib/notify/digest')
type DigestRow = import('@/lib/notify/digest').DigestRow
const { DEV_DIGEST_LOG, classifyResendError, createDigestSender } = await import('@/lib/notify/send')
const { readNotifyEnv } = await import('@/lib/notify/env')
const { AUTH_COUNT_TIMEOUT_MS, countAuthEmail } = await import('@/lib/notify/budget')
const { DEV_MAGIC_LINK_LOG, createMagicLinkSender } = await import('@/lib/auth/email')
const { readAuthEnv } = await import('@/lib/auth/env')
const { digestBatchKey } = await import('@/lib/notify/run')

const file = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8')
const senzaTrattini = (s: string) => !/[–—]/.test(s)
const UID = '2f1c6a4e-8b3d-4c5e-9f00-1234567890ab'

function token() {
  console.log('\n  -- lib/notify/token.ts: firma, verifica, revoca')
  const t = signUnsubscribeToken(SEGRETO, UID, 3)
  check('forma v1.<user>.<versione>.<hmac>', /^v1\.[0-9a-f-]{36}\.3\.[A-Za-z0-9_-]{43}$/.test(t), t.slice(0, 50))
  const c = verifyUnsubscribeToken(SEGRETO, t)
  check('si verifica e restituisce utente e versione', c?.userId === UID && c.tokenV === 3)
  check('un uuid maiuscolo firma lo stesso utente', signUnsubscribeToken(SEGRETO, UID.toUpperCase(), 3) === t)
  const pezzi = t.split('.')
  const altroUtente = ['v1', UID.replace(/^2/, '3'), pezzi[2], pezzi[3]].join('.')
  const altraVersione = ['v1', UID, '4', pezzi[3]].join('.')
  const firmaRotta = rompiFirma(t)
  check('un altro utente con la stessa firma: no', verifyUnsubscribeToken(SEGRETO, altroUtente) === null)
  check('un\'altra versione con la stessa firma: no', verifyUnsubscribeToken(SEGRETO, altraVersione) === null)
  check('una firma cambiata: no', verifyUnsubscribeToken(SEGRETO, firmaRotta) === null)
  const grafia = altraGrafia(t)
  check('la stessa firma con altri bit di riempimento: no (solo la grafia canonica)',
    grafia !== t && Buffer.from(grafia.split('.')[3], 'base64url').equals(Buffer.from(pezzi[3], 'base64url')) &&
    verifyUnsubscribeToken(SEGRETO, grafia) === null)
  // SEGRETO e' casuale a ogni giro: su 200 firme diverse il risultato non
  // deve dipendere da quale firma e' uscita
  const molti = Array.from({ length: 200 }, (_, k) => signUnsubscribeToken(SEGRETO, UID, k + 1))
  check('su 200 firme: rotta mai valida, altra grafia mai valida, originale sempre',
    molti.every((x) => verifyUnsubscribeToken(SEGRETO, x) !== null &&
      verifyUnsubscribeToken(SEGRETO, rompiFirma(x)) === null && verifyUnsubscribeToken(SEGRETO, altraGrafia(x)) === null))
  check('con un altro BETTER_AUTH_SECRET: no (ruotarlo invalida i link)',
    verifyUnsubscribeToken(randomBytes(32).toString('base64'), t) === null)
  check('forme sbagliate: no', [null, 42, '', 'v2' + t.slice(2), `${t}x`, `${t}.x`, t.replace('v1.', ''), 'v1.x.1.y',
    `v1.${UID}.0.${pezzi[3]}`, `v1.${UID}.99999999999.${pezzi[3]}`, 'x'.repeat(500)]
    .every((x) => verifyUnsubscribeToken(SEGRETO, x) === null))
  let lancia = false
  try { signUnsubscribeToken('short', UID, 1) } catch { lancia = true }
  check(`un segreto sotto ${NOTIFY_SECRET_MIN_LENGTH} caratteri non firma e non verifica`,
    lancia && verifyUnsubscribeToken('short', t) === null && verifyUnsubscribeToken('', t) === null)
  let versione = false
  try { signUnsubscribeToken(SEGRETO, UID, 0) } catch { versione = true }
  check('versione 0 o non intera: non si firma', versione)
  // la chiave e' derivata: l'HMAC diretto con BETTER_AUTH_SECRET non vale
  check('la firma non e\' un HMAC diretto con BETTER_AUTH_SECRET (chiave derivata, etichetta fissa)',
    !t.endsWith(createHmacB64(SEGRETO, `v1.${UID}.3`)))
}

function createHmacB64(k: string, s: string) { return createHmac('sha256', k).update(s).digest('base64url') }

// Rompe la firma cambiando un carattere a META' dell'HMAC: li' ogni
// carattere porta 6 bit veri. L'ultimo invece ha 2 bit di riempimento, e
// cambiarlo dentro il suo gruppo di 4 (A-D, E-H, ...) darebbe gli stessi byte:
// e' cosi' che il vecchio test falliva una volta su 16.
function rompiFirma(t: string): string {
  const i = t.length - 20
  return t.slice(0, i) + (t[i] === 'A' ? 'B' : 'A') + t.slice(i + 1)
}
/** La stessa firma scritta in un altro modo: cambia solo i bit di riempimento. */
function altraGrafia(t: string): string {
  const b64u = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  return t.slice(0, -1) + b64u[b64u.indexOf(t[t.length - 1]) ^ 1]
}

const riga = (over: Partial<DigestRow> = {}): DigestRow => ({
  user_id: UID, email: 'digestapp+finto@example.invalid', handle: 'dg_finto', token_v: 1, is_admin: false,
  has_moderation: true, since: new Date('2026-10-09T17:00:00Z'), upto: new Date('2026-10-10T17:00:00Z'),
  day: '2026-10-10', votes: 5, helpful: 1,
  items: [
    { id: 11, kind: 'clear_comment', target: 'clear', n: 3, actor_handle: 'dg_amico', event_name: 'Fight <b>&</b> "Win"',
      stage_seq: 2, stage_name: null, difficulty: 'super2' },
    { id: 12, kind: 'clear_comment', target: 'clear', n: 1, actor_handle: 'dg_amico', event_name: null,
      stage_seq: null, stage_name: null, difficulty: null },
    { id: 13, kind: 'content_hidden', target: 'clear', n: 1, actor_handle: null, event_name: 'Some Event',
      stage_seq: null, stage_name: null, difficulty: null },
    { id: 14, kind: 'suspended', target: 'account', n: 1, actor_handle: null, event_name: null,
      stage_seq: null, stage_name: null, difficulty: null },
    { id: 15, kind: 'reports_open', target: 'reports', n: 2, actor_handle: null, event_name: null,
      stage_seq: null, stage_name: null, difficulty: null },
  ],
  ...over,
})

function testi() {
  console.log('\n  -- lib/notify/digest.ts: testi, link, header')
  const t = signUnsubscribeToken(SEGRETO, UID, 1)
  const e = renderDigest(riga(), { baseURL: BASE, token: t })
  const u = unsubscribeUrls(BASE, t)
  check('oggetto con il giorno', e.subject === 'Your Dokkan Team Sharing digest for October 10', e.subject)
  check('digestDayLabel: un giorno strano resta com\'e\'', digestDayLabel('2026-13-01') === '2026-13-01' && digestDayLabel('x') === 'x')
  check('a: l\'email dell\'utente', e.to === 'digestapp+finto@example.invalid')
  check('List-Unsubscribe: l\'URL del one-click con il token', e.headers['List-Unsubscribe'] === `<${u.oneClick}>` &&
    u.oneClick === `${BASE}/api/notifications/unsubscribe?t=${t}`)
  check('List-Unsubscribe-Post: List-Unsubscribe=One-Click (RFC 8058)',
    e.headers['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click')
  check('il corpo porta alla pagina di conferma, non al one-click', e.text.includes(u.page) && !e.text.includes(u.oneClick) &&
    e.html.includes(`href="${u.page}"`))
  check('+N voti e Helpful, senza chi', e.text.includes('+5 upvotes on your clears') &&
    e.text.includes('+1 player found your tips helpful'))
  check('commenti accorpati e singoli', e.text.includes('3 new comments on your clear') &&
    e.text.includes('dg_amico commented on your clear'))
  check('ogni notifica porta a /notifications/<id>', [11, 12, 13, 14, 15].every((i) => e.text.includes(`${BASE}/notifications/${i}\n`)))
  check('moderazione generica: niente "hid", "suspended", "hidden"',
    e.text.includes('A moderator reviewed one of your posts') && e.text.includes('There is an update about your account') &&
    !/\bhid\b|hidden|suspend/i.test(e.text) && !/\bhid\b|hidden|suspend/i.test(e.html), e.text)
  check('segnalazioni per gli admin: solo il numero', e.text.includes('2 open reports to review'))
  check('HTML con escape (nome evento e handle)', e.html.includes('Fight &lt;b&gt;&amp;&lt;/b&gt; &quot;Win&quot;') &&
    !e.html.includes('<b>&</b>'))
  check('il testo ha il luogo del clear', e.text.includes('Fight <b>&</b> "Win", Stage 2'), e.text.split('\n')[5])
  check('dice perche\' arriva e come spegnerla', e.text.includes('turned on the daily email digest') &&
    e.text.includes(`${BASE}/settings#notifications`))
  check('niente trattini lunghi in oggetto, testo e HTML', senzaTrattini(e.subject + e.text + e.html))
  const molte = renderDigest(riga({
    votes: 0, helpful: 0,
    items: Array.from({ length: DIGEST_MAX_ITEMS + 3 }, (_, i) => ({ ...riga().items[1], id: 100 + i })),
  }), { baseURL: BASE, token: t })
  check(`oltre ${DIGEST_MAX_ITEMS} notifiche: "And 3 more"`, molte.text.includes('And 3 more in your notifications') &&
    !molte.text.includes('upvote') && !molte.text.includes(`/notifications/${100 + DIGEST_MAX_ITEMS}\n`))
  check('un tipo sconosciuto: una frase neutra', digestLine({ ...riga().items[0], kind: 'boh' }).title === 'New activity on your account')
}

async function mittente() {
  console.log('\n  -- lib/notify/send.ts: Resend, il file di sviluppo, gli errori')
  check('429 e quote: pausa', ['daily_quota_exceeded', 'monthly_quota_exceeded', 'rate_limit_exceeded']
    .every((name) => classifyResendError({ name }).status === 'quota') &&
    classifyResendError({ name: 'application_error', statusCode: 429 }).status === 'quota')
  check('stessa chiave e corpo diverso: gia\' partito', classifyResendError({ name: 'invalid_idempotent_request', statusCode: 409 }).status === 'duplicate')
  check('stessa chiave in corso: occupato', classifyResendError({ name: 'concurrent_idempotent_requests', statusCode: 409 }).status === 'busy')
  check('il resto: fallito, senza pausa', classifyResendError({ name: 'validation_error', statusCode: 422 }).status === 'failed' &&
    classifyResendError(null).status === 'failed')
  const env = readNotifyEnv()
  check('il mittente: EMAIL_FROM, o EMAIL_NOTIFY_FROM se c\'e\'', env.from === readAuthEnv().emailFrom &&
    readNotifyEnv({ ...process.env, EMAIL_NOTIFY_FROM: 'Notify <notify@x.example>' }).from === 'Notify <notify@x.example>')
  check('baseURL senza barra finale', readNotifyEnv({ ...process.env, BETTER_AUTH_URL: `${BASE}/` }).baseURL === BASE)
  check('il log dei digest sta accanto a quello dei magic link', DEV_DIGEST_LOG === join(CARTELLA, 'dokkan-digests.log') &&
    DEV_MAGIC_LINK_LOG === join(CARTELLA, 'dokkan-magic-links.log'))
  const prod = createDigestSender({ ...env, production: true, resendApiKey: null })
  const e = renderDigest(riga(), { baseURL: BASE, token: signUnsubscribeToken(SEGRETO, UID, 1) })
  const esito = await prod([e], 'digest:prova')
  let scritto = true
  try { readFileSync(DEV_DIGEST_LOG) } catch { scritto = false }
  check('in produzione senza chiave: fallito, e nessun file', esito.status === 'failed' && !scritto)
  const dev = await createDigestSender(env)([e], 'digest:2026-10-10:abc')
  const log = readFileSync(DEV_DIGEST_LOG, 'utf8')
  check('in sviluppo: il file con chiave, oggetto, header e testo', dev.status === 'sent' &&
    log.includes('digest key=digest:2026-10-10:abc') && log.includes(`Subject: ${e.subject}`) &&
    log.includes('List-Unsubscribe-Post: List-Unsubscribe=One-Click') && log.includes('3 new comments on your clear'))
  rmSync(DEV_DIGEST_LOG)
  const k1 = digestBatchKey('2026-10-10', ['b', 'a'])
  check('la chiave della batch: giorno e insieme degli utenti, in qualsiasi ordine',
    k1 === digestBatchKey('2026-10-10', ['a', 'b']) && k1 !== digestBatchKey('2026-10-11', ['a', 'b']) &&
    k1 !== digestBatchKey('2026-10-10', ['a']) && /^digest:2026-10-10:[0-9a-f]{32}$/.test(k1), k1)
}

// ---------------------------------------------------------------------
//  Dal qui in giu': il database di test
// ---------------------------------------------------------------------
const { db } = await import('@/lib/db')
const { dati, num, one, payload, q, utente, SUBMIT } = await import('@/db/test/builder-helpers')
const { runDigest } = await import('@/lib/notify/run')
const { unsubscribeWithToken } = await import('@/lib/notify/unsubscribe')
type Sender = import('@/lib/notify/send').DigestSender
type DigestEmail = import('@/lib/notify/digest').DigestEmail
const P = 'digestapp'
const NOSTRI = `${P}+%@example.invalid`
const COMMENTO_SEGRETO = 'Secret comment body DIGESTAPP-7781'

async function conteggioLogin() {
  console.log('\n  -- il conteggio dei login: dopo l\'invio, mai un errore, mai un\'attesa lunga')
  const oggi = async () => num(`select coalesce(sum(n), 0) from email_quota where kind = 'auth' and day = (now() at time zone 'UTC')::date`)
  const prima = await oggi()
  await countAuthEmail()
  check('countAuthEmail conta un\'email di accesso', (await oggi()) === prima + 1)
  let ok = true
  try {
    await countAuthEmail(() => Promise.reject(new Error('database giu\'')))
    await countAuthEmail(() => { throw new Error('sincrono') })
  } catch { ok = false }
  check('un contatore che lancia o rifiuta non fa fallire niente', ok)
  const t0 = Date.now()
  await countAuthEmail(() => new Promise(() => {}))
  const atteso = Date.now() - t0
  check(`un contatore bloccato non trattiene oltre ${AUTH_COUNT_TIMEOUT_MS} ms`, atteso < AUTH_COUNT_TIMEOUT_MS + 500, `${atteso} ms`)

  const env = readAuthEnv({ NODE_ENV: 'development', BETTER_AUTH_URL: BASE, BETTER_AUTH_SECRET: SEGRETO })
  const ordine: string[] = []
  const invia = createMagicLinkSender(env, {
    countSend: async () => {
      ordine.push(readFileSync(DEV_MAGIC_LINK_LOG, 'utf8').includes('digestapp+login') ? 'dopo' : 'prima')
      throw new Error('il contatore non va')
    },
  })
  let partito = true
  try { await invia({ email: 'digestapp+login@example.invalid', url: `${BASE}/x?token=1` }) } catch { partito = false }
  check('il magic link parte anche se il contatore lancia, e si conta DOPO l\'invio',
    partito && ordine.join() === 'dopo' && readFileSync(DEV_MAGIC_LINK_LOG, 'utf8').includes(`${BASE}/x?token=1`))
  rmSync(DEV_MAGIC_LINK_LOG)
  check('lib/auth/auth.ts passa countAuthEmail al mittente dei magic link',
    /createMagicLinkSender\(env, \{ countSend: \(\) => countAuthEmail\(\) \}\)/.test(file('lib/auth/auth.ts')))
}

type Mondo = { autore: string; admin: string; altro: string; vot: string; spento: string; vA: string }

async function mondo(): Promise<Mondo> {
  const d = await dati().catch(async () => {
    const b = await one<{ run: string; tier: string }>(
      `select r.id::text as run, st.id::text as tier from event_run r join stage_tier st on st.event_id = r.event_id
        where r.starts_at <= now() order by r.event_id, r.id, st.id limit 1`)
    const cards = (await q<{ id: string }>(
      `select c.id::text from card c join card_release r on r.card_id = c.id and r.reg = 'global'
        where r.released_at <= current_date order by c.id limit 8`)).map((r) => Number(r.id))
    return { run: b.run, tier: b.tier, futura: '', altraRun: '', cards }
  })
  const nuovo = async (h: string) => {
    const u = await utente(P, h)
    await db.query('update app_user set email_verified = true where id = $1', [u])
    return u
  }
  const [autore, admin, altro, vot, spento] = [await nuovo('dga_autore'), await nuovo('dga_admin'),
    await nuovo('dga_altro'), await nuovo('dga_vot'), await nuovo('dga_spento')]
  await db.query(`update app_user set role = 'admin' where id = $1`, [admin])
  const clear = async (u: string) =>
    (await one<{ id: string }>(SUBMIT, [u, d.run, d.tier, JSON.stringify(payload(d.cards))])).id
  const versione = async (c: string) =>
    (await one<{ id: string }>('select id::text from clear_version where clear_id = $1 and is_current', [c])).id
  const [cA, cAltro, cSpento] = [await clear(autore), await clear(altro), await clear(spento)]
  const vA = await versione(cA)
  for (const u of [autore, admin, altro]) await db.query('select set_email_digest($1::uuid, true)', [u])
  await db.query(`update app_user set notify_digest_on_at = now() - interval '1 hour' where id = any($1::uuid[])`, [[autore, admin, altro]])
  // l'attivita' di un altro utente: commenti, un +1, una segnalazione (agli admin)
  await db.query('select comment_clear_version($1::uuid, $2::uuid, $3)', [vot, vA, COMMENTO_SEGRETO])
  await db.query('select comment_clear_version($1::uuid, $2::uuid, $3)', [vot, await versione(cAltro), COMMENTO_SEGRETO])
  await db.query('select comment_clear_version($1::uuid, $2::uuid, $3)', [vot, await versione(cSpento), COMMENTO_SEGRETO])
  await db.query('select vote_clear_version($1::uuid, $2::uuid, 1::smallint)', [vot, vA])
  await db.query('select report_content($1::uuid, $2, $3::uuid, $4, $5)', [vot, 'clear', cAltro, 'spam', COMMENTO_SEGRETO])
  // digest_due guarda fino a un minuto fa: l'attivita' si sposta di 5 minuti indietro
  await db.query(`update notification set created_at = now() - interval '5 minutes', updated_at = now() - interval '5 minutes'
                   where recipient_id = any($1::uuid[])`, [[autore, admin, altro, spento]])
  await db.query(`update clear_vote set voted_at = now() - interval '5 minutes' where version_id = $1`, [vA])
  return { autore, admin, altro, vot, spento, vA }
}

/** Solo i nostri, per non dipendere da altri utenti del database di test. */
const nostriDovuti = async () =>
  (await q<{ user_id: string }>('select user_id::text from digest_due(100)')).map((r) => r.user_id)
const azzera = async () => {
  await db.query(`delete from email_quota where kind = 'notify'`)
  await db.query('update notify_state set paused_until = null, paused_reason = null')
}
const finto = (esito: Awaited<ReturnType<Sender>>) => {
  const chiamate: { emails: DigestEmail[]; key: string }[] = []
  const sender: Sender = async (emails, key) => { chiamate.push({ emails, key }); return esito }
  return { sender, chiamate }
}

async function giro(m: Mondo) {
  console.log('\n  -- lib/notify/run.ts: un giro con un mittente finto')
  const env = readNotifyEnv()
  const marcati = async () => num(`select count(*) from app_user where id = any($1::uuid[]) and notify_digest_day is not null`,
    [[m.autore, m.admin, m.altro]])
  await azzera()
  const dovuti = await nostriDovuti()
  check('in attesa: autore, admin e altro (non chi ha il digest spento, non chi ha solo agito)',
    [m.autore, m.admin, m.altro].every((u) => dovuti.includes(u)) && !dovuti.includes(m.spento) && !dovuti.includes(m.vot))
  check('prima gli admin', dovuti.indexOf(m.admin) < dovuti.indexOf(m.autore) && dovuti.indexOf(m.admin) < dovuti.indexOf(m.altro))

  await db.query(`update notify_state set paused_until = now() + interval '1 hour', paused_reason = 'prova'`)
  let f = finto({ status: 'sent' })
  let r = await runDigest({ sender: f.sender, env })
  check('in pausa: niente selezione, niente invio', r.status === 'paused' && f.chiamate.length === 0)
  await azzera()

  await db.query(`insert into email_quota (day, kind, n) values ((now() at time zone 'UTC')::date, 'notify', 40)`)
  f = finto({ status: 'sent' })
  r = await runDigest({ sender: f.sender, env })
  check('tetto di 40 al giorno raggiunto: budget, nessun invio, nessuno segnato',
    r.status === 'budget' && f.chiamate.length === 0 && (await marcati()) === 0, JSON.stringify(r))

  await db.query(`update email_quota set n = 39 where kind = 'notify' and day = (now() at time zone 'UTC')::date`)
  f = finto({ status: 'failed', reason: 'validation_error' })
  r = await runDigest({ sender: f.sender, env })
  check('un posto solo: parte il primo in ordine (l\'admin)', f.chiamate.length === 1 && f.chiamate[0].emails.length === 1 &&
    f.chiamate[0].emails[0].to === `${P}+dga_admin@example.invalid`)
  check('invio fallito: nessuno segnato, nessuna pausa', r.status === 'failed' && (await marcati()) === 0 &&
    (await one<{ p: Date | null }>('select notify_paused_until() as p')).p === null)

  await azzera()
  f = finto({ status: 'busy', reason: 'concurrent_idempotent_requests' })
  r = await runDigest({ sender: f.sender, env })
  check('un altro giro in corso con la stessa chiave: nessuno segnato', r.status === 'busy' && (await marcati()) === 0)

  await azzera()
  f = finto({ status: 'quota', reason: 'daily_quota_exceeded' })
  r = await runDigest({ sender: f.sender, env })
  const pausa = await one<{ p: Date | null; r: string | null }>('select paused_until as p, paused_reason as r from notify_state')
  check('429 o quota finita: pausa di circa 24 ore, nessuno segnato', r.status === 'quota' && (await marcati()) === 0 &&
    pausa.p !== null && Math.abs(pausa.p.getTime() - Date.now() - 24 * 3600e3) < 120e3 && pausa.r === 'daily_quota_exceeded')
  const chiave = f.chiamate[0].key

  await azzera()
  f = finto({ status: 'duplicate', reason: 'invalid_idempotent_request' })
  r = await runDigest({ sender: f.sender, env })
  check('stessa chiave dello stesso gruppo e dello stesso giorno', f.chiamate[0].key === chiave, chiave)
  check('gia\' partito con quella chiave: segnati, e oggi non ripartono', r.status === 'duplicate' && (await marcati()) === 3 &&
    !(await nostriDovuti()).some((u) => [m.autore, m.admin, m.altro].includes(u)))
  // torna tutto come prima, per la rotta vera
  await db.query(`update app_user set notify_digest_day = null, notify_digest_at = null where id = any($1::uuid[])`,
    [[m.autore, m.admin, m.altro]])
  await azzera()
}

type Uscita = { status?: string; sent?: number; due?: number }

async function rottaCron(m: Mondo): Promise<Record<string, string>> {
  console.log('\n  -- /api/cron/digest: il segreto, un digest nel log, il secondo giro vuoto')
  const { GET } = await import('@/app/api/cron/digest/route')
  type Rotta = Parameters<typeof GET>[0]
  const chiama = (auth?: string) =>
    GET(new Request(`${BASE}/api/cron/digest`, { headers: auth ? { authorization: auth } : {} }) as Rotta)
  const senza = await chiama()
  check('senza segreto: 401, no-store', senza.status === 401 && senza.headers.get('cache-control') === 'no-store')
  check('segreto sbagliato: 401', (await chiama(`Bearer ${CRON}x`)).status === 401)
  const ok = await chiama(`Bearer ${CRON}`)
  const corpo = (await ok.json()) as Uscita
  check('con il segreto: 200 e "sent"', ok.status === 200 && corpo.status === 'sent' && (corpo.sent ?? 0) >= 3, JSON.stringify(corpo))
  const log = readFileSync(DEV_DIGEST_LOG, 'utf8')
  const voci = log.split(/^=== /m).filter(Boolean)
  const di = (h: string) => voci.find((v) => v.includes(`To: ${P}+${h}@example.invalid`)) ?? ''
  check('un digest a testa per autore, admin e altro; nessuno a chi ha il digest spento',
    ['dga_autore', 'dga_admin', 'dga_altro'].every((h) => voci.filter((v) => v.includes(`To: ${P}+${h}@`)).length === 1) &&
    !log.includes('dga_spento@') && !log.includes('dga_vot@'))
  const a = di('dga_autore')
  check('autore: il commento di dga_vot e +1 upvote, con il link della notifica',
    a.includes('dga_vot commented on your clear') && a.includes('+1 upvote on your clears') &&
    /\/notifications\/\d+\n/.test(a), a.slice(0, 400))
  check('admin: la segnalazione da vedere, senza chi l\'ha mandata', di('dga_admin').includes('A new report to review') &&
    !di('dga_admin').includes('dga_vot'))
  check('il testo dei commenti e della segnalazione non c\'e\' mai', !log.includes(COMMENTO_SEGRETO))
  check('header di disiscrizione in ogni voce', voci.every((v) =>
    /List-Unsubscribe: <http:\/\/digestapp\.localhost:3999\/api\/notifications\/unsubscribe\?t=v1\.[^>]+>/.test(v) &&
    v.includes('List-Unsubscribe-Post: List-Unsubscribe=One-Click')))
  check('niente trattini lunghi nel log', senzaTrattini(log))
  const chiave = /digest key=(digest:\d{4}-\d{2}-\d{2}:[0-9a-f]{32})/.exec(voci[0] ?? '')?.[1]
  check('la Idempotency-Key della batch: digest:<giorno>:<hash>', Boolean(chiave) && voci.every((v) => v.includes(`key=${chiave}`)))

  check('digest_mark_sent: i tre hanno il giorno di oggi', await num(
    `select count(*) from app_user where id = any($1::uuid[]) and notify_digest_day = (now() at time zone 'UTC')::date`,
    [[m.autore, m.admin, m.altro]]) === 3)
  const secondo = (await (await chiama(`Bearer ${CRON}`)).json()) as Uscita
  check('il secondo giro dello stesso giorno non manda niente', secondo.status === 'empty' &&
    readFileSync(DEV_DIGEST_LOG, 'utf8') === log, JSON.stringify(secondo))
  await db.query(`update notify_state set paused_until = now() + interval '1 hour', paused_reason = 'prova'`)
  check('in pausa la rotta risponde "paused"', ((await (await chiama(`Bearer ${CRON}`)).json()) as Uscita).status === 'paused')
  await azzera()

  const token = (h: string) => /unsubscribe\?t=(v1\.[^>\s]+)>/.exec(di(h))?.[1] ?? ''
  return { autore: token('dga_autore'), admin: token('dga_admin'), altro: token('dga_altro') }
}

async function rottaDisiscrizione(m: Mondo, t: Record<string, string>) {
  console.log('\n  -- /api/notifications/unsubscribe: il one-click senza cookie, il GET che non scrive')
  const { GET, POST } = await import('@/app/api/notifications/unsubscribe/route')
  const acceso = async (u: string) =>
    (await one<{ on: boolean }>('select notify_digest_on_at is not null as on from app_user where id = $1', [u])).on
  const url = (tok: string) => `${BASE}/api/notifications/unsubscribe?t=${encodeURIComponent(tok)}`
  const oneClick = (tok: string, extra: Record<string, string> = {}) => POST(new Request(url(tok), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...extra },
    body: 'List-Unsubscribe=One-Click',
  }))
  check('i token sono nel log e sono nostri', verifyUnsubscribeToken(SEGRETO, t.autore)?.userId === m.autore &&
    verifyUnsubscribeToken(SEGRETO, t.admin)?.userId === m.admin)

  // un cookie di sessione qualsiasi non conta: decide solo il token
  const r = await oneClick(t.autore, { cookie: 'dts.session_token=qualcosa-di-un-altro' })
  check('POST one-click: 200, digest spento', r.status === 200 && ((await r.json()) as { ok?: boolean }).ok === true &&
    !(await acceso(m.autore)))
  check('nessun cookie nella risposta, no-store e no-referrer', r.headers.get('set-cookie') === null &&
    r.headers.get('cache-control') === 'no-store' && r.headers.get('referrer-policy') === 'no-referrer')
  check('il secondo clic dice lo stesso', (await oneClick(t.autore)).status === 200 && !(await acceso(m.autore)))
  check('solo l\'autore: gli altri restano accesi', (await acceso(m.admin)) && (await acceso(m.altro)))

  const rotto = rompiFirma(t.altro)
  check('un token rotto: 400, e non spegne niente', (await oneClick(rotto)).status === 400 && (await acceso(m.altro)))
  check('senza token: 400', (await POST(new Request(`${BASE}/api/notifications/unsubscribe`, { method: 'POST' }))).status === 400)
  const nelCorpo = await POST(new Request(`${BASE}/api/notifications/unsubscribe`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `t=${encodeURIComponent(t.altro)}`,
  }))
  check('il token nel corpo del form vale lo stesso', nelCorpo.status === 200 && !(await acceso(m.altro)))

  const g = GET(new Request(url(t.admin)))
  check('GET: 303 alla pagina con il bottone, e non spegne niente', g.status === 303 &&
    g.headers.get('location') === `/notifications/unsubscribe?t=${encodeURIComponent(t.admin)}` && (await acceso(m.admin)))

  await db.query('select notify_rotate_token($1::uuid)', [m.admin])
  check('dopo notify_rotate_token il link vecchio non vale: 400, resta acceso',
    (await oneClick(t.admin)).status === 400 && (await acceso(m.admin)))
  const nuovo = signUnsubscribeToken(SEGRETO, m.admin, 2)
  check('il bottone della pagina (unsubscribeWithToken) con il token nuovo: spento',
    (await unsubscribeWithToken(nuovo)) === 'ok' && !(await acceso(m.admin)))
  check('unsubscribeWithToken: un token non valido non tocca il database', (await unsubscribeWithToken('v1.x')) === 'invalid')
}

async function guardie() {
  console.log('\n  -- le guardie sui file')
  const pagina = file('app/notifications/unsubscribe/page.tsx')
  check('la pagina: noindex, no-referrer, niente sessione', /index: false/.test(pagina) && /referrer: 'no-referrer'/.test(pagina) &&
    !/lib\/dal|lib\/auth\/auth|cookies\(|headers\(/.test(pagina))
  check('la pagina: il GET mostra solo il bottone (la scrittura e\' nella Server Action)',
    !/unsubscribeWithToken|notify_unsubscribe/.test(pagina) && /type="hidden" name="t"/.test(file('components/notifiche/disiscrivi.tsx')))
  const rotta = file('app/api/notifications/unsubscribe/route.ts')
  check('la rotta one-click non legge sessione ne\' cookie', !/lib\/dal|lib\/auth\/auth|cookies\(|getSession|currentUser/.test(rotta))
  const conf = file('next.config.ts')
  check('next.config: no-referrer e noindex anche nell\'header della pagina, dopo gli header di sicurezza',
    conf.includes("['/notifications/unsubscribe', '/api/notifications/unsubscribe'].map") &&
    /key: 'Referrer-Policy', value: 'no-referrer'/.test(conf) &&
    /securityHeaders \}, \.\.\.pwaHeaders, \.\.\.unsubscribeHeaders\]/.test(conf))
  const crons = (JSON.parse(file('vercel.json')) as { crons: { path: string; schedule: string }[] }).crons
  check('vercel.json: il digest ogni giorno alle 17 UTC, la pulizia resta alle 4',
    crons.some((c) => c.path === '/api/cron/digest' && c.schedule === '0 17 * * *') &&
    crons.some((c) => c.path === '/api/cron/purge' && c.schedule === '0 4 * * *'))
  check('la pulizia chiama purge_email_quota', file('app/api/cron/purge/route.ts').includes('select purge_email_quota()'))
  const args = (await one<{ a: string }>("select pg_get_function_arguments('purge_email_quota(int)'::regprocedure) as a")).a
  const { LEGALE } = await import('@/lib/legale')
  check('LEGALE: i giorni dei contatori uguali a purge_email_quota', args.includes(`DEFAULT ${LEGALE.giorniContatoriEmail}`), args)
  const privacy = file('app/privacy/page.tsx')
  check('privacy: Resend manda anche il digest, il consenso si revoca, cosa si conta',
    /Resend \(sending sign-in emails and, if you turn it on, the daily digest\)/.test(privacy) &&
    /withdraw it\s+at any time/.test(privacy) && /counts how many sign-in emails and digests/.test(privacy))
  const settings = file('app/settings/page.tsx')
  check('Settings: la casella con lo stato salvato e l\'email verificata',
    /<DigestEmail on=\{digest\} verified=\{verified\}/.test(settings) && /emailDigestOn\(user\.id\)/.test(settings))
  const casella = file('components/notifiche/digest-email.tsx')
  check('la casella: Daily email digest, spenta senza email verificata', casella.includes('Daily email digest') &&
    /disabled=\{bloccata\}/.test(casella) && /const bloccata = !verified && !acceso/.test(casella))
  check('niente trattini lunghi nei testi nuovi', ['lib/notify/digest.ts', 'app/notifications/unsubscribe/page.tsx',
    'components/notifiche/digest-email.tsx', 'components/notifiche/disiscrivi.tsx', 'lib/notify/actions.ts', 'app/privacy/page.tsx']
    .every((f) => senzaTrattini(file(f))))
}

async function pulizia() {
  const nostri = `(select id from app_user where email like $1)`
  await db.query(`delete from clear where author_id in ${nostri}`, [NOSTRI])
  await db.query('delete from app_user where email like $1', [NOSTRI])
}

token()
testi()
await mittente()
// email_quota e notify_state si rimettono come erano
const quota = await q<{ day: string; kind: string; n: number }>('select day::text, kind, n from email_quota')
const statoNotify = await one<{ p: Date | null; r: string | null }>('select paused_until as p, paused_reason as r from notify_state')
try {
  await pulizia()
  await conteggioLogin()
  const m = await mondo()
  await giro(m)
  const t = await rottaCron(m)
  await rottaDisiscrizione(m, t)
  await guardie()
} finally {
  await pulizia()
  await db.query('delete from email_quota')
  for (const r of quota) await db.query('insert into email_quota (day, kind, n) values ($1::date, $2, $3)', [r.day, r.kind, r.n])
  await db.query('update notify_state set paused_until = $1, paused_reason = $2', [statoNotify.p, statoNotify.r])
  await db.end()
  rmSync(CARTELLA, { recursive: true, force: true })
}

console.log(`\n  ${stato.passes} PASS, ${stato.fails} FAIL`)
process.exit(stato.fails ? 1 : 0)
