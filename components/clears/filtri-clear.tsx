'use client'

import { useEffect, useId, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Funnel } from '@phosphor-icons/react/dist/ssr'
import {
  ORDINI, TIPI, filtriAttivi, parametriFiltri,
  type Classe, type FiltriClear, type Ordine, type TipoCarta,
} from '@/lib/clears/filtri'
import {
  CLASSI, OPZIONI_ORDINE, opzioniCategoria, opzioniClasse, opzioniLeader, opzioniMono, opzioniTurni,
} from '@/lib/clears/filtri-opzioni'
import { clearListHref } from '@/lib/urls'
import type { Region } from '@/lib/queries'
import { ScegliCarta, type OpzioneCarta } from '@/components/clears/scegli-carta'
import { campoAttivo, lasciaSegno, prendiSegno, rimettiFuoco, type Segno } from '@/components/clears/fuoco-filtri'
import { Scelta } from '@/components/scelta/scelta'
import type { Opzione } from '@/lib/scelta'

/** Le opzioni della barra, contate sui clear del tier (getClearFacets). */
export type OpzioniFiltri = {
  cards: OpzioneCarta[]
  leaders: OpzioneCarta[]
  types: { id: TipoCarta; n: number }[]
  classes: { id: Classe; n: number }[]
  categories: { id: number; name: string; n: number }[]
}

// Col dito le pillole, Filters e "Uses card" sono alti quanto i menu
// accanto (44px, components/scelta), con 15px come le voci dei menu: una
// riga sola, un'altezza sola. Al passaggio il bordo si fa piu' forte,
// mai piu' debole di campo (3:1).
const COL_DITO = 'pointer-coarse:min-h-11 pointer-coarse:text-[15px]'
const PILLOLA =
  `relative inline-flex items-center px-2.5 py-1.5 text-[13px] ${COL_DITO} rounded-[var(--raggio)] border cursor-pointer select-none transition-colors ` +
  'bg-superficie text-testo border-campo hover:border-tenue ' +
  'has-[:checked]:bg-inchiostro has-[:checked]:text-sfondo has-[:checked]:border-inchiostro ' +
  'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-oro'
// Le larghezze dei menu: fisse, cosi' una scelta non allarga la riga.
// Sotto md Leader e Category stanno a tutta riga (i nomi lunghi vanno a
// capo, mai tagliati), Max turns, Type e Class a meta'.
const MEZZA = 'w-[calc(50%-0.25rem)] md:w-[8.5rem]'
const LARGHEZZA = { turns: MEZZA, leader: 'w-full md:w-[18rem]', mono: MEZZA, class: MEZZA, cat: 'w-full md:w-[16rem]', sort: 'w-[9rem]' }

/**
 * Uno dei sei menu (components/scelta): l'etichetta sopra, il name del
 * form GET di prima e il data-fuoco per rimettere il focus dopo un cambio
 * di route (fuoco-filtri.ts).
 */
