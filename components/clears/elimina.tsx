'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { deleteClear, type ClearActionState } from '@/lib/clears/actions'

const piccolo = 'px-2 py-1 text-[12px] rounded-[var(--raggio)] border transition-colors active:scale-[0.98]'

/**
 * Delete in due passi: il primo chiede conferma accanto al bottone, senza
 * un dialogo modale. Il focus passa alla domanda e torna a Delete se si
 * annulla, così da tastiera non si perde il punto.
 */
export function EliminaClear({ clearId, tornaAllEvento = false }: {
  clearId: string
  /** dalla pagina di modifica: dopo la cancellazione si torna all'evento */
  tornaAllEvento?: boolean
}) {
  const [chiede, setChiede] = useState(false)
  const [stato, azione, inCorso] = useActionState<ClearActionState, FormData>(deleteClear, {})
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
      <button
        ref={apri}
        type="button"
        onClick={() => setChiede(true)}
        className={`${piccolo} border-linea bg-superficie text-testo hover:text-str hover:border-str`}
      >
        Delete
      </button>
    )
  }

  return (
    <form action={azione} className="flex flex-wrap items-center gap-2" aria-busy={inCorso}>
      <input type="hidden" name="clear" value={clearId} />
      {tornaAllEvento && <input type="hidden" name="dopo" value="evento" />}
      <span className="text-[12px] text-inchiostro">Delete this clear, its votes and comments?</span>
      <button
        ref={conferma}
        type="submit"
        className={`${piccolo} border-str bg-str text-sfondo hover:opacity-90`}
      >
        {inCorso ? 'Deleting…' : 'Delete'}
      </button>
      <button
        type="button"
        onClick={() => setChiede(false)}
        className={`${piccolo} border-linea bg-superficie text-testo hover:text-inchiostro`}
      >
        Cancel
      </button>
      {stato.error && <p role="alert" className="w-full text-[12px] text-str">{stato.error}</p>}
    </form>
  )
}
