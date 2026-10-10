import { UNSUBSCRIBE_PAGE } from '@/lib/notify/digest'
import { unsubscribeWithToken } from '@/lib/notify/unsubscribe'

// Il one-click di RFC 8058: il client di posta (il bottone "Unsubscribe"
// di Gmail, Apple Mail...) manda una POST all'URL di List-Unsubscribe con
// il corpo "List-Unsubscribe=One-Click". Il token sta nella query (?t=),
// come lo scrive l'header; un campo t nel corpo vale lo stesso.
//
// Nessuna sessione e nessun cookie: chi clicca nella casella di posta di
// solito non e' collegato al sito, e decide solo il token firmato. Il
// peggio che un token rubato puo' fare e' spegnere il digest.

const HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' }

const daQuery = (request: Request) => new URL(request.url).searchParams.get('t')

async function tokenDa(request: Request): Promise<string | null> {
  const q = daQuery(request)
  if (q) return q
  const tipo = request.headers.get('content-type') ?? ''
  if (!tipo.startsWith('application/x-www-form-urlencoded')) return null
  // Il corpo del one-click e' di poche decine di byte: uno piu' grande non
  // e' un client di posta, e non si legge.
  const corpo = await request.text()
  if (corpo.length > 1024) return null
  return new URLSearchParams(corpo).get('t')
}

export async function POST(request: Request) {
  const esito = await unsubscribeWithToken(await tokenDa(request))
  return esito === 'ok'
    ? Response.json({ ok: true }, { headers: HEADERS })
    : Response.json({ error: 'invalid link' }, { status: 400, headers: HEADERS })
}

// Un client che apre l'URL con un GET (o un antivirus che controlla i
// link) non deve disiscrivere nessuno (RFC 8058, 3.1): va alla pagina con
// il bottone, che chiede una conferma.
export function GET(request: Request) {
  const t = daQuery(request) ?? ''
  const dove = t && t.length <= 200 ? `${UNSUBSCRIBE_PAGE}?t=${encodeURIComponent(t)}` : UNSUBSCRIBE_PAGE
  return new Response(null, { status: 303, headers: { ...HEADERS, Location: dove } })
}
