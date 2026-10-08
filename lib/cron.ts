import { createHash, timingSafeEqual } from 'node:crypto'

// L'autenticazione delle rotte che chiama Vercel Cron (/api/cron/*).
// Vercel manda "Authorization: Bearer <CRON_SECRET>" se la variabile e'
// impostata nel progetto. Pura, senza Next: la provano i test.

/** Sotto questa lunghezza il segreto si indovina: la rotta resta chiusa. */
export const CRON_SECRET_MIN_LENGTH = 16

const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest()

/**
 * Vero solo se l'header e' esattamente "Bearer <secret>".
 *
 * Il confronto e' a tempo costante sugli hash: timingSafeEqual vuole due
 * buffer della stessa lunghezza, e confrontare gli hash non fa trapelare
 * nemmeno la lunghezza del segreto. Senza segreto (o troppo corto) la
 * risposta e' sempre no: una rotta di pulizia aperta a tutti la
 * lancerebbe chiunque, mille volte al minuto.
 */
export function isCronAuthorized(header: string | null | undefined, secret: string | null | undefined): boolean {
  if (!secret || secret.length < CRON_SECRET_MIN_LENGTH) return false
  if (typeof header !== 'string') return false
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`))
}
