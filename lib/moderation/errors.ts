// I rifiuti della moderazione (0024) tradotti per chi usa il sito: si
// traduce il nome del vincolo, mai il testo del messaggio, che e' italiano.
// friendlyClearError ci ricade prima del suo 42501 generico ("non tuo"),
// cosi' account_suspended si legge bene anche nei form del builder, dei
// voti e dei commenti. Modulo puro.

export type DbErrorLike = { code?: string; constraint?: string }

const BY_CONSTRAINT: Record<string, string> = {
  account_suspended:
    'Your account is suspended. You can still read, change your settings and delete your posts or your account.',
  report_kind: 'This cannot be reported.',
  report_target_missing: 'This post is no longer available.',
  report_own: 'You cannot report your own post.',
  report_reason: 'Pick one of the reasons in the list.',
  report_details: 'Tell us what is wrong, in under 500 characters.',
  report_rate_limit: 'You have sent a lot of reports in the last hour. Try again later.',
  mod_not_allowed: 'Only moderators can do this.',
  mod_note: 'Keep the note under 500 characters.',
  mod_status: 'That status is not valid. Reload the page.',
  mod_target_missing: 'This post no longer exists.',
  mod_kind: 'That kind of post is not valid. Reload the page.',
  mod_user_missing: 'This user no longer exists.',
  mod_suspend_forbidden: 'You cannot suspend yourself or another admin.',
  mod_suspend_until: 'The suspension must end in the future.',
  mod_suspend_reason: 'Keep the reason under 300 characters.',
  moderation_action_append_only: 'The moderation log cannot be changed.',
  // solo dagli script (db/admin/set-role.mjs), mai dal sito
  role_invalid: 'The role must be member, editor or admin.',
  role_user_missing: 'No user has that handle.',
}

/** La frase per un rifiuto della moderazione, o null se e' un guasto. */
export function friendlyModerationError(e: DbErrorLike): string | null {
  return (e.constraint && BY_CONSTRAINT[e.constraint]) || null
}

/** I nomi dei vincoli di 0024, per il test che controlla le frasi. */
export const MODERATION_CONSTRAINTS = Object.keys(BY_CONSTRAINT)
