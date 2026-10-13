import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { BuilderAzzerabile } from '@/components/builder/builder-azzerabile'
import { BannerSospeso } from '@/components/moderation/banner-sospeso'
import { Intestazione } from '@/components/builder/intestazione'
import { statoVuoto } from '@/lib/clears/builder-stato'
import { datiBuilder } from '@/lib/clears/pagina-builder'
import { requireOnboardedUser } from '@/lib/dal'
import { regione, uno, type Ricerca } from '@/lib/parametri'
import { eventHref, submitHref } from '@/lib/urls'

export const metadata: Metadata = { title: 'Submit a clear', robots: { index: false } }

// Pagina per utente: legge la sessione in cima, fuori da ogni <Suspense>.
// instant = false la toglie dalla verifica dello shell statico di
// cacheComponents, cosi' i redirect (a /login, a /welcome) restano 307
// veri e notFound() un 404 vero, invece di uno streaming con 200.
export const instant = false

// Come nella pagina dell'evento: gli id finiscono in un cast ::bigint
const idValido = (id: string | undefined): id is string => !!id && /^\d{1,18}$/.test(id)

export default async function InviaClear(props: PageProps<'/events/[id]/submit'>) {
  const { id } = await props.params
  const sp = (await props.searchParams) as Ricerca
  const tier = uno(sp.tier)
  if (!idValido(id) || !idValido(tier)) notFound()
  const reg = regione(sp)
  // Prima l'accesso: chi non è entrato torna qui dopo /login e /welcome
  const user = await requireOnboardedUser(submitHref(id, reg, tier))

  const dati = await datiBuilder(id, reg, tier)
  if (!dati) notFound()
  // explicit: si torna alla versione del builder, non a quella scelta nel sito
  const indietro = `${eventHref({ id, reg, tier, explicit: true })}#clear`

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-5 py-8">
      <Intestazione titolo="Submit a clear" evento={dati.evento.name} livello={dati.nomeTier} indietro={indietro} />
      {user.suspended && user.suspendedUntil ? (
        // Il builder non serve: l'invio sarebbe rifiutato (account_suspended)
        <BannerSospeso until={user.suspendedUntil} reason={user.suspensionReason} className="mt-8" />
      ) : dati.runPredefinita ? (
        <BuilderAzzerabile
          modo="submit"
          eventId={id}
          tierId={tier}
          reg={reg}
          runs={dati.runs}
          categorie={dati.categorie}
          abilita={dati.abilita}
          iniziale={statoVuoto(dati.runPredefinita)}
          annulla={indietro}
        />
      ) : (
        <p className="mt-8 border border-dashed border-linea-forte rounded-[var(--raggio)] px-6 py-10 text-center text-[13px] text-testo">
          This event has not started yet in the {reg === 'japan' ? 'Japan' : 'Global'} version, so it cannot have clears.
        </p>
      )}
    </div>
  )
}
