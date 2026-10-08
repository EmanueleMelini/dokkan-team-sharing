import type { NextRequest } from 'next/server'
import { purgeAuthExpired } from '@/lib/auth/startup'
import { isCronAuthorized } from '@/lib/cron'

// La pulizia giornaliera di sessioni e token scaduti, chiamata da Vercel
// Cron (vercel.json) con GET e "Authorization: Bearer <CRON_SECRET>".
// Chiunque altro riceve 401: senza segreto la rotta e' sempre chiusa.

const noStore = { 'Cache-Control': 'no-store' }

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return Response.json({ error: 'unauthorized' }, { status: 401, headers: noStore })
  }
  try {
    const purged = await purgeAuthExpired()
    return Response.json({ purged }, { headers: noStore })
  } catch (e) {
    // Il dettaglio nei log, non nella risposta. Vercel non riprova: un 500
    // si vede nei log del cron, e la pulizia di domani recupera.
    console.error('[cron] pulizia non riuscita:', e instanceof Error ? e.message : e)
    return Response.json({ error: 'purge failed' }, { status: 500, headers: noStore })
  }
}
