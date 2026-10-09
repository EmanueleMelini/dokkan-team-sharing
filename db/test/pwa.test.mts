// La PWA (fase 1): il service worker vero (public/sw.js) caricato in
// node:vm con self, caches e fetch finti; la pagina offline generata da
// scripts/brand/offline.mjs uguale a quella versionata e autonoma; il
// manifest e le sue icone; gli header di next.config.ts; chi vede l'invito
// a installare (lib/pwa/piattaforma.ts) con user agent veri.
//
// Funzioni pure e file, niente database.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import manifest from '@/app/manifest'
import nextConfig from '@/next.config'
import { CHIUSO_KEY } from '@/lib/pwa/installa'
import { isIOS, isIOSSafari, isMobile, rottaSenzaInvito, type Ambiente } from '@/lib/pwa/piattaforma'
import { TEMI } from '@/lib/tema/temi'
import { paginaOffline } from '@/scripts/brand/offline.mjs'

const ROOT = join(import.meta.dirname, '..', '..')
let fails = 0
let passes = 0
function check(nome: string, ok: boolean, dettaglio = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nome}${dettaglio ? `  (${dettaglio})` : ''}`)
  if (ok) passes++
  else fails++
}
const vale = <T,>(nome: string, got: T, atteso: T) =>
  check(nome, JSON.stringify(got) === JSON.stringify(atteso), `= ${JSON.stringify(got)}${JSON.stringify(got) === JSON.stringify(atteso) ? '' : `, atteso ${JSON.stringify(atteso)}`}`)

// ---------------------------------------------------------------------
//  public/sw.js in una sandbox
// ---------------------------------------------------------------------

const ORIGINE = 'https://dokkants.example'
const SORGENTE_SW = readFileSync(join(ROOT, 'public', 'sw.js'), 'utf8')

type Richiesta = { url: string; method: string; mode: string }
type Gestore = (e: Record<string, unknown>) => void

function sandbox(opzioni: { rete: 'ok' | 'giu'; cacheIniziali?: string[] }) {
  const gestori: Record<string, Gestore> = {}
  const registro: string[] = []
  const cache = new Map<string, Map<string, unknown>>()
  for (const n of opzioni.cacheIniziali ?? []) cache.set(n, new Map())
  const apri = (nome: string) => {
    if (!cache.has(nome)) cache.set(nome, new Map())
    const voci = cache.get(nome)!
    return {
      add: async (r: { url: string }) => { registro.push(`add ${nome} ${new URL(r.url).pathname}`); voci.set(new URL(r.url).pathname, 'OFFLINE') },
      put: async (r: { url: string }) => { registro.push(`put ${nome} ${r.url}`) },
      match: async (u: string) => voci.get(u),
    }
  }
  class FintaRequest {
    url: string
    cache?: string
    constructor(u: string, init?: { cache?: string }) { this.url = new URL(u, ORIGINE).href; this.cache = init?.cache }
  }
  const contesto = {
    self: {
      location: new URL(`${ORIGINE}/sw.js?v=abc123`),
      addEventListener: (tipo: string, f: Gestore) => { gestori[tipo] = f },
      skipWaiting: async () => { registro.push('skipWaiting') },
      clients: { claim: async () => { registro.push('claim') } },
    },
    caches: {
      open: async (n: string) => apri(n),
      keys: async () => [...cache.keys()],
      delete: async (n: string) => { registro.push(`delete ${n}`); return cache.delete(n) },
      match: async () => { throw new Error('caches.match globale: deve leggere solo la sua cache') },
    },
    fetch: async (r: Richiesta) => {
      registro.push(`fetch ${r.url}`)
      if (opzioni.rete === 'giu') throw new TypeError('Failed to fetch')
      return 'RETE'
    },
    Request: FintaRequest,
    Response: { error: () => 'ERRORE' },
    URL,
    Promise,
  }
  vm.runInNewContext(SORGENTE_SW, contesto, { filename: 'public/sw.js' })
  return { gestori, registro, cache }
}

/** Un evento install o activate, aspettando i suoi waitUntil. */
async function ciclo(s: ReturnType<typeof sandbox>, tipo: 'install' | 'activate') {
  const attese: Promise<unknown>[] = []
  s.gestori[tipo]({ waitUntil: (p: Promise<unknown>) => { attese.push(p) } })
  await Promise.all(attese)
}

/** Manda un evento fetch: undefined se il worker non chiama respondWith. */
async function naviga(s: ReturnType<typeof sandbox>, r: Partial<Richiesta> & { url: string }) {
  let risposta: Promise<unknown> | undefined
  s.gestori.fetch({
    request: { method: 'GET', mode: 'navigate', ...r },
    respondWith: (p: Promise<unknown>) => { risposta = p },
  })
  return risposta === undefined ? undefined : await risposta
}

console.log('sw.js: quali richieste passano dal worker')
{
  const s = sandbox({ rete: 'ok' })
  vale('ascolta install, activate e fetch', Object.keys(s.gestori).sort(), ['activate', 'fetch', 'install'])
  const intercettate = [
    '/events', '/events/12', '/events/12/japan/t/345/p/3', '/cards/1032310', '/users/demo_rotation', '/settings',
    '/login?next=%2Fsettings', '/welcome', '/events/12/submit', '/events/12/clears?tier=3', '/privacy',
    '/apiary', '/administrator', '/',
  ]
  for (const p of intercettate) vale(`navigazione ${p}: rete`, await naviga(s, { url: ORIGINE + p }), 'RETE')
  const lasciate: [string, Partial<Richiesta> & { url: string }][] = [
    ['/api/me', { url: `${ORIGINE}/api/me` }],
    ['callback OAuth', { url: `${ORIGINE}/api/auth/callback/discord?code=x&state=y` }],
    ['magic link', { url: `${ORIGINE}/api/auth/magic-link/verify?token=x` }],
    ['/api', { url: `${ORIGINE}/api` }],
    ['/admin', { url: `${ORIGINE}/admin` }],
    ['/admin/users/x', { url: `${ORIGINE}/admin/users/x` }],
    ['POST (un form)', { url: `${ORIGINE}/events/12/submit`, method: 'POST' }],
    ['chunk', { url: `${ORIGINE}/_next/static/chunks/a.js`, mode: 'no-cors' }],
    ['RSC (fetch del router)', { url: `${ORIGINE}/events/12?_rsc=abc`, mode: 'cors' }],
    ['/api/me da fetch', { url: `${ORIGINE}/api/me`, mode: 'same-origin' }],
    ['immagine cross-origin', { url: 'https://dokkants-assets.example/a.webp', mode: 'no-cors' }],
    ['navigazione cross-origin', { url: 'https://discord.com/oauth2/authorize' }],
  ]
  for (const [nome, r] of lasciate) vale(`${nome}: non intercettata`, await naviga(s, r), undefined)
  check('con la rete non scrive mai in cache', !s.registro.some((r) => r.startsWith('put') || r.startsWith('add')), s.registro.filter((r) => !r.startsWith('fetch')).join(', '))
}

console.log('sw.js: senza rete')
{
  const s = sandbox({ rete: 'giu' })
  await ciclo(s, 'install')
  vale('una pagina: la pagina offline', await naviga(s, { url: `${ORIGINE}/events/12` }), 'OFFLINE')
  vale('settings: la pagina offline', await naviga(s, { url: `${ORIGINE}/settings` }), 'OFFLINE')
  vale('/api/ resta al browser', await naviga(s, { url: `${ORIGINE}/api/auth/callback/google` }), undefined)
  const vuota = sandbox({ rete: 'giu' })
  vale('senza la pagina in cache: Response.error()', await naviga(vuota, { url: `${ORIGINE}/events` }), 'ERRORE')
}

console.log('sw.js: install e activate')
{
  const s = sandbox({ rete: 'ok', cacheIniziali: ['dts-offline-vecchia', 'dts-pagine-1', 'workbox-precache', 'altro'] })
  await ciclo(s, 'install')
  vale('install: solo /offline.html nella cache della versione, poi skipWaiting',
    s.registro, ['add dts-offline-abc123 /offline.html', 'skipWaiting'])
  s.registro.length = 0
  await ciclo(s, 'activate')
  vale('activate: via le dts-* di altre versioni, poi clients.claim',
    s.registro, ['delete dts-offline-vecchia', 'delete dts-pagine-1', 'claim'])
  vale('le cache rimaste', [...s.cache.keys()].sort(), ['altro', 'dts-offline-abc123', 'workbox-precache'])
}
check('sw.js non usa cache.put ne\' navigation preload',
  !/\.put\(|preloadResponse|navigationPreload/.test(SORGENTE_SW.replace(/\/\/.*$/gm, '')))

// ---------------------------------------------------------------------
//  La pagina offline
// ---------------------------------------------------------------------

console.log('public/offline.html')
{
  const versionata = readFileSync(join(ROOT, 'public', 'offline.html'), 'utf8')
  check('uguale a quella che genera scripts/brand/offline.mjs (npm run brand)', versionata === paginaOffline(ROOT))
  const senzaTesto = versionata.replace(/<title>[^<]*<\/title>|<h1>[^<]*<\/h1>|<p>[^<]*<\/p>/g, '')
  check('autonoma: niente src, href, url() ne\' /_next/', !/\bsrc=|\bhref=|url\(|\/_next\//.test(senzaTesto))
  check("dice You're offline e ha il bottone Try again",
    versionata.includes("<h1>You're offline</h1>") && /<button type="button" id="riprova">Try again<\/button>/.test(versionata))
  for (const t of TEMI.filter((t) => t.id !== 'system')) {
    check(`tema ${t.id}: blocco con il suo sfondo`, new RegExp(`\\[data-theme="${t.id}"\\]\\{[^}]*--sfondo:${t.sfondo}`).test(versionata))
  }
  check('System scuro per media query', /@media \(prefers-color-scheme:dark\)\{:root:not\(\[data-theme\]\)\{color-scheme:dark/.test(versionata))
  check('legge il tema da localStorage (dts:tema)', versionata.includes('localStorage.getItem("dts:tema")'))
  check('niente lineette lunghe nel testo', !/\u2014/.test(versionata))
}

// ---------------------------------------------------------------------
//  Manifest e icone
// ---------------------------------------------------------------------

const lato = (file: string) => {
  const b = readFileSync(file)
  return b.subarray(1, 4).toString() === 'PNG' ? `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}` : null
}

console.log('app/manifest.ts')
{
  const m = manifest()
  vale('id, nomi, start_url, scope, display', [m.id, m.name, m.short_name, m.start_url, m.scope, m.display],
    ['/', 'Dokkan Team Sharing', 'dokkants', '/events', '/', 'standalone'])
  vale('colori', [m.theme_color, m.background_color], ['#0f111d', '#0f111d'])
  vale('launch_handler', m.launch_handler, { client_mode: ['navigate-existing', 'auto'] })
  vale('shortcuts', m.shortcuts?.map((s) => s.url), ['/events', '/settings'])
  for (const i of m.icons ?? []) {
    if (i.type === 'image/svg+xml') {
      check(`${i.src}: app/icon.svg esiste`, readFileSync(join(ROOT, 'app', 'icon.svg'), 'utf8').startsWith('<svg'))
      continue
    }
    vale(`${i.src} (${i.purpose}): misura vera`, lato(join(ROOT, 'public', i.src)), i.sizes)
  }
  const scopi = (m.icons ?? []).filter((i) => i.type === 'image/png').map((i) => `${i.purpose} ${i.sizes}`).sort()
  vale('192 e 512, any e maskable', scopi, ['any 192x192', 'any 512x512', 'maskable 192x192', 'maskable 512x512'])
  vale('badge delle notifiche (fase 4)', lato(join(ROOT, 'public', 'pwa', 'badge-96.png')), '96x96')
}

console.log('next.config.ts: header')
{
  const regole = (await nextConfig.headers?.()) ?? []
  const di = (src: string) => Object.fromEntries((regole.find((r) => r.source === src)?.headers ?? []).map((h) => [h.key, h.value]))
  vale('/sw.js senza cache lunga', di('/sw.js')['Cache-Control'], 'public, max-age=0, must-revalidate')
  vale('/offline.html noindex', di('/offline.html')['X-Robots-Tag'], 'noindex')
  check('versione del worker', typeof nextConfig.env?.NEXT_PUBLIC_SW_VERSION === 'string' && nextConfig.env.NEXT_PUBLIC_SW_VERSION.length > 0)
}

// ---------------------------------------------------------------------
//  Chi vede l'invito
// ---------------------------------------------------------------------

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
  iphoneFirefox: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15',
  iphoneInstagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 337.0.3.23.54',
  ipadOS: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  android: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  desktopChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
}
const amb = (ua: string, extra: Partial<Ambiente> = {}): Ambiente => ({ ua, maxTouchPoints: 0, coarse: false, latoCorto: 900, ...extra })

console.log('lib/pwa/piattaforma.ts')
{
  const tocco = { maxTouchPoints: 5, coarse: true, latoCorto: 390 }
  vale('iPhone Safari: mobile, iOS, Safari', [isMobile(amb(UA.iphoneSafari, tocco)), isIOS(amb(UA.iphoneSafari)), isIOSSafari(amb(UA.iphoneSafari))], [true, true, true])
  vale('iPhone Chrome: iOS ma non Safari', [isIOS(amb(UA.iphoneChrome)), isIOSSafari(amb(UA.iphoneChrome))], [true, false])
  vale('iPhone Firefox: non Safari', isIOSSafari(amb(UA.iphoneFirefox)), false)
  vale('webview di Instagram: non Safari', isIOSSafari(amb(UA.iphoneInstagram)), false)
  vale('iPad con iPadOS (si presenta come un Mac): iOS Safari e mobile',
    [isIOSSafari(amb(UA.ipadOS, { maxTouchPoints: 5, coarse: true, latoCorto: 820 })), isMobile(amb(UA.ipadOS, { maxTouchPoints: 5 }))], [true, true])
  vale('Safari su Mac: niente', [isIOS(amb(UA.macSafari)), isMobile(amb(UA.macSafari))], [false, false])
  vale('Android: mobile, non iOS', [isMobile(amb(UA.android, tocco)), isIOS(amb(UA.android))], [true, false])
  vale('Chrome desktop: non mobile', isMobile(amb(UA.desktopChrome, { latoCorto: 1080 })), false)
  vale('Chrome desktop con UA-CH mobile (emulazione): mobile', isMobile(amb(UA.desktopChrome, { uaMobile: true })), true)
  vale('portatile touch con schermo grande: non mobile', isMobile(amb(UA.desktopChrome, { coarse: true, latoCorto: 1200 })), false)
  vale('touch con finestra piccola e UA sconosciuto: mobile', isMobile(amb('Mozilla/5.0 (X11; Linux x86_64)', { coarse: true, latoCorto: 600 })), true)
  for (const [p, atteso] of [['/login', true], ['/login/x', true], ['/welcome', true], ['/admin', true], ['/admin/users/x', true],
    ['/events', false], ['/settings', false], ['/loginx', false], ['/administrator', false]] as const) {
    vale(`invito su ${p}: ${atteso ? 'no' : 'si'}`, rottaSenzaInvito(p), atteso)
  }
  vale('la chiave della X', CHIUSO_KEY, 'dts:installa-chiuso')
}

console.log(fails ? `\n  ${passes} verdi, ${fails} rosse\n` : `\n  ${passes} verifiche, TUTTO VERDE\n`)
process.exit(fails ? 1 : 0)
