import Link from 'next/link'
import { X } from '@phosphor-icons/react/dist/ssr'
import { filtriAttivi, soloOrdine, type FiltriClear } from '@/lib/clears/filtri'
import { clearListHref } from '@/lib/urls'
import type { Region } from '@/lib/queries'

export type NomiFiltri = {
  /** id della carta -> nome da mostrare */
  carte: Map<string, string>
  categoria: string | null
}

const CHIP =
  'inline-flex items-center gap-1 px-2 py-0.5 text-[12px] rounded-[var(--raggio)] border border-oro-linea bg-oro-tenue text-inchiostro hover:border-oro transition-colors'

/*
 * I filtri attivi come chip: ognuno e' un link alla stessa lista senza quel
 * filtro. rel="nofollow" e prefetch spento: le combinazioni sono senza
 * fine, e un bot o il prefetch non devono girarle (CPU e query).
 */
export function FiltriAttivi({ eventId, reg, tier, filtri, nomi, className = '' }: {
  eventId: string
  reg: Region
  tier: string
  filtri: FiltriClear
  nomi: NomiFiltri
  className?: string
}) {
  if (filtriAttivi(filtri) === 0) return null
  const senza = (cambio: Partial<FiltriClear>) => clearListHref({ id: eventId, reg, tier, filtri: { ...filtri, ...cambio } })
  const carta = (id: string) => nomi.carte.get(id) ?? `Card ${id}`

  const chip: { key: string; testo: string; href: string }[] = []
  if (filtri.proof) chip.push({ key: 'proof', testo: 'Proof', href: senza({ proof: false }) })
  if (filtri.noItems) chip.push({ key: 'noitems', testo: 'No items', href: senza({ noItems: false }) })
  if (filtri.noKo) chip.push({ key: 'noko', testo: 'No KOs', href: senza({ noKo: false }) })
  if (filtri.turns != null) chip.push({ key: 'turns', testo: `≤ ${filtri.turns} ${filtri.turns === 1 ? 'turn' : 'turns'}`, href: senza({ turns: null }) })
  if (filtri.leader) chip.push({ key: 'leader', testo: `Leader: ${carta(filtri.leader)}`, href: senza({ leader: null }) })
  for (const id of filtri.cards) {
    chip.push({ key: `card-${id}`, testo: `Uses: ${carta(id)}`, href: senza({ cards: filtri.cards.filter((c) => c !== id) }) })
  }
  if (filtri.mono) chip.push({ key: 'mono', testo: `Mono ${filtri.mono}`, href: senza({ mono: null }) })
  if (filtri.cls) chip.push({ key: 'class', testo: `All ${filtri.cls}`, href: senza({ cls: null }) })
  if (filtri.cat != null) {
    chip.push({ key: 'cat', testo: `Category: ${nomi.categoria ?? filtri.cat}`, href: senza({ cat: null }) })
  }

  return (
    <ul aria-label="Active filters" className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {chip.map((c) => (
        <li key={c.key}>
          <Link href={c.href} rel="nofollow" prefetch={false} scroll={false} className={CHIP}>
            {c.testo}
            <X size={11} weight="bold" aria-hidden />
            <span className="sr-only">, remove this filter</span>
          </Link>
        </li>
      ))}
      <li>
        <Link
          href={clearListHref({ id: eventId, reg, tier, filtri: soloOrdine(filtri) })}
          rel="nofollow"
          prefetch={false}
          scroll={false}
          className="text-[12px] text-testo underline decoration-oro-linea underline-offset-2 hover:text-inchiostro"
        >
          Clear all
        </Link>
      </li>
    </ul>
  )
}
