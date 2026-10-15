import Link from 'next/link'
import Form from 'next/form'
import { Suspense } from 'react'
import Image from 'next/image'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/ssr'
import { assetUrl } from '@/lib/db'
import { giornoBreve } from '@/lib/date'
import { pagina as leggiPagina, regione, testoRicerca, uno, type Ricerca } from '@/lib/parametri'
import { EVENTI_PER_PAGINA, type EventKind, type EventRow, type Region, type Status } from '@/lib/queries'
import { listEventsCached } from '@/lib/cache/data'
import { browseHref, eventHref } from '@/lib/urls'
import { relRobots } from '@/lib/robots'
import { AttesaLink } from '@/components/attesa-link'
import { ConteggioClear } from '@/components/conteggio-clear'
import { Paginazione } from '@/components/paginazione'
import { AvvisoAccountCancellato } from '@/components/eventi/avviso-cancellato'
import { CorniceCarta, SegnapostoEvento } from '@/components/segnaposto'
import { CAMPO_DITO } from '@/components/scelta/stile'
import { AvvisoVersione } from '@/components/versione/avviso-versione'
import { segnapostoEvento } from '@/lib/segnaposto'
import { altraVersione } from '@/lib/versione/versione'

// La lista degli eventi, comune a /events e /events/japan (statiche: una
// versione, nessun filtro, pagina 1) e a /events/browse (ogni vista
// filtrata, dinamica e noindex). Legge solo dati in cache e mai la
// sessione. La versione non e' piu' un filtro della lista: la sceglie
// l'interruttore del sito (lib/versione), e chi guarda l'altra lo legge
// nell'avviso.

const TIPI: { valore: EventKind; etichetta: string }[] = [
  { valore: 'zbattle', etichetta: 'Extreme Z-Battle' },
  { valore: 'challenge', etichetta: 'Challenge' },
  { valore: 'story', etichetta: 'Story' },
  { valore: 'limited', etichetta: 'Limited' },
  { valore: 'bonus', etichetta: 'Bonus' },
]

// Le stesse parole della pagina dell'evento: Ongoing, Ended, Upcoming.
const STATI: { valore: Status; etichetta: string; vuoto: string }[] = [
  { valore: 'active', etichetta: 'Ongoing', vuoto: 'No event is listed as ongoing' },
  { valore: 'past', etichetta: 'Ended', vuoto: 'No event is listed as ended' },
  { valore: 'upcoming', etichetta: 'Upcoming', vuoto: 'No event is listed as upcoming' },
]

// Lo stato in breve sulla scheda. Niente per la fine sconosciuta: sarebbe
// la maggioranza, e ripeterlo su ogni scheda non dice niente.
function statoBreve(e: EventRow): { testo: string; inCorso: boolean } | null {
  if (e.status === 'active') {
    if (e.ends_at) return { testo: `Ends ${giornoBreve(e.ends_at)}`, inCorso: true }
    return e.ends_at_known ? { testo: 'Permanent', inCorso: false } : null
  }
  if (e.status === 'upcoming') return { testo: `Starts ${giornoBreve(e.starts_at)}`, inCorso: false }
  return { testo: 'Ended', inCorso: false }
}

function Filtro({
  attivo, href, children,
}: { attivo: boolean; href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      rel={relRobots(href)}
      prefetch={false}
      aria-current={attivo ? 'page' : undefined}
      className={`relative px-2.5 py-1 text-[13px] rounded-[var(--raggio)] border transition-colors ${
        attivo
          ? 'bg-inchiostro text-sfondo border-inchiostro font-medium'
          : 'bg-superficie text-testo border-linea hover:border-linea-forte'
      }`}
    >
      {children}
      <AttesaLink />
    </Link>
  )
}

// role=group con l'etichetta della riga: senza, i due link "All" (tipo
// e stato) hanno lo stesso nome e niente che li distingua.
function RigaFiltri({ id, etichetta, children }: { id: string; etichetta: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-labelledby={id} className="flex flex-wrap items-center gap-1.5">
      <span id={id} className="text-[11px] text-tenue w-16 shrink-0">{etichetta}</span>
      {children}
    </div>
  )
}


export type FiltriLista = {
  reg: Region
  kind: EventKind | null
  status: Status | null
  search: string | null
  pagina: number
}

export const FILTRI_BASE: FiltriLista = { reg: 'global', kind: null, status: null, search: null, pagina: 1 }

/** I parametri di /events/browse ridotti a filtri che le query sanno trattare. */
export function leggiFiltri(sp: Ricerca): FiltriLista {
  return {
    reg: regione(sp),
    kind: TIPI.find((t) => t.valore === uno(sp.type))?.valore ?? null,
    status: STATI.find((s) => s.valore === uno(sp.status))?.valore ?? null,
    search: testoRicerca(sp),
    pagina: leggiPagina(sp),
  }
}

