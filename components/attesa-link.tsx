'use client'

import { useLinkStatus } from 'next/link'

/*
 * Riscontro mentre un link di livello o di difficoltà carica i suoi clear.
 * La pagina è dinamica e ogni scelta è un giro al server: senza questo,
 * fra il tocco e la risposta non cambia niente. È sempre presente e cambia
 * solo opacità, così non sposta niente quando compare (lo raccomanda la
 * guida di useLinkStatus). Va dentro un <Link> con position: relative.
 */
export function AttesaLink() {
  const { pending } = useLinkStatus()
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute inset-0 rounded-[inherit] bg-current transition-opacity ${
        pending ? 'opacity-15' : 'opacity-0'
      }`}
    />
  )
}
