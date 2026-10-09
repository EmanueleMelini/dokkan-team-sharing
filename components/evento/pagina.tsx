import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { ArrowLeft, Trophy } from '@phosphor-icons/react/dist/ssr'
import { assetUrl } from '@/lib/db'
import { quando } from '@/lib/date'
import {
  CLEAR_PER_PAGINA, countClears, listClears, type EventDetail, type StageRow,
} from '@/lib/queries'
import {
  getEventCached, getEzaLinksCached, getMissionsCached, getStagesCached, listClearsCached,
} from '@/lib/cache/data'
import { browseHref, clearListHref, eventHref, submitHref, type EventView } from '@/lib/urls'
import { AttesaLink } from '@/components/attesa-link'
import { Clear } from '@/components/clear'
import { InviaClear } from '@/components/clears/invia-cta'
import { ViewerTier } from '@/components/viewer/provider'
import { BannerSospesoIsola } from '@/components/moderation/banner-sospeso'
import { Tips } from '@/components/tips/tips'
import { listTipsCached } from '@/lib/cache/tips'
import { extraClear } from '@/lib/clears/vista'
import { DIFFICOLTA, nomeTier } from '@/lib/livelli'
import { Missioni } from '@/components/missioni'
import { ConteggioClear } from '@/components/conteggio-clear'
import { Paginazione } from '@/components/paginazione'
import { FiltriClear, type OpzioniFiltri } from '@/components/clears/filtri-clear'
import { FiltriAttivi } from '@/components/clears/filtri-attivi'
import { SPIEGA_ORDINE, VUOTI, filtriAttivi, soloOrdine, type FiltriClear as Filtri } from '@/lib/clears/filtri'
import { datiFiltri } from '@/lib/clears/filtri-pagina'

// Il corpo della pagina di un evento, per tutte le sue viste
// (/events/<id>[/japan][/t/<tier>[/p/<n>]]). Legge solo dati in cache e
// non legge mai la sessione: la pagina e' la stessa per tutti, e Vercel la
// serve dalla CDN come prerender. Chi guarda arriva dopo, nelle isole
// client (voto, Edit/Delete, commenti, invio), da /api/me.
//
// Con `filtri` e' la lista filtrata (/events/<id>/clears?...), dinamica e
// noindex: la lista e il conteggio filtrati non stanno in cache (le
// combinazioni sono senza fine), tutto il resto si'.

const TIPO_EVENTO: Record<string, string> = {
  challenge: 'Challenge', zbattle: 'Extreme Z-Battle', limited: 'Limited', story: 'Story',
  bonus: 'Bonus', world_tournament: 'World Tournament', other: 'Event',
}

/*
 * Lo stato dell'evento in parole. Una run in corso senza fine può essere
 * permanente (il gioco lo dice: gli EZA sempre in lista) o solo di fine
 * sconosciuta (il gioco non la registra, o la data viene dal wiki): sono
 * due cose diverse e vanno dette diverse.
 */
function statoEvento(e: EventDetail): { etichetta: string; dettaglio: string; inCorso: boolean } | null {
  if (!e.status || !e.starts_at) return null
  const dal = quando(e.starts_at, e.source)
  const al = e.ends_at && e.ends_at_known ? quando(e.ends_at, e.source) : null
  if (e.status === 'active') {
    if (al) return { etichetta: 'Ongoing', dettaglio: `until ${al}`, inCorso: true }
    if (e.ends_at_known) return { etichetta: 'Permanent', dettaglio: `since ${dal}`, inCorso: true }
    return { etichetta: 'End date unknown', dettaglio: `started ${dal}`, inCorso: false }
  }
  if (e.status === 'upcoming') {
    return { etichetta: 'Upcoming', dettaglio: al ? `from ${dal} until ${al}` : `starts ${dal}`, inCorso: false }
  }
  return { etichetta: 'Ended', dettaglio: al ? `ran from ${dal} until ${al}` : `started ${dal}, end date unknown`, inCorso: false }
}

// Oltre i cento livelli la griglia si divide in fasce da cento: Dokkan
// All-Stars ne ha 999, che in una griglia unica sarebbero 125 righe.
const LIVELLI_PER_FASCIA = 100
const fasciaDi = (seq: number) => Math.floor((seq - 1) / LIVELLI_PER_FASCIA)

