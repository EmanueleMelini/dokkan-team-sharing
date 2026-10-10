'use client'

import { useActionState, useId } from 'react'
import { setSiteActivityAction, type SiteActivityState } from '@/lib/notify/actions'

/**
 * La casella "All site activity" (0032), solo per gli admin: la pagina la
 * rende solo a loro, e la Server Action e set_notification_pref rifiutano
 * gli altri. Spenta per difetto. Un form vero con un Save, come il digest:
 * funziona anche senza JavaScript. Lo stato salvato vince su quello con
 * cui la pagina e' arrivata.
 */
export function AttivitaSito({ on }: { on: boolean }) {
  const [stato, azione, inCorso] = useActionState<SiteActivityState, FormData>(setSiteActivityAction, {})
  const id = useId()
  const acceso = stato.saved ? stato.on === true : on

  return (
    <form action={azione} aria-busy={inCorso} className="space-y-3">
      <label className="flex items-start gap-2 text-[13px] text-inchiostro">
        <input
          // key: dopo il salvataggio la casella riparte dal valore salvato
          key={String(acceso)}
          type="checkbox"
          name="activity"
          defaultChecked={acceso}
          aria-describedby={`${id}-aiuto`}
          className="mt-0.5 accent-[var(--oro)]"
        />
        <span>All site activity</span>
      </label>
      <p id={`${id}-aiuto`} className="text-[12px] leading-relaxed text-tenue">
        A notification for every action other members take: clears and tips posted, edited or
        deleted, comments, votes and Helpful, reports, new members, handle changes, deleted
        accounts and other moderators&apos; actions. Your own actions are left out. They appear in
        your list and, where browser notifications are on, on your devices. Never by email. They say
        who did what and where, never the text of a post or who sent a report. Off unless you turn
        it on.
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
          {stato.error ? <span className="text-str">{stato.error}</span> : stato.saved && !inCorso ? (stato.on ? 'Site activity on.' : 'Site activity off.') : ''}
        </p>
      </div>
    </form>
  )
}
