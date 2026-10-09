'use server'

import { revalidatePath } from 'next/cache'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { DatabaseError } from 'pg'
import { sql } from '@/lib/db'
import { auth } from '@/lib/auth/auth'
import { friendlyAccountError, handleMatches } from '@/lib/auth/account'
import { PROVIDERS } from '@/lib/auth/env'
import { safeNext } from '@/lib/auth/safe-next'
import { requireFreshUser, requireOnboardedUser, requireUser } from '@/lib/dal'
import { afterUserChanged, collectUserFootprint, invalidateProfiles, invalidateUser } from '@/lib/cache/invalidate'
import { friendlyHandleError, nextHandleChange } from '@/lib/auth/handle-change'
import { handleChangedAt } from '@/lib/auth/handle-state'
import { soloGiorno } from '@/lib/date'
import { HINT_COOKIE } from '@/lib/viewer/hint'

// Le Server Action dell'accesso. Ognuna si comporta come un endpoint
// pubblico (una POST diretta la raggiunge): rilegge la sessione da sola
// e non accetta mai un id utente dal client.
//
// Niente invalidazione del layout ('/', 'layout'): con cacheComponents quel
// tag sta su ogni pagina, e ogni accesso o uscita svuoterebbe la cache di
// tutto il sito. L'header non dipende piu' dal server: lo aggiornano le
// isole client (components/viewer) con /api/me e l'indizio dts_signed_in.

/** Toglie l'indizio dts_signed_in: le pagine smettono di chiedere /api/me. */
async function togliIndizio() {
  ;(await cookies()).delete(HINT_COOKIE)
}

/** Esce: cancella la riga della sessione e il cookie, poi torna alla home. */
export async function signOutAction() {
  await auth.api.signOut({ headers: await headers() })
  // Anche l'hook di better-auth lo toglie; qui resta vero se l'uscita
  // avviene senza passare dalla sua rotta HTTP.
  await togliIndizio()
  redirect('/events')
}

export type OnboardingState = { error?: string; handle?: string; reg?: string }

const HANDLE = /^[A-Za-z0-9_]{3,24}$/

/** /welcome: handle e regione, salvati da complete_onboarding (0014). */
export async function completeOnboardingAction(
  _prev: OnboardingState,
  form: FormData,
): Promise<OnboardingState> {
  const next = safeNext(form.get('next'), '/events')
  const user = await requireUser(next)
  const handle = String(form.get('handle') ?? '').trim()
  const reg = String(form.get('reg') ?? '')
  const echo = { handle, reg }

  if (user.onboarded) redirect(next)
  // Lo stesso controllo lo rifa' il database: qui serve solo a rispondere
  // con una frase chiara senza un giro su Postgres.
  if (!HANDLE.test(handle)) {
    return { ...echo, error: 'Use 3 to 24 characters: letters, digits or underscores.' }
  }
  if (reg !== 'global' && reg !== 'japan') {
    return { ...echo, error: 'Choose the version of the game you play.' }
  }

  try {
    await sql('select complete_onboarding($1, $2, $3)', [user.id, handle, reg])
    // Il profilo nuovo: una visita di prima a /users/<handle> e' un 404 in cache
    invalidateProfiles([handle], 'now')
  } catch (e) {
    const msg = onboardingError(e)
    if (msg !== 'done') return { ...echo, error: msg }
  }
  // L'header passa da "Finish setup" all'handle da solo: il provider del
  // client rilegge /api/me al cambio di pagina finche' l'utente e' in setup.
  redirect(next)
}

function onboardingError(e: unknown): string {
  if (!(e instanceof DatabaseError)) throw e
  if (e.constraint === 'already_onboarded') return 'done'
  // Le frasi sono quelle del cambio di handle (handle_shape, handle_reserved,
  // handle_taken, e il 23505 dell'unique di app_user): una tabella sola
  const msg = friendlyHandleError(e)
  if (msg) return msg
  // Un altro 23514 e' un check di forma di app_user, l'ultima difesa
  if (e.code === '23514') return friendlyHandleError({ constraint: 'handle_shape' })!
  throw e
}

// ---------------------------------------------------------------------
//  Settings: scollegare un provider, cancellare l'account (0019)
// ---------------------------------------------------------------------

/**
 * reauth: la sessione ha piu' di 15 minuti (lib/auth/fresh.ts) e la UI
 * chiede di rientrare al posto della conferma. Nessuna query e' partita.
 */
export type AccountState = { error?: string; reauth?: boolean }

/** Il rifiuto di Postgres come frase, o rilancia se e' un guasto. */
function accountError(e: unknown): AccountState {
  if (e instanceof DatabaseError) {
    const msg = friendlyAccountError(e)
    if (msg) return { error: msg }
  }
  throw e
}

/**
 * Scollega un provider dall'account della sessione. La regola (resta
 * almeno un modo di entrare) la impone unlink_provider sotto lock: la
 * rotta /unlink-account di better-auth e' spenta (config.ts), cosi' questa
 * e' l'unica strada.
 */
