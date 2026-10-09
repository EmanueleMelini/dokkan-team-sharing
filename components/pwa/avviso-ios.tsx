'use client'

import { useSyncExternalStore } from 'react'
import { leggiContesto, type Contesto } from '@/lib/pwa/installa'

const nessunCambio = () => () => {}

const elenco = (nomi: string[]) =>
  nomi.length < 2 ? nomi.join('') : `${nomi.slice(0, -1).join(', ')} or ${nomi[nomi.length - 1]}`

/**
 * Nell'app installata su iPhone e iPad il link dell'email si apre in
 * Safari, non nell'app: si entrerebbe in Safari e l'app resterebbe fuori.
 * Lo si dice solo li' (iOS e modalita' standalone), suggerendo i provider
 * attivi. Un'isola: il server non rende niente.
 */
export function AvvisoIOS({ providers, dove, className = '' }: {
  /** i nomi dei provider OAuth attivi, come li mostra la pagina */
  providers: string[]
  dove: 'login' | 'settings'
  className?: string
}) {
  const contesto = useSyncExternalStore<Contesto | null>(nessunCambio, leggiContesto, () => null)
  if (!contesto?.ios || !contesto.standalone || providers.length === 0) return null
  const nomi = elenco(providers)
  return (
    <p role="note" className={`text-[12px] leading-relaxed text-inchiostro bg-oro-tenue border border-oro-linea rounded-[var(--raggio)] px-3 py-2 ${className}`}>
      In the installed app, email sign-in links open in Safari instead of here.{' '}
      {dove === 'login' ? `Sign in with ${nomi} to stay in the app.` : `Link ${nomi} to sign in here.`}
    </p>
  )
}
