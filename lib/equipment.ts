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

type Filtro = { q?: string | null; tier?: number | null; card?: number | null }

// Le parole cercate come pattern di ilike, e il filtro comune a ricerca e
// conteggio delle nascoste: $1 parole, $2 grado.
function parole(q: string | null | undefined): string[] {
  // % e _ sono jolly per ilike: chi cerca "50%" cerca il carattere
  return (q ?? '').trim().slice(0, 60).split(/\s+/).filter(Boolean).slice(0, 6)
    .map((p) => `%${p.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)
}
const DOVE = `($2::smallint is null or q.tier = $2::smallint)
       and coalesce((select bool_and(et.name || ' ' || coalesce(et.effect, '') ilike p)
                     from unnest($1::text[]) p), true)`

/**
 * Le sfere che contengono tutte le parole cercate, nel nome o nella
 * descrizione: cosi' "evasion bardock" trova le esclusive di Bardock, il
 * cui nome da solo e' uguale a quello di cento altre. Con `card` solo
 * quelle che quella carta puo' montare (equipment_fits, 0021).
 */
export async function searchEquipment(opts: Filtro & { offset?: number; limit?: number } = {}): Promise<EquipHit[]> {
  const limit = Math.min(Math.max(1, opts.limit ?? EQUIP_SEARCH_MAX), EQUIP_SEARCH_MAX)
  const offset = Math.max(0, Math.min(opts.offset ?? 0, 10_000))
  return sql<EquipHit>(
    `select q.id::text, et.name, q.tier, et.effect, count(*) over ()::int as total
     from equipment q
     join equipment_text et on et.equipment_id = q.id and et.locale = 'en'
     where ${DOVE}
       and ($5::bigint is null or equipment_fits(q.id, $5::bigint))
     order by q.tier desc, et.name, q.id
     limit $3 offset $4`,
    [parole(opts.q), opts.tier ?? null, limit, offset, opts.card ?? null],
  )
}

/** Quante sfere la ricerca troverebbe ma la carta non puo' montare. */
export async function countHiddenEquipment(opts: Filtro & { card: number }): Promise<number> {
  const [r] = await sql<{ n: number }>(
    `select count(*)::int as n
     from equipment q
     join equipment_text et on et.equipment_id = q.id and et.locale = 'en'
     where ${DOVE} and not equipment_fits(q.id, $3::bigint)`,
    [parole(opts.q), opts.tier ?? null, opts.card],
  )
  return r?.n ?? 0
}

/** Vero se la carta esiste: la ricerca per una carta sconosciuta e' un errore, non zero sfere. */
export async function cardExists(id: number): Promise<boolean> {
  return (await sql('select 1 from card where id = $1', [id])).length > 0
}

/** I nomi delle abilita' del Hidden Potential, nell'ordine del gioco. */
export async function listPotentialSkills(): Promise<string[]> {
  const rows = await sql<{ name: string }>('select name from potential_skill order by id')
  return rows.map((r) => r.name)
}
