import 'server-only'
import { assetUrl } from '@/lib/db'
import { CARTE_FILTRO_MAX, type CartaFiltro, type FacetClear, type Region } from '@/lib/queries'
import { filtriAttivi, type FiltriClear } from '@/lib/clears/filtri'
import { cardLabelsCached, categoryNameCached, getClearFacetsCached } from '@/lib/cache/filters'
import type { OpzioniFiltri } from '@/components/clears/filtri-clear'
import type { OpzioneCarta } from '@/components/clears/scegli-carta'
import type { NomiFiltri } from '@/components/clears/filtri-attivi'

// Quello che la pagina di un tier prepara per i filtri: le opzioni della
// barra (dai clear del tier, in cache) e i nomi per i chip. Solo letture in
// cache: lo usa anche la pagina statica, che non legge mai la sessione.

/** La barra compare da questo numero di clear in su: con uno non c'e' niente da filtrare. */
export const CLEAR_PER_BARRA = 2

const opzione = (c: CartaFiltro): OpzioneCarta => ({
  id: c.id, name: c.name, epithet: c.epithet, type: c.type, class: c.class,
  thumb: assetUrl(c.thumb_key), n: c.n,
})

function opzioni(f: FacetClear): OpzioniFiltri {
  return {
    cards: f.cards.map(opzione),
    leaders: f.leaders.map(opzione),
    types: f.types,
    classes: f.classes,
    categories: f.categories,
  }
}

export type DatiFiltri = {
  /** null sotto CLEAR_PER_BARRA: niente barra */
  opzioni: OpzioniFiltri | null
  nomi: NomiFiltri
  /** una frase per ogni carta dell'URL (usa o leader) che nessun clear del tier usa */
  maiUsate: string[]
}

export async function datiFiltri({ eventId, tierId, reg, totale, filtri }: {
  eventId: string
  tierId: string
  reg: Region
  /** i clear del tier senza filtri */
  totale: number
  filtri: FiltriClear
}): Promise<DatiFiltri> {
  // Le opzioni servono alla barra (da 2 clear) e ai nomi dei chip
  const servono = totale >= CLEAR_PER_BARRA || (totale > 0 && filtriAttivi(filtri) > 0)
  const facets = servono ? await getClearFacetsCached(eventId, tierId, reg) : null
  const note = new Map<string, CartaFiltro>()
  for (const c of [...(facets?.cards ?? []), ...(facets?.leaders ?? [])]) note.set(c.id, c)

  const chieste = [...filtri.cards, ...(filtri.leader ? [filtri.leader] : [])]
  // Le carte oltre le prime 200 del tier non sono fra le opzioni, ma
  // qualcuno le usa: il nome arriva da cardLabels, e "mai usata" lo dice
  // solo il conteggio vero, che qui vale 0 solo se non c'e' nei facets.
  const mancanti = chieste.filter((id) => !note.has(id))
  const [etichette, categoria] = await Promise.all([
    mancanti.length ? cardLabelsCached([...new Set(mancanti)].sort()) : Promise.resolve([]),
    filtri.cat == null ? Promise.resolve(null)
      : facets?.categories.find((c) => c.id === filtri.cat)?.name ?? categoryNameCached(filtri.cat),
  ])
  for (const c of etichette) note.set(c.id, c)

  const nomi = new Map<string, string>()
  for (const id of chieste) nomi.set(id, note.get(id)?.name ?? `Card ${id}`)
  // Con il tetto pieno una carta puo' esserci anche se non e' fra le opzioni
  const tutte = (facets?.cards.length ?? 0) < CARTE_FILTRO_MAX
  const usate = new Set((facets?.cards ?? []).map((c) => c.id))
  const leaderUsati = new Set((facets?.leaders ?? []).map((c) => c.id))
  const maiUsate = [
    ...filtri.cards.filter((id) => tutte && !usate.has(id))
      .map((id) => `Nobody has used ${nomi.get(id)} here yet.`),
    ...(filtri.leader && !leaderUsati.has(filtri.leader)
      ? [`Nobody has led with ${nomi.get(filtri.leader)} here yet.`] : []),
  ]

  return {
    opzioni: facets && totale >= CLEAR_PER_BARRA ? opzioni(facets) : null,
    nomi: { carte: nomi, categoria },
    maiUsate,
  }
}
