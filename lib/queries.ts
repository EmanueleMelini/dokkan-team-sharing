import { sql, sqlOne } from '@/lib/db'

export type Region = 'global' | 'japan'
export type Status = 'active' | 'upcoming' | 'past'
// Da dove viene una ricorrenza: il wiki dà solo il giorno di prima uscita,
// il gioco e le finestre messe a mano danno istanti precisi.
export type RunSource = 'wiki' | 'game' | 'manual'

export const EVENT_KINDS = [
  'challenge', 'zbattle', 'limited', 'story', 'bonus',
  'world_tournament', 'other',
] as const
export type EventKind = (typeof EVENT_KINDS)[number]

export type EventRow = {
  id: string
  name: string
  kind: EventKind
  status: Status
  ends_at_known: boolean
  // pg restituisce timestamptz come Date, non come stringa
  starts_at: Date
  // null con ends_at_known vero: permanente. null con ends_at_known falso:
  // fine sconosciuta.
  ends_at: Date | null
  source: RunSource
  banner_key: string | null
  stages: number
  // Vero quando ogni tier è un livello EZA: la lista lo usa per dire
  // "livelli" invece di "stage", come fa la pagina dell'evento.
  is_eza: boolean
  clears: number
  // Il totale con questi filtri, uguale su ogni riga: count(*) over () lo
  // calcola prima del limit, così la pagina sa quante ce ne sono in tutto
  // senza una seconda query.
  total: number
}

export const EVENTI_PER_PAGINA = 60

/*
 * Quale ricorrenza rappresenta un evento in una regione. Prendere solo la
 * più recente sbaglia appena c'è una replica annunciata: l'evento giocabile
 * oggi risulterebbe "in arrivo". L'ordine è: quella in corso, poi la
 * prossima in arrivo (la più vicina, non la più lontana), poi l'ultima
 * conclusa.
 */
const ORDINE_RUN = `case es.status when 'active' then 0 when 'upcoming' then 1 else 2 end,
       case when es.status = 'upcoming' then es.starts_at end asc nulls last,
       es.starts_at desc`

/**
 * La lista degli eventi di una regione.
 *
 * Un evento può avere più ricorrenze nella stessa regione: `distinct on`
 * ne tiene una sola, scelta con ORDINE_RUN.
 */
export async function listEvents(opts: {
  reg: Region
  kind?: EventKind | null
  status?: Status | null
  search?: string | null
  limit?: number
  offset?: number
}): Promise<EventRow[]> {
  const {
    reg, kind = null, status = null, search = null, limit = EVENTI_PER_PAGINA, offset = 0,
  } = opts
  return sql<EventRow>(
    `with ultima_run as (
       select distinct on (es.event_id)
              es.event_id, es.status, es.starts_at, es.ends_at, r.ends_at_known, r.source
       from event_status es
       join event_run r on r.id = es.run_id
       where es.reg = $1
       order by es.event_id, ${ORDINE_RUN}
     )
     select e.id::text, et.name, e.kind::text as kind,
            u.status, u.starts_at, u.ends_at, u.ends_at_known, u.source, e.banner_key,
            (select count(*) from stage s where s.event_id = e.id)::int as stages,
            coalesce((select bool_and(st.difficulty = 'eza_level')
                        from stage_tier st where st.event_id = e.id), false) as is_eza,
            (select count(*) from clear c
               join event_run r on r.id = c.run_id
              where c.event_id = e.id and r.reg = $1
                and c.status = 'published')::int as clears,
            count(*) over ()::int as total
     from event e
     join ultima_run u on u.event_id = e.id
     join event_text et on et.event_id = e.id and et.locale = 'en'
     where ($2::event_kind is null or e.kind = $2::event_kind)
       and ($3::text is null or u.status = $3)
       and ($4::text is null or strpos(lower(et.name), lower($4)) > 0)
     order by case when $3::text = 'active' then u.ends_at end asc nulls last,
              u.starts_at desc, e.id desc
     limit $5 offset $6`,
    [reg, kind, status, search, limit, offset],
  )
}

export type EventDetail = {
  id: string
  name: string
  kind: EventKind
  description: string | null
  banner_key: string | null
  // Null quando l'evento non è mai uscito in questa regione: il left join
  // laterale restituisce l'evento comunque, senza una run da mostrare.
  status: Status | null
  starts_at: Date | null
  ends_at: Date | null
  ends_at_known: boolean | null
  source: RunSource | null
}

