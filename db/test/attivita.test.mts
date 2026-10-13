// Verifica il feed dell'attivita' del sito per gli admin (migrazione 0032):
// spento per difetto e solo per gli admin (set_notification_pref), una riga
// per azione a chi l'ha acceso e a nessun altro, mai a se stessi, le
// esclusioni (chi e' segnalato, l'autore moderato, i ruoli da script,
// dts.silent; l'autore del clear commentato invece riceve anche il feed),
// le scritture che non cambiano niente, le cascate (una cancellazione e'
// UNA azione), l'accorpamento, il rollback, la privacy dopo la
// cancellazione di un account (nessun handle resta, mai il testo dei post,
// chi segnala mai nemmeno come attore), la lettura (render, limite per
// famiglia, il pallino che si spegne anche con piu' di LIST_LIMIT gruppi e
// quante azioni non mostrate la pagina deve dire, testi e link veri di
// lib/notify/vista.ts, la pagina di /admin per chi e' sospeso), le push
// (push_claim: una per azione dal giro dopo la scrittura, col totale e lo
// stesso tag, senza tetti, la prima push o il resto di un giro non
// riuscito ma non gli arretrati di chi accende la push dopo, mai chi
// segnala), il digest (mai il feed) e chi smette di essere admin (perde
// consenso e righe del feed, anche con una segnalazione nello stesso
// istante; reports_open resta com'era).
//
// Gira sul database di test (npm run db:test). Crea solo utenti
// attivitatest+...@example.invalid e li toglie alla fine, anche se qualcosa
// fallisce: notifiche, preferenze e dispositivi se ne vanno con loro. Le
// righe di moderation_action restano (il registro non si cancella).
import { createECDH, randomBytes } from 'node:crypto'
import { db } from '@/lib/db'
import type { NotificationRow } from '@/lib/notify/kinds'
import { pushTag, pushText, pushTopic } from '@/lib/notify/payload'
import { LIST_LIMIT, listNotifications, markListRead, renderNotification } from '@/lib/notify/queries'
import { notificationHref, notificationText } from '@/lib/notify/vista'
import { clearAnchor, eventHref, profileHref } from '@/lib/urls'
import {
  REVISE, SUBMIT, check, dati, esito, guardia, num, one, payload, q, stato, utente, type Dati,
} from '@/db/test/builder-helpers'

guardia()
const P = 'attivitatest'
const SEGRETO = 'SEGRETO-attivita-9d2e'

// la stessa istruzione della Server Action di Settings
const FEED = "select set_notification_pref($1::uuid, 'site_activity', c, $2) from unnest(array['list', 'push']) as c"
const PREF = 'select set_notification_pref($1::uuid, $2, $3, $4) as on'
const COMMENT = 'select comment_clear_version($1::uuid, $2::uuid, $3) as id'
const VOTE = 'select vote_clear_version($1::uuid, $2::uuid, $3::smallint) as score'
const POST_TIP = 'select post_tip($1::uuid, $2::bigint, $3::bigint, $4, null)::text as id'
const EDIT_TIP = 'select edit_tip($1::uuid, $2::uuid, $3, null)'
const DELETE_TIP = 'select delete_tip($1::uuid, $2::uuid)'
const VOTE_TIP = 'select vote_tip($1::uuid, $2::uuid, $3::smallint)'
const REPORT = 'select report_content($1::uuid, $2, $3::uuid, $4, $5) as id'
const HIDE_CLEAR = 'select mod_set_clear_status($1::uuid, $2::uuid, $3, null) as n'
const HIDE_COMMENT = 'select mod_set_comment_status($1::uuid, $2::uuid, $3, null) as n'
const HIDE_TIP = 'select mod_set_tip_status($1::uuid, $2::uuid, $3, null) as n'
const DISMISS = 'select mod_dismiss_reports($1::uuid, $2, $3::uuid, null) as n'
const SUSPEND = 'select mod_suspend_user($1::uuid, $2::uuid, $3::timestamptz, $4) as until'
const UNSUSPEND = 'select mod_unsuspend_user($1::uuid, $2::uuid, null) as ok'
const DELETE_CLEAR = 'select delete_clear($1::uuid, $2::uuid)'
const DELETE_ACCOUNT = 'select delete_account($1::uuid, $2)'
const ONBOARD = "select complete_onboarding($1::uuid, $2::citext, 'global')"
const HANDLE = 'select change_handle($1::uuid, $2::citext)'
const MARK = 'select mark_notifications_read($1::uuid, null)'
const CLAIM = 'select * from push_claim(100)'

type Riga = {
  id: string; recipient_id: string; group_key: string; actor_id: string | null; clear_id: string | null
  comment_id: string | null; tip_id: string | null; subject_id: string | null; data: Record<string, unknown>
  read_at: Date | null; updated_at: Date
}
type Job = {
  notification_id: string; recipient_id: string; kind: string; group_key: string; n: number
  actor_handle: string | null; target: string | null; event_name: string | null; stage_seq: number | null
  stage_name: string | null; difficulty: string | null; action: string | null; subject_handle: string | null
}

const RIGHE = `select id::text, recipient_id::text, group_key, actor_id::text, clear_id::text, comment_id::text,
                      tip_id::text, subject_id::text, data, read_at, updated_at
                 from notification where kind = 'site_activity'`
const feed = (u: string) => q<Riga>(`${RIGHE} and recipient_id = $1 order by updated_at desc, id desc`, [u])
const nonLette = async (u: string) => (await feed(u)).filter((r) => r.read_at === null)
const id = async (text: string, params: unknown[]) => (await one<{ id: string }>(text, params)).id
const versione = async (clear: string) =>
  (await one<{ id: string }>('select id::text from clear_version where clear_id = $1 and is_current', [clear])).id
const pallino = async (u: string) => (await one<{ on: boolean }>(
  `select coalesce(notif_last_at > coalesce(notif_seen_at, '-infinity'), false) as on from app_user where id = $1`, [u])).on
const senzaTrattini = (s: string) => !/[–—]/.test(s)

/** Gli admin col feed acceso: solo loro possono avere righe site_activity. */
const iscritti = new Set<string>()
const nomi = new Map<string, string>()
/** Le righe del feed di chi non l'ha acceso: devono essere sempre zero. */
const altri = () => num(`select count(*) from notification where kind = 'site_activity' and not (recipient_id = any ($1::uuid[]))`,
  [[...iscritti]])
const segnaTutti = async () => { for (const u of iscritti) await db.query(MARK, [u]) }
/** Lo stato del feed di tutti gli iscritti, per dire "non e' cambiato niente". */
const foto = async () => JSON.stringify(await q(
  `select recipient_id, group_key, data, updated_at, read_at from notification
    where kind = 'site_activity' and recipient_id = any ($1::uuid[]) order by id`, [[...iscritti]]))

async function datiMinimi(): Promise<Dati> {
  try { return await dati() } catch { /* nessuna ricorrenza futura: va bene lo stesso */ }
  const base = await one<{ run: string; tier: string }>(
    `select r.id::text as run, st.id::text as tier from event_run r join stage_tier st on st.event_id = r.event_id
      where r.starts_at <= now() order by r.event_id, r.id, st.id limit 1`)
  const cards = (await q<{ id: string }>(
    `select c.id::text from card c join card_release r on r.card_id = c.id and r.reg = 'global'
      where r.released_at <= current_date order by c.id limit 8`)).map((r) => Number(r.id))
  return { run: base.run, tier: base.tier, futura: '', altraRun: '', cards }
}

type Mondo = { d: Dati; eventId: string; A: string; B: string; C: string; m1: string; m2: string; m3: string; m4: string; m5: string }
let m: Mondo

async function persona(handle: string, admin = false) {
  const u = await utente(P, handle)
  if (admin) await db.query(`update app_user set role = 'admin' where id = $1`, [u])
  nomi.set(u, handle)
  return u
}
const clearDi = (u: string) => id(SUBMIT, [u, m.d.run, m.d.tier, JSON.stringify(payload(m.d.cards))])

