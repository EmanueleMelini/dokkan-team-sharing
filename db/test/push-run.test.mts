// Le push del browser (fase 4), lato app sul database di test: un giro
// vero di lib/notify/push.ts (push_claim, gli invii, push_report) con un
// mittente finto al posto dei servizi push, la notifica di prova e le
// letture di Settings.
//   - il testo che parte: chi ha commentato e dove, mai il testo del
//     commento; la moderazione generica;
//   - nessun client pg in uso mentre si manda (la pool resta libera);
//   - 410 toglie il dispositivo, 201 lo segna riuscito;
//   - il feed degli admin (site_activity, 0032): chi, cosa e dove, e il
//     Topic del suo gruppo;
//   - senza chiavi VAPID il giro non tocca il database.
//
// Gira dentro npm run db:test. Crea solo utenti pushrun+...@example.invalid
// e li toglie alla fine, anche se qualcosa fallisce.
import { createECDH, randomBytes } from 'node:crypto'
import webpush from 'web-push'
import { db } from '@/lib/db'
import { LEGALE } from '@/lib/legale'
import { endpointHash, pushDeviceListed, pushDevicesOf, pushKindsOn, runPush, sendTestPush } from '@/lib/notify/push'
import { pushTopic } from '@/lib/notify/payload'
import type { PushDevice, PushSender } from '@/lib/notify/push-send'
import { SUBMIT, check, dati, guardia, num, one, payload, q, stato, utente, type Dati } from '@/db/test/builder-helpers'

guardia()
const P = 'pushrun'
const SEGRETO = 'Secret comment body PUSHRUN-QQ'
const vapid = webpush.generateVAPIDKeys()
const env = { ...vapid, subject: 'mailto:privacy@example.invalid' }

const id = async (text: string, params: unknown[]) => (await one<{ id: string }>(text, params)).id
async function datiMinimi(): Promise<Dati> {
  try { return await dati() } catch { /* nessuna ricorrenza futura: va bene lo stesso */ }
  const base = await one<{ run: string; tier: string }>(
    `select r.id::text as run, st.id::text as tier from event_run r join stage_tier st on st.event_id = r.event_id
      where r.starts_at <= now() order by r.event_id, r.id, st.id limit 1`)
  const cards = (await q<{ id: string }>(
    `select c.id::text from card c join card_release r on r.card_id = c.id and r.reg = 'global'
      where r.released_at <= current_date order by c.id limit 8`)).map((r) => Number(r.id))
  return { run: base.run, tier: base.tier, futura: '', altraRun: '', cards }
}
async function vecchio(handle: string) {
  const u = await utente(P, handle)
  await db.query(`update app_user set created_at = now() - interval '2 days' where id = $1`, [u])
  return u
}
async function iscrivi(user: string) {
  const e = createECDH('prime256v1')
  e.generateKeys()
  const ep = `https://fcm.googleapis.com/fcm/send/${P}-${randomBytes(8).toString('hex')}`
  await db.query('select push_subscribe($1::uuid, $2, $3, $4, $5)', [user, ep, e.getPublicKey('base64url'), randomBytes(16).toString('base64url'), 'Chrome on Android'])
  return ep
}
const pref = (u: string, kind: string) => db.query("select set_notification_pref($1::uuid, $2, 'push', true)", [u, kind])

type Inviata = { device: PushDevice; payload: Record<string, unknown>; topic?: string; clientInUso: number }
/** Un mittente finto: annota cosa manda, quanti client pg sono in uso intanto, e risponde col codice scelto. */
function finto(codice: (d: PushDevice) => number): { sender: PushSender; inviate: Inviata[] } {
  const inviate: Inviata[] = []
  const sender: PushSender = async (device, p, o) => {
    await new Promise((r) => setTimeout(r, 20))
    inviate.push({ device, payload: JSON.parse(p), topic: o?.topic, clientInUso: db.totalCount - db.idleCount })
    return codice(device)
  }
  return { sender, inviate }
}

