import 'server-only'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { currentUser, type CurrentUser } from '@/lib/dal'

// Il cancello dell'area /admin e delle Server Action dei moderatori. Chi
// non e' admin riceve un 404, anche senza sessione: niente redirect a
// /login, che direbbe che li' dietro c'e' qualcosa. Le funzioni mod_* lo
// ricontrollano comunque nel database (mod_assert, 0024).

/** L'admin della sessione: onboarded, ruolo 'admin', non sospeso. Altrimenti notFound(). */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await currentUser()
  // suspended viene dalla sessione (additionalField suspendedUntil): un
  // admin sospeso non entra, e mod_assert lo rifiuta comunque
  if (!user || !user.onboarded || user.role !== 'admin' || user.suspended) notFound()
  return user
}

/**
 * I metadati di una pagina admin, solo per l'admin: un titolo statico
 * ("Moderation") finirebbe anche nel <title> del 404 dato agli altri, e
 * direbbe che la pagina esiste. Per chi non e' admin vale notFound().
 */
export async function metadataAdmin(title: Metadata['title']): Promise<Metadata> {
  await requireAdmin()
  return { title, robots: { index: false, follow: false } }
}
