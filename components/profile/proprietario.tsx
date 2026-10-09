'use client'

import Link from 'next/link'
import { PencilSimple } from '@phosphor-icons/react/dist/ssr'
import { useViewer } from '@/components/viewer/provider'
import { browseHref } from '@/lib/urls'

// Le isole del profilo per chi lo guarda. La pagina e' in cache e uguale
// per tutti (la versione anonima): se chi guarda e' il proprietario, lo
// dice /api/me, e solo allora compaiono il link a Settings e il vuoto
// scritto per lui. L'handle si confronta esatto: la pagina e' gia' quella
// con la forma giusta (le altre fanno un 308).

const mio = (user: { handle: string } | null, handle: string) => user?.handle === handle

/** "Edit profile", solo al proprietario. */
export function ModificaProfilo({ handle }: { handle: string }) {
  const { user } = useViewer()
  if (!mio(user, handle)) return null
  return (
    <Link
      href="/settings#handle"
      prefetch={false}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-medium rounded-[var(--raggio)] border border-campo bg-superficie text-inchiostro hover:bg-superficie-2 transition-colors"
    >
      <PencilSimple size={13} weight="bold" aria-hidden />
      Edit profile
    </Link>
  )
}

/** La lista vuota: per gli altri una frase, per il proprietario l'invito agli eventi. */
export function ProfiloVuoto({ handle }: { handle: string }) {
  const { user } = useViewer()
  if (!mio(user, handle)) {
    return <p className="text-[13px] text-tenue">{handle} hasn&apos;t shared any clears yet.</p>
  }
  return (
    <p className="text-[13px] text-tenue">
      You haven&apos;t shared any clears yet.{' '}
      <Link href={browseHref()} className="text-testo underline decoration-oro-linea underline-offset-2 hover:text-inchiostro">
        Browse events
      </Link>
    </p>
  )
}
