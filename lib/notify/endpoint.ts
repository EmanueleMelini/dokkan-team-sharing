// Gli endpoint push ammessi, la stessa regola di push_endpoint_ok (0031).
// Modulo puro: lo usano la Server Action dell'iscrizione (per rispondere
// prima del database), il mittente subito prima di ogni POST e i test.
//
// Perche' due volte: l'endpoint lo sceglie il browser, cioe' chiunque, e
// il server ci fa una POST. Il CHECK della tabella e' la barriera vera; il
// controllo qui, appena prima dell'invio, vale se un giorno la regola SQL
// venisse allargata per sbaglio o una riga arrivasse da un'altra strada.
// db/test/push-endpoints.ts tiene i casi che entrambe devono dare uguali.

/** La lunghezza massima, come char_length in SQL (solo ASCII: e' la stessa). */
export const PUSH_ENDPOINT_MAX = 1024

// Gli host dei servizi push dei browser: FCM (Chrome, Edge su Android),
// Mozilla (due host), Apple (Safari e iOS), WNS (Edge su Windows, un
// sottodominio per regione). Poi la porta 443 facoltativa, il percorso con
// i soli caratteri di un URL (RFC 3986) e niente frammento.
const ENDPOINT = new RegExp(
  '^https://(' +
    'fcm\\.googleapis\\.com' +
    '|updates\\.push\\.services\\.mozilla\\.com' +
    '|push\\.services\\.mozilla\\.com' +
    '|web\\.push\\.apple\\.com' +
    '|([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+notify\\.windows\\.com' +
    ")(:443)?/[-A-Za-z0-9._~:/?@!$&'()*+,;=%]*$",
)

/** Se il server puo' fare una POST a questo endpoint. */
export function pushEndpointOk(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string' || endpoint.length > PUSH_ENDPOINT_MAX) return false
  if (!ENDPOINT.test(endpoint)) return false
  // La regex basta; il parser di URL e' una seconda lettura indipendente:
  // l'host che fetch usera' davvero deve essere quello che la regex ha visto.
  try {
    const u = new URL(endpoint)
    return u.protocol === 'https:' && u.username === '' && u.password === '' && (u.port === '' || u.port === '443') &&
      endpoint.startsWith(`https://${u.hostname}`)
  } catch {
    return false
  }
}

/**
 * L'endpoint senza ':443': e' lo stesso URL, ma web-push costruisce
 * l'audience del token VAPID da protocollo e host, e con la porta scritta
 * l'audience non coinciderebbe con quella che il servizio si aspetta.
 */
export const senzaPorta443 = (endpoint: string) => endpoint.replace(/^(https:\/\/[^/:]+):443\//, '$1/')
