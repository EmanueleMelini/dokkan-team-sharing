import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import {
  ArrowSquareOut, ArrowsClockwise, BookOpenText, ClipboardText, DownloadSimple, HandTap, Heart, MagnifyingGlass,
} from '@phosphor-icons/react/dist/ssr'
import { CATEGORY_HELPER } from '@/lib/category-helper'
import { LEGALE } from '@/lib/legale'

export const metadata: Metadata = {
  title: 'Category Helper',
  description:
    'An Android helper for Dokkan Battle JP: type a category name in English and put the Japanese one straight into the game\'s category search.',
}

// La pagina dell'app Android (android/, DokkanTS Category Helper). Statica:
// niente dati, niente richiesta, un prerender del build che non si
// rigenera mai (zero scritture ISR dopo il deploy). Le categorie
// d'esempio sono scritte qui, vere (il dizionario dell'app e
// GET /api/v1/categories): leggerle dal database renderebbe la pagina un
// dato del catalogo, da riscrivere a ogni import.
//
// Ogni frase descrive quello che l'app fa davvero (android/README.md, la
// specifica): se cambia l'app, va cambiata anche questa pagina. La
// sezione sulla privacy vale anche per la Privacy Policy del sito.

const ESEMPI: { scrivi: string; en: string; ja: string }[] = [
  { scrivi: 'pure', en: 'Pure Saiyans', ja: '純粋サイヤ人' },
  { scrivi: 'ssj3', en: 'Super Saiyan 3', ja: '超サイヤ人3' },
  { scrivi: 'lcw', en: 'Low-Class Warrior', ja: '下級戦士' },
  { scrivi: 'rog', en: 'Realm of Gods', ja: '神次元' },
]

const codice = 'font-mono text-[12px] px-1 py-px rounded-[calc(var(--raggio)-2px)] bg-superficie-2 text-inchiostro'
const link = 'underline decoration-oro-linea underline-offset-2 hover:text-inchiostro'
const titolo = 'text-[15px] font-semibold text-inchiostro'

function Sezione({ id, nome, children }: { id: string; nome: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="min-w-0">
      <h2 id={id} className={`${titolo} scroll-mt-6`}>{nome}</h2>
      {children}
    </section>
  )
}

function Passo({ n, azione, children }: { n: number; azione: string; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 py-3.5">
      <span
        aria-hidden="true"
        className="numeri inline-flex size-7 items-center justify-center rounded-full border border-linea-forte text-[12px] text-inchiostro"
      >
        {n}
      </span>
      <div className="min-w-0 pt-0.5">
        <p className="text-[14px] font-medium text-inchiostro">{azione}</p>
        <div className="mt-1 text-[13px] leading-relaxed text-testo [&_p+p]:mt-1.5">{children}</div>
      </div>
    </li>
  )
}

function Uso({ icona, nome, children }: { icona: ReactNode; nome: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3">
      <span className="pt-0.5 text-tenue">{icona}</span>
      <div className="min-w-0">
        <h3 className="text-[13px] font-semibold text-inchiostro">{nome}</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-testo">{children}</p>
      </div>
    </div>
  )
}

const ESEMPIO_API = `{
  "version": 1,
  "categories": [
    {
      "id": 17,
      "name_en": "Pure Saiyans",
      "name_ja": "純粋サイヤ人",
      "aliases": ["ps", "pure", "saiyan"]
    }
  ]
}`

