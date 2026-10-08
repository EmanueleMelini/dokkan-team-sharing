'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { MagnifyingGlass, X } from '@phosphor-icons/react/dist/ssr'
import { PickerFiltri, type Categoria } from '@/components/builder/picker-filtri'
import { opzioneId, PickerRisultati } from '@/components/builder/picker-risultati'
import { FILTRI_VUOTI, useCarte, type CartaTrovata, type Filtri } from '@/components/builder/use-carte'

type Props = {
  /** cosa si sta riempiendo, per il titolo: "Rotation 1, slot 2" */
  titolo: string | null
  categorie: Categoria[]
  onScegli: (c: CartaTrovata) => void
  onChiudi: () => void
}

/**
 * Il picker delle carte in un <dialog> modale: il browser tiene il focus
 * dentro, Escape lo chiude e il focus torna allo slot che l'ha aperto.
 * Sotto i 640px occupa tutto lo schermo.
 */
export function Picker({ titolo, categorie, onScegli, onChiudi }: Props) {
  const dialogo = useRef<HTMLDialogElement>(null)
  const campoQ = useRef<HTMLInputElement>(null)
  const id = useId()
  const [filtri, setFiltri] = useState<Filtri>(FILTRI_VUOTI)
  const [attiva, setAttiva] = useState(0)
  const aperto = titolo !== null
  const { ricerca, altre } = useCarte(filtri, aperto)

  useEffect(() => {
    const d = dialogo.current
    if (!d) return
    // showModal metterebbe il focus sul primo bottone (Close): va alla ricerca
    if (aperto && !d.open) { d.showModal(); campoQ.current?.focus(); campoQ.current?.select() }
    if (!aperto && d.open) d.close()
  }, [aperto])

  const cambiaFiltri = (f: Filtri) => { setFiltri(f); setAttiva(0) }
  const listaId = `${id}-lista`
  const n = ricerca.carte.length

  function tasti(e: React.KeyboardEvent<HTMLInputElement>) {
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && n === 0) { e.preventDefault(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setAttiva((a) => Math.min(a + 1, n - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAttiva((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      const c = ricerca.carte[attiva]
      if (c) onScegli(c)
    }
  }

  // L'opzione attiva resta visibile mentre si scorre con le frecce
  useEffect(() => {
    document.getElementById(opzioneId(listaId, attiva))?.scrollIntoView({ block: 'nearest' })
  }, [attiva, listaId])

  return (
    <dialog
      ref={dialogo}
      aria-labelledby={`${id}-titolo`}
      onClose={onChiudi}
      className="fixed inset-0 m-0 w-full h-dvh max-w-none max-h-none p-0 bg-superficie text-testo backdrop:bg-black/50 sm:m-auto sm:w-[min(46rem,92vw)] sm:h-[min(44rem,88dvh)] sm:rounded-[var(--raggio)] sm:border sm:border-linea"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-3 px-4 pt-3">
          <h2 id={`${id}-titolo`} className="text-[14px] font-semibold text-inchiostro">
            Pick a card<span className="font-normal text-tenue">{titolo ? `, ${titolo}` : ''}</span>
          </h2>
          <button
            type="button"
            onClick={() => dialogo.current?.close()}
            aria-label="Close"
            className="inline-flex items-center justify-center w-8 h-8 rounded-[var(--raggio)] text-tenue hover:text-inchiostro"
          >
            <X size={16} weight="bold" aria-hidden />
          </button>
        </div>
        <div className="px-4 pt-2 pb-3 space-y-2 border-b border-linea">
          <label htmlFor={`${id}-q`} className="block text-[11px] text-tenue">Name</label>
          <div className="relative">
            <MagnifyingGlass size={14} aria-hidden className="absolute left-2.5 top-1/2 -translate-y-1/2 text-tenue" />
            <input
              id={`${id}-q`}
              type="search"
              role="combobox"
              aria-expanded={n > 0}
              aria-controls={listaId}
              aria-autocomplete="list"
              aria-activedescendant={n > 0 ? opzioneId(listaId, attiva) : undefined}
              autoComplete="off"
              ref={campoQ}
              maxLength={60}
              value={filtri.q}
              onChange={(e) => cambiaFiltri({ ...filtri, q: e.target.value })}
              onKeyDown={tasti}
              className="w-full pl-8 pr-3 py-1.5 text-[13px] rounded-[var(--raggio)] bg-superficie border border-campo text-inchiostro"
            />
          </div>
          <PickerFiltri filtri={filtri} onFiltri={cambiaFiltri} categorie={categorie} idBase={id} />
          <p className="text-[11px] text-tenue">Arrow keys move through the results, Enter picks one.</p>
        </div>
        <div className="flex-1 overflow-y-auto px-2" aria-busy={ricerca.stato === 'carica'}>
          <PickerRisultati
            ricerca={ricerca}
            listaId={listaId}
            attiva={attiva}
            onAttiva={setAttiva}
            onScegli={onScegli}
            onAltre={altre}
          />
        </div>
        <p aria-live="polite" className="sr-only">
          {ricerca.stato === 'pronto' ? `${ricerca.totale} ${ricerca.totale === 1 ? 'card' : 'cards'} found` : ''}
        </p>
      </div>
    </dialog>
  )
}
