'use client'

import { Plus, X } from '@phosphor-icons/react/dist/ssr'
import { Miniatura } from '@/components/builder/miniatura'
import type { SlotStato } from '@/lib/clears/builder-stato'
import type { SlotRole } from '@/lib/clears/validate'

type Props = {
  slot: SlotStato
  /** "Rotation 1, slot 2": nomi accessibili e titolo del picker */
  dove: string
  onApri: () => void
  onSvuota: () => void
  onRuolo: (r: SlotRole) => void
}

const ruoloBtn = 'px-1.5 py-0.5 text-[11px] font-medium rounded-[var(--raggio)] border transition-colors'

/** Uno dei sette slot: la carta (o il posto vuoto), il ruolo, togli. */
export function Slot({ slot, dove, onApri, onSvuota, onRuolo }: Props) {
  const { carta, role } = slot
  const ruolo = (r: 'leader' | 'friend', testo: string) => (
    <button
      type="button"
      aria-pressed={role === r}
      onClick={() => onRuolo(role === r ? 'member' : r)}
      className={`${ruoloBtn} ${role === r ? 'bg-oro-tenue text-oro border-oro' : 'bg-superficie text-testo border-campo hover:text-inchiostro'}`}
    >
      {testo}<span className="sr-only">, {dove}</span>
    </button>
  )

  return (
    <div className={`rounded-[var(--raggio)] border ${carta ? 'border-linea bg-superficie' : 'border-dashed border-linea-forte bg-superficie-2/40'} p-1.5`}>
      <button
        type="button"
        onClick={onApri}
        className="flex w-full min-w-0 items-center gap-2 text-left rounded-[var(--raggio)] p-0.5 hover:bg-superficie-2"
      >
        {carta ? (
          <>
            <Miniatura carta={carta} size={40} />
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] font-medium text-inchiostro leading-tight truncate" title={carta.name}>{carta.name}</span>
              {carta.epithet && <span className="block text-[11px] text-tenue leading-tight truncate">{carta.epithet}</span>}
              <span className="sr-only">. Replace the card in {dove}</span>
            </span>
          </>
        ) : (
          <>
            <span aria-hidden className="inline-flex w-10 h-10 shrink-0 items-center justify-center rounded-[var(--raggio)] border border-dashed border-campo text-tenue">
              <Plus size={14} weight="bold" />
            </span>
            <span className="text-[12px] text-testo">Add a card<span className="sr-only"> to {dove}</span></span>
          </>
        )}
      </button>
      {carta && (
        <div className="mt-1.5 flex items-center gap-1">
          {ruolo('leader', 'Leader')}
          {ruolo('friend', 'Friend')}
          <button
            type="button"
            onClick={onSvuota}
            className="ml-auto inline-flex items-center justify-center w-6 h-6 rounded-[var(--raggio)] text-tenue hover:text-str"
          >
            <X size={12} weight="bold" aria-hidden />
            <span className="sr-only">Remove the card from {dove}</span>
          </button>
        </div>
      )}
    </div>
  )
}
