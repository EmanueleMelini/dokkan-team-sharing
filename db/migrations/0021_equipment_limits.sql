-- =====================================================================
--  Le Skill Orb esclusive: chi puo' montare quale sfera.
--
--  Nel gioco (equipment_skill_limitations) ogni sfera ha UNA regola:
--    - per tipo e classe ("Skill Orb (Super AGL)", o tutti i tipi);
--    - per categoria ("Universe 6" Category);
--    - per lista di carte ([Character-Exclusive]);
--    - per nome ("name includes Goku": un set di card_unique_infos).
--  load-equipment le traduce sulle nostre carte: tipo e classe espansi
--  nelle coppie ammesse, la lista e il nome risolti in id delle nostre
--  carte (quelli della base, non della forma Z-awakened). Cosi' il
--  controllo qui e' solo una ricerca, e la regola per nome non dipende
--  da tabelle del gioco che non teniamo.
--
--  Una sfera senza riga in equipment_limit si monta su tutte: e' il caso
--  di una sfera nuova prima del suo import, meglio che bloccarla. Una
--  regola senza carte ammesse (le carte nominate non le abbiamo) invece
--  non si monta su nessuna, come nel gioco per chi non ha quelle carte.
--
--  Restano fuori i limiti che dipendono dalla copia del giocatore e non
--  dalla carta: il livello della Super Attack e i percorsi sbloccati.
-- =====================================================================

create table equipment_limit (
  equipment_id  bigint primary key references equipment on delete cascade,
  kind          text not null check (kind in ('type', 'category', 'card', 'name'))
);

create table equipment_limit_type (
  equipment_id  bigint     not null references equipment_limit on delete cascade,
  type          unit_type  not null,
  class         unit_class not null,
  primary key (equipment_id, type, class)
);

create table equipment_limit_category (
  equipment_id  bigint   not null references equipment_limit on delete cascade,
  category_id   smallint not null references category on delete cascade,
  primary key (equipment_id, category_id)
);

-- per 'card' e 'name': le carte ammesse, gia' risolte
create table equipment_limit_card (
  equipment_id  bigint not null references equipment_limit on delete cascade,
  card_id       bigint not null references card on delete cascade,
  primary key (equipment_id, card_id)
);
create index equipment_limit_card_by_card on equipment_limit_card (card_id);

-- Vero se la carta puo' montare la sfera. Guarda solo la tabella del suo
-- tipo di regola: una riga rimasta in un'altra non allarga niente.
create or replace function equipment_fits(p_equipment bigint, p_card bigint)
returns boolean language sql stable as $fn$
  select coalesce((
    select case l.kind
      when 'type' then exists (
        select 1 from equipment_limit_type t join card c on c.type = t.type and c.class = t.class
        where t.equipment_id = l.equipment_id and c.id = p_card)
      when 'category' then exists (
        select 1 from equipment_limit_category x join card_category cc on cc.category_id = x.category_id
        where x.equipment_id = l.equipment_id and cc.card_id = p_card)
      else exists (
        select 1 from equipment_limit_card x where x.equipment_id = l.equipment_id and x.card_id = p_card)
    end
    from equipment_limit l where l.equipment_id = p_equipment), true);
$fn$;


-- ---------------------------------------------------------------------
--  Il builder: una sfera che la carta dello slot non puo' montare si
--  rifiuta. submit_clear_from_builder e revise_clear_from_builder (0016)
--  chiamano builder_check_payload per nome: si riscrive quella del 0018,
--  con tutti i suoi controlli e lo stesso ordine, e poi questo.
-- ---------------------------------------------------------------------

create or replace function builder_check_build_card(p_seq int, s jsonb)
returns void language plpgsql stable as $fn$
declare e jsonb; v_card bigint;
begin
  -- forma e esistenza delle sfere le ha gia' viste builder_check_build
  if jsonb_typeof(s->'build'->'equipment') is distinct from 'array' then return; end if;
  v_card := builder_int(s->'card_id');
  for e in select * from jsonb_array_elements(s->'build'->'equipment') loop
    continue when jsonb_typeof(e) = 'null';
    if not equipment_fits(builder_int(e), v_card) then
      perform builder_fail('builder_build_equipment_card',
        format('la carta %s non puo'' montare la sfera %s nell''assetto %s', v_card, e, p_seq));
    end if;
  end loop;
end $fn$;

create or replace function builder_check_payload(p jsonb)
returns void language plpgsql stable as $fn$
declare s jsonb;
begin
  -- prima tutto il 0016: dopo, assetti e slot hanno la forma giusta
  perform builder_check_payload_0016(p);
  for i in 1 .. jsonb_array_length(p->'lineups') loop
    for s in select * from jsonb_array_elements(p->'lineups'->(i - 1)->'slots') loop
      perform builder_check_build(i, s->'build');
    end loop;
  end loop;
  -- poi le esclusive, su build che hanno gia' passato tutto il 0018
  for i in 1 .. jsonb_array_length(p->'lineups') loop
    for s in select * from jsonb_array_elements(p->'lineups'->(i - 1)->'slots') loop
      perform builder_check_build_card(i, s);
    end loop;
  end loop;
end $fn$;
