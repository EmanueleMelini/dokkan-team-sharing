import 'server-only'
import { cacheLife, cacheTag } from 'next/cache'
import { listCategoriesForApi } from '@/lib/categories'
import { TAG } from '@/lib/cache/tags'

// Le categorie di GET /api/v1/categories, in cache come gli altri dati del
// gioco: cambiano solo con un import, che manda il tag catalog. Dentro
// 'use cache' la rotta si prerenderizza al build, e un import la rigenera
// (sezione "L'API delle categorie" del README).

export async function listCategoriesForApiCached() {
  'use cache'
  cacheLife('catalog')
  cacheTag(TAG.catalog)
  return listCategoriesForApi()
}
