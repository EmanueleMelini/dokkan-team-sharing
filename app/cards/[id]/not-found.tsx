import Link from 'next/link'

/** Un id che non e' una carta: lo stesso riquadro del 404 del sito. */
export default function CartaNonTrovata() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-16">
      <div className="max-w-md border border-linea rounded-[var(--raggio)] bg-superficie px-6 py-10">
        <p className="numeri text-[12px] text-tenue">404</p>
        <h1 className="mt-1 text-lg font-semibold text-inchiostro">This card isn’t in our database</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-testo">
          The link may be old or mistyped. Cards appear here once the game or the wiki lists them.
        </p>
        <Link
          href="/events"
          className="inline-block mt-5 px-3 py-1.5 text-[13px] font-medium rounded-[var(--raggio)] bg-inchiostro text-sfondo hover:opacity-90 transition-opacity"
        >
          Go to events
        </Link>
      </div>
    </div>
  )
}
