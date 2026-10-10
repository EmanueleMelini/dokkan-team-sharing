'use server'

import { revalidatePath } from 'next/cache'
import { DatabaseError } from 'pg'
import { sql, sqlOne } from '@/lib/db'
import { currentUser } from '@/lib/dal'
import { pushEndpointOk } from '@/lib/notify/endpoint'
import { pushGroup, pushGroupsFor } from '@/lib/notify/push-kinds'
import { readPushEnv } from '@/lib/notify/push-env'
import { pushDeviceListed, pushKindsOn, sendTestPush, type TestPushResult } from '@/lib/notify/push'

// Le Server Action delle push del browser (0031). Come le altre, ognuna e'
// un endpoint pubblico: l'utente viene SEMPRE dalla sessione, mai dagli
// argomenti, e gli argomenti si ricontrollano tutti (un client puo'
// mandare qualunque cosa). Le chiama solo l'isola di Settings, il resync
// del menu e l'uscita: rispondono con un esito, non fanno redirect, cosi'
// un errore non porta via l'utente dalla pagina.

/** PushSubscription.toJSON() ridotta a quello che serve, piu' la label grossolana. */
export type PushSubscriptionInput = { endpoint: string; p256dh: string; auth: string; label?: string | null }

export type PushActionResult = { ok: true } | { ok: false; error: string }

const testo = (v: unknown, max: number) => (typeof v === 'string' && v.length <= max ? v : null)

/** L'input del browser, o null se non ha la forma giusta. Le regole vere sono in push_subscribe. */
function leggiIscrizione(v: unknown): PushSubscriptionInput | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const endpoint = testo(o.endpoint, 1024)
  const p256dh = testo(o.p256dh, 100)
  const auth = testo(o.auth, 40)
  if (!endpoint || !p256dh || !auth || !pushEndpointOk(endpoint)) return null
  return { endpoint, p256dh, auth, label: testo(o.label, 200) }
}

/** Chi chiama, gia' con l'handle; null se non c'e' una sessione o le push sono spente. */
async function chi() {
  if (!readPushEnv()) return null
  const user = await currentUser()
  return user?.onboarded ? user : null
}

const SESSIONE: PushActionResult = { ok: false, error: 'Sign in again to change notifications.' }

async function iscrivi(userId: string, s: PushSubscriptionInput): Promise<PushActionResult> {
  try {
    await sqlOne('select push_subscribe($1::uuid, $2, $3, $4, $5)', [userId, s.endpoint, s.p256dh, s.auth, s.label ?? null])
    return { ok: true }
  } catch (e) {
    if (e instanceof DatabaseError && e.constraint === 'push_device_limit') {
      return { ok: false, error: 'You already have 5 devices with notifications. Remove one below first.' }
    }
    if (e instanceof DatabaseError && (e.constraint === 'push_endpoint' || e.constraint === 'push_keys')) {
      return { ok: false, error: 'This browser gave a subscription the site cannot use.' }
    }
    throw e
  }
}

/**
 * "Turn on for this device": iscrive il dispositivo. La prima volta (nessun
 * tipo acceso) accende anche tutti i gruppi che l'utente vede: il clic e'
 * il consenso, e un dispositivo iscritto che non riceve niente sarebbe un
 * interruttore rotto. Dopo, i gruppi restano come li ha lasciati.
 */
export async function subscribePushAction(input: unknown): Promise<PushActionResult> {
  const user = await chi()
  if (!user) return SESSIONE
  const s = leggiIscrizione(input)
  if (!s) return { ok: false, error: 'This browser gave a subscription the site cannot use.' }
  const r = await iscrivi(user.id, s)
  if (!r.ok) return r
  if ((await pushKindsOn(user.id)).length === 0) {
    const kinds = pushGroupsFor(user.role === 'admin').flatMap((g) => g.kinds)
    await sql(
      "select set_notification_pref($1::uuid, k, 'push', true) from unnest($2::text[]) as k",
      [user.id, kinds],
    )
  }
  revalidatePath('/settings')
  return { ok: true }
}