function CampoFiltro({ idBase, id, etichetta, voci, valore, onCambia, nota }: {
  idBase: string
  id: keyof typeof LARGHEZZA
  etichetta: string
  voci: readonly Opzione[]
  valore: string
  onCambia: (v: string) => void
  nota?: React.ReactNode
}) {
  return (
    <div className={`min-w-0 ${LARGHEZZA[id]}`}>
      <label htmlFor={`${idBase}-${id}`} className="block text-[11px] text-tenue">{etichetta}</label>
      <Scelta
        id={`${idBase}-${id}`}
        etichetta={etichetta}
        name={id}
        data-fuoco={id}
        opzioni={voci}
        valore={valore}
        onCambia={onCambia}
        className="mt-1 w-full"
      />
      {nota}
    </div>
  )
}

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
  const daRiprendere = useRef<Segno | null>(null)
  // Il Tab che si sta premendo nella barra, se c'e' (1, o -1 con
  // Maiuscolo): un menu aperto lo usa per scegliere, e vai() arriva prima
  // che il focus si sposti (fuoco-filtri.ts)
  const tabRef = useRef<0 | 1 | -1>(0)

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
      daRiprendere.current = s
      requestAnimationFrame(() => setAperta(true))
    } else if (!rimettiFuoco(barra.current, s.campo, s.tab)) {
      rimettiFuoco(barra.current, 'sort')
    }
  }, [])
  useEffect(() => {
    const s = daRiprendere.current
    if (!aperta || !s) return
    daRiprendere.current = null
    if (!rimettiFuoco(barra.current, s.campo, s.tab)) rimettiFuoco(barra.current, 'pannello')
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
      const tab = tabRef.current
      if (campo) lasciaSegno(url, { campo, aperta, ...(tab ? { tab } : {}) })
    }
    startTransition(() => {
      if (sostituisci) router.replace(url, { scroll: false })
      else router.push(url, { scroll: false })
    })
  }

  const attivi = filtriAttivi(f)
  const idPannello = `${idBase}-pannello`
  // Una carta dell'URL che qui nessuno usa resta scelta, con "0 here"
  const carteOpzioni = [...opzioni.cards]
  for (const id of f.cards) {
    if (!carteOpzioni.some((c) => c.id === id)) {
      carteOpzioni.unshift({ id, name: etichette[id] ?? null, epithet: null, type: '', class: '', thumb: null, bare: false, n: 0 })
    }
  }
  const vociTurni = useMemo(() => opzioniTurni(f.turns), [f.turns])
  const vociLeader = useMemo(() => opzioniLeader(f.leader, opzioni.leaders, etichette), [f.leader, opzioni.leaders, etichette])
  const vociMono = useMemo(() => opzioniMono(f.mono, opzioni.types), [f.mono, opzioni.types])
  const vociClasse = useMemo(() => opzioniClasse(f.cls, opzioni.classes), [f.cls, opzioni.classes])
  const vociCategoria = useMemo(() => opzioniCategoria(f.cat, opzioni.categories), [f.cat, opzioni.categories])

  return (
    <>
      <form
        ref={barra}
        method="get"
        action={`/events/${eventId}/clears`}
        onSubmit={(e) => { e.preventDefault(); vai(f) }}
        onKeyDownCapture={(e) => {
          if (e.key !== 'Tab') return
          tabRef.current = e.shiftKey ? -1 : 1
          // dopo tutto l'evento: la fase di cattura e quella di bolla sono
          // due ascoltatori di React, e fra i due girerebbe un microtask
          setTimeout(() => { tabRef.current = 0 }, 0)
        }}
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
            className={`md:hidden inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[13px] ${COL_DITO} rounded-[var(--raggio)] bg-superficie border border-campo text-inchiostro`}
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
            <CampoFiltro
              idBase={idBase} id="turns" etichetta="Max turns" voci={vociTurni} valore={f.turns != null ? String(f.turns) : ''}
              onCambia={(v) => vai({ ...f, turns: v ? Number(v) : null })}
              nota={f.turns != null && <p className="mt-1 text-[11px] text-tenue">Clears that don’t report turns are hidden.</p>}
            />
            {(opzioni.cards.length > 0 || f.cards.length > 0) && (
              <ScegliCarta opzioni={carteOpzioni} scelte={f.cards} onCambia={(cards) => vai({ ...f, cards })} />
            )}
            {(opzioni.leaders.length > 0 || f.leader) && (
              <CampoFiltro
                idBase={idBase} id="leader" etichetta="Leader" voci={vociLeader} valore={f.leader ?? ''}
                onCambia={(v) => vai({ ...f, leader: v || null })}
              />
            )}
            {(opzioni.types.length > 0 || f.mono) && (
              <CampoFiltro
                idBase={idBase} id="mono" etichetta="Type" voci={vociMono} valore={f.mono ?? ''}
                onCambia={(v) => vai({ ...f, mono: (TIPI as readonly string[]).includes(v) ? (v as TipoCarta) : null })}
              />
            )}
            {(opzioni.classes.length > 0 || f.cls) && (
              <CampoFiltro
                idBase={idBase} id="class" etichetta="Class" voci={vociClasse} valore={CLASSI.find((c) => c.id === f.cls)?.url ?? ''}
                onCambia={(v) => vai({ ...f, cls: CLASSI.find((c) => c.url === v)?.id ?? null })}
              />
            )}
            {(opzioni.categories.length > 0 || f.cat != null) && (
              <CampoFiltro
                idBase={idBase} id="cat" etichetta="Category" voci={vociCategoria} valore={f.cat != null ? String(f.cat) : ''}
                onCambia={(v) => vai({ ...f, cat: v ? Number(v) : null })}
              />
            )}
          </div>
          <div className="ml-auto">
            <CampoFiltro
              idBase={idBase} id="sort" etichetta="Sort" voci={OPZIONI_ORDINE} valore={f.sort}
              onCambia={(v) => vai({ ...f, sort: (ORDINI as readonly string[]).includes(v) ? (v as Ordine) : 'top' })}
              nota={f.sort === 'turns' && f.turns == null && (
                <p className="mt-1 text-[11px] text-tenue">Clears that don’t report turns are listed last.</p>
              )}
            />
          </div>
        </div>
        {/* Senza JavaScript: il pannello sempre aperto e un bottone per
            applicare. I menu mostrano il loro <select> vero con noscript:
            (@media (scripting: none)); la seconda regola fa lo stesso nei
            browser che quella media query non la conoscono (Safari prima
            della 17), dove senza resterebbe trasparente. */}
        <noscript>
          <style>{`@media (max-width: 767px){[id="${idPannello}"]{display:flex}}` +
            '[data-scelta-nativa]>select{position:static;opacity:1;padding-top:.375rem;padding-bottom:.375rem}' +
            '[data-scelta-nativa]>[data-scelta-valore]{display:none}'}</style>
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
