import type { NextRequest } from 'next/server'
import { isCronAuthorized } from '@/lib/cron'
import { readNotifyEnv } from '@/lib/notify/env'
import { runDigest } from '@/lib/notify/run'
import { createDigestSender } from '@/lib/notify/send'

// Il digest email giornaliero (0029), chiamato da Vercel Cron alle 17:00
// UTC (vercel.json; su Hobby fino a 59 minuti dopo) con GET e
// "Authorization: Bearer <CRON_SECRET>". Senza segreto la rotta e' chiusa.
//
// Rilanciarla lo stesso giorno non manda niente a chi l'ha gia' avuto
// (digest_mark_sent), e la Idempotency-Key ferma Resend se l'invio era
// partito e il segno no. Vercel non riprova: chi resta fuori per il tetto
// o per una pausa parte il giorno dopo, con tutto quello che si e' perso.

const noStore = { 'Cache-Control': 'no-store' }

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return Response.json({ error: 'unauthorized' }, { status: 401, headers: noStore })
  }
  try {
    const env = readNotifyEnv()
    const esito = await runDigest({ sender: createDigestSender(env), env })
    // Solo numeri e il nome dell'errore di Resend: mai indirizzi.
    console.log('[cron] digest:', JSON.stringify(esito))
    const status = esito.status === 'failed' ? 502 : 200
    return Response.json(esito, { status, headers: noStore })
  } catch (e) {
    console.error('[cron] digest non riuscito:', e instanceof Error ? e.message : e)
    return Response.json({ error: 'digest failed' }, { status: 500, headers: noStore })
  }
}
