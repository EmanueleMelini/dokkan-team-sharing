import { isIOS, isIOSSafari, isMobile, type Ambiente } from '@/lib/pwa/piattaforma'

// L'installazione nel browser: chi siamo (mobile, iOS, gia' installata),
// l'evento beforeinstallprompt di Chromium e la chiusura dell'invito.
// Solo nel browser, e senza React: lo importa anche
// instrumentation-client.ts, che gira prima dell'idratazione (Chromium puo'
// mandare beforeinstallprompt prima che l'isola dell'invito esista).

/** La chiave di localStorage: l'invito chiuso con la X non torna piu'. */
export const CHIUSO_KEY = 'dts:installa-chiuso'

type SceltaUtente = { outcome: 'accepted' | 'dismissed' }
type EventoInstalla = Event & { prompt(): Promise<void>; userChoice: Promise<SceltaUtente> }

export type Contesto = { mobile: boolean; ios: boolean; iosSafari: boolean; standalone: boolean }
export type StatoInstalla = { pronto: boolean; chiuso: boolean; installata: boolean }

function leggiAmbiente(): Ambiente {
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } }
  return {
    ua: nav.userAgent,
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    coarse: matchMedia('(pointer: coarse)').matches,
    latoCorto: Math.min(innerWidth, innerHeight),
    uaMobile: nav.userAgentData?.mobile,
  }
}

const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true

// Calcolato una volta per pagina: useSyncExternalStore vuole lo stesso
// oggetto finche' niente cambia, e il dispositivo non cambia.
let contesto: Contesto | null = null
export function leggiContesto(): Contesto {
  if (!contesto) {
    const a = leggiAmbiente()
    contesto = { mobile: isMobile(a), ios: isIOS(a), iosSafari: isIOSSafari(a), standalone: isStandalone() }
  }
  return contesto
}

function leggiChiuso(): boolean {
  try {
    return localStorage.getItem(CHIUSO_KEY) !== null
  } catch {
    return false
  }
}

let evento: EventoInstalla | null = null
let stato: StatoInstalla | null = null
const ascoltatori = new Set<() => void>()

function aggiorna(cambi: Partial<StatoInstalla>) {
  stato = { ...leggiStato(), ...cambi }
  ascoltatori.forEach((f) => f())
}

export function leggiStato(): StatoInstalla {
  if (!stato) stato = { pronto: evento !== null, chiuso: leggiChiuso(), installata: false }
  return stato
}

export function iscriviInstalla(f: () => void) {
  ascoltatori.add(f)
  return () => {
    ascoltatori.delete(f)
  }
}

/**
 * Da instrumentation-client.ts, una volta. preventDefault toglie la
 * mini-infobar di Chrome Android, ma solo dove il nostro invito la
 * sostituisce: su desktop, o dopo la X, il browser fa come sempre.
 */
export function ascoltaInstallazione() {
  addEventListener('beforeinstallprompt', (e) => {
    const c = leggiContesto()
    if (!c.mobile || c.standalone || leggiChiuso()) return
    e.preventDefault()
    evento = e as EventoInstalla
    aggiorna({ pronto: true })
  })
  addEventListener('appinstalled', () => {
    evento = null
    aggiorna({ pronto: false, installata: true })
  })
}

/** Il prompt di Chromium: si puo' usare una volta sola, poi l'evento non vale piu'. */
export async function installa(): Promise<void> {
  const e = evento
  if (!e) return
  evento = null
  aggiorna({ pronto: false })
  try {
    await e.prompt()
    await e.userChoice
  } catch {
    // il browser l'ha gia' usato o rifiutato: l'invito resta nascosto per questa pagina
  }
}

/** La X: l'invito non torna piu' su questo dispositivo. */
export function chiudiInvito() {
  try {
    localStorage.setItem(CHIUSO_KEY, new Date().toISOString())
  } catch {
    // senza localStorage vale fino al prossimo caricamento
  }
  evento = null
  aggiorna({ pronto: false, chiuso: true })
}
