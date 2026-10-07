import { sqlOne } from '@/lib/db'

/**
 * Il limite per IP di better-auth, contato da auth_rate_consume (0014):
 * una sola istruzione che conta e decide, cosi' due richieste simultanee
 * non passano entrambe leggendo lo stesso conto. La chiave la compone
 * better-auth (IP + percorso).
 */
export const rateLimitStorage = {
  async consume(key: string, rule: { window: number; max: number }) {
    const r = await sqlOne<{ allowed: boolean; retry_after: number | null }>(
      'select allowed, retry_after from auth_rate_consume($1, $2, $3)',
      [key, rule.window, rule.max],
    )
    return { allowed: r?.allowed ?? false, retryAfter: r?.retry_after ?? null }
  },
}

/** La pausa per email del magic link (note_email_send, 0014). */
export async function mayEmail(email: string): Promise<boolean> {
  const r = await sqlOne<{ ok: boolean }>('select note_email_send($1) as ok', [email])
  return r?.ok === true
}
