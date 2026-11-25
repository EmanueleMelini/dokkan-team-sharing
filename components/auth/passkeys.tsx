'use client'

import { useRouter } from 'next/navigation'
import { useActionState, useEffect, useRef, useState, useTransition } from 'react'
import { ReauthNotice } from '@/components/auth/reauth-notice'
import { deletePasskeyAction, type AccountState } from '@/lib/auth/actions'
import { authClient } from '@/lib/auth/client'
import { usePasskeySupport } from '@/lib/auth/passkey-support'

const piccolo =
  'px-2.5 py-1 text-[12px] font-medium rounded-[var(--raggio)] border transition-colors active:scale-[0.98] disabled:opacity-60'

type Errore = NonNullable<Awaited<ReturnType<typeof authClient.passkey.addPasskey>>['error']>

/** La frase per un'aggiunta fallita, 'reauth' per la sessione vecchia, o null se annullata. */
function esitoAggiunta(error: Errore): string | 'reauth' | null {
  // il codice di better-auth nel corpo della risposta, o di SimpleWebAuthn
  const c = (error as { code?: unknown }).code
  const code = typeof c === 'string' ? c : ''
  if (code === 'SESSION_NOT_FRESH') return 'reauth'
  // Il dialogo chiuso o scaduto (NotAllowedError, che SimpleWebAuthn passa
  // come ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY), o sostituito: niente da dire.
  if (code === 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY' || code === 'ERROR_CEREMONY_ABORTED') return null
  if (error.status === 429) return 'Too many attempts. Wait a minute and try again.'
  if (code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') {
    return 'This device or password manager already has a passkey for your account.'
  }
  // Una chiave di sicurezza vecchia che non sa tenere una passkey da sola
  // (residentKey 'required', config.ts)
  if (code === 'ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT') {
    return "This security key can't hold a passkey. Use your device or password manager instead."
  }
  return "Couldn't add the passkey. Please try again."
}

/**
 * Aggiunge una passkey all'account aperto: il browser chiede dove
 * salvarla (il dispositivo, il gestore di password, una chiave di
 * sicurezza). Chiede una sessione fresca come collegare un provider: lo
 * impone il plugin (freshSessionMiddleware); `fresh` serve solo a dirlo
 * prima del giro. Dopo, la pagina si ricarica e la mostra nella lista.
 */
export function AddPasskey({ fresh }: { fresh: boolean }) {
  const supporto = usePasskeySupport()
  const router = useRouter()
  const [pending, setPending] = useState(false)
  // la pagina che si ricarica con la passkey nuova nella lista
  const [ricarica, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [reauth, setReauth] = useState(false)
  const bottone = useRef<HTMLButtonElement>(null)
  const primoGiro = useRef(true)

  // Annullato l'invito a rientrare, il focus torna al bottone.
  useEffect(() => {
    if (primoGiro.current) { primoGiro.current = false; return }
    if (!reauth) bottone.current?.focus()
  }, [reauth])

  async function add() {
    if (!fresh) { setReauth(true); return }
    setPending(true)
    setError(null)
    let res: Awaited<ReturnType<typeof authClient.passkey.addPasskey>>
    try {
      res = await authClient.passkey.addPasskey()
    } catch {
      setPending(false)
      setError("Couldn't reach the site. Check your connection and try again.")
      return
    }
    setPending(false)
    if (!res.error) {
      startTransition(() => {
        router.replace('/settings?passkey=added', { scroll: false })
        router.refresh()
      })
      return
    }
    const esito = esitoAggiunta(res.error)
    if (esito === 'reauth') setReauth(true)
    else setError(esito)
  }

  if (reauth) return <ReauthNotice className="w-full" onCancel={() => setReauth(false)} />
  // Un browser senza WebAuthn (certi browser dentro le app): il bottone non farebbe niente.
  if (supporto === false) return <span className="text-[12px] text-tenue">Not available in this browser</span>

  return (
    <>
      <button
        ref={bottone}
        type="button"
        onClick={add}
        disabled={pending || ricarica}
        className={`${piccolo} border-campo bg-superficie text-inchiostro hover:bg-superficie-2`}
      >
        {pending ? 'Waiting for your passkey…' : ricarica ? 'Saving…' : 'Add a passkey'}
      </button>
      {error && <p role="alert" className="w-full text-[12px] text-str">{error}</p>}
    </>
  )
}

/**
 * Toglie una passkey in due passi, come Unlink: la domanda compare nella
 * riga, senza dialogo modale. La regola (resta un modo di entrare) la
 * impone delete_passkey; `canRemove` la anticipa solo per non offrire il
 * bottone. La passkey resta nel gestore di password: il sito toglie solo
 * la sua chiave pubblica, e lo dice.
 */
export function RemovePasskey({ id, label, added, fresh }: { id: string; label: string; added: string; fresh: boolean }) {
  const [chiede, setChiede] = useState(false)
  const [stato, azione, inCorso] = useActionState<AccountState, FormData>(deletePasskeyAction, {})
  const conferma = useRef<HTMLButtonElement>(null)
  const apri = useRef<HTMLButtonElement>(null)
  const primoGiro = useRef(true)

  useEffect(() => {
    if (primoGiro.current) { primoGiro.current = false; return }
    if (chiede) conferma.current?.focus()
    else apri.current?.focus()
  }, [chiede])

  if (!chiede) {
    return (
      <button
        ref={apri}
        type="button"
        onClick={() => setChiede(true)}
        aria-label={`Remove passkey ${label}, added ${added}`}
        className={`${piccolo} border-linea bg-superficie text-testo hover:text-str hover:border-str`}
      >
        Remove
      </button>
    )
  }

  if (!fresh || stato.reauth) return <ReauthNotice className="w-full" onCancel={() => setChiede(false)} />

  return (
    <form action={azione} className="w-full flex flex-wrap items-center gap-2" aria-busy={inCorso}>
      <input type="hidden" name="passkey" value={id} />
      <p className="w-full text-[12px] leading-relaxed text-inchiostro">
        Remove this passkey? It will no longer sign you in here. To delete it from your device or
        password manager too, do that there.
      </p>
      <button ref={conferma} type="submit" disabled={inCorso} className={`${piccolo} border-str bg-str text-sfondo hover:opacity-90`}>
        {inCorso ? 'Removing…' : 'Remove passkey'}
      </button>
      <button
        type="button"
        onClick={() => setChiede(false)}
        className={`${piccolo} border-linea bg-superficie text-testo hover:text-inchiostro`}
      >
        Cancel
      </button>
      {stato.error && <p role="alert" className="w-full text-[12px] text-str">{stato.error}</p>}
    </form>
  )
}
