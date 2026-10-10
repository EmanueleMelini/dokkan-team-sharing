import 'server-only'
import { createHash } from 'node:crypto'
import { sql, sqlOne } from '@/lib/db'
import { renderDigest, type DigestEmail, type DigestRow } from '@/lib/notify/digest'
import type { NotifyEnv } from '@/lib/notify/env'
import type { DigestSender } from '@/lib/notify/send'
import { signUnsubscribeToken } from '@/lib/notify/token'

// Un giro del digest giornaliero, quello che fa /api/cron/digest:
//
//   1. in pausa (un 429 di Resend nelle ultime 24 ore)? Fine.
//   2. digest_due(40): chi ha qualcosa di nuovo e non l'ha ancora avuto
//      oggi, gia' in ordine di priorita' (admin, moderazione, il digest
//      piu' vecchio). Chi resta fuori parte domani.
//   3. email_budget_consume('notify', n): quanti ne passano sotto i tetti.
//      Si chiede per il gruppo intero, una volta sola.
//   4. una batch.send con i primi k, poi digest_mark_sent solo per loro.
//      Un 429 o una quota finita: notify_pause e stop. I login non passano
//      mai di qui: il loro budget non si rifiuta.
//
// Idempotenza: digest_mark_sent segna il giorno (uno al giorno per
// utente). Se l'invio riesce e il segno no, il giro rilanciato oggi
// riprende le stesse persone e la stessa chiave: Resend non rimanda.

/** Il tetto per giro: lo stesso di notify al giorno (email_budget_caps). */
export const DIGEST_BATCH = 40

export type DigestRunResult = {
  status: 'paused' | 'empty' | 'budget' | 'sent' | 'duplicate' | 'quota' | 'busy' | 'failed'
  due: number
  granted: number
  sent: number
  reason?: string
}

const COLONNE = `user_id::text, email::text, handle::text, token_v, is_admin, has_moderation,
  since, upto, day, votes, helpful, items`

/** Gli utenti in attesa oggi, nell'ordine di invio. */
export function digestDue(limit = DIGEST_BATCH): Promise<DigestRow[]> {
  return sql<DigestRow>(`select ${COLONNE} from digest_due($1::int)`, [limit])
}

/**
 * La Idempotency-Key della batch: il giorno e l'insieme degli utenti.
 * Resend la applica alla richiesta intera, quindi una chiave per utente
 * (digest:<user>:<giorno>) non si puo' usare con una batch sola.
 */
export function digestBatchKey(day: string, userIds: string[]): string {
  const h = createHash('sha256').update([...userIds].sort().join(','), 'utf8').digest('hex').slice(0, 32)
  return `digest:${day}:${h}`
}

async function segna(rows: DigestRow[]): Promise<number> {
  // upto e day sono gli stessi per tutto il giro, ma si raggruppano lo
  // stesso: digest_mark_sent li vuole uguali per ogni gruppo di utenti.
  const gruppi = new Map<string, DigestRow[]>()
  for (const r of rows) {
    const k = `${new Date(r.upto).toISOString()}|${r.day}`
    gruppi.set(k, [...(gruppi.get(k) ?? []), r])
  }
  let n = 0
  for (const g of gruppi.values()) {
    const ids = g.map((r) => r.user_id)
    const args = [ids, g[0].upto, g[0].day]
    const q = 'select digest_mark_sent($1::uuid[], $2::timestamptz, $3::date) as n'
    // Un secondo tentativo: le email sono gia' partite, e un errore di
    // rete qui farebbe rimandare domani anche quello che hanno gia' letto.
    const r = await sqlOne<{ n: number }>(q, args).catch(() => sqlOne<{ n: number }>(q, args))
    n += r?.n ?? 0
  }
  return n
}

export async function runDigest({ sender, env, limit = DIGEST_BATCH }: {
  sender: DigestSender
  env: NotifyEnv
  limit?: number
}): Promise<DigestRunResult> {
  const pausa = await sqlOne<{ until: Date | null }>('select notify_paused_until() as until')
  if (pausa?.until) return { status: 'paused', due: 0, granted: 0, sent: 0 }

  const rows = await digestDue(limit)
  if (!rows.length) return { status: 'empty', due: 0, granted: 0, sent: 0 }

  // I testi prima del budget: un errore qui (la firma) non consuma niente.
  const emails: DigestEmail[] = rows.map((r) =>
    renderDigest(r, { baseURL: env.baseURL, token: signUnsubscribeToken(env.secret, r.user_id, r.token_v) }))

  const k = (await sqlOne<{ n: number }>("select email_budget_consume('notify', $1::int) as n", [rows.length]))?.n ?? 0
  if (k <= 0) return { status: 'budget', due: rows.length, granted: 0, sent: 0 }

  const scelti = rows.slice(0, k)
  const esito = await sender(emails.slice(0, k), digestBatchKey(scelti[0].day, scelti.map((r) => r.user_id)))
  const base = { due: rows.length, granted: k }
  switch (esito.status) {
    case 'sent':
    case 'duplicate':
      return { status: esito.status, ...base, sent: await segna(scelti), ...(esito.status === 'duplicate' ? { reason: esito.reason } : {}) }
    case 'quota':
      await sqlOne('select notify_pause($1, 24)', [esito.reason])
      return { status: 'quota', ...base, sent: 0, reason: esito.reason }
    default:
      return { status: esito.status, ...base, sent: 0, reason: esito.reason }
  }
}
