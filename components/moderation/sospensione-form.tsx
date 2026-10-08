'use client'

import { useActionState, useEffect, useId, useRef, useState } from 'react'
import { ReauthNotice } from '@/components/auth/reauth-notice'
import { suspendUser, unsuspendUser, type ModState } from '@/lib/moderation/actions'
import { NOTE_MAX, SUSPENSION_REASON_MAX } from '@/lib/moderation/reasons'

const bottone =
  'px-3 py-1.5 text-[13px] font-medium rounded-[var(--raggio)] border transition-colors active:scale-[0.98] disabled:opacity-60'

const DURATE = [
  { v: '1d', label: '1 day' },
  { v: '7d', label: '7 days' },
  { v: '30d', label: '30 days' },
  { v: 'indefinite', label: 'Indefinitely' },
] as const

type Props = {
  userId: string
  handle: string
  /** se la sessione e' fresca: decide solo cosa mostrare, l'azione lo ricontrolla */
  fresh: boolean
  suspended: boolean
}

/**
 * Sospendere o riattivare, con lo stesso schema di Delete account: prima
 * un bottone, poi il modulo accanto, senza dialoghi. Con una sessione
 * vecchia compare l'invito a rientrare al posto del modulo. La pagina lo
 * monta con key sullo stato, cosi' dopo l'azione riparte chiuso.
 */
export function SospensioneForm({ userId, handle, fresh, suspended }: Props) {
  const [apre, setApre] = useState(false)
  const [stato, azione, inCorso] = useActionState<ModState, FormData>(suspended ? unsuspendUser : suspendUser, {})
  const apri = useRef<HTMLButtonElement>(null)
  const primo = useRef<HTMLInputElement>(null)
  const primoGiro = useRef(true)
  const idMotivo = useId()
  const idAiuto = useId()

  useEffect(() => {
    if (primoGiro.current) { primoGiro.current = false; return }
    if (apre) primo.current?.focus()
    else apri.current?.focus()
  }, [apre])

  if (!apre) {
    return (
      <div className="space-y-2">
        <button ref={apri} type="button" onClick={() => setApre(true)}
          className={suspended
            ? `${bottone} border-linea bg-superficie text-testo hover:text-inchiostro hover:border-linea-forte`
            : `${bottone} border-str bg-superficie text-str hover:bg-str hover:text-sfondo`}>
          {suspended ? 'Lift suspension' : 'Suspend user'}
        </button>
        {stato.ok && <p role="status" className="text-[12px] text-tenue">{stato.message}</p>}
      </div>
    )
  }

  if (!fresh || stato.reauth) return <ReauthNotice onCancel={() => setApre(false)} />

  return (
    <form action={azione} className="space-y-3" aria-busy={inCorso}>
      <input type="hidden" name="user" value={userId} />
      {suspended ? (
        <div>
          <label htmlFor={idMotivo} className="block text-[12px] text-inchiostro">Note for the log (optional, only moderators see it)</label>
          <input ref={primo} id={idMotivo} name="note" type="text" maxLength={NOTE_MAX} autoComplete="off"
            className="mt-1.5 w-full max-w-md px-2.5 py-1.5 text-[13px] rounded-[var(--raggio)] border border-campo bg-superficie text-inchiostro" />
        </div>
      ) : (
        <>
          <fieldset>
            <legend className="text-[12px] text-inchiostro">Suspend {handle} for</legend>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-2">
              {DURATE.map((d, i) => (
                <label key={d.v} className="inline-flex items-center gap-1.5 text-[13px] text-testo">
                  <input ref={i === 0 ? primo : undefined} type="radio" name="duration" value={d.v} defaultChecked={d.v === '7d'}
                    className="accent-[var(--oro)]" />
                  {d.label}
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor={idMotivo} className="block text-[12px] text-inchiostro">Reason (optional)</label>
            <textarea id={idMotivo} name="reason" rows={2} maxLength={SUSPENSION_REASON_MAX} aria-describedby={idAiuto}
              className="mt-1.5 block w-full max-w-md px-2.5 py-1.5 text-[13px] rounded-[var(--raggio)] border border-campo bg-superficie text-inchiostro" />
            <p id={idAiuto} className="mt-1 text-[11px] text-tenue">
              {handle} sees this reason. Up to {SUSPENSION_REASON_MAX} characters.
            </p>
          </div>
        </>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={inCorso}
          className={suspended ? `${bottone} border-inchiostro bg-inchiostro text-sfondo hover:opacity-90` : `${bottone} border-str bg-str text-sfondo hover:opacity-90`}>
          {inCorso ? 'Saving…' : suspended ? 'Lift suspension' : 'Suspend'}
        </button>
        <button type="button" onClick={() => setApre(false)}
          className={`${bottone} border-linea bg-superficie text-testo hover:text-inchiostro`}>
          Cancel
        </button>
      </div>
      {stato.error && !inCorso && <p role="alert" className="text-[12px] text-str">{stato.error}</p>}
    </form>
  )
}
