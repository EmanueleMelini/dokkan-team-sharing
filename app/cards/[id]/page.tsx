import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'
import { CardPage } from '@/components/cards/pagina'
import { getCardCached, getCardClearsCached, staticCardIdsCached } from '@/lib/cache/cards'
import { baseOfZAwakened, parseCardId, type CardDetail } from '@/lib/card-page'
import { assetUrl } from '@/lib/db'
import { cardHref } from '@/lib/urls'

// /cards/<id>: pubblica e in cache, uguale per tutti; non legge mai la
// sessione. Al build si prerenderizzano al massimo 100 carte (le piu'
// usate nei clear, lib/card-page.ts staticCardIds); le altre nascono alla
// prima visita e poi restano in cache (ISR), come gli eventi.
//
// instant = false: params si aspetta qui, in cima, cosi' notFound() e il
// redirect della forma Z rispondono davvero 404 e 308, non 200 da dentro
// uno streaming gia' partito.
export const instant = false

type Props = { params: Promise<{ id: string }> }

export async function generateStaticParams() {
  return (await staticCardIdsCached()).map((id) => ({ id }))
}

/** La carta dell'URL, o null. Le letture sono in cache: metadata e pagina le condividono. */
async function cartaDi(raw: string): Promise<CardDetail | null> {
  const id = parseCardId(raw)
  return id ? getCardCached(id) : null
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const card = await cartaDi((await params).id)
  if (!card) return {}
  const nome = card.name ?? `Card ${card.id}`
  // Come il gioco chiama le carte: "Mystery Super Technique Super Saiyan 3 Goku"
  const title = card.epithet ? `${card.epithet} ${nome}` : `${nome} (${card.rarity} ${card.type})`
  const leader = card.skills.find((s) => s.kind === 'leader' && s.tier === 'base')?.description
  const description = leader
    ? `Leader Skill: ${leader.replace(/\n/g, ' ').slice(0, 150)}`
    : `${nome}: skills, links, categories and the teams that use this card.`
  const arte = assetUrl(card.art_key)
  return {
    title,
    description,
    alternates: { canonical: cardHref(card.id) },
    openGraph: { title, description, ...(arte ? { images: [arte] } : {}) },
  }
}

export default async function Carta({ params }: Props) {
  const raw = (await params).id
  const id = parseCardId(raw)
  if (!id) notFound()
  const card = await getCardCached(id)
  if (!card) {
    // La forma risvegliata Z ha l'id della base piu' uno: porta alla base.
    const base = baseOfZAwakened(id)
    if (base && (await getCardCached(base))) permanentRedirect(cardHref(base))
    notFound()
  }
  // Le carte solo giapponesi mostrano i clear della versione giapponese
  const reg = card.releases.some((r) => r.reg === 'global') ? 'global' : 'japan'
  const clears = await getCardClearsCached(card.id, reg)
  return <CardPage card={card} clears={{ ...clears, reg }} />
}
