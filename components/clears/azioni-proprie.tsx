'use client'

import Link from 'next/link'
import { EliminaClear } from '@/components/clears/elimina'
import { useViewerTier } from '@/components/viewer/provider'
import { editClearHref } from '@/lib/urls'

/**
 * Edit e Delete sul proprio clear. La pagina in cache non sa chi guarda:
 * compaiono quando /api/me dice che il clear e' suo (tier.own).
 */
export function AzioniProprie({ eventId, clearId }: { eventId: string; clearId: string }) {
  const tier = useViewerTier()
  if (!tier?.own.includes(clearId)) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        href={editClearHref(eventId, clearId)}
        prefetch={false}
        className="px-2 py-1 text-[12px] rounded-[var(--raggio)] border border-linea bg-superficie text-testo hover:text-inchiostro hover:border-linea-forte transition-colors"
      >
        Edit<span className="sr-only"> your clear</span>
      </Link>
      <EliminaClear clearId={clearId} />
    </div>
  )
}
