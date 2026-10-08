import 'server-only'
import type { CurrentUser } from '@/lib/dal'
import type { ClearRow } from '@/lib/queries'
import {
  getComments, getVersionLineups, getViewerVotes, ownClearIds,
  type ClearComment, type VersionLineup,
} from '@/lib/clears'

// Quello che la pagina di un evento aggiunge a ogni clear mostrato: i cambi
// di squadra, i commenti, il voto di chi guarda e se il clear è suo. Poche
// query per pagina, non una per clear (tranne i commenti, solo dove ci sono).

export type Spettatore = {
  modo: 'ready' | 'own' | 'anon' | 'setup'
  vote: -1 | 1 | null
  accesso: string
}

export type ExtraClear = { spettatore: Spettatore; cambi: VersionLineup[]; commenti: ClearComment[] }

export async function extraClear(
  clears: ClearRow[],
  user: CurrentUser | null,
  accesso: string,
): Promise<Map<string, ExtraClear>> {
  const versioni = clears.map((c) => c.version_id)
  const conCambi = clears.filter((c) => c.changes > 0).map((c) => c.version_id)
  const conCommenti = clears.filter((c) => c.comments > 0)
  const pronto = !!user?.onboarded
  const [cambi, voti, miei, commenti] = await Promise.all([
    getVersionLineups(conCambi, 2),
    getViewerVotes(pronto ? user!.id : null, versioni),
    ownClearIds(pronto ? user!.id : null, clears.map((c) => c.id)),
    Promise.all(conCommenti.map(async (c) => [c.version_id, await getComments(c.version_id)] as const)),
  ])
  const commentiPer = new Map(commenti)

  const out = new Map<string, ExtraClear>()
  for (const c of clears) {
    const modo: Spettatore['modo'] = !user ? 'anon' : !user.onboarded ? 'setup' : miei.has(c.id) ? 'own' : 'ready'
    out.set(c.id, {
      spettatore: { modo, vote: voti.get(c.version_id) ?? null, accesso },
      cambi: cambi.filter((l) => l.version_id === c.version_id),
      commenti: commentiPer.get(c.version_id) ?? [],
    })
  }
  return out
}
