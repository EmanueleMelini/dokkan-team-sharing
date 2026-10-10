// La registrazione del service worker (public/sw.js), da
// instrumentation-client.ts. Solo nel browser.

const SCRIPT = '/sw.js'
// Le cache del nostro worker: le stesse che public/sw.js crea e pulisce.
const PREFISSO_CACHE = 'dts-'

/**
 * Nei build di produzione. Dopo il load e quando il browser e' libero:
 * l'installazione scarica /offline.html, e non deve competere con la
 * pagina. updateViaCache 'none': il browser chiede sempre sw.js al server.
 */
export function registraServiceWorker(versione: string) {
  if (!('serviceWorker' in navigator)) return
  const registra = () => {
    navigator.serviceWorker
      .register(`${SCRIPT}?v=${encodeURIComponent(versione)}`, { scope: '/', updateViaCache: 'none' })
      .catch(() => {
        // senza service worker il sito funziona uguale: manca solo la pagina offline
      })
  }
  const quandoLibero = () =>
    'requestIdleCallback' in window ? requestIdleCallback(registra, { timeout: 5000 }) : setTimeout(registra, 1000)
  if (document.readyState === 'complete') quandoLibero()
  else addEventListener('load', quandoLibero, { once: true })
}

/**
 * In next dev il worker non serve e darebbe fastidio (localhost:3000 e'
 * condiviso con altri progetti, e un build di prova con next start puo'
 * averlo lasciato qui): si toglie il nostro, con le sue cache, e basta.
 */
export function rimuoviServiceWorker() {
  if (!('serviceWorker' in navigator)) return
  navigator.serviceWorker
    .getRegistrations()
    .then((regs) =>
      Promise.all(
        regs
          .filter((r) => {
            const url = (r.active ?? r.waiting ?? r.installing)?.scriptURL
            return url !== undefined && new URL(url).pathname === SCRIPT
          })
          .map((r) => r.unregister()),
      ),
    )
    .then(() => ('caches' in window ? caches.keys() : []))
    .then((nomi) => Promise.all(nomi.filter((n) => n.startsWith(PREFISSO_CACHE)).map((n) => caches.delete(n))))
    .catch(() => {})
}

/**
 * La registrazione del nostro worker per le push (Settings, al clic su
 * "Turn on"): quella che c'e', o una nuova se il caricamento della pagina
 * non l'ha ancora fatta (registraServiceWorker aspetta che il browser sia
 * libero). null in next dev, dove il worker non c'e' di proposito, o se il
 * browser non lo ammette. Aspetta che sia attivo, al massimo 10 s.
 */
export async function assicuraServiceWorker(versione: string): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator) || process.env.NODE_ENV !== 'production') return null
  try {
    const reg = (await navigator.serviceWorker.getRegistration('/')) ??
      (await navigator.serviceWorker.register(`${SCRIPT}?v=${encodeURIComponent(versione)}`, { scope: '/', updateViaCache: 'none' }))
    if (reg.active) return reg
    const pronta = navigator.serviceWorker.ready
    const tempo = new Promise<null>((r) => setTimeout(() => r(null), 10_000))
    return await Promise.race([pronta, tempo])
  } catch {
    return null
  }
}
