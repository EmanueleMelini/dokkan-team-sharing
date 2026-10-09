// Verifica il lato app delle notifiche (fase 2): lib/notify/kinds.ts
// uguale a notification_kinds() e ai check delle tabelle, il pallino
// (hasUnread, viewerUserOf), gli href e i testi della lista
// (lib/notify/vista.ts) su righe vere di notification_list, le letture e
// la scrittura di lib/notify/queries.ts, i giorni della privacy uguali a
// purge_notifications, e le guardie sui file (robots, pagina per utente,
// niente prefetch, niente pallino nell'HTML del server).
//
// Gira sul database di test (npm run db:test). Crea solo utenti
// notifapp+...@example.invalid e li toglie alla fine, anche se qualcosa
// fallisce.
import { readFileSync } from 'node:fs'
import { db } from '@/lib/db'
import type { CurrentUser } from '@/lib/dal'
import { LEGALE } from '@/lib/legale'
import { NOTIFICATION_KINDS, hasUnread, isNotificationKind, type NotificationRow } from '@/lib/notify/kinds'
import { listNotifications, markNotificationsRead, markRead, renderNotification } from '@/lib/notify/queries'
import { notificationHref, notificationLink, notificationPlace, notificationText } from '@/lib/notify/vista'
import { clearAnchor, editClearHref, eventHref } from '@/lib/urls'
import { viewerUserOf } from '@/lib/viewer/utente'
import { SUBMIT, check, dati, guardia, num, one, payload, q, stato, utente } from '@/db/test/builder-helpers'

guardia()
const P = 'notifapp'
const SEGRETO = 'SEGRETO-testo-del-post-7f3a'

const COMMENT = 'select comment_clear_version($1::uuid, $2::uuid, $3) as id'
const REPORT = 'select report_content($1::uuid, $2, $3::uuid, $4, $5) as id'
const HIDE_CLEAR = 'select mod_set_clear_status($1::uuid, $2::uuid, $3, null) as n'
const SUSPEND = 'select mod_suspend_user($1::uuid, $2::uuid, $3::timestamptz, $4) as until'
const UNSUSPEND = 'select mod_unsuspend_user($1::uuid, $2::uuid, null) as ok'

const file = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8')
const senzaTrattini = (s: string) => !/[–—]/.test(s)

async function tipi() {
  console.log('\n  -- lib/notify/kinds.ts e il database')
  const sql = (await one<{ k: string[] }>('select notification_kinds() as k')).k
  check('NOTIFICATION_KINDS uguale a notification_kinds(), nello stesso ordine',
    sql.join(',') === NOTIFICATION_KINDS.join(','), `${sql.join(',')} / ${NOTIFICATION_KINDS.join(',')}`)
  for (const [tab, nome] of [['notification', 'notification_kind_check'], ['notification_pref', 'notification_pref_kind_check']]) {
    const def = (await one<{ d: string }>(
      'select pg_get_constraintdef(oid) as d from pg_constraint where conrelid = $1::regclass and conname = $2',
      [tab, nome])).d
    const nelCheck = [...def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]).sort()
    check(`${nome} uguale a NOTIFICATION_KINDS`, nelCheck.join(',') === [...NOTIFICATION_KINDS].sort().join(','), def)
  }
  check('isNotificationKind', isNotificationKind('clear_comment') && !isNotificationKind('vote') && !isNotificationKind(null))

  // i giorni della privacy sono quelli di purge_notifications
  const args = (await one<{ a: string }>(
    "select pg_get_function_arguments('purge_notifications(int, int)'::regprocedure) as a")).a
  const giorni = [...args.matchAll(/DEFAULT (\d+)/g)].map((m) => Number(m[1]))
  check('LEGALE: 30 giorni dopo la lettura e 90 senza, come purge_notifications',
    giorni[0] === LEGALE.giorniNotificheLette && giorni[1] === LEGALE.giorniNotificheNonLette, args)
}

