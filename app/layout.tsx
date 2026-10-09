import type { Metadata, Viewport } from 'next'
import Link from 'next/link'
import { Geist, Geist_Mono } from 'next/font/google'
import { UserMenu } from '@/components/auth/user-menu'
import { ViewerProvider } from '@/components/viewer/provider'
import { SceltaTemaFooter } from '@/components/tema/scelta-tema-footer'
import { Marchio } from '@/components/brand/marchio'
import { readAuthEnv } from '@/lib/auth/env'
import { BARRA_SISTEMA, scriptTema } from '@/lib/tema/temi'
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
// uguale e in cache.
const SCRIPT_TEMA = scriptTema()

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    // suppressHydrationWarning: lo script qui sotto aggiunge data-theme a
    // <html> prima che React idrati, e l'attributo non e' nell'HTML del server.
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full`}
      suppressHydrationWarning
    >
      <head>
        {/* Sincrono, prima del primo paint (non next/script, che e' asincrono):
            il tema salvato si applica senza lampi. */}
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
      </head>
      <body className="font-sans min-h-full flex flex-col">
        {/* Chi guarda lo sa solo il browser (/api/me): il layout e le pagine
            pubbliche restano uguali per tutti, e quindi in cache. */}
        <ViewerProvider>
        <header className="border-b border-linea bg-superficie">
          <div className="mx-auto max-w-6xl px-5 h-14 flex items-center gap-6">
            <Link href="/events" className="flex items-center gap-2 font-semibold tracking-tight text-inchiostro whitespace-nowrap">
              <Marchio className="size-6 shrink-0" />
              {/* Sotto i 640px il nome intero va su due righe accanto al menu:
                  si vede "dokkants", e il nome resta per i lettori di schermo */}
              <span className="max-sm:sr-only">Dokkan Team Sharing</span>
              <span aria-hidden="true" className="sm:hidden font-mono font-medium">dokkants</span>
            </Link>
            <nav className="text-sm">
              <Link href="/events" className="text-tenue hover:text-inchiostro transition-colors">
                Events
              </Link>
            </nav>
            <div className="ml-auto">
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
        </ViewerProvider>
      </body>
    </html>
  )
}
