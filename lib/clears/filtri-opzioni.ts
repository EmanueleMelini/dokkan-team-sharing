import type { OpzioneCarta } from '@/components/clears/scegli-carta'
import type { OpzioniFiltri } from '@/components/clears/filtri-clear'
import { ETICHETTA_ORDINE, ORDINI, SCELTE_TURNI, TIPI, type Classe, type TipoCarta } from '@/lib/clears/filtri'
import type { Opzione } from '@/lib/scelta'

// Le voci dei menu della barra dei filtri dei clear (components/clears/
// filtri-clear.tsx). Modulo puro: i valori sono quelli che il form GET
// manda (gli stessi name=value di prima) e testoNativo(opzione) e' il
// testo dell'<option> di prima, parola per parola (db/test/scelta.test.mts).

export const nomeCarta = (c: Pick<OpzioneCarta, 'name' | 'id'>) => c.name ?? `Card ${c.id}`

/** Le due classi: come si chiamano nel menu e come stanno nell'URL. */
export const CLASSI: { id: Classe; t: string; url: string }[] = [
  { id: 'Super', t: 'All Super', url: 'super' },
  { id: 'Extreme', t: 'All Extreme', url: 'extreme' },
]

/** Quanti clear la usano, a destra della voce; una scelta che qui nessuno usa dice "0 here". */
function conteggio(n: number): Pick<Opzione, 'nota' | 'notaSr'> {
  return n > 0 ? { nota: String(n), notaSr: `${n} ${n === 1 ? 'clear' : 'clears'}` } : { nota: '0 here' }
}

/** Max turns: le scelte fisse, piu' quella dell'URL se non e' fra loro. */
export function opzioniTurni(turni: number | null): Opzione[] {
  const n = [...new Set([...SCELTE_TURNI, ...(turni != null ? [turni] : [])])].sort((a, b) => a - b)
  return [{ valore: '', testo: 'Any' }, ...n.map((x) => ({ valore: String(x), testo: `${x} or fewer` }))]
}

/** Il leader: quelli del tier, e in cima quello dell'URL che qui nessuno usa. */
export function opzioniLeader(leader: string | null, leaders: OpzioneCarta[], etichette: Record<string, string>): Opzione[] {
  return [
    { valore: '', testo: 'Any leader' },
    ...(leader && !leaders.some((c) => c.id === leader)
      ? [{ valore: leader, testo: etichette[leader] ?? `Card ${leader}`, nota: '0 here' }] : []),
    ...leaders.map((c) => ({
      valore: c.id,
      testo: nomeCarta(c),
      ...(c.epithet ? { dettaglio: c.epithet } : {}),
      ...conteggio(c.n),
    })),
  ]
}

/** Mono un tipo: quelli usati qui, e quello dell'URL anche se nessuno lo usa. */
export function opzioniMono(mono: TipoCarta | null, tipi: OpzioniFiltri['types']): Opzione[] {
  return [
    { valore: '', testo: 'Any type' },
    ...TIPI.filter((t) => t === mono || tipi.some((x) => x.id === t)).map((t) => ({
      valore: t, testo: `Mono ${t}`, tipo: t, ...conteggio(tipi.find((x) => x.id === t)?.n ?? 0),
    })),
  ]
}

/** La classe, con il valore dell'URL (super, extreme). */
export function opzioniClasse(cls: Classe | null, classi: OpzioniFiltri['classes']): Opzione[] {
  return [
    { valore: '', testo: 'Any class' },
    ...CLASSI.filter((c) => c.id === cls || classi.some((x) => x.id === c.id)).map((c) => ({
      valore: c.url, testo: c.t, ...conteggio(classi.find((x) => x.id === c.id)?.n ?? 0),
    })),
  ]
}

/** La categoria: quelle del tier, e in cima quella dell'URL che qui non c'e'. */
export function opzioniCategoria(cat: number | null, categorie: OpzioniFiltri['categories']): Opzione[] {
  return [
    { valore: '', testo: 'Any category' },
    ...(cat != null && !categorie.some((c) => c.id === cat) ? [{ valore: String(cat), testo: `Category ${cat}`, nota: '0 here' }] : []),
    ...categorie.map((c) => ({ valore: String(c.id), testo: c.name, ...conteggio(c.n) })),
  ]
}

/** L'ordine: Top, Newest, Fewest turns. */
export const OPZIONI_ORDINE: readonly Opzione[] = ORDINI.map((o) => ({ valore: o, testo: ETICHETTA_ORDINE[o] }))