function pallino() {
  console.log('\n  -- il pallino: hasUnread e /api/me')
  const t = new Date('2026-10-10T10:00:00Z')
  const dopo = new Date(t.getTime() + 1)
  check('mai una notifica: spento', !hasUnread(null, null) && !hasUnread(undefined, t))
  check('una notifica e mai vista la lista: acceso', hasUnread(t, null))
  check('arrivata dopo l\'ultima visita: acceso; prima o insieme: spento',
    hasUnread(dopo, t) && !hasUnread(t, dopo) && !hasUnread(t, t))
  check('un valore non valido vale "mai"', !hasUnread(new Date(NaN), null) && !hasUnread('x', null))
  check('anche stringhe ISO (JSON)', hasUnread(dopo.toISOString(), t.toISOString()))

  const base: CurrentUser = {
    id: '00000000-0000-4000-8000-000000000001', handle: 'Someone', image: null, role: 'member', reg: 'global',
    displayName: 'Real Name', onboarded: true, prefersAnimated: false, theme: null,
    suspendedUntil: null, suspended: false, suspensionReason: null, unread: true,
  }
  const me = viewerUserOf(base)
  check('/api/me: user.unread e\' un booleano, nessuna data o numero', me.unread === true &&
    !Object.keys(me).some((k) => /notif|count|last|seen/i.test(k)), JSON.stringify(me))
  check('spento resta false', viewerUserOf({ ...base, unread: false }).unread === false)
  const fine = new Date(Date.now() + 3_600_000).toISOString()
  check('anche a chi e\' sospeso', viewerUserOf({ ...base, suspended: true, suspendedUntil: fine }).unread === true)
}

/** Una riga finta, per i casi che il database non produce facilmente. */
const finta = (x: Partial<NotificationRow>): NotificationRow => ({
  id: '1', kind: 'clear_comment', created_at: new Date(), updated_at: new Date(), read_at: null, n: 1,
  actor_handle: 'Goku', target: 'clear', clear_id: 'c1', comment_id: null, tip_id: null, event_id: '42', reg: 'global',
  tier_id: '7', event_name: 'Some Event', stage_seq: 3, stage_name: null, difficulty: 'super2',
  content_visible: true, visible: true, until: null, ...x,
})

function hrefFinti() {
  console.log('\n  -- href e testi su righe finte')
  check('il link della lista e\' /notifications/<id>', notificationLink('15') === '/notifications/15')
  check('clear pubblicato: la sua ancora nella pagina del tier',
    notificationHref(finta({})) === `${eventHref({ id: '42', tier: '7' })}${clearAnchor('c1')}`, notificationHref(finta({})))
  check('clear di Japan: il percorso /japan', notificationHref(finta({ reg: 'japan' })).startsWith('/events/42/japan/t/7#clear-c1'))
  check('clear nascosto: la sua modifica', notificationHref(finta({ kind: 'content_hidden', content_visible: false })) ===
    editClearHref('42', 'c1'))
  check('commento nascosto: comunque la pagina del clear (non e\' suo)',
    notificationHref(finta({ kind: 'content_hidden', target: 'comment', comment_id: 'm1', content_visible: false })) ===
    `/events/42/t/7${clearAnchor('c1')}`)
  check('tip pubblicata: la sua ancora; nascosta: la sezione tips',
    notificationHref(finta({ target: 'tip', tip_id: 't1', clear_id: null, reg: null })) === '/events/42/t/7#tip-t1' &&
    notificationHref(finta({ target: 'tip', tip_id: 't1', clear_id: null, content_visible: false })) === '/events/42/t/7#tips')
  check('account: /settings; segnalazioni: /admin',
    notificationHref(finta({ kind: 'suspended', target: 'account' })) === '/settings' &&
    notificationHref(finta({ kind: 'reports_open', target: 'reports' })) === '/admin')
  check('non piu\' visibile, o senza evento: la lista', notificationHref(finta({ visible: false })) === '/notifications' &&
    notificationHref(finta({ event_id: null })) === '/notifications')
  check('il luogo: evento, stage, difficolta\'', notificationPlace(finta({})) === 'Some Event, Stage 3, Super 2' &&
    notificationPlace(finta({ difficulty: 'eza_level', stage_seq: 30 })) === 'Some Event, Level 30')
  const tre = notificationText(finta({ n: 3, actor_handle: 'Vegeta' }))
  check('tre commenti accorpati: il numero e l\'ultimo autore', tre.title === '3 new comments on your clear' &&
    !!tre.detail?.includes('latest from Vegeta'), JSON.stringify(tre))
  check('un commento: chi', notificationText(finta({})).title === 'Goku commented on your clear')
  check('sospensione indefinita', notificationText(finta({ kind: 'suspended', target: 'account', until: Infinity })).title ===
    'Your account was suspended indefinitely')
  const tutti = NOTIFICATION_KINDS.map((k) => notificationText(finta({ kind: k, n: 2 })))
  check('ogni tipo ha un titolo suo, senza trattini lunghi', tutti.every((t) => t.title !== 'Notification' &&
    senzaTrattini(t.title + (t.detail ?? ''))), JSON.stringify(tutti))
}

