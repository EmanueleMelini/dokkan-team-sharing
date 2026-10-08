# Dokkan Team Sharing

Un indice di clear per Dragon Ball Z Dokkan Battle: per ogni evento, i team
che l'hanno chiuso davvero — con build, rotazioni e una prova.

La cosa che nessun altro sito fa non è il database eventi né il team builder:
quelli esistono già e sono presidiati bene. È **l'aggancio fra un clear e
l'evento che ha chiuso**, in forma di dato interrogabile. L'analisi che porta
a questa conclusione sta in `docs/`.

## Stato

Lo strato database è completo e verificato, con le carte, gli eventi e le
missioni veri. Sopra c'è il sito: le pagine degli eventi, gli account, il
builder con cui si inviano i clear, la moderazione (segnalazioni e `/admin`),
le tip dei giocatori nella pagina evento e la pagina di ogni carta
(`/cards/<id>`). I numeri sono quelli di `dokkan_dev`
all'8 ottobre 2026.

- **66 tabelle, 3 view, 15 trigger, 77 funzioni** su PostgreSQL 15, in 25
  migrazioni
- **2697 carte**: 2651 dal wiki, con link skill, categorie, statistiche e
  date di uscita separate per Japan e Global, più 46 che ha solo il gioco
  (senza epiteto). 662 hanno l'EZA, 299 anche la Super EZA. I testi
  completi delle skill sono 10.705 righe di `card_skill` (sezione sul 0022)
- **792 eventi**: 600 dal wiki (100 storia, 208 challenge, 152 Extreme
  Z-Battle, 114 limited, 20 bonus, 6 altri), banner compresi, e **192 dal
  gioco** che il wiki non documenta (2025-2026: 14 storia, 71 challenge, 86
  EZA e Super EZA, 21 limited), senza banner né descrizione. 1747
  ricorrenze in tutto
- **2396 stage con 3916 difficoltà** (1916 e 3213 dal wiki, 480 e 703 dal
  gioco), più **5976 livelli EZA** (4788 dal wiki, 1188 dal gioco)
- **7720 missioni Global** dal gioco su 642 eventi, con 13322 premi
  strutturati (1677 oggetti, ognuno col suo nome)
- **8857 Skill Orb** (2214 bronzo, 2824 argento, 3819 oro), ognuna con la
  sua regola su chi la monta: 1852 per tipo e classe, 5042 per categoria,
  1825 per lista di carte, 138 per nome
- **6246 immagini** ospitate da noi
- **1946 verifiche automatiche** in `db:test`: 38 passi, di cui 9
  preparano il database e 29 sono suite di verifica, tutte verdi, su un
  database a parte che non è quello di sviluppo

Tre regole recenti da sapere:

- **Le pagine pubbliche stanno in cache e non leggono la sessione.** Gli
  URL degli eventi si costruiscono con `lib/urls.ts`, i dati di chi guarda
  arrivano solo da `/api/me` nelle isole client, e ogni scrittura
  invalida per tag (sezione "Cache e budget CPU"). Dopo un import in
  locale: `npm run cache:clear`.

- **Le azioni sensibili chiedono un accesso recente.** Scollegare o
  collegare un provider e cancellare l'account passano solo con una
  sessione nata da meno di 15 minuti; altrimenti si rientra da
  `/settings/sign-in`, senza uscire (sezione "Gli account").
- **Le Skill Orb esclusive si rispettano.** Il builder mostra solo le sfere
  che la carta dello slot può montare, e il database rifiuta le altre
  (sezione sul 0021).

## Le tre decisioni da avere in testa

1. **L'API di scrittura è nel database.** `submit_clear()`, `revise_clear()`,
   `vote_clear()`, `add_clear_comment()`, `delete_clear()` contengono
   validazioni, autorizzazioni e transazioni. L'applicazione riceve un form,
   chiama una funzione, traduce l'errore. Per questo non c'è un ORM: lo schema
   usa constraint di esclusione, indici parziali, trigger, enum e foreign key
   composite, che nessun ORM modella — li gestirebbe comunque in SQL, ma
   combattendoci.

2. **Un clear è versionato, e voti e commenti stanno sulla versione.**
   L'intestazione (chi, quale stage, quale difficoltà) non cambia mai; una
   correzione è una versione nuova. Così correggere non porta con sé i voti
   già presi e non li azzera.

3. **Regione e lingua sono assi separati.** `region` (`global` / `japan`)
   decide quali *dati* vedi; `locale` decide in che *testo* li leggi. Le
   lingue disponibili per regione stanno in `region_locale`, e un testo
   dichiara se è ufficiale del gioco o una traduzione della community.

## Come si parte

```bash
npm install
npm run db:fetch     # scarica wikitext e CSV del gioco (in cache, una volta)
npm run db:refresh   # ricrea, migra, importa carte, eventi, correzioni e immagini
npm run db:test      # le 262 verifiche, su dokkan_test: lo sviluppo non si tocca
npm run dev          # http://localhost:3000
```

**L'ordine conta**: `load-cards` (wiki) deve girare prima di
`load-game-cards` (le carte che il wiki non ha ancora, dal gioco) e
`load-datamine` (che corregge e arricchisce tutte e due), `load-game-events` (gli eventi che il wiki
non ha, dal gioco) prima di `load-windows` (che dà le finestre anche a
loro), `load-missions` dopo `load-windows` (attacca ogni missione a una
run), e `fetch-assets` per ultimo. `db:import` e `db:refresh` li mettono in
fila:

```
load-cards → load-game-cards → load-events → load-datamine → load-game-events → load-windows → load-missions → load-equipment → fetch-assets
```

Il ciclo completo dura **cinque secondi**: le immagini sono già sul disco e
il wikitext è in cache. Al wiki parte una richiesta sola: `fetch-assets`
rilegge a ogni giro il template degli oggetti premio (e chiede solo i file
che sul disco non trova).

In produzione la fila è la stessa con `fetch-assets --offline` spostato
dopo `load-datamine` (`db/prod/pipeline.mjs`, spiegato in "Messa online").

### I test, e perché girano su un database a parte

`npm run db:test` è un comando solo, che mette in fila tutto su
**`dokkan_test`**, un database che esiste solo per questo:

1. lo ricrea da zero con le migrazioni e la fixture (`db/reset.mjs --fixture`);
2. verifica **schema e vincoli** (`schema.test.sh`, 28 controlli) e
   **l'API di scrittura** (`write_api.test.sh`, 68);
3. ci importa i dati veri dalle cache locali (carte, eventi, datamine), senza
   nessuna richiesta di rete;
4. verifica le **query che alimentano le pagine** chiamando le funzioni vere
   di `lib/queries.ts` (`queries.test.mts`, 124), i **parametri dell'URL**
   di `lib/parametri.ts` (`parametri.test.mts`, 42), gli **URL degli
   eventi** di `lib/urls.ts` (`urls.test.mts`) e i **tag della cache**
   (`cache-tags.test.mts`);
5. poi le suite del builder, degli account, della moderazione (SQL, area
   admin, lato utente), delle tip (`tips.test.mts`), dei dati del gioco,
   dei testi delle skill (`card-page.test.mts`), della pagina della carta
   (`card-page-ui.test.mts`) e, per ultima, dell'aggiornamento settimanale
   (`weekly-data.test.mts`).

Un passo che prepara i dati, se fallisce, ferma tutto; una suite rossa non
ferma le altre. Alla fine c'è un riepilogo, e il comando esce con errore se
qualcosa è rosso.

**Perché un database a parte.** Prima `db:test` girava su `dokkan_dev`: lo
ricreava, e dopo ogni giro di test le carte importate e le immagini
collegate non c'erano più. Peggio, il reset (node, che legge `DATABASE_URL`)
e le verifiche (psql, che legge `PG*`) avevano due sorgenti diverse e
potevano finire su due database diversi senza dirlo. Ora c'è una variabile
sola per tutti e due, **`TEST_DATABASE_URL`**, e per difetto vale
`postgres://$PGUSER@$PGHOST:$PGPORT/dokkan_test`. `DATABASE_URL` nei test
non conta: in `.env.local` punta allo sviluppo.

I test **si rifiutano di partire** se il nome del database non finisce per
`_test`, e ogni suite stampa dove sta lavorando, prima secondo la stringa e
poi secondo il server:

```
  database dei test: localhost:5432/dokkan_test come emanuelemelini
  psql: ::1:5432/dokkan_test come emanuelemelini
```

`npm run db:test:queries` rigira solo le verifiche delle query, per le
iterazioni veloci dopo un `db:test` (che prepara fixture e dati importati);
`npm run test:parametri` solo quelle dei parametri, che non usano il
database. Le query si provano senza un passo di build: Node toglie i tipi al
volo (`--experimental-strip-types`) e `db/test/alias.mjs` gli insegna gli
alias `@/` di tsconfig.

`npm run test:smoke` è un'altra cosa e **non fa parte di `db:test`**: prova
il sito che gira già (per difetto `http://localhost:3000`, si cambia con
`SMOKE_URL`) con sole richieste GET, quindi non scrive niente. Controlla i
codici HTTP e i testi chiave della lista eventi e delle viste filtrate
(`/events/browse`, noindex), della ricerca con `_`, `%` e `%00`, delle
pagine che non esistono (404, non 500), di un'EZA, di una sfida, degli URL
delle viste (`/japan`, `/t/<tier>`, `/p/<n>`, con i loro 404), del 307 da
`/` a `/events`, di `robots.txt`, della sitemap (con le carte), di
`/settings` senza sessione (307 a `/login`) e di `/api/me` senza cookie.
Sulla pagina di una sfida cerca il blocco delle tip nella versione anonima;
sulle carte prova `/cards/<id>` (200), la forma Z (308 verso la base) e gli
id sbagliati (404). Gli eventi da
aprire li prende dalle viste filtrate: servono i dati importati, non i
clear dimostrativi. Contro `next start` con `SMOKE_EXPECT_CACHE=1`
controlla anche che la seconda visita esca dalla cache (`x-nextjs-cache:
HIT`).

`npm run db:demo` crea tre clear dimostrativi su un evento **vero**,
passando da `submit_clear()` — serve a vedere la pagina popolata invece che
sempre vuota, e di rimbalzo prova che la funzione di scrittura regga su
dati reali. `npm run db:demo -- --pulisci` li toglie. Non fa parte di
`db:refresh`.

**Se il database di sviluppo va ricostruito** (`npm run db:reset` su
`dokkan_dev`, o un vecchio `db:test` che l'ha azzerato), il comando è
`npm run db:refresh`. Rifare solo `npm run db:import` non basta: ricarica
carte ed eventi ma non ricollega le immagini, che vogliono anche
`npm run db:assets` (quelle già sul disco le riadotta, senza riscaricarle).
I clear dimostrativi si rifanno con `npm run db:demo`.

`db:start` usa il Postgres di Postgres.app se c'è (quello di Homebrew su
questa macchina ha le librerie icu disallineate). Il cluster è locale al
progetto e non tocca nessun Postgres globale.

### Dove sta il database

Sul **Postgres.app già in ascolto su 5432**, nel database `dokkan_dev`, così
si vede in DataGrip accanto agli altri.

| | |
|---|---|
| Host | `localhost` |
| Porta | `5432` |
| Database | `dokkan_dev` |
| Utente | `emanuelemelini` |
| Password | *nessuna* |

```
jdbc:postgresql://localhost:5432/dokkan_dev?user=emanuelemelini
```

Accanto c'è **`dokkan_test`**, dei test: `db:test` lo ricrea a ogni giro,
quindi non ci si tiene niente.

Il database `dokkanteamsharing` sullo stesso server è **roba precedente e
non va toccata**: contiene sette tabelle di uno schema diverso.

`db/local.sh` resta disponibile per chi non ha un Postgres proprio: avvia un
cluster isolato in `db/.pgdata` sulla porta 55432. Per usarlo va cambiato
**`DATABASE_URL`** (in `.env.local`, o esportato):
`postgres://dokkan@localhost:55432/dokkan_dev`. Esportare solo
`PGPORT=55432 PGUSER=dokkan` non basta: `DATABASE_URL` di `.env.local` vince
su `PG*`, quindi gli script node e Next resterebbero su 5432. `PG*` valgono
per gli script shell e per i test, che ne ricavano
`postgres://dokkan@localhost:55432/dokkan_test` (oppure si indica
`TEST_DATABASE_URL`).

### Su quale database sto scrivendo

`db/env.mjs` è la sorgente unica: legge `.env.local`, e **ogni script stampa
il database su cui agisce** prima di fare qualsiasi cosa.

```
  database: localhost:5432/dokkan_dev come emanuelemelini
```

Esiste perché è già successo il contrario: gli script avevano dei valori di
ripiego cablati nel codice, `.env.local` diceva un'altra cosa, e una
migrazione è finita su un altro database **in silenzio**. Un errore così non
si vede: sembra tutto andato bene.

I test fanno eccezione, di proposito: `db/test/common.sh` ricava
`TEST_DATABASE_URL` e lo passa come `DATABASE_URL` agli script node che
lancia, così `.env.local` non li porta sullo sviluppo.

### La protezione del reset

`db:reset` guarda **dentro** il database prima di distruggere niente:
procede solo se è vuoto o se contiene la nostra `schema_migrations`. Se
trova tabelle che non ha creato lui, si ferma e le elenca.

Il criterio precedente era il nome — doveva finire per `_dev`. Non serviva a
niente: puntandolo su un database chiamato bene ma pieno di roba di
qualcun altro l'avrebbe cancellata comunque.

`reset.mjs` **non guarda il nome**, quindi da solo ricrea volentieri anche
`dokkan_dev`, che contiene `schema_migrations` ed è "nostro". Per questo i
test aggiungono il controllo sul nome che a lui manca: lavorano solo su un
database che finisce per `_test`.

## Struttura

```
app/                        Next.js 16, App Router
  admin/                    l'area dei moderatori: coda, nascosti, utenti, registro (404 per chi non e' admin)
  cards/[id]/               la pagina di una carta: pubblica, in cache, 308 dalla forma Z, 404 vero
proxy.ts                    solo per /admin: senza cookie di sessione un 404 vero, senza database
db/
  migrations/               NNNN_*.sql, applicate in ordine, mai modificate
    0001_schema.sql         tabelle, view, indici, trigger dei punteggi
    0002_write_api.sql      proof_host, trigger di congelamento, funzioni
    0016_clear_builder.sql  invio e revisione dal sito in una transazione, assetti congelati
    0017_rerun_stages.sql   stage.game_quest_id: gli stage che una riedizione aggiunge
    0018_slot_builds.sql    le build degli slot (Hidden Potential, Skill Orb), congelate con la versione
    0019_account_settings.sql  Settings: unlink_provider, delete_account, le segnalazioni col bersaglio
    0021_equipment_limits.sql  le Skill Orb esclusive: chi puo' montare quale sfera, controllato dal builder
    0022_card_skills.sql    card_skill: i testi completi delle skill, con EZA e Super EZA; set_prefers_animated
    0023_import_run.sql     import_run: un import alla volta, e l'ultimo riuscito per l'aggiornamento settimanale
    0024_moderation.sql     segnalazioni con motivo, nascosti, sospensioni, moderation_action (solo in aggiunta)
    0025_tips.sql           le tip: bersaglio, limiti, link senza accorciatori, voto Helpful, Report e mod_set_tip_status
  admin/set-role.mjs        il ruolo di un utente, solo da script (db:role, prod:role)
  seed/                     demo-clears.mjs: tre clear dimostrativi su un evento vero (db:demo)
  queries/reference.sql     le query di lettura principali, documentate
  test/                     le verifiche: run.sh le mette in fila (npm run db:test)
  cache-clear.mjs           invalida la cache del server di sviluppo dopo un import (npm run cache:clear)
  import/
    fetch-wiki.mjs          scarica il wikitext delle carte, in cache
    fetch-events.mjs        scarica il wikitext degli eventi, in cache
    load-cards.mjs          interpreta le carte e le scrive, idempotente
    wiki-skills.mjs         il template Characters letto come MediaWiki: i testi delle skill (card_skill)
    load-game-cards.mjs     le carte uscite su Global senza pagina wiki, dal datamine (db:game-cards)
    game-cards.mjs          la sua scelta: quali righe del datamine sono carte che mancano davvero
    load-events.mjs         idem per eventi, stage e difficoltà
    load-game-events.mjs    gli eventi che il wiki non ha, dal datamine del gioco
    game-events/            i suoi moduli: classify, build, write, i legami del wiki, gli stage delle riedizioni
    quest-refs.mjs          i legami per quest (Super Battle Road, archivi), per load-windows
    load-missions.mjs       le missioni Global e i loro premi, dal datamine (db:missions)
    missions/               i suoi moduli: owner (di che evento), text, rewards, write
    load-equipment.mjs      le Skill Orb, le loro regole e le abilita' del Hidden Potential (db:equipment)
    equipment-limits.mjs    le regole delle esclusive dal gioco alle nostre carte (funzioni pure)
    fetch-assets.mjs        scarica le immagini e le registra in asset (--offline: solo dal disco)
    .cache/                 il wikitext scaricato (non versionato)
  prod/                     gli script contro la produzione (prod:setup, prod:update, prod:backup)
    target.mjs              il bersaglio: PROD_DATABASE_URL, i rifiuti, il TLS, la conferma --yes
    pipeline.mjs            l'ordine dell'import, uguale per setup e update
    harden.mjs              toglie i privilegi su public ai ruoli della Data API di Supabase
    snapshot.mjs, compare.mjs, limits.json  la fotografia delle tabelle e i limiti dell'aggiornamento settimanale
    dump.mjs, rehearsal.mjs il backup della produzione e il giro di prova su una copia locale
    sanity.mjs, last-run.mjs, missing-assets.mjs, mirror-assets.mjs  i controlli e le immagini del workflow
.github/workflows/weekly-data.yml  l'aggiornamento settimanale automatico (Messa online, punto j)
public/assets/              le immagini ospitate da noi (non versionate)
  migrate.mjs               runner: applica le pendenti, una transazione ciascuna
  reset.mjs                 ricostruisce il database di sviluppo da zero
  local.sh                  avvia/ferma il cluster locale
docs/                       l'analisi competitiva e le decisioni di progetto
test/smoke.sh               prova di fumo sul sito che gira (npm run test:smoke)
test/auth-smoke.sh          il giro del magic link sul sito che gira (npm run test:auth-smoke)
lib/auth/                   better-auth: configurazione, mittente del link, Server Action
lib/dal.ts                  chi e' l'utente: requireUser / requireOnboardedUser (mai nelle pagine pubbliche)
lib/urls.ts                 gli URL degli eventi: /events/<id>[/japan][/t/<tier>[/p/<n>]], /events/browse
lib/cache/                  'use cache' sopra le query pure, i tag, l'invalidazione, /api/revalidate
lib/viewer/                 chi guarda: il tipo di /api/me e il cookie dts_signed_in
lib/clears/                 le Server Action dei clear, i loro validatori e le frasi d'errore
lib/moderation/             motivi, frasi d'errore, Report (report-actions), requireAdmin (guard), letture e azioni di /admin
lib/clears.ts               le letture del builder e del clear: modifica, cambi, voti, commenti
lib/tips.ts                 le letture delle tip (pure): la lista per tier ed evento, lo stato di chi guarda per /api/me
lib/tips/                   le Server Action delle tip, i loro validatori e le frasi d'errore
lib/card-page.ts            le letture della pagina della carta (pure): carta, skill per livello, catena, clear che la usano
lib/card-art.ts             statico o animato: la scelta dell'artwork e quella per carta nel localStorage
lib/cards.ts                la ricerca delle carte per il picker (anche GET /api/cards)
lib/equipment.ts            la ricerca delle Skill Orb per le build (anche GET /api/equipment)
lib/db.ts, lib/db-config.ts la pool (una per processo) e le sue impostazioni: dimensioni, TLS
lib/cron.ts                 l'autenticazione delle rotte di Vercel Cron (app/api/cron/)
vercel.json                 regione fra1 e il cron della pulizia giornaliera
scripts/assets-deploy.mjs   public/assets su Cloudflare Pages, con _headers (assets:deploy)
backups/                    le copie di prod:backup (non versionate)
components/builder/         il builder dei clear: slot, picker delle carte, build, dettagli, prove
components/clears/          la scheda di un clear: squadre, cambi, voti, commenti, Delete
components/evento/, eventi/ la pagina evento e la lista, uguali per tutti (stanno in cache)
components/viewer/          ViewerProvider e useViewer(): le isole client che leggono /api/me
components/moderation/      Report e il banner della sospensione (isole), la coda, i form e il registro di /admin
components/tips/            il blocco delle tip nella pagina evento: lista, Top/New, Helpful, Report, il form
components/cards/           la pagina della carta: artwork, schede delle skill per livello, catena, clear con la carta
test/cpu.sh                 la CPU per richiesta su next start (npm run test:cpu)
```

