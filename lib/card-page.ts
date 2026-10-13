import 'server-only'
import { sql, sqlOne } from '@/lib/db'
import { CLEAR_PER_PAGINA, ORDINE_CLEAR, type Region } from '@/lib/queries'

// Le letture della pagina di una carta (/cards/<id>). Modulo puro: niente
// cacheTag ne' cacheLife, i test lo importano fuori da Next. La cache sta
// in lib/cache/cards.ts.

// Gli id delle carte sono interi del gioco, mai con zeri iniziali: ogni
// pagina ha un URL solo. Il tetto a 10 cifre tiene fuori i numeri che non
// sono carte (e quelli oltre il bigint).
const ID_CARTA = /^[1-9][0-9]{0,9}$/

/** L'id della carta dal segmento dell'URL, o null: null diventa un 404. */
export function parseCardId(s: unknown): string | null {
  return typeof s === 'string' && ID_CARTA.test(s) ? s : null
}

/**
 * Il gioco da' alla forma risvegliata Z di una carta l'id della base piu'
 * uno (1032310 -> 1032311). Noi teniamo solo la base: l'id della forma Z,
 * se esiste la base, porta alla base. Funzione pura, per i test.
 */
export function baseOfZAwakened(id: string): string | null {
  if (!ID_CARTA.test(id) || !id.endsWith('1')) return null
  // dieci cifre al massimo: un Number le tiene esatte
  const base = String(Number(id) - 1)
  return ID_CARTA.test(base) ? base : null
}

export type SkillKind =
  | 'leader' | 'super' | 'ultra' | 'passive' | 'active' | 'standby' | 'domain'
  | 'transform' | 'unit_super' | 'ex_super' | 'finish'
export type SkillTier = 'base' | 'eza' | 'seza'

export type CardSkill = {
  kind: SkillKind
  tier: SkillTier
  seq: number
  name: string | null
  /** una riga per effetto; "- " apre un punto elenco */
  description: string
  /** le note del wiki: i numeri esatti */
  details: string[]
  condition: string | null
  ki: string | null
}

export type ChainItem = {
  id: string
  name: string | null
  epithet: string | null
  rarity: string
  type: string
  class: string | null
  thumb_key: string | null
  /** la miniatura e' il solo personaggio (asset_bare, 0034) */
  thumb_bare: boolean
  global: boolean
}

export type CardDetail = {
  id: string
  type: string
  class: string | null
  rarity: string
  has_eza: boolean
  is_seza: boolean
  hp: number | null
  atk: number | null
  def: number | null
  wiki_title: string | null
  /** null: la carta non ha ancora un testo inglese */
  name: string | null
  epithet: string | null
  /** 'YYYY-MM-DD' per regione */
  releases: { reg: Region; date: string }[]
  thumb_key: string | null
  /** la miniatura e' il solo personaggio (asset_bare, 0034) */
  thumb_bare: boolean
  art_key: string | null
  art_animated_key: string | null
  /** il peso dell'artwork animato, per dirlo prima di scaricarlo */
  art_animated_bytes: number | null
  /** le misure dello statico, per riservare il posto prima che arrivi */
  art_w: number | null
  art_h: number | null
  rarity_icon_key: string | null
  type_icon_key: string | null
  links: { id: number; name: string; effect: string | null }[]
  categories: { id: number; name: string }[]
  skills: CardSkill[]
  /** gli EZA il cui boss e' questa carta; super: la versione Super EZA */
  ezaEvents: { id: string; name: string; super: boolean }[]
  /** la catena del Dokkan Awakening, dalla prima forma all'ultima */
  chain: ChainItem[]
}

/**
 * Una carta con tutto quello che la pagina mostra, o null. Una query sola:
 * la pagina si rigenera di rado, ma ogni rigenerazione costa CPU.
 */
