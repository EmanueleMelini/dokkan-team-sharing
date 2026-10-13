import { VERSIONI, altraVersione, gemello, marcato, type Versione } from '@/lib/versione/versione'

// Le decisioni dell'interfaccia della versione del sito (lib/versione):
// l'interruttore del menu, dell'header e di Settings, il riallineamento
// con l'account (components/viewer/provider.tsx), gli avvisi sulle pagine
// dell'altra versione e i blocchi della pagina della carta.
//
// Modulo puro, senza React ne' Next: i componenti sono .tsx e i test
// (db/test/versione-ui.test.mts) non li possono importare, quindi tutto
// quello che decide qualcosa sta qui. Le parti per chi guarda arrivano
// solo dal CSS (la variante japan: di app/globals.css, sull'attributo
// data-reg che mette lo script del <head>): l'HTML delle pagine in cache
// resta uguale per tutti.

export const NOME_VERSIONE: Record<Versione, string> = { global: 'Global', japan: 'Japan' }

/** La pagina di un URL: quale versione mostra, e se e' l'URL a dirlo (marcata) o la scelta di chi guarda. */
export type PaginaVersione = { v: Versione; marcata: boolean }

const BASE = 'http://pagina.invalid'
const EVENTO_JP = /^\/events\/\d{1,18}\/japan(?:\/|$)/
// le sole pagine degli eventi che leggono ?region= (dinamiche)
const PER_QUERY = /^\/events\/(?:browse|\d{1,18}\/clears)$/

/**
 * La versione mostrata da un URL (percorso e query), o null per le pagine
 * uguali nelle due versioni (carte, profili, Settings, notifiche) e per
 * quelle per utente (il builder, la modifica): le stesse di gemello().
 *
 *   /events/japan, /events/<id>/japan...      Japan, marcata dal percorso
 *   /events/browse, /events/<id>/clears       la ?region= che leggono
 *   /events, /events/<id>[/t/...]             Global: sono statiche e la
 *                                             query non la leggono (un
 *                                             ?region= le marca e basta)
 */
export function paginaDi(href: unknown): PaginaVersione | null {
  if (typeof href !== 'string' || gemello(href, 'global') === null) return null
  const u = new URL(href, BASE)
  if (u.pathname === '/events/japan' || EVENTO_JP.test(u.pathname)) return { v: 'japan', marcata: true }
  const v: Versione = PER_QUERY.test(u.pathname) && u.searchParams.get('region') === 'japan' ? 'japan' : 'global'
  return { v, marcata: marcato(u.searchParams) }
}

/**
 * La pagina da passare a setVersionAction (qui), o null se dopo il cambio
 * si resta dove si e'. Si va al gemello solo se la pagina e' dell'altra
 * versione: chi sta gia' guardando la versione scelta (un link marcato,
 * l'avviso "Use ... everywhere") resta li', con la sua pagina e il suo
 * #clear-N.
 *
 * riconcilia: il riallineamento con l'account, che chi guarda non ha
 * chiesto. Allora anche una pagina marcata resta (un link che dice la
 * versione vince sempre), e si sposta solo quella arrivata da un link
 * senza versione, che per definizione segue la scelta di chi guarda.
 */
export function quiPerCambio(qui: string, v: Versione, riconcilia = false): string | null {
  const p = paginaDi(qui)
  if (!p || p.v === v || (riconcilia && p.marcata)) return null
  return qui
}

/**
 * Il riallineamento del dispositivo con l'account: la versione da
 * rimettere, o null. Solo per un account completo (account e' undefined
 * altrimenti), mai mentre un cambio e' in corso (/api/me puo' essere di
 * prima) e una volta sola per scheda: se il cookie non resta (bloccato),
 * non si gira in tondo.
 */
export function versioneDaRiconciliare({ account, attuale, inCorso, fatta }: {
  account: Versione | null | undefined
  attuale: Versione
  inCorso: boolean
  fatta: boolean
}): Versione | null {
  if (!account || !VERSIONI.includes(account) || inCorso || fatta || account === attuale) return null
  return account
}

/** La chiave di sessionStorage del riallineamento: una volta per scheda, anche dopo un ricaricamento. */
export const CHIAVE_RIALLINEAMENTO = 'dts_version_sync'

/**
 * Se il rifiuto di una Server Action e' il suo redirect: Next rifiuta la
 * promessa con l'errore NEXT_REDIRECT (gia' gestito, la navigazione parte
 * da se'). Va preso e lasciato li': rilanciato, il router lo rivedrebbe e
 * navigherebbe una seconda volta. Lo stesso controllo di isRedirectError
 * di Next (il test li confronta).
 */
