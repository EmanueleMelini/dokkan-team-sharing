import Link from 'next/link'
import { CaretLeft, CaretRight } from '@phosphor-icons/react/dist/ssr'
import { AttesaLink } from '@/components/attesa-link'
import { relRobots } from '@/lib/robots'

const BOTTONE =
  'relative inline-flex items-center gap-1 px-2.5 py-1 rounded-[var(--raggio)] border border-linea bg-superficie hover:border-linea-forte transition-colors'

/**
 * Pagina precedente e successiva. Niente prefetch: ogni pagina /p/<n> e' un
 * URL a parte, e un prefetch ne avvierebbe la generazione (una scrittura
 * ISR) anche per chi non ci va. Il rel segue robots.txt: nofollow verso le
 * pagine dei tier e le viste filtrate, niente verso quelle di un profilo.
 */
export function Paginazione({
  pagina, ultima, href, etichetta,
}: {
  pagina: number
  ultima: number
  href: (n: number) => string
  etichetta: string
}) {
  if (ultima <= 1 || pagina > ultima) return null
  return (
    <nav aria-label={etichetta} className="mt-8 flex items-center justify-between gap-4 text-[13px]">
      {pagina > 1 ? (
        <Link href={href(pagina - 1)} rel={relRobots(href(pagina - 1))} prefetch={false} className={BOTTONE}>
          <CaretLeft size={13} weight="bold" aria-hidden />
          Previous
          <AttesaLink />
        </Link>
      ) : (
        <span />
      )}
      <span className="text-[12px] text-tenue">
        Page <span className="numeri">{pagina}</span> of <span className="numeri">{ultima}</span>
      </span>
      {pagina < ultima ? (
        <Link href={href(pagina + 1)} rel={relRobots(href(pagina + 1))} prefetch={false} className={BOTTONE}>
          Next
          <CaretRight size={13} weight="bold" aria-hidden />
          <AttesaLink />
        </Link>
      ) : (
        <span />
      )}
    </nav>
  )
}
