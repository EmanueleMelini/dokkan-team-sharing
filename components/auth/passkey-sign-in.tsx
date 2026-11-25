'use client'

import { Key } from '@phosphor-icons/react/dist/ssr'
import { useCallback, useEffect, useRef, useState } from 'react'
import { authClient } from '@/lib/auth/client'
import { usePasskeySupport } from '@/lib/auth/passkey-support'

type Esito = Awaited<ReturnType<typeof authClient.signIn.passkey>>
type Errore = NonNullable<Esito['error']>

/** Il codice dell'errore: quello di better-auth nel corpo della risposta, o di SimpleWebAuthn. */
const codice = (e: Errore | null | undefined): string => {
  const c = (e as { code?: unknown } | null | undefined)?.code
  return typeof c === 'string' ? c : ''
}

// Il dialogo chiuso senza scegliere: NotAllowedError, che SimpleWebAuthn
// passa come ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY (e' anche lo scadere del
// tempo). Niente da dire. AUTH_CANCELLED invece e' un guasto vero: il
// plugin chiama cosi' ogni errore che SimpleWebAuthn non riconosce.
const ANNULLATO = new Set(['ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY'])

const TROPPI = 'Too many attempts. Wait a minute and try again.'
const RETE = "Couldn't reach the site. Check your connection and try again."

// La sfida del plugin vive 5 minuti (cookie e riga in auth_verification):
// il suggerimento nel campo email si rinnova prima che scada. Il controllo
// gira ogni 30 secondi, quindi il rinnovo cade tra 3:30 e 4:00.
const RINNOVO_MS = 3.5 * 60_000
const CONTROLLO_MS = 30_000

/** Il campo che propone le passkey (EmailSignIn con webauthn), se e' in pagina. */
const campo = () => document.querySelector<HTMLInputElement>("input[autocomplete$='webauthn']")

const nascosta = () => document.visibilityState !== 'visible'

/**
 * La frase per un accesso fallito, o null se non c'e' niente da dire.
 * `scelta`: la risposta della passkey e' partita verso il server (la
 * verifica), quindi l'utente l'aveva gia' scelta e sbloccata. Prima della
 * scelta il suggerimento nel campo email tace sempre: un browser senza
 * suggerimenti, un dominio diverso, una richiesta sostituita dal bottone.
 */
function messaggio(error: Errore, scelta: boolean, dalSuggerimento: boolean): string | null {
  const code = codice(error)
  if (!scelta) {
    if (dalSuggerimento || ANNULLATO.has(code)) return null
    // Solo un'altra richiesta interrompe il dialogo: il suggerimento, se
    // era partito un attimo prima del clic.
    if (code === 'ERROR_CEREMONY_ABORTED') return 'Please try again.'
    if (error.status === 429) return TROPPI
    return "Couldn't start the passkey sign-in. Please try again."
  }
  if (error.status === 429) return TROPPI
  if (code === 'PASSKEY_NOT_FOUND') {
    return "That passkey isn't linked to an account here. Sign in another way, then add a passkey in Settings."
  }
  if (code === 'CHALLENGE_NOT_FOUND') return 'Sign-in timed out. Please try again.'
  // la verifica non e' arrivata: il plugin chiama cosi' un fetch fallito
  if (code === 'AUTH_CANCELLED') return RETE
  return "Couldn't sign in with that passkey. Please try again."
}

/**
 * Entrare con una passkey. La sessione la crea il plugin passkey di
 * better-auth (/passkey/verify-authentication, in ACCESSI): poi si passa
 * da /welcome come gli altri accessi, che rimanda subito a next chi ha gia'
 * l'handle. Una passkey non crea account: chi non ne ha una entra in un
 * altro modo e la aggiunge da Settings.
 *
 * `autofill`: il browser propone le passkey anche nel campo email (l'input
 * con autocomplete "email webauthn" di EmailSignIn). La richiesta resta in
 * attesa finche' l'utente non ne sceglie una, e si rinnova prima che la
 * sfida scada. Il bottone la sostituisce; quando il suo dialogo si chiude
 * senza entrare, il suggerimento riparte.
 */
