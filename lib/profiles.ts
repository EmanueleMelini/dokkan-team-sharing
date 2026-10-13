import 'server-only'
import { sql, sqlOne } from '@/lib/db'
import { CLEAR_PER_PAGINA, ORDINE_CLEAR, type Region } from '@/lib/queries'
import { HANDLE } from '@/lib/auth/handle-change'

// Le letture del profilo pubblico (/users/<handle>). Modulo puro: niente
// cacheTag ne' cacheLife, i test lo importano fuori da Next; la cache sta
// in lib/cache/profiles.ts.
//
// Gli utenti si leggono SOLO dalla vista public_profile (0026), che ha un
// elenco chiuso di colonne: mai app_user direttamente, cosi' email, avatar
// del provider, ruolo e motivo di una sospensione non possono finire su
// una pagina pubblica per una join scritta di fretta. L'id dell'utente
// resta dentro le query: i componenti ricevono solo l'handle.

/** L'handle dal segmento dell'URL, o null (un 404 senza query). */
export function parseHandle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  let s = raw
  try { s = decodeURIComponent(raw) } catch { return null }
  return HANDLE.test(s) ? s : null
}

export type PublicProfile = {
  handle: string
  reg: Region
  joined_at: Date
  /** i clear pubblicati */
  clears: number
  /** i +1 su tutte le versioni dei clear pubblicati; mai i -1 */
  upvotes: number
  /** i commenti pubblicati su clear pubblicati */
  comments: number
}

/**
 * Cosa c'e' a /users/<handle>:
 * - found: il profilo, piu' gli eventi dei suoi clear e commenti (solo per
 *   i tag della cache: un voto o un commento su quegli eventi rinfresca i
 *   conteggi);
 * - moved: un handle lasciato, con quello attuale (308);
 * - null: nessuno, o chi non ha finito /welcome, o un sospeso (404).
 */
export type ProfileLookup =
  | { kind: 'found'; profile: PublicProfile; eventIds: string[] }
  | { kind: 'moved'; handle: string }
  | null

/** Quanti eventi al massimo diventano tag di una voce (Next ne tiene 128). */
const EVENTI_TAG_MAX = 100

export async function resolveHandle(raw: unknown): Promise<ProfileLookup> {
  const handle = parseHandle(raw)
  if (!handle) return null
  const p = await sqlOne<PublicProfile & { event_ids: string[] }>(
    `select p.handle::text as handle, p.reg::text as reg, p.joined_at,
            p.clears, p.upvotes, p.comments,
            array(select e from (
                    select c.event_id::text as e from clear c
                     where c.author_id = p.id and c.status = 'published'
                    union
                    select c.event_id::text from clear_comment m
                      join clear_version v on v.id = m.version_id
                      join clear c on c.id = v.clear_id
                     where m.author_id = p.id and m.status = 'published'
                  ) x order by e limit ${EVENTI_TAG_MAX}) as event_ids
     from public_profile p
     where p.handle = $1::citext`,
    [handle],
  )
  if (p) {
    const { event_ids: eventIds, ...profile } = p
    return { kind: 'found', profile, eventIds }
  }
  // Un nome lasciato porta a quello attuale, se il profilo e' visibile:
  // il vecchio nome di un sospeso e' un 404 come il nuovo.
  const m = await sqlOne<{ handle: string }>(
    `select p.handle::text as handle
     from handle_history h join public_profile p on p.id = h.user_id
     where h.handle = $1::citext`,
    [handle],
  )
  return m ? { kind: 'moved', handle: m.handle } : null
}

// ---------------------------------------------------------------------
//  I clear di un profilo
// ---------------------------------------------------------------------

/** Come la lista di un tier: venti per pagina. */
export const PROFILE_CLEARS_PER_PAGE = CLEAR_PER_PAGINA

export type ProfileCard = {
  card_id: string
  rot: number
  pos: number
  role: string
  thumb_key: string | null
  /** la miniatura e' il solo personaggio (asset_bare, 0034) */
  thumb_bare: boolean
  name: string | null
  /** il tipo, per il segnaposto di una carta senza miniatura */
  type: string
}

