// La validazione degli input delle Server Action dei clear. Funzioni pure,
// senza database: le prova db/test/submit.test.mts senza un server.
//
// Le stesse regole le rifa' il database (0016, builder_check_payload): qui
// servono a rispondere subito con una frase chiara e a non mandare a
// Postgres un payload che non ha la forma giusta. Se le due cambiano,
// cambiano insieme.

export type SlotRole = 'leader' | 'member' | 'friend'
/**
 * La build opzionale di uno slot (0018). hp_routes: i percorsi del Hidden
 * Potential completati, 0-4 (4 = arcobaleno). equipment: le Skill Orb,
 * la posizione e' lo slot ([null, 812] = solo lo slot 2).
 */
export type BuilderBuild = {
  hp_routes: number | null
  hp_path: string | null
  note: string | null
  equipment: (number | null)[]
}
export type BuilderSlot = {
  rot: 1 | 2 | 3; pos: number; card_id: number; role: SlotRole
  /** assente se lo slot non ha una build */
  build?: BuilderBuild
}
export type BuilderLineup = { label: string | null; note: string | null; slots: BuilderSlot[] }
export type ProofKind = 'screenshot' | 'video'
export type BuilderProof = { kind: ProofKind; url: string }
export type BuilderPayload = {
  lineups: BuilderLineup[]
  no_items: boolean
  deathless: boolean
  turns: number | null
  note: string | null
  lang: 'en' | 'ja' | null
  proofs: BuilderProof[]
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

export const LIMITS = {
  lineups: 4,
  lineupLabel: 40,
  lineupNote: 500,
  note: 2000,
  proofs: 3,
  proofUrl: 500,
  changeNote: 300,
  comment: 1000,
  turns: 99,
  hpRoutes: 4,
  buildPath: 40,
  buildNote: 200,
  equipment: 3,
} as const

// Le sette posizioni della forma 2+2+3, nell'ordine in cui le mostra il sito.
export const SHAPE: ReadonlyArray<readonly [1 | 2 | 3, number]> = [
  [1, 1], [1, 2], [2, 1], [2, 2], [3, 1], [3, 2], [3, 3],
]

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error })
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Un testo opzionale: undefined/null/"" diventano null, il resto ripulito. */
function optText(v: unknown): string | null | undefined {
  if (v === undefined || v === null) return null
  if (typeof v !== 'string') return undefined // undefined = non e' un testo
  const t = v.trim()
  return t === '' ? null : t
}

/** Vero se la build non dice niente: vale come nessuna build. */
export function buildVuota(b: BuilderBuild): boolean {
  return b.hp_routes === null && !b.hp_path && !b.note && b.equipment.every((e) => e === null)
}

/** La build di uno slot: null se manca o e' vuota. */
export function parseBuild(raw: unknown, where: string): Parsed<BuilderBuild | null> {
  if (raw === undefined || raw === null) return { ok: true, value: null }
  if (!isObj(raw)) return fail(`A build in ${where} is not valid.`)
  let routes: number | null = null
  if (raw.hp_routes !== undefined && raw.hp_routes !== null && raw.hp_routes !== '') {
    const r = typeof raw.hp_routes === 'string' ? Number(raw.hp_routes) : raw.hp_routes
    if (!Number.isInteger(r) || (r as number) < 0 || (r as number) > LIMITS.hpRoutes) {
      return fail(`Hidden Potential routes go from 0 to ${LIMITS.hpRoutes} in ${where}.`)
    }
    routes = r as number
  }
  const path = optText(raw.hp_path)
  const note = optText(raw.note)
  if (path === undefined || note === undefined) return fail(`A build in ${where} is not valid.`)
  if (path && path.length > LIMITS.buildPath) {
    return fail(`Keep the Hidden Potential path under ${LIMITS.buildPath} characters in ${where}.`)
  }
  if (note && note.length > LIMITS.buildNote) {
    return fail(`Keep each build note under ${LIMITS.buildNote} characters in ${where}.`)
  }
  let equipment: (number | null)[] = []
  if (raw.equipment !== undefined && raw.equipment !== null) {
    if (!Array.isArray(raw.equipment) || raw.equipment.length > LIMITS.equipment) {
      return fail(`A card holds at most ${LIMITS.equipment} Skill Orbs in ${where}.`)
    }
    if (!raw.equipment.every((e) => e === null || (Number.isSafeInteger(e) && (e as number) > 0))) {
      return fail(`A Skill Orb in ${where} is not valid. Pick it again.`)
    }
    equipment = raw.equipment as (number | null)[]
  }
  const b: BuilderBuild = { hp_routes: routes, hp_path: path, note, equipment }
  return { ok: true, value: buildVuota(b) ? null : b }
}

