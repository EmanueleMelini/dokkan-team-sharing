'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Plus } from '@phosphor-icons/react/dist/ssr'
import { useSegnaTipMia, useViewer } from '@/components/viewer/provider'
import { TipForm } from '@/components/tips/tip-form'
import type { TipScope } from '@/lib/tips/validate'

type Props = {
  eventId: string
  tierId: string
  etichettaTier: string
  scopeIniziale: TipScope
  /** questa pagina con #tips: dopo l'accesso si torna qui */
  ritorno: string
}

/**
 * Sotto le tip: il modulo per chi puo' scrivere, altrimenti dove entrare.
 * Chi guarda lo sa solo il browser (/api/me); finche' non risponde vale la
 * versione anonima, quella della pagina in cache. Il modulo si apre con un
 * bottone, per non allungare la colonna dei clear, e dopo un invio
 * riuscito si richiude e riparte vuoto (key).
 */
export function TipSpazio({ eventId, tierId, etichettaTier, scopeIniziale, ritorno }: Props) {
  const { mode, user } = useViewer()
  const segnaMia = useSegnaTipMia()
  const [aperto, setAperto] = useState(false)
  const [giro, setGiro] = useState(0)
  const [fatto, setFatto] = useState(false)

  if (mode === 'ready' && user?.suspended) {
    return <p className="mt-3 text-[12px] text-tenue">Your account is suspended, so you cannot post tips.</p>
  }
  if (mode !== 'ready') {
    const next = encodeURIComponent(ritorno)
    return (
      <p className="mt-3 text-[12px] text-tenue">
        <Link
          href={mode === 'setup' ? `/welcome?next=${next}` : `/login?next=${next}`}
          prefetch={false}
          className="text-testo underline decoration-oro-linea underline-offset-2 hover:text-inchiostro"
        >
          {mode === 'setup' ? 'Finish setting up your account' : 'Sign in'}
        </Link>{' '}
        to share a tip.
      </p>
    )
  }

  if (!aperto) {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => { setAperto(true); setFatto(false) }}
          aria-expanded={false}
          className="inline-flex items-center gap-1.5 px-3 py-1 text-[12px] font-medium rounded-[var(--raggio)] border border-campo bg-superficie text-inchiostro hover:border-linea-forte transition-colors active:scale-[0.98]"
        >
          <Plus size={12} weight="bold" aria-hidden />
          Share a tip
        </button>
        <p aria-live="polite" className="text-[12px] text-tenue">{fatto ? 'Tip posted.' : ''}</p>
      </div>
    )
  }

  return (
    <div className="mt-3 border border-linea rounded-[var(--raggio)] bg-superficie-2 p-3">
      <TipForm
        key={giro}
        modo="post"
        eventId={eventId}
        tierId={tierId}
        etichettaTier={etichettaTier}
        scopeIniziale={scopeIniziale}
        onDone={(id) => {
          // la propria tip nuova: Edit e Delete subito, niente Helpful ne' Report
          if (id) segnaMia(id)
          setGiro((n) => n + 1)
          setAperto(false)
          setFatto(true)
        }}
        onCancel={() => setAperto(false)}
      />
    </div>
  )
}
