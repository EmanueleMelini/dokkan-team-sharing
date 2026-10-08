'use client'

import { LIMITS } from '@/lib/clears/validate'
import type { Azione, BuilderStato, RunScelta } from '@/lib/clears/builder-stato'

export type { RunScelta }

const campo = 'mt-1 block w-full px-3 py-1.5 text-[13px] rounded-[var(--raggio)] bg-superficie border border-campo text-inchiostro'
const etichetta = 'block text-[12px] text-tenue'

type Props = {
  stato: BuilderStato
  runs: RunScelta[]
  /** in modifica la ricorrenza resta quella del clear: revise non la cambia */
  runFissa?: boolean
  dispatch: (a: Azione) => void
}

/** Quando, in quanti turni, con quali regole, e la nota per chi legge. */
export function Dettagli({ stato, runs, runFissa = false, dispatch }: Props) {
  const set = (c: Parameters<typeof dispatch>[0] & { t: 'campo' }) => dispatch(c)
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {runFissa ? (
        <div>
          <p className={etichetta}>When you cleared it</p>
          <p className="mt-1 py-1.5 text-[13px] text-inchiostro">
            {runs.find((r) => r.id === stato.run)?.label ?? 'The run you picked before'}
          </p>
          <p className="text-[11px] text-tenue">To change the run, delete this clear and submit it again.</p>
        </div>
      ) : (
        <div>
          <label htmlFor="b-run" className={etichetta}>When you cleared it</label>
          <select
            id="b-run"
            value={stato.run}
            onChange={(e) => set({ t: 'campo', campo: 'run', valore: e.target.value })}
            className={campo}
          >
            {runs.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </div>
      )}
      <div>
        <label htmlFor="b-turns" className={etichetta}>Turns (optional)</label>
        <input
          id="b-turns"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={2}
          value={stato.turns}
          onChange={(e) => set({ t: 'campo', campo: 'turns', valore: e.target.value.replace(/\D/g, '') })}
          aria-describedby="b-turns-aiuto"
          className={`${campo} numeri sm:max-w-[8rem]`}
        />
        <p id="b-turns-aiuto" className="mt-1 text-[11px] text-tenue">1 to {LIMITS.turns}, for the whole stage.</p>
      </div>

      <fieldset className="sm:col-span-2">
        <legend className={etichetta}>Rules you kept</legend>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {([['noItems', 'No items'], ['deathless', 'No KOs']] as const).map(([k, t]) => (
            <label
              key={k}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-[13px] rounded-[var(--raggio)] border border-campo bg-superficie text-inchiostro has-[:checked]:border-oro has-[:checked]:bg-oro-tenue cursor-pointer"
            >
              <input
                type="checkbox"
                checked={stato[k]}
                onChange={(e) => set({ t: 'campo', campo: k, valore: e.target.checked })}
                className="accent-[var(--oro)]"
              />
              {t}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="sm:col-span-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <label htmlFor="b-note" className={etichetta}>Note (optional)</label>
          <label className="inline-flex items-center gap-1.5 text-[11px] text-tenue">
            Written in
            <select
              value={stato.lang}
              onChange={(e) => set({ t: 'campo', campo: 'lang', valore: e.target.value })}
              className="px-1.5 py-0.5 text-[12px] rounded-[var(--raggio)] bg-superficie border border-campo text-inchiostro"
            >
              <option value="en">English</option>
              <option value="ja">Japanese</option>
            </select>
          </label>
        </div>
        <textarea
          id="b-note"
          rows={4}
          maxLength={LIMITS.note}
          value={stato.note}
          onChange={(e) => set({ t: 'campo', campo: 'note', valore: e.target.value })}
          aria-describedby="b-note-aiuto"
          className={campo}
        />
        <p id="b-note-aiuto" className="mt-1 text-[11px] text-tenue">
          Order of attacks, who to keep for the last phase, anything the next player should know.{' '}
          <span className="numeri">{LIMITS.note - stato.note.length}</span> characters left.
        </p>
      </div>
    </div>
  )
}
