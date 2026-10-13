// Una miniatura nuda finta (asset.frame false, migrazione 0034) per le
// letture delle pagine. Il database di test non scarica immagini: nessuna
// carta ha una miniatura, e un flag sempre false passerebbe anche con il
// join rotto. Qui alcune carte ricevono una riga di asset finta, nuda, per
// la durata di fn; poi le carte tornano come erano e le righe si tolgono.
//
// La query arriva da chi chiama (la pool di lib/db.ts): queries.test.mts la
// importa solo dopo aver scelto il database.
type Query = (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>

export const chiaveNuda = (id: string) => `test/nuda-${id}.webp`

export async function conMiniatureNude<T>(query: Query, ids: string[], fn: () => Promise<T>): Promise<T> {
  const prima = (await query('select id::text as id, thumb_key from card where id = any($1::bigint[])', [ids]))
    .rows as { id: string; thumb_key: string | null }[]
  const chiavi = ids.map(chiaveNuda)
  await query(`insert into asset (key, kind, content_type, byte_size, width, height, checksum, source, frame)
               select k, 'card_thumb', 'image/webp', 1, 250, 250, 'test', 'wiki', false from unnest($1::text[]) k
               on conflict (key) do update set frame = false`, [chiavi])
  await query(`update card set thumb_key = 'test/nuda-' || id || '.webp' where id = any($1::bigint[])`, [ids])
  try {
    return await fn()
  } finally {
    for (const r of prima) await query('update card set thumb_key = $1 where id = $2::bigint', [r.thumb_key, r.id])
    await query('delete from asset where key = any($1::text[])', [chiavi])
  }
}
