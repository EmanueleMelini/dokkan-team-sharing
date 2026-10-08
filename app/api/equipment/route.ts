import type { NextRequest } from 'next/server'
import { EQUIP_SEARCH_MAX, EQUIP_TIERS, cardExists, countHiddenEquipment, searchEquipment } from '@/lib/equipment'

// La ricerca delle Skill Orb per l'editor delle build: pubblica e in sola
// lettura, come /api/cards. Parametri sbagliati danno 400, non una lista
// vuota che sembrerebbe "nessun risultato". Con card= solo le sfere che
// quella carta puo' montare (0021), e hidden dice quante ne restano fuori.

const bad = (error: string) =>
  Response.json({ error }, { status: 400, headers: { 'Cache-Control': 'no-store' } })

function intParam(v: string | null, max: number): number | null | undefined {
  if (v === null || v === '') return null
  if (!/^[0-9]{1,6}$/.test(v)) return undefined
  const n = Number(v)
  return n <= max ? n : undefined
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const q = (sp.get('q') ?? '').trim()
  if (q.length > 60) return bad('q is longer than 60 characters')
  const tier = intParam(sp.get('tier'), 9)
  const offset = intParam(sp.get('offset'), 10_000)
  if (tier === undefined || (tier !== null && !(EQUIP_TIERS as readonly number[]).includes(tier))) {
    return bad('tier must be 1 (bronze), 2 (silver) or 3 (gold)')
  }
  if (offset === undefined) return bad('offset must be a number from 0 to 10000')
  const cardRaw = sp.get('card')
  // un intero positivo che sta in un bigint senza arrotondare: il resto e' 400, non 500
  if (cardRaw !== null && cardRaw !== '' && !/^[1-9][0-9]{0,8}$/.test(cardRaw)) return bad('card must be a card id')
  const card = cardRaw ? Number(cardRaw) : null
  if (card !== null && !(await cardExists(card))) return bad('card not found')

  const [hits, hidden] = await Promise.all([
    searchEquipment({ q, tier, card, offset: offset ?? 0, limit: EQUIP_SEARCH_MAX }),
    card === null ? 0 : countHiddenEquipment({ q, tier, card }),
  ])
  const total = hits[0]?.total ?? 0
  const from = offset ?? 0
  return Response.json(
    {
      items: hits.map((h) => ({ id: h.id, name: h.name, tier: h.tier, effect: h.effect })),
      total,
      next: from + hits.length < total ? from + hits.length : null,
      hidden,
    },
    // cambiano solo con un import, come le carte
    { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600' } },
  )
}
