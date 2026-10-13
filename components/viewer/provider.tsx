'use client'

import {
  createContext, startTransition, useCallback, useContext, useEffect, useMemo, useRef, useState,
  useSyncExternalStore, type ReactNode,
} from 'react'
import { usePathname } from 'next/navigation'
import { HINT_COOKIE, hasHint } from '@/lib/viewer/hint'
import { modeOf, type MeResponse, type ViewerMode, type ViewerTierData, type ViewerUser } from '@/lib/viewer/types'
import { setThemeAction, setVersionAction } from '@/lib/auth/actions'
import { applicaTema, temaAttuale, temaLocale } from '@/lib/tema/client'
import { riconciliaTema, temaDaAccount, type TemaId } from '@/lib/tema/temi'
import { applicaVersione, riallineamentoFatto, segnaRiallineamento, versioneAttuale } from '@/lib/versione/client'
import { ERRORE_VERSIONE, eRedirect, quiPerCambio, versioneDaRiconciliare } from '@/lib/versione/interruttore'
import type { Versione } from '@/lib/versione/versione'

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
  /** un salvataggio del tema parte o finisce: intanto /api/me puo' dire ancora quello vecchio */
  beginTema: () => void
  endTema: () => void
  /** il pallino delle notifiche, aggiornato da /notifications senza chiedere /api/me */
  setUnread: (unread: boolean) => void
  /** un cambio di versione parte o finisce: intanto /api/me puo' dire ancora quella vecchia */
  beginVersione: () => void
  endVersione: () => void
  /** l'account ha cambiato versione: la copia di /api/me qui la segue, e il riallineamento non la rimette */
  segnaReg: (reg: Versione) => void
}

const RootContext = createContext<Interno | null>(null)
const TierContext = createContext<ViewerTierData | null>(null)
/** segna come suo un commento appena scritto: /api/me non lo sa ancora */
const SegnaCommentoContext = createContext<(id: string) => void>(() => {})
/** lo stesso per una tip appena scritta: Edit e Delete subito, niente voto */
const SegnaTipContext = createContext<(id: string) => void>(() => {})

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

  // Il tema dell'account (0027) vince su quello di questo dispositivo: se
  // /api/me ne porta uno diverso lo si applica e lo si ricorda, cosi' dal
  // caricamento dopo lo script del <head> lo mette gia' prima del paint.
  // Tranne un account ancora su System davanti a una scelta fatta qui prima
  // di entrare: quella resta e va sull'account (riconciliaTema).
  // Non mentre un salvataggio e' in corso: la risposta puo' essere di prima.
  const salvataggiTema = useRef(0)
  const beginTema = useCallback(() => { salvataggiTema.current++ }, [])
  const endTema = useCallback(() => { salvataggiTema.current-- }, [])
  const temaAccount = hint && user ? temaDaAccount(user.theme) : undefined
  const completo = user?.onboarded === true
  useEffect(() => {
    if (salvataggiTema.current > 0) return
    const passo = riconciliaTema(temaAccount, temaLocale(), temaAttuale(), completo)
    if (passo && 'salva' in passo) {
      salvataggiTema.current++
      setThemeAction(passo.salva).catch(() => {}).finally(() => { salvataggiTema.current-- })
    } else if (passo) applicaTema(passo.applica)
  }, [temaAccount, completo])

  // La versione dell'account (app_user.reg, 0035) vince su quella di
  // questo dispositivo, come il tema: se /api/me ne porta una diversa la si
  // rimette con setVersionAction, che scrive il cookie (lo fa solo il
  // server) e porta al gemello se la pagina era arrivata da un link senza
  // versione. Una volta per scheda, mai durante un cambio, e /api/me non
  // scrive mai il cookie: una risposta vecchia non disfa un cambio appena
  // fatto. Chi non ha finito l'onboarding tiene la scelta del dispositivo.
  const salvataggiVersione = useRef(0)
  const beginVersione = useCallback(() => { salvataggiVersione.current++ }, [])
  const endVersione = useCallback(() => { salvataggiVersione.current-- }, [])
  const segnaReg = useCallback((reg: Versione) => {
    setUser((u) => (u && u.reg !== reg ? { ...u, reg } : u))
  }, [])
  const regAccount = hint && completo ? user?.reg : undefined
  useEffect(() => {
    const v = versioneDaRiconciliare({
      account: regAccount, attuale: versioneAttuale(), inCorso: salvataggiVersione.current > 0, fatta: riallineamentoFatto(),
    })
    if (!v) return
    segnaRiallineamento()
    startTransition(async () => {
      await cambiaVersioneQui(v, true, { beginVersione, endVersione, segnaReg })
    })
  }, [regAccount, beginVersione, endVersione, segnaReg])

  const reload = useCallback(() => { avvisa(); setGiro((n) => n + 1) }, [])
  // La lista ha appena segnato lette le notifiche mostrate: l'header e' nel
  // layout e non si rimonta con la navigazione, quindi il pallino si spegne
  // qui, senza un'altra richiesta a /api/me.
  const setUnread = useCallback((unread: boolean) => {
    setUser((u) => (u && u.unread !== unread ? { ...u, unread } : u))
  }, [])
  const reset = useCallback(() => {
    document.cookie = `${HINT_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`
    setUser(null)
    avvisa()
  }, [])

  const value = useMemo<Interno>(() => {
    const mode: ViewerMode = hint === null ? 'unknown' : !hint ? 'anon' : user === undefined ? 'unknown' : modeOf(user)
    return {
      mode, user: hint ? (user ?? null) : null, reload, reset, hint, beginScoped, endScoped, receive: setUser,
      beginTema, endTema, setUnread, beginVersione, endVersione, segnaReg,
    }
  }, [hint, user, reload, reset, beginScoped, endScoped, beginTema, endTema, setUnread, beginVersione, endVersione, segnaReg])

  return <RootContext.Provider value={value}>{children}</RootContext.Provider>
}

