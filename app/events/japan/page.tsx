import type { Metadata } from 'next'
import { EventList, FILTRI_BASE } from '@/components/eventi/lista'

export const metadata: Metadata = {
  title: 'Japan events',
  description: 'Dokkan Battle events in the Japan version of the game, with the teams that cleared them.',
  alternates: { canonical: '/events/japan' },
}

// La home di chi gioca la versione giapponese: come /events, statica
// (Japan, nessun filtro, pagina 1), servita dalla CDN senza funzioni. Chi
// ha scelto Japan (il cookie dts_version, lib/versione) ci arriva da / e da
// /events con il redirect di next.config.ts; ogni altra vista filtrata sta
// in /events/browse?region=japan. Un segmento statico: vince su [id].
export default function EventiJapan() {
  return <EventList filtri={{ ...FILTRI_BASE, reg: 'japan' }} />
}
