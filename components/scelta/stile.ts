// Le classi dei menu a scelta, in un posto solo per le due forme: il
// <select> nativo dell'HTML del server (scelta-nativa.tsx) e il combobox
// che lo sostituisce dopo l'idratazione (scelta-elenco.tsx). La scatola,
// il valore e la freccia sono gli stessi, quindi il cambio non sposta
// niente. Solo token dei temi: valgono in tutti e 11, e anche con japan:.
//
// L'aspetto e' quello dei campi del sito (la ricerca di /events): bordo
// campo su superficie, il raggio unico, l'anello d'oro sulla scatola.
// L'anello lo disegna la scatola (has-[:focus-visible]) e non il campo
// vero, che sta dentro: .scelta-campo in app/globals.css gli toglie il suo.

export type Misura = 'normale' | 'compatta'

/**
 * Le misure col dito di un campo: 44px di altezza (il bersaglio di WCAG
 * 2.5.5) e 16px di testo, sotto i quali Safari su iOS ingrandisce la
 * pagina al focus. Le hanno i menu (SCATOLA_BASE) e i campi di testo
 * delle stesse righe e degli stessi form: la ricerca di /events, che e' il
 * modello dei menu, quella del picker delle carte e di "Uses card", i
 * campi del builder. Col mouse restano i 34px e 13px del sito; col dito
 * una riga ha un'altezza sola e le etichette sopra stanno in fila.
 */
export const CAMPO_DITO = 'pointer-coarse:min-h-11 pointer-coarse:text-base pointer-coarse:leading-6'
/** Un bottone in una riga di campi: alto uguale col dito, con i 15px delle pillole dei filtri. */
export const BOTTONE_DITO = 'pointer-coarse:min-h-11 pointer-coarse:text-[15px]'

/**
 * La scatola: bordo, fondo, il testo del valore, l'anello del focus. 44px
 * col dito. Al passaggio e aperta il bordo si fa piu' forte (tenue), mai
 * piu' debole di campo, il bordo da 3:1 dei campi (WCAG 1.4.11).
 */
export const SCATOLA: Record<Misura, string> = {
  normale: 'min-h-8 text-[13px] leading-5',
  compatta: 'min-h-7 text-[12px] leading-4',
}
export const SCATOLA_BASE =
  'relative flex items-center rounded-[var(--raggio)] border border-campo bg-superficie text-inchiostro scroll-mt-2 ' +
  `${CAMPO_DITO} ` +
  'hover:border-tenue data-open:border-tenue ' +
  'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-oro ' +
  'has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60'

/** Il valore scritto: sta nel flusso, va a capo e da' l'altezza alla scatola. */
export const VALORE: Record<Misura, string> = {
  normale: 'py-1.5 pl-2.5 pr-8',
  compatta: 'py-1 pl-2 pr-7',
}
export const VALORE_BASE = 'block min-w-0 flex-1 [overflow-wrap:anywhere]'

/** Il campo vero (il <select>, o l'<input> del combobox): sopra il valore, con lo stesso testo. */
export const CAMPO: Record<Misura, string> = {
  normale: 'pl-2.5 pr-8',
  compatta: 'pl-2 pr-7',
}
export const CAMPO_BASE = 'scelta-campo absolute inset-0 size-full min-w-0 rounded-[inherit] bg-transparent'

/** La freccia a destra, che non prende i clic. */
export const FRECCIA: Record<Misura, string> = {
  normale: 'right-2.5',
  compatta: 'right-2',
}
export const FRECCIA_BASE = 'pointer-events-none absolute top-1/2 -translate-y-1/2 text-tenue'

/** Il pannello sotto (o sopra) il campo, come il popover di "Uses card" accanto. */
// (-1px e +2px: il pannello si allinea al bordo della scatola, non al suo
// interno; z-50: sopra l'invito a installare l'app, z-40, se compare
// mentre l'elenco e' aperto. Di solito l'elenco si ferma sopra, limiteVisibile)
export const PANNELLO =
  'absolute -left-px top-full z-50 mt-1 min-w-[calc(100%+2px)] rounded-[var(--raggio)] border border-linea-forte bg-superficie shadow-lg ' +
  'data-[verso=su]:top-auto data-[verso=su]:bottom-full data-[verso=su]:mt-0 data-[verso=su]:mb-1 ' +
  'data-[lato=destra]:left-auto data-[lato=destra]:-right-px'
