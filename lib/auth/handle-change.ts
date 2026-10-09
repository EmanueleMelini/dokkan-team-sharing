// Le regole del cambio di handle (0026) in funzioni pure, piu' la data
// dell'ultimo cambio per Settings. Le impone il database (change_handle):
// qui servono a dire le cose prima e a tradurre i rifiuti in frasi.

import type { DbErrorLike } from '@/lib/auth/account'

/** La forma di un handle, la stessa di handle_shape (0014). */
export const HANDLE = /^[A-Za-z0-9_]{3,24}$/

/** Un cambio vero ogni 30 giorni: lo stesso intervallo di change_handle. */
export const HANDLE_COOLDOWN_DAYS = 30
const GIORNO_MS = 86_400_000

/** Da quando si puo' cambiare di nuovo, o null se si puo' gia'. */
export function nextHandleChange(changedAt: Date | null, now = new Date()): Date | null {
  if (!changedAt) return null
  const dopo = new Date(changedAt.getTime() + HANDLE_COOLDOWN_DAYS * GIORNO_MS)
  return dopo > now ? dopo : null
}

/** Solo le maiuscole cambiano (Goku -> GOKU): libero, senza attesa. */
export const soloMaiuscole = (attuale: string, nuovo: string) =>
  attuale !== nuovo && attuale.toLowerCase() === nuovo.toLowerCase()

const FORMA = 'Use 3 to 24 characters: letters, digits or underscores.'

const BY_CONSTRAINT: Record<string, string> = {
  handle_shape: FORMA,
  handle_reserved: 'That handle is reserved. Try another one.',
  handle_taken: 'That handle is already taken. Try another one.',
  handle_unchanged: 'That is already your handle.',
  handle_cooldown: `You can change your handle once every ${HANDLE_COOLDOWN_DAYS} days.`,
  handle_change_forbidden: 'Finish setting up your account first.',
  account_suspended: 'Your account is suspended, so you cannot change your handle right now.',
}

/**
 * La frase per un rifiuto di change_handle, o null se e' un guasto. Un
 * 23505 senza nome (l'unique di app_user, l'ultima difesa sotto il lock)
 * vale come preso.
 */
export function friendlyHandleError(e: DbErrorLike): string | null {
  if (e.constraint && BY_CONSTRAINT[e.constraint]) return BY_CONSTRAINT[e.constraint]
  if (e.code === '23505') return BY_CONSTRAINT.handle_taken
  return null
}

/** I nomi dei vincoli tradotti, per il test che li confronta con 0026. */
export const HANDLE_CONSTRAINTS = Object.keys(BY_CONSTRAINT)
