import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { cache } from 'react'
import { ArrowLeft, Trophy } from '@phosphor-icons/react/dist/ssr'
import { assetUrl } from '@/lib/db'
import { quando } from '@/lib/date'
import { pagina as leggiPagina, regione, uno, type Ricerca } from '@/lib/parametri'
import {
  CLEAR_PER_PAGINA, getEvent, getStages, listClears, type EventDetail, type Region, type StageRow,
} from '@/lib/queries'
import { AttesaLink } from '@/components/attesa-link'
import { Clear } from '@/components/clear'
import { ConteggioClear } from '@/components/conteggio-clear'
import { Paginazione } from '@/components/paginazione'

const DIFFICOLTA: Record<string, string> = {
  normal: 'Normal', hard: 'Hard', z_hard: 'Z-Hard', super: 'Super', super2: 'Super 2',
  super3: 'Super 3', ultra: 'Ultra', dokkan: 'Dokkan', eza_level: 'Level',
}

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

// generateMetadata e la pagina chiedono lo stesso evento: cache() fa una
// sola query per richiesta invece di due.
const evento = cache((id: string, reg: Region) => getEvent(id, reg))

type Params = { id: string }

// L'id finisce in un cast ::bigint. Senza questo controllo /eventi/abc
// diventerebbe un errore 500 invece di un 404.
const idValido = (id: string) => /^\d{1,18}$/.test(id)

export async function generateMetadata(props: PageProps<'/events/[id]'>): Promise<Metadata> {
  const { id } = (await props.params) as Params
  if (!idValido(id)) return {}
  const e = await evento(id, regione(await props.searchParams))
  return e ? { title: e.name, description: e.description?.slice(0, 160) } : {}
}

/** Il tier mostrato all'apertura: quello con più clear, altrimenti il più difficile. */
function tierIniziale(stages: StageRow[]): StageRow | undefined {
  let migliore: StageRow | undefined
  for (const s of stages) if (!migliore || s.clears >= migliore.clears) migliore = s
  return migliore
}

