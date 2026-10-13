import 'server-only'
import { cookies } from 'next/headers'
import { VERSIONE_COOKIE, type Versione } from '@/lib/versione/versione'

// La versione di chi fa la richiesta, dal cookie dts_version. Solo per le
// Server Action, le rotte e le pagine per utente (/welcome): una pagina in
// cache che la leggesse diventerebbe diversa per chi guarda, e non
// starebbe piu' in cache. eslint.config.mjs lo vieta a lib/cache,
// components e alle pagine pubbliche.

export async function versioneRichiesta(): Promise<Versione> {
  return (await cookies()).get(VERSIONE_COOKIE)?.value === 'japan' ? 'japan' : 'global'
}
