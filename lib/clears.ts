import 'server-only'
import { sql, sqlOne } from '@/lib/db'
import type { Region } from '@/lib/queries'
import type { BuilderPayload, BuilderProof, ProofKind, SlotRole } from '@/lib/clears/validate'

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
           'thumb_key', cd.thumb_key)
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

/** I commenti di una versione, dal piu' vecchio: si leggono come un filo. */
export async function getComments(versionId: string, { limit = 100, offset = 0 } = {}): Promise<ClearComment[]> {
  return sql<ClearComment>(
    `select m.id::text, u.handle::text, m.body, m.lang, m.created_at,
            (m.author_id = c.author_id) as by_author
     from clear_comment m
     join app_user u on u.id = m.author_id
     join clear_version v on v.id = m.version_id
     join clear c on c.id = v.clear_id
     where m.version_id = $1::uuid
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
            (select count(*) from clear_comment x where x.version_id = v.id)::int as comments,
            (select count(*) from clear_lineup x where x.version_id = v.id and x.seq > 1)::int as changes
     from clear_version v where v.id = any ($1::uuid[])`,
    [versionIds],
  )
  return new Map(rows.map((r) => [r.version_id, r]))
}

export type ClearForEdit = {
  id: string
  event_id: string
  run_id: string
  tier_id: string
  reg: Region
  version_id: string
  version_seq: number
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
            c.reg::text as reg, c.version_id::text, c.version_seq, c.no_items, c.deathless,
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
    reg: head.reg, version_id: head.version_id, version_seq: head.version_seq,
    lineups,
    payload: {
      lineups: lineups.map((l) => ({
        label: l.label,
        note: l.note,
        slots: l.cards.map((k) => ({
          rot: k.rotation_index as 1 | 2 | 3, pos: k.pos, card_id: Number(k.card_id), role: k.role,
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

/**
 * Quali dei clear mostrati sono dell'utente: le pagine ci mettono Edit e
 * Delete. L'id dell'autore non esce dal server, si confronta qui.
 */
export async function ownClearIds(userId: string | null, clearIds: string[]): Promise<Set<string>> {
  if (!userId || !clearIds.length) return new Set()
  const rows = await sql<{ id: string }>(
    `select id::text from clear where author_id = $1::uuid and id = any ($2::uuid[])`,
    [userId, clearIds],
  )
  return new Set(rows.map((r) => r.id))
}
