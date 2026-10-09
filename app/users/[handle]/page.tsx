import type { Metadata } from 'next'
import { ProfilePage, metadataProfilo } from '@/components/profile/pagina'
import { staticProfileHandlesCached } from '@/lib/cache/profiles'

// /users/<handle>: il profilo pubblico, prima pagina dei clear. Pubblica e
// in cache, uguale per tutti: non legge mai la sessione (il proprietario
// lo riconoscono le isole client). Il corpo e' in components/profile.
//
// Al build si prerenderizzano i profili con piu' clear (al massimo 20); gli
// altri nascono alla prima visita e poi restano in cache (ISR), come gli
// eventi e le carte.
//
// instant = false: params si aspetta qui, in cima, cosi' notFound() e i
// 308 (nome lasciato, maiuscole) rispondono davvero 404 e 308, non 200 da
// dentro uno streaming gia' partito.
export const instant = false

type Props = { params: Promise<{ handle: string }> }

// Con cacheComponents generateStaticParams deve dare almeno una voce:
// senza profili con clear, un nome riservato che risponde 404.
export async function generateStaticParams() {
  const handles = await staticProfileHandlesCached()
  return (handles.length ? handles : ['users']).map((handle) => ({ handle }))
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { handle } = await props.params
  return metadataProfilo(handle, 1)
}

export default async function Profilo(props: Props) {
  const { handle } = await props.params
  return <ProfilePage raw={handle} page={1} />
}
