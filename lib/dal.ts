import 'server-only'
import { cache } from 'react'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth/auth'
import { safeNext } from '@/lib/auth/safe-next'

// Il livello di accesso ai dati per l'identita' (guida authentication di
// Next): ogni pagina protetta e ogni Server Action chiede qui chi e'
// l'utente. L'id viene SEMPRE dalla sessione nel cookie, mai da argomenti,
// FormData o .bind(): le funzioni SQL di scrittura si fidano del p_author
// che ricevono, e un uuid scelto dal client vorrebbe dire agire come un
// altro.

export type CurrentUser = {
  id: string
  handle: string
  image: string | null
  role: string
  reg: 'global' | 'japan'
  /** Il nome dato dal provider: solo il suggerimento per /welcome. */
  displayName: string
  onboarded: boolean
}

/** La sessione della richiesta, letta una volta per render (React cache). */
export const getSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() })
})

/** L'utente collegato come DTO minimo, o null. */
export const currentUser = cache(async (): Promise<CurrentUser | null> => {
  const s = await getSession()
  if (!s) return null
  const u = s.user
  return {
    id: u.id,
    handle: String(u.handle ?? ''),
    image: u.image ?? null,
    role: String(u.role ?? 'member'),
    reg: u.reg === 'japan' ? 'japan' : 'global',
    displayName: u.name ?? '',
    onboarded: u.onboardedAt != null,
  }
})

function loginUrl(next: string) {
  const n = safeNext(next, '')
  return n ? `/login?next=${encodeURIComponent(n)}` : '/login'
}

/**
 * Un utente collegato, anche se non ha ancora scelto l'handle. Senza
 * sessione porta a /login, con ?next= per tornare qui. redirect() lancia:
 * va chiamata fuori da try/catch.
 */
export async function requireUser(next = '/'): Promise<CurrentUser> {
  const user = await currentUser()
  if (!user) redirect(loginUrl(next))
  return user
}

/** Come requireUser, e in piu' con handle e regione scelti (/welcome). */
export async function requireOnboardedUser(next = '/'): Promise<CurrentUser> {
  const user = await requireUser(next)
  if (!user.onboarded) {
    const n = safeNext(next, '')
    redirect(n ? `/welcome?next=${encodeURIComponent(n)}` : '/welcome')
  }
  return user
}

/** I provider collegati all'utente della sessione: solo gli id, nessun token. */
export async function linkedProviderIds(): Promise<string[]> {
  await requireUser('/settings')
  const accounts = await auth.api.listUserAccounts({ headers: await headers() })
  return accounts.map((a) => a.providerId)
}

/** L'email dell'account, per mostrarla in Settings (solo all'interessato). */
export async function accountEmail(): Promise<string> {
  const s = await getSession()
  return s?.user.email ?? ''
}
