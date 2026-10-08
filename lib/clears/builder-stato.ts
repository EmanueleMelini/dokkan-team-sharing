// Lo stato del builder dei clear e il reducer che lo cambia. Puro, senza
// React né database: lo usa il componente client e lo prepara il server
// (con i nomi e le miniature delle carte già scelte, per la modifica).

import { LIMITS, SHAPE, type BuilderPayload, type ProofKind, type SlotRole } from '@/lib/clears/validate'

export type CartaScelta = {
  id: number
  name: string
  epithet: string | null
  type: string
  class: string | null
  /** URL già risolto della miniatura, o null: il client non conosce lo storage */
  thumb: string | null
}

/** Una ricorrenza dell'evento nel selettore, con la data già scritta. */
export type RunScelta = { id: string; label: string }

export type SlotStato = { carta: CartaScelta | null; role: SlotRole }
export type SquadraStato = { label: string; note: string; slots: SlotStato[] }
export type ProvaStato = { kind: ProofKind; url: string }

export type BuilderStato = {
  squadre: SquadraStato[]
  run: string
  turns: string
  noItems: boolean
  deathless: boolean
  note: string
  lang: '' | 'en' | 'ja'
  proofs: ProvaStato[]
  changeNote: string
}

export type Campo = 'run' | 'turns' | 'noItems' | 'deathless' | 'note' | 'lang' | 'changeNote'

export type Azione =
  | { t: 'carta'; l: number; i: number; carta: CartaScelta }
  | { t: 'svuota'; l: number; i: number }
  | { t: 'ruolo'; l: number; i: number; role: SlotRole }
  | { t: 'squadra'; l: number; campo: 'label' | 'note'; valore: string }
  | { t: 'aggiungi_cambio' }
  | { t: 'togli_cambio'; l: number }
  | { t: 'campo'; campo: Campo; valore: string | boolean }
  | { t: 'aggiungi_prova' }
  | { t: 'prova'; i: number; kind?: ProofKind; url?: string }
  | { t: 'togli_prova'; i: number }

export const squadraVuota = (): SquadraStato => ({
  label: '', note: '', slots: SHAPE.map(() => ({ carta: null, role: 'member' as SlotRole })),
})

export function statoVuoto(run: string): BuilderStato {
  return {
    squadre: [squadraVuota()], run, turns: '', noItems: false, deathless: false,
    note: '', lang: 'en', proofs: [], changeNote: '',
  }
}

function cambiaSquadra(s: BuilderStato, l: number, f: (q: SquadraStato) => SquadraStato): BuilderStato {
  return { ...s, squadre: s.squadre.map((q, k) => (k === l ? f(q) : q)) }
}

function cambiaSlot(q: SquadraStato, i: number, f: (x: SlotStato) => SlotStato): SquadraStato {
  return { ...q, slots: q.slots.map((x, k) => (k === i ? f(x) : x)) }
}

/** Un ruolo per slot, e un solo leader e un solo friend per squadra. */
function conRuolo(q: SquadraStato, i: number, role: SlotRole): SquadraStato {
  return {
    ...q,
    slots: q.slots.map((x, k) => {
      if (k === i) return { ...x, role }
      return role !== 'member' && x.role === role ? { ...x, role: 'member' } : x
    }),
  }
}

export function reducer(s: BuilderStato, a: Azione): BuilderStato {
  switch (a.t) {
    case 'carta':
      return cambiaSquadra(s, a.l, (q) => {
        const prima = cambiaSlot(q, a.i, (x) => ({ ...x, carta: a.carta }))
        // La prima carta di una squadra vuota fa da leader: è quasi
        // sempre quella da cui si parte, e si cambia con un click.
        const haLeader = prima.slots.some((x) => x.role === 'leader')
        return haLeader ? prima : conRuolo(prima, a.i, 'leader')
      })
    case 'svuota':
      return cambiaSquadra(s, a.l, (q) => cambiaSlot(q, a.i, () => ({ carta: null, role: 'member' })))
    case 'ruolo':
      return cambiaSquadra(s, a.l, (q) => conRuolo(q, a.i, a.role))
    case 'squadra':
      return cambiaSquadra(s, a.l, (q) => ({ ...q, [a.campo]: a.valore }))
    case 'aggiungi_cambio': {
      if (s.squadre.length >= LIMITS.lineups) return s
      // Il cambio parte dalla squadra precedente: di solito si toccano
      // una o due carte, non sette.
      const prima = s.squadre[s.squadre.length - 1]
      return { ...s, squadre: [...s.squadre, { label: '', note: '', slots: prima.slots.map((x) => ({ ...x })) }] }
    }
    case 'togli_cambio':
      return a.l === 0 ? s : { ...s, squadre: s.squadre.filter((_, k) => k !== a.l) }
    case 'campo':
      return { ...s, [a.campo]: a.valore }
    case 'aggiungi_prova':
      return s.proofs.length >= LIMITS.proofs ? s : { ...s, proofs: [...s.proofs, { kind: 'video', url: '' }] }
    case 'prova':
      return {
        ...s,
        proofs: s.proofs.map((p, k) => (k === a.i ? { kind: a.kind ?? p.kind, url: a.url ?? p.url } : p)),
      }
    case 'togli_prova':
      return { ...s, proofs: s.proofs.filter((_, k) => k !== a.i) }
  }
}

/**
 * Il payload per submit/revise. Gli slot vuoti restano senza carta
 * (card_id 0): parseBuilderPayload li rifiuta con la frase giusta, invece
 * di sparire e far dire "servono 7 carte".
 */
export function payloadDa(s: BuilderStato): BuilderPayload {
  return {
    lineups: s.squadre.map((q, n) => ({
      label: n === 0 ? null : q.label.trim() || null,
      note: q.note.trim() || null,
      slots: q.slots.map((x, k) => ({
        rot: SHAPE[k][0], pos: SHAPE[k][1], card_id: x.carta?.id ?? 0, role: x.role,
      })),
    })),
    no_items: s.noItems,
    deathless: s.deathless,
    turns: s.turns.trim() === '' ? null : Number(s.turns),
    note: s.note.trim() || null,
    lang: s.note.trim() && s.lang ? s.lang : null,
    // Le righe lasciate vuote non sono prove: si ignorano
    proofs: s.proofs.filter((p) => p.url.trim() !== '').map((p) => ({ kind: p.kind, url: p.url.trim() })),
  }
}
