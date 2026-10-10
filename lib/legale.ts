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
  aggiornato: 'October 10, 2026',
  etaMinima: 16,
  /** dopo quanti giorni si cancellano le segnalazioni chiuse (purge_resolved_reports, 0024) */
  giorniSegnalazioni: 180,
  /** dopo quanti giorni dalla lettura si cancella una notifica (purge_notifications, 0028) */
  giorniNotificheLette: 30,
  /** dopo quanti giorni senza novita' si cancella una notifica mai letta (purge_notifications, 0028) */
  giorniNotificheNonLette: 90,
  /** dopo quanti giorni si cancellano i contatori giornalieri delle email (purge_email_quota, 0029) */
  giorniContatoriEmail: 40,
  /** dopo quanti giorni senza conferme si cancella un dispositivo delle push (purge_push, 0031) */
  giorniDispositiviPush: 90,
  /** dopo quanti giorni si cancella il registro delle push mandate (purge_push, 0031) */
  giorniRegistroPush: 2,
} as const

/**
 * Da dove vengono i testi delle carte (nomi, skill, link, categorie): il
 * wiki della community, CC BY-SA, che chiede di citare la fonte accanto
 * al testo riusato. La pagina della carta linka la pagina del wiki da cui
 * vengono i suoi testi; Terms e il piede del sito citano il wiki intero.
 */
export const FONTE_TESTI = {
  nome: 'Dragon Ball Z Dokkan Battle Wiki',
  sito: 'https://dbz-dokkanbattle.fandom.com',
  licenza: 'CC BY-SA 3.0',
  licenzaUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
} as const

/** La pagina del wiki di una carta, dal titolo salvato da load-cards. */
export const paginaWiki = (titolo: string) =>
  `${FONTE_TESTI.sito}/wiki/${encodeURIComponent(titolo.replace(/ /g, '_')).replace(/%2F/g, '/')}`
