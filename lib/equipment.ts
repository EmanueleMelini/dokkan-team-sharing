import 'server-only'
import { sql } from '@/lib/db'

// Le Skill Orb (equipment, 0018) per il picker delle build, e le abilita'
// del Hidden Potential che il builder suggerisce come percorso.

export const EQUIP_SEARCH_MAX = 30
export const EQUIP_TIERS = [1, 2, 3] as const

export type EquipHit = {
  id: string
  name: string
  tier: number
  /** la descrizione del gioco: dice anche chi puo' montarla */
  effect: string | null
  total: number
}

/**
 * Le sfere che contengono tutte le parole cercate, nel nome o nella
 * descrizione: cosi' "evasion bardock" trova le esclusive di Bardock, il
 * cui nome da solo e' uguale a quello di cento altre.
 */
export async function searchEquipment(opts: {
  q?: string | null; tier?: number | null; offset?: number; limit?: number
} = {}): Promise<EquipHit[]> {
  const parole = (opts.q ?? '').trim().slice(0, 60).split(/\s+/).filter(Boolean).slice(0, 6)
  // % e _ sono jolly per ilike: chi cerca "50%" cerca il carattere
  const like = parole.map((p) => `%${p.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)
  const limit = Math.min(Math.max(1, opts.limit ?? EQUIP_SEARCH_MAX), EQUIP_SEARCH_MAX)
  const offset = Math.max(0, Math.min(opts.offset ?? 0, 10_000))
  return sql<EquipHit>(
    `select q.id::text, et.name, q.tier, et.effect, count(*) over ()::int as total
     from equipment q
     join equipment_text et on et.equipment_id = q.id and et.locale = 'en'
     where ($2::smallint is null or q.tier = $2::smallint)
       and coalesce((select bool_and(et.name || ' ' || coalesce(et.effect, '') ilike p)
                     from unnest($1::text[]) p), true)
     order by q.tier desc, et.name, q.id
     limit $3 offset $4`,
    [like, opts.tier ?? null, limit, offset],
  )
}

/** I nomi delle abilita' del Hidden Potential, nell'ordine del gioco. */
export async function listPotentialSkills(): Promise<string[]> {
  const rows = await sql<{ name: string }>('select name from potential_skill order by id')
  return rows.map((r) => r.name)
}