export default async function Evento(props: PageProps<'/events/[id]'>) {
  await connection()

  const { id } = (await props.params) as Params
  if (!idValido(id)) notFound()
  const sp = (await props.searchParams) as Ricerca
  const reg = regione(sp)
  const pagina = leggiPagina(sp)

  const [e, stages] = await Promise.all([evento(id, reg), getStages(id, reg)])
  if (!e) notFound()

  const richiesto = uno(sp.tier)
  const scelto = stages.find((s) => s.tier_id === richiesto) ?? tierIniziale(stages)
  const clears = scelto
    ? await listClears(scelto.tier_id, reg, { offset: (pagina - 1) * CLEAR_PER_PAGINA })
    : []
  // Il totale dei clear viene da getStages, che li conta con gli stessi
  // filtri di listClears (tier, regione, pubblicati): resta giusto anche su
  // una pagina oltre l'ultima, dove listClears non restituisce righe.
  const totaleClear = scelto?.clears ?? 0
  const ultimaPagina = Math.max(1, Math.ceil(totaleClear / CLEAR_PER_PAGINA))

  const eza = stages.length > 0 && stages.every((s) => s.difficulty === 'eza_level')
  const conClear = stages.some((s) => s.clears > 0)

  // La fascia mostrata è quella del livello scelto: scegliere una fascia
  // apre il suo primo livello, così l'URL resta uno solo (?tier=).
  const fasce = new Map<number, StageRow[]>()
  if (eza && stages.length > LIVELLI_PER_FASCIA) {
    for (const s of stages) fasce.set(fasciaDi(s.seq), [...(fasce.get(fasciaDi(s.seq)) ?? []), s])
  }
  const fasciaScelta = scelto ? fasciaDi(scelto.seq) : 0
  const livelliVisibili = fasce.size ? (fasce.get(fasciaScelta) ?? []) : stages
  const banner = assetUrl(e.banner_key)
  const href = (tier: string, n = 1) => `/events/${e.id}?${new URLSearchParams({
    ...(reg === 'japan' ? { region: reg } : {}), tier, ...(n > 1 ? { page: String(n) } : {}),
  })}`
  const stato = statoEvento(e)
  const nomeScelto = scelto
    ? eza
      ? `Level ${scelto.seq}`
      : `${scelto.name ?? `Stage ${scelto.seq}`}, ${DIFFICOLTA[scelto.difficulty] ?? scelto.difficulty}`
    : ''

  // Gli stage arrivano un tier per riga: per gli eventi normali li
  // raggruppo per stage, perché le difficoltà sono varianti dello stesso.
  const perStage = new Map<string, StageRow[]>()
  for (const s of stages) perStage.set(s.stage_id, [...(perStage.get(s.stage_id) ?? []), s])

  return (
    <div className="mx-auto max-w-6xl px-5 py-8">
      <Link
        href={reg === 'japan' ? '/events?region=japan' : '/events'}
        className="inline-flex items-center gap-1.5 text-[13px] text-tenue hover:text-inchiostro transition-colors"
      >
        <ArrowLeft size={14} weight="bold" aria-hidden />
        Events
      </Link>

      <header className="mt-5 grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:items-end">
        <div className="relative aspect-[16/7] rounded-[var(--raggio)] overflow-hidden bg-superficie-2 border border-linea">
          {banner && (
            <Image src={banner} alt="" fill preload sizes="(max-width: 768px) 100vw, 50vw" className="object-cover" />
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

          <section id="clear" aria-labelledby="titolo-clear" className="min-w-0 scroll-mt-6">
            {/*
             * Scegliere un livello cambia questo pannello senza spostare il
             * focus, che resta sulla griglia per poter scegliere ancora.
             * La regione live annuncia cosa è comparso; non ha una key, così
             * resta lo stesso nodo e il lettore di schermo ne legge il cambio.
             */}
            <p aria-live="polite" className="sr-only">
              {nomeScelto}: {totaleClear === 0 ? 'no clears' : `${totaleClear} ${totaleClear === 1 ? 'clear' : 'clears'}`}
            </p>

            {scelto && (
              <div className="pb-4 border-b border-linea">
                <h2 id="titolo-clear" className="text-[15px] font-semibold text-inchiostro">
                  {eza ? nomeScelto : (
                    <>
                      <span>{scelto.name ?? `Stage ${scelto.seq}`}</span>
                      , {DIFFICOLTA[scelto.difficulty] ?? scelto.difficulty}
                    </>
                  )}
                </h2>
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

            {totaleClear === 0 ? (
              // Lo stato vuoto è il caso normale, non quello raro: quasi
              // tutti gli stage oggi non hanno clear. Deve dire cosa manca
              // e cosa si può fare, non sembrare una pagina rotta.
              <div className="mt-5 border border-dashed border-linea-forte rounded-[var(--raggio)] px-6 py-10 text-center">
                <p className="text-sm font-medium text-inchiostro">
                  No clears for this {eza ? 'level' : 'stage'} yet
                </p>
                <p className="mt-1.5 text-[13px] text-testo max-w-[46ch] mx-auto leading-relaxed">
                  If you’ve cleared it, your team is exactly what the next player needs. Clear
                  submissions open together with accounts.
                </p>
              </div>
            ) : clears.length === 0 ? (
              <div className="mt-5 border border-linea rounded-[var(--raggio)] bg-superficie px-6 py-10 text-center">
                <p className="text-sm font-medium text-inchiostro">This page doesn’t exist</p>
                <p className="mt-1.5 text-[13px] text-testo">
                  Clears for this {eza ? 'level' : 'stage'} end at page {ultimaPagina}.
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
                  {totaleClear > clears.length ? (
                    <>
                      Clears <span className="numeri">{(pagina - 1) * CLEAR_PER_PAGINA + 1}-{(pagina - 1) * CLEAR_PER_PAGINA + clears.length}</span>{' '}
                      of <span className="numeri">{totaleClear}</span>
                    </>
                  ) : (
                    <>
                      <span className="numeri">{totaleClear}</span> {totaleClear === 1 ? 'clear' : 'clears'}
                    </>
                  )}
                  , those with proof and the most votes first
                </p>
                <ol className="mt-3 space-y-3">
                  {clears.map((c) => (
                    <li key={c.id}>
                      <Clear clear={c} />
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
          </section>
        </div>
      )}
    </div>
  )
}
