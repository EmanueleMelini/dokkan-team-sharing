import { readAuthEnv } from '@/lib/auth/env'

// Le variabili del digest email, sopra quelle dell'accesso: nessuna
// variabile obbligatoria nuova. La chiave dei link di disiscrizione si
// deriva da BETTER_AUTH_SECRET (lib/notify/token.ts), l'indirizzo e la
// chiave di Resend sono quelli dei magic link. Unica aggiunta, facoltativa:
// EMAIL_NOTIFY_FROM, per mandare il digest da un indirizzo diverso dello
// stesso dominio (per esempio notify@...), cosi' chi lo segna come spam
// non lo confonde con i link di accesso. Nessun valore va mai stampato.

type Env = Record<string, string | undefined>

export type NotifyEnv = {
  production: boolean
  /** BETTER_AUTH_URL senza la barra finale: la base dei link nell'email. */
  baseURL: string
  secret: string
  resendApiKey: string | null
  from: string
}

export function readNotifyEnv(env: Env = process.env): NotifyEnv {
  const a = readAuthEnv(env)
  const notifyFrom = env.EMAIL_NOTIFY_FROM?.trim()
  return {
    production: a.production,
    baseURL: a.baseURL.replace(/\/+$/, ''),
    secret: a.secret,
    resendApiKey: a.resendApiKey,
    from: notifyFrom || a.emailFrom,
  }
}
