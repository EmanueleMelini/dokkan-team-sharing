-- =====================================================================
--  Gli alias delle categorie, e i nomi giapponesi.
--
--  Per l'app Android Dokkan Category Helper (la ricerca di una categoria in
--  inglese per scriverla in giapponese nel gioco JP) e per la pagina
--  /category-helper: GET /api/v1/categories da' per ogni categoria il nome
--  inglese, quello giapponese e gli alias.
--
--  I nomi giapponesi non hanno bisogno di schema: stanno in category_text
--  con locale 'ja' e source 'official', come previsto dalla 0001. Li scrive
--  load-datamine dalle missioni dei titoli del datamine Global
--  (db/import/categories/japanese-names.mjs); prima l'import cancellava ogni
--  riga di category_text e rimetteva solo quelle inglesi, ora aggiorna sul
--  posto e tiene l'ultimo nome noto.
--
--  Gli alias sono i modi brevi con cui si cerca una categoria ("tb", "rog",
--  "ssj3"), di due tipi:
--    initials  le iniziali del nome inglese, generate dall'import;
--    nickname  i soprannomi scritti a mano (db/import/categories/aliases.mjs).
--  Minuscoli e senza spazi ai bordi, come li confronta l'app; lo stesso
--  alias puo' stare su piu' categorie ("gf": Giant Form, Ginyu Force, ...).
--  Dati di gioco (content in db/prod/tables.mjs): li scrive solo
--  load-datamine, e se ne vanno con la loro categoria.
--
--  Si applica PRIMA del codice che la scrive (npm run prod:migrate): il
--  codice di prima non la conosce, quello nuovo senza di lei si ferma a
--  check-schema e a migrate --check, come per la 0036.
-- =====================================================================

create table category_alias (
  category_id smallint not null references category (id) on delete cascade,
  alias       text     not null,
  kind        text     not null check (kind in ('initials', 'nickname')),
  primary key (category_id, alias),
  constraint category_alias_form check (alias <> '' and alias = lower(btrim(alias)))
);
