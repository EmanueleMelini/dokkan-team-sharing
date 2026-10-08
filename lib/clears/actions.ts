'use server'

import { redirect } from 'next/navigation'
import { DatabaseError } from 'pg'
import { sql, sqlOne } from '@/lib/db'
import { requireOnboardedUser } from '@/lib/dal'
import { clearCardIds } from '@/lib/clears'
import { clearPage } from '@/lib/queries'
import { afterClearWrite } from '@/lib/cache/invalidate'
import { clearAnchor, eventHref } from '@/lib/urls'
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

type Where = { event_id: string; reg: 'global' | 'japan'; tier_id: string }

/** Dove sta un clear: l'evento, la regione e il tier, dal database e non dal form. */
async function whereIsClear(clearId: string): Promise<Where | null> {
  return sqlOne<Where>(
    `select c.event_id::text, r.reg::text, c.stage_tier_id::text as tier_id
     from clear c join event_run r on r.id = c.run_id
     where c.id = $1::uuid`,
    [clearId],
  )
}

async function whereIsVersion(versionId: string): Promise<Where | null> {
  return sqlOne<Where>(
    `select c.event_id::text, r.reg::text, c.stage_tier_id::text as tier_id from clear_version v
     join clear c on c.id = v.clear_id join event_run r on r.id = c.run_id
     where v.id = $1::uuid`,
    [versionId],
  )
}

// L'invalidazione della cache per ogni scrittura sta in lib/cache/tags.ts
// (tagsFor): l'evento subito per invio, revisione, cancellazione e
// commento; il voto senza rigenerare la pagina nella risposta.

/** Il clear nella pagina del suo tier, alla pagina dove la lista lo mostra. */
async function clearHref(w: Where, clearId: string) {
  const page = (await clearPage(w.tier_id, w.reg, clearId)) ?? 1
  return eventHref({ id: w.event_id, reg: w.reg, tier: w.tier_id, page }) + clearAnchor(clearId)
}

/** Invia un clear dal builder. Se riesce porta al clear, nella pagina dell'evento. */
export async function submitClear(_prev: ClearActionState, form: FormData): Promise<ClearActionState> {
  const eventHint = parseBigintId(form.get('event'))
  const user = await requireOnboardedUser(eventHint ? eventHref({ id: eventHint }) : '/events')
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
  if (w) afterClearWrite('submit', { eventId: w.event_id, cardIds: await clearCardIds(clearId), handles: [user.handle] })
  redirect(w ? await clearHref(w, clearId) : '/events')
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
  const w = await whereIsClear(clearId)
  // le carte di tutte le versioni: quelle tolte e quelle nuove
  if (w) afterClearWrite('revise', { eventId: w.event_id, cardIds: await clearCardIds(clearId), handles: [user.handle] })
  redirect(w ? await clearHref(w, clearId) : '/events')
}

/** Cancella un clear dell'utente, con versioni, voti e commenti. */
export async function deleteClear(_prev: ClearActionState, form: FormData): Promise<ClearActionState> {
  const user = await requireOnboardedUser('/events')
  const clearId = parseUuid(form.get('clear'))
  if (!clearId) return { error: 'This clear does not exist or is not yours.' }
  // prima della cancellazione: dopo non si saprebbe piu' quali pagine rinfrescare
  const [w, carte] = await Promise.all([whereIsClear(clearId), clearCardIds(clearId)])
  try {
    await sql('select delete_clear($1::uuid, $2::uuid)', [user.id, clearId])
  } catch (e) {
    return dbError(e)
  }
  if (w) afterClearWrite('delete', { eventId: w.event_id, cardIds: carte, handles: [user.handle] })
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
  const w = await whereIsVersion(versionId)
  if (w) afterClearWrite('vote', { eventId: w.event_id })
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
  const w = await whereIsVersion(versionId)
  if (w) afterClearWrite('comment', { eventId: w.event_id })
  return { ok: true, commentId }
}
