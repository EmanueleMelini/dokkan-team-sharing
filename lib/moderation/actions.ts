'use server'

import { revalidatePath } from 'next/cache'
import { DatabaseError } from 'pg'
import { sqlOne } from '@/lib/db'
import { sessionIsFresh } from '@/lib/dal'
import { clearCardIds } from '@/lib/clears'
import { parseUuid } from '@/lib/clears/validate'
import { afterClearWrite, afterUserChanged, invalidateEvent } from '@/lib/cache/invalidate'
import { requireAdmin } from '@/lib/moderation/guard'
import { friendlyModerationError } from '@/lib/moderation/errors'
import { NOTE_MAX, SUSPENSION_REASON_MAX } from '@/lib/moderation/reasons'

// Le Server Action dei moderatori. Ognuna e' un endpoint pubblico: rifa'
// requireAdmin (un non admin riceve notFound), valida ogni campo, e l'id
// di chi agisce viene solo dalla sessione. Le regole vere (ruolo, stato,
// chi si puo' sospendere) le impongono le funzioni mod_* di 0024. Gli id
// per invalidare la cache vengono dal database, mai dal form.

export type ModState = {
  ok?: boolean
  /** la frase di conferma: "Clear hidden. 2 reports closed." */
  message?: string
  error?: string
  /** la sessione ha piu' di 15 minuti: prima si rientra (sospensioni) */
  reauth?: boolean
}

/** Il rifiuto di Postgres come frase, o rilancia se e' un guasto. */
function dbError(e: unknown): ModState {
  if (e instanceof DatabaseError) {
    const msg = friendlyModerationError(e)
    if (msg) return { error: msg }
  }
  throw e
}

/** La nota facoltativa: vuota = null, troppo lunga = undefined. */
function parseNota(v: FormDataEntryValue | null, max = NOTE_MAX): string | null | undefined {
  const s = typeof v === 'string' ? v.trim() : ''
  if ([...s].length > max) return undefined
  return s || null
}

function parseStato(v: FormDataEntryValue | null): 'published' | 'hidden' | null {
  return v === 'published' || v === 'hidden' ? v : null
}

const chiusi = (n: number) => (n === 0 ? '' : n === 1 ? ' 1 report closed.' : ` ${n} reports closed.`)

/** Le pagine admin rileggono la coda; non tocca la cache delle pagine pubbliche. */
const rinfrescaAdmin = () => revalidatePath('/admin', 'layout')

/** Nasconde o rimette un clear. */
export async function setClearStatus(_prev: ModState, form: FormData): Promise<ModState> {
  const mod = await requireAdmin()
  const clearId = parseUuid(form.get('clear'))
  const status = parseStato(form.get('status'))
  const note = parseNota(form.get('note'))
  if (!clearId || !status) return { error: 'This clear could not be read. Reload the page.' }
  if (note === undefined) return { error: `Keep the note under ${NOTE_MAX} characters.` }

  let n: number
  try {
    const r = await sqlOne<{ n: number }>('select mod_set_clear_status($1::uuid, $2::uuid, $3, $4) as n',
      [mod.id, clearId, status, note])
    n = r?.n ?? 0
  } catch (e) {
    return dbError(e)
  }
  // Dopo: il clear esiste ancora (nascosto non e' cancellato), id dal database
  const [w, carte] = await Promise.all([
    sqlOne<{ event_id: string; handle: string | null }>(
      `select c.event_id::text, u.handle::text from clear c
       left join app_user u on u.id = c.author_id where c.id = $1::uuid`,
      [clearId],
    ),
    clearCardIds(clearId),
  ])
  // nascondere e' come cancellare per chi legge (e rimettere come inviare):
  // evento, carte e profilo subito, la lista degli eventi poco dopo
  if (w) afterClearWrite('delete', { eventId: w.event_id, cardIds: carte, handles: w.handle ? [w.handle] : [] })
  rinfrescaAdmin()
  return { ok: true, message: status === 'hidden' ? `Clear hidden.${chiusi(n)}` : 'Clear visible again.' }
}

/** Nasconde o rimette un commento. */
export async function setCommentStatus(_prev: ModState, form: FormData): Promise<ModState> {
  const mod = await requireAdmin()
  const commentId = parseUuid(form.get('comment'))
  const status = parseStato(form.get('status'))
  const note = parseNota(form.get('note'))
  if (!commentId || !status) return { error: 'This comment could not be read. Reload the page.' }
  if (note === undefined) return { error: `Keep the note under ${NOTE_MAX} characters.` }

  let n: number
  try {
    const r = await sqlOne<{ n: number }>('select mod_set_comment_status($1::uuid, $2::uuid, $3, $4) as n',
      [mod.id, commentId, status, note])
    n = r?.n ?? 0
  } catch (e) {
    return dbError(e)
  }
  const w = await sqlOne<{ event_id: string }>(
    `select c.event_id::text from clear_comment m
     join clear_version v on v.id = m.version_id join clear c on c.id = v.clear_id
     where m.id = $1::uuid`,
    [commentId],
  )
  if (w) afterClearWrite('comment', { eventId: w.event_id })
  rinfrescaAdmin()
  return { ok: true, message: status === 'hidden' ? `Comment hidden.${chiusi(n)}` : 'Comment visible again.' }
}

