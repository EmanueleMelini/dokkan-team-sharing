'use client'

import Link from 'next/link'
import { useEffect, useRef } from 'react'

/** La pagina per rientrare senza uscire: /login rimanda via chi e' gia' dentro. */
export const REAUTH_HREF = '/settings/sign-in'

const piccolo =
  'px-2.5 py-1 text-[12px] font-medium rounded-[var(--raggio)] border transition-colors active:scale-[0.98]'

/**
 * Al posto della conferma quando la sessione non e' fresca (piu' di 15
 * minuti, lib/auth/fresh.ts). Compare sempre dopo un clic, quindi prende
 * il focus: chi usa la tastiera o un lettore di schermo sente subito
 * perche' l'azione non e' partita.
 */
export function ReauthNotice({ onCancel, className = '' }: { onCancel?: () => void; className?: string }) {
  const link = useRef<HTMLAnchorElement>(null)
  useEffect(() => { link.current?.focus() }, [])

  return (
    <div role="status" className={`rounded-[var(--raggio)] border border-oro-linea bg-oro-tenue px-3 py-2 ${className}`}>
      <p className="text-[12px] leading-relaxed text-inchiostro">For your safety, sign in again to do this.</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Link ref={link} href={REAUTH_HREF} className={`${piccolo} border-inchiostro bg-inchiostro text-sfondo hover:opacity-90`}>
          Sign in again
        </Link>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className={`${piccolo} border-linea bg-superficie text-testo hover:text-inchiostro`}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}
