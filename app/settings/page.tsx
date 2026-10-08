import type { Metadata } from 'next'
import { DeleteAccount } from '@/components/auth/delete-account'
import { LinkProvider } from '@/components/auth/link-provider'
import { SignOutButton } from '@/components/auth/sign-out-button'
import { UnlinkProvider } from '@/components/auth/unlink-provider'
import { canUnlink } from '@/lib/auth/account'
import { PROVIDERS } from '@/lib/auth/env'
import { providers } from '@/lib/auth/auth'
import { authErrorMessage } from '@/lib/auth/messages'
import { accountEmail, linkedProviderIds, requireOnboardedUser, sessionIsFresh } from '@/lib/dal'

export const metadata: Metadata = { title: 'Settings', robots: { index: false } }

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export default async function SettingsPage({ searchParams }: PageProps<'/settings'>) {
  const user = await requireOnboardedUser('/settings')
  const sp = await searchParams
  // fresh decide solo cosa mostrare al clic: lo ricontrollano le Server
  // Action e l'hook di /link-social, perche' la pagina puo' restare aperta.
  const [linked, { email, verified }, fresh] = await Promise.all([linkedProviderIds(), accountEmail(), sessionIsFresh()])
  const error = authErrorMessage(one(sp.error))
  const justLinked = PROVIDERS.find((p) => p.id === one(sp.linked) && linked.includes(p.id))
  const justUnlinked = PROVIDERS.find((p) => p.id === one(sp.unlinked) && !linked.includes(p.id))
  const notice = justLinked ? `${justLinked.label} is now linked.` : justUnlinked ? `${justUnlinked.label} is unlinked.` : null

  // Con cosa si entrera' dopo aver scollegato `id`: la frase della conferma.
  const fallback = (id: string) => {
    const altri = PROVIDERS.filter((p) => p.id !== id && linked.includes(p.id)).map((p) => p.label)
    if (verified) altri.unshift(`an email link to ${email}`)
    return altri.join(' or ')
  }

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
        {notice && !error && (
          <p role="status" className="mt-3 text-[12px] text-inchiostro bg-oro-tenue border border-oro-linea rounded-[var(--raggio)] px-3 py-2">
            {notice}
          </p>
        )}

        <ul className="mt-3 border border-linea rounded-[var(--raggio)] bg-superficie divide-y divide-linea">
          <li className="flex items-center justify-between gap-3 px-4 py-3">
            <div>
              <p className="text-[13px] text-inchiostro">Email link</p>
              <p className="text-[12px] text-tenue break-all">{email}</p>
            </div>
            <span className="text-[12px] text-tenue shrink-0">{verified ? 'Always on' : 'Not verified'}</span>
          </li>
          {rows.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3">
              <p className="text-[13px] text-inchiostro">
                {p.label}
                {linked.includes(p.id) && <span className="ml-2 text-[12px] text-oro font-medium">Linked</span>}
              </p>
              {!linked.includes(p.id) ? (
                <LinkProvider id={p.id} label={p.label} fresh={fresh} />
              ) : canUnlink(linked, verified, p.id) ? (
                <UnlinkProvider id={p.id} label={p.label} fallback={fallback(p.id)} fresh={fresh} />
              ) : (
                <span className="text-[12px] text-tenue">Your only way to sign in</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8 max-w-lg">
        <SignOutButton className="px-3 py-1.5 text-[13px] font-medium rounded-[var(--raggio)] border border-campo bg-superficie text-inchiostro hover:bg-superficie-2 transition-colors" />
      </section>

      <section className="mt-10 max-w-lg" aria-labelledby="danger">
        <h2 id="danger" className="text-[13px] font-semibold text-str">
          Danger zone
        </h2>
        <div className="mt-3 border border-str/40 rounded-[var(--raggio)] bg-superficie px-4 py-3 space-y-3">
          <div>
            <p className="text-[13px] text-inchiostro">Delete your account</p>
            <p className="mt-1 text-[12px] leading-relaxed text-tenue">
              This deletes your account and everything you posted: your clears with all their versions,
              proofs and builds, your teams, and the votes and comments you left, including those on other
              players&apos; clears. Linked sign-in methods are removed and you are signed out everywhere.
            </p>
          </div>
          <DeleteAccount handle={user.handle} fresh={fresh} />
        </div>
      </section>
    </div>
  )
}