async function regole() {
  console.log('\n  -- il tipo, i vincoli e l\'ordine dei trigger (0032)')
  const kinds = (await one<{ k: string[] }>('select notification_kinds() as k')).k
  check('site_activity e\' l\'ultimo tipo', kinds[kinds.length - 1] === 'site_activity', kinds.join(','))
  const fk = await one<{ del: string }>(
    `select confdeltype::text as del from pg_constraint where conname = 'notification_subject_id_fkey'`)
  check('subject_id: FK verso app_user a cascata', fk?.del === 'c')
  check('gli indici: per soggetto (la cascata) e per chi ha il feed acceso',
    await num(`select count(*) from pg_indexes where indexname in ('notification_by_subject', 'notification_pref_site_activity')`) === 2)
  const nomiTrigger = (await q<{ t: string }>(
    `select tgname as t from pg_trigger where tgrelid = 'moderation_action'::regclass and not tgisinternal
        and tgname in ('activity_moderation_action', 'notify_moderation_action') order by tgname`)).map((r) => r.t)
  check('activity_moderation_action viene prima di notify_moderation_action (Postgres li esegue per nome)',
    nomiTrigger.join(',') === 'activity_moderation_action,notify_moderation_action', nomiTrigger.join(','))
  const commenti = await one<{ src: string }>(`select prosrc as src from pg_proc where proname = 'comment_clear_version'`)
  check('il commento: l\'azione in comment_clear_version, prima di add_clear_comment (e di notify_clear_comment)',
    commenti.src.indexOf('activity_note') > 0 && commenti.src.indexOf('activity_note') < commenti.src.indexOf('add_clear_comment'))
  check('nessun trigger di attivita\' su clear_comment, clear_vote, tip_vote (cancellazioni e cascate non contano)',
    await num(`select count(*) from pg_trigger where tgname like 'activity%'
                 and tgrelid in ('clear_comment'::regclass, 'clear_vote'::regclass, 'tip_vote'::regclass)`) === 0)

  console.log('\n  -- data: solo azione, conteggio, evento e tier')
  const riga = (data: unknown) => esito(
    `insert into notification (recipient_id, kind, group_key, data) values ($1, 'site_activity', $2, $3::jsonb)`,
    [m.A, `act:prova:${randomBytes(4).toString('hex')}`, JSON.stringify(data)])
  check('un campo di testo e\' rifiutato', await riga({ a: 'comment_posted', n: 1, body: SEGRETO }) === '23514 notification_activity_data')
  check('un handle e\' rifiutato', await riga({ a: 'handle_changed', n: 1, old: 'vecchio' }) === '23514 notification_activity_data')
  check('senza azione, o un\'azione sconosciuta: rifiutata', await riga({ n: 1 }) === '23514 notification_activity_data' &&
    await riga({ a: 'clear_liked', n: 1 }) === '23514 notification_activity_data')
  check('n e gli id come numeri, non testo', await riga({ a: 'clear_posted', n: '1' }) === '23514 notification_activity_data' &&
    await riga({ a: 'clear_deleted', n: 1, event: 'Some Event' }) === '23514 notification_activity_data')
  check('la forma giusta passa', await riga({ a: 'clear_deleted', n: 1, event: 1, tier: 2 }) === 'ok')
  await db.query(`delete from notification where group_key like 'act:prova:%'`)
}

async function preferenze() {
  console.log('\n  -- set_notification_pref: solo gli admin, mai l\'email')
  check('un membro non accende il feed (lista e push): notification_pref_admin_only',
    await esito(PREF, [m.m2, 'site_activity', 'list', true]) === '42501 notification_pref_admin_only' &&
    await esito(PREF, [m.m2, 'site_activity', 'push', true]) === '42501 notification_pref_admin_only' &&
    await esito(FEED, [m.m2, true]) === '42501 notification_pref_admin_only')
  check('il feed per email no, nemmeno a un admin', await esito(PREF, [m.A, 'site_activity', 'email', true]) ===
    '23514 notification_pref_channel')
  check('la lista come canale vale solo per il feed', await esito(PREF, [m.A, 'clear_comment', 'list', true]) ===
    '23514 notification_pref_channel')
  check('spegnere si puo\' sempre', await esito(PREF, [m.m2, 'site_activity', 'list', false]) === 'ok' &&
    await esito(FEED, [m.m2, false]) === 'ok')
  check('il CHECK della tabella morde anche senza il verbo',
    await esito(`insert into notification_pref (user_id, kind, channel) values ($1, 'site_activity', 'email')`, [m.A]) ===
      '23514 notification_pref_channel_kind')
  check('nessuna preferenza scritta dai rifiuti', await num(
    `select count(*) from notification_pref where kind = 'site_activity' and user_id = any ($1::uuid[])`,
    [[m.A, m.B, m.C, m.m2]]) === 0)
}

async function spentoPerDifetto() {
  console.log('\n  -- spento per difetto: nessuna riga finche\' nessuno lo accende')
  const c = await clearDi(m.m2)
  await db.query(COMMENT, [m.m3, await versione(c), 'Default off comment.'])
  await db.query(VOTE, [m.m3, await versione(c), 1])
  const t = await id(POST_TIP, [m.m2, m.eventId, null, 'Default off tip, nothing to see.'])
  await db.query(VOTE_TIP, [m.m3, t, 1])
  await db.query(REPORT, [m.m3, 'clear', c, 'spam', null])
  await db.query(HIDE_CLEAR, [m.B, c, 'hidden'])
  await db.query(HIDE_CLEAR, [m.B, c, 'published'])
  check('nessuna riga site_activity, per nessuno (gli admin A, B, C compresi)', await num(
    `select count(*) from notification where kind = 'site_activity'`) === 0)
  await db.query(DELETE_TIP, [m.m2, t])
  await db.query(DELETE_CLEAR, [m.m2, c])
  check('nemmeno le cancellazioni', await num(`select count(*) from notification where kind = 'site_activity'`) === 0)
}

type Atteso = {
  group: string; a: string; actor: string | null
  clear?: string | null; comment?: string | null; tip?: string | null; subject?: string | null
  n?: number; extra?: Record<string, unknown>
  target: string; content?: boolean | null; subjectHandle?: string | null
  /** chi la riceve: per difetto A e B (C non ha il feed) */
  per?: string[]
  href: (r: NotificationRow) => string
}

/**
 * Un'azione: prima tutte le righe lette, poi la scrittura. Ogni admin col
 * feed in x.a ha UNA riga nuova, giusta (gruppo, azione, attore,
 * riferimenti, n, data), il pallino acceso, il render e il link giusti, e
 * mai il testo dei post; gli altri iscritti (chi ha agito) niente; chi non
 * ha il feed niente.
 */
async function azione<T>(nome: string, fare: () => Promise<T>, atteso: (r: T) => Atteso): Promise<T> {
  await segnaTutti()
  const fatto = await fare()
  const x = atteso(fatto)
  const chi = x.per ?? [m.A, m.B]
  for (const u of chi) {
    const r = await nonLette(u)
    const g = r[0]
    const chiavi = Object.keys(g?.data ?? {}).sort().join(',')
    const extra = Object.entries(x.extra ?? {}).every(([k, v]) => String(g?.data[k]) === String(v))
    check(`${nome}: una riga a ${nomi.get(u)}`, r.length === 1 && g.group_key === x.group && g.data.a === x.a &&
      g.actor_id === x.actor && g.clear_id === (x.clear ?? null) && g.comment_id === (x.comment ?? null) &&
      g.tip_id === (x.tip ?? null) && g.subject_id === (x.subject ?? null) && g.data.n === (x.n ?? 1) &&
      chiavi === ['a', 'n', ...Object.keys(x.extra ?? {})].sort().join(',') && extra, JSON.stringify(r))
    if (r.length !== 1) continue
    check(`${nome}: il pallino di ${nomi.get(u)} si accende`, await pallino(u))
    const v = await renderNotification(u, g.id)
    const testo = v ? notificationText(v) : null
    const href = v ? notificationHref(v) : ''
    check(`${nome}: render (${x.target}) e link`, !!v && v.kind === 'site_activity' && v.target === x.target && v.visible &&
      v.action === x.a && (x.content === undefined || v.content_visible === x.content) &&
      (x.subjectHandle === undefined || v.subject_handle === x.subjectHandle) && href === x.href(v),
    JSON.stringify({ target: v?.target, visible: v?.visible, action: v?.action, content: v?.content_visible, subject: v?.subject_handle, href }))
    const tutto = JSON.stringify({ v, testo })
    check(`${nome}: il testo dice chi, cosa e dove, mai il testo dei post`, !!testo && !!testo.title && !tutto.includes(SEGRETO) &&
      senzaTrattini(testo.title + (testo.detail ?? '')), JSON.stringify(testo))
  }
  for (const u of [...iscritti].filter((u) => !chi.includes(u))) {
    check(`${nome}: niente a ${nomi.get(u)} (l'ha fatta lui, o e' l'autore)`, (await nonLette(u)).length === 0)
  }
  check(`${nome}: niente a chi non ha il feed`, await altri() === 0)
  return fatto
}

// il clear con la sua versione nell'URL (lib/versione); la tip senza
const sulClear = (clear: string) => (r: NotificationRow) =>
  `${eventHref({ id: m.eventId, reg: r.reg ?? 'global', tier: m.d.tier, explicit: true })}${clearAnchor(clear)}`
const sullaTip = (tip: string, tier: string | null) => () => `${eventHref({ id: m.eventId, tier })}#tip-${tip}`

