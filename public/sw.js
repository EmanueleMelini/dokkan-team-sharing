// @ts-check
/// <reference lib="webworker" />

// Il service worker del sito, scritto a mano: URL fisso /sw.js, scope /.
// Lo registra instrumentation-client.ts, solo nei build di produzione.
//
// Fa due cose. Quando una navigazione non raggiunge la rete, mostra la
// pagina offline (public/offline.html, generata da scripts/brand). Non
// mette in cache nient'altro: niente pagine, niente chunk, niente API,
// niente immagini. Le pagine pubbliche le servono gia' la CDN e la cache
// HTTP, e quelle per utente non devono finire in una cache del dispositivo.
// Cosi' dopo un deploy non resta niente di vecchio, e un errore qui non
// puo' servire i dati di qualcuno a qualcun altro. E mostra le push del
// browser (in fondo al file), per chi le ha accese in Settings.
//
// Kill switch: se un giorno serve spegnerlo, si pubblica al suo posto un
// sw.js che all'install fa skipWaiting e all'activate cancella le cache
// dts-* e chiama self.registration.unregister(). L'URL e' fisso e senza
// cache HTTP (next.config.ts), quindi arriva a tutti al primo controllo.

const sw = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self))

// La versione arriva da ?v= (NEXT_PUBLIC_SW_VERSION, il commit del deploy):
// un URL diverso fa installare un worker nuovo a ogni deploy, che riprende
// la pagina offline aggiornata e butta le cache delle versioni prima.
const VERSIONE = new URL(sw.location.href).searchParams.get('v') || '0'
const PREFISSO = 'dts-'
const CACHE = `${PREFISSO}offline-${VERSIONE}`
const OFFLINE = '/offline.html'

/**
 * Se questa richiesta passa da qui. Solo le navigazioni GET dello stesso
 * sito, e mai /api/ (le callback OAuth e del magic link sono navigazioni:
 * devono arrivare al server una volta sola e cosi' come sono) ne' /admin.
 * Per tutto il resto non si chiama respondWith e decide il browser, come
 * se il service worker non ci fosse.
 * @param {Request} request
 */
function intercetta(request) {
  if (request.mode !== 'navigate' || request.method !== 'GET') return false
  const url = new URL(request.url)
  if (url.origin !== sw.location.origin) return false
  const p = url.pathname
  if (p.startsWith('/api/') || p === '/api') return false
  if (p === '/admin' || p.startsWith('/admin/')) return false
  return true
}

sw.addEventListener('install', (event) => {
  // cache: 'no-cache' riconvalida con il server: niente copia vecchia
  // dalla cache HTTP del browser.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.add(new Request(OFFLINE, { cache: 'no-cache' })))
      .then(() => sw.skipWaiting()),
  )
})

sw.addEventListener('activate', (event) => {
  // Solo le cache nostre (dts-*) delle altre versioni: localhost e'
  // condiviso con altri progetti, le loro cache non si toccano.
  event.waitUntil(
    caches
      .keys()
      .then((nomi) => Promise.all(nomi.filter((n) => n.startsWith(PREFISSO) && n !== CACHE).map((n) => caches.delete(n))))
      .then(() => sw.clients.claim()),
  )
})

sw.addEventListener('fetch', (event) => {
  if (!intercetta(event.request)) return
  // Sempre la rete, e la pagina offline solo se la rete manca (fetch
  // rifiuta solo per un errore di rete: un 404 o un 500 passano cosi'
  // come sono). Niente navigation preload: per una navigazione non
  // intercettata, come una callback OAuth, il browser potrebbe fare la
  // richiesta due volte.
  event.respondWith(
    fetch(event.request).catch(() =>
      caches.open(CACHE).then((c) => c.match(OFFLINE)).then((r) => r || Response.error()),
    ),
  )
})

