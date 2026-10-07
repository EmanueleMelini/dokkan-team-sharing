import Link from 'next/link'

/*
 * Al posto della pagina 404 di Next, che usa il proprio bianco e nero
 * dentro un layout che è nostro, fuori dai token del tema. Questa vale sia per
 * notFound() chiamato da una pagina sia per gli URL che non esistono.
 */
export default function NonTrovato() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-16">
      <div className="max-w-md border border-linea rounded-[var(--raggio)] bg-superficie px-6 py-10">
        <p className="numeri text-[12px] text-tenue">404</p>
        <h1 className="mt-1 text-lg font-semibold text-inchiostro">This page doesn’t exist</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-testo">
          The link may be old or mistyped. If you were looking for an event, you’ll find it in the list.
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
