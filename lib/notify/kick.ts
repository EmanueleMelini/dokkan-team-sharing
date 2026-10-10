import 'server-only'
import { after } from 'next/server'
import { readPushEnv } from '@/lib/notify/push-env'
import { runPush } from '@/lib/notify/push'

// Il giro delle push dopo una scrittura che puo' aver creato notifiche:
// un commento, un'azione di moderazione, una segnalazione. after() lo fa
// partire quando la risposta e' gia' partita (su Vercel con waitUntil,
// dentro la durata massima della funzione): chi ha scritto non aspetta i
// servizi push.
//
// Il giro non e' solo per la notifica appena nata: push_claim prende tutte
// quelle fresche, quindi una push rimasta indietro (un tetto che si e'
// liberato) parte con la scrittura dopo, di chiunque sia.
//
// Senza chiavi VAPID non parte nemmeno la query.

export function kickPush() {
  if (!readPushEnv()) return
  after(async () => {
    try {
      await runPush()
    } catch (e) {
      // best effort: la notifica resta nella lista e nel digest
      console.error('[push] giro non riuscito:', e instanceof Error ? e.message : e)
    }
  })
}
