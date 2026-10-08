import 'server-only'
import { sql, sqlOne } from '@/lib/db'
import type { Region } from '@/lib/queries'
import { buildJson, type SlotBuild } from '@/lib/clears/build'
import type { BuilderBuild, BuilderPayload, BuilderProof, ProofKind, SlotRole } from '@/lib/clears/validate'

// Le letture dei clear che servono al builder e alle pagine di un clear:
// la modifica, gli assetti successivi, il voto di chi guarda, i commenti.
// L'id dell'utente arriva sempre dal chiamante, che lo prende dalla
// sessione (lib/dal.ts): qui non si decide chi e' l'utente.

export type LineupCard = {
  rotation_index: number
  pos: number
  role: SlotRole
  card_id: string
  name: string | null
  epithet: string | null
  type: string
  class: string
  rarity: string
  thumb_key: string | null
  /** la build congelata dello slot (0018), o null */
  build: SlotBuild | null
}

export type VersionLineup = {
  version_id: string
  seq: number
  label: string | null
  note: string | null
  cards: LineupCard[]
}

// Le carte di un assetto come JSON. Le stesse colonne da clear_lineup_card
// (per assetto) o da clear_card (solo il #1, per i clear nati prima del 0016).
const cardsJson = (alias: string, from: 'clear_lineup_card' | 'clear_card' = 'clear_lineup_card') => `coalesce((
  select json_agg(json_build_object(
           'rotation_index', k.rotation_index, 'pos', k.pos, 'role', k.role,
           'card_id', k.card_id::text, 'name', ct.name, 'epithet', ct.epithet,
           'type', cd.type::text, 'class', cd.class::text, 'rarity', cd.rarity::text,
           'thumb_key', cd.thumb_key,
           'build', ${from === 'clear_lineup_card'
             ? buildJson('k.version_id', 'k.seq', 'k.rotation_index', 'k.pos')
             : buildJson('k.version_id', '1', 'k.rotation_index', 'k.pos')})
         order by k.rotation_index, k.pos)
  from ${from} k
  join card cd on cd.id = k.card_id
  left join card_text ct on ct.card_id = k.card_id and ct.locale = 'en'
  where k.version_id = ${alias}.version_id${from === 'clear_lineup_card' ? ` and k.seq = ${alias}.seq` : ''}
), '[]'::json)`

/**
 * Gli assetti congelati di alcune versioni, in ordine. Con fromSeq = 2
 * solo i cambi a meta' evento (il #1 le pagine lo leggono da clear_card).
 * I clear nati prima del 0016 non hanno righe qui: per loro esiste solo
 * l'assetto di partenza.
 */
export async function getVersionLineups(versionIds: string[], fromSeq = 1): Promise<VersionLineup[]> {
  if (!versionIds.length) return []
  return sql<VersionLineup>(
    `select l.version_id::text, l.seq, l.label, l.note, ${cardsJson('l')} as cards
     from clear_lineup l
     where l.version_id = any ($1::uuid[]) and l.seq >= $2
     order by l.version_id, l.seq`,
    [versionIds, fromSeq],
  )
}

/** Il voto di chi guarda sulle versioni mostrate: version_id -> -1 | 1. */
export async function getViewerVotes(userId: string | null, versionIds: string[]): Promise<Map<string, -1 | 1>> {
  if (!userId || !versionIds.length) return new Map()
  const rows = await sql<{ version_id: string; value: -1 | 1 }>(
    `select version_id::text, value from clear_vote
     where user_id = $1 and version_id = any ($2::uuid[])`,
    [userId, versionIds],
  )
  return new Map(rows.map((r) => [r.version_id, r.value]))
}

export type ClearComment = {
  id: string
  handle: string
  body: string
  lang: string | null
  created_at: Date
  /** Vero se l'ha scritto l'autore del clear: le pagine lo segnano. */
  by_author: boolean
}

/**
 * I commenti di una versione, dal piu' vecchio: si leggono come un filo.
 * Solo quelli pubblicati di un clear pubblicato: un commento nascosto da
 * un moderatore sparisce del tutto, senza segnaposto (0024).
 */
