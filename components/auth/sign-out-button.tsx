'use client'

import { signOutAction } from '@/lib/auth/actions'
import { useViewer } from '@/components/viewer/provider'

/**
 * Un form e non un link: uscire e' una scrittura, quindi una POST. L'header
 * passa subito ad anonimo (reset): l'azione toglie la sessione e l'indizio,
 * ma il layout resta montato e non lo saprebbe da solo.
 */
export function SignOutButton({ className = '' }: { className?: string }) {
  const { reset } = useViewer()
  return (
    <form action={async () => { reset(); await signOutAction() }}>
      <button type="submit" className={className}>
        Sign out
      </button>
    </form>
  )
}
