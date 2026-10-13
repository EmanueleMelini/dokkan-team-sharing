import { fineInParole, fineSospensione } from '@/lib/moderation/sospensione'
import { clearAnchor, editClearHref, eventHref } from '@/lib/urls'
import { activityHref, activityText } from '@/lib/notify/attivita'
import { NOTIFICATIONS_PATH, type NotificationRow } from '@/lib/notify/kinds'
import { notificationPlace } from '@/lib/notify/luogo'

export { NOTIFICATIONS_PATH }
export { notificationPlace, type NotificationPlaceFields } from '@/lib/notify/luogo'

// Dove porta una notifica e come si legge nella lista: funzioni pure su una
// riga di notification_view, cosi' la lista, la rotta /notifications/<id>
// e (fasi 3 e 4) push ed email dicono la stessa cosa. Le prova
// db/test/notifiche-app.test.mts.
//
// Il testo dei post non c'e' mai: la riga non lo porta. La lista e'
// privata, quindi qui la moderazione si dice per esteso; push ed email
// useranno frasi generiche, perche' si leggono anche sullo schermo bloccato.
// Il feed degli admin (site_activity, 0032) ha testi e link suoi, in
// lib/notify/attivita.ts.


/** L'unico link che lista, push ed email usano: segna letta e reindirizza. */
export const notificationLink = (id: string) => `${NOTIFICATIONS_PATH}/${id}`

/**
 * L'href calcolato adesso, dalla riga appena letta:
 *   clear     la sua ancora nella pagina del tier, o la modifica se non e'
 *             pubblicato (solo l'autore la apre: la moderazione lo riguarda);
 *   comment   l'ancora del suo clear (un commento non ha una pagina sua);
 *             tutti e due con la versione del clear scritta nell'URL;
 *   tip       la pagina del tier (o dell'evento) sulla tip, senza versione:
 *             le tip non hanno regione, e l'ancora vale nelle due;
 *   account   /settings, dove ci sono il banner e i contenuti nascosti;
 *   reports   /admin.
 * Senza i pezzi che servono si torna alla lista, mai a un URL inventato.
 */
export function notificationHref(v: NotificationRow): string {
  if (v.kind === 'site_activity') return activityHref(v)
  if (!v.visible) return NOTIFICATIONS_PATH
  switch (v.target) {
    case 'account':
      return '/settings'
    case 'reports':
      return '/admin'
    case 'tip':
      if (!v.event_id) return NOTIFICATIONS_PATH
      return `${eventHref({ id: v.event_id, tier: v.tier_id })}${v.content_visible && v.tip_id ? `#tip-${v.tip_id}` : '#tips'}`
    case 'comment':
    case 'clear': {
      if (!v.event_id || !v.clear_id) return NOTIFICATIONS_PATH
      // Un clear nascosto non e' nella pagina del tier: il suo autore lo
      // ritrova nella modifica. Un commento nascosto invece non e' suo
      // clear, quindi si va comunque alla pagina (il clear di un altro).
      if (v.target === 'clear' && v.content_visible === false) return editClearHref(v.event_id, v.clear_id)
      // explicit: la versione del clear vince su quella scelta nel sito
      // (lib/versione); l'ancora attraverserebbe il redirect e finirebbe su
      // un tier dell'altra versione, dove il clear non c'e'
      return `${eventHref({ id: v.event_id, reg: v.reg ?? 'global', tier: v.tier_id, explicit: true })}${clearAnchor(v.clear_id)}`
    }
    // solo del feed degli admin, che ha gia' risposto sopra
    case 'profile':
    case 'none':
      return NOTIFICATIONS_PATH
  }
}

const COSA: Record<string, string> = { clear: 'clear', comment: 'comment', tip: 'tip' }

export type NotificationText = { title: string; detail: string | null }

/** Il titolo e la riga sotto, per la lista privata. Inglese, senza trattini lunghi. */
export function notificationText(v: NotificationRow): NotificationText {
  const luogo = notificationPlace(v)
  const cosa = COSA[v.target] ?? 'post'
  switch (v.kind) {
    case 'clear_comment': {
      const chi = v.actor_handle ?? 'Someone'
      const title = v.n > 1
        ? `${v.n} new comments on your clear`
        : `${chi} commented on your clear`
      return { title, detail: v.n > 1 ? [luogo, `latest from ${chi}`].filter(Boolean).join(', ') : luogo }
    }
    case 'content_hidden': {
      const resta = v.target === 'clear' ? 'You can still edit or delete it.' : 'You can still delete it.'
      return {
        title: `A moderator hid your ${cosa}`,
        detail: [luogo, `Other players cannot see it. ${resta}`].filter(Boolean).join('. '),
      }
    }
    case 'content_unhidden':
      return { title: `A moderator restored your ${cosa}`, detail: luogo ? `${luogo}. It is visible again.` : 'It is visible again.' }
    case 'suspended': {
      const fine = fineSospensione(v.until)
      return {
        title: fine ? `Your account was suspended ${fineInParole(fine)}` : 'Your account was suspended',
        detail: 'Settings shows the reason and what you can still do.',
      }
    }
    case 'suspension_lifted':
      return { title: 'Your suspension was lifted', detail: 'You can post, vote, comment and report again.' }
    case 'reports_open':
      return {
        title: v.n > 1 ? `${v.n} open reports to review` : 'A new report to review',
        detail: `Open the moderation queue to handle ${v.n > 1 ? 'them' : 'it'}.`,
      }
    case 'site_activity':
      return activityText(v)
    default:
      return { title: 'Notification', detail: null }
  }
}
