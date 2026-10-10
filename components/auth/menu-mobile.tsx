'use client'

import Link from 'next/link'
import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { List, X } from '@phosphor-icons/react/dist/ssr'
import { SignInLink } from '@/components/auth/sign-in-link'
import { SignOutButton } from '@/components/auth/sign-out-button'
import { useViewer } from '@/components/viewer/provider'
import { profileHref } from '@/lib/urls'

const base = 'block w-full text-left px-5 py-3 text-[15px] hover:bg-superficie-2 transition-colors'
const voce = `${base} text-testo hover:text-inchiostro aria-[current=page]:text-inchiostro aria-[current=page]:font-medium`

/**
 * Il menu dell'header sotto i 1024px (telefoni e tablet in verticale):
 * cosi' accanto al marchio c'e' posto per il nome intero. Fuori resta solo
 * la campanella (UserMenu), per il pallino.
 *
 * Il pannello e' reso solo da aperto, quindi l'HTML del server ha solo il
 * bottone, uguale per tutti. Si chiude con Esc, con un tocco fuori, con un
 * tocco su una voce e cambiando pagina: e' aperto solo sul percorso dove lo
 * si e' aperto, senza effetti che lo rincorrano.
 */
export function MenuMobile() {
  const { mode, user } = useViewer()
  const pathname = usePathname()
  const [apertoSu, setApertoSu] = useState<string | null>(null)
  const aperto = apertoSu === pathname
  const contenitore = useRef<HTMLDivElement>(null)
  const bottone = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!aperto) return
    const fuori = (e: PointerEvent) => {
      if (!contenitore.current?.contains(e.target as Node)) setApertoSu(null)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setApertoSu(null)
      bottone.current?.focus()
    }
    document.addEventListener('pointerdown', fuori)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', fuori)
      document.removeEventListener('keydown', esc)
    }
  }, [aperto])

  const qui = (href: string) => (pathname === href ? ('page' as const) : undefined)
  const voci: ReactNode[] = [
    <Link key="events" href="/events" aria-current={qui('/events')} className={voce}>Events</Link>,
  ]
  if (mode === 'anon' || (mode !== 'unknown' && !user)) {
    voci.push(
      <Suspense key="in" fallback={null}>
        <SignInLink className={voce} />
      </Suspense>,
    )
  } else if (mode === 'setup') {
    voci.push(
      <Link key="welcome" href="/welcome" className={`${base} text-oro font-medium`}>Finish setup</Link>,
      <SignOutButton key="out" className={voce} />,
    )
  } else if (mode === 'ready' && user) {
    const profilo = profileHref(user.handle)
    voci.push(
      <Link key="profile" href={profilo} prefetch={false} aria-current={qui(profilo)} className={`${voce} flex items-center gap-2.5`}>
        <span
          aria-hidden="true"
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-superficie-2 border border-linea text-[11px] font-semibold uppercase"
        >
          {user.handle.slice(0, 1)}
        </span>
        <span className="truncate"><span className="sr-only">Your profile, </span>{user.handle}</span>
      </Link>,
    )
    // Solo agli admin; /admin ricontrolla il ruolo dal server
    if (user.isAdmin) {
      voci.push(<Link key="admin" href="/admin" prefetch={false} aria-current={qui('/admin')} className={voce}>Moderation</Link>)
    }
    voci.push(
      <Link key="settings" href="/settings" prefetch={false} aria-current={qui('/settings')} className={voce}>Settings</Link>,
      <SignOutButton key="out" className={voce} />,
    )
  }

  return (
    <div ref={contenitore}>
      <button
        ref={bottone}
        type="button"
        aria-expanded={aperto}
        aria-controls="menu-mobile"
        aria-label={aperto ? 'Close menu' : 'Menu'}
        onClick={() => setApertoSu(aperto ? null : pathname)}
        className="inline-flex items-center justify-center size-9 -mr-2 rounded-[var(--raggio)] text-tenue hover:text-inchiostro transition-colors"
      >
        {aperto ? <X size={20} weight="bold" aria-hidden /> : <List size={20} weight="bold" aria-hidden />}
      </button>
      {aperto && (
        // Una voce toccata chiude, anche se porta alla pagina dove si e'. Un
        // bottone (Sign out) chiude solo al giro dopo: il suo form parte dopo
        // il click, e smontato prima il browser annullerebbe l'invio.
        <nav
          id="menu-mobile"
          aria-label="Menu"
          onClick={(e) => {
            const voce = (e.target as Element).closest('a, button')
            if (voce?.tagName === 'A') setApertoSu(null)
            else if (voce) setTimeout(() => setApertoSu(null))
          }}
          className="absolute inset-x-0 top-full z-30 border-b border-linea bg-superficie shadow-lg"
        >
          <div className="mx-auto max-w-6xl py-1 divide-y divide-linea">{voci}</div>
        </nav>
      )}
    </div>
  )
}
