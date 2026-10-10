// Il mittente vero (lib/notify/push-send.ts) contro un servizio push
// locale, per db/test/push-app.test.mts. Un servizio vero (FCM, Mozilla,
// Apple) da qui non si raggiunge, e non serve: si prova che la richiesta
// che parte e' quella giusta. Il "browser" e' una coppia di chiavi P-256
// fatta qui; il corpo si decifra con RFC 8291 (aes128gcm) scritto da capo,
// e il token VAPID (RFC 8292) si verifica con la chiave pubblica del
// server. La lista degli host si allarga SOLO in questo file (allow), per
// 127.0.0.1 su http.
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, randomBytes, verify } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createPushSender, perOgni, PUSH_TTL_S } from '@/lib/notify/push-send'

type Verifiche = {
  check: (nome: string, ok: boolean, dettaglio?: string) => void
  vale: <T>(nome: string, got: T, atteso: T) => void
}

type Arrivata = { method: string; path: string; headers: IncomingMessage['headers']; body: Buffer }

/** RFC 8291: il payload in chiaro, con la chiave privata e il segreto auth del browser. */
function decifra(body: Buffer, browser: ReturnType<typeof createECDH>, auth: Buffer): string {
  const salt = body.subarray(0, 16)
  const idlen = body[20]
  const serverPub = body.subarray(21, 21 + idlen)
  const cifrato = body.subarray(21 + idlen)
  const segreto = browser.computeSecret(serverPub)
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), browser.getPublicKey(), serverPub])
  const ikm = Buffer.from(hkdfSync('sha256', segreto, auth, info, 32))
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16))
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12))
  const d = createDecipheriv('aes-128-gcm', cek, nonce)
  d.setAuthTag(cifrato.subarray(cifrato.length - 16))
  const chiaro = Buffer.concat([d.update(cifrato.subarray(0, cifrato.length - 16)), d.final()])
  // l'ultimo record finisce con 0x02 seguito da zeri di riempimento
  let fine = chiaro.length - 1
  while (fine >= 0 && chiaro[fine] === 0) fine--
  if (chiaro[fine] !== 2) throw new Error('delimitatore del record mancante')
  return chiaro.subarray(0, fine).toString('utf8')
}

/** RFC 8292: 'vapid t=<jwt>, k=<chiave>' firmato ES256 con la chiave del server. */
function leggiVapid(header: string | undefined, publicKey: string) {
  const m = /^vapid t=([^,\s]+),\s*k=([A-Za-z0-9_-]+)$/.exec(header ?? '')
  if (!m) return null
  const [h, p, firma] = m[1].split('.')
  const punto = Buffer.from(publicKey, 'base64url')
  const chiave = createPublicKey({
    key: { kty: 'EC', crv: 'P-256', x: punto.subarray(1, 33).toString('base64url'), y: punto.subarray(33).toString('base64url') },
    format: 'jwk',
  })
  const buona = verify('sha256', Buffer.from(`${h}.${p}`), { key: chiave, dsaEncoding: 'ieee-p1363' }, Buffer.from(firma, 'base64url'))
  return { k: m[2], buona, claims: JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as { aud: string; sub: string; exp: number } }
}

