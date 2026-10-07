import { appendFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Resend } from 'resend'
import type { AuthEnv } from '@/lib/auth/env'

export type MagicLinkMessage = { email: string; url: string }
export type MagicLinkSender = (msg: MagicLinkMessage) => Promise<void>

/** Dove finiscono i link in sviluppo, per provarli senza un servizio email. */
export const DEV_MAGIC_LINK_LOG = join(tmpdir(), 'dokkan-magic-links.log')

function testo(url: string) {
  return [
    'Use this link to sign in to Dokkan Team Sharing:',
    '',
    url,
    '',
    'The link works once and expires in 10 minutes.',
    "If you didn't ask for it, you can ignore this email.",
  ].join('\n')
}

function html(url: string) {
  // L'URL lo compone better-auth sul nostro baseURL, ma va comunque
  // escapato: finisce dentro un attributo.
  const u = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  return `<p>Use this link to sign in to Dokkan Team Sharing:</p>
<p><a href="${u}">Sign in</a></p>
<p>The link works once and expires in 10 minutes. If you didn't ask for it, you can ignore this email.</p>`
}

/**
 * In produzione Resend; in sviluppo, senza chiave, il link va nel terminale
 * del server e in un file in tmpdir. Il file non si scrive MAI in
 * produzione: chi lo leggesse entrerebbe come chiunque.
 */
export function createMagicLinkSender(env: AuthEnv): MagicLinkSender {
  if (env.resendApiKey) {
    const resend = new Resend(env.resendApiKey)
    return async ({ email, url }) => {
      const { error } = await resend.emails.send({
        from: env.emailFrom,
        to: email,
        subject: 'Your sign-in link for Dokkan Team Sharing',
        text: testo(url),
        html: html(url),
      })
      // Il messaggio di Resend, non l'indirizzo: nel log non serve.
      if (error) throw new Error(`Resend: ${error.name}: ${error.message}`)
    }
  }
  if (env.production) {
    // Il server non parte senza chiave (readAuthEnv in instrumentation.ts);
    // qui si arriva solo durante next build, che non manda niente. Se mai
    // succedesse a runtime, l'invio fallisce: mai il file di sviluppo.
    return async () => {
      throw new Error('RESEND_API_KEY mancante in produzione')
    }
  }
  return async ({ email, url }) => {
    console.log(`\n[auth] magic link per ${email}:\n  ${url}\n`)
    await appendFile(DEV_MAGIC_LINK_LOG, `${new Date().toISOString()} ${email} ${url}\n`, { mode: 0o600 })
  }
}
