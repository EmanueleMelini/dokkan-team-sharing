import Link from 'next/link'
import { Camera } from '@phosphor-icons/react/dist/ssr'
import { DIFFICOLTA } from '@/lib/livelli'
import { browseHref, clearAnchor, eventHref } from '@/lib/urls'
import type { CardClear } from '@/lib/card-page'
import type { Region } from '@/lib/queries'

const RUOLO = ['Leader', 'Friend'] as const

/** "Stage 3 name Super 2" o "Level 30" per gli EZA, come la pagina dell'evento. */
function dove(c: CardClear): string {
  if (c.difficulty === 'eza_level') return `Level ${c.stage_seq}`
  return `${c.stage_name ?? `Stage ${c.stage_seq}`} ${DIFFICOLTA[c.difficulty] ?? c.difficulty}`
}

const REGIONE: Record<Region, string> = { global: 'Global', japan: 'Japan' }

/**
 * I migliori clear che usano la carta, ciascuno col link al punto della
 * lista del suo tier dove si vede. La lista e' densa: niente prefetch.
 */
export function ClearConCarta({ clears, totale, reg }: { clears: CardClear[]; totale: number; reg: Region }) {
  if (!clears.length) {
    return (
      <p className="text-[13px] text-tenue">
        No clears use this card yet. Teams are posted on each event&apos;s stages.{' '}
        <Link href={browseHref({ reg })} prefetch={false} className="text-testo underline decoration-oro-linea underline-offset-2 hover:text-inchiostro">
          Browse events
        </Link>
      </p>
    )
  }
  return (
    <div>
      <p className="text-[12px] text-tenue">
        Used in <span className="numeri">{totale}</span> {totale === 1 ? 'clear' : 'clears'} on {REGIONE[reg]}
        {totale > clears.length && <>, the top <span className="numeri">{clears.length}</span> below</>}.
      </p>
      <ul className="mt-2 divide-y divide-linea border-y border-linea">
        {clears.map((c) => {
          const href = eventHref({ id: c.event_id, reg, tier: c.tier_id, page: c.page }) + clearAnchor(c.id)
          const ruolo = RUOLO[c.role_rank]
          return (
            <li key={c.id} className="py-2.5">
              <Link href={href} prefetch={false} className="group block min-w-0">
                <span className="block text-[13px] font-medium text-inchiostro group-hover:underline decoration-oro-linea underline-offset-2">
                  {c.event_name}
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-tenue">
                  <span>{dove(c)}</span>
                  <span aria-hidden>·</span>
                  <span>by <span className="text-testo">{c.handle}</span></span>
                  <span aria-hidden>·</span>
                  <span><span className="numeri">{c.score}</span> {Math.abs(c.score) === 1 ? 'vote' : 'votes'}</span>
                  {ruolo && (
                    <span className="numeri text-[10px] font-semibold px-1 py-px rounded-[var(--raggio)] bg-oro-tenue text-oro border border-oro-linea">
                      {ruolo}
                    </span>
                  )}
                  {c.has_proof && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-testo">
                      <Camera size={12} weight="bold" className="text-oro" aria-hidden />Proof
                    </span>
                  )}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
