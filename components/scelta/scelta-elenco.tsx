'use client'

import {
  useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type KeyboardEvent, type RefObject,
} from 'react'
import { Combobox, ComboboxButton, ComboboxInput, ComboboxOption, ComboboxOptions } from '@headlessui/react'
import { CaretDown, Check } from '@phosphor-icons/react/dist/ssr'
import {
  RIGA_MOUSE, RIGA_TOCCO, SOGLIA_TASTIERA, SOGLIA_VIRTUALE,
  annuncioRisultati, filtraOpzioni, posizionePannello, ricercaScritta, sceltaDaTasto, sceltaVisibile, sopraLeCoperture, spazi,
  testoCampo, valoreScelto, voceMossa, type Opzione, type Riquadro,
} from '@/lib/scelta'
import {
  CAMPO, CAMPO_BASE, ELENCO, ELENCO_VIRTUALE, FRECCIA, FRECCIA_BASE, PANNELLO, PANNELLO_LARGO, PANNELLO_VIRTUALE, PUNTO, PUNTO_BASE,
  RIGA, RIGA_DETTAGLIO, RIGA_NOTA, RIGA_SPUNTA, RIGA_TESTO, SCATOLA, SCATOLA_BASE, VALORE, VALORE_BASE, VUOTO,
} from '@/components/scelta/stile'
import type { PropsInterne } from '@/components/scelta/scelta'

/*
 * Il combobox di Headless UI 2 (il pattern combobox di WAI-ARIA: si
 * scrive per filtrare, frecce, Home/End, Invio, Esc, Tab), l'unico file
 * che importa la libreria: arriva in un chunk suo (scelta.tsx).
 *
 * Le scelte che contano, viste nel sorgente della 2.2.10:
 *   - niente anchor: con anchor l'elenco va in un portale sul <body>, e
 *     dentro un <dialog> aperto con showModal() (il picker delle carte,
 *     l'editor della build) finirebbe sotto il top layer, inerte. Il
 *     pannello sta nella scatola, e dove aprirlo lo decide
 *     posizionePannello (lib/scelta.ts);
 *   - modal={false}: con modal (il difetto) bloccherebbe lo scroll e
 *     renderebbe inerte il resto della pagina mentre e' aperto;
 *   - niente immediate: il focus da programma (il focus che torna ai
 *     filtri dopo un cambio di route, il primo campo dell'editor) non apre
 *     l'elenco;
 *   - i valori sono stringhe, e name mette un <input type="hidden"> con lo
 *     stesso name=value del <select> di prima;
 *   - svuotare il campo per scrivere manda onChange(null): valoreScelto lo
 *     ignora, se no i filtri andrebbero su "Any" mentre si scrive;
 *   - Invio a elenco chiuso Headless non lo usa, e in un form farebbe
 *     partire l'invio (il builder e' una Server Action): qui si ferma;
 *   - Esc a elenco aperto chiude solo l'elenco (Headless ferma l'evento),
 *     quindi un <dialog> resta aperto; a elenco chiuso chiude il dialog;
 *   - Invio e Tab a elenco aperto, per Headless, scelgono la voce attiva
 *     anche quando l'ha evidenziata lui (la prima, dopo un Backspace che
 *     svuota il campo): qui scelgono solo quella a cui si e' arrivati con
 *     le frecce o scrivendo (sceltaDaTasto). Il nostro onKeyDown gira prima
 *     del suo, nello stesso evento: alza fermoRef, e onChange non passa niente.
 *
 * q e' la ricerca scritta, null finche' non si scrive (di nuovo null a
 * ogni chiusura): intatto, il campo mostra la voce scelta.
 */
