import type { Metadata } from 'next'
import Link from 'next/link'
import { ArtPreference } from '@/components/auth/art-preference'
import { ChangeHandle } from '@/components/auth/change-handle'
import { HandleLink } from '@/components/handle-link'
import { DeleteAccount } from '@/components/auth/delete-account'
import { DigestEmail } from '@/components/notifiche/digest-email'
import { BannerSospeso } from '@/components/moderation/banner-sospeso'
import { LinkProvider } from '@/components/auth/link-provider'
import { ProviderLogo } from '@/components/auth/provider-logo'
import { SignOutButton } from '@/components/auth/sign-out-button'
import { AvvisoIOS } from '@/components/pwa/avviso-ios'
import { SceltaTema } from '@/components/tema/scelta-tema'
import { UnlinkProvider } from '@/components/auth/unlink-provider'
import { canUnlink } from '@/lib/auth/account'
import { PROVIDERS } from '@/lib/auth/env'
import { providers } from '@/lib/auth/auth'
import { authErrorMessage } from '@/lib/auth/messages'
import { accountEmail, linkedProviderIds, requireOnboardedUser, sessionIsFresh } from '@/lib/dal'
import { hiddenClearsOf } from '@/lib/clears'
import { nextHandleChange } from '@/lib/auth/handle-change'
import { handleChangedAt } from '@/lib/auth/handle-state'
import { soloGiorno } from '@/lib/date'
import { emailDigestOn } from '@/lib/notify/queries'
import { PushBrowser } from '@/components/notifiche/push-browser'
import { pushDevicesOf, pushKindsOn } from '@/lib/notify/push'
import { readPushEnv } from '@/lib/notify/push-env'
import { pushGroupsOn } from '@/lib/notify/push-kinds'
import { editClearHref } from '@/lib/urls'

export const metadata: Metadata = { title: 'Settings', robots: { index: false } }

