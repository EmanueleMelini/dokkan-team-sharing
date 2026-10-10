// Gira una volta all'avvio del server, prima della prima richiesta.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { startAuth } = await import('@/lib/auth/startup')
  await startAuth()
  // Le push sono facoltative: senza chiavi VAPID restano spente e il server
  // parte lo stesso. Una riga nei log solo se le chiavi sono a meta' o
  // sbagliate, mai i valori.
  const { logPushEnv } = await import('@/lib/notify/push-env')
  logPushEnv()
}
