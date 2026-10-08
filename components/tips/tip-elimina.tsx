'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { deleteTip } from '@/lib/tips/actions'
import type { TipActionState } from '@/lib/tips/validate'

const piccolo = 'px-2 py-0.5 text-[12px] rounded-[var(--raggio)] border transition-colors active:scale-[0.98] disabled:opacity-60'

/**
 * Delete in due passi, come EliminaClear: la domanda accanto al bottone,
 * il focus sulla conferma e di nuovo su Delete se si annulla. Dopo, la
 * pagina si rigenera senza la tip.
 */
export function TipElimina({ tipId }: { tipId: string }) {
  const [chiede, setChiede] = useState(false)
  const [stato, azione, inCorso] = useActionState<TipActionState, FormData>(deleteTip, {})
  const conferma = useRef<HTMLButtonElement>(null)
  const apri = useRef<HTMLButtonElement>(null)
  const primoGiro = useRef(true)

  useEffect(() => {
    if (primoGiro.current) { primoGiro.current = false; return }
    if (chiede) conferma.current?.focus()
    else apri.current?.focus()
  }, [chiede])

  if (!chiede) {
    return (
      <button ref={apri} type="button" onClick={() => setChiede(true)}
        className={`${piccolo} border-linea bg-superficie text-testo hover:text-str hover:border-str`}>
        Delete
      </button>
    )
  }

  return (
    <form action={azione} className="basis-full flex flex-wrap items-center gap-2" aria-busy={inCorso}>
      <input type="hidden" name="tip" value={tipId} />
      <span className="text-[12px] text-inchiostro">Delete this tip and its votes?</span>
      {/* key diverse: React non deve riusare il bottone di apertura come submit */}
      <button key="conferma" ref={conferma} type="submit" disabled={inCorso}
        className={`${piccolo} border-str bg-str text-sfondo hover:opacity-90`}>
        {inCorso ? 'Deleting…' : 'Delete'}
      </button>
      <button key="annulla" type="button" onClick={() => setChiede(false)}
        className={`${piccolo} border-linea bg-superficie text-testo hover:text-inchiostro`}>
        Cancel
      </button>
      {stato.error && !inCorso && <p role="alert" className="w-full text-[12px] text-str">{stato.error}</p>}
    </form>
  )
}
