import Link from 'next/link'
import { SignInLink } from '@/components/auth/sign-in-link'
import { SignOutButton } from '@/components/auth/sign-out-button'
import { currentUser } from '@/lib/dal'

const piccolo = 'text-sm text-tenue hover:text-inchiostro transition-colors'

/**
 * La parte dell'header che dipende dalla sessione. Sta dentro un
 * <Suspense> nel layout: leggere i cookie qui non blocca il resto della
 * pagina (guida authentication di Next).
 */
export async function UserMenu() {
  const user = await currentUser()
  if (!user) return <SignInLink className={piccolo} />

  if (!user.onboarded) {
    return (
      <div className="flex items-center gap-4">
        <Link href="/welcome" className="text-sm text-oro font-medium hover:underline underline-offset-2">
          Finish setup
        </Link>
        <SignOutButton className={piccolo} />
      </div>
    )
  }

  return (
    <div className="flex items-center gap-4">
      <Link
        href="/settings"
        aria-label={`Settings for ${user.handle}`}
        className="flex items-center gap-2 text-sm text-inchiostro hover:text-oro transition-colors"
      >
        <span
          aria-hidden="true"
          className="inline-flex size-6 items-center justify-center rounded-full bg-superficie-2 border border-linea text-[11px] font-semibold uppercase"
        >
          {user.handle.slice(0, 1)}
        </span>
        {/* Sul telefono basta l'iniziale: l'header ha gia' titolo, Events e Sign out. */}
        <span className="hidden sm:inline max-w-[12rem] truncate">{user.handle}</span>
      </Link>
      <SignOutButton className={piccolo} />
    </div>
  )
}
