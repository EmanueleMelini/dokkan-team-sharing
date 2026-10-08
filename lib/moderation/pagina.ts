// Il numero di pagina delle liste admin (?page=). Pura: niente Next.

/** Senza parametro 1; un valore storto null, e la pagina risponde 404. */
export function pagina(v: string | string[] | undefined): number | null {
  const s = Array.isArray(v) ? v[0] : v
  if (s === undefined || s === '') return 1
  if (!/^[1-9]\d{0,4}$/.test(s)) return null
  return Number(s)
}