/** Chi guarda: mode, user, reload, reset. Fuori dal provider: anonimo. */
export function useViewer(): Root {
  const ctx = useContext(RootContext)
  return ctx ?? { mode: 'anon', user: null, reload: () => {}, reset: () => {} }
}

/**
 * Cambia il tema: subito nel browser (attributo e localStorage), poi, per
 * chi ha un account completo, sull'account senza aspettare la risposta.
 * Un salvataggio fallito lascia il tema su questo dispositivo.
 */
export function useCambiaTema(): (id: TemaId) => void {
  const ctx = useContext(RootContext)
  const pronto = ctx?.mode === 'ready'
  const beginTema = ctx?.beginTema
  const endTema = ctx?.endTema
  return useCallback((id: TemaId) => {
    applicaTema(id)
    if (!pronto || !beginTema || !endTema) return
    beginTema()
    setThemeAction(id).catch(() => {}).finally(endTema)
  }, [pronto, beginTema, endTema])
}

export type EsitoCambioVersione =
  | { saved: 'account' | 'device' }
  | { navigato: true }
  | { error: string }

type PassiVersione = Pick<Interno, 'beginVersione' | 'endVersione' | 'segnaReg'>

/**
 * Il cambio di versione da questa pagina: setVersionAction scrive il
 * cookie (e l'account) e, se la pagina e' dell'altra versione, porta al
 * gemello (quiPerCambio). Senza navigazione l'attributo data-reg si mette
 * qui, quando l'azione ha risposto e non prima: la pagina di adesso non
 * mostra per un attimo l'avviso dell'altra versione. Con la navigazione lo
 * rimette SeguiVersione al cambio di URL, nello stesso commit della
 * pagina nuova.
 *
 * prima: subito prima di mettere l'attributo, solo se l'azione e' riuscita
 * e si resta qui ("Use ... everywhere" sposta il focus fuori dall'avviso,
 * che l'attributo nasconde).
 */
