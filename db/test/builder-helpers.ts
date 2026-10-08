// Gli aiutanti comuni alle due suite del builder dei clear (submit.test.mts
// e clears-lib.test.mts): la guardia sul database, le verifiche, gli
// utenti di prova e un payload valido da cui partire per romperlo.
import pg from 'pg'
import { db } from '@/lib/db'

export const stato = { passes: 0, fails: 0 }
export function check(nome: string, ok: boolean, dettaglio = ''): boolean {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nome}${dettaglio ? `  (${dettaglio})` : ''}`)
  if (ok) stato.passes++
  else stato.fails++
  return ok
}

/** Si ferma se non gira dentro npm run db:test, su un database *_test. */
export function guardia() {
  const url = process.env.TEST_DATABASE_URL ?? ''
  let nome = ''
  try { nome = decodeURIComponent(new URL(url).pathname.slice(1)) } catch { /* resta vuoto */ }
  if (!nome.endsWith('_test') || process.env.DATABASE_URL !== url) {
    console.error('\n  mi fermo: DATABASE_URL e TEST_DATABASE_URL devono puntare allo stesso database *_test')
    console.error('  (lancialo dentro  npm run db:test)\n')
    process.exit(2)
  }
}

export const q = async <T = Record<string, unknown>,>(text: string, params: unknown[] = []) =>
  (await db.query(text, params)).rows as T[]
export const one = async <T = Record<string, unknown>,>(text: string, params: unknown[] = []) =>
  (await q<T>(text, params))[0]
export const num = async (text: string, params: unknown[] = []) =>
  Number(Object.values((await one(text, params)) ?? {})[0])

/** 'ok', oppure il codice e il vincolo dell'errore Postgres ("23514 builder_shape"). */
export async function esito(text: string, params: unknown[] = []): Promise<string> {
  try { await db.query(text, params); return 'ok' }
  catch (e) {
    if (e instanceof pg.DatabaseError) return `${e.code}${e.constraint ? ' ' + e.constraint : ''}`
    throw e
  }
}

/** Il messaggio dell'errore Postgres, o 'ok'. Per i trigger senza nome di vincolo. */
export async function messaggio(text: string, params: unknown[] = []): Promise<string> {
  try { await db.query(text, params); return 'ok' }
  catch (e) {
    if (e instanceof pg.DatabaseError) return e.message
    throw e
  }
}

export const DOMINIO = '@example.invalid'

/** Un utente di prova gia' completo (onboarded), con email del prefisso dato. */
export async function utente(prefisso: string, handle: string, onboarded = true): Promise<string> {
  const r = await one<{ id: string }>(
    `insert into app_user (handle, email, onboarded_at)
     values ($1, $2, ${onboarded ? 'now()' : 'null'}) returning id`,
    [handle, `${prefisso}+${handle}${DOMINIO}`])
  return r.id
}

export type Slot = { rot: number; pos: number; card_id: unknown; role: string; build?: unknown }
export type Lineup = { label?: unknown; note?: unknown; slots: Slot[] }
export type Payload = Record<string, unknown> & { lineups: Lineup[]; proofs: { kind: string; url: string }[] }

export const FORMA: [number, number][] = [[1, 1], [1, 2], [2, 1], [2, 2], [3, 1], [3, 2], [3, 3]]

/** Sette slot con le carte date: leader in 1.1, friend in 3.3. */
export function slots(cards: number[]): Slot[] {
  return FORMA.map(([rot, pos], i) => ({
    rot, pos, card_id: cards[i],
    role: i === 0 ? 'leader' : i === 6 ? 'friend' : 'member',
  }))
}

/** Un payload valido: partenza + un cambio, una prova video. */
export function payload(cards: number[], extra: Partial<Payload> = {}): Payload {
  return {
    lineups: [
      { label: null, note: 'Start here.', slots: slots(cards.slice(0, 7)) },
      { label: 'Phase 2', note: 'Swap the support in.', slots: slots([cards[0], cards[7], ...cards.slice(2, 7)]) },
    ],
    no_items: true,
    deathless: false,
    turns: 12,
    note: 'Stall the first phase, nuke the second.',
    lang: 'en',
    proofs: [{ kind: 'video', url: 'https://youtu.be/builder-test' }],
    ...extra,
  }
}

/** Una copia profonda da modificare senza toccare l'originale. */
export const copia = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

export type Dati = { run: string; tier: string; futura: string; altraRun: string; cards: number[] }

/**
 * Il punto di partenza dai dati del database di test: una ricorrenza gia'
 * iniziata con una difficolta', una futura dello stesso evento, una di un
 * altro evento, e otto carte uscite su Global.
 */
export async function dati(): Promise<Dati> {
  const base = await one<{ run: string; tier: string; event_id: string; futura: string }>(
    `select r.id::text as run, st.id::text as tier, r.event_id::text,
            (select f.id::text from event_run f where f.event_id = r.event_id and f.starts_at > now()
              order by f.starts_at limit 1) as futura
     from event_run r join stage_tier st on st.event_id = r.event_id
     where r.starts_at <= now()
       and exists (select 1 from event_run f where f.event_id = r.event_id and f.starts_at > now())
     order by r.event_id, r.id, st.id limit 1`)
  const altra = await one<{ id: string }>(
    `select r.id::text from event_run r where r.event_id <> $1::bigint and r.starts_at <= now()
     order by r.id limit 1`, [base.event_id])
  const cards = (await q<{ id: string }>(
    `select c.id::text from card c join card_release r on r.card_id = c.id and r.reg = 'global'
     where r.released_at <= current_date order by c.id limit 8`)).map((r) => Number(r.id))
  return { run: base.run, tier: base.tier, futura: base.futura, altraRun: altra.id, cards }
}

export const SUBMIT = 'select submit_clear_from_builder($1::uuid, $2::bigint, $3::bigint, $4::jsonb) as id'
export const REVISE = 'select revise_clear_from_builder($1::uuid, $2::uuid, $3, $4::jsonb) as id'

/** Quello che l'invio valido lascia alle altre parti della suite. */
export type Ctx = {
  d: Dati
  autore: string
  altro: string
  nuovo: string
  clear: string
  v1: string
  base: Payload
  prefisso: string
}
