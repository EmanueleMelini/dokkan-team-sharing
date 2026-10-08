import 'server-only'
import { sql, sqlOne } from '@/lib/db'
import { clearPage, type Region } from '@/lib/queries'
import { DIFFICOLTA } from '@/lib/livelli'
import { clearAnchor, eventHref } from '@/lib/urls'

// Le letture dell'area /admin. Solo per le pagine dietro requireAdmin:
// qui escono i testi delle segnalazioni e i motivi delle sospensioni, che
// non vanno mai in una pagina pubblica ne' in una voce di cache. I testi
// restano testo React: mai in un href.

export const PER_PAGINA = 50

/** Dove sta un clear, per il link e l'etichetta dello stage. */
export type Posto = {
  eventId: string
  eventName: string
  reg: Region
  /** null per una tip di tutto l'evento */
  tierId: string | null
  /** "Stage 3 name, Super 2" o "Level 30" per le EZA, "Whole event" per una tip */
  tier: string
  /** il clear nella sua pagina, o solo il tier (clear nascosto, o nel registro) */
  href: string
}

type PostoRiga = {
  event_id: string | null
  event_name: string | null
  reg: Region | null
  tier_id: string | null
  stage_name: string | null
  stage_seq: number | null
  difficulty: string | null
}

// Le colonne di PostoRiga per un clear con alias c (le join di POSTO_JOIN).
const POSTO_COLONNE = `c.event_id::text as event_id, et.name as event_name, r.reg::text as reg,
  c.stage_tier_id::text as tier_id, sx.name as stage_name, s.seq::int as stage_seq,
  st.difficulty::text as difficulty`

const POSTO_JOIN = `left join event_run r on r.id = c.run_id
  left join stage_tier st on st.id = c.stage_tier_id
  left join stage s on s.id = st.stage_id
  left join stage_text sx on sx.stage_id = s.id and sx.locale = 'en'
  left join event_text et on et.event_id = c.event_id and et.locale = 'en'`

function nomeTier(p: PostoRiga): string {
  if (p.difficulty === 'eza_level') return `Level ${p.stage_seq}`
  return `${p.stage_name ?? `Stage ${p.stage_seq}`}, ${DIFFICOLTA[p.difficulty ?? ''] ?? p.difficulty}`
}

/**
 * Il posto di un clear. Con la pagina esatta solo se il clear si vede
 * (clearPage conta solo i pubblicati): una query per riga, va bene per
 * le 50 righe di una pagina admin.
 */
async function posto(p: PostoRiga, clearId: string | null, visibile: boolean, esatto = true): Promise<Posto | null> {
  if (!p.event_id || !p.tier_id || !p.reg) return null
  const base = { id: p.event_id, reg: p.reg, tier: p.tier_id }
  let href = eventHref(base)
  // senza la pagina esatta l'ancora porterebbe a pagina 1, forse sbagliata
  if (clearId && visibile && esatto) {
    const page = await clearPage(p.tier_id, p.reg, clearId)
    href = eventHref({ ...base, page: page ?? 1 }) + clearAnchor(clearId)
  }
  return { eventId: p.event_id, eventName: p.event_name ?? `Event ${p.event_id}`, reg: p.reg, tierId: p.tier_id, tier: nomeTier(p), href }
}

// Il posto di una tip (alias tp): l'evento e, se c'e', il tier. Le tip non
// hanno regione: il link e' alla pagina Global, all'ancora del blocco.
const POSTO_TIP_COLONNE = `tp.event_id::text as tip_event_id, tet.name as tip_event_name,
  tp.stage_tier_id::text as tip_tier_id, tsx.name as tip_stage_name, tss.seq::int as tip_stage_seq,
  tst.difficulty::text as tip_difficulty`

const POSTO_TIP_JOIN = `left join event_text tet on tet.event_id = tp.event_id and tet.locale = 'en'
  left join stage_tier tst on tst.id = tp.stage_tier_id
  left join stage tss on tss.id = tst.stage_id
  left join stage_text tsx on tsx.stage_id = tss.id and tsx.locale = 'en'`

