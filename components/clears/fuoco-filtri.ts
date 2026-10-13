/*
 * Il primo filtro scelto sulla pagina statica del tier porta a
 * /events/<id>/clears (e togliere l'ultimo riporta indietro): e' un'altra
 * route, la barra si rimonta e il focus finirebbe sul <body>, con il
 * popover chiuso e il pannello di nuovo chiuso. Prima di andare la barra
 * lascia qui quale controllo aveva il focus; la barra della pagina d'arrivo
 * lo riprende al montaggio. Sta in sessionStorage (solo questa scheda,
 * niente nell'URL) e vale una volta sola, per pochi secondi e solo
 * sull'URL per cui e' stato scritto.
 *
 * Una scelta fatta col Tab (un menu aperto, la voce raggiunta con le
 * frecce, Tab) arriva mentre il focus e' ancora sul menu, e il Tab lo
 * porta avanti subito dopo: il segno dice anche il verso, e all'arrivo il
 * focus va al controllo dopo (o prima, con Maiuscolo) quello del segno,
 * come col Tab sulla pagina di prima. Anche fuori dalla barra: dopo Sort
 * viene la lista.
 */

const CHIAVE = 'dokkan:fuoco-filtri'
const VALIDO_MS = 10_000

export type Segno = {
  /** il data-fuoco del controllo che aveva il focus */
  campo: string
  /** il pannello dei filtri era aperto (sotto md) */
  aperta: boolean
  /** la scelta e' arrivata con Tab (1) o Maiuscolo+Tab (-1): il focus va oltre il controllo */
  tab?: 1 | -1
}

const qui = () => window.location.pathname + window.location.search

export function lasciaSegno(url: string, segno: Segno) {
  try {
    const dove = new URL(url, window.location.href)
    sessionStorage.setItem(CHIAVE, JSON.stringify({ ...segno, dove: dove.pathname + dove.search, t: Date.now() }))
  } catch {
    // Senza storage si perde solo il focus, come prima
  }
}

/** Legge e consuma il segno, se e' per questa pagina e recente. */
export function prendiSegno(): Segno | null {
  try {
    const grezzo = sessionStorage.getItem(CHIAVE)
    if (!grezzo) return null
    sessionStorage.removeItem(CHIAVE)
    const s = JSON.parse(grezzo) as Partial<Segno> & { dove?: unknown; t?: unknown }
    if (s.dove !== qui() || typeof s.t !== 'number' || Date.now() - s.t > VALIDO_MS) return null
    if (typeof s.campo !== 'string' || !s.campo) return null
    return { campo: s.campo, aperta: s.aperta === true, ...(s.tab === 1 || s.tab === -1 ? { tab: s.tab } : {}) }
  } catch {
    return null
  }
}

/** Il data-fuoco dell'elemento attivo, se sta dentro la barra. */
export function campoAttivo(barra: HTMLElement | null): string | null {
  const a = document.activeElement
  if (!barra || !(a instanceof HTMLElement) || !barra.contains(a)) return null
  return a.closest<HTMLElement>('[data-fuoco]')?.dataset.fuoco ?? null
}

// Quello che il Tab puo' raggiungere; tabulabile() toglie il resto
const FOCUSABILI = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]'

/** Raggiungibile col Tab: niente tabindex negativo, disabilitato, inerte o che non si vede (un <details> chiuso, <Activity>). */
function tabulabile(el: HTMLElement): boolean {
  if (el.tabIndex < 0 || el.matches(':disabled') || el.closest('[inert]')) return false
  return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'
}

/** Il controllo che il Tab raggiunge da el, avanti (1) o indietro (-1), nell'ordine della pagina. */
export function accanto(el: HTMLElement, verso: 1 | -1): HTMLElement | null {
  const tutti = [...document.querySelectorAll<HTMLElement>(FOCUSABILI)]
  const lato = verso === 1 ? Node.DOCUMENT_POSITION_FOLLOWING : Node.DOCUMENT_POSITION_PRECEDING
  const candidati = tutti.filter((x) => x !== el && !el.contains(x) && !x.contains(el) && (el.compareDocumentPosition(x) & lato) !== 0)
  if (verso === -1) candidati.reverse()
  return candidati.find(tabulabile) ?? null
}

/**
 * Rimette il focus sul controllo; se sta in un <details> lo riapre. Con
 * tab, sul controllo che il Tab raggiunge da li': se non ce n'e', sul
 * controllo stesso.
 */
export function rimettiFuoco(barra: HTMLElement | null, campo: string, tab?: 1 | -1): boolean {
  if (!barra) return false
  const el = barra.querySelector<HTMLElement>(`[data-fuoco="${CSS.escape(campo)}"]`)
  if (!el) return false
  const d = el.closest('details')
  if (d && !d.open && el.tagName !== 'SUMMARY') d.open = true
  const dove = (tab && accanto(el, tab)) || el
  dove.focus()
  return document.activeElement === dove
}
