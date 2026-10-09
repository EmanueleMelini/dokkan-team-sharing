import 'server-only'
import { sqlOne } from '@/lib/db'

/**
 * L'ultimo cambio vero dell'handle (0026), per dire in Settings da quando
 * si puo' cambiare di nuovo. Solo per l'utente della sessione: e' un dato
 * suo, non sta nella vista pubblica.
 */
export async function handleChangedAt(userId: string): Promise<Date | null> {
  const r = await sqlOne<{ at: Date | null }>(
    'select handle_changed_at as at from app_user where id = $1::uuid', [userId])
  return r?.at ?? null
}
