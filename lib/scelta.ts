// I menu a scelta del sito (components/scelta): le opzioni, la ricerca
// mentre si scrive, i testi e dove si apre l'elenco. Modulo puro, senza
// React ne' DOM: lo usano il componente, le liste dei chiamanti
// (lib/clears/filtri-opzioni.ts, lib/clears/builder-opzioni.ts) e il test
// (db/test/scelta.test.mts).

/** Una voce del menu. */
export type Opzione = {
  /** esattamente il value dell'<option> di prima: va nell'URL e nello stato cosi' com'e' */
  valore: string
  /** il testo del campo e la prima riga della voce */
  testo: string
  /** la seconda riga (l'epiteto di una carta): si cerca anche li' */
  dettaglio?: string
  /** a destra nella riga, per esempio "12" o "0 here": non si cerca */
  nota?: string
  /** la nota per i lettori di schermo, se quella scritta non basta ("12 clears") */
  notaSr?: string
  /** AGL ... PHY: un quadratino del colore del tipo davanti al testo */
  tipo?: string
  /** altre parole che la ricerca trova, mai mostrate */
  cerca?: string
}

/** Fino a qui niente tastiera sul telefono: si sceglie col dito (inputMode none). */
export const SOGLIA_TASTIERA = 12
/** Oltre qui l'elenco e' virtuale: nel DOM solo le righe visibili. */
export const SOGLIA_VIRTUALE = 50
/** L'altezza massima dell'elenco, in px (18rem). */
export const ALTEZZA_MAX = 288
/** Sotto il campo deve starci almeno questo numero di righe, se no si apre sopra. */
export const RIGHE_MIN = 4
/** Lo spazio fra l'elenco e il bordo di quello che si vede, in px. */
export const MARGINE = 8
/** L'altezza di una riga: 44px col dito (il bersaglio di WCAG 2.5.5), 32px col mouse. */
export const RIGA_TOCCO = 44
export const RIGA_MOUSE = 32
/** Lo stacco fra campo ed elenco (mt-1) piu' i due bordi del pannello, in px. */
export const STACCO = 6

/** Gli spazi come li mostra un <option>: a capo e spazi doppi diventano uno spazio. */
export const spazi = (s: string) => s.replace(/\s+/g, ' ').trim()

/**
 * Il testo per confrontare: senza accenti, minuscolo, gli spazi come
 * sopra. NFKD porta anche le lettere a tutta larghezza alla loro forma
 * semplice (Ｇｏｋｕ = goku).
 */
export const normalizza = (s: string) =>
  spazi(s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase())

// Il testo in cui si cerca, una volta per opzione: le liste dei chiamanti
// sono memorizzate, quindi l'oggetto resta lo stesso fra un tasto e l'altro.
const pagliai = new WeakMap<Opzione, string>()
function pagliaio(o: Opzione): string {
  let p = pagliai.get(o)
  if (p === undefined) {
    p = normalizza([o.testo, o.dettaglio ?? '', o.cerca ?? ''].join(' '))
    pagliai.set(o, p)
  }
  return p
}

const lettera = /[\p{L}\p{N}]/u
/** La parola compare all'inizio di una parola del testo. */
function aInizio(testo: string, parola: string): boolean {
  for (let i = testo.indexOf(parola); i !== -1; i = testo.indexOf(parola, i + 1)) {
    if (i === 0 || !lettera.test(testo[i - 1])) return true
  }
  return false
}

/**
 * Le opzioni che contengono ogni parola scritta, in qualsiasi ordine, nel
 * testo, nel dettaglio o fra le parole nascoste (mai nella nota: un "12"
 * scritto non trova i clear contati 12). Prima quelle dove ogni parola
 * comincia una parola, poi le altre; dentro i due gruppi l'ordine resta
 * quello della lista. Senza parole torna la lista stessa.
 */
export function filtraOpzioni<T extends Opzione>(opzioni: readonly T[], q: string): readonly T[] {
  const parole = normalizza(q).split(' ').filter(Boolean)
  if (parole.length === 0) return opzioni
  const prima: T[] = []
  const dopo: T[] = []
  for (const o of opzioni) {
    const p = pagliaio(o)
    if (!parole.every((w) => p.includes(w))) continue
    if (parole.every((w) => aInizio(p, w))) prima.push(o)
    else dopo.push(o)
  }
  return [...prima, ...dopo]
}

