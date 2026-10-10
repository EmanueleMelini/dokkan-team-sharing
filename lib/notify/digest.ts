import { notificationLink, notificationPlace } from '@/lib/notify/vista'
import { profileHref } from '@/lib/urls'

// I testi del digest giornaliero (0029): una riga di digest_due diventa
// oggetto, testo semplice, HTML e gli header di disiscrizione. Modulo puro,
// in inglese, senza trattini lunghi: lo provano i test.
//
// Regole del proprietario, qui oltre che nella selezione SQL:
//   - voti e Helpful sono solo "+N", mai chi li ha dati;
//   - la moderazione e' generica: al massimo l'evento. Un'email si legge
//     anche sullo schermo bloccato o in un'anteprima, quindi niente
//     "nascosto", "sospeso", motivi o note: i dettagli sono nel sito;
//   - il testo dei post non c'e' mai (la riga non lo porta nemmeno).
// Ogni notifica porta a /notifications/<id>, che segna letta e
// reindirizza dove punta adesso.

export type DigestItem = {
  id: number | string
  kind: string
  target: string
  n: number
  actor_handle: string | null
  event_name: string | null
  stage_seq: number | null
  stage_name: string | null
  difficulty: string | null
}

/** Una riga di digest_due come la consegna node-postgres. */
export type DigestRow = {
  user_id: string
  email: string
  handle: string
  token_v: number
  is_admin: boolean
  has_moderation: boolean
  since: Date
  upto: Date
  day: string
  votes: number
  helpful: number
  items: DigestItem[]
}

export type DigestEmail = {
  to: string
  subject: string
  text: string
  html: string
  headers: Record<string, string>
}

/** Oltre questo numero di notifiche, il resto si conta e basta. */
export const DIGEST_MAX_ITEMS = 20

export const UNSUBSCRIBE_PAGE = '/notifications/unsubscribe'
export const UNSUBSCRIBE_API = '/api/notifications/unsubscribe'

/** La pagina con il bottone (link nel corpo) e l'URL del one-click (RFC 8058, nell'header). */
export function unsubscribeUrls(baseURL: string, token: string) {
  const t = encodeURIComponent(token)
  return { page: `${baseURL}${UNSUBSCRIBE_PAGE}?t=${t}`, oneClick: `${baseURL}${UNSUBSCRIBE_API}?t=${t}` }
}

type Riga = { title: string; detail: string | null; path: string }

const MODERAZIONE_POST = new Set(['content_hidden', 'content_unhidden'])
const MODERAZIONE_ACCOUNT = new Set(['suspended', 'suspension_lifted'])

const luogo = (i: DigestItem) => notificationPlace({ ...i, event_id: null })

/** Una notifica come riga del digest, gia' nella forma generica. */
export function digestLine(i: DigestItem): Riga {
  const path = notificationLink(String(i.id))
  if (i.kind === 'clear_comment') {
    const title = i.n > 1 ? `${i.n} new comments on your clear` : `${i.actor_handle ?? 'Someone'} commented on your clear`
    return { title, detail: luogo(i), path }
  }
  if (MODERAZIONE_POST.has(i.kind)) return { title: 'A moderator reviewed one of your posts', detail: luogo(i), path }
  if (MODERAZIONE_ACCOUNT.has(i.kind)) return { title: 'There is an update about your account', detail: null, path }
  if (i.kind === 'reports_open') {
    return { title: i.n > 1 ? `${i.n} open reports to review` : 'A new report to review', detail: null, path }
  }
  return { title: 'New activity on your account', detail: null, path }
}

/** Le righe dei conteggi: +N voti sui clear, +N Helpful sulle tip. */
function conteggi(r: DigestRow): Riga[] {
  const profilo = profileHref(r.handle)
  const out: Riga[] = []
  if (r.votes > 0) out.push({ title: `+${r.votes} ${r.votes === 1 ? 'upvote' : 'upvotes'} on your clears`, detail: null, path: profilo })
  if (r.helpful > 0) {
    out.push({ title: `+${r.helpful} ${r.helpful === 1 ? 'player' : 'players'} found your tips helpful`, detail: null, path: profilo })
  }
  return out
}

const MESI = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** '2026-10-10' -> 'October 10'. Il giorno e' quello UTC di digest_due. */
export function digestDayLabel(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return day
  return `${MESI[Number(m[2]) - 1]} ${Number(m[3])}`
}

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/**
 * L'email di un utente. token e' il suo token di disiscrizione
 * (signUnsubscribeToken), baseURL senza la barra finale.
 */
export function renderDigest(r: DigestRow, { baseURL, token }: { baseURL: string; token: string }): DigestEmail {
  const notifiche = r.items.slice(0, DIGEST_MAX_ITEMS).map(digestLine)
  const altre = Math.max(0, r.items.length - DIGEST_MAX_ITEMS)
  const righe = [...conteggi(r), ...notifiche]
  const link = unsubscribeUrls(baseURL, token)
  const impostazioni = `${baseURL}/settings#notifications`
  const lista = `${baseURL}/notifications`
  const subject = `Your Dokkan Team Sharing digest for ${digestDayLabel(r.day)}`
  const intro = 'Here is what happened on Dokkan Team Sharing since your last digest.'
  const perche = 'You get this email because you turned on the daily email digest in Settings. ' +
    'It comes at most once a day, and only when there is something new.'

  const text = [
    `Hi ${r.handle},`,
    '',
    intro,
    '',
    ...righe.flatMap((x) => [`- ${x.title}`, ...(x.detail ? [`  ${x.detail}`] : []), `  ${baseURL}${x.path}`, '']),
    ...(altre ? [`And ${altre} more in your notifications: ${lista}`, ''] : []),
    perche,
    `Unsubscribe: ${link.page}`,
    `Or turn it off in Settings: ${impostazioni}`,
  ].join('\n')

  const a = (href: string, testo: string) => `<a href="${escape(href)}" style="color:#8a6d1f">${escape(testo)}</a>`
  const html = `<!doctype html>
<html lang="en"><body style="margin:0;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#1d1f2b;background:#ffffff">
<p>Hi ${escape(r.handle)},</p>
<p>${escape(intro)}</p>
<ul style="padding-left:18px">
${righe.map((x) => `<li style="margin:0 0 12px">${a(`${baseURL}${x.path}`, x.title)}${x.detail ? `<br><span style="color:#5b5f73">${escape(x.detail)}</span>` : ''}</li>`).join('\n')}
</ul>
${altre ? `<p>And ${altre} more in ${a(lista, 'your notifications')}.</p>\n` : ''}<p style="margin-top:24px;font-size:12px;color:#5b5f73">${escape(perche)}<br>
${a(link.page, 'Unsubscribe')} or turn it off in ${a(impostazioni, 'Settings')}.</p>
</body></html>`

  return {
    to: r.email,
    subject,
    text,
    html,
    headers: {
      // RFC 2369 e RFC 8058: il client di posta mostra "Unsubscribe" e lo fa
      // con una POST a questo URL, senza aprire il sito e senza cookie.
      'List-Unsubscribe': `<${link.oneClick}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  }
}
