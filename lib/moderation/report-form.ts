// Il form di una segnalazione letto e controllato prima di chiamare
// report_content (0024). Modulo puro: lo usa la Server Action e lo prova
// il test. Le stesse regole le rifa' il database, che e' quello che conta:
// qui servono a rispondere subito con la frase giusta.

import { parseUuid } from '@/lib/clears/validate'
import { friendlyClearError, type DbErrorLike } from '@/lib/clears/errors'
import { cleanDetails, isReasonFor, isReportKind, type ReportKind, type ReportReason } from '@/lib/moderation/reasons'

export type ReportActionState = { ok?: boolean; error?: string; message?: string }

export type ReportInput = { kind: ReportKind; target: string; reason: ReportReason; details: string | null }

/** Grazie: lo stesso per una segnalazione nuova e per un doppione (spec). */
export const REPORT_THANKS = 'Thanks. A moderator will look at it.'

export function parseReportForm(form: FormData): { ok: true; value: ReportInput } | { ok: false; error: string } {
  const kind = form.get('kind')
  const target = parseUuid(form.get('target'))
  if (!isReportKind(kind) || !target) return { ok: false, error: 'This post is no longer available.' }
  const reason = form.get('reason')
  if (!isReasonFor(kind, reason)) return { ok: false, error: 'Pick one of the reasons in the list.' }
  const details = cleanDetails(reason, form.get('details'))
  if (details === undefined) return { ok: false, error: 'Tell us what is wrong, in under 500 characters.' }
  return { ok: true, value: { kind, target, reason, details } }
}

/**
 * Il rifiuto del database come frase. friendlyClearError ha gia' dentro le
 * frasi della moderazione (account_suspended, report_*) e builder_author
 * per chi non ha finito l'account; null vuol dire un guasto.
 */
export function reportErrorMessage(e: DbErrorLike): string | null {
  return friendlyClearError(e)
}
