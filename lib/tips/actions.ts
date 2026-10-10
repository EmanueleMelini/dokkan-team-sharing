'use server'

import { DatabaseError } from 'pg'
import { sqlOne } from '@/lib/db'
import { requireOnboardedUser } from '@/lib/dal'
import { tipEvent } from '@/lib/tips'
import { invalidateEvent } from '@/lib/cache/invalidate'
import { eventHref } from '@/lib/urls'
import { parseBigintId, parseUuid } from '@/lib/clears/validate'
import { friendlyTipError } from '@/lib/tips/errors'
import {
  parseTipBody, parseTipLink, parseTipScope, parseTipVote, type TipActionState,
} from '@/lib/tips/validate'
import { REPORT_THANKS, type ReportActionState } from '@/lib/moderation/report-form'
import { cleanDetails, isReasonFor } from '@/lib/moderation/reasons'
import { kickPush } from '@/lib/notify/kick'

// Le Server Action delle tip. Come quelle dei clear: endpoint pubblici,
// l'utente solo dalla sessione, ogni campo controllato, le regole vere nei
// verbi di 0025 (che rifiutano anche chi e' sospeso). L'evento da
// invalidare viene dal database, mai dal form: scrivere, modificare e
// cancellare lo rigenerano subito, un voto solo alla prossima visita.

const MANCANTE = 'This tip is no longer available.'

/** Il rifiuto di Postgres come frase, o rilancia se e' un guasto. */
function dbError(e: unknown): { error: string } {
  if (e instanceof DatabaseError) {
    const msg = friendlyTipError(e)
    if (msg) return { error: msg }
  }
  throw e
}

/** Una tip nuova, sul tier mostrato (scope=stage) o su tutto l'evento. */
export async function postTip(_prev: TipActionState, form: FormData): Promise<TipActionState> {
  const eventId = parseBigintId(form.get('event'))
  const user = await requireOnboardedUser(eventId ? eventHref({ id: eventId }) : '/events')
  const scope = parseTipScope(form.get('scope'))
  const tierId = scope === 'stage' ? parseBigintId(form.get('tier')) : null
  if (!eventId || !scope || (scope === 'stage' && !tierId)) {
    return { error: 'That stage no longer exists. Reload the page.' }
  }
  const body = parseTipBody(form.get('body'))
  if (!body.ok) return { error: body.error }
  const link = parseTipLink(form.get('link'))
  if (!link.ok) return { error: link.error }

  let tipId: string
  try {
    const r = await sqlOne<{ id: string }>(
      'select post_tip($1::uuid, $2::bigint, $3::bigint, $4, $5)::text as id',
      [user.id, eventId, tierId, body.value, link.value],
    )
    tipId = r!.id
  } catch (e) {
    return dbError(e)
  }
  const evento = await tipEvent(tipId)
  if (evento) invalidateEvent(evento, 'now')
  return { ok: true, tipId }
}

/** Testo e link nuovi su una propria tip: i voti restano. */
export async function editTip(_prev: TipActionState, form: FormData): Promise<TipActionState> {
  const user = await requireOnboardedUser('/events')
  const tipId = parseUuid(form.get('tip'))
  if (!tipId) return { error: MANCANTE }
  const body = parseTipBody(form.get('body'))
  if (!body.ok) return { error: body.error }
  const link = parseTipLink(form.get('link'))
  if (!link.ok) return { error: link.error }

  let evento: string
  try {
    const r = await sqlOne<{ event_id: string }>(
      'select edit_tip($1::uuid, $2::uuid, $3, $4)::text as event_id',
      [user.id, tipId, body.value, link.value],
    )
    evento = r!.event_id
  } catch (e) {
    return dbError(e)
  }
  invalidateEvent(evento, 'now')
  return { ok: true }
}

/** Cancella una propria tip, con i voti e le segnalazioni. Anche da sospesi. */
export async function deleteTip(_prev: TipActionState, form: FormData): Promise<TipActionState> {
  const user = await requireOnboardedUser('/events')
  const tipId = parseUuid(form.get('tip'))
  if (!tipId) return { error: 'This tip does not exist or is not yours.' }
  let evento: string
  try {
    const r = await sqlOne<{ event_id: string }>(
      'select delete_tip($1::uuid, $2::uuid)::text as event_id', [user.id, tipId])
    evento = r!.event_id
  } catch (e) {
    return dbError(e)
  }
  invalidateEvent(evento, 'now')
  return { ok: true }
}

/** "Helpful": 1, o 0 per ritirarlo. Torna il punteggio; la pagina non si rigenera ora. */
export async function voteTip(_prev: TipActionState, form: FormData): Promise<TipActionState> {
  const user = await requireOnboardedUser('/events')
  const tipId = parseUuid(form.get('tip'))
  const value = parseTipVote(form.get('value'))
  if (!tipId || value === null) return { error: 'That vote could not be read. Reload the page.' }
  let score: number
  try {
    const r = await sqlOne<{ score: number }>(
      'select vote_tip($1::uuid, $2::uuid, $3::smallint) as score', [user.id, tipId, value])
    score = r!.score
  } catch (e) {
    return dbError(e)
  }
  const evento = await tipEvent(tipId)
  if (evento) invalidateEvent(evento, 'soon')
  return { ok: true, score }
}

/**
 * La segnalazione di una tip: report_content con kind 'tip' (0025). Lo
 * stesso stato e lo stesso grazie del Report di clear e commenti, cosi'
 * il componente e' lo stesso. Nessuna invalidazione: una segnalazione non
 * cambia nessuna pagina pubblica.
 */
export async function reportTip(_prev: ReportActionState, form: FormData): Promise<ReportActionState> {
  const user = await requireOnboardedUser('/events')
  const tipId = parseUuid(form.get('target'))
  if (!tipId) return { error: MANCANTE }
  const reason = form.get('reason')
  if (!isReasonFor('tip', reason)) return { error: 'Pick one of the reasons in the list.' }
  const details = cleanDetails(reason, form.get('details'))
  if (details === undefined) return { error: 'Tell us what is wrong, in under 500 characters.' }
  try {
    await sqlOne('select report_content($1::uuid, $2, $3::uuid, $4, $5) as id',
      [user.id, 'tip', tipId, reason, details])
  } catch (e) {
    return dbError(e)
  }
  // gli admin hanno una notifica (0028): la push, se l'hanno accesa
  kickPush()
  return { ok: true, message: REPORT_THANKS }
}
