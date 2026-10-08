import 'server-only'
import { assetUrl } from '@/lib/db'
import type { ClearForEdit } from '@/lib/clears'
import { SHAPE } from '@/lib/clears/validate'
import { squadraVuota, type BuilderStato, type SquadraStato } from '@/lib/clears/builder-stato'

/**
 * Il builder già pieno con un clear da modificare. Le miniature diventano
 * URL qui, sul server: il client non sa dove stanno le immagini.
 */
export function statoDaClear(c: ClearForEdit): BuilderStato {
  const squadre: SquadraStato[] = c.lineups.map((l) => {
    const q = squadraVuota()
    q.label = l.label ?? ''
    q.note = l.note ?? ''
    for (const k of l.cards) {
      const i = SHAPE.findIndex(([r, p]) => r === k.rotation_index && p === k.pos)
      if (i < 0) continue
      q.slots[i] = {
        role: k.role,
        carta: {
          id: Number(k.card_id), name: k.name ?? `Card ${k.card_id}`, epithet: k.epithet,
          type: k.type, class: k.class, thumb: assetUrl(k.thumb_key),
        },
      }
    }
    return q
  })
  const p = c.payload
  return {
    squadre: squadre.length ? squadre : [squadraVuota()],
    run: c.run_id,
    turns: p.turns == null ? '' : String(p.turns),
    noItems: p.no_items,
    deathless: p.deathless,
    note: p.note ?? '',
    lang: p.lang ?? 'en',
    proofs: p.proofs.map((x) => ({ kind: x.kind, url: x.url })),
    changeNote: '',
  }
}
