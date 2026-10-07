import Link from 'next/link'
import { CaretLeft, CaretRight } from '@phosphor-icons/react/dist/ssr'
import { AttesaLink } from '@/components/attesa-link'

const BOTTONE =
  'relative inline-flex items-center gap-1 px-2.5 py-1 rounded-[var(--raggio)] border border-linea bg-superficie hover:border-linea-forte transition-colors'

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
        <Link href={href(pagina - 1)} className={BOTTONE}>
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
        <Link href={href(pagina + 1)} className={BOTTONE}>
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
