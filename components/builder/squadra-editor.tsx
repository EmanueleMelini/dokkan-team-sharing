'use client'

import { RicopiaPartenza } from '@/components/builder/ricopia-partenza'
import { Slot } from '@/components/builder/slot'
import { LIMITS, SHAPE } from '@/lib/clears/validate'
import type { Azione, SquadraStato } from '@/lib/clears/builder-stato'

const GRUPPI = [
  { rot: 1, nome: 'Rotation 1' },
  { rot: 2, nome: 'Rotation 2' },
  { rot: 3, nome: 'Floaters' },
] as const

const campo = 'mt-1 block w-full px-3 py-1.5 text-[13px] rounded-[var(--raggio)] bg-superficie border border-campo text-inchiostro'

type Props = {
  squadra: SquadraStato
  l: number
  idBase: string
  /** solo per i cambi: vero se ha gli stessi slot della partenza */
  uguale: boolean
  dispatch: (a: Azione) => void
  onApri: (l: number, i: number, dove: string) => void
  onBuild: (l: number, i: number, dove: string) => void
}

/** Una squadra del clear: la partenza (l = 0) o un cambio a metà evento. */
export function SquadraEditor({ squadra, l, idBase, uguale, dispatch, onApri, onBuild }: Props) {
  const nome = l === 0 ? 'Starting team' : `Change ${l}`
  const titoloId = `${idBase}-titolo`
  return (
    <fieldset aria-labelledby={titoloId} className="border border-linea rounded-[var(--raggio)] bg-superficie p-3 sm:p-4 min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={titoloId} className="text-[13px] font-semibold text-inchiostro">{nome}</h3>
        {l > 0 && (
          <button
            type="button"
            onClick={() => dispatch({ t: 'togli_cambio', l })}
            className="text-[12px] text-tenue underline underline-offset-2 hover:text-str"
          >
            Remove {nome.toLowerCase()}
          </button>
        )}
      </div>

      {l > 0 && (
        <div className="mt-2 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div>
            <label htmlFor={`${idBase}-label`} className="block text-[12px] text-tenue">When it starts</label>
            <input
              id={`${idBase}-label`}
              value={squadra.label}
              onChange={(e) => dispatch({ t: 'squadra', l, campo: 'label', valore: e.target.value })}
              maxLength={LIMITS.lineupLabel}
              required
              placeholder="From phase 3"
              className={`${campo} placeholder:text-tenue`}
            />
          </div>
          <div>
            <label htmlFor={`${idBase}-note`} className="block text-[12px] text-tenue">What changes and why (optional)</label>
            <input
              id={`${idBase}-note`}
              value={squadra.note}
              onChange={(e) => dispatch({ t: 'squadra', l, campo: 'note', valore: e.target.value })}
              maxLength={LIMITS.lineupNote}
              className={campo}
            />
          </div>
        </div>
      )}

      {l > 0 && (
        <div className="mt-2">
          <RicopiaPartenza nome={nome} uguale={uguale} onRicopia={() => dispatch({ t: 'ricopia_partenza', l })} />
        </div>
      )}

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)]">
        {GRUPPI.map((g) => {
          const gid = `${idBase}-g${g.rot}`
          return (
            <div key={g.rot} role="group" aria-labelledby={gid} className="min-w-0">
              <h4 id={gid} className="text-[11px] text-tenue mb-1.5">{g.nome}</h4>
              <ul className="grid gap-2 grid-cols-1 min-[420px]:grid-cols-2 sm:grid-cols-1">
                {SHAPE.map(([rot, pos], i) => {
                  if (rot !== g.rot) return null
                  const dove = `${l === 0 ? '' : `${nome}, `}${g.nome}, slot ${pos}`
                  return (
                    <li key={i} className="min-w-0">
                      <Slot
                        slot={squadra.slots[i]}
                        dove={dove}
                        onApri={() => onApri(l, i, dove)}
                        onSvuota={() => dispatch({ t: 'svuota', l, i })}
                        onRuolo={(role) => dispatch({ t: 'ruolo', l, i, role })}
                        onBuild={() => onBuild(l, i, dove)}
                      />
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>
    </fieldset>
  )
}
