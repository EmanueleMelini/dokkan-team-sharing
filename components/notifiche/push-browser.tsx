'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { PushDispositivi, type DispositivoVista } from '@/components/notifiche/push-dispositivi'
import { attiva, disattiva, hashEndpoint, iscrizioneAttuale, pushSupportato, risincronizza } from '@/lib/notify/push-client'
import { testPushAction } from '@/lib/notify/push-actions'
import type { PushGroupId } from '@/lib/notify/push-kinds'
import { leggiContesto } from '@/lib/pwa/installa'

type Fase = 'caricamento' | 'sviluppo' | 'ios' | 'ios-vecchio' | 'non-supportato' | 'bloccato' | 'spento' | 'acceso'

const bottone =
  'px-3 py-1.5 text-[13px] font-medium rounded-[var(--raggio)] border border-campo bg-superficie text-inchiostro hover:bg-superficie-2 transition-colors disabled:opacity-50'

const TEST: Record<string, string> = {
  sent: 'Sent. It should appear in a few seconds.',
  rate: 'You can send one test notification a minute.',
  gone: 'This device is no longer reachable. Turn notifications on again.',
  missing: 'This device is not on your list. Turn notifications on again.',
  failed: 'The browser push service did not accept it. Try again later.',
  off: 'Browser notifications are not available right now.',
}

/**
 * "Browser notifications" in Settings (fase 4). Spente per difetto: il
 * permesso del browser si chiede solo al clic su "Turn on for this
 * device", mai prima (Chrome passa al prompt silenzioso per i siti che lo
 * chiedono subito, e un 'denied' non si puo' piu' richiedere). Su iPhone
 * e iPad le push ci sono solo nell'app installata (iOS 16.4 o piu').
 * Un'isola: il server la rende solo se le chiavi VAPID ci sono.
 */
