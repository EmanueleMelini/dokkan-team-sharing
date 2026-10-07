// Gira una volta all'avvio del server, prima della prima richiesta.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { startAuth } = await import('@/lib/auth/startup')
  await startAuth()
}
