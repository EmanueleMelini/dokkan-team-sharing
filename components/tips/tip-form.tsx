'use client'

import { useActionState, useEffect, useId, useRef, useState } from 'react'
import { editTip, postTip } from '@/lib/tips/actions'
import { TIP_LIMITS, caratteri, type TipActionState, type TipScope } from '@/lib/tips/validate'

type Comune = {
  /** dopo il salvataggio: chi lo usa chiude o rimonta il modulo (key) */
  onDone: (tipId: string | null) => void
  onCancel: () => void
}

type Nuova = Comune & {
  modo: 'post'
  eventId: string
  /** il tier mostrato; null = solo "Whole event" */
  tierId: string | null
  /** "This stage" o "This level" */
  etichettaTier: string
  /** EZA: si propone tutto l'evento (un consiglio vale per ogni livello) */
  scopeIniziale: TipScope
}

type Modifica = Comune & {
  modo: 'edit'
  tipId: string
  body: string
  link: string | null
}

const piccolo = 'px-3 py-1 text-[12px] rounded-[var(--raggio)] border transition-colors active:scale-[0.98] disabled:opacity-60'
const campo = 'block w-full px-3 py-1.5 text-[13px] rounded-[var(--raggio)] bg-superficie border border-campo text-inchiostro'

/**
 * Il modulo di una tip, per scriverne una o modificarla. Testo e link sono
 * controllati: se il server rifiuta (limite orario, doppione) chi scrive
 * non li perde. Il focus va al testo all'apertura.
 */
export function TipForm(props: Nuova | Modifica) {
  const [testo, setTesto] = useState(props.modo === 'edit' ? props.body : '')
  const [link, setLink] = useState(props.modo === 'edit' ? (props.link ?? '') : '')
  const [scope, setScope] = useState<TipScope>(props.modo === 'post' && props.tierId ? props.scopeIniziale : 'event')
  const { onDone } = props
  const [stato, azione, inCorso] = useActionState<TipActionState, FormData>(async (prev, form) => {
    const r = props.modo === 'post' ? await postTip(prev, form) : await editTip(prev, form)
    if (r.ok) onDone(r.tipId ?? null)
    return r
  }, {})
  const id = useId()
  const area = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { area.current?.focus() }, [])

  const resto = TIP_LIMITS.body - caratteri(testo)
  const corto = caratteri(testo.trim()) < TIP_LIMITS.bodyMin

  return (
    <form action={azione} aria-busy={inCorso} className="space-y-2.5">
      {props.modo === 'post' ? (
        <>
          <input type="hidden" name="event" value={props.eventId} />
          {props.tierId && <input type="hidden" name="tier" value={props.tierId} />}
        </>
      ) : (
        <input type="hidden" name="tip" value={props.tipId} />
      )}
      <div>
        <label htmlFor={`${id}-testo`} className="block text-[12px] text-tenue">
          {props.modo === 'post' ? 'Share a tip' : 'Edit your tip'}
        </label>
        <textarea
          ref={area}
          id={`${id}-testo`}
          name="body"
          value={testo}
          onChange={(e) => setTesto(e.target.value)}
          rows={3}
          maxLength={TIP_LIMITS.body}
          required
          placeholder="What should the next player know? One or two sentences."
          aria-describedby={`${id}-aiuto`}
          aria-invalid={stato.error ? true : undefined}
          className={`mt-1 ${campo}`}
        />
        <p id={`${id}-aiuto`} className="mt-1 text-[11px] text-tenue">
          <span className="numeri">{resto}</span> characters left. Plain text, one optional https link.
        </p>
      </div>
      <div>
        <label htmlFor={`${id}-link`} className="block text-[12px] text-tenue">Link (optional)</label>
        <input
          id={`${id}-link`}
          name="link"
          type="url"
          inputMode="url"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          maxLength={TIP_LIMITS.link}
          placeholder="https://"
          autoComplete="off"
          className={`mt-1 ${campo}`}
        />
      </div>
      {props.modo === 'post' && (
        props.tierId ? (
          <fieldset>
            <legend className="text-[12px] text-tenue">The tip is for</legend>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              {([['stage', props.etichettaTier], ['event', 'Whole event']] as const).map(([v, l]) => (
                <label key={v} className="inline-flex items-center gap-1.5 text-[13px] text-testo cursor-pointer">
                  <input type="radio" name="scope" value={v} checked={scope === v} onChange={() => setScope(v)}
                    className="accent-[var(--oro)]" />
                  {l}
                </label>
              ))}
            </div>
          </fieldset>
        ) : (
          <input type="hidden" name="scope" value="event" />
        )
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={inCorso || corto}
          className={`${piccolo} font-medium border-inchiostro bg-inchiostro text-sfondo hover:opacity-90`}
        >
          {props.modo === 'post' ? (inCorso ? 'Posting…' : 'Post tip') : (inCorso ? 'Saving…' : 'Save')}
        </button>
        <button type="button" onClick={props.onCancel}
          className={`${piccolo} border-linea bg-superficie text-testo hover:text-inchiostro`}>
          Cancel
        </button>
      </div>
      {stato.error && !inCorso && <p role="alert" className="text-[12px] text-str">{stato.error}</p>}
    </form>
  )
}