export function PushBrowser({ publicKey, handle, admin, devices, groupsOn }: {
  publicKey: string
  handle: string
  admin: boolean
  devices: DispositivoVista[]
  groupsOn: PushGroupId[]
}) {
  const router = useRouter()
  const [fase, setFase] = useState<Fase>('caricamento')
  const [questo, setQuesto] = useState<string | null>(null)
  const [endpoint, setEndpoint] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ testo: string; errore?: boolean } | null>(null)
  const [inCorso, avvia] = useTransition()

  // All'apertura: che browser e', e il resync di questo dispositivo (la
  // visita di Settings e' uno dei due momenti del piano, con il giorno).
  useEffect(() => {
    let vivo = true
    ;(async () => {
      if (process.env.NODE_ENV !== 'production') return setFase('sviluppo')
      const c = leggiContesto()
      if (c.ios && !c.standalone) return setFase('ios')
      if (!pushSupportato()) return setFase(c.ios ? 'ios-vecchio' : 'non-supportato')
      // il resync prima del permesso: con le notifiche bloccate dopo
      // l'iscrizione, e' lui a togliere il dispositivo anche dal server
      const prima = await iscrizioneAttuale()
      const esito = prima ? await risincronizza(handle) : 'none'
      const dopo = esito === 'on' ? await iscrizioneAttuale() : null
      if (!vivo) return
      if (Notification.permission === 'denied') {
        setFase('bloccato')
      } else if (dopo) {
        setEndpoint(dopo.endpoint)
        setQuesto(await hashEndpoint(dopo.endpoint))
        setFase('acceso')
      } else {
        setFase('spento')
      }
      // la lista e' arrivata prima del resync: se e' cambiato qualcosa, si rilegge
      if (esito === 'off' || (prima && dopo && prima.endpoint !== dopo.endpoint)) router.refresh()
    })().catch(() => { if (vivo) setFase('spento') })
    return () => { vivo = false }
  }, [handle, router])

  const accendi = () => {
    setMsg(null)
    avvia(async () => {
      const r = await attiva(publicKey, handle)
      if (r.ok) {
        setEndpoint(r.endpoint)
        setQuesto(await hashEndpoint(r.endpoint))
        setFase('acceso')
        setMsg({ testo: 'Notifications are on for this device.' })
        return
      }
      if (r.reason === 'denied') setFase('bloccato')
      else if (r.reason === 'unsupported') setFase('non-supportato')
      setMsg({
        testo: r.reason === 'server' ? r.error
          : r.reason === 'dismissed' ? 'The browser did not get permission. Try again and choose Allow.'
            : r.reason === 'failed' ? 'This browser could not turn notifications on. Try again in a moment.'
              : '',
        errore: true,
      })
    })
  }

  const spegni = () => {
    setMsg(null)
    avvia(async () => {
      await disattiva()
      setFase('spento')
      setQuesto(null)
      setEndpoint(null)
      setMsg({ testo: 'Notifications are off for this device.' })
      router.refresh()
    })
  }

  const prova = () => {
    if (!endpoint) return
    setMsg(null)
    avvia(async () => {
      const { result } = await testPushAction(endpoint).catch(() => ({ result: 'failed' as const }))
      setMsg({ testo: TEST[result] ?? TEST.failed, errore: result !== 'sent' })
    })
  }

  return (
    <div id="browser-notifications" className="scroll-mt-6 space-y-3" aria-busy={inCorso || fase === 'caricamento'}>
      <p className="text-[12px] leading-relaxed text-tenue">
        Off unless you turn it on. A notification says who commented and where, or that a moderator
        updated one of your posts{admin ? ', or how many reports are open, or, with Site activity on, who did what and where' : ''}.
        It never shows the text of a post.
      </p>
      <Stato fase={fase} />
      <div className="flex flex-wrap items-center gap-2">
        {fase === 'spento' && (
          <button type="button" onClick={accendi} disabled={inCorso} className={bottone}>
            {inCorso ? 'Turning on…' : 'Turn on for this device'}
          </button>
        )}
        {fase === 'acceso' && (
          <>
            <button type="button" onClick={prova} disabled={inCorso} className={bottone}>Send a test notification</button>
            <button type="button" onClick={spegni} disabled={inCorso} className={bottone}>Turn off for this device</button>
          </>
        )}
      </div>
      <p role="status" className="text-[12px] text-tenue">
        {msg ? <span className={msg.errore ? 'text-str' : undefined}>{msg.testo}</span> : ''}
      </p>
      {/* key: dopo un salvataggio i gruppi ripartono da quelli del server */}
      <PushDispositivi key={groupsOn.join()} devices={devices} questo={questo} admin={admin} groupsOn={groupsOn} onRimuoviQuesto={spegni} />
    </div>
  )
}

function Stato({ fase }: { fase: Fase }) {
  const testo: Partial<Record<Fase, string>> = {
    sviluppo: 'Browser notifications work only in the production build of the site.',
    ios: 'On iPhone and iPad, notifications work only in the installed app (iOS 16.4 or later): tap Share, then Add to Home Screen, open the site from your Home Screen and come back to this page.',
    'ios-vecchio': 'Notifications in the installed app need iOS 16.4 or later.',
    'non-supportato': 'This browser cannot show notifications from websites.',
    bloccato: 'Notifications are blocked for this site in your browser settings. Allow them there, then reload this page.',
    acceso: 'On for this device.',
    spento: 'Off for this device.',
  }
  const t = testo[fase]
  if (!t) return <p className="text-[13px] text-tenue">Checking this browser…</p>
  const avviso = fase === 'ios' || fase === 'bloccato'
  return (
    <p
      role={avviso ? 'note' : undefined}
      className={avviso
        ? 'text-[12px] leading-relaxed text-inchiostro bg-oro-tenue border border-oro-linea rounded-[var(--raggio)] px-3 py-2'
        : 'text-[13px] text-inchiostro'}
    >
      {t}
    </p>
  )
}
