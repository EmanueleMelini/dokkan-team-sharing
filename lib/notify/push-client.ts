import { resyncPushAction, subscribePushAction, unsubscribePushAction, type PushSubscriptionInput } from '@/lib/notify/push-actions'
import { etichettaDispositivo } from '@/lib/pwa/piattaforma'
import { assicuraServiceWorker } from '@/lib/pwa/registra'

// Il lato browser delle push: permesso, iscrizione, resync e uscita. Solo
// nel browser, senza React: lo usano l'isola di Settings, il resync nel
// menu e il bottone Sign out. Ogni funzione inghiotte i propri errori: un
// browser strano non deve mai rompere la pagina ne' fermare un'uscita.

/** localStorage: chi e quando ha fatto l'ultimo resync, per farne al massimo uno al giorno. */
export const RESYNC_KEY = 'dts:push-resync'
const GIORNO = 24 * 60 * 60 * 1000
/** L'uscita aspetta il server al massimo questo, poi esce comunque. */
export const USCITA_MS = 1500

const VERSIONE = process.env.NEXT_PUBLIC_SW_VERSION ?? '0'

/** Il browser sa fare le push (iOS solo nell'app installata, 16.4 o piu'). */
export function pushSupportato(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

/** L'iscrizione di questo browser, senza registrare niente; null se non c'e'. */
export async function iscrizioneAttuale(): Promise<PushSubscription | null> {
  if (!pushSupportato()) return null
  try {
    const reg = await navigator.serviceWorker.getRegistration('/')
    return (await reg?.pushManager.getSubscription()) ?? null
  } catch {
    return null
  }
}

/** La chiave VAPID da base64url ai byte che vuole pushManager.subscribe. */
export function chiaveBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  const s = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  const out = new Uint8Array(new ArrayBuffer(s.length))
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

/** Se l'iscrizione e' stata fatta con questa chiave (se il browser non lo dice, si', per non rifarla a vuoto). */
export function stessaChiave(sub: PushSubscription, publicKey: string): boolean {
  const k = sub.options?.applicationServerKey
  if (!k) return true
  const a = new Uint8Array(k)
  const b = chiaveBytes(publicKey)
  return a.length === b.length && a.every((x, i) => x === b[i])
}

function dati(sub: PushSubscription): PushSubscriptionInput {
  const j = sub.toJSON()
  return {
    endpoint: sub.endpoint,
    p256dh: j.keys?.p256dh ?? '',
    auth: j.keys?.auth ?? '',
    label: etichettaDispositivo({ ua: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints ?? 0 }),
  }
}

/** La stessa impronta di endpointHash (lib/notify/push.ts): sha256, base64url, 22 caratteri. */
export async function hashEndpoint(endpoint: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint)))
  let s = ''
  for (const x of d) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 22)
}

function segnaResync(handle: string | null) {
  try {
    if (handle === null) localStorage.removeItem(RESYNC_KEY)
    else localStorage.setItem(RESYNC_KEY, JSON.stringify({ h: handle, at: Date.now() }))
  } catch {
    // senza localStorage il resync si rifa' alla prossima pagina: costa una Server Action
  }
}

function resyncDovuto(handle: string): boolean {
  try {
    const v = JSON.parse(localStorage.getItem(RESYNC_KEY) ?? 'null') as { h?: unknown; at?: unknown } | null
    return !v || v.h !== handle || typeof v.at !== 'number' || Date.now() - v.at > GIORNO || v.at > Date.now()
  } catch {
    return true
  }
}

export type AttivaEsito =
  | { ok: true; endpoint: string }
  | { ok: false; reason: 'denied' | 'dismissed' | 'unsupported' | 'failed' }
  | { ok: false; reason: 'server'; error: string }

/**
 * "Turn on for this device". Il permesso si chiede PER PRIMO, dentro il
 * clic: Safari lo concede solo con un gesto dell'utente ancora valido, e
 * qualunque attesa prima lo farebbe rifiutare. Poi il worker, l'iscrizione
 * del browser e quella del server; se il server dice no, l'iscrizione del
 * browser si toglie, cosi' i due lati restano d'accordo.
 */
