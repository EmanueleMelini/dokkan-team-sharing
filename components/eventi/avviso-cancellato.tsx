'use client'

import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { useViewer } from '@/components/viewer/provider'
import { dimenticaSoloBrowser } from '@/lib/notify/push-client'

/**
 * Dopo la cancellazione dell'account (Settings porta a /events?account=deleted).
 * La lista e' statica: la query si legge qui, nel browser. Prima si
 * rilegge chi guarda: l'avviso compare solo se la sessione non c'e' piu',
 * cosi' un link con ?account=deleted non lo mostra a chi e' ancora dentro.
 * I filtri non lo ripropagano.
 */
export function AvvisoAccountCancellato() {
  const cancellato = useSearchParams().get('account') === 'deleted'
  const { mode, reload } = useViewer()
  useEffect(() => { if (cancellato) reload() }, [cancellato, reload])
  // Le righe delle push le ha gia' tolte la cascata: resta l'iscrizione
  // del browser, che senza account non serve piu' a niente.
  useEffect(() => { if (cancellato && mode === 'anon') dimenticaSoloBrowser().catch(() => {}) }, [cancellato, mode])
  if (!cancellato || mode !== 'anon') return null
  return (
    <p role="status" className="mt-4 max-w-lg text-[12px] text-inchiostro bg-oro-tenue border border-oro-linea rounded-[var(--raggio)] px-3 py-2">
      Your account and everything you posted have been deleted.
    </p>
  )
}
