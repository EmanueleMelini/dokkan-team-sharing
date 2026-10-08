// L'unico posto che legge le variabili d'ambiente dell'accesso (la guida
// data-security di Next: solo il livello di accesso ai dati tocca
// process.env). Nessun valore va mai stampato: al massimo il nome.

export type ProviderId = 'discord' | 'google' | 'twitch'

export const PROVIDERS: { id: ProviderId; label: string }[] = [
  { id: 'discord', label: 'Discord' },
  { id: 'google', label: 'Google' },
  { id: 'twitch', label: 'Twitch' },
]

type Env = Record<string, string | undefined>

export type AuthEnv = {
  production: boolean
  baseURL: string
  secret: string
  /** Solo i provider con entrambe le variabili: gli altri non esistono. */
  providers: Partial<Record<ProviderId, { clientId: string; clientSecret: string }>>
  resendApiKey: string | null
  emailFrom: string
  /**
   * Gli header da cui better-auth legge l'IP del client (limite per IP e
   * sessioni). Null: il default di better-auth (x-forwarded-for), che va
   * bene in sviluppo dove il client e' la macchina stessa.
   */
  ipAddressHeaders: string[] | null
}

// Su Vercel l'header affidabile e' quello che scrive Vercel: x-forwarded-for
// e x-real-ip vengono sovrascritti dal suo edge (un valore mandato dal
// client non passa), ma x-vercel-forwarded-for resta giusto anche se un
// giorno ci fosse un altro proxy davanti. Con un header falsificabile
// ogni richiesta potrebbe dichiarare un IP nuovo e il limite non varrebbe.
const VERCEL_IP_HEADERS = ['x-vercel-forwarded-for']

/** AUTH_IP_HEADERS ("a, b"), o il default della piattaforma. */
export function readIpAddressHeaders(env: Env): string[] | null {
  const raw = presente(env.AUTH_IP_HEADERS)
  if (raw) {
    const nomi = raw.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)
    const sbagliato = nomi.find((h) => !/^[a-z0-9-]+$/.test(h))
    if (!nomi.length || sbagliato !== undefined) {
      throw new Error('AUTH_IP_HEADERS: serve una lista di nomi di header separati da virgole.')
    }
    return nomi
  }
  return presente(env.VERCEL) ? VERCEL_IP_HEADERS : null
}

const presente = (v: string | undefined) => (v && v.trim() ? v.trim() : null)

export function readAuthEnv(env: Env = process.env): AuthEnv {
  const production = env.NODE_ENV === 'production'
  // next build carica i moduli con NODE_ENV=production ma non manda email:
  // la chiave di Resend si pretende all'avvio del server (instrumentation.ts),
  // non sulla macchina che compila.
  const building = env.NEXT_PHASE === 'phase-production-build'
  const baseURL = presente(env.BETTER_AUTH_URL)
  const secret = presente(env.BETTER_AUTH_SECRET)
  const mancano = [
    !baseURL && 'BETTER_AUTH_URL',
    !secret && 'BETTER_AUTH_SECRET',
    // In produzione il link per email deve partire davvero: senza chiave
    // il sito accetterebbe le richieste e non manderebbe niente.
    production && !building && !presente(env.RESEND_API_KEY) && 'RESEND_API_KEY',
    production && !building && !presente(env.EMAIL_FROM) && 'EMAIL_FROM',
  ].filter(Boolean)
  if (mancano.length) {
    throw new Error(`Accesso non configurato: manca ${mancano.join(', ')} (in .env.local in sviluppo).`)
  }

  const providers: AuthEnv['providers'] = {}
  for (const { id } of PROVIDERS) {
    const clientId = presente(env[`${id.toUpperCase()}_CLIENT_ID`])
    const clientSecret = presente(env[`${id.toUpperCase()}_CLIENT_SECRET`])
    if (clientId && clientSecret) providers[id] = { clientId, clientSecret }
  }

  return {
    production,
    baseURL: baseURL!,
    secret: secret!,
    providers,
    resendApiKey: presente(env.RESEND_API_KEY),
    emailFrom: presente(env.EMAIL_FROM) ?? 'Dokkan Team Sharing <login@localhost>',
    ipAddressHeaders: readIpAddressHeaders(env),
  }
}

/** I provider attivi, nell'ordine dei bottoni. Per la pagina di accesso. */
export function enabledProviders(env: AuthEnv): { id: ProviderId; label: string }[] {
  return PROVIDERS.filter((p) => env.providers[p.id])
}
