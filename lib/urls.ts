import type { EventKind, Region, Status } from '@/lib/queries'

// Tutti gli URL interni degli eventi passano da qui. Lo stato che deve
// poter stare in cache (regione, tier, pagina) sta nel percorso: con
// cacheComponents una pagina che legge la query string non puo' essere un
// prerender servito dalla CDN, una che legge solo i params si'. Le query
// string restano alle pagine dinamiche e noindex (/events/browse).
//
// Modulo puro, senza Next: lo provano i test (db/test/urls.test.mts).

/** Come gli id del database: finiscono in un cast ::bigint. */
const ID = /^\d{1,18}$/
// Nessuna lista arriva a centomila pagine; il tetto tiene l'offset dentro
// il bigint (lo stesso di lib/parametri.ts). Niente zeri iniziali: ogni
// pagina deve avere un URL solo, perche' ogni URL valido diventa una voce
// ISR salvata.
const PAGINA = /^[1-9]\d{0,5}$/
export const PAGINA_MAX = 100_000

export type EventView = { reg: Region; tier: string | null; page: number }

/** /events/<id>[/japan][/t/<tier>[/p/<n>]]. La pagina vale solo con un tier. */
export function eventHref({ id, reg = 'global', tier = null, page = 1 }: {
  id: string
  reg?: Region
  tier?: string | null
  page?: number
}): string {
  let href = `/events/${id}`
  if (reg === 'japan') href += '/japan'
  if (tier) {
    href += `/t/${tier}`
    if (page > 1) href += `/p/${Math.min(Math.trunc(page), PAGINA_MAX)}`
  }
  return href
}

/**
 * I segmenti dopo l'id (il catch-all [...view]) come vista, o null se non
 * seguono la grammatica: null diventa notFound(). Rifiuta anche le forme
 * doppie dello stesso contenuto (p/1, 'Japan', zeri iniziali), cosi' un bot
 * non moltiplica le voci in cache.
 */
export function parseEventView(view: string[] | undefined): EventView | null {
  const v = [...(view ?? [])]
  let reg: Region = 'global'
  if (v[0] === 'japan') { reg = 'japan'; v.shift() }
  if (v.length === 0) return { reg, tier: null, page: 1 }
  if (v[0] !== 't' || !ID.test(v[1] ?? '')) return null
  const tier = v[1]
  if (v.length === 2) return { reg, tier, page: 1 }
  if (v.length !== 4 || v[2] !== 'p' || !PAGINA.test(v[3])) return null
  const page = Number(v[3])
  if (page < 2 || page > PAGINA_MAX) return null
  return { reg, tier, page }
}

export type BrowseFilters = {
  reg?: Region
  kind?: EventKind | null
  status?: Status | null
  search?: string | null
  page?: number
}

/**
 * La lista filtrata. Senza filtri e' /events, la pagina statica; con
 * qualsiasi filtro e' /events/browse con gli stessi parametri di prima
 * (region solo se japan, page solo da 2).
 */
export function browseHref({ reg = 'global', kind = null, status = null, search = null, page = 1 }: BrowseFilters = {}): string {
  const p = new URLSearchParams()
  if (reg === 'japan') p.set('region', reg)
  if (kind) p.set('type', kind)
  if (status) p.set('status', status)
  if (search) p.set('q', search)
  if (page > 1) p.set('page', String(page))
  const s = p.toString()
  return s ? `/events/browse?${s}` : '/events'
}

/** Il builder di un tier: resta con la query string, e' per utente e dinamico. */
export function submitHref(id: string, reg: Region, tier: string): string {
  const p = new URLSearchParams({ ...(reg === 'japan' ? { region: reg } : {}), tier })
  return `/events/${id}/submit?${p}`
}

/** La modifica di un proprio clear. */
export const editClearHref = (eventId: string, clearId: string) => `/events/${eventId}/clears/${clearId}/edit`

/** Il punto di un clear nella pagina del suo tier. */
export const clearAnchor = (clearId: string) => `#clear-${clearId}`

/** La pagina di una carta (/cards/<id>): un URL solo per carta, niente query string. */
export const cardHref = (cardId: string) => `/cards/${cardId}`
