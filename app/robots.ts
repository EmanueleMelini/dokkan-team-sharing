import type { MetadataRoute } from 'next'
import { readAuthEnv } from '@/lib/auth/env'
import { DISALLOW } from '@/lib/robots'

// Ai motori servono gli eventi e i loro clear, le carte e i profili.
// L'API, l'accesso e le pagine che chiedono un account non hanno niente da
// indicizzare, e un bot che le visita consuma solo funzioni e query (quote
// di Vercel e Supabase). Le pagine dei tier e quelle Japan degli eventi
// sono la coda lunga che costava le scritture ISR. Le regole, una per una,
// stanno in lib/robots.ts, insieme al rel nofollow dei link che ci portano.
export default function robots(): MetadataRoute.Robots {
  const base = readAuthEnv().baseURL.replace(/\/$/, '')
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [...DISALLOW],
    },
    sitemap: `${base}/sitemap.xml`,
  }
}
