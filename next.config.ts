import type { NextConfig } from 'next'

// Le immagini non passano dall'ottimizzazione di Next. Sono gia' webp
// piccoli, e su Vercel Hobby l'ottimizzazione ha una quota mensile
// (5000 trasformazioni): con migliaia di carte a piu' larghezze finirebbe
// in pochi giorni e le immagini nuove risponderebbero 402. Cosi' <Image>
// usa l'URL di assetUrl() cosi' com'e': /assets/... in sviluppo (servito
// da public/), l'URL assoluto di ASSET_BASE_URL in produzione. Per questo
// non servono piu' remotePatterns, e il build non legge public/assets.

const production = process.env.NODE_ENV === 'production'

// La CSP e' solo per le cornici: una CSP completa senza nonce dovrebbe
// comunque permettere gli script inline di Next ('unsafe-inline'), e con
// form-action rischierebbe di bloccare i redirect verso i provider OAuth.
// frame-ancestors (con X-Frame-Options per i browser vecchi) impedisce il
// clickjacking sulle pagine di accesso e di Settings; base-uri e object-src
// non toccano nulla di quello che il sito usa.
const csp = "frame-ancestors 'none'; base-uri 'self'; object-src 'none'"

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // Solo in produzione: in sviluppo su http://localhost il browser
  // ricorderebbe l'HTTPS per localhost e romperebbe gli altri progetti.
  ...(production ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }] : []),
]

// La cache (Vercel Hobby: 4 ore di CPU attiva al mese, niente extra). Le
// pagine pubbliche non leggono ne' la sessione ne' la query string: sono
// prerender che la CDN serve senza invocare funzioni. I dati stanno in
// 'use cache' (lib/cache/data.ts) e si invalidano per tag a ogni scrittura
// (lib/cache/invalidate.ts) e con gli import (/api/revalidate).
//
// partialPrefetching serve all'ISR degli id non prerenderizzati al build:
// la prima visita genera la pagina, le successive la trovano in cache.
const cacheLife = {
  // dati del gioco: cambiano solo con un import, che invalida per tag
  catalog: { stale: 300, revalidate: 86_400, expire: 2_592_000 },
  // clear, voti, commenti: invalidati per tag a ogni scrittura
  community: { stale: 60, revalidate: 86_400, expire: 604_800 },
}

// La PWA (public/sw.js, public/offline.html). sw.js ha un URL fisso: con
// una cache HTTP lunga un worker sbagliato resterebbe sui dispositivi per
// giorni, quindi max-age=0 (il browser lo riconvalida a ogni controllo).
// La pagina offline la rilegge solo il worker quando si installa.
const pwaHeaders = [
  {
    source: '/sw.js',
    headers: [
      { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
      { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
    ],
  },
  {
    source: '/offline.html',
    headers: [
      { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
      { key: 'X-Robots-Tag', value: 'noindex' },
    ],
  },
]

// La versione del service worker: un ?v= diverso a ogni deploy fa
// installare un worker nuovo, che riprende la pagina offline aggiornata e
// cancella le cache della versione prima. Su Vercel e' il commit; in locale
// cambia a ogni build.
const swVersion = (process.env.VERCEL_GIT_COMMIT_SHA ?? `b${Date.now().toString(36)}`).slice(0, 12)

const nextConfig: NextConfig = {
  images: { unoptimized: true },
  poweredByHeader: false,
  env: { NEXT_PUBLIC_SW_VERSION: swVersion },
  cacheComponents: true,
  partialPrefetching: true,
  cacheLife,
  // NEXT_CACHE_MEMORY=0 imita in locale una funzione serverless, dove la
  // cache in memoria non sopravvive fra le richieste (test/cpu.sh).
  ...(process.env.NEXT_CACHE_MEMORY === '0' ? { cacheMaxMemorySize: 0 } : {}),
  // Il redirect sta nel routing: nessuna funzione per chi apre /.
  async redirects() {
    return [{ source: '/', destination: '/events', permanent: false }]
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }, ...pwaHeaders]
  },
}

export default nextConfig
