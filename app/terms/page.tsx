import type { Metadata } from 'next'
import Link from 'next/link'
import { PaginaLegale } from '@/components/pagina-legale'
import { LEGALE } from '@/lib/legale'

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'The rules for using Dokkan Team Sharing and posting clears.',
}

export default function Terms() {
  const mail = `mailto:${LEGALE.contatto}`
  return (
    <PaginaLegale titolo="Terms of Service" aggiornato={LEGALE.aggiornato}>
      <p>
        These terms apply to Dokkan Team Sharing ({LEGALE.sito}), a free, non-commercial fan site
        run by {LEGALE.titolare}. By creating an account you agree to them. Reading the site needs
        no account.
      </p>

      <h2>A fan site</h2>
      <p>
        This site is not affiliated with, endorsed, sponsored or approved by Bandai Namco
        Entertainment, Akatsuki, Toei Animation, Shueisha or Bird Studio. DRAGON BALL Z Dokkan
        Battle, its names, characters and images belong to their owners and are shown here for
        information only. Card and event data comes from the Dragon Ball Z Dokkan Battle Wiki on
        Fandom, licensed under CC BY-SA, and from the game&apos;s own data.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>You must be at least {LEGALE.etaMinima} years old.</li>
        <li>One account per person, and you are responsible for what is posted with it.</li>
        <li>
          You can delete your account at any time from <Link href="/settings">Settings</Link>.
        </li>
      </ul>

      <h2>What you post</h2>
      <p>
        You keep the rights to the clears, notes and comments you post. You allow this site to
        store and show them, and to format them for display, for as long as they are online. When
        you delete them, or your account, they are removed.
      </p>
      <p>Please keep it useful and fair. Do not post:</p>
      <ul>
        <li>clears you did not achieve, or proof that is not yours;</li>
        <li>insults, harassment, hate speech or personal information about other people;</li>
        <li>spam, advertising, or links to malware, scams or explicit or illegal content;</li>
        <li>anything that infringes someone else&apos;s rights.</li>
      </ul>
      <p>Content that breaks these rules can be removed, and accounts that keep doing it suspended.</p>

      <h2>Reports and moderation</h2>
      <p>
        If a clear or a comment breaks these rules, use its Report button. Moderators read every
        report; nothing is hidden automatically, however many reports a post gets.
      </p>
      <ul>
        <li>
          A moderator can hide a clear or a comment. Other players no longer see it. The author of
          a hidden clear finds it in Settings and can still change it or delete it.
        </li>
        <li>
          A moderator can suspend an account for a set time or indefinitely, with a reason that the
          account owner sees. While suspended you can still sign in, read the site, change your
          settings and delete your posts or your account, but you cannot post, revise, vote,
          comment or report.
        </li>
        <li>
          If you think a decision was wrong, write to <a href={mail}>{LEGALE.contatto}</a>.
        </li>
      </ul>

      <h2>The service</h2>
      <p>
        The site is offered as it is, for free. It can change, be unavailable at times or stop,
        and its data, coming from community sources, can contain mistakes. To the extent the law
        allows, no warranty is given and no liability is accepted for losses caused by using it.
        Nothing here limits the rights you have under the consumer law of your country.
      </p>

      <h2>Changes and law</h2>
      <p>
        If these terms change, this page and its date are updated, and important changes are
        announced on the site before they apply. These terms are governed by Italian law, without
        affecting the mandatory protections of the country where you live.
      </p>

      <h2>Contact</h2>
      <p>
        Questions or reports: <a href={mail}>{LEGALE.contatto}</a>. How personal data is handled is
        explained in the <Link href="/privacy">Privacy Policy</Link>.
      </p>
    </PaginaLegale>
  )
}