/** Largo quanto il contenuto, fino a 24rem; quello virtuale non ha una larghezza sua (le righe sono assolute). */
export const PANNELLO_LARGO = 'w-max max-w-[min(24rem,var(--scelta-max-w,24rem))]'
export const PANNELLO_VIRTUALE = 'w-[max(calc(100%+2px),22rem)] max-w-[var(--scelta-max-w,22rem)]'

/** L'elenco: scorre dentro il pannello, alto quanto c'e' posto (lib/scelta.ts posizionePannello). */
export const ELENCO =
  'max-h-[var(--scelta-max-h,18rem)] overflow-y-auto overscroll-contain rounded-[calc(var(--raggio)-1px)] outline-none'
/**
 * L'elenco virtuale ha bisogno di un'altezza prima delle righe: il
 * virtualizer di Headless (TanStack) non ne disegna nessuna in uno
 * scroller alto 0. Almeno quanto le voci filtrate (--scelta-n) per una
 * riga, mai oltre il massimo; poi cresce con le righe misurate.
 */
export const ELENCO_VIRTUALE =
  'min-h-[min(var(--scelta-max-h,18rem),calc(var(--scelta-n)*2rem))] ' +
  'pointer-coarse:min-h-[min(var(--scelta-max-h,18rem),calc(var(--scelta-n)*2.75rem))]'

/**
 * Una voce. Le righe non sono scatole (il raggio unico): le separa una
 * linea. 32px col mouse, 44px e 15px col dito, come le righe del burger.
 * Quella attiva (frecce o mouse) ha il fondo superficie-2 e una barra
 * d'oro a sinistra, che si vede anche dove il fondo si distingue poco;
 * con i colori forzati il pieno di sistema delle selezioni, come
 * l'interruttore della versione. Quella scelta e' in grassetto, con la
 * spunta.
 */
export const RIGA =
  'group/riga flex w-full min-h-8 cursor-default select-none items-center gap-2 border-b border-linea px-2.5 py-1.5 ' +
  'text-left text-[13px] leading-5 text-testo last:border-b-0 ' +
  'pointer-coarse:min-h-11 pointer-coarse:text-[15px] pointer-coarse:leading-6 ' +
  'data-focus:bg-superficie-2 data-focus:text-inchiostro data-focus:shadow-[inset_2px_0_0_var(--oro)] ' +
  'data-selected:font-medium data-selected:text-inchiostro ' +
  'forced-colors:data-focus:bg-[color:Highlight] forced-colors:data-focus:text-[color:HighlightText] forced-colors:data-focus:forced-color-adjust-none'
export const RIGA_TESTO = 'min-w-0 flex-1 [overflow-wrap:anywhere]'
// forced-color-adjust: none passa ai figli: sul pieno di sistema anche
// epiteto, conteggio e spunta prendono HighlightText, se no resterebbero tenui
const SUL_PIENO = 'forced-colors:group-data-focus/riga:text-[color:HighlightText]'
export const RIGA_DETTAGLIO = `block text-[11px] leading-4 font-normal text-tenue pointer-coarse:text-[13px] pointer-coarse:leading-5 ${SUL_PIENO}`
export const RIGA_NOTA = `numeri shrink-0 text-[11px] font-normal text-tenue pointer-coarse:text-[13px] ${SUL_PIENO}`
export const RIGA_SPUNTA = `shrink-0 text-oro invisible group-data-selected/riga:visible ${SUL_PIENO}`
export const VUOTO = 'px-2.5 py-3 text-[12px] text-tenue pointer-coarse:text-[14px]'

/** Il quadratino del tipo, davanti a "Mono AGL" e ai tipi del picker. */
export const PUNTO_BASE = 'size-2 shrink-0 rounded-[2px]'
export const PUNTO: Record<string, string> = {
  AGL: 'bg-agl', TEQ: 'bg-teq', INT: 'bg-int', STR: 'bg-str', PHY: 'bg-phy',
}
