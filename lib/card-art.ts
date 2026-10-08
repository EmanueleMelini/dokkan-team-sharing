// Quale artwork mostrare su una pagina carta, statico o animato. Modulo
// puro: niente React, niente window. Lo usa l'isola client
// (components/cards/art-toggle.tsx) e lo provano i test.
//
// L'animato pesa in media 4 MB, circa 25 volte lo statico: si scarica
// solo per una scelta esplicita (su quella carta, o il default
// dell'account), mai per chi non ha un account.

export type ArtMode = 'still' | 'animated'

export type ArtInput = {
  /** la carta ha un artwork animato */
  hasAnimated: boolean
  /** il default dell'account (Settings); null per chi non e' entrato */
  accountDefault: ArtMode | null
  /** la scelta fatta su questa carta, su questo dispositivo */
  stored: ArtMode | null
  /** prefers-reduced-motion: reduce */
  reducedMotion: boolean
  /** Save-Data del browser (navigator.connection.saveData) */
  saveData: boolean
}

/**
 * L'ordine: senza animato sempre statico; poi la scelta fatta su questa
 * carta, che vince su tutto; poi il default dell'account, che il
 * movimento ridotto o il risparmio dati riportano a statico.
 */
export function resolveArt({ hasAnimated, accountDefault, stored, reducedMotion, saveData }: ArtInput): ArtMode {
  if (!hasAnimated) return 'still'
  if (stored) return stored
  if (reducedMotion || saveData) return 'still'
  return accountDefault ?? 'still'
}

// ---------------------------------------------------------------------
//  La scelta per carta, nel localStorage di questo dispositivo
// ---------------------------------------------------------------------

export const ART_STORE_KEY = 'dts:card-art'
export const ART_STORE_MAX = 200

/** Quello che serve di Storage: i test passano uno finto. */
export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

// Una lista di coppie e non un oggetto: le chiavi numeriche di un oggetto
// si ordinano da sole per valore, e l'ordine d'inserimento (chi e' la
// scelta piu' vecchia) andrebbe perso.
type Voci = [string, ArtMode][]

const isMode = (v: unknown): v is ArtMode => v === 'still' || v === 'animated'

function leggi(storage: StorageLike | null): Voci {
  if (!storage) return []
  try {
    const v: unknown = JSON.parse(storage.getItem(ART_STORE_KEY) ?? '[]')
    if (!Array.isArray(v)) return []
    return v.filter((x): x is [string, ArtMode] =>
      Array.isArray(x) && typeof x[0] === 'string' && isMode(x[1]))
  } catch {
    // bloccato, pieno o scritto male: come se non ci fosse niente
    return []
  }
}

/** La scelta salvata per una carta, o null. */
export function readArtChoice(storage: StorageLike | null, cardId: string): ArtMode | null {
  return leggi(storage).find(([id]) => id === cardId)?.[1] ?? null
}

/**
 * Salva la scelta per una carta come la piu' recente, e tiene solo le
 * ultime ART_STORE_MAX. false se il browser non ha lasciato scrivere: la
 * pagina continua con la scelta in memoria.
 */
export function saveArtChoice(storage: StorageLike | null, cardId: string, mode: ArtMode): boolean {
  if (!storage) return false
  const voci = leggi(storage).filter(([id]) => id !== cardId)
  voci.push([cardId, mode])
  try {
    storage.setItem(ART_STORE_KEY, JSON.stringify(voci.slice(-ART_STORE_MAX)))
    return true
  } catch {
    return false
  }
}

/** localStorage, o null dove il browser lo nega (anche il solo accesso puo' lanciare). */
export function artStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/** "4.2 MB", "870 KB": il peso detto prima di scaricare. */
export function formatBytes(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`
  return `${Math.max(1, Math.round(n / 1000))} KB`
}
