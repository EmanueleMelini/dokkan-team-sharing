import type { Metadata } from 'next'
import Link from 'next/link'
import { PaginaLegale } from '@/components/pagina-legale'
import { LEGALE } from '@/lib/legale'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'What Dokkan Team Sharing collects, why, and your rights.',
}

// Ogni frase qui sotto descrive quello che il codice fa davvero (tabelle
// app_user, auth_*, clear_*, report, moderation_action, notification,
// email_quota, push_subscription, push_sent; lib/auth/config.ts,
// lib/notify/digest.ts, lib/notify/payload.ts, lib/notify/push-client.ts,
// lib/notify/attivita.ts):
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
          <strong>Site activity for moderators.</strong> A moderator can turn on, in Settings, a feed of
          what happens on the site. For each action another member takes (posting, editing or deleting
          a clear or a tip, commenting, voting, marking a tip Helpful, reporting, joining, changing their
          handle, deleting their account) and for the actions of other moderators, that moderator gets
          a notification which stores who acted (a link to the account, shown with its current handle),
          what they did and where: the post, or for a deleted post only the event and stage. For a
          report it stores only the post, never who sent it. It never stores the text of a post or
          the reason or details of a report, and it never goes by email. When an account is deleted,
          its handle no longer appears in any notification: the ones about that person or their posts
          are deleted, and in the others the person shows up only as &quot;Someone&quot;. If a
          moderator stops being one, the feed is turned off and its notifications are deleted. These
          notifications are kept like the others, below. This helps moderators keep the site safe
          and fair (legitimate interest, GDPR Art. 6(1)(f)).
        </li>
        <li>
          <strong>Browser notifications.</strong> Off unless you turn them on in Settings, on each
          device separately. If you do, the site stores what your browser gives it for that device:
          the address of its push service (Google for Chrome and Android, Apple for Safari and
          iPhone, Mozilla for Firefox, Microsoft for Edge on Windows), the keys that encrypt the
          notification so that only your browser can read it, a rough name such as &quot;Chrome on
          Android&quot;, when it was added and last confirmed, and whether recent deliveries worked.
          It also logs when a notification was sent, to whom and because of which account, to limit
          how many go out. A notification says who commented and on which event, that a moderator
          updated one of your posts or your account, or how many reports are open, and for a
          moderator with the site activity feed on, who did what and where; it never shows the text
          of a post or who sent a report. The push service sees when a notification reaches your
          device, but not what it says. Your consent is the legal basis (GDPR Art. 6(1)(a)). You can withdraw it at
          any time: turn notifications off or remove a device in Settings, or block notifications
          for this site in your browser. Signing out also removes the device you sign out from.
        </li>
        <li>
          <strong>Email digest.</strong> Off unless you turn it on in Settings. If you do, the site
          stores when you agreed and when it last sent you a digest, and once a day at most, only
          when something is new, it emails your account&apos;s address a summary of your unread
          notifications and how many upvotes and Helpful votes your posts got, without saying who
          gave them. Moderation is only mentioned in general terms, and the digest never copies the
          text of a post. Your consent is the legal basis (GDPR Art. 6(1)(a)). You can withdraw it
          at any time with the unsubscribe link in every digest or in Settings; this stops future
          digests and does not affect the ones already sent.
        </li>
        <li>
          <strong>Email counts.</strong> To stay within the email provider&apos;s daily and monthly
          limits, the site counts how many sign-in emails and digests it sends each day. The counts
          are just numbers per day: no addresses and no accounts (legitimate interest, GDPR Art.
          6(1)(f)).
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
      <p>
        If you turn on browser notifications, your browser also keeps in its local storage your
        handle and when it last checked its notification setting with the site, so it does that at
        most once a day. Signing out removes it.
      </p>

      <h2>Who else handles the data</h2>
      <p>These services process data on the site&apos;s behalf, only to run it:</p>
      <ul>
        <li>Vercel (hosting of the site)</li>
        <li>Supabase (the database)</li>
        <li>Cloudflare (domain and card images)</li>
        <li>Resend (sending sign-in emails and, if you turn it on, the daily digest)</li>
        <li>
          If you turn on browser notifications, the push service of your browser: Google, Apple,
          Mozilla or Microsoft. It only carries the encrypted notification to your device.
        </li>
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
          The daily email counts: {LEGALE.giorniContatoriEmail} days. Your digest consent: until you
          turn the digest off. The time of the last digest: as long as your account exists.
        </li>
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
          A device for browser notifications: until you turn it off, remove it or sign out on it,
          until its push service says it no longer exists, or {LEGALE.giorniDispositiviPush} days
          after your browser last confirmed it. The log of sent notifications:{' '}
          {LEGALE.giorniRegistroPush} days.
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
        sent, your notifications and your devices for browser notifications.
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
