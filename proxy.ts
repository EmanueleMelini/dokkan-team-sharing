import { NextResponse, type NextRequest } from 'next/server'
import { getSessionCookie } from 'better-auth/cookies'

// Solo per /admin. Con cacheComponents ogni rotta dinamica manda prima lo
// shell statico con 200, e il notFound() di requireAdmin arriva nello
// stream: un 404 "morbido" (noindex, ma status 200). Chi non ha nemmeno il
// cookie di sessione riceve qui un 404 vero, senza toccare il database.
//
// E' solo un controllo ottimista: il cookie non viene verificato. Chi ce
// l'ha passa, e il cancello vero resta requireAdmin (pagine e Server
// Action) e mod_assert nel database. Un membro collegato vede quindi il
// 404 morbido, senza nessun dato dell'area.

export function proxy(request: NextRequest) {
  // lo stesso prefisso di advanced.cookiePrefix in lib/auth/config.ts
  if (getSessionCookie(request, { cookiePrefix: 'dts' })) return NextResponse.next()
  // una rotta che non esiste: la pagina 404 del sito, con lo status giusto
  return NextResponse.rewrite(new URL('/_admin-not-found', request.url))
}

export const config = {
  matcher: ['/admin', '/admin/:path*'],
}
