import 'server-only'
import { cacheLife, cacheTag } from 'next/cache'
import { cardLabels, categoryName, getClearFacets, type Region } from '@/lib/queries'
import { TAG, eventTag } from '@/lib/cache/tags'

// Le opzioni dei filtri dei clear di un tier, in cache come i clear
// (lib/cache/data.ts): cambiano con ogni invio, revisione o moderazione,
// che invalidano event:<id>; i nomi delle carte cambiano con gli import
// (catalog). Solo id pubblici negli argomenti, mai la sessione.
//
// La lista filtrata invece NON sta in cache: le combinazioni dei filtri
// sono senza fine, e ogni voce occuperebbe memoria per una visita sola.

export async function getClearFacetsCached(eventId: string, tierId: string, reg: Region) {
  'use cache'
  cacheLife('community')
  cacheTag(eventTag(eventId), TAG.community, TAG.catalog)
  return getClearFacets(tierId, reg)
}

/** Nomi e miniature delle carte di un URL condiviso: cambiano solo con gli import. */
export async function cardLabelsCached(ids: string[]) {
  'use cache'
  cacheLife('catalog')
  cacheTag(TAG.catalog)
  return cardLabels(ids)
}

export async function categoryNameCached(id: number) {
  'use cache'
  cacheLife('catalog')
  cacheTag(TAG.catalog)
  return categoryName(id)
}
