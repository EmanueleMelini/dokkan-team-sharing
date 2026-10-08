import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Builder } from '@/components/builder/builder'
import { Intestazione } from '@/components/builder/intestazione'
import { statoVuoto } from '@/lib/clears/builder-stato'
import { datiBuilder } from '@/lib/clears/pagina-builder'
import { requireOnboardedUser } from '@/lib/dal'
import { regione, uno, type Ricerca } from '@/lib/parametri'

export const metadata: Metadata = { title: 'Submit a clear', robots: { index: false } }

// Come nella pagina dell'evento: gli id finiscono in un cast ::bigint
const idValido = (id: string | undefined): id is string => !!id && /^\d{1,18}$/.test(id)

export default async function InviaClear(props: PageProps<'/events/[id]/submit'>) {
  const { id } = await props.params
  const sp = (await props.searchParams) as Ricerca
  const tier = uno(sp.tier)
  if (!idValido(id) || !idValido(tier)) notFound()
  const reg = regione(sp)
  const qs = new URLSearchParams({ ...(reg === 'japan' ? { region: reg } : {}), tier })
  // Prima l'accesso: chi non è entrato torna qui dopo /login e /welcome
  await requireOnboardedUser(`/events/${id}/submit?${qs}`)

  const dati = await datiBuilder(id, reg, tier)
  if (!dati) notFound()
  const indietro = `/events/${id}?${qs}#clear`

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-5 py-8">
      <Intestazione titolo="Submit a clear" evento={dati.evento.name} livello={dati.nomeTier} indietro={indietro} />
      {dati.runPredefinita ? (
        <Builder
          modo="submit"
          eventId={id}
          tierId={tier}
          runs={dati.runs}
          categorie={dati.categorie}
          iniziale={statoVuoto(dati.runPredefinita)}
          annulla={indietro}
        />
      ) : (
        <p className="mt-8 border border-dashed border-linea-forte rounded-[var(--raggio)] px-6 py-10 text-center text-[13px] text-testo">
          This event has not started yet in the {reg === 'japan' ? 'Japanese' : 'Global'} version, so it cannot have clears.
        </p>
      )}
    </div>
  )
}
