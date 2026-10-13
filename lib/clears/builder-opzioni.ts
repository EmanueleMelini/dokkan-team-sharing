import { GRADI, nomeRoutes } from '@/lib/clears/build'
import type { RunScelta } from '@/lib/clears/builder-stato'
import type { Opzione } from '@/lib/scelta'

// Le voci dei menu del builder dei clear (components/builder): i valori
// sono quelli dello stato del form, e testoNativo(opzione) e' il testo
// dell'<option> di prima (db/test/scelta.test.mts). Modulo puro.

/** Hidden Potential: non impostato, poi da 0 a 4 percorsi. */
export const OPZIONI_ROUTES: readonly Opzione[] = [
  { valore: '', testo: 'Not set' },
  ...[0, 1, 2, 3, 4].map((n) => ({ valore: String(n), testo: nomeRoutes(n) })),
]

/** Il grado delle Skill Orb nella ricerca: dal piu' alto. */
export const OPZIONI_GRADO: readonly Opzione[] = [
  { valore: '', testo: 'Any' },
  ...[3, 2, 1].map((n) => ({ valore: String(n), testo: GRADI[n] })),
]

/** Il tipo di un link di prova. */
export const OPZIONI_PROVA: readonly Opzione[] = [
  { valore: 'video', testo: 'Video' },
  { valore: 'screenshot', testo: 'Screenshot' },
]

/** La lingua della nota. */
export const OPZIONI_LINGUA: readonly Opzione[] = [
  { valore: 'en', testo: 'English' },
  { valore: 'ja', testo: 'Japanese' },
]

/** Le ricorrenze dell'evento, con la data gia' scritta. */
export const opzioniRun = (runs: readonly RunScelta[]): Opzione[] => runs.map((r) => ({ valore: r.id, testo: r.label }))

// I filtri del picker delle carte: gli stessi valori che /api/cards
// accetta (lib/cards.ts, che e' solo server).
const TIPI = ['AGL', 'TEQ', 'INT', 'STR', 'PHY']
const CLASSI = ['Super', 'Extreme']
const RARITA = ['LR', 'UR', 'SSR', 'SR', 'R', 'N']

export const OPZIONI_PICKER_TIPO: readonly Opzione[] = [
  { valore: '', testo: 'Any type' },
  ...TIPI.map((v) => ({ valore: v, testo: v, tipo: v })),
]
export const OPZIONI_PICKER_CLASSE: readonly Opzione[] = [
  { valore: '', testo: 'Any class' },
  ...CLASSI.map((v) => ({ valore: v, testo: v })),
]
export const OPZIONI_PICKER_RARITA: readonly Opzione[] = [
  { valore: '', testo: 'Any rarity' },
  ...RARITA.map((v) => ({ valore: v, testo: v })),
]
export const opzioniPickerCategoria = (categorie: readonly { id: number; name: string }[]): Opzione[] => [
  { valore: '', testo: 'Any category' },
  ...categorie.map((c) => ({ valore: String(c.id), testo: c.name })),
]
