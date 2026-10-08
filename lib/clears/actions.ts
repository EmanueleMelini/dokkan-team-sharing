'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { DatabaseError } from 'pg'
import { sql, sqlOne } from '@/lib/db'
import { requireOnboardedUser } from '@/lib/dal'
import { friendlyClearError } from '@/lib/clears/errors'
import {
  parseBigintId, parseChangeNote, parseComment, parsePayloadField, parseUuid, parseVote,
} from '@/lib/clears/validate'

// Le Server Action dei clear. Ognuna e' un endpoint pubblico (una POST
// diretta la raggiunge): rilegge la sessione, valida tutto quello che
// arriva dal form, e non prende MAI l'id utente dall'input. Le regole
// vere (forma 2+2+3, ruoli, prove, proprieta', limiti per ora) le
// impone il database (0002, 0016): qui si risponde prima e con frasi
// chiare, e si traducono i rifiuti di Postgres.

export type ClearActionState = {
  ok?: boolean
  error?: string
  /** voteClear: il punteggio aggiornato della versione */
  score?: number
  /** addComment: l'id del commento nuovo */
  commentId?: string
}

/** Il rifiuto di Postgres come frase, o rilancia se e' un guasto. */
function dbError(e: unknown): ClearActionState {
  if (e instanceof DatabaseError) {
    const msg = friendlyClearError(e)
    if (msg) return { error: msg }
  }
  throw e
}

type Where = { event_id: string; reg: 'global' | 'japan' }

/** Dove sta un clear: l'evento e la regione, dal database e non dal form. */
async function whereIsClear(clearId: string): Promise<Where | null> {
  return sqlOne<Where>(
    `select c.event_id::text, r.reg::text from clear c join event_run r on r.id = c.run_id
     where c.id = $1::uuid`,
    [clearId],
  )
}

async function whereIsVersion(versionId: string): Promise<Where | null> {
  return sqlOne<Where>(
    `select c.event_id::text, r.reg::text from clear_version v
     join clear c on c.id = v.clear_id join event_run r on r.id = c.run_id
     where v.id = $1::uuid`,
    [versionId],
  )
}

/** La pagina dell'evento e la lista: i conteggi dei clear cambiano in entrambe. */
function refresh(w: Where | null) {
  if (!w) return
  revalidatePath(`/events/${w.event_id}`)
  revalidatePath('/events')
}

function clearHref(w: Where, tierId: string, clearId: string) {
  const qs = new URLSearchParams({ ...(w.reg === 'japan' ? { region: 'japan' } : {}), tier: tierId })
  return `/events/${w.event_id}?${qs}#clear-${clearId}`
}

/** Invia un clear dal builder. Se riesce porta al clear, nella pagina dell'evento. */
export async function submitClear(_prev: ClearActionState, form: FormData): Promise<ClearActionState> {
  const eventHint = parseBigintId(form.get('event'))
  const user = await requireOnboardedUser(eventHint ? `/events/${eventHint}` : '/events')
  const run = parseBigintId(form.get('run'))
  const tier = parseBigintId(form.get('tier'))
  if (!run || !tier) return { error: 'Pick the difficulty and the run you cleared.' }
  const payload = parsePayloadField(form.get('payload'))
  if (!payload.ok) return { error: payload.error }

  let clearId: string
  try {
    const r = await sqlOne<{ id: string }>(
      'select submit_clear_from_builder($1::uuid, $2::bigint, $3::bigint, $4::jsonb)::text as id',
      [user.id, run, tier, JSON.stringify(payload.value)],
    )
    clearId = r!.id
  } catch (e) {
    return dbError(e)
  }
  const w = await whereIsClear(clearId)
  refresh(w)
  redirect(w ? clearHref(w, tier, clearId) : '/events')
}

/**
 * Una revisione: una versione nuova, con il motivo. Anche questa porta al
 * clear se riesce: e' li' che si vede la versione appena creata.
 */
export async function reviseClear(_prev: ClearActionState, form: FormData): Promise<ClearActionState> {
  const clearId = parseUuid(form.get('clear'))
  const user = await requireOnboardedUser('/events')
  if (!clearId) return { error: 'This clear does not exist or is not yours.' }
  const reason = parseChangeNote(form.get('change_note'))
  if (!reason.ok) return { error: reason.error }
  const payload = parsePayloadField(form.get('payload'))
  if (!payload.ok) return { error: payload.error }

  try {
    await sql('select revise_clear_from_builder($1::uuid, $2::uuid, $3, $4::jsonb)',
      [user.id, clearId, reason.value, JSON.stringify(payload.value)])
  } catch (e) {
    return dbError(e)
  }
  const w = await sqlOne<Where & { tier_id: string }>(
    `select c.event_id::text, r.reg::text, c.stage_tier_id::text as tier_id
     from clear c join event_run r on r.id = c.run_id where c.id = $1::uuid`,
    [clearId],
  )
  refresh(w)
  redirect(w ? clearHref(w, w.tier_id, clearId) : '/events')
}

/** Cancella un clear dell'utente, con versioni, voti e commenti. */
export async function deleteClear(_prev: ClearActionState, form: FormData): Promise<ClearActionState> {
  const user = await requireOnboardedUser('/events')
  const clearId = parseUuid(form.get('clear'))
  if (!clearId) return { error: 'This clear does not exist or is not yours.' }
  // prima della cancellazione: dopo non si saprebbe piu' quale pagina rinfrescare
  const w = await whereIsClear(clearId)
  try {
    await sql('select delete_clear($1::uuid, $2::uuid)', [user.id, clearId])
  } catch (e) {
    return dbError(e)
  }
  refresh(w)
  return { ok: true }
}

/** Vota la versione corrente: 1, -1, oppure 0 per ritirare il voto. */
export async function voteClear(_prev: ClearActionState, form: FormData): Promise<ClearActionState> {
  const user = await requireOnboardedUser('/events')
  const versionId = parseUuid(form.get('version'))
  const value = parseVote(form.get('value'))
  if (!versionId || value === null) return { error: 'That vote could not be read. Reload the page.' }
  let score: number
  try {
    const r = await sqlOne<{ score: number }>(
      'select vote_clear_version($1::uuid, $2::uuid, $3::smallint) as score',
      [user.id, versionId, value],
    )
    score = r!.score
  } catch (e) {
    return dbError(e)
  }
  refresh(await whereIsVersion(versionId))
  return { ok: true, score }
}

/** Un commento sulla versione corrente. */
export async function addComment(_prev: ClearActionState, form: FormData): Promise<ClearActionState> {
  const user = await requireOnboardedUser('/events')
  const versionId = parseUuid(form.get('version'))
  if (!versionId) return { error: 'This clear is no longer available.' }
  const body = parseComment(form.get('body'))
  if (!body.ok) return { error: body.error }
  const rawLang = form.get('lang')
  const lang = rawLang === 'en' || rawLang === 'ja' ? rawLang : null
  let commentId: string
  try {
    const r = await sqlOne<{ id: string }>(
      'select comment_clear_version($1::uuid, $2::uuid, $3, $4)::text as id',
      [user.id, versionId, body.value, lang],
    )
    commentId = r!.id
  } catch (e) {
    return dbError(e)
  }
  refresh(await whereIsVersion(versionId))
  return { ok: true, commentId }
}
