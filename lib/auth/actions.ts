'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { DatabaseError } from 'pg'
import { sql } from '@/lib/db'
import { auth } from '@/lib/auth/auth'
import { safeNext } from '@/lib/auth/safe-next'
import { requireUser } from '@/lib/dal'

// Le Server Action dell'accesso. Ognuna si comporta come un endpoint
// pubblico (una POST diretta la raggiunge): rilegge la sessione da sola
// e non accetta mai un id utente dal client.

/** Esce: cancella la riga della sessione e il cookie, poi torna alla home. */
export async function signOutAction() {
  await auth.api.signOut({ headers: await headers() })
  // L'header (UserMenu) sta nel layout: senza questo il client terrebbe
  // quello vecchio, con l'utente ancora dentro.
  revalidatePath('/', 'layout')
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
  revalidatePath('/', 'layout') // l'header passa da "Finish setup" all'handle
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
