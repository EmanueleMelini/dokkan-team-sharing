/*
 * Il primo suggerimento di handle in /welcome, ricavato dal nome che dà il
 * provider. È solo un punto di partenza: l'utente lo cambia nel form, e la
 * regola vera (3-24 tra lettere, cifre e _) la controllano l'action e il DB.
 */

// Lettere che NFKD non scompone in "lettera + accento", perché per Unicode
// sono lettere a sé: senza questa tabella "ŁełeMims01" diventava "e_eMims01".
const LETTERE: Record<string, string> = {
  Ł: 'L', ł: 'l', Ø: 'O', ø: 'o', Đ: 'D', đ: 'd', Ð: 'D', ð: 'd', Ħ: 'H', ħ: 'h',
  ß: 'ss', ẞ: 'SS', Æ: 'AE', æ: 'ae', Œ: 'OE', œ: 'oe', Þ: 'Th', þ: 'th', ı: 'i', ĸ: 'k',
}

export function suggestHandle(name: string | null | undefined): string {
  const s = String(name ?? '')
    .replace(/[ŁłØøĐđÐðĦħßẞÆæŒœÞþıĸ]/g, (c) => LETTERE[c] ?? c)
    // NFKD separa la lettera dall'accento ("é" -> "e" + accento), poi
    // l'accento si toglie: lasciarlo lo trasformava in un _ in mezzo alla parola
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24)
    .replace(/_+$/, '')
  // "user_..." è il prefisso degli handle provvisori, e il DB lo rifiuta
  return s.length >= 3 && !/^user_/i.test(s) ? s : ''
}
