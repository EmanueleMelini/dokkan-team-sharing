import type { Metadata } from 'next'
import { ProfilePage, metadataProfilo } from '@/components/profile/pagina'
import { staticProfileHandlesCached } from '@/lib/cache/profiles'
import { parseProfilePage } from '@/lib/urls'

// /users/<handle>/p/<n>: le pagine dei clear dopo la prima. La pagina 1 e'
// solo /users/<handle> (p/1 e gli zeri iniziali sono 404): un URL per
// pagina. Come la prima: params in cima e instant = false.
export const instant = false

type Props = { params: Promise<{ handle: string; n: string }> }

// Almeno una voce: la pagina 2 del profilo con piu' clear (un 404 se non
// ne ha abbastanza). Il resto nasce alla prima visita.
export async function generateStaticParams() {
  const [primo] = await staticProfileHandlesCached()
  return [{ handle: primo ?? 'users', n: '2' }]
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { handle, n } = await props.params
  return metadataProfilo(handle, parseProfilePage(n))
}

export default async function PaginaProfilo(props: Props) {
  const { handle, n } = await props.params
  return <ProfilePage raw={handle} page={parseProfilePage(n)} />
}
