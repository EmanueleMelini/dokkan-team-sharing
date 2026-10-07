// I testi delle missioni come li scrive il database Global: inglese, gia'
// interi. Non sono costruiti dalle condizioni (il gioco non ha modelli con
// segnaposto), ma sono impaginati per lo schermo del telefono e portano
// un'istruzione per il client.
import { oneLine } from '../game-events/data.mjs'

// "{cards: by_conditions}", "{cards: card_category_ids:3}",
// "{cards:card_id:1013150,1013151}": il client al loro posto mette il
// pulsante con l'elenco delle carte che vanno bene. Testo non ce n'e', e
// le condizioni vere stanno gia' nella frase: si tolgono.
const CLIENT_TOKEN = /\{\s*cards\s*:[^}]*\}/g

// Gli a capo sono quelli dello schermo ("Clear Stage 4 on Z-HARD 30 times
// using \nat least 3 characters"), non del testo: dentro un paragrafo si
// uniscono. Restano i paragrafi (riga vuota) e le note che il gioco mette
// a parte con l'asterisco ("* Friends do not count.").
export function cleanDescription(s) {
  const paras = (s ?? '').replace(CLIENT_TOKEN, '').split(/\n\s*\n/)
  const out = []
  for (const p of paras) {
    const lines = []
    for (const raw of p.split('\n')) {
      const l = raw.replace(/\s+/g, ' ').trim()
      if (!l) continue
      if (lines.length && !/^[*※・]/.test(l)) lines[lines.length - 1] += ' ' + l
      else lines.push(l)
    }
    if (lines.length) out.push(lines.join('\n'))
  }
  return out.join('\n\n')
}

// Il titolo breve della lista: una riga sola.
export const cleanName = (s) => oneLine((s ?? '').replace(CLIENT_TOKEN, ''))

// I segni che un testo non e' inglese: kana, kanji e la punteggiatura a
// tutta larghezza. Sul database Global ci sono 4311 missioni giapponesi
// (giornaliere e campagne), nessuna su un'area o un'EZA nostra: se un
// giorno ne arriva una, la si salta invece di scriverla come 'en'.
export const notEnglish = (s) => /[぀-ヿ一-鿿！-～]/.test(s ?? '')
