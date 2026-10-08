// La sospensione di un account (0024: app_user.suspended_until) come la
// vedono la DAL, /api/me e il banner. Modulo puro: lo usano il server e
// le isole client.
//
// Il database tiene null, una data o 'infinity' (a tempo indeterminato).
// node-postgres legge 'infinity' come il numero Infinity, e better-auth
// ne fa una Date non valida: qui tutto diventa una stringa sola, una data
// ISO oppure INDEFINITA, che passa uguale nel JSON di /api/me.

export const INDEFINITA = 'infinity'

/** La fine della sospensione come stringa (ISO o 'infinity'), o null. */
export function fineSospensione(v: unknown): string | null {
  if (v == null) return null
  if (v === Infinity || v === INDEFINITA) return INDEFINITA
  if (v instanceof Date) {
    // new Date(Infinity): l'unico modo in cui una colonna timestamptz
    // arriva non valida. -infinity non si scrive (mod_suspend_until).
    return Number.isNaN(v.getTime()) ? INDEFINITA : v.toISOString()
  }
  if (typeof v === 'string') {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  return null
}

/** Vero se la sospensione e' ancora in corso: una data passata non conta piu'. */
export function isSospeso(fine: string | null, ora = Date.now()): boolean {
  if (!fine) return false
  if (fine === INDEFINITA) return true
  return new Date(fine).getTime() > ora
}

const giorno = new Intl.DateTimeFormat('en-US', {
  month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC',
})

/** "until October 15, 2026 at 14:00 UTC" oppure "indefinitely". */
export function fineInParole(fine: string): string {
  if (fine === INDEFINITA) return 'indefinitely'
  const d = new Date(fine)
  return Number.isNaN(d.getTime()) ? 'indefinitely' : `until ${giorno.format(d)} UTC`
}

/** La frase del banner (spec): cosa resta permesso e cosa no. */
export function fraseSospensione(fine: string): string {
  return `Your account is suspended ${fineInParole(fine)}. You can still read, change your settings and delete your posts or your account, but you cannot post, vote, comment or report.`
}
