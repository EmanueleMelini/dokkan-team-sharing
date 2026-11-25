import { getAuthenticatorName } from '@better-auth/passkey'

/**
 * Come si chiama una passkey in Settings: l'etichetta scelta (oggi il sito
 * non la chiede), o il gestore che la custodisce dal suo AAGUID (Google
 * Password Manager, Bitwarden, Windows Hello, ...), o "Passkey". I
 * dispositivi Apple mandano un AAGUID di soli zeri: per loro "Passkey".
 */
export function passkeyLabel(p: { name?: string | null; aaguid?: string | null }): string {
  return p.name?.trim() || getAuthenticatorName(p.aaguid ?? undefined) || 'Passkey'
}
