import Link from 'next/link'
import { Plus } from '@phosphor-icons/react/dist/ssr'

type Props = {
  /** ready: va al builder; setup: deve finire /welcome; anon: deve entrare */
  modo: 'ready' | 'setup' | 'anon'
  /** il builder con il tier già scelto */
  invia: string
}

/**
 * L'invito a inviare un clear, nel pannello del livello scelto. Chi non è
 * entrato vede dove entrare: dopo l'accesso (e /welcome) torna al builder
 * di questo stesso livello.
 */
export function InviaClear({ modo, invia }: Props) {
  const href =
    modo === 'ready' ? invia
      : modo === 'setup' ? `/welcome?next=${encodeURIComponent(invia)}`
        : `/login?next=${encodeURIComponent(invia)}`
  const testo = modo === 'ready' ? 'Submit a clear' : modo === 'setup' ? 'Finish setup to submit a clear' : 'Sign in to submit a clear'
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium rounded-[var(--raggio)] transition-colors active:scale-[0.98] whitespace-nowrap ${
        modo === 'ready'
          ? 'bg-inchiostro text-sfondo hover:opacity-90'
          : 'border border-campo bg-superficie text-inchiostro hover:border-linea-forte'
      }`}
    >
      {modo === 'ready' && <Plus size={13} weight="bold" aria-hidden />}
      {testo}
    </Link>
  )
}
