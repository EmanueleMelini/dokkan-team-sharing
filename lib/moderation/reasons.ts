// I motivi delle segnalazioni, per tipo di contenuto. Gli stessi codici li
// controlla il database (0024: report_reason_check e report_reasons()), e
// un test verifica che le due liste coincidano. Modulo puro: lo usano i
// form, le Server Action e le pagine admin.

export type ReportKind = 'clear' | 'comment' | 'tip'

export type ReportReason =
  | 'fake_proof'
  | 'wrong_stage'
  | 'wrong_info'
  | 'spam'
  | 'offensive'
  | 'personal_info'
  | 'other'

export const REASON_LABELS: Record<ReportReason, string> = {
  fake_proof: "Proof is fake or doesn't show this clear",
  wrong_stage: 'Wrong event, stage or difficulty',
  wrong_info: 'Wrong or outdated information',
  spam: 'Spam or advertising',
  offensive: 'Offensive or hateful',
  personal_info: "Shares someone's personal information",
  other: 'Something else',
}

// L'ordine e' quello dei radio nel form. Una prova falsa si segnala sul
// clear: non c'e' un bottone a parte per le prove.
export const REASONS_BY_KIND: Record<ReportKind, readonly ReportReason[]> = {
  clear: ['fake_proof', 'wrong_stage', 'spam', 'offensive', 'personal_info', 'other'],
  comment: ['spam', 'offensive', 'personal_info', 'other'],
  tip: ['wrong_info', 'spam', 'offensive', 'personal_info', 'other'],
}

/**
 * I tipi del form generico (reportContent). report_content accetta anche
 * 'tip' (0025), ma le tip passano dalla loro azione, reportTip.
 */
export const REPORTABLE_KINDS: readonly ReportKind[] = ['clear', 'comment']

/** Tutti i codici, l'unione delle liste: e' il check della tabella report. */
export const ALL_REASONS = Object.keys(REASON_LABELS) as ReportReason[]

export const DETAILS_MAX = 500
export const NOTE_MAX = 500
export const SUSPENSION_REASON_MAX = 300
/** Segnalazioni nuove per ora (clear_write_limit('report')). */
export const REPORTS_PER_HOUR = 10

export function isReportKind(v: unknown): v is ReportKind {
  return typeof v === 'string' && (REPORTABLE_KINDS as readonly string[]).includes(v)
}

/** Vero se il motivo vale per quel tipo. */
export function isReasonFor(kind: ReportKind, reason: unknown): reason is ReportReason {
  return typeof reason === 'string' && (REASONS_BY_KIND[kind] as readonly string[]).includes(reason)
}

/** 'Something else' vuole due parole di spiegazione: senza, il moderatore non sa cosa guardare. */
export function needsDetails(reason: ReportReason): boolean {
  return reason === 'other'
}

/**
 * I dettagli come li salva il database: senza spazi ai lati, vuoti = null.
 * Torna undefined se mancano per 'other' o superano DETAILS_MAX.
 */
export function cleanDetails(reason: ReportReason, details: unknown): string | null | undefined {
  const v = typeof details === 'string' ? details.trim() : ''
  // per caratteri, come char_length: .length conterebbe due volte un'emoji
  if ([...v].length > DETAILS_MAX) return undefined
  if (!v) return needsDetails(reason) ? undefined : null
  return v
}
