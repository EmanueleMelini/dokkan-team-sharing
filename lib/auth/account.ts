// Le regole di Settings in funzioni pure: la pagina le usa per decidere
// cosa mostrare, la Server Action per rispondere prima di Postgres, i test
// per provarle. Le stesse regole le impone il database (0019): qui servono
// solo a dare una frase chiara senza un giro su SQL.

export type DbErrorLike = { code?: string; constraint?: string }

/**
 * I modi di entrare che restano togliendo `without` (o nessuno). Il link
 * per email conta solo con un'email verificata: e' l'unico caso in cui
 * arriva a chi possiede l'account.
 */
export function signInMethodsLeft(linked: string[], emailVerified: boolean, without?: string): number {
  const altri = linked.filter((p) => p !== without).length
  return altri + (emailVerified ? 1 : 0)
}

/** Si puo' scollegare `provider` se e' collegato e resta almeno un modo di entrare. */
export function canUnlink(linked: string[], emailVerified: boolean, provider: string): boolean {
  return linked.includes(provider) && signInMethodsLeft(linked, emailVerified, provider) > 0
}

/** L'handle scritto per confermare la cancellazione: senza spazi ai lati, maiuscole libere. */
export function handleMatches(typed: unknown, handle: string): boolean {
  if (typeof typed !== 'string' || !handle) return false
  return typed.trim().toLowerCase() === handle.toLowerCase()
}

const BY_CONSTRAINT: Record<string, string> = {
  account_missing: 'This account no longer exists.',
  provider_not_linked: 'That provider is not linked to your account.',
  last_sign_in_method:
    'This is your only way to sign in. Link another account first, or you would be locked out.',
  account_handle_mismatch: 'That is not your handle. Type it exactly as shown above the box.',
}

/** La frase per un rifiuto di unlink_provider o delete_account, o null se e' un guasto. */
export function friendlyAccountError(e: DbErrorLike): string | null {
  return (e.constraint && BY_CONSTRAINT[e.constraint]) || null
}

/** I nomi dei vincoli di 0019, per il test che controlla le frasi. */
export const ACCOUNT_CONSTRAINTS = Object.keys(BY_CONSTRAINT)