export function eRedirect(e: unknown): boolean {
  if (typeof e !== 'object' || e === null || typeof (e as { digest?: unknown }).digest !== 'string') return false
  // NEXT_REDIRECT;<replace|push>;<url>;<303|307|308>;
  const parti = (e as { digest: string }).digest.split(';')
  return parti[0] === 'NEXT_REDIRECT' && (parti[1] === 'replace' || parti[1] === 'push') &&
    ['303', '307', '308'].includes(parti.at(-2) ?? '')
}

/** Quello che dice lo sr-only dopo un cambio che non cambia pagina (la navigazione la annuncia Next). */
export const annuncioVersione = (v: Versione) => `${NOME_VERSIONE[v]} version on`

/** La riga di stato di Settings dopo un cambio: la versione, e dove e' rimasta la scelta. */
export const esitoVersione = (v: Versione, saved: 'account' | 'device') =>
  `${annuncioVersione(v)}. ${saved === 'account' ? 'Saved to your account.' : 'Saved on this device.'}`

/**
 * L'errore di un cambio non riuscito (la rete, un 500). Breve: in Settings
 * sta nella riga riservata all'esito, che a 320px ne tiene una sola (211px
 * a 12px, con l'icona 231 su 246), e nel burger nella cella dell'etichetta.
 */
export const ERRORE_VERSIONE = 'Couldn’t change the version. Try again.'

/**
 * "Use ... everywhere" dopo un errore: il bottone stesso dice di riprovare,
 * con l'icona, nel posto e nella larghezza che aveva (l'errore intero lo
 * sente il lettore di schermo). Piu' corto di tutti e due gli "Use ...".
 */
export const RIPROVA_VERSIONE = 'Try again'

// ---------------------------------------------------------------------
//  Gli avvisi sulle pagine
// ---------------------------------------------------------------------

/**
 * La classe che mostra un pezzo solo a chi guarda nella versione v: Global
 * e' la base (nessun attributo), japan: la sovrascrive. Con un solo pezzo
 * (una carta uscita in una versione sola) nessuna: si vede sempre.
 */
export function classeVersione(v: Versione, pezzi = 2): string {
  if (pezzi < 2) return ''
  return v === 'global' ? 'japan:hidden' : 'hidden japan:block'
}

/**
 * L'avviso su una pagina della versione reg, per chi ha scelto l'altra:
 * una pagina Japan lo mostra a chi e' su Global (japan:hidden), una Global
 * a chi e' su Japan (hidden japan:block). titolo e' la parte che conta
 * (in inchiostro), dettaglio la scelta di chi guarda.
 */
export function avvisoVersione(reg: Versione) {
  const altra = altraVersione(reg)
  return {
    classe: classeVersione(altra),
    titolo: `This is the ${NOME_VERSIONE[reg]} version.`,
    dettaglio: `Your site is set to ${NOME_VERSIONE[altra]}.`,
    link: `${NOME_VERSIONE[altra]} version of this page`,
    usa: `Use ${NOME_VERSIONE[reg]} everywhere`,
  }
}

/**
 * Un evento senza run in questa versione: lo diciamo senza affermare che
 * non e' uscito (puo' darsi che manchi solo la data nelle fonti). Japan ha
 * le date solo dal wiki, Global anche dal gioco. Nella pagina sta al posto
 * dello stato dell'evento, con la stessa forma: l'etichetta ("Ongoing",
 * qui "No Japan dates") e il dettaglio.
 */
export function senzaDate(reg: Versione): { etichetta: string; dettaglio: string } {
  const fonti = reg === 'japan' ? 'the wiki doesn’t list it' : 'neither the game data nor the wiki lists it'
  return { etichetta: `No ${NOME_VERSIONE[reg]} dates`, dettaglio: `It may not be out in this version yet, or ${fonti}.` }
}

/** Il link all'altra versione accanto a senzaDate, solo se li' l'evento ha una run. */
export const linkAltraVersione = (reg: Versione) => `${NOME_VERSIONE[altraVersione(reg)]} version of this event`

/**
 * Le versioni di cui la pagina della carta mostra i clear, nell'ordine
 * Global, Japan: quelle dove la carta e' uscita. Senza nessuna data,
 * Japan, come prima (una carta senza data Global non e' "su Global").
 */
export function versioniCarta(releases: readonly { reg: string }[]): Versione[] {
  const uscite = VERSIONI.filter((v) => releases.some((r) => r.reg === v))
  return uscite.length ? uscite : ['japan']
}
