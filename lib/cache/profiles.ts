import 'server-only'
import { cacheLife, cacheTag } from 'next/cache'
import { listUserClears, resolveHandle, staticProfileHandles } from '@/lib/profiles'
import { TAG, eventTag, profileTag } from '@/lib/cache/tags'

// Le letture del profilo pubblico, in cache. Come lib/cache/data.ts: solo
// handle e numeri come argomenti, mai la sessione (regola eslint).
//
// I tag:
// - profile:<handle> (minuscolo) per l'handle chiesto e per quello che si
//   trova: lo invalidano invio, revisione, cancellazione e moderazione di
//   un clear (l'autore), la sospensione, il cambio di handle e la
//   cancellazione dell'account (afterUserChanged: userFootprint ci mette
//   anche i nomi lasciati di handle_history, perche' un 404 in cache di un
//   nome lasciato, visto durante una sospensione, porta solo il suo tag);
// - event:<id> degli eventi in cui l'utente ha clear o commenti: un voto
//   ('soon') o un commento ('now') li tocca, e i conteggi e i punteggi si
//   rinfrescano senza che quelle scritture debbano conoscere l'autore;
// - community, la rete di sicurezza oltre le soglie di afterUserChanged.
// Un redirect da un nome lasciato porta anche il tag del nome attuale: un
// secondo cambio (o una sospensione) lo fa rileggere, senza catene di 308.

export async function resolveHandleCached(handle: string) {
  'use cache'
  cacheLife('community')
  const r = await resolveHandle(handle)
  const tags = [TAG.community, profileTag(handle)]
  if (r?.kind === 'moved') tags.push(profileTag(r.handle))
  if (r?.kind === 'found') tags.push(profileTag(r.profile.handle), ...r.eventIds.map(eventTag))
  cacheTag(...tags)
  return r
}

/** Una pagina della lista: i punteggi cambiano con i voti, quindi anche gli eventi mostrati. */
export async function listUserClearsCached(handle: string, offset: number) {
  'use cache'
  cacheLife('community')
  const righe = await listUserClears(handle, { offset })
  cacheTag(TAG.community, profileTag(handle), ...new Set(righe.map((r) => eventTag(r.event_id))))
  return righe
}

export async function staticProfileHandlesCached() {
  'use cache'
  cacheLife('days')
  cacheTag(TAG.community)
  return staticProfileHandles()
}
