import type { Region } from '@/lib/queries'

// I tipi di notifica (0028) e la forma di una riga di notification_view.
// Modulo puro, solo tipi importati: lo usano il server, le isole client e
// i test senza Next.
//
// La lista ripete notification_kinds() della migrazione, nello stesso
// ordine: db/test/notifiche-app.test.mts controlla che coincidano, come
// per i temi e i motivi delle segnalazioni. Un tipo nuovo va aggiunto in
// tutti e due i posti, altrimenti il check della tabella lo rifiuta.

export const NOTIFICATION_KINDS = [
  'clear_comment',
  'content_hidden',
  'content_unhidden',
  'suspended',
  'suspension_lifted',
  'reports_open',
] as const

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

export const isNotificationKind = (v: unknown): v is NotificationKind =>
  typeof v === 'string' && (NOTIFICATION_KINDS as readonly string[]).includes(v)

/** La lista: dove si torna quando il contenuto non c'e' piu' o la riga non si mostra. */
export const NOTIFICATIONS_PATH = '/notifications'

export type NotificationTarget = 'clear' | 'comment' | 'tip' | 'account' | 'reports'

/**
 * Una riga di notification_list / notification_render come la consegna
 * node-postgres: bigint e id come stringhe, timestamptz come Date. until
 * puo' essere il numero Infinity ('infinity' = a tempo indeterminato).
 */
export type NotificationRow = {
  id: string
  kind: string
  created_at: Date
  updated_at: Date
  read_at: Date | null
  n: number
  actor_handle: string | null
  target: NotificationTarget
  clear_id: string | null
  comment_id: string | null
  tip_id: string | null
  event_id: string | null
  reg: Region | null
  tier_id: string | null
  event_name: string | null
  stage_seq: number | null
  stage_name: string | null
  difficulty: string | null
  content_visible: boolean | null
  visible: boolean
  until: Date | number | null
}

/**
 * Il pallino del menu: c'e' qualcosa di nuovo dall'ultima volta che la
 * lista e' stata vista. Le due date vengono dalla sessione (additionalFields),
 * quindi /api/me non fa query in piu'. null = mai.
 */
export function hasUnread(lastAt: unknown, seenAt: unknown): boolean {
  const last = tempo(lastAt)
  if (last === null) return false
  const seen = tempo(seenAt)
  return seen === null || last > seen
}

// better-auth da' una Date; un valore non valido vale "mai", cosi' un dato
// strano spegne il pallino invece di tenerlo acceso per sempre.
function tempo(v: unknown): number | null {
  if (v == null) return null
  const t = v instanceof Date ? v.getTime() : typeof v === 'string' || typeof v === 'number' ? new Date(v).getTime() : NaN
  return Number.isFinite(t) ? t : null
}