export async function attiva(publicKey: string, handle: string): Promise<AttivaEsito> {
  if (!pushSupportato()) return { ok: false, reason: 'unsupported' }
  let permesso: NotificationPermission
  try {
    permesso = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
  } catch {
    return { ok: false, reason: 'failed' }
  }
  if (permesso === 'denied') return { ok: false, reason: 'denied' }
  if (permesso !== 'granted') return { ok: false, reason: 'dismissed' }
  const reg = await assicuraServiceWorker(VERSIONE)
  if (!reg) return { ok: false, reason: 'unsupported' }
  let sub: PushSubscription
  try {
    const c = await reg.pushManager.getSubscription()
    if (c && !stessaChiave(c, publicKey)) await c.unsubscribe()
    sub = c && stessaChiave(c, publicKey)
      ? c
      : await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chiaveBytes(publicKey) })
  } catch {
    return { ok: false, reason: 'failed' }
  }
  let r: Awaited<ReturnType<typeof subscribePushAction>>
  try {
    r = await subscribePushAction(dati(sub))
  } catch {
    r = { ok: false, error: 'Something went wrong. Try again in a moment.' }
  }
  if (!r.ok) {
    await sub.unsubscribe().catch(() => false)
    return { ok: false, reason: 'server', error: r.error }
  }
  segnaResync(handle)
  return { ok: true, endpoint: sub.endpoint }
}

/** "Turn off for this device": prima il server (finche' la sessione vale), poi il browser. */
export async function disattiva(): Promise<void> {
  const sub = await iscrizioneAttuale()
  if (!sub) return
  await unsubscribePushAction(sub.endpoint).catch(() => {})
  await sub.unsubscribe().catch(() => false)
}

/**
 * Riallinea browser e server: 'on' se il dispositivo resta iscritto,
 * 'off' se il server non lo conosce piu' (tolto da un altro browser, o il
 * servizio ha detto 404/410) e allora si toglie anche qui, 'none' se il
 * browser non ha un'iscrizione. Con la chiave VAPID cambiata il browser si
 * iscrive di nuovo e il server sostituisce il vecchio endpoint.
 */
export async function risincronizza(handle: string): Promise<'on' | 'off' | 'none'> {
  const sub = await iscrizioneAttuale()
  if (!sub) return 'none'
  try {
    if (Notification.permission !== 'granted') {
      // il permesso ritirato dalle impostazioni del browser: il server smette di mandare
      await disattiva()
      return 'off'
    }
    let r = await resyncPushAction(dati(sub))
    if (!r.listed) {
      await sub.unsubscribe().catch(() => false)
      return 'off'
    }
    if (r.publicKey && !stessaChiave(sub, r.publicKey)) {
      const reg = await navigator.serviceWorker.getRegistration('/')
      if (!reg) return 'on'
      await sub.unsubscribe().catch(() => false)
      const nuova = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chiaveBytes(r.publicKey) })
      r = await resyncPushAction(dati(nuova), sub.endpoint)
      if (!r.listed) {
        await nuova.unsubscribe().catch(() => false)
        return 'off'
      }
    }
    segnaResync(handle)
    return 'on'
  } catch {
    return 'on'
  }
}

/** Dal menu, a ogni pagina: il resync al massimo una volta al giorno, o subito se e' cambiato l'account. */
export async function risincronizzaOgniGiorno(handle: string): Promise<void> {
  if (!pushSupportato() || !resyncDovuto(handle)) return
  const esito = await risincronizza(handle)
  if (esito === 'none') segnaResync(handle)
}

/**
 * L'uscita (Sign out): toglie questo dispositivo mentre la sessione vale
 * ancora, aspettando il server al massimo USCITA_MS, poi l'iscrizione del
 * browser. Senza, chi usa dopo lo stesso browser riceverebbe le push
 * dell'account di prima. Non lancia mai: l'uscita prosegue comunque.
 */
export async function dimenticaDispositivo(): Promise<void> {
  const sub = await iscrizioneAttuale()
  segnaResync(null)
  if (!sub) return
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    unsubscribePushAction(sub.endpoint).catch(() => {}),
    new Promise<void>((r) => { timer = setTimeout(r, USCITA_MS) }),
  ])
  clearTimeout(timer)
  await sub.unsubscribe().catch(() => false)
}

/** Dopo la cancellazione dell'account: il server non c'e' piu' (cascata), resta solo il browser. */
export async function dimenticaSoloBrowser(): Promise<void> {
  segnaResync(null)
  const sub = await iscrizioneAttuale()
  await sub?.unsubscribe().catch(() => false)
}