async function azioni() {
  console.log('\n  -- ogni azione: una riga a chi ha il feed, nessuna agli altri')
  for (const u of [m.A, m.B]) {
    await db.query(FEED, [u, true])
    iscritti.add(u)
  }
  check('la Server Action scrive lista e push', await num(
    `select count(*) from notification_pref where kind = 'site_activity' and user_id = any ($1::uuid[])`, [[m.A, m.B]]) === 4)
  check('C resta spento', await num(`select count(*) from notification_pref where user_id = $1`, [m.C]) === 0)

  // l'iscrizione: un utente col nome provvisorio sceglie l'handle
  m.m1 = await azione('user_joined (complete_onboarding)', async () => {
    const u = await utente(P, 'at_provv', false)
    await db.query(ONBOARD, [u, 'at_m1'])
    nomi.set(u, 'at_m1')
    return u
  }, (u) => ({ group: `act:joined:${u}`, a: 'user_joined', actor: u, subject: u, target: 'profile', subjectHandle: 'at_m1',
    href: () => profileHref('at_m1') }))

  const clear1 = await azione('clear_posted', () => clearDi(m.m1), (c) => ({
    group: `act:clear_posted:${c}`, a: 'clear_posted', actor: m.m1, clear: c, target: 'clear', content: true, href: sulClear(c) }))
  await azione('clear_revised', () => db.query(REVISE, [m.m1, clear1, 'Swapped the order.', JSON.stringify(payload(m.d.cards))]), () => ({
    group: `act:clear_revised:${clear1}`, a: 'clear_revised', actor: m.m1, clear: clear1, target: 'clear', href: sulClear(clear1) }))
  const v1 = await versione(clear1)
  const commento1 = await azione('comment_posted', () => id(COMMENT, [m.m2, v1, `${SEGRETO} comment`]), () => ({
    group: `act:comment:${clear1}`, a: 'comment_posted', actor: m.m2, clear: clear1, target: 'clear', href: sulClear(clear1) }))
  for (const [valore, a] of [[1, 'clear_upvoted'], [-1, 'clear_downvoted'], [0, 'clear_unvoted']] as const) {
    await azione(a, () => db.query(VOTE, [m.m2, v1, valore]), () => ({
      group: `act:clear_vote:${clear1}`, a, actor: m.m2, clear: clear1, target: 'clear', href: sulClear(clear1) }))
  }
  const tip1 = await azione('tip_posted', () => id(POST_TIP, [m.m1, m.eventId, m.d.tier, `${SEGRETO} tip body`]), (t) => ({
    group: `act:tip_posted:${t}`, a: 'tip_posted', actor: m.m1, tip: t, target: 'tip', content: true, href: sullaTip(t, m.d.tier) }))
  await azione('tip_edited', () => db.query(EDIT_TIP, [m.m1, tip1, `${SEGRETO} tip body, edited`]), () => ({
    group: `act:tip_edited:${tip1}`, a: 'tip_edited', actor: m.m1, tip: tip1, target: 'tip', href: sullaTip(tip1, m.d.tier) }))
  for (const [valore, a] of [[1, 'tip_helpful'], [0, 'tip_unhelpful']] as const) {
    await azione(a, () => db.query(VOTE_TIP, [m.m2, tip1, valore]), () => ({
      group: `act:tip_vote:${tip1}`, a, actor: m.m2, tip: tip1, target: 'tip', href: sullaTip(tip1, m.d.tier) }))
  }
  // chi segnala non si salva nemmeno come attore: actor null
  await azione('report (mai chi segnala, mai motivo o dettagli)', () => db.query(REPORT, [m.m2, 'clear', clear1, 'other', `${SEGRETO} details`]),
    () => ({ group: `act:report:clear:${clear1}`, a: 'report', actor: null, clear: clear1, target: 'clear', href: () => '/admin' }))
  const rep = (await nonLette(m.A))[0]
  const vr = await renderNotification(m.A, rep.id)
  check('report: il render non dice chi ha segnalato', vr?.actor_handle === null && !JSON.stringify(vr).includes('at_m2') &&
    notificationText(vr!).title === 'New report on a clear', JSON.stringify(vr && notificationText(vr)))
  check('report: nessuna riga del feed tiene chi segnala, nemmeno come id', await num(
    `select count(*) from notification where kind = 'site_activity' and data ->> 'a' = 'report' and actor_id is not null`) === 0)

  console.log('\n  -- la moderazione di un altro admin (B): ad A, mai a B')
  await azione('mod_dismiss', () => db.query(DISMISS, [m.B, 'clear', clear1]), () => ({
    group: `act:mod:dismiss:clear:${clear1}`, a: 'mod_dismiss', actor: m.B, clear: clear1, target: 'clear',
    href: () => '/admin/log', per: [m.A] }))
  await azione('mod_hide (clear)', () => db.query(HIDE_CLEAR, [m.B, clear1, 'hidden']), () => ({
    group: `act:mod:hide:clear:${clear1}`, a: 'mod_hide', actor: m.B, clear: clear1, target: 'clear', content: false,
    href: () => '/admin/log', per: [m.A] }))
  const posted = (await feed(m.A)).find((r) => r.group_key === `act:clear_posted:${clear1}`)!
  const vp = await renderNotification(m.A, posted.id)
  check('un clear nascosto ora: le sue righe portano a /admin/hidden', vp?.content_visible === false && notificationHref(vp!) === '/admin/hidden',
    vp ? notificationHref(vp) : 'assente')
  await azione('mod_unhide (clear)', () => db.query(HIDE_CLEAR, [m.B, clear1, 'published']), () => ({
    group: `act:mod:unhide:clear:${clear1}`, a: 'mod_unhide', actor: m.B, clear: clear1, target: 'clear', content: true,
    href: () => '/admin/log', per: [m.A] }))
  await azione('mod_hide (commento)', () => db.query(HIDE_COMMENT, [m.B, commento1, 'hidden']), () => ({
    group: `act:mod:hide:comment:${commento1}`, a: 'mod_hide', actor: m.B, clear: clear1, comment: commento1, target: 'comment',
    content: false, href: () => '/admin/log', per: [m.A] }))
  await azione('mod_unhide (commento)', () => db.query(HIDE_COMMENT, [m.B, commento1, 'published']), () => ({
    group: `act:mod:unhide:comment:${commento1}`, a: 'mod_unhide', actor: m.B, clear: clear1, comment: commento1, target: 'comment',
    href: () => '/admin/log', per: [m.A] }))
  await azione('mod_hide (tip)', () => db.query(HIDE_TIP, [m.B, tip1, 'hidden']), () => ({
    group: `act:mod:hide:tip:${tip1}`, a: 'mod_hide', actor: m.B, tip: tip1, target: 'tip', content: false,
    href: () => '/admin/log', per: [m.A] }))
  const tipRighe = (await feed(m.A)).filter((r) => r.tip_id === tip1 && !r.group_key.startsWith('act:mod:'))
  const tipHref = await Promise.all(tipRighe.map(async (r) => {
    const v = await renderNotification(m.A, r.id)
    return v ? `${v.content_visible}:${notificationHref(v)}` : 'assente'
  }))
  check('una tip nascosta ora: le sue righe (scritta, modificata, Helpful) portano alla scheda Tips di /admin/hidden',
    tipRighe.length >= 3 && tipHref.every((h) => h === 'false:/admin/hidden?kind=tip'), tipHref.join(','))
  await azione('mod_unhide (tip)', () => db.query(HIDE_TIP, [m.B, tip1, 'published']), () => ({
    group: `act:mod:unhide:tip:${tip1}`, a: 'mod_unhide', actor: m.B, tip: tip1, target: 'tip', href: () => '/admin/log', per: [m.A] }))
  const fine = new Date(Date.now() + 86_400_000)
  await azione('mod_suspend (mai motivo ne\' fine)', () => db.query(SUSPEND, [m.B, m.m3, fine.toISOString(), `${SEGRETO} reason`]), () => ({
    group: `act:mod:suspend:user:${m.m3}`, a: 'mod_suspend', actor: m.B, subject: m.m3, target: 'profile', subjectHandle: 'at_m3',
    href: () => '/admin/log', per: [m.A] }))
  await azione('mod_unsuspend', () => db.query(UNSUSPEND, [m.B, m.m3]), () => ({
    group: `act:mod:unsuspend:user:${m.m3}`, a: 'mod_unsuspend', actor: m.B, subject: m.m3, target: 'profile',
    href: () => '/admin/log', per: [m.A] }))
  const sosp = (await feed(m.A)).find((r) => r.group_key === `act:mod:suspend:user:${m.m3}`)!
  const vs = await renderNotification(m.A, sosp.id)
  check('la sospensione: "at_admin_b suspended at_m3", senza fine ne\' motivo',
    !!vs && notificationText(vs).title === 'at_admin_b suspended at_m3' && !JSON.stringify(vs).includes(SEGRETO) &&
    Object.keys(sosp.data).sort().join(',') === 'a,n', vs ? notificationText(vs).title : 'assente')

  console.log('\n  -- l\'account: handle, poi le cancellazioni')
  await azione('handle_changed', () => db.query(HANDLE, [m.m1, 'at_m1_new']), () => ({
    group: `act:handle:${m.m1}`, a: 'handle_changed', actor: m.m1, subject: m.m1, target: 'profile', subjectHandle: 'at_m1_new',
    href: () => profileHref('at_m1_new') }))
  nomi.set(m.m1, 'at_m1_new')
  // le sole maiuscole sono un cambio anche loro (il confronto e' sul testo): stesso gruppo, n = 2
  await db.query(HANDLE, [m.m1, 'AT_M1_NEW'])
  const h = (await nonLette(m.A))
  const vh = h[0] ? await renderNotification(m.A, h[0].id) : null
  check('handle_changed: anche le sole maiuscole, accorpate (n = 2), con l\'handle di adesso e mai quello vecchio',
    h.length === 1 && h[0].data.n === 2 && vh?.subject_handle === 'AT_M1_NEW' && !JSON.stringify(h).includes('at_m1"') &&
    !JSON.stringify(h[0].data).includes('at_m1'), JSON.stringify({ h, t: vh && notificationText(vh) }))
  nomi.set(m.m1, 'AT_M1_NEW')

  // chi e' sospeso non ha il profilo pubblico (public_profile, 0026: /users/<handle>
  // sarebbe un 404): iscrizione e handle portano alla sua pagina di /admin
  const suoi = async () => Promise.all((await feed(m.A))
    .filter((r) => r.group_key === `act:joined:${m.m1}` || r.group_key === `act:handle:${m.m1}`)
    .map(async (r) => {
      const v = await renderNotification(m.A, r.id)
      return v ? `${v.subject_public}:${notificationHref(v)}` : 'assente'
    }))
  check('prima: iscrizione e handle portano al profilo (subject_public)', (await suoi()).join() ===
    [`true:${profileHref('AT_M1_NEW')}`, `true:${profileHref('AT_M1_NEW')}`].join())
  await db.query(`update app_user set suspended_until = now() + interval '1 day' where id = $1`, [m.m1])
  const fuori = await num('select count(*) from public_profile where id = $1', [m.m1])
  const sospeso = await suoi()
  await db.query(`update app_user set suspended_until = null where id = $1`, [m.m1])
  const riattivato = await suoi()
  check('iscrizione e handle di un sospeso (fuori da public_profile): la sua pagina di /admin, non il profilo',
    fuori === 0 && sospeso.length === 2 && sospeso.every((h) => h === 'false:/admin/users/AT_M1_NEW'), sospeso.join(','))
  check('tolta la sospensione: di nuovo il profilo', riattivato.length === 2 &&
    riattivato.every((h) => h === `true:${profileHref('AT_M1_NEW')}`), riattivato.join(','))

  await azione('tip_deleted', () => db.query(DELETE_TIP, [m.m1, tip1]), () => ({
    group: `act:tip_deleted:${tip1}`, a: 'tip_deleted', actor: m.m1, target: 'tip', content: null,
    extra: { event: m.eventId, tier: m.d.tier }, href: () => '/notifications' }))
  const td = (await nonLette(m.A))[0]
  const vtd = td ? await renderNotification(m.A, td.id) : null
  check('tip cancellata: evento e tier dai dati, il luogo nel testo', vtd?.event_id === m.eventId && vtd.tier_id === m.d.tier &&
    !!vtd.event_name && !!notificationText(vtd).detail, JSON.stringify(vtd && notificationText(vtd)))
  check('tip cancellata: le sue righe di prima se ne sono andate con lei', await num(
    `select count(*) from notification where tip_id = $1`, [tip1]) === 0)
  await azione('clear_deleted (una azione, non i voti e i commenti)', () => db.query(DELETE_CLEAR, [m.m1, clear1]), () => ({
    group: `act:clear_deleted:${clear1}`, a: 'clear_deleted', actor: m.m1, target: 'clear', content: null,
    extra: { event: m.eventId, tier: m.d.tier }, href: () => '/notifications' }))
  const cd = (await nonLette(m.A))[0]
  const vcd = cd ? await renderNotification(m.A, cd.id) : null
  check('clear cancellato: evento e tier dai dati', vcd?.event_id === m.eventId && vcd.tier_id === m.d.tier && !!vcd.event_name,
    JSON.stringify(vcd))
  check('clear cancellato: nel feed resta solo quella riga del clear', (await feed(m.A)).filter((r) =>
    r.group_key.endsWith(clear1)).map((r) => r.group_key).join(',') === `act:clear_deleted:${clear1}`)
}

