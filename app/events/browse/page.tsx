import type { Metadata } from 'next'
import { Suspense } from 'react'
import { EventList, leggiFiltri } from '@/components/eventi/lista'
import { ListaSkeleton } from '@/components/eventi/skeleton'
import type { Ricerca } from '@/lib/parametri'

// Le viste filtrate della lista: regione, tipo, stato, ricerca, pagina.
// Leggono la query string, quindi sono dinamiche (una invocazione per
// vista): fuori dagli indici (noindex e robots.txt), e la sitemap elenca
// ogni evento, cosi' i motori non hanno bisogno di passare di qui.
export const metadata: Metadata = {
  title: 'Events',
  description: 'Dokkan Battle events, with the teams that cleared them.',
  robots: { index: false, follow: true },
}

export default function Browse(props: PageProps<'/events/browse'>) {
  return (
    <Suspense fallback={<ListaSkeleton />}>
      <Filtrata sp={props.searchParams} />
    </Suspense>
  )
}

async function Filtrata({ sp }: { sp: Promise<Ricerca> }) {
  return <EventList filtri={leggiFiltri(await sp)} />
}
