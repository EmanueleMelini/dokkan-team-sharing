/*
 * Il primo filtro scelto sulla pagina statica del tier porta a
 * /events/<id>/clears (e togliere l'ultimo riporta indietro): e' un'altra
 * route, la barra si rimonta e il focus finirebbe sul <body>, con il
 * popover chiuso e il pannello di nuovo chiuso. Prima di andare la barra
 * lascia qui quale controllo aveva il focus; la barra della pagina d'arrivo
 * lo riprende al montaggio. Sta in sessionStorage (solo questa scheda,
 * niente nell'URL) e vale una volta sola, per pochi secondi e solo
 * sull'URL per cui e' stato scritto.
 */

const CHIAVE = 'dokkan:fuoco-filtri'
const VALIDO_MS = 10_000

export type Segno = {
  /** il data-fuoco del controllo che aveva il focus */
  campo: string
  /** il pannello dei filtri era aperto (sotto md) */
  aperta: boolean
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
    return { campo: s.campo, aperta: s.aperta === true }
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

/** Rimette il focus sul controllo; se sta in un <details> lo riapre. */
export function rimettiFuoco(barra: HTMLElement | null, campo: string): boolean {
  if (!barra) return false
  const el = barra.querySelector<HTMLElement>(`[data-fuoco="${CSS.escape(campo)}"]`)
  if (!el) return false
  const d = el.closest('details')
  if (d && !d.open && el.tagName !== 'SUMMARY') d.open = true
  el.focus()
  return document.activeElement === el
}
