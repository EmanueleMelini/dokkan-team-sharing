'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowCounterClockwise } from '@phosphor-icons/react/dist/ssr'

type Props = {
  /** "Change 2": per i nomi accessibili e il testo della conferma */
  nome: string
  /** vero se il cambio ha già gli stessi slot della partenza */
  uguale: boolean
  onRicopia: () => void
}

const link = 'inline-flex items-center gap-1 text-[12px] text-testo underline decoration-oro-linea underline-offset-2 hover:text-inchiostro'
const btn = 'px-2.5 py-1 text-[12px] font-medium rounded-[var(--raggio)] border active:scale-[0.98]'

/**
 * "Copy the starting team again" su un cambio. Il cambio nasce come copia
 * e poi è indipendente: questo lo riallinea. Se ricopiare cancellerebbe
 * delle modifiche chiede conferma in linea, non con window.confirm, così
 * resta nello stile della pagina e il focus non si perde.
 */
export function RicopiaPartenza({ nome, uguale, onRicopia }: Props) {
  const [chiede, setChiede] = useState(false)
  const conferma = useRef<HTMLButtonElement>(null)
  const apri = useRef<HTMLButtonElement>(null)
  const fatto = useRef<HTMLParagraphElement>(null)
  const torna = useRef(false)

  // Il focus segue la conferma: entra sul bottone che conferma, e alla
  // chiusura torna dove si era (o sulla riga "uguale", se si è ricopiato).
  useEffect(() => {
    if (chiede) conferma.current?.focus()
    else if (torna.current) (apri.current ?? fatto.current)?.focus()
    torna.current = false
  }, [chiede])

  // Se nel frattempo il cambio torna uguale, la domanda non serve più
  if (uguale && chiede) setChiede(false)

  if (uguale) {
    return (
      <p ref={fatto} tabIndex={-1} className="text-[12px] text-tenue outline-none">
        Same as the starting team<span className="sr-only"> in {nome.toLowerCase()}</span>
      </p>
    )
  }

  if (!chiede) {
    return (
      <button ref={apri} type="button" onClick={() => setChiede(true)} className={link}>
        <ArrowCounterClockwise size={12} weight="bold" aria-hidden />
        Copy the starting team again<span className="sr-only"> into {nome.toLowerCase()}</span>
      </button>
    )
  }

  const chiudi = () => {
    torna.current = true
    setChiede(false)
  }
  return (
    <div
      role="group"
      aria-label={`Copy the starting team into ${nome.toLowerCase()}`}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); chiudi() } }}
      className="w-full rounded-[var(--raggio)] border border-oro-linea bg-oro-tenue px-3 py-2"
    >
      <p className="text-[12px] text-inchiostro">
        This replaces the cards, leader, friend and builds of {nome.toLowerCase()} with the starting team. Its name and note stay.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          ref={conferma}
          type="button"
          onClick={() => { torna.current = true; setChiede(false); onRicopia() }}
          className={`${btn} border-inchiostro bg-inchiostro text-sfondo hover:opacity-90`}
        >
          Replace with the starting team
        </button>
        <button type="button" onClick={chiudi} className={`${btn} border-campo bg-superficie text-inchiostro hover:border-linea-forte`}>
          Keep my edits
        </button>
      </div>
    </div>
  )
}
