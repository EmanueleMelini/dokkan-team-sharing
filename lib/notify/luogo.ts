import { DIFFICOLTA } from '@/lib/livelli'
import type { NotificationRow } from '@/lib/notify/kinds'

// Dove sta il contenuto di una notifica, in parole: lo dicono la lista, le
// push, il digest e il feed degli admin (lib/notify/attivita.ts). Modulo
// puro a parte, cosi' vista.ts e attivita.ts lo usano senza importarsi a
// vicenda.

/** I campi che servono a dire dove sta il contenuto: li hanno anche le righe del digest. */
export type NotificationPlaceFields = Pick<NotificationRow, 'event_id' | 'event_name' | 'stage_seq' | 'stage_name' | 'difficulty'>

/** "Event name, Stage 3, Super 2": dove sta il contenuto, o null. */
export function notificationPlace(v: NotificationPlaceFields): string | null {
  if (!v.event_name && !v.event_id) return null
  const evento = v.event_name ?? `Event ${v.event_id}`
  if (!v.difficulty) return evento
  if (v.difficulty === 'eza_level') return `${evento}, Level ${v.stage_seq ?? ''}`.trim()
  const stage = v.stage_name ?? (v.stage_seq != null ? `Stage ${v.stage_seq}` : null)
  const diff = DIFFICOLTA[v.difficulty] ?? v.difficulty
  // un evento di uno stage solo ha spesso lo stage con lo stesso nome: una volta basta
  return stage && stage !== evento ? `${evento}, ${stage}, ${diff}` : `${evento}, ${diff}`
}
