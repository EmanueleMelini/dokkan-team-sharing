import { notFound } from 'next/navigation'
import { Registro } from '@/components/moderation/registro'
import { Paginazione } from '@/components/paginazione'
import { metadataAdmin, requireAdmin } from '@/lib/moderation/guard'
import { pagina } from '@/lib/moderation/pagina'
import { listLog, PER_PAGINA } from '@/lib/moderation/queries'

export const generateMetadata = () => metadataAdmin('Log')

// Per utente, come le altre pagine admin (vedi app/admin/page.tsx).
export const instant = false

export default async function RegistroPage({ searchParams }: PageProps<'/admin/log'>) {
  await requireAdmin()
  const page = pagina((await searchParams).page)
  if (page === null) notFound()
  const { voci, altre } = await listLog((page - 1) * PER_PAGINA)
  if (page > 1 && voci.length === 0) notFound()

  return (
    <section aria-labelledby="registro">
      <h2 id="registro" className="text-[13px] font-semibold text-inchiostro">Moderation log</h2>
      <p className="mt-1 text-[12px] text-tenue">Every moderator action, newest first. The log cannot be edited and keeps no post content.</p>
      <div className="mt-3"><Registro voci={voci} /></div>
      <Paginazione pagina={page} ultima={altre ? page + 1 : page}
        href={(n) => (n > 1 ? `/admin/log?page=${n}` : '/admin/log')} etichetta="Log pages" />
    </section>
  )
}
