'use client'

import { useEffect, useRef, useState, type ComponentProps } from 'react'
import { Builder } from '@/components/builder/builder'

/**
 * Il builder che riparte vuoto dopo un invio riuscito. Con cacheComponents
 * Next tiene montate (nascoste, in <Activity>) le pagine visitate: tornando
 * indietro dopo l'invio si ritroverebbe la squadra compilata, e un secondo
 * Submit farebbe un doppione. Quando la pagina torna visibile gli effetti
 * ripartono: se l'ultimo invio non e' tornato con un errore, la key nuova
 * rimonta il builder dallo stato iniziale.
 */
export function BuilderAzzerabile(props: Omit<ComponentProps<typeof Builder>, 'onInvio'>) {
  const [giro, setGiro] = useState(0)
  const inviato = useRef(false)
  useEffect(() => {
    if (!inviato.current) return
    inviato.current = false
    setGiro((n) => n + 1)
  }, [])
  return <Builder key={giro} {...props} onInvio={(v) => { inviato.current = v }} />
}