export type ProfileClear = {
  id: string
  event_id: string
  tier_id: string
  reg: Region
  difficulty: string
  stage_seq: number
  /** 'Event <id>' se l'evento non ha ancora un nome inglese */
  event_name: string
  stage_name: string | null
  turns: number | null
  no_items: boolean
  deathless: boolean
  has_proof: boolean
  score: number
  created_at: Date
  versions: number
  /** la squadra di partenza (clear_card, le sette carte): non gli assetti dopo */
  cards: ProfileCard[]
  /** la pagina del tier in cui la lista dell'evento mostra il clear (ORDINE_CLEAR) */
  page: number
}

/**
 * I clear pubblicati di un handle (quello attuale), dal piu' recente; a
 * parita' di data l'id piu' alto. La pagina di ogni clear si calcola con
 * lo stesso ORDINE_CLEAR della lista dell'evento, nella sua regione: il
 * link arriva dove il clear si vede davvero.
 */
export async function listUserClears(
  handle: string,
  { limit = PROFILE_CLEARS_PER_PAGE, offset = 0 }: { limit?: number; offset?: number } = {},
): Promise<ProfileClear[]> {
  if (!HANDLE.test(handle)) return []
  return sql<ProfileClear>(
    `with mine as (
       select c.* from clear_current c
       join public_profile p on p.id = c.author_id
       where p.handle = $1::citext and c.status = 'published'
       order by c.created_at desc, c.id desc
       limit $2 offset $3
     ),
     ranked as (
       select c.id, row_number() over (partition by c.stage_tier_id, c.reg order by ${ORDINE_CLEAR}) as rn
       from clear_current c
       where c.status = 'published'
         and (c.stage_tier_id, c.reg) in (select stage_tier_id, reg from mine)
     )
     select c.id::text, c.event_id::text, c.stage_tier_id::text as tier_id, c.reg::text as reg,
            c.difficulty::text as difficulty, c.stage_seq,
            coalesce(et.name, 'Event ' || c.event_id) as event_name, stx.name as stage_name,
            c.turns, c.no_items, c.deathless, c.has_proof, c.score::int, c.created_at,
            rep.versions::int,
            coalesce((
              select json_agg(json_build_object(
                       'card_id', cl.card_id::text, 'rot', cl.rotation_index, 'pos', cl.pos,
                       'role', cl.role, 'thumb_key', cd.thumb_key, 'thumb_bare', asset_bare(cd.thumb_key),
                       'name', ct.name, 'type', cd.type::text)
                     order by cl.rotation_index, cl.pos)
              from clear_card cl
              join card cd on cd.id = cl.card_id
              left join card_text ct on ct.card_id = cl.card_id and ct.locale = 'en'
              where cl.version_id = c.version_id
            ), '[]'::json) as cards,
            ceil(r.rn / $4::numeric)::int as page
     from mine c
     join ranked r on r.id = c.id
     join clear_reputation rep on rep.clear_id = c.id
     join stage_tier st on st.id = c.stage_tier_id
     left join event_text et on et.event_id = c.event_id and et.locale = 'en'
     left join stage_text stx on stx.stage_id = st.stage_id and stx.locale = 'en'
     order by c.created_at desc, c.id desc`,
    [handle, limit, offset, CLEAR_PER_PAGINA],
  )
}

// ---------------------------------------------------------------------
//  Il build
// ---------------------------------------------------------------------

/** Quanti profili si prerenderizzano al build: gli altri nascono alla prima visita. */
export const PROFILI_STATICI_MAX = 20

/** I profili con piu' clear pubblicati (solo quelli con almeno uno). */
export async function staticProfileHandles(limit = PROFILI_STATICI_MAX): Promise<string[]> {
  const righe = await sql<{ handle: string }>(
    `select p.handle::text as handle from public_profile p
     where p.clears > 0
     order by p.clears desc, p.handle
     limit $1`,
    [limit],
  )
  return righe.map((r) => r.handle)
}