export default function SceltaElenco(props: PropsInterne) {
  const { opzioni, valore, onCambia, name, disabled } = props
  const [q, setQ] = useState<string | null>(null)
  const cercata = useDeferredValue(q) ?? ''
  const filtrate = useMemo(() => filtraOpzioni(opzioni, cercata), [opzioni, cercata])
  const virtuale = opzioni.length > SOGLIA_VIRTUALE
  // Headless vuole i valori stessi nell'elenco virtuale: le stringhe
  const valori = useMemo(() => filtrate.map((o) => o.valore), [filtrate])
  const virtual = useMemo(() => (virtuale ? { options: valori } : null), [virtuale, valori])
  const scelta = sceltaVisibile(opzioni, valore)
  // mossaRef: la voce attiva ce l'hanno portata le frecce (voceMossa).
  // fermoRef: l'Invio o il Tab di questo momento non sceglie (sceltaDaTasto)
  const mossaRef = useRef(false)
  const fermoRef = useRef(false)

  // <Activity> tiene montata la pagina che si lascia: la ricerca scritta non resta li'
  useEffect(() => () => setQ(null), [])

  return (
    <Combobox
      value={scelta?.valore ?? valore}
      onChange={(v: string | null) => {
        if (fermoRef.current) return
        const x = valoreScelto(v, valore, opzioni)
        if (x !== null) onCambia(x)
      }}
      onClose={() => {
        mossaRef.current = voceMossa(mossaRef.current, { chiuso: true })
        setQ(null)
      }}
      name={name}
      disabled={disabled}
      virtual={virtual}
    >
      {({ open }) => (
        <Corpo {...props} open={open} q={q} cercata={cercata} filtrate={filtrate} virtuale={virtuale} onScrivi={setQ}
          mossaRef={mossaRef} fermoRef={fermoRef} />
      )}
    </Combobox>
  )
}

