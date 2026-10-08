'use client'

import { Prohibit } from '@phosphor-icons/react/dist/ssr'
import { useViewer } from '@/components/viewer/provider'
import { fraseSospensione } from '@/lib/moderation/sospensione'

type Props = {
  /** la fine: una data ISO o 'infinity' (lib/moderation/sospensione.ts) */
  until: string
  /** il motivo del moderatore: lo vede solo l'interessato */
  reason?: string | null
  className?: string
}

/**
 * Il banner della sospensione. Le pagine per utente (Settings, l'invio)
 * lo rendono dal server con i dati della DAL; nelle pagine in cache lo
 * mostra BannerSospesoIsola, da /api/me.
 */
export function BannerSospeso({ until, reason, className = '' }: Props) {
  return (
    <div role="status" className={`flex items-start gap-2.5 border border-str/40 rounded-[var(--raggio)] bg-superficie px-3 py-2.5 ${className}`}>
      <Prohibit size={15} weight="bold" aria-hidden className="mt-px shrink-0 text-str" />
      <div className="text-[12px] leading-relaxed text-testo">
        <p className="text-inchiostro">{fraseSospensione(until)}</p>
        {reason && <p className="mt-1">Reason given by the moderator: <span className="text-inchiostro">{reason}</span></p>}
      </div>
    </div>
  )
}

/** Lo stesso banner nelle pagine in cache: niente finche' /api/me non dice "sospeso". */
export function BannerSospesoIsola({ className }: { className?: string }) {
  const { user } = useViewer()
  if (!user?.suspended || !user.suspendedUntil) return null
  return <BannerSospeso until={user.suspendedUntil} reason={user.suspensionReason} className={className} />
}