// L'id finisce in un cast ::bigint. Senza questo controllo /events/abc
// diventerebbe un errore 500 invece di un 404.
export const idValido = (id: string) => /^\d{1,18}$/.test(id)

/** Il titolo della pagina: la stessa lettura in cache della pagina (Next la deduplica). */
export async function metadataEvento(id: string, view: EventView | null): Promise<Metadata> {
  if (!view || !idValido(id)) return {}
  const e = await getEventCached(id, view.reg)
  return e ? { title: e.name, description: e.description?.slice(0, 160) } : {}
}

/** La barra dei filtri sopra la lista, se il tier ha abbastanza clear; altrimenti solo la lista. */
function ListaConFiltri({ barra, eventId, reg, tier, filtri, sostituisci, etichette, children }: {
  barra: OpzioniFiltri | null
  eventId: string
  reg: EventView['reg']
  tier: string
  filtri: Filtri
  sostituisci: boolean
  etichette: Record<string, string>
  children: React.ReactNode
}) {
  if (!barra) return <>{children}</>
  return (
    <FiltriClear
      eventId={eventId} reg={reg} tier={tier} filtri={filtri} opzioni={barra}
      sostituisci={sostituisci} etichette={etichette}
    >
      {children}
    </FiltriClear>
  )
}

const N = ({ n }: { n: number | string }) => <span className="numeri">{n}</span>

/** "Clears 1-20 of 40", o con i filtri "12 of 40 clears match". */
function Riepilogo({ primo, visti, totale, delTier, filtrata }: {
  primo: number
  visti: number
  totale: number
  delTier: number
  filtrata: boolean
}) {
  if (totale > visti) {
    return (
      <>
        Clears <N n={`${primo}-${primo + visti - 1}`} /> of <N n={totale} />
        {filtrata && <> matching, out of <N n={delTier} /></>}
      </>
    )
  }
  if (filtrata) return <><N n={totale} /> of <N n={delTier} /> clears match</>
  return <><N n={totale} /> {totale === 1 ? 'clear' : 'clears'}</>
}

/** Il tier mostrato all'apertura: quello con più clear, altrimenti il più difficile. */
function tierIniziale(stages: StageRow[]): StageRow | undefined {
  let migliore: StageRow | undefined
  for (const s of stages) if (!migliore || s.clears >= migliore.clears) migliore = s
  return migliore
}

/**
 * Ogni URL valido diventa una voce ISR salvata: un tier che non e'
 * dell'evento, o una pagina oltre l'ultima, sono 404 veri (non un 200 con
 * un messaggio, ne' un ripiego sul tier di apertura). notFound() qui, al
 * livello della pagina e non dentro un <Suspense>, risponde davvero 404.
 */
