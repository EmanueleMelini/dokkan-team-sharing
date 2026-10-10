import 'server-only'
import { assetUrl } from '@/lib/db'
import type { ClearForEdit } from '@/lib/clears'
import { SHAPE } from '@/lib/clears/validate'
import type { SlotBuild } from '@/lib/clears/build'
import { buildVuota, squadraVuota, type BuildStato, type BuilderStato, type SquadraStato } from '@/lib/clears/builder-stato'

/** La build congelata di uno slot nei campi del form, sfere per posizione. */
function buildDaClear(b: SlotBuild | null): BuildStato {
  const out = buildVuota()
  if (!b) return out
  out.routes = b.hp_routes == null ? '' : String(b.hp_routes)
  out.path = b.hp_path ?? ''
  out.note = b.note ?? ''
  for (const e of b.equipment) {
    if (e.slot >= 1 && e.slot <= 3) {
      out.sfere[e.slot - 1] = { id: Number(e.id), name: e.name ?? `Skill Orb ${e.id}`, tier: e.tier }
    }
  }
  return out
}

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
        build: buildDaClear(k.build),
        carta: {
          id: Number(k.card_id), name: k.name ?? `Card ${k.card_id}`, epithet: k.epithet,
          type: k.type, class: k.class, thumb: assetUrl(k.thumb_key), rarity: k.rarity,
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
