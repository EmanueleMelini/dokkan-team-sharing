'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/ssr'
import { GRADI } from '@/lib/clears/build'
import { useSfere, type SferaTrovata } from '@/components/builder/use-sfere'

type Props = {
  /** "Skill Orb slot 2": il nome accessibile della ricerca */
  dove: string
  /** la carta dello slot: la ricerca mostra solo le sfere che puo' montare */
  carta: number | null
  onScegli: (s: SferaTrovata) => void
  onAnnulla: () => void
}

const campo = 'w-full py-1.5 text-[13px] rounded-[var(--raggio)] bg-superficie border border-campo text-inchiostro'

/**
 * La ricerca di una Skill Orb dentro l'editor della build. Le esclusive
 * hanno tutte lo stesso nome: la riga mostra anche la descrizione del
 * gioco, che dice a chi si monta, e la ricerca guarda anche lì. Le
 * esclusive di altre carte non arrivano: il database le rifiuterebbe.
 */
export function SferaPicker({ dove, carta, onScegli, onAnnulla }: Props) {
  const id = useId()
  const campoQ = useRef<HTMLInputElement>(null)
  const [q, setQ] = useState('')
  const [tier, setTier] = useState('')
  const [attiva, setAttiva] = useState(0)
  const { ricerca, altre } = useSfere(q, tier, carta, true)
  const listaId = `${id}-lista`
  const opz = (i: number) => `${listaId}-o${i}`
  const n = ricerca.sfere.length

  useEffect(() => { campoQ.current?.focus() }, [])
  // l'opzione attiva resta visibile mentre si scorre con le frecce
  useEffect(() => {
    document.getElementById(`${listaId}-o${attiva}`)?.scrollIntoView({ block: 'nearest' })
  }, [attiva, listaId])

  function tasti(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAttiva((a) => Math.min(a + 1, Math.max(n - 1, 0))) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAttiva((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); const s = ricerca.sfere[attiva]; if (s) onScegli(s) }
    // Escape chiude solo la ricerca, non tutto il dialogo
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onAnnulla() }
  }

  return (
    <div className="rounded-[var(--raggio)] border border-linea-forte bg-superficie-2/40 p-2 space-y-2">
      <div className="grid gap-2 grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <label htmlFor={`${id}-q`} className="block text-[11px] text-tenue">Search Skill Orbs<span className="sr-only">, {dove}</span></label>
          <div className="relative mt-1">
            <MagnifyingGlass size={14} aria-hidden className="absolute left-2.5 top-1/2 -translate-y-1/2 text-tenue" />
            <input
              id={`${id}-q`}
              ref={campoQ}
              type="search"
              role="combobox"
              aria-expanded={n > 0}
              aria-controls={listaId}
              aria-autocomplete="list"
              aria-activedescendant={n > 0 ? opz(attiva) : undefined}
              aria-describedby={`${id}-aiuto`}
              autoComplete="off"
              maxLength={60}
              value={q}
              onChange={(e) => { setQ(e.target.value); setAttiva(0) }}
              onKeyDown={tasti}
              className={`${campo} pl-8 pr-2`}
            />
          </div>
        </div>
        <div>
          <label htmlFor={`${id}-t`} className="block text-[11px] text-tenue">Grade</label>
          <select
            id={`${id}-t`}
            value={tier}
            onChange={(e) => { setTier(e.target.value); setAttiva(0) }}
            className={`${campo} mt-1 px-2`}
          >
            <option value="">Any</option>
            <option value="3">Gold</option>
            <option value="2">Silver</option>
            <option value="1">Bronze</option>
          </select>
        </div>
      </div>
      <p id={`${id}-aiuto`} className="text-[11px] text-tenue">
        Words match the name or the description, for example &quot;evasion bardock&quot;. Arrow keys and Enter pick, Escape cancels.
      </p>

      <div className="max-h-64 overflow-y-auto rounded-[var(--raggio)] border border-linea bg-superficie" aria-busy={ricerca.stato === 'carica'}>
        {ricerca.stato === 'errore' && !n ? (
          <p role="alert" className="px-2 py-4 text-center text-[12px] text-str">The Skill Orbs could not be loaded. Try again.</p>
        ) : ricerca.stato !== 'pronto' && !n ? (
          <ul aria-hidden className="divide-y divide-linea">
            {Array.from({ length: 4 }, (_, i) => (
              <li key={i} className="px-2 py-2"><span className="block h-3 w-48 rounded-[var(--raggio)] bg-superficie-2" /></li>
            ))}
          </ul>
        ) : !n ? (
          <p className="px-2 py-4 text-center text-[12px] text-tenue">
            {ricerca.nascoste ? 'This card cannot equip any Skill Orb that matches. Try other words.' : 'No Skill Orbs match. Try fewer words.'}
          </p>
        ) : (
          <ul id={listaId} role="listbox" aria-label="Skill Orbs" className="divide-y divide-linea">
            {ricerca.sfere.map((s, i) => (
              <li
                key={s.id}
                id={opz(i)}
                role="option"
                aria-selected={i === attiva}
                onMouseEnter={() => setAttiva(i)}
                onClick={() => onScegli(s)}
                className={`px-2 py-1.5 cursor-pointer ${i === attiva ? 'bg-oro-tenue' : ''}`}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 text-[12px] font-medium text-inchiostro leading-snug">{s.name}</span>
                  <span className="shrink-0 text-[11px] text-tenue">{GRADI[s.tier]}</span>
                </span>
                {s.effect && <span className="block text-[11px] text-tenue leading-snug line-clamp-2">{s.effect}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-tenue">
        <span aria-live="polite">
          {ricerca.stato === 'pronto' ? <><span className="numeri">{n}</span> of <span className="numeri">{ricerca.totale}</span></> : ''}
          {ricerca.stato === 'pronto' && ricerca.nascoste > 0 && (
            <>. <span className="numeri">{ricerca.nascoste}</span> hidden because this card cannot equip them</>
          )}
        </span>
        <span className="flex gap-2">
          {ricerca.prossimo != null && (
            <button type="button" onClick={altre} disabled={ricerca.stato === 'carica'}
              className="px-2 py-1 text-[12px] rounded-[var(--raggio)] border border-campo bg-superficie text-inchiostro disabled:opacity-60">
              {ricerca.stato === 'carica' ? 'Loading…' : 'Show more'}
            </button>
          )}
          <button type="button" onClick={onAnnulla}
            className="px-2 py-1 text-[12px] rounded-[var(--raggio)] border border-campo bg-superficie text-inchiostro">
            Cancel
          </button>
        </span>
      </div>
    </div>
  )
}
