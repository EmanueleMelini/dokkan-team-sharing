'use client'

import { useEffect } from 'react'
import { risincronizzaOgniGiorno } from '@/lib/notify/push-client'

/**
 * Il resync delle push dal menu, su ogni pagina di chi e' entrato: al
 * massimo una volta al giorno (o subito con un altro account sullo stesso
 * browser), e solo se questo browser ha un'iscrizione. Senza iscrizione
 * resta tutto locale: nessuna richiesta. Il service worker non ha una
 * rotta per pushsubscriptionchange: e' questo il suo posto. Non rende niente.
 */
export function PushResync({ handle }: { handle: string }) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    risincronizzaOgniGiorno(handle).catch(() => {})
  }, [handle])
  return null
}