async function righeVere() {
  console.log('\n  -- su righe vere: lista, testi, href, lette')
  const d = await dati().catch(async () => {
    const b = await one<{ run: string; tier: string }>(
      `select r.id::text as run, st.id::text as tier from event_run r join stage_tier st on st.event_id = r.event_id
        where r.starts_at <= now() order by r.event_id, r.id, st.id limit 1`)
    const cards = (await q<{ id: string }>(
      `select c.id::text from card c join card_release r on r.card_id = c.id and r.reg = 'global'
        where r.released_at <= current_date order by c.id limit 8`)).map((r) => Number(r.id))
    return { run: b.run, tier: b.tier, futura: '', altraRun: '', cards }
  })
  const autore = await utente(P, 'na_autore')
  const altro = await utente(P, 'na_altro')
  const terzo = await utente(P, 'na_terzo')
  const admin = await utente(P, 'na_admin')
  await db.query(`update app_user set role = 'admin' where id = $1`, [admin])
  const clear = (await one<{ id: string }>(SUBMIT, [autore, d.run, d.tier, JSON.stringify(payload(d.cards))])).id
  const versione = (await one<{ id: string }>('select id::text from clear_version where clear_id = $1 and is_current', [clear])).id
  const evento = (await one<{ e: string }>('select event_id::text as e from clear where id = $1', [clear])).e

  await db.query(COMMENT, [altro, versione, `${SEGRETO} uno`])
  await db.query(COMMENT, [terzo, versione, `${SEGRETO} due`])
  await db.query(COMMENT, [altro, versione, `${SEGRETO} tre`])
  let lista = await listNotifications(autore)
  check('tre commenti di due persone: una riga sola, non letta', lista.length === 1 && lista[0].read_at === null &&
    lista[0].n === 3 && lista[0].kind === 'clear_comment', JSON.stringify(lista.map((r) => [r.kind, r.n])))
  const r = lista[0]
  const testo = notificationText(r)
  check('il titolo conta i commenti, l\'ultimo autore e\' nella riga sotto',
    testo.title === '3 new comments on your clear' && !!testo.detail?.includes('latest from na_altro'), JSON.stringify(testo))
  check('id e numeri come stringhe per lib/urls.ts', typeof r.id === 'string' && typeof r.event_id === 'string' &&
    typeof r.tier_id === 'string' && typeof r.n === 'number')
  check('href: l\'ancora del clear nella pagina del tier', notificationHref(r) ===
    `${eventHref({ id: evento, reg: r.reg ?? 'global', tier: d.tier })}${clearAnchor(clear)}`, notificationHref(r))
  check('render: la stessa riga a chi la possiede, nessuna a un altro',
    (await renderNotification(autore, r.id))?.id === r.id && (await renderNotification(altro, r.id)) === null)
  check('mai il testo del commento nelle colonne', !JSON.stringify(lista).includes(SEGRETO))

  // il pallino come lo legge la sessione
  const colonne = async (u: string) => one<{ l: Date | null; s: Date | null }>(
    'select notif_last_at as l, notif_seen_at as s from app_user where id = $1', [u])
  let c = await colonne(autore)
  check('il pallino e\' acceso (colonne di app_user)', hasUnread(c.l, c.s))
  check('markRead di un id di un altro: niente', await markRead(altro, [r.id]) === 0)
  const m = await markNotificationsRead(autore, [r.id])
  c = await colonne(autore)
  check('aprire la lista segna lette quelle mostrate e spegne il pallino', m.marked === 1 && m.unread === false &&
    !hasUnread(c.l, c.s), JSON.stringify(m))
  lista = await listNotifications(autore)
  check('ora e\' in Earlier (read_at)', lista[0].read_at !== null)
  check('con zero id (niente di nuovo) non segna niente e resta spento',
    (await markNotificationsRead(autore, [])).unread === false)

  console.log('\n  -- moderazione e segnalazioni')
  await db.query(REPORT, [altro, 'clear', clear, 'spam', null])
  check('chi e\' segnalato non riceve niente', await num(
    "select count(*) from notification where recipient_id = $1 and kind = 'reports_open'", [autore]) === 0)
  const perAdmin = (await listNotifications(admin)).find((x) => x.kind === 'reports_open')
  check('l\'admin: una segnalazione da vedere, verso /admin, senza chi l\'ha mandata',
    !!perAdmin && notificationHref(perAdmin) === '/admin' && notificationText(perAdmin).title === 'A new report to review' &&
    perAdmin.actor_handle === null, JSON.stringify(perAdmin && notificationText(perAdmin)))
  await db.query(HIDE_CLEAR, [admin, clear, 'hidden'])
  const nascosto = (await listNotifications(autore)).find((x) => x.kind === 'content_hidden')
  check('clear nascosto: "A moderator hid your clear", verso la sua modifica', !!nascosto &&
    notificationText(nascosto).title === 'A moderator hid your clear' && notificationHref(nascosto) === editClearHref(evento, clear),
    nascosto ? `${notificationText(nascosto).title} ${notificationHref(nascosto)}` : 'assente')
  check('il moderatore non compare', nascosto?.actor_handle === null &&
    !JSON.stringify(nascosto).includes('na_admin'))
  await db.query(HIDE_CLEAR, [admin, clear, 'published'])
  const ripristinato = (await listNotifications(autore)).find((x) => x.kind === 'content_unhidden')
  check('ripristinato: "A moderator restored your clear", verso la pagina', !!ripristinato &&
    notificationText(ripristinato).title === 'A moderator restored your clear' &&
    notificationHref(ripristinato).endsWith(clearAnchor(clear)))

  const fine = new Date(Date.now() + 2 * 86_400_000)
  await db.query(SUSPEND, [admin, autore, fine.toISOString(), `${SEGRETO} motivo`])
  const sosp = (await listNotifications(autore)).find((x) => x.kind === 'suspended')
  check('sospeso: il titolo con la fine, verso /settings, senza il motivo', !!sosp &&
    notificationText(sosp).title.startsWith('Your account was suspended until ') && notificationHref(sosp) === '/settings' &&
    !JSON.stringify(sosp).includes(SEGRETO), sosp ? notificationText(sosp).title : 'assente')
  await db.query(UNSUSPEND, [admin, autore])
  const tolta = (await listNotifications(autore)).find((x) => x.kind === 'suspension_lifted')
  check('sospensione tolta: verso /settings', !!tolta && notificationHref(tolta) === '/settings' &&
    notificationText(tolta).title === 'Your suspension was lifted')

  const tutte = await listNotifications(autore)
  const testi = tutte.map((x) => notificationText(x)).map((t) => t.title + (t.detail ?? '')).join(' | ')
  check('in nessun testo il testo dei post o il motivo', !testi.includes(SEGRETO) && senzaTrattini(testi), testi)
  const fine2 = await markNotificationsRead(autore, tutte.filter((x) => !x.read_at).map((x) => x.id))
  check('segnate tutte quelle mostrate: pallino spento', fine2.unread === false && fine2.marked >= 3, JSON.stringify(fine2))
}

