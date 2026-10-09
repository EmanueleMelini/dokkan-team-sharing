import type { NextRequest } from 'next/server'
import { currentUser } from '@/lib/dal'
import { parseBigintId } from '@/lib/clears/validate'
import { NOTIFICATIONS_PATH } from '@/lib/notify/kinds'
import { markRead, renderNotification } from '@/lib/notify/queries'
import { notificationHref, notificationLink } from '@/lib/notify/vista'

// L'unico link di una notifica, per la lista e (fasi 3 e 4) per push ed
// email: segna letta quella notifica e porta con un 307 dove punta ADESSO.
// L'href non si salva mai: un clear nascosto dopo porta alla sua modifica,
// un contenuto cancellato o una notifica di un altro tornano alla lista.
//
// E' un GET che scrive: segnare letta e' innocuo e idempotente, e deve
// funzionare da un clic su una push o in un'email, dove non c'e' un form.
// Un altro sito puo' al piu' segnare letta una notifica: non vede niente,
// perche' l'id non gli dice dove porta e la risposta e' solo un redirect.

const HEADERS = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' }

/** Location relativa: vale per qualsiasi host serva il sito (RFC 9110). */
const vai = (href: string) => new Response(null, { status: 307, headers: { ...HEADERS, Location: href } })

export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const id = parseBigintId((await ctx.params).id)
  const qui = id ? notificationLink(id) : NOTIFICATIONS_PATH
  const user = await currentUser()
  // Senza sessione (un link da un'email aperto su un altro dispositivo) si
  // entra e si torna qui, come per le altre pagine per utente.
  if (!user) return vai(`/login?next=${encodeURIComponent(qui)}`)
  if (!user.onboarded) return vai(`/welcome?next=${encodeURIComponent(qui)}`)
  if (!id) return vai(NOTIFICATIONS_PATH)

  const riga = await renderNotification(user.id, id)
  if (!riga) return vai(NOTIFICATIONS_PATH)
  await markRead(user.id, [id])
  return vai(notificationHref(riga))
}
