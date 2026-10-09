// @ts-check
/// <reference lib="webworker" />

// Il service worker del sito, scritto a mano: URL fisso /sw.js, scope /.
// Lo registra instrumentation-client.ts, solo nei build di produzione.
//
// Fa UNA cosa sola: quando una navigazione non raggiunge la rete, mostra la
// pagina offline (public/offline.html, generata da scripts/brand). Non
// mette in cache nient'altro: niente pagine, niente chunk, niente API,
// niente immagini. Le pagine pubbliche le servono gia' la CDN e la cache
// HTTP, e quelle per utente non devono finire in una cache del dispositivo.
// Cosi' dopo un deploy non resta niente di vecchio, e un errore qui non
// puo' servire i dati di qualcuno a qualcun altro.
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

// Fase 4 (notifiche push), qui:
// - 'push': legge il payload JSON v1 e chiama showNotification con icon
//   /pwa/icon-192.png e badge /pwa/badge-96.png;
// - 'notificationclick': mette a fuoco una finestra del sito o ne apre una;
// - 'pushsubscriptionchange': vedi il piano della fase 4.
// Nessuno dei tre deve mettere in cache qualcosa.
