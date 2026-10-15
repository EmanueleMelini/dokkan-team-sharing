// Il vocabolario dei tag della cache e quali tag tocca ogni scrittura.
// Modulo puro, senza Next: lo provano i test (db/test/cache-tags.test.mts),
// e lib/cache/invalidate.ts lo traduce in chiamate a next/cache.
//
// I tag finiscono in chiaro nelle voci di cache e negli header di Vercel:
// solo id pubblici e handle, mai un id utente o un'email.

export const TAG = {
  /** tutti i dati del gioco: eventi, stage, carte, missioni (cambiano con gli import) */
  catalog: 'catalog',
  /** la lista degli eventi: i conteggi dei clear cambiano con gli invii */
  eventsList: 'events-list',
  /**
   * tutto il contenuto degli utenti. Lo invalida solo cache:clear in
   * sviluppo: in produzione toccherebbe ogni pagina evento, tier, carta e
   * profilo insieme (una scrittura ISR per ogni pagina rivisitata).
   */
  community: 'community',
} as const

const ID = /^\d{1,18}$/
const HANDLE = /^[a-z0-9_]{3,24}$/

export const eventTag = (id: string) => `event:${id}`
export const cardTag = (id: string) => `card:${id}`
/** Gli handle si confrontano senza maiuscole: un tag solo per profilo. */
export const profileTag = (handle: string) => `profile:${handle.toLowerCase()}`

/** I tag che si possono chiedere da fuori (/api/revalidate), o null. */
export function isAllowedTag(tag: unknown): tag is string {
  if (typeof tag !== 'string' || tag.length > 255) return false
  if (tag === TAG.catalog || tag === TAG.eventsList || tag === TAG.community) return true
  const [tipo, valore, ...resto] = tag.split(':')
  if (resto.length || valore === undefined) return false
  if (tipo === 'event' || tipo === 'card') return ID.test(valore)
  if (tipo === 'profile') return HANDLE.test(valore)
  return false
}

/**
 * Due modi di invalidare:
 * - now: updateTag, scade subito. Chi ha scritto rilegge la sua scrittura,
 *   e la risposta dell'azione rigenera la pagina corrente (CPU).
 * - soon: revalidateTag(tag, 'max'). La prossima visita riceve ancora la
 *   copia vecchia e la rigenera dietro; l'azione non rigenera niente.
 */
export type Invalidazione = { now: string[]; soon: string[] }

export type ClearWrite = 'submit' | 'revise' | 'delete' | 'vote' | 'comment'

export type ClearWhere = {
  eventId: string
  /** le carte della versione vecchia e di quella nuova */
  cardIds?: string[]
  /** l'autore del clear (la pagina profilo arriva con una fase dopo) */
  handles?: string[]
}

const unici = (xs: string[]) => [...new Set(xs)]

/** Quali tag tocca una scrittura su un clear, e come. */
export function tagsFor(kind: ClearWrite, where: ClearWhere): Invalidazione {
  const evento = eventTag(where.eventId)
  const carte = unici((where.cardIds ?? []).filter((id) => ID.test(id))).map(cardTag)
  const profili = unici((where.handles ?? []).filter(Boolean).map(profileTag))
  switch (kind) {
    // Il voto e' la scrittura piu' frequente: niente rigenerazione nella
    // risposta. Il punteggio nuovo torna dall'azione e da /api/me.
    case 'vote':
      return { now: [], soon: [evento] }
    case 'comment':
      return { now: [evento], soon: [] }
    case 'submit':
      return { now: [evento], soon: [TAG.eventsList, ...carte, ...profili] }
    case 'revise':
      return { now: [evento], soon: [...carte, ...profili] }
    // Quello che si cancella deve sparire dalla richiesta dopo, ovunque.
    case 'delete':
      return { now: [evento, ...carte, ...profili], soon: [TAG.eventsList] }
  }
}

/**
 * Dopo un cambio che tocca tutto quello che un utente ha scritto
 * (cancellazione dell'account, cambio di handle, sospensione): le sue
 * pagine, e solo quelle, scadono subito, quante che siano. Prima, oltre 300
 * tag, si faceva scadere tutto 'community': ogni pagina evento, tier, carta
 * e profilo del sito, da riscrivere per intero alla visita dopo.
 */
export function tagsForUser(touched: { eventIds: string[]; cardIds: string[]; handles: string[] }): Invalidazione {
  const tags = unici([
    ...touched.eventIds.filter((id) => ID.test(id)).map(eventTag),
    ...touched.cardIds.filter((id) => ID.test(id)).map(cardTag),
    ...touched.handles.filter(Boolean).map(profileTag),
  ])
  return { now: tags, soon: [TAG.eventsList] }
}
