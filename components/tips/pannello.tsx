'use client'

import { useState } from 'react'
import type { TipGroup } from '@/lib/tips'
import { TIP_LIMITS, ordina, type Ordine, type TipScope } from '@/lib/tips/validate'
import { Tip } from '@/components/tips/tip'
import { TipSpazio } from '@/components/tips/tip-spazio'

type Props = {
  eventId: string
  tierId: string
  /** "For Stage 3 name, Super 2" o "For level 30" */
  titoloTier: string
  /** "This stage" o "This level" */
  etichettaTier: string
  /** "stage" o "level", per il gruppo vuoto */
  nomeTier: string
  scopeIniziale: TipScope
  stage: TipGroup
  event: TipGroup
  ritorno: string
}

function Gruppo({ titolo, gruppo, ordine, vuoto }: { titolo: string; gruppo: TipGroup; ordine: Ordine; vuoto: string }) {
  const [tutte, setTutte] = useState(false)
  const ordinate = ordina(gruppo.tips, ordine)
  const visibili = tutte ? ordinate : ordinate.slice(0, TIP_LIMITS.shown)
  const altre = gruppo.total > TIP_LIMITS.shown

  return (
    <div className="mt-3">
      <h4 className="text-[12px] font-medium text-inchiostro">
        {titolo}
        {gruppo.total > 0 && <span className="ml-1.5 numeri font-normal text-tenue">{gruppo.total}</span>}
      </h4>
      {visibili.length === 0 ? (
        <p className="mt-1 text-[12px] text-tenue">{vuoto}</p>
      ) : (
        <ol className="divide-y divide-linea">
          {visibili.map((t) => <li key={t.id}><Tip tip={t} /></li>)}
        </ol>
      )}
      {altre && (
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <button
            type="button"
            onClick={() => setTutte((v) => !v)}
            aria-expanded={tutte}
            className="text-[12px] text-testo underline decoration-linea-forte underline-offset-2 hover:text-inchiostro"
          >
            {tutte ? 'Show fewer' : `Show all ${gruppo.total} tips`}
          </button>
          {tutte && gruppo.total > ordinate.length && (
            <span className="text-[11px] text-tenue">
              Showing the first <span className="numeri">{ordinate.length}</span>.
            </span>
          )}
        </div>
      )}
    </div>
  )
}

/** Le tip del tier e di tutto l'evento, con l'ordine e il modulo. */
export function TipsPannello(p: Props) {
  const [ordine, setOrdine] = useState<Ordine>('top')
  const scelta = p.stage.tips.length > 1 || p.event.tips.length > 1

  return (
    <>
      {scelta && (
        <div role="group" aria-label="Order tips by" className="mt-2 inline-flex rounded-[var(--raggio)] border border-linea overflow-hidden text-[12px]">
          {(['top', 'new'] as const).map((o) => (
            <button
              key={o}
              type="button"
              aria-pressed={ordine === o}
              onClick={() => setOrdine(o)}
              className={`px-2.5 py-0.5 transition-colors ${
                ordine === o ? 'bg-inchiostro text-sfondo font-medium' : 'bg-superficie text-testo hover:text-inchiostro'
              }`}
            >
              {o === 'top' ? 'Top' : 'New'}
            </button>
          ))}
        </div>
      )}
      <Gruppo titolo={p.titoloTier} gruppo={p.stage} ordine={ordine} vuoto={`No tips for this ${p.nomeTier} yet.`} />
      {p.event.total > 0 && (
        <Gruppo titolo="For the whole event" gruppo={p.event} ordine={ordine} vuoto="" />
      )}
      <TipSpazio
        eventId={p.eventId}
        tierId={p.tierId}
        etichettaTier={p.etichettaTier}
        scopeIniziale={p.scopeIniziale}
        ritorno={p.ritorno}
      />
    </>
  )
}
