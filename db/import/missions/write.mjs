// Le scritture di load-missions. Tutte upsert per chiave naturale
// (game_mission_id, (item_type, item_id), (mission_id, seq)), in blocco con
// unnest: settemila missioni una per una sarebbero settemila andate e
// ritorno. Ogni funzione dice quante righe ha toccato davvero: un
// secondo giro uguale deve dire zero.

// Gli oggetti e il loro nome inglese.
export async function writeItems(db, items) {
  const v = [...items.values()]
  const a = (f) => v.map(f)
  const ins = await db.query(`
    insert into game_item (item_type, item_id, reward_item_slug, card_id)
    select * from unnest($1::text[], $2::int[], $3::text[], $4::bigint[])
    on conflict (item_type, item_id) do update
      set reward_item_slug = excluded.reward_item_slug, card_id = excluded.card_id
      where (game_item.reward_item_slug, game_item.card_id)
            is distinct from (excluded.reward_item_slug, excluded.card_id)
    returning 1`, [a((i) => i.item_type), a((i) => i.item_id), a((i) => i.slug), a((i) => i.card_id)])
  const txt = await db.query(`
    insert into game_item_text (item_type, item_id, locale, name, source)
    select t, i, 'en', n, s::text_source from unnest($1::text[], $2::int[], $3::text[], $4::text[]) as x(t, i, n, s)
    on conflict (item_type, item_id, locale) do update
      set name = excluded.name, source = excluded.source
      where (game_item_text.name, game_item_text.source) is distinct from (excluded.name, excluded.source)
    returning 1`, [a((i) => i.item_type), a((i) => i.item_id), a((i) => i.name), a((i) => i.source)])
  return { items: ins.rowCount, texts: txt.rowCount }
}

// Le missioni: riga e testo. Restituisce Map(game_mission_id -> mission.id).
export async function writeMissions(db, ms) {
  const a = (f) => ms.map(f)
  const up = await db.query(`
    insert into mission (game_mission_id, event_id, run_id, seq, starts_at, ends_at, imported_from)
    select g, e, r, s, st, en, 'datamine'
      from unnest($1::int[], $2::bigint[], $3::bigint[], $4::smallint[], $5::timestamptz[], $6::timestamptz[])
        as x(g, e, r, s, st, en)
    on conflict (game_mission_id) do update
      set event_id = excluded.event_id, run_id = excluded.run_id, seq = excluded.seq,
          starts_at = excluded.starts_at, ends_at = excluded.ends_at, imported_from = 'datamine'
      where (mission.event_id, mission.run_id, mission.seq, mission.starts_at, mission.ends_at, mission.imported_from)
            is distinct from (excluded.event_id, excluded.run_id, excluded.seq, excluded.starts_at,
                              excluded.ends_at, 'datamine'::data_source)
    returning (xmax = 0) as inserted`,
    [a((m) => m.game_id), a((m) => m.event_id), a((m) => m.run_id), a((m) => m.seq),
     a((m) => m.starts_at), a((m) => m.ends_at)])
  const ids = new Map((await db.query(
    `select game_mission_id, id from mission where game_mission_id = any($1::int[])`, [a((m) => m.game_id)],
  )).rows.map((r) => [r.game_mission_id, Number(r.id)]))
  const txt = await db.query(`
    insert into mission_text (mission_id, locale, name, description, reward, source)
    select i, 'en', n, d, r, 'official' from unnest($1::bigint[], $2::text[], $3::text[], $4::text[]) as x(i, n, d, r)
    on conflict (mission_id, locale) do update
      set name = excluded.name, description = excluded.description, reward = excluded.reward, source = 'official'
      where (mission_text.name, mission_text.description, mission_text.reward, mission_text.source)
            is distinct from (excluded.name, excluded.description, excluded.reward, 'official'::text_source)
    returning 1`,
    [a((m) => ids.get(m.game_id)), a((m) => m.name), a((m) => m.description), a((m) => m.reward)])
  const inserted = up.rows.filter((r) => r.inserted).length
  return { ids, inserted, updated: up.rowCount - inserted, texts: txt.rowCount }
}

// I premi: upsert per (mission_id, seq), e via quelli oltre l'ultimo seq
// (un premio tolto dal gioco).
export async function writeRewards(db, ms, ids) {
  const rows = ms.flatMap((m) => m.rewards.map((r) => ({ ...r, mission_id: ids.get(m.game_id) })))
  const a = (f) => rows.map(f)
  const up = await db.query(`
    insert into mission_reward (mission_id, seq, item_type, item_id, quantity)
    select * from unnest($1::bigint[], $2::smallint[], $3::text[], $4::int[], $5::bigint[])
    on conflict (mission_id, seq) do update
      set item_type = excluded.item_type, item_id = excluded.item_id, quantity = excluded.quantity
      where (mission_reward.item_type, mission_reward.item_id, mission_reward.quantity)
            is distinct from (excluded.item_type, excluded.item_id, excluded.quantity)
    returning 1`, [a((r) => r.mission_id), a((r) => r.seq), a((r) => r.item_type), a((r) => r.item_id), a((r) => r.quantity)])
  const del = await db.query(`
    delete from mission_reward w using unnest($1::bigint[], $2::smallint[]) as x(i, n)
     where w.mission_id = x.i and w.seq > x.n`,
    [ms.map((m) => ids.get(m.game_id)), ms.map((m) => m.rewards.length)])
  return { rewards: rows.length, written: up.rowCount, removed: del.rowCount }
}
