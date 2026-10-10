'use server'

import { revalidatePath } from 'next/cache'
import { DatabaseError } from 'pg'
import { sql } from '@/lib/db'
import { requireOnboardedUser } from '@/lib/dal'
import { unsubscribeWithToken } from '@/lib/notify/unsubscribe'

// Le Server Action del digest email (0029) e del feed degli admin (0032).
// Come le altre, ognuna e' un endpoint pubblico: rilegge la sessione da
// sola e non prende mai un id utente dal client. La disiscrizione dal link
// e' l'eccezione voluta: non guarda la sessione, decide solo il token firmato.

export type EmailDigestState = { saved?: boolean; on?: boolean; error?: string }

/** La casella "Daily email digest" di Settings. */
export async function setEmailDigestAction(_prev: EmailDigestState, form: FormData): Promise<EmailDigestState> {
  const user = await requireOnboardedUser('/settings')
  const on = form.get('digest') === 'on'
  try {
    await sql('select set_email_digest($1::uuid, $2)', [user.id, on])
  } catch (e) {
    if (e instanceof DatabaseError && e.constraint === 'email_not_verified') {
      return { error: 'Verify your email first: sign in once with the email link.' }
    }
    if (e instanceof DatabaseError && e.constraint === 'user_not_found') {
      return { error: 'Finish setting up your account first.' }
    }
    throw e
  }
  // /settings e' per utente e dinamica: si tocca solo la sua copia nella
  // cache del router.
  revalidatePath('/settings')
  return { saved: true, on }
}

export type UnsubscribeState = { done?: boolean; error?: string }

/** Il bottone della pagina /notifications/unsubscribe: il token arriva dal campo nascosto. */
export async function unsubscribeAction(_prev: UnsubscribeState, form: FormData): Promise<UnsubscribeState> {
  const esito = await unsubscribeWithToken(form.get('t'))
  if (esito !== 'ok') {
    return { error: 'This link is no longer valid. You can turn the digest off in Settings.' }
  }
  return { done: true }
}

export type SiteActivityState = { saved?: boolean; on?: boolean; error?: string }

const SOLO_ADMIN = 'Only moderators can turn this on.'

/**
 * La casella "All site activity" di Settings, solo per gli admin (0032).
 * Accende o spegne insieme la lista ('list', il consenso) e le push
 * ('push', sui dispositivi dove le notifiche del browser sono accese), in
 * una sola istruzione: o tutte e due, o niente. Mai l'email. Il ruolo lo
 * ricontrolla set_notification_pref; qui si risponde prima con una frase.
 * Spegnere si puo' sempre, anche a chi non e' piu' admin.
 */
export async function setSiteActivityAction(_prev: SiteActivityState, form: FormData): Promise<SiteActivityState> {
  const user = await requireOnboardedUser('/settings')
  const on = form.get('activity') === 'on'
  if (on && user.role !== 'admin') return { error: SOLO_ADMIN }
  try {
    await sql(
      "select set_notification_pref($1::uuid, 'site_activity', c, $2) from unnest(array['list', 'push']) as c",
      [user.id, on],
    )
  } catch (e) {
    if (e instanceof DatabaseError && e.constraint === 'notification_pref_admin_only') return { error: SOLO_ADMIN }
    if (e instanceof DatabaseError && e.constraint === 'user_not_found') {
      return { error: 'Finish setting up your account first.' }
    }
    throw e
  }
  revalidatePath('/settings')
  return { saved: true, on }
}