export async function EventPage({ id, view, filtri }: { id: string; view: EventView | null; filtri?: Filtri }) {
  if (!view || !idValido(id)) notFound()
  const { reg, page: pagina } = view

  const [e, stages, legami] = await Promise.all([
    getEventCached(id, reg), getStagesCached(id, reg), getEzaLinksCached(id),
  ])
  if (!e) notFound()

  const scelto = view.tier ? stages.find((s) => s.tier_id === view.tier) : tierIniziale(stages)
  if (view.tier && !scelto) notFound()
  // Il totale dei clear viene da getStages, che li conta con gli stessi
  // filtri di listClears (tier, regione, pubblicati).
  const totaleClear = scelto?.clears ?? 0
  // La lista filtrata non e' una voce ISR: una pagina oltre l'ultima mostra
  // il riquadro "non esiste" invece di un 404.
  if (!filtri && pagina > Math.max(1, Math.ceil(totaleClear / CLEAR_PER_PAGINA))) notFound()
  const f = filtri ?? VUOTI
  const nFiltri = filtriAttivi(f)

  // Le missioni ci sono solo per Global: il datamine è quello della versione Global.
  // Le tip non hanno regione (gli stage nemmeno): le stesse in Global e Japan.
  const offset = (pagina - 1) * CLEAR_PER_PAGINA
  const [clears, totaleFiltrato, perFiltri, missioni, tips] = await Promise.all([
    !scelto ? Promise.resolve([])
      : filtri ? listClears(scelto.tier_id, reg, { offset, filtri })
        : listClearsCached(scelto.tier_id, reg, offset, e.id),
    // senza filtri il conteggio e' quello di getStages
    scelto && nFiltri > 0 ? countClears(scelto.tier_id, reg, f) : Promise.resolve(totaleClear),
    scelto ? datiFiltri({ eventId: e.id, tierId: scelto.tier_id, reg, totale: totaleClear, filtri: f }) : Promise.resolve(null),
    reg === 'global' ? getMissionsCached(e.id, e.run_id) : Promise.resolve([]),
    scelto ? listTipsCached(e.id, scelto.tier_id) : Promise.resolve(null),
  ])
  const ultimaPagina = Math.max(1, Math.ceil(totaleFiltrato / CLEAR_PER_PAGINA))
  const extra = await extraClear(e.id, clears)
  const invia = scelto ? submitHref(e.id, reg, scelto.tier_id) : ''

  const eza = stages.length > 0 && stages.every((s) => s.difficulty === 'eza_level')
  const conClear = stages.some((s) => s.clears > 0)

  // La fascia mostrata è quella del livello scelto: scegliere una fascia
  // apre il suo primo livello, così l'URL resta uno solo (/t/<tier>).
  const fasce = new Map<number, StageRow[]>()
  if (eza && stages.length > LIVELLI_PER_FASCIA) {
    for (const s of stages) fasce.set(fasciaDi(s.seq), [...(fasce.get(fasciaDi(s.seq)) ?? []), s])
  }
  const fasciaScelta = scelto ? fasciaDi(scelto.seq) : 0
  const livelliVisibili = fasce.size ? (fasce.get(fasciaScelta) ?? []) : stages
  const banner = assetUrl(e.banner_key)
  const copertina = assetUrl(e.cover_thumb_key)
  const linkEvento = (altro: string) => eventHref({ id: altro, reg })
  // I link di stage, livelli e fasce tengono i filtri e tornano a pagina 1
  const href = (tier: string, n = 1) => clearListHref({ id: e.id, reg, tier, filtri: f, page: n })
  const stato = statoEvento(e)
  // Per commentare si torna a questa pagina, non al builder
  const qui = scelto ? `${href(scelto.tier_id, pagina)}#clear` : ''
  const nomeScelto = scelto ? nomeTier(scelto, eza) : ''

  // Gli stage arrivano un tier per riga: per gli eventi normali li
  // raggruppo per stage, perché le difficoltà sono varianti dello stesso.
  const perStage = new Map<string, StageRow[]>()
  for (const s of stages) perStage.set(s.stage_id, [...(perStage.get(s.stage_id) ?? []), s])

  return (
    <div className="mx-auto max-w-6xl px-5 py-8">
      <Link
        href={browseHref({ reg })}
        className="inline-flex items-center gap-1.5 text-[13px] text-tenue hover:text-inchiostro transition-colors"
      >
        <ArrowLeft size={14} weight="bold" aria-hidden />
        Events
      </Link>

      <header className="mt-5 grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:items-end">
        <div className="relative aspect-[16/7] rounded-[var(--raggio)] overflow-hidden bg-superficie-2 border border-linea flex items-center justify-center">
          {banner ? (
            <Image src={banner} alt="" fill preload sizes="(max-width: 768px) 100vw, 50vw" className="object-cover" />
          ) : (
            // Gli eventi presi dal gioco non hanno banner: la carta del boss
            copertina && <Image src={copertina} alt="" width={96} height={96} preload className="rounded-[var(--raggio)]" />
          )}
        </div>
        <div>
          <p className="text-[12px] text-tenue">
            {TIPO_EVENTO[e.kind] ?? 'Event'}
            {reg === 'japan' && <span className="ml-2">Japanese version</span>}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-inchiostro leading-tight text-balance">
            {e.name}
          </h1>
          <p className="mt-2 text-[13px] text-testo">
            {stato ? (
              <>
                <span className={stato.inCorso ? 'text-oro font-medium' : ''}>{stato.etichetta}</span>
                <span className="ml-2 text-tenue">{stato.dettaglio}</span>
              </>
            ) : (
              // Nessuna run in questa regione può voler dire che l'evento non
              // è uscito, ma anche solo che il wiki non ne ha la data: non
              // sappiamo quale delle due, quindi non lo affermiamo.
              <span className="text-tenue">We have no dates for this version of the game.</span>
            )}
          </p>
          {/* EZA e Super EZA sono due eventi: ciascuno porta all'altro */}
          {legami.normal && (
            <p className="mt-2 text-[13px] text-testo">
              Super version of{' '}
              <Link href={linkEvento(legami.normal.id)} className="underline decoration-oro-linea underline-offset-2 hover:text-inchiostro">
                {legami.normal.name}
              </Link>
            </p>
          )}
          {legami.supers.map((s) => (
            <p key={s.id} className="mt-2 text-[13px] text-testo">
              Super version:{' '}
              <Link href={linkEvento(s.id)} className="underline decoration-oro-linea underline-offset-2 hover:text-inchiostro">
                {s.name}
              </Link>
            </p>
          ))}
        </div>
      </header>

      {e.description && (
        <p className="mt-6 text-[14px] leading-relaxed text-testo max-w-[70ch] whitespace-pre-line">
          {e.description}
        </p>
      )}

      {stages.length === 0 ? (
        <p className="mt-10 text-[13px] text-tenue">
          We don’t have the stages for this event yet. They’ll arrive with the next data import.
        </p>
      ) : (
        <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <nav aria-label={eza ? 'Levels' : 'Stages'} className="lg:sticky lg:top-6 lg:self-start">
            <h2 className="text-[13px] font-medium text-inchiostro">
              {eza ? `${stages.length} levels` : `${perStage.size} ${perStage.size === 1 ? 'stage' : 'stages'}`}
            </h2>

            {eza && fasce.size > 0 && (
              <div role="group" aria-label="Level ranges" className="mt-3 flex flex-wrap gap-1">
                {[...fasce.entries()].map(([f, livelli]) => {
                  const attiva = f === fasciaScelta
                  const primo = livelli[0].seq
                  const ultimo = livelli[livelli.length - 1].seq
                  const clearFascia = livelli.reduce((n, s) => n + s.clears, 0)
                  return (
                    <Link
                      key={f}
                      href={href(livelli[0].tier_id)}
                      prefetch={false}
                      scroll={false}
                      aria-current={attiva ? 'true' : undefined}
                      className={`relative inline-flex items-center gap-1 px-2 py-0.5 numeri text-[12px] rounded-[var(--raggio)] border transition-colors ${
                        attiva
                          ? 'bg-inchiostro text-sfondo border-inchiostro font-medium'
                          : 'bg-superficie text-testo border-linea hover:border-linea-forte'
                      }`}
                    >
                      <span className="sr-only">Levels </span>
                      {primo}-{ultimo}
                      {clearFascia > 0 && <ConteggioClear n={clearFascia} className={attiva ? '' : 'text-oro'} />}
                      <AttesaLink />
                    </Link>
                  )
                })}
              </div>
            )}

            {eza ? (
              // Una lista di righe sarebbe una pagina da scorrere, una
              // griglia di numeri si legge a colpo d'occhio.
              <ol className="mt-3 grid grid-cols-8 gap-1">
                {livelliVisibili.map((s) => {
                  const attivo = s.tier_id === scelto?.tier_id
                  return (
                    <li key={s.tier_id}>
                      <Link
                        href={href(s.tier_id)}
                        prefetch={false}
                        scroll={false}
                        aria-current={attivo ? 'page' : undefined}
                        className={`relative flex items-center justify-center h-8 numeri text-[12px] rounded-[var(--raggio)] border transition-colors ${
                          attivo
                            ? 'bg-inchiostro text-sfondo border-inchiostro font-semibold'
                            : s.clears
                              ? 'bg-oro-tenue text-inchiostro border-oro-linea hover:border-oro'
                              : 'bg-superficie text-testo border-linea hover:border-linea-forte'
                        }`}
                      >
                        <span className="sr-only">Level </span>
                        {s.seq}
                        {/* Il trofeo dice "ha clear" anche senza distinguere
                            i colori, e resta sulla cella scelta, che perde
                            il fondo dorato. */}
                        {s.clears > 0 && (
                          <>
                            <Trophy
                              size={9}
                              weight="fill"
                              aria-hidden
                              className={`absolute top-0.5 right-0.5 ${attivo ? 'text-sfondo' : 'text-oro'}`}
                            />
                            <span className="sr-only">, {s.clears} {s.clears === 1 ? 'clear' : 'clears'}</span>
                          </>
                        )}
                        <AttesaLink />
                      </Link>
                    </li>
                  )
                })}
              </ol>
            ) : (
              <ol className="mt-3 border border-linea rounded-[var(--raggio)] bg-superficie overflow-hidden">
                {[...perStage.values()].map((tiers) => (
                  <li key={tiers[0].stage_id} className="px-3 py-2.5 border-b border-linea last:border-b-0">
                    <div className="flex items-baseline gap-2">
                      <span className="numeri text-[11px] text-tenue w-5 shrink-0">{tiers[0].seq}</span>
                      <span className="text-[13px] text-inchiostro leading-snug">
                        {tiers[0].name ?? `Stage ${tiers[0].seq}`}
                      </span>
                    </div>
                    <div className="mt-2 ml-7 flex flex-wrap gap-1">
                      {tiers.map((s) => {
                        const attivo = s.tier_id === scelto?.tier_id
                        return (
                          <Link
                            key={s.tier_id}
                            href={href(s.tier_id)}
                            prefetch={false}
                            scroll={false}
                            aria-current={attivo ? 'page' : undefined}
                            className={`relative inline-flex items-center gap-1.5 px-2 py-0.5 text-[12px] rounded-[var(--raggio)] border transition-colors ${
                              attivo
                                ? 'bg-inchiostro text-sfondo border-inchiostro font-medium'
                                : 'bg-superficie text-testo border-linea hover:border-linea-forte'
                            }`}
                          >
                            {DIFFICOLTA[s.difficulty] ?? s.difficulty}
                            {s.clears > 0 && <ConteggioClear n={s.clears} className={attivo ? '' : 'text-oro'} />}
                            <AttesaLink />
                          </Link>
                        )
                      })}
                    </div>
                  </li>
                ))}
              </ol>
            )}

            {eza && conClear && (
              <p className="mt-3 text-[11px] text-tenue inline-flex items-center gap-1">
                <Trophy size={10} weight="fill" aria-hidden className="text-oro" />
                marks levels with at least one clear.
              </p>
            )}
          </nav>

          {/* Lo stato di chi guarda su questo tier (voti, propri clear, punteggi
              vivi) arriva in una richiesta sola a /api/me?tier= */}
          <ViewerTier tierId={scelto!.tier_id}>
          <section id="clear" aria-labelledby="titolo-clear" className="min-w-0 scroll-mt-6">
            {/*
             * Scegliere un livello cambia questo pannello senza spostare il
             * focus, che resta sulla griglia per poter scegliere ancora.
             * La regione live annuncia cosa è comparso; non ha una key, così
             * resta lo stesso nodo e il lettore di schermo ne legge il cambio.
             */}
            <p aria-live="polite" className="sr-only">
              {nomeScelto}: {totaleClear === 0 ? 'no clears'
                : nFiltri > 0 ? `${totaleFiltrato} of ${totaleClear} clears match`
                  : `${totaleClear} ${totaleClear === 1 ? 'clear' : 'clears'}`}
            </p>

            {scelto && (
              <div className="pb-4 border-b border-linea">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
                  <h2 id="titolo-clear" className="text-[15px] font-semibold text-inchiostro">
                    {eza ? nomeScelto : (
                      <>
                        <span>{scelto.name ?? `Stage ${scelto.seq}`}</span>
                        , {DIFFICOLTA[scelto.difficulty] ?? scelto.difficulty}
                      </>
                    )}
                  </h2>
                  <InviaClear invia={invia} />
                </div>
                <dl className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-tenue">
                  {scelto.sta_cost != null && (
                    <div className="flex gap-1">
                      <dt>Stamina</dt>
                      <dd className="numeri text-testo">{scelto.sta_cost}</dd>
                    </div>
                  )}
                  {scelto.boss_note && (
                    <div className="flex gap-1">
                      <dt className="sr-only">Enemy</dt>
                      <dd className="text-testo">{scelto.boss_note}</dd>
                    </div>
                  )}
                </dl>
              </div>
            )}

            {/* chi e' sospeso lo sa da /api/me: nell'HTML in cache non c'e' */}
            <BannerSospesoIsola className="mt-4" />

            {scelto && tips && (
              <Tips
                eventId={e.id}
                tierId={scelto.tier_id}
                nomeTier={nomeScelto}
                eza={eza}
                tips={tips}
                ritorno={`${eventHref({ id: e.id, reg, tier: scelto.tier_id })}#tips`}
              />
            )}

            {totaleClear === 0 ? (
              // Lo stato vuoto è il caso normale, non quello raro: quasi
              // tutti gli stage oggi non hanno clear. Deve dire cosa manca
              // e cosa si può fare, non sembrare una pagina rotta.
              <div className="mt-5 border border-dashed border-linea-forte rounded-[var(--raggio)] px-6 py-10 text-center">
                <p className="text-sm font-medium text-inchiostro">
                  No clears for this {eza ? 'level' : 'stage'} yet
                </p>
                <p className="mt-1.5 text-[13px] text-testo max-w-[46ch] mx-auto leading-relaxed">
                  If you’ve cleared it, your team is exactly what the next player needs.
                  Be the first to share it.
                </p>
              </div>
            ) : (
              <ListaConFiltri
                barra={perFiltri?.opzioni ?? null}
                eventId={e.id} reg={reg} tier={scelto!.tier_id} filtri={f} sostituisci={!!filtri}
                etichette={Object.fromEntries(perFiltri?.nomi.carte ?? [])}
              >
                {perFiltri && (
                  <FiltriAttivi
                    eventId={e.id} reg={reg} tier={scelto!.tier_id} filtri={f} nomi={perFiltri.nomi} className="mt-3"
                  />
                )}
                {totaleFiltrato === 0 ? (
                  <div className="mt-5 border border-dashed border-linea-forte rounded-[var(--raggio)] px-6 py-10 text-center">
                    <p className="text-sm font-medium text-inchiostro">No clears match these filters</p>
                    <p className="mt-1.5 text-[13px] text-testo max-w-[46ch] mx-auto leading-relaxed">
                      <span className="numeri">{totaleClear}</span> {totaleClear === 1 ? 'clear' : 'clears'} for
                      this {eza ? 'level' : 'stage'}, but none with all of these.
                    </p>
                    {perFiltri?.maiUsate.map((frase) => (
                      <p key={frase} className="mt-1 text-[13px] text-testo">{frase}</p>
                    ))}
                    <Link
                      href={clearListHref({ id: e.id, reg, tier: scelto!.tier_id, filtri: soloOrdine(f) })}
                      rel="nofollow"
                      prefetch={false}
                      scroll={false}
                      className="inline-block mt-4 px-3 py-1.5 text-[13px] font-medium rounded-[var(--raggio)] bg-inchiostro text-sfondo hover:opacity-90 transition-opacity"
                    >
                      Clear all filters
                    </Link>
                  </div>
                ) : clears.length === 0 ? (
                  <div className="mt-5 border border-linea rounded-[var(--raggio)] bg-superficie px-6 py-10 text-center">
                    <p className="text-sm font-medium text-inchiostro">This page doesn’t exist</p>
                    <p className="mt-1.5 text-[13px] text-testo">
                      {nFiltri > 0 ? 'Matching clears' : `Clears for this ${eza ? 'level' : 'stage'}`} end at page {ultimaPagina}.
                    </p>
                    <Link
                      href={href(scelto!.tier_id)}
                      className="inline-block mt-4 px-3 py-1.5 text-[13px] font-medium rounded-[var(--raggio)] bg-inchiostro text-sfondo hover:opacity-90 transition-opacity"
                    >
                      Go to the first page
                    </Link>
                  </div>
                ) : (
                  <>
                    <p className="mt-4 text-[12px] text-tenue">
                      <Riepilogo
                        primo={offset + 1} visti={clears.length} totale={totaleFiltrato}
                        delTier={totaleClear} filtrata={nFiltri > 0}
                      />
                      {nFiltri === 0 && f.sort === 'top'
                        ? ', those with proof and the most votes first'
                        : ` · ${SPIEGA_ORDINE[f.sort]}`}
                    </p>
                    <ol className="mt-3 space-y-3">
                      {clears.map((c) => (
                        <li key={c.id}>
                          <Clear clear={c} eventId={e.id} ritorno={qui} {...extra.get(c.id)!} />
                        </li>
                      ))}
                    </ol>
                    <Paginazione
                      pagina={pagina}
                      ultima={ultimaPagina}
                      etichetta="Clear pages"
                      href={(n) => `${href(scelto!.tier_id, n)}#clear`}
                    />
                  </>
                )}
              </ListaConFiltri>
            )}
          </section>
          </ViewerTier>
        </div>
      )}

      <Missioni missioni={missioni} />
    </div>
  )
}
