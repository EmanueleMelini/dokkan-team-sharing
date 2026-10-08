import type { Metadata } from 'next'
import { EventPage, metadataEvento } from '@/components/evento/pagina'
import { staticEventIdsCached } from '@/lib/cache/data'
import { parseEventView } from '@/lib/urls'

// /events/<id>/japan, /events/<id>[/japan]/t/<tier>[/p/<n>]. La
// grammatica e' in lib/urls.ts: tutto il resto e' un 404. I fratelli
// statici submit e clears vincono sul catch-all.
//
// Come /events/[id]: params in cima e instant = false, perche' notFound()
// risponda 404 davvero.
export const instant = false

// Con cacheComponents generateStaticParams deve dare almeno una voce: la
// versione giapponese del primo evento prerenderizzato. Il resto nasce
// alla prima visita e poi resta in cache.
export async function generateStaticParams() {
  const [primo] = await staticEventIdsCached()
  return primo ? [{ id: primo, view: ['japan'] }] : []
}

export async function generateMetadata(props: PageProps<'/events/[id]/[...view]'>): Promise<Metadata> {
  const { id, view } = await props.params
  return metadataEvento(id, parseEventView(view))
}

export default async function VistaEvento(props: PageProps<'/events/[id]/[...view]'>) {
  const { id, view } = await props.params
  return <EventPage id={id} view={parseEventView(view)} />
}
