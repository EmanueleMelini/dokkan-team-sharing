import { cookies } from 'next/headers'
import type { NextRequest } from 'next/server'
import { currentUser } from '@/lib/dal'
import { viewerTierState } from '@/lib/clears'
import { viewerTipState } from '@/lib/tips'
import { parseBigintId } from '@/lib/clears/validate'
import { readAuthEnv } from '@/lib/auth/env'
import { SESSION_DAYS } from '@/lib/auth/config'
import { HINT_COOKIE, hintOptions } from '@/lib/viewer/hint'
import type { MeResponse } from '@/lib/viewer/types'
import { viewerUserOf } from '@/lib/viewer/utente'

// Chi guarda, per le isole client delle pagine in cache: l'utente e, con
// ?tier=<id>, i suoi voti, i suoi clear, i suoi commenti e i punteggi vivi
// di quel tier, piu' le sue tip e i suoi "helpful" (tier ed evento).
// Una richiesta per pagina vista, e solo da chi ha l'indizio dts_signed_in.
//
// private, no-store e Vary: Cookie: nessuna cache condivisa la tiene.
// Nessun header CORS: un altro sito non puo' leggere la risposta.
const HEADERS = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' }

export async function GET(request: NextRequest) {
  const [user, jar] = await Promise.all([currentUser(), cookies()])
  const maxAge = SESSION_DAYS * 24 * 60 * 60
  const opzioni = hintOptions(readAuthEnv().baseURL, maxAge)

  if (!user) {
    // L'indizio senza sessione (scaduta, revocata, falsificato) si toglie:
    // le prossime pagine non chiederanno piu'.
    if (jar.has(HINT_COOKIE)) jar.set(HINT_COOKIE, '', { ...opzioni, maxAge: 0 })
    return Response.json({ user: null } satisfies MeResponse, { headers: HEADERS })
  }
  // Rinnovato a ogni visita: la sessione scorre (updateAge), l'indizio con lei.
  jar.set(HINT_COOKIE, '1', opzioni)

  // isAdmin e la sospensione li legge la sessione: niente cache nel cookie
  // (config.ts), quindi un cambio di ruolo vale dalla richiesta dopo.
  const body: MeResponse = { user: viewerUserOf(user) }
  const tier = parseBigintId(request.nextUrl.searchParams.get('tier'))
  // Senza handle non si vota e non si invia: niente da dire sul tier.
  if (tier && user.onboarded) {
    // ogni sezione e' una funzione sua, in parallelo: una richiesta sola
    const [clear, tips] = await Promise.all([viewerTierState(user.id, tier), viewerTipState(user.id, tier)])
    body.tier = { ...clear, ...tips }
  }
  return Response.json(body, { headers: HEADERS })
}
