import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight, CaretRight } from '@phosphor-icons/react/dist/ssr'
import { assetUrl } from '@/lib/db'
import { soloGiorno } from '@/lib/date'
import { eventHref } from '@/lib/urls'
import { relRobots } from '@/lib/robots'
import { CorniceCarta, SegnapostoCarta } from '@/components/segnaposto'
import type { MissionRow } from '@/lib/queries'

const numero = new Intl.NumberFormat('en-US')

// Oltre questa soglia la lista parte chiusa: c'è un evento con 462 missioni,
// e aperta spingerebbe tutto il resto della pagina in fondo.
const APERTA_FINO_A = 12

/** L'ancora della sezione, per il link dalle viste di un tier. */
export const ANCORA_MISSIONI = 'missions'

/** Le missioni della ricorrenza mostrata, con i premi come li dà il gioco. */
export function Missioni({ missioni }: { missioni: MissionRow[] }) {
  if (!missioni.length) return null
  return (
    <section id={ANCORA_MISSIONI} aria-labelledby="titolo-missioni" className="mt-12 scroll-mt-6">
      <details open={missioni.length <= APERTA_FINO_A} className="group">
        {/* summary con dentro un titolo: lo permette l'HTML, e così la sezione
            resta nella navigazione per titoli anche quando è chiusa */}
        <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden inline-flex items-baseline gap-2">
          <CaretRight
            size={12}
            weight="bold"
            aria-hidden
            className="self-center text-tenue transition-transform group-open:rotate-90"
          />
          <h2 id="titolo-missioni" className="text-[15px] font-semibold text-inchiostro">Missions</h2>
          <span className="numeri text-[12px] text-tenue">{missioni.length}</span>
        </summary>

        <ol className="mt-3 border border-linea rounded-[var(--raggio)] bg-superficie">
          {missioni.map((m) => (
            <li key={m.id} className="px-4 py-3 border-b border-linea last:border-b-0">
              <p className="text-[13px] font-medium text-inchiostro leading-snug">{m.name ?? m.description}</p>
              {m.name && (
                <p className="mt-0.5 text-[12px] text-testo leading-relaxed max-w-[80ch] whitespace-pre-line">
                  {m.description}
                </p>
              )}
              {(m.rewards.length > 0 || m.ends_at) && (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-testo">
                  {m.rewards.map((r, i) => {
                    const icona = assetUrl(r.icon_key)
                    return (
                      <span key={i} className="inline-flex items-center gap-1">
                        {icona && r.icon_bare ? (
                          // la miniatura di una carta che e' il solo
                          // personaggio: il bordo del tipo, di un px
                          <CorniceCarta type={r.card?.type} size={16}>
                            <Image src={icona} alt="" width={16} height={16} className="rounded-[2px]" />
                          </CorniceCarta>
                        ) : icona ? (
                          <Image src={icona} alt="" width={16} height={16} className="rounded-[2px]" />
                        ) : r.card && (
                          // una carta senza miniatura: la sola banda del tipo,
                          // il nome e' scritto accanto. Gli altri premi senza
                          // icona restano solo testo.
                          <SegnapostoCarta name={r.name} type={r.card.type} size={16} />
                        )}
                        {r.name}
                        <span className="numeri text-tenue">x{numero.format(r.quantity)}</span>
                      </span>
                    )
                  })}
                  {m.ends_at && <span className="text-tenue">until {soloGiorno(m.ends_at)}</span>}
                </div>
              )}
            </li>
          ))}
        </ol>
      </details>
    </section>
  )
}

/**
 * Al posto delle missioni, sulle viste di un tier: sono le stesse
 * dell'evento, e ripeterle su ogni tier pesava piu' del resto della pagina
 * in cache. Il link porta alla loro sezione nella pagina dell'evento, con
 * la versione esplicita (le missioni ci sono solo su Global, e chi ha
 * scelto Japan non va rimandato alla pagina giapponese). Lo stesso titolo
 * e lo stesso numero della sezione, come link; niente prefetch.
 */
export function LinkMissioni({ eventId, n }: { eventId: string; n: number }) {
  if (!n) return null
  const href = `${eventHref({ id: eventId, explicit: true })}#${ANCORA_MISSIONI}`
  return (
    <p className="mt-10">
      <Link
        href={href}
        rel={relRobots(href)}
        prefetch={false}
        className="group inline-flex items-baseline gap-2"
      >
        <span className="text-[13px] font-medium text-inchiostro underline decoration-oro-linea underline-offset-2 group-hover:decoration-oro">
          Missions
        </span>
        <span className="numeri text-[12px] text-tenue">{numero.format(n)}</span>
        <span className="sr-only">, on the event page</span>
        <ArrowRight size={12} weight="bold" aria-hidden className="self-center text-tenue group-hover:text-inchiostro transition-colors" />
      </Link>
    </p>
  )
}
