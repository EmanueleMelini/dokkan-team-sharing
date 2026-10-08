'use client'

import { Miniatura } from '@/components/builder/miniatura'
import { Tipo } from '@/components/tipo'
import type { CartaTrovata, Ricerca } from '@/components/builder/use-carte'

type Props = {
  ricerca: Ricerca
  listaId: string
  attiva: number
  onAttiva: (i: number) => void
  onScegli: (c: CartaTrovata) => void
  onAltre: () => void
}

export const opzioneId = (listaId: string, i: number) => `${listaId}-o${i}`

/**
 * I risultati come listbox: il focus resta nel campo di ricerca e
 * aria-activedescendant indica l'opzione scelta con le frecce.
 */
export function PickerRisultati({ ricerca, listaId, attiva, onAttiva, onScegli, onAltre }: Props) {
  const { carte, stato, prossimo, totale } = ricerca
  if (stato === 'errore' && !carte.length) {
    return <p role="alert" className="px-1 py-6 text-center text-[13px] text-str">The cards could not be loaded. Try again.</p>
  }
  if (stato !== 'pronto' && !carte.length) {
    // Righe vuote della stessa forma dei risultati, non uno spinner
    return (
      <ul aria-hidden className="divide-y divide-linea">
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i} className="flex items-center gap-3 px-2 py-2">
            <span className="w-11 h-11 rounded-[var(--raggio)] bg-superficie-2" />
            <span className="h-3 w-40 rounded-[var(--raggio)] bg-superficie-2" />
          </li>
        ))}
      </ul>
    )
  }
  if (!carte.length) {
    return <p className="px-1 py-6 text-center text-[13px] text-tenue">No cards match. Try a shorter name or fewer filters.</p>
  }
  return (
    <>
      <ul id={listaId} role="listbox" aria-label="Cards" className="divide-y divide-linea">
        {carte.map((c, i) => (
          <li
            key={c.id}
            id={opzioneId(listaId, i)}
            role="option"
            aria-selected={i === attiva}
            onMouseEnter={() => onAttiva(i)}
            onClick={() => onScegli(c)}
            className={`flex items-center gap-3 px-2 py-1.5 cursor-pointer ${i === attiva ? 'bg-oro-tenue' : ''}`}
          >
            <Miniatura carta={c} />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium text-inchiostro leading-tight truncate">{c.name}</span>
              {c.epithet && <span className="block text-[11px] text-tenue leading-tight truncate">{c.epithet}</span>}
            </span>
            <span className="shrink-0 flex items-center gap-2">
              <span className="numeri text-[11px] text-tenue">{c.rarity}</span>
              <Tipo tipo={c.type} classe={c.class} />
            </span>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between gap-2 px-2 py-2 text-[11px] text-tenue">
        <span><span className="numeri">{carte.length}</span> of <span className="numeri">{totale}</span></span>
        {prossimo != null && (
          <button
            type="button"
            onClick={onAltre}
            disabled={stato === 'carica'}
            className="px-2 py-1 text-[12px] rounded-[var(--raggio)] border border-campo bg-superficie text-inchiostro disabled:opacity-60"
          >
            {stato === 'carica' ? 'Loading…' : 'Show more'}
          </button>
        )}
      </div>
    </>
  )
}
