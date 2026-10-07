// La scrittura di load-game-events: tutto per chiave naturale, tenendo gli
// id, e senza toccare quello che non e' suo.
//
//   event, event_text   solo gli eventi con imported_from = 'datamine'
//   event_game_ref      solo le righe con source = 'game' (le altre sono di
//                       load-windows, che a sua volta non tocca queste)
//   stage, stage_tier   solo degli eventi del gioco; uno stage o una
//                       difficolta' che il gioco non da' piu' si toglie, a
//                       meno che un clear o un tip ci puntino (come in
//                       load-events)
//   cover_card_id       di tutti gli eventi con un legame al gioco: e' una
//                       colonna nuova che nessun altro scrive
//
// Ogni update scrive solo se il valore cambia: un secondo giro uguale non
// cambia niente, e i contatori lo dicono.
const LOCALE = 'en'
const used = (r) => r.used

// gli eventi e i loro nomi
export async function writeEvents(db, built) {
  const { rows: clash } = await db.query(`
    select id from event where id = any($1::bigint[]) and imported_from <> 'datamine'`, [built.map((e) => e.id)])
  const taken = new Set(clash.map((r) => Number(r.id)))
  for (const id of taken) console.log(`  salto ${id}: c'e' gia' un evento con questo id che non viene dal gioco`)
  const evs = built.filter((e) => !taken.has(e.id))
  const { rows } = await db.query(`
    insert into event (id, kind, imported_from, wiki_title, banner_key, cover_card_id)
    select d.id, d.kind, 'datamine', null, null, d.cover
    from unnest($1::bigint[], $2::event_kind[], $3::bigint[]) as d(id, kind, cover)
    on conflict (id) do update set kind = excluded.kind, cover_card_id = excluded.cover_card_id, imported_at = now()
    where (event.kind, event.cover_card_id) is distinct from (excluded.kind, excluded.cover_card_id)
    returning (xmax = 0) as inserted`,
    [evs.map((e) => e.id), evs.map((e) => e.kind), evs.map((e) => e.cover)])
  const { rowCount: renamed } = await db.query(`
    insert into event_text (event_id, locale, name, official_description, source)
    select d.id, $3, d.name, null, 'official' from unnest($1::bigint[], $2::text[]) as d(id, name)
    on conflict (event_id, locale) do update set name = excluded.name
    where event_text.name is distinct from excluded.name`,
    [evs.map((e) => e.id), evs.map((e) => e.name), LOCALE])
  return { evs, created: rows.filter((r) => r.inserted).length,
           updated: rows.filter((r) => !r.inserted).length, texts: renamed, taken: taken.size }
}

// il ponte verso il gioco, per differenza sulle righe source = 'game'
export async function writeRefs(db, refs) {
  const { rows: wikiHeld } = await db.query(`
    select g.game_kind, g.game_id, g.event_id from event_game_ref g
    join unnest($1::text[], $2::int[]) as d(k, id) on d.k = g.game_kind and d.id = g.game_id
    where g.source <> 'game'`, [refs.map((r) => r.game_kind), refs.map((r) => r.game_id)])
  const held = new Set(wikiHeld.map((r) => `${r.game_kind}:${r.game_id}`))
  for (const r of wikiHeld) console.log(`  salto il legame ${r.game_kind} ${r.game_id}: e' gia' dell'evento del wiki ${r.event_id}`)
  const ok = refs.filter((r) => !held.has(`${r.game_kind}:${r.game_id}`))
  const { rows } = await db.query(`
    insert into event_game_ref (event_id, game_kind, game_id, via, keys, confidence, source, related_game_id)
    select d.event_id, d.k, d.id, d.via, string_to_array(d.keys, ','), d.conf, 'game', d.rel
    from unnest($1::bigint[], $2::text[], $3::int[], $4::text[], $5::text[], $6::text[], $7::int[])
         as d(event_id, k, id, via, keys, conf, rel)
    on conflict (game_kind, game_id) do update set
      event_id = excluded.event_id, via = excluded.via, keys = excluded.keys,
      confidence = excluded.confidence, related_game_id = excluded.related_game_id
    where event_game_ref.source = 'game'
      and (event_game_ref.event_id, event_game_ref.via, event_game_ref.keys, event_game_ref.confidence, event_game_ref.related_game_id)
          is distinct from (excluded.event_id, excluded.via, excluded.keys, excluded.confidence, excluded.related_game_id)
    returning (xmax = 0) as inserted`,
    [ok.map((r) => r.event_id), ok.map((r) => r.game_kind), ok.map((r) => r.game_id), ok.map((r) => r.via),
     ok.map((r) => r.keys.join(',')), ok.map((r) => r.confidence), ok.map((r) => r.related ?? null)])
  const { rowCount: gone } = await db.query(`
    delete from event_game_ref g where g.source = 'game'
      and not exists (select 1 from unnest($1::text[], $2::int[]) as d(k, id) where d.k = g.game_kind and d.id = g.game_id)`,
    [ok.map((r) => r.game_kind), ok.map((r) => r.game_id)])
  return { written: ok.length, created: rows.filter((r) => r.inserted).length,
           changed: rows.filter((r) => !r.inserted).length, gone, held: wikiHeld.length }
}

