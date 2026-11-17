import { categoriesPayload } from '@/lib/categories'
import { listCategoriesForApiCached } from '@/lib/cache/categories'
import { CACHE_CATEGORIE } from '@/lib/cache/headers'

// Le categorie per l'app Android DokkanTS Category Helper (il pulsante
// "Check for updates") e per chiunque le voglia: pubbliche, uguali per
// tutti, in sola lettura. Niente CORS (la legge un'app, non una pagina di
// un altro sito), niente chiave.
//
// Non legge niente della richiesta (nessun parametro, header o cookie) e i
// dati stanno in 'use cache': con cacheComponents la rotta e' un prerender
// del build, servito dalla CDN senza funzioni, e un import la rigenera col
// tag catalog. Per questo GET non prende la request: leggerla la farebbe
// dinamica, una funzione a ogni chiamata.
export async function GET() {
  const body = categoriesPayload(await listCategoriesForApiCached())
  return Response.json(body, {
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CACHE_CATEGORIE },
  })
}
