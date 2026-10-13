import 'server-only'
import { sql } from '@/lib/db'

// La ricerca delle carte per il picker del builder dei clear.

export const CARD_TYPES = ['AGL', 'TEQ', 'INT', 'STR', 'PHY'] as const
export const CARD_CLASSES = ['Super', 'Extreme'] as const
export const CARD_RARITIES = ['N', 'R', 'SR', 'SSR', 'UR', 'LR'] as const
export type CardType = (typeof CARD_TYPES)[number]
export type CardClass = (typeof CARD_CLASSES)[number]
export type CardRarity = (typeof CARD_RARITIES)[number]

export const CARD_SEARCH_MAX = 40

export type CardSearch = {
  q?: string | null
  type?: CardType | null
  class?: CardClass | null
  rarity?: CardRarity | null
  category?: number | null
  limit?: number
  offset?: number
  /** I nomi delle link skill: costano un'aggregazione, solo se servono. */
  withLinks?: boolean
}

export type CardHit = {
  id: string
  name: string
  // NULL per le carte che il wiki non ha ancora (0015)
  epithet: string | null
  type: CardType
  class: CardClass
  rarity: CardRarity
  thumb_key: string | null
  /** la miniatura e' il solo personaggio (asset_bare, 0034) */
  thumb_bare: boolean
  // il giorno di uscita su Global, 'YYYY-MM-DD': una data, non un istante
  released_at: string | null
  links?: string[]
  total: number
}

/**
 * Le carte uscite su Global, filtrate e cercate per nome o epiteto.
 *
 * Il filtro testo scrive la stessa espressione dell'indice trigram
 * card_text_search (0015, con il coalesce): con un'espressione diversa
 * Postgres non lo userebbe. L'ordine mette prima chi ha il nome che
 * inizia con la ricerca, poi le uscite piu' recenti: chi cerca "Goku"
 * vuole i Goku nuovi, non i primi del 2015.
 */
export async function searchCards(opts: CardSearch = {}): Promise<CardHit[]> {
  const q = opts.q?.trim() ? opts.q.trim().slice(0, 60) : null
  const limit = Math.min(Math.max(1, opts.limit ?? CARD_SEARCH_MAX), CARD_SEARCH_MAX)
  const offset = Math.max(0, Math.min(opts.offset ?? 0, 10_000))
  // % e _ sono jolly per ilike: chi cerca "100%" cerca il carattere
  const like = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null
  return sql<CardHit>(
    `select c.id::text, ct.name, ct.epithet, c.type::text as type, c.class::text as class,
            c.rarity::text as rarity, c.thumb_key, asset_bare(c.thumb_key) as thumb_bare,
            r.released_at::text as released_at,
            ${opts.withLinks ? `coalesce((
              select json_agg(lt.name order by lt.name)
              from card_link cl
              join link_skill_text lt on lt.link_id = cl.link_id and lt.locale = 'en'
              where cl.card_id = c.id), '[]'::json) as links,` : ''}
            count(*) over ()::int as total
     from card c
     join card_text ct on ct.card_id = c.id and ct.locale = 'en'
     join card_release r on r.card_id = c.id and r.reg = 'global'
     where r.released_at <= current_date
       and ($1::text is null or (ct.name || ' ' || coalesce(ct.epithet, '')) ilike $1)
       and ($2::unit_type is null or c.type = $2::unit_type)
       and ($3::unit_class is null or c.class = $3::unit_class)
       and ($4::rarity is null or c.rarity = $4::rarity)
       and ($5::smallint is null or exists (
             select 1 from card_category cc where cc.card_id = c.id and cc.category_id = $5::smallint))
     order by case when $6::text is not null and ct.name ilike $6 then 0 else 1 end,
              r.released_at desc nulls last, c.id desc
     limit $7 offset $8`,
    [like, opts.type ?? null, opts.class ?? null, opts.rarity ?? null, opts.category ?? null,
      q ? `${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null, limit, offset],
  )
}

export type CategoryOption = { id: number; name: string }

/** Le categorie per il filtro del picker, in ordine alfabetico. */
export async function listCategories(): Promise<CategoryOption[]> {
  return sql<CategoryOption>(
    `select c.id, ct.name from category c
     join category_text ct on ct.category_id = c.id and ct.locale = 'en'
     order by ct.name`,
  )
}