function parseSlots(raw: unknown, n: number): Parsed<BuilderSlot[]> {
  const where = n === 1 ? 'the starting team' : `change ${n - 1}`
  if (!Array.isArray(raw) || raw.length !== 7) {
    return fail(`Fill all 7 slots in ${where}.`)
  }
  const seen = new Set<string>()
  let leaders = 0
  let friends = 0
  const slots: BuilderSlot[] = []
  for (const s of raw) {
    if (!isObj(s)) return fail(`A slot in ${where} is not valid.`)
    const { rot, pos, card_id: card, role } = s
    const shapeOk = Number.isInteger(rot) && Number.isInteger(pos) &&
      SHAPE.some(([r, p]) => r === rot && p === pos)
    if (!shapeOk || seen.has(`${rot}.${pos}`)) {
      return fail(`The slots in ${where} must follow the 2+2+3 rotation shape.`)
    }
    seen.add(`${rot}.${pos}`)
    if (!Number.isSafeInteger(card) || (card as number) <= 0) {
      return fail(`Pick a card for every slot in ${where}.`)
    }
    if (role === 'leader') leaders++
    else if (role === 'friend') friends++
    else if (role !== 'member') return fail(`A slot in ${where} has an unknown role.`)
    const build = parseBuild(s.build, where)
    if (!build.ok) return build
    slots.push({
      rot: rot as 1 | 2 | 3, pos: pos as number, card_id: card as number, role,
      ...(build.value ? { build: build.value } : {}),
    })
  }
  if (leaders !== 1 || friends !== 1) {
    return fail(`Mark exactly one leader and one friend in ${where}.`)
  }
  return { ok: true, value: slots }
}

function parseLineup(raw: unknown, n: number): Parsed<BuilderLineup> {
  if (!isObj(raw)) return fail('A team in the clear is not valid.')
  const label = optText(raw.label)
  const note = optText(raw.note)
  if (label === undefined || note === undefined) return fail('A team in the clear is not valid.')
  if (n > 1 && !label) return fail(`Give change ${n - 1} a short name, for example "Phase 2".`)
  if (label && label.length > LIMITS.lineupLabel) {
    return fail(`Keep the name of each team under ${LIMITS.lineupLabel} characters.`)
  }
  if (note && note.length > LIMITS.lineupNote) {
    return fail(`Keep the note of each team under ${LIMITS.lineupNote} characters.`)
  }
  const slots = parseSlots(raw.slots, n)
  if (!slots.ok) return slots
  return { ok: true, value: { label, note, slots: slots.value } }
}

// Gli accorciatori li rifiuta anche il database (proof_host, 0002): qui
// solo per dirlo prima. La lista vera resta quella della tabella.
const SHORTENERS = new Set(['bit.ly', 'tinyurl.com', 't.co', 'is.gd', 'shorturl.at'])

export function parseProofs(raw: unknown): Parsed<BuilderProof[]> {
  if (raw === undefined || raw === null) return { ok: true, value: [] }
  if (!Array.isArray(raw) || raw.length > LIMITS.proofs) {
    return fail(`Add at most ${LIMITS.proofs} proof links.`)
  }
  const out: BuilderProof[] = []
  for (const p of raw) {
    if (!isObj(p) || (p.kind !== 'screenshot' && p.kind !== 'video')) {
      return fail('Each proof is a screenshot or a video.')
    }
    const url = typeof p.url === 'string' ? p.url.trim() : ''
    let u: URL | null = null
    try { u = new URL(url) } catch { /* resta null */ }
    if (!u || u.protocol !== 'https:' || !u.hostname || /\s/.test(url) || url.length > LIMITS.proofUrl) {
      return fail('Proof links must be full https:// addresses.')
    }
    if (SHORTENERS.has(u.hostname.replace(/^www\./, ''))) {
      return fail('Link shorteners are not accepted. Paste the full address.')
    }
    if (out.some((o) => o.url === url)) return fail('The same proof link is there twice.')
    out.push({ kind: p.kind, url })
  }
  return { ok: true, value: out }
}

