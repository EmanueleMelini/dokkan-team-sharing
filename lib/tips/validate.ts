// La validazione dei form delle tip. Funzioni pure, senza database: le
// prova db/test/tips.test.mts. Le stesse regole le rifa' il database
// (0025: tip_clean_body, tip_clean_link, vote_tip), che e' quello che
// conta; qui servono a rispondere subito con la frase giusta.

import type { Parsed } from '@/lib/clears/validate'
import type { TipRow } from '@/lib/tips'

export const TIP_LIMITS = {
  bodyMin: 10,
  body: 500,
  link: 500,
  /** tip vive per autore sullo stesso bersaglio (post_tip) */
  perTarget: 3,
  /** quante ne porta la pagina in cache per gruppo e per ordine */
  perScope: 50,
  /** quante se ne vedono prima di "Show all" */
  shown: 3,
} as const

/** Lo stato delle Server Action delle tip. Sta qui: un file 'use server' esporta solo funzioni. */
export type TipActionState = {
  ok?: boolean
  error?: string
  /** voteTip: il punteggio aggiornato */
  score?: number
  /** postTip: l'id della tip nuova */
  tipId?: string
}

export type TipScope = 'stage' | 'event'

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error })

/** Per caratteri, come char_length: .length conterebbe due volte un'emoji. */
export const caratteri = (s: string) => [...s].length

export function parseTipBody(v: unknown): Parsed<string> {
  const t = typeof v === 'string' ? v.trim() : ''
  const n = caratteri(t)
  if (n < TIP_LIMITS.bodyMin || n > TIP_LIMITS.body) {
    return fail(`Tips need between ${TIP_LIMITS.bodyMin} and ${TIP_LIMITS.body} characters.`)
  }
  return { ok: true, value: t }
}

/**
 * Il link facoltativo: vuoto = null. Solo la forma (https, niente spazi,
 * lunghezza); gli accorciatori li rifiuta il database con proof_host, che
 * e' la lista vera.
 */
export function parseTipLink(v: unknown): Parsed<string | null> {
  const t = typeof v === 'string' ? v.trim() : ''
  if (!t) return { ok: true, value: null }
  if (!/^https:\/\/[^/\s]+/i.test(t) || /\s/.test(t) || caratteri(t) > TIP_LIMITS.link) {
    return fail('Links must be full https:// addresses. Shortened links are not accepted.')
  }
  return { ok: true, value: t }
}

export function parseTipScope(v: unknown): TipScope | null {
  return v === 'stage' || v === 'event' ? v : null
}

/** Il voto su una tip: 1 (helpful), o 0 per ritirarlo. */
export function parseTipVote(v: unknown): 0 | 1 | null {
  return v === '1' || v === 1 ? 1 : v === '0' || v === 0 ? 0 : null
}

/** L'host da mostrare accanto al link, senza www. Null se l'URL non si legge. */
export function hostDi(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || null
  } catch {
    return null
  }
}

/** Il nome del provider come lo legge una persona (proof_host.provider). */
export const PROVIDER_LABELS: Record<string, string> = {
  youtube: 'YouTube',
  imgur: 'Imgur',
  streamable: 'Streamable',
  reddit: 'Reddit',
  twitch: 'Twitch',
  drive: 'Google Drive',
}

export type Ordine = 'top' | 'new'

const perData = (a: TipRow, b: TipRow) =>
  b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? -1 : 1)

/**
 * In ordine Top (punteggio, poi le piu' nuove) o New. La pagina porta
 * l'unione delle prime perScope di ogni ordine (listTips): ordinate qui e
 * tagliate a perScope, entrambe le liste sono esatte. Top usa il punteggio
 * della copia in cache, non quello vivo di /api/me: un voto non deve far
 * saltare le righe sotto il cursore.
 */
export function ordina(tips: TipRow[], ordine: Ordine): TipRow[] {
  const copia = [...tips]
  copia.sort(ordine === 'new' ? perData : (a, b) => b.score - a.score || perData(a, b))
  return copia.slice(0, TIP_LIMITS.perScope)
}