/** Nasconde o rimette una tip (mod_set_tip_status, 0025). */
export async function setTipStatus(_prev: ModState, form: FormData): Promise<ModState> {
  const mod = await requireAdmin()
  const tipId = parseUuid(form.get('tip'))
  const status = parseStato(form.get('status'))
  const note = parseNota(form.get('note'))
  if (!tipId || !status) return { error: 'This tip could not be read. Reload the page.' }
  if (note === undefined) return { error: `Keep the note under ${NOTE_MAX} characters.` }

  let n: number
  try {
    const r = await sqlOne<{ n: number }>('select mod_set_tip_status($1::uuid, $2::uuid, $3, $4) as n',
      [mod.id, tipId, status, note])
    n = r?.n ?? 0
  } catch (e) {
    return dbError(e)
  }
  // la tip esiste ancora (nascosta non e' cancellata): l'evento dal database
  const w = await sqlOne<{ event_id: string }>('select event_id::text from tip where id = $1::uuid', [tipId])
  if (w) invalidateEvent(w.event_id, 'now')
  rinfrescaAdmin()
  return { ok: true, message: status === 'hidden' ? `Tip hidden.${chiusi(n)}` : 'Tip visible again.' }
}

/** Archivia le segnalazioni aperte su un bersaglio, senza toccare il contenuto. */
export async function dismissReports(_prev: ModState, form: FormData): Promise<ModState> {
  const mod = await requireAdmin()
  const kind = form.get('kind')
  const target = parseUuid(form.get('target'))
  const note = parseNota(form.get('note'))
  if ((kind !== 'clear' && kind !== 'comment' && kind !== 'tip') || !target) {
    return { error: 'These reports could not be read. Reload the page.' }
  }
  if (note === undefined) return { error: `Keep the note under ${NOTE_MAX} characters.` }
  let n: number
  try {
    const r = await sqlOne<{ n: number }>('select mod_dismiss_reports($1::uuid, $2, $3::uuid, $4) as n',
      [mod.id, kind, target, note])
    n = r?.n ?? 0
  } catch (e) {
    return dbError(e)
  }
  // le segnalazioni non si vedono nelle pagine pubbliche: solo l'admin
  rinfrescaAdmin()
  return { ok: true, message: n === 0 ? 'There were no open reports left.' : `Dismissed.${chiusi(n)}` }
}

/** Le durate del form, in giorni; null = a tempo indeterminato. */
const DURATE: Record<string, number | null> = { '1d': 1, '7d': 7, '30d': 30, indefinite: null }

const RIENTRA: ModState = { reauth: true, error: 'Sign in again to do this.' }

/** Sospende un utente. Chiede una sessione fresca, come le azioni di Settings. */
export async function suspendUser(_prev: ModState, form: FormData): Promise<ModState> {
  const mod = await requireAdmin()
  if (!(await sessionIsFresh())) return RIENTRA
  const userId = parseUuid(form.get('user'))
  const durata = String(form.get('duration') ?? '')
  const reason = parseNota(form.get('reason'), SUSPENSION_REASON_MAX)
  if (!userId) return { error: 'This user could not be read. Reload the page.' }
  if (!(durata in DURATE)) return { error: 'Choose how long the suspension lasts.' }
  if (reason === undefined) return { error: `Keep the reason under ${SUSPENSION_REASON_MAX} characters.` }

  try {
    // la data la calcola Postgres: niente orologio del server nel mezzo
    await sqlOne(
      `select mod_suspend_user($1::uuid, $2::uuid,
         case when $3::int is null then null else now() + make_interval(days => $3::int) end, $4)`,
      [mod.id, userId, DURATE[durata], reason],
    )
  } catch (e) {
    return dbError(e)
  }
  await afterUserChanged(userId)
  rinfrescaAdmin()
  return { ok: true, message: 'User suspended.' }
}

/** Toglie la sospensione. Anche questa con una sessione fresca. */
export async function unsuspendUser(_prev: ModState, form: FormData): Promise<ModState> {
  const mod = await requireAdmin()
  if (!(await sessionIsFresh())) return RIENTRA
  const userId = parseUuid(form.get('user'))
  const note = parseNota(form.get('note'))
  if (!userId) return { error: 'This user could not be read. Reload the page.' }
  if (note === undefined) return { error: `Keep the note under ${NOTE_MAX} characters.` }
  let era: boolean
  try {
    const r = await sqlOne<{ era: boolean }>('select mod_unsuspend_user($1::uuid, $2::uuid, $3) as era',
      [mod.id, userId, note])
    era = r?.era === true
  } catch (e) {
    return dbError(e)
  }
  if (era) await afterUserChanged(userId)
  rinfrescaAdmin()
  return { ok: true, message: era ? 'Suspension lifted.' : 'This user was not suspended any more.' }
}
