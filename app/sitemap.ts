import type { MetadataRoute } from 'next'
import { cacheLife, cacheTag } from 'next/cache'
import { readAuthEnv } from '@/lib/auth/env'
import { sitemapEventsCached } from '@/lib/cache/data'
import { sitemapCardsCached } from '@/lib/cache/cards'
import { TAG } from '@/lib/cache/tags'
import { cardHref, eventHref } from '@/lib/urls'

// Tutti gli eventi e le carte uscite su Global (circa mille e
// duemilasettecento, lontani dal limite di 50.000 di una sitemap sola):
// cosi' i motori trovano ogni pagina senza passare dalle viste filtrate
// (/events/browse, dinamiche e fuori da robots.txt). Le carte solo
// giapponesi restano raggiungibili dai link, non dalla sitemap.
//
// In cache e rigenerata con gli import (tag catalog). Si prerenderizza al
// build: il build legge il database (solo SELECT), come la lista e le
// pagine evento prerenderizzate.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  'use cache'
  cacheLife('days')
  cacheTag(TAG.catalog)
  const base = readAuthEnv().baseURL.replace(/\/$/, '')
  const [eventi, carte] = await Promise.all([sitemapEventsCached(), sitemapCardsCached()])
  return [
    { url: `${base}/events`, changeFrequency: 'daily' },
    ...eventi.map((e) => ({ url: `${base}${eventHref({ id: e.id })}`, ...(e.ultima ? { lastModified: e.ultima } : {}) })),
    ...carte.map((c) => ({ url: `${base}${cardHref(c.id)}` })),
  ]
}
