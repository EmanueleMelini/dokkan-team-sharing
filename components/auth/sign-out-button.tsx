import { signOutAction } from '@/lib/auth/actions'

/** Un form e non un link: uscire e' una scrittura, quindi una POST. */
export function SignOutButton({ className = '' }: { className?: string }) {
  return (
    <form action={signOutAction}>
      <button type="submit" className={className}>
        Sign out
      </button>
    </form>
  )
}
