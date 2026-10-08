'use client'

import { Segnala } from '@/components/moderation/segnala'
import { useViewer, useViewerTier } from '@/components/viewer/provider'
import { canWrite } from '@/lib/viewer/types'

// Chi vede Report. La pagina in cache e' la stessa per tutti e non ha il
// bottone: compare solo dopo /api/me, per chi e' entrato, ha l'handle e non
// e' sospeso, e solo sui post degli altri. Finche' lo stato del tier non
// arriva non si sa cosa e' suo, quindi niente bottone.

/** Report su un clear che non e' di chi guarda (tier.own). */
export function SegnalaClear({ clearId }: { clearId: string }) {
  const { user } = useViewer()
  const tier = useViewerTier()
  if (!canWrite(user) || !tier || tier.own.includes(clearId)) return null
  return <Segnala kind="clear" target={clearId} />
}

/** Report su un commento che non e' di chi guarda (tier.ownComments). */
export function SegnalaCommento({ commentId }: { commentId: string }) {
  const { user } = useViewer()
  const tier = useViewerTier()
  if (!canWrite(user) || !tier?.ownComments || tier.ownComments.includes(commentId)) return null
  return <Segnala kind="comment" target={commentId} />
}
