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
  }
}

/** I provider attivi, nell'ordine dei bottoni. Per la pagina di accesso. */
export function enabledProviders(env: AuthEnv): { id: ProviderId; label: string }[] {
  return PROVIDERS.filter((p) => env.providers[p.id])
}