### Sulle migrazioni

Una migrazione applicata non si modifica più. Il runner ne tiene il checksum
e si rifiuta di procedere se un file cambia sotto i piedi — è il modo più
rapido di ritrovarsi con due database diversi convinti di essere uguali. In
sviluppo si ricrea tutto con `db:reset`; in seguito si aggiunge un file nuovo.

`reset.mjs` si ferma su un database che ha tabelle e non ha
`schema_migrations` (vedi sopra); il nome non lo guarda. Quello lo
controllano i test, che girano solo su un nome che finisce per `_test`.

## Due fonti, e nessuna sostituisce l'altra

I dati vengono da due posti, e la divisione non è una comodità: è quello
che le fonti permettono.

**Il database ufficiale del gioco** — i CSV di
[Nicholas1006/dokkan-backend](https://github.com/Nicholas1006/dokkan-backend),
che versiona in git il database Global esportato tabella per tabella con
commit automatici settimanali. È autorevole per: id reali, tipo, classe,
rarità, link skill, categorie, eventi, stage, **missioni** (27.121 righe
con finestre temporali) e il **calendario**.

**Il wiki Fandom** — autorevole per le due cose che il database del gioco
*non contiene*:

- l'**epiteto** ("Everlasting Legend"), che è come la community identifica
  una carta. Nel database c'è solo `cards.name` = "Super Saiyan Goku".
- le **etichette di difficoltà e il costo in stamina** degli stage. Il gioco
  modella la difficoltà come un `area` separato ma non la etichetta, e la
  stamina non è in `quests`.

**Si uniscono sull'id del gioco**, verificato: i 2651 id ricavati dal wiki
esistono tutti nel datamine, 2651 su 2651. Per questo `load-datamine` non
sostituisce le carte, le *corregge*, e `load-cards` deve girare prima.

**Le carte che il wiki non ha ancora** (migrazione 0015, `load-game-cards`).
Il wiki ha smesso di creare pagine carta a fine luglio 2026, il gioco no: 46
unità uscite su Global esistevano solo nel datamine. Ora entrano con il nome
inglese del gioco, tipo, classe e rarità con la stessa decodifica di
`load-datamine`, la data di uscita Global e `imported_from = 'datamine'`;
l'**epiteto resta NULL** (il gioco non ce l'ha, e inventarlo sarebbe un dato
falso), niente statistiche né testi delle skill, niente immagini. La scelta è
fatta di regole, non di una lista, così le uscite future entrano da sole:
id a 7 cifre col prefisso 1/2/3, `open_at` già passato e non 2038, una
passiva o un link (senza è un oggetto), un'unità sola fra base e
Z-awakened (l'id della base, come il wiki; la classe della base viene dalla
Z-awakened, giusta 1373 volte su 1376 sulle carte del wiki). Restano fuori
le unità già coperte dal wiki, le righe alla data minima del lancio
(2015-10-30: Android #14/#15 e tre copie spente) e le **copie**: stesso set
della leader skill, stesso nome, tipo e rarità di un'altra unità (le
ristampe come 1032520 = 1012360, e i secondi id delle pagine dei cloni di
Goku Black). Il solo set condiviso non basta: le cinque Metal Cooler ne
hanno uno solo e sono carte distinte. Il giorno che il wiki pubblica la
pagina, `load-cards` fa upsert sullo stesso id e riempie l'epiteto; da lì
`load-game-cards` la vede coperta e non la tocca più.

Le **catene di risveglio** del gioco vanno fra le forme Z-awakened
(1034131 → 1034141), mentre le nostre carte hanno l'id della base: lette
così com'erano non se ne collegava nessuna. `load-datamine` ora riporta ogni
capo alla sua unità; contro le catene del wiki tornano 1071 su 1073, e ne
aggiunge 192 dove il wiki non ne indicava (23 sulle carte nuove).

Un errore che vale la pena raccontare: avevo letto `element` 20-24 come
"carte nemico da filtrare". Il controllo incrociato contro i dati del wiki
ha mostrato che 10-14 sono le **Super** e 20-24 le **Extreme** — avrei
buttato via tutte le unità Extreme. La mappatura ora è verificata al 99-100%
su 2632 carte, e la rarità al 100%.

E una cosa che *non* si sovrascrive: `hp/atk/def`. Il gioco dà il massimo di
livello (per la LR 1007470: 8782/8414/3658), il wiki il valore a potenziale
pieno (15800/15100/8220). Misurano cose diverse, e il secondo è quello che i
giocatori confrontano.

## Le carte dal wiki: come sono state estratte

Dall'**API MediaWiki pubblica del wiki Fandom**. È la sorgente a monte da
cui derivano gli altri dataset in circolazione — quelli che ho trovato sono
fermi a gennaio 2023 — ed è un'API documentata con i suoi limiti, non uno
scraping di HTML. L'enumerazione passa da chi include `Template:Characters`,
che sono esattamente le pagine carta.

Su 2671 pagine, **2651 importate** e 20 scartate, ognuna con il suo motivo
stampato: 18 sono oggetti di supporto e non unità, 1 ha un tipo malformato,
1 è una pagina abbozzata senza id. Le varianti a cinque tipi che condividono
la stessa immagine, e le pagine senza un'immagine col numero della carta,
prendono l'id dal campo `|ID`, accettato solo se il datamine ha quella carta
con lo stesso tipo e la stessa rarità (`db/import/wiki-card.mjs`).

Le immagini delle 19 carte entrate così non ci sono ancora: il CDN delle
immagini del wiki risponde 403 con la verifica anti-bot di Cloudflare, e non
la si aggira. Quando torna a servire i file basta `npm run db:assets`, che
scarica solo quello che manca.

Due controlli che dicono che il parsing è sano: i link skill per carta si
concentrano su 5, 6 e 7 come nel gioco, e la media sale con la rarità (1,7
sulle N, 7,0 sulle LR). L'EZA risulta solo su UR e LR, che è esattamente
dove esiste.

L'import è **idempotente**: rilanciarlo aggiorna e non duplica. Le chiavi
naturali `(locale, name)` su `link_skill_text` e `category_text` sono ciò
che glielo permette.

`card.imported_from` vale `wiki` su queste righe: il giorno che esiste una
pipeline dall'APK si sa esattamente cosa sostituire.

### I testi delle skill (migrazione 0022)

`card_text` tiene un riassunto per carta (leader, passiva e super di base) per la ricerca e il builder. I testi completi stanno in `card_skill`, una riga per skill: leader, super (anche 2-3 per le forme con più super), Ultra Super Attack, passiva, attiva con la condizione, Standby, dominio, trasformazione, Unit Super, EX Super e Finish, ognuna con le varianti EZA (`tier = 'eza'`) e Super EZA (`'seza'`) quando il wiki le scrive. A un'EZA senza nome passa quello della base.

Il template si legge come lo legge MediaWiki (`db/import/wiki-skills.mjs`): i parametri si dividono sui `|` fuori da link, template e note, quindi `|SA type = Ki |SA name = Galick Gun` dà tutti e due i campi e la passiva che va a capo dopo un `<hr>` resta intera. Le note `<ref>` (i numeri esatti dietro "Raises DEF") vanno in `details` e non restano incollate al testo; quelle con nome riusate dall'EZA prendono la loro definizione. `description` tiene una riga per effetto, e `- ` segna un punto elenco. Le frecce del wiki diventano ↑ e ↓, Permanent e OneTime diventano "(Permanent)" e "(Once only)", le icone dei tipi tornano parole.

Si prende la prima scheda della pagina, cioè la carta. Attiva, Standby, dominio, Unit Super, EX Super e Finish si prendono da un'altra scheda solo se la prima non li ha (il Finish sta sulla scheda della modalità Standby).

Sul database di sviluppo: 10.705 righe su 2.651 carte; leader EZA 649, passiva Super EZA 33, Ultra 185, attive 217. Le 46 carte solo del datamine non hanno testi. load-cards stampa la copertura per tipo e livello a ogni giro: un calo improvviso dice che il parser ha perso un campo. L'import resta idempotente: cancella e riscrive le righe `official` delle carte che importa, nella stessa transazione.

Le note del wiki perdono il link "How does it work?" alla pagina sugli accumuli. load-cards riconosce un nome di link skill o di categoria scritto in un altro modo (apostrofo curvo, spazio in coda, "/" al posto di "-", singolare e plurale: `lookupKey` in `wiki-skills.mjs`). Così, dopo load-datamine, non crea più a ogni giro cinque link e due categorie "nuove", e un'immagine nella riga dei link (`[[File:Global server.png|20px]]`) non diventa più una link skill di nome "20px".

### Attribuzione, che non è opzionale

Il contenuto del wiki Fandom è **CC BY-SA**. Usarlo richiede di attribuirlo
in modo visibile e di mantenere la stessa licenza sui contenuti derivati.
Va messo nel footer del sito accanto al disclaimer Bandai, non nascosto in
una pagina che nessuno apre. È un obbligo più concreto della questione
Bandai, perché ha una comunità che lo fa rispettare.

## Le immagini: le ospitiamo noi

Deciso: gli asset di gioco stanno sui nostri server. Non è in contrasto con
la scelta sulle prove dei clear — quelle restano link esterni, perché sono
contenuto degli utenti. Gli asset di gioco sono un'altra cosa: sono il
vocabolario visivo del sito, e devono essere veloci e non spariti.

**Il database tiene la chiave, non l'URL.** Una riga di `asset` ha
`key = 'cards/1002240/thumb.webp'`; l'URL lo compone l'applicazione
mettendoci davanti `ASSET_BASE_URL`. Passare dal disco locale a un object
storage è una variabile d'ambiente, non una UPDATE su cinquemila righe.

**Fandom ridimensiona e converte lato server, e conviene approfittarne.**
L'artwork originale di una carta è circa 1 MB; a 640 px di lato lungo in
WebP sta in ~150 KB. Su 2450 carte la differenza è fra 2,5 GB e ~370 MB —
ed è anche più educato verso la loro banda. Le miniature vanno a 256 px
(nitide a 128 px CSS su schermi 2x) e pesano 24 KB l'una.

Le dimensioni in pixel si leggono dall'intestazione del file (WebP, PNG,
JPEG) senza librerie native: servono per dare a `<img>` width e height e
non far ballare il layout.

Lo scaricamento è **ripartibile in due modi**. Se la riga in `asset` c'è, il
file è sul disco e la dimensione combacia, salta. E se il file è sul disco
ma la riga **no** — cosa che succede a ogni `db:reset`, che ricrea il
database ma non tocca `public/assets` — lo riadotta leggendo dimensioni e
checksum dal file stesso, invece di riscaricare mezzo giga. Su un database
appena ricreato con le immagini già presenti l'intera fase dura **un secondo
e mezzo**, e al wiki parte una richiesta sola: il template degli oggetti
premio, che `fetch-assets` rilegge a ogni giro (più i file che sul disco
non trova).

```bash
npm run db:assets                       # tutto
npm run db:assets -- --only icons
npm run db:assets -- --only thumb        # statiche e animate
npm run db:assets -- --only anim         # solo le animate
npm run db:assets -- --only art --limit 50
npm run db:assets -- --flatten-existing  # ripara gli animati salvati male
npm run db:assets -- --force             # riscarica comunque
```

### Statico e animato, entrambi

Circa 170 carte — quasi tutte le LR — hanno miniatura e artwork **animati**.
Non sono la stessa immagine in due formati: sono due contenuti, e costano in
modo molto diverso.

| | peso | scelta |
|---|---|---|
| miniatura statica | 23 KB | sempre |
| miniatura animata | 27 KB | trascurabile, si può mostrare sempre |
| artwork statico | 169 KB | il valore di base |
| artwork animato | ~9 MB | va scelto |

L'artwork animato è un WebP di **650 fotogrammi** a 356×474. Ricodificarlo
non serve: il peso sono i fotogrammi, non la risoluzione — a qualità 55
ImageMagick ne restituisce 10 MB. Quindi si tiene com'è.

Chi guarda decide: `app_user.prefers_animated` è la preferenza di base nel
profilo, e sulla pagina della carta un interruttore vale per quella singola
carta (stato dell'interfaccia, senza schema). Il valore di partenza è
statico, che è la scelta gentile: 9 MB su una connessione mobile si sentono.

Le colonne sono quattro: `thumb_key`, `thumb_animated_key`, `art_key`,
`art_animated_key`.

**Una trappola da conoscere:** il ridimensionatore di Fandom, applicato a un
WebP animato da 9 MB, restituisce un **GIF da 33 MB** — peggio dell'originale.
Il primo giro di import ne ha salvati 87 così, 1675 MB invece di 2,3 MB. Il
fotogramma statico si estrae in locale con `ffmpeg`, che il download fa da
sé quando riconosce un'immagine animata (`--flatten-existing` ripara quelle
già salvate, leggendole dal disco senza riscaricare).

**E una sua conseguenza:** quella riparazione prendeva anche le versioni
animate delle carte, e ne ha lasciate ferme 82 di artwork e tutte le 171
miniature, ancora collegate come animate (la pagina della carta offriva
"Animated" per un'immagine immobile e più piccola). Ora le esclude, e il
collegamento controlla i primi byte del file (`siMuove` in
`db/import/asset-select.mjs`: GIF, WebP con ANIM, PNG con acTL): un
"animato" che non si muove resta scollegato. Su `dokkan_dev` restano 88
artwork animati e nessuna miniatura animata. Le originali si possono
riprendere con `npm run db:assets -- --only anim --force` quando la CDN del
wiki risponde di nuovo; il controllo anti-bot non si aggira.

### L'icona LR

Le rarità da N a UR seguono la convenzione `<rarità> icon.png`. LR no: è un
**APNG animato** che sta sotto `LR logo apng.png`, e il template del wiki la
richiama con un URL fisso invece della sintassi normale dei file — per
questo non salta fuori cercando "LR icon". Qualunque ridimensionamento di
Fandom la appiattisce in un WebP statico da 13 KB. Teniamo entrambe le
versioni: `rarity_icon.asset_key` è la statica, `animated_asset_key`
l'animata da 397 KB. La statica per le liste, l'animata per la pagina della
carta.

## Gli eventi: cosa c'è e cosa manca

Dalla stessa fonte, `Template:Events`: 608 pagine, **598 importate**, 10
scartate (sono guide e modalità di gioco: World Tournament, Burst Mode,
Pettan Battle, Explosive Chain Battle).

| tipo | eventi | stage |
|---|---|---|
| challenge | 208 | 739 |
| zbattle (Extreme Z-Battle) | 152 | 4788 |
| limited | 114 | 339 |
| story | 100 | 738 |
| bonus | 20 | 26 |
| other | 6 | 55 |

(Su `dokkan_dev`, 8 ottobre 2026: 600 eventi del wiki.)

La classificazione viene dal template di navigazione in fondo alla pagina:
è il wiki stesso a dire in che elenco sta un evento. Se non c'è, prova il
titolo, e per ultime due categorie del wiki che il tipo lo dicono senza
dubbi: "Story Events" (story in 84 pagine classificate su 84) e "Special
Events" (limited in 60 su 61). Le due pagine che prendono, 710308 (Super
Hero) e 2542 (Countdown to Resurrection), hanno nel gioco la categoria che
dice la stessa cosa (7 e 2).

