// Le push del browser (fase 4), lato app, senza database:
//   - lib/notify/endpoint.ts contro gli stessi casi di push_endpoint_ok
//     (db/test/push-endpoints.ts), cosi' le due regole non divergono;
//   - le chiavi VAPID dall'ambiente (spente se mancano o sono sbagliate);
//   - i gruppi di Settings contro NOTIFICATION_KINDS;
//   - testo e payload (512 byte, l'URL, il tag, mai il testo dei post);
//   - il mittente vero contro un servizio push locale: la richiesta che
//     arriva si decifra con la chiave del "browser" (RFC 8291, scritta qui
//     da capo, non quella di web-push) e il token VAPID si verifica con la
//     chiave pubblica. La lista degli host si allarga SOLO qui, per
//     raggiungere 127.0.0.1;
//   - public/sw.js in node:vm: push valido e non valido, il clic.
import webpush from 'web-push'
import { pushEndpointOk, senzaPorta443 } from '@/lib/notify/endpoint'
import { NOTIFICATION_KINDS } from '@/lib/notify/kinds'
import { PUSH_PAYLOAD_MAX, pushPayload, pushTag, pushText, pushTopic, testPayload, type PushJobFields } from '@/lib/notify/payload'
import { pushEnvProblem, readPushEnv } from '@/lib/notify/push-env'
import { PUSH_GROUPS, pushGroupsOn } from '@/lib/notify/push-kinds'
import { etichettaDispositivo } from '@/lib/pwa/piattaforma'
import { ENDPOINT_BUONI, ENDPOINT_CATTIVI } from '@/db/test/push-endpoints'
import { provaMittente } from '@/db/test/push-app-sender'
import { provaServiceWorker } from '@/db/test/push-app-sw'

let fails = 0
let passes = 0
function check(nome: string, ok: boolean, dettaglio = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nome}${dettaglio ? `  (${dettaglio})` : ''}`)
  if (ok) passes++
  else fails++
}
const vale = <T,>(nome: string, got: T, atteso: T) =>
  check(nome, JSON.stringify(got) === JSON.stringify(atteso), JSON.stringify(got) === JSON.stringify(atteso) ? '' : `= ${JSON.stringify(got)}, atteso ${JSON.stringify(atteso)}`)

console.log('lib/notify/endpoint.ts: gli stessi casi del SQL')
check('i buoni passano', ENDPOINT_BUONI.every((e) => pushEndpointOk(e)), ENDPOINT_BUONI.filter((e) => !pushEndpointOk(e)).join(' '))
check('i cattivi no', ENDPOINT_CATTIVI.every((e) => !pushEndpointOk(e)), ENDPOINT_CATTIVI.filter((e) => pushEndpointOk(e)).join(' '))
check('1024 caratteri si, 1025 no', pushEndpointOk(`https://fcm.googleapis.com/${'a'.repeat(1024 - 27)}`) &&
  !pushEndpointOk(`https://fcm.googleapis.com/${'a'.repeat(1025 - 27)}`))
check('non stringhe no', [null, undefined, 42, {}, ['https://fcm.googleapis.com/x']].every((v) => !pushEndpointOk(v)))
check('http e IP locali no', !pushEndpointOk('http://127.0.0.1:4010/x') && !pushEndpointOk('https://localhost/x'))
vale('senza :443', senzaPorta443('https://fcm.googleapis.com:443/wp/abc'), 'https://fcm.googleapis.com/wp/abc')
vale('senza porta resta com\'e\'', senzaPorta443('https://web.push.apple.com/abc:443/x'), 'https://web.push.apple.com/abc:443/x')

console.log('lib/notify/push-env.ts')
const chiaviVapid = webpush.generateVAPIDKeys()
const envOk = { VAPID_PUBLIC_KEY: chiaviVapid.publicKey, VAPID_PRIVATE_KEY: chiaviVapid.privateKey }
vale('senza chiavi: spente, senza errore', [pushEnvProblem({}), readPushEnv({})], ['missing', null])
vale('una sola: spente', pushEnvProblem({ VAPID_PUBLIC_KEY: chiaviVapid.publicKey }), 'partial')
vale('formato sbagliato: spente', pushEnvProblem({ ...envOk, VAPID_PRIVATE_KEY: 'abc' }), 'invalid')
vale('soggetto sbagliato: spente', pushEnvProblem({ ...envOk, VAPID_SUBJECT: 'privacy@example.com' }), 'invalid')
vale('le chiavi di web-push vanno, soggetto per difetto quello della privacy',
  readPushEnv(envOk)?.subject, 'mailto:privacy@emanuelemelini.dev')
vale('VAPID_SUBJECT https', readPushEnv({ ...envOk, VAPID_SUBJECT: 'https://dokkants.example' })?.subject, 'https://dokkants.example')

console.log('lib/notify/push-kinds.ts')
const coperti = PUSH_GROUPS.flatMap((g) => g.kinds)
vale('i gruppi coprono ogni tipo una volta sola', [...coperti].sort(), [...NOTIFICATION_KINDS].sort())
check('reports solo per gli admin', PUSH_GROUPS.find((g) => g.id === 'reports')?.admin === true)
vale('un gruppo acceso solo se tutti i suoi tipi lo sono',
  pushGroupsOn(['clear_comment', 'content_hidden', 'reports_open'], false), ['comments'])
