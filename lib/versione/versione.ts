import type { EventKind, Region, Status } from '@/lib/queries'
import { browseHref, eventHref, homeHref, parseEventView } from '@/lib/urls'

// La versione del sito: Global o Japan, una scelta sola per tutte le pagine.
//
// Lo stato vero e' il cookie dts_version: 'japan', oppure nessun cookie
// (Global, il default, anche per chi non ha mai scelto e per i motori).
// Non e' un segreto e non e' httpOnly: lo legge lo script del <head>, che
// mette html[data-reg="japan"] prima del primo paint (come il tema), e le
// parti per chi guarda (l'interruttore, gli avvisi) seguono quell'attributo
// col CSS. Lo scrive SOLO il server (l'azione dell'interruttore, l'hook
// dopo l'accesso, /welcome): Safari tiene al massimo 7 giorni un cookie
// scritto da document.cookie, 400 giorni (il tetto di Chrome) uno di una
// risposta.
//
// Gli URL: un percorso /japan o un ?region= dicono gia' la versione e
// vincono sempre ("marcati"); gli altri seguono la scelta di chi guarda,
// con i redirect 307 di next.config.ts, nel routing (sulla CDN, nessuna
// funzione). Le pagine pubbliche non leggono mai il cookie: restano
// uguali per tutti e in cache.
//
// Modulo puro, senza Next: lo usano le Server Action, better-auth, il
// layout (lo script del <head>), le isole del browser e i test
// (db/test/versione.test.mts). Le regole dei redirect stanno in
// next.config.ts; seguiVersione() qui sotto e' il loro specchio, e il test
// li confronta.

export const VERSIONE_COOKIE = 'dts_version'
/** L'attributo di <html> che lo script del <head> mette in modalita' Japan. */
export const ATTRIBUTO_VERSIONE = 'data-reg'

export type Versione = Region
export const VERSIONI: readonly Versione[] = ['global', 'japan']

export const isVersione = (v: unknown): v is Versione => v === 'global' || v === 'japan'
export const altraVersione = (v: Versione): Versione => (v === 'japan' ? 'global' : 'japan')

/** 400 giorni: il massimo che Chrome accetta (RFC 6265bis). */
export const VERSIONE_MAX_AGE = 400 * 24 * 60 * 60

export type VersioneOptions = {
  httpOnly: false
  sameSite: 'lax'
  secure: boolean
  path: '/'
  maxAge: number
}

/** Come hintOptions (lib/viewer/hint.ts): secure solo su https, dove localhost lo scarterebbe. */
export function opzioniVersione(baseURL: string): VersioneOptions {
  return { httpOnly: false, sameSite: 'lax', secure: baseURL.startsWith('https://'), path: '/', maxAge: VERSIONE_MAX_AGE }
}

export type CookieVersione = { name: string; value: string; options: VersioneOptions }

/**
 * Il Set-Cookie di una scelta: japan per 400 giorni; Global lo toglie
 * (valore vuoto e maxAge 0, con lo stesso path), perche' Global e' "nessun
 * cookie". Lo stesso per l'azione, l'hook di better-auth e /welcome.
 */
export function cookieVersione(v: Versione, baseURL: string): CookieVersione {
  const options = opzioniVersione(baseURL)
  return v === 'japan'
    ? { name: VERSIONE_COOKIE, value: 'japan', options }
    : { name: VERSIONE_COOKIE, value: '', options: { ...options, maxAge: 0 } }
}

/**
 * La versione da un header Cookie (o da document.cookie): Japan solo con
 * dts_version=japan esatto, come la regola di next.config.ts (il valore
 * vi e' ancorato: ^japan$). Con due cookie dallo stesso nome vale il
 * primo, come per il parser del routing.
 */
export function versioneDaCookie(header: string | null | undefined): Versione {
  if (!header) return 'global'
  for (const parte of header.split(';')) {
    const i = parte.indexOf('=')
    if (i < 0 || parte.slice(0, i).trim() !== VERSIONE_COOKIE) continue
    return parte.slice(i + 1).trim() === 'japan' ? 'japan' : 'global'
  }
  return 'global'
}

/**
 * Lo script sincrono del <head>, accanto a quello del tema: con il cookie
 * mette data-reg="japan" su <html> prima del primo paint, cosi'
 * l'interruttore e gli avvisi (CSS, variante japan:) non lampeggiano.
 * Legge e basta: non scrive mai il cookie, e non naviga (i redirect li fa
 * il routing). Lo stesso testo per tutti: l'HTML resta in cache.
 */
