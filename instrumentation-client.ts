import { ascoltaInstallazione } from '@/lib/pwa/installa'
import { registraServiceWorker, rimuoviServiceWorker } from '@/lib/pwa/registra'

// Gira nel browser prima dell'idratazione, su ogni pagina. Qui perche'
// beforeinstallprompt puo' arrivare prima che l'isola dell'invito esista,
// e la registrazione del service worker non dipende da nessuna pagina.
//
// Il service worker solo nei build di produzione: in next dev si toglie,
// cosi' non serve pagine offline mentre si sviluppa.
try {
  ascoltaInstallazione()
  if (process.env.NODE_ENV === 'production') registraServiceWorker(process.env.NEXT_PUBLIC_SW_VERSION ?? '0')
  else rimuoviServiceWorker()
} catch {
  // un browser senza matchMedia o addEventListener: niente PWA, il sito resta uguale
}
