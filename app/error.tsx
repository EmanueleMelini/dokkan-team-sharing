'use client' // gli error boundary devono essere Client Component

/*
 * Un errore non previsto (il database che non risponde, una query che
 * fallisce) mostra questo dentro il layout del sito, invece della pagina
 * 500 di Next. In questa versione di Next la prop per riprovare è retry(),
 * che rifà anche il fetch; reset() rirenderizzerebbe senza ricaricare i dati.
 */
export default function Errore({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return (
    <div className="mx-auto max-w-6xl px-5 py-16">
      <div className="max-w-md border border-linea rounded-[var(--raggio)] bg-superficie px-6 py-10">
        <h1 className="text-lg font-semibold text-inchiostro">Something went wrong</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-testo">
          We couldn’t load this page. Trying again in a moment usually fixes it.
        </p>
        {error.digest && (
          <p className="mt-3 text-[11px] text-tenue">
            Error code: <span className="numeri">{error.digest}</span>
          </p>
        )}
        <button
          type="button"
          onClick={() => retry()}
          className="mt-5 px-3 py-1.5 text-[13px] font-medium rounded-[var(--raggio)] bg-inchiostro text-sfondo hover:opacity-90 transition-opacity"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
