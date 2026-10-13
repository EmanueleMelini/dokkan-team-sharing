'use client'

import Link from 'next/link'
import { Suspense } from 'react'
import { SignInLink } from '@/components/auth/sign-in-link'
import { SignOutButton } from '@/components/auth/sign-out-button'
import { MenuMobile } from '@/components/auth/menu-mobile'
import { Campanella } from '@/components/notifiche/campanella'
import { PushResync } from '@/components/notifiche/push-resync'
import { useViewer } from '@/components/viewer/provider'
import { profileHref } from '@/lib/urls'

const piccolo = 'text-sm text-tenue hover:text-inchiostro transition-colors whitespace-nowrap'

/**
 * La parte dell'header che dipende da chi guarda. L'header e' nel layout
 * di ogni pagina in cache, quindi non legge la sessione: l'utente arriva
 * da /api/me (useViewer). Dai 1024px in su le voci stanno in riga; sotto
 * vanno nel burger (MenuMobile) e fuori resta solo la campanella.
 *
 * La versione del sito (Global o Japan, lib/versione) non sta qui: e' per
 * tutti, e questa parte cambia larghezza quando /api/me risponde. Dai
 * 1024px sta nel layout accanto a Events, dove non si sposta; sotto e' la
 * prima riga del burger, con un tag JP sul bottone per chi e' su Japan.
 */
export function UserMenu() {
  const { mode, user } = useViewer()
  return (
    <>
      <div className="max-lg:hidden flex items-center">
        <Riga />
      </div>
      <div className="lg:hidden flex items-center gap-1">
        {/* Il pallino viene da /api/me: questo ramo non c'e' mai nell'HTML in cache */}
        {mode === 'ready' && user && (
          <Campanella unread={user.unread === true} className="size-9 text-tenue hover:text-inchiostro transition-colors" />
        )}
        <MenuMobile />
      </div>
      {mode === 'ready' && user && <PushResync handle={user.handle} />}
    </>
  )
}

/** Le voci in riga, dai 1024px. Finche' non si sa chi guarda, uno spazio vuoto: l'header non salta. */
function Riga() {
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
      {/* Il pallino viene da /api/me: questo ramo non c'e' mai nell'HTML in cache */}
      <Campanella unread={user.unread === true} className={piccolo} />
      {/* L'handle porta al profilo pubblico; Settings ha il suo link accanto */}
      <Link
        href={profileHref(user.handle)}
        prefetch={false}
        aria-label={`Your profile, ${user.handle}`}
        className="flex items-center gap-2 text-sm text-inchiostro hover:text-oro transition-colors"
      >
        <span
          aria-hidden="true"
          className="inline-flex size-6 items-center justify-center rounded-full bg-superficie-2 border border-linea text-[11px] font-semibold uppercase"
        >
          {user.handle.slice(0, 1)}
        </span>
        <span className="max-w-[12rem] truncate">{user.handle}</span>
      </Link>
      <Link href="/settings" prefetch={false} className={piccolo}>
        Settings
      </Link>
      <SignOutButton className={piccolo} />
    </div>
  )
}
