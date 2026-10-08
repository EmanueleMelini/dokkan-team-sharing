// I rifiuti delle tip (0025) tradotti per chi usa il sito: si traduce il
// nome del vincolo, mai il testo del messaggio, che e' italiano. Modulo
// puro: lo usano le Server Action e il test che controlla che ogni nome
// 'tip_*' della migrazione abbia la sua frase.

import { friendlyClearError, type DbErrorLike } from '@/lib/clears/errors'
import { friendlyModerationError } from '@/lib/moderation/errors'

const CORPO = 'Tips need between 10 and 500 characters.'
const LINK = 'Links must be full https:// addresses. Shortened links are not accepted.'
const BERSAGLIO = 'That stage no longer exists. Reload the page.'
const DOPPIONE = 'You already posted this tip here.'
const VOTO = 'That vote could not be read. Reload the page.'

const BY_CONSTRAINT: Record<string, string> = {
  // i verbi (tip_fail)
  tip_body: CORPO,
  tip_link: LINK,
  tip_target: BERSAGLIO,
  tip_per_target: 'You already have 3 tips here. Edit one of them instead.',
  tip_duplicate: DOPPIONE,
  tip_missing: 'This tip is no longer available.',
  tip_not_yours: 'This tip does not exist or is not yours.',
  tip_vote_value: VOTO,
  tip_own_vote: 'You cannot vote on your own tip.',
  // i vincoli della tabella: li raggiunge solo chi scrive senza i verbi
  tip_tier_in_event: BERSAGLIO,
  tip_status_check: 'That status is not valid. Reload the page.',
  tip_body_len: CORPO,
  tip_link_ok: LINK,
  tip_link_provider: 'That link could not be read. Paste it again.',
  tip_no_duplicate: DOPPIONE,
  tip_vote_value_check: VOTO,
}

// Dal builder valgono solo questi due: gli altri nomi builder_* non
// arrivano dalle tip, e il 42501 generico di friendlyClearError parla di clear.
const DAL_BUILDER = new Set(['builder_author', 'builder_rate_limit'])

/**
 * La frase per un rifiuto, o null se e' un guasto (l'azione lo rilancia).
 * Prima le tip, poi la moderazione (account_suspended, report_* della
 * segnalazione di una tip), poi l'account incompleto e il limite per ora.
 */
export function friendlyTipError(e: DbErrorLike): string | null {
  if (e.constraint && BY_CONSTRAINT[e.constraint]) return BY_CONSTRAINT[e.constraint]
  const mod = friendlyModerationError(e)
  if (mod) return mod
  if (e.constraint && DAL_BUILDER.has(e.constraint)) return friendlyClearError(e)
  return null
}

/** I nomi dei vincoli di 0025, per il test che controlla le frasi. */
export const TIP_CONSTRAINTS = Object.keys(BY_CONSTRAINT)
