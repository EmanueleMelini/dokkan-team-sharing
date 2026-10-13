import { useSyncExternalStore } from 'react'
import { CHIAVE_RIALLINEAMENTO } from '@/lib/versione/interruttore'
import { ATTRIBUTO_VERSIONE, versioneDaCookie, type Versione } from '@/lib/versione/versione'

// La versione del sito nel browser, per le isole client (l'interruttore,
// il burger, il provider): lo stato vero e' l'attributo data-reg di <html>,
// che lo script del <head> mette dal cookie prima del primo paint. Come
// lib/tema/client.ts, ma il cookie qui non si scrive mai: lo scrive solo il
// server (setVersionAction), perche' Safari terrebbe 7 giorni un cookie
// scritto da document.cookie.

const ascoltatori = new Set<() => void>()
const avvisa = () => ascoltatori.forEach((f) => f())

/** La versione applicata ora; senza attributo e' Global. */
export function versioneAttuale(): Versione {
  return document.documentElement.getAttribute(ATTRIBUTO_VERSIONE) === 'japan' ? 'japan' : 'global'
}

/**
 * Mette (o toglie) l'attributo, come lo script del <head>. Da chiamare
 * quando l'azione ha risposto, non prima: la pagina di adesso non deve
 * mostrare per un attimo l'avviso "il sito e' impostato sull'altra".
 */
export function applicaVersione(v: Versione) {
  const root = document.documentElement
  if (v === 'japan') root.setAttribute(ATTRIBUTO_VERSIONE, 'japan')
  else root.removeAttribute(ATTRIBUTO_VERSIONE)
  avvisa()
}

/**
 * Rilegge il cookie e riallinea l'attributo: dopo il cambio di questa
 * scheda (SeguiVersione, al cambio di URL), un cambio fatto in un'altra
 * scheda, una pagina tornata dalla bfcache con l'attributo di prima.
 * true se l'attributo e' cambiato.
 */
export function rileggiVersione(): boolean {
  let v: Versione
  try {
    v = versioneDaCookie(document.cookie)
  } catch {
    return false // cookie illeggibili: resta quello che ha messo lo script
  }
  if (v === versioneAttuale()) return false
  applicaVersione(v)
  return true
}

// Un cambio arrivato da fuori: la scheda torna visibile, o la pagina torna
// dalla bfcache, e il cookie non e' piu' quello di prima. La cache del
// router di questa scheda ha ancora le pagine della versione vecchia, e un
// link senza versione le mostrerebbe senza chiedere niente al server (il
// 307 di next.config.ts non arriverebbe mai): SeguiVersione la butta.
const fuori = new Set<(v: Versione) => void>()

const daFuori = () => {
  if (rileggiVersione()) {
    const v = versioneAttuale()
    fuori.forEach((f) => f(v))
  }
}
const seVisibile = () => {
  if (document.visibilityState === 'visible') daFuori()
}

// Un solo paio di listener per la pagina, finche' qualcuno ascolta
let iscritti = 0
function ascolta(): () => void {
  if (iscritti++ === 0) {
    document.addEventListener('visibilitychange', seVisibile)
    window.addEventListener('pageshow', daFuori)
  }
  return () => {
    if (--iscritti === 0) {
      document.removeEventListener('visibilitychange', seVisibile)
      window.removeEventListener('pageshow', daFuori)
    }
  }
}

function iscrivi(f: () => void) {
  ascoltatori.add(f)
  const smetti = ascolta()
  return () => {
    ascoltatori.delete(f)
    smetti()
  }
}

/**
 * Se nella pagina c'e' un testo scritto e non ancora inviato (un commento,
 * una tip, una ricerca): un cambio fatto in un'altra scheda non deve
 * portarla altrove e farlo perdere.
 */
export function testoNonInviato(): boolean {
  return [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('main textarea, main input:not([type]), main input[type="text"], main input[type="search"]')]
    .some((c) => c.value !== c.defaultValue)
}

/** Per SeguiVersione: f(v) a ogni cambio arrivato da fuori (un'altra scheda, la bfcache). */
export function alCambioDaFuori(f: (v: Versione) => void): () => void {
  fuori.add(f)
  const smetti = ascolta()
  return () => {
    fuori.delete(f)
    smetti()
  }
}

/**
 * La versione applicata, per i controlli (aria-pressed, il tag JP). Sul
 * server e durante l'idratazione e' null (sconosciuta): l'HTML resta
 * uguale per tutti, e lo stato visibile prima dell'idratazione lo da' il
 * CSS (variante japan:).
 */
export const useVersione = (): Versione | null => useSyncExternalStore(iscrivi, versioneAttuale, () => null)

// ---------------------------------------------------------------------
//  L'annuncio per i lettori di schermo
// ---------------------------------------------------------------------

// Uno solo per la pagina (SeguiVersione, nel layout), fuori dai controlli:
// l'avviso "Use ... everywhere" sparisce col CSS appena la versione
// cambia, e il pannello del burger si chiude, con dentro le loro regioni
// live. n cambia a ogni annuncio, cosi' anche la stessa frase si ripete.
export type AnnuncioVersione = { testo: string; n: number }
const NESSUN_ANNUNCIO: AnnuncioVersione = { testo: '', n: 0 }
let annuncio = NESSUN_ANNUNCIO
const ascoltatoriAnnuncio = new Set<() => void>()

/** Dopo un cambio che non cambia pagina: la navigazione al gemello la annuncia gia' Next. */
export function annunciaVersione(testo: string) {
  annuncio = { testo, n: annuncio.n + 1 }
  ascoltatoriAnnuncio.forEach((f) => f())
}

const iscriviAnnuncio = (f: () => void) => {
  ascoltatoriAnnuncio.add(f)
  return () => { ascoltatoriAnnuncio.delete(f) }
}

export const useAnnuncioVersione = (): AnnuncioVersione =>
  useSyncExternalStore(iscriviAnnuncio, () => annuncio, () => NESSUN_ANNUNCIO)

// ---------------------------------------------------------------------
//  Il riallineamento con l'account, una volta per scheda
// ---------------------------------------------------------------------

// Un flag del modulo e sessionStorage: il primo regge anche senza storage
// (navigazione privata), il secondo anche dopo un ricaricamento. Una
// scelta fatta in questa scheda vale come riallineamento: da li' in poi
// vince quella.
let riallineata = false

export function riallineamentoFatto(): boolean {
  if (riallineata) return true
  try {
    return sessionStorage.getItem(CHIAVE_RIALLINEAMENTO) === '1'
  } catch {
    return false
  }
}

export function segnaRiallineamento() {
  riallineata = true
  try {
    sessionStorage.setItem(CHIAVE_RIALLINEAMENTO, '1')
  } catch {
    // resta il flag del modulo: vale fino al prossimo caricamento
  }
}