export async function provaMittente(v: Verifiche, vapid: { publicKey: string; privateKey: string }) {
  console.log('lib/notify/push-send.ts: contro un servizio push locale')
  const arrivate: Arrivata[] = []
  // il servizio finto: risponde con il codice scritto nel percorso
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const pezzi: Buffer[] = []
    req.on('data', (c: Buffer) => pezzi.push(c))
    req.on('end', () => {
      arrivate.push({ method: req.method ?? '', path: req.url ?? '', headers: req.headers, body: Buffer.concat(pezzi) })
      const codice = Number(/\/push\/(\d{3})/.exec(req.url ?? '')?.[1] ?? 201)
      if (req.url?.includes('/lento/')) return // non risponde mai: il tempo massimo
      if (codice === 301) res.writeHead(301, { Location: '/altrove' })
      else res.writeHead(codice)
      res.end()
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  const browser = createECDH('prime256v1')
  browser.generateKeys()
  const auth = randomBytes(16)
  const dispositivo = (path: string) => ({ id: '00000000-0000-4000-8000-000000000001', endpoint: `${base}${path}`, p256dh: browser.getPublicKey('base64url'), auth: auth.toString('base64url') })
  const env = { ...vapid, subject: 'mailto:privacy@example.invalid' }
  const manda = createPushSender(env, { allow: (e) => e.startsWith(`${base}/`), timeoutMs: 300 })
  try {
    const payload = JSON.stringify({ v: 1, kind: 'clear_comment', title: 'Goku_99 commented on your clear', body: 'In イベント.', url: '/notifications/7', tag: 'dts:x', ts: 1 })
    v.vale('201 dal servizio', await manda(dispositivo('/push/201/abc'), payload, { topic: 'abcdefghijklmnopqrstuvwxyz012345' }), 201)
    const a = arrivate[0]
    v.check('una POST all\'endpoint', a?.method === 'POST' && a.path === '/push/201/abc')
    v.vale('gli header di RFC 8030 e 8291', [a?.headers['content-encoding'], a?.headers.ttl, a?.headers.urgency, a?.headers.topic, a?.headers['content-type']],
      ['aes128gcm', String(PUSH_TTL_S), 'normal', 'abcdefghijklmnopqrstuvwxyz012345', 'application/octet-stream'])
    v.check('il corpo non contiene il testo in chiaro', !a?.body.includes(Buffer.from('Goku_99')) && !a?.body.includes(Buffer.from('notifications')))
    let chiaro = ''
    try { chiaro = decifra(a.body, browser, auth) } catch (e) { chiaro = `errore: ${e instanceof Error ? e.message : e}` }
    v.vale('decifrato con la chiave del browser: il payload esatto', chiaro, payload)
    const t = leggiVapid(a?.headers.authorization, vapid.publicKey)
    v.check('VAPID: firma ES256 valida con la chiave pubblica del server', t?.buona === true && t.k === vapid.publicKey)
    v.check('VAPID: aud e\' l\'origine dell\'endpoint, sub il contatto, exp entro 24 ore',
      t?.claims.aud === base && t.claims.sub === env.subject && t.claims.exp > Date.now() / 1000 && t.claims.exp <= Date.now() / 1000 + 86_400,
      JSON.stringify(t?.claims))
    const altro = createECDH('prime256v1')
    altro.generateKeys()
    let rifiutato = false
    try { decifra(a.body, altro, auth) } catch { rifiutato = true }
    v.check('con un\'altra chiave non si decifra', rifiutato)

    v.vale('404, 410, 413, 429, 500 passano come sono', await perOgni([404, 410, 413, 429, 500], 6, (c) => manda(dispositivo(`/push/${c}/x`), payload)), [404, 410, 413, 429, 500])
    const prima = arrivate.length
    v.vale('un 301 non si segue', await manda(dispositivo('/push/301/x'), payload), 301)
    v.check('nessuna richiesta verso il Location', arrivate.length === prima + 1 && !arrivate.some((x) => x.path === '/altrove'))
    const t0 = Date.now()
    v.vale('un servizio che non risponde: 0 dopo il tempo massimo', await manda(dispositivo('/lento/x'), payload), 0)
    v.check('il tempo massimo regge', Date.now() - t0 < 2000, `${Date.now() - t0} ms`)
    v.vale('chiavi del browser rotte: 400 senza richiesta', await manda({ ...dispositivo('/push/201/y'), p256dh: 'BAAA' }, payload), 400)

    // il mittente come in produzione: la lista chiusa vale anche qui
    const vero = createPushSender(env, { timeoutMs: 300 })
    const n = arrivate.length
    v.vale('senza allow: un host fuori lista non parte (null)', await vero(dispositivo('/push/201/z'), payload), null)
    v.vale('neanche un https fuori lista', await vero({ ...dispositivo('/x'), endpoint: 'https://evil.example/fcm/send/x' }, payload), null)
    v.check('nessuna richiesta partita', arrivate.length === n)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((r) => server.close(() => r()))
  }
  v.vale('perOgni: al massimo n insieme, esiti in ordine', await (async () => {
    let attivi = 0
    let max = 0
    const r = await perOgni([1, 2, 3, 4, 5, 6, 7, 8], 3, async (x) => {
      attivi++
      max = Math.max(max, attivi)
      await new Promise((ok) => setTimeout(ok, 5))
      attivi--
      return x * 2
    })
    return { r, max }
  })(), { r: [2, 4, 6, 8, 10, 12, 14, 16], max: 3 })
}
