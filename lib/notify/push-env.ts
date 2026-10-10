import { LEGALE } from '@/lib/legale'

// Le chiavi VAPID delle push del browser (fase 4). Facoltative: senza, le
// push sono spente e basta (Settings non mostra la riga Browser, nessuna
// Server Action manda niente) e il sito parte lo stesso. Cosi' un deploy
// senza le variabili e' sicuro. Nessun valore va mai stampato, nemmeno la
// chiave pubblica: chi legge i log non deve poterle confrontare.
//
//   VAPID_PUBLIC_KEY   il punto P-256 non compresso, base64url (87 caratteri)
//   VAPID_PRIVATE_KEY  lo scalare, base64url (43 caratteri)
//   VAPID_SUBJECT      chi contattare per i servizi push: mailto: o https:
//                      (facoltativo: per difetto l'indirizzo della privacy)
//
// Si generano con `npx web-push generate-vapid-keys` e vanno solo nelle
// variabili di Vercel Production (Sensitive), con una copia nel password
// manager: se la chiave cambia, tutte le iscrizioni smettono di funzionare.

type Env = Record<string, string | undefined>

export type PushEnv = { publicKey: string; privateKey: string; subject: string }

const PUBBLICA = /^B[A-P][A-Za-z0-9_-]{85}$/
const PRIVATA = /^[A-Za-z0-9_-]{43}$/
const SOGGETTO = /^(mailto:[^\s@]+@[^\s@]+\.[^\s@]+|https:\/\/[^\s/]+(\/\S*)?)$/

/** Perche' le push sono spente, o null se sono accese. Mai i valori. */
export function pushEnvProblem(env: Env = process.env): 'missing' | 'partial' | 'invalid' | null {
  const pub = env.VAPID_PUBLIC_KEY?.trim() ?? ''
  const priv = env.VAPID_PRIVATE_KEY?.trim() ?? ''
  const subject = env.VAPID_SUBJECT?.trim() ?? ''
  if (!pub && !priv) return 'missing'
  if (!pub || !priv) return 'partial'
  if (!PUBBLICA.test(pub.replace(/=+$/, '')) || !PRIVATA.test(priv.replace(/=+$/, ''))) return 'invalid'
  if (subject && !SOGGETTO.test(subject)) return 'invalid'
  return null
}

/** Le chiavi, o null: con null le push sono spente. */
export function readPushEnv(env: Env = process.env): PushEnv | null {
  if (pushEnvProblem(env) !== null) return null
  return {
    publicKey: env.VAPID_PUBLIC_KEY!.trim().replace(/=+$/, ''),
    privateKey: env.VAPID_PRIVATE_KEY!.trim().replace(/=+$/, ''),
    subject: env.VAPID_SUBJECT?.trim() || `mailto:${LEGALE.contatto}`,
  }
}

/**
 * All'avvio (instrumentation.ts): una riga sola, e solo se c'e' qualcosa
 * da correggere. Le chiavi assenti sono una scelta, non un errore.
 */
export function logPushEnv(env: Env = process.env) {
  const p = pushEnvProblem(env)
  if (p === 'partial') console.warn('[push] spente: serve sia VAPID_PUBLIC_KEY sia VAPID_PRIVATE_KEY')
  if (p === 'invalid') console.warn('[push] spente: le chiavi VAPID o VAPID_SUBJECT non hanno il formato giusto')
}
