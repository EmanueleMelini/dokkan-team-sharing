import 'server-only'
import { sql } from '@/lib/db'

// Le categorie per GET /api/v1/categories, che legge l'app Android DokkanTS
// Category Helper (il pulsante "Check for updates"): per ogni categoria il
// nome inglese, quello giapponese e gli alias (0037). Modulo puro, senza
// cache: lo avvolge lib/cache/categories.ts, e i test lo importano fuori
// da Next (db/test/queries.test.mts).
//
// L'uscita e' deterministica, perche' la rotta e' un prerender: con gli
// stessi dati una rigenerazione da' gli stessi byte e non costa scritture
// ISR (README, "Scritture ISR su Vercel Hobby"). Ordine per id, alias in
// ordine di code unit (collate "C", lo stesso di aliasesFor in
// db/import/categories/aliases.mjs), niente orari.

/** La versione dello schema della risposta: cambia solo se cambia la forma. */
export const CATEGORIES_API_VERSION = 1

export type CategoryApiEntry = {
  /** l'id della categoria nel gioco (card_categories.id del datamine) */
  id: number
  name_en: string
  /** dalle missioni dei titoli del datamine; null finche' non si conosce */
  name_ja: string | null
  /** minuscoli, senza doppioni, in ordine di code unit */
  aliases: string[]
}

export type CategoriesPayload = { version: number; categories: CategoryApiEntry[] }

/**
 * Le categorie con un nome inglese, per id. Il nome giapponese e' una
 * left join: una categoria nuova arriva anche prima che le missioni dei
 * titoli ne diano il nome. L'ordine degli alias e' quello della chiave
 * primaria (category_id, alias).
 */
export async function listCategoriesForApi(): Promise<CategoryApiEntry[]> {
  return sql<CategoryApiEntry>(
    `select c.id, en.name as name_en, ja.name as name_ja,
            coalesce((select array_agg(a.alias order by a.alias collate "C")
                      from category_alias a where a.category_id = c.id), '{}'::text[]) as aliases
     from category c
     join category_text en on en.category_id = c.id and en.locale = 'en'
     left join category_text ja on ja.category_id = c.id and ja.locale = 'ja'
     order by c.id`,
  )
}

/** Il corpo della risposta, con le chiavi sempre nello stesso ordine. */
export function categoriesPayload(rows: CategoryApiEntry[]): CategoriesPayload {
  return {
    version: CATEGORIES_API_VERSION,
    categories: rows.map((r) => ({ id: r.id, name_en: r.name_en, name_ja: r.name_ja, aliases: r.aliases })),
  }
}
