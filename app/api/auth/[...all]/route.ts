import { toNextJsHandler } from 'better-auth/next-js'
import { auth } from '@/lib/auth/auth'

// Tutte le rotte di better-auth: callback OAuth, magic link, sessione,
// uscita. Le POST controllano da sole l'Origin contro BETTER_AUTH_URL.
export const { GET, POST } = toNextJsHandler(auth)