export function scriptVersione(): string {
  return `(function(){try{var m=/(?:^|;\\s*)${VERSIONE_COOKIE}=([^;]*)/.exec(document.cookie);` +
    `if(m&&m[1]==="japan")document.documentElement.setAttribute(${JSON.stringify(ATTRIBUTO_VERSIONE)},"japan")}catch(e){}})()`
}

/**
 * La lingua di una versione. Oggi l'inglese per entrambe: il giapponese
 * arrivera' sui percorsi /japan, che lo isolano gia' nella cache, e allora
 * japan diventa 'ja' qui (app_user.locale c'e' gia').
 */
const LOCALE: Record<Versione, 'en'> = { global: 'en', japan: 'en' }
export const localeDi = (v: Versione) => LOCALE[v]

// ---------------------------------------------------------------------
//  Lo specchio dei redirect di next.config.ts
// ---------------------------------------------------------------------

/** Un percorso del sito: una barra sola in testa (non //host ne' /\host), al massimo 2048 caratteri. */
const HREF_MAX = 2048
const interno = (href: string) => href.length <= HREF_MAX && /^\/(?![/\\])/.test(href)

/**
 * Se la query dice gia' la versione: come il missing della regola, conta
 * un ?region= con un valore (vuoto non vale, ripetuto si'). Lo usa anche
 * l'interruttore (lib/versione/interruttore.ts).
 */
export function marcato(query: URLSearchParams): boolean {
  const r = query.getAll('region')
  return r.length > 1 || (r.length === 1 && r[0] !== '')
}

// Le regole di next.config.ts, nello stesso ordine. region: la
// destinazione aggiunge ?region=japan (la query di chi arriva passa).
//
// La i: il router di Next non distingue le maiuscole nei percorsi
// (experimental.caseSensitiveRoutes, false per difetto), quindi col
// cookie Japan anche /Events/5 o /events/5/T/4 prendono il 307. La
// destinazione e' scritta qui, minuscola, come quella della regola; la
// chiave della query invece conta com'e' (REGION non e' region), come nel
// missing della regola. Il test lo prova col router vero di Next.
const ID = '(\\d{1,18})'
const REGOLE: { da: RegExp; a: (m: RegExpExecArray) => string; region?: true }[] = [
  { da: /^\/$/, a: () => '/events/japan' },
  { da: /^\/events$/i, a: () => '/events/japan' },
  { da: new RegExp(`^/events/${ID}$`, 'i'), a: (m) => `/events/${m[1]}/japan` },
  { da: new RegExp(`^/events/${ID}/t/${ID}$`, 'i'), a: (m) => `/events/${m[1]}/japan/t/${m[2]}` },
  // la pagina no: la pagina n di una versione puo' non esserci nell'altra (404)
  { da: new RegExp(`^/events/${ID}/t/${ID}/p/(\\d{1,6})$`, 'i'), a: (m) => `/events/${m[1]}/japan/t/${m[2]}` },
  { da: /^\/events\/browse$/i, a: () => '/events/browse', region: true },
  { da: new RegExp(`^/events/${ID}/clears$`, 'i'), a: (m) => `/events/${m[1]}/clears`, region: true },
  { da: new RegExp(`^/events/${ID}/submit$`, 'i'), a: (m) => `/events/${m[1]}/submit`, region: true },
]

/**
 * Il percorso come lo legge il router prima delle regole. Due 308 suoi
 * vengono prima: le barre ripetute (e le \\) diventano una sola
 * (resolve-routes, normalizeRepeatedSlashes), poi quella in fondo va via
 * (la regola interna di trailingSlash: false, la prima dei redirect di
 * load-custom-routes). Col cookie Japan /events/5/ e /events//5 finiscono
 * cosi' su /events/5/japan, e lo specchio deve dire lo stesso. La radice
 * resta /.
 */
function comeIlRouter(path: string): string {
  const p = path.replace(/\\/g, '/').replace(/\/{2,}/g, '/')
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p
}

/**
 * Dove porta un href con la versione v: quello che farebbero i redirect di
 * next.config.ts, gia' risolto. Per Global lo stesso href.
 *
 * Serve alle Server Action: il redirect di un'azione prende la pagina di
 * destinazione passando dal routing (con i cookie della risposta), ma il
 * browser tiene l'URL scritto nell'azione (x-action-redirect). Un'azione
 * che porta a un URL non marcato mostrerebbe la pagina giapponese sotto
 * l'URL Global. Lo stesso per un percorso che il router pulisce prima
 * (le maiuscole, le barre doppie o in fondo): la destinazione e' sempre
 * quella pulita e minuscola. Per questo ogni redirect di un'azione passa
 * da qui, o da un URL gia' marcato (eventHref explicit, homeHref della
 * richiesta): un
 * test legge ogni file 'use server' col parser di TypeScript, e uno che
 * non sa leggere vuole il segno "// redirect-versione: <perche'>".
 */
