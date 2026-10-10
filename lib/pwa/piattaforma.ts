// Che dispositivo e che browser: serve all'invito a installare e
// all'avviso di iOS. Modulo puro, senza 'use client' ne' accessi a window:
// lo legge lib/pwa/installa.ts nel browser e lo prova db/test/pwa.test.mts
// con user agent veri.

export type Ambiente = {
  /** navigator.userAgent */
  ua: string
  /** navigator.maxTouchPoints: l'iPad con iPadOS 13+ si presenta come un Mac */
  maxTouchPoints: number
  /** matchMedia('(pointer: coarse)'): il puntatore principale e' un dito */
  coarse: boolean
  /** il lato corto della finestra, in px CSS */
  latoCorto: number
  /** navigator.userAgentData?.mobile, dove c'e' (Chromium) */
  uaMobile?: boolean
}

// Sotto questa misura un dispositivo touch e' un telefono o un tablet
// piccolo. Un portatile touch col mouse ha il puntatore "fine".
const LATO_MOBILE = 820

export const isIOS = (a: Ambiente) =>
  /iPhone|iPad|iPod/.test(a.ua) || (/Macintosh/.test(a.ua) && a.maxTouchPoints > 1)

// I browser di iOS che non sono Safari (tutti WebKit, ma con un token loro)
// e le webview delle app (senza "Safari/" nello user agent). Dal 16.4 alcuni
// sanno aggiungere alla Home, ma con passi diversi: l'invito si limita a
// Safari, dove la frase "Share, then Add to Home Screen" e' giusta.
const NON_SAFARI = /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|YaBrowser|DuckDuckGo|FBAN|FBAV|Instagram|Line\/|Twitter|MicroMessenger|Snapchat|TikTok|musical_ly|Pinterest/

export const isIOSSafari = (a: Ambiente) => isIOS(a) && /Safari\//.test(a.ua) && !NON_SAFARI.test(a.ua)

/** Telefono o tablet: puntatore touch su uno schermo piccolo, o uno user agent mobile. */
export const isMobile = (a: Ambiente) =>
  (a.coarse && a.latoCorto <= LATO_MOBILE) ||
  a.uaMobile === true ||
  /Android|iPhone|iPad|iPod|Mobile/.test(a.ua) ||
  isIOS(a)

/** Le rotte dove l'invito non compare: accesso, scelta dell'handle, area admin. */
export const rottaSenzaInvito = (pathname: string) =>
  ['/login', '/welcome', '/admin'].some((r) => pathname === r || pathname.startsWith(`${r}/`))

/**
 * Il nome grossolano di un dispositivo per la lista delle push in Settings
 * ("Chrome on Android"): browser e sistema, mai la versione o il modello.
 * Va nel database (push_subscription.label), quindi meno dice meglio e':
 * basta a riconoscere i propri dispositivi. null se non si capisce.
 */
export function etichettaDispositivo(a: Pick<Ambiente, 'ua' | 'maxTouchPoints'>): string | null {
  const ua = a.ua
  // l'ordine conta: Edge e Opera dicono anche "Chrome", Chrome dice anche "Safari"
  const browser =
    /EdgA?\/|EdgiOS\//.test(ua) ? 'Edge'
      : /OPR\/|OPiOS\//.test(ua) ? 'Opera'
        : /SamsungBrowser\//.test(ua) ? 'Samsung Internet'
          : /Firefox\/|FxiOS\//.test(ua) ? 'Firefox'
            : /Chrome\/|CriOS\//.test(ua) ? 'Chrome'
              : /Safari\//.test(ua) && /Version\//.test(ua) ? 'Safari'
                : null
  const sistema =
    /Android/.test(ua) ? 'Android'
      : /iPhone|iPod/.test(ua) ? 'iPhone'
        : /iPad/.test(ua) || (/Macintosh/.test(ua) && a.maxTouchPoints > 1) ? 'iPad'
          : /CrOS/.test(ua) ? 'ChromeOS'
            : /Windows/.test(ua) ? 'Windows'
              : /Macintosh|Mac OS X/.test(ua) ? 'macOS'
                : /Linux/.test(ua) ? 'Linux'
                  : null
  if (browser && sistema) return `${browser} on ${sistema}`
  return browser ?? (sistema ? `Browser on ${sistema}` : null)
}
