'use client'

import { useActionState, useState } from 'react'
import { addComment, type ClearActionState } from '@/lib/clears/actions'
import { LIMITS } from '@/lib/clears/validate'
import { useSegnaCommentoMio } from '@/components/viewer/provider'

/**
 * Il modulo di un commento. Il testo è controllato: se il server rifiuta
 * (limite orario, versione cambiata) chi scrive non lo perde; si svuota
 * solo quando il commento è salvato.
 */
export function CommentoForm({ versionId, idBase }: { versionId: string; idBase: string }) {
  const [testo, setTesto] = useState('')
  const segnaMio = useSegnaCommentoMio()
  const [stato, azione, inCorso] = useActionState<ClearActionState, FormData>(async (prev, form) => {
    const r = await addComment(prev, form)
    if (r.ok) setTesto('')
    // il proprio commento nuovo non deve avere Report
    if (r.ok && r.commentId) segnaMio(r.commentId)
    return r
  }, {})
  const id = `${idBase}-nuovo`
  const resto = LIMITS.comment - testo.length

  return (
    <form action={azione} className="mt-3 space-y-2">
      <input type="hidden" name="version" value={versionId} />
      <label htmlFor={id} className="block text-[12px] text-tenue">Add a comment</label>
      <textarea
        id={id}
        name="body"
        value={testo}
        onChange={(e) => setTesto(e.target.value)}
        rows={2}
        maxLength={LIMITS.comment}
        required
        aria-describedby={`${id}-aiuto`}
        aria-invalid={stato.error ? true : undefined}
        className="block w-full px-3 py-1.5 text-[13px] rounded-[var(--raggio)] bg-superficie border border-campo text-inchiostro"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p id={`${id}-aiuto`} className="text-[11px] text-tenue">
          <span className="numeri">{resto}</span> characters left
        </p>
        <button
          type="submit"
          disabled={inCorso || testo.trim() === ''}
          className="px-3 py-1 text-[12px] font-medium rounded-[var(--raggio)] bg-inchiostro text-sfondo hover:opacity-90 transition-opacity disabled:opacity-60 active:scale-[0.98]"
        >
          {inCorso ? 'Posting…' : 'Post'}
        </button>
      </div>
      {stato.error && !inCorso && <p role="alert" className="text-[12px] text-str">{stato.error}</p>}
      <p aria-live="polite" className="sr-only">{stato.ok && !inCorso ? 'Comment posted.' : ''}</p>
    </form>
  )
}
