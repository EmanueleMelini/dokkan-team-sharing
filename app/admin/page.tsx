import { notFound } from 'next/navigation'
import { CodaReport } from '@/components/moderation/coda-report'
import { Paginazione } from '@/components/paginazione'
import { metadataAdmin, requireAdmin } from '@/lib/moderation/guard'
import { listOpenReports, PER_PAGINA } from '@/lib/moderation/queries'
import { pagina } from '@/lib/moderation/pagina'

// il template di app/admin/layout.tsx vale solo per i segmenti figli, non
// per la pagina dello stesso segmento: qui il titolo si scrive intero
export const generateMetadata = () => metadataAdmin('Reports · Moderation')

// Per utente: il layout ha gia' il cancello, ma pagina e layout girano in
// parallelo e le query partirebbero prima del suo 404. Lo rifa' qui.
export const instant = false

export default async function CodaPage({ searchParams }: PageProps<'/admin'>) {
  await requireAdmin()
  const page = pagina((await searchParams).page)
  if (page === null) notFound()
  const { gruppi, totale } = await listOpenReports(page)
  const ultima = Math.max(1, Math.ceil(totale / PER_PAGINA))

  return (
    <section aria-labelledby="coda">
      <h2 id="coda" className="text-[13px] font-semibold text-inchiostro">
        Open reports <span className="numeri font-normal text-tenue">{totale}</span>
      </h2>
      <p className="mt-1 text-[12px] text-tenue">Oldest first. Hiding a post closes its reports; you can unhide it from Hidden.</p>
      <div className="mt-3">
        {gruppi.length === 0 ? (
          <p className="border border-linea rounded-[var(--raggio)] bg-superficie px-4 py-6 text-[13px] text-tenue">No open reports.</p>
        ) : (
          <CodaReport gruppi={gruppi} />
        )}
      </div>
      <Paginazione pagina={page} ultima={ultima} href={(n) => (n > 1 ? `/admin?page=${n}` : '/admin')} etichetta="Report pages" />
    </section>
  )
}
