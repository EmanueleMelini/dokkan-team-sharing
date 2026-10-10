import 'server-only'
import { sqlOne } from '@/lib/db'
import { readNotifyEnv } from '@/lib/notify/env'
import { verifyUnsubscribeToken } from '@/lib/notify/token'

// La disiscrizione dal link dell'email (0029), per la POST one-click
// (RFC 8058) e per il bottone della pagina di conferma. Niente sessione e
// niente cookie: decide solo il token firmato, e notify_unsubscribe puo'
// solo spegnere (il digest e le preferenze email), mai accendere.
//
// 'ok' anche quando era gia' spento: un secondo clic dice la stessa cosa
// del primo. 'invalid' per una firma sbagliata, una versione revocata (un
// cambio di email, notify_rotate_token) o un utente che non c'e' piu'.

export type UnsubscribeResult = 'ok' | 'invalid'

export async function unsubscribeWithToken(token: unknown): Promise<UnsubscribeResult> {
  const claim = verifyUnsubscribeToken(readNotifyEnv().secret, token)
  if (!claim) return 'invalid'
  const r = await sqlOne<{ ok: boolean }>('select notify_unsubscribe($1::uuid, $2::int) as ok', [claim.userId, claim.tokenV])
  return r?.ok ? 'ok' : 'invalid'
}
