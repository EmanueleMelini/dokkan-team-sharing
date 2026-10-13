import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { OnboardingForm } from '@/components/auth/onboarding-form'
import { suggestHandle } from '@/lib/auth/handle'
import { safeNext } from '@/lib/auth/safe-next'
import { requireUser } from '@/lib/dal'
import { versioneRichiesta } from '@/lib/versione/server'
import { seguiVersione } from '@/lib/versione/versione'

export const metadata: Metadata = { title: 'Welcome', robots: { index: false } }

// Pagina per utente: legge la sessione in cima, fuori da ogni <Suspense>.
// instant = false la toglie dalla verifica dello shell statico di
// cacheComponents, cosi' i redirect (a /login, a /welcome) restano 307
// veri e notFound() un 404 vero, invece di uno streaming con 200.
export const instant = false

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export default async function WelcomePage({ searchParams }: PageProps<'/welcome'>) {
  const sp = await searchParams
  const next = safeNext(one(sp.next), '/events')
  // Senza sessione a /login con lo stesso next: l'accesso riporta qui.
  const user = await requireUser(next)
  const versione = await versioneRichiesta()
  // Chi ha gia' scelto passa e basta: ogni accesso arriva da qui. Questo
  // redirect lo segue il browser (passa dal routing), quindi next potrebbe
  // restare com'e'; risolto qui, si risparmia un 307.
  if (user.onboarded) redirect(seguiVersione(next, versione))

  return (
    <div className="mx-auto max-w-6xl px-5 py-12">
      <div className="max-w-sm mx-auto border border-linea rounded-[var(--raggio)] bg-superficie px-6 py-8">
        <h1 className="text-lg font-semibold tracking-tight text-inchiostro">Welcome</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-testo">
          Pick the handle other players will see and the version of the game you play.
        </p>
        {/* La versione proposta e' quella gia' scelta su questo dispositivo
            (il cookie dts_version esiste solo per Japan), altrimenti quella
            dell'account: Global per un account nuovo. */}
        <OnboardingForm next={next} suggestion={suggestHandle(user.displayName)} reg={versione === 'japan' ? 'japan' : user.reg} />
      </div>
    </div>
  )
}