/** Il payload del builder, gia' decodificato da JSON. */
export function parseBuilderPayload(raw: unknown): Parsed<BuilderPayload> {
  if (!isObj(raw) || !Array.isArray(raw.lineups)) return fail('The clear could not be read. Reload the page.')
  if (raw.lineups.length < 1 || raw.lineups.length > LIMITS.lineups) {
    return fail(`A clear has a starting team and at most ${LIMITS.lineups - 1} changes.`)
  }
  const lineups: BuilderLineup[] = []
  for (let i = 0; i < raw.lineups.length; i++) {
    const l = parseLineup(raw.lineups[i], i + 1)
    if (!l.ok) return l
    lineups.push(l.value)
  }
  const flag = (v: unknown) => (v === undefined ? false : v)
  const noItems = flag(raw.no_items)
  const deathless = flag(raw.deathless)
  if (typeof noItems !== 'boolean' || typeof deathless !== 'boolean') {
    return fail('The clear could not be read. Reload the page.')
  }
  let turns: number | null = null
  if (raw.turns !== undefined && raw.turns !== null && raw.turns !== '') {
    const t = typeof raw.turns === 'string' ? Number(raw.turns) : raw.turns
    if (!Number.isInteger(t) || (t as number) < 1 || (t as number) > LIMITS.turns) {
      return fail(`Turns must be a whole number from 1 to ${LIMITS.turns}, or empty.`)
    }
    turns = t as number
  }
  const note = optText(raw.note)
  if (note === undefined) return fail('The clear could not be read. Reload the page.')
  if (note && note.length > LIMITS.note) return fail(`Keep the note under ${LIMITS.note} characters.`)
  const lang = optText(raw.lang)
  if (lang !== null && lang !== 'en' && lang !== 'ja') return fail('Choose the language of the note.')
  const proofs = parseProofs(raw.proofs)
  if (!proofs.ok) return proofs
  return {
    ok: true,
    value: { lineups, no_items: noItems, deathless, turns, note, lang, proofs: proofs.value },
  }
}

/** Il campo "payload" di un form: una stringa JSON. */
export function parsePayloadField(v: FormDataEntryValue | null | undefined): Parsed<BuilderPayload> {
  if (typeof v !== 'string' || v.length > 50_000) return fail('The clear could not be read. Reload the page.')
  let raw: unknown
  try { raw = JSON.parse(v) } catch { return fail('The clear could not be read. Reload the page.') }
  return parseBuilderPayload(raw)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BIGINT = /^[1-9][0-9]{0,17}$/

/** Un id uuid da un campo del form, o null. */
export function parseUuid(v: unknown): string | null {
  return typeof v === 'string' && UUID.test(v.trim()) ? v.trim().toLowerCase() : null
}

/** Un id bigint (run, tier, evento) da un campo del form, come stringa, o null. */
export function parseBigintId(v: unknown): string | null {
  return typeof v === 'string' && BIGINT.test(v.trim()) ? v.trim() : null
}

/** Il valore di un voto: 1, -1, oppure 0 per ritirarlo. */
export function parseVote(v: unknown): -1 | 0 | 1 | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return n === 1 || n === -1 || n === 0 ? n : null
}

export function parseComment(v: unknown): Parsed<string> {
  const t = typeof v === 'string' ? v.trim() : ''
  if (!t) return fail('Write something before posting.')
  if (t.length > LIMITS.comment) return fail(`Keep comments under ${LIMITS.comment} characters.`)
  return { ok: true, value: t }
}

export function parseChangeNote(v: unknown): Parsed<string> {
  const t = typeof v === 'string' ? v.trim() : ''
  if (!t) return fail('Say what changed in this revision.')
  if (t.length > LIMITS.changeNote) return fail(`Keep the reason under ${LIMITS.changeNote} characters.`)
  return { ok: true, value: t }
}