export async function getComments(versionId: string, { limit = 100, offset = 0 } = {}): Promise<ClearComment[]> {
  return sql<ClearComment>(
    `select m.id::text, u.handle::text, m.body, m.lang, m.created_at,
            (m.author_id = c.author_id) as by_author
     from clear_comment m
     join app_user u on u.id = m.author_id
     join clear_version v on v.id = m.version_id
     join clear c on c.id = v.clear_id
     where m.version_id = $1::uuid and m.status = 'published' and c.status = 'published'
     order by m.created_at, m.id
     limit $2 offset $3`,
    [versionId, Math.min(limit, 200), offset],
  )
}

export type VersionCounts = { version_id: string; votes: number; comments: number; changes: number }

/** Quanti voti, commenti e cambi di assetto ha ogni versione. */
export async function getVersionCounts(versionIds: string[]): Promise<Map<string, VersionCounts>> {
  if (!versionIds.length) return new Map()
  const rows = await sql<VersionCounts>(
    `select v.id::text as version_id,
            (select count(*) from clear_vote x where x.version_id = v.id)::int as votes,
            (select count(*) from clear_comment x
              where x.version_id = v.id and x.status = 'published')::int as comments,
            (select count(*) from clear_lineup x where x.version_id = v.id and x.seq > 1)::int as changes
     from clear_version v where v.id = any ($1::uuid[])`,
    [versionIds],
  )
  return new Map(rows.map((r) => [r.version_id, r]))
}

/**
 * Una build congelata nella forma del payload: le sfere tornano un array
 * per posizione ([null, 812] = solo lo slot 2), senza null in coda.
 */
export function buildDaVersione(b: SlotBuild): BuilderBuild {
  const equipment: (number | null)[] = [null, null, null]
  for (const e of b.equipment) if (e.slot >= 1 && e.slot <= 3) equipment[e.slot - 1] = Number(e.id)
  while (equipment.length && equipment[equipment.length - 1] === null) equipment.pop()
  return { hp_routes: b.hp_routes, hp_path: b.hp_path, note: b.note, equipment }
}

export type ClearForEdit = {
  id: string
  event_id: string
  run_id: string
  tier_id: string
  reg: Region
  version_id: string
  version_seq: number
  /** 'hidden' se un moderatore l'ha nascosto (0024): l'autore lo puo' ancora rivedere */
  status: string
  /** Il modulo gia' pieno, nella forma che submit/revise accettano. */
  payload: BuilderPayload
  /** Gli stessi assetti con nomi e miniature, per mostrarli nel builder. */
  lineups: VersionLineup[]
}

/**
 * Il clear da modificare, solo se e' dell'utente: per chiunque altro null,
 * come se non esistesse (la pagina risponde 404 e non rivela niente).
 */
export async function getClearForEdit(clearId: string, userId: string): Promise<ClearForEdit | null> {
  const head = await sqlOne<Omit<ClearForEdit, 'payload' | 'lineups'> & {
    no_items: boolean; deathless: boolean; turns: number | null; note: string | null
    lang: string | null; label: string | null; lineup_note: string | null
  }>(
    `select c.id::text, c.event_id::text, c.run_id::text, c.stage_tier_id::text as tier_id,
            c.reg::text as reg, c.version_id::text, c.version_seq, c.status, c.no_items, c.deathless,
            c.turns, c.note, c.lang, c.lineup_snapshot->>'label' as label,
            c.lineup_snapshot->>'note' as lineup_note
     from clear_current c
     where c.id = $1::uuid and c.author_id = $2::uuid`,
    [clearId, userId],
  )
  if (!head) return null

  let lineups = await getVersionLineups([head.version_id])
  // Un clear nato prima del 0016: solo l'assetto di partenza, da clear_card
  if (!lineups.length) {
    lineups = await sql<VersionLineup>(
      `select $1::text as version_id, 1 as seq, $2::text as label, $3::text as note,
              ${cardsJson('x', 'clear_card')} as cards
       from (select $1::uuid as version_id) x`,
      [head.version_id, head.label, head.lineup_note],
    )
  }
  const proofs = await sql<BuilderProof>(
    `select kind, url from clear_proof where version_id = $1::uuid order by added_at, id`,
    [head.version_id],
  )

  const { no_items, deathless, turns, note, lang } = head
  return {
    id: head.id, event_id: head.event_id, run_id: head.run_id, tier_id: head.tier_id,
    reg: head.reg, version_id: head.version_id, version_seq: head.version_seq, status: head.status,
    lineups,
    payload: {
      lineups: lineups.map((l) => ({
        label: l.label,
        note: l.note,
        slots: l.cards.map((k) => ({
          rot: k.rotation_index as 1 | 2 | 3, pos: k.pos, card_id: Number(k.card_id), role: k.role,
          ...(k.build ? { build: buildDaVersione(k.build) } : {}),
        })),
      })),
      no_items, deathless, turns, note,
      lang: lang === 'en' || lang === 'ja' ? lang : null,
      proofs: proofs.map((p) => ({ kind: p.kind as ProofKind, url: p.url })),
    },
  }
}

