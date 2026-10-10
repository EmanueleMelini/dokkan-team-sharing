'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { CaretDown } from '@phosphor-icons/react/dist/ssr'
import { Miniatura, TipoSenzaMiniatura } from '@/components/builder/miniatura'
import { CARTE_MAX } from '@/lib/clears/filtri'

/** Una carta fra le opzioni dei filtri, con la miniatura gia' come URL. */
export type OpzioneCarta = {
  id: string
  name: string | null
  epithet: string | null
  type: string
  class: string
  thumb: string | null
  /** in quanti clear del tier; 0 per una carta che arriva solo dall'URL */
  n: number
}

export const nomeCarta = (c: Pick<OpzioneCarta, 'name' | 'id'>) => c.name ?? `Card ${c.id}`

/*
 * "Usa la carta": un popover con le carte che compaiono nei clear del
 * tier, fino a 3 scelte. E' un <details> con dentro caselle vere
 * (name="card"), cosi' senza JavaScript si apre lo stesso e il form le
 * invia. La ricerca filtra la lista nel browser e non ha name: non va
 * nell'URL.
 */
export function ScegliCarta({ opzioni, scelte, onCambia }: {
  opzioni: OpzioneCarta[]
  scelte: string[]
  onCambia: (ids: string[]) => void
}) {
  const [testo, setTesto] = useState('')
  // Il popover si apre verso destra; se uscirebbe dallo schermo, verso sinistra
  const [aDestra, setADestra] = useState(false)
  const box = useRef<HTMLDetailsElement>(null)
  const idLista = useId()
  const pieno = scelte.length >= CARTE_MAX

  // Fuori dal popover o Esc: si chiude, e con Esc il focus torna al bottone
  useEffect(() => {
    const fuori = (e: PointerEvent) => {
      if (box.current?.open && !box.current.contains(e.target as Node)) box.current.open = false
    }
    document.addEventListener('pointerdown', fuori)
    return () => document.removeEventListener('pointerdown', fuori)
  }, [])

  const q = testo.trim().toLowerCase()
  // Le scelte in cima: con tante carte dallo stesso nome si vedono subito
  const visibili = [...(q
    ? opzioni.filter((c) => `${c.name ?? ''} ${c.epithet ?? ''}`.toLowerCase().includes(q))
    : opzioni
  )].sort((a, b) => Number(scelte.includes(b.id)) - Number(scelte.includes(a.id)))

  return (
    <details
      ref={box}
      className="relative"
      onToggle={(e) => {
        const d = e.currentTarget
        if (!d.open) return
        const largo = Math.min(320, window.innerWidth - 40)
        setADestra(d.getBoundingClientRect().left + largo > window.innerWidth - 16)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && box.current?.open) {
          box.current.open = false
          box.current.querySelector('summary')?.focus()
        }
      }}
    >
      <summary data-fuoco="carte" className="list-none [&::-webkit-details-marker]:hidden cursor-pointer inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[13px] rounded-[var(--raggio)] bg-superficie border border-campo text-inchiostro hover:border-linea-forte">
        Uses card
        {scelte.length > 0 && <span className="numeri text-[11px] px-1 rounded-[var(--raggio)] bg-oro-tenue text-inchiostro">{scelte.length}</span>}
        <CaretDown size={12} weight="bold" aria-hidden />
      </summary>
      <div className={`absolute ${aDestra ? 'right-0' : 'left-0'} z-20 mt-1 w-[min(20rem,calc(100vw-2.5rem))] rounded-[var(--raggio)] border border-linea-forte bg-superficie shadow-lg`}>
        <div className="p-2 border-b border-linea">
          <label htmlFor={`${idLista}-q`} className="sr-only">Search the cards used here</label>
          <input
            id={`${idLista}-q`}
            type="search"
            data-fuoco="cerca-carte"
            value={testo}
            onChange={(e) => setTesto(e.target.value)}
            placeholder="Search cards"
            autoComplete="off"
            className="w-full px-2 py-1.5 text-[13px] rounded-[var(--raggio)] bg-superficie border border-campo text-inchiostro"
          />
          <p className="mt-1.5 text-[11px] text-tenue">Up to {CARTE_MAX} cards. A clear must use all of them.</p>
        </div>
        <fieldset className="max-h-72 overflow-y-auto">
          <legend className="sr-only">Cards used in these clears</legend>
          {visibili.length === 0 && <p className="px-3 py-3 text-[12px] text-tenue">No card matches.</p>}
          {visibili.map((c) => {
            const presa = scelte.includes(c.id)
            return (
              <label
                key={c.id}
                className={`flex items-center gap-2 px-2 py-1.5 border-b border-linea last:border-b-0 ${
                  !presa && pieno ? 'opacity-50' : 'cursor-pointer hover:bg-superficie-2'
                }`}
              >
                <input
                  type="checkbox"
                  name="card"
                  value={c.id}
                  data-fuoco={`card:${c.id}`}
                  checked={presa}
                  disabled={!presa && pieno}
                  onChange={() => onCambia(presa ? scelte.filter((x) => x !== c.id) : [...scelte, c.id])}
                  className="shrink-0 accent-[var(--oro)]"
                />
                <Miniatura carta={c} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-inchiostro">{nomeCarta(c)}</span>
                  {c.epithet && <span className="block truncate text-[11px] text-tenue">{c.epithet}</span>}
                </span>
                {/* senza miniatura il riquadro non dice tipo e classe: accanto */}
                <TipoSenzaMiniatura carta={c} />
                <span className="numeri text-[11px] text-tenue shrink-0">
                  {c.n > 0 ? (
                    <>{c.n}<span className="sr-only">{c.n === 1 ? ' clear' : ' clears'}</span></>
                  ) : '0 here'}
                </span>
              </label>
            )
          })}
        </fieldset>
      </div>
    </details>
  )
}
