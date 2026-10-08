'use client'

import { useState } from 'react'
import { authClient } from '@/lib/auth/client'

/**
 * Il link per email. La risposta e' sempre "controlla la posta", che
 * l'indirizzo sia iscritto o no e anche se e' in pausa: la pagina non
 * deve dire a nessuno chi ha un account. `errorPath` e `defaultEmail`
 * servono a /settings/sign-in: chi rientra e' gia' dentro, e /login lo
 * rimanderebbe via perdendo l'errore.
 */
export function EmailSignIn({ next, errorPath = '/login', defaultEmail = '' }: {
  next: string
  errorPath?: string
  defaultEmail?: string
}) {
  const [email, setEmail] = useState(defaultEmail)
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setState('sending')
    setError(null)
    const res = await authClient.signIn.magicLink({
      email: email.trim(),
      callbackURL: `/welcome?next=${encodeURIComponent(next)}`,
      errorCallbackURL: `${errorPath}?next=${encodeURIComponent(next)}`,
    })
    if (res.error) {
      setState('idle')
      setError(
        res.error.status === 429
          ? 'Too many requests. Wait a minute and try again.'
          : res.error.status === 400
            ? 'Enter a valid email address.'
            : "Couldn't send the link. Please try again.",
      )
      return
    }
    setState('sent')
  }

  if (state === 'sent') {
    return (
      <div role="status" className="rounded-[var(--raggio)] border border-oro-linea bg-oro-tenue px-4 py-3">
        <p className="text-[13px] font-medium text-inchiostro">Check your inbox</p>
        <p className="mt-1 text-[12px] leading-relaxed text-testo">
          If <span className="font-medium text-inchiostro">{email.trim()}</span> can receive email, a sign-in link is on its way. It
          works once and expires in 10 minutes.
        </p>
        <button
          type="button"
          onClick={() => setState('idle')}
          className="mt-2 text-[12px] text-oro underline underline-offset-2"
        >
          Use a different address
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-2" noValidate>
      <label htmlFor="email" className="block text-[12px] text-tenue">
        Email address
      </label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full px-3 py-1.5 text-[13px] rounded-[var(--raggio)] bg-superficie border border-campo text-inchiostro placeholder:text-tenue"
        placeholder="you@example.com"
      />
      <button
        type="submit"
        disabled={state === 'sending' || email.trim() === ''}
        className="w-full px-3 py-2 text-[13px] font-medium rounded-[var(--raggio)] bg-inchiostro text-sfondo hover:opacity-90 transition-opacity disabled:opacity-60"
      >
        {state === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
      </button>
      {error && <p role="alert" className="text-[12px] text-str">{error}</p>}
    </form>
  )
}
