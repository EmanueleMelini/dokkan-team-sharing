import type { CurrentUser } from '@/lib/dal'
import type { ViewerUser } from '@/lib/viewer/types'

// La sezione user di /api/me, dall'utente della DAL. Funzione pura (solo
// tipi importati): la prova il test senza Next. Il ruolo esce solo come
// isAdmin; la sospensione solo quando e' in corso, con il suo motivo, che
// e' gia' dell'interessato. Nessun id, email o nome del provider.

export function viewerUserOf(u: CurrentUser): ViewerUser {
  const out: ViewerUser = {
    handle: u.handle,
    onboarded: u.onboarded,
    prefersAnimated: u.prefersAnimated,
    theme: u.theme,
    reg: u.reg,
    isAdmin: u.role === 'admin',
    suspended: u.suspended,
    suspendedUntil: u.suspended ? u.suspendedUntil : null,
    // anche a chi e' sospeso: le notifiche sui suoi contenuti gli arrivano
    unread: u.unread,
  }
  if (u.suspended && u.suspensionReason) out.suspensionReason = u.suspensionReason
  return out
}
