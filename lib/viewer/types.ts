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
  /** il link 'Moderation' nell'header (role = 'admin'); /admin ricontrolla da se' */
  isAdmin?: boolean
  /** solo se la sospensione e' in corso: una data ISO o 'infinity' (lib/moderation/sospensione.ts) */
  suspendedUntil?: string | null
  suspended?: boolean
  /** il motivo, mostrato nel banner solo all'interessato */
  suspensionReason?: string | null
}

export type ViewerTierData = {
  /** version_id -> il voto di chi guarda */
  votes: Record<string, -1 | 1>
  /** i clear di chi guarda in questo tier */
  own: string[]
  /** version_id -> punteggio vivo: la copia della CDN puo' essere vecchia di un voto */
  scores: Record<string, number>
  /** i commenti di chi guarda nel tier: su quelli non c'e' Report */
  ownComments?: string[]
  /** le tip (del tier e di tutto l'evento) che chi guarda ha segnato come utili */
  tipVotes?: string[]
  /** le sue tip: Edit e Delete al posto di voto e Report */
  ownTips?: string[]
  /** tip id -> punteggio vivo, come scores per i clear */
  tipScores?: Record<string, number>
}

export type MeResponse = {
  user: ViewerUser | null
  tier?: ViewerTierData
}

/** unknown: non ancora saputo (il primo render, uguale all'HTML statico). */
export type ViewerMode = 'unknown' | 'anon' | 'setup' | 'ready'

export const modeOf = (user: ViewerUser | null | undefined): Exclude<ViewerMode, 'unknown'> =>
  !user ? 'anon' : user.onboarded ? 'ready' : 'setup'

/** Chi puo' segnalare, votare e commentare: entrato, con l'handle, non sospeso. */
export const canWrite = (user: ViewerUser | null | undefined): boolean =>
  !!user && user.onboarded && user.suspended !== true
