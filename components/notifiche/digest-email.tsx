'use client'

import { useActionState, useId } from 'react'
import { setEmailDigestAction, type EmailDigestState } from '@/lib/notify/actions'

/**
 * La casella "Daily email digest" (0029): spenta per difetto, si accende
 * solo con l'email verificata. Un form vero con un Save, come l'artwork:
 * funziona anche senza JavaScript. Lo stato salvato vince su quello con
 * cui la pagina e' arrivata.
 */
export function DigestEmail({ on, verified, email, admin }: { on: boolean; verified: boolean; email: string; admin: boolean }) {
  const [stato, azione, inCorso] = useActionState<EmailDigestState, FormData>(setEmailDigestAction, {})
  const id = useId()
  const acceso = stato.saved ? stato.on === true : on
  // Senza email verificata si puo' solo spegnere (se fosse rimasta accesa).
  const bloccata = !verified && !acceso

  return (
    <form action={azione} aria-busy={inCorso} className="space-y-3">
      <label className="flex items-start gap-2 text-[13px] text-inchiostro">
        <input
          // key: dopo il salvataggio la casella riparte dal valore salvato
          key={String(acceso)}
          type="checkbox"
          name="digest"
          defaultChecked={acceso}
          disabled={bloccata}
          aria-describedby={`${id}-aiuto`}
          className="mt-0.5 accent-[var(--oro)]"
        />
        <span>Daily email digest</span>
      </label>
      <p id={`${id}-aiuto`} className="text-[12px] leading-relaxed text-tenue">
        At most one email a day, only when something is new: comments on your clears, how many
        upvotes your clears and Helpful votes your tips got, and moderation updates about your posts
        or account{admin ? ', plus open reports to review' : ''}. It never quotes posts.{' '}
        {verified ? (
          <>It goes to <span className="break-all text-testo">{email}</span>.</>
        ) : (
          <>It needs a verified email: sign in once with the email link to verify yours.</>
        )}{' '}
        Off unless you turn it on, and you can turn it off any time here or with the link in every email.
      </p>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={inCorso || bloccata}
          className="px-3 py-1.5 text-[13px] font-medium rounded-[var(--raggio)] border border-campo bg-superficie text-inchiostro hover:bg-superficie-2 transition-colors disabled:opacity-50"
        >
          {inCorso ? 'Saving…' : 'Save'}
        </button>
        <p role="status" className="text-[12px] text-tenue">
          {stato.error ? <span className="text-str">{stato.error}</span> : stato.saved && !inCorso ? (stato.on ? 'Digest on.' : 'Digest off.') : ''}
        </p>
      </div>
    </form>
  )
}
