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
//
// expire e' di 30 giorni per tutti e due (come SCADENZA in lib/cache/vita.ts):
// una pagina prende la scadenza piu' corta fra i dati che legge, e con una
// settimana la coda lunga visitata di rado si riscriveva da capo nella
// cache ISR (le scritture di Vercel Hobby, sezione del README). I dati
// restano freschi coi tag e col revalidate di un giorno, e una
// rigenerazione che da' gli stessi byte non costa scritture.
const cacheLife = {
  // dati del gioco: cambiano solo con un import, che invalida per tag
  catalog: { stale: 300, revalidate: 86_400, expire: 2_592_000 },
  // clear, voti, commenti: invalidati per tag a ogni scrittura
  community: { stale: 60, revalidate: 86_400, expire: 2_592_000 },
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

// La disiscrizione dal digest (0029), la pagina e il one-click: il token
// sta nella query string, quindi niente Referer verso nessun link. Dopo
// securityHeaders: a parita' di chiave vince l'ultima regola (gli header
// di next.config vincono anche su quelli della risposta della rotta).
const unsubscribeHeaders = ['/notifications/unsubscribe', '/api/notifications/unsubscribe'].map((source) => ({
  source,
  headers: [
    { key: 'Referrer-Policy', value: 'no-referrer' },
    { key: 'X-Robots-Tag', value: 'noindex' },
  ],
}))

// La versione del service worker: un ?v= diverso a ogni deploy fa
// installare un worker nuovo, che riprende la pagina offline aggiornata e
// cancella le cache della versione prima. Su Vercel e' il commit; in locale
// cambia a ogni build.
const swVersion = (process.env.VERCEL_GIT_COMMIT_SHA ?? `b${Date.now().toString(36)}`).slice(0, 12)

// La versione del sito, Global o Japan (lib/versione/versione.ts). Chi ha
// scelto Japan ha il cookie dts_version=japan, e un URL che non dice la
// versione (un link Global, /, la start_url della PWA, quelli delle email
// dopo /notifications/<id>) lo porta alla stessa pagina giapponese. Sta
// nel routing, prima di proxy.ts e delle pagine: su Vercel e' una regola
// della CDN, nessuna funzione, e le pagine restano prerender uguali per
// tutti (non leggono il cookie, e alla CDN una richiesta col cookie per un
// URL Global non arriva mai). La query passa (anche _rsc delle navigazioni
// del client).
//
//   - 307 e mai 308: un redirect permanente il browser lo ricorda, e
//     tornare a Global non funzionerebbe piu';
//   - un URL che dice gia' la versione vince sempre: un percorso /japan, o
//     ?region= (global o japan, i link "espliciti" di lib/urls.ts);
//   - le Server Action (header next-action) non si toccano: un'azione
//     partita da una scheda vecchia non viene rimandata altrove;
//   - chi non ha il cookie (Global, chi non ha scelto, i motori) non ne
//     vede nessuno; il valore e' ancorato (^japan$): japan2 non vale;
//   - la pagina /p/<n> si perde: nell'altra versione puo' non esserci.
//
// Nessuna destinazione ricade in una regola: niente giri. seguiVersione()
// e' lo specchio di queste regole per i redirect delle Server Action, e
// db/test/versione.test.mts le prova col valutatore di Next e le confronta.
const VERSIONE_JAPAN = [{ type: 'cookie' as const, key: 'dts_version', value: 'japan' }]
const VERSIONE_GIA_DETTA = [{ type: 'query' as const, key: 'region' }, { type: 'header' as const, key: 'next-action' }]
const ID = ':id(\\d{1,18})'
const TIER = ':tier(\\d{1,18})'
const versione = (source: string, destination: string) =>
  ({ source, destination, permanent: false, has: VERSIONE_JAPAN, missing: VERSIONE_GIA_DETTA })
const versioneRedirects = [
  // dritto alla home giapponese, senza passare da /events
  versione('/', '/events/japan'),
  versione('/events', '/events/japan'),
  versione(`/events/${ID}`, '/events/:id/japan'),
  versione(`/events/${ID}/t/${TIER}`, '/events/:id/japan/t/:tier'),
  versione(`/events/${ID}/t/${TIER}/p/:n(\\d{1,6})`, '/events/:id/japan/t/:tier'),
  versione('/events/browse', '/events/browse?region=japan'),
  versione(`/events/${ID}/clears`, '/events/:id/clears?region=japan'),
  // solo i link vecchi: submitHref scrive sempre la regione
  versione(`/events/${ID}/submit`, '/events/:id/submit?region=japan'),
]

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
  // I redirect stanno nel routing: nessuna funzione per chi apre /. Prima
  // quelli della versione: con il cookie Japan / va dritto a /events/japan.
  async redirects() {
    return [...versioneRedirects, { source: '/', destination: '/events', permanent: false }]
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }, ...pwaHeaders, ...unsubscribeHeaders]
  },
}

export default nextConfig
