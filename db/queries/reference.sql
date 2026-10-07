-- =====================================================================
--  Le quattro query per cui il sito esiste.
--  Nessuno dei sette siti concorrenti sa risponderne una.
-- =====================================================================


-- 1. Eventi attivi adesso, quelli che scadono prima in testa.
--    Lo stato non è memorizzato: è la finestra a dirlo.
select event_id, name, kind, ends_at
from event_status
where status = 'active'
order by ends_at nulls last;


-- 2. Clear di questo stage fatti SENZA le carte del banner in corso.
--    $1 = stage_tier_id, $2 = array degli id carta del banner.
select c.id, c.turns, c.no_items, c.deathless, c.score, u.handle
from clear_current c
join app_user u on u.id = c.author_id
where c.stage_tier_id = $1
  and c.status = 'published'
  and not exists (
    select 1 from clear_card cc
    where cc.version_id = c.version_id
      and cc.card_id = any($2::bigint[])
  )
order by c.score desc, c.turns nulls last
limit 20;


-- 3. Clear di questo stage in cui TUTTE le 7 unità sono della categoria.
--    $1 = stage_tier_id, $2 = category_id (es. Wicked Bloodline).
select c.id, c.turns, c.score, u.handle
from clear_current c
join app_user u on u.id = c.author_id
where c.stage_tier_id = $1
  and c.status = 'published'
  and not exists (
    select 1
    from clear_card cc
    where cc.version_id = c.version_id
      and not exists (
        select 1 from card_category k
        where k.card_id = cc.card_id
          and k.category_id = $2
      )
  )
order by c.score desc, c.turns nulls last;


-- 4. Il meta reale di questo stage: non chi è forte in teoria,
--    ma chi compare nei clear che sono stati davvero fatti.
--    $1 = stage_tier_id.
-- Solo le versioni CORRENTI: il meta è quello che i clear dicono oggi,
-- non la somma di tutte le versioni che sono passate.
with published as (
  select id as clear_id, version_id
  from clear_current
  where stage_tier_id = $1 and status = 'published'
)
select
  cd.name,
  cd.epithet,
  cd.type,
  -- distinct obbligatorio: leader e friend possono essere la stessa carta,
  -- quindi count(*) conterebbe gli slot e non i clear (e il % sfonda il 100).
  count(distinct p.clear_id)                                   as clears,
  count(distinct p.clear_id) filter (where c.no_items)         as clears_no_items,
  count(distinct p.clear_id) filter (where cc.role = 'leader') as as_leader,
  round(100.0 * count(distinct p.clear_id)
        / (select count(*) from published), 1)           as pct_dei_clear
from clear c
join published p  on p.id = c.id
join clear_card cc on cc.clear_id = c.id
join card cd      on cd.id = cc.card_id
group by cd.id, cd.name, cd.epithet, cd.type
order by clears desc
limit 25;


-- 5. I clear rivisti, e su quale versione stanno i voti.
--    È la query che rende onesta la pagina: mostrare 503 quando la
--    versione che stai leggendo ne ha preso 3 sarebbe ingannevole.
select
  c.id,
  u.handle,
  r.current_seq          as versione_mostrata,
  r.current_score        as voti_di_questa_versione,
  r.versions             as versioni_totali,
  r.lifetime_score       as voti_di_tutta_la_storia,
  cv.change_note         as perche_e_cambiata
from clear_reputation r
join clear_current c on c.id = r.clear_id
join clear_version cv on cv.id = c.version_id
join app_user u on u.id = c.author_id
where r.revised
order by r.lifetime_score desc;
