'use client'

import { useEffect, useId, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Funnel } from '@phosphor-icons/react/dist/ssr'
import {
  ETICHETTA_ORDINE, ORDINI, SCELTE_TURNI, TIPI, filtriAttivi, parametriFiltri,
  type Classe, type FiltriClear, type Ordine, type TipoCarta,
} from '@/lib/clears/filtri'
import { clearListHref } from '@/lib/urls'
import type { Region } from '@/lib/queries'
import { ScegliCarta, nomeCarta, type OpzioneCarta } from '@/components/clears/scegli-carta'
import { campoAttivo, lasciaSegno, prendiSegno, rimettiFuoco } from '@/components/clears/fuoco-filtri'

/** Le opzioni della barra, contate sui clear del tier (getClearFacets). */
export type OpzioniFiltri = {
  cards: OpzioneCarta[]
  leaders: OpzioneCarta[]
  types: { id: TipoCarta; n: number }[]
  classes: { id: Classe; n: number }[]
  categories: { id: number; name: string; n: number }[]
}

const SELECT =
  'mt-1 w-full min-w-0 px-2 py-1.5 text-[13px] rounded-[var(--raggio)] bg-superficie border border-campo text-inchiostro'
const PILLOLA =
  'relative inline-flex items-center px-2.5 py-1.5 text-[13px] rounded-[var(--raggio)] border cursor-pointer select-none transition-colors ' +
  'bg-superficie text-testo border-campo hover:border-linea-forte ' +
  'has-[:checked]:bg-inchiostro has-[:checked]:text-sfondo has-[:checked]:border-inchiostro ' +
  'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-oro'
const CLASSI: { id: Classe; t: string; url: string }[] = [
  { id: 'Super', t: 'All Super', url: 'super' },
  { id: 'Extreme', t: 'All Extreme', url: 'extreme' },
]
const conta = (n: number) => (n > 0 ? ` (${n})` : ' (0 here)')

/*
 * La barra dei filtri dei clear di un tier. E' un vero <form method="get">
 * verso /events/<id>/clears: senza JavaScript si sceglie e si preme Apply.
 * Con JavaScript ogni scelta porta subito al suo URL (pulito, in ordine
 * canonico, senza i "?turns=" vuoti che un form aggiungerebbe), e mentre
 * arriva la lista sotto si attenua.
 *
 * Sulla pagina statica del tier i filtri partono vuoti; sulla lista
 * filtrata arrivano dall'URL. Togliere tutto riporta alla pagina statica.
 */
