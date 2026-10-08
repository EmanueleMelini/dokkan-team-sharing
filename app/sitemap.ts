import type { MetadataRoute } from 'next'
import { cacheLife, cacheTag } from 'next/cache'
import { readAuthEnv } from '@/lib/auth/env'
import { sitemapEventsCached } from '@/lib/cache/data'
import { TAG } from '@/lib/cache/tags'
import { eventHref } from '@/lib/urls'

// Tutti gli eventi (poco meno di mille, lontani dal limite di 50.000):
// cosi' i motori trovano ogni pagina evento senza passare dalle viste
// filtrate (/events/browse, dinamiche e fuori da robots.txt).
//
// In cache e rigenerata con gli import (tag catalog). Si prerenderizza al
// build: il build legge il database (solo SELECT), come la lista e le
// pagine evento prerenderizzate.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  'use cache'
  cacheLife('days')
  cacheTag(TAG.catalog)
  const base = readAuthEnv().baseURL.replace(/\/$/, '')
  const eventi = await sitemapEventsCached()
  return [
    { url: `${base}/events`, changeFrequency: 'daily' },
    ...eventi.map((e) => ({ url: `${base}${eventHref({ id: e.id })}`, ...(e.ultima ? { lastModified: e.ultima } : {}) })),
  ]
}
