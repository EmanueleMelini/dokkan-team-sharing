-- =====================================================================
--  Tip: consigli brevi dei giocatori su un evento o su un tier.
--
--  La tabella c'era da 0001 ma senza regole: nessun verbo di scrittura,
--  nessuno stato, nessun limite. Qui:
--    - ogni tip appartiene a un evento; quella di uno stage (o livello
--      EZA) punta a un tier DELLO STESSO evento (FK composita);
--    - 10-500 caratteri di testo semplice, al massimo un link https, gli
--      accorciatori rifiutati con la stessa regola delle prove (proof_host);
--    - solo voti "helpful" (+1): una tip sbagliata si segnala, non si
--      vota giu';
--    - lo stato published/hidden della moderazione (0024), senza
--      'flagged': nessun nascondimento automatico dopo N segnalazioni;
--    - i verbi post_tip, edit_tip, delete_tip, vote_tip, con i limiti per
--      ora di 0024 ('tip' 10, 'tip_edit' 30) e al massimo 3 tip vive per
--      autore sullo stesso bersaglio;
--    - report_content che accetta 'tip', e mod_set_tip_status.
--
--  Ogni rifiuto ha un nome in CONSTRAINT, tradotto da lib/tips/errors.ts
--  (un test controlla che ogni nome 'tip_*' di questo file abbia la sua
--  frase). Le colonne di report, i tipi del registro delle scritture e i
--  loro limiti sono gia' di 0024: qui non si ridefiniscono.
-- =====================================================================


-- ---------------------------------------------------------------------
--  1. Il bersaglio: sempre un evento, e il tier solo se e' di quell'evento
-- ---------------------------------------------------------------------

-- Una tip con il solo tier (0001 lo permetteva) prende l'evento del tier;
-- una con evento e tier in disaccordo si fida del tier, che e' il piu'
-- preciso. Nessuna riga nei dati di oggi: e' la guardia per un database
-- che ne avesse.
update tip t set event_id = st.event_id
  from stage_tier st
 where st.id = t.stage_tier_id and t.event_id is distinct from st.event_id;

-- Lo stesso per le insert che arrivano senza evento (gli script e i test
-- scritti prima di questa migrazione): l'evento si deduce dal tier. Senza
-- tier resta null, e lo rifiuta il NOT NULL qui sotto.
create or replace function tip_event_from_tier()
returns trigger language plpgsql as $fn$
begin
  if new.event_id is null and new.stage_tier_id is not null then
    select event_id into new.event_id from stage_tier where id = new.stage_tier_id;
  end if;
  return new;
end $fn$;

create trigger tip_event_from_tier before insert on tip
  for each row execute function tip_event_from_tier();

alter table tip drop constraint tip_has_target;
alter table tip alter column event_id set not null;
-- MATCH SIMPLE: con stage_tier_id null la FK non si controlla, ed e' la
-- tip di tutto l'evento. stage_tier (id, event_id) e' unico da 0001.
alter table tip add constraint tip_tier_in_event
  foreign key (stage_tier_id, event_id) references stage_tier (id, event_id) on delete cascade;


-- ---------------------------------------------------------------------
--  2. Link, stato, modifica, lunghezze
-- ---------------------------------------------------------------------

alter table tip
  add column link_url      text,
  add column link_provider text,
  add column status        text not null default 'published'
    constraint tip_status_check check (status in ('published', 'hidden')),
  add column edited_at     timestamptz,
  add constraint tip_body_len check (char_length(body) between 10 and 500),
  -- la stessa forma delle prove (0016): https, niente spazi, 500 caratteri.
  -- Blocca anche javascript: e data:, che finirebbero in un href.
  add constraint tip_link_ok check (
    link_url is null
    or (link_url ~* '^https://[^/\s]+' and link_url !~ '\s' and char_length(link_url) <= 500)),
  add constraint tip_link_provider check (link_provider is null or link_url is not null);

