import Link from 'next/link'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { EmailSignIn } from '@/components/auth/email-sign-in'
import { ProviderButtons } from '@/components/auth/provider-buttons'
import { AvvisoIOS } from '@/components/pwa/avviso-ios'
import { providers } from '@/lib/auth/auth'
import { authErrorMessage } from '@/lib/auth/messages'
import { safeNext } from '@/lib/auth/safe-next'
import { currentUser } from '@/lib/dal'

export const metadata: Metadata = { title: 'Sign in', robots: { index: false } }

// Pagina per utente: legge la sessione in cima, fuori da ogni <Suspense>.
// instant = false la toglie dalla verifica dello shell statico di
// cacheComponents, cosi' i redirect (a /login, a /welcome) restano 307
// veri e notFound() un 404 vero, invece di uno streaming con 200.
export const instant = false

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const sp = await searchParams
  const next = safeNext(one(sp.next), '/events')
  const user = await currentUser()
  if (user) redirect(user.onboarded ? next : `/welcome?next=${encodeURIComponent(next)}`)

  const error = authErrorMessage(one(sp.error))

  return (
    <div className="mx-auto max-w-6xl px-5 py-12">
      <div className="max-w-sm mx-auto border border-linea rounded-[var(--raggio)] bg-superficie px-6 py-8">
        <h1 className="text-lg font-semibold tracking-tight text-inchiostro">Sign in</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-testo">
          Sign in to share your clears and vote on others. Reading the site needs no account.
        </p>

        {error && (
          <p role="alert" className="mt-5 text-[12px] leading-relaxed text-inchiostro bg-oro-tenue border border-oro-linea rounded-[var(--raggio)] px-3 py-2">
            {error}
          </p>
        )}

        {/* Solo nell'app installata su iOS: il magic link si aprirebbe in Safari */}
        <AvvisoIOS providers={providers.map((p) => p.label)} dove="login" className="mt-5" />

        {providers.length > 0 && (
          <div className="mt-6">
            <ProviderButtons providers={providers} next={next} />
            <div className="my-5 flex items-center gap-3 text-[11px] text-tenue" aria-hidden="true">
              <span className="h-px flex-1 bg-linea" />
              or
              <span className="h-px flex-1 bg-linea" />
            </div>
          </div>
        )}

        <div className={providers.length > 0 ? '' : 'mt-6'}>
          <EmailSignIn next={next} />
        </div>

        <p className="mt-6 text-[11px] leading-relaxed text-tenue">
          New here? Signing in creates your account. You will pick a handle next. By continuing you
          agree to the{' '}
          <Link href="/terms" className="underline decoration-oro-linea underline-offset-2 hover:text-inchiostro">
            Terms of Service
          </Link>{' '}
          and acknowledge the{' '}
          <Link href="/privacy" className="underline decoration-oro-linea underline-offset-2 hover:text-inchiostro">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </div>
  )
}
