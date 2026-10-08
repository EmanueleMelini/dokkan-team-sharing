'use client'

import { useActionState, useEffect, useId, useRef, useState } from 'react'
import { Flag } from '@phosphor-icons/react/dist/ssr'
import { reportContent } from '@/lib/moderation/report-actions'
import type { ReportActionState } from '@/lib/moderation/report-form'
import { DETAILS_MAX, REASONS_BY_KIND, REASON_LABELS, needsDetails, type ReportReason } from '@/lib/moderation/reasons'

type Props = {
  kind: 'clear' | 'comment'
  target: string
}

const piccolo = 'px-2 py-1 text-[12px] rounded-[var(--raggio)] border transition-colors active:scale-[0.98] disabled:opacity-60'

/**
 * Report in linea, come Delete (elimina.tsx): il bottone apre sul posto i
 * motivi e i dettagli, senza un dialogo modale. Il focus va al primo
 * motivo e torna a Report se si annulla. Chi lo vede lo decidono le isole
 * sotto (SegnalaClear, SegnalaCommento), da /api/me.
 */
export function Segnala({ kind, target }: Props) {
  const [aperto, setAperto] = useState(false)
  const [motivo, setMotivo] = useState<ReportReason | null>(null)
  const [dettagli, setDettagli] = useState('')
  const [stato, azione, inCorso] = useActionState<ReportActionState, FormData>(reportContent, {})
  const apri = useRef<HTMLButtonElement>(null)
  const primo = useRef<HTMLInputElement>(null)
  const primoGiro = useRef(true)
  const id = useId()

  useEffect(() => {
    if (primoGiro.current) { primoGiro.current = false; return }
    if (aperto) primo.current?.focus()
    else apri.current?.focus()
  }, [aperto])

  const cosa = kind === 'clear' ? 'clear' : 'comment'

  // Inviata (o gia' inviata prima: per chi segnala e' lo stesso): solo il grazie
  if (stato.ok) {
    return <p role="status" className="text-[11px] text-tenue">{stato.message}</p>
  }

  if (!aperto) {
    return (
      <button
        ref={apri}
        type="button"
        onClick={() => setAperto(true)}
        aria-expanded={false}
        className="inline-flex items-center gap-1 text-[11px] text-tenue hover:text-inchiostro transition-colors"
      >
        <Flag size={11} weight="bold" aria-hidden />
        Report<span className="sr-only"> this {cosa}</span>
      </button>
    )
  }

  const servono = motivo !== null && needsDetails(motivo)
  const resto = DETAILS_MAX - [...dettagli].length

  return (
    <form action={azione} aria-busy={inCorso} className="basis-full w-full mt-1 space-y-2.5 border border-linea rounded-[var(--raggio)] bg-superficie-2 p-3">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="target" value={target} />
      <fieldset>
        <legend className="text-[12px] font-medium text-inchiostro">Why are you reporting this {cosa}?</legend>
        <div className="mt-2 grid gap-1.5">
          {REASONS_BY_KIND[kind].map((r, i) => (
            <label key={r} className="flex items-start gap-2 text-[12px] text-testo cursor-pointer">
              <input
                ref={i === 0 ? primo : undefined}
                type="radio"
                name="reason"
                value={r}
                required
                checked={motivo === r}
                onChange={() => setMotivo(r)}
                className="mt-0.5 accent-[var(--oro)]"
              />
              {REASON_LABELS[r]}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor={`${id}-dettagli`} className="block text-[12px] text-tenue">
          Details{servono ? '' : ' (optional)'}
        </label>
        <textarea
          id={`${id}-dettagli`}
          name="details"
          value={dettagli}
          onChange={(e) => setDettagli(e.target.value)}
          rows={2}
          maxLength={DETAILS_MAX}
          required={servono}
          aria-describedby={`${id}-aiuto`}
          className="mt-1 block w-full px-3 py-1.5 text-[13px] rounded-[var(--raggio)] bg-superficie border border-campo text-inchiostro"
        />
        <p id={`${id}-aiuto`} className="mt-1 text-[11px] text-tenue">
          Required for Something else. <span className="numeri">{resto}</span> characters left.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={inCorso || motivo === null || (servono && dettagli.trim() === '')}
          className={`${piccolo} border-inchiostro bg-inchiostro text-sfondo hover:opacity-90`}
        >
          {inCorso ? 'Sending…' : 'Send report'}
        </button>
        <button
          type="button"
          onClick={() => setAperto(false)}
          className={`${piccolo} border-linea bg-superficie text-testo hover:text-inchiostro`}
        >
          Cancel
        </button>
      </div>
      {stato.error && !inCorso && <p role="alert" className="text-[12px] text-str">{stato.error}</p>}
    </form>
  )
}