drop index tip_by_event;
-- La lista della pagina: per evento, poi tier (null = tutto l'evento).
create index tip_by_target on tip (event_id, stage_tier_id, score desc, created_at desc)
  where status = 'published';
-- La cascata del tier (FK composita) e i controlli degli import
-- ("questo tier ha tip?") cercano per tier.
create index tip_by_tier on tip (stage_tier_id) where stage_tier_id is not null;
-- Il tetto per bersaglio, la cancellazione dell'account, /api/me.
create index tip_by_author on tip (author_id, event_id);
-- La stessa tip due volte sullo stesso bersaglio: maiuscole e spazi non
-- contano. Vale anche contro una tip nascosta: ripubblicarla uguale non
-- la riporta in pagina.
create unique index tip_no_duplicate on tip (
  author_id, event_id, coalesce(stage_tier_id, 0),
  md5(regexp_replace(lower(btrim(body)), '\s+', ' ', 'g')));


-- ---------------------------------------------------------------------
--  3. I voti: solo "helpful"
-- ---------------------------------------------------------------------

-- Un eventuale voto negativo se ne va (il trigger ricalcola il punteggio).
delete from tip_vote where value <> 1;
alter table tip_vote drop constraint tip_vote_value_check;
alter table tip_vote add constraint tip_vote_value_check check (value = 1);
alter table tip_vote add column voted_at timestamptz not null default now();
-- la cancellazione dell'account e lo stato di chi guarda (/api/me)
create index tip_vote_by_user on tip_vote (user_id);


-- ---------------------------------------------------------------------
--  4. Gli aiutanti della validazione
-- ---------------------------------------------------------------------

-- Come builder_fail (0016), con il codice: 23514 input sbagliato, 42501
-- non e' tuo.
create or replace function tip_fail(p_constraint text, p_msg text, p_code text default '23514')
returns void language plpgsql as $fn$
begin
  raise exception '%', p_msg using errcode = p_code, constraint = p_constraint;
end $fn$;

-- Il testo ripulito ai lati, 10-500 caratteri (come tip_body_len).
create or replace function tip_clean_body(p_body text)
returns text language plpgsql immutable as $fn$
declare v text := btrim(p_body);
begin
  if v is null or char_length(v) not between 10 and 500 then
    perform tip_fail('tip_body', 'una tip ha da 10 a 500 caratteri');
  end if;
  return v;
end $fn$;

-- Il link facoltativo: vuoto = nessun link. Altrimenti https, senza spazi,
-- al massimo 500 caratteri, e un host che proof_provider (0002) accetta:
-- un accorciatore nasconde dove porta, quindi no. Torna l'URL e il
-- provider (null per un host che non e' in proof_host).
create or replace function tip_clean_link(p_link text)
returns table (url text, provider text) language plpgsql stable as $fn$
declare
  v text := nullif(btrim(p_link), '');
  v_provider text;
begin
  if v is null then
    return query select null::text, null::text;
    return;
  end if;
  if v !~* '^https://[^/\s]+' or v ~ '\s' or char_length(v) > 500 then
    perform tip_fail('tip_link', 'il link deve essere un indirizzo https:// completo');
  end if;
  begin
    v_provider := proof_provider(v);
  exception when check_violation then
    perform tip_fail('tip_link', format('host non ammesso: %s', v));
  end;
  return query select v, v_provider;
end $fn$;

-- Il bersaglio: l'evento esiste, e il tier (se c'e') e' di quell'evento.
create or replace function tip_assert_target(p_event bigint, p_tier bigint)
returns void language plpgsql stable as $fn$
begin
  if p_event is null or not exists (select 1 from event where id = p_event) then
    perform tip_fail('tip_target', format('evento inesistente: %s', p_event));
  end if;
  if p_tier is not null and not exists (select 1 from stage_tier where id = p_tier and event_id = p_event) then
    perform tip_fail('tip_target', format('il tier %s non e'' dell''evento %s', p_tier, p_event));
  end if;
end $fn$;


-- ---------------------------------------------------------------------
--  5. Scrivere, modificare, cancellare
-- ---------------------------------------------------------------------

-- Torna l'id della tip nuova.
create or replace function post_tip(p_user uuid, p_event bigint, p_tier bigint, p_body text, p_link text)
returns uuid language plpgsql as $fn$
declare
  v_body text;
  v_url  text;
  v_prov text;
  v_id   uuid;
begin
  perform builder_assert_author(p_user);
  perform tip_assert_target(p_event, p_tier);
  v_body := tip_clean_body(p_body);
  select l.url, l.provider into v_url, v_prov from tip_clean_link(p_link) l;

  -- lo stesso lucchetto di note_clear_write: due invii simultanei non
  -- passano entrambi il tetto per bersaglio
  perform pg_advisory_xact_lock(hashtextextended('clear_write:' || p_user::text, 0));
  if (select count(*) from tip
       where author_id = p_user and event_id = p_event
         and stage_tier_id is not distinct from p_tier and status = 'published') >= 3 then
    perform tip_fail('tip_per_target', 'gia'' 3 tip su questo bersaglio');
  end if;
  -- un rifiuto dopo questa riga annulla anche la riga del registro
  perform note_clear_write(p_user, 'tip');
  begin
    insert into tip (author_id, event_id, stage_tier_id, body, lang, link_url, link_provider)
    values (p_user, p_event, p_tier, v_body, 'en', v_url, v_prov)
    returning id into v_id;
  exception when unique_violation then
    perform tip_fail('tip_duplicate', 'la stessa tip e'' gia'' qui');
  end;
  return v_id;
end $fn$;

-- Testo e link nuovi; i voti restano, e la tip si mostra "edited". Una
-- modifica che non cambia niente non scrive e non conta per il limite.
-- Torna l'evento, per invalidare la sua pagina.
create or replace function edit_tip(p_user uuid, p_tip uuid, p_body text, p_link text)
returns bigint language plpgsql as $fn$
declare
  v_row  tip;
  v_body text;
  v_url  text;
  v_prov text;
begin
  perform builder_assert_author(p_user);
  select * into v_row from tip where id = p_tip for update;
  if not found or v_row.status <> 'published' then
    perform tip_fail('tip_missing', format('tip inesistente o nascosta: %s', p_tip));
  end if;
  if v_row.author_id <> p_user then
    perform tip_fail('tip_not_yours', 'la tip non e'' tua', '42501');
  end if;
  v_body := tip_clean_body(p_body);
  select l.url, l.provider into v_url, v_prov from tip_clean_link(p_link) l;
  if v_body = v_row.body and v_url is not distinct from v_row.link_url then
    return v_row.event_id;
  end if;
  perform note_clear_write(p_user, 'tip_edit');
  begin
    update tip set body = v_body, link_url = v_url, link_provider = v_prov, edited_at = now()
     where id = p_tip;
  exception when unique_violation then
    perform tip_fail('tip_duplicate', 'la stessa tip e'' gia'' qui');
  end;
  return v_row.event_id;
end $fn$;

-- Come delete_clear: niente builder_assert_author, perche' chi e' sospeso
-- deve poter togliere quello che ha scritto (0024). Solo l'autore. La
-- cascata porta via i voti, il trigger report_target_gone (0019) le
-- segnalazioni. Torna l'evento, per invalidare la sua pagina.
create or replace function delete_tip(p_user uuid, p_tip uuid)
returns bigint language plpgsql as $fn$
declare v_event bigint;
begin
  delete from tip where id = p_tip and author_id = p_user returning event_id into v_event;
  if not found then
    perform tip_fail('tip_not_yours', 'tip inesistente o non tua', '42501');
  end if;
  return v_event;
end $fn$;


-- ---------------------------------------------------------------------
--  6. Votare: 1 = "helpful", 0 = ritirato
--
--  Idempotente: due 1 di fila lasciano un voto solo. Nessun limite per
--  ora: un voto per persona e tip, e il secondo non scrive. Torna il
--  punteggio.
-- ---------------------------------------------------------------------

create or replace function vote_tip(p_user uuid, p_tip uuid, p_value smallint)
returns int language plpgsql as $fn$
declare
  v_author uuid;
  v_status text;
  v_score  int;
begin
  perform builder_assert_author(p_user);
  if p_value is null or p_value not in (0, 1) then
    perform tip_fail('tip_vote_value', 'un voto su una tip vale 1, o 0 per ritirarlo');
  end if;
  select author_id, status into v_author, v_status from tip where id = p_tip;
  if not found or v_status <> 'published' then
    perform tip_fail('tip_missing', format('tip inesistente o nascosta: %s', p_tip));
  end if;
  if v_author = p_user then
    perform tip_fail('tip_own_vote', 'non si vota la propria tip', '42501');
  end if;
  if p_value = 1 then
    insert into tip_vote (tip_id, user_id, value) values (p_tip, p_user, 1)
    on conflict (tip_id, user_id) do nothing;
  else
    delete from tip_vote where tip_id = p_tip and user_id = p_user;
  end if;
  select score into v_score from tip where id = p_tip;
  return v_score;
end $fn$;


-- ---------------------------------------------------------------------
--  7. Segnalare una tip
--
--  report_content di 0024, copiata com'era: stessi codici, stessi nomi
--  dei vincoli, stesso lucchetto. Cambia solo che 'tip' e' un tipo
--  ammesso: si segnala una tip pubblicata, non tua, con i motivi di
--  report_reasons('tip'). Il doppione aperto torna l'id che c'era.
-- ---------------------------------------------------------------------

create or replace function report_content(
  p_user uuid, p_kind text, p_target uuid, p_reason text, p_details text
) returns uuid language plpgsql as $fn$
declare
  v_author  uuid;
  v_details text := nullif(btrim(p_details), '');
  v_id      uuid;
begin
  perform builder_assert_author(p_user);
  if p_kind is null or p_kind not in ('clear', 'comment', 'tip') then
    raise exception 'tipo di bersaglio non segnalabile: %', p_kind
      using errcode = '23514', constraint = 'report_kind';
  end if;
  if p_kind = 'clear' then
    select c.author_id into v_author
      from clear c where c.id = p_target and c.status = 'published';
  elsif p_kind = 'comment' then
    select m.author_id into v_author
      from clear_comment m
      join clear_version v on v.id = m.version_id
      join clear c on c.id = v.clear_id
     where m.id = p_target and m.status = 'published' and c.status = 'published';
  else
    select t.author_id into v_author
      from tip t where t.id = p_target and t.status = 'published';
  end if;
  if v_author is null then
    raise exception 'bersaglio inesistente o non visibile: % %', p_kind, p_target
      using errcode = '23514', constraint = 'report_target_missing';
  end if;
  if v_author = p_user then
    raise exception 'non si segnala un proprio contenuto'
      using errcode = '23514', constraint = 'report_own';
  end if;
  if p_reason is null or not (p_reason = any (report_reasons(p_kind))) then
    raise exception 'motivo non ammesso per %: %', p_kind, p_reason
      using errcode = '23514', constraint = 'report_reason';
  end if;
  if (p_reason = 'other' and v_details is null) or char_length(v_details) > 500 then
    raise exception 'dettagli mancanti (per "other") o oltre i 500 caratteri'
      using errcode = '23514', constraint = 'report_details';
  end if;

  -- lo stesso lucchetto di note_clear_write: il controllo del doppione e
  -- il conteggio stanno in fila con le altre scritture di questo utente
  perform pg_advisory_xact_lock(hashtextextended('clear_write:' || p_user::text, 0));
  select id into v_id from report
   where reporter_id = p_user and target_kind = p_kind and target_id = p_target and status = 'open';
  if found then
    return v_id;
  end if;
  begin
    perform note_clear_write(p_user, 'report');
  exception when sqlstate '54000' then
    raise exception 'troppe segnalazioni nell''ultima ora: massimo %', clear_write_limit('report')
      using errcode = '54000', constraint = 'report_rate_limit';
  end;
  insert into report (reporter_id, target_kind, target_id, reason, details)
  values (p_user, p_kind, p_target, p_reason, v_details)
  returning id into v_id;
  return v_id;
end $fn$;


-- ---------------------------------------------------------------------
--  8. Nascondere e rimostrare una tip
--
--  Come mod_set_comment_status (0024): solo un admin (mod_assert),
--  idempotente (lo stesso stato torna 0 e non scrive il registro),
--  nascondere chiude come 'actioned' le segnalazioni aperte. Nel
--  dettaglio del registro l'evento e il tier: sono id, servono a
--  ritrovare la pagina; il testo della tip non ci va mai.
-- ---------------------------------------------------------------------

create or replace function mod_set_tip_status(p_mod uuid, p_tip uuid, p_status text, p_note text)
returns int language plpgsql as $fn$
declare
  v_handle citext := mod_assert(p_mod);
  v_note   text := mod_note(p_note);
  v_row    tip;
  v_n      int := 0;
begin
  perform mod_status(p_status);
  select * into v_row from tip where id = p_tip for update;
  if not found then
    raise exception 'tip inesistente: %', p_tip
      using errcode = '23514', constraint = 'mod_target_missing';
  end if;
  if v_row.status = p_status then
    return 0;
  end if;
  update tip set status = p_status where id = p_tip;
  if p_status = 'hidden' then
    v_n := mod_close_reports(p_mod, 'tip', p_tip, 'actioned');
  end if;
  insert into moderation_action
    (moderator_id, moderator_handle, action, target_kind, target_id, target_author_id, reports_closed, note, detail)
  values (p_mod, v_handle, case p_status when 'hidden' then 'hide' else 'unhide' end,
          'tip', p_tip, v_row.author_id, v_n, v_note,
          jsonb_strip_nulls(jsonb_build_object('event_id', v_row.event_id, 'tier_id', v_row.stage_tier_id)));
  return v_n;
end $fn$;
