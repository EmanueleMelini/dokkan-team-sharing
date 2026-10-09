import type { Metadata } from 'next'
import { EventPage, idValido, metadataEvento } from '@/components/evento/pagina'
import { leggiFiltri } from '@/lib/clears/filtri'
import { pagina, regione, uno, type Ricerca } from '@/lib/parametri'
import { eventHref, type EventView } from '@/lib/urls'

// /events/<id>/clears?tier=...&proof=1&card=...: la lista filtrata dei
// clear di un tier. La pagina dell'evento e' la stessa (components/evento/
// pagina.tsx), con i filtri: legge la query string, quindi e' dinamica,
// una invocazione per vista. Fuori dagli indici (noindex, canonical al
// tier senza filtri, robots.txt) perche' le combinazioni sono senza fine.
//
// Come le altre viste dell'evento: params e searchParams in cima e
// instant = false, cosi' un id o un tier sbagliati sono un 404 vero. Un
// filtro sbagliato invece non e' un errore: vale "non impostato".
export const instant = false

const ID = /^\d{1,18}$/

/** La vista dalla query string; null (404) solo per un tier che non e' un id. */
function vista(sp: Ricerca): EventView | null {
  const tier = uno(sp.tier)
  if (tier && !ID.test(tier)) return null
  return { reg: regione(sp), tier: tier || null, page: pagina(sp) }
}

export async function generateMetadata(props: PageProps<'/events/[id]/clears'>): Promise<Metadata> {
  const [{ id }, sp] = await Promise.all([props.params, props.searchParams])
  const v = vista(sp)
  const base = await metadataEvento(id, v)
  return {
    ...base,
    robots: { index: false, follow: true },
    ...(v && idValido(id) ? { alternates: { canonical: eventHref({ id, reg: v.reg, tier: v.tier }) } } : {}),
  }
}

export default async function ClearFiltrati(props: PageProps<'/events/[id]/clears'>) {
  const [{ id }, sp] = await Promise.all([props.params, props.searchParams])
  return <EventPage id={id} view={vista(sp)} filtri={leggiFiltri(sp)} />
}
