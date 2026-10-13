// La versione del sito, Global o Japan (lib/versione, 0035):
//
//   - i redirect di next.config.ts provati col valutatore di Next 16
//     (unstable_getResponseFromNextConfig): chi va dove col cookie
//     dts_version=japan, cosa non si tocca mai, _rsc che passa, nessun giro;
//   - seguiVersione() che dice le stesse cose delle regole (lo specchio per
//     i redirect delle Server Action), anche con le maiuscole nel percorso,
//     provate coi matcher del router vero di Next (che non le distingue), e
//     con le barre doppie o in fondo, che il router toglie con due 308 suoi
//     prima delle regole;
//   - gemello(), dove porta l'interruttore, nelle due direzioni;
//   - il cookie (lettura, opzioni, il Set-Cookie di una scelta) e lo script
//     del <head> su un document finto;
//   - set_region (0035) sul database, e cambiaVersione() (il cuore di
//     setVersionAction) con il set_region vero;
//   - le guardie sui file: ogni redirect di un file 'use server' e di un
//     modulo di lib/ che lo importa (quelli che le azioni chiamano, come
//     lib/dal.ts), letto col parser di TypeScript, va gia' alla versione
//     giusta (seguiVersione con la versione della richiesta, un eventHref
//     esplicito, la home della richiesta, o il segno "// redirect-versione:"),
//     con la controprova su redirect sbagliati di prova; le uscite e le
//     cancellazioni passano da seguiVersione, nessuno scrive il cookie da
//     document.cookie.
//
// Gira sul database di test (npm run db:test). Crea solo gli utenti
// versiontest+...@example.invalid e li toglie alla fine (per email esatta).
import { AsyncLocalStorage } from 'node:async_hooks'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { parse } from 'node:url'
import type * as TS from 'typescript'
import pg from 'pg'
import { db } from '@/lib/db'
import type { CurrentUser } from '@/lib/dal'
import { cambiaVersione, type DipendenzeVersione } from '@/lib/versione/cambio'
import {
  ATTRIBUTO_VERSIONE, VERSIONE_COOKIE, VERSIONE_MAX_AGE, cookieVersione, gemello, isVersione, localeDi,
  opzioniVersione, scriptVersione, seguiVersione, versioneDaCookie, type CookieVersione, type Versione,
} from '@/lib/versione/versione'
import { viewerUserOf } from '@/lib/viewer/utente'
import { DOMINIO, check, esito, guardia, num, one, q, stato, utente } from '@/db/test/builder-helpers'

guardia()
const P = 'versiontest'
const HANDLE = ['ver_a', 'ver_b', 'ver_new', 'ver_admin']
const EMAILS = HANDLE.map((h) => `${P}+${h}${DOMINIO}`)

const mostra = (v: unknown) => JSON.stringify(v) ?? String(v)
function vale<T>(nome: string, got: T, atteso: T) {
  const ok = mostra(got) === mostra(atteso)
  check(nome, ok, `= ${mostra(got)}${ok ? '' : `, atteso ${mostra(atteso)}`}`)
}
const file = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8')

// ---------------------------------------------------------------------
//  Le regole di next.config.ts, nel valutatore di Next
// ---------------------------------------------------------------------

// Il valutatore costruisce una richiesta di Next, che vuole
// AsyncLocalStorage globale (il server di Next lo mette da se').
;(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage = AsyncLocalStorage
const testing = await import('next/experimental/testing/server.js')
const valuta = (testing.default ?? testing).unstable_getResponseFromNextConfig as
  typeof import('next/experimental/testing/server.js').unstable_getResponseFromNextConfig
const nextConfig = (await import('@/next.config')).default

const ORIGINE = 'https://dokkan.test'
const JP = { [VERSIONE_COOKIE]: 'japan' }
type Risposta = { status: number; location: string | null }

async function apri(href: string, cookies: Record<string, string> = {}, headers: Record<string, string> = {}): Promise<Risposta> {
  const r = await valuta({ url: `${ORIGINE}${href}`, nextConfig, cookies, headers })
  const loc = r.headers.get('location')
  return { status: r.status, location: loc === null ? null : loc.startsWith(ORIGINE) ? loc.slice(ORIGINE.length) : loc }
}

// Il router vero (next start, Vercel) non distingue le maiuscole nei
// percorsi: experimental.caseSensitiveRoutes, false per difetto, e /Events/5
// col cookie Japan prende il 307 come /events/5. Il valutatore qui sopra
// invece si' (prova route.regex senza la i). Per le maiuscole servono
// quindi i matcher del router di Next: buildCustomRoute di
// router-utils/filesystem (quelli che usa resolve-routes), con la
// sensibilita' della config, matchHas e prepareDestination come li'.
const richiedi = createRequire(import.meta.url)
const { buildCustomRoute } = richiedi('next/dist/server/lib/router-utils/filesystem.js') as
  typeof import('next/dist/server/lib/router-utils/filesystem')
const { matchHas, prepareDestination } = richiedi('next/dist/shared/lib/router/utils/prepare-destination.js') as
  typeof import('next/dist/shared/lib/router/utils/prepare-destination')
const { constructRequest } = richiedi('next/dist/experimental/testing/server/utils.js') as
  typeof import('next/dist/experimental/testing/server/utils')
const { normalizeConfig } = richiedi('next/dist/server/config-shared.js') as typeof import('next/dist/server/config-shared')
const { getRedirectStatus } = richiedi('next/dist/lib/redirect-status.js') as typeof import('next/dist/lib/redirect-status')
const caricaRotte = (richiedi('next/dist/lib/load-custom-routes.js') as { default: typeof import('next/dist/lib/load-custom-routes').default }).default
const configVera = await normalizeConfig('phase-production-build', nextConfig)
const maiuscoleUguali = configVera.experimental?.caseSensitiveRoutes !== true
const rotteVere = (await caricaRotte(configVera)).redirects
  .map((r) => buildCustomRoute('redirect', r, configVera.basePath, !maiuscoleUguali))

/** Come apri(), col router vero: la prima regola che risponde, o 200. */
function apriVero(href: string, cookies: Record<string, string> = {}, headers: Record<string, string> = {}): Risposta {
  const url = `${ORIGINE}${href}`
  const u = parse(url, true)
  const req = constructRequest({ url, cookies, headers })
  for (const r of rotteVere) {
    let params = r.match(u.pathname ?? '')
    if (params && (r.has || r.missing)) {
      const h = matchHas(req, u.query, r.has, r.missing)
      params = h ? { ...params, ...h } : false
    }
    if (!params) continue
    const { parsedDestination: d } = prepareDestination({ appendParamsToQuery: false, destination: r.destination, params, query: u.query })
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(d.query ?? {})) for (const x of [v ?? []].flat()) q.append(k, String(x))
    return { status: getRedirectStatus(r), location: `${d.pathname}${q.size ? `?${q}` : ''}` }
  }
  return { status: 200, location: null }
}

/** Percorso e query in ordine di chiave: Next e seguiVersione possono ordinarla in modo diverso. */
function normale(href: string, togli: string[] = []): string {
  const u = new URL(href, ORIGINE)
  const p = [...u.searchParams].filter(([k]) => !togli.includes(k)).sort(([a], [b]) => a.localeCompare(b))
  return `${u.pathname}${p.length ? `?${new URLSearchParams(p)}` : ''}`
}

const C = '3b49014b-0000-4000-8000-000000000001'

// [da, dove porta con il cookie Japan]
const REDIRECT: [string, string][] = [
  ['/', '/events/japan'],
  ['/events', '/events/japan'],
  ['/events?account=deleted', '/events/japan?account=deleted'],
  ['/events/123', '/events/123/japan'],
  ['/events/123/t/45', '/events/123/japan/t/45'],
  ['/events/123/t/45/p/2', '/events/123/japan/t/45'],
  ['/events/123/t/45/p/100000', '/events/123/japan/t/45'],
  ['/events/browse', '/events/browse?region=japan'],
  ['/events/browse?type=story&page=3', '/events/browse?region=japan&type=story&page=3'],
  // un ?region= vuoto non dice niente (come per la pagina, che lo legge Global)
  ['/events/browse?region=', '/events/browse?region=japan'],
  ['/events/123?region=', '/events/123/japan?region='],
  ['/events/123/clears?tier=45&proof=1', '/events/123/clears?region=japan&tier=45&proof=1'],
  ['/events/123/clears?tier=45&page=4', '/events/123/clears?region=japan&tier=45&page=4'],
  ['/events/123/submit?tier=45', '/events/123/submit?region=japan&tier=45'],
]

