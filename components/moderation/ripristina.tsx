'use client'

import { useActionState } from 'react'
import { setClearStatus, setCommentStatus, setTipStatus, type ModState } from '@/lib/moderation/actions'

const AZIONE = { clear: setClearStatus, comment: setCommentStatus, tip: setTipStatus } as const

/**
 * Unhide di un clear, un commento o una tip nascosti: un clic, perche' si
 * rinasconde dalla coda o da qui. Torna con i voti che aveva.
 */
export function Ripristina({ kind, id }: { kind: keyof typeof AZIONE; id: string }) {
  const [stato, azione, inCorso] = useActionState<ModState, FormData>(AZIONE[kind], {})
  return (
    <form action={azione} className="flex flex-wrap items-center gap-2" aria-busy={inCorso}>
      <input type="hidden" name={kind} value={id} />
      <input type="hidden" name="status" value="published" />
      <button
        type="submit"
        disabled={inCorso}
        className="px-2 py-1 text-[12px] rounded-[var(--raggio)] border border-linea bg-superficie text-testo hover:text-inchiostro hover:border-linea-forte transition-colors active:scale-[0.98] disabled:opacity-60"
      >
        {inCorso ? 'Unhiding…' : 'Unhide'}
      </button>
      {stato.error && !inCorso && <p role="alert" className="w-full text-[12px] text-str">{stato.error}</p>}
      <p aria-live="polite" className="sr-only">{stato.ok && !inCorso ? stato.message : ''}</p>
    </form>
  )
}
