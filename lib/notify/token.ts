import { createHmac, timingSafeEqual } from 'node:crypto'

// Il token dei link di disiscrizione del digest (0029). Modulo puro, senza
// Next e senza database: lo provano i test.
//
//   v1.<user_id>.<notify_token_v>.<hmac>
//
// Nessuna variabile d'ambiente nuova: la chiave si deriva da
// BETTER_AUTH_SECRET con un'etichetta fissa, cosi' il proprietario non ha
// un segreto in piu' da creare e ricordare. L'etichetta separa gli usi:
// un HMAC fatto qui non vale come nessun'altra firma di better-auth, e
// viceversa. Cambiare BETTER_AUTH_SECRET invalida i link vecchi (accettato:
// al massimo si clicca "Unsubscribe" in Settings). Per revocare i link di un
// utente solo c'e' notify_token_v, che il database alza da solo quando
// cambia l'email (notify_rotate_token per farlo a mano).
//
// Il token puo' solo SPEGNERE il digest: chi lo trova in un'email inoltrata
// al massimo smette di ricevere email, non vede niente e non accende niente.

const ETICHETTA = 'dokkants/notify-unsubscribe/v1'
const FORMA = /^v1\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([1-9][0-9]{0,9})\.([A-Za-z0-9_-]{43})$/
const INT_MAX = 2_147_483_647

/** Il minimo per una chiave HMAC seria; readAuthEnv non lo controlla. */
export const NOTIFY_SECRET_MIN_LENGTH = 16

export type UnsubscribeClaim = { userId: string; tokenV: number }

const chiave = (secret: string) => createHmac('sha256', secret).update(ETICHETTA, 'utf8').digest()
const firma = (secret: string, payload: string) => createHmac('sha256', chiave(secret)).update(payload, 'utf8').digest()

function sicuro(secret: string): void {
  // Con un segreto vuoto o corto chiunque firmerebbe: meglio non mandare
  // il digest che mandarlo con link falsificabili.
  if (!secret || secret.length < NOTIFY_SECRET_MIN_LENGTH) throw new Error('BETTER_AUTH_SECRET troppo corto per firmare i link')
}

/** Il token per un utente e la sua versione corrente (app_user.notify_token_v). */
export function signUnsubscribeToken(secret: string, userId: string, tokenV: number): string {
  sicuro(secret)
  const id = userId.toLowerCase()
  if (!Number.isInteger(tokenV) || tokenV < 1 || tokenV > INT_MAX) throw new Error('notify_token_v non valido')
  const payload = `v1.${id}.${tokenV}`
  if (!FORMA.test(`${payload}.${'A'.repeat(43)}`)) throw new Error('user id non valido')
  return `${payload}.${firma(secret, payload).toString('base64url')}`
}

/**
 * L'utente e la versione, se la firma e' giusta; null per qualsiasi altra
 * cosa (forma, versione fuori misura, firma). Il confronto e' a tempo
 * costante come in lib/cron.ts. La versione la controlla poi il database
 * (notify_unsubscribe): qui si dice solo che il token l'abbiamo fatto noi.
 */
export function verifyUnsubscribeToken(secret: string, token: unknown): UnsubscribeClaim | null {
  if (!secret || secret.length < NOTIFY_SECRET_MIN_LENGTH) return null
  if (typeof token !== 'string' || token.length > 200) return null
  const m = FORMA.exec(token)
  if (!m) return null
  const tokenV = Number(m[2])
  if (!Number.isSafeInteger(tokenV) || tokenV > INT_MAX) return null
  const atteso = firma(secret, `v1.${m[1]}.${m[2]}`)
  const dato = Buffer.from(m[3], 'base64url')
  // L'ultimo dei 43 caratteri porta 4 bit utili e 2 di riempimento che la
  // decodifica scarta: senza questo controllo ogni token avrebbe 4 grafie
  // valide. Si accetta solo quella canonica, l'unica che firmiamo noi. Il
  // confronto dipende solo dall'input, non dal segreto: niente tempo costante.
  if (dato.toString('base64url') !== m[3]) return null
  // 43 caratteri base64url sono sempre 32 byte, ma la lunghezza si
  // ricontrolla: timingSafeEqual lancia con buffer diversi.
  if (dato.length !== atteso.length || !timingSafeEqual(dato, atteso)) return null
  return { userId: m[1], tokenV }
}
