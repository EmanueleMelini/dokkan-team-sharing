'use client'

import { useEffect, useLayoutEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { alCambioDaFuori, rileggiVersione, testoNonInviato, useAnnuncioVersione } from '@/lib/versione/client'
import { quiPerCambio } from '@/lib/versione/interruttore'
import { gemello } from '@/lib/versione/versione'

/**
 * Nel layout, dentro un <Suspense> (legge la query): a ogni cambio di URL
 * rimette data-reg dal cookie, prima del paint della pagina nuova. Dopo
 * il cambio di versione con il gemello, il cookie e' gia' quello nuovo
 * (l'ha scritto la risposta dell'azione) e la pagina nuova arriva gia'
 * con l'interruttore e gli avvisi giusti; lo script del <head> non gira
 * sulle navigazioni del client.
 *
 * Un cambio fatto in un'altra scheda (o trovato tornando dalla bfcache):
 * qui l'azione non e' passata, e la cache del router ha ancora le pagine
 * di prima. router.refresh() la butta (e la bfcache del router), cosi' i
 * link senza versione tornano a chiedere al server e incontrano il 307.
 * La pagina arrivata da un link senza versione segue la scelta nuova, col
 * gemello gia' risolto, come col riallineamento con l'account; una
 * marcata resta, con il suo avviso. Tranne se c'e' un testo scritto e non
 * inviato (un commento a meta'): allora la pagina resta com'e', anche
 * senza refresh (che la porterebbe di la' col 307), e l'avviso la spiega.
 *
 * Porta anche la sola regione live degli annunci della versione: fuori
 * dai controlli, che possono sparire (il burger si chiude, l'avviso si
 * nasconde col CSS) proprio mentre l'annuncio parte.
 */
export function SeguiVersione() {
  const percorso = usePathname()
  const query = useSearchParams().toString()
  const router = useRouter()
  useLayoutEffect(() => { rileggiVersione() }, [percorso, query])
  useEffect(() => alCambioDaFuori((v) => {
    const qui = quiPerCambio(`${location.pathname}${location.search}`, v, true)
    const dove = qui === null ? null : gemello(qui, v)
    if (dove && testoNonInviato()) return
    router.refresh()
    if (dove) router.replace(dove)
  }), [router])
  const { testo, n } = useAnnuncioVersione()
  return (
    <p aria-live="polite" className="sr-only">
      <span key={n}>{testo}</span>
    </p>
  )
}