export async function EventList({ filtri }: { filtri: FiltriLista }) {
  const { reg, kind, status, search, pagina } = filtri
  const stato = STATI.find((s) => s.valore === status) ?? null
  const eventi = await listEventsCached({
    reg, kind, status, search, offset: (pagina - 1) * EVENTI_PER_PAGINA,
  })
  // Il totale viaggia dentro le righe: oltre l'ultima pagina non ci sono
  // righe e il totale si perde. Solo in quel caso costa una query in più.
  const totale =
    eventi[0]?.total ??
    (pagina > 1 ? ((await listEventsCached({ reg, kind, status, search, offset: 0, limit: 1 }))[0]?.total ?? 0) : 0)
  const da = (pagina - 1) * EVENTI_PER_PAGINA + 1
  const a = da + eventi.length - 1
  const ultima = Math.max(1, Math.ceil(totale / EVENTI_PER_PAGINA))
  const fuoriRange = eventi.length === 0 && pagina > ultima

  // Le stesse chiavi della vecchia query string: le traduce browseHref
  type Patch = { region?: string | null; type?: EventKind | null; status?: Status | null; q?: string | null; page?: string | null }
  const query = (patch: Patch) => {
    const v = { region: reg as string | null, type: kind, status, q: search, page: null as string | null, ...patch }
    return browseHref({
      reg: v.region === 'japan' ? 'japan' : 'global',
      kind: v.type ?? null,
      status: v.status ?? null,
      search: v.q ?? null,
      page: v.page ? Number(v.page) : 1,
    })
  }

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      {reg === 'japan' && <p className="mb-1 text-[12px] text-tenue">Japan version</p>}
      <h1 className="text-2xl font-semibold tracking-tight text-inchiostro">Events</h1>
      <p className="mt-1.5 text-sm text-testo max-w-[65ch]">
        Pick an event to see its stages and the teams that cleared them.
      </p>
      {/* Per chi ha scelto l'altra versione, solo col CSS: la stessa vista di la' */}
      <AvvisoVersione reg={reg} altra={query({ region: altraVersione(reg) })} className="mt-4" />
      {/* Dopo la cancellazione dell'account (Settings): un'isola client,
          perche' la pagina e' statica e non legge ne' la query ne' la sessione. */}
      <Suspense fallback={null}>
        <AvvisoAccountCancellato />
      </Suspense>

      <div className="mt-7 space-y-3">
        <RigaFiltri id="filtro-tipo" etichetta="Type">
          <Filtro attivo={!kind} href={query({ type: null })}>All</Filtro>
          {TIPI.map((t) => (
            <Filtro key={t.valore} attivo={kind === t.valore} href={query({ type: t.valore })}>
              {t.etichetta}
            </Filtro>
          ))}
        </RigaFiltri>

        <RigaFiltri id="filtro-stato" etichetta="Status">
          <Filtro attivo={!status} href={query({ status: null })}>All</Filtro>
          {STATI.map((s) => (
            <Filtro key={s.valore} attivo={status === s.valore} href={query({ status: s.valore })}>
              {s.etichetta}
            </Filtro>
          ))}
        </RigaFiltri>

        {/*
         * next/form: la ricerca naviga lato client come i filtri, invece di
         * ricaricare tutto il documento. La key rimonta il form quando
         * cambiano i filtri: altrimenti il campo, che non è controllato,
         * terrebbe il testo di una ricerca già tolta.
         */}
        <Form
          key={`${reg}|${kind}|${status}|${search}`}
          action="/events/browse"
          className="flex items-center gap-2 pt-1"
        >
          {reg === 'japan' && <input type="hidden" name="region" value={reg} />}
          {kind && <input type="hidden" name="type" value={kind} />}
          {status && <input type="hidden" name="status" value={status} />}
          <label htmlFor="q" className="text-[11px] text-tenue w-16 shrink-0">
            Search
          </label>
          <div className="relative flex-1 max-w-md">
            <MagnifyingGlass
              size={15}
              weight="bold"
              aria-hidden
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-tenue pointer-events-none"
            />
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={search ?? ''}
              placeholder="event name"
              maxLength={100}
              // il modello dei menu a scelta, anche col dito (CAMPO_DITO)
              className={`w-full pl-8 pr-3 py-1.5 text-[13px] rounded-[var(--raggio)] bg-superficie border border-campo text-inchiostro placeholder:text-tenue ${CAMPO_DITO}`}
            />
          </div>
        </Form>
      </div>

      {/* Global ha le finestre del gioco; Japan solo la data di prima uscita
          dal wiki. L'avviso dice quanto ci si può fidare dello stato. */}
      {status && (
        <p className="mt-6 text-[12px] leading-relaxed text-testo bg-oro-tenue border border-oro-linea rounded-[var(--raggio)] px-3 py-2 max-w-[70ch]">
          {reg === 'global'
            ? 'Global dates come from the game’s own data wherever we can match the event. When the game doesn’t record an end, the event is listed as ongoing, so Ongoing also includes some events that may have closed.'
            : 'Japan dates come from the wiki, which records when an event first came out but not when it ends, so almost every Japan event shows as ongoing and nothing shows as ended.'}
        </p>
      )}

      <p className="mt-6 text-[12px] text-tenue">
        {eventi.length > 0 && totale > eventi.length ? (
          <>
            <span className="numeri">{da}-{a}</span> of <span className="numeri">{totale}</span> events
          </>
        ) : (
          <>
            <span className="numeri">{totale}</span> event{totale === 1 ? '' : 's'}
          </>
        )}
      </p>

      {eventi.length === 0 ? (
        <div className="mt-4 border border-linea rounded-[var(--raggio)] bg-superficie px-6 py-12 text-center">
          {fuoriRange ? (
            <>
              <p className="text-sm font-medium text-inchiostro">This page doesn’t exist</p>
              <p className="mt-1.5 text-[13px] text-testo max-w-[48ch] mx-auto">
                Results for these filters end at page {ultima}.
              </p>
              <AzioneVuoto href={query({})}>Go to the first page</AzioneVuoto>
            </>
          ) : stato && stato.valore !== 'active' ? (
            // Il motivo è già scritto nell'avviso qui sopra: ripeterlo, o
            // dare la colpa ai filtri, sarebbe falso.
            <>
              <p className="text-sm font-medium text-inchiostro">{stato.vuoto}</p>
              <AzioneVuoto href={query({ status: null })}>Show all events</AzioneVuoto>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-inchiostro">No events match these filters</p>
              <p className="mt-1.5 text-[13px] text-testo max-w-[48ch] mx-auto">
                Try removing the search, or choose All for type and status.
              </p>
              <AzioneVuoto href={query({ type: null, status: null, q: null })}>Clear filters</AzioneVuoto>
            </>
          )}
        </div>
      ) : (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {eventi.map((e, i) => {
            const banner = assetUrl(e.banner_key)
            const copertina = assetUrl(e.cover_thumb_key)
            const st = statoBreve(e)
            return (
              <li key={e.id}>
                <Link
                  href={eventHref({ id: e.id, reg })}
                  // 60 schede per pagina: il prefetch di ognuna costerebbe un
                  // render sul server per ogni evento non ancora in cache.
                  prefetch={false}
                  // sulla lista Japan le pagine /japan, fuori da robots.txt
                  rel={relRobots(eventHref({ id: e.id, reg }))}
                  className="group relative block h-full border border-linea rounded-[var(--raggio)] bg-superficie overflow-hidden hover:border-linea-forte transition-colors"
                >
                  <div className="relative aspect-[16/7] bg-superficie-2 flex items-center justify-center">
                    {banner ? (
                      <Image
                        src={banner}
                        alt=""
                        fill
                        // La prima riga è l'elemento più grande sopra la piega
                        // (LCP): caricata subito, le altre quando servono.
                        loading={i < 3 ? 'eager' : undefined}
                        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                        className="object-cover"
                      />
                    ) : (
                      // Senza banner (gli eventi presi dal gioco non lo hanno):
                      // la carta del boss, se la conosciamo, altrimenti l'icona
                      // del tipo; sotto, il tipo di evento scritto.
                      <div className="flex flex-col items-center gap-1.5">
                        {copertina && e.cover_thumb_bare ? (
                          // il boss e' il solo personaggio: la cornice disegnata
                          <CorniceCarta type={e.cover_type} rarity={e.cover_rarity} size={56}>
                            <Image src={copertina} alt="" width={56} height={56} className="rounded-[var(--raggio)]" />
                          </CorniceCarta>
                        ) : copertina ? (
                          <Image src={copertina} alt="" width={56} height={56} className="rounded-[var(--raggio)]" />
                        ) : (
                          <SegnapostoEvento kind={e.kind} misura="scheda" />
                        )}
                        <span className="text-[11px] text-tenue">{segnapostoEvento(e.kind).etichetta}</span>
                      </div>
                    )}
                  </div>
                  <div className="p-3">
                    <h2 className="text-[13px] font-medium leading-snug text-inchiostro line-clamp-2 group-hover:text-oro transition-colors">
                      {e.name}
                    </h2>
                    <div className="mt-2 flex items-center gap-3 text-[11px] text-tenue">
                      <span className="numeri">
                        {e.stages} {e.is_eza ? (e.stages === 1 ? 'level' : 'levels') : (e.stages === 1 ? 'stage' : 'stages')}
                      </span>
                      {e.clears > 0 && <ConteggioClear n={e.clears} className="text-oro" />}
                      {st && (
                        <span className={`ml-auto ${st.inCorso ? 'text-oro font-medium' : ''}`}>{st.testo}</span>
                      )}
                    </div>
                  </div>
                  {/* ultimo, così sta sopra al banner che è anch'esso relative */}
                  <AttesaLink />
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      <Paginazione
        pagina={pagina}
        ultima={ultima}
        etichetta="Event pages"
        href={(n) => query({ page: n === 1 ? null : String(n) })}
      />
    </div>
  )
}

function AzioneVuoto({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      rel={relRobots(href)}
      prefetch={false}
      className="inline-block mt-4 px-3 py-1.5 text-[13px] font-medium rounded-[var(--raggio)] bg-inchiostro text-sfondo hover:opacity-90 transition-opacity"
    >
      {children}
    </Link>
  )
}