export type ClearVersionRow = {
  version_id: string
  seq: number
  is_current: boolean
  change_note: string | null
  score: number
  created_at: Date
}

/** La storia di un clear, dalla versione piu' recente. */
export async function getClearVersions(clearId: string): Promise<ClearVersionRow[]> {
  return sql<ClearVersionRow>(
    `select v.id::text as version_id, v.seq, v.is_current, v.change_note, v.score, v.created_at
     from clear_version v join clear c on c.id = v.clear_id
     where v.clear_id = $1::uuid and c.status = 'published'
     order by v.seq desc`,
    [clearId],
  )
}

export type RunOption = { id: string; starts_at: Date; ends_at: Date | null; status: 'active' | 'past' }

/**
 * Le ricorrenze di un evento in una regione per cui si puo' inviare un
 * clear: quelle gia' iniziate (submit_clear rifiuta le altre), dalla
 * piu' recente. Il builder parte da quella mostrata nella pagina.
 */
export async function listStartedRuns(eventId: string, reg: Region): Promise<RunOption[]> {
  return sql<RunOption>(
    `select es.run_id::text as id, es.starts_at, es.ends_at, es.status
     from event_status es
     where es.event_id = $1::bigint and es.reg = $2 and es.starts_at <= now()
     order by es.starts_at desc`,
    [eventId, reg],
  )
}

// ---------------------------------------------------------------------
//  Chi guarda e cosa tocca una scrittura (cache: /api/me, lib/cache/*)
// ---------------------------------------------------------------------

/** Lo stato di chi guarda su un tier: i suoi voti, i suoi clear, i punteggi vivi. */
export type ViewerTierState = {
  votes: Record<string, -1 | 1>
  own: string[]
  scores: Record<string, number>
  /** i commenti pubblicati di chi guarda sulle versioni correnti del tier */
  ownComments: string[]
}

/** Oltre questi clear per tier i punteggi vivi si fermano: la pagina ne mostra 20. */
const PUNTEGGI_MAX = 500

/**
 * Per /api/me?tier=: la pagina in cache e' quella anonima, e qui arriva
 * cio' che dipende da chi guarda. I punteggi ci sono perche' la copia della
 * CDN puo' essere vecchia di un voto: chi ha votato vede sempre il vero.
 * Gli id dell'autore non escono: si confrontano qui.
 */
export async function viewerTierState(userId: string, tierId: string): Promise<ViewerTierState> {
  // le due letture in parallelo: /api/me e' sul percorso di ogni pagina vista
  const [rows, ownComments] = await Promise.all([sql<{
    version_id: string; clear_id: string; score: number; value: -1 | 1 | null; own: boolean
  }>(
    `select c.version_id::text, c.id::text as clear_id, c.score::int, v.value::int as value,
            (c.author_id = $1::uuid) as own
     from clear_current c
     left join clear_vote v on v.version_id = c.version_id and v.user_id = $1::uuid
     where c.stage_tier_id = $2::bigint and c.status = 'published'
     order by (v.user_id is not null or c.author_id = $1::uuid) desc,
              c.has_proof desc, c.score desc, c.turns nulls last, c.id
     limit $3`,
    [userId, tierId, PUNTEGGI_MAX],
  ), ownCommentsInTier(userId, tierId)])
  const out: ViewerTierState = { votes: {}, own: [], scores: {}, ownComments }
  for (const r of rows) {
    out.scores[r.version_id] = r.score
    if (r.value === 1 || r.value === -1) out.votes[r.version_id] = r.value
    if (r.own) out.own.push(r.clear_id)
  }
  return out
}

