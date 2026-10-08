// La scrittura degli stage delle riedizioni (game-events/rerun-stages.mjs).
//
// Uno stage aggiunto si riconosce da stage.game_quest_id (migrazione 0017):
// (evento, quest) e' la sua chiave, cosi' un secondo giro ritrova lo stesso
// stage con lo stesso id, e le sue difficolta' con i loro (i clear ci
// puntano). Uno nuovo va in coda, dopo il seq piu' alto dell'evento; uno
// che c'e' gia' tiene il suo seq. Quello che il piano non da' piu' si
// toglie, tranne dove ci sono clear o tip, come negli altri import.
//
// Ogni update scrive solo se il valore cambia: un secondo giro uguale non
// cambia niente, e i contatori lo dicono.
const LOCALE = 'en'
const used = (r) => r.used

// Gli import che possiedono gli stage per (evento, seq), load-events e
// writeStages, prima di scrivere chiamano questa: uno stage aggiunto da una
// riedizione che occupa un seq che la loro fonte ora vuole si sposta in
// coda, con il suo id, invece di prendersi nome e difficolta' di un altro.
// wanted: [{ ev, seq }]. Ritorna quanti ne ha spostati.
export async function makeRoom(db, wanted) {
  const { rows } = await db.query(`
    select s.id, s.event_id from stage s
    join unnest($1::bigint[], $2::smallint[]) as d(ev, seq) on d.ev = s.event_id and d.seq = s.seq
    where s.game_quest_id is not null order by s.event_id, s.seq`,
  [wanted.map((w) => w.ev), wanted.map((w) => w.seq)])
  if (!rows.length) return 0
  const top = new Map()
  for (const w of wanted) top.set(String(w.ev), Math.max(top.get(String(w.ev)) ?? 0, w.seq))
  const { rows: mx } = await db.query(
    'select event_id, max(seq) as m from stage where event_id = any($1::bigint[]) group by event_id',
    [rows.map((r) => r.event_id)])
  for (const r of mx) top.set(String(r.event_id), Math.max(top.get(String(r.event_id)) ?? 0, r.m))
  for (const r of rows) {
    const seq = top.get(String(r.event_id)) + 1
    top.set(String(r.event_id), seq)
    await db.query('update stage set seq = $2 where id = $1', [r.id, seq])
    console.log(`  sposto lo stage ${r.id} dell'evento ${r.event_id} (da una riedizione) al seq ${seq}: il suo posto ora e' della fonte dell'evento`)
  }
  return rows.length
}

/** plan: planRerunStages(), [{ event_id, area, quest, name, tiers }] */
export async function writeRerunStages(db, plan) {
  // solo eventi che ci sono: un evento del gioco saltato (id occupato) no
  const { rows: evRows } = await db.query('select id from event where id = any($1::bigint[])',
    [[...new Set(plan.map((p) => p.event_id))]])
  const exists = new Set(evRows.map((r) => Number(r.id)))
  const st = plan.filter((p) => exists.has(p.event_id)).map((p) => ({ ...p }))

  // gli stage nuovi in coda, nell'ordine del piano
  const { rows: have } = await db.query(`
    select id, event_id, seq, game_quest_id from stage
    where event_id = any($1::bigint[])`, [[...exists]])
  const key = (ev, q) => `${ev}:${q}`
  const known = new Map(have.filter((r) => r.game_quest_id != null).map((r) => [key(r.event_id, r.game_quest_id), r]))
  const top = new Map()
  for (const r of have) top.set(Number(r.event_id), Math.max(top.get(Number(r.event_id)) ?? 0, r.seq))
  const fresh = st.filter((s) => !known.has(key(s.event_id, s.quest)))
  for (const s of fresh) {
    s.seq = (top.get(s.event_id) ?? 0) + 1
    top.set(s.event_id, s.seq)
  }
  const { rowCount: stageNew } = await db.query(`
    insert into stage (event_id, seq, game_quest_id)
    select * from unnest($1::bigint[], $2::smallint[], $3::int[])
    on conflict (event_id, game_quest_id) do nothing`,
  [fresh.map((s) => s.event_id), fresh.map((s) => s.seq), fresh.map((s) => s.quest)])

  // tutti gli stage aggiunti, ora con il loro id
  const { rows: mine } = await db.query(`
    select id, event_id, seq, game_quest_id from stage where game_quest_id is not null`)
  const idOf = new Map(mine.map((r) => [key(r.event_id, r.game_quest_id), r.id]))
  for (const s of st) s.id = idOf.get(key(s.event_id, s.quest))
  const { rowCount: named } = await db.query(`
    insert into stage_text (stage_id, locale, name, source)
    select d.s, $3, d.n, 'official' from unnest($1::bigint[], $2::text[]) as d(s, n)
    on conflict (stage_id, locale) do update set name = excluded.name, source = excluded.source
    where (stage_text.name, stage_text.source) is distinct from (excluded.name, excluded.source)`,
  [st.map((s) => s.id), st.map((s) => s.name), LOCALE])

  const tr = st.flatMap((s) => s.tiers.map((t) => ({ stage: s.id, ev: s.event_id, ...t })))
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
    select id, stage_id, difficulty::text as d from stage_tier where stage_id = any($1::bigint[])`,
  [mine.map((r) => r.id)])
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

  // quello che il piano non da' piu', fra gli stage aggiunti: via, tranne
  // dove gli utenti hanno scritto
  const { rows: old } = await db.query(`
    select t.id, t.event_id, s.seq, t.difficulty::text as difficulty,
           exists (select 1 from clear c where c.stage_tier_id = t.id)
             or exists (select 1 from tip p where p.stage_tier_id = t.id) as used
    from stage_tier t join stage s on s.id = t.stage_id
    where s.game_quest_id is not null and not (t.id = any($1::bigint[]))`, [tr.map((t) => t.id)])
  await db.query('delete from stage_tier where id = any($1::bigint[])', [old.filter((x) => !used(x)).map((x) => x.id)])
  for (const x of old.filter(used)) console.log(`  tengo evento ${x.event_id} stage ${x.seq} ${x.difficulty}: la riedizione non lo da' piu' ma ci sono clear o tip`)
  const { rowCount: stageGone } = await db.query(`
    delete from stage s where s.game_quest_id is not null and not (s.id = any($1::bigint[]))
      and not exists (select 1 from stage_tier t where t.stage_id = s.id)`, [st.map((s) => s.id)])
  return { stages: st.length, events: new Set(st.map((s) => s.event_id)).size, stageNew, stageGone, named,
           tiers: tr.length, tierNew: tierRows.filter((r) => r.inserted).length,
           tierChanged: tierRows.filter((r) => !r.inserted).length,
           tierGone: old.length - old.filter(used).length, notes }
}
