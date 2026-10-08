'use client'

import { ArrowSquareOut, Plus, X } from '@phosphor-icons/react/dist/ssr'
import { Miniatura } from '@/components/builder/miniatura'
import { buildPiena, type BuildStato, type SlotStato } from '@/lib/clears/builder-stato'
import type { SlotRole } from '@/lib/clears/validate'
import { cardHref } from '@/lib/urls'

type Props = {
  slot: SlotStato
  /** "Rotation 1, slot 2": nomi accessibili e titolo del picker */
  dove: string
  onApri: () => void
  onSvuota: () => void
  onRuolo: (r: SlotRole) => void
  onBuild: () => void
}

/** La build in poche parole, sotto la carta: "4/4 routes, 2 orbs, note". */
export function riassuntoBuild(b: BuildStato): string {
  const parti: string[] = []
  if (b.routes !== '') parti.push(`${b.routes}/4 routes`)
  if (b.path.trim()) parti.push(b.path.trim())
  const n = b.sfere.filter(Boolean).length
  if (n) parti.push(`${n} ${n === 1 ? 'orb' : 'orbs'}`)
  if (b.note.trim()) parti.push('note')
  return parti.join(', ')
}

const ruoloBtn = 'px-1.5 py-0.5 text-[11px] font-medium rounded-[var(--raggio)] border transition-colors'

/** Uno dei sette slot: la carta (o il posto vuoto), il ruolo, togli. */
export function Slot({ slot, dove, onApri, onSvuota, onRuolo, onBuild }: Props) {
  const { carta, role, build } = slot
  const piena = buildPiena(build)
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
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {ruolo('leader', 'Leader')}
          {ruolo('friend', 'Friend')}
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={onBuild}
            className={`${ruoloBtn} ${piena ? 'bg-superficie-2 text-inchiostro border-linea-forte' : 'bg-superficie text-testo border-campo hover:text-inchiostro'}`}
          >
            Build<span className="sr-only">{piena ? `, set: ${riassuntoBuild(build)}` : ' (optional)'}, {dove}</span>
          </button>
          {/* In una scheda nuova: il builder non salva la bozza, e andare via
              dalla pagina perderebbe la squadra */}
          <a
            href={cardHref(String(carta.id))}
            target="_blank"
            rel="noopener"
            aria-label={`Open ${carta.name} in a new tab`}
            title="Card page"
            className="ml-auto inline-flex items-center justify-center w-6 h-6 rounded-[var(--raggio)] text-tenue hover:text-inchiostro"
          >
            <ArrowSquareOut size={12} weight="bold" aria-hidden />
          </a>
          <button
            type="button"
            onClick={onSvuota}
            className="inline-flex items-center justify-center w-6 h-6 rounded-[var(--raggio)] text-tenue hover:text-str"
          >
            <X size={12} weight="bold" aria-hidden />
            <span className="sr-only">Remove the card from {dove}</span>
          </button>
        </div>
      )}
      {carta && piena && (
        <p aria-hidden className="mt-1 px-0.5 text-[11px] leading-tight text-tenue truncate" title={riassuntoBuild(build)}>
          {riassuntoBuild(build)}
        </p>
      )}
    </div>
  )
}
