import 'server-only'
import { createHash } from 'node:crypto'
import { DatabaseError } from 'pg'
import { sql, sqlOne } from '@/lib/db'
import { pushPayload, pushTopic, testPayload } from '@/lib/notify/payload'
import { readPushEnv, type PushEnv } from '@/lib/notify/push-env'
import { createPushSender, perOgni, PUSH_CONCURRENCY, type PushDevice, type PushSender } from '@/lib/notify/push-send'

// Un giro delle push (fase 4, 0031), quello che kickPush() fa partire con
// after() dopo una scrittura della community:
//
//   1. push_claim: UNA query. Sceglie le notifiche da mandare (fresche,
//      con la preferenza push, sotto i tetti), le segna e torna i
//      dispositivi. La pool rilascia il client appena la query finisce;
//   2. gli invii, in parallelo (al massimo PUSH_CONCURRENCY), senza nessun
//      client pg aperto: un servizio push lento (fino a 5 s) non deve
//      tenere una delle 5 connessioni dell'istanza mentre /api/me aspetta;
//   3. push_report: UNA query con tutti gli esiti.
//
// Best effort e senza ritentativi: una push persa resta nella lista del
// sito e nel digest. Un errore qui non deve mai arrivare all'utente che ha
// scritto: lo inghiotte kickPush.

/** Una riga di push_claim come la consegna node-postgres (bigint come testo). */
export type PushJobRow = {
  notification_id: string
  kind: string
  group_key: string
  n: number
  actor_handle: string | null
  event_name: string | null
  stage_seq: number | null
  stage_name: string | null
  difficulty: string | null
  devices: PushDevice[]
}

export type PushRunResult = { status: 'off' | 'empty' | 'sent'; jobs: number; sent: number; ok: number; failed: number; removed: number }

const VUOTO = { jobs: 0, sent: 0, ok: 0, failed: 0, removed: 0 }

export async function runPush({ limit = 20, env = readPushEnv(), sender, now = Date.now }: {
  limit?: number
  env?: PushEnv | null
  sender?: PushSender
  now?: () => number
} = {}): Promise<PushRunResult> {
  if (!env) return { status: 'off', ...VUOTO }
  const jobs = await sql<PushJobRow>(
    `select notification_id::text, kind, group_key, n, actor_handle::text, event_name, stage_seq,
            stage_name, difficulty, devices
       from push_claim($1::int)`,
    [limit],
  )
  if (!jobs.length) return { status: 'empty', ...VUOTO }

  const manda = sender ?? createPushSender(env)
  const ts = now()
  const invii = jobs.flatMap((j) => {
    const payload = pushPayload(j, ts)
    const topic = pushTopic(j.group_key)
    return j.devices.map((d) => ({ d, payload, topic }))
  })
  const esiti = await perOgni(invii, PUSH_CONCURRENCY, async (x) => ({ id: x.d.id, status: await manda(x.d, x.payload, { topic: x.topic }) }))
  const r = await report(esiti)
  return { status: 'sent', jobs: jobs.length, sent: esiti.filter((e) => e.status !== null).length, ...r }
}

/** Gli esiti in una chiamata sola; quelli non partiti (null) non contano. */
async function report(esiti: { id: string; status: number | null }[]) {
  const validi = esiti.filter((e): e is { id: string; status: number } => e.status !== null)
  if (!validi.length) return { ok: 0, failed: 0, removed: 0 }
  const r = await sqlOne<{ ok: number; failed: number; removed: number }>(
    'select ok, failed, removed from push_report($1::jsonb)',
    [JSON.stringify(validi)],
  )
  return r ?? { ok: 0, failed: 0, removed: 0 }
}

export type TestPushResult = 'sent' | 'gone' | 'failed' | 'rate' | 'missing' | 'off'

/** La notifica di prova di Settings, su questo dispositivo (push_test: una al minuto). */
export async function sendTestPush(userId: string, endpoint: string, sender?: PushSender): Promise<TestPushResult> {
  const env = readPushEnv()
  if (!env) return 'off'
  let d: PushDevice | null
  try {
    d = await sqlOne<PushDevice>('select id::text, endpoint, p256dh, auth from push_test($1::uuid, $2)', [userId, endpoint])
  } catch (e) {
    if (e instanceof DatabaseError && e.constraint === 'push_test_rate') return 'rate'
    throw e
  }
  if (!d) return 'missing'
  const status = await (sender ?? createPushSender(env))(d, testPayload(Date.now()), { topic: 'test' })
  if (status === null) return 'failed'
  await report([{ id: d.id, status }])
  if (status >= 200 && status < 300) return 'sent'
  return status === 404 || status === 410 ? 'gone' : 'failed'
}

/** Un'impronta corta dell'endpoint: al client basta per riconoscere "this device". */
export const endpointHash = (endpoint: string) =>
  createHash('sha256').update(endpoint, 'utf8').digest('base64url').slice(0, 22)

export type PushDeviceView = { id: string; label: string | null; hash: string; createdAt: string; lastOkAt: string | null; failing: boolean }

/** I dispositivi per Settings, senza endpoint ne' chiavi (push_devices, 0031). */
export async function pushDevicesOf(userId: string): Promise<PushDeviceView[]> {
  const rows = await sql<{ id: string; label: string | null; endpoint: string; created_at: Date; last_ok_at: Date | null; failures: number }>(
    'select id::text, label, endpoint, created_at, last_ok_at, failures from push_devices($1::uuid)',
    [userId],
  )
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    hash: endpointHash(r.endpoint),
    createdAt: r.created_at.toISOString(),
    lastOkAt: r.last_ok_at?.toISOString() ?? null,
    failing: r.failures > 0,
  }))
}

/** Se questo endpoint e' fra i dispositivi dell'utente. */
export async function pushDeviceListed(userId: string, endpoint: string): Promise<boolean> {
  const r = await sqlOne<{ ok: boolean }>('select exists (select 1 from push_devices($1::uuid) where endpoint = $2) as ok', [userId, endpoint])
  return r?.ok === true
}

/** I tipi con la push accesa (notification_pref, 0028). */
export async function pushKindsOn(userId: string): Promise<string[]> {
  const rows = await sql<{ kind: string }>(
    "select kind from notification_pref where user_id = $1::uuid and channel = 'push' order by kind",
    [userId],
  )
  return rows.map((r) => r.kind)
}
