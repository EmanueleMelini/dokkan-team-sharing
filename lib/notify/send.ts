import { appendFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Resend } from 'resend'
import type { DigestEmail } from '@/lib/notify/digest'
import type { NotifyEnv } from '@/lib/notify/env'

// Chi consegna i digest: Resend in produzione, un file in tmpdir in
// sviluppo senza chiave (accanto a quello dei magic link). Senza Next e
// senza database: il cron (lib/notify/run.ts) decide cosa fare dell'esito,
// i test passano un mittente finto.
//
// Una sola chiamata batch.send per giro (al massimo 40 email): una
// richiesta HTTP invece di 40, cosi' i magic link che partono nello stesso
// momento non trovano il limite di richieste al secondo di Resend gia'
// occupato dal digest. La Idempotency-Key di Resend vale per la richiesta
// intera, non per la singola email: la sceglie il chiamante (digestBatchKey).

/** Dove finiscono i digest in sviluppo: mai scritto in produzione. */
export const DEV_DIGEST_LOG = join(tmpdir(), 'dokkan-digests.log')

export type SendOutcome =
  /** Resend li ha accettati (o li aveva gia' accettati con la stessa chiave e lo stesso corpo). */
  | { status: 'sent' }
  /** La stessa chiave con un corpo diverso: quel gruppo e' gia' partito oggi. */
  | { status: 'duplicate'; reason: string }
  /** 429 o quota finita: il digest si ferma per 24 ore, il login no. */
  | { status: 'quota'; reason: string }
  /** Un altro giro con la stessa chiave e' ancora in corso: non si segna niente. */
  | { status: 'busy'; reason: string }
  | { status: 'failed'; reason: string }

export type DigestSender = (emails: DigestEmail[], idempotencyKey: string) => Promise<SendOutcome>

const QUOTA = new Set(['daily_quota_exceeded', 'monthly_quota_exceeded', 'rate_limit_exceeded'])

/**
 * L'errore di Resend come esito. reason e' solo il nome dell'errore (va
 * in notify_state, tagliato a 60 caratteri): mai il messaggio, che puo'
 * citare un indirizzo.
 */
export function classifyResendError(err: { name?: unknown; statusCode?: unknown } | null | undefined): SendOutcome {
  const name = typeof err?.name === 'string' && err.name ? err.name : 'unknown_error'
  if (err?.statusCode === 429 || QUOTA.has(name)) return { status: 'quota', reason: name }
  if (name === 'invalid_idempotent_request') return { status: 'duplicate', reason: name }
  if (name === 'concurrent_idempotent_requests') return { status: 'busy', reason: name }
  return { status: 'failed', reason: name }
}

function voceDiLog(e: DigestEmail, key: string, from: string): string {
  const head = [`From: ${from}`, `To: ${e.to}`, `Subject: ${e.subject}`, ...Object.entries(e.headers).map(([k, v]) => `${k}: ${v}`)]
  return `=== ${new Date().toISOString()} digest key=${key}\n${head.join('\n')}\n\n${e.text}\n\n`
}

export function createDigestSender(env: NotifyEnv): DigestSender {
  if (env.resendApiKey) {
    const resend = new Resend(env.resendApiKey)
    return async (emails, idempotencyKey) => {
      try {
        const { error } = await resend.batch.send(
          emails.map((e) => ({ from: env.from, to: e.to, subject: e.subject, text: e.text, html: e.html, headers: e.headers })),
          { idempotencyKey },
        )
        return error ? classifyResendError(error) : { status: 'sent' }
      } catch (e) {
        // La rete o l'SDK: niente pausa, il prossimo giro ritenta.
        return { status: 'failed', reason: e instanceof Error ? e.name : 'exception' }
      }
    }
  }
  if (env.production) {
    // readAuthEnv pretende la chiave all'avvio: qui si arriva solo se manca
    // davvero, e allora niente parte. Mai il file di sviluppo in produzione.
    return async () => ({ status: 'failed', reason: 'missing_api_key' })
  }
  return async (emails, idempotencyKey) => {
    await appendFile(DEV_DIGEST_LOG, emails.map((e) => voceDiLog(e, idempotencyKey, env.from)).join(''), { mode: 0o600 })
    console.log(`\n[notify] ${emails.length} digest scritti in ${DEV_DIGEST_LOG}\n`)
    return { status: 'sent' }
  }
}
