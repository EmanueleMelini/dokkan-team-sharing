// Gli header di cache delle API del catalogo (/api/cards, /api/equipment).
// Modulo puro: i test importano le rotte fuori da Next.

/**
 * Le carte cambiano solo con un import. Cinque minuti nel browser; sulla
 * CDN di Vercel (CDN-Cache-Control, che il browser ignora) sei ore, e
 * intanto per un giorno la copia vecchia va bene mentre se ne fa una
 * nuova. La CDN tiene una voce per query string: il debounce del picker
 * limita quante ne nascono.
 */
export const CACHE_CATALOGO = {
  'Cache-Control': 'public, max-age=300',
  'CDN-Cache-Control': 'public, s-maxage=21600, stale-while-revalidate=86400',
}
