import type { NextRequest } from 'next/server'
import { assetUrl } from '@/lib/db'
import { CACHE_CATALOGO } from '@/lib/cache/headers'
import {
  CARD_CLASSES, CARD_RARITIES, CARD_SEARCH_MAX, CARD_TYPES, searchCards,
  type CardClass, type CardRarity, type CardType,
} from '@/lib/cards'

// La ricerca del picker delle carte: pubblica (sono dati del gioco, uguali
// per tutti) e in sola lettura. Parametri sbagliati danno 400 e non una
// lista vuota: un filtro ignorato in silenzio sembrerebbe "nessun
// risultato".

function oneOf<T extends string>(list: readonly T[], v: string | null): T | null | undefined {
  if (v === null || v === '') return null
  return (list as readonly string[]).includes(v) ? (v as T) : undefined
}

function intParam(v: string | null, max: number): number | null | undefined {
  if (v === null || v === '') return null
  if (!/^[0-9]{1,6}$/.test(v)) return undefined
  const n = Number(v)
  return n <= max ? n : undefined
}

const bad = (error: string) =>
  Response.json({ error }, { status: 400, headers: { 'Cache-Control': 'no-store' } })

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const q = (sp.get('q') ?? '').trim()
  if (q.length > 60) return bad('q is longer than 60 characters')
  const type = oneOf<CardType>(CARD_TYPES, sp.get('type'))
  const cls = oneOf<CardClass>(CARD_CLASSES, sp.get('class'))
  const rarity = oneOf<CardRarity>(CARD_RARITIES, sp.get('rarity'))
  const category = intParam(sp.get('category'), 32767)
  const offset = intParam(sp.get('offset'), 10_000)
  if (type === undefined) return bad(`type must be one of ${CARD_TYPES.join(', ')}`)
  if (cls === undefined) return bad(`class must be one of ${CARD_CLASSES.join(', ')}`)
  if (rarity === undefined) return bad(`rarity must be one of ${CARD_RARITIES.join(', ')}`)
  if (category === undefined) return bad('category must be a category id')
  if (offset === undefined) return bad('offset must be a number from 0 to 10000')

  const hits = await searchCards({
    q, type, class: cls, rarity, category, offset: offset ?? 0, limit: CARD_SEARCH_MAX,
  })
  const total = hits[0]?.total ?? 0
  const from = offset ?? 0
  return Response.json(
    {
      cards: hits.map((c) => ({
        id: c.id, name: c.name, epithet: c.epithet, type: c.type, class: c.class,
        rarity: c.rarity, thumb: assetUrl(c.thumb_key), bare: c.thumb_bare,
      })),
      total,
      next: from + hits.length < total ? from + hits.length : null,
    },
    { headers: CACHE_CATALOGO },
  )
}
