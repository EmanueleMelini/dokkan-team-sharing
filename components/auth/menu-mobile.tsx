'use client'

import Link from 'next/link'
import { Suspense, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { List, X } from '@phosphor-icons/react/dist/ssr'
import { SignInLink } from '@/components/auth/sign-in-link'
import { SignOutButton } from '@/components/auth/sign-out-button'
import { useViewer } from '@/components/viewer/provider'
import { LinkEventi } from '@/components/versione/link-eventi'
import { SceltaVersione } from '@/components/versione/scelta-versione'
import { useVersione } from '@/lib/versione/client'
import { homeHref, profileHref } from '@/lib/urls'

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
 *
 * La prima riga e' la versione del sito, Global o Japan (lib/versione):
 * cambia tutto quello che c'e' sotto. Un tocco li' non chiude il pannello
 * (sulle pagine senza gemello si resta e si vede la scelta cambiare);
 * quando porta al gemello si chiude, e il focus torna al bottone.
 *
 * A menu chiuso, chi e' su Japan lo vede da un tag JP sull'angolo del
 * bottone, solo col CSS (l'HTML resta uguale per tutti). Sta sopra il
 * bottone, come il pallino sulla campanella, e non occupa posto nella
 * riga: a 320px, con la campanella, il nome del sito ci sta intero solo
 * cosi'. Col focus da tastiera si toglie, per lasciare intero l'anello.
 */
export function MenuMobile() {
  const { mode, user } = useViewer()
  const versione = useVersione()
  const etichettaVersione = useId()
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
  // le due home, /events e /events/japan: la voce e' la stessa
  const suEventi = pathname === homeHref('global') || pathname === homeHref('japan')
  const voci: ReactNode[] = [
    // Una griglia: l'etichetta a sinistra, il controllo a destra. Un errore
    // prende la cella dell'etichetta (scelta-versione.tsx) e la nasconde
    // finche' c'e': le voci sotto non si spostano. invisible e non hidden:
    // il gruppo si chiama ancora "Game version" (aria-labelledby).
    <div key="versione" data-versione className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-5 py-1.5">
      <span id={etichettaVersione} className="col-start-1 row-start-1 text-[15px] text-testo group-has-[[role=alert]]:invisible">Game version</span>
      <SceltaVersione
        variante="menu"
        etichetta={etichettaVersione}
        onNavigato={() => { setApertoSu(null); bottone.current?.focus() }}
      />
    </div>,
    <LinkEventi key="events" aria-current={suEventi ? 'page' : undefined} className={voce}>Events</LinkEventi>,
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
        aria-label={aperto ? 'Close menu' : versione === 'japan' ? 'Menu, Japan version' : 'Menu'}
        onClick={() => setApertoSu(aperto ? null : pathname)}
        className="group relative inline-flex items-center justify-center size-9 -mr-2 rounded-[var(--raggio)] text-tenue hover:text-inchiostro transition-colors"
      >
        {aperto ? <X size={20} weight="bold" aria-hidden /> : <List size={20} weight="bold" aria-hidden />}
        {/* Decorativo: il nome del bottone dice gia' "Japan version". Sopra
            l'angolo dell'icona senza coprirne le righe, con un bordo del
            colore dell'header che lo stacca (come il pallino della campanella).
            Con il focus da tastiera sparisce: starebbe sopra l'anello, e
            l'anello va visto intero (WCAG 2.4.7). invisible e non hidden:
            display resta quello di japan:, e non c'e' gara fra le due classi. */}
        {!aperto && (
          <span
            aria-hidden="true"
            data-tag-jp=""
            className="absolute -top-1.5 -right-1 hidden japan:inline-flex items-center px-1 py-px text-[10px] font-semibold leading-none tracking-wide rounded-[calc(var(--raggio)-2px)] border border-oro-linea bg-oro-tenue text-oro ring-2 ring-superficie group-focus-visible:invisible"
          >
            JP
          </span>
        )}
      </button>
      {aperto && (
        // Una voce toccata chiude, anche se porta alla pagina dove si e'. Un
        // bottone (Sign out) chiude solo al giro dopo: il suo form parte dopo
        // il click, e smontato prima il browser annullerebbe l'invio. La riga
        // della versione no: la chiude lei, se porta al gemello.
        <nav
          id="menu-mobile"
          aria-label="Menu"
          onClick={(e) => {
            if ((e.target as Element).closest('[data-versione]')) return
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
