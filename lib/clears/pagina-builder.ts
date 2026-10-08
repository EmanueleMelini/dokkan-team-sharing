import 'server-only'
import { listCategories, type CategoryOption } from '@/lib/cards'
import { listStartedRuns } from '@/lib/clears'
import { listPotentialSkills } from '@/lib/equipment'
import { quando } from '@/lib/date'
import { nomeTier } from '@/lib/livelli'
import { getEvent, getStages, type EventDetail, type Region } from '@/lib/queries'
import type { RunScelta } from '@/lib/clears/builder-stato'

// Quello che serve alle pagine del builder (invio e modifica): l'evento,
// il livello scelto, le ricorrenze già iniziate e le categorie del picker.

export type DatiBuilder = {
  evento: EventDetail
  nomeTier: string
  runs: RunScelta[]
  /** la ricorrenza mostrata nella pagina dell'evento, se è tra quelle iniziate */
  runPredefinita: string | null
  categorie: CategoryOption[]
  /** le abilita' del Hidden Potential (0018), suggerite nelle build */
  abilita: string[]
}

export async function datiBuilder(eventId: string, reg: Region, tierId: string): Promise<DatiBuilder | null> {
  const [evento, stages, runs, categorie, abilita] = await Promise.all([
    getEvent(eventId, reg), getStages(eventId, reg), listStartedRuns(eventId, reg), listCategories(),
    listPotentialSkills(),
  ])
  if (!evento) return null
  const tier = stages.find((s) => s.tier_id === tierId)
  if (!tier) return null
  const eza = stages.every((s) => s.difficulty === 'eza_level')

  const scelte: RunScelta[] = runs.map((r) => {
    const dal = quando(r.starts_at, 'wiki')
    const label = r.status === 'active'
      ? `Running now, since ${dal}`
      : r.ends_at ? `${dal} to ${quando(r.ends_at, 'wiki')}` : `From ${dal}`
    return { id: r.id, label }
  })
  const predefinita = runs.find((r) => r.id === evento.run_id)?.id ?? runs[0]?.id ?? null
  return { evento, nomeTier: nomeTier(tier, eza), runs: scelte, runPredefinita: predefinita, categorie, abilita }
}