function Corpo({
  id, etichetta, opzioni, valore, misura = 'normale', className = '', aggancia,
  'aria-describedby': descritto, 'data-fuoco': fuoco,
  open, q, cercata, filtrate, virtuale, onScrivi, mossaRef, fermoRef,
}: PropsInterne & {
  open: boolean
  q: string | null
  cercata: string
  filtrate: readonly Opzione[]
  virtuale: boolean
  onScrivi: (q: string) => void
  mossaRef: RefObject<boolean>
  fermoRef: RefObject<boolean>
}) {
  const scatola = useRef<HTMLDivElement>(null)
  const pannello = useRef<HTMLDivElement>(null)
  const campo = useRef<HTMLInputElement | null>(null)
  const scelta = sceltaVisibile(opzioni, valore)
  const mostrato = scelta ? testoCampo(scelta) : ''
  const intatto = q === null
  const perValore = useMemo(() => new Map(opzioni.map((o) => [o.valore, o])), [opzioni])
  const lunga = opzioni.length > SOGLIA_TASTIERA

  const collega = useCallback((el: HTMLInputElement | null) => {
    campo.current = el
    aggancia?.(el)
  }, [aggancia])

  usePannello(open, scatola, pannello)

  // Finche' non si scrive il testo del campo e' selezionato, e il primo
  // tasto lo sostituisce, comunque ci si arrivi: Tab, il clic
  // sull'etichetta, il focus da programma (onFocus), l'elenco che si apre,
  // e con il focus ancora qui dopo una scelta, dopo Esc o quando il valore
  // cambia (la route dei filtri che torna). Headless riscrive il campo in
  // un suo effetto, che gira prima di questo, e quando il bottone gli
  // rimette il focus sposta il cursore in fondo: si seleziona al frame
  // dopo. Non col dito su un elenco corto, dove la tastiera non c'e' e la
  // selezione sarebbe solo rumore; li' (una tastiera fisica), e dove la
  // selezione si perde lo stesso, il tasto lo sistema ricercaScritta.
  useEffect(() => {
    const c = campo.current
    if (!intatto || !c || document.activeElement !== c || senzaTastiera(lunga)) return
    const giro = requestAnimationFrame(() => {
      if (document.activeElement === c) selezionaTutto(c)
    })
    return () => cancelAnimationFrame(giro)
  }, [intatto, open, mostrato, lunga])

  // Quante voci restano, per i lettori di schermo: dopo una pausa nello scrivere
  const annuncio = open ? annuncioRisultati(filtrate.length, cercata) : ''
  const [detto, setDetto] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDetto(annuncio), 400)
    return () => clearTimeout(t)
  }, [annuncio])
  // una pagina nascosta da <Activity> non tiene un conteggio vecchio
  useEffect(() => () => setDetto(''), [])

  // I tasti nel campo, prima di Headless (lo stesso evento: un
  // preventDefault qui ferma il suo gestore)
  const tasto = (e: KeyboardEvent<HTMLInputElement>) => {
    const c = e.currentTarget
    const aperto = c.getAttribute('aria-expanded') === 'true'
    const componendo = e.nativeEvent.isComposing
    // Invio a elenco chiuso Headless non lo usa, e in un form partirebbe l'invio
    if (e.key === 'Enter' && !componendo && !aperto) {
      e.preventDefault()
      return
    }
    // Invio o Tab su una voce che nessuno ha scelto: si chiude e basta
    // (con Tab il focus va avanti come sempre), il valore resta quello
    if (((e.key === 'Enter' && !componendo) || e.key === 'Tab') && aperto && !sceltaDaTasto(mossaRef.current, q)) {
      fermoRef.current = true
      queueMicrotask(() => { fermoRef.current = false })
      return
    }
    // Backspace o Canc sulla voce mostrata, a elenco aperto: il campo si
    // svuota qui, senza Headless, che per un campo vuoto toglierebbe la
    // voce attiva e farebbe evidenziare la prima. Cosi' resta quella di
    // prima, e l'elenco intero sotto. A elenco chiuso passa da
    // ricercaScritta, e l'elenco si apre sulla voce scelta.
    if ((e.key === 'Backspace' || e.key === 'Delete') && !componendo && aperto && intatto && mostrato !== '') {
      e.preventDefault()
      c.value = ''
      mossaRef.current = voceMossa(mossaRef.current, { ricerca: '' })
      onScrivi('')
      return
    }
    mossaRef.current = voceMossa(mossaRef.current, { tasto: e.key, aperto, shift: e.shiftKey })
  }

  // La chiave cambia con la ricerca: le voci che passano in cima (quelle
  // che cominciano con la parola scritta) si registrano di nuovo, e
  // Headless, che le ordina per posizione nel DOM solo quando arrivano,
  // evidenzia davvero la prima. Cambia anche quando il campo si svuota
  // (q da null a ''): rientrando, la voce scelta torna quella attiva, come
  // la evidenzia l'elenco appena aperto, e non resta dov'era.
  // L'elenco virtuale va per indice e non ne ha bisogno.
  const scritta = q === null ? '' : '\u0001'
  const riga = (o: Opzione) => (
    <ComboboxOption key={virtuale ? o.valore : `${scritta}${cercata}\u0000${o.valore}`} value={o.valore} className={RIGA}>
      {o.tipo && PUNTO[o.tipo] && <span aria-hidden="true" className={`${PUNTO_BASE} ${PUNTO[o.tipo]}`} />}
      <span className={RIGA_TESTO}>
        <span className="block">{spazi(o.testo)}</span>
        {o.dettaglio && <span className={RIGA_DETTAGLIO}>{spazi(o.dettaglio)}</span>}
      </span>
      {o.nota && (o.notaSr ? (
        <>
          <span aria-hidden="true" className={RIGA_NOTA}>{o.nota}</span>
          <span className="sr-only">{`, ${o.notaSr}`}</span>
        </>
      ) : <span className={RIGA_NOTA}>{o.nota}</span>)}
      <Check size={12} weight="bold" aria-hidden className={RIGA_SPUNTA} />
    </ComboboxOption>
  )

  return (
    <div
      ref={scatola}
      data-scelta-elenco=""
      data-open={open ? '' : undefined}
      className={`${SCATOLA_BASE} ${SCATOLA[misura]} ${className}`}
    >
      <ComboboxInput
        id={id}
        ref={collega}
        data-fuoco={fuoco}
        aria-describedby={descritto}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        // Poche voci: sul telefono si sceglie col dito, senza la tastiera
        // che coprirebbe l'elenco. Una tastiera fisica filtra lo stesso.
        inputMode={lunga ? undefined : 'none'}
        displayValue={(v: string) => {
          const o = sceltaVisibile(opzioni, v)
          return o ? testoCampo(o) : ''
        }}
        onFocus={(e) => {
          if (intatto && !senzaTastiera(lunga)) selezionaTutto(e.currentTarget)
        }}
        onChange={(e) => {
          const ev = e.nativeEvent as InputEvent
          if (!ev.isComposing) {
            const v = ricercaScritta(e.target.value, mostrato, intatto, ev.inputType?.startsWith('delete') === true)
            if (v !== e.target.value) e.target.value = v
          }
          mossaRef.current = voceMossa(mossaRef.current, { ricerca: e.target.value })
          onScrivi(e.target.value)
        }}
        onKeyDown={tasto}
        // il testo del campo si vede solo da quando si scrive (data-scritto);
        // prima c'e' il valore sotto, e la selezione non si disegna sopra.
        // Coi colori forzati il testo trasparente tornerebbe visibile, in una
        // riga sola tagliata sopra il valore che va a capo: finche' non si
        // scrive il campo resta fuori dai colori forzati (forced-color-adjust:
        // none), con il cursore del sistema
        data-scritto={intatto ? undefined : ''}
        // col dito su un elenco corto la tastiera non c'e': nemmeno il cursore
        className={`peer ${CAMPO_BASE} ${CAMPO[misura]} text-transparent caret-inchiostro not-data-scritto:selection:bg-transparent ` +
          'data-scritto:text-inchiostro forced-colors:not-data-scritto:forced-color-adjust-none forced-colors:caret-[color:CanvasText] ' +
          (lunga ? '' : 'pointer-coarse:caret-transparent')}
      />
      {/* Il valore come nel <select> di prima del cambio: va a capo, e da'
          l'altezza. Resta anche col focus e a elenco aperto, e coi colori
          forzati, finche' non si scrive: un nome lungo non si stringe in
          una riga tagliata. Poi c'e' il campo. */}
      <span
        aria-hidden="true"
        className={`${VALORE_BASE} ${VALORE[misura]} ${scelta?.valore === '' ? 'text-tenue' : ''} peer-data-scritto:invisible`}
      >
        {mostrato}
      </span>
      {/* Chiuso copre tutta la scatola (un clic ovunque apre); aperto resta
          solo sulla freccia, e nel campo si puo' mettere il cursore. */}
      <ComboboxButton className={`absolute inset-y-0 right-0 cursor-default rounded-[inherit] outline-none ${open ? 'w-8' : 'left-0'}`}>
        <span className="sr-only">{etichetta}</span>
        <CaretDown
          size={12}
          weight="bold"
          aria-hidden
          className={`${FRECCIA_BASE} ${FRECCIA[misura]} ${open ? 'rotate-180' : ''}`}
        />
      </ComboboxButton>
      {open && (
        <div
          ref={pannello}
          // un clic sul pannello (il bordo, "No results") non toglie il focus al campo
          onMouseDown={(e) => e.preventDefault()}
          className={`${PANNELLO} ${virtuale ? PANNELLO_VIRTUALE : PANNELLO_LARGO}`}
        >
          <ComboboxOptions
            modal={false}
            className={virtuale ? `${ELENCO} ${ELENCO_VIRTUALE}` : ELENCO}
            style={virtuale ? ({ '--scelta-n': filtrate.length } as CSSProperties) : undefined}
          >
            {virtuale
              ? ({ option }: { option: string }) => riga(perValore.get(option) ?? { valore: option, testo: option })
              : filtrate.map(riga)}
          </ComboboxOptions>
          {filtrate.length === 0 && <p className={VUOTO}>No results</p>}
        </div>
      )}
      <span role="status" className="sr-only">{detto}</span>
    </div>
  )
}

