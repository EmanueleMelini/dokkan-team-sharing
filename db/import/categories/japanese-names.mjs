// I nomi giapponesi delle categorie, dal datamine Global (migrazione 0037).
// Funzione pura: niente database, niente file, niente effetti all'import.
//
// DA DOVE. Il database Global non ha una colonna col nome giapponese delle
// categorie, ma porta in missions.csv le "missioni dei titoli" del server
// giapponese, mai tradotte: mission_category_id 5 (称号ミッション). Per ogni
// categoria ce ne sono tre (10, 100 e 300 clear con sei personaggi della
// categoria), con le condizioni {"all_card_category_ids": [N, N, ...]} e la
// descrizione che comincia col nome: 「フュージョン」カテゴリに属する...
// Il campo name lo ripete (「フュージョン」結集！, 団結！, 大連携！), ma la
// fonte e' la descrizione. Sulla cache di ottobre 2026 escono 99 nomi su
// 99, gli stessi della lista fatta a mano dal database JP.
//
// Le missioni arrivano nello stesso commit del datamine della categoria
// nuova: il nome giapponese c'e' dal primo giro.
//
// SEVERA, perche' un nome sbagliato finisce nel campo di ricerca del gioco:
//   - solo mission_category_id 5;
//   - un solo id distinto in all_card_category_ids (le missioni con piu'
//     categorie non dicono quale nome e' di quale);
//   - la descrizione comincia con 「<nome>」カテゴリ. Le altre missioni della
//     categoria 5 con le stesse condizioni non lo fanno e si ignorano: le
//     nove della "ドキドキ♥ヒロインバトル" con [4, 4, 4, 4] (24844-24846,
//     24870-24872, 25150-25152) e quelle del 超激闘大全 su 21, 77, 78 e 81,
//     che cominciano con 「超激闘大全」のステージ;
//   - le missioni valide di un id devono dire tutte lo stesso nome: se non
//     lo fanno l'id resta senza nome (e un problema lo dice);
//   - due id con lo stesso nome restano entrambi senza: category_text ha
//     unique (locale, name), e non si saprebbe quale dei due e' giusto.
// Un id senza nome non e' un errore: chi scrive (categories/plan.mjs)
// tiene l'ultimo nome noto e lo segnala.

const MISSIONI_DEI_TITOLI = 5
const NOME = /^「([^「」\r\n]+)」カテゴリ/

const intero = (v) => {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isInteger(n) ? n : null
}

/**
 * @param {Iterable<Record<string, string>>} missionRows le righe di missions.csv
 * @returns {{ names: Map<number, string>, problems: { kind: string, id?: number, ids?: number[], mission?: string, msg: string }[] }}
 */
export function extractJapaneseNames(missionRows) {
  /** @type {Map<number, Map<string, string[]>>} id -> nome -> missioni */
  const visti = new Map()
  const problems = []
  for (const r of missionRows) {
    if (intero(r.mission_category_id) !== MISSIONI_DEI_TITOLI) continue
    const m = NOME.exec(String(r.description ?? '').trim())
    if (!m) continue
    const nome = m[1].trim()
    let ids
    try {
      const cond = JSON.parse(r.conditions)
      ids = Array.isArray(cond?.all_card_category_ids) ? cond.all_card_category_ids : null
    } catch { ids = null }
    if (!ids) {
      problems.push({ kind: 'condizioni', mission: r.id,
                      msg: `missione ${r.id}: 「${nome}」 senza all_card_category_ids leggibili, la ignoro` })
      continue
    }
    const distinti = [...new Set(ids.map(intero))]
    if (distinti.length !== 1 || distinti[0] == null || distinti[0] <= 0) {
      problems.push({ kind: 'piu_categorie', mission: r.id,
                      msg: `missione ${r.id}: 「${nome}」 con le categorie [${distinti.join(', ')}], non una sola: la ignoro` })
      continue
    }
    const id = distinti[0]
    if (!visti.has(id)) visti.set(id, new Map())
    const nomi = visti.get(id)
    if (!nomi.has(nome)) nomi.set(nome, [])
    nomi.get(nome).push(String(r.id))
  }

  /** @type {Map<number, string>} un nome per id, se le sue missioni sono d'accordo */
  const candidati = new Map()
  for (const [id, nomi] of visti) {
    if (nomi.size === 1) { candidati.set(id, [...nomi.keys()][0]); continue }
    const elenco = [...nomi].map(([n, ms]) => `「${n}」 (${ms.join(', ')})`).join(' / ')
    problems.push({ kind: 'disaccordo', id, msg: `categoria ${id}: le missioni non sono d'accordo sul nome: ${elenco}` })
  }

  /** @type {Map<string, number[]>} */
  const idsPerNome = new Map()
  for (const id of [...candidati.keys()].sort((a, b) => a - b)) {
    const nome = candidati.get(id)
    if (!idsPerNome.has(nome)) idsPerNome.set(nome, [])
    idsPerNome.get(nome).push(id)
  }
  /** @type {Map<number, string>} */
  const names = new Map()
  for (const [nome, ids] of idsPerNome) {
    if (ids.length === 1) { names.set(ids[0], nome); continue }
    problems.push({ kind: 'nome_doppio', ids,
                    msg: `categorie ${ids.join(', ')}: lo stesso nome 「${nome}」, non lo prende nessuna` })
  }
  return { names, problems }
}
