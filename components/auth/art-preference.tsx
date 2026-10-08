'use client'

import { useActionState, useEffect, useId } from 'react'
import { useViewer } from '@/components/viewer/provider'
import { setArtPreferenceAction, type ArtPreferenceState } from '@/lib/auth/actions'

const OPZIONI = [
  { value: 'still', label: 'Still frame (recommended on mobile data)' },
  { value: 'animated', label: 'Animated' },
] as const

/**
 * Il default dell'artwork per tutte le carte. Un form vero con due radio:
 * funziona anche senza JavaScript. Dopo il salvataggio fa rileggere
 * /api/me, cosi' le pagine delle carte aperte da qui usano subito il
 * default nuovo.
 */
export function ArtPreference({ animated }: { animated: boolean }) {
  const [stato, azione, inCorso] = useActionState<ArtPreferenceState, FormData>(setArtPreferenceAction, {})
  const { reload } = useViewer()
  const id = useId()

  useEffect(() => {
    if (stato.saved) reload()
  }, [stato, reload])

  const scelto = stato.saved ?? (animated ? 'animated' : 'still')

  return (
    <form action={azione} aria-busy={inCorso} className="space-y-3">
      <fieldset aria-describedby={`${id}-aiuto`}>
        <legend className="sr-only">Artwork on card pages</legend>
        <div className="space-y-2">
          {OPZIONI.map((o) => (
            <label key={o.value} className="flex items-center gap-2 text-[13px] text-inchiostro">
              <input
                type="radio"
                name="art"
                value={o.value}
                defaultChecked={scelto === o.value}
                className="accent-[var(--oro)]"
              />
              {o.label}
            </label>
          ))}
        </div>
      </fieldset>
      <p id={`${id}-aiuto`} className="text-[12px] leading-relaxed text-tenue">
        Animated artwork is about 4 MB per card, around 25 times the still image. You can switch on any
        card page; that choice is remembered on this device only.
      </p>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={inCorso}
          className="px-3 py-1.5 text-[13px] font-medium rounded-[var(--raggio)] border border-campo bg-superficie text-inchiostro hover:bg-superficie-2 transition-colors disabled:opacity-50"
        >
          {inCorso ? 'Saving…' : 'Save'}
        </button>
        <p role="status" className="text-[12px] text-tenue">
          {stato.error ? <span className="text-str">{stato.error}</span> : stato.saved && !inCorso ? 'Saved.' : ''}
        </p>
      </div>
    </form>
  )
}
