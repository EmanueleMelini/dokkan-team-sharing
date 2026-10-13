import type { Metadata } from 'next'
import { EventList, FILTRI_BASE } from '@/components/eventi/lista'

// Il canonical: /events?account=deleted (dopo la cancellazione
// dell'account) e' la stessa pagina.
export const metadata: Metadata = {
  title: 'Events',
  description: 'Dokkan Battle events, with the teams that cleared them.',
  alternates: { canonical: '/events' },
}

// Statica: Global, nessun filtro, pagina 1. Niente searchParams ne'
// sessione, cosi' Vercel la serve dalla CDN. Ogni vista filtrata sta in
// /events/browse; la lista si rigenera con l'import (tag catalog), con gli
// invii (events-list) e al prossimo cambio di stato di un evento.
export default function Eventi() {
  return <EventList filtri={FILTRI_BASE} />
}
