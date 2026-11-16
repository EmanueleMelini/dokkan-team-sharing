import type { RunSource } from '@/lib/queries'

/*
 * Tutte le date in UTC. Global programma gli eventi in UTC (la ricerca
 * sul datamine lo ha verificato sugli orari dei reset), e le date del wiki
 * sono giorni UTC salvati a mezzanotte UTC. Formattarle nel fuso del
 * server, come prima, cambiava il giorno mostrato a seconda di dove gira.
 */
const giorno = new Intl.DateTimeFormat('en-US', {
  month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
})
const breve = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const ora = new Intl.DateTimeFormat('en-US', {
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC',
})

/**
 * Il giorno, più l'ora quando la fonte la conosce: il wiki dà solo il
 * giorno. Lo specchio Japan (mirror, 0036) ha l'istante di Global, e lo
 * mostra come Global, con l'ora e "UTC": il giorno da solo sarebbe quello
 * UTC, e una finestra che parte dalle 15:00 UTC a Tokyo è già il giorno
 * dopo (le date del wiki sulle stesse pagine sono giorni giapponesi). Così
 * "Same dates as Global" sotto lo stato è vero alla lettera.
 */
export function quando(d: Date, source: RunSource | null): string {
  const g = giorno.format(d)
  return source === 'wiki' ? g : `${g}, ${ora.format(d)} UTC`
}

/** "Oct 20", per le schede della lista. */
export const giornoBreve = (d: Date) => breve.format(d)

/** Solo il giorno, per le date che non sono di una run (es. quando è stato inviato un clear). */
export const soloGiorno = (d: Date) => giorno.format(d)
