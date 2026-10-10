'use server'

import { DatabaseError } from 'pg'
import { sqlOne } from '@/lib/db'
import { requireOnboardedUser } from '@/lib/dal'
import {
  REPORT_THANKS, parseReportForm, reportErrorMessage, type ReportActionState,
} from '@/lib/moderation/report-form'
import { kickPush } from '@/lib/notify/kick'

// La segnalazione di un clear o di un commento. E' un endpoint pubblico
// come le azioni dei clear: l'id di chi segnala viene dalla sessione, il
// bersaglio dal form, e report_content controlla da se' che esista, sia
// pubblicato, non sia di chi segnala e che il limite orario regga.
//
// Nessuna invalidazione: una segnalazione non cambia nessuna pagina
// pubblica. Le pagine di /admin sono dinamiche e la leggono gia'.

export async function reportContent(_prev: ReportActionState, form: FormData): Promise<ReportActionState> {
  const user = await requireOnboardedUser('/events')
  // Detto prima, senza toccare il database (che lo rifiuterebbe comunque).
  if (user.suspended) return { error: reportErrorMessage({ code: '42501', constraint: 'account_suspended' })! }
  const input = parseReportForm(form)
  if (!input.ok) return { error: input.error }
  const { kind, target, reason, details } = input.value
  try {
    await sqlOne('select report_content($1::uuid, $2, $3::uuid, $4, $5) as id',
      [user.id, kind, target, reason, details])
  } catch (e) {
    if (e instanceof DatabaseError) {
      const msg = reportErrorMessage(e)
      if (msg) return { error: msg }
    }
    throw e
  }
  // Un doppione ritorna l'id che c'era: per chi segnala e' la stessa cosa.
  // Gli admin hanno una notifica (0028): la push, se l'hanno accesa.
  kickPush()
  return { ok: true, message: REPORT_THANKS }
}
