import type { MetadataRoute } from 'next'

// Il manifest della PWA, servito a /manifest.webmanifest. Non legge niente
// della richiesta, quindi e' statico: lo genera il build e lo serve la CDN.
// Next aggiunge da solo <link rel="manifest"> a ogni pagina.
//
// I colori sono il fondo del marchio (lo sfondo del tema Dark): servono
// solo allo splash di Android e al primo frame. Poi vince il theme-color
// della pagina, che segue il tema scelto (app/layout.tsx, lib/tema).
const FONDO = '#0f111d'

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Dokkan Team Sharing',
    short_name: 'dokkants',
    description:
      'For every Dokkan Battle event, the teams that actually cleared it, with their rotations and proof.',
    lang: 'en',
    dir: 'ltr',
    // Non /: e' un redirect (307) che l'app farebbe a ogni avvio
    start_url: '/events',
    scope: '/',
    display: 'standalone',
    theme_color: FONDO,
    background_color: FONDO,
    // Aprire l'app (o un link al sito, su Chromium) riusa la finestra aperta
    launch_handler: { client_mode: ['navigate-existing', 'auto'] },
    categories: ['games', 'entertainment'],
    prefer_related_applications: false,
    // Il menu della pressione lunga sull'icona (senza icone proprie: usa quella dell'app)
    shortcuts: [
      { name: 'Events', url: '/events' },
      { name: 'Settings', url: '/settings' },
    ],
    // Le PNG le genera scripts/brand (npm run brand) in public/pwa/
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/pwa/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/pwa/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
