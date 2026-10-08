// Il cookie indizio dts_signed_in=1: dice al browser che vale la pena
// chiedere /api/me. Non e' un segreto e non da' accesso a niente (la
// sessione vera e' httpOnly): chi lo falsifica fa solo partire una
// richiesta, che risponde {user:null} e lo cancella. Senza indizio chi
// guarda e' anonimo e non costa nessuna invocazione.
//
// Modulo puro: lo usano better-auth (config.ts), le azioni e /api/me.

export const HINT_COOKIE = 'dts_signed_in'

export type HintOptions = {
  httpOnly: false
  sameSite: 'lax'
  secure: boolean
  path: '/'
  maxAge: number
}

/** secure solo su https: su http://localhost il browser lo scarterebbe. */
export function hintOptions(baseURL: string, maxAge: number): HintOptions {
  return { httpOnly: false, sameSite: 'lax', secure: baseURL.startsWith('https://'), path: '/', maxAge }
}

/** Se document.cookie (o un header Cookie) contiene l'indizio. */
export function hasHint(cookieHeader: string | null | undefined): boolean {
  if (!cookieHeader) return false
  return cookieHeader.split(';').some((c) => c.trim() === `${HINT_COOKIE}=1`)
}
