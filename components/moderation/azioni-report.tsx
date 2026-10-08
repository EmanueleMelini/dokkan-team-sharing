'use client'

import { useActionState, useEffect, useId, useRef, useState } from 'react'
import {
  dismissReports, setClearStatus, setCommentStatus, setTipStatus, type ModState,
} from '@/lib/moderation/actions'
import { NOTE_MAX } from '@/lib/moderation/reasons'

const piccolo =
  'px-2 py-1 text-[12px] rounded-[var(--raggio)] border transition-colors active:scale-[0.98] disabled:opacity-60'

type Props = {
  kind: 'clear' | 'comment' | 'tip' | string
  targetId: string
  /** quante segnalazioni aperte: per la domanda di conferma */
  n: number
  /** false se il bersaglio non c'e' piu' o e' gia' nascosto: resta solo Dismiss */
  canHide: boolean
}

/**
 * I bottoni di una riga della coda, in un solo form: il bottone premuto
 * dice quale azione (op). Hide si annulla dalla scheda Hidden, quindi
 * basta un clic; Dismiss chiude le segnalazioni senza toccare il post e
 * chiede conferma accanto al bottone, come Delete di un clear.
 */
export function AzioniReport({ kind, targetId, n, canHide }: Props) {
  const [chiede, setChiede] = useState(false)
  const [nota, setNota] = useState(false)
  const idNota = useId()
  const conferma = useRef<HTMLButtonElement>(null)
  const apri = useRef<HTMLButtonElement>(null)
  const primoGiro = useRef(true)

  const [stato, azione, inCorso] = useActionState<ModState, FormData>(async (prev, form) => {
    const op = form.get('op')
    if (op === 'dismiss') {
      form.set('kind', kind)
      form.set('target', targetId)
      return dismissReports(prev, form)
    }
    form.set('status', 'hidden')
    if (op === 'hide_clear') { form.set('clear', targetId); return setClearStatus(prev, form) }
    if (op === 'hide_comment') { form.set('comment', targetId); return setCommentStatus(prev, form) }
    if (op === 'hide_tip') { form.set('tip', targetId); return setTipStatus(prev, form) }
    return prev
  }, {})

  useEffect(() => {
    if (primoGiro.current) { primoGiro.current = false; return }
    if (chiede) conferma.current?.focus()
    else apri.current?.focus()
  }, [chiede])

  const hide = kind === 'clear' ? 'hide_clear' : kind === 'comment' ? 'hide_comment' : kind === 'tip' ? 'hide_tip' : null

  return (
    <form action={azione} className="space-y-2" aria-busy={inCorso}>
      {nota ? (
        <div>
          <label htmlFor={idNota} className="block text-[11px] text-tenue">Note for the log (only moderators see it)</label>
          <input
            id={idNota}
            name="note"
            type="text"
            maxLength={NOTE_MAX}
            autoComplete="off"
            className="mt-1 w-full max-w-md px-2.5 py-1 text-[12px] rounded-[var(--raggio)] border border-campo bg-superficie text-inchiostro"
          />
        </div>
      ) : null}
      {/* key diverse: senza, React riuserebbe il <button> di "Dismiss reports"
          per quello di conferma, che diventa type=submit mentre il clic e'
          ancora in corso, e il browser invierebbe il form al primo clic */}
      {chiede ? (
        <div key="conferma" className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-inchiostro">
            Dismiss {n === 1 ? 'this report' : `these ${n} reports`} and leave the post as it is?
          </span>
          <button ref={conferma} type="submit" name="op" value="dismiss" disabled={inCorso}
            className={`${piccolo} border-inchiostro bg-inchiostro text-sfondo hover:opacity-90`}>
            {inCorso ? 'Dismissing…' : 'Dismiss'}
          </button>
          <button type="button" onClick={() => setChiede(false)}
            className={`${piccolo} border-linea bg-superficie text-testo hover:text-inchiostro`}>
            Cancel
          </button>
        </div>
      ) : (
        <div key="azioni" className="flex flex-wrap items-center gap-2">
          {hide && canHide && (
            <button type="submit" name="op" value={hide} disabled={inCorso}
              className={`${piccolo} border-str bg-superficie text-str hover:bg-str hover:text-sfondo`}>
              {inCorso ? 'Hiding…' : kind === 'clear' ? 'Hide clear' : kind === 'tip' ? 'Hide tip' : 'Hide comment'}
            </button>
          )}
          <button ref={apri} type="button" onClick={() => setChiede(true)} disabled={inCorso}
            className={`${piccolo} border-linea bg-superficie text-testo hover:text-inchiostro hover:border-linea-forte`}>
            Dismiss reports
          </button>
          {!nota && (
            <button type="button" onClick={() => setNota(true)}
              className="text-[12px] text-tenue underline decoration-linea-forte underline-offset-2 hover:text-inchiostro">
              Add a note
            </button>
          )}
        </div>
      )}
      {stato.error && !inCorso && <p role="alert" className="text-[12px] text-str">{stato.error}</p>}
      <p aria-live="polite" className="text-[12px] text-tenue">{stato.ok && !inCorso ? stato.message : ''}</p>
    </form>
  )
}
