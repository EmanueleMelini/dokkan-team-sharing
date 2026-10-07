import type { NextConfig } from 'next'

// In produzione ASSET_BASE_URL punta allo storage degli asset invece che a
// /assets. next/image ottimizza solo gli host dichiarati: senza questo ogni
// banner e ogni miniatura risponderebbe 400 mentre la pagina dà 200.
// Va impostata anche al build, perché questa configurazione si legge lì.
const base = process.env.ASSET_BASE_URL
const remoto = base && /^https?:\/\//.test(base) ? new URL(`${base.replace(/\/$/, '')}/**`) : null

const nextConfig: NextConfig = {
  images: { remotePatterns: remoto ? [remoto] : [] },
}

export default nextConfig
