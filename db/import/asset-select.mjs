// Quali immagini fetch-assets deve davvero lavorare. Pura, per i test.
//
// Una riga in asset ha chiave <keyBase>.<estensione> (cards/1/thumb.webp):
// per ogni job si cerca la riga col suo prefisso.

// indice prefisso -> chiave, cosi' 6000 job contro 6000 righe non sono
// 36 milioni di startsWith
export function keyIndex(keys) {
  /** @type {Map<string, string>} */
  const idx = new Map()
  for (const k of keys) {
    for (let i = k.indexOf('.'); i > 0; i = k.indexOf('.', i + 1)) {
      const base = k.slice(0, i)
      if (!idx.has(base)) idx.set(base, k)
    }
  }
  return idx
}

/**
 * --missing: solo i job senza riga (la CI chiede al wiki solo le immagini
 * nuove, non le 6000 che stanno gia' su Cloudflare).
 * --offline: un job con la riga si collega e basta, anche se il file non e'
 * su questo disco. In produzione i file stanno su Cloudflare Pages, non qui:
 * prima finivano contati come "falliti" e senza collegamento.
 *
 * @template {{ keyBase: string }} J
 * @param {J[]} jobs
 * @param {Iterable<string>} haveKeys
 * @param {{ missing?: boolean, offline?: boolean }} [opts]
 * @returns {{ todo: J[], kept: (J & { key: string })[], dropped: number }}
 */
export function selectJobs(jobs, haveKeys, { missing = false, offline = false } = {}) {
  const idx = keyIndex(haveKeys)
  const todo = [], kept = []
  let dropped = 0
  for (const j of jobs) {
    const key = idx.get(j.keyBase)
    if (key && missing) { dropped++; continue }
    if (key && offline) { kept.push({ ...j, key }); continue }
    todo.push(j)
  }
  return { todo, kept, dropped }
}