async function maiASeStessi() {
  console.log('\n  -- mai a se stessi: le azioni di A arrivano a B, non ad A')
  await segnaTutti()
  await clearDi(m.A)
  const cM = await clearDi(m.m3)
  await db.query(VOTE, [m.A, await versione(cM), 1])
  await db.query(COMMENT, [m.A, await versione(cM), 'A moderator comment.'])
  await db.query(HIDE_CLEAR, [m.A, cM, 'hidden'])
  await db.query(HIDE_CLEAR, [m.A, cM, 'published'])
  check('A: nessuna riga per le sue azioni', (await feed(m.A)).every((r) => r.actor_id !== m.A))
  check('A: ma il clear di at_m3 si\'', (await nonLette(m.A)).some((r) => r.group_key === `act:clear_posted:${cM}`))
  const b = (await nonLette(m.B)).filter((r) => r.actor_id === m.A).map((r) => String(r.data.a)).sort()
  check('B: il clear, il voto, il commento e la moderazione di A', b.join(',') ===
    'clear_posted,clear_upvoted,comment_posted,mod_hide,mod_unhide', b.join(','))
}

async function esclusioni() {
  console.log('\n  -- esclusioni: chi e\' segnalato, l\'autore moderato, i ruoli, dts.silent (l\'autore del clear no)')
  await segnaTutti()
  const cB = await clearDi(m.B)
  await db.query(COMMENT, [m.m2, await versione(cB), 'Comment on an admin clear.'])
  // il feed non perde azioni: la push di clear_comment ha i tetti di 0031, quella del feed no
  check('un commento sul clear di B: B riceve clear_comment E la riga del feed', await num(
    `select count(*) from notification where recipient_id = $1 and kind = 'clear_comment' and read_at is null`, [m.B]) === 1 &&
    (await nonLette(m.B)).some((r) => r.group_key === `act:comment:${cB}` && r.actor_id === m.m2 && r.data.a === 'comment_posted'))
  check('ed A riceve il commento nel feed', (await nonLette(m.A)).some((r) => r.group_key === `act:comment:${cB}` && r.actor_id === m.m2))

  await segnaTutti()
  await db.query(REPORT, [m.m2, 'clear', cB, 'spam', null])
  check('una segnalazione su un clear di B: B non riceve niente (ne\' il feed ne\' reports_open)',
    (await nonLette(m.B)).length === 0 && await num(
      `select count(*) from notification where recipient_id = $1 and kind = 'reports_open' and read_at is null`, [m.B]) === 0)
  check('ed A si\'', (await nonLette(m.A)).some((r) => r.group_key === `act:report:clear:${cB}`))

  await segnaTutti()
  await db.query(DISMISS, [m.A, 'clear', cB])
  await db.query(HIDE_CLEAR, [m.A, cB, 'hidden'])
  check('A archivia e nasconde un clear di B: B riceve solo content_hidden, niente feed', (await nonLette(m.B)).length === 0 &&
    await num(`select count(*) from notification where recipient_id = $1 and kind = 'content_hidden' and read_at is null`, [m.B]) === 1)
  check('e A, che ha agito, niente', (await nonLette(m.A)).length === 0)
  await db.query(HIDE_CLEAR, [m.A, cB, 'published'])

  await segnaTutti()
  const f = await foto()
  await db.query(`select set_user_role('at_m2', 'editor')`)
  await db.query(`select set_user_role('at_m2', 'member')`)
  check('set_user_role (lo script) non scrive niente', await foto() === f)

  // come il seed, la fixture e gli import: set local dts.silent = 'on', e commit
  const c = await db.connect()
  try {
    await c.query('begin')
    await c.query(`set local dts.silent = 'on'`)
    const s = (await c.query(SUBMIT, [m.m3, m.d.run, m.d.tier, JSON.stringify(payload(m.d.cards))])).rows[0].id as string
    const vs = (await c.query('select id::text from clear_version where clear_id = $1 and is_current', [s])).rows[0].id
    await c.query(COMMENT, [m.m2, vs, 'Silent comment, committed.'])
    await c.query(VOTE, [m.m2, vs, -1])
    await c.query(POST_TIP, [m.m3, m.eventId, null, 'A silent tip from the import.'])
    await c.query(REPORT, [m.m2, 'clear', s, 'spam', null])
    await c.query(HIDE_CLEAR, [m.B, s, 'hidden'])
    await c.query(HANDLE, [m.m3, 'at_m3_silent'])
    await c.query('commit')
  } catch (e) {
    await c.query('rollback')
    throw e
  } finally {
    c.release()
  }
  nomi.set(m.m3, 'at_m3_silent')
  check('dts.silent: invio, commento, voto, tip, segnalazione, moderazione e handle non scrivono', await foto() === f && await altri() === 0)
}

