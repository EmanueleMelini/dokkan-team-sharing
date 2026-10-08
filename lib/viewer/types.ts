// Quello che /api/me dice a chi guarda. Le pagine pubbliche sono in cache e
// uguali per tutti (la versione anonima): tutto cio' che dipende
// dall'utente arriva da qui, nelle isole client (components/viewer).
//
// Le fasi dopo aggiungono campi (isAdmin, ownComments, tipVotes...): ogni
// sezione nuova e' opzionale, cosi' un client vecchio la ignora.

export type ViewerUser = {
  handle: string
  onboarded: boolean
  prefersAnimated: boolean
}

export type ViewerTierData = {
  /** version_id -> il voto di chi guarda */
  votes: Record<string, -1 | 1>
  /** i clear di chi guarda in questo tier */
  own: string[]
  /** version_id -> punteggio vivo: la copia della CDN puo' essere vecchia di un voto */
  scores: Record<string, number>
}

export type MeResponse = {
  user: ViewerUser | null
  tier?: ViewerTierData
}

/** unknown: non ancora saputo (il primo render, uguale all'HTML statico). */
export type ViewerMode = 'unknown' | 'anon' | 'setup' | 'ready'

export const modeOf = (user: ViewerUser | null | undefined): Exclude<ViewerMode, 'unknown'> =>
  !user ? 'anon' : user.onboarded ? 'ready' : 'setup'
