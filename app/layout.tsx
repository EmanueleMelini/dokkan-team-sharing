import type { Metadata } from 'next'
import Link from 'next/link'
import { Geist, Geist_Mono } from 'next/font/google'
import { UserMenu } from '@/components/auth/user-menu'
import { ViewerProvider } from '@/components/viewer/provider'
import './globals.css'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: { default: 'Dokkan Team Sharing', template: '%s · Dokkan Team Sharing' },
  description:
    'For every Dokkan Battle event, the teams that actually cleared it, with their rotations and proof.',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full`}>
      <body className="font-sans min-h-full flex flex-col">
        {/* Chi guarda lo sa solo il browser (/api/me): il layout e le pagine
            pubbliche restano uguali per tutti, e quindi in cache. */}
        <ViewerProvider>
        <header className="border-b border-linea bg-superficie">
          <div className="mx-auto max-w-6xl px-5 h-14 flex items-center gap-6">
            <Link href="/events" className="font-semibold tracking-tight text-inchiostro">
              Dokkan Team Sharing
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
            <nav aria-label="Legal" className="flex gap-4">
              <Link href="/privacy" className="underline decoration-oro-linea underline-offset-2 hover:text-inchiostro">
                Privacy Policy
              </Link>
              <Link href="/terms" className="underline decoration-oro-linea underline-offset-2 hover:text-inchiostro">
                Terms of Service
              </Link>
            </nav>
          </div>
        </footer>
        </ViewerProvider>
      </body>
    </html>
  )
}