**I remake della storia sono `story`.** Le 15 pagine con la navigazione
"Dragon Ball Story Nav" sono le aree DbStory del gioco (categoria 9000, 901-917),
e `load-game-events` crea quelle nuove come `story`: prima quelle del wiki
finivano 14 in `other` e una (722687, "The 21st World Tournament") in
`world_tournament`, per il titolo. Ora la regola sta in `load-events`, dove
il tipo si decide, quindi un reimport non la disfa; il test lo verifica
anche dal lato del gioco (ogni evento legato a un'area 9000 è `story`). Con
722687 `world_tournament` resta senza eventi, e il filtro del sito lo offre
lo stesso.

I 6 `other` che restano: quattro pagine "Limit Events" (4285 e 5467 Hero
Extermination Plan, 56171 The Bizarre Rabbit Mob!, 648656 Awakened Power!),
una famiglia del wiki che il sito non ha fra i tipi e che il gioco mette
nella categoria 8 (648656 nella 6), che anche `load-game-events` lascia
`other`; e due pagine senza navigazione né categorie (727138 Rebel Plotting
for Dominance, 727287 Miraculous Strike!, aree 1508 e 1507, categoria 10).
Il wiki non dice niente, e una regola sulla sola categoria del gioco per
due pagine sarebbe un tipo indovinato: meglio ammettere di non saperlo.

**Due strutture diverse, entrambe gestite.** Gli eventi normali hanno stage
con difficoltà: le righe di gruppo dicono `Level N: Nome` e sotto ci sono i
`{{STA|difficoltà|STA|costo}}`. Le **Extreme Z-Battle** no: hanno *livelli
nemico*, una tabella con `Enemy Lv.` dove ogni riga è un livello. Ma il
livello è esattamente ciò che uno chiude e di cui condivide il team, quindi
diventa uno stage (`seq` = il livello) con una sola riga in `stage_tier`
che porta la difficoltà `eza_level`. Sono 150 eventi e 3718 livelli:
lasciarli fuori sarebbe stato il buco più grosso dell'import.

Per le EZA finisce in `stage_tier_text.boss_note` anche l'informazione che
serve davvero a scegliere un team:

```
Livello 30 | Damage reduction -70%; Immune to: Stun, Seal Super Attack,
             Lower ATK, Lower DEF, Disable Action
```

### Tre assenze, e sono importanti

**Le missioni non ci sono.** Solo 3 pagine su 608 hanno una sezione
dedicata, e il wiki stesso rimanda al gioco. Ora arrivano dal gioco: vedi
"Le missioni: dal gioco, con i premi".

**Zeni, exp e drop per difficoltà non ci sono.** Sono nelle tabelle, ma
l'intestazione delle colonne è riconoscibile solo in **78 pagine su 448**:
l'ordine cambia da pagina a pagina, e leggere la colonna sbagliata darebbe
numeri plausibili e falsi. Meglio un dato assente.

**Le ricorrenze non ci sono.** Il wiki dà *una* data di prima uscita per
regione, non le finestre delle repliche. Una run con `ends_at` nullo, nel
nostro modello, significa "permanente" — vero per gli eventi story e le
EZA, falso per quelli a tempo. Invece di far finta,
`event_run.ends_at_known` vale `false` su queste righe: la view
`event_status` continua a dire `active` e l'interfaccia può aggiungere
"fine non nota" invece di mentire. **Attenzione a questo prima di mostrare
la lista degli attivi**: oggi risultano attivi tutti gli eventi mai usciti.

### E una cosa che gli eventi non hanno

Le carte hanno l'id di gioco dentro il nome dell'immagine. **Gli eventi no,
da nessuna parte.** Quindi `event.id` qui è il *pageid del wiki*: stabile e
riproducibile, ma non l'id del gioco. Il giorno che arriva un datamine, gli
id degli eventi vanno rimappati passando da `wiki_title`, che è l'unica
chiave che i due lati hanno in comune. `imported_from` dice quali righe
sono in questa condizione. Gli eventi creati dal gioco (`imported_from =
'datamine'`) hanno invece un id ricavato da quello di gioco, lontano dai
pageid: vedi "Gli eventi che il wiki non ha".

## Gli oggetti dei premi

29 oggetti con icona, ricavati dallo switch di `Template:ItemsEvent`: orb,
pesi, medaglie, dragon stone, zeni. Sono i **drop mostrati sulle pagine
evento**. I premi delle missioni sono un'altra cosa, con un'altra tabella
(`game_item`, vedi "Le missioni"): un loro oggetto prende una di queste
icone solo quando il nome è lo stesso (45 su 1677).

## Il calendario: le finestre Global vengono dal gioco

Il wiki dà solo la data di prima uscita, quindi fino a qui ogni evento
risultava attivo per sempre. Ora le finestre **Global** vengono dal database
del gioco: `npm run db:windows` (`db/import/load-windows.mjs`), che gira
anche dentro `db:import`, `db:refresh` e `db:test`, sempre dopo
`load-datamine`.

**Il legame.** Il gioco non conosce i nostri id (sono i pageid del wiki), e
il join per solo nome reggeva l'84% degli eventi e lo 0% delle EZA.
`db/import/game-map.mjs` incrocia più chiavi e ne vuole almeno due, una
forte: il **file del banner** (`Quest top banner 582 2.png` è
`quest_top_banner_582_2.png`), il **nome** senza i suffissi del wiki, gli
**stage** contro le quest dell'area, e come conferma i banner nel resto della
pagina e il **boss** fra i nemici delle quest. Per le EZA: titolo, boss del
livello 1 e banner della news. Il risultato sta in `event_game_ref`, con la
chiave che ha deciso e la confidenza, e si ricostruisce a ogni giro. Dalla
migrazione 0011 ogni riga dice anche chi l'ha scritta (`source`):
`load-windows` tocca solo le sue (`wiki`), `load-game-events` solo le sue
(`game`), e le finestre si calcolano su tutte. Le regole del legame stanno
in un posto solo (`game-events/wiki-refs.mjs`), perché `load-game-events`,
che gira prima, le deve applicare uguali senza leggerle dal database:

| tipo | legati | | tipo | legati |
|---|---|---|---|---|
| zbattle | 152 / 152 | | other | 6 / 6 |
| challenge | 208 / 208 | | bonus | 18 / 20 |
| limited | 110 / 114 | | | |
| story | 100 / 100 | | **totale** | **594 / 600** (549 high, 45 medium) |

Le 15 pagine della Super Battle Road sono legate per quest, non per area:
vedi "Super Battle Road e archivi: un'area, più eventi".

I 6 non legati restano col calendario del wiki, ed è voluto:
137827 (la sua area il gioco non l'ha più) e la collaborazione 703308, che ha
solo una quest in comune con un evento già legato. Altri quattro un'area nel
gioco ce l'hanno, ma le chiavi non ci arrivano: la Snaky Way (869, aree
125/126, che il gioco chiama "Snaky Way" e il wiki "Snaky Path"), le due
"All Open" (aree 291/292) e 33264 (area 111). Nessuno dei quattro cambierebbe
una finestra; se servisse, andrebbero in una lista di eccezioni scritta a
mano, non allargando le regole. L'import li elenca uno per uno, col motivo.

I doppioni "(Discontinued)" erano il punto debole: la vecchia edizione e la
riedizione hanno le stesse quest, e la vecchia finiva attaccata alla nuova
come "riedizione". Ora a pari stage decidono i segni della pagina (un suo
banner, i suoi boss), e chi perde un'area contesa riprova senza: 7750 ha la
sua area 321 (tre corse fra il 2018 e il 2019, quindi conclusa, non più
attiva per sempre), 1302 la 306. E il nome di uno stage vale anche senza la
variante che il wiki gli scrive fra parentesi ("Vs. Majin Buu (Majin Buu
Tactics)"), il che lega Infinite Dragon Ball History alla 713.

Le **riaperture** sono la stessa area rimessa in gioco con un id nuovo e le
quest appena diverse: 789 è la 727 di Team Bardock più "Grand Opening", 1202
tiene una delle due quest di Pan's Secret Adventure (135), 617 e 619 sono
due Challenge del 2020 riaperte il 29/08/2026 con un "Extreme Stage". Le
quest identiche non bastano più, e allora decide il tempo: l'area nuova
deve partire quando la nostra smette (entro due giorni), stesso nome, tipo
e scheda, e nessun altro evento la deve avere. Sono legami `medium`. Così
698372 e 18261, prima "conclusi", tornano in corso come nel gioco.

**Le finestre.** Le date del gioco sono **UTC**, senza ora legale (05:00,
06:30, 08:00; le fini alle 07:59:59 sono la mezzanotte di Los Angeles a
UTC-8 fisso): si convertono in JS, perché un `::timestamptz` in SQL le
leggerebbe nel fuso della sessione, che su `dokkan_dev` è Europe/Rome. La
fine diventa il primo minuto fuori (07:59:59 → 08:00). Anche la data del
wiki (GLBdate, JPdate) è un giorno **UTC**: è la data UTC del primo inizio
delle quest in 253 eventi su 291. `load-events` la scrive come mezzanotte
UTC esplicita; prima finiva a mezzanotte del fuso della sessione (22:00 o
23:00 UTC del giorno prima, su `dokkan_dev`), e le 1067 run del wiki sono
state spostate sul posto, con lo stesso id. Le adozioni e le chiusure di
`load-windows` non cambiano (stesse corse, confrontato su un import nuovo).

- **Aree**: le missioni con `missions.area_id`. Ogni gruppo con la stessa
  fine è una corsa, dal suo primo inizio; le fasi che si toccano sono la
  stessa corsa. Se l'ultimo blocco scade tutto il **2038-01-01** si sa
  quando è iniziato ma non quando finisce: per le missioni quella data vuol
  dire "senza scadenza propria", non "evento permanente". La corsa aperta
  parte dal primo blocco 2038 della stessa apertura: si risale ai blocchi
  precedenti finché lo stacco resta sotto i 31 giorni e nessuna fine vera
  cade in mezzo (il Super Warrior Memorial, area 1306, apre il 07/07/2024 e
  aggiunge stage il 18/07 e il 05/08). Gli stacchi misurati sono 7-28
  giorni, poi 33, 50 e oltre: quelli sono riaperture, e la corsa parte
  dall'ultima. Le righe che
  iniziano prima del lancio di Global (luglio 2015) sono giapponesi e non
  contano, anche se scadono nel 2038: Korin Tower (area 120) ne ha una dal
  01/04/2015, e altrimenti risultava su Global da prima che esistesse.
- **EZA**: `z_battle_stages.start_at`/`end_at`. Qui il 2038 vuol dire
  davvero "in lista per sempre": permanente, fine nota. Il Portale dei
  Ricordi (a chiavi) non conta come attivo. Le Super EZA sono eventi a sé,
  creati dal gioco (vedi sotto), con la loro riga.
  La riga tiene solo l'ultima messa in lista, e se le missioni dello stage
  partono dopo la sua fine è rimasta indietro: allora vale la corsa delle
  missioni. Succede solo all'EZA di Jiren (stage 10): maggio 2018 nella
  riga, prima ancora dell'uscita giapponese, e 13/09 → 11/10/2018 nelle
  missioni, che sono le 21:00 PST del wiki Global.

**Chi vince.** `event_run.source` (migrazione 0010) dice da dove viene una
run: `wiki`, `game` o `manual`, e vince in quest'ordine `manual` > `game` >
`wiki`. Ogni import tocca solo le sue. La run del wiki della **stessa
uscita** (entro due giorni) diventa quella del gioco **sul posto**, con lo
stesso id; una run più vecchia che si sovrappone si **chiude** all'inizio
della finestra con la fine non nota ("finita non dopo"); una finestra che
tocca una run a mano si salta. Non si cancella niente: i clear puntano a
`event_run` senza cascata. Un clear sta nella corsa in cui è stato scritto
(il sito lo aggancia alla run attiva): se chiudere la run del wiki lo
lascerebbe fuori, le due righe si **scambiano**, e la run del clear diventa
la corsa del gioco con lo stesso id. È il caso dei tre clear dimostrativi su
728100, di ottobre 2026: la loro run 1148 ora è la permanenza dal
24/06/2025, e il tratto del wiki prima di quella data è una run nuova.

`npm run db:window` resta il tappo per quello che il gioco non dà (Japan,
gli eventi non legati), e vince sul gioco. **Le date vanno scritte con il
fuso** (`--dal 2026-09-05T05:00Z`): senza, valgono nel fuso della sessione.
Una corsa precedente che si accavalla (del gioco, o del wiki oltre i due
giorni di tolleranza) si chiude al `--dal` con la fine non nota, invece di
sparire: le run del gioco sono storia che il datamine non ridà. La stessa
corsa (la run del wiki della stessa uscita, una del gioco che inizia dentro
la finestra) diventa la run a mano sul posto, con lo stesso id.

**Il risultato su `dokkan_dev`**, una ricorrenza per evento come la lista
del sito, oggi (7 ottobre 2026), con la fotografia del 2 ottobre:

| Global | prima | dopo | con gli eventi dal gioco (8 ottobre) | con SBR e archivi |
|---|---|---|---|---|
| attivi con la fine | 0 | 6 (fino al 20 ottobre) | 28 (6 del wiki, 22 del gioco) | 28 (6 + 22) |
| attivi permanenti | 0 | 147 | 219 (147 + 72) | 251 (173 + 78) |
| attivi, fine non nota | 560 | 306 | 374 (312 + 62) | 346 (290 + 56) |
| conclusi | 0 | 120 | 150 (114 + 36) | 150 (114 + 36) |
| in arrivo | 0 | 0 | 0 | 0 |

Nella quarta colonna gli eventi sono 792, 771 con una run Global; nella
quinta 775: quattro edizioni che il wiki dava solo su Japan (o senza data)
ora ce l'hanno dall'archivio. Le 32 permanenti in più sono le 15 pagine
della Super Battle Road e le 17 edizioni degli archivi. Sei eventi del wiki sono passati da
"conclusi" a "in corso": il gioco li ha riaperti sotto un'altra area, e
`load-game-events` li ha riconosciuti come riedizioni (vedi sotto).

19 eventi che il wiki dava solo su Japan ora hanno anche la loro corsa
Global, perché il gioco ce l'ha.

**Dove mente ancora**, ed è il motivo per cui l'interfaccia deve dire "fine
non nota" e non tacerlo:

- **306 attivi senza una fine**: 158 hanno nel gioco solo missioni senza
  scadenza (spesso contenuto permanente, ma non sempre: la Brief Breather di
  aprile ce le ha), 130 sono legati ad aree che hanno solo quest e nessuna
  missione valida su Global, 18 non sono legati. L'elenco degli eventi in corso arriva al
  gioco dal server, e il database non lo contiene.
- **L'inizio di una corsa "senza scadenza"** è il primo blocco 2038 della
  sua apertura: per 21 eventi questo l'ha anticipato (fino a un mese) e ha
  riunito 14 aperture che erano spezzate in una run del wiki "conclusa" più
  una del gioco. Restano 36 eventi il cui ultimo blocco 2038 arriva più di
  un mese dopo il precedente: lì la corsa parte dall'ultimo, e quella prima
  è coperta solo dalla run del wiki, chiusa con la fine non nota, o da
  niente quando il wiki non ha la data Global (481 e 516, aree 404 e 405,
  aperte nel 2016-2017 e riaperte nel 2023). Non sempre l'ultimo blocco è
  una replica: in Fight Against Despair! (area 371) è il blocco delle
  Support Memory del 15/02/2022, in Infinite Dragon Ball History (713)
  l'ultimo piano aggiunto, il 09/09/2026. Al contrario, una
  riapertura che parte dove la corsa prima finisce si fonde con lei: Team
  Bardock (698372) è una corsa sola dal 26/08/2021.
- **Japan** non si tocca: il datamine è quello Global. Le 590 run Japan sono
  ancora del wiki, tutte attive.
- **La storia è corta.** Ogni fotografia sovrascrive la corsa precedente di
  un'area; quella attuale ha conservato 34 corse passate oltre all'ultima di
  ogni evento (l'area 503 ha ancora dicembre 2024 accanto a ottobre 2026), e
  nient'altro. Da qui in avanti le run del gioco si accumulano e non si
  cancellano, quindi la storia cresce solo rifacendo l'import: il repo si
  aggiorna circa una volta a settimana, con qualche giorno di anticipo sugli
  eventi in arrivo (`node db/import/fetch-datamine.mjs --fresh`, poi
  `npm run db:windows`). Il commit scaricato sta in
  `.cache/datamine/_snapshot.json`.
- **Gli eventi più nuovi il wiki non li ha**: le sue pagine di eventi si
  fermano a gennaio 2025. Li crea `load-game-events` dal gioco, nella
  sezione che segue.

## Gli eventi che il wiki non ha: dal gioco

Il wiki ha smesso di scrivere pagine di eventi a inizio 2025: l'ultima
uscita Global che documenta è del 19/01/2025, e da allora sono nate solo
pagine di carte. Gli eventi di quasi due anni, e 58 EZA, non avevano un
evento nostro. `npm run db:game-events` (`db/import/load-game-events.mjs`,
con i moduli in `db/import/game-events/`) li crea dal datamine Global; gira
dentro `db:import`, `db:refresh` e `db:test`, dopo `load-datamine` e prima di
`load-windows`, che così dà le finestre anche a loro.

**Chi diventa un evento.** Si guardano le aree attive dopo il taglio e le
EZA che `game-map` non ha legato a una pagina del wiki
(`game-events/classify.mjs`, regole rilette a mano sulle 138 aree):

| esito | quante | cosa |
|---|---|---|
| evento nuovo | 106 aree, 86 EZA | 71 challenge, 21 limited, 14 story, 86 zbattle (58 Normal, 28 Super) |
| riedizione di un evento che c'è | 20 aree | una riga in `event_game_ref` sull'evento esistente, niente evento nuovo |
| non è un evento | 5 | i capitoli della storia (MainArea 38-42) |
| archivio | 2 | 1737 Ultimate Red Zone, 1738 Supreme Magnificent Battle: ripropongono edizioni che hanno già un evento: nessun evento nuovo, le loro quest le lega `load-windows` alle edizioni |
| deciso a mano | 2 | 710 e 720 Super Battle Road: il wiki le ha in pagine per intervallo di piani, legate per quest da `load-windows` |
| tipo sconosciuto | 1 | 807, categoria 27: nessun evento legato da cui ricavare il tipo |

- **Riedizione** = stesso nome di un'area più vecchia dello stesso tipo, e
  almeno metà dei boss o delle quest non generiche in comune. Così 1226 va
  su 721748, 1219 su 709063, 613-618 sui loro Extreme Z-Area, 291 e 292
  sulle due "All Open" del wiki (per nome), 285 su 561817. 1747 è la
  replica di 1708, uscita prima del taglio e senza pagina: l'evento nasce
  da 1708 e 1747 gli si attacca.
- **Gli stage in più** di una riedizione finiscono sull'evento di prima:
  vedi "Gli stage che una riedizione aggiunge", qui sotto.
- **Evento nuovo anche con lo stesso nome**: i remix `: RE [...]`, le
  edizioni con boss diversi (Dokkan Ultimate Speed Battle 1757), i remake
  DbStory (come 901-917, che hanno già un evento ciascuno).
- **Million Arena** sono quattro aree (preliminari, semifinale, finale, in
  singolo) e un evento solo, 1000001717, con sei stage.
- **Le Super EZA** sono eventi a sé; il legame ricorda la Normal da cui
  pendono (`event_game_ref.related_game_id`), così il sito potrà collegarle.

**Gli stage che una riedizione aggiunge** (migrazione 0017,
`game-events/rerun-stages.mjs` e `write-rerun.mjs`). Legare la riedizione
all'evento non bastava: 552139 Looming Menace ha 3 stage dal wiki, la sua
riedizione 616 ne ha 4, e le missioni dicono "Clear Stage 4". Lo stesso per
le Extreme Z-Area riproposte (613-619), che aggiungono un "Extreme Stage".
Per ogni evento legato a più di un pezzo del gioco (aree, o quest legate una
per una: gli archivi), `load-game-events`, dopo aver scritto gli stage
propri, confronta le quest di ogni pezzo con gli stage che l'evento ha, per
area crescente:

1. **per nome**, dopo la normalizzazione di `game-map` o senza la variante
   fra parentesi del wiki;
2. **per ordine**: le quest rimaste vanno, in fila, sugli stage che nessuna
   quest di quel pezzo ha preso per nome. Copre i nomi che il wiki scrive
   diversi e gli stage senza nome; nel dubbio una quest "c'è già". Così
   52097, che dal wiki ha già lo stage 4 `[VS. Extreme AGL]`, dall'area 613
   prende solo il "Super Extreme Stage";
3. le quest che restano sono **stage nuovi, in coda**, col nome del gioco e
   le difficoltà come per gli eventi del gioco (`build.mjs`: `id % 10`,
   STA, exp, zeni, nota sul boss).

Dal secondo pezzo in poi gli stage appena aggiunti contano come propri, per
nome e per ordine: due riedizioni con lo stesso "Extreme Stage", o
l'archivio 1737 che ripete l'area dell'edizione 771 come "Movie Edition
Stage 8", non aggiungono niente due volte. Il confronto si fa sempre con gli
stage propri (non con quelli aggiunti nei giri prima), quindi il piano non
dipende da cosa c'è già nel database. Le famiglie (Million Arena) e l'area
di un evento del gioco restano fuori: i loro stage li ha già `buildEvent`.
Una pagina della Super Battle Road è legata a un pezzo solo, e i piani che
il wiki non ha scritto (81 - 90 ne ha 5 su 10) non entrano.

`stage.game_quest_id` è la quest da cui viene lo stage: chiave per rifarlo
(evento, quest: stesso id per lo stage e per le sue difficoltà, a cui
puntano i clear) e segno di chi l'ha scritto. `load-events` e `writeStages`
non lo tolgono come "stage che la mia fonte non dà più"; se la loro fonte
vuole il suo seq (il wiki che scrive uno stage 4), lo spostano in coda con
il suo id invece di prendersene nome e difficoltà (`makeRoom`). Il legame
col wiki (`wiki-refs.mjs`) guarda solo gli stage propri, o le chiavi
cambierebbero fra un giro e l'altro. Uno stage che il piano non dà più se ne
va, tranne se ha clear o tip.

Su `dokkan_dev`: 20 stage su 14 eventi. Sette Extreme Z-Area (552139 e
339306, 431231, 631974, 702246, 708590 col loro "Extreme Stage", 52097 col
"Super Extreme Stage"), le tre camere del 2026 (1221-1223, lo stage
"Category Only"), Grand Opening su Team Bardock (698372), Movie Boss Rush su
712687, sette saghe su 728324 dall'area 1703, e il secondo stage della
Gendarmerie (1747 su 1000001708). Il test (`db/test/rerun-stages.test.mts`)
li prova su 552139, 339306, 52097, 712687 e 1000001708, e controlla che un
secondo giro, anche dopo `load-events` e `load-windows`, non cambi niente.

**Gli id** non possono toccare i pageid del wiki (oggi fino a ~730.000):
`1000000000 + id dell'area`, `2000000000 + id dello stage EZA`.
`imported_from = 'datamine'`, `wiki_title` nullo.

**Cosa c'è dentro** (`game-events/build.mjs`):

- **Nome** inglese da `areas.name` (gli a capo diventano spazi); per le EZA
  `Extreme Z-Battle: <soprannome> <nome>`, la regola del wiki (143 nomi su
  152 identici), e `Super Extreme Z-Battle: ...` per le Super.
- **Stage** dalle quest, in ordine di id, col loro nome (70 su 479 sono
  "Stage N": il gioco non dice di più).
- **Difficoltà** da `sugoroku_maps.id % 10`: 0 Normal, 1 Hard, 2 Z-Hard,
  3 Super, 4 Super 2, 5 Super 3. Verificata contro i tier che il wiki ha già
  scritto: coincide in 1747 stage su 1788, e per codice 3 → super 167 volte
  (super2 8), 4 → super2 157, 5 → super3 196. La colonna `difficulty` no
  (1516): il 17/09/2025 il gioco ha declassato 479 mappe vecchie e mostra
  quell'etichetta. Il test rifà il confronto su sei eventi, uno per codice.
- **STA, exp, zeni** da `act`, `user_exp`, `zeni` (il wiki non dava questi
  ultimi due). Challenge e Red Zone costano 0 in entrambe le fonti.
- **Note sul boss**, per ogni difficoltà: l'ultimo round dell'ultima
  battaglia e le sue abilità, nello stesso formato delle EZA del wiki col
  nome davanti: `Boss: Majin Vegeta; Damage reduction -70%; Immune to:
  Stun, Seal Super Attack, Lower ATK, Lower DEF`. Sei aree il gioco le
  nasconde (`battles: null`) e restano senza nota.
- **EZA**: i livelli sono l'ultimo premio del primo completamento meno uno
  (148 su 152 come il wiki), le Super ne hanno uno. Per livello il boss, la
  riduzione danni (l'ultima arrivata) e le immunità (si sommano). Contro le
  note del wiki: riduzione uguale entro un punto in 4544 livelli su 4784,
  immunità uguali in 3892 (il gioco ha 875 sigilli in più). "Disable
  Interruption" non è il "Disable Action" del wiki e resta fuori. La
  stamina c'è solo per i checkpoint (`z_battle_check_points`).
- **Copertina**: `event.cover_card_id` (migrazione 0011), la carta del boss
  principale (l'ultimo stage alla difficoltà più alta, o l'EZA), solo se è
  nella tabella `card`; l'interfaccia la usa quando non c'è un banner. 173
  eventi del gioco su 192 ce l'hanno. Già che costava uguale, è riempita
  anche per gli eventi del wiki legati: 527 su 579.
- **Finestre**: le scrive `load-windows`, con le stesse regole. Un'area del
  gioco senza missioni (1776, 1224, 1226...) prende la partenza delle sue
  quest, con la fine non nota: senza, l'evento non avrebbe nessuna run.

**Rifarlo non cambia niente**: tutto per chiave naturale, gli id restano, e
un update scrive solo se il valore cambia (il test lo verifica, anche dopo
`load-events` e `load-windows`). Un evento del gioco che un giro non produce
più se ne va solo se non ha clear né tip sopra.

**Se il wiki scrive la pagina dopo.** `load-events` cerca, per le sole
pagine nuove, il legame col gioco con le stesse chiavi di `load-windows`:
se l'area o l'EZA è già di un evento del gioco, la pagina si salta e lo
dice (`game-events/wiki-guard.mjs`), invece di creare un doppione. La
fusione non è automatica, perché sposta righe con dei clear sopra. Senza
clear né tip basta togliere l'evento del gioco (`delete from event where
id = ...`, la cascata porta via stage, run e legami) e rilanciare
`db:import`: la pagina entra, `load-game-events` non ricrea l'evento perché
ora l'area è del wiki, e `load-windows` le dà le finestre. Con dei clear
va scritta una volta, in una transazione: creare l'evento del wiki, portare
su di lui (cambiando `event_id`, non gli id) stage, tier, run, clear e tip
dell'evento del gioco, passare il legame a `source = 'wiki'`, togliere
l'evento del gioco ormai vuoto, e poi rilanciare l'import.

**Cosa non hanno** gli eventi del gioco, rispetto a quelli del wiki: la
descrizione (il datamine non ha testi degli eventi, solo `announcement_id`
di news che non contiene), il banner (il datamine dà solo il percorso del
file, e il wiki non li carica più dal febbraio 2025), la data Japan, i nomi
degli stage "Stage N", l'exp del personaggio e i drop, e il nome dei boss
la cui carta non abbiamo (manca anche la copertina: 19 eventi). Le missioni
il gioco le ha, ma non sono ancora importate.

## Super Battle Road e archivi: un'area, più eventi

`event_game_ref` vuole un'area per evento (la chiave è `(game_kind,
game_id)`), ed è giusto quasi sempre. Due famiglie no:

- **Super Battle Road**: il gioco ha due aree, 710 (90 piani) e 720 Extreme
  (85), un piano per quest. Il wiki ha una pagina ogni dieci piani, 9 + 6
  pagine, e nessuna si legava: restavano con la prima uscita del wiki.
- **Gli archivi** 1737 Ultimate Red Zone e 1738 Supreme Magnificent Battle
  ripropongono le edizioni vecchie, ognuna già evento a sé, come quest
  "GT Edition Stage 3". Le edizioni risultavano "fine non nota" dal 2022,
  anche se sono in gioco.

Allargare la chiave avrebbe reso ambiguo ogni altro legame. La migrazione
0012 fa scendere la riga di un livello: `game_kind = 'quest'`, `game_id` =
id della quest. Una quest sta in una pagina sola, e la chiave regge com'è.
Le righe le scrive `load-windows` (`source = 'wiki'`, ricostruite a ogni
giro come le altre sue), con le regole di `db/import/quest-refs.mjs`, due
chiavi ciascuna:

- `via = 'range'`: "Super Battle Road 11 - 20" prende le quest dalla 11a
  alla 20a dell'area che si chiama come la pagina senza l'intervallo, se i
  nomi degli stage sono quelli delle quest (almeno metà: 81 - 90 ne ha 5 su
  10; Extreme 1 - 10 ripete i nomi della Super, che il gioco tronca).
- `via = 'archive'`: la quest "<Edizione> Stage N" dell'archivio va
  all'evento dell'area "<nome dell'archivio> [<Edizione>]", del wiki o del
  gioco, se i boss delle quest con quel prefisso sono quelli dell'edizione
  (sono uguali, 1.00, in tutte). 110 quest su 117: Movie Edition di 1738
  (area 797) non ha un evento, e l'import lo dice.

**Le finestre.** Le due famiglie non chiudono: SBR aggiunge piani alle
stesse aree dal 2018 (l'ultimo il 22/07/2026) e i primi sono ancora lì, con
le missioni del 2018; un archivio esiste per tenere in gioco le edizioni
finite (la SDBH Edition, che è finita il 07/12/2023, non c'è). Quindi, finché
l'area è accesa (il suo ultimo blocco di missioni scade nel 2038, la regola
delle aree), la quest è una corsa **permanente**, dalla sua partenza vera.
Quasi tutte le quest degli archivi hanno la partenza fittizia 2015-10-30:
per loro vale l'apertura dell'archivio, la prima missione che parla solo
delle sue mappe. Le missioni più vecchie sono quelle delle edizioni,
trasferite con la loro data e con le mappe di prima accanto a quelle nuove
(la 31506 del 06/01/2026 ha `[17360035, 17370825]`). Le prime solo sue sono
del **22/01/2026 05:00** per entrambi, e torna con la storia del repo: gli
archivi non ci sono nella fotografia del 26/12/2025, ci sono in quella del
23/03/2026. Artificial Life Forms entra nell'archivio il 26/02/2026 08:00,
con la partenza vera delle sue quest.

**La riconciliazione** è quella di sempre, con due ritocchi:

- una pagina SBR **è** la sua fetta di piani, quindi la sua run del wiki è
  la stessa uscita anche quando la data sbaglia, e diventa quella del gioco
  sul posto: 81 - 90 il wiki la dà il 10/11/2023 (la data di 71 - 80), il
  piano 81 apre il 18/07/2024; Extreme 51 - 60 il 14/04/2023 contro il
  02/04/2024. Senza, resterebbe un tratto "concluso" inventato;
- per un'edizione la run di prima (la prima uscita del wiki, o la finestra
  dall'area del gioco, che non ha più missioni perché sono passate
  all'archivio) **finisce, non dopo, dove comincia l'archivio**, con la fine
  non nota, e la permanenza entra come run nuova. Fuse, la corsa sarebbe
  stata "fine non nota" e l'archivio non si sarebbe visto.

Il resto non cambia: una run a mano vince e la finestra si salta, non si
cancella niente, e un clear scritto oggi sulla run chiusa la porta con sé
sulla permanenza (lo scambio). Il test (`db/test/classification.test.mts`)
li prova tutti e due, su GT Edition.

**Il risultato** su `dokkan_dev`: le 15 pagine SBR hanno una run Global sola,
permanente, dal primo piano del loro intervallo (1 - 10 dal 14/02/2018 06:30,
Extreme 1 - 10 dal 15/09/2020 06:00). Le 17 edizioni (13 Ultimate Red Zone,
4 Supreme Magnificent Battle) sono in corso, permanenti dal 22/01/2026
(Artificial Life Forms dal 26/02); 7 run del wiki e 6 del gioco sono state
chiuse lì, e quattro edizioni che il
wiki dava solo su Japan o senza data (725181, 726771, 725305, 726799) ora
hanno la loro run Global. Un secondo giro non cambia niente.

## Le missioni: dal gioco, con i premi

`npm run db:missions` (`db/import/load-missions.mjs`, moduli in
`db/import/missions/`), dentro `db:import` e `db:refresh` subito dopo
`load-windows`. Legge `missions.csv` e `mission_rewards.csv`, e per i nomi
dei premi una tabella per tipo di oggetto (`training_items`,
`awakening_items`, `potential_items`, `cards`... ventuno, aggiunte a
`fetch-datamine` dallo stesso commit delle altre). Migrazione 0013.

**Di quale evento.** Il gioco lo dice con `area_id` e `z_battle_stage_id`, e
il ponte è `event_game_ref`, lo stesso delle finestre:

| strada | missioni |
|---|---|
| EZA (`z_battle_stage`) | le missioni dello stage; quelle "at Lv. SUPER" di una Super EZA stanno sullo stage Normal ma nominano lo stage Super nelle condizioni, e vanno alla Super |
| area | le missioni dell'area legata |
| quest (Super Battle Road, archivi) | la quest delle mappe nelle condizioni; le "completa queste missioni" vanno all'evento delle missioni elencate |

Restano fuori, elencate dall'import col motivo: le cancellate
(`Mission::DeletedMission`), quelle senza una finestra Global (partite
prima di luglio 2015, o finite quando iniziano), e le **campagne**: una
missione appesa a un'area che chiede stage di un altro dei nostri eventi
("Go Forth!", area 331, sei eventi in uno) non è di nessuno dei due. Con la
fotografia del 2 ottobre: **7720 missioni su 642 eventi**, 118 fuori (89
quest senza evento: i piani 61+ della Extreme SBR, che il wiki non ha, la
SMB Movie Edition e 43 missioni Burst Mode di Ultimate Red Zone, che
nominano solo un `genkai_battle_id` senza tabella; 14 senza finestra; 13
campagne; 2 "tutti gli stage" di un archivio intero).

**Il testo è inglese, ed è già intero.** Sul database Global ci sono 4311
missioni in giapponese, nessuna sulle nostre aree (l'import le salterebbe).
Non c'è un modello da riempire con le condizioni: `name` è il titolo breve
della lista, `description` la frase completa. Due ritocchi: gli a capo sono
quelli dello schermo del telefono e si uniscono (restano i paragrafi e le
note con l'asterisco), e il segnaposto `{cards: by_conditions}` (o
`{cards:card_id:...}`), che il client sostituisce col pulsante delle carte
valide, si toglie: la condizione sta già nella frase.

**La corsa.** Una missione che scade il 2038 non ha una scadenza sua: c'è
ogni volta che l'evento è aperto. `run_id` e `ends_at` nulli (5236). Una con
una fine vera va nella run Global dello stesso evento che contiene la sua
finestra (2484, tutte trovate); se mancasse, si salterebbe invece di
chiamarla permanente. `mission` tiene anche la sua finestra
(`starts_at`/`ends_at`), che non è quella della corsa: uno stage aggiunto a
metà porta missioni che partono dopo. `seq` è l'ordine del gioco:
`priority` più alta prima (lo stage 1 ha 30014, lo stage 2 30013), poi l'id.

**I premi.** `mission_reward(mission_id, seq, item_type, item_id,
quantity)` punta a `game_item` (tipo e id del gioco) col nome in
`game_item_text`. I Point non hanno tabella del nome: Dragon Stone, Zeni,
Friend Points, Baba Points li scriviamo noi, e sono `community`; il loro id
è un pacchetto di `points.csv` (id 11 = 1 stone), e `quantity` è già il
totale. `game_item.reward_item_slug` dà l'icona quando il nome è uguale a uno
dei 29 oggetti del wiki (Dragon Stone, Zeni, Z-Sword, i pesi...), `card_id`
quando il premio è una carta che abbiamo (192). `mission_text.reward` è il
riassunto da leggere: "Dragon Stone x20", "TEQ Potential Orb (L) x230, ...".

**Reimport.** Upsert per `game_mission_id`, gli id restano; il secondo giro
scrive zero righe. Una missione uscita dalla fotografia resta (è storia, come
le run del gioco); una ancora nel gioco che le regole non danno più a nessun
evento si toglie. Il test (`db/test/missions.test.mts`) confronta
riga per riga 552139 Looming Menace con i CSV: tre missioni nella corsa di
aprile 2020, tre del 2026 senza scadenza.

## Gli account

Si entra con Discord, Google, Twitch o con un link per email (magic link).
Niente password: non c'è nessun `emailAndPassword` da tenere al sicuro.
La libreria è [better-auth](https://www.better-auth.com) **1.7.7**, fissata
esatta in `package.json` (con `resend` 6.32.1 e `server-only` 0.0.1): sugli
aggiornamenti si leggono gli avvisi di sicurezza prima di cambiare numero.

**Dove sta cosa.**

- `db/migrations/0014_auth.sql`: scritta a mano, non con la CLI di
  better-auth. `app_user` resta l'unica tabella delle persone (better-auth la
  usa come sua `user`, con i campi rimappati: `name` → `display_name` e così
  via), più `auth_session`, `auth_account`, `auth_verification`,
  `auth_rate_limit`, `auth_email_send`. Id uuid dal database, tutte le FK
  verso `app_user` con `on delete cascade`.
  I verbi: `complete_onboarding(utente, handle, regione)`,
  `note_email_send(email)` (la pausa per indirizzo), `auth_rate_consume`
  (il limite per IP, atomico) e `purge_auth_expired()`.
- `lib/auth/`: `env.ts` è l'unico file che legge le variabili dell'accesso;
  `config.ts` costruisce better-auth (senza Next, così i test la usano);
  `auth.ts` è l'istanza dell'app; `email.ts` il mittente del link;
  `actions.ts` le Server Action (uscita, /welcome, Settings); `account.ts`
  le regole di Settings in funzioni pure (pagina, azione e test).
- `lib/dal.ts`: `currentUser()`, `requireUser()`, `requireOnboardedUser()`.
  **Ogni pagina protetta e ogni Server Action passa da qui**, e l'id
  dell'utente viene sempre dalla sessione, mai da argomenti, FormData o
  `.bind()`: le funzioni SQL di scrittura si fidano del `p_author` che
  ricevono.
- `app/api/auth/[...all]/route.ts`: le rotte di better-auth (callback OAuth,
  verifica del link, sessione, uscita).
- Le pagine: `/login`, `/welcome` (prima entrata: handle e regione),
  `/settings` (metodi di accesso collegati, scollegare, uscita, cancellare
  l'account). Nell'header, dentro un
  `<Suspense>`, "Sign in" oppure l'utente.

**Le regole, e perché.**

- Un account nuovo nasce solo con un'email che il provider dichiara
  verificata (`validateUserInfo` in `config.ts`; il magic link la verifica da
  sé). Nessun collegamento implicito per email: se l'indirizzo ha già un
  account, `/login` dice di entrare come la volta prima e collegare il
  provider da Settings. Così nessuno prende l'account di un altro registrando
  la sua email su un provider.
- Nessun token dei provider resta salvato: un hook li azzera e un vincolo
  (`auth_account_no_secrets`) rifiuta la riga se un aggiornamento cambiasse
  strada. Ci serve solo l'identità.
- Magic link: salvato come hash, monouso, 10 minuti. Al massimo 3 richieste
  al minuto per IP, e per indirizzo una ogni 60 secondi e 3 ogni 15 minuti.
  La pagina risponde sempre "check your inbox": non rivela chi è iscritto.
- Sessioni nel database (30 giorni, rinnovate al più una volta al giorno),
  niente cache nel cookie: uscire o revocare vale subito.
- Alla prima entrata l'utente ha un handle provvisorio `user_xxxxxxxx` e
  `onboarded_at` nullo; `/welcome` lo fa scegliere (3-24 tra lettere, cifre,
  `_`, non riservato) con `complete_onboarding`. Chi nasce da SQL (fixture,
  seed, test) ha `onboarded_at` già pieno.
- Un provider compare solo se ha **entrambe** le sue variabili.
- All'avvio (`instrumentation.ts`) la configurazione si controlla e parte la
  pulizia delle righe scadute, ripetuta ogni giorno.

**Provarlo in locale.** Con il server di sviluppo acceso (`npm run dev`) e
`.env.local` con `BETTER_AUTH_URL=http://localhost:3000` e
`BETTER_AUTH_SECRET` (`openssl rand -base64 32`):

1. Apri `http://localhost:3000/login`, scrivi un indirizzo finto come
   `test+1@example.invalid` e chiedi il link.
2. Senza `RESEND_API_KEY` il link **non parte**: il server lo stampa nel suo
   terminale e lo aggiunge a `$TMPDIR/dokkan-magic-links.log` (solo in
   sviluppo, mai in produzione). Aprilo: si arriva a `/welcome`.
3. Scegli handle e regione: si torna alla pagina di partenza, con l'utente
   nell'header. Da lì Settings e Sign out.
4. Per togliere l'utente di prova:
   `psql -d dokkan_dev -c "delete from app_user where email like 'test+%@example.invalid'"`
   (sessioni e account se ne vanno a cascata).

`npm run test:auth-smoke` fa lo stesso giro con curl sul server che gira
(richiesta, link dal file, verifica, cookie, `/welcome`, link riusato
rifiutato, uscita) e cancella da solo il suo utente. `npm run db:test`
comprende il passo "account" (`db/test/auth.test.mts`): vincoli e verbi SQL,
poi better-auth vero su `dokkan_test` con un mittente che cattura i link.

I bottoni Discord, Google e Twitch partono già in locale se le variabili ci
sono, ma il giro completo va provato a mano con un account vero.

**Per la produzione** i passi (callback presso i provider, Google "In
production", Resend, le variabili su Vercel) sono in "Messa online", in
fondo. Senza `RESEND_API_KEY` o `EMAIL_FROM` il server di produzione **non
parte**, apposta.

**Settings: scollegare e cancellare (migrazione 0019).**

- *Scollegare un provider* si può solo se resta almeno un modo di entrare.
  Il link per email conta come modo **solo con l'email verificata**: è
  l'unico caso in cui il link arriva a chi possiede l'account. Oggi ogni
  account nasce verificato (vedi sopra), quindi in pratica si può
  scollegare anche l'ultimo provider e restare col link; la regola però
  non si appoggia a quell'invariante. La impone `unlink_provider(utente,
  provider)` con la riga dell'utente bloccata (`for update`): due richieste
  in parallelo non tolgono entrambe l'ultimo provider. La rotta
  `/unlink-account` di better-auth è spenta (`disabledPaths` in
  `config.ts`, con `/delete-user`): conta solo i provider, e sarebbe una
  seconda strada con regole diverse. In pagina la conferma sta nella
  riga e dice con cosa si entrerà dopo; il provider che non si può
  togliere mostra "Your only way to sign in".
- *Cancellare l'account*: la "Danger zone" chiede di scrivere il proprio
  handle (maiuscole e spazi ai lati liberi). `delete_account(utente,
  handle)` lo ricontrolla contro l'handle di **quell'** utente, quindi
  anche un id sbagliato non cancella un altro. Poi fa tutto la cascata:
  ogni FK verso `app_user`, `clear` e le versioni è `on delete cascade`
  (sessioni, accessi, squadre, assetti, clear con versioni, prove, carte e
  build, voti e commenti anche sui clear degli altri, con i punteggi
  ricalcolati dai trigger). L'unico buco era `report`, il cui `target_id`
  è polimorfico e senza FK: ora un trigger toglie la segnalazione quando
  sparisce il suo clear, la sua tip o la sua prova (vale anche per
  `delete_clear`). Prima di cancellare raccoglie gli eventi, le carte e i
  profili che l'utente ha toccato, e dopo li invalida nella cache. Poi
  `signOut` toglie il cookie (e `dts_signed_in`) e si torna a
  `/events?account=deleted`, con un avviso che chi è dentro non vede.
- Il limite è nella natura: si cancella una volta, e si scollegano al più
  tre provider.
- *La sessione fresca.* Scollegare, collegare un provider e cancellare
  l'account chiedono un accesso di meno di 15 minuti (`lib/auth/fresh.ts`,
  `isFreshSession`): conta `auth_session.created_at`, che il rinnovo
  giornaliero non sposta, quindi solo un accesso vero. Così un cookie di
  sessione vecchio, anche rubato, non basta per agganciare un altro
  provider né per chiudere l'account. Le due Server Action partono da
  `requireFreshUser` in `lib/dal.ts`: con una sessione vecchia rispondono
  `{ reauth: true }` senza toccare il database. Collegare passa dalla rotta
  `/link-social` di better-auth, che da sola non controlla: lo fa un hook
  `before` in `config.ts`, che risponde 403 `SESSION_NOT_FRESH`; la stessa
  soglia è `session.freshAge`. In pagina, al clic, al posto della conferma
  compare "Sign in again" (`components/auth/reauth-notice.tsx`), che porta a
  `/settings/sign-in`: lì si rientra con un modo di entrare di questo
  account (un provider collegato, o il link se l'email è verificata) senza
  uscire, e si torna a Settings con una sessione nuova. Dalla moderazione
  (sospendere chiede la stessa sessione fresca) il link porta
  `?next=<pagina di /admin>` e si torna lì; ogni altro `next` vale
  `/settings`. `/login` non va bene
  per questo: rimanda via chi ha già una sessione. Lo prova il passo
  "account" (`db/test/auth.test.mts`).
- Il test è il passo "settings dell'account"
  (`db/test/account-settings.test.mts`): regole pure, FK tutte a cascata,
  `unlink_provider` (anche in parallelo), le rotte di better-auth spente,
  e un utente con clear, build, prove, squadre, voti, commenti, tip e
  segnalazioni che si cancella senza lasciare righe e senza toccare
  l'altro utente.

Le Server Action di scrittura (invio, voto, commenti) sono in
`lib/clears/actions.ts`, su `requireOnboardedUser` (sotto).

## Il builder dei clear (migrazione 0016)

Il sito non scrive team, assetti e slot uno per uno: manda il modulo intero
come jsonb a `submit_clear_from_builder(autore, run, tier, payload)`, che
in **una** transazione valida, crea il team (con il nome del leader), i suoi
assetti e gli slot, e poi chiama `submit_clear` del 0002. Le regole di
quello (assetto completo, ricorrenza iniziata, prove) restano scritte una
volta sola. `revise_clear_from_builder(autore, clear, motivo, payload)` fa
lo stesso con `revise_clear`, e torna l'id della versione nuova.

- **Il payload.** Da 1 a 4 assetti: il #1 è la squadra di partenza, gli
  altri sono i cambi a metà evento, con un nome (obbligatorio, 40
  caratteri) e una nota (500). Ognuno ha 7 unità nella forma 2+2+3, un
  leader e un friend (anche la stessa carta), carte che esistono. Poi
  `no_items`, `deathless`, `turns` (1-99 o null), `note` (2000), `lang`,
  `proofs` (0-3, screenshot o video, solo https; gli accorciatori li
  rifiuta `proof_provider`).
- **Ogni rifiuto ha un nome.** Il database mette `builder_*` nel campo
  CONSTRAINT dell'errore; `lib/clears/errors.ts` lo traduce in inglese.
  La suite controlla che ogni nome della migrazione abbia la sua frase.
- **I cambi sono congelati con la versione.** `lineup_snapshot` e
  `clear_card` vedono solo l'assetto #1 (e continuano a servire le pagine
  e i filtri per carta). `clear_lineup` e `clear_lineup_card` tengono
  tutti gli assetti di ogni versione: si scrivono solo nella transazione
  che crea la versione, non si modificano, e si cancellano solo in cascata
  con lei. I clear nati prima del 0016 non hanno righe lì: per loro c'è
  solo l'assetto di partenza (`getClearForEdit` lo rilegge da `clear_card`).
- **La revisione** riscrive al posto il team se lo usa solo quel clear,
  altrimenti ne crea uno nuovo. Le prove sono quelle del payload (il
  modulo parte da quelle della versione corrente); una prova che resta si
  porta dietro l'ultimo controllo del link. Voti e commenti restano sulla
  versione vecchia, come sempre.
- **Il freno.** Al massimo 10 invii, 20 revisioni e 30 commenti l'ora per
  utente, contati in `clear_write_log`: un registro che cancellare i
  clear non svuota. Un invio rifiutato non conta (la transazione cade).
- **Voti e commenti dal sito** passano da `vote_clear_version` e
  `comment_clear_version`, che accettano solo la versione **corrente** di
  un clear pubblicato: se il clear è stato rivisto mentre la pagina era
  aperta, il voto non finisce su un assetto mai visto. Il proprio clear
  non si vota (regola di `vote_clear`); un voto per utente e versione, che
  si cambia rivotando e si ritira con 0. Il proprio clear si commenta: è il
  modo di rispondere. `vote_clear` e `add_clear_comment` del 0002 restano
  come sono.
- **Chi è l'autore** lo decide sempre la sessione: le Server Action di
  `lib/clears/actions.ts` (`submitClear`, `reviseClear`, `deleteClear`,
  `voteClear`, `addComment`) partono da `requireOnboardedUser()`, validano
  il form con le funzioni pure di `lib/clears/validate.ts` e non leggono
  mai un id utente dall'input. Il database rifà comunque tutto, e
  controlla che `p_author` esista e abbia finito /welcome.
- **Il picker** legge `GET /api/cards?q=&type=&class=&rarity=&category=&offset=`:
  solo carte uscite su Global, 40 per pagina, parametri sbagliati danno 400.

Le verifiche sono `db/test/submit.test.mts` (gli ingressi SQL) e
`db/test/clears-lib.test.mts` (validatori, letture, la rotta).

### Le pagine

- **Pagina evento.** Il livello scelto sta nel percorso
  (`/events/<id>[/japan]/t/<tier>[/p/<n>]`, sezione "Cache e budget CPU").
  Nel suo pannello c'è "Submit a clear"
  (chi non è entrato vede "Sign in to submit a clear", con `?next=` al
  builder dello stesso livello). Ogni clear mostra i cambi di squadra sotto
  la partenza, i voti (su e giù, il voto di chi guarda, `useOptimistic`),
  i commenti della versione corrente in un `<details>` chiuso, e per
  l'autore Edit e Delete (con conferma). I dati in più li legge
  `lib/clears/vista.ts`, poche query per pagina; voto, Edit/Delete, modulo
  dei commenti e invio sono isole client che leggono `/api/me?tier=`, così
  l'HTML della pagina è uguale per tutti e sta in cache. Dopo un invio o
  una revisione si arriva alla pagina dove il clear compare davvero.
- **`/events/[id]/submit?tier=`** e **`/events/[id]/clears/[clearId]/edit`**:
  lo stesso builder (`components/builder/`). Lo stato è un `useReducer`
  puro in `lib/clears/builder-stato.ts` e parte come un solo campo JSON;
  prima dell'invio passa `parseBuilderPayload`, lo stesso controllo
  dell'azione. Il picker è un `<dialog>` modale (a schermo pieno sotto i
  640px) su `/api/cards`, con frecce, Enter ed Escape. In modifica la
  ricorrenza non si cambia: `revise_clear_from_builder` non la prende.
  La modifica di un clear altrui risponde 404.
- **I cambi di squadra sono copie.** "Add a rotation change" copia la
  squadra sopra, con carte, leader, friend e build; da lì il cambio è
  indipendente, e una modifica alla partenza non lo tocca (lo dice una riga
  sotto il bottone). Per riallinearlo, ogni cambio ha "Copy the starting
  team again" (azione `ricopia_partenza` del reducer): riporta carte, ruoli
  e build della partenza e lascia nome e nota del cambio. Se il cambio è
  diverso dalla partenza chiede conferma in riga, perché le sue modifiche
  andrebbero perse; se è uguale (`comeLaPartenza`) dice "Same as the
  starting team" e non offre niente.

Lo stato del form lo prova `db/test/builder-stato.test.mts`.

## Le build degli slot (migrazione 0018)

Ogni slot di ogni assetto può avere una build, tutta opzionale: quanti
percorsi del Hidden Potential sono completati, il percorso o le abilità
scelte, fino a tre Skill Orb e una nota.

- **Cosa dà il gioco.** La tavola del Hidden Potential ha quattro percorsi
  (`potential_squares.route` 0-3) e il gioco stesso ne parla così
  ("unlocking two Hidden Potential routes"): il livello è quindi
  `hp_routes` 0-4, dove 4 è l'arcobaleno. Le stelle 0-5 del 0001 il gioco
  non le ha, e `slot_build.hp_stars` è diventata `hp_routes`. Le caselle a
  scelta (Combo Attack, Critical Hit, Evasion...) cambiano da carta a
  carta: il percorso resta un testo di 40 caratteri, e il builder suggerisce
  i sette nomi di `potential_skills`. L'equipaggiamento sono le **Skill Orb**
  (`equipment_skill_items`, 8857 con nome inglese e grado bronzo, argento,
  oro): `load-equipment` le scrive in `equipment` (tier 1-3) ed
  `equipment_text`, e non ne cancella mai una, perché una build congelata
  ci punta. Chi può montare quale sfera lo dice il 0021 (sezione sotto).
- **Il payload.** Ogni slot può avere
  `"build": {"hp_routes": 0-4, "hp_path": "...", "note": "...", "equipment": [id|null x 3]}`;
  la posizione nell'array è lo slot della sfera. Una build vuota vale come
  nessuna build e non si salva. I rifiuti hanno un nome come quelli del
  0016 (`builder_build`, `_routes`, `_path`, `_note`, `_equipment`).
- **Come è scritta.** `builder_check_payload`, `builder_write_team` e
  `builder_freeze_lineups` del 0016 sono rinominate in `*_0016`; le nuove
  le chiamano e poi fanno la parte delle build. `submit_clear_from_builder`
  e `revise_clear_from_builder` restano le stesse, con le stesse firme.
- **Congelate con la versione.** `clear_lineup_build` e
  `clear_lineup_equipment` hanno lo stesso patto di `clear_lineup`: scritte
  nella transazione della versione, mai modificate, cancellate solo in
  cascata. Una revisione riscrive il team e lascia le versioni vecchie con
  le loro build. Anche lo snapshot del #1 le porta (`take_lineup_snapshot`
  rifatta: ora le sfere dicono lo slot).
- **Nelle pagine.** Nel builder ogni carta ha un bottone Build che apre un
  `<dialog>` (a schermo pieno sotto i 640px): percorsi, percorso, tre
  sfere cercate su `GET /api/equipment?q=&tier=&offset=` (tutte le parole,
  nel nome o nella descrizione, perché le esclusive hanno lo stesso nome)
  e la nota. Un cambio di squadra parte con le build della squadra sopra
  (e le ricopia dalla partenza con "Copy the starting team again"); in
  modifica il form parte dalle build della versione corrente. Nei clear
  la build è una riga piccola sotto la carta, solo se c'è.

Le verifiche sono in `db/test/builds.test.mts` (e i suoi moduli
`builds-revise.ts`, `builds-pure.ts`): 83 controlli.

## Le Skill Orb esclusive (migrazione 0021)

Ogni sfera del gioco ha una regola (`equipment_skill_limitations`, una per
set), di quattro tipi:

- **tipo e classe**: `element_bitpattern`, dove i bit 0-4 sono AGL..PHY
  con qualunque classe, 12-16 le Super e 17-21 le Extreme (31 = tutte,
  4096 = Super AGL). Si espande nelle coppie ammesse
  (`equipment_limit_type`);
- **categoria**: le categorie del gioco (`equipment_limit_category`), che
  si confrontano con `card_category`;
- **lista di carte** ([Character-Exclusive]): gli id del gioco nominano
  spesso la forma Z-awakened (x...1) e tutta la catena del Dokkan
  Awakening; ogni id torna all'unità che abbiamo, con l'id della base
  (`equipment_limit_card`);
- **nome** ("name includes Goku"): un set di `card_unique_infos`
  (`card_unique_info_set_relations`), risolto nelle nostre carte con
  `cards.card_unique_info_id`, nella stessa tabella delle liste.

`load-equipment` le riscrive tutte a ogni giro (nessuno ci punta) e dice
se qualcosa è cambiato; una carta importata dopo entra con il giro dopo.
`equipment_fits(sfera, carta)` dice se la carta la monta; una sfera senza
regola si monta su tutte, una regola senza carte nostre su nessuna (3 oggi,
per carte non ancora uscite). Il builder rifiuta una sfera sbagliata con
`builder_build_equipment_card`, in invio e in revisione:
`builder_check_payload` è riscritta con tutti i controlli del 0018 e poi
questo. Nel builder la ricerca passa la carta dello slot
(`GET /api/equipment?card=`), mostra solo le sfere giuste e dice quante ne
nasconde (`hidden`). Non si controllano i limiti della copia del
giocatore: livello della Super Attack, percorsi sbloccati, rarità UR/LR
scritta solo nella descrizione.

Le verifiche sono in `db/test/orbs.test.mts` (e `orbs-search.ts`).

## Moderazione (migrazione 0024)

Chi è collegato può segnalare un clear o un commento (un motivo dalla
lista, al massimo 10 segnalazioni l'ora). Le segnalazioni finiscono nella
coda di `/admin`, che vedono solo gli utenti con ruolo `admin` non sospesi:
per chiunque altro ogni URL di `/admin` è un 404. `proxy.ts` dà un 404 vero
a chi non ha il cookie di sessione. Per un membro collegato il 404 arriva
nello stream (status 200 con noindex, senza nessun dato): il cancello vero è
`requireAdmin` (`lib/moderation/guard.ts`), che apre ogni pagina e ogni
Server Action di `lib/moderation/actions.ts`, e sotto `mod_assert` nel
database. Nessuno viene nascosto in automatico: decide sempre un moderatore.

- **Reports**: una riga per bersaglio, la più vecchia per prima. *Hide*
  nasconde il clear o il commento e chiude le sue segnalazioni. *Dismiss*
  le archivia senza toccare il post (chiede conferma). Nascondere un clear
  chiude solo le sue: quelle sui suoi commenti restano in coda, segnate
  "Its clear is hidden".
- **Hidden**: i clear e i commenti nascosti, con *Unhide*. Un clear rimesso
  torna con i voti che aveva.
- **Users**: la ricerca per handle e i sospesi. La scheda di un utente
  permette di sospenderlo per 1, 7 o 30 giorni o a tempo indeterminato, con
  un motivo che l'utente vede, oppure di togliere la sospensione. Sospendere
  chiede un accesso recente, come le azioni di Settings. Gli admin non si
  possono sospendere.
- **Log**: ogni azione dei moderatori, in `moderation_action`. È
  append-only (i trigger rifiutano UPDATE, DELETE e TRUNCATE) e non tiene il
  contenuto: solo id, handle e note.

Ogni azione invalida per tag con `lib/cache/invalidate.ts`
(`afterClearWrite`, `afterUserChanged`), con gli id presi dal database.

### Dal lato di chi usa il sito

Le pagine pubbliche restano le stesse per tutti: Report, il banner della
sospensione e il link Moderation sono isole client che leggono GET /api/me.

- **Report.** Lo vedono solo un utente entrato, con l'handle e non sospeso, e
  solo sui post degli altri: clear fuori da `tier.own`, commenti fuori da
  `tier.ownComments`. Il form (`components/moderation/segnala.tsx`) chiama la
  Server Action `reportContent` (`lib/moderation/report-actions.ts`), che
  passa da `report_content`. Un doppione e una segnalazione nuova danno lo
  stesso grazie. Il limite è di 10 segnalazioni all'ora, e una segnalazione
  aperta conta una volta sola.
- **/api/me** aggiunge `user.isAdmin`, `user.suspended` e
  `user.suspendedUntil` (una data ISO o `'infinity'`). `suspensionReason`
  c'è solo per chi è sospeso. `tier.ownComments` elenca i propri commenti
  pubblicati del tier. Il link Moderation nell'header compare solo con
  `isAdmin`.
- **Sospensione.** Il database ferma invio, revisione, voti, commenti e
  segnalazioni (`builder_assert_author`, account_suspended). Restano
  permessi l'accesso, la lettura, Settings, `delete_clear` e
  `delete_account`. Il banner con la data e il motivo compare in Settings,
  nella pagina di invio, in quella di modifica e sopra la lista dei clear.
  Le sessioni non si revocano: senza cookie cache, un cambio vale dalla
  richiesta dopo. Un sospeso non vede "Submit a clear" né Edit sui propri
  clear, solo Delete (le isole leggono `user.suspended`).
- **Clear nascosti.** Spariscono anche dalle liste del loro autore, che li
  ritrova in Settings ("Hidden by a moderator"). Dalla pagina di modifica
  li può ancora cambiare (restano nascosti) o cancellare.
- **Le frasi d'errore** dei rifiuti di 0024 stanno in un posto solo,
  `lib/moderation/errors.ts`; `friendlyClearError` ci ricade prima del suo
  42501 generico, così un sospeso legge "Your account is suspended" anche
  nei form del builder, dei voti e dei commenti.

### Privacy e conservazione

Le pagine `/privacy` e `/terms` (con `lib/legale.ts`) lo dicono a chi usa il
sito:

- si segnalano clear, commenti e tip (da 0025);
- una segnalazione tiene chi l'ha fatta, il bersaglio, il motivo, i
  dettagli e l'ora. La vedono solo i moderatori; l'autore del post non sa
  chi l'ha segnalato;
- le segnalazioni chiuse restano 180 giorni (`LEGALE.giorniSegnalazioni`),
  poi le cancella il cron giornaliero (`/api/cron/purge`,
  `purge_resolved_reports`). Le aperte restano. Se ne vanno prima con
  l'account di chi le ha fatte o con il post segnalato;
- la data di fine e il motivo di una sospensione restano finché la si toglie
  o l'account si cancella;
- il registro resta senza limite di tempo, con gli id e l'handle del
  moderatore, mai il testo del post. Cancellare un account mette a null il
  suo id nel registro (FK `on delete set null`), l'handle del moderatore
  resta.

Per le tip e la pagina della carta le stesse pagine dicono che le tip sono
pubbliche con l'handle e che il conteggio Helpful non dice chi ha votato;
che una tip si cancella con l'account; che il default dell'artwork sta
nell'account (`prefers_animated`) e la scelta per carta solo nel
localStorage del dispositivo. I Terms citano il wiki (CC BY-SA 3.0) per i
testi delle carte (`FONTE_TESTI` in `lib/legale.ts`) e vietano le tip con
link che nascondono dove portano.

### Il primo admin

Mai dall'interfaccia: il ruolo si cambia solo da script, e ogni cambio
finisce nel registro (moderatore vuoto = script).

    npm run db:role -- <handle> admin                 # su DATABASE_URL (sviluppo)
    npm run prod:role -- <handle> admin --yes         # sul database di produzione

`prod:role` passa da `db/prod/target.mjs` come gli altri script di
produzione: rifiuta `dokkanteamsharing`, i database locali e quelli
`_dev`/`_test`, e senza `--yes` non scrive. Per togliere il ruolo si usa
`member`. Il ruolo nuovo vale dalla richiesta successiva: la sessione non
tiene cache nel cookie.

Le verifiche sono nei passi "moderazione" (`db/test/moderation.test.mts`:
l'API SQL, i rifiuti, la sospensione, il registro, gli script dei ruoli),
"moderazione (area admin)" (`moderation-admin.test.mts`: le letture di
`/admin`) e "moderazione (lato utente)" (`moderation-app.test.mts`: la
sospensione dalla sessione, /api/me, il form di Report), più
`clears-lib.test.mts` e `auth.test.mts` (ownComments, hiddenClearsOf,
input:false su role e suspendedUntil). `test:smoke` controlla che ogni URL
di `/admin` sia un 404 senza sessione e che la pagina in cache non abbia
niente di chi guarda.

## Le tip (migrazione 0025)

Consigli brevi dei giocatori, nella pagina di un evento, tra l'intestazione del tier e la lista dei clear. Una tip vale per tutto l'evento o per un tier (uno stage a una difficoltà, o un livello EZA): la FK composita `tip_tier_in_event` impedisce il tier di un altro evento. Sono le stesse in Global e Japan, perché gli stage non hanno regione.

- 10-500 caratteri di testo semplice (React lo mostra come testo, niente markdown) e al massimo un link https. Gli accorciatori sono rifiutati con la stessa tabella delle prove (`proof_host`); il provider (youtube, imgur...) viene da lì.
- Voto solo "Helpful" (+1, o 0 per ritirarlo): una tip sbagliata si segnala, non si vota giù. Niente voto sulla propria.
- Limiti: 10 tip e 30 modifiche all'ora (`clear_write_log`, kind `tip` e `tip_edit` di 0024), al massimo 3 tip vive per autore sullo stesso bersaglio, e la stessa tip due volte sullo stesso bersaglio no (`tip_no_duplicate`, maiuscole e spazi non contano).
- La modifica tiene i voti e mostra "edited". La cancellazione porta via voti e segnalazioni. Chi è sospeso non scrive, non modifica, non vota e non segnala, ma cancella le proprie tip (come i clear).
- Moderazione come clear e commenti: Report con i motivi di `report_reasons('tip')`, nessun nascondimento automatico, e da `/admin` "Hide tip" (`mod_set_tip_status`, che chiude le segnalazioni e scrive il registro), "Unhide" dalla scheda Hidden > Tips.
- La pagina in cache porta fino a 50 tip per gruppo e per ordine; "Show all" e Top/New lavorano nel browser, senza parametri nell'URL. I propri voti e le proprie tip arrivano da `/api/me` (`tier.tipVotes`, `tier.ownTips`, `tier.tipScores`).

Verbi SQL: `post_tip`, `edit_tip`, `delete_tip`, `vote_tip`; i rifiuti hanno un nome (`tip_*`) tradotto da `lib/tips/errors.ts`. Le verifiche sono nel passo "tip" (`db/test/tips.test.mts`).

## La pagina della carta

`/cards/<id>` è pubblica e in cache come le pagine evento: non legge mai la sessione. Le letture stanno in `lib/card-page.ts` (pure, provate da `db/test/card-page-ui.test.mts`), la cache in `lib/cache/cards.ts`: la carta con il tag `card:<id>` e `catalog`, i clear che la usano con `card:<id>` e `community`, che le scritture sui clear invalidano già. Al build si prerenderizzano al massimo 100 carte (le più usate nei clear); le altre nascono alla prima visita e poi restano in cache. L'id della forma Z (quello della base più uno) porta alla base con un 308; un id che non è una carta è un 404 vero. Le carte uscite solo in Giappone si aprono lo stesso, con "Not released on Global yet." e i clear della versione giapponese.

La pagina mostra le skill per livello (Base, EZA, Super EZA) e si apre sul livello più alto che la carta ha. Una sezione che il wiki non riscrive per l'EZA prende il testo del livello sotto, segnato "Unchanged from EZA". Seguono link skill con l'effetto, categorie, la catena del Dokkan Awakening, i 10 clear migliori che usano la carta (prova, voti, i più recenti) con "Used in N clears". Ogni clear porta alla pagina del suo tier dove si vede davvero: la pagina si calcola con lo stesso `ORDINE_CLEAR` della lista. In fondo c'è il link alla pagina del wiki da cui vengono i testi (CC BY-SA).

L'artwork parte sempre statico: è l'immagine che si vede subito, e chi non è entrato non scarica mai l'animato (in media 4 MB, circa 25 volte lo statico). Chi è entrato sceglie il default in Settings > Display > Artwork (`set_prefers_animated`, letto da `/api/me`). Movimento ridotto o risparmio dati riportano a statico un default "Animated", ma mai la scelta fatta su una carta. Quella scelta resta nel localStorage del dispositivo (`dts:card-art`, al massimo 200 carte), mai nel database. La logica sta in `lib/card-art.ts`.

I nomi delle carte nei clear portano alla pagina nella stessa scheda, senza prefetch (20 clear per 7 carte farebbero 140 prefetch a pagina). Dal builder, l'icona dello slot e il link sotto il picker aprono una scheda nuova, perché il builder non salva la bozza. La sitemap ha tutte le carte uscite su Global.

## La produzione: Vercel, Supabase, Cloudflare

Deciso: tutto sui piani gratuiti, senza carta da nessuna parte. Superare
una quota ferma un servizio invece di addebitarlo, e il codice è scritto
per non arrivarci.

- **App** su Vercel Hobby (`https://dokkants.emanuelemelini.dev`, CNAME su
  Cloudflare in "DNS only"), funzioni in `fra1` (`vercel.json`), accanto al
  database.
- **Database** su Supabase Free a Francoforte. A runtime `DATABASE_URL` è il
  pooler Supavisor in **transaction mode** (porta 6543); migrazioni e
  restore passano dalla connessione diretta o di sessione. Il codice non usa
  niente di legato alla sessione (SET, LISTEN, lock di sessione): i lock
  sono `pg_advisory_xact_lock`, dentro la transazione.
- **Immagini** su Cloudflare Pages (`https://dokkants-assets.emanuelemelini.dev`),
  caricate con `wrangler pages deploy public/assets`. `ASSET_BASE_URL` punta
  lì; il database non cambia.
- **Email** da Resend (`login@dokkants.emanuelemelini.dev`), con i record
  sul sottodominio `send.dokkants…` e `resend._domainkey.dokkants…`: non
  toccano l'Email Routing dell'apex.

**Cosa fa il codice per starci dentro.**

- `next.config.ts`: immagini **non ottimizzate**. Sono già webp piccoli, e
  l'ottimizzazione di Hobby ha 5000 trasformazioni al mese: con migliaia di
  carte finirebbero in pochi giorni (402 sulle immagini nuove). `<Image>`
  usa l'URL di `assetUrl()` così com'è. Nello stesso file gli header di
  sicurezza per tutte le rotte; HSTS solo in produzione. La CSP si limita a
  `frame-ancestors`, `base-uri` e `object-src`: una completa senza nonce non
  aggiungerebbe molto e rischierebbe i redirect OAuth.
- `lib/db-config.ts`: la pool in produzione ha al massimo 5 connessioni,
  chiude quelle inattive dopo 5 s e non aspetta una connessione più di
  10 s. **TLS verificato**: `DATABASE_CA_CERT` contiene il PEM del
  certificato radice di Supabase (Database Settings → SSL Configuration;
  vanno bene anche gli a capo scritti `\n`). Con la CA impostata i
  parametri `sslmode`/`sslrootcert` dell'URL si tolgono: pg-connection-string
  li farebbe vincere sull'opzione `ssl`, e un `?sslmode=require` copiato
  dalla dashboard spegnerebbe la verifica in silenzio. In produzione un
  database non locale senza CA è un errore all'avvio, non un TLS a metà.
- Pulizia giornaliera: su Vercel non c'è un processo che vive un giorno,
  quindi la fa **Vercel Cron** (`vercel.json`, ogni giorno alle 4 UTC, con
  un'ora di tolleranza su Hobby) chiamando `GET /api/cron/purge` con
  `Authorization: Bearer $CRON_SECRET`. Senza `CRON_SECRET` (almeno 16
  caratteri) la rotta risponde sempre 401. La stessa chiamata cancella le
  segnalazioni chiuse da più di 180 giorni (`purge_resolved_reports`). In
  locale resta il timer di `lib/auth/startup.ts`, che pulisce solo sessioni
  e token.
- Il limite per IP di better-auth legge l'IP da `x-vercel-forwarded-for`,
  scritto da Vercel: un header mandato dal client non lo sposta.
  `AUTH_IP_HEADERS` lo cambia (per esempio dietro un altro proxy).
- `robots.ts` e `sitemap.ts`: indicizzati gli eventi; fuori API, accesso,
  Settings, pagine di invio e le viste filtrate (`/events/browse`). La
  sitemap ha `/events` e tutti gli eventi, in cache per un giorno.
  **Il build legge il database** (solo SELECT): prerenderizza `/events`, la
  sitemap e fino a 100 eventi (sezione "Cache e budget CPU"), quindi
  `DATABASE_URL` deve rispondere anche durante il build.
  `robots.txt` è statico e prende l'URL da `BETTER_AUTH_URL` **al build**.
- `.vercelignore` lascia fuori `public/assets` (1,2 GB) e le cache
  dell'import: il build non ne ha bisogno.

Le variabili su Vercel, una per una, e tutti i passi della prima messa
online sono nella sezione seguente. Le prove: `npm run db:test` (passi
"configurazione di produzione" e "script di produzione").

## Cache e budget CPU

Vercel Hobby dà 4 ore di CPU attiva al mese, senza extra. Per questo le pagine pubbliche (`/events`, `/events/<id>/…`, `/cards/<id>`) non leggono mai né la sessione né la query string: sono prerender (ISR) che la CDN serve senza invocare funzioni. Chi è dentro costa una sola richiesta a `/api/me` per pagina; chi non è dentro, niente.

- **URL**: `/events` (statica) · `/events/browse?region=&type=&status=&q=&page=` (viste filtrate, dinamiche, noindex, escluse da `robots.txt`) · `/events/<id>` · `/events/<id>/japan` · `/events/<id>[/japan]/t/<tier>` · `…/t/<tier>/p/<n>` (n ≥ 2). Si costruiscono solo con `lib/urls.ts`. Un tier che non è dell'evento, `p/1` o una pagina oltre l'ultima sono 404. Su `next start` e su Vercel la prima visita a un URL non prerenderizzato riceve lo shell con 200 e il 404 nello stream (noindex); dalla seconda visita è un 404 vero, dalla cache. `/` porta a `/events` con un 307 (`next.config.ts`). Restano con la query string le pagine per utente: `/events/<id>/submit?tier=` (e `region=japan`) e `/events?account=deleted` dopo la cancellazione dell'account (l'avviso lo legge un'isola client).
- **Dati**: `lib/cache/data.ts` (`'use cache'` con `cacheLife` e `cacheTag`) avvolge `lib/queries.ts` e `lib/clears.ts`, che restano senza cache perché i test li importano fuori da Next. Tag: `catalog`, `events-list`, `community`, `event:<id>`, `card:<id>`, `profile:<handle>`. Lo stato degli eventi (Ongoing/Ended) scade al prossimo inizio o fine di una run (minimo 5 minuti).
- **Invalidazione** (`lib/cache/invalidate.ts`): invio, revisione, cancellazione e commento rigenerano subito l'evento (`updateTag`); il voto lo segna vecchio senza rigenerare (`revalidateTag` `'max'`): gli altri vedono il voto dopo una visita, chi vota lo vede subito da `/api/me`. Mai `revalidatePath('/', 'layout')`.
- **Chi guarda**: il cookie `dts_signed_in=1` (non segreto, non httpOnly) lo mette better-auth a ogni accesso e lo toglie l'uscita; solo con lui il browser chiama `/api/me` (private, no-store). Header, voto, Edit/Delete, commenti e invio sono isole client (`components/viewer`).
- **Import**: in produzione `db/prod/update.mjs` chiama `POST /api/revalidate` (Bearer `CRON_SECRET`, la stessa variabile del cron; serve anche `PROD_SITE_URL`, da mettere in `~/.config/dokkants/prod.env` per la routine a mano). In locale `db:import`, `db:refresh` e `db:demo` finiscono con `npm run cache:clear`; dopo una modifica a mano con psql lancialo tu, altrimenti `next dev` mostra i dati vecchi fino al riavvio. In `next dev` senza `CRON_SECRET` la rotta è aperta.
- **Build**: legge il database (solo SELECT): fino a 100 eventi Global in corso o in arrivo, fino a 100 carte (le più usate nei clear), `/events` e la sitemap (tutti gli eventi e le carte uscite su Global). Se Supabase Free è in pausa, il build fallisce. Ogni deploy riparte con la cache vuota.
- **Misure** (`test/cpu.sh` su `next start` locale, 200 richieste per classe, ms di CPU per richiesta):

  | classe | prima (ogni pagina dinamica) | dopo | dopo, NEXT_CACHE_MEMORY=0 |
  |---|---|---|---|
  | /events | 8,50 | 1,65-1,85 (HIT) | 2,55 |
  | pagina evento (20 id) | 6,10 | 1,40 (HIT) | 16,45 |
  | pagina tier (16) | 5,45 | 1,30-1,85 (HIT) | 27,75 |
  | /events/browse | 7,85 | 12-16 (dinamica) | 12,55 |
  | /api/cards | 1,50 | 1,2-2,2 | 1,30 |

  In locale anche una pagina in cache passa da Node (circa 1,5 ms); su Vercel esce dalla CDN e costa zero. La colonna NEXT_CACHE_MEMORY=0 è il caso peggiore: in locale le pagine generate a richiesta non restano, su Vercel stanno nella cache ISR durevole. Dopo il deploy: Vercel Observability → Functions (CPU attiva per rotta) e la pagina Usage (invocazioni, scritture ISR).
- **Come misurare**: `npm run build`; `NODE_ENV=production NEXT_PRIVATE_DEBUG_CACHE=1 npx next start -p 3100 > /tmp/next.log 2>&1 &`; `CPU_URL=http://localhost:3100 CPU_LOG=/tmp/next.log npm run test:cpu`. In locale servono anche `RESEND_API_KEY` ed `EMAIL_FROM` finti, e `VERCEL=1` per non fare la pulizia delle sessioni su `dokkan_dev`.

Le prove: `npm run db:test` (passi "URL degli eventi" e "cache: tag e /api/revalidate") e `npm run test:smoke`, che con `SMOKE_EXPECT_CACHE=1` contro `next start` controlla anche che la seconda visita a `/events`, a un evento e a una carta sia un `x-nextjs-cache: HIT`.

## Messa online

La prima volta, in quest'ordine: ogni passo usa qualcosa del precedente.
Tutto si fa dal tuo Mac; nessuno script crea account o pubblica da solo.
Gli script contro la produzione chiedono sempre `--yes`: senza, stampano
il bersaglio (host, database, utente, mai la password) e si fermano.

**Prima di cominciare.** Committa il lavoro e porta il branch su `main`:
Vercel pubblica in produzione da lì. Le cache dell'import
(`db/import/.cache`) e le immagini (`public/assets`) devono essere sul
disco: `npm run db:fetch` e `npm run db:assets` se mancano.

### a) Git: il repository non ha ancora un remote

**Opzione A, consigliata: GitHub privato + integrazione Git di Vercel.**
Ogni push su `main` diventa un deploy di produzione, con lo storico e il
rollback a un clic.

1. Su github.com crea un repository **privato** vuoto (niente README né
   .gitignore), per esempio `DokkanTeamSharing`.
2. Dal progetto:
   ```bash
   git remote add origin git@github.com:EmanueleMelini/DokkanTeamSharing.git
   git push -u origin main
   ```
   `public/assets`, `.env*`, le cache e `backups/` sono in `.gitignore`:
   controlla con `git status` che non ci sia niente di segreto prima del
   primo push.
3. Su Vercel (piano Hobby, account personale: un team Hobby non si collega
   ai repository di un'organizzazione GitHub) **Add New → Project → Import
   Git Repository**, e dai all'app GitHub di Vercel accesso **solo** a quel
   repository. Il progetto lo finisci al passo (f): al primo import il build
   fallisce perché mancano le variabili, ed è normale.
4. In **Settings → Git → Ignored Build Step** scegli "Only build
   production". Senza, ogni branch fa un deploy di anteprima: consuma la
   quota di build e, con le variabili di produzione, parlerebbe con il
   database vero.

**Opzione B: deploy dalla CLI di Vercel, senza remote.** Va bene per
provare; non c'è storico dei deploy legato ai commit.

```bash
npx vercel login
npx vercel link            # crea o collega il progetto (cartella .vercel/, ignorata)
npx vercel --prod          # build su Vercel e pubblicazione
```

La CLI carica la cartella del progetto: `.vercelignore` lascia fuori
`public/assets` e le cache, altrimenti si fermerebbe al limite di 100 MB e
15.000 file. Ogni nuova versione è un altro `npx vercel --prod`.

### b) Supabase: il database

1. Su supabase.com crea un'organizzazione (piano Free) e un progetto:
   nome `dokkants`, regione **Central EU (Frankfurt)**, `eu-central-1`.
   La password del database generala lunga e salvala nel password manager.
   Se il modulo chiede quali connessioni userai, scegli **solo la
   connection string**: la Data API non ci serve (sotto il perché).
2. **Spegni la Data API** se è accesa (Project Settings → Data API). Supabase
   espone lo schema `public` via REST ai ruoli `anon` e `authenticated`, e
   la chiave anon è pubblica per definizione: senza RLS chiunque leggerebbe
   `auth_session` e le email. Il sito non la usa. `prod:setup` toglie
   comunque ogni privilegio su `public` a quei ruoli (`db/prod/harden.mjs`).
   Il Security Advisor continuerà a segnalare "RLS disabled": è atteso, le
   tabelle non sono raggiungibili da lì.
3. In **Project Settings → Database → SSL Configuration** scarica il
   certificato (`prod-ca-2021.crt`) e attiva "Enforce SSL". Tienilo **fuori
   dal repository**, per esempio in `~/.config/dokkants/prod-ca-2021.crt`.
4. Dal bottone **Connect** in alto prendi due stringhe (la password al posto
   di `[YOUR-PASSWORD]`; se contiene caratteri come `@` `/` `:` va
   percent-encoded):
   - **Transaction pooler**, porta **6543**
     (`postgresql://postgres.<ref>:<password>@aws-…-eu-central-1.pooler.supabase.com:6543/postgres`):
     è il `DATABASE_URL` dell'app su Vercel. Le funzioni serverless aprono
     e chiudono connessioni di continuo, e il pooler le regge.
   - **Session pooler**, porta **5432**, stesso host: è il
     `PROD_DATABASE_URL` degli script sul tuo Mac (migrazioni, import,
     backup). Le migrazioni e `pg_dump` vogliono una sessione vera, e gli
     script rifiutano la porta 6543. La connessione **diretta**
     (`db.<ref>.supabase.co`) sul piano Free è solo IPv6: va bene al suo
     posto solo se la tua rete ha IPv6.
5. Prepara un file con le variabili, fuori dal repository e leggibile solo
   da te, così la password non finisce nella history della shell:
   ```bash
   mkdir -p ~/.config/dokkants && chmod 700 ~/.config/dokkants
   cat > ~/.config/dokkants/prod.env <<'X'
   PROD_DATABASE_URL='postgresql://postgres.<ref>:<password>@aws-…-eu-central-1.pooler.supabase.com:5432/postgres'
   PROD_DATABASE_CA_CERT="$HOME/.config/dokkants/prod-ca-2021.crt"
   PROD_SITE_URL='https://dokkants.emanuelemelini.dev'
   CRON_SECRET='<lo stesso di Vercel, passo f>'
   X
   chmod 600 ~/.config/dokkants/prod.env
   ```
   e in ogni terminale dove lanci gli script `prod:*`:
   `set -a; . ~/.config/dokkants/prod.env; set +a`.

Con `PROD_DATABASE_CA_CERT` gli script si collegano con
`sslmode=verify-full` su quella CA (e tolgono un eventuale `sslmode=require`
copiato dalla dashboard). Senza CA un database remoto si rifiuta: niente
TLS non verificato verso la produzione.

### c) Il database: `prod:setup`

```bash
set -a; . ~/.config/dokkants/prod.env; set +a
npm run prod:setup              # stampa bersaglio e passi, non tocca niente
npm run prod:setup -- --yes     # migrazioni, harden, import completo
```

Fa: `db/migrate.mjs` (le 21 migrazioni), `harden.mjs`, poi l'import dalle
cache locali nell'ordine di `db/prod/pipeline.mjs`: carte, carte dal
gioco, eventi, datamine, **righe delle immagini** (`fetch-assets
--offline`: le ricava dai file in `public/assets`, non scarica niente),
eventi dal gioco, finestre, missioni, equipaggiamento. Niente fixture,
niente demo, nessun reset, nessun utente. Le immagini stanno prima degli
eventi del gioco e delle missioni perché le copertine preferiscono le carte
con miniatura e le icone dei premi si agganciano per nome: così il primo
giro dà lo stesso risultato del secondo.

Gli script rifiutano `localhost`, `127.0.0.1`, `::1` e ogni database che
finisce in `_dev` o `_test` (`--allow-local` serve solo alla simulazione
qui sotto), e non leggono mai `DATABASE_URL` né `.env.local`: lanciano gli
importer con `DOKKAN_ENV_FILES=off` (vedi `db/env.mjs`) e senza le
variabili `PG*`. Si può rilanciare: le migrazioni applicano solo le
pendenti e gli importer sono idempotenti. È anche il comando per le
**migrazioni nuove**: `prod:update` non cambia lo schema.

La simulazione, fatta l'8 ottobre 2026 su un database locale
`dokkan_prodsim` poi cancellato: `prod:setup` in **9 secondi**, con conteggi e
contenuto dei dati di gioco identici a `dokkan_dev`: 2697 carte, 792
eventi, 8372 stage e 9892 difficoltà, 1747 finestre, 7720 missioni con
13.322 premi, 8857 sfere con 8857 regole, 6246 righe in `asset` (riprese
tutte dal disco; 45 immagini mancano anche in sviluppo); 0 utenti, 0
sessioni, 0 clear, 0 squadre. Due `prod:update` di fila non hanno cambiato
una riga, e `prod:backup` ha scritto 1,5 MB compressi, ripristinati poi su
un database vuoto con gli stessi conteggi.

### d) Le immagini: Cloudflare Pages

1. `npx wrangler login` (una volta: apre il browser sull'account
   Cloudflare che ha la zona `emanuelemelini.dev`).
2. Crea il progetto, di tipo Direct Upload:
   `npx wrangler@4.148.0 pages project create dokkants-assets --production-branch main`
   (o dalla dashboard: Workers & Pages → Create → Pages → Upload assets,
   nome `dokkants-assets`).
3. `npm run assets:deploy` conta i file e controlla i limiti; `npm run
   assets:deploy -- --yes` pubblica. Lo script scrive prima
   `public/assets/_headers` (`Cache-Control: public, max-age=31536000,
   immutable` e `nosniff` per tutto), poi lancia
   `npx wrangler@4.148.0 pages deploy public/assets --project-name dokkants-assets --branch main`.
   Wrangler carica solo i file nuovi o cambiati, quindi i deploy dopo il
   primo sono rapidi.
4. Nel progetto Pages, **Custom domains → Set up a custom domain →
   `dokkants-assets.emanuelemelini.dev`**. La zona è sullo stesso account,
   quindi Cloudflare crea da solo il CNAME, **proxied** (qui l'arancione è
   giusto: è Cloudflare stesso a servire i file). Aspetta "Active".

I limiti del piano Free, per deploy: **20.000 file** e **25 MiB per file**;
500 deploy al mese; banda e richieste dei file statici senza limite.
Oggi: **6246 file** (1,31 GB), il più grande
`cards/1026900/art-animated.webp` da **10,0 MiB**. Lo script si ferma prima
di wrangler se uno dei due limiti verrebbe superato, e dice quale file.
Il prezzo di `immutable`: un'immagine riscaricata sotto la stessa chiave
(con `db:assets --force`) arriva a chi l'aveva già vista solo quando la sua
cache scade. Le chiavi però non cambiano di significato, quindi succede
quasi mai.

### e) L'email: Resend

1. Su resend.com (piano Free) **Domains → Add Domain →
   `dokkants.emanuelemelini.dev`**, regione `eu-west-1` (Irlanda).
2. Resend mostra tre record (o li scrive lui con "Sign in to Cloudflare").
   Nel DNS di Cloudflare, zona `emanuelemelini.dev`, i nomi sono relativi
   alla zona:
   | Tipo | Nome | Valore |
   | --- | --- | --- |
   | MX | `send.dokkants` | `feedback-smtp.eu-west-1.amazonses.com`, priorità 10 |
   | TXT | `send.dokkants` | `v=spf1 include:amazonses.com ~all` |
   | TXT | `resend._domainkey.dokkants` | la chiave DKIM che mostra Resend |

   Copia i valori dalla pagina di Resend, non da qui. Tutti **DNS only**
   (MX e TXT non si possono comunque proxare). Facoltativo ma consigliato
   un DMARC per il sottodominio: TXT `_dmarc.dokkants` con
   `v=DMARC1; p=none;`.
3. Aspetta "Verified", poi **API Keys → Create** con permesso **Sending
   access** limitato a quel dominio: è `RESEND_API_KEY`.

**Perché non tocca l'Email Routing dell'apex.** Email Routing (quello che
riceve `privacy@emanuelemelini.dev`) vive sui record **dell'apex**: gli MX
`route*.mx.cloudflare.net` e il TXT SPF di `emanuelemelini.dev`, che la
dashboard blocca. I record di Resend stanno su nomi diversi
(`send.dokkants…`, il dominio di ritorno per i bounce, e
`resend._domainkey.dokkants…`), e su `dokkants` stesso non c'è nessun MX:
si spedisce da lì, non si riceve. Niente si sovrappone, e l'SPF dell'apex
resta quello di Cloudflare.

### f) Vercel: il progetto e le variabili

1. Il progetto importato al passo (a): framework Next.js, comandi di
   default. La regione delle funzioni è già in `vercel.json` (`fra1`,
   accanto a Supabase): controlla in Settings → Functions che dica
   Frankfurt.
2. **Settings → Environment Variables**, ambiente **Production** (sono
   disponibili anche al build):

   | Variabile | Cosa metterci |
   | --- | --- |
   | `DATABASE_URL` | la stringa del **Transaction pooler** (porta 6543); serve anche al build, che legge gli eventi da prerenderizzare |
   | `DATABASE_CA_CERT` | il contenuto di `prod-ca-2021.crt`, PEM intero (vanno bene anche gli a capo scritti `\n`) |
   | `BETTER_AUTH_URL` | `https://dokkants.emanuelemelini.dev` (serve anche al build: `robots.txt` è statico) |
   | `BETTER_AUTH_SECRET` | **nuovo**, non quello di sviluppo: `openssl rand -base64 32` |
   | `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | l'app Discord di sempre |
   | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | il client Google **di produzione** |
   | `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` | l'applicazione Twitch **di produzione** |
   | `RESEND_API_KEY` | la chiave del passo (e) |
   | `EMAIL_FROM` | `Dokkan Team Sharing <login@dokkants.emanuelemelini.dev>` |
   | `ASSET_BASE_URL` | `https://dokkants-assets.emanuelemelini.dev` (senza `/` finale) |
   | `CRON_SECRET` | `openssl rand -hex 32` (almeno 16 caratteri, o la rotta risponde sempre 401) |
   | `AUTH_IP_HEADERS` | **non impostarla**: su Vercel il limite per IP legge già `x-vercel-forwarded-for` |

   Senza `RESEND_API_KEY` o `EMAIL_FROM` il server non parte; senza
   `DATABASE_CA_CERT` la pool rifiuta il database remoto. Un provider senza
   le sue due variabili semplicemente non compare tra i bottoni.
3. **Sposta i segreti di produzione da `.env.local`.** Le coppie Google e
   Twitch `# PROD` commentate lì vanno incollate su Vercel e poi
   **cancellate** dal file: `.env.local` deve contenere solo lo sviluppo, e
   un segreto di produzione su disco è un segreto in più da proteggere.
4. **Settings → Domains → Add `dokkants.emanuelemelini.dev`.** Vercel mostra
   il CNAME da usare (un valore tipo `….vercel-dns-0xx.com`). Su
   Cloudflare: record **CNAME** `dokkants` → quel valore, **DNS only**
   (nuvola grigia): Vercel sconsiglia un proxy davanti, e il certificato lo
   emette lui. Aspetta che il dominio risulti valido.
5. **Deployments → Redeploy** (o un push su `main`, o `npx vercel --prod`):
   ora il build ha le variabili.

### g) Le console OAuth

I callback di produzione stanno **accanto** a quelli di sviluppo
(`http://localhost:3000/api/auth/callback/<provider>`), non al loro posto.

- **Discord** (discord.com/developers, la stessa app → OAuth2 → Redirects):
  aggiungi `https://dokkants.emanuelemelini.dev/api/auth/callback/discord`.
- **Google** (console.cloud.google.com, Google Auth Platform):
  - **Clients → Create client**, tipo Web application, nome "produzione":
    Authorized JavaScript origins `https://dokkants.emanuelemelini.dev`,
    Authorized redirect URIs
    `https://dokkants.emanuelemelini.dev/api/auth/callback/google`.
  - **Branding**: app home page `https://dokkants.emanuelemelini.dev`,
    privacy policy `https://dokkants.emanuelemelini.dev/privacy`, terms of
    service `https://dokkants.emanuelemelini.dev/terms`, authorized domain
    `emanuelemelini.dev`.
  - **Audience → Publish app**, da Testing a **In production**: in Testing
    entrano solo 100 utenti di prova e le autorizzazioni scadono dopo 7
    giorni. Gli scope sono solo `openid email profile`, quindi non serve
    la verifica dell'app (quella del brand è facoltativa: chiede il dominio
    verificato in Search Console, e senza il logo non compare).
- **Twitch** (dev.twitch.tv/console → Register Your Application, una
  nuova per la produzione): categoria Website Integration, client
  Confidential, OAuth Redirect URL
  `https://dokkants.emanuelemelini.dev/api/auth/callback/twitch`.

### h) Il primo deploy: cosa controllare

- [ ] `https://dokkants.emanuelemelini.dev` porta a `/events`, e una
      pagina evento si apre con stage, finestre e missioni.
- [ ] Le immagini arrivano da `dokkants-assets.emanuelemelini.dev`
      (DevTools → Network, o il "Copy image address" di una carta), e
      `curl -sI https://dokkants-assets.emanuelemelini.dev/icons/rarity/UR.webp`
      risponde 200 con `cache-control: public, max-age=31536000, immutable`.
- [ ] `curl -sI https://dokkants.emanuelemelini.dev/events` ha
      `strict-transport-security`, `x-frame-options: DENY` e niente
      `x-powered-by`.
- [ ] Si entra con **Discord**, con **Google** e con **Twitch** (un
      account per provider, o un account con i tre collegati da Settings).
- [ ] Il **magic link** arriva (Resend → Emails mostra "Delivered"), si
      apre e porta a `/welcome` per scegliere l'handle.
- [ ] `/robots.txt` indica la sitemap di `dokkants.emanuelemelini.dev`,
      esclude `/events/browse`, e `/sitemap.xml` elenca gli eventi.
- [ ] **La cache**: un secondo `curl -sI` di `/events` e di una pagina
      evento risponde con `x-vercel-cache: HIT` (o `STALE`), e
      `/api/me` senza cookie dà `{"user":null}` con `cache-control`
      `private, no-store`. Anche `SMOKE_URL=https://dokkants.emanuelemelini.dev
      npm run test:smoke` passa (solo GET; senza `SMOKE_EXPECT_CACHE`,
      che legge `x-nextjs-cache` di `next start` e non l'header di Vercel).
- [ ] **Il cron**: Settings → Cron Jobs mostra `/api/cron/purge` alle 4
      UTC; "Run" lo lancia subito, e nei log della funzione la risposta è
      200 con `{"purged":n,"reports":m}`. Da fuori, `curl -i
      https://dokkants.emanuelemelini.dev/api/cron/purge` deve dare 401.
- [ ] Supabase → Table Editor: `app_user` ha solo gli account delle prove.
- [ ] **Il primo admin**: dopo aver scelto l'handle sul sito,
      `npm run prod:role -- <handle> admin --yes` (sezione "Moderazione").
      Alla richiesta dopo l'header mostra Moderation e `/admin` risponde.

### i) La routine

**Ogni settimana** (il datamine si aggiorna di settimana in settimana):

```bash
npm run db:fetch -- --fresh     # wiki + datamine nuovo (--fresh va a fetch-datamine)
npm run db:import               # prima sullo sviluppo: si guarda che torni
npm run db:assets               # scarica le immagini nuove in public/assets
npm run assets:deploy -- --yes  # le pubblica, PRIMA che il database le citi
set -a; . ~/.config/dokkants/prod.env; set +a
npm run prod:backup -- --yes    # la copia prima di scrivere
npm run prod:update -- --yes    # solo l'import, dalle cache appena scaricate
```

`prod:update` controlla prima che lo schema sia aggiornato (se ci sono
migrazioni nuove, chiede `prod:setup`) e poi rifà la stessa fila di
`prod:setup`, migrazioni escluse. Un secondo giro non cambia niente.
Alla fine chiede al sito di rinfrescare le pagine (`POST /api/revalidate`
con `PROD_SITE_URL` e `CRON_SECRET`); senza le due variabili lo salta, e
le pagine si aggiornano solo alla scadenza della cache o al deploy dopo.

**I backup.** Supabase Free non ne fa. `prod:backup` usa `pg_dump` dello
schema `public` (con le estensioni) in `backups/<ora UTC>.sql.gz` e tiene
le ultime 8 copie. Il `pg_dump` deve essere almeno della versione del
server: lo script prende quello di Postgres.app della stessa versione se
c'è, altrimenti uno più nuovo, e si ferma se non ne trova (Postgres.app
installa più versioni affiancate; `PG_DUMP=/percorso/pg_dump` ne indica
uno). Supabase crea i progetti nuovi su una versione più recente della 15
di questo Mac: controlla in Settings → Infrastructure. Per ripristinare su
un database vuoto (un progetto Supabase nuovo, o uno locale):

```bash
gunzip -c backups/<copia>.sql.gz \
  | sed -e '/^CREATE SCHEMA public;$/d' -e '/^COMMENT ON EXTENSION /d' \
  | psql -X -q -v ON_ERROR_STOP=1 "<url di sessione del database vuoto>"
```

Le due righe tolte sono le sole che falliscono su un database che ha già
lo schema `public` e le estensioni di qualcun altro. Provato in locale: il
ripristino dà gli stessi conteggi, funzioni, trigger e indici.

**Quando una quota finisce.** Nessun servizio ha una carta: si ferma, non
addebita.

| Servizio | Quota Free | Cosa succede | Dove guardare |
| --- | --- | --- | --- |
| Vercel Hobby | 1M invocazioni, 4 ore di CPU attiva, 100 GB di traffico al mese | la funzione si ferma (fino a 30 giorni) e il sito dà errore | Dashboard → Usage |
| Supabase Free | 500 MB di database (oggi ~56 MB), 5 GB di egress | oltre lo spazio il database passa in sola lettura; dopo 7 giorni senza attività il progetto va in pausa (il cron quotidiano lo tiene sveglio) | Organization → Usage, e le email di Supabase |
| Cloudflare Pages | 500 deploy al mese, 20.000 file | il deploy viene rifiutato; i file già pubblicati restano | Workers & Pages → il progetto |
| Resend Free | 100 email al giorno, 3000 al mese | le email in più falliscono: il magic link non arriva, i provider OAuth continuano a funzionare | Resend → Usage ed Emails |

Il segnale da tenere d'occhio nella prima settimana è la CPU attiva di
Vercel: le pagine pubbliche escono dalla cache (sezione "Cache e budget
CPU"), ma `/events/browse`, l'accesso, Settings e l'invio passano sempre
dal server, bot compresi.

### j) L'aggiornamento settimanale automatico (GitHub Actions)

`.github/workflows/weekly-data.yml` fa da solo la routine del punto i), ogni venerdì alle 03:17 UTC (il datamine di solito arriva mercoledì o giovedì):

1. riscarica wiki e datamine. Il datamine con `--strict`: commit noto e tutte le tabelle, altrimenti si ferma. Se il wiki non risponde usa la cache della settimana prima e lo scrive nel riepilogo;
2. `db/prod/sanity.mjs` confronta con la cache precedente: pagine del wiki calate di oltre il 2% o un CSV sotto il 90% fermano tutto;
3. `db/prod/last-run.mjs`: se commit del datamine e contenuto del wiki sono quelli dell'ultimo import riuscito (tabella `import_run`, migrazione 0023), "Nothing new" e fine;
4. un `pg_dump` della produzione (`db/prod/dump.mjs`), cifrato con age per la tua chiave pubblica e caricato come artifact `prod-backup-<data>` (14 giorni). Il dump in chiaro non lascia mai il runner: il repository è pubblico;
5. il giro di prova: il dump ripristinato in un Postgres 17 dentro il runner (`db/prod/rehearsal.mjs`), poi `node db/migrate.mjs --check` (se la produzione è indietro si ferma: le migrazioni restano `prod:setup` a mano), poi lo stesso `prod:update` con `--allow-local`;
6. `db/prod/snapshot.mjs` prima e dopo, e `db/prod/compare.mjs` con `db/prod/limits.json`: le tabelle degli utenti devono restare identiche (sempre, nessuna eccezione) e ogni tabella di gioco ha un tetto alle righe tolte. Una violazione ferma il job prima della produzione;
7. le immagini nuove: chiede al wiki solo quelle senza riga (`fetch-assets --missing`). Un 403 della CDN del wiki diventa un avviso e non si ritenta. Se ne arriva almeno una, `db/prod/mirror-assets.mjs` ricostruisce l'albero completo dalla nostra CDN (ogni file verificato con sha256), ci aggiunge le nuove e lo pubblica su Pages. Un deploy di Pages è una fotografia intera: mai solo i file nuovi;
8. `prod:update` sulla produzione con le stesse cache, poi un confronto con il giro di prova (avvisa soltanto: nel frattempo gli utenti scrivono). Alla fine `prod:update` chiama `POST /api/revalidate` del sito (sezione "Cache e budget CPU");
9. il riepilogo del job: cambiamenti per tabella, eventi e carte nuovi, immagini, "Needs attention", limiti.

**Da configurare una volta**, nelle Settings del repository su GitHub:

- Environments → `production`, con Deployment branches "Selected branches" = `main`. Secret dell'environment (non del repository):
  - `PROD_DATABASE_URL`: il pooler di **sessione** (`aws-0-eu-central-1.pooler.supabase.com:5432`, utente `postgres.<ref>`). L'host diretto `db.<ref>.supabase.co` è solo IPv6, e i runner di GitHub non hanno IPv6;
  - `PROD_DATABASE_CA_CERT_PEM`: il contenuto del `.crt` di Supabase;
  - `CLOUDFLARE_API_TOKEN`: un token con solo Account → Cloudflare Pages → Edit;
  - `CRON_SECRET`: lo stesso di Vercel, per rinfrescare le pagine dopo l'import.
- Variables: `CLOUDFLARE_ACCOUNT_ID`, `CF_PAGES_PROJECT` (`dokkants-assets`), `ASSET_BASE_URL` (`https://dokkants-assets.emanuelemelini.dev`), `PROD_SITE_URL` (`https://dokkants.emanuelemelini.dev`), `BACKUP_AGE_RECIPIENT`, `WEEKLY_APPLY` (`false` all'inizio).
- La chiave age, sul Mac: `brew install age`, poi `age-keygen -o ~/.config/dokkants/backup.agekey` e `chmod 600` sul file. La riga `# public key: age1...` va in `BACKUP_AGE_RECIPIENT`. La chiave privata resta solo da te (tienine una copia sicura: senza, i backup non si aprono).
- Settings → Notifications → Actions: "Only notify for failed workflows". GitHub scrive a chi ha modificato per ultimo la riga del cron.

**Le prime settimane** `WEEKLY_APPLY=false`: il cron fa solo la prova. Leggi 2-3 riepiloghi e aggiusta `limits.json` se serve. Prima di accendere, controlla che i file su Pages siano esattamente quelli della tabella `asset`: un file su Pages senza riga sparirebbe al primo deploy fatto dalla CI. Poi metti `WEEKLY_APPLY=true`. A mano: Actions → Weekly data update → Run workflow. `dry_run` è acceso per difetto; spento, applica davvero anche con `WEEKLY_APPLY=false`.

**Limiti superati.** Il job si ferma e il riepilogo dice tabella, righe tolte e tetto. Se le cancellazioni sono giuste (il gioco ha davvero tolto quegli eventi), rilancia a mano con `allow_deletions`: vale per i dati di gioco, mai per quelli degli utenti. Un tetto con numero e percentuale vale per il più stretto dei due; la regola `"*"` (almeno il 97% delle righe) vale per le tabelle senza un limite proprio. `force` rifà tutto anche senza novità, `skip_wiki` usa il wiki in cache.

**Aprire un backup.** Scarica l'artifact `prod-backup-<data>`: contiene `<nome>.dump.age` e `<nome>.dump.extensions.json` (solo gli schemi delle estensioni, nessun dato). Nella stessa cartella:

```bash
age -d -i ~/.config/dokkants/backup.agekey -o <nome>.dump <nome>.dump.age
createdb dokkan_restore_test
DATABASE_URL=postgres://localhost/dokkan_restore_test node db/prod/rehearsal.mjs --dump <nome>.dump
```

`rehearsal.mjs` accetta solo un database locale e vuoto: ricrea le estensioni negli schemi della produzione e lancia `pg_restore`, che deve essere almeno della versione del server (Postgres.app 17 se Supabase è sulla 17, oppure `PG_RESTORE=/percorso/pg_restore`). Il dump contiene email e sessioni: cancella la copia in chiaro quando hai finito.

**In locale** ci sono gli stessi pezzi: `npm run prod:snapshot -- --out a.json`, `npm run prod:compare -- a.json b.json`, `npm run prod:sanity`. `npm run prod:mirror-assets -- --from https://dokkants-assets.emanuelemelini.dev --to public/assets` rifà le immagini su una macchina nuova scaricandole dalla CDN, e riprende da dove si era fermato.

**Cosa può andare storto.**
- Il wiki blocca l'API anche dai datacenter: si usa la cache. Se non c'è un giro riuscito da più di 30 giorni l'artifact è scaduto e il job fallisce.
- Il cron di un repository pubblico si spegne dopo 60 giorni senza commit: GitHub avvisa per email, e un commit lo riaccende.
- Un `prod:update` dal Mac mentre gira la CI viene rifiutato da `import_run`. Un giro rimasto "running" per più di 2 ore si considera morto.

## Cosa manca, in ordine

1. **Il calendario, da tenere vivo.** Rifare il datamine con `--fresh`
   ogni settimana, poi `db:game-events` e `db:windows`: gli eventi nuovi
   arrivano da lì, il wiki non ne scrive più. In produzione lo fa il
   workflow settimanale (Messa online, punto j), da accendere con
   `WEEKLY_APPLY=true` dopo le prime prove. Japan resta senza finestre
   vere, e 374 eventi Global restano "attivi, fine non nota" (312 del wiki,
   62 del gioco). Le corse di un'area riaperta dopo più di un mese partono
   dall'ultimo blocco: la corsa di prima non ha una run del gioco sua.
2. **Gli eventi del gioco, da completare.** Non hanno descrizione né banner
   (nessuna fonte: il datamine ha solo i percorsi dei file, il wiki non li
   carica più), e 19 non hanno nemmeno la copertina, perché il boss è una
   carta senza pagina sul wiki. Restano fuori, elencati da
   `load-game-events`: i due archivi (1737 Ultimate Red Zone, 1738 Supreme
   Magnificent Battle, che andrebbero modellati come finestre permanenti
   delle edizioni che contengono), le aree 710/720 della Super Battle Road
   (due aree per 15 pagine del wiki), l'area 807 (categoria 27, tipo ignoto)
   e i capitoli della storia. Le edizioni RE e le Super EZA non sono ancora
   collegate al loro originale nell'interfaccia (il dato per le Super c'è:
   `related_game_id`). La fusione di un evento del gioco con una pagina del
   wiki scritta dopo è a mano.
3. **Le carte senza pagina sul wiki.** 59 unità Global giocabili non sono
   nella tabella `card` (42 uscite fra agosto e settembre 2026, più copie
   riemesse e secondi id): niente epiteto, niente immagini. Sono anche i
   boss che mancano nelle copertine. E le immagini delle 19 carte nuove di
   ottobre aspettano il CDN del wiki, che oggi risponde 403.
4. **Le missioni, da mostrare e da completare.** Ci sono (7720, con i
   premi), manca la sezione nella pagina evento. Restano fuori le missioni
   Burst Mode degli archivi (serve una tabella `genkai_battles` che il
   datamine non esporta), i piani 61+ della Extreme Super Battle Road (il
   wiki non ha la pagina, e un evento del gioco per loro non c'è ancora) e
   le campagne su più eventi. Japan non ha missioni: il datamine è Global.
   Solo 45 oggetti su 1677 hanno un'icona; le altre aspettano il CDN del
   wiki o le immagini del gioco.
5. **L'invio, da rifinire.** Le pagine ci sono (sotto). Mancano la storia
   delle versioni nella pagina (`getClearVersions` è pronta), un modo di
   riusare le proprie squadre invece di ricomporle, e la ricerca delle
   carte per chi gioca la versione giapponese (il picker mostra solo le
   uscite Global; il builder accetta qualsiasi carta).

## Nota su Next.js

La versione installata è più recente della documentazione che gira in giro:
`AGENTS.md` indica di leggere `node_modules/next/dist/docs/` prima di
scrivere codice applicativo. Vale la pena dargli retta.

## Licenza e attribuzione

Dati delle carte dal [Dragon Ball Z Dokkan Battle Wiki](https://dbz-dokkanbattle.fandom.com)
su Fandom, disponibili con licenza CC BY-SA.

DRAGON BALL Z Dokkan Battle © BIRD STUDIO / SHUEISHA, TOEI ANIMATION —
© BANDAI NAMCO Entertainment Inc. Sviluppato da Akatsuki Inc.

Questo progetto ha fine puramente informativo e non è affiliato, associato,
autorizzato né approvato in alcun modo da BANDAI NAMCO Entertainment,
Akatsuki, Toei Animation, Shueisha o Bird Studio.