export function FiltriClear({ eventId, reg, tier, filtri, opzioni, sostituisci, etichette, children }: {
  eventId: string
  reg: Region
  tier: string
  filtri: FiltriClear
  opzioni: OpzioniFiltri
  /** sulla lista filtrata ogni scelta rimpiazza la voce della cronologia */
  sostituisci: boolean
  /** i nomi delle carte dell'URL che fra le opzioni non ci sono */
  etichette: Record<string, string>
  children: React.ReactNode
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const idBase = useId()
  const [aperta, setAperta] = useState(false)
  const barra = useRef<HTMLFormElement>(null)
  // Il controllo da rimettere a fuoco quando il pannello si sara' aperto
  const daRiprendere = useRef<string | null>(null)

  // Arrivati da un'altra route con un filtro scelto da tastiera: il focus
  // torna sul controllo (con il popover e il pannello aperti com'erano).
  // Gira anche quando <Activity> rimostra una pagina gia' vista.
  useEffect(() => {
    const s = prendiSegno()
    if (!s) return
    if (s.aperta) {
      // Prima si apre il pannello, al frame dopo; il focus lo mette
      // l'effetto qui sotto, quando il pannello e' visibile. Niente
      // cancel nel cleanup: il segno e' gia' consumato, e in StrictMode il
      // secondo giro dell'effetto non lo ritroverebbe.
      daRiprendere.current = s.campo
      requestAnimationFrame(() => setAperta(true))
    } else if (!rimettiFuoco(barra.current, s.campo)) {
      rimettiFuoco(barra.current, 'sort')
    }
  }, [])
  useEffect(() => {
    const campo = daRiprendere.current
    if (!aperta || !campo) return
    daRiprendere.current = null
    if (!rimettiFuoco(barra.current, campo)) rimettiFuoco(barra.current, 'pannello')
  }, [aperta])

  // La scelta appena fatta, finche' l'URL non la raggiunge; null = l'URL.
  // Lo stato segue l'URL quando cambia da fuori (un chip, Indietro)
  const chiave = new URLSearchParams(parametriFiltri(filtri)).toString()
  const [vista, setVista] = useState(chiave)
  const [scelta, setScelta] = useState<FiltriClear | null>(null)
  if (vista !== chiave) {
    setVista(chiave)
    setScelta(null)
  }
  const f = scelta ?? filtri
  // Next tiene la pagina che si lascia montata ma nascosta (<Activity>):
  // tornandoci, la barra mostrerebbe la scelta con cui la si e' lasciata,
  // con l'URL senza filtri. Quando si nasconde torna a seguire l'URL.
  useEffect(() => () => setScelta(null), [])

  function vai(nuovi: FiltriClear) {
    setScelta(nuovi)
    const url = clearListHref({ id: eventId, reg, tier, filtri: nuovi })
    // Cambiare route rimonta la barra: si lascia detto dov'era il focus
    if (new URL(url, window.location.href).pathname !== window.location.pathname) {
      const campo = campoAttivo(barra.current)
      if (campo) lasciaSegno(url, { campo, aperta })
    }
    startTransition(() => {
      if (sostituisci) router.replace(url, { scroll: false })
      else router.push(url, { scroll: false })
    })
  }

  const attivi = filtriAttivi(f)
  const idPannello = `${idBase}-pannello`
  const campo = (id: string, etichetta: string, controllo: React.ReactNode, nota?: React.ReactNode) => (
    <div className="min-w-0">
      <label htmlFor={`${idBase}-${id}`} className="block text-[11px] text-tenue">{etichetta}</label>
      {controllo}
      {nota}
    </div>
  )

  // Una carta dell'URL che qui nessuno usa resta scelta, con "0 here"
  const carteOpzioni = [...opzioni.cards]
  for (const id of f.cards) {
    if (!carteOpzioni.some((c) => c.id === id)) {
      carteOpzioni.unshift({ id, name: etichette[id] ?? null, epithet: null, type: '', class: '', thumb: null, bare: false, n: 0 })
    }
  }
  const leaderFuori = f.leader && !opzioni.leaders.some((c) => c.id === f.leader)

  return (
    <>
      <form
        ref={barra}
        method="get"
        action={`/events/${eventId}/clears`}
        onSubmit={(e) => { e.preventDefault(); vai(f) }}
        aria-label="Filter clears"
        className="mt-4"
      >
        {reg === 'japan' && <input type="hidden" name="region" value="japan" />}
        <input type="hidden" name="tier" value={tier} />

        <div className="flex flex-wrap items-end gap-2">
          <button
            type="button"
            data-fuoco="pannello"
            onClick={() => setAperta((a) => !a)}
            aria-expanded={aperta}
            aria-controls={idPannello}
            className="md:hidden inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[13px] rounded-[var(--raggio)] bg-superficie border border-campo text-inchiostro"
          >
            <Funnel size={14} weight="bold" aria-hidden />
            Filters
            {attivi > 0 && <span className="numeri text-[11px] px-1 rounded-[var(--raggio)] bg-oro-tenue text-inchiostro">{attivi}</span>}
          </button>
          {/* Sotto md e' un pannello da aprire; da md in su la scatola sparisce
              (contents) e i campi stanno nella riga della barra, Sort in fondo */}
          <div
            id={idPannello}
            className={`${aperta ? 'flex' : 'hidden'} md:contents basis-full flex-wrap items-end gap-2`}
          >
            <div role="group" aria-label="Clear conditions" className="flex flex-wrap gap-1.5">
              {([['proof', 'Proof', 'proof'], ['noItems', 'No items', 'noitems'], ['noKo', 'No KOs', 'noko']] as const).map(([k, t, nome]) => (
                <label key={k} className={PILLOLA}>
                  <input
                    type="checkbox"
                    name={nome}
                    value="1"
                    data-fuoco={k}
                    checked={f[k]}
                    onChange={(e) => vai({ ...f, [k]: e.target.checked })}
                    className="sr-only"
                  />
                  {t}
                </label>
              ))}
            </div>
            {campo('turns', 'Max turns', (
              <select
                id={`${idBase}-turns`}
                data-fuoco="turns"
                name="turns"
                value={f.turns ?? ''}
                onChange={(e) => vai({ ...f, turns: e.target.value ? Number(e.target.value) : null })}
                className={SELECT}
              >
                <option value="">Any</option>
                {[...new Set([...SCELTE_TURNI, ...(f.turns != null ? [f.turns] : [])])].sort((a, b) => a - b)
                  .map((n) => <option key={n} value={n}>{n} or fewer</option>)}
              </select>
            ), f.turns != null && (
              <p className="mt-1 text-[11px] text-tenue max-w-[12rem]">Clears that don’t report turns are hidden.</p>
            ))}
            {(opzioni.cards.length > 0 || f.cards.length > 0) && (
              <ScegliCarta opzioni={carteOpzioni} scelte={f.cards} onCambia={(cards) => vai({ ...f, cards })} />
            )}
            {(opzioni.leaders.length > 0 || f.leader) && campo('leader', 'Leader', (
              <select
                id={`${idBase}-leader`}
                data-fuoco="leader"
                name="leader"
                value={f.leader ?? ''}
                onChange={(e) => vai({ ...f, leader: e.target.value || null })}
                className={`${SELECT} max-w-[16rem]`}
              >
                <option value="">Any leader</option>
                {leaderFuori && <option value={f.leader!}>{`${etichette[f.leader!] ?? `Card ${f.leader}`} (0 here)`}</option>}
                {opzioni.leaders.map((c) => (
                  <option key={c.id} value={c.id}>
                    {nomeCarta(c)}{c.epithet ? `, ${c.epithet}` : ''}{conta(c.n)}
                  </option>
                ))}
              </select>
            ))}
            {(opzioni.types.length > 0 || f.mono) && campo('mono', 'Type', (
              <select
                id={`${idBase}-mono`}
                data-fuoco="mono"
                name="mono"
                value={f.mono ?? ''}
                onChange={(e) => vai({ ...f, mono: (e.target.value || null) as TipoCarta | null })}
                className={SELECT}
              >
                <option value="">Any type</option>
                {TIPI.filter((t) => t === f.mono || opzioni.types.some((x) => x.id === t)).map((t) => (
                  <option key={t} value={t}>Mono {t}{conta(opzioni.types.find((x) => x.id === t)?.n ?? 0)}</option>
                ))}
              </select>
            ))}
            {(opzioni.classes.length > 0 || f.cls) && campo('class', 'Class', (
              <select
                id={`${idBase}-class`}
                data-fuoco="class"
                name="class"
                value={CLASSI.find((c) => c.id === f.cls)?.url ?? ''}
                onChange={(e) => vai({ ...f, cls: CLASSI.find((c) => c.url === e.target.value)?.id ?? null })}
                className={SELECT}
              >
                <option value="">Any class</option>
                {CLASSI.filter((c) => c.id === f.cls || opzioni.classes.some((x) => x.id === c.id)).map((c) => (
                  <option key={c.id} value={c.url}>{c.t}{conta(opzioni.classes.find((x) => x.id === c.id)?.n ?? 0)}</option>
                ))}
              </select>
            ))}
            {(opzioni.categories.length > 0 || f.cat != null) && campo('cat', 'Category', (
              <select
                id={`${idBase}-cat`}
                data-fuoco="cat"
                name="cat"
                value={f.cat ?? ''}
                onChange={(e) => vai({ ...f, cat: e.target.value ? Number(e.target.value) : null })}
                className={`${SELECT} max-w-[16rem]`}
              >
                <option value="">Any category</option>
                {f.cat != null && !opzioni.categories.some((c) => c.id === f.cat) && (
                  <option value={f.cat}>{`Category ${f.cat} (0 here)`}</option>
                )}
                {opzioni.categories.map((c) => <option key={c.id} value={c.id}>{c.name}{conta(c.n)}</option>)}
              </select>
            ))}
          </div>
          <div className="ml-auto min-w-[9rem]">
            {campo('sort', 'Sort', (
              <select
                id={`${idBase}-sort`}
                data-fuoco="sort"
                name="sort"
                value={f.sort}
                onChange={(e) => vai({ ...f, sort: e.target.value as Ordine })}
                className={SELECT}
              >
                {ORDINI.map((o) => <option key={o} value={o}>{ETICHETTA_ORDINE[o]}</option>)}
              </select>
            ), f.sort === 'turns' && f.turns == null && (
              <p className="mt-1 text-[11px] text-tenue">Clears that don’t report turns are listed last.</p>
            ))}
          </div>
        </div>
        {/* Senza JavaScript: il pannello sempre aperto e un bottone per applicare */}
        <noscript>
          <style>{`@media (max-width: 767px){[id="${idPannello}"]{display:flex}}`}</style>
          <button type="submit" className="mt-2 px-3 py-1.5 text-[13px] font-medium rounded-[var(--raggio)] bg-inchiostro text-sfondo">
            Apply
          </button>
        </noscript>
      </form>
      <div aria-busy={pending} className={`transition-opacity ${pending ? 'opacity-50' : ''}`}>
        {children}
      </div>
    </>
  )
}