type PostoTipRiga = {
  tip_event_id: string | null
  tip_event_name: string | null
  tip_tier_id: string | null
  tip_stage_name: string | null
  tip_stage_seq: number | null
  tip_difficulty: string | null
}

function postoTip(p: PostoTipRiga): Posto | null {
  if (!p.tip_event_id) return null
  const tier = p.tip_tier_id
    ? nomeTier({ stage_name: p.tip_stage_name, stage_seq: p.tip_stage_seq, difficulty: p.tip_difficulty } as PostoRiga)
    : 'Whole event'
  return {
    eventId: p.tip_event_id,
    eventName: p.tip_event_name ?? `Event ${p.tip_event_id}`,
    reg: 'global',
    tierId: p.tip_tier_id,
    tier,
    href: eventHref({ id: p.tip_event_id, tier: p.tip_tier_id }) + '#tips',
  }
}

/** 'infinity' esce da node-postgres come numero: qui diventa indefinite. */
const FINE = `case when u.suspended_until = 'infinity' then null else u.suspended_until end as until,
  coalesce(u.suspended_until = 'infinity', false) as indefinite`

// ---------------------------------------------------------------------
//  La coda delle segnalazioni aperte
// ---------------------------------------------------------------------

export type DettaglioReport = { reason: string; details: string; handle: string; at: Date }

export type GruppoReport = {
  kind: string
  targetId: string
  /** segnalazioni aperte su questo bersaglio */
  n: number
  reasons: Record<string, number>
  /** le ultime spiegazioni scritte, al massimo 5 */
  details: DettaglioReport[]
  firstAt: Date
  lastAt: Date
  /** null se il bersaglio non c'e' piu' o il tipo non e' ancora gestito */
  author: { handle: string; suspended: boolean } | null
  /** il clear, o il clear del commento */
  clear: { id: string; status: string; note: string | null } | null
  comment: { id: string; status: string; body: string; onCurrent: boolean } | null
  tip: { id: string; status: string; body: string; link: string | null } | null
  posto: Posto | null
}

type RigaGruppo = PostoRiga & PostoTipRiga & {
  kind: string
  target_id: string
  n: number
  first_at: Date
  last_at: Date
  reasons: Record<string, number> | null
  details: { reason: string; details: string; handle: string; at: string }[]
  author_handle: string | null
  author_suspended: boolean | null
  clear_id: string | null
  clear_status: string | null
  clear_note: string | null
  comment_id: string | null
  comment_status: string | null
  comment_body: string | null
  comment_current: boolean | null
  tip_id: string | null
  tip_status: string | null
  tip_body: string | null
  tip_link: string | null
}

/**
 * Le segnalazioni aperte raggruppate per bersaglio, la piu' vecchia per
 * prima, 50 per pagina. Un commento su un clear nascosto resta in coda:
 * nascondere il clear chiude solo le segnalazioni del clear.
 */
