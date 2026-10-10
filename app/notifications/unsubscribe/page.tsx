import type { Metadata } from 'next'
import Link from 'next/link'
import { Disiscrivi } from '@/components/notifiche/disiscrivi'
import { readNotifyEnv } from '@/lib/notify/env'
import { verifyUnsubscribeToken } from '@/lib/notify/token'

// La conferma della disiscrizione dal digest, il link nel corpo
// dell'email. Il GET mostra solo un bottone e non scrive niente: i filtri
// antispam e gli antivirus aprono i link delle email, e non devono
// disiscrivere nessuno. La firma si controlla gia' qui (senza database),
// per dire subito se il link e' rotto; la versione la controlla la POST.
//
// Nessuna sessione: chi apre il link puo' non essere collegato, o esserlo
// con un altro account. noindex, e no-referrer (anche nell'header, in
// next.config.ts): il token sta nell'URL e non deve uscire verso i link
// della pagina.
export const metadata: Metadata = {
  title: 'Unsubscribe',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

// Dipende dalla query string: niente shell statico da validare.
export const instant = false

export default async function UnsubscribePage({ searchParams }: PageProps<'/notifications/unsubscribe'>) {
  const t = (await searchParams).t
  const token = typeof t === 'string' ? t : null
  const valido = token !== null && verifyUnsubscribeToken(readNotifyEnv().secret, token) !== null

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-inchiostro">Daily email digest</h1>
      <div className="mt-6 max-w-lg border border-linea rounded-[var(--raggio)] bg-superficie px-4 py-4 space-y-3">
        {valido ? (
          <>
            <p className="text-[13px] leading-relaxed text-testo">
              Stop the daily digest emails for the account this link was sent to. Your notifications
              list on the site stays as it is.
            </p>
            <Disiscrivi token={token} />
          </>
        ) : (
          <p role="alert" className="text-[13px] leading-relaxed text-testo">
            This unsubscribe link is not valid. It may be incomplete, or it was sent before the
            account&apos;s email changed.
          </p>
        )}
      </div>
      <p className="mt-6 max-w-lg text-[12px] leading-relaxed text-tenue">
        You can also turn the digest on or off in{' '}
        <Link href="/settings#notifications" prefetch={false} className="underline decoration-oro-linea underline-offset-2 hover:text-inchiostro">
          Settings
        </Link>
        .
      </p>
    </div>
  )
}