/** Col dito su un elenco corto: niente tastiera (inputMode none), niente selezione. */
const senzaTastiera = (lunga: boolean) => !lunga && window.matchMedia('(pointer: coarse)').matches
const selezionaTutto = (c: HTMLInputElement) => c.setSelectionRange(0, c.value.length)

/**
 * Quello che si vede davvero: il visualViewport (senza la tastiera) dentro
 * ogni antenato che taglia, e sopra cio' che sta fisso in fondo
 * ([data-copre-fondo], l'invito a installare l'app, z-40). Non dentro un
 * <dialog> aperto, che sta nel top layer sopra a tutto.
 */
function limiteVisibile(da: HTMLElement): Riquadro {
  const vv = window.visualViewport
  const r: Riquadro = vv
    ? { top: vv.offsetTop, left: vv.offsetLeft, bottom: vv.offsetTop + vv.height, right: vv.offsetLeft + vv.width }
    : { top: 0, left: 0, bottom: window.innerHeight, right: window.innerWidth }
  for (let n = da.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
    const s = getComputedStyle(n)
    if (s.display === 'contents' || (s.overflowX === 'visible' && s.overflowY === 'visible')) continue
    const b = n.getBoundingClientRect()
    r.top = Math.max(r.top, b.top)
    r.bottom = Math.min(r.bottom, b.bottom)
    r.left = Math.max(r.left, b.left)
    r.right = Math.min(r.right, b.right)
  }
  if (da.closest('dialog[open]')) return r
  const coperture = [...document.querySelectorAll<HTMLElement>('[data-copre-fondo]')].map((el) => el.getBoundingClientRect())
  return sopraLeCoperture(r, coperture)
}

