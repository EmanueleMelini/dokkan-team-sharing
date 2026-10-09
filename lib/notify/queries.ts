import 'server-only'
import { sql, sqlOne } from '@/lib/db'
import type { NotificationRow } from '@/lib/notify/kinds'

// Le letture e l'unica scrittura delle notifiche lato app (0028). L'id
// dell'utente arriva sempre dalla sessione (lib/dal.ts): le funzioni SQL
// filtrano per destinatario, quindi una notifica di un altro non esiste.
// Le righe le scrivono solo i trigger della migrazione.

// i bigint e gli uuid gia' come testo, come li vogliono lib/urls.ts e i link
const COLONNE = `id::text, kind, created_at, updated_at, read_at, n, actor_handle::text, target,
  clear_id::text, comment_id::text, tip_id::text, event_id::text, reg::text, tier_id::text,
  event_name, stage_seq, stage_name, difficulty, content_visible, visible, until`

/** Quante ne mostra /notifications: le piu' recenti. */
export const LIST_LIMIT = 50

/** Le ultime LIST_LIMIT, le piu' recenti prima (anche quelle non piu' visibili). */
export function listNotifications(userId: string, limit = LIST_LIMIT): Promise<NotificationRow[]> {
  return sql<NotificationRow>(`select ${COLONNE} from notification_list($1::uuid, $2::int)`, [userId, limit])
}

/** Una notifica sola, ricalcolata adesso, o null se non e' di userId. */
export function renderNotification(userId: string, id: string): Promise<NotificationRow | null> {
  return sqlOne<NotificationRow>(`select ${COLONNE} from notification_render($1::uuid, $2::bigint)`, [userId, id])
}

/** Solo la scrittura, per la rotta /notifications/<id>: torna quante ne ha segnate. */
export async function markRead(userId: string, ids: string[]): Promise<number> {
  const m = await sqlOne<{ marked: number }>('select mark_notifications_read($1::uuid, $2::bigint[]) as marked', [userId, ids])
  return m?.marked ?? 0
}

/**
 * Segna lette queste notifiche (le altre dell'utente restano come sono).
 * Il pallino si spegne solo se non resta nessuna non letta: lo decide
 * mark_notifications_read sotto lock. Torna se resta acceso.
 */
export async function markNotificationsRead(userId: string, ids: string[]): Promise<{ marked: number; unread: boolean }> {
  const marked = await markRead(userId, ids)
  // Una seconda istruzione e non un CTE: dentro la stessa istruzione la
  // lettura di app_user non vedrebbe l'aggiornamento fatto dalla funzione.
  const u = await sqlOne<{ unread: boolean }>(
    `select coalesce(notif_last_at > coalesce(notif_seen_at, '-infinity'), false) as unread
       from app_user where id = $1::uuid`,
    [userId],
  )
  return { marked, unread: u?.unread ?? false }
}
