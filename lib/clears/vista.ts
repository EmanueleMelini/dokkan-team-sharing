import 'server-only'
import type { ClearRow } from '@/lib/queries'
import type { ClearComment, VersionLineup } from '@/lib/clears'
import { clearExtrasCached } from '@/lib/cache/data'

// Quello che la pagina di un evento aggiunge a ogni clear mostrato: i cambi
// di squadra e i commenti. Solo la parte pubblica, uguale per tutti e
// quindi in cache: il voto di chi guarda e se il clear e' suo arrivano da
// /api/me nel browser. Poche query per pagina, non una per clear (tranne i
// commenti, solo dove ci sono).

export type ExtraClear = { cambi: VersionLineup[]; commenti: ClearComment[] }

export async function extraClear(eventId: string, clears: ClearRow[]): Promise<Map<string, ExtraClear>> {
  const conCambi = clears.filter((c) => c.changes > 0).map((c) => c.version_id)
  const conCommenti = clears.filter((c) => c.comments > 0).map((c) => c.version_id)
  const { cambi, commenti } = await clearExtrasCached(eventId, conCambi, conCommenti)
  const commentiPer = new Map(commenti)

  const out = new Map<string, ExtraClear>()
  for (const c of clears) {
    out.set(c.id, {
      cambi: cambi.filter((l) => l.version_id === c.version_id),
      commenti: commentiPer.get(c.version_id) ?? [],
    })
  }
  return out
}
