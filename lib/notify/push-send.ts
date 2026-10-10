import webpush from 'web-push'
import { pushEndpointOk, senzaPorta443 } from '@/lib/notify/endpoint'
import type { PushEnv } from '@/lib/notify/push-env'

// Chi consegna una push: web-push costruisce la richiesta (cifratura
// aes128gcm del payload e token VAPID), la POST la fa fetch, qui. Senza
// Next e senza database: lib/notify/push.ts decide cosa fare degli esiti,
// i test passano un fetch finto o puntano a un servizio locale.
//
// Perche' fetch e non sendNotification di web-push: cosi' i redirect non
// si seguono (redirect 'manual': l'host e' quello controllato, e un 3xx non
// porta altrove), il tempo massimo copre tutta la richiesta (AbortSignal),
// e l'host si ricontrolla qui, un attimo prima della connessione.

/** Un dispositivo come lo torna push_claim (0031), con le chiavi del browser. */
export type PushDevice = { id: string; endpoint: string; p256dh: string; auth: string }

/** L'esito di un invio: il codice HTTP, 0 per rete o tempo scaduto, null se non e' partito. */
export type PushStatus = number | null

export type PushSender = (device: PushDevice, payload: string, opzioni?: { topic?: string }) => Promise<PushStatus>

/** Il tempo massimo di una richiesta a un servizio push. */
export const PUSH_TIMEOUT_MS = 5000
/** Quanto il servizio tiene una push per un dispositivo spento: un giorno, poi c'e' il digest. */
export const PUSH_TTL_S = 86_400
/** Quante richieste insieme in un giro. */
export const PUSH_CONCURRENCY = 6

export type SenderOptions = {
  fetchImpl?: typeof fetch
  /** solo i test lo allargano, per puntare a un servizio locale */
  allow?: (endpoint: string) => boolean
  timeoutMs?: number
}

export function createPushSender(vapid: PushEnv, opzioni: SenderOptions = {}): PushSender {
  const { fetchImpl = fetch, allow = pushEndpointOk, timeoutMs = PUSH_TIMEOUT_MS } = opzioni
  return async (device, payload, { topic } = {}) => {
    if (!allow(device.endpoint)) return null
    let req: ReturnType<typeof webpush.generateRequestDetails>
    try {
      req = webpush.generateRequestDetails(
        { endpoint: senzaPorta443(device.endpoint), keys: { p256dh: device.p256dh, auth: device.auth } },
        payload,
        {
          vapidDetails: vapid,
          TTL: PUSH_TTL_S,
          urgency: 'normal',
          contentEncoding: 'aes128gcm',
          ...(topic ? { topic } : {}),
        },
      )
    } catch {
      // chiavi del browser che non sono un punto della curva: per il
      // servizio sarebbe un 400, e come un 400 si conta
      return 400
    }
    const headers: Record<string, string> = {}
    // Content-Length lo calcola fetch dal corpo
    for (const [k, v] of Object.entries(req.headers)) if (k.toLowerCase() !== 'content-length') headers[k] = String(v)
    try {
      const res = await fetchImpl(req.endpoint, {
        method: 'POST',
        headers,
        body: req.body ? new Uint8Array(req.body) : undefined,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      })
      // il corpo non serve: si scarta, cosi' la connessione si libera
      await res.body?.cancel().catch(() => {})
      return res.status
    } catch {
      return 0
    }
  }
}

/** Esegue fn su tutti gli elementi, al massimo n alla volta, e torna gli esiti nell'ordine. */
export async function perOgni<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const esiti: R[] = new Array(items.length)
  let prossimo = 0
  const lavoratore = async () => {
    while (prossimo < items.length) {
      const i = prossimo++
      esiti[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, lavoratore))
  return esiti
}