/**
 * Dove si apre il pannello, scritto direttamente nel DOM prima del paint
 * (data-verso, data-lato, --scelta-max-h, --scelta-max-w): niente stato,
 * niente render in piu'. Si rifa' quando il visualViewport cambia (la
 * tastiera di iOS non manda il resize della finestra), al piu' una volta
 * per frame. Se ne' sopra ne' sotto c'e' posto, il campo sale una volta
 * in cima a quello che si vede, e si rifa' il conto.
 */
function usePannello(open: boolean, scatola: RefObject<HTMLDivElement | null>, pannello: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    if (!open) return
    let giro = 0
    let salito = false
    const calcola = () => {
      const b = scatola.current
      const p = pannello.current
      if (!b || !p) return
      const lista = p.querySelector<HTMLElement>('[role="listbox"]')
      // la larghezza che vorrebbe, senza il tetto del conto di prima
      p.style.setProperty('--scelta-max-w', '9999px')
      const pos = posizionePannello({
        campo: b.getBoundingClientRect(),
        limite: limiteVisibile(b),
        larghezza: p.offsetWidth,
        altezza: (lista?.scrollHeight ?? 0) + (p.offsetHeight - (lista?.offsetHeight ?? 0)),
        riga: window.matchMedia('(pointer: coarse)').matches ? RIGA_TOCCO : RIGA_MOUSE,
      })
      if (pos.scorri && !salito) {
        salito = true
        b.scrollIntoView({ block: 'start' })
        giro = requestAnimationFrame(calcola)
        return
      }
      p.dataset.verso = pos.verso
      p.dataset.lato = pos.lato
      p.style.setProperty('--scelta-max-h', `${pos.altezzaMax}px`)
      p.style.setProperty('--scelta-max-w', `${pos.larghezzaMax}px`)
    }
    calcola()
    const pianifica = () => {
      cancelAnimationFrame(giro)
      giro = requestAnimationFrame(calcola)
    }
    const vv = window.visualViewport
    vv?.addEventListener('resize', pianifica)
    vv?.addEventListener('scroll', pianifica)
    window.addEventListener('resize', pianifica)
    return () => {
      cancelAnimationFrame(giro)
      vv?.removeEventListener('resize', pianifica)
      vv?.removeEventListener('scroll', pianifica)
      window.removeEventListener('resize', pianifica)
    }
  }, [open, scatola, pannello])
}
