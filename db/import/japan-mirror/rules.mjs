// Le regole dello specchio Japan (db/import/mirror-japan.mjs, migrazione
// 0036): da quando le date Japan si copiano da Global, e cosa no.
//
// PERCHE' SI PUO' COPIARE. Il wiki era l'unica fonte delle date Japan e ha
// smesso di creare pagine evento a gennaio 2025. La ricerca di novembre
// 2026 (tre strade, piu' una verifica indipendente) dice che da allora le
// due versioni escono insieme:
//   - il contenuto nuovo esce lo stesso giorno da fine agosto 2024 (17
//     pagine evento su 17 con JPdate = GLBdate; 351 date carta su 352);
//   - Global ha finito di recuperare il contenuto giapponese arretrato il
//     2024-12-12 (le carte di Jiren, le EZA di luglio-agosto 2024 arrivate
//     a ottobre-dicembre); il datamine Global lo conferma con open_at;
//   - da gennaio 2025 carte, EZA ed eventi coincidono (gli eventi di
//     ottobre-novembre 2026 controllati su fonti giapponesi, spesso al
//     minuto), e 146 banner giapponesi su 166 hanno il gemello Global con
//     inizio e fine identici.
// Le eccezioni del wiki dopo il 2024 erano quasi tutte errori del campo
// Global (scritto "luglio" per abitudine): smentite dal datamine.
//
// D. 2025-01-01 00:00 JST, un istante esplicito (le 15:00 UTC del giorno
// prima). Lascia fuori il recupero di Global del 2024 e la rimessa in lista
// di 128 EZA del 2024-12-27 alle 02:00 UTC: tutte e due sono fatti di
// Global, che copiati darebbero a Japan date sbagliate. Le run del wiki dei
// pochi eventi Japan di gennaio 2025 restano del wiki (sono prime uscite;
// le copie le chiudono solo alla replica dopo).
//
// LE ECCEZIONI si scrivono a mano, una per una, ognuna col suo motivo:
//   globalOnly       eventi solo di Global (una collaborazione, una
//                    campagna "Worldwide"): nessuna loro finestra si copia;
//   skipWindows      una finestra sola, riconosciuta dall'inizio Global
//                    (entro i due giorni di tolleranza): per esempio una
//                    replica che Japan ha avuto in un altro momento;
//   globalOnlyCards  carte uscite solo su Global.
// Oggi sono vuote: nei dati non c'e' un evento o una carta di cui si possa
// dire con certezza che e' solo di Global. I nomi che lo farebbero pensare
// ("10th Anniv.!", "11th Anniversary!") sono gli anniversari giapponesi,
// usciti anche su Global nello stesso istante. Il --dry-run --verbose dello
// specchio elenca gli eventi che prendono la prima run Japan: e' la lista da
// rivedere prima di aggiungerne una.
//
// Pure: nessun database, nessun file. Le usano mirror-japan.mjs e i test.

/** @typedef {{ event: number, why: string }} GlobalOnly */
/** @typedef {{ event: number, start: string, why: string }} SkipWindow */
/** @typedef {{ card: number, why: string }} GlobalOnlyCard */
/** @typedef {{ since: string, globalOnly: GlobalOnly[], skipWindows: SkipWindow[], globalOnlyCards: GlobalOnlyCard[] }} Rules */

/** @type {Rules} */
export const RULES = {
  // 2025-01-01 00:00 JST
  since: '2024-12-31T15:00:00Z',
  globalOnly: [],
  skipWindows: [],
  globalOnlyCards: [],
}

// La tolleranza della stessa uscita, come in load-windows e set-event-window:
// la data del wiki e' un giorno, la finestra del gioco un istante.
export const TOL = 2 * 86_400_000

const JST = 9 * 3_600_000

/**
 * Il giorno giapponese di un istante, 'YYYY-MM-DD'. Le date di uscita delle
 * carte sono giorni: D sul calendario giapponese e' il 2025-01-01.
 * @param {string | Date} t
 */
export function japanDay(t) {
  return new Date(new Date(t).getTime() + JST).toISOString().slice(0, 10)
}

/**
 * Le regole sono scritte a mano: un errore di battitura deve fermare il
 * giro, non togliere in silenzio le run di un evento sbagliato. Torna
 * l'elenco dei problemi (vuoto = vanno bene).
 * @param {Rules} r
 */
export function checkRules(r) {
  const out = []
  const instant = (s) => typeof s === 'string' && /Z$|[+-]\d\d:\d\d$/.test(s) && !Number.isNaN(Date.parse(s))
  const id = (n) => Number.isSafeInteger(n) && n > 0
  const why = (s) => typeof s === 'string' && s.trim().length >= 10
  if (!r || typeof r !== 'object') return ['regole assenti']
  if (!instant(r.since)) out.push(`since: "${r.since}" non e' un istante col fuso (Z o +09:00)`)
  const elenchi = ['globalOnly', 'skipWindows', 'globalOnlyCards'].filter((k) => !Array.isArray(r[k]))
  for (const k of elenchi) out.push(`${k}: deve essere un elenco`)
  if (elenchi.length) return out
  const seen = new Set()
  for (const [i, g] of r.globalOnly.entries()) {
    if (!id(g?.event)) out.push(`globalOnly[${i}]: event non e' un id`)
    if (!why(g?.why)) out.push(`globalOnly[${i}]: manca il motivo (why, almeno una frase)`)
    if (seen.has(g?.event)) out.push(`globalOnly[${i}]: l'evento ${g.event} c'e' due volte`)
    seen.add(g?.event)
  }
  for (const [i, s] of r.skipWindows.entries()) {
    if (!id(s?.event)) out.push(`skipWindows[${i}]: event non e' un id`)
    if (!instant(s?.start)) out.push(`skipWindows[${i}]: start "${s?.start}" non e' un istante col fuso`)
    if (!why(s?.why)) out.push(`skipWindows[${i}]: manca il motivo (why, almeno una frase)`)
    if (seen.has(s?.event)) out.push(`skipWindows[${i}]: l'evento ${s.event} e' gia' tutto in globalOnly`)
  }
  const cards = new Set()
  for (const [i, c] of r.globalOnlyCards.entries()) {
    if (!id(c?.card)) out.push(`globalOnlyCards[${i}]: card non e' un id`)
    if (!why(c?.why)) out.push(`globalOnlyCards[${i}]: manca il motivo (why, almeno una frase)`)
    if (cards.has(c?.card)) out.push(`globalOnlyCards[${i}]: la carta ${c.card} c'e' due volte`)
    cards.add(c?.card)
  }
  return out
}
