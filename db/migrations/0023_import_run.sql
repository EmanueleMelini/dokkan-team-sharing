-- =====================================================================
--  import_run: un registro degli aggiornamenti dei dati di gioco.
--
--  Serve a tre cose:
--    - un lucchetto fra macchine: prod:update dal Mac e il workflow
--      settimanale non devono importare insieme. Un advisory lock di
--      sessione non basta, perche' il pooler di Supabase puo' dare a
--      ogni comando una connessione diversa: qui il lucchetto e' una riga,
--      e l'indice unico parziale ne ammette una sola 'running';
--    - il "niente di nuovo": il workflow legge l'ultimo giro riuscito e,
--      se commit del datamine e contenuto del wiki sono gli stessi, non
--      rifa' niente;
--    - la storia: quando, da quale commit, con quale esito.
--
--  Un giro rimasto 'running' (il processo ucciso a meta') si considera
--  morto dopo 2 ore e il prossimo lo chiude come fallito: nessun import
--  dura tanto, e senza questo un crash bloccherebbe tutto per sempre.
-- =====================================================================

create table import_run (
  id                     bigint generated always as identity primary key,
  source                 text        not null check (source in ('ci', 'local')),
  status                 text        not null default 'running'
                                     check (status in ('running', 'ok', 'failed')),
  started_at             timestamptz not null default now(),
  finished_at            timestamptz,
  git_sha                text,
  datamine_commit        text,
  datamine_committed_at  timestamptz,
  wiki_fetched_at        timestamptz,
  summary                jsonb       not null default '{}'::jsonb,
  -- chiuso se e solo se non e' piu' in corso
  constraint import_run_finished check ((status = 'running') = (finished_at is null))
);

create unique index import_run_one_running on import_run ((true)) where status = 'running';
create index import_run_last_ok on import_run (finished_at desc) where status = 'ok';

-- Apre un giro. Rifiuta con P0001 se un altro e' in corso da meno di 2 ore.
create or replace function import_run_begin(p_source text, p_git text)
returns bigint
language plpgsql as $$
declare
  v bigint;
begin
  update import_run
     set status = 'failed', finished_at = now(),
         summary = summary || '{"reason":"stale"}'::jsonb
   where status = 'running' and started_at < now() - interval '2 hours';
  insert into import_run (source, git_sha) values (p_source, p_git) returning id into v;
  return v;
exception when unique_violation then
  raise exception 'another import is running' using errcode = 'P0001';
end $$;

-- Chiude un giro aperto. Se nel frattempo e' stato chiuso come stale da
-- un altro, lo dice invece di riscriverne l'esito.
create or replace function import_run_end(
  p_id bigint, p_status text, p_summary jsonb,
  p_commit text, p_committed timestamptz, p_wiki timestamptz)
returns void
language plpgsql as $$
begin
  if p_status not in ('ok', 'failed') then
    raise exception 'import_run_end: status % non previsto', p_status using errcode = '22023';
  end if;
  update import_run
     set status = p_status, finished_at = now(),
         summary = summary || coalesce(p_summary, '{}'::jsonb),
         datamine_commit = p_commit, datamine_committed_at = p_committed,
         wiki_fetched_at = p_wiki
   where id = p_id and status = 'running';
  if not found then
    raise exception 'import_run % is not running any more', p_id using errcode = 'P0002';
  end if;
end $$;