async function nienteCambia() {
  console.log('\n  -- le scritture che non cambiano niente non scrivono')
  const cX = await clearDi(m.m3)
  const vX = await versione(cX)
  const tX = await id(POST_TIP, [m.m3, m.eventId, null, 'Bring a strong healer for phase two.'])
  await db.query(VOTE, [m.m2, vX, 1])
  await db.query(VOTE_TIP, [m.m2, tX, 1])
  await db.query(REPORT, [m.m2, 'clear', cX, 'spam', null])
  await segnaTutti()
  const f = await foto()
  const prove: [string, () => Promise<unknown>][] = [
    ['lo stesso voto due volte', () => db.query(VOTE, [m.m2, vX, 1])],
    ['ritirare un voto che non c\'e\'', () => db.query(VOTE, [m.m4, vX, 0])],
    ['Helpful due volte', () => db.query(VOTE_TIP, [m.m2, tX, 1])],
    ['ritirare un Helpful che non c\'e\'', () => db.query(VOTE_TIP, [m.m4, tX, 0])],
    ['una modifica identica della tip', () => db.query(EDIT_TIP, [m.m3, tX, 'Bring a strong healer for phase two.'])],
    ['la stessa segnalazione ancora aperta', () => db.query(REPORT, [m.m2, 'clear', cX, 'spam', null])],
    ['rimostrare un clear gia\' pubblicato', () => db.query(HIDE_CLEAR, [m.B, cX, 'published'])],
    ['archiviare senza segnalazioni aperte', () => db.query(DISMISS, [m.B, 'tip', tX])],
    ['riattivare chi non e\' sospeso', () => db.query(UNSUSPEND, [m.B, m.m4])],
  ]
  for (const [nome, fare] of prove) {
    await fare()
    check(`${nome}: niente`, await foto() === f)
  }
  check('votare il proprio clear: rifiutato, e niente', await esito(VOTE, [m.m3, vX, 1]) === '42501 builder_own_vote' && await foto() === f)
}

async function accorpamento() {
  console.log('\n  -- l\'accorpamento: un gruppo per azione e bersaglio finche\' non e\' letta')
  const cY = await clearDi(m.m3)
  const vY = await versione(cY)
  await segnaTutti()
  await db.query(VOTE, [m.m2, vY, 1])
  await db.query(VOTE, [m.m4, vY, 1])
  let g = (await feed(m.A)).filter((r) => r.group_key === `act:clear_vote:${cY}`)
  const v = g[0] ? await renderNotification(m.A, g[0].id) : null
  check('due voti di due persone: una riga, n = 2, l\'ultimo attore', g.length === 1 && g[0].data.n === 2 && g[0].actor_id === m.m4 &&
    g[0].data.a === 'clear_upvoted' && v?.n === 2, JSON.stringify(g))
  check('il testo: "2 vote changes on a clear", l\'ultimo nella riga sotto', !!v && notificationText(v).title === '2 vote changes on a clear' &&
    !!notificationText(v).detail?.endsWith('latest: at_m4 upvoted'), JSON.stringify(v && notificationText(v)))
  await db.query(MARK, [m.A])
  await db.query(VOTE, [m.m2, vY, -1])
  g = (await feed(m.A)).filter((r) => r.group_key === `act:clear_vote:${cY}`)
  check('dopo la lettura il voto dopo apre una riga nuova', g.length === 2 && g[0].read_at === null && g[0].data.n === 1 &&
    g[0].data.a === 'clear_downvoted' && g[1].read_at !== null, JSON.stringify(g.map((r) => [r.data, r.read_at])))
  const b = (await feed(m.B)).filter((r) => r.group_key === `act:clear_vote:${cY}` && r.read_at === null)
  check('B, che non ha letto, ha ancora una riga sola con n = 3', b.length === 1 && b[0].data.n === 3, JSON.stringify(b))
  return { cY, vY }
}

async function rollback() {
  console.log('\n  -- il rollback della scrittura porta via anche la riga')
  const cR = await clearDi(m.m3)
  const vR = await versione(cR)
  await segnaTutti()
  const f = await foto()
  const last = await one<{ l: Date | null }>('select notif_last_at as l from app_user where id = $1', [m.A])
  const c = await db.connect()
  try {
    await c.query('begin')
    await c.query(COMMENT, [m.m2, vR, 'Comment that rolls back.'])
    await c.query(VOTE, [m.m2, vR, 1])
    const dentro = Number((await c.query(
      `select count(*) from notification where kind = 'site_activity' and recipient_id = $1 and read_at is null`, [m.A])).rows[0].count)
    check('dentro la transazione le righe ci sono', dentro === 2, String(dentro))
    await c.query('rollback')
  } finally {
    c.release()
  }
  check('dopo il rollback: niente, e il pallino non si e\' mosso', await foto() === f &&
    (await one<{ l: Date | null }>('select notif_last_at as l from app_user where id = $1', [m.A])).l?.getTime() === last.l?.getTime())
  check('delete_account con l\'handle sbagliato: rifiutato, e nessun "account deleted"',
    await esito(DELETE_ACCOUNT, [m.m4, 'not_my_handle']) === '23514 account_handle_mismatch' && await foto() === f)
}

async function limitePerFamiglia() {
  console.log('\n  -- il limite vale per famiglia: il feed non spinge fuori le notifiche personali')
  const cA = await clearDi(m.A)
  await db.query(COMMENT, [m.m2, await versione(cA), 'A personal comment for the admin.'])
  const personale = await one<{ id: string }>(
    `select id::text from notification where recipient_id = $1 and kind = 'clear_comment' and clear_id = $2`, [m.A, cA])
  // 60 gruppi del feed, tutti piu' recenti del commento
  await db.query(
    `insert into notification (recipient_id, kind, group_key, data, created_at, updated_at)
     select $1, 'site_activity', 'act:prova:' || i, '{"a": "account_deleted", "n": 1}'::jsonb,
            clock_timestamp() + make_interval(secs => i), clock_timestamp() + make_interval(secs => i)
       from generate_series(1, 60) i`, [m.A])
  const lista = await q<{ id: string; kind: string }>('select id::text, kind from notification_list($1::uuid, 50)', [m.A])
  check('notification_list(50): il commento personale c\'e\' ancora, e 50 righe del feed',
    lista.some((r) => r.id === personale.id) && lista.filter((r) => r.kind === 'site_activity').length === 50,
    `${lista.length} righe, ${lista.filter((r) => r.kind === 'site_activity').length} del feed`)
  const app = await listNotifications(m.A)
  check('anche dalla lista dell\'app (lib/notify/queries.ts)', app.some((r) => r.id === personale.id))
  check('notification_render e notification_list portano action e subject_handle (select * dopo alter type)',
    app.every((r) => 'action' in r && 'subject_handle' in r) && app.find((r) => r.id === personale.id)?.action === null)

  console.log('\n  -- aprire la lista con piu\' di LIST_LIMIT gruppi non letti spegne il pallino (mark_list_read)')
  // e 55 personali (gruppi finti), tutte non lette; poi tutto un'ora
  // indietro, cosi' un'azione vera di adesso e' la piu' recente
  await db.query(
    `insert into notification (recipient_id, kind, group_key, created_at, updated_at)
     select $1, 'suspension_lifted', 'prova:' || i, clock_timestamp() + make_interval(secs => i), clock_timestamp() + make_interval(secs => i)
       from generate_series(1, 55) i`, [m.A])
  await db.query(`update notification set created_at = created_at - interval '1 hour', updated_at = updated_at - interval '1 hour'
                   where recipient_id = $1 and read_at is null`, [m.A])
  // come notify_upsert e activity_upsert: il pallino acceso
  await db.query('update app_user set notif_last_at = clock_timestamp() where id = $1', [m.A])
  const nonLetteA = () => num('select count(*) from notification where recipient_id = $1 and read_at is null', [m.A])
  const prima = await nonLetteA()
  const mostrate = await listNotifications(m.A)
  check('prima: piu\' di LIST_LIMIT non lette in ogni famiglia, il pallino acceso, la lista ne mostra LIST_LIMIT per famiglia',
    prima > 2 * LIST_LIMIT && await pallino(m.A) && mostrate.length === 2 * LIST_LIMIT, `${prima} non lette, ${mostrate.length} mostrate`)
  // la pagina: la lista, poi markListRead sulle non lette mostrate. In
  // mezzo arriva un'azione vera, che la lista non ha mostrato
  // le azioni del feed non lette che la lista non ha mostrato: quella mostrata e
  // scivolata oltre il limite per l'azione vera qui sotto conta come mostrata
  const feedNonLette = await num(`select coalesce(sum((data ->> 'n')::int), 0) from notification
                                   where recipient_id = $1 and kind = 'site_activity' and read_at is null`, [m.A])
  const feedMostrate = mostrate.filter((r) => r.kind === 'site_activity' && r.read_at === null).reduce((s, r) => s + r.n, 0)
  const cNuovo = await clearDi(m.m3)
  const v1 = await markListRead(m.A, mostrate.filter((r) => r.read_at === null).map((r) => r.id))
  const restano = await q<{ group_key: string }>('select group_key from notification where recipient_id = $1 and read_at is null', [m.A])
  check('la prima visita: lette le mostrate e quelle oltre il limite; resta solo quella arrivata dopo, e il pallino',
    restano.length === 1 && restano[0].group_key === `act:clear_posted:${cNuovo}` && v1.unread && v1.marked === prima,
    JSON.stringify({ restano, v1, prima }))
  check('mark_list_read dice quante azioni del feed ha segnato lette senza mostrarle (la pagina lo scrive)',
    feedNonLette - feedMostrate >= 10 && v1.unseenActions === feedNonLette - feedMostrate,
    JSON.stringify({ feedNonLette, feedMostrate, v1 }))
  const v2 = await markListRead(m.A, (await listNotifications(m.A)).filter((r) => r.read_at === null).map((r) => r.id))
  check('la visita dopo: nessuna non letta, nessuna azione saltata, e il pallino spento (notif_seen_at >= notif_last_at)',
    v2.marked === 1 && v2.unseenActions === 0 && !v2.unread && await nonLetteA() === 0 && !(await pallino(m.A)), JSON.stringify(v2))
  check('markListRead non tocca le notifiche degli altri', (await nonLette(m.B)).some((r) => r.group_key === `act:clear_posted:${cNuovo}`))
  await db.query(`delete from notification where group_key like 'act:prova:%' or group_key like 'prova:%'`)
}

