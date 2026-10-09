import type { Metadata } from 'next'
import Link from 'next/link'
import { PaginaLegale } from '@/components/pagina-legale'
import { LEGALE } from '@/lib/legale'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'What Dokkan Team Sharing collects, why, and your rights.',
}

// Ogni frase qui sotto descrive quello che il codice fa davvero (tabelle
// app_user, auth_*, clear_*, report, moderation_action, notification;
// lib/auth/config.ts):
// se cambia il codice, va cambiata anche questa pagina.
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
          <strong>Display preference.</strong> Whether card pages show the still or the animated
          artwork by default, stored with your account until you change it or delete the account.
          Same legal basis as above.
        </li>
        <li>
          <strong>What you post.</strong> Clears (teams, builds, notes and proof links), comments,
          tips (short advice with an optional link) and votes. Clears, comments and tips are public
          together with your handle. Votes count toward public scores, including the Helpful count
          on tips, but who voted is not shown. Same legal basis as above.
        </li>
        <li>
          <strong>Your public profile.</strong> Your handle has a public page at /users/your-handle. It
          shows your handle, the game version you play, the month you joined, how many clears you
          shared, how many upvotes they received and how many comments you wrote, and the list of
          your clears. It never shows your email, your sign-in provider, its name or picture, or your
          role. The profile of a suspended account is not shown. If you change your handle, your old
          handles stay reserved for your account so nobody else can take them, and links to them lead
          to your new one. Same legal basis as above.
        </li>
        <li>
          <strong>Reports and moderation.</strong> When you report a clear, a comment or a tip, the site
          stores your account, the post, the reason you picked, the details you wrote, if any, and
          the time. Only moderators (accounts the site owner gives the admin role) see reports;
          the author of the post is not told who reported it. When a moderator hides or restores a
          post, closes reports or suspends an account, an entry goes into a moderation log: the
          moderator&apos;s account and handle, the action, the id of the post or account and of its
          author, how many reports it closed, a private note of the moderator and, for a
          suspension, its end and reason. The log never copies the text of the post. If your
          account is suspended, the end date and the reason are stored with your account and shown
          to you. This keeps the site safe and fair for its users (legitimate interest, GDPR Art.
          6(1)(f)).
        </li>
        <li>
          <strong>Notifications.</strong> When someone comments on one of your clears, or a moderator
          hides or restores one of your posts or suspends your account or lifts a suspension, the site
          stores a notification for you: its type, the post it is about, the account that caused it
          (for a comment, the commenter; for moderation, the moderator, whose handle is never shown to
          you), when it arrived and when you read it. Moderators also get one when a new report is
          waiting, without saying who sent it. A notification never copies the text of a post, and
          nobody is told who reported their post. Only you can see your notifications. Same legal
          basis as your account.
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
      <p>
        If you switch a card&apos;s artwork between still and animated on its page, your browser
        remembers that choice in its local storage, for the last 200 cards. It stays on your device
        and is never sent to the site; clearing your browser data removes it.
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
        <li>
          Your old handles: as long as your account exists. Deleting the account frees them, and
          someone else can then pick them.
        </li>
        <li>Sessions: 30 days after your last visit, then removed.</li>
        <li>Sign-in links: 10 minutes. Sign-in counters: 1 hour. The sign-in email log: 1 day.</li>
        <li>
          Reports: until a moderator handles them, then {LEGALE.giorniSegnalazioni} more days. They
          are deleted earlier if you delete your account, or when the reported post is deleted.
        </li>
        <li>
          Notifications: {LEGALE.giorniNotificheLette} days after you read them, or{' '}
          {LEGALE.giorniNotificheNonLette} days after the last update if you never do. They are deleted
          earlier with your account or with the post they are about.
        </li>
        <li>
          A suspension&apos;s end date and reason: until a moderator lifts it, or until you delete
          your account.
        </li>
        <li>
          The moderation log: kept without a time limit, so that every decision can be checked
          and undone. When an account is deleted its entries stay, but only with ids that no
          longer lead to any account; a moderator&apos;s entries also keep the handle they had.
        </li>
      </ul>
      <p>
        Deleting your account from <Link href="/settings">Settings</Link> removes it immediately,
        together with everything you posted: clears, comments, tips, votes, the reports you
        sent and your notifications.
        Copies inside database
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
