'use client'

import { useState, useTransition } from 'react'
import { removePushDeviceAction, setPushGroupAction } from '@/lib/notify/push-actions'
import { pushGroupsFor, type PushGroupId } from '@/lib/notify/push-kinds'

/** Un dispositivo come lo mostra Settings: niente endpoint, solo la sua impronta. */
export type DispositivoVista = {
  id: string
  label: string | null
  hash: string
  /** la data dell'iscrizione, gia' scritta dal server */
  added: string
  failing: boolean
}

const piccolo = 'text-[12px] text-testo underline decoration-oro-linea underline-offset-2 hover:text-inchiostro disabled:opacity-50'

/**
 * Cosa arriva come push (un interruttore per gruppo, per tutti i
 * dispositivi) e la lista dei dispositivi con Remove. Al massimo 5: il
 * sesto si rifiuta, e da qui si toglie uno vecchio. "This device" si
 * riconosce dall'impronta dell'endpoint, che il server non manda mai per
 * intero.
 */
export function PushDispositivi({ devices, questo, admin, groupsOn, onRimuoviQuesto }: {
  devices: DispositivoVista[]
  questo: string | null
  admin: boolean
  groupsOn: PushGroupId[]
  onRimuoviQuesto: () => void
}) {
  const [accesi, setAccesi] = useState<Set<PushGroupId>>(() => new Set(groupsOn))
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, avvia] = useTransition()

  if (devices.length === 0) return null

  const cambia = (id: PushGroupId, on: boolean) => {
    setErrore(null)
    const prima = accesi
    const dopo = new Set(prima)
    if (on) dopo.add(id)
    else dopo.delete(id)
    setAccesi(dopo)
    avvia(async () => {
      const r = await setPushGroupAction(id, on).catch(() => ({ ok: false as const, error: 'This setting could not be saved. Try again.' }))
      if (!r.ok) {
        setAccesi(prima)
        setErrore(r.error)
      }
    })
  }

  const rimuovi = (d: DispositivoVista) => {
    setErrore(null)
    if (d.hash === questo) return onRimuoviQuesto()
    avvia(async () => {
      const r = await removePushDeviceAction(d.id).catch(() => ({ ok: false as const, error: 'This device could not be removed. Try again.' }))
      if (!r.ok) setErrore(r.error)
    })
  }

  return (
    <div className="space-y-3 pt-1" aria-busy={inCorso}>
      <fieldset>
        <legend className="text-[12px] font-medium text-inchiostro">Send to all your devices</legend>
        <div className="mt-1.5 space-y-1.5">
          {pushGroupsFor(admin).map((g) => (
            <label key={g.id} className="flex items-start gap-2 text-[13px] text-inchiostro">
              <input
                type="checkbox"
                checked={accesi.has(g.id)}
                onChange={(e) => cambia(g.id, e.target.checked)}
                className="mt-0.5 accent-[var(--oro)]"
              />
              <span>{g.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <p className="text-[12px] font-medium text-inchiostro">Your devices</p>
        <ul className="mt-1.5 divide-y divide-linea border-y border-linea">
          {devices.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
              <p className="text-[13px] text-inchiostro">
                {d.label ?? 'Unknown browser'}
                {d.hash === questo && <span className="ml-2 text-[12px] font-medium text-oro">This device</span>}
                <span className="ml-2 text-[12px] text-tenue">Added {d.added}</span>
                {d.failing && <span className="ml-2 text-[12px] text-tenue">Not reachable lately</span>}
              </p>
              <button type="button" onClick={() => rimuovi(d)} disabled={inCorso} className={piccolo}>
                Remove<span className="sr-only"> {d.label ?? 'this device'}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      {errore && <p role="alert" className="text-[12px] text-str">{errore}</p>}
    </div>
  )
}