const chiavi = () => {
  const e = createECDH('prime256v1')
  e.generateKeys()
  return { p256dh: e.getPublicKey('base64url'), auth: randomBytes(16).toString('base64url') }
}
async function dispositivo(u: string) {
  const k = chiavi()
  await db.query('select push_subscribe($1::uuid, $2, $3, $4, $5)',
    [u, `https://fcm.googleapis.com/fcm/send/${P}-${randomBytes(8).toString('hex')}`, k.p256dh, k.auth, 'Chrome on Android'])
}

async function push(y: { cY: string; vY: string }) {
  console.log('\n  -- push_claim: una push per azione dal giro dopo la scrittura (lo stesso tag), niente tetti, mai chi segnala')
  const D = await persona('at_admin_d', true)
  const E = await persona('at_admin_e', true)
  await db.query(FEED, [D, true])
  await db.query(PREF, [E, 'site_activity', 'list', true])
  iscritti.add(D)
  iscritti.add(E)
  await dispositivo(D)
  await dispositivo(E)
  const miei = async () => (await q<Job>(CLAIM)).filter((j) => j.recipient_id === D || j.recipient_id === E)
  const inviate = (u: string) => num('select count(*) from push_sent where recipient_id = $1', [u])
  await miei()

  const cZ = await clearDi(m.m5)
  const vZ = await versione(cZ)
  await miei()   // il clear nuovo: gia' partito
  await db.query(VOTE, [m.m2, vZ, 1])
  let j = await miei()
  check('un voto: una push a D, con il testo minimo', j.length === 1 && j[0].recipient_id === D && j[0].kind === 'site_activity' &&
    j[0].action === 'clear_upvoted' && pushText(j[0]).title === 'at_m2 upvoted a clear', JSON.stringify(j.map((x) => [x.action, pushText(x)])))
  check('E ha la riga ma non la push (solo la lista accesa)', (await nonLette(E)).some((r) => r.group_key === `act:clear_vote:${cZ}`) &&
    !j.some((x) => x.recipient_id === E))
  check('nessuna riga in push_sent per il feed', await inviate(D) === 0)
  check('un account di meno di 24 ore fa partire lo stesso la push del feed', await num(
    `select count(*) from app_user where id = $1 and created_at > now() - interval '24 hours'`, [m.m2]) === 1 && j.length === 1)

  /** Il tempo che passa per una riga non letta di D: pushed_at e updated_at indietro di secs. */
  const indietro = (gruppo: string, secs: number) => db.query(
    `update notification set pushed_at = pushed_at - make_interval(secs => $3),
            updated_at = updated_at - make_interval(secs => $3)
      where recipient_id = $1 and group_key = $2 and read_at is null`, [D, gruppo, secs])
  const gZ = `act:clear_vote:${cZ}`
  const caps = await one<{ h: number }>('select pending_hours as h from activity_push_caps()')
  check('il tetto del feed: il resto di un giro non riuscito aspetta fino a un giorno', caps.h === 24, JSON.stringify(caps))
  // un'azione dopo l'altra sullo stesso gruppo, ognuna col suo giro (come kickPush): nessuna aspetta
  await db.query(VOTE, [m.m4, vZ, 1])
  j = await miei()
  check('un secondo voto subito dopo: la sua push parte subito, col totale e l\'ultimo, nello stesso gruppo', j.length === 1 &&
    j[0].recipient_id === D && j[0].n === 2 && j[0].group_key === gZ && pushText(j[0]).title === '2 vote changes on a clear' &&
    pushText(j[0]).body.endsWith('latest: at_m4 upvoted'), JSON.stringify(j.map((x) => pushText(x))))
  check('e senza novita\' non riparte', (await miei()).length === 0)
  await db.query(VOTE, [m.m4, vZ, -1])
  j = await miei()
  check('il voto cambiato: parte subito anche lui', j.length === 1 && j[0].n === 3 && j[0].action === 'clear_downvoted',
    JSON.stringify(j.map((x) => [x.n, x.action])))

  // un giro che non riesce (un errore nell'after()): il resto lo prende il primo
  // giro dopo, anche oltre i 10 minuti freschi, fino a un giorno
  await db.query(VOTE, [m.m4, vZ, 0])
  await indietro(gZ, 15 * 60)
  j = await miei()
  check('un resto toccato 15 minuti fa, il cui giro non e\' partito: parte col primo giro dopo', j.length === 1 && j[0].n === 4 &&
    j[0].action === 'clear_unvoted', JSON.stringify(j.map((x) => [x.n, x.action])))
  await db.query(VOTE, [m.m4, vZ, 1])
  await indietro(gZ, 25 * 3600)
  check('un resto di un giro non riuscito piu\' di un giorno fa: non parte piu\' (resta nella lista)', (await miei()).length === 0)
  await db.query(VOTE, [m.m4, vZ, -1])
  j = await miei()
  check('la stessa riga toccata di nuovo adesso: riparte subito, col totale', j.length === 1 && j[0].n === 6 &&
    j[0].action === 'clear_downvoted', JSON.stringify(j.map((x) => [x.n, x.action])))

  // la PRIMA push di un'azione persa (il giro dopo la scrittura non e' partito,
  // pushed_at resta null): la prende il primo giro dopo, anche oltre i 10 minuti
  // freschi e fino a un giorno, se all'azione la push e il dispositivo c'erano
  // gia'. Qui la push e il dispositivo di D sono di due giorni fa.
  const prefD = (await one<{ k: string }>(`select string_agg(kind || ':' || channel, ',' order by kind, channel) as k
                                            from notification_pref where user_id = $1`, [D])).k
  await db.query(PREF, [D, 'suspension_lifted', 'push', true])
  await db.query(`update notification_pref set created_at = created_at - interval '2 days' where user_id = $1`, [D])
  await db.query(`update push_subscription set created_at = created_at - interval '2 days' where user_id = $1`, [D])
  /** Un'azione che nessun giro ha visto: la riga, mai mandata, indietro di secs. */
  const persa = (u: string, gruppo: string, secs: number) => db.query(
    `update notification set created_at = created_at - make_interval(secs => $3), updated_at = updated_at - make_interval(secs => $3)
      where recipient_id = $1 and group_key = $2 and read_at is null and pushed_at is null`, [u, gruppo, secs])
  // un autore suo: m5 ha gia' i suoi clear dell'ora (note_clear_write ne tiene 10)
  const m7 = await persona('at_m7')
  const cP = await clearDi(m7)
  const gP = `act:clear_posted:${cP}`
  await persa(D, gP, 15 * 60)
  await persa(E, gP, 15 * 60)
  // un altro tipo, mai mandato, della stessa eta': resta alla finestra dei 10 minuti
  await db.query(`insert into notification (recipient_id, kind, group_key, created_at, updated_at)
                  values ($1, 'suspension_lifted', 'prova:persa', now() - interval '15 minutes', now() - interval '15 minutes')`, [D])
  // E accende la push del feed solo adesso, dopo l'azione (il dispositivo ce l'ha)
  await db.query(PREF, [E, 'site_activity', 'push', true])
  j = await miei()
  check('una prima push persa 15 minuti fa: parte col primo giro dopo', j.some((x) => x.recipient_id === D && x.group_key === gP &&
    x.action === 'clear_posted' && x.n === 1 && pushText(x).title === 'at_m7 posted a clear'), JSON.stringify(j.map((x) => [x.kind, x.group_key, x.n])))
  check('gli altri tipi non cambiano: una suspension_lifted mai mandata di 15 minuti fa non parte', !j.some((x) => x.kind === 'suspension_lifted') &&
    await num(`select count(*) from notification where recipient_id = $1 and group_key = 'prova:persa' and pushed_at is null`, [D]) === 1)
  check('non a chi ha acceso la push dopo l\'azione (E): quel giro non l\'avrebbe mandata, niente arretrati',
    !j.some((x) => x.recipient_id === E && x.group_key === gP))
  // e a chi ha la push da prima ma il dispositivo nuovo, iscritto dopo l'azione
  await db.query(`update notification_pref set created_at = created_at - interval '2 days' where user_id = $1`, [E])
  const jE = await miei()
  check('ne\' se il dispositivo e\' arrivato dopo l\'azione', !jE.some((x) => x.recipient_id === E && x.group_key === gP) && await num(
    `select count(*) from notification where recipient_id = $1 and group_key = $2 and pushed_at is null`, [E, gP]) === 1)
  check('la push persa parte una volta sola', !jE.some((x) => x.group_key === gP))
  await db.query(PREF, [E, 'site_activity', 'push', false])
  const cQ = await clearDi(m7)
  await persa(D, `act:clear_posted:${cQ}`, 25 * 3600)
  check('una prima push persa piu\' di un giorno fa: non parte piu\' (resta nella lista)', (await miei()).length === 0 &&
    (await nonLette(D)).some((r) => r.group_key === `act:clear_posted:${cQ}`))
  await db.query(PREF, [D, 'suspension_lifted', 'push', false])
  await db.query(`delete from notification where recipient_id = $1 and group_key = 'prova:persa'`, [D])
  check('le preferenze di D come prima', (await one<{ k: string }>(`select string_agg(kind || ':' || channel, ',' order by kind, channel) as k
                                                                    from notification_pref where user_id = $1`, [D])).k === prefD)

  // trenta cambi di voto di un membro, uno dopo l'altro, con un giro dopo ognuno (come kickPush)
  const cF = await clearDi(m.m5)
  const vF = await versione(cF)
  await miei()   // il clear nuovo
  const raffica: Job[] = []
  for (let i = 0; i < 30; i++) {
    await db.query(VOTE, [m.m2, vF, i % 2 === 0 ? 1 : 0])
    raffica.push(...(await miei()).filter((x) => x.recipient_id === D))
  }
  check('30 cambi di voto di fila sullo stesso clear: 30 push a D, una per azione, ognuna col totale fin li\' e la sua azione',
    raffica.length === 30 && raffica.every((x, i) => x.n === i + 1 && x.action === (i % 2 === 0 ? 'clear_upvoted' : 'clear_unvoted')),
    JSON.stringify(raffica.map((x) => [x.n, x.action])))
  check('tutte con lo stesso tag e lo stesso Topic: sul dispositivo resta una notifica, l\'ultima',
    new Set(raffica.map((x) => `${pushTag(x.group_key)}|${pushTopic(x.group_key)}`)).size === 1 &&
    raffica[29]?.group_key === `act:clear_vote:${cF}` && pushText(raffica[29]).title === '30 vote changes on a clear' &&
    pushText(raffica[29]).body.endsWith('latest: at_m2 took back a vote'), JSON.stringify(raffica[29] && pushText(raffica[29])))
  check('e dopo la raffica non resta niente da mandare', (await miei()).length === 0)

  await db.query(
    `insert into push_sent (recipient_id, actor_id) select $1, null from generate_series(1, (select recipient_day from push_caps()))`, [D])
  await db.query(VOTE, [m.m2, y.vY, 0])
  j = await miei()
  check('con le 20 push del giorno gia\' usate da altri tipi, il feed parte lo stesso', j.length === 1 && j[0].action === 'clear_unvoted' &&
    await inviate(D) === 20, JSON.stringify(j.map((x) => x.action)))

  await db.query(REPORT, [m.m4, 'clear', cZ, 'other', `${SEGRETO} push details`])
  j = await miei()
  const r = j.find((x) => x.action === 'report')
  check('una segnalazione: la push non dice chi l\'ha mandata, ne\' i dettagli', !!r && r.actor_handle === null &&
    !JSON.stringify(pushText(r)).includes('at_m4') && !JSON.stringify(j).includes(SEGRETO), JSON.stringify(r && pushText(r)))

  const tutti = await q<Job>(`select * from push_claim(100)`)
  check('i testi del feed non portano mai il testo dei post', !JSON.stringify(tutti).includes(SEGRETO))
  return { D, E }
}

