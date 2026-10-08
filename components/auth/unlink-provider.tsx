'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { unlinkProviderAction, type AccountState } from '@/lib/auth/actions'

const piccolo =
  'px-2.5 py-1 text-[12px] font-medium rounded-[var(--raggio)] border transition-colors active:scale-[0.98] disabled:opacity-60'

/**
 * Scollega in due passi, come Delete sui clear: la domanda compare nella
 * riga, senza dialogo modale. Il focus va alla conferma e torna a Unlink
 * se si annulla. `fallback` dice con cosa si entrera' dopo.
 */
export function UnlinkProvider({ id, label, fallback }: { id: string; label: string; fallback: string }) {
  const [chiede, setChiede] = useState(false)
  const [stato, azione, inCorso] = useActionState<AccountState, FormData>(unlinkProviderAction, {})
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
        aria-label={`Unlink ${label}`}
        className={`${piccolo} border-linea bg-superficie text-testo hover:text-str hover:border-str`}
      >
        Unlink
      </button>
    )
  }

  return (
    <form action={azione} className="w-full flex flex-wrap items-center gap-2" aria-busy={inCorso}>
      <input type="hidden" name="provider" value={id} />
      <p className="w-full text-[12px] leading-relaxed text-inchiostro">
        Unlink {label}? You will still sign in with {fallback}. You can link it again later.
      </p>
      <button ref={conferma} type="submit" disabled={inCorso} className={`${piccolo} border-str bg-str text-sfondo hover:opacity-90`}>
        {inCorso ? 'Unlinking…' : `Unlink ${label}`}
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
