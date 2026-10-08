'use client'

import Link from 'next/link'
import { Suspense } from 'react'
import { SignInLink } from '@/components/auth/sign-in-link'
import { SignOutButton } from '@/components/auth/sign-out-button'
import { useViewer } from '@/components/viewer/provider'

const piccolo = 'text-sm text-tenue hover:text-inchiostro transition-colors'

/**
 * La parte dell'header che dipende da chi guarda. L'header e' nel layout
 * di ogni pagina in cache, quindi non legge la sessione: l'utente arriva
 * da /api/me (useViewer). Finche' non si sa, uno spazio vuoto della stessa
 * larghezza, cosi' l'header non salta.
 */
export function UserMenu() {
  const { mode, user } = useViewer()

  if (mode === 'unknown') return <span aria-hidden="true" className="block h-6 w-16" />

  // SignInLink legge la query (per ?next=): useSearchParams vuole un <Suspense>
  if (mode === 'anon' || !user) {
    return (
      <Suspense fallback={<span aria-hidden="true" className="block h-6 w-16" />}>
        <SignInLink className={piccolo} />
      </Suspense>
    )
  }

  if (mode === 'setup') {
    return (
      <div className="flex items-center gap-4">
        <Link href="/welcome" className="text-sm text-oro font-medium hover:underline underline-offset-2">
          Finish setup
        </Link>
        <SignOutButton className={piccolo} />
      </div>
    )
  }

  return (
    <div className="flex items-center gap-4">
      {/* Solo agli admin; /admin ricontrolla il ruolo dal server e per gli altri e' un 404 */}
      {user.isAdmin && (
        <Link href="/admin" prefetch={false} className={piccolo}>
          Moderation
        </Link>
      )}
      <Link
        href="/settings"
        prefetch={false}
        aria-label={`Settings for ${user.handle}`}
        className="flex items-center gap-2 text-sm text-inchiostro hover:text-oro transition-colors"
      >
        <span
          aria-hidden="true"
          className="inline-flex size-6 items-center justify-center rounded-full bg-superficie-2 border border-linea text-[11px] font-semibold uppercase"
        >
          {user.handle.slice(0, 1)}
        </span>
        {/* Sul telefono basta l'iniziale: l'header ha gia' titolo, Events e Sign out. */}
        <span className="hidden sm:inline max-w-[12rem] truncate">{user.handle}</span>
      </Link>
      <SignOutButton className={piccolo} />
    </div>
  )
}
