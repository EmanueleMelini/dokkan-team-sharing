import { molti, uno, type Ricerca } from '@/lib/parametri'

/*
 * I filtri della lista dei clear di un tier (/events/<id>/clears?...).
 * Modulo puro, senza Next ne' database: lo usano la pagina, la barra dei
 * filtri nel browser, lib/queries.ts e i test.
 *
 * Ogni valore passa da una lista ammessa o da una regex, e alle query
 * arriva solo come parametro legato. Un valore strano vale "non impostato"
 * (la regola di lib/parametri.ts: mai un 500), e la barra lo mostra cosi',
 * quindi non nasconde niente di nascosto.
 */

export const TIPI = ['AGL', 'TEQ', 'INT', 'STR', 'PHY'] as const
export type TipoCarta = (typeof TIPI)[number]
export type Classe = 'Super' | 'Extreme'
export const ORDINI = ['top', 'new', 'turns'] as const
export type Ordine = (typeof ORDINI)[number]

export type FiltriClear = {
  proof: boolean
  noItems: boolean
  noKo: boolean
  /** turni massimi, 1-99: i clear senza turni restano fuori */
  turns: number | null
  /** "usa tutte queste carte", fino a 3, in ordine di id */
  cards: string[]
  /** il leader dell'assetto di partenza (il friend non conta) */
  leader: string | null
  /** ogni carta di ogni assetto di questo tipo; la classe non conta */
  mono: TipoCarta | null
  cls: Classe | null
  /** ogni carta di ogni assetto ha questa categoria */
  cat: number | null
  sort: Ordine
}

export const VUOTI: Readonly<FiltriClear> = Object.freeze({
  proof: false, noItems: false, noKo: false, turns: null, cards: [],
  leader: null, mono: null, cls: null, cat: null, sort: 'top',
})

export const CARTE_MAX = 3
// Gli id finiscono in un cast ::bigint: 18 cifre non lo superano mai. Niente
// zeri iniziali, cosi' ogni filtro ha un URL solo.
const ID = /^[1-9]\d{0,17}$/
const TURNI = /^[1-9]\d?$/
const CATEGORIA = /^[1-9]\d{0,4}$/
const CATEGORIA_MAX = 32_767 // smallint

const CLASSI: Record<string, Classe> = { super: 'Super', extreme: 'Extreme' }
const CLASSI_URL: Record<Classe, string> = { Super: 'super', Extreme: 'extreme' }

/** Confronto numerico di due id senza zeri iniziali (senza BigInt). */
const perId = (a: string, b: string) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)

const vero = (v: string | string[] | undefined) => uno(v) === '1'

function idCarta(v: string | undefined): string | null {
  return typeof v === 'string' && ID.test(v) ? v : null
}

export function leggiFiltri(sp: Ricerca): FiltriClear {
  const turni = uno(sp.turns)
  const cat = uno(sp.cat)
  const mono = uno(sp.mono)
  const ordine = uno(sp.sort)
  // le prime tre carte diverse, nell'ordine dell'URL; poi in ordine di id
  const cards = [...new Set(molti(sp.card).filter((v) => ID.test(v)))].slice(0, CARTE_MAX).sort(perId)
  return {
    proof: vero(sp.proof),
    noItems: vero(sp.noitems),
    noKo: vero(sp.noko),
    turns: typeof turni === 'string' && TURNI.test(turni) ? Number(turni) : null,
    cards,
    leader: idCarta(uno(sp.leader)),
    mono: (TIPI as readonly string[]).includes(mono ?? '') ? (mono as TipoCarta) : null,
    cls: CLASSI[uno(sp.class) ?? ''] ?? null,
    cat: typeof cat === 'string' && CATEGORIA.test(cat) && Number(cat) <= CATEGORIA_MAX ? Number(cat) : null,
    sort: (ORDINI as readonly string[]).includes(ordine ?? '') ? (ordine as Ordine) : 'top',
  }
}

/**
 * I parametri dei filtri nell'ordine canonico, senza i valori di difetto:
 * gli stessi filtri danno sempre lo stesso URL.
 */
export function parametriFiltri(f: FiltriClear): [string, string][] {
  const p: [string, string][] = []
  if (f.proof) p.push(['proof', '1'])
  if (f.noItems) p.push(['noitems', '1'])
  if (f.noKo) p.push(['noko', '1'])
  if (f.turns != null) p.push(['turns', String(f.turns)])
  for (const c of [...f.cards].sort(perId)) p.push(['card', c])
  if (f.leader) p.push(['leader', f.leader])
  if (f.mono) p.push(['mono', f.mono])
  if (f.cls) p.push(['class', CLASSI_URL[f.cls]])
  if (f.cat != null) p.push(['cat', String(f.cat)])
  if (f.sort !== 'top') p.push(['sort', f.sort])
  return p
}

/** Quanti filtri restringono la lista. L'ordine non e' un filtro. */
export function filtriAttivi(f: FiltriClear): number {
  return Number(f.proof) + Number(f.noItems) + Number(f.noKo) + Number(f.turns != null)
    + f.cards.length + Number(f.leader != null) + Number(f.mono != null)
    + Number(f.cls != null) + Number(f.cat != null)
}

/** Gli stessi filtri senza restringere niente, con l'ordine che c'era. */
export const soloOrdine = (f: FiltriClear): FiltriClear => ({ ...VUOTI, cards: [], sort: f.sort })

export const ETICHETTA_ORDINE: Record<Ordine, string> = {
  top: 'Top', new: 'Newest', turns: 'Fewest turns',
}

/** La coda della frase del riepilogo: come e' ordinata la lista. */
export const SPIEGA_ORDINE: Record<Ordine, string> = {
  top: 'Top: proof first, then votes',
  new: 'Newest first',
  turns: 'Fewest turns first',
}

/** Le scelte del menu dei turni; un altro valore dell'URL compare come opzione sua. */
export const SCELTE_TURNI = [3, 5, 7, 10, 15, 20] as const
