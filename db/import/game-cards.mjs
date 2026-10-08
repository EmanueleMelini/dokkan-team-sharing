// Quali carte del datamine mancano davvero, e come diventano righe.
//
// Funzioni pure, senza database: le usa load-game-cards e le prova
// db/test/game-cards.test.mts sul CSV vero. La scelta e' fatta di regole
// e non di una lista di id, cosi' al prossimo aggiornamento del datamine
// le carte appena uscite entrano da sole.
import { decodeElement, decodeRarity, int, isPlayable, isSentinel } from './datamine.mjs'

// Le carte giocabili hanno il prefisso 1, 2 o 3. Il 4 sono le forme
// trasformate in battaglia (nella stessa pagina wiki della carta), il 7
// le forme potenziate, il 5 righe giapponesi, il 9 copie nemiche.
const UNIT_PREFIX = /^[123]\d{6}$/

// 2015-10-30 e' la data minima che il database Global da' alle carte
// dell'epoca del lancio, non un'uscita vera. Tutte le carte reali di
// quel periodo hanno una pagina wiki; quelle che restano senza sono
// righe spente (Android #14 e #15, che il wiki segna come mai uscite, e
// tre copie di Krillin, Tien e Yamcha senza nemmeno un file sul wiki).
export const LAUNCH_FLOOR = '2015-11-01'

// L'unita': ultima cifra 0 = la carta base, 1 = la stessa dopo lo
// Z-awakening. Una carta del sito e' un'unita', con l'id della base,
// come fa il wiki.
export const unitOf = (id) => Math.floor(Number(id) / 10)

const cleanName = (s) => (s ?? '').replace(/\s+/g, ' ').trim()

/**
 * rows: le righe di cards.csv. covered: gli id delle carte che hanno gia'
 * una pagina wiki (il wiki vince sempre). now: la data di oggi, perche'
 * una carta annunciata ma non ancora uscita non e' giocabile.
 * Restituisce { cards, skipped }: skipped ha il motivo, per il riepilogo.
 */
export function pickGameCards(rows, covered, now = new Date()) {
  const coveredUnits = new Set([...covered].map(unitOf))
  const today = now.toISOString().slice(0, 19).replace('T', ' ')
  const byId = new Map(rows.map((r) => [String(r.id), r]))
  const units = new Map()
  for (const r of rows) {
    if (!isPlayable(r) || !UNIT_PREFIX.test(r.id)) continue
    if (!r.open_at || isSentinel(r.open_at) || r.open_at > today) continue
    // senza passiva e senza link e' un oggetto (statue di Hercule, Kaioh)
    if (!int(r.passive_skill_set_id) && !int(r.link_skill1_id)) continue
    const u = unitOf(r.id)
    if (!units.has(u)) units.set(u, [])
    units.get(u).push(r)
  }

  const cards = [], skipped = []
  for (const [u, list] of units) {
    list.sort((a, b) => Number(a.id) - Number(b.id))
    const base = list[0]
    const skip = (why) => skipped.push({ id: Number(base.id), name: cleanName(base.name), why })
    if (coveredUnits.has(u)) continue                // c'e' gia', dal wiki
    if (base.open_at < LAUNCH_FLOOR) { skip('data minima del lancio, non un\'uscita'); continue }
    // Il set della leader skill porta l'id dell'unita' che l'ha introdotto.
    // Se e' di un'altra unita' con lo stesso nome, tipo e rarita', questa
    // e' una copia: una ristampa (1032520 e' 1012360) o il secondo id di
    // una pagina che ne copre due (i cloni di Goku Black). La carta vera
    // c'e' gia' con il suo id. Il solo set condiviso non basta: le cinque
    // Metal Cooler ne hanno uno solo e sono carte distinte (tipi diversi).
    const ls = int(base.leader_skill_set_id)
    const orig = ls && ls !== u ? byId.get(String(ls * 10)) : null
    if (orig && cleanName(orig.name) === cleanName(base.name)
        && orig.element === base.element && orig.rarity === base.rarity) {
      skip(`copia di ${orig.id}`); continue
    }

    // La forma base (element 0-4) non ha ancora la classe: la si prende
    // dalla forma Z-awakened della stessa unita'. Sulle carte del wiki
    // questa regola da' la classe giusta 1373 volte su 1376.
    const el = decodeElement(base.element)
    const cls = el?.cls ?? list.map((r) => decodeElement(r.element)?.cls).find(Boolean)
    const rarity = decodeRarity(base.rarity)
    if (!el || !cls || !rarity) { skip('tipo, classe o rarita\' non decifrabili'); continue }
    const name = cleanName(base.name)
    if (!name) { skip('senza nome'); continue }

    cards.push({
      id: Number(base.id), name, type: el.type, cls, rarity,
      // il giorno UTC di open_at e' la data GLBdate del wiki (1034300:
      // open_at 2026-07-29 05:00, GLBdate 29 Jul 2026)
      global_release: base.open_at.slice(0, 10),
    })
  }
  cards.sort((a, b) => a.id - b.id)
  skipped.sort((a, b) => a.id - b.id)
  return { cards, skipped }
}