export async function listOpenReports(page = 1): Promise<{ gruppi: GruppoReport[]; totale: number }> {
  const offset = (Math.max(1, page) - 1) * PER_PAGINA
  const [righe, tot] = await Promise.all([
    sql<RigaGruppo>(
      `with g as (
         select x.target_kind as kind, x.target_id, count(*)::int as n,
                min(x.created_at) as first_at, max(x.created_at) as last_at
         from report x where x.status = 'open'
         group by x.target_kind, x.target_id
         order by min(x.created_at), x.target_kind, x.target_id
         limit $1 offset $2
       )
       select g.kind, g.target_id::text, g.n, g.first_at, g.last_at,
         (select json_object_agg(q.reason, q.n) from (
            select reason, count(*)::int as n from report
            where status = 'open' and target_kind = g.kind and target_id = g.target_id
            group by reason) q) as reasons,
         coalesce((select json_agg(json_build_object('reason', q.reason, 'details', q.details,
                    'handle', q.handle, 'at', q.created_at) order by q.created_at desc) from (
            select y.reason, y.details, ru.handle::text as handle, y.created_at from report y
            join app_user ru on ru.id = y.reporter_id
            where y.status = 'open' and y.target_kind = g.kind and y.target_id = g.target_id
              and y.details is not null
            order by y.created_at desc limit 5) q), '[]'::json) as details,
         a.handle::text as author_handle, user_suspended(a.id) as author_suspended,
         c.id::text as clear_id, c.status as clear_status, cv.note as clear_note,
         m.id::text as comment_id, m.status as comment_status, m.body as comment_body,
         mv.is_current as comment_current,
         tp.id::text as tip_id, tp.status as tip_status, tp.body as tip_body, tp.link_url as tip_link,
         ${POSTO_COLONNE},
         ${POSTO_TIP_COLONNE}
       from g
       left join clear_comment m on g.kind = 'comment' and m.id = g.target_id
       left join clear_version mv on mv.id = m.version_id
       left join clear c on c.id = case g.kind when 'clear' then g.target_id when 'comment' then mv.clear_id end
       left join clear_version cv on cv.clear_id = c.id and cv.is_current
       left join tip tp on g.kind = 'tip' and tp.id = g.target_id
       left join app_user a on a.id = case g.kind
         when 'clear' then c.author_id when 'comment' then m.author_id when 'tip' then tp.author_id end
       ${POSTO_JOIN}
       ${POSTO_TIP_JOIN}
       order by g.first_at, g.kind, g.target_id`,
      [PER_PAGINA, offset],
    ),
    sqlOne<{ n: number }>(
      `select count(*)::int as n from (
         select 1 from report where status = 'open' group by target_kind, target_id) x`,
    ),
  ])
  const gruppi = await Promise.all(righe.map(async (r): Promise<GruppoReport> => ({
    kind: r.kind,
    targetId: r.target_id,
    n: r.n,
    reasons: r.reasons ?? {},
    details: r.details.map((d) => ({ ...d, at: new Date(d.at) })),
    firstAt: r.first_at,
    lastAt: r.last_at,
    author: r.author_handle ? { handle: r.author_handle, suspended: r.author_suspended === true } : null,
    clear: r.clear_id ? { id: r.clear_id, status: r.clear_status ?? 'published', note: r.clear_note } : null,
    comment: r.comment_id
      ? { id: r.comment_id, status: r.comment_status ?? 'published', body: r.comment_body ?? '', onCurrent: r.comment_current === true }
      : null,
    tip: r.tip_id ? { id: r.tip_id, status: r.tip_status ?? 'published', body: r.tip_body ?? '', link: r.tip_link } : null,
    posto: r.tip_id ? postoTip(r) : r.clear_id ? await posto(r, r.clear_id, r.clear_status === 'published') : null,
  })))
  return { gruppi, totale: tot?.n ?? 0 }
}

// ---------------------------------------------------------------------
//  Il contenuto nascosto
// ---------------------------------------------------------------------

export type KindNascosto = 'clear' | 'comment' | 'tip'

export type Nascosto = {
  kind: KindNascosto
  id: string
  /** il clear, o il clear del commento; null per una tip */
  clearId: string | null
  clearStatus: string | null
  author: string | null
  /** la nota del clear, il testo del commento o della tip */
  text: string | null
  createdAt: Date
  /** l'ultima riga 'hide' del registro, se c'e' */
  hiddenAt: Date | null
  hiddenBy: string | null
  posto: Posto | null
}

type RigaNascosto = PostoRiga & Partial<PostoTipRiga> & {
  id: string
  clear_id: string | null
  clear_status: string | null
  author: string | null
  text: string | null
  created_at: Date
  hidden_at: Date | null
  hidden_by: string | null
}