/**
 * Toglie questo dispositivo: l'interruttore di Settings e l'uscita. Senza
 * sessione non c'e' niente da togliere (push_unsubscribe tocca solo le
 * righe dell'utente), e l'uscita prosegue lo stesso.
 */
export async function unsubscribePushAction(endpoint: unknown): Promise<PushActionResult> {
  const user = await currentUser()
  if (!user) return SESSIONE
  const e = testo(endpoint, 1024)
  if (!e) return { ok: true }
  await sqlOne('select push_unsubscribe($1::uuid, $2)', [user.id, e])
  revalidatePath('/settings')
  return { ok: true }
}

/** "Remove" nella lista dei dispositivi, anche per un altro browser. */
export async function removePushDeviceAction(id: unknown): Promise<PushActionResult> {
  const user = await currentUser()
  if (!user) return SESSIONE
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
    return { ok: false, error: 'This device could not be read. Reload the page.' }
  }
  await sqlOne('select push_device_remove($1::uuid, $2::uuid)', [user.id, id])
  revalidatePath('/settings')
  return { ok: true }
}

/** Un gruppo acceso o spento: tutti i suoi tipi insieme. */
export async function setPushGroupAction(group: unknown, on: unknown): Promise<PushActionResult> {
  const user = await chi()
  if (!user) return SESSIONE
  const g = pushGroup(group)
  if (!g || typeof on !== 'boolean' || (g.admin && user.role !== 'admin')) {
    return { ok: false, error: 'This setting could not be saved. Reload the page.' }
  }
  await sql(
    "select set_notification_pref($1::uuid, k, 'push', $3) from unnest($2::text[]) as k",
    [user.id, g.kinds, on],
  )
  revalidatePath('/settings')
  return { ok: true }
}

/** La notifica di prova su questo dispositivo. */
export async function testPushAction(endpoint: unknown): Promise<{ result: TestPushResult }> {
  const user = await chi()
  if (!user) return { result: 'off' }
  const e = testo(endpoint, 1024)
  if (!e) return { result: 'missing' }
  const result = await sendTestPush(user.id, e)
  if (result === 'gone') revalidatePath('/settings')
  return { result }
}

export type ResyncResult = {
  /** il dispositivo e' fra quelli dell'utente (dopo il resync) */
  listed: boolean
  /** la chiave VAPID di adesso: se e' cambiata, il browser deve iscriversi di nuovo */
  publicKey: string | null
}

/**
 * Il resync del client (una volta al giorno, a ogni visita di Settings, e
 * dopo un cambio di chiave). Conferma solo un dispositivo che il server
 * conosce ancora: se l'utente l'ha tolto da un altro browser, o il servizio
 * push ha detto 404/410, la risposta e' listed false e il client lascia
 * cadere l'iscrizione del browser, invece di riportarla in vita da solo.
 * Con oldEndpoint (il browser si e' iscritto di nuovo con una chiave
 * nuova) il vecchio si sostituisce col nuovo.
 */
export async function resyncPushAction(input: unknown, oldEndpoint?: unknown): Promise<ResyncResult> {
  const env = readPushEnv()
  const user = env ? await currentUser() : null
  if (!env || !user?.onboarded) return { listed: false, publicKey: env?.publicKey ?? null }
  const s = leggiIscrizione(input)
  if (!s) return { listed: false, publicKey: env.publicKey }
  const vecchio = testo(oldEndpoint, 1024)
  if (!(await pushDeviceListed(user.id, vecchio ?? s.endpoint))) return { listed: false, publicKey: env.publicKey }
  if (vecchio && vecchio !== s.endpoint) await sqlOne('select push_unsubscribe($1::uuid, $2)', [user.id, vecchio])
  const r = await iscrivi(user.id, s)
  return { listed: r.ok, publicKey: env.publicKey }
}
