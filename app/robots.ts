import type { MetadataRoute } from 'next'
import { readAuthEnv } from '@/lib/auth/env'

// Ai motori servono gli eventi e i loro clear. L'API, l'accesso e le
// pagine che chiedono un account non hanno niente da indicizzare, e un bot
// che le visita consuma solo funzioni e query (quote di Vercel e Supabase).
// Il * nei percorsi lo capiscono Google e Bing (RFC 9309).
//
// /events/browse sono le viste filtrate della lista: dinamiche (una
// funzione per vista) e in numero senza fine. Ogni evento e' gia' nella
// sitemap, quindi ai motori non servono.
export default function robots(): MetadataRoute.Robots {
  const base = readAuthEnv().baseURL.replace(/\/$/, '')
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/login',
        '/welcome',
        '/settings',
        '/events/browse',
        '/events/*/submit',
        '/events/*/clears/*/edit',
      ],
    },
    sitemap: `${base}/sitemap.xml`,
  }
}