export function PasskeySignIn({ next, autofill = false }: { next: string; autofill?: boolean }) {
  const supporto = usePasskeySupport()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const montato = useRef(false)
  // il giro del suggerimento: ne vive uno solo, un giro nuovo (o il clic) ferma il vecchio
  const giro = useRef(0)
  // quando e' partita la richiesta del suggerimento in attesa (0: nessuna)
  const inizio = useRef(0)
  // la scheda e' stata nascosta con una richiesta in attesa: un'altra scheda
  // di /login puo' aver preso il cookie della sfida (ce n'e' uno solo)
  const scaduta = useRef(false)
  const dialogo = useRef(false)
  // suggerisci() stesso, per ripartire da dentro un giro (lo aggiorna l'effetto)
  const riparti = useRef<() => void>(() => {})

  const mostra = useCallback((m: string | null) => { if (m && montato.current) setError(m) }, [])
  // Ferma il giro del suggerimento in corso: non riparte piu' dopo la sua attesa.
  const ferma = useCallback(() => { giro.current++ }, [])

  /** Vero se si entra: la pagina va gia' altrove. */
  const entrato = useCallback((res: Esito): boolean => {
    if (res.error) return false
    // Navigazione piena, come al ritorno da OAuth o dal magic link: le
    // pagine e l'header (components/viewer) ripartono con la sessione nuova.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/welcome?next=${encodeURIComponent(next)}`)
    return true
  }, [next])

  const suggerisci = useCallback(async (): Promise<void> => {
    if (!autofill || typeof window.PublicKeyCredential !== 'function') return
    // Una scheda nascosta non chiede la sfida: il cookie e' uno solo per
    // il browser, e una /login aperta in background lo toglierebbe alla
    // scheda che si sta guardando. Parte quando si mostra (rinnova, su
    // visibilitychange: inizio resta 0).
    if (nascosta()) return
    const mio = ++giro.current
    const puo = await PublicKeyCredential.isConditionalMediationAvailable?.().catch(() => false)
    // Ogni giro aspetta una scelta dell'utente: una passkey che il sito
    // rifiuta fa ripartire il suggerimento per sceglierne un'altra. Un
    // errore prima della scelta lo ferma; il rinnovo riprova piu' tardi.
    // Senza il campo in pagina (EmailSignIn dopo l'invio del link) non si
    // chiede niente: SimpleWebAuthn rifiuterebbe, e la sfida andrebbe persa.
    while (puo && montato.current && giro.current === mio && !dialogo.current && campo() && !nascosta()) {
      let scelta = false
      inizio.current = Date.now()
      scaduta.current = false
      let res: Esito
      try {
        res = await authClient.signIn.passkey({ autoFill: true, fetchOptions: { onRequest: () => { scelta = true } } })
      } catch {
        if (giro.current === mio) inizio.current = 0
        if (scelta) mostra(RETE)
        return
      }
      if (entrato(res)) return
      const vecchio = giro.current !== mio
      if (!vecchio) inizio.current = 0
      // Una passkey scelta conta anche se nel frattempo e' partito un giro
      // nuovo (un rinnovo fallito prima di sostituirla): si dice com'e'
      // andata e si riparte.
      if (scelta) mostra(messaggio(res.error!, scelta, true))
      if (vecchio) {
        if (scelta && montato.current && !dialogo.current) riparti.current()
        return
      }
      if (!scelta) return
    }
  }, [autofill, entrato, mostra])

  useEffect(() => {
    montato.current = true
    riparti.current = () => { void suggerisci() }
    void suggerisci()
    if (!autofill) return () => { montato.current = false }
    // Il rinnovo: nessuna richiesta in attesa, una con la sfida quasi
    // scaduta, o una rimasta in attesa mentre la scheda era nascosta. Mai
    // mentre il campo email ha il focus (chiuderebbe l'elenco delle passkey
    // sotto le dita), senza il campo, o con il dialogo del bottone aperto.
    const rinnova = () => {
      if (document.visibilityState !== 'visible') {
        if (inizio.current !== 0) scaduta.current = true
        return
      }
      const f = campo()
      if (dialogo.current || !f || document.activeElement === f) return
      if (inizio.current === 0 || scaduta.current || Date.now() - inizio.current > RINNOVO_MS) void suggerisci()
    }
    const timer = window.setInterval(rinnova, CONTROLLO_MS)
    document.addEventListener('visibilitychange', rinnova)
    return () => {
      montato.current = false
      ferma()
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', rinnova)
    }
  }, [autofill, suggerisci, ferma])

  async function start() {
    dialogo.current = true
    ferma()
    setPending(true)
    setError(null)
    let scelta = false
    try {
      const res = await authClient.signIn.passkey({ fetchOptions: { onRequest: () => { scelta = true } } })
      if (entrato(res)) return
      mostra(messaggio(res.error!, scelta, false))
    } catch {
      mostra(RETE)
    }
    dialogo.current = false
    if (!montato.current) return
    setPending(false)
    void suggerisci()
  }

  // Un browser senza WebAuthn: il bottone non farebbe niente.
  if (supporto === false) return null

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={start}
        disabled={pending}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 text-[13px] font-medium rounded-[var(--raggio)] border border-campo bg-superficie text-inchiostro hover:bg-superficie-2 transition-colors disabled:opacity-60"
      >
        <Key size={17} weight="bold" aria-hidden className="shrink-0 text-oro" />
        {pending ? 'Waiting for your passkey…' : 'Sign in with a passkey'}
      </button>
      {error && <p role="alert" className="text-[12px] text-str">{error}</p>}
    </div>
  )
}
