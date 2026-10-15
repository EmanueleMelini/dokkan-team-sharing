'use client'

import Link from 'next/link'
import { relRobots } from '@/lib/robots'
import { useActionState, useReducer, useState } from 'react'
import { Plus } from '@phosphor-icons/react/dist/ssr'
import { BuildEditor, type BuildAperta } from '@/components/builder/build-editor'
import { Dettagli, type RunScelta } from '@/components/builder/dettagli'
import { Picker } from '@/components/builder/picker'
import type { Categoria } from '@/components/builder/picker-filtri'
import { Prove } from '@/components/builder/prove'
import { SquadraEditor } from '@/components/builder/squadra-editor'
import { CAMPO_DITO } from '@/components/scelta/stile'
import { reviseClear, submitClear, type ClearActionState } from '@/lib/clears/actions'
import { comeLaPartenza, payloadDa, reducer, type BuilderStato } from '@/lib/clears/builder-stato'
import { LIMITS, parseChangeNote, parsePayloadField } from '@/lib/clears/validate'
import type { Region } from '@/lib/queries'

type Props = {
  modo: 'submit' | 'edit'
  eventId: string
  tierId: string
  /** la versione delle run (e quindi delle carte che il picker propone) */
  reg: Region
  /** solo in modifica */
  clearId?: string
  runs: RunScelta[]
  categorie: Categoria[]
  /** le abilita' del Hidden Potential, per suggerire il percorso di una build */
  abilita: string[]
  iniziale: BuilderStato
  /** dove porta "Cancel": la pagina dell'evento */
  annulla: string
  /** inviato: l'azione e' partita; false se e' tornata con un errore (BuilderAzzerabile) */
  onInvio?: (inviato: boolean) => void
}

type Aperto = { l: number; i: number; dove: string } | null

/**
 * Il builder dei clear. Lo stato vive qui (useReducer) e parte al server
 * come un solo campo JSON: le stesse regole le rifà la Server Action e poi
 * il database, che resta l'autorità. Qui si controlla prima solo per
 * rispondere subito, senza un giro sul server.
 */
