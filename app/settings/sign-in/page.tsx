import type { Metadata } from 'next'
import Link from 'next/link'
import { EmailSignIn } from '@/components/auth/email-sign-in'
import { ProviderButtons } from '@/components/auth/provider-buttons'
import { providers } from '@/lib/auth/auth'
import { authErrorMessage } from '@/lib/auth/messages'
import { accountEmail, linkedProviderIds, requireOnboardedUser, sessionIsFresh } from '@/lib/dal'

export const metadata: Metadata = { title: 'Sign in again', robots: { index: false } }

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

// Dopo l'accesso si torna qui: callbackURL passa da /welcome, che rimanda
// a next chi ha gia' l'handle.
const NEXT = '/settings'
const HERE = '/settings/sign-in'

/**
 * Rientrare restando dentro, per le azioni di Settings che chiedono una
 * sessione fresca (lib/auth/fresh.ts). /login non va bene: rimanda subito
 * via chi ha gia' una sessione. Un nuovo accesso crea una sessione nuova
 * e il cookie la sostituisce; quella vecchia scade da sola. Si offrono
 * solo i modi di entrare di questo account: un provider non collegato
 * aprirebbe un altro account, o finirebbe in account_not_linked.
 */
export default async function SignInAgainPage({ searchParams }: PageProps<'/settings/sign-in'>) {
  await requireOnboardedUser(NEXT)
  const sp = await searchParams
  const [linked, { email, verified }, fresh] = await Promise.all([linkedProviderIds(), accountEmail(), sessionIsFresh()])
  const mine = providers.filter((p) => linked.includes(p.id))
  const error = authErrorMessage(one(sp.error))

  return (
    <div className="mx-auto max-w-6xl px-5 py-12">
      <div className="max-w-sm mx-auto border border-linea rounded-[var(--raggio)] bg-superficie px-6 py-8">
        <h1 className="text-lg font-semibold tracking-tight text-inchiostro">Sign in again</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-testo">
          Changing how you sign in or deleting your account needs a sign-in from the last 15 minutes.
          You stay signed in meanwhile.
        </p>

        {error && (
          <p role="alert" className="mt-5 text-[12px] leading-relaxed text-inchiostro bg-oro-tenue border border-oro-linea rounded-[var(--raggio)] px-3 py-2">
            {error}
          </p>
        )}
        {fresh && !error && (
          <p role="status" className="mt-5 text-[12px] leading-relaxed text-inchiostro bg-oro-tenue border border-oro-linea rounded-[var(--raggio)] px-3 py-2">
            You signed in recently, so you can go straight back to Settings.
          </p>
        )}

        {mine.length > 0 && (
          <div className="mt-6">
            <ProviderButtons providers={mine} next={NEXT} errorPath={HERE} />
          </div>
        )}
        {mine.length > 0 && verified && (
          <div className="my-5 flex items-center gap-3 text-[11px] text-tenue" aria-hidden="true">
            <span className="h-px flex-1 bg-linea" />
            or
            <span className="h-px flex-1 bg-linea" />
          </div>
        )}
        {verified && (
          <div className={mine.length > 0 ? '' : 'mt-6'}>
            <EmailSignIn next={NEXT} errorPath={HERE} defaultEmail={email} />
          </div>
        )}
        {mine.length === 0 && !verified && (
          <p className="mt-6 text-[12px] leading-relaxed text-testo">
            None of your sign-in methods is available right now. Sign out, then sign in from the sign-in page.
          </p>
        )}

        <p className="mt-6 text-[12px]">
          <Link href={NEXT} className="text-oro underline underline-offset-2">
            Back to Settings
          </Link>
        </p>
      </div>
    </div>
  )
}
