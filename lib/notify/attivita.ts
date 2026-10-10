import { NOTIFICATIONS_PATH, type NotificationRow } from '@/lib/notify/kinds'
import { notificationPlace, type NotificationPlaceFields } from '@/lib/notify/luogo'
import { adminUserHref, clearAnchor, eventHref, profileHref } from '@/lib/urls'

// Il feed delle azioni del sito per gli admin (site_activity, 0032): il
// titolo, la riga sotto e il link di una riga. Modulo puro, come vista.ts:
// lo usano la lista, la rotta /notifications/<id>, le push e i test.
//
// Il minimo, deciso dal proprietario: chi (l'handle di adesso, "Someone"
// se l'account non c'e' piu'), cosa (un verbo breve) e dove (evento e
// stage). Mai il testo di un post, di un commento o di una tip, mai il
// motivo o i dettagli di una segnalazione, mai chi l'ha mandata: la riga
// non li porta (nemmeno come attore, per una segnalazione), e qui non si
// inventano. Inglese, senza trattini lunghi.

/**
 * Le azioni, nello stesso ordine di site_activity_actions() della
 * migrazione: db/test/notifiche-app.test.mts controlla che coincidano, e
 * che coincidano col check notification_activity_data.
 */
export const SITE_ACTIVITY_ACTIONS = [
  'clear_posted',
  'clear_revised',
  'clear_deleted',
  'comment_posted',
  'clear_upvoted',
  'clear_downvoted',
  'clear_unvoted',
  'tip_posted',
  'tip_edited',
  'tip_deleted',
  'tip_helpful',
  'tip_unhelpful',
  'report',
  'user_joined',
  'handle_changed',
  'account_deleted',
  'mod_hide',
  'mod_unhide',
  'mod_dismiss',
  'mod_suspend',
  'mod_unsuspend',
] as const

export type SiteActivityAction = (typeof SITE_ACTIVITY_ACTIONS)[number]

/**
 * I campi del testo: quelli di una riga della lista, o di un push_job (che
 * non ha event_id). target, action e subject_handle mancano solo nelle
 * righe degli altri tipi.
 */
export type ActivityFields = Omit<NotificationPlaceFields, 'event_id'> & {
  event_id?: string | null
  n: number
  actor_handle: string | null
  subject_handle?: string | null
  action?: string | null
  target?: string | null
}

const COSA: Record<string, string> = { clear: 'a clear', comment: 'a comment', tip: 'a tip' }

