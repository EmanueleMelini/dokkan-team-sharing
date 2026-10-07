import type { Region } from '@/lib/queries'

/*
 * I parametri dell'URL arrivano da chiunque: link vecchi, URL scritti a
 * mano, bot. Qui vengono ridotti a valori che le query sanno trattare,
 * così un parametro strano dà una pagina vuota e non un errore 500.
 */

export type Ricerca = Record<string, string | string[] | undefined>

/** Un parametro ripetuto (?q=a&q=b) arriva come array: vale il primo. */
export const uno = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export const regione = (sp: Ricerca): Region => (uno(sp.region) === 'japan' ? 'japan' : 'global')

// Nessun filtro arriva a centomila pagine. Il tetto serve all'offset:
// calcolato da numeri più grandi esce dal bigint di Postgres, o pg lo
// scrive in notazione esponenziale, e in entrambi i casi la query fallisce.
const PAGINA_MAX = 100_000

export function pagina(sp: Ricerca): number {
  const n = Number(uno(sp.page) ?? '1')
  return Number.isSafeInteger(n) && n >= 1 ? Math.min(n, PAGINA_MAX) : 1
}

export function testoRicerca(sp: Ricerca): string | null {
  const q = uno(sp.q)
    // un carattere NUL fa rifiutare la query a Postgres
    ?.replace(/[\u0000-\u001f\u007f]/g, '')
    // iOS sostituisce l'apostrofo con quello tipografico mentre scrivi, e
    // "Bulma’s" non troverebbe "Bulma's"
    .replace(/[‘’ʼ′]/g, "'")
    // trim prima del taglio, così gli spazi iniziali non consumano i 100
    // caratteri; e dopo, perché il taglio può cadere su uno spazio
    .trim()
    .slice(0, 100)
    .trim()
  return q || null
}
