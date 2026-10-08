import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { BuilderAzzerabile } from '@/components/builder/builder-azzerabile'
import { BannerSospeso } from '@/components/moderation/banner-sospeso'
import { EliminaClear } from '@/components/clears/elimina'
import { Intestazione } from '@/components/builder/intestazione'
import { getClearForEdit } from '@/lib/clears'
import { statoDaClear } from '@/lib/clears/builder-iniziale'
import { datiBuilder } from '@/lib/clears/pagina-builder'
import { parseUuid } from '@/lib/clears/validate'
import { requireOnboardedUser } from '@/lib/dal'
import { clearAnchor, editClearHref, eventHref } from '@/lib/urls'
import { clearPage } from '@/lib/queries'

export const metadata: Metadata = { title: 'Edit your clear', robots: { index: false } }

// Pagina per utente: legge la sessione in cima, fuori da ogni <Suspense>.
// instant = false la toglie dalla verifica dello shell statico di
// cacheComponents, cosi' i redirect (a /login, a /welcome) restano 307
// veri e notFound() un 404 vero, invece di uno streaming con 200.
export const instant = false

export default async function ModificaClear(props: PageProps<'/events/[id]/clears/[clearId]/edit'>) {
  const { id, clearId: grezzo } = await props.params
  const clearId = parseUuid(grezzo)
  if (!/^\d{1,18}$/.test(id) || !clearId) notFound()
  const user = await requireOnboardedUser(editClearHref(id, clearId))

  // Per chi non è l'autore il clear non esiste: 404, come per un id sbagliato
  const clear = await getClearForEdit(clearId, user.id)
  if (!clear || clear.event_id !== id) notFound()
  const dati = await datiBuilder(id, clear.reg, clear.tier_id)
  if (!dati) notFound()

  // la pagina della lista dove il clear sta davvero
  const page = (await clearPage(clear.tier_id, clear.reg, clear.id)) ?? 1
  const indietro = eventHref({ id, reg: clear.reg, tier: clear.tier_id, page }) + clearAnchor(clear.id)
  // La ricorrenza del clear resta scelta anche se nel frattempo è finita
  const runs = dati.runs.some((r) => r.id === clear.run_id)
    ? dati.runs
    : [{ id: clear.run_id, label: 'The run you picked before' }, ...dati.runs]

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-5 py-8">
      <Intestazione titolo="Edit your clear" evento={dati.evento.name} livello={dati.nomeTier} indietro={indietro} />
      {clear.status === 'hidden' && (
        // Nessuna notifica e nessuna nota del moderatore: solo il fatto (spec)
        <div role="status" className="mt-4 max-w-[70ch] text-[12px] leading-relaxed text-inchiostro bg-oro-tenue border border-oro-linea rounded-[var(--raggio)] px-3 py-2 space-y-2">
          <p>
            A moderator hid this clear. Other players cannot see it, and it stays hidden if you edit it.
            You can still delete it here.
          </p>
          {/* nascosto vuol dire fuori dalla lista: il Delete della pagina dell'evento non c'e' */}
          <EliminaClear clearId={clear.id} tornaAllEvento />
        </div>
      )}
      {user.suspended && user.suspendedUntil ? (
        <BannerSospeso until={user.suspendedUntil} reason={user.suspensionReason} className="mt-6" />
      ) : (
        <>
      <p className="mt-3 text-[12px] text-tenue max-w-[70ch]">
        Saving makes version {clear.version_seq + 1}. The current version keeps its votes and comments in the history.
      </p>
      <BuilderAzzerabile
        modo="edit"
        eventId={id}
        tierId={clear.tier_id}
        clearId={clear.id}
        runs={runs}
        categorie={dati.categorie}
        abilita={dati.abilita}
        iniziale={statoDaClear(clear)}
        annulla={indietro}
      />
        </>
      )}
    </div>
  )
}
