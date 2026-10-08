-- =====================================================================
--  I testi completi delle skill di una carta, per la pagina della carta.
--
--  card_text tiene una riga per carta con leader, passiva e super di
--  base: basta alla ricerca e al builder, ma non alla pagina. Una carta
--  ha anche la Ultra Super Attack, l'abilita' attiva, lo standby, il
--  dominio, la condizione di trasformazione, e ognuna puo' cambiare con
--  l'EZA e la Super EZA. Una colonna per ogni combinazione sarebbero
--  decine di colonne quasi sempre vuote: qui e' una riga per skill.
--
--  La chiave naturale (card_id, locale, kind, tier, seq) e' quella che
--  rende l'import idempotente: load-cards cancella e riscrive le righe
--  'official' delle carte che importa, nella stessa transazione.
--  seq numera le skill dello stesso tipo (le tre super di Beerus in Rage,
--  le Unit Super, i Finish), da 1.
--
--  description tiene gli a capo del wiki: una riga per effetto, "- " per
--  un punto elenco, le altre righe sono i titoletti ("Basic effect(s)").
--  details sono le note <ref> del wiki, i numeri esatti dietro a "Raises
--  DEF": separate dal testo perche', incollate dentro, lo rendevano
--  illeggibile ("for 1 turnRaises SA Multiplier by 30%...").
-- =====================================================================

create type card_skill_kind as enum (
  'leader', 'super', 'ultra', 'passive', 'active', 'standby', 'domain',
  'transform', 'unit_super', 'ex_super', 'finish');

-- base = la carta come esce; eza = Extreme Z-Awakening; seza = Super EZA
create type card_skill_tier as enum ('base', 'eza', 'seza');

create table card_skill (
  card_id      bigint not null references card on delete cascade,
  locale       text   not null references locale on delete cascade,
  kind         card_skill_kind not null,
  tier         card_skill_tier not null default 'base',
  seq          smallint not null default 1
               constraint card_skill_seq check (seq between 1 and 9),
  name         text constraint card_skill_name check (name is null or btrim(name) <> ''),
  description  text not null constraint card_skill_description check (btrim(description) <> ''),
  details      text[] not null default '{}',
  condition    text constraint card_skill_condition check (condition is null or btrim(condition) <> ''),
  -- il tipo di attacco come lo scrive il wiki ('Ki', 'M', ...), quando c'e'
  ki           text,
  source       text_source not null default 'official',
  primary key (card_id, locale, kind, tier, seq)
);


-- ---------------------------------------------------------------------
--  La preferenza artwork statico / animato (colonna di 0006)
-- ---------------------------------------------------------------------

-- Un verbo e non un update dall'app, come gli altri: l'id arriva dalla
-- sessione, e un utente che non ha finito l'onboarding non ha ancora un
-- profilo da configurare. Ritorna il valore salvato, cosi' l'azione puo'
-- confermarlo senza rileggere.
create function set_prefers_animated(p_user uuid, p_value boolean) returns boolean
language plpgsql as $$
begin
  if p_value is null then
    raise exception 'valore mancante' using errcode = '23514', constraint = 'prefers_animated_missing';
  end if;
  update app_user set prefers_animated = p_value, updated_at = now()
   where id = p_user and onboarded_at is not null;
  if not found then
    raise exception 'utente inesistente o senza onboarding'
      using errcode = 'P0002', constraint = 'user_not_found';
  end if;
  return p_value;
end $$;
