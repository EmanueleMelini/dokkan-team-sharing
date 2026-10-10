'use client'

import { useActionState } from 'react'
import { unsubscribeAction, type UnsubscribeState } from '@/lib/notify/actions'

/**
 * Il bottone della pagina di disiscrizione. Il GET della pagina non
 * cambia niente (un antivirus che apre i link non deve disiscrivere
 * nessuno): si spegne solo con questa POST, che porta il token nel campo
 * nascosto. Funziona anche senza JavaScript.
 */
export function Disiscrivi({ token }: { token: string }) {
  const [stato, azione, inCorso] = useActionState<UnsubscribeState, FormData>(unsubscribeAction, {})
  if (stato.done) {
    return (
      <p role="status" className="text-[13px] text-inchiostro">
        Done. You will not get the daily email digest anymore.
      </p>
    )
  }
  return (
    <form action={azione} aria-busy={inCorso} className="space-y-3">
      <input type="hidden" name="t" value={token} />
      <button
        type="submit"
        disabled={inCorso}
        className="px-3 py-1.5 text-[13px] font-medium rounded-[var(--raggio)] border border-campo bg-superficie text-inchiostro hover:bg-superficie-2 transition-colors disabled:opacity-50"
      >
        {inCorso ? 'Unsubscribing…' : 'Unsubscribe from the daily digest'}
      </button>
      {stato.error && <p role="alert" className="text-[12px] text-str">{stato.error}</p>}
    </form>
  )
}
