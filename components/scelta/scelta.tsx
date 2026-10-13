'use client'

import { useCallback, useEffect, useState, useSyncExternalStore, type ComponentType, type Ref } from 'react'
import type { Opzione } from '@/lib/scelta'
import type { Misura } from '@/components/scelta/stile'
import { SceltaNativa } from '@/components/scelta/scelta-nativa'

export type PropsScelta = {
  /** l'id del campo: il <label htmlFor> del chiamante resta il suo nome */
  id: string
  /** il testo dell'etichetta visibile: il nome del bottone e dell'elenco per i lettori di schermo */
  etichetta: string
  opzioni: readonly Opzione[]
  valore: string
  /** mai con null, mai con il valore che c'e' gia' */
  onCambia: (valore: string) => void
  /** solo nei form che partono davvero (i filtri GET): il campo nascosto con lo stesso name=value */
  name?: string
  misura?: Misura
  /** larghezza e margini */
  className?: string
  disabled?: boolean
  'aria-describedby'?: string
  'data-fuoco'?: string
  /** il campo: il <select> prima del cambio, l'<input> dopo */
  ref?: Ref<HTMLInputElement | HTMLSelectElement>
}

/** Le props delle due forme: il ref arriva come callback, valido per tutte e due. */
export type PropsInterne = Omit<PropsScelta, 'ref'> & {
  aggancia?: (el: HTMLInputElement | HTMLSelectElement | null) => void
}

/*
 * Il combobox (scelta-elenco.tsx, l'unico file che importa Headless UI)
 * sta in un chunk suo, caricato quando il browser e' libero dopo il primo
 * menu montato: il footer ne ha uno su ogni pagina, e cosi' Headless non
 * entra nel JavaScript del primo caricamento di nessuna. Finche' non c'e',
 * e sempre sul server e all'idratazione, si vede il <select> nativo
 * (scelta-nativa.tsx), con la stessa scatola: il cambio non sposta niente.
 *
 * Il modulo caricato e' uno store esterno (useSyncExternalStore): niente
 * Suspense, quindi il <select> dell'HTML resta lo stesso nodo fino al
 * cambio, e dopo il primo caricamento le pagine nuove montano subito il
 * combobox. Un <select> che ha il focus non si cambia sotto le dita (un
 * menu del browser aperto si chiuderebbe, il focus andrebbe perso): il
 * cambio aspetta che lo lasci.
 */
let Elenco: ComponentType<PropsInterne> | null = null
let carico: Promise<void> | null = null
let avviato = false
const ascoltatori = new Set<() => void>()

function carica(): Promise<void> {
  carico ??= import('@/components/scelta/scelta-elenco').then(
    (m) => {
      Elenco = m.default
      ascoltatori.forEach((f) => f())
    },
    () => {
      // Senza rete resta il <select>, che funziona: si riprova al prossimo menu montato
      carico = null
      avviato = false
    },
  )
  return carico
}

function preparaElenco() {
  if (avviato || Elenco) return
  avviato = true
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(() => void carica(), { timeout: 2000 })
  else setTimeout(() => void carica(), 200)
}

function iscrivi(f: () => void) {
  ascoltatori.add(f)
  return () => { ascoltatori.delete(f) }
}
const elencoPronto = () => Elenco !== null
const sulServer = () => false

/**
 * Un menu a scelta con la ricerca: si scrive per filtrare le voci. Al
 * posto di ogni <select> del sito; la sezione "Menu a scelta" del README
 * dice come e perche'.
 */
export function Scelta({ ref, ...props }: PropsScelta) {
  const pronto = useSyncExternalStore(iscrivi, elencoPronto, sulServer)
  const [inUso, setInUso] = useState(false)
  useEffect(preparaElenco, [])
  // Un callback solo per i due campi: il ref del chiamante segue quello montato
  const aggancia = useCallback((el: HTMLInputElement | HTMLSelectElement | null) => {
    if (typeof ref === 'function') ref(el)
    else if (ref) ref.current = el
  }, [ref])
  if (pronto && !inUso && Elenco) return <Elenco {...props} aggancia={aggancia} />
  return (
    <SceltaNativa
      {...props}
      aggancia={aggancia}
      onFocus={() => setInUso(true)}
      // Il focus che esce dalla finestra (un'altra scheda) non conta: il <select> resta quello attivo
      onBlur={(e) => { if (document.activeElement !== e.currentTarget || document.hasFocus()) setInUso(false) }}
    />
  )
}
