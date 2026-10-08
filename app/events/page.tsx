import type { Metadata } from 'next'
import Link from 'next/link'
import Form from 'next/form'
import Image from 'next/image'
import { connection } from 'next/server'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/ssr'
import { assetUrl } from '@/lib/db'
import { giornoBreve } from '@/lib/date'
import { pagina as leggiPagina, regione, testoRicerca, uno } from '@/lib/parametri'
import { EVENTI_PER_PAGINA, listEvents, type EventKind, type EventRow, type Status } from '@/lib/queries'
import { currentUser } from '@/lib/dal'
import { AttesaLink } from '@/components/attesa-link'
import { ConteggioClear } from '@/components/conteggio-clear'
import { Paginazione } from '@/components/paginazione'

export const metadata: Metadata = {
  title: 'Events',
  description: 'Dokkan Battle events, with the teams that cleared them.',
}

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

export default async function Eventi(props: PageProps<'/events'>) {
  // Senza cacheComponents una pagina che legge solo dal database verrebbe
  // prerenderizzata a build time e congelata. connection() lega il
  // rendering alla richiesta, ed è ciò che i doc di Next 16 preferiscono
  // a export const dynamic = 'force-dynamic'.
  await connection()

  const sp = await props.searchParams
  const reg = regione(sp)
  const kind = TIPI.find((t) => t.valore === uno(sp.type))?.valore ?? null
  const stato = STATI.find((s) => s.valore === uno(sp.status)) ?? null
  const status = stato?.valore ?? null
  const search = testoRicerca(sp)
  const pagina = leggiPagina(sp)
  // L'avviso resta nell'URL (anche nel ?next= di Sign in): chi rientra non
  // deve rileggerlo. La sessione si legge solo quando serve.
  const cancellato = uno(sp.account) === 'deleted' && !(await currentUser())

  const eventi = await listEvents({
    reg, kind, status, search, offset: (pagina - 1) * EVENTI_PER_PAGINA,
  })
  // Il totale viaggia dentro le righe: oltre l'ultima pagina non ci sono
  // righe e il totale si perde. Solo in quel caso costa una query in più.
  const totale =
    eventi[0]?.total ??
    (pagina > 1 ? ((await listEvents({ reg, kind, status, search, limit: 1 }))[0]?.total ?? 0) : 0)
  const da = (pagina - 1) * EVENTI_PER_PAGINA + 1
  const a = da + eventi.length - 1
  const ultima = Math.max(1, Math.ceil(totale / EVENTI_PER_PAGINA))
  const fuoriRange = eventi.length === 0 && pagina > ultima

  const query = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams()
    const base = { region: reg, type: kind, status, q: search, page: null, ...patch }
    for (const [k, v] of Object.entries(base)) if (v && !(k === 'region' && v === 'global')) p.set(k, String(v))
    const s = p.toString()
    return s ? `/events?${s}` : '/events'
  }

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-inchiostro">Events</h1>
      <p className="mt-1.5 text-sm text-testo max-w-[65ch]">
        Pick an event to see its stages and the teams that cleared them.
      </p>
      {/* Dopo la cancellazione dell'account (Settings): solo un avviso, i
          filtri non lo ripropagano. */}
      {cancellato && (
        <p role="status" className="mt-4 max-w-lg text-[12px] text-inchiostro bg-oro-tenue border border-oro-linea rounded-[var(--raggio)] px-3 py-2">
          Your account and everything you posted have been deleted.
        </p>
      )}

      <div className="mt-7 space-y-3">
        <RigaFiltri id="filtro-versione" etichetta="Version">
          <Filtro attivo={reg === 'global'} href={query({ region: null })}>Global</Filtro>
          <Filtro attivo={reg === 'japan'} href={query({ region: 'japan' })}>Japan</Filtro>
        </RigaFiltri>

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
          action="/events"
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
              className="w-full pl-8 pr-3 py-1.5 text-[13px] rounded-[var(--raggio)] bg-superficie border border-campo text-inchiostro placeholder:text-tenue"
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
                  href={reg === 'japan' ? `/events/${e.id}?region=japan` : `/events/${e.id}`}
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
                      // la carta del boss, se la conosciamo, e il tipo di evento.
                      <div className="flex flex-col items-center gap-1.5">
                        {copertina && (
                          <Image src={copertina} alt="" width={56} height={56} className="rounded-[var(--raggio)]" />
                        )}
                        <span className="text-[11px] text-tenue">
                          {TIPI.find((t) => t.valore === e.kind)?.etichetta ?? 'Event'}
                        </span>
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
      className="inline-block mt-4 px-3 py-1.5 text-[13px] font-medium rounded-[var(--raggio)] bg-inchiostro text-sfondo hover:opacity-90 transition-opacity"
    >
      {children}
    </Link>
  )
}
