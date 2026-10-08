'use client'

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

export type Scheda = { key: string; label: string; panel: ReactNode }

/**
 * Le schede Base / EZA / Super EZA delle skill. I pannelli arrivano gia'
 * renderizzati dal server: qui si sceglie solo quale si vede. Il primo
 * render apre quello indicato dal server (il livello piu' alto), cosi'
 * l'HTML in cache e l'idratazione coincidono e senza JavaScript si legge
 * comunque il testo che conta.
 */
export function TierTabs({ schede, iniziale }: { schede: Scheda[]; iniziale: string }) {
  const id = useId()
  const [scelta, setScelta] = useState(iniziale)
  const bottoni = useRef<(HTMLButtonElement | null)[]>([])

  // Le frecce spostano e attivano (attivazione automatica: i pannelli
  // sono gia' nella pagina, cambiare non costa niente).
  function tasti(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const n = schede.length
    const dove = e.key === 'ArrowRight' ? (i + 1) % n
      : e.key === 'ArrowLeft' ? (i - 1 + n) % n
      : e.key === 'Home' ? 0
      : e.key === 'End' ? n - 1
      : -1
    if (dove < 0) return
    e.preventDefault()
    setScelta(schede[dove].key)
    bottoni.current[dove]?.focus()
  }

  return (
    <div>
      {schede.length > 1 && (
        <div role="tablist" aria-label="Skill level" className="flex gap-1 border-b border-linea">
          {schede.map((s, i) => {
            const attiva = s.key === scelta
            return (
              <button
                key={s.key}
                ref={(el) => { bottoni.current[i] = el }}
                type="button"
                role="tab"
                id={`${id}-t-${s.key}`}
                aria-selected={attiva}
                aria-controls={`${id}-p-${s.key}`}
                tabIndex={attiva ? 0 : -1}
                onClick={() => setScelta(s.key)}
                onKeyDown={(e) => tasti(e, i)}
                className={`-mb-px border-b-2 px-3 py-1.5 text-[13px] transition-colors ${
                  attiva ? 'border-oro text-inchiostro font-medium' : 'border-transparent text-tenue hover:text-inchiostro'
                }`}
              >
                {s.label}
              </button>
            )
          })}
        </div>
      )}
      {schede.map((s) => (
        <div
          key={s.key}
          role={schede.length > 1 ? 'tabpanel' : undefined}
          id={`${id}-p-${s.key}`}
          aria-labelledby={schede.length > 1 ? `${id}-t-${s.key}` : undefined}
          hidden={s.key !== scelta}
          className="pt-4"
        >
          {s.panel}
        </div>
      ))}
    </div>
  )
}