// stage, difficolta' e note degli eventi del gioco
export async function writeStages(db, evs) {
  const ids = evs.map((e) => e.id)
  const st = evs.flatMap((e) => e.stages.map((s) => ({ ev: e.id, ...s })))
  const { rowCount: stageNew } = await db.query(`
    insert into stage (event_id, seq) select * from unnest($1::bigint[], $2::smallint[])
    on conflict (event_id, seq) do nothing`, [st.map((s) => s.ev), st.map((s) => s.seq)])
  const { rows: sr } = await db.query('select id, event_id, seq from stage where event_id = any($1::bigint[])', [ids])
  const sid = new Map(sr.map((r) => [`${r.event_id}:${r.seq}`, r.id]))
  for (const s of st) s.id = sid.get(`${s.ev}:${s.seq}`)
  const { rowCount: named } = await db.query(`
    insert into stage_text (stage_id, locale, name, source)
    select d.s, $3, d.n, 'official' from unnest($1::bigint[], $2::text[]) as d(s, n)
    on conflict (stage_id, locale) do update set name = excluded.name
    where stage_text.name is distinct from excluded.name`,
    [st.map((s) => s.id), st.map((s) => s.name), LOCALE])

  const tr = st.flatMap((s) => s.tiers.map((t) => ({ stage: s.id, ev: s.ev, ...t })))
  const { rows: tierRows } = await db.query(`
    insert into stage_tier (stage_id, event_id, difficulty, sta_cost, exp, zeni)
    select * from unnest($1::bigint[], $2::bigint[], $3::difficulty[], $4::smallint[], $5::int[], $6::int[])
    on conflict (stage_id, difficulty) do update set
      sta_cost = excluded.sta_cost, exp = excluded.exp, zeni = excluded.zeni
    where (stage_tier.sta_cost, stage_tier.exp, stage_tier.zeni)
          is distinct from (excluded.sta_cost, excluded.exp, excluded.zeni)
    returning (xmax = 0) as inserted`,
    [tr.map((t) => t.stage), tr.map((t) => t.ev), tr.map((t) => t.difficulty),
     tr.map((t) => t.sta_cost), tr.map((t) => t.exp), tr.map((t) => t.zeni)])
  const { rows: tid } = await db.query(`
    select id, stage_id, difficulty::text as d from stage_tier where event_id = any($1::bigint[])`, [ids])
  const tierId = new Map(tid.map((r) => [`${r.stage_id}:${r.d}`, r.id]))
  for (const t of tr) t.id = tierId.get(`${t.stage}:${t.difficulty}`)
  const noted = tr.filter((t) => t.note)
  const { rowCount: notes } = await db.query(`
    insert into stage_tier_text (stage_tier_id, locale, boss_note, source)
    select d.t, $3, d.n, 'official' from unnest($1::bigint[], $2::text[]) as d(t, n)
    on conflict (stage_tier_id, locale) do update set boss_note = excluded.boss_note, source = excluded.source
    where (stage_tier_text.boss_note, stage_tier_text.source) is distinct from (excluded.boss_note, excluded.source)`,
    [noted.map((t) => t.id), noted.map((t) => t.note), LOCALE])
  await db.query('delete from stage_tier_text where stage_tier_id = any($1::bigint[]) and locale = $2',
    [tr.filter((t) => !t.note).map((t) => t.id), LOCALE])

  // quello che il gioco non da' piu': via, tranne dove gli utenti hanno scritto
  const { rows: old } = await db.query(`
    select t.id, t.event_id, s.seq, t.difficulty::text as difficulty,
           exists (select 1 from clear c where c.stage_tier_id = t.id)
             or exists (select 1 from tip p where p.stage_tier_id = t.id) as used
    from stage_tier t join stage s on s.id = t.stage_id
    where t.event_id = any($1::bigint[]) and not (t.id = any($2::bigint[]))`, [ids, tr.map((t) => t.id)])
  await db.query('delete from stage_tier where id = any($1::bigint[])', [old.filter((x) => !used(x)).map((x) => x.id)])
  for (const x of old.filter(used)) console.log(`  tengo evento ${x.event_id} stage ${x.seq} ${x.difficulty}: il gioco non lo da' piu' ma ci sono clear o tip`)
  const { rowCount: stageGone } = await db.query(`
    delete from stage s where s.event_id = any($1::bigint[]) and not (s.id = any($2::bigint[]))
      and not exists (select 1 from stage_tier t where t.stage_id = s.id)`, [ids, st.map((s) => s.id)])
  return { stages: st.length, stageNew, stageGone, named, tiers: tr.length,
           tierNew: tierRows.filter((r) => r.inserted).length, tierChanged: tierRows.filter((r) => !r.inserted).length,
           tierGone: old.length - old.filter(used).length, notes }
}

// la copertina degli eventi del wiki: dal loro legame principale
export async function writeWikiCovers(db, covers) {
  const { rowCount } = await db.query(`
    update event e set cover_card_id = d.c
    from unnest($1::bigint[], $2::bigint[]) as d(id, c)
    where e.id = d.id and e.imported_from <> 'datamine' and e.cover_card_id is distinct from d.c`,
    [covers.map((x) => x.id), covers.map((x) => x.cover)])
  return rowCount
}
