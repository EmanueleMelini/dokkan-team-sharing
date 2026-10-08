import type { Metadata } from 'next'
import { EventPage, metadataEvento } from '@/components/evento/pagina'
import { staticEventIdsCached } from '@/lib/cache/data'

// /events/<id>: Global, tier di apertura, pagina 1. Il corpo e' in
// components/evento/pagina.tsx, comune a tutte le viste.
//
// Al build si prerenderizzano gli eventi Global in corso o in arrivo
// (al massimo 100, lib/queries.ts staticEventIds); gli altri id nascono
// alla prima visita e poi restano in cache (ISR).
//
// instant = false: params si aspetta qui, in cima, e non dentro un
// <Suspense>. Un notFound() dentro un pezzo in streaming arriverebbe con
// 200, dopo che lo shell e' gia' partito; cosi' un id sbagliato e' un 404
// vero. Il prezzo: la prima visita a un id non prerenderizzato aspetta un
// render intero, una volta.
export const instant = false

const VISTA = { reg: 'global', tier: null, page: 1 } as const

export async function generateStaticParams() {
  return (await staticEventIdsCached()).map((id) => ({ id }))
}

export async function generateMetadata(props: PageProps<'/events/[id]'>): Promise<Metadata> {
  const { id } = await props.params
  return metadataEvento(id, VISTA)
}

export default async function Evento(props: PageProps<'/events/[id]'>) {
  const { id } = await props.params
  return <EventPage id={id} view={VISTA} />
}
