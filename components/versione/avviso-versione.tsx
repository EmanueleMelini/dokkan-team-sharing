import Link from 'next/link'
import { ArrowRight, Globe } from '@phosphor-icons/react/dist/ssr'
import { UsaVersione } from '@/components/versione/usa-versione'
import { avvisoVersione } from '@/lib/versione/interruttore'
import { relRobots } from '@/lib/robots'
import type { Versione } from '@/lib/versione/versione'

/**
 * L'avviso su una pagina della versione reg per chi ha scelto l'altra: "This
 * is the Japan version. Your site is set to Global.", il link alla stessa
 * pagina nell'altra versione e "Use Japan everywhere". Statico e uguale per
 * tutti (la pagina resta in cache): lo mostra o lo nasconde solo il CSS,
 * dall'attributo data-reg (lib/versione/interruttore.ts avvisoVersione).
 *
 * Come il banner della sospensione: l'icona, la frase con la parte che
 * conta in inchiostro, e sotto le due strade. Il link porta altrove (un
 * link, con la freccia); "Use ... everywhere" cambia la scelta del sito
 * (un bottone).
 *
 * altra: la pagina gemella (gemello() o browseHref). Su una pagina Japan e'
 * l'URL Global senza marca: l'avviso lo vede solo chi e' su Global, che
 * non viene rimandato. Su una pagina Global e' il percorso /japan, marcato,
 * e nofollow: robots.txt esclude le pagine Japan degli eventi (lib/robots.ts),
 * e questo link e' nell'HTML di ogni pagina Global.
 */
export function AvvisoVersione({ reg, altra, className = '' }: { reg: Versione; altra: string | null; className?: string }) {
  const a = avvisoVersione(reg)
  return (
    <div
      data-avviso-versione={reg}
      className={`${a.classe} ${className} max-w-xl rounded-[var(--raggio)] border border-oro-linea bg-oro-tenue px-3 py-2.5`}
    >
      <div className="flex items-start gap-2.5">
        <Globe size={15} weight="bold" aria-hidden className="mt-0.5 shrink-0 text-oro" />
        <div className="min-w-0 text-[12px] leading-relaxed text-testo">
          <p>
            <span className="font-medium text-inchiostro">{a.titolo}</span> {a.dettaglio}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
            {altra && (
              <Link
                href={altra}
                rel={relRobots(altra)}
                prefetch={false}
                className="inline-flex items-center gap-1 font-medium text-inchiostro underline decoration-oro-linea underline-offset-2 hover:decoration-oro"
              >
                {a.link}
                <ArrowRight size={12} weight="bold" aria-hidden />
              </Link>
            )}
            <UsaVersione v={reg}>{a.usa}</UsaVersione>
          </div>
        </div>
      </div>
    </div>
  )
}
