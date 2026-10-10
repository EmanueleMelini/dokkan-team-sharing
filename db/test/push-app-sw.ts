// public/sw.js in node:vm, la parte delle push (fase 4), per
// db/test/push-app.test.mts: il push valido e quello che non si capisce,
// e il clic sulla notifica (una finestra del sito o una nuova, mai un URL
// di un altro sito). La parte offline la prova db/test/pwa.test.mts.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'

type Verifiche = {
  check: (nome: string, ok: boolean, dettaglio?: string) => void
  vale: <T>(nome: string, got: T, atteso: T) => void
}

const ORIGINE = 'https://dokkants.example'
const SORGENTE = readFileSync(join(import.meta.dirname, '..', '..', 'public', 'sw.js'), 'utf8')

type Finestra = { url: string; focus: () => Promise<Finestra>; navigate: (u: string) => Promise<Finestra | null> }
type Gestore = (e: Record<string, unknown>) => void

function sandbox(finestre: { url: string; naviga?: 'ok' | 'null' | 'errore' }[] = []) {
  const gestori: Record<string, Gestore> = {}
  const registro: string[] = []
  const mostrate: { title: string; options: Record<string, unknown> }[] = []
  const lista: Finestra[] = finestre.map((f) => {
    const w: Finestra = {
      url: f.url,
      focus: async () => { registro.push(`focus ${f.url}`); return w },
      navigate: async (u: string) => {
        registro.push(`navigate ${u}`)
        if (f.naviga === 'errore') throw new TypeError('not controlled')
        return f.naviga === 'null' ? null : w
      },
    }
    return w
  })
  const contesto = {
    self: {
      location: new URL(`${ORIGINE}/sw.js?v=abc123`),
      addEventListener: (tipo: string, f: Gestore) => { gestori[tipo] = f },
      registration: {
        showNotification: async (title: string, options: Record<string, unknown>) => { mostrate.push({ title, options }) },
      },
      clients: {
        matchAll: async (o: unknown) => { registro.push(`matchAll ${JSON.stringify(o)}`); return lista },
        openWindow: async (u: string) => { registro.push(`openWindow ${u}`); return null },
        claim: async () => {},
      },
      skipWaiting: async () => {},
    },
    caches: { open: async () => ({}), keys: async () => [], delete: async () => true },
    fetch: async () => { throw new Error('le push non fanno fetch') },
    Request: class {},
    Response: { error: () => 'ERRORE' },
    URL,
    Promise,
  }
  vm.runInNewContext(SORGENTE, contesto, { filename: 'public/sw.js' })
  return { gestori, registro, mostrate }
}

/** Manda un evento e aspetta i suoi waitUntil. */
async function evento(s: ReturnType<typeof sandbox>, tipo: string, dati: Record<string, unknown>) {
  const attese: Promise<unknown>[] = []
  s.gestori[tipo]({ ...dati, waitUntil: (p: Promise<unknown>) => { attese.push(p) } })
  await Promise.all(attese)
}

const push = (v: unknown) => ({ data: { json: () => (typeof v === 'function' ? (v as () => unknown)() : v) } })

export async function provaServiceWorker(v: Verifiche) {
  console.log('public/sw.js: push e notificationclick')
  {
    const s = sandbox()
    await evento(s, 'push', push({ v: 1, kind: 'clear_comment', title: 'Goku_99 commented on your clear', body: 'In Cell Max.', url: '/notifications/42', tag: 'dts:abc', ts: 1760000000000 }))
    v.vale('un push v1: la notifica con testo, tag, icona, badge e url', s.mostrate, [{
      title: 'Goku_99 commented on your clear',
      options: { body: 'In Cell Max.', tag: 'dts:abc', icon: '/pwa/icon-192.png', badge: '/pwa/badge-96.png', data: { url: '/notifications/42' }, timestamp: 1760000000000 },
    }])
  }
  const generica = async (nome: string, e: Record<string, unknown>) => {
    const s = sandbox()
    await evento(s, 'push', e)
    v.check(`${nome}: comunque una notifica, generica`,
      s.mostrate.length === 1 && s.mostrate[0].title === 'You have new activity' && (s.mostrate[0].options.data as { url: string }).url === '/notifications',
      JSON.stringify(s.mostrate))
  }
  await generica('JSON non valido', push(() => { throw new SyntaxError('bad json') }))
  await generica('senza dati', { data: null })
  await generica('versione sconosciuta', push({ v: 2, title: 'x', url: '/x' }))
  await generica('titolo vuoto', push({ v: 1, title: '  ', body: 'x', url: '/x' }))
  await generica('titolo enorme', push({ v: 1, title: 'x'.repeat(201), url: '/x' }))
  for (const url of ['https://evil.example/x', '//evil.example/x', '/\\evil.example', 'javascript:alert(1)', 42]) {
    const s = sandbox()
    await evento(s, 'push', push({ v: 1, title: 'T', body: 'B', url, tag: 'dts:t' }))
    v.vale(`url ${JSON.stringify(url)}: la lista, mai fuori dal sito`, (s.mostrate[0]?.options.data as { url: string })?.url, '/notifications')
  }

  const clic = async (finestre: Parameters<typeof sandbox>[0], url: unknown) => {
    const s = sandbox(finestre)
    let chiusa = false
    await evento(s, 'notificationclick', { notification: { data: { url }, close: () => { chiusa = true } } })
    return { registro: s.registro, chiusa }
  }
  {
    const r = await clic([], '/notifications/42')
    v.vale('nessuna finestra: se ne apre una sull\'URL', r.registro, ['matchAll {"type":"window"}', `openWindow ${ORIGINE}/notifications/42`])
    v.check('la notifica si chiude', r.chiusa)
  }
  {
    const r = await clic([{ url: 'https://altro.example/' }, { url: `${ORIGINE}/events` }], '/notifications/42')
    v.vale('una finestra del sito: in primo piano e portata all\'URL, nessuna nuova', r.registro,
      ['matchAll {"type":"window"}', `focus ${ORIGINE}/events`, `navigate ${ORIGINE}/notifications/42`])
  }
  {
    const r = await clic([{ url: `${ORIGINE}/events`, naviga: 'errore' }], '/notifications/9')
    v.check('una finestra che non si lascia navigare: una nuova',
      r.registro.at(-1) === `openWindow ${ORIGINE}/notifications/9`, r.registro.join(', '))
    const n = await clic([{ url: `${ORIGINE}/events`, naviga: 'null' }], '/notifications/9')
    v.check('navigate che torna null: una nuova', n.registro.at(-1) === `openWindow ${ORIGINE}/notifications/9`, n.registro.join(', '))
  }
  for (const url of ['https://evil.example/', '//evil.example/x', undefined]) {
    const r = await clic([], url)
    v.vale(`clic con url ${JSON.stringify(url)}: la lista del sito`, r.registro.at(-1), `openWindow ${ORIGINE}/notifications`)
  }
  {
    const r = await clic([], '/settings#browser-notifications')
    v.vale('la prova: Settings con l\'ancora', r.registro.at(-1), `openWindow ${ORIGINE}/settings#browser-notifications`)
  }
  v.check('i gestori delle push non usano caches ne\' fetch',
    !/caches\.|fetch\(/.test(SORGENTE.slice(SORGENTE.indexOf("sw.addEventListener('push'")).replace(/\/\/.*$/gm, '')))
}