/** Il testo del campo chiuso: "Goku, Ultra Instinct". */
export const testoCampo = (o: Opzione) =>
  o.dettaglio ? `${spazi(o.testo)}, ${spazi(o.dettaglio)}` : spazi(o.testo)

/** Il testo dell'<option> del menu nativo: quello di prima, con la nota fra parentesi. */
export const testoNativo = (o: Opzione) => (o.nota ? `${testoCampo(o)} (${o.nota})` : testoCampo(o))

/** L'opzione mostrata per un valore: la sua, o la prima (come fa un <select>). */
export function sceltaVisibile<T extends Opzione>(opzioni: readonly T[], valore: string): T | undefined {
  return opzioni.find((o) => o.valore === valore) ?? opzioni[0]
}

/**
 * Cosa arriva al chiamante da una scelta: null quando non c'e' niente da
 * dire. Headless UI manda null quando si svuota il campo per scrivere, e
 * il valore di prima quando si riprende la stessa voce; un valore che non
 * e' fra le opzioni non si accetta.
 */
export function valoreScelto(nuovo: string | null | undefined, attuale: string, opzioni: readonly Opzione[]): string | null {
  if (nuovo == null || nuovo === attuale) return null
  return opzioni.some((o) => o.valore === nuovo) ? nuovo : null
}

/**
 * La ricerca dal testo del campo dopo un tasto. intatto: da quando la
 * lista si e' chiusa non si e' ancora scritto, quindi il campo mostra la
 * voce scelta (mostrato), di solito selezionata, e il primo tasto la
 * sostituisce. Dove la selezione non c'e' (un clic dentro il testo, le
 * frecce, un focus che la perde) il tasto finirebbe in coda, e cercare
 * "Any leaderfri" non trova niente: conta solo quello aggiunto in fondo,
 * e il primo Backspace svuota il campo invece di togliere una lettera.
 */
export function ricercaScritta(campo: string, mostrato: string, intatto: boolean, cancella: boolean): string {
  if (!intatto || mostrato === '') return campo
  if (cancella) return ''
  return campo.length > mostrato.length && campo.startsWith(mostrato) ? campo.slice(mostrato.length) : campo
}

/**
 * Un gesto nel menu, per voceMossa: un tasto premuto nel campo (aperto:
 * l'elenco era gia' aperto), la ricerca che cambia, l'elenco che si chiude.
 */
export type Gesto =
  | { tasto: string; aperto: boolean; shift?: boolean }
  | { ricerca: string }
  | { chiuso: true }

/**
 * Se la voce attiva dell'elenco ce l'ha portata chi usa il menu con i
 * tasti. Le frecce la spostano, anche quella che apre l'elenco (freccia
 * su su un "Any" porta all'ultima voce); Home, End, PagSu e PagGiu solo a
 * elenco aperto (a elenco chiuso Home e End muovono il cursore nel
 * testo). Svuotare il campo, o chiudere l'elenco, la riporta dove la
 * mette Headless UI da se': si ricomincia da capo.
 */
export function voceMossa(prima: boolean, g: Gesto): boolean {
  if ('chiuso' in g) return false
  if ('ricerca' in g) return normalizza(g.ricerca) === '' ? false : prima
  switch (g.tasto) {
    case 'ArrowDown':
    case 'ArrowUp':
      return true
    case 'PageDown':
    case 'PageUp':
      return prima || g.aperto
    case 'Home':
    case 'End':
      return prima || (g.aperto && !g.shift)
    default:
      return prima
  }
}

/**
 * Se Invio o Tab, a elenco aperto, scelgono la voce attiva. Solo quando ce
 * l'ha portata chi usa il menu: con le frecce (mossa) o scrivendo una
 * ricerca, di cui la voce attiva e' la prima trovata. Altrimenti la voce
 * attiva e' quella che Headless UI evidenzia da se' (la prima dell'elenco
 * dopo un Backspace che svuota il campo), e Headless la sceglierebbe col
 * Tab: il <select> di prima non cambiava valore ne' con Backspace ne' con
 * Tab, e il menu nemmeno. Una scelta col clic o col dito passa sempre.
 */
