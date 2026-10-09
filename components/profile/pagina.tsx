import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'
import { listUserClearsCached, resolveHandleCached } from '@/lib/cache/profiles'
import { PROFILE_CLEARS_PER_PAGE, parseHandle, type PublicProfile } from '@/lib/profiles'
import { profileHref } from '@/lib/urls'
import { Paginazione } from '@/components/paginazione'
import { RigaClear } from '@/components/profile/riga-clear'
import { ModificaProfilo, ProfiloVuoto } from '@/components/profile/proprietario'

// Il corpo del profilo pubblico, per /users/<handle> e /users/<handle>/p/<n>.
// Legge solo dati in cache e non legge mai la sessione: la pagina e' la
// stessa per tutti. Il proprietario si riconosce dopo, nelle isole client
// (components/profile/proprietario.tsx), da /api/me.
//
// Cosa mostra (decisione del proprietario del sito): handle, versione del
// gioco, mese d'iscrizione, i conteggi e la lista dei clear. Niente
// avatar (la privacy promette che l'immagine del provider non si mostra),
// niente ruolo, niente commenti.

const MESE = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const VERSIONE = { global: 'Global', japan: 'Japan' } as const

/**
 * Il profilo dell'URL, o una risposta che non e' la pagina: notFound()
 * per chi non c'e' (o e' sospeso), un 308 per un nome lasciato e per le
 * maiuscole diverse (/users/GOKU -> /users/Goku), con la stessa pagina.
 */
async function profiloDi(raw: string, page: number): Promise<PublicProfile> {
  const handle = parseHandle(raw)
  if (!handle) notFound()
  const r = await resolveHandleCached(handle)
  if (!r) notFound()
  if (r.kind === 'moved') permanentRedirect(profileHref(r.handle, page))
  if (r.profile.handle !== handle) permanentRedirect(profileHref(r.profile.handle, page))
  return r.profile
}

/** Il titolo e l'indicizzazione: niente indice per i profili senza clear. */
export async function metadataProfilo(raw: string, page: number | null): Promise<Metadata> {
  const handle = parseHandle(raw)
  if (!handle || !page) return {}
  const r = await resolveHandleCached(handle)
  if (r?.kind !== 'found') return {}
  const p = r.profile
  const n = p.clears
  return {
    title: page > 1 ? `${p.handle}, page ${page}` : p.handle,
    description: `${p.handle} has shared ${n} ${n === 1 ? 'clear' : 'clears'} for Dokkan Battle events.`,
    alternates: { canonical: profileHref(p.handle, page) },
    robots: { index: n > 0 },
  }
}

function Conteggio({ nome, n }: { nome: string; n: number }) {
  return (
    <div className="px-3 py-2.5">
      <dt className="text-[11px] text-tenue">{nome}</dt>
      <dd className="numeri mt-0.5 text-lg font-semibold text-inchiostro">{n.toLocaleString('en-US')}</dd>
    </div>
  )
}

/** page null: un segmento /p/<n> che non segue la grammatica (404). */
export async function ProfilePage({ raw, page }: { raw: string; page: number | null }) {
  if (!page) notFound()
  const p = await profiloDi(raw, page)
  const ultima = Math.max(1, Math.ceil(p.clears / PROFILE_CLEARS_PER_PAGE))
  if (page > ultima) notFound()
  const clears = p.clears > 0 ? await listUserClearsCached(p.handle, (page - 1) * PROFILE_CLEARS_PER_PAGE) : []

  return (
    <div className="mx-auto max-w-6xl px-5 py-8">
      <header className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <span
          aria-hidden="true"
          className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-superficie-2 border border-linea text-lg font-semibold uppercase text-inchiostro"
        >
          {p.handle.slice(0, 1)}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight text-inchiostro break-all">{p.handle}</h1>
          <p className="mt-1 text-[13px] text-testo">
            Plays {VERSIONE[p.reg] ?? 'Global'}
            <span aria-hidden className="mx-2 text-tenue">·</span>
            <span className="text-tenue">Joined {MESE.format(p.joined_at)}</span>
          </p>
        </div>
        <ModificaProfilo handle={p.handle} />
      </header>

      <dl className="mt-6 grid max-w-md grid-cols-3 divide-x divide-linea border border-linea rounded-[var(--raggio)] bg-superficie">
        <Conteggio nome="Clears" n={p.clears} />
        <Conteggio nome="Upvotes received" n={p.upvotes} />
        <Conteggio nome="Comments" n={p.comments} />
      </dl>

      <section className="mt-8 max-w-3xl" aria-labelledby="clears">
        <h2 id="clears" className="text-[13px] font-semibold text-inchiostro">Clears</h2>
        <div className="mt-2">
          {clears.length === 0 ? (
            <ProfiloVuoto handle={p.handle} />
          ) : (
            <ol className="divide-y divide-linea border-y border-linea">
              {clears.map((c) => <RigaClear key={c.id} c={c} />)}
            </ol>
          )}
        </div>
        <Paginazione pagina={page} ultima={ultima} href={(n) => profileHref(p.handle, n)} etichetta="Clear pages" />
      </section>
    </div>
  )
}