export function seguiVersione(href: string, v: Versione): string {
  if (v !== 'japan' || !interno(href)) return href
  const h = href.indexOf('#')
  const frammento = h < 0 ? '' : href.slice(h)
  const senza = h < 0 ? href : href.slice(0, h)
  const q = senza.indexOf('?')
  const path = q < 0 ? senza : senza.slice(0, q)
  const search = q < 0 ? '' : senza.slice(q + 1)
  const query = new URLSearchParams(search)
  if (marcato(query)) return href
  const visto = comeIlRouter(path)
  for (const r of REGOLE) {
    const m = r.da.exec(visto)
    if (!m) continue
    const dest = r.a(m)
    if (!r.region) return `${dest}${search ? `?${search}` : ''}${frammento}`
    query.set('region', 'japan')
    return `${dest}?${query}${frammento}`
  }
  return href
}

// ---------------------------------------------------------------------
//  Il gemello: la stessa pagina nell'altra versione
// ---------------------------------------------------------------------

// L'ancora di una tip resta (le tip non hanno regione); quella di un clear
// no: il clear e' di una run sola, nell'altra versione non c'e'.
const ANCORA_TIP = /^#(tips|tip-[A-Za-z0-9-]{1,64})$/
const EVENTO = new RegExp(`^/events/${ID}(?:/(.*))?$`)
const CLEARS = new RegExp(`^/events/${ID}/clears$`)

/**
 * La stessa pagina nella versione to, per l'interruttore: dove andare dopo
 * il cambio, o null se la pagina e' la stessa per le due versioni (carte,
 * profili, Settings, le notifiche) o e' per utente (il builder, la
 * modifica: un team non salvato non si perde). Allora la pagina resta, e
 * cambia solo quello che segue l'attributo data-reg.
 *
 *   /events <-> /events/japan            le altre chiavi della query restano
 *   /events/<id>[/japan][/t/<tier>...]   eventHref della versione to: senza
 *                                        pagina (nell'altra puo' non esserci),
 *                                        senza ?region, senza #clear-N; #tips
 *                                        e #tip-N restano
 *   /events/browse?...                   la regione cambia, pagina 1 (senza
 *                                        altri filtri e' la home)
 *   /events/<id>/clears?...              la regione cambia, pagina 1
 *
 * L'uscita e' sempre costruita dai pezzi letti (mai l'input ricopiato):
 * nessun open redirect, e nessun URL che i redirect di to rimanderebbero
 * altrove.
 */
export function gemello(href: unknown, to: Versione): string | null {
  if (typeof href !== 'string' || !interno(href)) return null
  const base = 'http://gemello.invalid'
  let u: URL
  try {
    u = new URL(href, base)
  } catch {
    return null
  }
  if (u.origin !== base) return null
  const path = u.pathname
  const sp = u.searchParams

  if (path === '/events' || path === '/events/japan') {
    const resto = new URLSearchParams()
    for (const [k, val] of sp) if (k !== 'region' && k !== 'page') resto.append(k, val)
    const s = resto.toString()
    return `${homeHref(to)}${s ? `?${s}` : ''}`
  }

  if (path === '/events/browse') {
    const primo = (k: string) => sp.get(k) || null
    return browseHref({
      reg: to,
      kind: primo('type') as EventKind | null,
      status: primo('status') as Status | null,
      search: primo('q'),
    })
  }

  const c = CLEARS.exec(path)
  if (c) {
    const q = new URLSearchParams()
    if (to === 'japan') q.set('region', 'japan')
    for (const [k, val] of sp) if (k !== 'region' && k !== 'page') q.append(k, val)
    const s = q.toString()
    return `/events/${c[1]}/clears${s ? `?${s}` : ''}`
  }

  const e = EVENTO.exec(path)
  if (e) {
    const vista = parseEventView(e[2] === undefined ? [] : e[2].split('/'))
    if (!vista) return null
    const ancora = ANCORA_TIP.test(u.hash) ? u.hash : ''
    return eventHref({ id: e[1], reg: to, tier: vista.tier }) + ancora
  }
  return null
}