/**
 * I commenti di chi guarda che la pagina del tier puo' mostrare: quelli
 * pubblicati, sulla versione corrente di un clear pubblicato (come
 * getComments). Su questi il bottone Report non compare.
 */
async function ownCommentsInTier(userId: string, tierId: string): Promise<string[]> {
  const rows = await sql<{ id: string }>(
    `select m.id::text
     from clear_comment m
     join clear_current c on c.version_id = m.version_id
     where m.author_id = $1::uuid and c.stage_tier_id = $2::bigint
       and m.status = 'published' and c.status = 'published'
     order by m.created_at desc
     limit $3`,
    [userId, tierId, PUNTEGGI_MAX],
  )
  return rows.map((r) => r.id)
}

export type HiddenClear = { id: string; event_id: string; event_name: string | null; created_at: Date }

/**
 * I clear dell'utente che un moderatore ha nascosto (0024), per Settings:
 * fuori dalle liste, senza questo l'autore non saprebbe dove trovarli per
 * cambiarli o cancellarli. Solo i suoi: userId viene dalla sessione.
 */
export async function hiddenClearsOf(userId: string): Promise<HiddenClear[]> {
  return sql<HiddenClear>(
    `select c.id::text, c.event_id::text, et.name as event_name, c.created_at
     from clear c
     left join event_text et on et.event_id = c.event_id and et.locale = 'en'
     where c.author_id = $1::uuid and c.status = 'hidden'
     order by c.created_at desc, c.id
     limit 50`,
    [userId],
  )
}

/** Le carte di tutte le versioni di un clear, assetti a meta' evento compresi. */
export async function clearCardIds(clearId: string): Promise<string[]> {
  const rows = await sql<{ id: string }>(
    `select distinct k.card_id::text as id
     from clear_version v
     join lateral (
       select card_id from clear_card where version_id = v.id
       union select card_id from clear_lineup_card where version_id = v.id
     ) k on true
     where v.clear_id = $1::uuid`,
    [clearId],
  )
  return rows.map((r) => r.id)
}

export type UserFootprint = { eventIds: string[]; cardIds: string[]; handles: string[] }

/**
 * Le pagine pubbliche che mostrano qualcosa di un utente: gli eventi dei
 * suoi clear, dei clear che ha commentato o votato; le carte dei suoi
 * clear; il suo profilo e quello degli autori che ha votato (i voti
 * ricevuti stanno nel profilo). Da leggere PRIMA di cancellare.
 */
export async function userFootprint(userId: string, extraHandles: string[] = []): Promise<UserFootprint> {
  const [eventi, carte, handle] = await Promise.all([
    sql<{ id: string }>(
      `select c.event_id::text as id from clear c where c.author_id = $1::uuid
       union select c.event_id::text from clear_comment m
         join clear_version v on v.id = m.version_id join clear c on c.id = v.clear_id
        where m.author_id = $1::uuid
       union select c.event_id::text from clear_vote x
         join clear_version v on v.id = x.version_id join clear c on c.id = v.clear_id
        where x.user_id = $1::uuid`,
      [userId],
    ),
    sql<{ id: string }>(
      `select k.card_id::text as id from clear c
         join clear_version v on v.clear_id = c.id
         join clear_card k on k.version_id = v.id
        where c.author_id = $1::uuid
       union select k.card_id::text from clear c
         join clear_version v on v.clear_id = c.id
         join clear_lineup_card k on k.version_id = v.id
        where c.author_id = $1::uuid`,
      [userId],
    ),
    sql<{ handle: string }>(
      `select u.handle::text as handle from app_user u where u.id = $1::uuid
       union select a.handle::text from clear_vote x
         join clear_version v on v.id = x.version_id join clear c on c.id = v.clear_id
         join app_user a on a.id = c.author_id
        where x.user_id = $1::uuid`,
      [userId],
    ),
  ])
  return {
    eventIds: eventi.map((r) => r.id),
    cardIds: carte.map((r) => r.id),
    handles: [...new Set([...handle.map((r) => r.handle), ...extraHandles])],
  }
}