export async function getCard(id: string): Promise<CardDetail | null> {
  if (!parseCardId(id)) return null
  return sqlOne<CardDetail>(
    `with recursive
     su(id, d) as (
       select awakens_from, 1 from card where id = $1::bigint and awakens_from is not null
       union all
       select c.awakens_from, su.d + 1 from su join card c on c.id = su.id
        where c.awakens_from is not null and su.d < 5
     ),
     giu(id, d) as (
       select c.id, 1 from card c where c.awakens_from = $1::bigint
       union all
       select c.id, giu.d + 1 from giu join card c on c.awakens_from = giu.id where giu.d < 5
     ),
     -- un ciclo nei dati (non ce ne sono, ma il wiki e' scritto a mano)
     -- ripeterebbe una carta: resta la posizione piu' vicina
     catena as (
       select distinct on (id) id, ord from (
         select id, -d as ord from su
         union all select $1::bigint, 0
         union all select id, d from giu
       ) x order by id, abs(ord)
     )
     select c.id::text, c.type::text, c.class::text, c.rarity::text, c.has_eza, c.is_seza,
            c.hp, c.atk, c.def, c.wiki_title, ct.name, ct.epithet,
            c.thumb_key, asset_bare(c.thumb_key) as thumb_bare, c.art_key, c.art_animated_key,
            (select a.byte_size from asset a where a.key = c.art_animated_key) as art_animated_bytes,
            (select a.width from asset a where a.key = c.art_key) as art_w,
            (select a.height from asset a where a.key = c.art_key) as art_h,
            ri.asset_key as rarity_icon_key, ti.asset_key as type_icon_key,
            coalesce((select json_agg(json_build_object('reg', r.reg, 'date', to_char(r.released_at, 'YYYY-MM-DD'))
                                      order by r.reg)
                        from card_release r where r.card_id = c.id), '[]'::json) as releases,
            coalesce((select json_agg(json_build_object('id', l.link_id, 'name', l.name, 'effect', l.effect)
                                      order by l.name)
                        from card_link cl
                        join link_skill_text l on l.link_id = cl.link_id and l.locale = 'en'
                       where cl.card_id = c.id), '[]'::json) as links,
            coalesce((select json_agg(json_build_object('id', g.category_id, 'name', g.name) order by g.name)
                        from card_category cc
                        join category_text g on g.category_id = cc.category_id and g.locale = 'en'
                       where cc.card_id = c.id), '[]'::json) as categories,
            coalesce((select json_agg(json_build_object(
                               'kind', s.kind, 'tier', s.tier, 'seq', s.seq, 'name', s.name,
                               'description', s.description, 'details', s.details,
                               'condition', s.condition, 'ki', s.ki)
                             order by s.kind, s.tier, s.seq)
                        from card_skill s where s.card_id = c.id and s.locale = 'en'), '[]'::json) as skills,
            coalesce((select json_agg(json_build_object('id', e.id::text, 'name', et.name, 'super', x.super)
                                      order by x.super, e.id)
                        from event e
                        join event_text et on et.event_id = e.id and et.locale = 'en'
                        cross join lateral (select exists (
                          select 1 from event_game_ref g
                           where g.event_id = e.id and g.related_game_id is not null) as super) x
                       where e.cover_card_id = c.id and e.kind = 'zbattle'), '[]'::json) as "ezaEvents",
            (select json_agg(json_build_object(
                      'id', k.id::text, 'name', kt.name, 'epithet', kt.epithet, 'rarity', kc.rarity,
                      'type', kc.type, 'class', kc.class, 'thumb_key', kc.thumb_key,
                      'thumb_bare', asset_bare(kc.thumb_key),
                      'global', exists (select 1 from card_release r
                                         where r.card_id = k.id and r.reg = 'global'))
                    order by k.ord)
               from catena k
               join card kc on kc.id = k.id
               left join card_text kt on kt.card_id = k.id and kt.locale = 'en') as chain
     from card c
     left join card_text ct on ct.card_id = c.id and ct.locale = 'en'
     left join rarity_icon ri on ri.rarity = c.rarity
     left join type_icon ti on ti.type = c.type and ti.class is not distinct from c.class
     where c.id = $1::bigint`,
    [id],
  )
}

// ---------------------------------------------------------------------
//  I clear che usano la carta
// ---------------------------------------------------------------------

export const CLEAR_CARTA_MAX = 10

export type CardClear = {
  id: string
  event_id: string
  tier_id: string
  difficulty: string
  stage_seq: number
  score: number
  has_proof: boolean
  turns: number | null
  handle: string
  event_name: string
  stage_name: string | null
  /** 0 leader, 1 friend, 2 in squadra: il ruolo migliore della carta nel clear */
  role_rank: number
  /** la pagina del tier in cui la lista dell'evento mostra il clear */
  page: number
}

/**
 * I migliori clear pubblicati (prova, voti, i piu' recenti) che usano la
 * carta in una regione, e quanti sono in tutto. Conta ogni assetto, non
 * solo la partenza (clear_lineup_card), e i clear di prima del 0016 che
 * hanno solo clear_card. Un clear con la carta in due assetti vale uno.
 *
 * La pagina di ogni clear si calcola con lo stesso ORDINE_CLEAR della
 * lista dell'evento: il link arriva dove il clear si vede davvero.
 */
