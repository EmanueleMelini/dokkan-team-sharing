'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { X } from '@phosphor-icons/react/dist/ssr'
import { SferaPicker } from '@/components/builder/sfera-picker'
import { Scelta } from '@/components/scelta/scelta'
import { CAMPO_DITO } from '@/components/scelta/stile'
import { GRADI } from '@/lib/clears/build'
import { OPZIONI_ROUTES } from '@/lib/clears/builder-opzioni'
import { buildPiena, type Azione, type BuildStato } from '@/lib/clears/builder-stato'
import { LIMITS } from '@/lib/clears/validate'

/** carta: il nome per il titolo; cartaId: per cercare solo le sfere che puo' montare */
export type BuildAperta = { l: number; i: number; dove: string; carta: string; cartaId: number | null }

type Props = {
  aperta: BuildAperta | null
  build: BuildStato | null
  /** le abilita' del Hidden Potential, suggerite come percorso */
  abilita: string[]
  dispatch: (a: Azione) => void
  onChiudi: () => void
}

// col dito alti quanto i menu (CAMPO_DITO)
const campo = `mt-1 block w-full px-3 py-1.5 text-[13px] rounded-[var(--raggio)] bg-superficie border border-campo text-inchiostro ${CAMPO_DITO}`
const piccolo = 'px-2 py-1 text-[12px] rounded-[var(--raggio)] border border-campo bg-superficie text-inchiostro hover:border-linea-forte'

/**
 * La build di uno slot in un <dialog> modale. Si scrive direttamente
 * nello stato del builder: Done chiude e basta, non c'e' niente da
 * salvare a parte. Tutto opzionale; una build vuota non parte.
 */
