import Link from 'next/link'
import { profileHref } from '@/lib/urls'

/**
 * Un handle come link al suo profilo. Ovunque compaia un handle (clear,
 * commenti, tip, Settings, header): un componente solo, cosi' l'URL e lo
 * stile restano gli stessi. Senza prefetch: una pagina d'evento ne mostra
 * decine, e ogni prefetch costerebbe CPU per profili che nessuno apre.
 */
export function HandleLink({ handle, className = '' }: { handle: string; className?: string }) {
  return (
    <Link
      href={profileHref(handle)}
      prefetch={false}
      className={`underline-offset-2 decoration-oro-linea hover:underline hover:text-oro transition-colors ${className}`}
    >
      {handle}
    </Link>
  )
}
