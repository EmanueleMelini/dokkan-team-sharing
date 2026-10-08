import type { UtenteTrovato } from '@/lib/moderation/queries'

// Le date in UTC, come il resto del sito (lib/date.ts), con l'ora: una
// sospensione di un giorno finisce a un'ora precisa.
const formato = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC',
})

export const dataOra = (d: Date) => `${formato.format(d)} UTC`

/** "Suspended until Oct 9, 2026, 14:00 UTC" o "Suspended indefinitely". */
export function FineSospensione({ u }: { u: Pick<UtenteTrovato, 'suspended' | 'until' | 'indefinite'> }) {
  if (!u.suspended) return null
  if (u.indefinite || !u.until) return <>Suspended indefinitely</>
  return <>Suspended until <time dateTime={u.until.toISOString()}>{dataOra(u.until)}</time></>
}
