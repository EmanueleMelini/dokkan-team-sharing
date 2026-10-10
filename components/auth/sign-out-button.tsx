'use client'

import { signOutAction } from '@/lib/auth/actions'
import { useViewer } from '@/components/viewer/provider'
import { dimenticaDispositivo } from '@/lib/notify/push-client'

/**
 * Un form e non un link: uscire e' una scrittura, quindi una POST. L'header
 * passa subito ad anonimo (reset): l'azione toglie la sessione e l'indizio,
 * ma il layout resta montato e non lo saprebbe da solo.
 *
 * Prima dell'uscita si toglie questo dispositivo dalle push, mentre la
 * sessione vale ancora (al massimo 1,5 s di attesa): su un computer
 * condiviso chi entra dopo non deve ricevere le push di chi e' uscito.
 */
export function SignOutButton({ className = '' }: { className?: string }) {
  const { reset } = useViewer()
  return (
    <form action={async () => { await dimenticaDispositivo(); reset(); await signOutAction() }}>
      <button type="submit" className={className}>
        Sign out
      </button>
    </form>
  )
}
