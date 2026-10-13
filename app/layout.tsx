import type { Metadata, Viewport } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { Geist, Geist_Mono } from 'next/font/google'
import { UserMenu } from '@/components/auth/user-menu'
import { LinkEventi } from '@/components/versione/link-eventi'
import { SceltaVersione } from '@/components/versione/scelta-versione'
import { SeguiVersione } from '@/components/versione/segui-versione'
import { ViewerProvider } from '@/components/viewer/provider'
import { SceltaTemaFooter } from '@/components/tema/scelta-tema-footer'
import { Marchio } from '@/components/brand/marchio'
import { InvitoInstalla } from '@/components/pwa/invito-installa'
import { readAuthEnv } from '@/lib/auth/env'
import { BARRA_SISTEMA, scriptTema } from '@/lib/tema/temi'
import { scriptVersione } from '@/lib/versione/versione'
import './globals.css'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  // og:image e twitter:image devono essere URL assoluti sul dominio vero,
  // senza contare sul fallback di Vercel (VERCEL_PROJECT_PRODUCTION_URL).
  metadataBase: new URL(readAuthEnv().baseURL),
  title: { default: 'Dokkan Team Sharing', template: '%s · Dokkan Team Sharing' },
  description:
    'For every Dokkan Battle event, the teams that actually cleared it, with their rotations and proof.',
  // L'app aggiunta alla Home di iOS: il nome sotto l'icona (iOS lo accorcia
  // se non ci sta) e la barra di stato. L'icona e' app/apple-icon.png, il
  // manifest e' app/manifest.ts.
  appleWebApp: { title: 'Dokkan Team Sharing', statusBarStyle: 'default' },
}

// La barra del browser mobile con System. Con un tema scelto lo script del
// <head> mette davanti un theme-color suo, che vince su questi due.
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: BARRA_SISTEMA.light },
    { media: '(prefers-color-scheme: dark)', color: BARRA_SISTEMA.dark },
  ],
}

// Calcolato una volta: e' lo stesso testo per tutti, quindi l'HTML resta
// uguale e in cache. Il tema (localStorage) e la versione del sito (il
// cookie dts_version, lib/versione): due attributi di <html>, data-theme e
// data-reg, prima del primo paint.
const SCRIPT_TESTA = `${scriptTema()};${scriptVersione()}`

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    // suppressHydrationWarning: lo script qui sotto aggiunge data-theme e
    // data-reg a <html> prima che React idrati, e gli attributi non sono
    // nell'HTML del server.
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full`}
      suppressHydrationWarning
    >
      <head>
        {/* Sincrono, prima del primo paint (non next/script, che e' asincrono):
            il tema salvato e la versione si applicano senza lampi. */}
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TESTA }} />
      </head>
      <body className="font-sans min-h-full flex flex-col">
        {/* Chi guarda lo sa solo il browser (/api/me): il layout e le pagine
            pubbliche restano uguali per tutti, e quindi in cache. */}
        <ViewerProvider>
        {/* relative: il pannello del burger (MenuMobile) si apre sotto, largo quanto l'header */}
        <header className="relative border-b border-linea bg-superficie">
          <div className="mx-auto max-w-6xl px-5 h-14 flex items-center gap-3 lg:gap-6">
            {/* Il nome intero anche sul telefono: le voci li' vanno nel burger.
                truncate solo come rete sotto i 320px. I due link agli eventi
                portano alla home della versione scelta (lib/versione), dopo
                l'idratazione: nell'HTML sono /events per tutti. */}
            <LinkEventi className="flex min-w-0 items-center gap-2 font-semibold tracking-tight text-inchiostro whitespace-nowrap">
              <Marchio className="size-6 shrink-0" />
              <span className="truncate">Dokkan Team Sharing</span>
            </LinkEventi>
            <nav className="text-sm max-lg:hidden">
              <LinkEventi className="text-tenue hover:text-inchiostro transition-colors">
                Events
              </LinkEventi>
            </nav>
            {/* La versione del sito (lib/versione), dai 1024px e per tutti:
                accanto a Events, i cui link la seguono. Qui a sinistra niente
                prima di lei cambia larghezza (le voci di destra arrivano da
                /api/me), quindi non si sposta mai. Sotto i 1024px e' nel burger. */}
            <div className="max-lg:hidden">
              <SceltaVersione variante="riga" />
            </div>
            <div className="ml-auto shrink-0">
              <UserMenu />
            </div>
          </div>
        </header>

        <main className="flex-1">{children}</main>

        <footer className="border-t border-linea bg-superficie mt-16">
          <div className="mx-auto max-w-6xl px-5 py-8 text-xs leading-relaxed text-tenue space-y-3">
            <p>
              Card and event data from the{' '}
              <a
                href="https://dbz-dokkanbattle.fandom.com"
                className="underline decoration-oro-linea underline-offset-2 hover:text-inchiostro"
              >
                Dragon Ball Z Dokkan Battle Wiki
              </a>{' '}
              on Fandom, licensed under CC BY-SA.
            </p>
            <p>
              DRAGON BALL Z Dokkan Battle © BIRD STUDIO / SHUEISHA, TOEI ANIMATION. © BANDAI NAMCO
              Entertainment Inc. Developed by Akatsuki Inc. This is an informational fan site and is
              not affiliated with, endorsed, sponsored or approved by any of the parties above.
            </p>
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <nav aria-label="Legal" className="flex gap-4">
              <Link href="/privacy" className="underline decoration-oro-linea underline-offset-2 hover:text-inchiostro">
                Privacy Policy
              </Link>
              <Link href="/terms" className="underline decoration-oro-linea underline-offset-2 hover:text-inchiostro">
                Terms of Service
              </Link>
            </nav>
            {/* Un'isola client: l'HTML del server e' lo stesso per tutti. */}
            <SceltaTemaFooter />
            </div>
          </div>
        </footer>
        {/* Un'isola: solo su telefoni e tablet, mai nell'HTML del server. */}
        <InvitoInstalla />
        {/* La versione del sito dopo ogni navigazione, e la sua regione live:
            legge la query, quindi sta in un <Suspense> (nell'HTML in cache non c'e'). */}
        <Suspense fallback={null}>
          <SeguiVersione />
        </Suspense>
        </ViewerProvider>
      </body>
    </html>
  )
}
