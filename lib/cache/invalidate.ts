import 'server-only'
import { revalidateTag, updateTag } from 'next/cache'
import {
  TAG, cardTag, eventTag, profileTag, tagsFor, tagsForUser,
  type ClearWhere, type ClearWrite, type Invalidazione,
} from '@/lib/cache/tags'
import { userFootprint, type UserFootprint } from '@/lib/clears'

// L'unico posto che chiama next/cache per invalidare. Gli id arrivano
// sempre dal database (un valore restituito da una query), mai dal form.
// revalidatePath('/', 'layout') e' vietato: con cacheComponents quel tag
// sta su ogni pagina e svuoterebbe tutto il sito a ogni accesso.

export type Modo = 'now' | 'soon'

/** updateTag funziona solo nelle Server Action: le rotte usano sempre 'soon'. */
function applica({ now, soon }: Invalidazione) {
  for (const t of now) updateTag(t)
  for (const t of soon) revalidateTag(t, 'max')
}

const per = (modo: Modo, tags: string[]): Invalidazione =>
  modo === 'now' ? { now: tags, soon: [] } : { now: [], soon: tags }

export const invalidateEvent = (id: string, modo: Modo) => applica(per(modo, [eventTag(id)]))
export const invalidateCards = (ids: string[], modo: Modo = 'soon') => applica(per(modo, ids.map(cardTag)))
export const invalidateProfiles = (handles: string[], modo: Modo = 'soon') =>
  applica(per(modo, handles.filter(Boolean).map(profileTag)))
export const invalidateEventsList = () => applica(per('soon', [TAG.eventsList]))

/** Dopo invio, revisione, cancellazione, voto o commento su un clear. */
export function afterClearWrite(kind: ClearWrite, where: ClearWhere | null) {
  if (!where) return
  applica(tagsFor(kind, where))
}

/**
 * Le tracce di un utente vanno raccolte PRIMA del cambio quando il cambio
 * le cancella (delete_account): dopo non si saprebbe piu' quali pagine
 * mostravano i suoi clear, commenti e voti.
 */
export const collectUserFootprint = (userId: string, extraHandles: string[] = []) =>
  userFootprint(userId, extraHandles)

/** Invalida le pagine raccolte; oltre la soglia tutto il contenuto utenti. */
export function invalidateUser(footprint: UserFootprint) {
  const inv = tagsForUser(footprint)
  if (inv.all) revalidateTag(TAG.community, { expire: 0 })
  applica(inv)
}

/** Per i cambi che non cancellano (handle, sospensione): raccoglie e invalida. */
export async function afterUserChanged(userId: string, { extraHandles = [] }: { extraHandles?: string[] } = {}) {
  invalidateUser(await userFootprint(userId, extraHandles))
}
