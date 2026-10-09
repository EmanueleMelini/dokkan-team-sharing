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
//
// /events/<id>/clears sono le liste filtrate dei clear di un tier: come
// browse, dinamiche e senza fine (ogni combinazione di filtri e' un URL).
// La regola copre anche /events/<id>/clears/<clear>/edit.
//
// /admin risponde 404 a chiunque non sia admin: niente da indicizzare, e
// cosi' un bot non la prova a ogni giro.
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
        '/events/*/clears',
        '/events/*/clears/*/edit',
        '/admin',
      ],
    },
    sitemap: `${base}/sitemap.xml`,
  }
}
