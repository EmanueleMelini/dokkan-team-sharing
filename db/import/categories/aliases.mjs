// Gli alias delle categorie (migrazione 0037, tabella category_alias): i
// modi brevi con cui un giocatore cerca una categoria ("tb", "rog", "ssj3").
// Funzioni pure: niente database, niente effetti all'import.
//
// Sono quelli del dizionario dell'app Android DokkanTS Category Helper (99
// voci, versione 2), che da qui in avanti li riceve da /api/v1/categories.
// Di due tipi:
//
//   initials  le iniziali del nome inglese, generate: la stessa regola
//             dell'app, cosi' una categoria nuova ha la sua sigla dal primo
//             giro senza che nessuno la scriva;
//   nickname  i soprannomi della community, scritti a mano qui sotto per id
//             del gioco (l'id non cambia, il nome inglese potrebbe).
//
// La regola delle iniziali, verificata sulle 99 voci dell'app:
//   - gli apostrofi non spezzano la parola (Goku's Family -> gf, Siblings'
//     Bond -> sb), ogni altro segno si' (Low-Class Warrior -> lcw,
//     Androids/Cell Saga -> acs, Target: Goku -> tg);
//   - ogni parola conta, anche "of" e "and" (Bond of Master and Disciple ->
//     bomad);
//   - un numero entra intero (Universe 11 -> u11, Super Saiyan 3 -> ss3);
//   - niente iniziali per un nome di una parola sola (Fusion, DAIMA) o con
//     una sigla gia' dentro (DB Saga, GT Heroes): la sigla e' gia' il modo
//     breve.
// Tutto minuscolo e senza spazi ai bordi, come li confronta l'app.

/** @param {string} nameEn */
export function initialsAlias(nameEn) {
  const parole = String(nameEn ?? '').replace(/['’]/g, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  if (parole.length < 2) return null
  if (parole.some((p) => /^\p{Lu}{2,}$/u.test(p))) return null
  return parole.map((p) => p.match(/^\p{N}+/u)?.[0] ?? p[0]).join('').toLowerCase()
}

// I soprannomi, per id del gioco (card_categories.csv). Quelli dell'app
// tolte le iniziali generate. Uno nuovo si aggiunge qui, minuscolo.
/** @type {Readonly<Record<number, readonly string[]>>} */
export const NICKNAMES = Object.freeze({
  5: ['hybrid', 'half saiyan'],            // Hybrid Saiyans
  6: ['tournament of power', 'top'],       // Universe Survival Saga
  12: ['ssj3'],                            // Super Saiyan 3
  17: ['pure', 'saiyan'],                  // Pure Saiyans
  22: ['universe 7', 'u7'],                // Representatives of Universe 7
  34: ['dragon ball saga'],                // DB Saga
  36: ['ssj'],                             // Super Saiyans
  39: ['kame'],                            // Kamehameha
  45: ['ssj2'],                            // Super Saiyan 2
  60: ['great ape', 'oozaru'],             // Giant Ape Power
})

const pulito = (a) => String(a).trim().toLowerCase()

/**
 * Gli alias di una categoria, minuscoli, senza doppioni, in ordine (quello
 * di JavaScript, per unita' di codice: in SQL e' collate "C").
 * @param {number} id
 * @param {string} nameEn
 * @returns {string[]}
 */
export function aliasesFor(id, nameEn) {
  const tutti = [initialsAlias(nameEn), ...(NICKNAMES[id] ?? [])].filter((a) => a != null).map(pulito)
  return [...new Set(tutti)].filter(Boolean).sort()
}
