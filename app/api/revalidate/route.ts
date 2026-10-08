import { revalidateTag } from 'next/cache'
import { revalidateRequest } from '@/lib/cache/revalidate'

// Gli import dicono qui che i dati sono cambiati: vedi lib/cache/revalidate.ts.
// 'max': la prossima visita riceve ancora la copia vecchia e la rigenera
// dietro, cosi' un import non fa ripartire tutte le pagine insieme. In
// next dev invece scade subito: dopo db:demo o db:import si ricarica la
// pagina e si vede il dato nuovo, senza una visita a vuoto.
export async function POST(request: Request) {
  const dev = process.env.NODE_ENV === 'development'
  return revalidateRequest(request, {
    secret: process.env.CRON_SECRET,
    dev,
    apply: (tags) => { for (const t of tags) revalidateTag(t, dev ? { expire: 0 } : 'max') },
  })
}