export async function getEvent(id: string, reg: Region): Promise<EventDetail | null> {
  return sqlOne<EventDetail>(
    `select e.id::text, et.name, e.kind::text as kind,
            et.official_description as description, e.banner_key,
            u.status, u.starts_at, u.ends_at, u.ends_at_known, u.source
     from event e
     join event_text et on et.event_id = e.id and et.locale = 'en'
     left join lateral (
       select es.status, es.starts_at, es.ends_at, r.ends_at_known, r.source
       from event_status es
       join event_run r on r.id = es.run_id
       where es.event_id = e.id and es.reg = $2
       order by ${ORDINE_RUN} limit 1
     ) u on true
     where e.id = $1::bigint`,
    [id, reg],
  )
}

export type StageRow = {
  stage_id: string
  seq: number
  name: string | null
  tier_id: string
  difficulty: string
  sta_cost: number | null
  boss_note: string | null
  clears: number
}

export async function getStages(eventId: string, reg: Region): Promise<StageRow[]> {
  return sql<StageRow>(
    `select s.id::text as stage_id, s.seq, stx.name,
            st.id::text as tier_id, st.difficulty::text as difficulty,
            st.sta_cost, stt.boss_note,
            (select count(*) from clear c
               join event_run r on r.id = c.run_id
              where c.stage_tier_id = st.id and r.reg = $2
                and c.status = 'published')::int as clears
     from stage s
     join stage_tier st on st.stage_id = s.id
     left join stage_text stx on stx.stage_id = s.id and stx.locale = 'en'
     left join stage_tier_text stt on stt.stage_tier_id = st.id and stt.locale = 'en'
     where s.event_id = $1::bigint
     order by s.seq, st.difficulty`,
    [eventId, reg],
  )
}

export type ClearCard = {
  rotation_index: number
  pos: number
  role: 'leader' | 'member' | 'friend'
  card_id: string
  name: string
  epithet: string
  type: string
  class: string
  rarity: string
  thumb_key: string | null
}

export type ClearProof = {
  kind: 'screenshot' | 'video'
  provider: string | null
  url: string
}

export type ClearRow = {
  id: string
  version_id: string
  handle: string
  turns: number | null
  no_items: boolean
  deathless: boolean
  score: number
  has_proof: boolean
  note: string | null
  // La lingua in cui l'autore ha scritto la nota: è testo libero, quindi
  // non si può dare per scontato che sia inglese come i dati del gioco.
  note_lang: string | null
  created_at: Date
  versions: number
  lifetime_score: number
  proofs: ClearProof[]
  cards: ClearCard[]
}

export const CLEAR_PER_PAGINA = 20

/** I clear di una difficoltà in una regione, con la squadra e le prove. */
export async function listClears(
  tierId: string,
  reg: Region,
  { limit = CLEAR_PER_PAGINA, offset = 0 }: { limit?: number; offset?: number } = {},
): Promise<ClearRow[]> {
  return sql<ClearRow>(
    `select c.id::text, c.version_id::text, u.handle, c.turns, c.no_items,
            c.deathless, c.score::int, c.has_proof, c.note, c.lang as note_lang,
            c.created_at, rep.versions::int, rep.lifetime_score::int,
            coalesce((
              select json_agg(json_build_object(
                       'kind', p.kind, 'provider', p.provider, 'url', p.url)
                     order by p.kind desc, p.url)
              from clear_proof p
              where p.version_id = c.version_id and p.is_reachable is not false
            ), '[]'::json) as proofs,
            coalesce((
              select json_agg(json_build_object(
                       'rotation_index', cl.rotation_index, 'pos', cl.pos,
                       'role', cl.role, 'card_id', cl.card_id::text,
                       'name', ct.name, 'epithet', ct.epithet,
                       'type', cd.type::text, 'class', cd.class::text,
                       'rarity', cd.rarity::text, 'thumb_key', cd.thumb_key)
                     order by cl.rotation_index, cl.pos)
              from clear_card cl
              join card cd on cd.id = cl.card_id
              left join card_text ct on ct.card_id = cl.card_id and ct.locale = 'en'
              where cl.version_id = c.version_id
            ), '[]'::json) as cards
     from clear_current c
     join app_user u on u.id = c.author_id
     join clear_reputation rep on rep.clear_id = c.id
     where c.stage_tier_id = $1::bigint and c.reg = $2 and c.status = 'published'
     order by c.has_proof desc, c.score desc, c.turns nulls last, c.id
     limit $3 offset $4`,
    [tierId, reg, limit, offset],
  )
}
