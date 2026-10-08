'use client'

import Link from 'next/link'
import { CommentoForm } from '@/components/clears/commento-form'
import { useViewer } from '@/components/viewer/provider'

/**
 * Sotto i commenti: il modulo per chi puo' scrivere, altrimenti dove
 * entrare. ritorno e' questa pagina (con #clear): dopo l'accesso si torna
 * qui, non al builder.
 */
export function CommentoSpazio({ versionId, idBase, ritorno }: { versionId: string; idBase: string; ritorno: string }) {
  const { mode } = useViewer()
  if (mode === 'ready') return <CommentoForm versionId={versionId} idBase={idBase} />
  const next = encodeURIComponent(ritorno)
  return (
    <p className="mt-2 text-[12px] text-tenue">
      <Link
        href={mode === 'setup' ? `/welcome?next=${next}` : `/login?next=${next}`}
        prefetch={false}
        className="text-testo underline decoration-oro-linea underline-offset-2 hover:text-inchiostro"
      >
        {mode === 'setup' ? 'Finish setting up your account' : 'Sign in'}
      </Link>{' '}
      to comment.
    </p>
  )
}
