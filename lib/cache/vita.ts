// Le vite dei dati in cache che non sono un profilo fisso di next.config.ts.
// Modulo puro, senza Next: lo provano i test (db/test/cache-tags.test.mts).

export const GIORNO = 86_400
/**
 * Il minimo della scadenza (expire) di ogni pagina pubblica, lo stesso del
 * profilo 'community' di next.config.ts. Una pagina prende la scadenza piu'
 * corta fra i dati che legge, e passata la scadenza la prossima visita la
 * rigenera da capo: con una settimana la coda lunga visitata di rado (un bot
 * ogni dieci giorni) si riscriveva per intero a ogni visita. Con 30 giorni
 * la freschezza non cambia (i tag e il revalidate di un giorno), e una
 * rigenerazione che da' gli stessi byte non costa scritture ISR.
 */
export const SCADENZA = 30 * GIORNO

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

/**
 * La vita di un dato che dipende da now() (lo stato Ongoing/Ended): si
 * rigenera al prossimo confine di una ricorrenza, non prima di 5 minuti
 * (sotto, il dato uscirebbe dal prerender) e non oltre il tetto.
 */
export function vitaAlConfine(secondi: number | null, tetto: number) {
  const revalidate = clamp(secondi ?? tetto, 300, tetto)
  return { stale: 300, revalidate, expire: Math.max(revalidate * 2, SCADENZA) }
}
