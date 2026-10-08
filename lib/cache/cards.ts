import 'server-only'
import { cacheLife, cacheTag } from 'next/cache'
import { getCard, getCardClears, sitemapCards, staticCardIds } from '@/lib/card-page'
import type { Region } from '@/lib/queries'
import { TAG, cardTag } from '@/lib/cache/tags'

// Le letture della pagina di una carta, in cache. Come lib/cache/data.ts:
// solo id pubblici come argomenti, mai la sessione (regola eslint).
//
// Due vite diverse: la carta cambia solo con un import (catalog), i clear
// che la usano a ogni invio, revisione, cancellazione o moderazione, che
// invalidano card:<id> (lib/cache/tags.ts tagsFor).

export async function getCardCached(id: string) {
  'use cache'
  cacheLife('catalog')
  cacheTag(TAG.catalog, cardTag(id))
  return getCard(id)
}

export async function getCardClearsCached(id: string, reg: Region) {
  'use cache'
  cacheLife('community')
  cacheTag(cardTag(id), TAG.community)
  return getCardClears(id, reg)
}

export async function staticCardIdsCached() {
  'use cache'
  cacheLife('days')
  cacheTag(TAG.catalog)
  return staticCardIds()
}

export async function sitemapCardsCached() {
  'use cache'
  cacheLife('days')
  cacheTag(TAG.catalog)
  return sitemapCards()
}
