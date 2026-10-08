import type { Metadata } from 'next'
import Link from 'next/link'
import { PaginaLegale } from '@/components/pagina-legale'
import { LEGALE } from '@/lib/legale'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'What Dokkan Team Sharing collects, why, and your rights.',
}

// Ogni frase qui sotto descrive quello che il codice fa davvero (tabelle
// app_user, auth_*, clear_*; lib/auth/config.ts): se cambia il codice,
// va cambiata anche questa pagina.
export default function Privacy() {
  const mail = `mailto:${LEGALE.contatto}`
  return (
    <PaginaLegale titolo="Privacy Policy" aggiornato={LEGALE.aggiornato}>
      <p>
        Dokkan Team Sharing ({LEGALE.sito}) is a free, non-commercial fan site run by{' '}
        {LEGALE.titolare}, an individual based in {LEGALE.paese}, who is the data controller.
        You can reach me at <a href={mail}>{LEGALE.contatto}</a>.
      </p>
      <p>
        You can browse every page without an account. Personal data is collected only when you
        sign in, and only what the site needs to work.
      </p>

      <h2>What is collected and why</h2>
      <ul>
        <li>
          <strong>Your account.</strong> Your email address and whether it is verified, the id of
          your account at the sign-in provider you chose (Discord, Google or Twitch), the name and
          profile picture link that provider shares (used only to suggest a handle, never shown),
          and the handle and game version you pick. This is needed to give you an account
          (performance of a contract, GDPR Art. 6(1)(b)).
        </li>
        <li>
          <strong>What you post.</strong> Clears (teams, builds, notes and proof links), comments
          and votes. Clears and comments are public together with your handle. Votes count toward
          public scores, but who voted is not shown. Same legal basis as above.
        </li>
        <li>
          <strong>Security.</strong> While you are signed in, your session is stored with the IP
          address and browser identifier it started from, and short-lived counters by IP address
          and email address limit sign-in attempts and sign-in emails. This protects the site and
          its users from abuse (legitimate interest, GDPR Art. 6(1)(f)).
        </li>
      </ul>
      <p>
        There are no passwords, and the access tokens of sign-in providers are not kept. There are
        no ads, no analytics, no trackers, and your data is never sold.
      </p>

      <h2>Cookies</h2>
      <p>
        One cookie keeps you signed in, and a few short-lived ones protect the sign-in step from
        forgery while it happens. They are strictly necessary, so no consent banner is needed.
        Nothing is set when you only browse.
      </p>

      <h2>Who else handles the data</h2>
      <p>These services process data on the site&apos;s behalf, only to run it:</p>
      <ul>
        <li>Vercel (hosting of the site)</li>
        <li>Supabase (the database)</li>
        <li>Cloudflare (domain and card images)</li>
        <li>Resend (sending sign-in emails)</li>
      </ul>
      <p>
        The provider you sign in with (Discord, Google or Twitch) handles that step under its own
        privacy policy. Some of these services may process data outside the European Union, with
        the safeguards the GDPR requires, such as the European Commission&apos;s standard
        contractual clauses.
      </p>

      <h2>How long it is kept</h2>
      <ul>
        <li>Your account and what you post: until you delete them.</li>
        <li>Sessions: 30 days after your last visit, then removed.</li>
        <li>Sign-in links: 10 minutes. Sign-in counters: 1 hour. The sign-in email log: 1 day.</li>
      </ul>
      <p>
        Deleting your account from <Link href="/settings">Settings</Link> removes it immediately,
        together with everything you posted: clears, comments and votes. Copies inside database
        backups disappear when those backups expire, within 30 days.
      </p>

      <h2>Your rights</h2>
      <p>
        You can ask to access, correct, export or delete your data, to restrict its use, or object
        to it, by writing to <a href={mail}>{LEGALE.contatto}</a>. You can delete your account
        yourself at any time. You can also complain to the Italian data protection authority
        (Garante per la protezione dei dati personali, garanteprivacy.it) or to the authority of
        the country where you live.
      </p>

      <h2>Age</h2>
      <p>You must be at least {LEGALE.etaMinima} years old to create an account.</p>

      <h2>Changes</h2>
      <p>
        If this policy changes, this page and its date are updated, and important changes are
        announced on the site before they apply.
      </p>
    </PaginaLegale>
  )
}