async function digest(x: { D: string }) {
  console.log('\n  -- digest_due: il feed non va mai per email')
  await db.query('update app_user set email_verified = true where id = $1', [x.D])
  await db.query('select set_email_digest($1::uuid, true)', [x.D])
  await new Promise((r) => setTimeout(r, 5))
  const cW = await clearDi(m.m5)
  await db.query(VOTE, [m.m2, await versione(cW), 1])
  const due = async () => (await q<{ user_id: string; items: { kind: string }[] }>(
    'select user_id::text, items from digest_due(100, clock_timestamp())')).find((r) => r.user_id === x.D)
  check('un admin con solo righe del feed: nessun digest', (await nonLette(x.D)).length > 0 && (await due()) === undefined)
  const cD = await clearDi(x.D)
  await db.query(COMMENT, [m.m2, await versione(cD), 'A comment for the admin digest.'])
  const d = await due()
  check('con un commento sul suo clear: il digest c\'e\', e solo con quello', !!d && d.items.length === 1 &&
    d.items.every((i) => i.kind === 'clear_comment'), JSON.stringify(d?.items))
  await db.query('select set_email_digest($1::uuid, false)', [x.D])
}

async function cascate() {
  console.log('\n  -- le cascate: una cancellazione e\' una azione sola')
  const cW = await clearDi(m.m5)
  const vW = await versione(cW)
  await db.query(VOTE, [m.m2, vW, 1])
  await db.query(COMMENT, [m.m4, vW, 'Comment on a clear that goes away.'])
  await segnaTutti()
  await db.query(DELETE_CLEAR, [m.m5, cW])
  for (const u of iscritti) {
    const r = await nonLette(u)
    check(`delete_clear con voti e commenti: a ${nomi.get(u)} solo clear_deleted`, r.length === 1 && r[0].data.a === 'clear_deleted' &&
      r[0].group_key === `act:clear_deleted:${cW}`, JSON.stringify(r.map((x) => x.group_key)))
  }
  check('le righe di prima su quel clear (inviato, voto, commento) se ne sono andate', await num(
    `select count(*) from notification where kind = 'site_activity' and group_key like $1 and group_key <> $2`,
    [`%${cW}`, `act:clear_deleted:${cW}`]) === 0)

  const tW = await id(POST_TIP, [m.m3, m.eventId, null, 'A tip that an import removes.'])
  await segnaTutti()
  const f = await foto()
  // come la cascata di un import che toglie un tier: nessuna azione di un utente
  await db.query('delete from tip where id = $1', [tW])
  check('una tip tolta dal database (un import): nessuna riga nuova', await foto() !== f &&
    (await Promise.all([...iscritti].map((u) => nonLette(u)))).every((r) => r.length === 0) &&
    await num('select count(*) from notification where tip_id = $1', [tW]) === 0)

  console.log('\n  -- delete_account: una riga sola, e nessun handle resta')
  // m1 ha un clear, una tip, un commento e un voto sui clear di altri, e righe su di se'
  const c2 = await clearDi(m.m1)
  await db.query(COMMENT, [m.m2, await versione(c2), `${SEGRETO} on the clear of m1`])
  await db.query(POST_TIP, [m.m1, m.eventId, null, `${SEGRETO} last tip of m1`])
  const cZ = await clearDi(m.m5)
  await db.query(COMMENT, [m.m1, await versione(cZ), `${SEGRETO} m1 comments`])
  await db.query(VOTE, [m.m1, await versione(cZ), 1])
  check('prima: m1 e\' attore e soggetto di righe del feed', await num(
    `select count(*) from notification where kind = 'site_activity' and (actor_id = $1 or subject_id = $1)`, [m.m1]) > 0 &&
    await num(`select count(*) from notification where group_key in ($1, $2)`, [`act:joined:${m.m1}`, `act:handle:${m.m1}`]) > 0)
  await segnaTutti()
  const handle = nomi.get(m.m1)!
  await db.query(DELETE_ACCOUNT, [m.m1, handle])
  for (const u of iscritti) {
    const r = await nonLette(u)
    const v = r[0] ? await renderNotification(u, r[0].id) : null
    check(`a ${nomi.get(u)}: solo "An account was deleted", senza attore ne' riferimenti`, r.length === 1 &&
      r[0].group_key === 'act:account_deleted' && r[0].data.a === 'account_deleted' && r[0].actor_id === null &&
      r[0].clear_id === null && r[0].tip_id === null && r[0].subject_id === null && !!v && v.target === 'none' &&
      notificationText(v).title === 'An account was deleted' && notificationHref(v) === '/notifications',
    JSON.stringify(r.map((x) => x.group_key)))
  }
  check('nessuna riga ha piu\' m1 come attore o soggetto', await num(
    `select count(*) from notification where actor_id = $1 or subject_id = $1`, [m.m1]) === 0)
  check('le righe su di lui (iscrizione, handle) se ne sono andate', await num(
    `select count(*) from notification where group_key in ($1, $2)`, [`act:joined:${m.m1}`, `act:handle:${m.m1}`]) === 0)
  const tracce = await num(
    `select count(*) from notification where group_key ilike $1 or data::text ilike $1 or group_key ilike $2 or data::text ilike $2`,
    ['%at_m1%', `%${SEGRETO}%`])
  check('nessun group_key o data contiene il suo handle (vecchio o nuovo) o il testo dei post', tracce === 0, String(tracce))
  check('data del feed: solo a, n, event e tier, in ogni riga', await num(
    `select count(*) from notification where kind = 'site_activity' and (data - 'a' - 'n' - 'event' - 'tier') <> '{}'::jsonb`) === 0)
  const viste = JSON.stringify(await Promise.all([...iscritti].map((u) => listNotifications(u))))
  check('e nemmeno la lista che gli admin leggono', !/at_m1/i.test(viste) && !viste.includes(SEGRETO))

  // un secondo account: lo stesso gruppo, n = 2, ancora senza nomi
  await db.query(DELETE_ACCOUNT, [m.m4, 'at_m4'])
  const g = (await nonLette(m.A))
  const v = g[0] ? await renderNotification(m.A, g[0].id) : null
  check('due account cancellati: una riga, "2 accounts were deleted"', g.length === 1 && g[0].data.n === 2 && !!v &&
    notificationText(v).title === '2 accounts were deleted', JSON.stringify(g))
}