async function pulizia() {
  const tutti = `(select id from app_user where email like $1)`
  await db.query(`delete from clear where author_id in ${tutti}`, [`${P}+%@example.invalid`])
  await db.query('delete from app_user where email like $1', [`${P}+%@example.invalid`])
}

async function prove() {
  const d = await datiMinimi()
  const autore = await vecchio('pr_autore')
  const commenta = await vecchio('pr_commenta')
  const admin = await vecchio('pr_admin')
  await db.query(`update app_user set role = 'admin' where id = $1`, [admin])
  const clear = await id(SUBMIT, [autore, d.run, d.tier, JSON.stringify(payload(d.cards))])
  const versione = (await one<{ id: string }>('select id::text from clear_version where clear_id = $1 and is_current', [clear])).id
  const mie = (x: Inviata[]) => x.filter((i) => i.device.endpoint.includes(`/${P}-`))

  console.log('\n  -- runPush: un commento')
  const ep1 = await iscrivi(autore)
  await pref(autore, 'clear_comment')
  check('Settings: il tipo acceso si legge', JSON.stringify(await pushKindsOn(autore)) === '["clear_comment"]')
  await db.query('select comment_clear_version($1::uuid, $2::uuid, $3)', [commenta, versione, SEGRETO])
  const nid = (await one<{ id: string }>(`select id::text from notification where recipient_id = $1 and kind = 'clear_comment'`, [autore])).id

  const spente = await runPush({ env: null, sender: finto(() => 201).sender })
  check('senza chiavi VAPID: off, e la notifica resta da mandare',
    spente.status === 'off' && await num('select count(*) from notification where id = $1 and pushed_at is null', [nid]) === 1)

  const a = finto(() => 201)
  const r1 = await runPush({ env, sender: a.sender, now: () => 1760000000000 })
  const i1 = mie(a.inviate)
  check('una push al dispositivo dell\'autore', i1.length === 1 && i1[0].device.endpoint === ep1, JSON.stringify(r1))
  const p1 = i1[0]?.payload ?? {}
  check('il testo: chi ha commentato e dove', p1.title === 'pr_commenta commented on your clear' && String(p1.body).startsWith('In '), JSON.stringify(p1))
  check('mai il testo del commento', !JSON.stringify(a.inviate).includes(SEGRETO))
  check('url e topic della notifica', p1.url === `/notifications/${nid}` && i1[0].topic === pushTopic(`comments:${clear}`) && p1.ts === 1760000000000)
  check('nessun client pg in uso durante gli invii', a.inviate.every((x) => x.clientInUso === 0), a.inviate.map((x) => x.clientInUso).join(','))
  check('push_report: il 201 conta come riuscito', r1.ok >= 1 &&
    await num('select count(*) from push_subscription where endpoint = $1 and last_ok_at is not null and last_status = 201', [ep1]) === 1)
  const b = finto(() => 201)
  await runPush({ env, sender: b.sender })
  check('subito dopo: niente (coalescenza)', mie(b.inviate).length === 0)

  console.log('\n  -- runPush: moderazione, 410')
  const ep2 = await iscrivi(autore)
  for (const k of ['content_hidden', 'content_unhidden', 'suspended', 'suspension_lifted']) await pref(autore, k)
  await db.query('select mod_set_clear_status($1::uuid, $2::uuid, $3, null)', [admin, clear, 'hidden'])
  const c = finto((dev) => (dev.endpoint === ep2 ? 410 : 201))
  const r2 = await runPush({ env, sender: c.sender })
  const i2 = mie(c.inviate)
  check('due dispositivi, la stessa push', i2.length === 2 && new Set(i2.map((x) => JSON.stringify(x.payload))).size === 1)
  check('moderazione: frase generica, senza evento', i2[0]?.payload.title === 'A moderator updated one of your posts' &&
    !String(i2[0]?.payload.body).includes(' In '), JSON.stringify(i2[0]?.payload))
  check('il 410 toglie il dispositivo', r2.removed >= 1 && !(await pushDeviceListed(autore, ep2)) && await pushDeviceListed(autore, ep1))

  console.log('\n  -- runPush: il feed degli admin (site_activity, 0032)')
  await db.query("select set_notification_pref($1::uuid, 'site_activity', c, true) from unnest(array['list', 'push']) as c", [admin])
  const epAdmin = await iscrivi(admin)
  // rimostrato dall'admin stesso: nel suo feed non entra (mai a se stessi)
  await db.query('select mod_set_clear_status($1::uuid, $2::uuid, $3, null)', [admin, clear, 'published'])
  await db.query('select vote_clear_version($1::uuid, $2::uuid, 1::smallint)', [commenta, versione])
  const g = finto(() => 201)
  await runPush({ env, sender: g.sender })
  const allAdmin = mie(g.inviate).filter((x) => x.device.endpoint === epAdmin)
  const pf = allAdmin[0]?.payload ?? {}
  const nf = (await one<{ id: string }>(
    `select id::text from notification where recipient_id = $1 and kind = 'site_activity' and group_key = $2`, [admin, `act:clear_vote:${clear}`]))?.id
  check('il voto arriva all\'admin col feed acceso: una push, il suo testo', allAdmin.length === 1 && pf.kind === 'site_activity' &&
    pf.title === 'pr_commenta upvoted a clear' && typeof pf.body === 'string' && pf.body.length > 0 && pf.body !== 'Open it to see more.',
  JSON.stringify(pf))
  check('url e topic del gruppo del feed', pf.url === `/notifications/${nf}` && allAdmin[0]?.topic === pushTopic(`act:clear_vote:${clear}`))
  check('nessuna push del feed per la sua stessa azione', !mie(g.inviate).some((x) => x.device.endpoint === epAdmin &&
    /restored|unhide/i.test(String(x.payload.title))))
  check('il feed non scrive push_sent', await num('select count(*) from push_sent where recipient_id = $1', [admin]) === 0)

  console.log('\n  -- Settings: dispositivi e prova')
  const lista = await pushDevicesOf(autore)
  check('la lista: impronta e non endpoint, niente chiavi',
    lista.length === 1 && lista[0].hash === endpointHash(ep1) && !JSON.stringify(lista).includes(ep1) && !('p256dh' in lista[0]), JSON.stringify(lista))
  process.env.VAPID_PUBLIC_KEY = vapid.publicKey
  process.env.VAPID_PRIVATE_KEY = vapid.privateKey
  try {
    const t = finto(() => 201)
    check('la prova parte', await sendTestPush(autore, ep1, t.sender) === 'sent' && t.inviate[0]?.payload.kind === 'test')
    check('la seconda entro un minuto no', await sendTestPush(autore, ep1, t.sender) === 'rate' && t.inviate.length === 1)
    check('un endpoint di un altro: missing', await sendTestPush(commenta, ep1, t.sender) === 'missing' && t.inviate.length === 1)
  } finally {
    delete process.env.VAPID_PUBLIC_KEY
    delete process.env.VAPID_PRIVATE_KEY
  }
  check('senza chiavi la prova e\' off', await sendTestPush(autore, ep1, finto(() => 201).sender) === 'off')

  console.log('\n  -- la privacy dice gli stessi giorni di purge_push')
  const f = await one<{ args: string; src: string }>(
    `select pg_get_function_arguments(p.oid) as args, p.prosrc as src from pg_proc p where p.proname = 'purge_push'`)
  check('i dispositivi: LEGALE.giorniDispositiviPush come il default di purge_push', f.args.includes(`DEFAULT ${LEGALE.giorniDispositiviPush}`), f.args)
  check('il registro: LEGALE.giorniRegistroPush come in purge_push', f.src.includes(`interval '${LEGALE.giorniRegistroPush} days'`))
}

try {
  await pulizia()
  await prove()
} finally {
  await pulizia()
  check('nessun utente di prova resta', await num('select count(*) from app_user where email like $1', [`${P}+%@example.invalid`]) === 0)
  await db.end()
}
console.log(`\n  ${stato.passes} PASS, ${stato.fails} FAIL`)
process.exit(stato.fails ? 1 : 0)
