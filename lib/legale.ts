/*
 * Chi risponde del sito e come contattarlo, in un posto solo: le pagine
 * Privacy e Terms li leggono da qui. Il GDPR chiede che il titolare del
 * trattamento sia identificabile e raggiungibile.
 */
export const LEGALE = {
  titolare: 'Emanuele Melini',
  paese: 'Italy',
  contatto: 'privacy@emanuelemelini.dev',
  sito: 'dokkants.emanuelemelini.dev',
  aggiornato: 'October 8, 2026',
  etaMinima: 16,
  /** dopo quanti giorni si cancellano le segnalazioni chiuse (purge_resolved_reports, 0024) */
  giorniSegnalazioni: 180,
} as const