// ---------------------------------------------------------------------
//  Le push del browser (fase 4)
//
//  Nessuno di questi gestori mette in cache qualcosa. Il testo arriva gia'
//  scritto dal server (lib/notify/payload.ts), cifrato fino al browser:
//  qui si controlla solo la forma e si mostra. Un payload che non si
//  capisce mostra una frase generica, perche' con userVisibleOnly ogni
//  push deve mostrare una notifica (altrimenti il browser lo fa da se', con
//  un testo suo, e alla lunga revoca l'iscrizione).
//
//  pushsubscriptionchange: nessun gestore, di proposito. Una rotta per
//  rinnovare l'iscrizione sarebbe una scrittura con i cookie fuori da una
//  Server Action. Il client risincronizza al massimo una volta al giorno e
//  a ogni visita di Settings; un'iscrizione scaduta la toglie il server al
//  primo 404 o 410, e l'utente la riaccende da Settings.
// ---------------------------------------------------------------------

/**
 * Il payload v1, lo stesso tipo PushPayload di lib/notify/payload.ts.
 * @typedef {{ v: 1, kind: string, title: string, body: string, url: string, tag: string, ts: number }} PushPayload
 */

const ICONA = '/pwa/icon-192.png'
const BADGE = '/pwa/badge-96.png'
const LISTA = '/notifications'
const GENERICA = { title: 'You have new activity', body: 'Open Dokkan Team Sharing to see it.', url: LISTA, tag: 'dts:generic', ts: 0 }

/**
 * Solo percorsi dello stesso sito: iniziano con '/' ma non con '//' ne'
 * con '/\' (che il parser degli URL leggerebbe come un altro host). Tutto
 * il resto porta alla lista delle notifiche.
 * @param {unknown} u
 */
function percorsoSicuro(u) {
  if (typeof u !== 'string' || !u.startsWith('/') || u.startsWith('//') || u.startsWith('/\\')) return LISTA
  try {
    const url = new URL(u, sw.location.origin)
    return url.origin === sw.location.origin ? url.pathname + url.search + url.hash : LISTA
  } catch {
    return LISTA
  }
}

/** @param {unknown} v @param {number} max */
const testo = (v, max) => (typeof v === 'string' && v.trim() !== '' && v.length <= max ? v : null)

/**
 * Il payload della push, o quello generico se non e' un v1 valido.
 * @param {{ json(): unknown } | null | undefined} data
 */
function leggiPush(data) {
  /** @type {Partial<PushPayload> | null} */
  let p = null
  try {
    p = data ? /** @type {Partial<PushPayload>} */ (data.json()) : null
  } catch {
    p = null
  }
  if (!p || typeof p !== 'object' || p.v !== 1) return GENERICA
  const title = testo(p.title, 200)
  if (!title) return GENERICA
  return {
    title,
    body: testo(p.body, 500) ?? '',
    url: percorsoSicuro(p.url),
    tag: testo(p.tag, 64) ?? GENERICA.tag,
    ts: typeof p.ts === 'number' && Number.isFinite(p.ts) ? p.ts : 0,
  }
}

sw.addEventListener('push', (event) => {
  const p = leggiPush(event.data)
  event.waitUntil(
    sw.registration.showNotification(p.title, {
      body: p.body,
      tag: p.tag,
      icon: ICONA,
      badge: BADGE,
      data: { url: p.url },
      ...(p.ts ? { timestamp: p.ts } : {}),
    }),
  )
})

// Il clic porta all'URL della notifica (/notifications/<id>, che la segna
// letta e reindirizza). Prima una finestra del sito gia' aperta e
// controllata da questo worker, portata in primo piano; se non c'e', o non
// si lascia navigare, una finestra nuova.
sw.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const dati = /** @type {{ url?: unknown } | null} */ (event.notification.data)
  const url = new URL(percorsoSicuro(dati && dati.url), sw.location.origin).href
  event.waitUntil(
    sw.clients.matchAll({ type: 'window' }).then(async (finestre) => {
      const f = finestre.find((c) => new URL(c.url).origin === sw.location.origin)
      if (f) {
        try {
          const c = await f.focus()
          if (await c.navigate(url)) return
        } catch {
          // una finestra che non si lascia navigare: se ne apre una nuova
        }
      }
      await sw.clients.openWindow(url)
    }),
  )
})