vale('gli admin vedono anche reports', pushGroupsOn(['reports_open'], true), ['reports'])

console.log('lib/notify/payload.ts: testi e misura')
const job = (x: Partial<PushJobFields>): PushJobFields => ({
  notification_id: '42', group_key: 'comments:abc', kind: 'clear_comment', n: 1, actor_handle: 'Goku_99',
  event_name: 'Fearsome Activation! Cell Max', stage_seq: 3, stage_name: null, difficulty: 'super2', ...x,
})
const t1 = pushText(job({}))
vale('un commento: chi e dove', t1.title, 'Goku_99 commented on your clear')
check('il corpo dice l\'evento', t1.body.startsWith('In Fearsome Activation! Cell Max'), t1.body)
vale('lo stage con lo stesso nome dell\'evento non si ripete',
  pushText(job({ event_name: 'Training at Korin Tower', stage_name: 'Training at Korin Tower', difficulty: 'normal' })).body,
  'In Training at Korin Tower, Normal.')
const t3 = pushText(job({ n: 3 }))
check('tre commenti: il conteggio e l\'ultimo', t3.title === '3 new comments on your clear' && t3.body.includes('Latest from Goku_99'), JSON.stringify(t3))
const mod = ['content_hidden', 'content_unhidden', 'suspended', 'suspension_lifted'].map((kind) => pushText(job({ kind, actor_handle: 'ModName' })))
check('moderazione: frasi generiche, senza evento ne\' moderatore',
  mod.every((t) => t.title.startsWith('A moderator updated') && !/Cell Max|ModName/.test(t.title + t.body)), JSON.stringify(mod))
vale('admin: N open reports', [pushText(job({ kind: 'reports_open', n: 1 })).title, pushText(job({ kind: 'reports_open', n: 4 })).title],
  ['1 open report', '4 open reports'])
vale('un tipo sconosciuto: generico', pushText(job({ kind: 'nuovo' })).title, 'You have new activity')
const tutti = [...NOTIFICATION_KINDS, 'nuovo'].flatMap((kind) => [1, 5].map((n) => pushText(job({ kind, n }))))
check('nessun trattino lungo nei testi', tutti.every((t) => !/[\u2014\u2013]/.test(t.title + t.body)))
const p = JSON.parse(pushPayload(job({}), 1760000000000))
vale('le chiavi del payload v1', Object.keys(p).sort(), ['body', 'kind', 'tag', 'title', 'ts', 'url', 'v'])
vale('url: la rotta che segna letta', p.url, '/notifications/42')
check('tag: dts: e stabile per gruppo', p.tag === pushTag('comments:abc') && p.tag.startsWith('dts:') && pushTag('comments:x') !== p.tag)
check('topic: 32 caratteri base64url', /^[A-Za-z0-9_-]{32}$/.test(pushTopic('comments:abc')))
for (const [nome, ev] of [['ASCII lungo', 'X'.repeat(900)], ['giapponese', 'イベント'.repeat(120)], ['emoji', '🐉'.repeat(200)]] as const) {
  const s = pushPayload(job({ event_name: ev, actor_handle: 'A'.repeat(24), n: 99 }), Date.now())
  const j = JSON.parse(s)
  check(`${nome}: al massimo ${PUSH_PAYLOAD_MAX} byte, JSON valido, titolo intero`,
    Buffer.byteLength(s) <= PUSH_PAYLOAD_MAX && j.title === '99 new comments on your clear' && j.body.endsWith('…') && !j.body.includes('�'),
    `${Buffer.byteLength(s)} byte`)
}
check('la prova porta a Settings', JSON.parse(testPayload(1)).url === '/settings#browser-notifications')

console.log('lib/pwa/piattaforma.ts: la label del dispositivo')
const ua = {
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
  firefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
}
vale('Chrome on Android', etichettaDispositivo({ ua: ua.android, maxTouchPoints: 5 }), 'Chrome on Android')
vale('Safari on iPhone', etichettaDispositivo({ ua: ua.iphone, maxTouchPoints: 5 }), 'Safari on iPhone')
vale('iPad che si dice Mac', etichettaDispositivo({ ua: ua.ipad, maxTouchPoints: 5 }), 'Safari on iPad')
vale('Safari on macOS', etichettaDispositivo({ ua: ua.ipad, maxTouchPoints: 0 }), 'Safari on macOS')
vale('Edge on Windows', etichettaDispositivo({ ua: ua.edge, maxTouchPoints: 0 }), 'Edge on Windows')
vale('Firefox on Linux', etichettaDispositivo({ ua: ua.firefox, maxTouchPoints: 0 }), 'Firefox on Linux')
vale('sconosciuto', etichettaDispositivo({ ua: 'curl/8', maxTouchPoints: 0 }), null)

await provaMittente({ check, vale }, chiaviVapid)
await provaServiceWorker({ check, vale })

console.log(`\n  ${passes + fails} verifiche, ${fails ? `${fails} ROSSE` : 'TUTTO VERDE'}`)
process.exit(fails ? 1 : 0)

