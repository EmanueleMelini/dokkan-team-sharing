import type { Metadata } from 'next'
import { LinkProvider } from '@/components/auth/link-provider'
import { SignOutButton } from '@/components/auth/sign-out-button'
import { PROVIDERS } from '@/lib/auth/env'
import { providers } from '@/lib/auth/auth'
import { authErrorMessage } from '@/lib/auth/messages'
import { accountEmail, linkedProviderIds, requireOnboardedUser } from '@/lib/dal'

export const metadata: Metadata = { title: 'Settings', robots: { index: false } }

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export default async function SettingsPage({ searchParams }: PageProps<'/settings'>) {
  const user = await requireOnboardedUser('/settings')
  const sp = await searchParams
  const [linked, email] = await Promise.all([linkedProviderIds(), accountEmail()])
  const error = authErrorMessage(one(sp.error))
  const justLinked = PROVIDERS.find((p) => p.id === one(sp.linked) && linked.includes(p.id))

  // Quelli gia' collegati si mostrano anche se il provider e' stato spento
  // dopo: l'utente deve vedere cosa e' legato al suo account.
  const rows = PROVIDERS.filter((p) => linked.includes(p.id) || providers.some((e) => e.id === p.id))

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-inchiostro">Settings</h1>
      <p className="mt-1.5 text-sm text-testo">
        Signed in as <span className="font-medium text-inchiostro">{user.handle}</span>.
      </p>

      <section className="mt-8 max-w-lg" aria-labelledby="accounts">
        <h2 id="accounts" className="text-[13px] font-semibold text-inchiostro">
          Sign-in methods
        </h2>
        <p className="mt-1 text-[12px] leading-relaxed text-tenue">
          Link another account to sign in with it too. Only accounts you link here are connected.
        </p>

        {error && (
          <p role="alert" className="mt-3 text-[12px] text-inchiostro bg-oro-tenue border border-oro-linea rounded-[var(--raggio)] px-3 py-2">
            {error}
          </p>
        )}
        {justLinked && !error && (
          <p role="status" className="mt-3 text-[12px] text-inchiostro bg-oro-tenue border border-oro-linea rounded-[var(--raggio)] px-3 py-2">
            {justLinked.label} is now linked.
          </p>
        )}

        <ul className="mt-3 border border-linea rounded-[var(--raggio)] bg-superficie divide-y divide-linea">
          <li className="flex items-center justify-between gap-3 px-4 py-3">
            <div>
              <p className="text-[13px] text-inchiostro">Email link</p>
              <p className="text-[12px] text-tenue break-all">{email}</p>
            </div>
            <span className="text-[12px] text-tenue">Always on</span>
          </li>
          {rows.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <p className="text-[13px] text-inchiostro">{p.label}</p>
              {linked.includes(p.id) ? (
                <span className="text-[12px] text-oro font-medium">Linked</span>
              ) : (
                <LinkProvider id={p.id} label={p.label} />
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8 max-w-lg">
        <SignOutButton className="px-3 py-1.5 text-[13px] font-medium rounded-[var(--raggio)] border border-campo bg-superficie text-inchiostro hover:bg-superficie-2 transition-colors" />
      </section>
    </div>
  )
}