// Con il cookie Japan restano dove sono
const FERMI = [
  '/events/japan', '/events/japan?account=deleted', '/events/123/japan', '/events/123/japan/t/45',
  '/events/123/japan/t/45/p/2',
  '/events?region=japan', '/events?region=global',
  '/events/123?region=global', '/events/123?region=japan', '/events/123/t/45?region=global',
  '/events/123/t/45/p/2?region=global', '/events/browse?region=japan', '/events/browse?region=global&type=story',
  '/events/123/clears?region=global&tier=45', '/events/123/clears?region=japan&tier=45',
  '/events/123/submit?region=global&tier=45', '/events/123/submit?region=japan&tier=45',
  `/events/123/clears/${C}/edit`, '/cards/1034200', '/users/goku_fan', '/users/goku_fan/p/2',
  '/notifications', '/notifications/15', '/settings', '/welcome?next=/events', '/login', '/admin', '/admin/log',
  '/api/cards?q=goku', '/api/me', '/privacy', '/terms', '/sitemap.xml',
  // non sono pagine evento: restano i 404 di oggi
  '/events/abc', '/events/123/t/abc', '/events/1234567890123456789', '/events/123/t/45/p/1234567',
  '/events/123/japan/japan',
]

// Le maiuscole nel percorso, nel router vero: come le minuscole, e la
// destinazione e' quella della regola (minuscola). La chiave della query
// invece conta com'e': REGION non marca niente.
const MAIUSCOLE: [string, string][] = [
  ['/EVENTS', '/events/japan'],
  ['/Events?account=deleted', '/events/japan?account=deleted'],
  ['/Events/5001', '/events/5001/japan'],
  ['/events/5001/T/4', '/events/5001/japan/t/4'],
  ['/EVENTS/5001/T/4/P/2', '/events/5001/japan/t/4'],
  ['/Events/Browse?type=story', '/events/browse?region=japan&type=story'],
  ['/events/5001/Clears?tier=4&proof=1', '/events/5001/clears?region=japan&tier=4&proof=1'],
  ['/Events/5001/SUBMIT?tier=4', '/events/5001/submit?region=japan&tier=4'],
  ['/Events/5001?REGION=global', '/events/5001/japan?REGION=global'],
]
const FERMI_MAIUSCOLE = [
  '/Events?region=global', '/EVENTS/5001/T/4?region=global', '/Events/Browse?region=japan', '/EVENTS/JAPAN',
  '/Events/5001/Japan', '/events/5001/JAPAN/t/4', '/Cards/1001', '/EVENTS/abc', '/Events/5001/Clears/x/Edit',
]
/** Lo stesso URL con il percorso tutto maiuscolo, o con l'iniziale di ogni pezzo maiuscola (la query resta). */
function inMaiuscolo(href: string, iniziali = false): string {
  const q = href.search(/[?#]/)
  const [p, resto] = q < 0 ? [href, ''] : [href.slice(0, q), href.slice(q)]
  return (iniziali ? p.replace(/\/([a-z])/g, (_, c: string) => `/${c.toUpperCase()}`) : p.toUpperCase()) + resto
}

async function regole() {
  console.log('\n  -- i redirect di next.config.ts (unstable_getResponseFromNextConfig)')
  for (const [da, a] of REDIRECT) {
    const r = await apri(da, JP)
    check(`Japan: ${da} -> 307 ${a}`, r.status === 307 && r.location !== null && normale(r.location) === normale(a),
      `${r.status} ${r.location}`)
  }
  let r = await apri('/events/123?_rsc=abc', JP, { rsc: '1' })
  check('una navigazione del client (RSC): _rsc passa alla destinazione', r.status === 307 &&
    normale(r.location ?? '') === normale('/events/123/japan?_rsc=abc'), `${r.status} ${r.location}`)
  r = await apri('/events/123/t/45?_rsc=x1', JP,
    { rsc: '1', 'next-router-prefetch': '1', 'next-router-segment-prefetch': '/_tree' })
  check('un prefetch dei segmenti: anche lui, con _rsc', r.status === 307 &&
    normale(r.location ?? '') === normale('/events/123/japan/t/45?_rsc=x1'), `${r.status} ${r.location}`)
  for (const h of ['/', '/events', '/events/123', '/events/123/t/45', '/events/browse']) {
    const a = await apri(h, JP, { 'next-action': '7f3a9c' })
    check(`una Server Action (next-action) su ${h}: nessun redirect della versione`,
      h === '/' ? a.status === 307 && a.location === '/events' : a.status === 200, `${a.status} ${a.location}`)
  }

  const fermi: string[] = []
  for (const h of FERMI) {
    const a = await apri(h, JP)
    if (a.status !== 200) fermi.push(`${h} -> ${a.status} ${a.location}`)
  }
  check(`Japan: ${FERMI.length} URL marcati, per utente o di una pagina sola restano dove sono`, fermi.length === 0,
    fermi.join(', '))

  // Senza il cookie giusto: esattamente il sito di oggi
  for (const [nome, cookies] of [
    ['nessun cookie', {}], ['dts_version=global', { [VERSIONE_COOKIE]: 'global' }],
    ['dts_version=japan2', { [VERSIONE_COOKIE]: 'japan2' }], ['dts_version=JAPAN', { [VERSIONE_COOKIE]: 'JAPAN' }],
    ['dts_version vuoto', { [VERSIONE_COOKIE]: '' }], ['un altro nome', { xdts_version: 'japan', dts_versione: 'japan' }],
  ] as [string, Record<string, string>][]) {
    const mossi: string[] = []
    for (const h of [...REDIRECT.map(([da]) => da), ...FERMI]) {
      const a = await apri(h, cookies)
      const atteso = h === '/' ? '307 /events' : '200 null'
      if (`${a.status} ${a.location}` !== atteso) mossi.push(`${h} -> ${a.status} ${a.location}`)
    }
    check(`${nome}: nessun redirect della versione (solo / -> /events di sempre)`, mossi.length === 0, mossi.join(', '))
  }

  const giri: string[] = []
  for (const [, a] of REDIRECT) {
    const x = await apri(a, JP)
    if (x.status !== 200) giri.push(`${a} -> ${x.status} ${x.location}`)
  }
  check('nessun giro: ogni destinazione, rivalutata col cookie Japan, e\' una pagina', giri.length === 0, giri.join(', '))

  const conf = file('next.config.ts')
  check('307 e mai 308: tutte le regole della versione con permanent: false',
    /permanent: false, has: VERSIONE_JAPAN, missing: VERSIONE_GIA_DETTA/.test(conf) && !/permanent: true/.test(conf))
  check('il cookie delle regole e\' VERSIONE_COOKIE', conf.includes(`key: '${VERSIONE_COOKIE}', value: 'japan'`))
  check('proxy.ts resta solo per /admin', !/dts_version|versione/i.test(file('proxy.ts')))
}

function specchio() {
  console.log('\n  -- seguiVersione: lo specchio delle regole')
  const sbagliati: string[] = []
  for (const [da, a] of REDIRECT) {
    const s = seguiVersione(da, 'japan')
    if (normale(s) !== normale(a)) sbagliati.push(`${da} -> ${s}`)
  }
  check(`Japan: le ${REDIRECT.length} destinazioni delle regole`, sbagliati.length === 0, sbagliati.join(', '))
  const mossi = FERMI.filter((h) => seguiVersione(h, 'japan') !== h)
  check(`Japan: i ${FERMI.length} URL che le regole non toccano restano uguali`, mossi.length === 0, mossi.join(', '))
  const tutti = [...REDIRECT.map(([da]) => da), ...FERMI]
  check('Global: ogni href resta com\'e\'', tutti.every((h) => seguiVersione(h, 'global') === h))
  vale('l\'ancora resta (il browser la porta attraverso il 307)',
    seguiVersione('/events/1/t/5#tips', 'japan'), '/events/1/japan/t/5#tips')
  vale('un link esplicito non si tocca', seguiVersione('/events/1/t/5/p/2?region=global#clear-9', 'japan'),
    '/events/1/t/5/p/2?region=global#clear-9')
  for (const h of ['//evil.example/events', '/\\evil.example', 'https://evil.example/events', 'events']) {
    check(`non un percorso del sito (${JSON.stringify(h)}): com'e'`, seguiVersione(h, 'japan') === h)
  }
}

/** Il 307 di una risposta come URL confrontabile, o null se la pagina resta. */
const doveVa = (r: Risposta) => (r.status === 307 && r.location !== null ? normale(r.location) : r.status === 200 ? null : `${r.status}`)

async function maiuscole() {
  console.log('\n  -- le maiuscole: il router vero, e lo specchio con lui')
  // controprova: sulle righe di sempre il router vero dice quello che dice il valutatore di Next
  const scollati: string[] = []
  for (const h of [...REDIRECT.map(([da]) => da), ...FERMI]) {
    for (const [cookies, headers] of [[JP, {}], [{}, {}], [JP, { 'next-action': '7f3a9c' }]] as Record<string, string>[][]) {
      const [a, b] = [await apri(h, cookies, headers), apriVero(h, cookies, headers)]
      if (a.status !== b.status || (a.location && normale(a.location)) !== (b.location && normale(b.location))) {
        scollati.push(`${h} ${mostra(cookies)}: ${a.status} ${a.location} / ${b.status} ${b.location}`)
      }
    }
  }
  check(`il router vero e il valutatore di Next dicono lo stesso sulle ${REDIRECT.length + FERMI.length} righe di sempre`,
    scollati.length === 0 && rotteVere.length >= 9, scollati.join(' | '))
  // lo specchio ha la i perche' la config non distingue: se un giorno lo fara', la i va tolta
  check('la config non distingue le maiuscole (caseSensitiveRoutes non c\'e\')', maiuscoleUguali)

  for (const [da, a] of MAIUSCOLE) {
    const r = apriVero(da, JP)
    const s = seguiVersione(da, 'japan')
    check(`Japan: ${da} -> 307 ${a}, e seguiVersione lo stesso`, doveVa(r) === normale(a) && normale(s) === normale(a),
      `${r.status} ${r.location}; seguiVersione ${s}`)
  }
  const mossi = FERMI_MAIUSCOLE.filter((h) => apriVero(h, JP).status !== 200 || seguiVersione(h, 'japan') !== h)
  check(`Japan: ${FERMI_MAIUSCOLE.length} URL con le maiuscole che le regole non toccano restano, anche per seguiVersione`,
    mossi.length === 0, mossi.join(', '))
  const senza = [...MAIUSCOLE.map(([da]) => da), ...FERMI_MAIUSCOLE].filter((h) => apriVero(h).status !== 200 ||
    apriVero(h, { [VERSIONE_COOKIE]: 'JAPAN' }).status !== 200)
  check('senza il cookie (o con JAPAN): nessun redirect neanche con le maiuscole', senza.length === 0, senza.join(', '))
  const giri = MAIUSCOLE.filter(([, a]) => apriVero(a, JP).status !== 200).map(([, a]) => a)
  check('nessun giro: le destinazioni sono minuscole e restano', giri.length === 0, giri.join(', '))

  // Tutte le righe, col percorso maiuscolo o con le iniziali maiuscole: lo specchio dice quello che dice il router
  const diversi: string[] = []
  for (const h of [...REDIRECT.map(([da]) => da), ...FERMI].flatMap((x) => [inMaiuscolo(x), inMaiuscolo(x, true)])) {
    const r = doveVa(apriVero(h, JP))
    const s = seguiVersione(h, 'japan')
    if ((r === null ? s !== h : normale(s) !== r)) diversi.push(`${h}: router ${r}, seguiVersione ${s}`)
    if (seguiVersione(h, 'global') !== h) diversi.push(`${h}: Global lo cambia`)
  }
  check('ogni riga con le maiuscole: seguiVersione = il router vero (e Global non tocca niente)', diversi.length === 0,
    diversi.join(' | '))
}

// Le barre. Prima delle regole il router fa due 308 suoi: resolve-routes
// toglie le barre ripetute (e le \), prima di ogni regola
// (normalizeRepeatedSlashes); la barra in fondo la toglie la prima regola
// dei redirect, quella interna di trailingSlash: false
// (load-custom-routes). Col cookie Japan /events/5/ fa 308 a /events/5 e
// poi 307 a /events/5/japan: il browser (e il fetch del redirect di
// un'azione) li segue tutti, quindi lo specchio deve dire dove si arriva.
const { normalizeRepeatedSlashes } = richiedi('next/dist/shared/lib/utils.js') as
  typeof import('next/dist/shared/lib/utils')

/** Come apriVero, ma seguendo i 308 del router come il browser: la prima risposta che non lo e', e i 308 fatti. */
function apriDopoLeBarre(href: string, cookies: Record<string, string> = {}): Risposta & { passi: string[] } {
  const passi: string[] = []
  let qui = href
  for (let i = 0; i < 5; i++) {
    // la stessa prova di resolve-routes, sul percorso senza la query
    const r: Risposta = /(\\|\/\/)/.test(qui.split('?', 1)[0])
      ? { status: 308, location: normalizeRepeatedSlashes(qui) }
      : apriVero(qui, cookies)
    if (r.status !== 308 || r.location === null) return { ...r, passi }
    passi.push(r.location)
    qui = r.location
  }
  return { status: 0, location: `troppi 308 da ${href}`, passi }
}

// [da, dove porta col cookie Japan dopo i 308 del router]
const BARRE: [string, string][] = [
  ['/events/', '/events/japan'],
  ['/events/5001/', '/events/5001/japan'],
  ['/Events/5001/', '/events/5001/japan'],
  ['/events//5001', '/events/5001/japan'],
  ['/events///5001//t//4//', '/events/5001/japan/t/4'],
  ['/events/5001/t/4/p/2/', '/events/5001/japan/t/4'],
  ['/events\\5001', '/events/5001/japan'],
  ['/events/browse/?type=story', '/events/browse?region=japan&type=story'],
  ['/events//5001/clears/?tier=4', '/events/5001/clears?region=japan&tier=4'],
  ['/events/5001/submit/?tier=4', '/events/5001/submit?region=japan&tier=4'],
]
// dopo i 308 restano: la pagina e' gia' quella giusta, e lo specchio non tocca l'href
const FERMI_BARRE = [
  '/events/japan/', '/events/5001/japan/', '/events//5001/japan', '/Events/5001/Japan/', '/events/5001/?region=global',
  '/events//browse?region=global', '/cards/1001/', '/settings/', '/events/abc/',
]
/** Lo stesso URL con una barra in fondo al percorso, o con ogni barra dopo la prima doppia (la query resta). */
function conLeBarre(href: string, doppie = false): string {
  const q = href.search(/[?#]/)
  const [p, resto] = q < 0 ? [href, ''] : [href.slice(0, q), href.slice(q)]
  return (doppie ? `/${p.slice(1).replace(/\//g, '//')}` : `${p}/`) + resto
}

function barre() {
  console.log('\n  -- le barre doppie e in fondo: i 308 del router prima delle regole, e lo specchio con lui')
  const primo = rotteVere[0] as (typeof rotteVere)[number] & { source?: string; internal?: boolean }
  check('il primo redirect del router e\' il suo 308 della barra in fondo (trailingSlash: false)',
    primo?.source === '/:path+/' && primo.internal === true && getRedirectStatus(primo) === 308,
    `${primo?.source} ${primo && getRedirectStatus(primo)}`)

  for (const [da, a] of BARRE) {
    const r = apriDopoLeBarre(da, JP)
    const s = seguiVersione(da, 'japan')
    check(`Japan: ${JSON.stringify(da)} -> 308 e poi 307 ${a}, e seguiVersione lo stesso`,
      r.passi.length > 0 && doveVa(r) === normale(a) && normale(s) === normale(a) && !/\/\/|\\/.test(s),
      `${r.passi.join(' -> ')} -> ${r.status} ${r.location}; seguiVersione ${s}`)
  }
  const giri = BARRE.filter(([, a]) => { const r = apriDopoLeBarre(a, JP); return r.status !== 200 || r.passi.length > 0 })
  check('nessun giro: le destinazioni non hanno barre da togliere e restano', giri.length === 0, giri.join(', '))
  const mossi = FERMI_BARRE.filter((h) => apriDopoLeBarre(h, JP).status !== 200 || seguiVersione(h, 'japan') !== h)
  check(`Japan: ${FERMI_BARRE.length} URL con le barre che dopo i 308 restano, e seguiVersione non li tocca`,
    mossi.length === 0, mossi.join(', '))
  const senza = [...BARRE.map(([da]) => da), ...FERMI_BARRE].filter((h) => {
    const r = apriDopoLeBarre(h)
    return r.status !== 200 || r.passi.length === 0 || seguiVersione(h, 'global') !== h
  })
  check('senza il cookie: solo i 308 delle barre, nessun redirect della versione (e Global non tocca l\'href)',
    senza.length === 0, senza.join(', '))
  vale('l\'ancora resta anche col percorso pulito', seguiVersione('/events//1/t/5/#tips', 'japan'), '/events/1/japan/t/5#tips')
  vale('la radice resta la radice', seguiVersione('/?x=1', 'japan'), '/events/japan?x=1')

  // Tutte le righe di sempre, con la barra in fondo o con le barre doppie: lo specchio dice dove arriva il router
  const diversi: string[] = []
  const righe = [...REDIRECT.map(([da]) => da), ...FERMI].filter((h) => !/^\/(?:[?#]|$)/.test(h))
  for (const h of righe.flatMap((x) => [conLeBarre(x), conLeBarre(x, true)])) {
    const r = apriDopoLeBarre(h, JP)
    const dove = doveVa(r)
    const s = seguiVersione(h, 'japan')
    if (r.passi.length === 0 && h.split('?', 1)[0].length > 1 && /\/(?:[?]|$)|\/\//.test(h.split('?', 1)[0])) {
      diversi.push(`${h}: il router non ha fatto il 308`)
    }
    if (dove === null ? s !== h : normale(s) !== dove) diversi.push(`${h}: router ${dove}, seguiVersione ${s}`)
    if (seguiVersione(h, 'global') !== h) diversi.push(`${h}: Global lo cambia`)
  }
  check(`ogni riga con le barre (${righe.length * 2}): seguiVersione = il router vero dopo i suoi 308`, diversi.length === 0,
    diversi.join(' | '))
}

// ---------------------------------------------------------------------
//  Il gemello dell'interruttore
// ---------------------------------------------------------------------

const GEMELLI: [string, Versione, string | null][] = [
  ['/events', 'japan', '/events/japan'],
  ['/events/japan', 'global', '/events'],
  ['/events/japan', 'japan', '/events/japan'],
  ['/events?account=deleted', 'japan', '/events/japan?account=deleted'],
  ['/events/japan?account=deleted&region=global', 'global', '/events?account=deleted'],
  ['/events/1', 'japan', '/events/1/japan'],
  ['/events/1/japan', 'global', '/events/1'],
  ['/events/1/t/5/p/3?region=global#clear-9', 'japan', '/events/1/japan/t/5'],
  ['/events/1/japan/t/5/p/3#clear-9', 'global', '/events/1/t/5'],
  ['/events/1/japan/t/5#tips', 'global', '/events/1/t/5#tips'],
  ['/events/1/t/5#tip-6f1e2d3c-0000-4000-8000-000000000001', 'japan', '/events/1/japan/t/5#tip-6f1e2d3c-0000-4000-8000-000000000001'],
  ['/events/1/t/5#clear', 'japan', '/events/1/japan/t/5'],
  ['/events/1/t/5?region=global', 'global', '/events/1/t/5'],
  ['/events/browse?type=story&page=3', 'japan', '/events/browse?region=japan&type=story'],
  ['/events/browse?region=japan&type=story&status=active&q=goku+%26+co&page=2', 'global',
    '/events/browse?type=story&status=active&q=goku+%26+co'],
  ['/events/browse?region=japan', 'global', '/events'],
  ['/events/browse?region=japan&page=4', 'global', '/events'],
  ['/events/browse', 'japan', '/events/japan'],
  ['/events/browse?q=goku', 'japan', '/events/browse?region=japan&q=goku'],
  ['/events/1/clears?tier=5&proof=1&page=2', 'japan', '/events/1/clears?region=japan&tier=5&proof=1'],
  ['/events/1/clears?region=japan&tier=5&card=3', 'global', '/events/1/clears?tier=5&card=3'],
  // la pagina e' la stessa nelle due versioni, o e' per utente
  ['/events/1/submit?region=global&tier=5', 'japan', null],
  [`/events/1/clears/${C}/edit`, 'japan', null],
  ['/cards/1034200', 'japan', null],
  ['/users/goku_fan', 'japan', null],
  ['/settings', 'japan', null],
  ['/notifications', 'global', null],
  ['/welcome?next=/events', 'japan', null],
  ['/login', 'japan', null],
  ['/admin', 'japan', null],
  ['/', 'japan', null],
  // non pagine evento, o non nostre
  ['/events/abc', 'japan', null],
  ['/events/1/t/abc', 'japan', null],
  ['/events/1/japan/japan', 'global', null],
  ['//evil.example/events', 'japan', null],
  ['/\\evil.example/events', 'japan', null],
  ['https://evil.example/events', 'japan', null],
  ['events', 'japan', null],
  ['', 'japan', null],
  [`/events?x=${'a'.repeat(2048)}`, 'japan', null],
]

async function gemelli() {
  console.log('\n  -- gemello(): dove porta l\'interruttore')
  for (const [da, to, a] of GEMELLI) {
    const nome = da.length > 80 ? `${da.slice(0, 40)}... (${da.length} caratteri)` : da
    vale(`${nome} -> ${to}`, gemello(da, to), a)
  }
  check('un valore che non e\' testo: null', gemello(42, 'japan') === null && gemello(null, 'global') === null &&
    gemello(undefined, 'japan') === null)
  const fuori: string[] = []
  const nonIdem: string[] = []
  for (const [da, to] of GEMELLI) {
    const g = gemello(da, to)
    if (g === null) continue
    if (gemello(g, to) !== g) nonIdem.push(`${g} -> ${gemello(g, to)}`)
    const r = await apri(g, to === 'japan' ? JP : {})
    if (r.status !== 200) fuori.push(`${g} (${to}) -> ${r.status} ${r.location}`)
  }
  check('idempotente: il gemello del gemello e\' lui', nonIdem.length === 0, nonIdem.join(', '))
  check('mai un URL che le regole della versione nuova rimanderebbero altrove', fuori.length === 0, fuori.join(', '))
  check('Japan: l\'uscita e\' gia\' marcata (seguiVersione non la cambia)',
    GEMELLI.every(([da]) => { const g = gemello(da, 'japan'); return g === null || seguiVersione(g, 'japan') === g }))
}

// ---------------------------------------------------------------------
//  Il cookie e lo script del <head>
// ---------------------------------------------------------------------

function cookie() {
  console.log('\n  -- il cookie dts_version')
  check('il nome e\' dts_version', VERSIONE_COOKIE === 'dts_version')
  const japan = ['dts_version=japan', 'a=1; dts_version=japan; b=2', ' dts_version=japan ', 'dts_signed_in=1;dts_version=japan']
  const global = ['dts_version=JAPAN', 'dts_version=japan2', 'xdts_version=japan', 'dts_versione=japan', 'dts_version=',
    'dts_version', 'dts_version=global', '', 'a=1', 'dts_version=global; dts_version=japan']
  check('versioneDaCookie: japan solo con dts_version=japan esatto', japan.every((c) => versioneDaCookie(c) === 'japan'))
  const sbagliati = global.filter((c) => versioneDaCookie(c) !== 'global')
  check('...e Global per tutto il resto (maiuscole, japan2, altri nomi, vuoto, il primo dei doppi)',
    sbagliati.length === 0 && versioneDaCookie(null) === 'global' && versioneDaCookie(undefined) === 'global',
    sbagliati.join(' | '))
  vale('opzioni su https', opzioniVersione('https://dokkan.example'),
    { httpOnly: false, sameSite: 'lax', secure: true, path: '/', maxAge: 400 * 86400 })
  check('Secure solo su https (http://localhost lo scarterebbe)', opzioniVersione('http://localhost:3000').secure === false)
  check('400 giorni, il tetto di Chrome', VERSIONE_MAX_AGE === 34_560_000)
  const jp = cookieVersione('japan', 'https://dokkan.example')
  const gl = cookieVersione('global', 'https://dokkan.example')
  check('la scelta Japan: dts_version=japan per 400 giorni', jp.name === VERSIONE_COOKIE && jp.value === 'japan' &&
    jp.options.maxAge === VERSIONE_MAX_AGE && jp.options.path === '/')
  check('la scelta Global: il cookie se ne va (vuoto, maxAge 0, stesso path)', gl.name === VERSIONE_COOKIE &&
    gl.value === '' && gl.options.maxAge === 0 && gl.options.path === '/' && gl.options.httpOnly === false)
  check('isVersione', isVersione('global') && isVersione('japan') && !isVersione('Japan') && !isVersione('eu') &&
    !isVersione(null))
  check('la lingua: inglese per tutte e due, per ora', localeDi('global') === 'en' && localeDi('japan') === 'en')
}

/** Lo script del <head> su un document finto: l'attributo che mette, con il cookie dato. */
function eseguiScript(cookie: string | Error): string | undefined {
  const attributi: Record<string, string> = {}
  const doc = {
    get cookie(): string {
      if (cookie instanceof Error) throw cookie
      return cookie
    },
    set cookie(_v: string) {
      attributi['scritto'] = 'si'
    },
    documentElement: { setAttribute: (k: string, v: string) => { attributi[k] = v } },
  }
  new Function('document', scriptVersione())(doc)
  return attributi.scritto ? 'SCRITTO' : attributi[ATTRIBUTO_VERSIONE]
}

function script() {
  console.log('\n  -- lo script del <head>')
  check('dts_version=japan: data-reg="japan"', eseguiScript('dts_version=japan') === 'japan')
  check('fra altri cookie', eseguiScript('dts_signed_in=1; dts_version=japan; x=2') === 'japan')
  const casi = ['', 'dts_version=JAPAN', 'dts_version=japan2', 'xdts_version=japan', 'dts_version=',
    'dts_version=global', 'dts_version=global; dts_version=japan', 'a=dts_version=japan']
  const sbagliati = casi.filter((c) => eseguiScript(c) !== undefined)
  check('nessun attributo per tutto il resto', sbagliati.length === 0, sbagliati.join(' | '))
  const diversi = [...casi, 'dts_version=japan', 'a=1; dts_version=japan; b=2']
    .filter((c) => (eseguiScript(c) === 'japan' ? 'japan' : 'global') !== versioneDaCookie(c))
  check('dice sempre quello che dice versioneDaCookie', diversi.length === 0, diversi.join(' | '))
  let lancia = false
  try { eseguiScript(new Error('SecurityError')) } catch { lancia = true }
  check('document.cookie che lancia: nessun errore', !lancia)
  check('non scrive mai il cookie (Safari lo terrebbe 7 giorni)', !casi.some((c) => eseguiScript(c) === 'SCRITTO') &&
    !/cookie\s*=[^=]/.test(scriptVersione()))
  check('lo stesso testo per tutti (l\'HTML resta in cache)', scriptVersione() === scriptVersione() &&
    !/location|fetch|localStorage/.test(scriptVersione()))
  check('il layout lo mette nel <head> accanto a quello del tema',
    /\$\{scriptTema\(\)\};\$\{scriptVersione\(\)\}/.test(file('app/layout.tsx')))
}

/** lib/versione/client.ts su un document finto: l'attributo, e il cookie riletto (mai scritto). */
async function client() {
  console.log('\n  -- il browser (lib/versione/client.ts)')
  const attributi = new Map<string, string>()
  let cookie = ''
  let scritto = false
  const g = globalThis as Record<string, unknown>
  g.document = {
    get cookie() { return cookie },
    set cookie(_v: string) { scritto = true },
    visibilityState: 'visible',
    documentElement: {
      getAttribute: (k: string) => attributi.get(k) ?? null,
      setAttribute: (k: string, v: string) => { attributi.set(k, v) },
      removeAttribute: (k: string) => { attributi.delete(k) },
    },
  }
  try {
    const c = await import('@/lib/versione/client')
    check('senza attributo: Global', c.versioneAttuale() === 'global')
    c.applicaVersione('japan')
    check('applicaVersione(japan): data-reg="japan"', attributi.get(ATTRIBUTO_VERSIONE) === 'japan' && c.versioneAttuale() === 'japan')
    c.applicaVersione('global')
    check('applicaVersione(global): l\'attributo se ne va', !attributi.has(ATTRIBUTO_VERSIONE) && c.versioneAttuale() === 'global')
    cookie = 'dts_signed_in=1; dts_version=japan'
    c.rileggiVersione()
    check('rileggiVersione: il cookie cambiato da un\'altra scheda arriva qui', c.versioneAttuale() === 'japan')
    cookie = ''
    c.rileggiVersione()
    check('...e anche il ritorno a Global', c.versioneAttuale() === 'global')
    Object.defineProperty(g.document, 'cookie', { get() { throw new Error('SecurityError') }, configurable: true })
    attributi.set(ATTRIBUTO_VERSIONE, 'japan')
    let lancia = false
    try { c.rileggiVersione() } catch { lancia = true }
    check('cookie illeggibili: nessun errore, resta quello dello script', !lancia && c.versioneAttuale() === 'japan')
    check('il browser non scrive mai il cookie', !scritto && !/document\.cookie\s*=[^=]/.test(file('lib/versione/client.ts')))
  } finally {
    delete g.document
  }
}

// ---------------------------------------------------------------------
//  set_region (0035) e cambiaVersione
// ---------------------------------------------------------------------

const reg = async (id: string) => (await one<{ r: string }>('select reg::text as r from app_user where id = $1', [id]))?.r
const feedAdmin = (admin: string) =>
  num(`select count(*) from notification where kind = 'site_activity' and recipient_id = $1`, [admin])

async function verbo(a: string, b: string, nuovo: string, admin: string) {
  console.log('\n  -- set_region (0035)')
  check('per difetto Global', await reg(a) === 'global')
  await db.query(`update app_user set updated_at = now() - interval '1 day' where id = $1`, [a])
  const prima = (await one<{ t: Date }>('select updated_at as t from app_user where id = $1', [a])).t
  const r1 = await one<{ c: boolean }>('select set_region($1::uuid, $2::region) as c', [a, 'japan'])
  const dopo = (await one<{ t: Date }>('select updated_at as t from app_user where id = $1', [a])).t
  check('Japan: true, e l\'account cambia', r1.c === true && await reg(a) === 'japan')
  check('updated_at si aggiorna', dopo.getTime() > prima.getTime())
  check('...e solo per lui', await reg(b) === 'global')
  const r2 = await one<{ c: boolean }>('select set_region($1::uuid, $2::region) as c', [a, 'japan'])
  const ancora = (await one<{ t: Date }>('select updated_at as t from app_user where id = $1', [a])).t
  check('la stessa regione: false, e updated_at non si tocca', r2.c === false && ancora.getTime() === dopo.getTime())
  const pub = await one<{ reg: string }>('select reg::text as reg from public_profile where id = $1', [a])
  check('il profilo pubblico la segue ("Plays Japan")', pub?.reg === 'japan')
  const r3 = await one<{ c: boolean }>('select set_region($1::uuid, $2::region) as c', [a, 'global'])
  check('di nuovo Global: true', r3.c === true && await reg(a) === 'global')
  check('anche da sospeso: e\' una preferenza',
    (await db.query(`update app_user set suspended_until = now() + interval '1 day' where id = $1`, [b]), true) &&
    await esito('select set_region($1::uuid, $2::region)', [b, 'japan']) === 'ok' && await reg(b) === 'japan')
  await db.query('update app_user set suspended_until = null where id = $1', [b])

  const rifiuti: [string, string, unknown[]][] = [
    ['un uuid sconosciuto', 'P0002 user_not_found', ['00000000-0000-4000-8000-000000000000', 'japan']],
    ['un utente senza onboarding', 'P0002 user_not_found', [nuovo, 'japan']],
    ['Japan con la maiuscola', '22P02', [a, 'Japan']],
    ['una regione che non c\'e\'', '22P02', [a, 'eu']],
    ['null', '23514 region_missing', [a, null]],
  ]
  for (const [nome, vuole, args] of rifiuti) {
    const got = await esito('select set_region($1::uuid, $2::region)', args)
    check(`${nome}: ${vuole}`, got === vuole, got)
  }
  check('dopo i rifiuti niente e\' cambiato', await reg(a) === 'global' && await reg(nuovo) === 'global')
  check('il feed degli admin non ne sa niente (activity_app_user guarda handle e onboarded_at)',
    await feedAdmin(admin) === 0)
  // la controprova: il feed di quell'admin e' acceso davvero
  await db.query("select complete_onboarding($1::uuid, 'ver_new_ok', 'japan')", [nuovo])
  check('controprova: un iscritto nuovo nel feed dello stesso admin', await feedAdmin(admin) === 1)
}

async function cambio(a: string, nuovo: string) {
  console.log('\n  -- cambiaVersione (setVersionAction)')
  const BASE = 'https://dokkan.example'
  const finto = (utente: DipendenzeVersione['utente'], salva?: DipendenzeVersione['salva']) => {
    const scritti: CookieVersione[] = []
    const salvati: string[] = []
    const invalidati: string[] = []
    const d: DipendenzeVersione = {
      utente,
      salva: salva ?? (async (id, v) => {
        salvati.push(`${id}:${v}`)
        return (await one<{ c: boolean }>('select set_region($1::uuid, $2::region) as c', [id, v])).c
      }),
      invalida: (h) => { invalidati.push(h) },
      scrivi: (c) => { scritti.push(c) },
      utenteSparito: (e) => e instanceof pg.DatabaseError && e.constraint === 'user_not_found',
    }
    return { d, scritti, salvati, invalidati }
  }
  const hA = 'ver_a'
  const utenteA = { id: a, handle: hA, onboarded: true }

  let f = finto(utenteA)
  let e = await cambiaVersione('eu', '/events/1', BASE, f.d)
  check('un valore sbagliato: errore, nessun cookie, niente sull\'account', 'error' in e && f.scritti.length === 0 &&
    f.salvati.length === 0)

  f = finto(null)
  e = await cambiaVersione('japan', '/events/1/t/5/p/2#clear-9', BASE, f.d)
  vale('chi non e\' entrato: il cookie e basta, e il gemello', { e, cookie: f.scritti.map((c) => c.value), salvati: f.salvati },
    { e: { saved: 'device', vai: '/events/1/japan/t/5' }, cookie: ['japan'], salvati: [] })
  f = finto({ id: nuovo, handle: 'user_x', onboarded: false })
  e = await cambiaVersione('japan', '/cards/1', BASE, f.d)
  vale('chi deve ancora scegliere l\'handle: solo il dispositivo', { e, salvati: f.salvati },
    { e: { saved: 'device', vai: null }, salvati: [] })

  f = finto(utenteA)
  e = await cambiaVersione('japan', '/cards/1034200', BASE, f.d)
  check('un account completo: sull\'account, profilo invalidato, la carta resta (nessun redirect)',
    mostra(e) === mostra({ saved: 'account', vai: null }) && await reg(a) === 'japan' &&
    mostra(f.invalidati) === mostra([hA]) && f.scritti[0]?.value === 'japan', mostra({ e, i: f.invalidati }))
  f = finto(utenteA)
  e = await cambiaVersione('japan', '/events', BASE, f.d)
  check('la stessa scelta: salvata, ma il profilo non si invalida', mostra(e) === mostra({ saved: 'account', vai: '/events/japan' }) &&
    f.invalidati.length === 0 && f.salvati.length === 1, mostra({ e, i: f.invalidati }))
  f = finto(utenteA)
  e = await cambiaVersione('global', '/events/1/japan/t/5#tips', BASE, f.d)
  check('Global: il cookie se ne va, e il gemello Global', mostra(e) === mostra({ saved: 'account', vai: '/events/1/t/5#tips' }) &&
    f.scritti[0]?.value === '' && f.scritti[0]?.options.maxAge === 0 && await reg(a) === 'global' &&
    mostra(f.invalidati) === mostra([hA]), mostra({ e, c: f.scritti }))

  f = finto({ id: '00000000-0000-4000-8000-000000000000', handle: 'sparito', onboarded: true })
  e = await cambiaVersione('japan', '/settings', BASE, f.d)
  check('l\'account appena cancellato: la scelta resta sul dispositivo', mostra(e) === mostra({ saved: 'device', vai: null }) &&
    f.scritti.length === 1)
  f = finto(utenteA, async () => { throw new Error('guasto') })
  let lancia = false
  try { await cambiaVersione('japan', '/events', BASE, f.d) } catch { lancia = true }
  check('un altro errore del database non si nasconde', lancia)
  // Next mette il Set-Cookie nella risposta appena lo si scrive, e il 500
  // dell'azione lo tiene: il dispositivo cambierebbe con l'account fermo
  check('...e il cookie non si scrive: il dispositivo resta com\'era', f.scritti.length === 0, mostra(f.scritti))

  const mai: string[] = []
  for (const [da] of GEMELLI) {
    f = finto(null)
    const x = await cambiaVersione('japan', da, BASE, f.d)
    if ('vai' in x && x.vai && seguiVersione(x.vai, 'japan') !== x.vai) mai.push(`${da} -> ${x.vai}`)
  }
  check('in Japan mai un redirect a un URL di eventi non marcato', mai.length === 0, mai.join(', '))
}

function utenteDiMe() {
  console.log('\n  -- /api/me: la versione dell\'account')
  const base: CurrentUser = {
    id: '00000000-0000-4000-8000-000000000001', handle: 'Someone', image: null, role: 'member', reg: 'japan',
    displayName: 'Real Name', onboarded: true, prefersAnimated: false, theme: null,
    suspendedUntil: null, suspended: false, suspensionReason: null, unread: false,
  }
  const me = viewerUserOf(base)
  check('user.reg c\'e\'', me.reg === 'japan' && viewerUserOf({ ...base, reg: 'global' }).reg === 'global')
  check('e ancora nessun id, email o nome del provider', !('id' in me) && !('email' in me) && !('displayName' in me))
}

// ---------------------------------------------------------------------
//  Le guardie sui file
// ---------------------------------------------------------------------

function fileDi(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(new URL(`../../${dir}`, import.meta.url))) {
    const rel = `${dir}/${n}`
    if (statSync(new URL(`../../${rel}`, import.meta.url)).isDirectory()) fileDi(rel, out)
    else if (/\.(ts|tsx)$/.test(n)) out.push(rel)
  }
  return out
}

// ---------------------------------------------------------------------
//  I redirect delle Server Action, letti con il parser di TypeScript
// ---------------------------------------------------------------------

const ts = richiedi('typescript') as typeof TS

/** Il segno per un redirect che il test non sa leggere ma e' gia' della versione giusta, col perche'. */
const SEGNO = /\/\/\s*redirect-versione:\s*\S/

/** Un URL scritto che porta agli eventi (o alla radice, che porta a /events): senza versione. */
const eventiScritti = (t: string) => /^\/(?:events(?:[/?#]|$)|[?#]|$)/i.test(t)

const albero = (testo: string) => ts.createSourceFile('x.tsx', testo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

/** I nomi con cui un sorgente importa redirect e permanentRedirect da next/navigation, e i suoi import * as. */
function importDiRedirect(sf: TS.SourceFile): { nomi: Set<string>; spazi: Set<string> } {
  const nomi = new Set<string>()
  const spazi = new Set<string>()
  for (const s of sf.statements) {
    if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier) || s.moduleSpecifier.text !== 'next/navigation') continue
    const b = s.importClause?.namedBindings
    if (b && ts.isNamespaceImport(b)) spazi.add(b.name.text)
    if (b && ts.isNamedImports(b)) {
      for (const e of b.elements) if (/^(?:redirect|permanentRedirect)$/.test((e.propertyName ?? e.name).text)) nomi.add(e.name.text)
    }
  }
  return { nomi, spazi }
}

/**
 * I sorgenti da giudicare: ogni file 'use server', e ogni modulo di lib/
 * che importa redirect o permanentRedirect. Un redirect lanciato da un
 * modulo che l'azione chiama (requireUser di lib/dal.ts) e' un redirect
 * dell'azione come gli altri. Le pagine e i loro componenti no: i loro
 * redirect li segue il browser, quindi passano dalle regole.
 */
function daGiudicare(percorso: string, testo: string): boolean {
  if (/^\s*['"]use server['"]/m.test(testo)) return true
  if (!percorso.startsWith('lib/')) return false
  const { nomi, spazi } = importDiRedirect(albero(testo))
  return nomi.size > 0 || spazi.size > 0
}

/**
 * Ogni redirect (o permanentRedirect) di next/navigation in un sorgente,
 * col primo argomento giudicato: null se porta gia' alla versione giusta,
 * altrimenti il perche'. Vanno bene seguiVersione(href, versione) con la
 * versione della richiesta (await versioneRichiesta(), o una variabile che
 * la tiene: mai una versione scritta, perche' con 'global' l'URL resta
 * senza versione), un URL scritto che non e' degli eventi,
 * eventHref({..., explicit: true}) (anche con clearAnchor o un #... dopo),
 * homeHref(await versioneRichiesta()), i due rami di un ternario buoni, e
 * una funzione dello stesso file i cui return sono buoni. Tutto il resto
 * (un'altra funzione di lib/urls.ts, una variabile) no, a meno del segno
 * "// redirect-versione: <perche'>" sulla riga o su quella prima.
 */
function redirectDi(testo: string): { riga: number; arg: string; male: string | null }[] {
  const sf = albero(testo)
  const righe = testo.split('\n')
  const { nomi, spazi } = importDiRedirect(sf)
  const locali = new Map<string, TS.Node>()
  const raccogli = (n: TS.Node) => {
    if (ts.isFunctionDeclaration(n) && n.name && n.body) locali.set(n.name.text, n.body)
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer &&
      (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) locali.set(n.name.text, n.initializer.body)
    ts.forEachChild(n, raccogli)
  }
  raccogli(sf)
  const nomeDi = (e: TS.Expression) => (ts.isIdentifier(e) ? e.text : null)
  const togli = (e: TS.Expression): TS.Expression =>
    ts.isParenthesizedExpression(e) || ts.isAwaitExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) ? togli(e.expression) : e
  const ritorni = (corpo: TS.Node): TS.Expression[] => {
    if (!ts.isBlock(corpo)) return [corpo as TS.Expression]
    const out: TS.Expression[] = []
    const giro = (n: TS.Node) => {
      if (ts.isFunctionLike(n)) return
      if (ts.isReturnStatement(n)) out.push(n.expression ?? ts.factory.createIdentifier('undefined'))
      ts.forEachChild(n, giro)
    }
    ts.forEachChild(corpo, giro)
    return out
  }
  const giudica = (x: TS.Expression, visti: Set<string>): string | null => {
    const e = togli(x)
    if (ts.isConditionalExpression(e)) return giudica(e.whenTrue, visti) ?? giudica(e.whenFalse, visti)
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return eventiScritti(e.text) ? `l'URL scritto ${e.text}` : null
    if (ts.isTemplateExpression(e)) {
      return e.head.text === '' ? 'un URL che comincia da una variabile' : eventiScritti(e.head.text) ? `l'URL scritto ${e.head.text}...` : null
    }
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const d = togli(e.right)
      const ancora = (ts.isCallExpression(d) && nomeDi(d.expression) === 'clearAnchor') ||
        ((ts.isStringLiteral(d) || ts.isNoSubstitutionTemplateLiteral(d)) && d.text.startsWith('#'))
      return giudica(e.left, visti) ?? (ancora ? null : 'dopo l\'URL qualcosa che non e\' un\'ancora')
    }
    if (ts.isCallExpression(e)) {
      const f = nomeDi(e.expression)
      const a0 = e.arguments[0] ? togli(e.arguments[0]) : null
      if (f === 'seguiVersione') {
        const a1 = e.arguments[1] ? togli(e.arguments[1]) : null
        if (!a1) return 'seguiVersione senza la versione'
        const dellaRichiesta = (ts.isIdentifier(a1) && a1.text !== 'undefined') ||
          (ts.isCallExpression(a1) && nomeDi(a1.expression) === 'versioneRichiesta')
        return dellaRichiesta ? null : `seguiVersione con la versione ${a1.getText(sf).slice(0, 30)}, non quella della richiesta`
      }
      if (f === 'eventHref') {
        const esplicito = !!a0 && ts.isObjectLiteralExpression(a0) && a0.properties.some((p) =>
          ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'explicit' && p.initializer.kind === ts.SyntaxKind.TrueKeyword)
        return esplicito ? null : 'eventHref senza explicit: true'
      }
      if (f === 'homeHref') {
        return a0 && ts.isCallExpression(a0) && nomeDi(a0.expression) === 'versioneRichiesta' ? null : 'homeHref senza la versione della richiesta'
      }
      if (f && locali.has(f) && !visti.has(f)) {
        const r = ritorni(locali.get(f)!)
        const prossimi = new Set([...visti, f])
        return r.length === 0 ? `${f}() non ritorna niente` : r.map((x2) => giudica(x2, prossimi)).find((m) => m !== null) ?? null
      }
      return `${f ?? 'una chiamata'}(...) non passa da seguiVersione`
    }
    return `${e.getText(sf).slice(0, 40)}: un valore che il test non sa leggere`
  }
  const trovati: { riga: number; arg: string; male: string | null }[] = []
  const visita = (n: TS.Node) => {
    if (ts.isCallExpression(n)) {
      const c = n.expression
      const e = (ts.isIdentifier(c) && nomi.has(c.text)) ||
        (ts.isPropertyAccessExpression(c) && ts.isIdentifier(c.expression) && spazi.has(c.expression.text) &&
          /^(?:redirect|permanentRedirect)$/.test(c.name.text))
      if (e && n.arguments[0]) {
        const riga = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line
        const segnato = SEGNO.test(righe[riga]) || (riga > 0 && SEGNO.test(righe[riga - 1]))
        trovati.push({ riga: riga + 1, arg: n.arguments[0].getText(sf), male: segnato ? null : giudica(n.arguments[0], new Set()) })
      }
    }
    ts.forEachChild(n, visita)
  }
  visita(sf)
  return trovati
}

function guardiaRedirect(sorgenti: string[]) {
  console.log('\n  -- i redirect delle Server Action (parser di TypeScript)')
  const TESTA = "'use server'\nimport { RedirectType, permanentRedirect, redirect } from 'next/navigation'\n"
  // la controprova: ognuno di questi deve essere preso (un redirect sbagliato ciascuno)
  const CATTIVI: [string, string][] = [
    ['un evento senza explicit', 'redirect(eventHref({ id }))'],
    ['un evento con la regione ma senza explicit', 'redirect(eventHref({ id, reg: w.reg, tier: w.tier_id }))'],
    ['explicit: false', 'redirect(eventHref({ id, explicit: false }))'],
    ['la lista filtrata', "redirect(browseHref({ kind: 'story' }))"],
    ['la home senza versione', 'redirect(homeHref())'],
    ['la home Global', "redirect(homeHref('global'))"],
    ['/events scritto', "redirect('/events')"],
    ['/Events/1 scritto', 'redirect("/Events/1")'],
    ['la radice', "redirect('/')"],
    ['/?x', "redirect('/?x=1')"],
    ['un template sugli eventi', 'redirect(`/events/${id}/t/${tier}`)'],
    ['un template che comincia da una variabile', 'redirect(`${base}/x`)'],
    ['una variabile', 'redirect(next)'],
    ['un ramo del ternario', "redirect(ok ? '/settings' : eventHref({ id }))"],
    ['permanentRedirect', 'permanentRedirect(submitHref(id, reg, tier))'],
    ['un nome diverso', "import { redirect as vai } from 'next/navigation'\nvai(homeHref())"],
    ['lo spazio dei nomi', "import * as nav from 'next/navigation'\nnav.redirect(eventHref({ id }))"],
    ['una funzione dello stesso file che sbaglia', "const dove = () => eventHref({ id: '1' })\nredirect(dove())"],
    ['...con un return buono e uno no', "function dove(x: number) { if (x) return '/settings'\n  return browseHref({}) }\nredirect(dove(1))"],
    ['un\'ancora dopo un URL senza versione', 'redirect(eventHref({ id }) + clearAnchor(c))'],
    ['una query dopo un URL marcato', "redirect(eventHref({ id, explicit: true }) + '?page=2')"],
    ['il segno senza il perche\'', '// redirect-versione:\nredirect(next)'],
    ['il segno due righe sopra', '// redirect-versione: lontano\n\nredirect(next)'],
    // seguiVersione(href, 'global') restituisce href com'e': senza versione
    ['seguiVersione con la versione scritta', "redirect(seguiVersione(eventHref({ id }), 'global'))"],
    ['...anche in un template', 'redirect(seguiVersione(next, `japan`))'],
    ['seguiVersione senza la versione', 'redirect(seguiVersione(next))'],
    ['seguiVersione con undefined', 'redirect(seguiVersione(next, undefined))'],
  ]
  const presi = CATTIVI.filter(([, s]) => redirectDi(TESTA + s).filter((r) => r.male).length !== 1).map(([n]) => n)
  check(`la guardia prende i ${CATTIVI.length} redirect sbagliati di prova`, presi.length === 0, `non presi: ${presi.join(', ')}`)
  // ...e lascia stare questi: [sorgente, quanti redirect ci sono]
  const BUONI: [string, number][] = [
    ['redirect(seguiVersione(next, reg))', 1],
    ["redirect(seguiVersione('/events?account=deleted', await versioneRichiesta()))", 1],
    ["redirect('/settings?x=1')", 1], ['redirect(`/settings?unlinked=${p.id}`)', 1], ["redirect('/login')", 1],
    ['redirect(eventHref({ id, reg, tier, page, explicit: true }) + clearAnchor(c))', 1],
    ["redirect(eventHref({ id, explicit: true }) + '#tips')", 1],
    ['redirect(homeHref(await versioneRichiesta()))', 1],
    ['const casa = async () => homeHref(await versioneRichiesta())\nasync function al(w: string) {\n  const p = 2\n  return eventHref({ id: w, page: p, explicit: true }) + clearAnchor(w)\n}\nredirect(w ? await al(w) : await casa())', 1],
    ["// redirect-versione: il gemello, gia' risolto\nif (e.vai) redirect(e.vai, RedirectType.replace)", 1],
    ["if (e.vai) redirect(e.vai) // redirect-versione: il gemello", 1],
    ["// redirect('/events') in un commento non conta\nconst s = \"redirect('/events')\"\nrouter.redirect('/events')", 0],
    // le due di lib/dal.ts: /login e /welcome, con ?next=
    ["function loginUrl(next: string) {\n  const n = safeNext(next, '')\n  return n ? `/login?next=${encodeURIComponent(n)}` : '/login'\n}\nredirect(loginUrl(next))", 1],
    ["redirect(n ? `/welcome?next=${encodeURIComponent(n)}` : '/welcome')", 1],
  ]
  const falsi = BUONI.filter(([s, n]) => { const r = redirectDi(TESTA + s); return r.length !== n || r.some((x) => x.male) })
    .map(([s]) => s.split('\n').at(-1))
  check(`...e non tocca i ${BUONI.length} giusti (nessun falso positivo)`, falsi.length === 0, falsi.join(' | '))

  // Un redirect nascosto in un modulo che le azioni chiamano: il modulo va
  // giudicato anche senza 'use server' (era il buco: lib/dal.ts non lo e').
  const NASCOSTO = "import { redirect } from 'next/navigation'\nexport function vaiAllEvento(id: string) {\n  redirect(`/events/${id}`)\n}\n"
  check('...anche in un modulo di lib/ senza \'use server\' che le azioni chiamano',
    daGiudicare('lib/x.ts', NASCOSTO) && redirectDi(NASCOSTO).filter((r) => r.male).length === 1 &&
    daGiudicare('lib/x.ts', "import * as nav from 'next/navigation'\nnav.redirect('/events')") &&
    daGiudicare('app/x/azioni.ts', `'use server'\n${NASCOSTO}`))
  check('...e non giudica i moduli che non importano redirect',
    !daGiudicare('lib/x.ts', "import { notFound } from 'next/navigation'\nconst s = \"redirect('/events')\"") &&
    !daGiudicare('lib/x.ts', "import { redirect } from 'next/dist/x'\nredirect('/events')"))

  const giudicati = sorgenti.filter((f) => daGiudicare(f, file(f)))
  const tutti = giudicati.flatMap((f) => redirectDi(file(f)).map((r) => ({ ...r, f })))
  const sbagliati = tutti.filter((r) => r.male).map((r) => `${r.f}:${r.riga} redirect(${r.arg}): ${r.male}`)
  const azioni = giudicati.filter((f) => /^\s*['"]use server['"]/m.test(file(f)))
  check(`ogni redirect delle Server Action e dei moduli di lib/ va gia' alla versione giusta (${tutti.length} in ${giudicati.length} file, ${azioni.length} 'use server')`,
    azioni.length >= 7 && giudicati.includes('lib/dal.ts') && tutti.length >= 11 && sbagliati.length === 0, sbagliati.join(' | '))
}

function guardie() {
  console.log('\n  -- le guardie sui file')
  const sorgenti = [...fileDi('lib'), ...fileDi('app'), ...fileDi('components')]
  guardiaRedirect(sorgenti)
  const auth = file('lib/auth/actions.ts')
  check('uscita, cancellazione e /welcome portano a seguiVersione(...)',
    /redirect\(seguiVersione\('\/events', await versioneRichiesta\(\)\)\)/.test(auth) &&
    /redirect\(seguiVersione\('\/events\?account=deleted', await versioneRichiesta\(\)\)\)/.test(auth) &&
    /redirect\(seguiVersione\(next, await versioneRichiesta\(\)\)\)/.test(auth) &&
    /redirect\(seguiVersione\(next, reg\)\)/.test(auth))
  check('/welcome scrive il cookie della scelta prima del redirect',
    /await scriviVersione\(cookieVersione\(reg, readAuthEnv\(\)\.baseURL\)\)\s*\n(?:\s*\/\/.*\n)*\s*redirect\(seguiVersione\(next, reg\)\)/.test(auth))
  check('setVersionAction va al gemello con un replace', /redirect\(esito\.vai, RedirectType\.replace\)/.test(auth))
  const clears = file('lib/clears/actions.ts')
  check('i redirect dei clear: espliciti, o la home della versione',
    (clears.match(/explicit: true/g) ?? []).length === 2 && (clears.match(/: await casa\(\)\)/g) ?? []).length === 2)
  // (provider.tsx toglie da li' l'indizio dts_signed_in: un'altra cosa)
  const scrittori = sorgenti.filter((f) => /document\.cookie\s*=[^=][^\n]*(dts_version|VERSIONE_COOKIE)/.test(file(f)))
  check('nessuno scrive il cookie della versione da document.cookie', scrittori.length === 0, scrittori.join(', '))
  const lettori = sorgenti.filter((f) => /@\/lib\/versione\/server/.test(file(f)))
  const ammessi = ['lib/auth/actions.ts', 'lib/clears/actions.ts', 'app/welcome/page.tsx']
  check('il cookie della versione lo leggono solo azioni e /welcome', lettori.every((f) => ammessi.includes(f)) &&
    lettori.length === ammessi.length, lettori.join(', '))
  // email e push portano a /notifications/<id>, che segue la versione: il
  // 307 della rotta lo segue il browser, quindi passa dal routing
  const payload = file('lib/notify/payload.ts')
  const digest = file('lib/notify/digest.ts')
  check('push e digest: solo /notifications/<id>, mai un URL di eventi',
    /url: notificationLink\(/.test(payload) && /notificationLink\(String\(i\.id\)\)/.test(digest) &&
    ![payload, digest].some((t) => /eventHref|['"`]\/events/.test(t)))
  const casaJp = file('app/events/japan/page.tsx')
  check('/events/japan: la lista Japan, statica (niente query, cookie o sessione), col suo canonical',
    /<EventList filtri=\{\{ \.\.\.FILTRI_BASE, reg: 'japan' \}\} \/>/.test(casaJp) &&
    !/searchParams|cookies\(|headers\(|currentUser|getSession|versione\/server/.test(casaJp) &&
    /canonical: '\/events\/japan'/.test(casaJp))
  check('la sitemap ha /events/japan, e non le pagine evento /japan',
    /\$\{base\}\/events\/japan`/.test(file('app/sitemap.ts')) && !/reg: 'japan'/.test(file('app/sitemap.ts')))
  const config = file('lib/auth/config.ts')
  // newSession c'e' anche al rinnovo della sessione (/get-session, /update-user): solo gli accessi
  check('l\'accesso: la versione dell\'account solo a un accesso vero e con onboardedAt, e l\'uscita non la tocca',
    /if \(ACCESSI\.has\(ctx\.path\) && u\.onboardedAt != null\)/.test(config) &&
    !/sign-out'\)[^\n]*VERSIONE|sign-out'\)[^\n]*cookieVersione/.test(config))
}

try {
  await regole()
  specchio()
  await maiuscole()
  barre()
  await gemelli()
  cookie()
  script()
  await client()
  utenteDiMe()
  guardie()
  await db.query('delete from app_user where email = any($1::text[])', [EMAILS])
  const a = await utente(P, 'ver_a')
  const b = await utente(P, 'ver_b')
  const nuovo = await utente(P, 'ver_new', false)
  const admin = await utente(P, 'ver_admin')
  await db.query(`update app_user set role = 'admin' where id = $1`, [admin])
  await db.query("select set_notification_pref($1::uuid, 'site_activity', 'list', true)", [admin])
  await verbo(a, b, nuovo, admin)
  await cambio(a, nuovo)
} catch (e) {
  check('nessuna eccezione inattesa', false, e instanceof Error ? e.stack ?? e.message : String(e))
}

try {
  await db.query('delete from app_user where email = any($1::text[])', [EMAILS])
  check('pulizia: nessun utente di prova rimasto',
    (await q('select 1 from app_user where email = any($1::text[])', [EMAILS])).length === 0)
} finally {
  await db.end()
}

console.log(`\n  ${stato.passes} PASS, ${stato.fails} FAIL`)
process.exit(stato.fails ? 1 : 0)
