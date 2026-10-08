import { sql, sqlOne } from '@/lib/db'
import { buildJson, type SlotBuild } from '@/lib/clears/build'

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
  // Gli eventi presi dal gioco non hanno banner: al suo posto la miniatura
  // della carta del boss principale (event.cover_card_id).
  cover_thumb_key: string | null
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
            cv.thumb_key as cover_thumb_key,
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
     left join card cv on cv.id = e.cover_card_id
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
  cover_thumb_key: string | null
  // Null quando l'evento non è mai uscito in questa regione: il left join
  // laterale restituisce l'evento comunque, senza una run da mostrare.
  status: Status | null
  starts_at: Date | null
  ends_at: Date | null
  ends_at_known: boolean | null
  source: RunSource | null
  // La ricorrenza mostrata: le missioni si scelgono su questa
  run_id: string | null
}

export async function getEvent(id: string, reg: Region): Promise<EventDetail | null> {
  return sqlOne<EventDetail>(
    `select e.id::text, et.name, e.kind::text as kind,
            et.official_description as description, e.banner_key,
            cv.thumb_key as cover_thumb_key,
            u.status, u.starts_at, u.ends_at, u.ends_at_known, u.source, u.run_id
     from event e
     join event_text et on et.event_id = e.id and et.locale = 'en'
     left join card cv on cv.id = e.cover_card_id
     left join lateral (
       select es.status, es.starts_at, es.ends_at, r.ends_at_known, r.source, es.run_id::text as run_id
       from event_status es
       join event_run r on r.id = es.run_id
       where es.event_id = e.id and es.reg = $2
       order by ${ORDINE_RUN} limit 1
     ) u on true
     where e.id = $1::bigint`,
    [id, reg],
  )
}

export type MissionReward = {
  name: string
  quantity: number
  // l'icona del catalogo premi, o la miniatura se il premio è una carta
  icon_key: string | null
}

export type MissionRow = {
  id: string
  seq: number | null
  name: string | null
  description: string
  ends_at: Date | null
  rewards: MissionReward[]
}

/**
 * Le missioni di una ricorrenza: quelle legate a lei, più quelle senza una
 * scadenza propria (run_id nullo), che nel gioco ci sono ogni volta che
 * l'evento è aperto. Le missioni di una ricorrenza passata restano fuori:
 * appartenevano a quella, non a questa.
 */
export async function getMissions(eventId: string, runId: string | null): Promise<MissionRow[]> {
  return sql<MissionRow>(
    `select m.id::text, m.seq, mt.name, mt.description, m.ends_at,
            coalesce((
              select json_agg(json_build_object(
                       'name', coalesce(git.name, r.item_type),
                       'quantity', r.quantity,
                       'icon_key', coalesce(ri.asset_key, c.thumb_key))
                     order by r.seq)
              from mission_reward r
              join game_item gi on gi.item_type = r.item_type and gi.item_id = r.item_id
              left join game_item_text git on git.item_type = r.item_type
                    and git.item_id = r.item_id and git.locale = 'en'
              left join reward_item ri on ri.slug = gi.reward_item_slug
              left join card c on c.id = gi.card_id
              where r.mission_id = m.id
            ), '[]'::json) as rewards
     from mission m
     join mission_text mt on mt.mission_id = m.id and mt.locale = 'en'
     where m.event_id = $1::bigint
       and (m.run_id is null or m.run_id = $2::bigint)
     order by m.seq nulls last, m.id`,
    [eventId, runId],
  )
}

export type EventLink = { id: string; name: string }

/**
 * Il legame fra un'EZA e la sua versione Super. Nel gioco la Super EZA
 * punta allo stage dell'EZA normale (related_game_id); qui si risale agli
 * eventi da entrambi i lati, così ciascuna pagina può linkare l'altra.
 */
export async function getEzaLinks(eventId: string): Promise<{ normal: EventLink | null; supers: EventLink[] }> {
  const righe = await sql<EventLink & { verso: 'normal' | 'super' }>(
    `select r2.event_id::text as id, et.name, 'normal' as verso
     from event_game_ref r1
     join event_game_ref r2 on r2.game_kind = r1.game_kind and r2.game_id = r1.related_game_id
     join event_text et on et.event_id = r2.event_id and et.locale = 'en'
     where r1.event_id = $1::bigint and r1.related_game_id is not null
     union all
     select r1.event_id::text, et.name, 'super'
     from event_game_ref r2
     join event_game_ref r1 on r1.game_kind = r2.game_kind and r1.related_game_id = r2.game_id
     join event_text et on et.event_id = r1.event_id and et.locale = 'en'
     where r2.event_id = $1::bigint and r2.game_kind = 'z_battle_stage'
     order by 1`,
    [eventId],
  )
  const normal = righe.find((r) => r.verso === 'normal')
  return {
    normal: normal ? { id: normal.id, name: normal.name } : null,
    supers: righe.filter((r) => r.verso === 'super').map(({ id, name }) => ({ id, name })),
  }
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
  // NULL per le carte che il wiki non ha ancora documentato (0015)
  epithet: string | null
  type: string
  class: string
  rarity: string
  thumb_key: string | null
  // La build dello slot (0018), null se non c'e'. I clear di prima del
  // 0016 non hanno assetti congelati e quindi nemmeno build.
  build: SlotBuild | null
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
  // I cambi di assetto a meta' evento della versione mostrata (0016): le
  // carte si leggono con getVersionLineups, qui solo quanti sono.
  changes: number
  comments: number
}

