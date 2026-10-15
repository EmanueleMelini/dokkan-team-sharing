import Link from 'next/link'
import { ArrowLeft } from '@phosphor-icons/react/dist/ssr'
import { relRobots } from '@/lib/robots'

type Props = { titolo: string; evento: string; livello: string; indietro: string }

/**
 * Il titolo delle pagine del builder: dove si sta inviando il clear. Il
 * link torna alla pagina del tier: senza prefetch, che ne avvierebbe la
 * generazione per chi non ci torna.
 */
export function Intestazione({ titolo, evento, livello, indietro }: Props) {
  return (
    <header>
      <Link href={indietro} rel={relRobots(indietro)} prefetch={false} className="inline-flex items-center gap-1.5 text-[13px] text-tenue hover:text-inchiostro transition-colors">
        <ArrowLeft size={14} weight="bold" aria-hidden />
        Back to the event
      </Link>
      <h1 className="mt-4 text-xl font-semibold tracking-tight text-inchiostro">{titolo}</h1>
      {/* due righe invece di un separatore: evento e livello si leggono
          da soli, anche con un lettore di schermo */}
      <p className="mt-1 text-[13px] text-testo">{evento}</p>
      <p className="text-[13px] text-inchiostro font-medium">{livello}</p>
    </header>
  )
}
