// Lo stato del builder dei clear e il reducer che lo cambia. Puro, senza
// React né database: lo usa il componente client e lo prepara il server
// (con i nomi e le miniature delle carte già scelte, per la modifica).

import {
  LIMITS, SHAPE, buildVuota as buildPayloadVuota,
  type BuilderBuild, type BuilderPayload, type ProofKind, type SlotRole,
} from '@/lib/clears/validate'

export type CartaScelta = {
  id: number
  name: string
  epithet: string | null
  type: string
  class: string | null
  /** URL già risolto della miniatura, o null: il client non conosce lo storage */
  thumb: string | null
  /** solo per il segnaposto di una carta senza miniatura: non va mai nel payload */
  rarity?: string | null
  /** la miniatura e' il solo personaggio (0034), per la cornice disegnata: mai nel payload */
  bare?: boolean
}

/** Una ricorrenza dell'evento nel selettore, con la data già scritta. */
export type RunScelta = { id: string; label: string }

/** Una Skill Orb scelta nell'editor della build. */
export type SferaScelta = { id: number; name: string; tier: number }

/**
 * La build di uno slot come la tiene il form: testi come nei campi, e
 * sempre tre posti per le sfere (null = vuoto). Tutta opzionale.
 */
export type BuildStato = { routes: string; path: string; note: string; sfere: (SferaScelta | null)[] }

export type SlotStato = { carta: CartaScelta | null; role: SlotRole; build: BuildStato }
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
  | { t: 'build'; l: number; i: number; campo: 'routes' | 'path' | 'note'; valore: string }
  | { t: 'sfera'; l: number; i: number; k: number; sfera: SferaScelta | null }
  | { t: 'togli_build'; l: number; i: number }
  | { t: 'squadra'; l: number; campo: 'label' | 'note'; valore: string }
  | { t: 'aggiungi_cambio' }
  | { t: 'togli_cambio'; l: number }
  | { t: 'ricopia_partenza'; l: number }
  | { t: 'campo'; campo: Campo; valore: string | boolean }
  | { t: 'aggiungi_prova' }
  | { t: 'prova'; i: number; kind?: ProofKind; url?: string }
  | { t: 'togli_prova'; i: number }

export const buildVuota = (): BuildStato => ({ routes: '', path: '', note: '', sfere: [null, null, null] })

/** Vero se la build ha almeno un campo pieno: lo slot lo mostra. */
export const buildPiena = (b: BuildStato): boolean =>
  b.routes !== '' || b.path.trim() !== '' || b.note.trim() !== '' || b.sfere.some((x) => x !== null)

export const squadraVuota = (): SquadraStato => ({
  label: '', note: '',
  slots: SHAPE.map(() => ({ carta: null, role: 'member' as SlotRole, build: buildVuota() })),
})

export function statoVuoto(run: string): BuilderStato {
  return {
    squadre: [squadraVuota()], run, turns: '', noItems: false, deathless: false,
    note: '', lang: 'en', proofs: [], changeNote: '',
  }
}

/** Copia profonda degli slot: carta, ruolo e build, con le sfere a parte. */
function copiaSlots(slots: SlotStato[]): SlotStato[] {
  return slots.map((x) => ({ ...x, build: { ...x.build, sfere: [...x.build.sfere] } }))
}

const stessoSlot = (a: SlotStato, b: SlotStato): boolean =>
  (a.carta?.id ?? null) === (b.carta?.id ?? null) && a.role === b.role &&
  a.build.routes === b.build.routes && a.build.path === b.build.path && a.build.note === b.build.note &&
  a.build.sfere.every((x, k) => (x?.id ?? null) === (b.build.sfere[k]?.id ?? null))

/**
 * Vero se il cambio l ha gli stessi slot della partenza (carte, ruoli,
 * build). Il builder lo usa per chiedere conferma prima di ricopiare: se
 * sono uguali non c'è niente da perdere, e il bottone non serve.
 */
export function comeLaPartenza(s: BuilderStato, l: number): boolean {
  const q = s.squadre[l]
  return !!q && s.squadre[0].slots.every((x, k) => stessoSlot(x, q.slots[k]))
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
      return cambiaSquadra(s, a.l, (q) => cambiaSlot(q, a.i, () => ({ carta: null, role: 'member', build: buildVuota() })))
    case 'ruolo':
      return cambiaSquadra(s, a.l, (q) => conRuolo(q, a.i, a.role))
    case 'build':
      return cambiaSquadra(s, a.l, (q) => cambiaSlot(q, a.i, (x) => ({ ...x, build: { ...x.build, [a.campo]: a.valore } })))
    case 'sfera':
      if (a.k < 0 || a.k >= LIMITS.equipment) return s
      return cambiaSquadra(s, a.l, (q) => cambiaSlot(q, a.i, (x) => ({
        ...x, build: { ...x.build, sfere: x.build.sfere.map((y, k) => (k === a.k ? a.sfera : y)) },
      })))
    case 'togli_build':
      return cambiaSquadra(s, a.l, (q) => cambiaSlot(q, a.i, (x) => ({ ...x, build: buildVuota() })))
    case 'squadra':
      return cambiaSquadra(s, a.l, (q) => ({ ...q, [a.campo]: a.valore }))
    case 'aggiungi_cambio': {
      if (s.squadre.length >= LIMITS.lineups) return s
      // Il cambio parte dalla squadra precedente: di solito si toccano
      // una o due carte, non sette.
      const prima = s.squadre[s.squadre.length - 1]
      // Anche ruoli e build: nel cambio restano le stesse carte, buildate
      // uguali. Da qui in poi il cambio è indipendente.
      return { ...s, squadre: [...s.squadre, { label: '', note: '', slots: copiaSlots(prima.slots) }] }
    }
    case 'togli_cambio':
      return a.l === 0 ? s : { ...s, squadre: s.squadre.filter((_, k) => k !== a.l) }
    case 'ricopia_partenza':
      // Il cambio è una copia, non un riferimento: se la partenza cambia
      // dopo, si riallinea a mano. Nome e nota del cambio restano.
      if (a.l <= 0 || a.l >= s.squadre.length) return s
      return cambiaSquadra(s, a.l, (q) => ({ ...q, slots: copiaSlots(s.squadre[0].slots) }))
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
      slots: q.slots.map((x, k) => {
        const build = buildDaStato(x.build)
        return {
          rot: SHAPE[k][0], pos: SHAPE[k][1], card_id: x.carta?.id ?? 0, role: x.role,
          ...(build ? { build } : {}),
        }
      }),
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

/**
 * La build di uno slot per il payload, o null se e' vuota. Le sfere
 * restano per posizione, senza i null in coda: [null, 812] = slot 2. Un
 * numero di percorsi non valido passa com'e': lo rifiuta parseBuild, con
 * la frase giusta.
 */
export function buildDaStato(b: BuildStato): BuilderBuild | null {
  const equipment = b.sfere.map((x) => x?.id ?? null)
  while (equipment.length && equipment[equipment.length - 1] === null) equipment.pop()
  const out: BuilderBuild = {
    hp_routes: b.routes === '' ? null : Number(b.routes),
    hp_path: b.path.trim() || null,
    note: b.note.trim() || null,
    equipment,
  }
  return buildPayloadVuota(out) ? null : out
}
