// Gli alias "@/..." di tsconfig per Node, cosi' i test importano lib/ cosi'
// com'e', senza copie e senza un passo di build.
//
// Node non legge tsconfig, e con i tipi tolti al volo vuole l'estensione
// esplicita: '@/lib/db' diventa <radice>/lib/db.ts. Il resto passa al
// risolutore normale, che decide anche il formato del file.
//
//   node --experimental-strip-types --import ./db/test/alias.mjs file.mts
//
// Lo stesso file fa le due parti: nel thread principale si registra, nel
// thread degli hook (dove isMainThread e' falso) esporta resolve().
import { register } from 'node:module'
import { isMainThread } from 'node:worker_threads'

const ROOT = new URL('../../', import.meta.url)

if (isMainThread) register(import.meta.url)

export async function resolve(specifier, context, next) {
  // 'server-only' fuori da Next lancia sempre (non c'e' la condizione
  // react-server): nei test i moduli di lib/ girano gia' sul server, quindi
  // vale un modulo vuoto.
  if (specifier === 'server-only') return { url: 'data:text/javascript,', shortCircuit: true }
  if (!specifier.startsWith('@/')) return next(specifier, context)
  const rel = specifier.slice(2)
  const file = /\.(ts|mts|tsx|js|mjs)$/.test(rel) ? rel : `${rel}.ts`
  return next(new URL(file, ROOT).href, context)
}