const maiuscola = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Il titolo e la riga sotto. Per la lista privata e per la push, che li usa uguali. */
export function activityText(v: ActivityFields): { title: string; detail: string | null } {
  const chi = v.actor_handle ?? 'Someone'
  const n = Number.isFinite(v.n) && v.n > 1 ? Math.trunc(v.n) : 1
  const luogo = notificationPlace({ ...v, event_id: v.event_id ?? null })
  const cosa = COSA[v.target ?? ''] ?? 'a post'
  const chiE = v.subject_handle ?? null
  /** il luogo e chi ha fatto l'ultima, per i gruppi con piu' azioni di persone diverse */
  const ultimo = (frase: string) => [luogo, frase].filter(Boolean).join(', ')
  switch (v.action) {
    case 'clear_posted':
      return { title: `${chi} posted a clear`, detail: luogo }
    case 'clear_revised':
      return { title: n > 1 ? `${chi} revised a clear ${n} times` : `${chi} revised a clear`, detail: luogo }
    case 'clear_deleted':
      return { title: `${chi} deleted a clear`, detail: luogo }
    case 'comment_posted':
      return n > 1
        ? { title: `${n} new comments on a clear`, detail: ultimo(`latest from ${chi}`) }
        : { title: `${chi} commented on a clear`, detail: luogo }
    case 'clear_upvoted':
    case 'clear_downvoted':
    case 'clear_unvoted': {
      if (n > 1) {
        const verbo = v.action === 'clear_upvoted' ? 'upvoted' : v.action === 'clear_downvoted' ? 'downvoted' : 'took back a vote'
        return { title: `${n} vote changes on a clear`, detail: ultimo(`latest: ${chi} ${verbo}`) }
      }
      const title = v.action === 'clear_upvoted' ? `${chi} upvoted a clear`
        : v.action === 'clear_downvoted' ? `${chi} downvoted a clear` : `${chi} took back a vote on a clear`
      return { title, detail: luogo }
    }
    case 'tip_posted':
      return { title: `${chi} posted a tip`, detail: luogo }
    case 'tip_edited':
      return { title: n > 1 ? `${chi} edited a tip ${n} times` : `${chi} edited a tip`, detail: luogo }
    case 'tip_deleted':
      return { title: `${chi} deleted a tip`, detail: luogo }
    case 'tip_helpful':
    case 'tip_unhelpful': {
      const su = v.action === 'tip_helpful'
      if (n > 1) {
        return { title: `${n} Helpful changes on a tip`, detail: ultimo(`latest: ${chi} ${su ? 'found it helpful' : 'took back Helpful'}`) }
      }
      return { title: su ? `${chi} found a tip helpful` : `${chi} took back Helpful on a tip`, detail: luogo }
    }
    case 'report':
      // chi segnala non si dice mai: la riga non porta il suo handle
      return { title: n > 1 ? `${n} new reports on ${cosa}` : `New report on ${cosa}`, detail: luogo }
    case 'user_joined':
      return { title: `${chiE ?? 'A new member'} joined the site`, detail: null }
    case 'handle_changed':
      if (n > 1) return { title: `A member changed their handle ${n} times`, detail: chiE ? `Now ${chiE}` : null }
      return { title: chiE ? `A member changed their handle to ${chiE}` : 'A member changed their handle', detail: null }
    case 'account_deleted':
      // nessun handle: la riga non sa di chi era, ed e' voluto
      return { title: n > 1 ? `${n} accounts were deleted` : 'An account was deleted', detail: null }
    case 'mod_hide':
      return n > 1
        ? { title: `${maiuscola(cosa)} was hidden ${n} times`, detail: ultimo(`latest by ${chi}`) }
        : { title: `${chi} hid ${cosa}`, detail: luogo }
    case 'mod_unhide':
      return n > 1
        ? { title: `${maiuscola(cosa)} was restored ${n} times`, detail: ultimo(`latest by ${chi}`) }
        : { title: `${chi} restored ${cosa}`, detail: luogo }
    case 'mod_dismiss':
      return n > 1
        ? { title: `Reports on ${cosa} were dismissed ${n} times`, detail: ultimo(`latest by ${chi}`) }
        : { title: `${chi} dismissed the reports on ${cosa}`, detail: luogo }
    case 'mod_suspend':
      return n > 1
        ? { title: `${chiE ?? 'A member'} was suspended ${n} times`, detail: `Latest by ${chi}` }
        : { title: `${chi} suspended ${chiE ?? 'a member'}`, detail: null }
    case 'mod_unsuspend':
      return n > 1
        ? { title: `${chiE ? `${chiE}'s suspension` : 'A suspension'} was lifted ${n} times`, detail: `Latest by ${chi}` }
        : { title: `${chi} lifted ${chiE ? `${chiE}'s` : 'a'} suspension`, detail: null }
    default:
      return { title: 'New activity on the site', detail: luogo }
  }
}

/**
 * Dove porta, calcolato adesso dalla riga:
 *   - una segnalazione: la coda di /admin; la moderazione: il registro;
 *   - un iscritto o un handle: il profilo, con l'handle di adesso; se il
 *     profilo non si vede, o non si sa (subject_public: chi e' sospeso non
 *     e' in public_profile, e /users/<handle> sarebbe un 404), la sua
 *     pagina di /admin, che c'e' sempre (chi legge il feed e' un admin);
 *   - un contenuto pubblicato: la sua ancora (il clear nella pagina del
 *     tier, la tip nella sua pagina); nascosto ora: /admin/hidden, nella
 *     scheda Tips per una tip;
 *   - un contenuto cancellato, un account cancellato, una riga che non si
 *     mostra piu' (non sei piu' admin): la lista, mai un URL inventato.
 */
export function activityHref(v: NotificationRow): string {
  if (!v.visible) return NOTIFICATIONS_PATH
  const a = v.action ?? ''
  if (a === 'report') return '/admin'
  if (a.startsWith('mod_')) return '/admin/log'
  if (a === 'user_joined' || a === 'handle_changed') {
    if (!v.subject_handle) return NOTIFICATIONS_PATH
    return v.subject_public ? profileHref(v.subject_handle) : adminUserHref(v.subject_handle)
  }
  if (a === 'account_deleted' || a === 'clear_deleted' || a === 'tip_deleted') return NOTIFICATIONS_PATH
  if (v.target === 'tip') {
    if (!v.event_id || !v.tip_id) return NOTIFICATIONS_PATH
    // la scheda Tips: senza ?kind la pagina apre quella dei clear
    if (v.content_visible === false) return '/admin/hidden?kind=tip'
    return `${eventHref({ id: v.event_id, tier: v.tier_id })}#tip-${v.tip_id}`
  }
  if (!v.event_id || !v.clear_id) return NOTIFICATIONS_PATH
  if (v.content_visible === false) return '/admin/hidden'
  return `${eventHref({ id: v.event_id, reg: v.reg ?? 'global', tier: v.tier_id })}${clearAnchor(v.clear_id)}`
}
