-- =====================================================================
--  Le date Japan copiate da Global: lo specchio (db/import/mirror-japan.mjs).
--
--  Il wiki era l'unica fonte delle run Japan (JPdate, load-events), e ha
--  smesso di creare pagine evento a gennaio 2025: la produzione ha 48 run
--  Japan del 2024, 4 del 2025 e nessuna del 2026. Da allora Japan e Global
--  escono con lo stesso calendario: le carte, le EZA, gli eventi (lo stesso
--  giorno, spesso lo stesso minuto) e 146 banner su 166. Global ha finito di
--  recuperare il contenuto giapponese arretrato il 2024-12-12. Le run Japan
--  da D (2025-01-01 00:00 JST) in poi si copiano allora dalle finestre del
--  gioco (le regole in db/import/japan-mirror/rules.mjs).
--
--  Una provenienza nuova, 'mirror', e non 'game': ogni import tocca solo le
--  sue righe (0010), e lo specchio deve poter ricalcolare e togliere le sue
--  (una regola che cambia, una finestra Global che sparisce) senza toccare
--  quelle del datamine, che sono storia che non torna. Su Japan:
--    manual  vince sempre: la finestra che la tocca non si copia;
--    mirror  la copia di una run Global del gioco, da D in poi;
--    wiki    la prima uscita del wiki. Quella della stessa uscita diventa la
--            copia sul posto (stesso id), una piu' vecchia si chiude
--            all'inizio della copia; una data del wiki da D in poi che non
--            torna con Global vince lei, e la finestra non si copia.
--
--  Si applica PRIMA del codice che scrive 'mirror' (npm run prod:migrate):
--  il giro settimanale si ferma su check-schema finche' non c'e'.
-- =====================================================================

-- Oggi su Japan ci sono solo run del wiki (e quelle a mano della fixture):
-- nessuna del gioco, che legge solo il datamine Global. I due vincoli lo
-- tengono vero da qui in avanti.
alter table event_run
  drop constraint run_source,
  add constraint run_source check (source in ('wiki', 'manual', 'game', 'mirror')),
  add constraint run_mirror_japan check (source <> 'mirror' or reg = 'japan'),
  add constraint run_game_global check (source <> 'game' or reg = 'global');


-- La stessa provenienza per le date di uscita delle carte. Il picker del
-- builder di un clear Japan cerca le carte uscite su Japan (card_release
-- per regione): le carte che il gioco ha aggiunto (load-game-cards, solo
-- Global) li' non c'erano, e su dokkan_dev 45 delle 125 uscite Global del
-- 2026 non avevano una data Japan. Lo specchio gliela da' uguale a quella
-- Global, e deve poter riconoscere le sue righe per ricalcolarle.
--
-- Chi scrive card_release:
--    wiki    load-cards, le due regioni (JPdate, GLBdate);
--    game    load-game-cards, solo Global, le carte senza pagina del wiki;
--    mirror  lo specchio, solo Japan, dove non c'e' altro;
--    manual  la fixture, chi inserisce a mano (il valore per difetto).
--
-- Il riempimento dice chi riscrive la riga al prossimo giro: load-cards
-- tutte quelle delle carte con una pagina, load-game-cards l'uscita Global
-- delle altre prese dal gioco. Nessuna riga Japan e' del gioco.
alter table card_release add column source text;

update card_release r
   set source = case when c.wiki_title is not null then 'wiki'
                     when c.imported_from = 'datamine' and r.reg = 'global' then 'game'
                     else 'manual' end
  from card c
 where c.id = r.card_id;

alter table card_release
  alter column source set not null,
  alter column source set default 'manual',
  add constraint card_release_source check (source in ('wiki', 'game', 'mirror', 'manual')),
  add constraint card_release_mirror_japan check (source <> 'mirror' or reg = 'japan'),
  add constraint card_release_game_global check (source <> 'game' or reg = 'global');
