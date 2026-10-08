import Link from 'next/link'
import { notFound } from 'next/navigation'
import { FineSospensione } from '@/components/moderation/fine-sospensione'
import { Registro } from '@/components/moderation/registro'
import { SospensioneForm } from '@/components/moderation/sospensione-form'
import { soloGiorno } from '@/lib/date'
import { sessionIsFresh } from '@/lib/dal'
import { metadataAdmin, requireAdmin } from '@/lib/moderation/guard'
import { cercaHandle, listLog, userModerationSummary } from '@/lib/moderation/queries'

export const generateMetadata = () => metadataAdmin('User')

// Per utente, come le altre pagine admin (vedi app/admin/page.tsx).
export const instant = false

function Numero({ n, label, sotto }: { n: number; label: string; sotto?: string }) {
  return (
    <div className="px-3 py-2.5">
      <dt className="text-[11px] text-tenue">{label}</dt>
      <dd className="numeri text-[15px] font-semibold text-inchiostro">{n}</dd>
      {sotto && <dd className="text-[11px] text-tenue">{sotto}</dd>}
    </div>
  )
}

export default async function UtentePage({ params }: PageProps<'/admin/users/[handle]'>) {
  const mod = await requireAdmin()
  const handle = cercaHandle((await params).handle)
  if (!handle) notFound()
  const u = await userModerationSummary(handle)
  if (!u) notFound()
  const [{ voci }, fresh] = await Promise.all([listLog(0, { authorId: u.id }), sessionIsFresh()])
  // mod_suspend_user rifiuta se stessi e gli altri admin: il modulo non
  // compare. Un admin sospeso a mano (SQL) si puo' pero' riattivare.
  const sospendibile = u.id !== mod.id && (u.role !== 'admin' || u.suspended)

  return (
    <div className="space-y-8">
      <p className="text-[12px]">
        <Link href="/admin/users" className="text-tenue underline decoration-linea-forte underline-offset-2 hover:text-inchiostro">Users</Link>
      </p>
      <section aria-labelledby="utente">
        <h2 id="utente" className="text-xl font-semibold tracking-tight text-inchiostro break-all">{u.handle}</h2>
        <p className="mt-1 text-[12px] text-tenue">
          {u.role} · joined <time dateTime={u.createdAt.toISOString()}>{soloGiorno(u.createdAt)}</time>
        </p>
        <dl className="mt-4 grid grid-cols-2 sm:grid-cols-5 border border-linea rounded-[var(--raggio)] bg-superficie divide-x divide-y sm:divide-y-0 divide-linea">
          <Numero n={u.clears} label="Clears" sotto={u.clearsHidden ? `${u.clearsHidden} hidden` : undefined} />
          <Numero n={u.comments} label="Comments" sotto={u.commentsHidden ? `${u.commentsHidden} hidden` : undefined} />
          <Numero n={u.openReports} label="Open reports" />
          <Numero n={u.allReports} label="Reports in total" />
          <Numero n={u.reportsSent} label="Reports sent" />
        </dl>
      </section>

      <section aria-labelledby="sospensione">
        <h2 id="sospensione" className="text-[13px] font-semibold text-inchiostro">Suspension</h2>
        {u.suspended ? (
          <div className="mt-2 rounded-[var(--raggio)] border border-str px-3 py-2">
            <p className="text-[13px] text-str"><FineSospensione u={u} /></p>
            {u.reason && <p className="mt-1 text-[12px] text-testo break-words">Reason shown to them: “{u.reason}”</p>}
          </div>
        ) : (
          <p className="mt-1 text-[12px] text-tenue">
            Not suspended. A suspended user can still read, change settings and delete their posts or account, but cannot post, vote, comment or report.
          </p>
        )}
        <div className="mt-3">
          {sospendibile ? (
            <SospensioneForm key={u.suspended ? 'sospeso' : 'attivo'} userId={u.id} handle={u.handle} fresh={fresh} suspended={u.suspended} />
          ) : (
            <p className="text-[12px] text-tenue">{u.id === mod.id ? 'You cannot suspend yourself.' : 'Admins cannot be suspended.'}</p>
          )}
        </div>
      </section>

      <section aria-labelledby="storia">
        <h2 id="storia" className="text-[13px] font-semibold text-inchiostro">History</h2>
        <p className="mt-1 text-[12px] text-tenue">Actions on this user and their posts, the last 50.</p>
        <div className="mt-3"><Registro voci={voci} vuoto="No moderation actions yet." /></div>
      </section>
    </div>
  )
}
