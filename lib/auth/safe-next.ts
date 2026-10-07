/**
 * Il ?next= dopo l'accesso, solo se e' un percorso di questo sito.
 * "//evil.com" e "/\evil.com" il browser li legge come un altro host, e
 * un URL assoluto porterebbe fuori: tutto cio' che non e' un percorso
 * relativo semplice diventa "/". Puro, lo usano server e client.
 */
export function safeNext(value: unknown, fallback = '/'): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) return fallback
  if (!value.startsWith('/')) return fallback
  if (value.startsWith('//') || value.startsWith('/\\')) return fallback
  // Caratteri di controllo (un a capo nell'header Location) e backslash
  // ovunque: certi browser li trattano come "/".
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return fallback
  // Le pagine dell'accesso non sono una meta: si finirebbe in un giro.
  if (/^\/(login|welcome)(\/|\?|#|$)/.test(value)) return fallback
  return value
}
