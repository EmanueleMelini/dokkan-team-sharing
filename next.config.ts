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

const nextConfig: NextConfig = {
  images: { unoptimized: true },
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

export default nextConfig