const ULTIMO_HIDE = (kind: string, id: string) => `left join lateral (
    select l.created_at, l.moderator_handle from moderation_action l
    where l.target_kind = '${kind}' and l.target_id = ${id} and l.action = 'hide'
    order by l.created_at desc limit 1) h on true`

// Le tip nascoste: niente clear, il posto e' l'evento (o il tier).
const NASCOSTE_TIP = `select tp.id::text, null as clear_id, null as clear_status, a.handle::text as author,
         tp.body as text, tp.created_at, h.created_at as hidden_at, h.moderator_handle::text as hidden_by,
         ${POSTO_TIP_COLONNE}
  from tip tp
  left join app_user a on a.id = tp.author_id
  ${ULTIMO_HIDE('tip', 'tp.id')}
  ${POSTO_TIP_JOIN}
  where tp.status = 'hidden'
  order by h.created_at desc nulls last, tp.id
  limit $1 offset $2`

const CONTA_NASCOSTI: Record<KindNascosto, string> = {
  clear: `select count(*)::int as n from clear where status = 'hidden'`,
  comment: `select count(*)::int as n from clear_comment where status = 'hidden'`,
  tip: `select count(*)::int as n from tip where status = 'hidden'`,
}

/** I clear, i commenti o le tip nascosti, l'ultimo nascosto per primo, 50 per pagina. */
export async function listHidden(kind: KindNascosto, page = 1): Promise<{ righe: Nascosto[]; totale: number }> {
  const offset = (Math.max(1, page) - 1) * PER_PAGINA
  const testo = kind === 'tip' ? NASCOSTE_TIP : kind === 'clear'
    ? `select c.id::text, c.id::text as clear_id, c.status as clear_status, a.handle::text as author,
              cv.note as text, c.created_at, h.created_at as hidden_at, h.moderator_handle::text as hidden_by,
              ${POSTO_COLONNE}
       from clear c
       left join clear_version cv on cv.clear_id = c.id and cv.is_current
       left join app_user a on a.id = c.author_id
       ${ULTIMO_HIDE('clear', 'c.id')}
       ${POSTO_JOIN}
       where c.status = 'hidden'
       order by h.created_at desc nulls last, c.id
       limit $1 offset $2`
    : `select m.id::text, c.id::text as clear_id, c.status as clear_status, a.handle::text as author,
              m.body as text, m.created_at, h.created_at as hidden_at, h.moderator_handle::text as hidden_by,
              ${POSTO_COLONNE}
       from clear_comment m
       join clear_version mv on mv.id = m.version_id
       join clear c on c.id = mv.clear_id
       left join app_user a on a.id = m.author_id
       ${ULTIMO_HIDE('comment', 'm.id')}
       ${POSTO_JOIN}
       where m.status = 'hidden'
       order by h.created_at desc nulls last, m.id
       limit $1 offset $2`
  const [righe, tot] = await Promise.all([
    sql<RigaNascosto>(testo, [PER_PAGINA, offset]),
    sqlOne<{ n: number }>(CONTA_NASCOSTI[kind]),
  ])
  return {
    totale: tot?.n ?? 0,
    righe: await Promise.all(righe.map(async (r): Promise<Nascosto> => ({
      kind,
      id: r.id,
      clearId: r.clear_id,
      clearStatus: r.clear_status,
      author: r.author,
      text: r.text,
      createdAt: r.created_at,
      hiddenAt: r.hidden_at,
      hiddenBy: r.hidden_by,
      // il commento porta al suo clear, se quello si vede; la tip al suo evento
      posto: kind === 'tip'
        ? postoTip(r as RigaNascosto & PostoTipRiga)
        : await posto(r, r.clear_id, r.clear_status === 'published', kind === 'comment'),
    }))),
  }
}

// ---------------------------------------------------------------------
//  Gli utenti
// ---------------------------------------------------------------------