export function BuildEditor({ aperta, build, abilita, dispatch, onChiudi }: Props) {
  const dialogo = useRef<HTMLDialogElement>(null)
  // il primo campo: il menu del Hidden Potential (il <select> prima del cambio, poi l'<input>)
  const primo = useRef<HTMLInputElement | HTMLSelectElement>(null)
  const id = useId()
  const [cerca, setCerca] = useState<number | null>(null)
  // Chiusa la ricerca di una sfera, il focus torna al bottone del suo
  // slot: senza, finirebbe sul body e la tastiera ripartirebbe da capo.
  const bottoni = useRef<(HTMLButtonElement | null)[]>([])
  const daRiprendere = useRef<number | null>(null)
  const chiudiRicerca = () => { daRiprendere.current = cerca; setCerca(null) }
  useEffect(() => {
    if (cerca !== null || daRiprendere.current === null) return
    bottoni.current[daRiprendere.current]?.focus()
    daRiprendere.current = null
  }, [cerca, build])
  const aperto = aperta !== null && build !== null

  useEffect(() => {
    const d = dialogo.current
    if (!d) return
    // showModal metterebbe il focus su Close: va al primo campo (il focus
    // da programma non apre l'elenco)
    if (aperto && !d.open) { d.showModal(); primo.current?.focus() }
    if (!aperto && d.open) d.close()
  }, [aperto])

  const a = aperta ?? { l: 0, i: 0, dove: '', carta: '', cartaId: null }
  const b = build
  const set = (c: 'routes' | 'path' | 'note', valore: string) => dispatch({ t: 'build', l: a.l, i: a.i, campo: c, valore })

  return (
    <dialog
      ref={dialogo}
      aria-labelledby={`${id}-titolo`}
      onClose={() => { setCerca(null); onChiudi() }}
      className="fixed inset-0 m-0 w-full h-dvh max-w-none max-h-none p-0 bg-superficie text-testo backdrop:bg-black/50 sm:m-auto sm:w-[min(38rem,92vw)] sm:h-fit sm:max-h-[88dvh] sm:rounded-[var(--raggio)] sm:border sm:border-linea"
    >
      {b && (
        <div className="flex h-full flex-col sm:max-h-[88dvh]">
          <div className="flex items-start justify-between gap-3 px-4 pt-3">
            <div className="min-w-0">
              <h2 id={`${id}-titolo`} className="text-[14px] font-semibold text-inchiostro">
                Build<span className="font-normal text-tenue">, {a.dove}</span>
              </h2>
              <p className="text-[12px] text-tenue truncate">{a.carta}. Optional: fill only what matters for this clear.</p>
            </div>
            <button type="button" onClick={() => dialogo.current?.close()} aria-label="Close"
              className="inline-flex shrink-0 items-center justify-center w-8 h-8 rounded-[var(--raggio)] text-tenue hover:text-inchiostro">
              <X size={16} weight="bold" aria-hidden />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
              <div>
                <label htmlFor={`${id}-routes`} className="block text-[12px] text-tenue">Hidden Potential</label>
                <Scelta
                  id={`${id}-routes`}
                  ref={primo}
                  etichetta="Hidden Potential"
                  opzioni={OPZIONI_ROUTES}
                  valore={b.routes}
                  onCambia={(v) => set('routes', v)}
                  className="mt-1 w-full"
                />
              </div>
              <div>
                <label htmlFor={`${id}-path`} className="block text-[12px] text-tenue">Path or skills (optional)</label>
                <input id={`${id}-path`} list={`${id}-abilita`} value={b.path} maxLength={LIMITS.buildPath}
                  onChange={(e) => set('path', e.target.value)} aria-describedby={`${id}-path-aiuto`} className={campo} />
                <datalist id={`${id}-abilita`}>
                  {abilita.map((x) => <option key={x} value={x} />)}
                </datalist>
                <p id={`${id}-path-aiuto`} className="mt-1 text-[11px] text-tenue">For example Critical Hit, or Combo Attack and Evasion.</p>
              </div>
            </div>

            <fieldset className="min-w-0">
              <legend className="text-[12px] text-tenue">Skill Orbs</legend>
              <ol className="mt-1 space-y-2">
                {b.sfere.map((s, k) => {
                  const dove = `Skill Orb slot ${k + 1}`
                  return (
                    <li key={k} className="min-w-0">
                      {cerca === k ? (
                        <SferaPicker
                          dove={dove}
                          carta={a.cartaId}
                          onAnnulla={chiudiRicerca}
                          onScegli={(x) => {
                            dispatch({ t: 'sfera', l: a.l, i: a.i, k, sfera: { id: x.id, name: x.name, tier: x.tier } })
                            chiudiRicerca()
                          }}
                        />
                      ) : (
                        <div className="flex flex-wrap items-center gap-2 rounded-[var(--raggio)] border border-linea px-2 py-1.5">
                          <span className="text-[11px] text-tenue w-11 shrink-0">Slot {k + 1}</span>
                          {s ? (
                            <span className="min-w-0 flex-1 text-[12px] text-inchiostro">
                              {s.name} <span className="text-tenue">· {GRADI[s.tier]}</span>
                            </span>
                          ) : (
                            <span className="min-w-0 flex-1 text-[12px] text-tenue">Empty</span>
                          )}
                          <span className="flex gap-1.5">
                            <button type="button" ref={(el) => { bottoni.current[k] = el }} onClick={() => setCerca(k)} className={piccolo}>
                              {s ? 'Change' : 'Add'}<span className="sr-only">, {dove}</span>
                            </button>
                            {s && (
                              <button type="button" onClick={() => {
                                // Remove sparisce: il focus va su Add dello stesso slot
                                daRiprendere.current = k
                                dispatch({ t: 'sfera', l: a.l, i: a.i, k, sfera: null })
                              }} className={piccolo}>
                                Remove<span className="sr-only">, {dove}</span>
                              </button>
                            )}
                          </span>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ol>
            </fieldset>

            <div>
              <label htmlFor={`${id}-note`} className="block text-[12px] text-tenue">Note (optional)</label>
              <textarea id={`${id}-note`} value={b.note} maxLength={LIMITS.buildNote} rows={2}
                onChange={(e) => set('note', e.target.value)} aria-describedby={`${id}-note-n`} className={`${campo} resize-y`} />
              <p id={`${id}-note-n`} className="mt-1 text-[11px] text-tenue text-right numeri">
                {b.note.length}/{LIMITS.buildNote}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-linea px-4 py-3">
            <button type="button" disabled={!buildPiena(b)} onClick={() => dispatch({ t: 'togli_build', l: a.l, i: a.i })}
              className="text-[12px] text-tenue underline underline-offset-2 hover:text-str disabled:opacity-50 disabled:no-underline">
              Clear the build
            </button>
            <button type="button" onClick={() => dialogo.current?.close()}
              className="px-4 py-1.5 text-[13px] font-medium rounded-[var(--raggio)] bg-inchiostro text-sfondo hover:opacity-90 active:scale-[0.98]">
              Done
            </button>
          </div>
        </div>
      )}
    </dialog>
  )
}
