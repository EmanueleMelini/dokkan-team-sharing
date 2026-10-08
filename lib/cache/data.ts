import 'server-only'
import { cacheLife, cacheTag } from 'next/cache'
import {
  getEvent, getEzaLinks, getMissions, getStages, listClears, listEvents,
  secondsToNextStatusChange, sitemapEvents, staticEventIds,
  type EventKind, type Region, type Status,
} from '@/lib/queries'
import { getComments, getVersionLineups } from '@/lib/clears'
import { TAG, eventTag } from '@/lib/cache/tags'

// Le letture delle pagine pubbliche, in cache. Avvolgono le funzioni pure
// di lib/queries.ts e lib/clears.ts, che restano senza cacheTag/cacheLife:
// i test le importano fuori da Next, dove quelle chiamate lanciano.
//
// Gli argomenti sono solo id pubblici e filtri, MAI un id utente: la
// chiave e i tag sono salvati in chiaro, e un argomento sbagliato
// servirebbe i dati di un utente a tutti. Per questo questo modulo non
// importa lib/dal ne' next/headers (regola eslint).
//
// Ogni funzione ha il suo cacheLife: la vita della pagina e' la piu' corta
// fra quelle dei dati che legge.

const GIORNO = 86_400
const SETTIMANA = 7 * GIORNO
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

/**
 * La vita di un dato che dipende da now() (lo stato Ongoing/Ended): si
 * rigenera al prossimo confine di una ricorrenza, non prima di 5 minuti
 * (sotto, il dato uscirebbe dal prerender) e non oltre il tetto.
 */
function vitaAlConfine(secondi: number | null, tetto: number) {
  const revalidate = clamp(secondi ?? tetto, 300, tetto)
  return { stale: 300, revalidate, expire: Math.max(revalidate * 2, SETTIMANA) }
}

export async function getEventCached(id: string, reg: Region) {
  'use cache'
  cacheTag(TAG.catalog, eventTag(id))
  const [evento, secondi] = await Promise.all([getEvent(id, reg), secondsToNextStatusChange(id)])
  cacheLife(vitaAlConfine(secondi, GIORNO))
  return evento
}

/** Con i conteggi dei clear per tier: cambia a ogni invio, quindi anche event:<id>. */
export async function getStagesCached(id: string, reg: Region) {
  'use cache'
  cacheLife('community')
  cacheTag(TAG.catalog, eventTag(id))
  return getStages(id, reg)
}

export async function getEzaLinksCached(id: string) {
  'use cache'
  cacheLife('catalog')
  cacheTag(TAG.catalog)
  return getEzaLinks(id)
}

export async function getMissionsCached(eventId: string, runId: string | null) {
  'use cache'
  cacheLife('catalog')
  cacheTag(TAG.catalog)
  return getMissions(eventId, runId)
}

export async function listClearsCached(tierId: string, reg: Region, offset: number, eventId: string) {
  'use cache'
  cacheLife('community')
  cacheTag(eventTag(eventId), TAG.community)
  return listClears(tierId, reg, { offset })
}

/**
 * La parte pubblica di cio' che la pagina aggiunge a ogni clear: i cambi
 * di squadra e i commenti. Il voto di chi guarda e i propri clear
 * arrivano da /api/me, non da qui.
 */
export async function clearExtrasCached(eventId: string, conCambi: string[], conCommenti: string[]) {
  'use cache'
  cacheLife('community')
  cacheTag(eventTag(eventId), TAG.community)
  const [cambi, commenti] = await Promise.all([
    getVersionLineups(conCambi, 2),
    Promise.all(conCommenti.map(async (v) => [v, await getComments(v)] as const)),
  ])
  return { cambi, commenti }
}

export type FiltriEventi = {
  reg: Region
  kind: EventKind | null
  status: Status | null
  search: string | null
  offset: number
  limit?: number
}

/** La lista: i conteggi dei clear cambiano con gli invii, lo stato al confine. */
export async function listEventsCached(f: FiltriEventi) {
  'use cache'
  cacheTag(TAG.catalog, TAG.eventsList)
  const [righe, secondi] = await Promise.all([listEvents(f), secondsToNextStatusChange(null)])
  cacheLife(vitaAlConfine(secondi, 3600))
  return righe
}

export async function staticEventIdsCached() {
  'use cache'
  cacheLife('days')
  cacheTag(TAG.catalog)
  return staticEventIds()
}

export async function sitemapEventsCached() {
  'use cache'
  cacheLife('days')
  cacheTag(TAG.catalog)
  return sitemapEvents()
}
