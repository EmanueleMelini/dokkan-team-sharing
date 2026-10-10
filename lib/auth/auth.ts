import 'server-only'
import { nextCookies } from 'better-auth/next-js'
import { createAuth } from '@/lib/auth/config'
import { createMagicLinkSender } from '@/lib/auth/email'
import { enabledProviders, readAuthEnv } from '@/lib/auth/env'
import { countAuthEmail } from '@/lib/notify/budget'

// Nessuna cache su globalThis (a differenza della pool di lib/db.ts):
// l'istanza non apre connessioni sue, e ricrearla a ogni ricarica di
// sviluppo e' cio' che fa vedere subito una modifica alla configurazione.
const env = readAuthEnv()

export const auth = createAuth({
  env,
  sendMagicLink: createMagicLinkSender(env, { countSend: () => countAuthEmail() }),
  plugins: [nextCookies()], // l'ultimo: scrive i cookie dalle Server Action
})

/** I provider attivi, per i bottoni di /login e /settings. Solo id ed etichetta. */
export const providers = enabledProviders(env)
