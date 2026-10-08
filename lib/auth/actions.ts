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
import { requireFreshUser, requireUser } from '@/lib/dal'
import { collectUserFootprint, invalidateUser } from '@/lib/cache/invalidate'
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
  if (e.code === '23505') return 'That handle is already taken. Try another one.'
  if (e.code === '23514') {
    if (e.constraint === 'already_onboarded') return 'done'
    if (e.constraint === 'handle_reserved') return 'That handle is reserved. Try another one.'
    return 'Use 3 to 24 characters: letters, digits or underscores.'
  }
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
