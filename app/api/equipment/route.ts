import type { NextRequest } from 'next/server'
import { EQUIP_SEARCH_MAX, EQUIP_TIERS, searchEquipment } from '@/lib/equipment'

// La ricerca delle Skill Orb per l'editor delle build: pubblica e in sola
// lettura, come /api/cards. Parametri sbagliati danno 400, non una lista
// vuota che sembrerebbe "nessun risultato".

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

  const hits = await searchEquipment({ q, tier, offset: offset ?? 0, limit: EQUIP_SEARCH_MAX })
  const total = hits[0]?.total ?? 0
  const from = offset ?? 0
  return Response.json(
    {
      items: hits.map((h) => ({ id: h.id, name: h.name, tier: h.tier, effect: h.effect })),
      total,
      next: from + hits.length < total ? from + hits.length : null,
    },
    // cambiano solo con un import, come le carte
    { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600' } },
  )
}
