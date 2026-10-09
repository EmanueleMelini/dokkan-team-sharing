'use client'

import { useEffect } from 'react'
import { useSetUnread } from '@/components/viewer/provider'

/**
 * Nella pagina /notifications: il server ha appena segnato lette quelle
 * mostrate e dice se il pallino resta acceso (piu' di 50 non lette). Qui
 * lo si riporta all'header, che e' nel layout e non rilegge /api/me a ogni
 * navigazione. Non rende niente.
 */
export function SegnaViste({ unread }: { unread: boolean }) {
  const setUnread = useSetUnread()
  useEffect(() => { setUnread(unread) }, [unread, setUnread])
  return null
}