export async function unlinkProviderAction(_prev: AccountState, form: FormData): Promise<AccountState> {
  const user = await requireFreshUser('/settings')
  if (!user) return { reauth: true }
  const provider = PROVIDERS.find((p) => p.id === form.get('provider'))
  if (!provider) return { error: 'That provider is not linked to your account.' }
  try {
    await sql('select unlink_provider($1::uuid, $2)', [user.id, provider.id])
  } catch (e) {
    return accountError(e)
  }
  revalidatePath('/settings')
  redirect(`/settings?unlinked=${provider.id}`)
}

/**
 * Cancella l'account della sessione: la conferma e' l'handle scritto,
 * che delete_account ricontrolla. Tutto il resto lo porta via la cascata,
 * sessioni comprese; signOut toglie poi il cookie rimasto nel browser.
 */
export async function deleteAccountAction(_prev: AccountState, form: FormData): Promise<AccountState> {
  const user = await requireFreshUser('/settings')
  if (!user) return { reauth: true }
  const typed = form.get('handle')
  if (!handleMatches(typed, user.handle)) {
    return { error: 'That is not your handle. Type it exactly as shown above the box.' }
  }
  // Prima della cancellazione: dopo non si saprebbe piu' quali pagine
  // mostravano i suoi clear, commenti e voti.
  const tracce = await collectUserFootprint(user.id)
  try {
    await sql('select delete_account($1::uuid, $2)', [user.id, String(typed)])
  } catch (e) {
    return accountError(e)
  }
  invalidateUser(tracce)
  await auth.api.signOut({ headers: await headers() })
  await togliIndizio()
  redirect('/events?account=deleted')
}

// ---------------------------------------------------------------------
//  Settings: l'artwork delle carte, statico o animato (0022)
// ---------------------------------------------------------------------

export type ArtPreferenceState = { error?: string; saved?: 'still' | 'animated' }

/**
 * Il default dell'artwork per tutte le carte. Una preferenza e non un
 * contenuto: niente sessione fresca, e la sospensione non la blocca. Le
 * pagine delle carte sono in cache e uguali per tutti, quindi non c'e'
 * niente da invalidare: il default arriva a ogni pagina da /api/me, e il
 * form fa rileggere /api/me a questa scheda dopo il salvataggio.
 */
export async function setArtPreferenceAction(_prev: ArtPreferenceState, form: FormData): Promise<ArtPreferenceState> {
  const user = await requireOnboardedUser('/settings')
  const v = form.get('art')
  if (v !== 'still' && v !== 'animated') return { error: 'Choose still or animated.' }
  try {
    await sql('select set_prefers_animated($1::uuid, $2)', [user.id, v === 'animated'])
  } catch (e) {
    if (e instanceof DatabaseError && e.constraint === 'user_not_found') {
      return { error: 'Finish setting up your account first.' }
    }
    throw e
  }
  // /settings e' per utente e dinamica: questo tocca solo la sua copia
  // nella cache del router, cosi' tornandoci si vede il valore nuovo.
  revalidatePath('/settings')
  return { saved: v }
}

// ---------------------------------------------------------------------
//  Settings: il cambio dell'handle (0026)
// ---------------------------------------------------------------------

/**
 * changed: l'handle nuovo, per il messaggio e per far rileggere /api/me
 * all'header. reauth come per le altre azioni dell'account.
 */
export type HandleState = { error?: string; reauth?: boolean; changed?: string; handle?: string }

/**
 * Cambia l'handle della sessione. Chiede un accesso recente, come
 * scollegare un provider: un handle e' l'identita' pubblica, e chi trova
 * una sessione aperta non deve poterla cambiare. Le regole (30 giorni, le
 * sole maiuscole libere, i nomi lasciati, la sospensione) le impone
 * change_handle; qui la forma si controlla prima per non fare un giro su
 * Postgres per niente.
 */
export async function changeHandleAction(_prev: HandleState, form: FormData): Promise<HandleState> {
  const user = await requireFreshUser('/settings')
  if (!user) return { reauth: true }
  const handle = String(form.get('handle') ?? '').trim()
  if (!HANDLE.test(handle)) return { handle, error: 'Use 3 to 24 characters: letters, digits or underscores.' }
  if (handle === user.handle) return { handle, error: 'That is already your handle.' }
  const vecchio = user.handle
  try {
    await sql('select change_handle($1::uuid, $2)', [user.id, handle])
  } catch (e) {
    if (!(e instanceof DatabaseError)) throw e
    const msg = friendlyHandleError(e)
    if (!msg) throw e
    if (e.constraint !== 'handle_cooldown') return { handle, error: msg }
    const dopo = nextHandleChange(await handleChangedAt(user.id))
    return { handle, error: dopo ? `${msg} You can change it again on ${soloGiorno(dopo)}.` : msg }
  }
  // Ogni pagina che mostrava il nome vecchio: i suoi eventi, le carte, il
  // profilo vecchio (che ora porta al nuovo) e quello nuovo. Gli id
  // arrivano dal database (userFootprint), mai dal form.
  await afterUserChanged(user.id, { extraHandles: [vecchio] })
  // /settings e' per utente e dinamica: si ridisegna col nome nuovo.
  revalidatePath('/settings')
  return { changed: handle }
}