// Pagina per utente: legge la sessione in cima, fuori da ogni <Suspense>.
// instant = false la toglie dalla verifica dello shell statico di
// cacheComponents, cosi' i redirect (a /login, a /welcome) restano 307
// veri e notFound() un 404 vero, invece di uno streaming con 200.
export const instant = false

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export default async function SettingsPage({ searchParams }: PageProps<'/settings'>) {
  const user = await requireOnboardedUser('/settings')
  const sp = await searchParams
  // fresh decide solo cosa mostrare al clic: lo ricontrollano le Server
  // Action e l'hook di /link-social, perche' la pagina puo' restare aperta.
  // Le push solo con le chiavi VAPID: senza, la riga Browser non c'e'.
  const push = readPushEnv()
  const [linked, { email, verified }, fresh, nascosti, cambiato, digest, dispositivi, pushKinds] = await Promise.all([
    linkedProviderIds(), accountEmail(), sessionIsFresh(), hiddenClearsOf(user.id), handleChangedAt(user.id),
    emailDigestOn(user.id), push ? pushDevicesOf(user.id) : [], push ? pushKindsOn(user.id) : [],
  ])
  const prossimoCambio = nextHandleChange(cambiato)
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
        Signed in as <HandleLink handle={user.handle} className="font-medium text-inchiostro" />.
      </p>
      {user.suspended && user.suspendedUntil && (
        <BannerSospeso until={user.suspendedUntil} reason={user.suspensionReason} className="mt-6 max-w-lg" />
      )}

      {/* id: il link "Edit profile" della pagina del profilo porta qui */}
      <section className="mt-8 max-w-lg" aria-labelledby="handle">
        <h2 id="handle" className="scroll-mt-6 text-[13px] font-semibold text-inchiostro">
          Handle
        </h2>
        <div className="mt-3 border border-linea rounded-[var(--raggio)] bg-superficie px-4 py-3">
          <ChangeHandle
            handle={user.handle}
            fresh={fresh}
            nextChange={prossimoCambio ? soloGiorno(prossimoCambio) : null}
          />
        </div>
      </section>

      <section className="mt-8 max-w-lg" aria-labelledby="display">
        <h2 id="display" className="text-[13px] font-semibold text-inchiostro">
          Display
        </h2>
        <h3 className="mt-3 text-[12px] font-medium text-inchiostro">Artwork</h3>
        <p className="mt-0.5 text-[12px] leading-relaxed text-tenue">What card pages show first.</p>
        <div className="mt-3 border border-linea rounded-[var(--raggio)] bg-superficie px-4 py-3">
          <ArtPreference animated={user.prefersAnimated} />
        </div>
        <h3 className="mt-5 text-[12px] font-medium text-inchiostro">Theme</h3>
        <p className="mt-0.5 text-[12px] leading-relaxed text-tenue">The colors of the whole site.</p>
        <div className="mt-3 border border-linea rounded-[var(--raggio)] bg-superficie px-4 py-3">
          <SceltaTema />
        </div>
      </section>

      {/* Cosa arriva nella lista, poi le push del browser (0031) e il
          digest email (0029), spenti per difetto. */}
      <section className="mt-8 max-w-lg" aria-labelledby="notifications">
        <h2 id="notifications" className="scroll-mt-6 text-[13px] font-semibold text-inchiostro">
          Notifications
        </h2>
        <p className="mt-1 text-[12px] leading-relaxed text-tenue">
          Your <Link href="/notifications" prefetch={false} className="underline decoration-oro-linea underline-offset-2 hover:text-inchiostro">notifications</Link> list
          is always on. A dot next to the bell in the header means something new arrived.
        </p>
        <ul className="mt-3 border border-linea rounded-[var(--raggio)] bg-superficie divide-y divide-linea">
          <li className="px-4 py-3">
            <p className="text-[13px] text-inchiostro">Comments on your clears</p>
            <p className="text-[12px] text-tenue">Several comments on the same clear are grouped until you read them.</p>
          </li>
          <li className="px-4 py-3">
            <p className="text-[13px] text-inchiostro">Moderation of your posts and account</p>
            <p className="text-[12px] text-tenue">When a moderator hides or restores one of your posts, or suspends your account or lifts a suspension.</p>
          </li>
          {user.role === 'admin' && (
            <li className="px-4 py-3">
              <p className="text-[13px] text-inchiostro">New reports</p>
              <p className="text-[12px] text-tenue">Only for moderators. Reports you send, or reports about your own posts, are left out.</p>
            </li>
          )}
        </ul>
        {push && (
          <>
            <h3 className="mt-5 text-[12px] font-medium text-inchiostro">Browser notifications</h3>
            <div className="mt-3 border border-linea rounded-[var(--raggio)] bg-superficie px-4 py-3">
              <PushBrowser
                publicKey={push.publicKey}
                handle={user.handle}
                admin={user.role === 'admin'}
                devices={dispositivi.map((d) => ({ id: d.id, label: d.label, hash: d.hash, added: soloGiorno(new Date(d.createdAt)), failing: d.failing }))}
                groupsOn={pushGroupsOn(pushKinds, user.role === 'admin')}
              />
            </div>
          </>
        )}
        <h3 className="mt-5 text-[12px] font-medium text-inchiostro">Email</h3>
        <div className="mt-3 border border-linea rounded-[var(--raggio)] bg-superficie px-4 py-3">
          <DigestEmail on={digest} verified={verified} email={email} admin={user.role === 'admin'} />
        </div>
      </section>

      <section className="mt-8 max-w-lg" aria-labelledby="accounts">
        <h2 id="accounts" className="text-[13px] font-semibold text-inchiostro">
          Sign-in methods
        </h2>
        <p className="mt-1 text-[12px] leading-relaxed text-tenue">
          Link another account to sign in with it too. Only accounts you link here are connected.
        </p>

        {/* Solo nell'app installata su iOS: il magic link si aprirebbe in Safari */}
        <AvvisoIOS providers={providers.map((p) => p.label)} dove="settings" className="mt-3" />
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
              <p className="flex items-center gap-2 text-[13px] text-inchiostro">
                <ProviderLogo id={p.id} />
                {p.label}
                {linked.includes(p.id) && <span className="text-[12px] text-oro font-medium">Linked</span>}
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

      {nascosti.length > 0 && (
        // Fuori dalle liste: da qui l'autore li ritrova per cambiarli o cancellarli
        <section className="mt-8 max-w-lg" aria-labelledby="nascosti">
          <h2 id="nascosti" className="text-[13px] font-semibold text-inchiostro">
            Hidden by a moderator
          </h2>
          <p className="mt-1 text-[12px] leading-relaxed text-tenue">
            Other players cannot see these clears. You can still edit or delete them.
          </p>
          <ul className="mt-3 border border-linea rounded-[var(--raggio)] bg-superficie divide-y divide-linea">
            {nascosti.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3">
                <p className="text-[13px] text-inchiostro">
                  {c.event_name ?? `Event ${c.event_id}`}
                  <span className="ml-2 text-[12px] text-tenue">{soloGiorno(c.created_at)}</span>
                </p>
                <Link href={editClearHref(c.event_id, c.id)} prefetch={false} className="text-[12px] text-testo underline decoration-oro-linea underline-offset-2 hover:text-inchiostro">
                  Open<span className="sr-only"> this clear</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

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
              players&apos; clears. Linked sign-in methods, notification settings and devices are removed, and you are signed out everywhere.
            </p>
          </div>
          <DeleteAccount handle={user.handle} fresh={fresh} />
        </div>
      </section>
    </div>
  )
}