export type UtenteTrovato = {
  id: string
  handle: string
  role: string
  suspended: boolean
  /** null con indefinite = per sempre; null senza = non sospeso */
  until: Date | null
  indefinite: boolean
  reason: string | null
}

type RigaUtente = { id: string; handle: string; role: string; until: Date | null; indefinite: boolean; suspended: boolean; reason: string | null }

const UTENTE_COLONNE = `u.id::text, u.handle::text, u.role, ${FINE},
  user_suspended(u.id) as suspended, u.suspension_reason as reason`

const utente = (r: RigaUtente): UtenteTrovato => ({
  id: r.id, handle: r.handle, role: r.role, suspended: r.suspended,
  until: r.suspended ? r.until : null, indefinite: r.suspended && r.indefinite, reason: r.suspended ? r.reason : null,
})

/** Gli utenti sospesi adesso, chi torna prima per primo (gli indefiniti in fondo). */
export async function listSuspended(): Promise<UtenteTrovato[]> {
  const righe = await sql<RigaUtente>(
    `select ${UTENTE_COLONNE} from app_user u
     where u.suspended_until > now()
     order by u.suspended_until, u.handle limit 200`,
  )
  return righe.map(utente)
}

/** Un handle valido come cerca, o null: niente caratteri che non possono esserci. */
export function cercaHandle(q: unknown): string | null {
  const v = typeof q === 'string' ? q.trim() : ''
  return /^[A-Za-z0-9_]{1,24}$/.test(v) ? v : null
}

/** Per handle: quello esatto per primo, poi chi comincia cosi'. Al massimo 20. */
export async function findUserByHandle(q: string): Promise<UtenteTrovato[]> {
  const v = cercaHandle(q)
  if (!v) return []
  // _ e' un jolly di LIKE: va scappato, l'handle lo contiene davvero
  const prefisso = v.replace(/_/g, '\\_') + '%'
  const righe = await sql<RigaUtente>(
    `select ${UTENTE_COLONNE} from app_user u
     where u.onboarded_at is not null and (u.handle = $1::citext or u.handle::text ilike $2)
     order by (u.handle = $1::citext) desc, u.handle limit 20`,
    [v, prefisso],
  )
  return righe.map(utente)
}

export type RiepilogoUtente = UtenteTrovato & {
  createdAt: Date
  clears: number
  clearsHidden: number
  comments: number
  commentsHidden: number
  tips: number
  tipsHidden: number
  /** segnalazioni sul suo contenuto: aperte, e in tutto (anche chiuse) */
  openReports: number
  allReports: number
  /** quelle che ha mandato lui */
  reportsSent: number
}

/** La scheda di un utente per handle esatto, o null. */
export async function userModerationSummary(handle: string): Promise<RiepilogoUtente | null> {
  const v = cercaHandle(handle)
  if (!v) return null
  const r = await sqlOne<RigaUtente & {
    created_at: Date; clears: number; clears_hidden: number; comments: number; comments_hidden: number
    tips: number; tips_hidden: number; open_reports: number; all_reports: number; reports_sent: number
  }>(
    `with u as (select * from app_user where handle = $1::citext and onboarded_at is not null),
     suoi as (
       select 'clear'::text as kind, c.id from clear c, u where c.author_id = u.id
       union all
       select 'comment', m.id from clear_comment m, u where m.author_id = u.id
       union all
       select 'tip', t.id from tip t, u where t.author_id = u.id)
     select ${UTENTE_COLONNE}, u.created_at,
       (select count(*) from clear c where c.author_id = u.id)::int as clears,
       (select count(*) from clear c where c.author_id = u.id and c.status = 'hidden')::int as clears_hidden,
       (select count(*) from clear_comment m where m.author_id = u.id)::int as comments,
       (select count(*) from clear_comment m where m.author_id = u.id and m.status = 'hidden')::int as comments_hidden,
       (select count(*) from tip t where t.author_id = u.id)::int as tips,
       (select count(*) from tip t where t.author_id = u.id and t.status = 'hidden')::int as tips_hidden,
       (select count(*) from report x join suoi s on s.kind = x.target_kind and s.id = x.target_id
         where x.status = 'open')::int as open_reports,
       (select count(*) from report x join suoi s on s.kind = x.target_kind and s.id = x.target_id)::int as all_reports,
       (select count(*) from report x where x.reporter_id = u.id)::int as reports_sent
     from u`,
    [v],
  )
  if (!r) return null
  return {
    ...utente(r),
    createdAt: r.created_at,
    clears: r.clears,
    clearsHidden: r.clears_hidden,
    comments: r.comments,
    commentsHidden: r.comments_hidden,
    tips: r.tips,
    tipsHidden: r.tips_hidden,
    openReports: r.open_reports,
    allReports: r.all_reports,
    reportsSent: r.reports_sent,
  }
}