async function cambiaVersioneQui(
  v: Versione, riconcilia: boolean, passi: PassiVersione, prima?: () => void,
): Promise<EsitoCambioVersione> {
  const qui = `${location.pathname}${location.search}`
  passi.beginVersione()
  try {
    const r = await setVersionAction(v, quiPerCambio(qui, v, riconcilia))
    if (r.error) return { error: r.error }
    prima?.()
    applicaVersione(v)
    if (r.saved === 'account') passi.segnaReg(v)
    return { saved: r.saved ?? 'device' }
  } catch (e) {
    // Il redirect al gemello arriva come rifiuto, gia' gestito dal router:
    // rilanciato, il router navigherebbe una seconda volta.
    if (!eRedirect(e)) return { error: ERRORE_VERSIONE }
    passi.segnaReg(v)
    return { navigato: true }
  } finally {
    passi.endVersione()
  }
}

const nessunPasso: PassiVersione = { beginVersione: () => {}, endVersione: () => {}, segnaReg: () => {} }

/**
 * Cambia la versione del sito (l'interruttore del menu, dell'header e di
 * Settings, e "Use ... everywhere" degli avvisi). Una scelta fatta qui
 * vale come riallineamento: da li' in poi il provider non rimette quella
 * dell'account in questa scheda. prima: come in cambiaVersioneQui.
 */
export function useCambiaVersione(): (v: Versione, prima?: () => void) => Promise<EsitoCambioVersione> {
  const ctx = useContext(RootContext)
  const beginVersione = ctx?.beginVersione
  const endVersione = ctx?.endVersione
  const segnaReg = ctx?.segnaReg
  return useCallback((v: Versione, prima?: () => void) => {
    segnaRiallineamento()
    const passi = beginVersione && endVersione && segnaReg ? { beginVersione, endVersione, segnaReg } : nessunPasso
    return cambiaVersioneQui(v, false, passi, prima)
  }, [beginVersione, endVersione, segnaReg])
}

/** Accende o spegne il pallino delle notifiche nell'header (solo in questa scheda). */
export function useSetUnread(): (unread: boolean) => void {
  const ctx = useContext(RootContext)
  return ctx?.setUnread ?? nessuno
}
const nessuno = () => {}

/** Lo stato del tier mostrato (voti, propri clear e commenti, punteggi), o null. */
export const useViewerTier = () => useContext(TierContext)

/**
 * Dopo un commento riuscito: la pagina si rigenera con il commento nuovo,
 * ma lo stato del tier e' di prima. Senza questo il proprio commento
 * avrebbe il bottone Report fino alla prossima pagina vista.
 */
export const useSegnaCommentoMio = () => useContext(SegnaCommentoContext)

/** Dopo una tip riuscita: come useSegnaCommentoMio, per ownTips. */
export const useSegnaTipMia = () => useContext(SegnaTipContext)

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

  // i commenti e le tip scritti da questa pagina, per tier: si aggiungono
  // a ownComments e ownTips
  const [nuovi, setNuovi] = useState<{ tier: string; ids: string[]; tips: string[] }>({ tier: tierId, ids: [], tips: [] })
  const segna = useCallback((id: string) => {
    setNuovi((n) => (n.tier === tierId ? { ...n, ids: [...n.ids, id] } : { tier: tierId, ids: [id], tips: [] }))
  }, [tierId])
  const segnaTip = useCallback((id: string) => {
    setNuovi((n) => (n.tier === tierId ? { ...n, tips: [...n.tips, id] } : { tier: tierId, ids: [], tips: [id] }))
  }, [tierId])

  const data = useMemo(() => {
    const base = stato && stato.tier === tierId ? stato.data : null
    const extra = nuovi.tier === tierId ? nuovi.ids : []
    const tips = nuovi.tier === tierId ? nuovi.tips : []
    if (!base || (!extra.length && !tips.length)) return base
    return {
      ...base,
      ownComments: [...(base.ownComments ?? []), ...extra],
      ownTips: [...(base.ownTips ?? []), ...tips],
    }
  }, [stato, nuovi, tierId])
  return (
    <TierContext.Provider value={data}>
      <SegnaCommentoContext.Provider value={segna}>
        <SegnaTipContext.Provider value={segnaTip}>{children}</SegnaTipContext.Provider>
      </SegnaCommentoContext.Provider>
    </TierContext.Provider>
  )
}
