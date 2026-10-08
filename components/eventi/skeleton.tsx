/** L'attesa della lista filtrata: la forma della pagina, senza testo che lampeggia. */
export function ListaSkeleton() {
  return (
    <div aria-busy="true" className="mx-auto max-w-6xl px-5 py-10">
      <div className="h-7 w-32 rounded-[var(--raggio)] bg-superficie-2" />
      <div className="mt-7 space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-7 max-w-xl rounded-[var(--raggio)] bg-superficie-2" />
        ))}
      </div>
      <ul className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <li key={i} className="aspect-[16/9] rounded-[var(--raggio)] border border-linea bg-superficie" />
        ))}
      </ul>
    </div>
  )
}
