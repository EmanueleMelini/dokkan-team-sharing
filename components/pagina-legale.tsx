/** L'impaginazione comune di Privacy e Terms: testo lungo, righe leggibili. */
export function PaginaLegale({
  titolo, aggiornato, children,
}: { titolo: string; aggiornato: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl px-5 py-12">
      <article className="max-w-[70ch] text-[14px] leading-relaxed text-testo [&_h2]:mt-9 [&_h2]:mb-2 [&_h2]:text-[15px] [&_h2]:font-semibold [&_h2]:text-inchiostro [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:mt-1.5 [&_a]:underline [&_a]:decoration-oro-linea [&_a]:underline-offset-2 [&_strong]:text-inchiostro [&_strong]:font-medium">
        <h1 className="text-2xl font-semibold tracking-tight text-inchiostro">{titolo}</h1>
        <p className="!mt-1 text-[12px] text-tenue">Last updated: {aggiornato}</p>
        {children}
      </article>
    </div>
  )
}
