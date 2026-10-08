// Le build degli slot (0018) come le leggono le pagine: tipi e il pezzo
// di SQL che le legge dalle tabelle congelate. Niente 'server-only': i
// tipi servono anche ai componenti client, e qui non c'e' accesso al db.

/** Una Skill Orb montata: lo slot (1-3), l'id, il nome e il grado (1-3). */
export type SlotEquip = { slot: number; id: string; name: string | null; tier: number }

export type SlotBuild = {
  /** percorsi del Hidden Potential completati, 0-4; 4 = arcobaleno */
  hp_routes: number | null
  hp_path: string | null
  note: string | null
  equipment: SlotEquip[]
}

export const GRADI: Record<number, string> = { 1: 'Bronze', 2: 'Silver', 3: 'Gold' }

/** "4/4 routes" o "Rainbow": come il livello si legge in una riga. */
export function nomeRoutes(n: number): string {
  return n === 4 ? 'Rainbow (4/4 routes)' : `${n}/4 routes`
}

/**
 * La build di uno slot di una versione, come JSON (o null). Le
 * espressioni sono quelle della query che la include: versione, assetto,
 * rotazione e posizione della carta.
 */
export const buildJson = (version: string, seq: string, rot: string, pos: string) => `(
  select json_build_object(
           'hp_routes', b.hp_routes, 'hp_path', b.hp_path, 'note', b.note,
           'equipment', coalesce((
             select json_agg(json_build_object(
                      'slot', e.slot_no, 'id', e.equipment_id::text,
                      'name', et.name, 'tier', q.tier)
                    order by e.slot_no)
             from clear_lineup_equipment e
             join equipment q on q.id = e.equipment_id
             left join equipment_text et on et.equipment_id = e.equipment_id and et.locale = 'en'
             where (e.version_id, e.seq, e.rotation_index, e.pos)
                 = (b.version_id, b.seq, b.rotation_index, b.pos)
           ), '[]'::json))
  from clear_lineup_build b
  where b.version_id = ${version} and b.seq = ${seq}
    and b.rotation_index = ${rot} and b.pos = ${pos}
)`