// ---------------------------------------------------------------------
//  Il registro
// ---------------------------------------------------------------------

export type VoceRegistro = {
  id: string
  at: Date
  /** null = uno script (npm run db:role) */
  moderator: string | null
  action: string
  targetKind: string
  targetId: string
  /** l'autore del contenuto o l'utente; null se l'account non c'e' piu' */
  targetHandle: string | null
  reportsClosed: number
  note: string | null
  detail: Record<string, unknown>
  /** il tier dove stava il clear, se esiste ancora */
  posto: Posto | null
}

type RigaRegistro = PostoRiga & PostoTipRiga & {
  id: string
  at: Date
  moderator: string | null
  action: string
  target_kind: string
  target_id: string
  target_handle: string | null
  reports_closed: number
  note: string | null
  detail: Record<string, unknown> | null
  clear_id: string | null
  clear_status: string | null
  tip_id: string | null
}

/**
 * Il registro, l'ultima azione per prima, 50 per volta. Con authorId solo
 * le azioni su quell'utente o sul suo contenuto (moderation_action_by_author).
 * I link portano al tier, senza la pagina esatta: niente query per riga.
 */
export async function listLog(offset = 0, { authorId }: { authorId?: string } = {}): Promise<{ voci: VoceRegistro[]; altre: boolean }> {
  const righe = await sql<RigaRegistro>(
    `select l.id::text, l.created_at as at, l.moderator_handle::text as moderator, l.action,
            l.target_kind, l.target_id::text, a.handle::text as target_handle,
            l.reports_closed, l.note, l.detail,
            c.id::text as clear_id, c.status as clear_status,
            tp.id::text as tip_id,
            ${POSTO_COLONNE},
            ${POSTO_TIP_COLONNE}
     from moderation_action l
     left join app_user a on a.id = l.target_author_id
     left join clear c on c.id = case l.target_kind
       when 'clear' then l.target_id
       when 'comment' then (l.detail->>'clear_id')::uuid end
     left join tip tp on l.target_kind = 'tip' and tp.id = l.target_id
     ${POSTO_JOIN}
     ${POSTO_TIP_JOIN}
     where ($3::uuid is null or l.target_author_id = $3::uuid)
     order by l.created_at desc, l.id desc
     limit $1 offset $2`,
    [PER_PAGINA + 1, Math.max(0, offset), authorId ?? null],
  )
  const voci = await Promise.all(righe.slice(0, PER_PAGINA).map(async (r): Promise<VoceRegistro> => ({
    id: r.id,
    at: r.at,
    moderator: r.moderator,
    action: r.action,
    targetKind: r.target_kind,
    targetId: r.target_id,
    targetHandle: r.target_handle,
    reportsClosed: r.reports_closed,
    note: r.note,
    detail: r.detail ?? {},
    posto: r.tip_id ? postoTip(r) : r.clear_id ? await posto(r, r.clear_id, r.clear_status === 'published', false) : null,
  })))
  return { voci, altre: righe.length > PER_PAGINA }
}
