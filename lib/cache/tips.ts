import 'server-only'
import { cacheLife, cacheTag } from 'next/cache'
import { listTips } from '@/lib/tips'
import { TAG, eventTag } from '@/lib/cache/tags'

// Le tip della pagina di un evento, in cache come i clear (lib/cache/data.ts):
// stessa vita ('community') e stesso tag dell'evento, che le scritture
// delle tip invalidano. Solo id pubblici negli argomenti, mai un utente.

/** Le tip del tier e di tutto l'evento, fino a perScope per gruppo e per ordine. */
export async function listTipsCached(eventId: string, tierId: string | null) {
  'use cache'
  cacheLife('community')
  cacheTag(eventTag(eventId), TAG.community)
  return listTips(eventId, tierId)
}
