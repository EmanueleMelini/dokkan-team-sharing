// La "sessione fresca": le azioni che cambiano come si entra (scollegare,
// collegare un provider) o che non si annullano (cancellare l'account)
// chiedono un accesso recente. Chi ha rubato un cookie di sessione vecchio
// non puo' cosi' agganciare un suo provider o chiudere l'account altrui.
// Pura, senza Next: la usano la DAL, l'hook di better-auth e i test.

export const FRESH_SESSION_MINUTES = 15
export const FRESH_SESSION_SECONDS = FRESH_SESSION_MINUTES * 60

/**
 * Vero se la sessione e' nata (auth_session.created_at) da meno di 15
 * minuti. created_at non cambia quando better-auth rinnova la scadenza:
 * conta solo l'accesso vero. Una data illeggibile vale come vecchia.
 */
export function isFreshSession(createdAt: Date | string | number | null | undefined, now = Date.now()): boolean {
  if (createdAt == null) return false
  const t = new Date(createdAt).getTime()
  if (Number.isNaN(t)) return false
  return now - t < FRESH_SESSION_SECONDS * 1000
}
