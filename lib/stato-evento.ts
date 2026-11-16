import { giornoBreve, quando, soloGiorno } from '@/lib/date'
import type { EventDetail, EventRow } from '@/lib/queries'

// Lo stato di una ricorrenza in parole: la riga di stato della pagina
// dell'evento (components/evento/pagina.tsx) e le voci del selettore delle
// run del builder (lib/clears/pagina-builder.ts). Modulo puro, senza React
// ne' database: i componenti sono .tsx e i test (db/test/versione-ui.test.mts,
// queries.test.mts) non li possono importare, quindi le parole stanno qui.

/**
 * La nota di una run dello specchio Japan (mirror, 0036): le date sono
 * quelle di Global, copiate (con l'ora UTC, come sulla pagina Global), e
 * chi guarda Japan lo deve sapere. Breve, sotto il dettaglio, con lo stesso
 * colore. Solo quando e' vero alla lettera: la copia mostrata e' uguale a
 * una run Global (same_as_global di getEvent). Una copia chiusa al --dal da
 * set-event-window --reg japan, o tenuta per i clear dopo che la sua
 * finestra Global e' sparita, e' 'mirror' ma non ha piu' le date di Global.
 */
export const STESSE_DATE = 'Same dates as Global'

export type StatoEvento = {
  etichetta: string
  dettaglio: string
  inCorso: boolean
  /** STESSE_DATE per una copia uguale a una run Global, altrimenti null */
  nota: string | null
}

type RunMostrata = Pick<EventDetail, 'status' | 'starts_at' | 'ends_at' | 'ends_at_known' | 'source' | 'same_as_global'>

/*
 * Lo stato dell'evento in parole. Una run in corso senza fine può essere
 * permanente (il gioco lo dice: gli EZA sempre in lista) o solo di fine
 * sconosciuta (il gioco non la registra, o la data viene dal wiki): sono
 * due cose diverse e vanno dette diverse. null: nessuna run in questa
 * versione (la pagina dice senzaDate al suo posto).
 */
export function statoEvento(e: RunMostrata): StatoEvento | null {
  if (!e.status || !e.starts_at) return null
  const nota = e.source === 'mirror' && e.same_as_global ? STESSE_DATE : null
  const dal = quando(e.starts_at, e.source)
  const al = e.ends_at && e.ends_at_known ? quando(e.ends_at, e.source) : null
  if (e.status === 'active') {
    if (al) return { etichetta: 'Ongoing', dettaglio: `until ${al}`, inCorso: true, nota }
    if (e.ends_at_known) return { etichetta: 'Permanent', dettaglio: `since ${dal}`, inCorso: true, nota }
    return { etichetta: 'End date unknown', dettaglio: `started ${dal}`, inCorso: false, nota }
  }
  if (e.status === 'upcoming') {
    return { etichetta: 'Upcoming', dettaglio: al ? `from ${dal} until ${al}` : `starts ${dal}`, inCorso: false, nota }
  }
  return {
    etichetta: 'Ended', dettaglio: al ? `ran from ${dal} until ${al}` : `started ${dal}, end date unknown`, inCorso: false, nota,
  }
}

/**
 * Lo stato in breve sulla scheda della lista degli eventi
 * (components/eventi/lista.tsx). Niente per la fine sconosciuta: sarebbe la
 * maggioranza, e ripeterlo su ogni scheda non dice niente. "Ends" solo con
 * la fine nota, come la pagina dell'evento: una run chiusa senza saperlo
 * (una copia chiusa al --dal da set-event-window, fine non nota) non
 * finisce quel giorno, e' solo il limite piu' tardi.
 */
export function statoBreve(e: Pick<EventRow, 'status' | 'starts_at' | 'ends_at' | 'ends_at_known'>):
  { testo: string; inCorso: boolean } | null {
  if (e.status === 'active') {
    if (e.ends_at && e.ends_at_known) return { testo: `Ends ${giornoBreve(e.ends_at)}`, inCorso: true }
    return e.ends_at_known ? { testo: 'Permanent', inCorso: false } : null
  }
  if (e.status === 'upcoming') return { testo: `Starts ${giornoBreve(e.starts_at)}`, inCorso: false }
  return { testo: 'Ended', inCorso: false }
}

/** Una ricorrenza gia' iniziata, come la legge listStartedRuns (lib/clears.ts). */
export type RunIniziata = { starts_at: Date; ends_at: Date | null; ends_at_known: boolean; status: 'active' | 'past' }

/**
 * La voce di una ricorrenza nel selettore del builder ("When you cleared
 * it"). Solo il giorno, per ogni fonte (il selettore e' stretto): il giorno
 * UTC, come in tutto il sito. Per una copia dello specchio e' lo stesso
 * giorno che la pagina dell'evento scrive accanto all'ora e a "UTC", e la
 * stessa voce della run Global. Una run senza la fine nota non e' "in corso
 * da": puo' essere finita da tempo (il wiki dice solo il giorno di uscita),
 * o essere stata chiusa all'inizio della replica dopo, che e' solo il
 * limite piu' tardi. Lo dice come la pagina dell'evento.
 */
export function etichettaRun(r: RunIniziata): string {
  const dal = soloGiorno(r.starts_at)
  if (!r.ends_at_known) return `Started ${dal}, end date unknown`
  if (r.status === 'active') return `Running now, since ${dal}`
  return r.ends_at ? `${dal} to ${soloGiorno(r.ends_at)}` : `From ${dal}`
}
