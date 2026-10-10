import type { NextRequest } from 'next/server'
import { purgeAuthExpired } from '@/lib/auth/startup'
import { isCronAuthorized } from '@/lib/cron'
import { sqlOne } from '@/lib/db'
import { LEGALE } from '@/lib/legale'

// La pulizia giornaliera di sessioni e token scaduti, delle segnalazioni
// chiuse da piu' di 180 giorni (purge_resolved_reports, 0024: le aperte
// restano, il registro dei moderatori non si tocca) e delle notifiche
// (purge_notifications, 0028: lette da 30 giorni, non lette da 90) e dei contatori
// delle email (purge_email_quota, 0029: 40 giorni) e delle push (purge_push,
// 0031: i dispositivi non visti da 90 giorni, il registro degli invii dopo
// 2), chiamata da Vercel
// Cron (vercel.json) con GET e "Authorization: Bearer <CRON_SECRET>".
// Chiunque altro riceve 401: senza segreto la rotta e' sempre chiusa.

const noStore = { 'Cache-Control': 'no-store' }

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return Response.json({ error: 'unauthorized' }, { status: 401, headers: noStore })
  }
  try {
    const purged = await purgeAuthExpired()
    const reports = (await sqlOne<{ n: number }>('select purge_resolved_reports() as n'))?.n ?? 0
    const notifications = (await sqlOne<{ n: number }>('select purge_notifications() as n'))?.n ?? 0
    const emailQuota = (await sqlOne<{ n: number }>('select purge_email_quota() as n'))?.n ?? 0
    const push = (await sqlOne<{ devices: number; sent: number }>(
      'select devices, sent from purge_push($1::int)', [LEGALE.giorniDispositiviPush],
    )) ?? { devices: 0, sent: 0 }
    return Response.json({ purged, reports, notifications, emailQuota, push }, { headers: noStore })
  } catch (e) {
    // Il dettaglio nei log, non nella risposta. Vercel non riprova: un 500
    // si vede nei log del cron, e la pulizia di domani recupera.
    console.error('[cron] pulizia non riuscita:', e instanceof Error ? e.message : e)
    return Response.json({ error: 'purge failed' }, { status: 500, headers: noStore })
  }
}
