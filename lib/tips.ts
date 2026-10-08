import 'server-only'
import { sql } from '@/lib/db'
import { TIP_LIMITS } from '@/lib/tips/validate'

// Le letture delle tip (0025). Modulo puro, senza cacheTag/cacheLife: i
// test lo importano fuori da Next. La versione in cache per la pagina
// dell'evento sta in lib/cache/tips.ts; lo stato di chi guarda (voti,
// proprie tip) arriva da /api/me con viewerTipState, mai dalla cache.

export type TipRow = {
  id: string
  /** null = tip di tutto l'evento */
  tierId: string | null
  body: string
  linkUrl: string | null
  /** youtube, imgur... (proof_host); null per un host fuori lista */
  linkProvider: string | null
  score: number
  createdAt: Date
  editedAt: Date | null
  handle: string
}

export type TipGroup = { tips: TipRow[]; total: number }
export type EventTips = { stage: TipGroup; event: TipGroup }

type Riga = {
  id: string; tier_id: string | null; body: string; link_url: string | null; link_provider: string | null
  score: number; created_at: Date; edited_at: Date | null; handle: string; total: number
}

/**
 * Le tip pubblicate di un evento: quelle di tutto l'evento e quelle del
 * tier dato. Per gruppo le prime `limit` in ordine Top (punteggio, poi le
 * piu' nuove) PIU' le prime `limit` in ordine New: la pagina cambia ordine
 * nel browser, senza parametri nell'URL, e cosi' entrambi gli ordini sono
 * esatti fino a `limit`. total conta tutte quelle pubblicate del gruppo.
 */
export async function listTips(eventId: string, tierId: string | null, limit: number = TIP_LIMITS.perScope): Promise<EventTips> {
  const righe = await sql<Riga>(
    `with t as (
       select t.*,
              row_number() over (partition by t.stage_tier_id order by t.score desc, t.created_at desc, t.id) as rn_top,
              row_number() over (partition by t.stage_tier_id order by t.created_at desc, t.id) as rn_new,
              count(*) over (partition by t.stage_tier_id)::int as total
       from tip t
       where t.event_id = $1::bigint and t.status = 'published'
         and (t.stage_tier_id is null or t.stage_tier_id = $2::bigint))
     select t.id::text, t.stage_tier_id::text as tier_id, t.body, t.link_url, t.link_provider,
            t.score::int, t.created_at, t.edited_at, u.handle::text as handle, t.total
     from t join app_user u on u.id = t.author_id
     where t.rn_top <= $3 or t.rn_new <= $3
     order by t.stage_tier_id nulls first, t.rn_top`,
    [eventId, tierId, limit],
  )
  const out: EventTips = { stage: { tips: [], total: 0 }, event: { tips: [], total: 0 } }
  for (const r of righe) {
    const g = r.tier_id === null ? out.event : out.stage
    g.total = r.total
    g.tips.push({
      id: r.id, tierId: r.tier_id, body: r.body, linkUrl: r.link_url, linkProvider: r.link_provider,
      score: r.score, createdAt: r.created_at, editedAt: r.edited_at, handle: r.handle,
    })
  }
  return out
}

export type ViewerTipState = {
  /** le tip che chi guarda ha segnato come utili */
  tipVotes: string[]
  /** le sue tip: niente voto ne' Report, ma Edit e Delete */
  ownTips: string[]
  /** tip id -> punteggio vivo: il voto non rigenera la pagina in cache */
  tipScores: Record<string, number>
}

/** Un tetto alla risposta di /api/me: la pagina ne mostra al massimo 2 x 2 x perScope. */
const STATO_MAX = 4 * TIP_LIMITS.perScope

/**
 * Lo stato di chi guarda sulle tip che la pagina di un tier mostra: quelle
 * del tier e quelle di tutto il suo evento. Le sue e quelle votate per
 * prime, cosi' il tetto non le taglia.
 */
export async function viewerTipState(userId: string, tierId: string): Promise<ViewerTipState> {
  const righe = await sql<{ id: string; score: number; own: boolean; voted: boolean }>(
    `select t.id::text, t.score::int, (t.author_id = $1::uuid) as own, (v.user_id is not null) as voted
     from stage_tier st
     join tip t on t.event_id = st.event_id and (t.stage_tier_id is null or t.stage_tier_id = st.id)
     left join tip_vote v on v.tip_id = t.id and v.user_id = $1::uuid
     where st.id = $2::bigint and t.status = 'published'
     order by (t.author_id = $1::uuid or v.user_id is not null) desc, t.score desc, t.created_at desc
     limit $3`,
    [userId, tierId, STATO_MAX],
  )
  const out: ViewerTipState = { tipVotes: [], ownTips: [], tipScores: {} }
  for (const r of righe) {
    out.tipScores[r.id] = r.score
    if (r.own) out.ownTips.push(r.id)
    if (r.voted) out.tipVotes.push(r.id)
  }
  return out
}

/** L'evento di una tip, dal database (per invalidare la sua pagina), o null. */
export async function tipEvent(tipId: string): Promise<string | null> {
  const [r] = await sql<{ event_id: string }>('select event_id::text from tip where id = $1::uuid', [tipId])
  return r?.event_id ?? null
}