export function Builder({ modo, eventId, tierId, reg, clearId, runs, categorie, abilita, iniziale, annulla, onInvio }: Props) {
  const [stato, dispatch] = useReducer(reducer, iniziale)
  const [aperto, setAperto] = useState<Aperto>(null)
  const [build, setBuild] = useState<BuildAperta | null>(null)
  const [esito, azione, inCorso] = useActionState<ClearActionState, FormData>(async (prev, form) => {
    const p = parsePayloadField(form.get('payload'))
    if (!p.ok) return { error: p.error }
    if (!form.get('run')) return { error: 'Pick when you cleared it.' }
    if (modo === 'edit') {
      const r = parseChangeNote(form.get('change_note'))
      if (!r.ok) return { error: r.error }
    }
    // Se riesce l'azione porta alla pagina dell'evento (redirect) e non
    // torna qui: tornare vuol dire un rifiuto, e il form resta com'e'.
    onInvio?.(true)
    const esito = modo === 'edit' ? await reviseClear(prev, form) : await submitClear(prev, form)
    onInvio?.(false)
    return esito
  }, {})

  const cambi = stato.squadre.length - 1
  return (
    <form action={azione} className="mt-6 space-y-6" aria-busy={inCorso}>
      <input type="hidden" name="event" value={eventId} />
      <input type="hidden" name="tier" value={tierId} />
      <input type="hidden" name="run" value={stato.run} />
      {clearId && <input type="hidden" name="clear" value={clearId} />}
      <input type="hidden" name="payload" value={JSON.stringify(payloadDa(stato))} />

      <section aria-labelledby="b-squadre" className="space-y-3">
        <div>
          <h2 id="b-squadre" className="text-[15px] font-semibold text-inchiostro">Team</h2>
          <p className="mt-0.5 text-[12px] text-tenue">
            Pick the 7 units in rotation order, then mark the leader and the friend. The friend can be another copy of the leader card, in its own slot.
          </p>
        </div>
        {stato.squadre.map((q, l) => (
          <SquadraEditor
            key={l}
            squadra={q}
            l={l}
            idBase={`b-l${l}`}
            uguale={l > 0 && comeLaPartenza(stato, l)}
            dispatch={dispatch}
            onApri={(ll, i, dove) => setAperto({ l: ll, i, dove })}
            onBuild={(ll, i, dove) => {
              const c = stato.squadre[ll].slots[i].carta
              setBuild({ l: ll, i, dove, carta: c?.name ?? '', cartaId: c?.id ?? null })
            }}
          />
        ))}
        {stato.squadre.length < LIMITS.lineups && (
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => dispatch({ t: 'aggiungi_cambio' })}
                aria-describedby="b-cambio-aiuto"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] rounded-[var(--raggio)] border border-campo bg-superficie text-inchiostro hover:border-linea-forte active:scale-[0.98]"
              >
                <Plus size={13} weight="bold" aria-hidden />
                Add a rotation change
              </button>
              <span className="text-[11px] text-tenue">
                For a team switch mid-event. It starts as a copy of the team above. {LIMITS.lineups - 1 - cambi} left.
              </span>
            </div>
            <p id="b-cambio-aiuto" className="mt-1.5 text-[11px] text-tenue">
              Later edits to the starting team do not change the copies. Each change can copy it again.
            </p>
          </div>
        )}
      </section>

      <section aria-labelledby="b-dettagli" className="space-y-3 border-t border-linea pt-5">
        <h2 id="b-dettagli" className="text-[15px] font-semibold text-inchiostro">Details</h2>
        <Dettagli stato={stato} runs={runs} runFissa={modo === 'edit'} dispatch={dispatch} />
      </section>

      <section className="border-t border-linea pt-5">
        <Prove prove={stato.proofs} dispatch={dispatch} />
      </section>

      {modo === 'edit' && (
        <section className="border-t border-linea pt-5">
          <label htmlFor="b-change" className="block text-[13px] font-semibold text-inchiostro">What changed</label>
          <p id="b-change-aiuto" className="mt-0.5 text-[12px] text-tenue">
            Required. Shown with the new version; votes and comments start again on it.
          </p>
          <input
            id="b-change"
            name="change_note"
            value={stato.changeNote}
            onChange={(e) => dispatch({ t: 'campo', campo: 'changeNote', valore: e.target.value })}
            maxLength={LIMITS.changeNote}
            required
            aria-describedby="b-change-aiuto"
            className={`mt-2 block w-full px-3 py-1.5 text-[13px] rounded-[var(--raggio)] bg-superficie border border-campo text-inchiostro ${CAMPO_DITO}`}
          />
        </section>
      )}

      <div className="border-t border-linea pt-5 space-y-3">
        {esito.error && !inCorso && (
          <p role="alert" className="text-[13px] text-inchiostro bg-oro-tenue border border-oro-linea rounded-[var(--raggio)] px-3 py-2">
            {esito.error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={inCorso}
            className="px-4 py-2 text-[13px] font-medium rounded-[var(--raggio)] bg-inchiostro text-sfondo hover:opacity-90 transition-opacity disabled:opacity-60 active:scale-[0.98]"
          >
            {inCorso ? 'Saving…' : modo === 'edit' ? 'Save the new version' : 'Submit the clear'}
          </button>
          {/* torna al tier: senza prefetch, che ne avvierebbe la generazione */}
          <Link href={annulla} rel={relRobots(annulla)} prefetch={false} className="text-[13px] text-testo underline decoration-oro-linea underline-offset-2 hover:text-inchiostro">
            Cancel
          </Link>
        </div>
      </div>

      <BuildEditor
        aperta={build}
        build={build ? stato.squadre[build.l]?.slots[build.i]?.build ?? null : null}
        abilita={abilita}
        dispatch={dispatch}
        onChiudi={() => setBuild(null)}
      />
      <Picker
        titolo={aperto?.dove ?? null}
        categorie={categorie}
        reg={reg}
        onChiudi={() => setAperto(null)}
        onScegli={(c) => {
          if (aperto) dispatch({ t: 'carta', l: aperto.l, i: aperto.i, carta: c })
          setAperto(null)
        }}
      />
    </form>
  )
}
