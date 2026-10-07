-- =====================================================================
--  Aggiustamenti richiesti dai dati reali del wiki.
--
--  Tre cose non coincidevano con quello che avevo assunto scrivendo lo
--  schema, e l'import le ha fatte emergere.
-- =====================================================================

-- 1. L'EZA. Avevo previsto uno stadio numerico (0..7), ma il wiki non lo
--    espone: dice solo SE una carta ha un'EZA (dalle date JPdateEZA /
--    GLBdateEZA) e, indirettamente, se e' una Super EZA. Tenere una
--    colonna che finge una precisione che non abbiamo e' peggio che
--    ammetterlo: diventa un booleano. Lo stadio si aggiunge il giorno
--    che c'e' una fonte che lo dice.
alter table card drop column eza_level;
alter table card add  column has_eza boolean not null default false;

-- 2. Il titolo della pagina wiki. Serve per due motivi: e' l'unica
--    chiave con cui rimettere le mani su una carta importata male, ed e'
--    l'attribuzione (il contenuto del wiki e' CC BY-SA).
alter table card add column wiki_title text unique;

-- 3. Da dove arriva la riga. 'wiki' non era fra i valori previsti.
alter type data_source add value if not exists 'wiki';

-- 4. Chiavi naturali su link e categorie: senza queste l'import non puo'
--    essere idempotente, perche' non saprebbe riconoscere un link che ha
--    gia' visto e ne creerebbe uno nuovo a ogni esecuzione.
alter table link_skill_text add constraint link_skill_text_name_uq unique (locale, name);
alter table category_text   add constraint category_text_name_uq   unique (locale, name);
