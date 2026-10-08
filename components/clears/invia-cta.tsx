'use client'

import Link from 'next/link'
import { Plus } from '@phosphor-icons/react/dist/ssr'
import { useViewer } from '@/components/viewer/provider'

type Props = {
  /** il builder con il tier già scelto */
  invia: string
}

/**
 * L'invito a inviare un clear, nel pannello del livello scelto. Chi non è
 * entrato vede dove entrare: dopo l'accesso (e /welcome) torna al builder
 * di questo stesso livello. Chi guarda lo dice /api/me (useViewer): finché
 * non risponde vale la versione anonima, quella della pagina in cache.
 * Chi e' sospeso non lo vede: il banner della pagina dice gia' perche'.
 */
export function InviaClear({ invia }: Props) {
  const { mode, user } = useViewer()
  if (user?.suspended === true) return null
  const modo = mode === 'ready' || mode === 'setup' ? mode : 'anon'
  const href =
    modo === 'ready' ? invia
      : modo === 'setup' ? `/welcome?next=${encodeURIComponent(invia)}`
        : `/login?next=${encodeURIComponent(invia)}`
  const testo = modo === 'ready' ? 'Submit a clear' : modo === 'setup' ? 'Finish setup to submit a clear' : 'Sign in to submit a clear'
  return (
    <Link
      href={href}
      prefetch={false}
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
