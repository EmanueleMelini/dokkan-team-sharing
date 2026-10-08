import { SchedeAdmin } from '@/components/moderation/schede'
import { metadataAdmin, requireAdmin } from '@/lib/moderation/guard'

export const generateMetadata = () =>
  metadataAdmin({ default: 'Moderation', template: '%s · Moderation · Dokkan Team Sharing' })

// Area per utente: il cancello sta qui, in cima e fuori da ogni
// <Suspense>, cosi' chi non e' admin riceve un 404 vero (instant = false
// toglie il segmento dalla verifica dello shell statico, come /settings).
// Il loading.tsx accanto copre solo le pagine sotto, al cambio di scheda.
export const instant = false

export default async function AdminLayout({ children }: LayoutProps<'/admin'>) {
  await requireAdmin()
  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-inchiostro">Moderation</h1>
      <SchedeAdmin />
      <div className="mt-6">{children}</div>
    </div>
  )
}