export const CLEAR_PER_PAGINA = 20

/**
 * L'ordine dei clear di un tier: prima quelli con prova, poi i piu'
 * votati. Unico per tutto il sito, cosi' clearPage() trova la pagina dove
 * la lista mostra davvero un clear (profili, pagina carta, moderazione).
 * Vuole l'alias c su clear_current.
 */
export const ORDINE_CLEAR = 'c.has_proof desc, c.score desc, c.turns nulls last, c.id'

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
                       'rarity', cd.rarity::text, 'thumb_key', cd.thumb_key,
                       'build', ${buildJson('cl.version_id', '1', 'cl.rotation_index', 'cl.pos')})
                     order by cl.rotation_index, cl.pos)
              from clear_card cl
              join card cd on cd.id = cl.card_id
              left join card_text ct on ct.card_id = cl.card_id and ct.locale = 'en'
              where cl.version_id = c.version_id
            ), '[]'::json) as cards,
            (select count(*) from clear_lineup l
              where l.version_id = c.version_id and l.seq > 1)::int as changes,
            (select count(*) from clear_comment m
              where m.version_id = c.version_id)::int as comments
     from clear_current c
     join app_user u on u.id = c.author_id
     join clear_reputation rep on rep.clear_id = c.id
     where c.stage_tier_id = $1::bigint and c.reg = $2 and c.status = 'published'
     order by ${ORDINE_CLEAR}
     limit $3 offset $4`,
    [tierId, reg, limit, offset],
  )
}

/** La pagina (da 1) della lista del suo tier in cui sta un clear, o null. */
export async function clearPage(tierId: string, reg: Region, clearId: string): Promise<number | null> {
  const r = await sqlOne<{ n: number }>(
    `select x.n::int from (
       select c.id, row_number() over (order by ${ORDINE_CLEAR}) as n
       from clear_current c
       where c.stage_tier_id = $1::bigint and c.reg = $2 and c.status = 'published'
     ) x where x.id = $3::uuid`,
    [tierId, reg, clearId],
  )
  return r ? Math.ceil(r.n / CLEAR_PER_PAGINA) : null
}

// ---------------------------------------------------------------------
//  Per la cache (lib/cache/data.ts): quando cambia lo stato, cosa
//  prerenderizzare, cosa mettere nella sitemap
// ---------------------------------------------------------------------

/**
 * Fra quanti secondi il prossimo inizio o fine di una ricorrenza (di un
 * evento, o di tutti con null). event_status calcola Ongoing ed Ended da
 * now(): una pagina in cache deve scadere a quel confine, non un giorno
 * dopo. null: nessun confine in futuro.
 */
export async function secondsToNextStatusChange(eventId: string | null): Promise<number | null> {
  const r = await sqlOne<{ s: number | null }>(
    `select ceil(extract(epoch from min(t) - now()))::int as s from (
       select starts_at as t from event_run
        where starts_at > now() and ($1::bigint is null or event_id = $1::bigint)
       union all
       select ends_at from event_run
        where ends_at > now() and ($1::bigint is null or event_id = $1::bigint)
     ) x`,
    [eventId],
  )
  return r?.s ?? null
}

/** Quanti eventi si prerenderizzano al build: ogni pagina costa tempo di build e spazio. */
export const EVENTI_STATICI_MAX = 100

/**
 * Gli eventi Global in corso o in arrivo con una fine nota, i piu' vicini
 * alla fine per primi: sono quelli che si aprono adesso. Mai vuota (con
 * cacheComponents generateStaticParams deve dare almeno un id): senza
 * eventi cosi' resta il piu' recente.
 */
export async function staticEventIds(limit = EVENTI_STATICI_MAX): Promise<string[]> {
  const righe = await sql<{ id: string }>(
    `select x.id from (
       select distinct on (es.event_id) es.event_id::text as id, es.ends_at
       from event_status es
       join event_text et on et.event_id = es.event_id and et.locale = 'en'
       where es.reg = 'global' and es.status in ('active', 'upcoming') and es.ends_at is not null
       order by es.event_id, es.ends_at
     ) x order by x.ends_at, x.id limit $1`,
    [limit],
  )
  if (righe.length) return righe.map((r) => r.id)
  const ultimo = await sqlOne<{ id: string }>(
    `select e.id::text from event e
     join event_text et on et.event_id = e.id and et.locale = 'en'
     order by e.id desc limit 1`,
  )
  return ultimo ? [ultimo.id] : []
}

/** Tutti gli eventi che si mostrano (hanno il nome in inglese), per la sitemap. */
export async function sitemapEvents(): Promise<{ id: string; ultima: Date | null }[]> {
  return sql<{ id: string; ultima: Date | null }>(
    `select e.id::text, max(r.starts_at) filter (where r.starts_at <= now()) as ultima
     from event e
     join event_text et on et.event_id = e.id and et.locale = 'en'
     left join event_run r on r.event_id = e.id
     group by e.id
     order by ultima desc nulls last, e.id desc`,
  )
}
