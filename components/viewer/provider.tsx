'use client'

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore,
  type ReactNode,
} from 'react'
import { usePathname } from 'next/navigation'
import { HINT_COOKIE, hasHint } from '@/lib/viewer/hint'
import { modeOf, type MeResponse, type ViewerMode, type ViewerTierData, type ViewerUser } from '@/lib/viewer/types'

// Chi guarda, lato client. Le pagine pubbliche arrivano dalla CDN uguali
// per tutti, nella versione anonima; dopo l'idratazione, se c'e'
// l'indizio dts_signed_in, una sola richiesta a /api/me porta l'utente (e,
// dentro ViewerTier, lo stato del tier). Senza indizio non parte niente:
// i visitatori anonimi e i bot non costano invocazioni.

type Root = {
  mode: ViewerMode
  user: ViewerUser | null
  /** rilegge /api/me (dopo un cambio dell'account) */
  reload: () => void
  /** anonimo subito, senza aspettare il server (uscita) */
  reset: () => void
}

type Interno = Root & {
  hint: boolean | null
  /** una richiesta con ?tier= parte o finisce: intanto la radice non ne fa una sua */
  beginScoped: () => void
  endScoped: () => void
  receive: (user: ViewerUser | null) => void
}

const RootContext = createContext<Interno | null>(null)
const TierContext = createContext<ViewerTierData | null>(null)

// L'indizio come store esterno: il server e l'idratazione vedono null
// (sconosciuto), cosi' il primo render e' identico all'HTML statico.
const ascoltatori = new Set<() => void>()
const avvisa = () => ascoltatori.forEach((f) => f())
const iscrivi = (f: () => void) => {
  ascoltatori.add(f)
  return () => { ascoltatori.delete(f) }
}
const leggiIndizio = () => hasHint(document.cookie)
const indizioServer = () => null

export async function fetchMe(tier: string | null, signal?: AbortSignal): Promise<MeResponse> {
  try {
    const r = await fetch(tier ? `/api/me?tier=${encodeURIComponent(tier)}` : '/api/me', {
      credentials: 'same-origin', cache: 'no-store', signal,
    })
    return r.ok ? ((await r.json()) as MeResponse) : { user: null }
  } catch (e) {
    if (signal?.aborted) throw e
    // Una rete che cade vale "anonimo" per questa pagina: l'indizio resta.
    return { user: null }
  }
}

export function ViewerProvider({ children }: { children: ReactNode }) {
  const hint = useSyncExternalStore(iscrivi, leggiIndizio, indizioServer)
  // undefined: non ancora chiesto
  const [user, setUser] = useState<ViewerUser | null | undefined>(undefined)
  const [giro, setGiro] = useState(0)
  const scoped = useRef(0)
  const beginScoped = useCallback(() => { scoped.current++ }, [])
  const endScoped = useCallback(() => { scoped.current-- }, [])
  const pathname = usePathname()

  useEffect(() => {
    if (hint !== true || scoped.current > 0) return
    const ctrl = new AbortController()
    fetchMe(null, ctrl.signal).then((r) => setUser(r.user), () => {})
    return () => ctrl.abort()
  }, [hint, giro])

  // Chi deve ancora scegliere l'handle lo fa in /welcome, e l'azione porta
  // altrove con un redirect: al cambio di pagina si rilegge l'utente, cosi'
  // l'header passa da "Finish setup" all'handle. Costa solo a quegli utenti.
  const inSetup = user ? !user.onboarded : false
  const primo = useRef(true)
  useEffect(() => {
    if (primo.current) { primo.current = false; return }
    if (!inSetup) return
    const ctrl = new AbortController()
    fetchMe(null, ctrl.signal).then((r) => setUser(r.user), () => {})
    return () => ctrl.abort()
  }, [pathname, inSetup])

  const reload = useCallback(() => { avvisa(); setGiro((n) => n + 1) }, [])
  const reset = useCallback(() => {
    document.cookie = `${HINT_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`
    setUser(null)
    avvisa()
  }, [])

  const value = useMemo<Interno>(() => {
    const mode: ViewerMode = hint === null ? 'unknown' : !hint ? 'anon' : user === undefined ? 'unknown' : modeOf(user)
    return { mode, user: hint ? (user ?? null) : null, reload, reset, hint, beginScoped, endScoped, receive: setUser }
  }, [hint, user, reload, reset, beginScoped, endScoped])

  return <RootContext.Provider value={value}>{children}</RootContext.Provider>
}

/** Chi guarda: mode, user, reload, reset. Fuori dal provider: anonimo. */
export function useViewer(): Root {
  const ctx = useContext(RootContext)
  return ctx ?? { mode: 'anon', user: null, reload: () => {}, reset: () => {} }
}

/** Lo stato del tier mostrato (voti, propri clear, punteggi), o null. */
export const useViewerTier = () => useContext(TierContext)

/**
 * Lo stato di chi guarda su un tier, per i clear della pagina. Il suo
 * effetto gira prima di quello della radice (React esegue prima gli
 * effetti dei figli): segna la richiesta come in corso e la radice non ne
 * fa una sua. Una richiesta per pagina vista.
 */
export function ViewerTier({ tierId, children }: { tierId: string; children: ReactNode }) {
  const root = useContext(RootContext)
  const [stato, setStato] = useState<{ tier: string; data: ViewerTierData } | null>(null)
  const hint = root?.hint ?? null
  const beginScoped = root?.beginScoped
  const endScoped = root?.endScoped
  const receive = root?.receive
  const reload = root?.reload

  useEffect(() => {
    if (hint !== true || !beginScoped || !endScoped || !receive || !reload) return
    const ctrl = new AbortController()
    let arrivato = false
    beginScoped()
    fetchMe(tierId, ctrl.signal).then((r) => {
      arrivato = true
      receive(r.user)
      setStato(r.tier ? { tier: tierId, data: r.tier } : null)
    }, () => {})
    return () => {
      endScoped()
      ctrl.abort()
      // Uscita prima della risposta: la radice non sa ancora chi guarda.
      if (!arrivato) reload()
    }
  }, [hint, tierId, beginScoped, endScoped, receive, reload])

  const data = stato && stato.tier === tierId ? stato.data : null
  return <TierContext.Provider value={data}>{children}</TierContext.Provider>
}
