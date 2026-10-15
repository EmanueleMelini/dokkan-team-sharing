import Link from 'next/link'
import { Camera } from '@phosphor-icons/react/dist/ssr'
import { DIFFICOLTA } from '@/lib/livelli'
import { HandleLink } from '@/components/handle-link'
import { browseHref, clearAnchor, eventHref } from '@/lib/urls'
import { relRobots } from '@/lib/robots'
import type { CardClear } from '@/lib/card-page'
import type { Region } from '@/lib/queries'

const RUOLO = ['Leader', 'Friend'] as const

/** "Stage 3 name Super 2" o "Level 30" per gli EZA, come la pagina dell'evento. */
function dove(c: CardClear): string {
  if (c.difficulty === 'eza_level') return `Level ${c.stage_seq}`
  return `${c.stage_name ?? `Stage ${c.stage_seq}`} ${DIFFICOLTA[c.difficulty] ?? c.difficulty}`
}

const REGIONE: Record<Region, string> = { global: 'Global', japan: 'Japan' }

const LINK = 'text-testo underline decoration-oro-linea underline-offset-2 hover:text-inchiostro'

// explicit: la versione del blocco, qualunque sia quella scelta nel sito (lib/versione)
const hrefClear = (c: CardClear, reg: Region) =>
  eventHref({ id: c.event_id, reg, tier: c.tier_id, page: c.page, explicit: true }) + clearAnchor(c.id)

/** Il blocco dell'altra versione, quando ha dei clear: il suo totale e il migliore. */
export type AltraVersioneCarta = { reg: Region; totale: number; primo: CardClear }

/**
 * I migliori clear che usano la carta, ciascuno col link al punto della
 * lista del suo tier dove si vede. La lista e' densa: niente prefetch. I
 * tier sono fuori da robots.txt (lib/robots.ts): link nofollow.
 *
 * perVersione: la pagina ha un blocco per versione e chi guarda ne vede
 * uno solo (components/cards/pagina.tsx). Allora il blocco vuoto dice di
 * quale versione parla, e se l'altra ha dei clear (altra) lo dice col
 * link al migliore: "nessun clear" della sola versione scelta non e'
 * vero per la carta.
 */
export function ClearConCarta({ clears, totale, reg, perVersione = false, altra = null }: {
  clears: CardClear[]
  totale: number
  reg: Region
  perVersione?: boolean
  altra?: AltraVersioneCarta | null
}) {
  if (!clears.length) {
    return (
      <p className="text-[13px] text-tenue">
        No {perVersione && `${REGIONE[reg]} `}clears use this card yet.{' '}
        {altra && (
          <>
            On {REGIONE[altra.reg]} it&apos;s in <span className="numeri">{altra.totale}</span>{' '}
            {altra.totale === 1 ? 'clear' : 'clears'}, the top one in{' '}
            <Link href={hrefClear(altra.primo, altra.reg)} rel={relRobots(hrefClear(altra.primo, altra.reg))} prefetch={false} className={LINK}>
              {altra.primo.event_name}
            </Link>.{' '}
          </>
        )}
        Teams are posted on each event&apos;s stages.{' '}
        <Link href={browseHref({ reg })} prefetch={false} className={LINK}>
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
          const href = hrefClear(c, reg)
          const ruolo = RUOLO[c.role_rank]
          return (
            <li key={c.id} className="py-2.5 min-w-0">
              {/* Il link e' sull'evento, l'handle ha il suo: due link, mai uno dentro l'altro */}
              <Link href={href} rel={relRobots(href)} prefetch={false} className="block text-[13px] font-medium text-inchiostro hover:underline decoration-oro-linea underline-offset-2">
                {c.event_name}
              </Link>
              <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-tenue">
                <span>{dove(c)}</span>
                <span aria-hidden>·</span>
                <span>by <HandleLink handle={c.handle} className="text-testo" /></span>
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
            </li>
          )
        })}
      </ul>
    </div>
  )
}