export default function CategoryHelper() {
  const icona = { size: 18, weight: 'regular', 'aria-hidden': true } as const
  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <div className="grid gap-y-10 lg:grid-cols-[minmax(0,1fr)_17rem] lg:gap-x-14">
        <header className="min-w-0 max-w-[68ch]">
          <h1 className="text-2xl font-semibold tracking-tight text-inchiostro">{CATEGORY_HELPER.nome}</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-testo">
            An Android helper for Dokkan Battle JP. Type a category name in English, pick it, and the Japanese
            name goes straight into the game&apos;s category search, or onto your clipboard.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
            <a
              href={CATEGORY_HELPER.apk}
              type="application/vnd.android.package-archive"
              className="inline-flex items-center gap-2 whitespace-nowrap px-4 py-2 text-[14px] font-medium rounded-[var(--raggio)] bg-inchiostro text-sfondo hover:opacity-90 transition-opacity active:scale-[0.98]"
            >
              <DownloadSimple size={17} weight="bold" aria-hidden />
              Download APK
            </a>
            <a href={CATEGORY_HELPER.release} className={`inline-flex items-center gap-1.5 text-[13px] text-testo ${link}`}>
              All releases on GitHub
              <ArrowSquareOut size={13} weight="bold" aria-hidden />
            </a>
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-tenue">
            Free and unofficial. It is not on Google Play: the APK comes from the GitHub releases of this site.
          </p>
        </header>

        <section aria-labelledby="requirements" className="min-w-0 lg:self-start">
          <h2 id="requirements" className={titolo}>Requirements</h2>
          <dl className="mt-3 border border-linea rounded-[var(--raggio)] bg-superficie divide-y divide-linea text-[13px]">
            {[
              ['Android', `${CATEGORY_HELPER.android} or newer`],
              ['Game', 'Dokkan Battle JP, the Japanese version'],
              ['Account', 'None'],
              ['Price', 'Free, no ads'],
            ].map(([k, v]) => (
              <div key={k} className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 px-4 py-2.5">
                <dt className="text-tenue">{k}</dt>
                <dd className="text-inchiostro">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-[12px] leading-relaxed text-tenue">
            The Global version is already in English, so the bubble stays out of it.
          </p>
        </section>

        <div className="min-w-0 max-w-[68ch] space-y-12">
          <Sezione id="what-it-does" nome="What it does">
            <p className="mt-2 text-[14px] leading-relaxed text-testo">
              In Dokkan Battle JP you filter cards by category, and the category search field expects the Japanese
              name. The app keeps an English to Japanese dictionary of every category, and you search it in English
              right on top of the game: by full name, part of it or a short alias.
            </p>
            <div className="mt-4 overflow-x-auto border border-linea rounded-[var(--raggio)] bg-superficie">
              <table className="w-full text-left text-[13px]">
                <caption className="sr-only">Examples: what you type and what the app writes in the game</caption>
                <thead className="text-[12px] text-tenue">
                  <tr className="border-b border-linea">
                    <th scope="col" className="px-3 py-2 font-medium">You type</th>
                    <th scope="col" className="px-3 py-2 font-medium">Category</th>
                    <th scope="col" className="px-3 py-2 font-medium">In the game</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-linea">
                  {ESEMPI.map((e) => (
                    <tr key={e.scrivi}>
                      <td className="px-3 py-2 align-top"><code className={codice}>{e.scrivi}</code></td>
                      <td className="px-3 py-2 align-top text-inchiostro">{e.en}</td>
                      <td className="px-3 py-2 align-top text-inchiostro" lang="ja">{e.ja}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Sezione>

          <Sezione id="install" nome="Install">
            <ol className="mt-1 divide-y divide-linea">
              <Passo n={1} azione="Download and install the APK">
                <p>
                  On your phone, tap Download APK above and open the file. If Android asks, allow your browser or
                  file manager to install unknown apps, then tap Install. On your home screen its icon reads
                  Category Helper.
                </p>
                <p>Google Play Protect may show a warning, because the app does not come from Google Play.</p>
              </Passo>
              <Passo n={2} azione="Turn on the accessibility service">
                <p>
                  Open Settings, Accessibility, then Downloaded apps (on some phones Installed apps or Installed
                  services). Tap DokkanTS Category Helper, turn it on and confirm. In the app, Open accessibility
                  settings takes you there.
                </p>
              </Passo>
              <Passo n={3} azione="Android 13 and newer: allow restricted settings">
                <p>
                  If the switch is grayed out or Android says the setting is restricted, open the app&apos;s App
                  info, tap the three-dot menu at the top right and choose Allow restricted settings. Then turn the
                  service on again.
                </p>
              </Passo>
              <Passo n={4} azione="Check that it is on">
                <p>
                  Back in the app, Accessibility service says On. On some phones, for example with
                  ColorOS or OxygenOS, also turn off battery optimization for the app, or the system may stop the
                  service.
                </p>
              </Passo>
            </ol>
          </Sezione>

          <Sezione id="how-to-use" nome="How to use it">
            <div className="mt-4 grid gap-x-8 gap-y-6 sm:grid-cols-2">
              <Uso icona={<HandTap {...icona} />} nome="The bubble">
                It appears only while Dokkan Battle JP is open, and goes away when you leave the game. Drag it
                anywhere: it snaps to the nearest edge and stays there. Size and opacity are in the app settings.
              </Uso>
              <Uso icona={<MagnifyingGlass {...icona} />} nome="Search">
                Tap the bubble and type in English: a name, part of it or an alias like{' '}
                <code className={codice}>ssj3</code>, <code className={codice}>tb</code> or{' '}
                <code className={codice}>u7</code>. Small typos still match, and Enter picks the first result.
              </Uso>
              <Uso icona={<ClipboardText {...icona} />} nome="Insert">
                With Insertion set to Automatic, the default, tap the game&apos;s category search field within 30
                seconds and the Japanese name is typed in (if the field was already open, it goes in right away).
                With Clipboard only, you paste it yourself. The name is on the clipboard either way.
              </Uso>
              <Uso icona={<Heart {...icona} />} nome="Favorites and recents">
                With an empty search, the panel shows your favorites (tap the heart on a row), your last 10 picks
                and every category from A to Z.
              </Uso>
              <Uso icona={<BookOpenText {...icona} />} nome="Your dictionary">
                The app comes with the 99 categories of the game as of October 2026. In the dictionary editor you
                can add, edit and delete categories, and import or export them as JSON.
              </Uso>
              <Uso icona={<ArrowsClockwise {...icona} />} nome="Check for updates">
                Downloads the new categories from Dokkan Team Sharing and adds the ones you do not have yet.
                Nothing you already have changes, edits included, and a category you deleted is not added back.
                The app also checks by itself when you open Dokkan, at most once a day or an hour after a check
                that failed, and tells you only when it adds something. To stop that, turn off Check for updates
                automatically in the app settings.
              </Uso>
            </div>
          </Sezione>

          <Sezione id="developers" nome="For developers">
            <p className="mt-2 text-[14px] leading-relaxed text-testo">
              The app updates from <code className={codice}>GET {CATEGORY_HELPER.api}</code>, a public JSON list of
              every category, with no key. It comes from the game data of the Global version and changes at most
              once a week, after the weekly data update.
            </p>
            <pre className="mt-3 max-w-full overflow-x-auto border border-linea rounded-[var(--raggio)] bg-superficie px-4 py-3 font-mono text-[12px] leading-relaxed text-inchiostro">
              <code>{ESEMPIO_API}</code>
            </pre>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-testo">
              <li>The list is ordered by <code className={codice}>id</code>, the category id in the game.</li>
              <li><code className={codice}>name_ja</code> is null until the Japanese name is known.</li>
              <li>
                <code className={codice}>aliases</code> are lowercase and sorted: the initials of multi-word names
                and a few nicknames.
              </li>
              <li><code className={codice}>version</code> is the version of the format, not of the data.</li>
            </ul>
          </Sezione>
        </div>

        <div className="min-w-0 max-w-[68ch] space-y-10 lg:self-start">
          <Sezione id="privacy" nome="Privacy">
            <ul className="mt-2 space-y-2 text-[13px] leading-relaxed text-testo">
              <li>
                No account, no ads, no analytics. Your dictionary, favorites, recent picks and settings stay on your
                phone. Android can also keep them in your phone&apos;s backup and copy them to a new phone, so they
                come back. The site never receives them.
              </li>
              <li>
                The accessibility service only reads which app is on screen and, inside Dokkan Battle, the search
                field that has focus. It types only the category you pick, once, into the game&apos;s search field,
                and never taps anything for you.
              </li>
              <li>
                The app goes online only to download the list from{' '}
                <code className={`${codice} [overflow-wrap:anywhere]`}>{LEGALE.sito}{CATEGORY_HELPER.api}</code>: when you open
                Dokkan, at most once a day or an hour after a check that failed (you can turn this off in the app
                settings), and when you tap Check for updates. The request is the same either way and carries no
                account, no device id and nothing from your dictionary, like opening a page of this site without
                signing in.
              </li>
            </ul>
          </Sezione>
          <Sezione id="unofficial" nome="Unofficial">
            <p className="mt-2 text-[13px] leading-relaxed text-testo">
              DokkanTS Category Helper is a fan-made tool. It is not affiliated with, endorsed or approved by Bandai
              Namco Entertainment or Akatsuki. It is not on Google Play: you install it yourself, and you use it at
              your own risk.
            </p>
          </Sezione>
        </div>
      </div>
    </div>
  )
}