export function sceltaDaTasto(mossa: boolean, ricerca: string | null): boolean {
  return mossa || (ricerca !== null && normalizza(ricerca) !== '')
}

/** La frase della regione live: niente finche' non si scrive. */
export function annuncioRisultati(n: number, q: string): string {
  if (!normalizza(q)) return ''
  if (n === 0) return 'No results'
  return n === 1 ? '1 result' : `${n} results`
}

/** Un rettangolo nelle coordinate della pagina visibile (getBoundingClientRect). */
export type Riquadro = { top: number; bottom: number; left: number; right: number }

/**
 * Quello che si vede, tolto cio' che sta fisso in fondo e copre la pagina
 * (l'invito a installare l'app): l'elenco si ferma sopra la sua cima, e
 * cosi' posizionePannello lo apre verso l'alto o lo accorcia. Conta solo
 * una copertura che comincia dentro quello che si vede: una che sta
 * sotto (dietro la tastiera del telefono), fuori di lato o alta 0 no.
 */
export function sopraLeCoperture(limite: Riquadro, coperture: readonly Riquadro[]): Riquadro {
  let bottom = limite.bottom
  for (const c of coperture) {
    if (c.bottom <= c.top || c.right <= c.left) continue
    if (c.right <= limite.left || c.left >= limite.right) continue
    if (c.top <= limite.top || c.top >= bottom) continue
    bottom = c.top
  }
  return { ...limite, bottom }
}

export type Posizione = {
  /** sotto il campo o sopra */
  verso: 'giu' | 'su'
  /** allineato al bordo sinistro del campo, o al destro (quando a sinistra uscirebbe) */
  lato: 'sinistra' | 'destra'
  /** px, per l'elenco (--scelta-max-h) */
  altezzaMax: number
  /** px, per il pannello (--scelta-max-w) */
  larghezzaMax: number
  /** ne' sopra ne' sotto ci stanno RIGHE_MIN righe (la tastiera): il campo va portato in alto */
  scorri: boolean
}

/**
 * Dove si apre l'elenco. campo: il riquadro del campo. limite: quello che
 * si vede davvero, cioe' il visualViewport (senza la tastiera del
 * telefono) intersecato con ogni antenato che taglia (il <dialog>, lo
 * scroller dell'editor della build). larghezza: quella che il pannello
 * vorrebbe; altezza: quella del suo contenuto; riga: l'altezza di una riga.
 *
 * Sotto, se ci stanno RIGHE_MIN righe (o tutto il contenuto, se e' meno);
 * altrimenti sopra, se li' c'e' piu' posto. L'altezza e' quella che resta
 * meno il margine, mai oltre ALTEZZA_MAX e mai meno di una riga. Verso
 * destra finche' ci sta, poi allineato al bordo destro del campo.
 */
export function posizionePannello({ campo, limite, larghezza, altezza = Infinity, riga = RIGA_TOCCO }: {
  campo: Riquadro
  limite: Riquadro
  larghezza: number
  altezza?: number
  riga?: number
}): Posizione {
  // lo spazio per l'elenco: tolti il margine, lo stacco dal campo e i bordi del pannello
  const sotto = limite.bottom - campo.bottom - MARGINE - STACCO
  const sopra = campo.top - limite.top - MARGINE - STACCO
  const serve = Math.min(RIGHE_MIN * riga, altezza)
  const verso = sotto >= serve || sotto >= sopra ? 'giu' : 'su'
  const spazio = verso === 'giu' ? sotto : sopra
  const altezzaMax = Math.max(riga, Math.min(ALTEZZA_MAX, Math.floor(spazio)))
  const scorri = sotto < serve && sopra < serve

  const aDestra = limite.right - MARGINE - campo.left
  const aSinistra = campo.right - (limite.left + MARGINE)
  const lato = larghezza <= aDestra || aDestra >= aSinistra ? 'sinistra' : 'destra'
  const larghezzaMax = Math.max(0, Math.floor(lato === 'sinistra' ? aDestra : aSinistra))
  return { verso, lato, altezzaMax, larghezzaMax, scorri }
}