async function nonPiuAdmin() {
  console.log('\n  -- chi smette di essere admin perde il consenso e le righe del feed (activity_role_lost)')
  const prefs = async (u: string) => (await q<{ k: string }>(
    `select kind || ':' || channel as k from notification_pref where user_id = $1 order by kind, channel`, [u])).map((r) => r.k).join(',')
  await segnaTutti()
  await db.query(PREF, [m.A, 'reports_open', 'push', true])
  const cA = await clearDi(m.A)
  // un commento sul clear di A: clear_comment (personale, resta) e la riga del feed
  await db.query(COMMENT, [m.m2, await versione(cA), 'A comment that stays in the personal list.'])
  await clearDi(m.m5)
  check('prima: A ha il feed (lista e push), la push delle segnalazioni, righe del feed non lette e il pallino',
    await prefs(m.A) === 'reports_open:push,site_activity:list,site_activity:push' && (await nonLette(m.A)).length === 2 &&
    (await feed(m.A)).length > 2 && await pallino(m.A), await prefs(m.A))

  await db.query(`select set_user_role('at_admin_a', 'member')`)
  check('tornato membro: nessuna preferenza del feed; la push di reports_open resta, come in 0028 e 0031',
    await prefs(m.A) === 'reports_open:push', await prefs(m.A))
  check('nessuna riga del feed, lette o no; la sua clear_comment resta', (await feed(m.A)).length === 0 && await num(
    `select count(*) from notification where recipient_id = $1 and kind = 'clear_comment' and clear_id = $2`, [m.A, cA]) === 1)
  const vista = await markListRead(m.A, (await listNotifications(m.A)).filter((r) => r.read_at === null).map((r) => r.id))
  check('la visita dopo spegne il pallino', !vista.unread && !(await pallino(m.A)), JSON.stringify(vista))
  const c = await clearDi(m.m5)
  check('un clear nuovo: niente ad A, a B si\'', (await feed(m.A)).length === 0 &&
    (await nonLette(m.B)).some((x) => x.group_key === `act:clear_posted:${c}`))
  check('e non puo\' riaccenderlo', await esito(FEED, [m.A, true]) === '42501 notification_pref_admin_only' &&
    await esito(PREF, [m.A, 'reports_open', 'push', true]) === '42501 notification_pref_admin_only')
  check('spegnerlo invece si\' (non resta niente da togliere)', await esito(FEED, [m.A, false]) === 'ok' &&
    await prefs(m.A) === 'reports_open:push')

  await db.query(`select set_user_role('at_admin_a', 'admin')`)
  const c2 = await clearDi(m.m5)
  check('tornato admin: il feed resta spento finche\' non lo riaccende lui; le push delle segnalazioni ripartono da sole',
    (await feed(m.A)).length === 0 && await prefs(m.A) === 'reports_open:push', await prefs(m.A))
  await db.query(FEED, [m.A, true])
  const c3 = await clearDi(m.m5)
  check('riacceso: arrivano solo le azioni dopo', (await nonLette(m.A)).some((x) => x.group_key === `act:clear_posted:${c3}`) &&
    !(await feed(m.A)).some((x) => x.group_key === `act:clear_posted:${c2}`))

  const m3 = nomi.get(m.m3)!
  await db.query(PREF, [m.m3, 'clear_comment', 'push', true])
  await db.query('select set_user_role($1::citext, $2)', [m3, 'editor'])
  await db.query('select set_user_role($1::citext, $2)', [m3, 'member'])
  check('un cambio di ruolo fra membro ed editor non tocca le preferenze', await prefs(m.m3) === 'clear_comment:push', await prefs(m.m3))
}

/**
 * La gara: una segnalazione mentre un admin col feed viene retrocesso.
 * notify_report sceglie gli admin senza lock; la retrocessione tiene la
 * riga dell'admin fino al commit, la segnalazione la aspetta (il pallino
 * di reports_open) e poi activity_upsert deve vedere il ruolo nuovo.
 */
async function garaRetrocessione() {
  console.log('\n  -- una segnalazione nello stesso istante di una retrocessione: nessuna riga del feed resta')
  const F = await persona('at_admin_f', true)
  const m6 = await persona('at_m6')
  await db.query(FEED, [F, true])
  const c = await clearDi(m6)
  await db.query(MARK, [F])
  const rigaF = () => num(`select count(*) from notification where recipient_id = $1 and kind = 'site_activity'`, [F])
  const a = await db.connect()
  const b = await db.connect()
  try {
    await a.query('begin')
    await a.query(`update app_user set role = 'member' where id = $1`, [F])
    const pid = (await b.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid
    const segnala = b.query(REPORT, [m.m3, 'clear', c, 'spam', null])
    let ferma = false
    for (let i = 0; i < 200 && !ferma; i++) {
      ferma = (await one<{ w: boolean }>(`select coalesce(wait_event_type = 'Lock', false) as w from pg_stat_activity where pid = $1`, [pid]))?.w === true
      if (!ferma) await new Promise((r) => setTimeout(r, 10))
    }
    check('la segnalazione aspetta la riga dell\'admin che si sta retrocedendo', ferma)
    await a.query('commit')
    await segnala
  } catch (e) {
    await a.query('rollback').catch(() => {})
    throw e
  } finally {
    a.release()
    b.release()
  }
  check('la segnalazione e\' passata, e gli admin col feed la vedono', await num(
    `select count(*) from report where target_id = $1 and status = 'open'`, [c]) === 1 &&
    (await nonLette(m.B)).some((r) => r.group_key === `act:report:clear:${c}`))
  check('al retrocesso: nessuna riga del feed e nessuna preferenza del feed', await rigaF() === 0 && await num(
    `select count(*) from notification_pref where user_id = $1 and kind = 'site_activity'`, [F]) === 0)
  await db.query(`update app_user set role = 'admin' where id = $1`, [F])
  check('tornato admin senza riaccenderlo: niente del feed nella lista', await rigaF() === 0 &&
    (await listNotifications(F)).every((r) => r.kind !== 'site_activity'))
}

async function pulizia() {
  const nostri = `(select id from app_user where email like $1)`
  await db.query(`delete from clear where author_id in ${nostri}`, [`${P}+%@example.invalid`])
  await db.query('delete from app_user where email like $1', [`${P}+%@example.invalid`])
}

try {
  await pulizia()
  const d = await datiMinimi()
  m = {
    d, eventId: (await one<{ e: string }>('select event_id::text as e from event_run where id = $1', [d.run])).e,
    A: await persona('at_admin_a', true), B: await persona('at_admin_b', true), C: await persona('at_admin_c', true),
    m1: '', m2: await persona('at_m2'), m3: await persona('at_m3'), m4: await persona('at_m4'), m5: await persona('at_m5'),
  }
  await regole()
  await preferenze()
  await spentoPerDifetto()
  await azioni()
  await maiASeStessi()
  await esclusioni()
  await nienteCambia()
  const y = await accorpamento()
  await rollback()
  await limitePerFamiglia()
  const x = await push(y)
  await digest(x)
  await cascate()
  await nonPiuAdmin()
  await garaRetrocessione()
} finally {
  await pulizia()
  check('nessun utente di prova resta', await num('select count(*) from app_user where email like $1', [`${P}+%@example.invalid`]) === 0)
  await db.end()
}

console.log(`\n  ${stato.passes} PASS, ${stato.fails} FAIL`)
process.exit(stato.fails ? 1 : 0)