function guardieFile() {
  console.log('\n  -- guardie sui file')
  const robots = file('app/robots.ts')
  check('robots.txt esclude /notifications (copre /notifications/<id>)', /'\/notifications'/.test(robots))
  const pagina = file('app/notifications/page.tsx')
  check('/notifications: per utente, noindex, requireOnboardedUser', /export const instant = false/.test(pagina) &&
    /robots: \{ index: false \}/.test(pagina) && /requireOnboardedUser\(/.test(pagina))
  const rotta = file('app/notifications/[id]/route.ts')
  check('/notifications/<id>: 307, private no-store, segna letta', /status: 307/.test(rotta) &&
    /private, no-store/.test(rotta) && /markRead\(/.test(rotta))
  const campanella = file('components/notifiche/campanella.tsx')
  check('la campanella non fa prefetch (aprire la lista segna lette)', /prefetch=\{false\}/.test(campanella) &&
    /Notifications, new/.test(campanella))
  const riga = file('components/notifiche/riga.tsx')
  check('le righe della lista sono <a>, non <Link> (la rotta scrive)', /<a\b/.test(riga) && !/from 'next\/link'/.test(riga))
  const menu = file('components/auth/user-menu.tsx')
  check('il menu non mostra niente finche\' /api/me non risponde', /mode === 'unknown'/.test(menu) && /<Campanella/.test(menu))
  const privacy = file('app/privacy/page.tsx')
  check('la privacy dice cosa si salva e per quanto', /giorniNotificheLette/.test(privacy) &&
    /giorniNotificheNonLette/.test(privacy) && /<strong>Notifications\.<\/strong>/.test(privacy))
  const settings = file('app/settings/page.tsx')
  check('Settings ha la sezione #notifications', /id="notifications"/.test(settings))
}

async function pulizia() {
  await db.query('delete from app_user where email like $1', [`${P}+%@example.invalid`])
}

try {
  await pulizia()
  await tipi()
  pallino()
  hrefFinti()
  await righeVere()
  guardieFile()
} finally {
  await pulizia()
  await db.end()
}

console.log(`\n  ${stato.passes} PASS, ${stato.fails} FAIL`)
process.exit(stato.fails ? 1 : 0)
