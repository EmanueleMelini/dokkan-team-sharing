// I codici d'errore di better-auth (nel ?error= dei redirect) in frasi
// per chi legge. Un codice sconosciuto ha una frase generica: non si
// ripete mai in pagina il testo grezzo che arriva nell'URL.

const MESSAGES: Record<string, string> = {
  account_not_linked:
    'This email already has an account. Sign in the way you did before, then link this provider in Settings.',
  email_not_verified:
    'That account has no verified email address. Verify it with the provider, or sign in with an email link.',
  email_not_found: "That provider didn't share an email address, so we can't create an account with it.",
  account_already_linked_to_different_user: 'That account is already linked to a different user.',
  unable_to_link_account: "We couldn't link that account. Please try again.",
  email_does_not_match: "We couldn't link that account. Please try again.",
  INVALID_TOKEN: 'This sign-in link is invalid, expired or already used. Request a new one.',
  EXPIRED_TOKEN: 'This sign-in link has expired. Request a new one.',
  access_denied: 'Sign-in was cancelled.',
  state_mismatch: 'Sign-in timed out or was started in another tab. Please try again.',
  state_not_found: 'Sign-in timed out or was started in another tab. Please try again.',
  new_user_signup_disabled: 'New accounts are closed right now.',
}

export function authErrorMessage(code: string | undefined | null): string | null {
  if (!code) return null
  return MESSAGES[code] ?? 'Something went wrong while signing in. Please try again.'
}
