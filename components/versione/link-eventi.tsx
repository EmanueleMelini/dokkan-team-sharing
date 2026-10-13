'use client'

import Link from 'next/link'
import type { ComponentProps } from 'react'
import { useVersione } from '@/lib/versione/client'
import { homeHref } from '@/lib/urls'

/**
 * Il link alla home degli eventi della versione scelta: /events sul
 * server (l'HTML in cache e' uguale per tutti), /events/japan dopo
 * l'idratazione per chi ha scelto Japan. Risparmia il 307 sul clic piu'
 * frequente; un clic prima dell'idratazione arriva comunque giusto, col
 * redirect di next.config.ts.
 */
export function LinkEventi(props: Omit<ComponentProps<typeof Link>, 'href'>) {
  const versione = useVersione()
  return <Link {...props} href={homeHref(versione ?? 'global')} />
}