export async function getCardClears(
  id: string,
  reg: Region,
  limit = CLEAR_CARTA_MAX,
): Promise<{ rows: CardClear[]; total: number }> {
  if (!parseCardId(id)) return { rows: [], total: 0 }
  const righe = await sql<CardClear & { total: number }>(
    `with v as (
       select version_id, min(case role when 'leader' then 0 when 'friend' then 1 else 2 end) as r
       from (select version_id, role::text from clear_card where card_id = $1::bigint
             union all
             select version_id, role::text from clear_lineup_card where card_id = $1::bigint) x
       group by version_id
     ),
     ranked as (
       select c.*, row_number() over (partition by c.stage_tier_id order by ${ORDINE_CLEAR}) as rn
       from clear_current c
       where c.reg = $2 and c.status = 'published'
         and c.stage_tier_id in (select cc.stage_tier_id from clear_current cc join v using (version_id))
     )
     select c.id::text, c.event_id::text, c.stage_tier_id::text as tier_id, c.difficulty::text,
            c.stage_seq, c.score::int, c.has_proof, c.turns, u.handle,
            et.name as event_name, st.name as stage_name, v.r as role_rank,
            ceil(c.rn / $4::numeric)::int as page, (count(*) over ())::int as total
     from ranked c
     join v using (version_id)
     join app_user u on u.id = c.author_id
     join event_text et on et.event_id = c.event_id and et.locale = 'en'
     join stage_tier t on t.id = c.stage_tier_id
     left join stage_text st on st.stage_id = t.stage_id and st.locale = 'en'
     order by c.has_proof desc, c.score desc, c.created_at desc, c.id
     limit $3`,
    [id, reg, limit, CLEAR_PER_PAGINA],
  )
  const total = righe[0]?.total ?? 0
  for (const r of righe) delete (r as Partial<typeof r>).total
  return { rows: righe, total }
}

// ---------------------------------------------------------------------
//  Build e sitemap
// ---------------------------------------------------------------------

/** Quante carte si prerenderizzano al build, come gli eventi (EVENTI_STATICI_MAX). */
export const CARTE_STATICHE_MAX = 100

/**
 * Le carte da prerenderizzare: le piu' usate nei clear pubblicati, poi le
 * ultime uscite su Global. Mai vuota (con cacheComponents
 * generateStaticParams deve dare almeno un id).
 */
export async function staticCardIds(limit = CARTE_STATICHE_MAX): Promise<string[]> {
  const righe = await sql<{ id: string }>(
    `select c.id::text from card c
     join card_release r on r.card_id = c.id and r.reg = 'global'
     left join lateral (
       select count(distinct l.version_id) as n from clear_lineup_card l where l.card_id = c.id
     ) u on true
     order by u.n desc, r.released_at desc, c.id desc
     limit $1`,
    [limit],
  )
  if (righe.length) return righe.map((r) => r.id)
  const una = await sqlOne<{ id: string }>('select id::text from card order by id desc limit 1')
  return una ? [una.id] : []
}

/** Le carte uscite su Global, per la sitemap. */
export async function sitemapCards(): Promise<{ id: string; uscita: Date }[]> {
  return sql<{ id: string; uscita: Date }>(
    `select r.card_id::text as id, r.released_at as uscita
     from card_release r
     where r.reg = 'global'
     order by r.released_at desc, r.card_id desc`,
  )
}

// ---------------------------------------------------------------------
//  Le skill per livello (funzioni pure, per la pagina e per i test)
// ---------------------------------------------------------------------

/** L'ordine delle sezioni, quello dell'enum card_skill_kind. */
export const SKILL_KINDS: SkillKind[] = [
  'leader', 'super', 'ultra', 'passive', 'active', 'standby', 'domain',
  'transform', 'unit_super', 'ex_super', 'finish',
]

const SOTTO: Record<SkillTier, SkillTier[]> = { base: [], eza: ['base'], seza: ['eza', 'base'] }

/** I livelli che hanno almeno una skill, dal piu' alto: il primo e' quello che si apre. */
export function skillTiers(skills: CardSkill[]): SkillTier[] {
  return (['seza', 'eza', 'base'] as const).filter((t) => skills.some((s) => s.tier === t))
}

export type SkillSection = {
  kind: SkillKind
  rows: CardSkill[]
  /** il livello da cui vengono le righe, se non e' quello mostrato ("Unchanged from EZA") */
  from: SkillTier | null
}

/**
 * Le sezioni di un livello. Il wiki scrive per l'EZA solo cio' che cambia:
 * una sezione che manca prende il testo del livello sotto, segnato come
 * invariato. Una Super EZA con la sola passiva mostra le altre dall'EZA.
 */
export function skillsForTier(skills: CardSkill[], tier: SkillTier): SkillSection[] {
  const out: SkillSection[] = []
  for (const kind of SKILL_KINDS) {
    const proprie = skills.filter((s) => s.kind === kind && s.tier === tier)
    if (proprie.length) { out.push({ kind, rows: proprie, from: null }); continue }
    for (const sotto of SOTTO[tier]) {
      const rows = skills.filter((s) => s.kind === kind && s.tier === sotto)
      if (rows.length) { out.push({ kind, rows, from: sotto }); break }
    }
  }
  return out
}

export type RigaTesto = { bullet: boolean; text: string }

/** Le righe di una descrizione: "- " apre un punto elenco, le altre sono titoletti. */
export function righeDi(description: string): RigaTesto[] {
  return description.split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l) => (l.startsWith('- ') ? { bullet: true, text: l.slice(2) } : { bullet: false, text: l }))
}
