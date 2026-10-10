import { createHash } from 'node:crypto'
import { notificationLink, notificationPlace } from '@/lib/notify/vista'

// Il testo di una push e il suo payload. Modulo puro (solo node:crypto):
// lo provano db/test/push-app.test.mts e lo legge public/sw.js, che ha lo
// stesso typedef.
//
// Il testo si legge sulla schermata di blocco, e passa (cifrato) dal
// servizio push del browser. Per questo, decisione del proprietario:
//   - un commento: l'handle di chi ha commentato e dove (evento e stage),
//     mai il testo del commento, che potrebbe essere nascosto un minuto
//     dopo e resterebbe sul telefono;
//   - la moderazione: una frase generica, il dettaglio e' nella lista del
//     sito, che e' privata;
//   - gli admin: "N open reports";
//   - mai il testo di un post.

/** Il tetto del payload in byte, prima della cifratura (i servizi ne accettano 4096). */
export const PUSH_PAYLOAD_MAX = 512

/** Il payload v1, uguale al typedef PushPayload di public/sw.js. */
export type PushPayload = {
  v: 1
  kind: string
  title: string
  body: string
  /** sempre /notifications/<id>: segna letta e porta dove serve adesso */
  url: string
  /** dts:<hash del gruppo>: una notifica nuova dello stesso gruppo sostituisce quella vecchia */
  tag: string
  /** quando e' partita, in ms */
  ts: number
}

/** Le colonne di push_job che servono al testo (0031). */
export type PushTextFields = {
  kind: string
  n: number
  actor_handle: string | null
  event_name: string | null
  stage_seq: number | null
  stage_name: string | null
  difficulty: string | null
}

export type PushJobFields = PushTextFields & { notification_id: string; group_key: string }

const MODERAZIONE_CONTENUTI = new Set(['content_hidden', 'content_unhidden'])
const MODERAZIONE_ACCOUNT = new Set(['suspended', 'suspension_lifted'])

/** Titolo e corpo. Inglese, senza trattini lunghi, mai il testo dei post. */
export function pushText(j: PushTextFields): { title: string; body: string } {
  if (j.kind === 'clear_comment') {
    // push_job non ha event_id: il luogo c'e' solo se c'e' il nome
    const luogo = j.event_name ? notificationPlace({ ...j, event_id: null }) : null
    const chi = j.actor_handle ?? 'Someone'
    if (j.n > 1) {
      return {
        title: `${j.n} new comments on your clear`,
        body: luogo ? `In ${luogo}. Latest from ${chi}.` : `Latest from ${chi}.`,
      }
    }
    return { title: `${chi} commented on your clear`, body: luogo ? `In ${luogo}.` : 'Open it to read the comment.' }
  }
  if (MODERAZIONE_CONTENUTI.has(j.kind)) {
    return { title: 'A moderator updated one of your posts', body: 'Open it to see what changed.' }
  }
  if (MODERAZIONE_ACCOUNT.has(j.kind)) {
    return { title: 'A moderator updated your account', body: 'Open it to see what changed.' }
  }
  if (j.kind === 'reports_open') {
    const n = Math.max(1, j.n)
    return { title: n === 1 ? '1 open report' : `${n} open reports`, body: 'Open the moderation queue.' }
  }
  return { title: 'You have new activity', body: 'Open it to see what is new.' }
}

const hash = (s: string) => createHash('sha256').update(s, 'utf8').digest('base64url')

/** Il tag della notifica nel sistema: lo stesso gruppo prende il posto della notifica di prima. */
export const pushTag = (groupKey: string) => `dts:${hash(groupKey).slice(0, 16)}`

/**
 * L'header Topic (RFC 8030, al massimo 32 caratteri base64url): il
 * servizio push sostituisce un messaggio dello stesso gruppo non ancora
 * consegnato, cosi' un telefono spento riceve solo l'ultimo.
 */
export const pushTopic = (groupKey: string) => hash(groupKey).slice(0, 32)

const byte = (s: string) => Buffer.byteLength(s, 'utf8')

/** Taglia a n punti di codice con i puntini, senza spezzare un carattere. */
function taglia(s: string, n: number): string {
  const c = Array.from(s)
  return c.length <= n ? s : `${c.slice(0, Math.max(0, n - 1)).join('')}…`
}

/**
 * Il payload in JSON, al massimo PUSH_PAYLOAD_MAX byte. Il nome di un
 * evento puo' essere lungo (e in giapponese ogni carattere sono 3 byte):
 * si accorcia prima il corpo, poi il titolo. url, tag e kind sono corti e
 * fissi, quindi ci stanno sempre.
 */
export function pushPayload(j: PushJobFields, ts: number): string {
  const testo = pushText(j)
  const p: PushPayload = {
    v: 1,
    kind: j.kind,
    title: testo.title,
    body: testo.body,
    url: notificationLink(j.notification_id),
    tag: pushTag(j.group_key),
    ts,
  }
  let s = JSON.stringify(p)
  for (const campo of ['body', 'title'] as const) {
    while (byte(s) > PUSH_PAYLOAD_MAX && Array.from(p[campo]).length > 1) {
      // un taglio proporzionale all'eccesso, almeno di un carattere
      const lungo = Array.from(p[campo]).length
      const via = Math.max(1, Math.ceil((byte(s) - PUSH_PAYLOAD_MAX) / 3))
      p[campo] = taglia(p[campo], lungo - via)
      s = JSON.stringify(p)
    }
  }
  return s
}

/** La notifica di prova di Settings: niente dati, solo che il dispositivo riceve. */
export function testPayload(ts: number): string {
  const p: PushPayload = {
    v: 1,
    kind: 'test',
    title: 'Notifications are on',
    body: 'This device will show updates from Dokkan Team Sharing.',
    url: '/settings#browser-notifications',
    tag: 'dts:test',
    ts,
  }
  return JSON.stringify(p)
}
