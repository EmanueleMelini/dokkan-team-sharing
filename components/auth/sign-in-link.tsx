'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'

/** "Sign in" con ?next= alla pagina corrente, per tornarci dopo l'accesso. */
export function SignInLink({ className = '' }: { className?: string }) {
  const path = usePathname()
  const query = useSearchParams().toString()
  const here = query ? `${path}?${query}` : path
  const href = path === '/' || path.startsWith('/login') ? '/login' : `/login?next=${encodeURIComponent(here)}`
  return (
    <Link href={href} className={className}>
      Sign in
    </Link>
  )
}
