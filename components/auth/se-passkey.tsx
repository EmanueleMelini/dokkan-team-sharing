'use client'

import type { ReactNode } from 'react'
import { usePasskeySupport } from '@/lib/auth/passkey-support'

/**
 * `children` se il browser sa usare le passkey (o non lo si sa ancora, al
 * primo render), altrimenti `altrimenti`. Per le parti di una pagina del
 * server che esistono solo per il bottone della passkey.
 */
export function SePasskey({ children, altrimenti = null }: { children: ReactNode; altrimenti?: ReactNode }) {
  return usePasskeySupport() === false ? altrimenti : children
}
