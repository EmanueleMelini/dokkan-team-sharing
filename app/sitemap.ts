import type { MetadataRoute } from 'next'
import { connection } from 'next/server'
import { readAuthEnv } from '@/lib/auth/env'
import { sql } from '@/lib/db'

// L'elenco e gli ultimi eventi usciti (la home rimanda a /events). Gli
// eventi sono migliaia: quelli vecchi i motori li trovano dall'elenco.
const ULTIMI_EVENTI = 200

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Letta a ogni richiesta, non al build: il build non deve aver bisogno
  // del database, e gli eventi nuovi arrivano con gli import, non col deploy.
  await connection()
  const base = readAuthEnv().baseURL.replace(/\/$/, '')
  const eventi = await sql<{ id: string; ultima: Date }>(
    `select r.event_id::text as id, max(r.starts_at) as ultima
       from event_run r
       -- come l'elenco: senza il nome in inglese l'evento non si mostra
       join event_text et on et.event_id = r.event_id and et.locale = 'en'
      where r.starts_at <= now()
      group by r.event_id
      order by ultima desc, r.event_id desc
      limit $1`,
    [ULTIMI_EVENTI],
  )
  return [
    { url: `${base}/events`, changeFrequency: 'daily' },
    ...eventi.map((e) => ({ url: `${base}/events/${e.id}`, lastModified: e.ultima })),
  ]
}
