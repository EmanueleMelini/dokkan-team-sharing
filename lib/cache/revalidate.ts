import { isCronAuthorized } from '@/lib/cron'
import { isAllowedTag } from '@/lib/cache/tags'

// POST /api/revalidate: gli import scrivono su Postgres fuori da Next, e
// qui dicono quali tag sono cambiati (db/prod/update.mjs dopo la pipeline,
// db/cache-clear.mjs in locale). La logica e' qui, senza next/cache: la
// rotta passa la funzione che invalida, i test una finta.

export const TAG_MAX = 50
const CORPO_MAX = 8 * 1024

const NO_STORE = { 'Cache-Control': 'no-store' }
const risposta = (status: number, body: unknown) => Response.json(body, { status, headers: NO_STORE })

/**
 * Con lo stesso segreto del cron (CRON_SECRET, Bearer a tempo costante).
 * Solo in `next dev` senza segreto la rotta e' aperta: cache:clear deve
 * funzionare senza configurare niente, e li' l'unico effetto e' rigenerare
 * pagine sulla propria macchina.
 */
export async function revalidateRequest(
  request: Request,
  { secret, dev, apply }: { secret: string | undefined; dev: boolean; apply: (tags: string[]) => void },
): Promise<Response> {
  const aperta = dev && !secret
  if (!aperta && !isCronAuthorized(request.headers.get('authorization'), secret)) {
    return risposta(401, { error: 'unauthorized' })
  }
  const testo = await request.text()
  if (testo.length > CORPO_MAX) return risposta(400, { error: 'body too large' })
  let corpo: unknown
  try {
    corpo = JSON.parse(testo)
  } catch {
    return risposta(400, { error: 'body must be JSON: {"tags": [...]}' })
  }
  const tags = (corpo as { tags?: unknown } | null)?.tags
  if (!Array.isArray(tags) || tags.length === 0 || tags.length > TAG_MAX) {
    return risposta(400, { error: `tags must be a list of 1 to ${TAG_MAX} tags` })
  }
  const sbagliato = tags.find((t) => !isAllowedTag(t))
  if (sbagliato !== undefined) return risposta(400, { error: 'unknown tag', tag: String(sbagliato).slice(0, 80) })
  const unici = [...new Set(tags as string[])]
  apply(unici)
  return risposta(200, { revalidated: unici })
}
