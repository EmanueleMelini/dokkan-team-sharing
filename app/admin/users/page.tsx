import Link from 'next/link'
import { utenteHref } from '@/components/moderation/coda-report'
import { FineSospensione } from '@/components/moderation/fine-sospensione'
import { metadataAdmin, requireAdmin } from '@/lib/moderation/guard'
import { cercaHandle, findUserByHandle, listSuspended, type UtenteTrovato } from '@/lib/moderation/queries'

export const generateMetadata = () => metadataAdmin('Users')

// Per utente, come le altre pagine admin (vedi app/admin/page.tsx).
export const instant = false

function Righe({ utenti, vuoto }: { utenti: UtenteTrovato[]; vuoto: string }) {
  if (utenti.length === 0) {
    return <p className="mt-3 border border-linea rounded-[var(--raggio)] bg-superficie px-4 py-4 text-[13px] text-tenue">{vuoto}</p>
  }
  return (
    <ul className="mt-3 border border-linea rounded-[var(--raggio)] bg-superficie divide-y divide-linea">
      {utenti.map((u) => (
        <li key={u.id} className="px-4 py-2.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <Link href={utenteHref(u.handle)} prefetch={false}
            className="text-[13px] font-medium text-inchiostro underline decoration-linea-forte underline-offset-2 hover:decoration-oro">
            {u.handle}
          </Link>
          <span className="text-[12px] text-tenue">
            {u.role !== 'member' && <span className="mr-2">{u.role}</span>}
            {u.suspended ? <span className="text-str"><FineSospensione u={u} /></span> : 'Active'}
          </span>
        </li>
      ))}
    </ul>
  )
}

export default async function UtentiPage({ searchParams }: PageProps<'/admin/users'>) {
  await requireAdmin()
  const grezzo = (await searchParams).q
  const q = typeof grezzo === 'string' ? grezzo.trim() : ''
  const valido = cercaHandle(q)
  const [trovati, sospesi] = await Promise.all([valido ? findUserByHandle(valido) : Promise.resolve([]), listSuspended()])

  return (
    <div className="space-y-10">
      <section aria-labelledby="cerca">
        <h2 id="cerca" className="text-[13px] font-semibold text-inchiostro">Find a user</h2>
        <form action="/admin/users" method="get" className="mt-2 flex flex-wrap gap-2" role="search">
          <label htmlFor="q" className="sr-only">Handle</label>
          <input id="q" name="q" type="search" defaultValue={q} placeholder="Handle or its first letters"
            autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={24}
            className="w-full max-w-xs px-2.5 py-1.5 text-[13px] rounded-[var(--raggio)] border border-campo bg-superficie text-inchiostro" />
          <button type="submit"
            className="px-3 py-1.5 text-[13px] font-medium rounded-[var(--raggio)] bg-inchiostro text-sfondo hover:opacity-90 transition-opacity active:scale-[0.98]">
            Search
          </button>
        </form>
        {q && !valido && <p className="mt-2 text-[12px] text-str">Handles use only letters, digits and underscores.</p>}
        {valido && <Righe utenti={trovati} vuoto={`No user starts with "${valido}".`} />}
      </section>

      <section aria-labelledby="sospesi">
        <h2 id="sospesi" className="text-[13px] font-semibold text-inchiostro">
          Suspended now <span className="numeri font-normal text-tenue">{sospesi.length}</span>
        </h2>
        <Righe utenti={sospesi} vuoto="Nobody is suspended." />
      </section>
    </div>
  )
}
