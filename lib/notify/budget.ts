import { sqlOne } from '@/lib/db'

// Il conteggio delle email di accesso nel budget condiviso con il digest
// (0029). Resend Free ha un tetto solo per tutte le email: i magic link si
// contano perche' il digest sappia quanto spazio resta, ma non si rifiutano
// e non si ritardano MAI.
//
// Per questo si conta DOPO l'invio, senza lanciare: un database lento o
// giu' non deve far fallire un login gia' partito. Il tempo massimo
// limita solo l'attesa della risposta HTTP (l'email e' gia' in viaggio):
// la query, se arriva tardi, conta lo stesso.

/** Oltre questo il conteggio si lascia correre senza aspettarlo. */
export const AUTH_COUNT_TIMEOUT_MS = 1500

export type AuthEmailCounter = () => Promise<void>

const logga = (e: unknown) => console.error('[auth] conteggio email non riuscito:', e instanceof Error ? e.message : e)

/** Conta un'email di accesso; non lancia mai, anche se la query arriva dopo il tempo massimo. */
export async function countAuthEmail(count: () => Promise<unknown> = defaultCount): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const conta = Promise.resolve().then(count).catch(logga)
  const basta = new Promise<void>((resolve) => { timer = setTimeout(resolve, AUTH_COUNT_TIMEOUT_MS) })
  await Promise.race([conta, basta])
  clearTimeout(timer)
}

const defaultCount = () => sqlOne("select email_budget_consume('auth', 1) as n")
