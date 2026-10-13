# Dokkan Team Sharing

Un indice di clear per Dragon Ball Z Dokkan Battle: per ogni evento, i team
che l'hanno chiuso davvero — con build, rotazioni e una prova.

La cosa che nessun altro sito fa non è il database eventi né il team builder:
quelli esistono già e sono presidiati bene. È **l'aggancio fra un clear e
l'evento che ha chiuso**, in forma di dato interrogabile. L'analisi che porta
a questa conclusione sta in `docs/`.

## Stato

Lo strato database è completo e verificato, con le carte, gli eventi e le
missioni veri. Sopra c'è il sito, pronto per la messa online: le pagine
degli eventi (con le missioni e i filtri della lista dei clear), gli
account, il builder con cui si inviano i clear, la moderazione
(segnalazioni e `/admin`), le tip dei giocatori nella pagina evento, la
pagina di ogni carta (`/cards/<id>`), il profilo pubblico di ogni
giocatore (`/users/<handle>`), il marchio con le icone, undici temi e la
versione del sito, Global o Japan, scelta una volta per tutte le pagine.
Manca solo quello che va fatto a mano (sezione "Cosa manca, in ordine").
I numeri sono quelli di `dokkan_dev` al 9 ottobre 2026; schema e verifiche anche di `dokkan_test`.

- **68 tabelle, 4 view, 15 trigger, 81 funzioni** su PostgreSQL 15, in 27
  migrazioni
- **2697 carte**: 2651 dal wiki, con link skill, categorie, statistiche e
  date di uscita separate per Japan e Global, più 46 che ha solo il gioco
  (senza epiteto). Dal prossimo import 2652 e 45: la pagina abbozzata di
  1034150 ora trova la sua carta (sezione "Le pagine abbozzate"). 662 hanno
  l'EZA, 299 anche la Super EZA. I testi completi delle skill sono 10.705
  righe di `card_skill` (sezione sul 0022)
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
- **6246 immagini** ospitate da noi, 1245 MB: 6247 file con `_headers`, il
  31% dei 20.000 che Cloudflare Pages accetta in un deploy (sezione "Spazio
  e limiti"). Una carta o un evento senza immagine mostra un segnaposto
  fatto con i colori del marchio (sezione "Segnaposto delle immagini")
- **Più di tremila verifiche automatiche** in `db:test`, tutte verdi, su
  un database a parte che non è quello di sviluppo: alcuni passi preparano
  il database, gli altri sono suite di verifica (l'elenco è
  `db/test/run.sh`, e il riepilogo finale dice l'esito di ognuno; ogni
  suite stampa i suoi PASS). In più `test:smoke` (i controlli contro
  `next start`) e `test:auth-smoke` sul sito che gira

Tre regole recenti da sapere:

- **Le pagine pubbliche stanno in cache e non leggono la sessione.**
  Eventi, carte e profili: gli URL si costruiscono con `lib/urls.ts`, i
  dati di chi guarda arrivano solo da `/api/me` nelle isole client, e ogni
  scrittura invalida per tag (sezione "Cache e budget CPU"). Dopo un
  import in locale: `npm run cache:clear`.

- **Le azioni sensibili chiedono un accesso recente.** Scollegare o
  collegare un provider, cambiare l'handle, sospendere un utente e
  cancellare l'account passano solo con una
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
   Nel sito la regione è una scelta sola per tutte le pagine, la versione
   (un interruttore Global/Japan, sezione "Versione Global/Japan"). La
   lingua arriverà dopo: nell'interfaccia seguirà la versione, nei dati
   resta un asse a parte.

## Come si parte

```bash
npm install
npm run db:fetch     # scarica wikitext e CSV del gioco (in cache, una volta)
npm run db:refresh   # ricrea, migra, importa carte, eventi, correzioni e immagini
npm run db:test      # tutte le verifiche, su dokkan_test: lo sviluppo non si tocca
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

Il ciclo completo dura **pochi secondi**: le immagini sono già sul disco e
il wikitext è in cache. Al wiki partono poche richieste: `fetch-assets`
rilegge a ogni giro il template degli oggetti premio, e chiede all'API
(`imageinfo`, 50 nomi per richiesta) i file delle carte che un'immagine non
ce l'hanno ancora, anche di quelle senza pagina, con i nomi per convenzione
del wiki (sezione "Le carte senza pagina: i nomi per convenzione"). Quelli
che il wiki ha li scarica, gli altri li riprova al giro dopo.

In produzione la fila è la stessa con `fetch-assets --offline` spostato
dopo `load-datamine` (`db/prod/pipeline.mjs`). Il giro delle sole immagini
(`prod:update -- --images-only`, sezione "Il giro giornaliero delle
immagini") ha solo `fetch-assets --offline` (`PIPELINE_IMAGES`).

### I test, e perché girano su un database a parte

`npm run db:test` è un comando solo, che mette in fila tutto su
**`dokkan_test`**, un database che esiste solo per questo:

1. lo ricrea da zero con le migrazioni e la fixture (`db/reset.mjs --fixture`);
2. verifica **schema e vincoli** (`schema.test.sh`) e
   **l'API di scrittura** (`write_api.test.sh`, 68), poi le funzioni pure
   dell'import: l'id delle carte dal wiki e le pagine abbozzate
   (`wiki-card.test.mjs`), i job delle immagini anche senza pagina, le
   risposte della CDN e i ritenti, la provenienza, i limiti di spazio e la
   cornice delle miniature (`assets.test.mjs`), le soglie della freschezza delle fonti e l'archivio
   del datamine (`fonti.test.mjs`);
3. ci importa i dati veri dalle cache locali (carte, eventi, datamine), senza
   nessuna richiesta di rete;
4. verifica le **query che alimentano le pagine** chiamando le funzioni vere
   di `lib/queries.ts` (`queries.test.mts`), i **parametri dell'URL**
   di `lib/parametri.ts` (`parametri.test.mts`, 43), gli **URL degli
   eventi** di `lib/urls.ts` (`urls.test.mts`), i **parametri dei filtri**
   dei clear (`filtri.test.mts`, 72) e i **tag della cache**
   (`cache-tags.test.mts`);
5. poi le suite del builder, degli account, della moderazione (SQL, area
   admin, lato utente), delle tip (`tips.test.mts`), dei profili e del
   cambio di handle (`profiles.test.mts`), dei temi (`temi.test.mts`) e dei
   segnaposto delle immagini (`segnaposto.test.mts`), dei menu a scelta
   (`scelta.test.mts`), dei dati del gioco,
   dei testi delle skill (`card-page.test.mts`), della pagina della carta
   (`card-page-ui.test.mts`), dei filtri dei clear (`filters.test.mts`) e,
   per ultima, dell'aggiornamento settimanale e del giro giornaliero delle
   immagini (`weekly-data.test.mts`: i due workflow e i permessi job per
   job, la guardia della cache di Actions, `import_run`, le immagini
   mancanti, i vincoli della 0033 e della 0034).

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
`npm run test:parametri` e `npm run test:filtri` solo quelle dei parametri
dell'URL e dei filtri, `npm run test:scelta` quelle dei menu a scelta, che
non usano il database. Le query si provano senza un passo di build: Node toglie i tipi al
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
id sbagliati (404); sulla lista filtrata dei clear il noindex, il
canonical al tier e i valori sbagliati (200, mai un 500); sui profili un
profilo vero, il 308 delle maiuscole diverse e gli handle che non ci sono,
malformati o riservati (404). Gli eventi da aprire li prende dalle viste
filtrate: servono i dati importati. Il profilo lo cerca nelle pagine
evento, o lo prende da `SMOKE_PROFILE_HANDLE` (con `db:demo`:
`demo_rotation`). Contro `next start` con `SMOKE_EXPECT_CACHE=1`
controlla anche che la seconda visita a `/events`, a un evento, a una
carta e a un profilo esca dalla cache (`x-nextjs-cache: HIT`), e accetta
i redirect e i 404 che lì arrivano nello stream (sezione "Cache e budget
CPU").

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
app/                          Next.js 16, App Router
  events/                     /events e japan/ (/events/japan): le home statiche di Global e Japan; browse/ (viste filtrate, dinamiche)
    [id]/                     la pagina evento; [...view]/ per /japan, /t/<tier>, /p/<n>
      clears/                 la lista filtrata dei clear di un tier (dinamica, noindex)
      clears/[clearId]/edit/  la modifica di un proprio clear
      submit/                 il builder per inviare un clear
  cards/[id]/                 la pagina di una carta: pubblica, in cache, 308 dalla forma Z, 404 vero
  users/[handle]/             il profilo pubblico (e p/[n]/ dalla pagina 2): in cache, 308 dai nomi lasciati
  login/, welcome/            l'accesso e la prima entrata (handle e regione)
  settings/                   l'account: handle, display, provider, clear nascosti, cancellazione; sign-in/ per rientrare
  admin/                      l'area dei moderatori: coda, nascosti, utenti, registro (404 per chi non e' admin)
  privacy/, terms/            le pagine legali (testi in lib/legale.ts)
  api/                        auth/ (better-auth), me/ (chi guarda), cards/ e equipment/ (i picker),
                              revalidate/ (dopo un import), cron/purge/ (la pulizia giornaliera), cron/digest/ (il digest email)
  robots.ts, sitemap.ts       cosa indicizzare: eventi e carte, mai le viste filtrate
  icon.svg, favicon.ico, apple-icon.png, opengraph-image.png, twitter-image.png
                              le icone e l'anteprima dei link, file statici generati da scripts/brand/
proxy.ts                      solo per /admin: senza cookie di sessione un 404 vero, senza database
next.config.ts                i redirect della versione del sito (col cookie dts_version, 307, sulla CDN), / -> /events, gli header
instrumentation.ts            all'avvio: controlla la configurazione dell'accesso, pulizia delle sessioni
components/
  evento/, eventi/            la pagina evento e la lista, uguali per tutti (stanno in cache)
  clear.tsx, clears/          la scheda di un clear (squadre, cambi, voti, commenti, Delete) e i filtri della lista
  builder/                    il builder dei clear: slot, picker delle carte, build, dettagli, prove
  cards/, carta.tsx           la pagina della carta, e il nome di una carta come link
  profile/, handle-link.tsx   il profilo pubblico, e l'handle come link al profilo
  tips/                       il blocco delle tip: lista, Top/New, Helpful, Report, il form
  moderation/                 Report e il banner della sospensione (isole), la coda, i form e il registro di /admin
  auth/                       accesso, /welcome, Settings (handle, provider, artwork, cancellazione), l'utente nell'header
  viewer/                     ViewerProvider e useViewer(): le isole client che leggono /api/me
  brand/marchio.tsx           il marchio dell'header: SVG con colori fissi, chiaro o scuro solo dal CSS di app/globals.css (anche per i segnaposto)
  tema/                       il selettore del tema: nel footer e in Settings
  versione/                   la versione del sito: l'interruttore Global/Japan (burger, header, Settings), i link alla home della versione, gli avvisi
  missioni.tsx                le missioni di un evento, con i premi
  segnaposto.tsx              al posto delle immagini che mancano: la carta (tipo, iniziale, rarita') e l'evento (icona del tipo)
  scelta/                     i menu a scelta: <Scelta> (scelta.tsx), il <select> del server (scelta-nativa.tsx), il combobox di Headless UI (scelta-elenco.tsx, chunk suo), le classi (stile.ts)
lib/
  queries.ts                  le letture delle pagine evento (pure): eventi, stage, clear, filtri, faccette
  clears.ts, clears/          il builder e il clear: letture, Server Action, validatori, frasi d'errore, filtri
  tips.ts, tips/              le tip: letture (pure), Server Action, validatori, frasi d'errore
  card-page.ts, card-art.ts   la pagina della carta (pura) e la scelta dell'artwork
  profiles.ts                 i profili (pure): solo dalla vista public_profile
  cards.ts, equipment.ts      le ricerche dei picker (anche GET /api/cards e /api/equipment)
  parametri.ts, urls.ts       la query string letta con difesa, e tutti gli URL interni
  cache/                      'use cache' sopra le query pure, i tag, l'invalidazione, /api/revalidate
  viewer/                     chi guarda: il tipo di /api/me e il cookie dts_signed_in
  tema/                       i temi: id e nomi, lo script del <head> (temi.ts, puro), applicarli nel browser (client.ts)
  versione/                   la versione Global/Japan: cookie, specchio dei redirect, gemello e script del <head> (versione.ts, puro), il browser (client.ts), le decisioni dell'interfaccia (interruttore.ts, puro), il cambio (cambio.ts), il cookie della richiesta (server.ts)
  auth/                       better-auth: configurazione, mittente del link, Server Action, regole di Settings e dell'handle
  dal.ts                      chi e' l'utente: requireUser / requireOnboardedUser / requireFreshUser (mai nelle pagine pubbliche)
  moderation/                 motivi, frasi d'errore, Report, requireAdmin, letture e azioni di /admin
  legale.ts                   i numeri e i testi di privacy e terms
  segnaposto.ts               cosa mostra un segnaposto (puro): settore del tipo, iniziale, misure, icona ed etichetta dell'evento, la cornice disegnata
  scelta.ts                   i menu a scelta (puro): le opzioni, la ricerca, i testi, dove si apre l'elenco
  db.ts, db-config.ts         la pool (una per processo) e le sue impostazioni: dimensioni, TLS
  cron.ts                     l'autenticazione delle rotte di Vercel Cron
db/
  migrations/                 NNNN_*.sql, applicate in ordine, mai modificate (0001-0035, elenco sotto)
  migrate.mjs                 runner: applica le pendenti, una transazione ciascuna (--check per sapere se e' indietro)
  reset.mjs                   ricostruisce un database da zero (--fixture per i test)
  env.mjs                     la sorgente unica di DATABASE_URL per gli script
  local.sh, pgenv.sh          il cluster locale opzionale e le variabili PG*
  cache-clear.mjs             invalida la cache del server di sviluppo dopo un import (npm run cache:clear)
  import/                     gli import, idempotenti, dalle cache locali (vedi sotto)
    fetch-wiki.mjs, fetch-events.mjs, fetch-datamine.mjs   scaricano wiki e datamine, in cache
    load-cards.mjs, wiki-skills.mjs   le carte del wiki e i testi delle skill (card_skill)
    load-game-cards.mjs, game-cards.mjs   le carte uscite su Global senza pagina wiki
    load-events.mjs           eventi, stage e difficolta' dal wiki
    load-datamine.mjs         correzioni e arricchimenti dal gioco
    load-game-events.mjs, game-events/   gli eventi che il wiki non ha, e gli stage delle riedizioni
    load-windows.mjs, set-event-window.mjs, quest-refs.mjs   le finestre Global dal gioco
    load-missions.mjs, missions/   le missioni Global e i loro premi
    load-equipment.mjs, equipment-limits.mjs   le Skill Orb e le loro regole
    fetch-assets.mjs          le immagini (--offline: solo dal disco; --missing: solo quelle senza riga; --plan: solo il piano)
    asset-jobs.mjs            quali file chiedere al wiki per ogni carta, anche senza pagina (i nomi per convenzione), e quale miniatura collegare (0034)
    asset-select.mjs          quali job fare, le risposte della CDN e i ritenti, la provenienza (0033)
    asset-cornice.mjs         se una miniatura ha la cornice o e' il solo personaggio, dai pixel (ffmpeg, 0034)
    asset-limits.mjs          i limiti di spazio: file per deploy di Pages, tetto e budget degli animati
    .cache/                   wikitext e CSV scaricati (non versionati)
  prod/                       gli script contro la produzione (prod:setup, prod:migrate, prod:update, prod:backup, ...)
    target.mjs                il bersaglio: PROD_DATABASE_URL, i rifiuti, il TLS, la conferma --yes
    pipeline.mjs              l'ordine dell'import, uguale per setup e update
    harden.mjs                toglie i privilegi su public ai ruoli della Data API di Supabase
    tables.mjs                ogni tabella classificata: di gioco o degli utenti
    snapshot.mjs, compare.mjs, limits.json   la fotografia delle tabelle e i limiti dell'aggiornamento settimanale
    dump.mjs, rehearsal.mjs   il backup della produzione e il giro di prova su una copia locale
    sanity.mjs, last-run.mjs, missing-assets.mjs, mirror-assets.mjs   i controlli e le immagini del workflow
    storage.mjs               lo spazio delle immagini contro i limiti, e la guardia prima del deploy
    freshness.mjs             le fonti sono fresche? l'app del gioco contro il datamine
    datamine-archive.mjs      la copia privata delle fotografie del datamine (push, restore)
    cache-check.mjs           prima di salvare la cache di Actions: dentro solo le fonti pubbliche
  admin/set-role.mjs          il ruolo di un utente, solo da script (db:role, prod:role)
  seed/demo-clears.mjs        tre clear dimostrativi su un evento vero (db:demo)
  queries/reference.sql       le query di lettura principali, documentate
  test/                       le verifiche: run.sh le mette in fila (npm run db:test), fixture/ i dati di prova
test/
  smoke.sh                    prova di fumo sul sito che gira (npm run test:smoke)
  auth-smoke.sh               il giro del magic link sul sito che gira (npm run test:auth-smoke)
  cpu.sh                      la CPU per richiesta su next start (npm run test:cpu)
.github/workflows/weekly-data.yml   l'aggiornamento settimanale automatico
.github/workflows/daily-images.yml  il giro giornaliero delle sole immagini (mai il venerdi')
scripts/assets-deploy.mjs     public/assets su Cloudflare Pages, con _headers (assets:deploy)
scripts/brand/                il marchio: geometria, SVG sorgente (svg/) e il generatore delle icone (npm run brand)
vercel.json                   regione fra1, i cron (pulizia alle 4 UTC, digest email alle 17), anteprime saltate (ignoreCommand)
public/.well-known/security.txt   il contatto per chi trova una vulnerabilita' (RFC 9116): Expires va rinnovato ogni anno, entro ottobre (test:smoke lo segnala)
public/assets/                le immagini ospitate da noi (non versionate)
backups/                      le copie di prod:backup (non versionate)
docs/                         l'analisi competitiva e le decisioni di progetto
```

Le migrazioni che contano per il sito, oltre allo schema dei dati (0001-0013, 0015, 0017):

| | |
|---|---|
| `0002_write_api.sql` | `proof_host`, trigger di congelamento, le funzioni di scrittura |
| `0014_auth.sql` | gli account: better-auth sulle nostre tabelle, `complete_onboarding` |
| `0016_clear_builder.sql` | invio e revisione dal sito in una transazione, assetti congelati |
| `0018_slot_builds.sql` | le build degli slot (Hidden Potential, Skill Orb), congelate con la versione |
| `0019_account_settings.sql`, `0020` | Settings: `unlink_provider`, `delete_account` e la sua guardia |
| `0021_equipment_limits.sql` | le Skill Orb esclusive: chi può montare quale sfera |
| `0022_card_skills.sql` | `card_skill`: i testi completi delle skill, con EZA e Super EZA; `set_prefers_animated` |
| `0023_import_run.sql` | `import_run`: un import alla volta, e l'ultimo riuscito |
| `0024_moderation.sql` | segnalazioni con motivo, nascosti, sospensioni, `moderation_action` |
| `0025_tips.sql` | le tip: bersaglio, limiti, link senza accorciatori, voto Helpful, Report |
| `0026_public_profiles.sql` | `public_profile`, `handle_history`, `change_handle`, gli indici per autore |
| `0027_theme.sql` | `app_user.theme` (null = System) e `set_theme` |
| `0028_notifications.sql` | le notifiche nel sito: `notification`, `notification_pref`, i trigger, il pallino |
| `0029_email_digest.sql` | il digest email giornaliero, con il budget che protegge i login |
| `0030_vote_score_cascade.sql` | i punteggi dei clear quando un voto se ne va con l'account |
| `0031_push.sql` | le push del browser: `push_subscription`, `push_sent`, `push_claim` |
| `0032_site_activity.sql` | l'attività del sito per gli admin: il feed, una push per azione, mai per email |
| `0033_asset_source.sql` | `asset.source` e `source_url`: da dove viene ogni immagine |
| `0034_thumb_frame.sql` | `asset.frame` e `asset_bare()`: le miniature senza cornice (le LR del wiki), che il sito incornicia |
| `0035_set_region.sql` | `set_region`: la versione del sito (`app_user.reg`) salvata sull'account dall'interruttore |

### Sulle migrazioni

Una migrazione applicata non si modifica più. Il runner ne tiene il checksum
e si rifiuta di procedere se un file cambia sotto i piedi — è il modo più
rapido di ritrovarsi con due database diversi convinti di essere uguali. In
sviluppo si ricrea tutto con `db:reset`; in seguito si aggiunge un file nuovo.

`reset.mjs` si ferma su un database che ha tabelle e non ha
`schema_migrations` (vedi sopra); il nome non lo guarda. Quello lo
controllano i test, che girano solo su un nome che finisce per `_test`.

**In produzione l'ordine con il codice non è sempre lo stesso**, e la CI non
migra mai (`npm run prod:migrate -- --yes` è un gesto a mano). Una colonna
che il codice nuovo legge va online **prima** del codice: senza, il codice
nuovo si rompe (0027, 0028, 0034; allo stesso modo la 0035, una funzione
che il codice nuovo chiama). Un vincolo che il codice di prima non
rispetta va online **subito dopo** il codice: prima, il codice di prima
fallirebbe a ogni scrittura (la 0033, `asset.source` not null senza
default). Ma conta solo dove il codice di prima scrive davvero: la 0033
può precedere il codice finché nessun giro applicato del codice di prima
scrive `asset` (sezione della 0033). Quando conta, lo dice la sezione
della migrazione.

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
falso), niente statistiche né testi delle skill. Le immagini invece arrivano
quando il wiki le ha caricate senza scrivere la pagina, cosa che succede
spesso: `fetch-assets` prova per loro i nomi per convenzione (sezione "Le
carte senza pagina: i nomi per convenzione"). La scelta è
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

### Fonti fresche e copia del datamine

Il datamine è il repository di un privato, aggiornato da un esportatore
automatico che si può fermare in silenzio quando cambia il client del
gioco, e il suo `database.db` è vicino al limite di 100 MiB per file di
GitHub. Un controllo lo tiene d'occhio, una copia privata lo mette al
sicuro, e un ripiego tiene in piedi il settimanale se sparisce.

**La freschezza** (`db/prod/freshness.mjs`, il passo "Freshness of the
sources" del settimanale dopo il controllo delle sorgenti, e del giornaliero
dopo la cache). Confronta l'app del gioco con il datamine:

| avviso | soglia |
|---|---|
| l'app Global è uscita e l'ultimo commit di `data/` del datamine è più vecchio | più di 3 giorni dall'uscita (`APP_AHEAD_DAYS`) |
| nessun commit di `data/` | più di 14 giorni (`DATAMINE_STALE_DAYS`): di solito committa ogni settimana |
| nessuna carta nuova (l'`open_at` giocabile più recente nel `cards.csv` in cache) | più di 21 giorni (`CARDS_STALE_DAYS`): fra agosto e settembre 2026 il buco più lungo è stato di 16 |
| `database.db` del datamine | dal 98% di 100 MiB (`UPSTREAM_DB_WARN_PCT`); sotto è solo informazione |

Le fonti, una richiesta ciascuna con 15 secondi al massimo: l'API di lookup
di iTunes (Global `id=951627425`, Japan `id=951627670&country=jp`: senza
`country` risponde `resultCount` 0), l'ultimo commit di `data/` (lo stesso
`resolveCommit` di `fetch-datamine`, il token di GitHub solo verso
`api.github.com`) e l'elenco della cartella con `database.db`
(`UPSTREAM_DB_PATH`, cioè
`Dokkan_Asset_Downloader/card_assets/global/en/sqlite/current/en/`; se il
file cambia nome si prende il `.db` che c'è e il riepilogo dice il
percorso). Japan è solo informazione: il datamine è di
Global, e Japan è avanti per natura. Ogni avviso è un `::warning::` e una
riga fra le cose da guardare; il riepilogo ha la sezione "Sources". Un'API
che non risponde è un "not checked", un errore qualsiasi una notice: **il
giro non fallisce mai per questo** (e il passo ha `continue-on-error`).
Il 10 ottobre 2026 non c'era nessun avviso: Global 6.5.5 del 29 agosto,
Japan 6.6.0 del 7 ottobre, commit 86e8684e del 2 ottobre, carta più recente
del 29 settembre; `database.db` 101.199.872 byte, il 96,5% di 100 MiB, cioè
circa 3,5 MiB di margine a 1,7 MB al mese: un paio di mesi. Il percorso di
`database.db` va confermato dal primo riepilogo della CI, che lo stampa (o
dice "not checked").

**La copia privata** (`db/prod/datamine-archive.mjs`). La cache di Actions
sparisce dopo 7 giorni senza uso; qui resta per sempre ogni commit buono
del datamine, in un repository **privato**,
`EmanueleMelini/dokkan-team-sharing-ops`: `datamine/datamine-<giorno del
commit>-<sha7>.tar.gz` (i CSV delle tabelle e `_snapshot.json`) e
`datamine/LATEST.json` (`commit`, `committed_at`, `file`, `sha256`,
`bytes`), l'ultima fotografia buona. Un tarball per commit, 3-5 MB l'uno
(circa 200 MB l'anno); un push con lo stesso commit di `LATEST.json` non fa
niente. Il settimanale archivia nel passo "Archive the datamine snapshot",
con `continue-on-error`, solo una fotografia buona: il datamine arrivato
intero, il controllo delle sorgenti passato e, se c'era qualcosa di nuovo,
il giro di prova con i limiti passato (`GO=false` lì vuol dire lo stesso
commit dell'ultimo import). In prova la produzione non la importa, ma il
giro di prova sì.

Non li ripubblichiamo noi: i CSV sono dati del gioco, non nostri da
pubblicare. Per questo:

- `push` chiede a ogni giro `GET /repos/EmanueleMelini/dokkan-team-sharing-ops`
  e non carica niente (un `::warning::`, il giro va avanti) se il repo non è
  `private`, o se il token non lo vede: un repo creato pubblico per sbaglio,
  o reso pubblico dopo, non riceve niente;
- l'artifact `import-cache` del settimanale (30 giorni, lo scarica chiunque
  abbia un account GitHub) tiene solo il wiki (CC BY-SA): la cartella
  `datamine/` resta fuori;
- il datamine della settimana prima sta nella cache di Actions, che il
  giornaliero legge ogni giorno e così tiene viva. **La cache non è un
  posto privato**: un giro `pull_request`, anche quello di una fork con un
  suo workflow, ripristina le cache del branch base, quindi chi apre una
  pull request può leggerla. Ci sta perché il contenuto è lo stesso del
  repository pubblico del datamine su GitHub: non esce nessun segreto. La
  copia privata è solo l'archivio ops. Nella cache non va mai un secret, un
  dump o un dato della produzione: prima di salvarla (e di caricare
  l'artifact) il passo "Check the import cache holds only public sources"
  (`db/prod/cache-check.mjs`) controlla che in `db/import/.cache` ci siano
  solo `wiki-cards.json`, `wiki-events.json`, `wiki-items-template.json`,
  `datamine/_snapshot.json` e i CSV di `datamine/`. Un altro file, una
  cartella in più o un link fermano il salvataggio e l'artifact, e il giro
  diventa rosso con i soli nomi dei file.

**Se il datamine sparisce** (il repository tolto, un 404, l'API giù),
"Fetch the datamine" può fallire e il passo "Datamine fallback" tiene
l'ultima fotografia buona: prima toglie la cache a metà (un `--fresh`
fermato mescolerebbe due commit), poi rimette quella della settimana prima
(`db/import/.cache.prev`, dalla cache di Actions: l'artifact non ha il
datamine), altrimenti, con il token, quella dell'archivio privato. Senza
nessuna delle due il giro si ferma con un errore, come prima.
Con la fotografia di ripiego **non si applica niente**, nemmeno con `force`:
`DATAMINE_MODE=fallback` e "Decide" mette `GO=false`; nel riepilogo un
avviso dice quale commit è stato tenuto. La cache di ripiego non viene mai
salvata come cache nuova.

Il secret `OPS_ARCHIVE_TOKEN` è **facoltativo**. Per attivarlo:

1. crea il repository **privato** `EmanueleMelini/dokkan-team-sharing-ops`
   con un primo commit (basta un README: l'API Git Data non scrive in un
   repository vuoto);
2. crea un token fine-grained (GitHub, Settings, Developer settings,
   Personal access tokens, Fine-grained tokens): resource owner
   `EmanueleMelini`, "Only select repositories" con il solo
   `dokkan-team-sharing-ops`, permesso Repository "Contents: Read and
   write" (Metadata in lettura arriva da sé), scadenza di circa un anno, e
   un promemoria per ruotarlo prima che scada;
3. aggiungilo come secret dell'environment `production` del repository del
   sito (Settings, Environments, production, Environment secrets), con il
   nome `OPS_ARCHIVE_TOKEN`. L'environment vale solo per `main`;
4. senza il secret `push` stampa la notice "OPS_ARCHIVE_TOKEN not set:
   datamine snapshot not archived" ed esce 0, e il ripiego usa solo la
   cache della settimana prima;
5. per rimettere a mano l'ultima fotografia sul Mac, il token si incolla
   a un `read -rs` (non si vede e non finisce in `~/.zsh_history`, che
   salva i comandi interi):
   `read -rs OPS_ARCHIVE_TOKEN && export OPS_ARCHIVE_TOKEN`, poi
   `node db/prod/datamine-archive.mjs restore`, poi `unset OPS_ARCHIVE_TOKEN`.
   Sostituisce `db/import/.cache/datamine` dopo aver controllato lo sha256 e
   che il commit di `_snapshot.json` sia quello di `LATEST.json`. Il token
   mai in `.env.local` o in un file del repository.

Per ruotarlo: un token nuovo con gli stessi permessi, il secret
sostituito, il vecchio revocato. Il token è solo un header `Authorization`
verso `api.github.com`: mai su disco, mai stampato.

## Le carte dal wiki: come sono state estratte

Dall'**API MediaWiki pubblica del wiki Fandom**. È la sorgente a monte da
cui derivano gli altri dataset in circolazione — quelli che ho trovato sono
fermi a gennaio 2023 — ed è un'API documentata con i suoi limiti, non uno
scraping di HTML. L'enumerazione passa da chi include `Template:Characters`,
che sono esattamente le pagine carta.

Su 2671 pagine, **2652 importate** e 19 scartate, ognuna con il suo motivo
stampato: 18 sono oggetti di supporto e non unità, 1 ha un tipo malformato.
La pagina abbozzata senza id che prima si scartava ora prende la sua carta
per nome, tipo, classe e rarità (sotto, "Le pagine abbozzate"). Le varianti
a cinque tipi che condividono la stessa immagine, e le pagine senza
un'immagine col numero della carta, prendono l'id dal campo `|ID`,
accettato solo se il datamine ha quella carta con lo stesso tipo e la
stessa rarità (`db/import/wiki-card.mjs`).

Le carte con una pagina ma senza immagine in tabella sono 19 senza
miniatura e 21 senza artwork, quasi tutte entrate col `|ID`. Il wiki le ha
quasi tutte (l'API, il 10 ottobre 2026): le 19 miniature (9 col nome per
convenzione, le 10 Metal Cooler col nome scritto sulla pagina, `Card 1003640
thumb <TIPO>.png` e `Card 1015680 thumb <TIPO>.png`) e 18 artwork su 21 (8
per convenzione, e le 10 Metal Cooler da `SR Metal Cooler HD.png` e
`5Type SSRCooler.png`); non c'è l'artwork di 1033060, 1030970 e 1032880.
Mancano solo perché la CDN aveva risposto 403 e perché il settimanale
applica ancora in prova. Il runner di GitHub di solito le scarica (42 file
su 45 il 9 ottobre 2026, mentre il giorno dopo il Mac riceveva il 403); un
403 lo riprova il giro giornaliero delle immagini, e non si aggira mai.

### Le pagine abbozzate

Il wiki a volte apre la pagina di una carta appena uscita senza immagini e
senza `|ID`: nome, tipo, classe e rarità, e niente altro. Prima si scartava
("nessun id carta ricavabile da immagini o |ID"). Ora `assignCardIds`
(`matchStub` in `db/import/wiki-card.mjs`) la aggancia all'**unica** carta
solo del datamine che le corrisponde su segnali esatti:

- il nome (`name2`, ripulito come lo pulisce `load-cards`; gli spazi
  intorno a "/" non contano, perché il datamine scrive "A/\nB"), il tipo, la
  classe e la rarità devono essere uguali;
- se la pagina ha `GLBdate`, deve stare entro un giorno dall'uscita Global
  del datamine: il giorno UTC di `open_at` coincide con `GLBdate` 2183 volte
  su 2282, e sbaglia di uno 78;
- i candidati sono quelli che sceglierebbe `load-game-cards` (niente copie,
  niente righe alla data minima del lancio, niente carte non ancora
  uscite), meno ogni id che un'altra pagina nomina, anche con un'immagine
  condivisa o un `|ID` rifiutato;
- il candidato deve essere unico **nel gioco intero**, non solo fra i
  candidati (`gameUnits` in `db/import/game-cards.mjs`): nessun'altra unità
  del datamine con lo stesso nome, tipo, classe e rarità, comprese quelle che
  i candidati tolgono (la gemella non ancora uscita con la data finta del
  2038, una copia, una riga alla data minima del lancio) e quelle che hanno
  già una pagina. Altrimenti la pagina potrebbe essere di quella, o di una
  carta che il datamine non ha ancora (proprio il caso dell'avviso di
  freschezza). Con `GLBdate` una rivale si esclude solo se tutte le sue date
  sono note e lontane più di un giorno; senza, nessuna. La rarità è quella
  della base: la forma Z-awakened sale di una (1034130 SSR, 1034131 UR), ma
  il wiki scrive sempre quella della base (1487 pagine su 1487 con le due
  rarità diverse).

Il costo no (wiki e datamine coincidono solo 1124 volte su 2295), le
statistiche nemmeno (misurano cose diverse). Una corrispondenza ambigua
(due candidati, o un candidato e un'altra unità del gioco con la stessa
firma) o a metà (lo stesso nome con tipo, classe o rarità diversi, o una
data lontana) resta fuori con il motivo stampato: mai una carta indovinata.
Due abbozzi sulla stessa carta restano fuori tutti e due. Sulle 45 carte
solo del datamine di oggi, un abbozzo senza `GLBdate` ne troverebbe 29 (le
altre 16 hanno un nome, un tipo, una classe e una rarità che il gioco ha già
usato, come Super Saiyan Goku SSR AGL Super), uno con `GLBdate` 44 (resta
fuori la LR Super Saiyan Goku, che il gioco ha due volte lo stesso giorno,
1034030 e 3034040).

Oggi ce n'è una: "Transcendent Existence Buu (Kid)" (pageid 730530, LR,
EXTREME INT) diventa **1034150**; 1034130 (SSR) e 1034140 (UR), le forme
prima del risveglio, hanno lo stesso nome ma un'altra rarità, e nel gioco
non c'è un'altra LR INT Extreme che si chiami così. La pagina non ha date,
quindi `load-cards` prende la data Global dal datamine (2026-09-29): senza, un `db:refresh` la perderebbe, perché
`load-game-cards` non la scrive più su una carta che ha la pagina. Le carte
solo del datamine passano da 46 a 45. `load-cards` stampa a ogni giro
quelle agganciate così ("id da una pagina abbozzata"). Il giorno che la
pagina riceve le immagini l'id arriva dall'immagine, ed è lo stesso.

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
appena ricreato con le immagini già presenti l'intera fase dura **pochi
secondi**, e al wiki partono poche richieste: il template degli oggetti
premio, che `fetch-assets` rilegge a ogni giro, e qualche richiesta
`imageinfo` per i file che sul disco non trova, cioè le immagini che una
carta non ha ancora (anche senza pagina: sotto, "Le carte senza pagina").

```bash
npm run db:assets                       # tutto
npm run db:assets -- --only icons
npm run db:assets -- --only thumb        # statiche (anche quelle con la cornice, 0034) e animate
npm run db:assets -- --only anim         # solo le animate
npm run db:assets -- --only art --limit 50
npm run db:assets -- --flatten-existing  # ripara gli animati salvati male
npm run db:assets -- --force             # riscarica comunque
npm run db:assets -- --missing           # solo le immagini senza riga in asset (la CI)
npm run db:assets -- --plan piano.json   # solo il piano: cosa c'e' sul wiki e quanto pesa, niente download
```

`--plan` implica `--missing`, e non va con `--force`, `--offline` o
`--flatten-existing`: legge in una transazione read only, chiede all'API
quali file esistono e quanto pesano, scrive il piano in JSON ed esce prima
di qualsiasi download. `--report <file>` scrive invece, a giro finito,
quanto è successo (scaricati, byte, sfidati dalla CDN, falliti dopo i
ritenti, mancanti, saltati per i limiti): lo leggono i riepiloghi della CI.

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
wiki risponde; il controllo anti-bot non si aggira. Il comando rispetta i
tetti di `db/import/asset-limits.mjs` (sotto, "Spazio e limiti"): un
artwork animato oltre 12 MiB, o oltre il budget, si salta e l'artwork fermo
resta; le miniature animate oltre 1 MiB (i veri APNG del wiki pesano circa
5 MB l'una, e nessuna pagina le mostra) restano fuori. Senza tetti
avrebbe aggiunto circa 850 MB.

### L'icona LR

Le rarità da N a UR seguono la convenzione `<rarità> icon.png`. LR no: è un
**APNG animato** che sta sotto `LR logo apng.png`, e il template del wiki la
richiama con un URL fisso invece della sintassi normale dei file — per
questo non salta fuori cercando "LR icon". Qualunque ridimensionamento di
Fandom la appiattisce in un WebP statico da 13 KB. Teniamo entrambe le
versioni: `rarity_icon.asset_key` è la statica, `animated_asset_key`
l'animata da 397 KB. La statica per le liste, l'animata per la pagina della
carta.

### Le carte senza pagina: i nomi per convenzione

Il wiki carica le immagini delle carte con un nome fisso, `Card <id>
thumb.png` e `Card <id> artwork.png` (nel wikitext in cache: 2457 miniature
su 2494 e 1928 artwork su 2494 si chiamano così), e spesso le carica anche
quando la pagina non c'è ancora. Prima `fetch-assets` chiedeva le immagini
solo delle carte con una pagina (`wiki_title` non nullo, e lo stesso filtro
in `db/prod/missing-assets.mjs`). Ora i job li costruisce
`db/import/asset-jobs.mjs` (puro, `cardJobs`) per **ogni carta in tabella**:

- con una pagina: prima il file scritto sulla pagina, poi i nomi per
  convenzione, poi l'URL dell'APNG incollato, solo se sta sulla CDN del
  wiki (prima si scaricava qualsiasi `https` incollato da un editor);
- senza pagina: solo i nomi per convenzione, la miniatura e l'artwork
  (`Card <id> artwork.png`, poi `Card <id> bg.png`, la stessa regola delle
  pagine). Niente animati: delle 46 carte senza pagina nessuna ha un APNG
  sul wiki, e i due trovati in tutto (1030970, 1032880) sono già scritti
  sulle loro pagine.

Le richieste sono quelle di sempre: l'API `imageinfo`, 50 nomi per volta,
150 ms fra una e l'altra, lo stesso User-Agent. Un job è *quiet* quando la
pagina non dichiara nessun file: se il wiki non ce l'ha è solo un conto
("N cards have no file on the wiki yet, retried every run"), e il giro dopo
riprova. Un file che una pagina dichiara e il wiki non ha resta un
`::warning::`, così un parser che si rompe si vede ancora.

Misurato il 10 ottobre 2026: delle 46 carte senza pagina il wiki ha la
miniatura di 34 e l'artwork di 31; 12 non hanno ancora nessun file
(1020410, 1030310, 1031350, 1033720 e 1034130-1034200).
`missing-assets.mjs` ora le conta (colonna `no_page`) con una riga sola nel
riepilogo ("N cards without a wiki page: only the conventional file names
are tried, every run"). Per questo le immagini in attesa non tornano più a
zero e il passo dei download del settimanale gira ogni settimana: costa un
paio di richieste all'API finché il wiki non le carica. Le copie e le
riedizioni non sono in tabella (`load-game-cards` le salta), quindi non
possono prendere l'immagine di un'altra carta.

### Da dove viene un'immagine (migrazione 0033)

Ogni riga di `asset` dice da dove viene:

- `source`, la fonte: oggi una sola, `wiki` (`fetch-assets` chiede tutto al
  wiki, l'API per i nomi e la CDN per i file). Niente default: chi scrive
  una riga deve dirla, e una fonte nuova (il gioco, file nostri) è una
  migrazione, non un valore libero (il vincolo `asset_source`);
- `source_url`, il file originale sulla CDN del wiki, senza
  ridimensionamento (lo decide il kind) e senza query string. Il vincolo
  `asset_source_url_wiki` accetta solo `static.wikia.nocookie.net`,
  `vignette.wikia.nocookie.net` (il nome vecchio della stessa CDN, che 136
  URL di APNG nelle pagine usano ancora) e `dbz-dokkanbattle.fandom.com`.

Il riempimento dice solo quello che è certo: tutte le 6246 righe di oggi
hanno `source = 'wiki'` e `source_url` null, perché sono state riadottate
dal disco dopo un `db:reset`, e quale dei nomi candidati avesse risposto
(il file della pagina o quello per convenzione, l'artwork o il bg) non si
sa più. Da ora un download scrive l'URL da cui è arrivato il file. Con
`ASSET_MANIFEST` ogni download aggiunge anche una riga a un file JSONL
fuori dall'albero pubblicato (chiave, fonte, URL, checksum, byte), e
un'adozione dal disco prende l'URL da lì solo se il checksum combacia;
altrimenti null. Una riadozione non cancella mai un URL già noto. In CI il
manifesto del giro di prova passa all'applicazione, quindi la produzione
ha lo stesso `source_url` del giro di prova.

**In produzione la 0033 non deve precedere un giro applicato del codice di
prima.** Il sito non scrive mai `asset`: lo fanno solo il settimanale e il
giornaliero. Con il settimanale in prova (`WEEKLY_APPLY=false`) e nessun
giro applicato lanciato a mano nel frattempo, la 0033 può andare online
insieme alla 0032, **prima** del codice, che la 0032 richiede: è l'ordine
del rilascio che le porta tutte e due (`npm run prod:migrate -- --yes` da
un export pulito del commit, poi subito il push). Con `WEEKLY_APPLY=true`
invece prima il codice su `main`, poi subito la migrazione. Il motivo: la
0033 vuole `source` su ogni riga, e il codice di prima scrive `asset`
senza; con la 0033 già applicata ogni riga
nuova fallirebbe una per una, il `migrate --check` di prima avvisa soltanto
di una migrazione applicata che non vede sul disco e il `check-schema` di
prima non se ne accorge, quindi il settimanale finirebbe verde con file
scaricati (e con `WEEKLY_APPLY=true` pubblicati) senza la loro riga. Nell'ordine giusto, finché la 0033 manca,
`migrate --check` (nel giro di prova) e `check-schema` (in `prod:update`)
fermano il settimanale e il giornaliero con il loro messaggio, prima di
scrivere qualsiasi cosa (la CI non migra mai); il sito non legge
`asset.source`, quindi non se ne accorge. La 0032 e la 0033 sono nate in
parallelo; `migrate.mjs` applica le pendenti per nome.

### Le miniature e la cornice (migrazione 0034)

**Il problema.** Sul wiki la miniatura di una LR non è un file: il modulo
`Module:Thumb` la compone nel browser a strati (la cornice `Frame SSR <tipo>
thumb.png`, la spirale, i raggi animati, `Card <id> thumb.png`, il logo
`LR icon thumb.png` e l'icona del tipo). `Card <id> thumb.png` di una LR è
quindi **il solo personaggio**, senza cornice, badge del tipo né logo LR, e
`fetch-assets` lo prendeva per convenzione. Misurato il 13 ottobre 2026 su
`dokkan_dev`: 179 delle 183 miniature LR erano così, tutte 250x250. La
versione con la cornice c'è quasi sempre: è `|thumb apng`, l'APNG animato
che la pagina incolla (`Card <id> thumb apng.png`, 4,4 MB in media), il cui
primo fotogramma è la miniatura giusta.

**Due job per la miniatura ferma** (`db/import/asset-jobs.mjs`, `cardJobs`):

- `cards/<id>/thumb`, quello di sempre: il file scritto sulla pagina, poi
  `Card <id> thumb.png`;
- `cards/<id>/thumb-framed` (kind `card_thumb`, colonna `thumb_key`): il
  primo fotogramma dell'APNG, chiesto col nome del file nell'URL della
  pagina e poi con quello per convenzione, `Card <id> thumb apng.png` (171
  dei 172 APNG dichiarati si chiamano così). Si chiede quando la pagina ha `|thumb apng` e nessun
  `|thumb` fermo; quando la carta è LR e la pagina non dichiara un `|thumb`
  fermo (un `{{ThumbLR|...}}` non è un file: sono gli strati del wiki), o
  la pagina non c'è (allora solo il nome per convenzione, *quiet*); e quando
  la ferma che abbiamo è misurata nuda (`asset.frame = false`). Allora
  l'APNG è suo, e la ferma non lo usa più come ripiego: lo stesso file non
  si scarica due volte. Un `|thumb` dichiarato resta il primo: niente
  cornice, a meno che non sia misurato nudo. Le quattro LR con un `|thumb`
  dichiarato (1032580, 1033940, 1034340, 1034380) hanno già la cornice.

Il fotogramma arriva come le altre ferme, dal ridimensionatore di Fandom
(`scale-to-width-down/256?format=webp`): sugli APNG risponde con un WebP
fermo di circa 30 KB. Se mai restituisse un file che si muove (anche un
APNG: ora il controllo è `siMuove`, che riconosce `acTL`), `fetch-assets`
lo appiattisce al primo fotogramma con `ffmpeg`, come gli artwork animati.

**Quale va in `card.thumb_key`** lo decide `miniaturaVincente`: quella con
la cornice, se c'è e non è misurata nuda (null, non misurata, vale come
incorniciata); altrimenti la ferma; altrimenti quella che c'è.
`collegaMiniature` lo applica a fine giro solo alle carte con almeno un
risultato in quel giro, e fra i soli job chiesti: un job che `--missing` ha
tolto prende chiave e cornice dalla riga di `asset`. Così il giro di prova
(`--missing`, senza file) e la produzione (`--offline`, con l'albero
intero) scelgono allo stesso modo.

**Una chiave nuova, mai una sovrascritta.** Le immagini stanno in cache un
anno, `immutable` (`public/assets/_headers`): un file corretto sotto la
stessa chiave arriverebbe a chi l'aveva già solo quando la sua cache scade.
Per questo la miniatura con la cornice ha la sua chiave,
`cards/<id>/thumb-framed.webp`, e le vecchie `cards/<id>/thumb.webp`
restano, righe e file: niente si cancella. Una correzione futura avrà a
sua volta una chiave nuova. `kindOfKey` (`asset-limits.mjs`) la conta fra
le `card_thumb` nel riepilogo dello spazio.

**Come si riconosce il solo personaggio** (`db/import/asset-cornice.mjs`):
dai pixel, con `ffmpeg`, che l'import usa già. Il primo fotogramma ridotto a
64x64 (`scale=64:64:flags=area,format=rgba`), e due misure sull'alfa:

- la **striscia**, l'alfa medio della barra in basso della cornice (x dal
  30 al 70%, y dall'86 al 92%; a 64 px le colonne 19-44 e le righe 55-58):
  nella cornice del gioco lì c'è la barra del nome, piena; sotto un
  personaggio scontornato è vuota;
- la **copertura**, la parte del riquadro con alfa almeno 128.

Nuda quando la striscia è sotto 0,5 **e** la copertura sotto 0,55. Sulle 2632
miniature collegate di `dokkan_dev`: le 179 nude hanno striscia 0,000 e
copertura 0,264-0,462; le 2453 incorniciate striscia 1,000 e copertura da
0,650 (p01 0,689); i 171 fotogrammi degli APNG striscia 0,797-1,000 e
copertura 0,600-0,697. Nessun falso, nessuna mancata, e ognuna delle due
misure da sola separa già: con tutte e due una cornice doppia su una carta
che l'ha già vorrebbe due sbagli indipendenti. Né il nome né la misura
bastano: le miniature nuove con la cornice sono 255x255 e 11 APNG 120x120, e
un file caricato domani come `Card <id> thumb.png` potrebbe avere la
cornice. Se `ffmpeg` non legge un file (1 su 2632 con ffmpeg 8, una UR
incorniciata) la misura è null, e vale come incorniciata. I test usano 4
maschere alfa 64x64 in `db/test/fixture/cornici` (PGM: solo la sagoma,
nessuna immagine del gioco nel repository; il comando che le ha fatte sta
in `db/test/assets.test.mjs`) e, se c'è `ffmpeg`, file fatti al volo (PNG,
WebP, un APNG di due fotogrammi).

**`asset.frame`** (0034): `true` con la cornice, `false` il solo personaggio,
null non misurato o non una miniatura (il vincolo `asset_frame_card_thumb`
lo tiene solo alle `card_thumb`). Si scrive solo con la riga, in un
download o in un'adozione dal disco; le righe che restano come sono non si
rimisurano. Un'adozione la cui misura non riesce tiene quella di prima
(coalesce, come `source_url`). Il riempimento della 0034 non legge i pixel:
mette `false` alle miniature collegate di LR 250x250, che sul disco
coincidono con le 179 misurate (la produzione serve gli stessi file, con
gli stessi checksum). `asset_bare(key)` dice se una chiave è nuda (false
anche per null, per una chiave senza riga o non misurata): le query delle
pagine la chiamano accanto a ogni `thumb_key` (`lib/queries.ts`,
`lib/cards.ts`, `lib/clears.ts`, `lib/card-page.ts`, `lib/profiles.ts`).
`fetch-assets` senza `asset.frame` si ferma subito e dice di applicare la
0034; `missing-assets.mjs` conta nel riepilogo le carte che il sito
incornicia ("N cards show a drawn frame") e lo scrive in `GITHUB_OUTPUT`
(`bare_thumbs`, accanto a `pending`): il passo "Download new images" del
settimanale parte anche quando non manca nessuna immagine ma qualche
miniatura è nuda, così la `thumb-framed` si riprova a ogni giro in tutti e
due i workflow (il giornaliero parte dal piano, che la conta già).

**La cornice disegnata.** Dove la sola miniatura che abbiamo è nuda (sul wiki
non c'è ancora la versione con la cornice) il sito la mette dentro
`CorniceCarta` (`components/segnaposto.tsx`, misure da `corniceDisegnata` in
`lib/segnaposto.ts`): un bordo col colore del tipo, come la banda dei
segnaposto (`--marchio-1`…`--marchio-5` dentro `.colori-marchio`, `--tenue`
per un tipo sconosciuto), spesso un sedicesimo del lato (1 px a 16, 3 a 48,
6 a 96, 16 a 250), e da 40 px un'etichetta con la rarità ("LR") appena
dentro il bordo, a sinistra: in basso, in alto nelle squadre dei clear,
dove il fondo lo copre Leader o Friend. Inchiostro su `--superficie-2`, la
coppia che il test dei segnaposto prova in ogni tema. Accanto al nome,
nello slot del builder e nel menu "Uses card", si scrivono tipo e classe
(`TipoSenzaMiniatura`), come per una carta senza miniatura: la nuda non ha
il badge del tipo. Vale in tutti gli otto riquadri che mostrano una
miniatura: le squadre dei clear, il builder (slot, picker) e i filtri, la
catena di risveglio, la pagina della carta senza artwork (fino a 250 px e
al 70% del riquadro, quadrata anche su un telefono), il profilo, i premi
delle missioni e le copertine degli eventi. Niente sessione, hook o
`<style>`: il flag viene dai dati, quindi l'HTML in cache è lo stesso per
tutti, e nel builder `bare` sta nello stato del form, mai nel payload.
Il riquadro è `inline-flex` con la sola immagine in flusso, quindi
`align-top`: nei genitori a blocchi (il riquadro di `Carta`, il `<li>` del
profilo) sulla linea di base del testo la riga gli aggiungerebbe sotto la
discesa del font, circa 6 px, e Leader/Friend si staccherebbe dal bordo.
Il 13 ottobre 2026, dopo la riparazione, resterebbero 16 carte con la
cornice disegnata (5 sono copertine di eventi) e 2 LR senza nessuna
miniatura (1034150, 1034200).

**Le miniature non si deformano.** `components/builder/miniatura.tsx` dava
a `next/image` larghezza e altezza anche nello style, senza `object-fit`:
2449 miniature su 2632 non sono quadrate (2088 sono 256x224), e nel picker,
negli slot e nel menu "Uses card" si allungavano di un settimo, su ogni
browser e anche in modalità desktop sul telefono. Ora il riquadro resta
quadrato (le righe restano allineate) e l'immagine ha
`objectFit: 'contain'`: intera, nelle sue proporzioni, col fondo
`--superficie-2` nei due o tre px che avanzano. Le altre miniature davano
solo gli attributi `width` e `height`, e il preflight di Tailwind
(`img { height: auto }`) le teneva giuste. Il test dei segnaposto controlla
ogni `<Image>` dei componenti: larghezza e altezza fissate entrambe (o
`fill`) vogliono un `object-fit`.

**In produzione la 0034 va online PRIMA del codice**, l'ordine contrario
della 0033: le pagine chiamano `asset_bare()` e leggono `asset.frame`, e
`fetch-assets` scrive `frame` in ogni riga, quindi il codice nuovo senza la
0034 darebbe 500 sulle pagine (anche le anteprime di Vercel che puntano
alla produzione) e righe di `asset` rifiutate. La colonna è nullable e senza
default, e la funzione nuova: il codice di prima continua a funzionare
sopra. Quindi `npm run prod:migrate -- --yes` da un export pulito del
commit, poi subito il push su `main`. Se mancasse, il piano del giornaliero
si ferma con il messaggio di `fetch-assets`, e il giro di prova a
`migrate --check`.

**La riparazione** passa dalla strada normale: le chiavi `thumb-framed` non
hanno una riga, quindi `--missing` le prende. I numeri attesi, misurati il
13 ottobre 2026 su `dokkan_dev` e sull'API del wiki:

- 191 job con la cornice: 172 dalle pagine con `|thumb apng` (le 171 nude e
  1032550, senza miniatura) e 19 LR senza `|thumb` né APNG (12 con la
  pagina, 7 senza). Il wiki ne ha 173: le 172 e 1031820 col nome per
  convenzione (120x120). Le altre 18 restano "not on the wiki yet", quiet,
  e si riprovano a ogni giro (circa una richiesta in più all'API);
- 10 miniature ferme nuove, nude, per le LR che non ne avevano (1031920,
  1032010, 1032550, 1033060, 1032710, 1032770, 1033970, 1034030, 1034070,
  1034120), più quelle delle altre carte senza miniatura che nel frattempo
  il wiki avesse caricato;
- righe di `asset` in più: circa 183 per le LR (173 `thumb-framed` e 10
  `thumb`, circa 5 MB), nessuna tolta; carte LR cambiate: 182 (le 171 e
  1031820 dalla nuda alla cornice, 1032550 da niente alla cornice, 9 da
  niente a una nuda);
- nello stesso giro `--missing` prende anche le miniature che il wiki ha già
  per le altre carte senza miniatura: il 13 ottobre su `dokkan_dev` erano
  circa 43 in più, per 257 job in tutto e 30 immagini ancora assenti dal
  wiki. I numeri del riepilogo saranno quindi più alti dei soli 183.

In sviluppo, a codice arrivato e test verdi (finché la 0034 manca, le pagine
del server di sviluppo e `next build`, che prerenderizza da `dokkan_dev`,
falliscono con `function asset_bare(text) does not exist`: è il primo passo):

1. `npm run db:up`: la 0034. Controllo: `select count(*) from asset where
   frame = false` dà 179;
2. `npm run db:assets -- --only thumb --missing`: la stessa strada della CI,
   circa 6 richieste `imageinfo` e circa 226 download dalla CDN (le 183 LR
   più le altre miniature che il wiki ha già). Dal Mac la CDN del wiki può
   rispondere con il controllo anti-bot (403): lo script si ferma al primo
   e si riprova un altro giorno, oppure ci pensa il giro della CI;
3. `npm run cache:clear`;
4. controlli in sola lettura: `select count(*) from card where thumb_key
   like 'cards/%/thumb-framed.%'` dà 173; `select count(*) from card c join
   asset a on a.key = c.thumb_key where a.frame = false` dà 16; `select
   count(*) from card where rarity = 'LR' and thumb_key is null` dà 2; le
   vecchie `cards/<id>/thumb.webp` ci sono ancora tutte.

In produzione:

1. `npm run prod:migrate -- --yes` (da un export pulito del commit), poi il
   push su `main`. Controllo: `select count(*) from asset where frame =
   false` dà 179 (se è meno, le righe che mancano restano null: nessuna
   cornice disegnata, come oggi);
2. GitHub Actions, Daily images, Run workflow su `main` con `dry_run`
   acceso: "Dry run: would fetch ≈226 files (up to ≈775 MB)": le 183 LR più
   le miniature che il wiki ha già per le altre carte senza. I MB contano gli
   APNG originali (4,4 MB l'uno): i download veri sono fermi di circa 30 KB,
   e il riepilogo lo dice ("Of these, N are framed stills from animated
   thumbnails"). Non il venerdì: il cancello salta se il settimanale gira o
   è in coda;
3. lo stesso con `dry_run` spento. Il giro fa il resto da solo: il backup,
   `fetch-assets --missing` sul giro di prova, il confronto (asset circa +226 e
   0 tolte, card circa 225 cambiate e 0 tolte: "All within limits", perché
   `db/prod/limits.json` limita solo le righe tolte e i totali, e
   `compare.mjs` non ha un tetto alle righe cambiate o aggiunte; non c'è
   niente da cambiare), l'albero con i file nuovi (≈6430 file sui 20000 di
   Pages), il deploy, `update.mjs --images-only` (con `--offline` adotta i
   file nuovi dall'albero e misura la cornice dagli stessi byte del giro di
   prova) e il controllo dopo, uguale al giro di prova;
4. dopo: le pagine del catalogo e la lista degli eventi si rinfrescano; le
   liste dei clear in cache mostrano le miniature nuove quando la loro
   cache scade (le vecchie URL funzionano ancora). Il riepilogo delle
   immagini dice "16 cards show a drawn frame".

Lo stesso lo fa il settimanale del venerdì nel suo passo dei download, una
volta che `WEEKLY_APPLY=true`.

### Il giro giornaliero delle immagini

La CDN del wiki a volte risponde 403 con il controllo anti-bot di
Cloudflare, e un giorno dopo di solito no: il 9 ottobre 2026 il runner di
GitHub ha scaricato 42 immagini su 45, il 10 ottobre il Mac riceveva il
403. `.github/workflows/daily-images.yml` riprova ogni giorno quelle che
mancano, con gli stessi script, gli stessi secret e le stesse guardie del
settimanale. Riscaricarle dal Mac non serve più.

- **Quando**: ogni giorno alle 06:41 UTC tranne il venerdì (`41 6 * *
  0-4,6`), lontano dai cron di Vercel delle 4 e delle 17: il venerdì le
  immagini le chiede il settimanale, alle 03:17. Si lancia anche a mano,
  con `dry_run` acceso per difetto.
- **Mai insieme al settimanale.** Un primo job senza environment né secret
  (`gate`) guarda con `gh run list` se il settimanale gira o è in coda, e
  in quel caso salta a domani: chi entra in un gruppo di concorrenza
  cancella chi vi stava aspettando. Poi il job delle immagini sta nello
  stesso gruppo del settimanale (`prod-data`, `cancel-in-progress: false`).
  `actions: read` ce l'ha solo `gate`, che non ha altri permessi e non fa
  nemmeno il checkout; il job delle immagini, quello con i secret, ha
  solo `contents: read`.
- **La cache** è quella di Actions del settimanale, solo letta e mai
  salvata (leggerla ogni giorno la tiene viva). Niente artifact di riserva:
  quello del settimanale ha solo il wiki, e senza il datamine
  `assignCardIds` non riconosce le pagine con l'id da `|ID` o da un
  abbozzo. Senza cache non fa niente. Le pagine pubblicate in settimana
  aspettano il venerdì.
- **Il piano**, in sola lettura sulla produzione:
  `missing-assets.mjs --prod --plan` (il bersaglio da `target.mjs`, TLS
  verificato, niente database locale senza `--allow-local`) lancia
  `fetch-assets --missing --plan`, che chiede all'API del wiki quali file ci
  sono e quanto pesano ed esce prima di scaricare. Il riepilogo ha anche lo
  spazio (`storage.mjs --prod`) e la freschezza delle fonti.
- **In prova** (`WEEKLY_APPLY` diverso da `true`, la stessa variabile del
  settimanale con la stessa espressione, o `dry_run` a mano) si ferma lì:
  "Dry run: would fetch N files (up to X MB); M not on the wiki yet.
  Production not touched." Nessun dump, nessun download dalla CDN, nessun
  deploy, nessuna scrittura. Lo stesso, con APPLY acceso, quando non c'è
  niente da scaricare.
- **Con `WEEKLY_APPLY=true`** e qualcosa da scaricare: il backup cifrato
  (artifact tenuto 7 giorni), il giro di prova dal dump con `migrate
  --check`, `fetch-assets --missing --report` sul giro di prova con il
  manifesto, il confronto con i limiti (bloccante: in un giro di sole
  immagini una cancellazione è un errore), l'albero completo, la guardia
  dello spazio, il deploy su Cloudflare Pages, il controllo che i file nuovi
  siano serviti, `prod:update -- --images-only` e il controllo dopo contro
  il giro di prova. Al massimo 40 minuti.
- **`update.mjs --images-only`** fa solo `fetch-assets --offline`
  (`PIPELINE_IMAGES` in `db/prod/pipeline.mjs`): adotta i file appena
  pubblicati e li collega, con lo stesso lucchetto di `import_run`, lo
  stesso controllo dello schema e lo stesso rinfresco delle pagine. Chiude
  `import_run` con `summary.mode = 'images'` e senza commit del datamine, e
  `last-run.mjs` lo ignora: un giro delle immagini non fa credere al
  settimanale che il commit di oggi sia già importato. Le copertine degli
  eventi e le icone dei premi si riallineano al giro completo dopo.
- **Un 403 non si aggira mai**: niente altri User-Agent, niente browser. Al
  primo 403 della CDN `fetch-assets` non comincia più nessun download, e il
  resto conta come "challenged" per domani; al primo 403 dell'API, o con
  l'API che non risponde dopo i ritenti, smette di chiamarla. Si ritentano
  i 408, 425, 429, 5xx e gli errori di rete: 4 volte dopo il primo
  tentativo (1,6, 3,2, 6,4, 12,8 s), con `Retry-After` rispettato fino a
  60 s, e al massimo 60 s per un download e 30 s per una chiamata all'API
  (`esitoHttp` e `attesaRitento` in `db/import/asset-select.mjs`).
- Fra le cose da guardare c'è una riga solo quando la CDN ha sfidato dei
  download o i ritenti sono finiti ("the daily image pass retries
  tomorrow"). Il vecchio "run npm run db:assets on the Mac" non c'è più.

### Spazio e limiti

Cloudflare Pages Free accetta al massimo 20.000 file per deploy e 25 MiB
per file; oltre, il deploy fallisce a metà. Gli artwork animati si tengono
(decisione del proprietario), ma con un tetto per file e un budget in tutto.
Le soglie stanno in `db/import/asset-limits.mjs` e valgono insieme per la
CI, il Mac e i test:

| limite | valore | perché |
|---|---|---|
| file per deploy (`PAGES_MAX_FILES`) | 20.000, avviso all'80% (16.000), deploy rifiutato sopra | il limite di Pages; oggi 6247 file con `_headers`, il 31,2% |
| un file (`PAGES_MAX_FILE_BYTES`) | 25 MiB, deploy rifiutato sopra | il limite di Pages |
| un artwork animato (`ANIM_ART_MAX_FILE`) | 12 MiB, si salta sopra | il più grande di oggi è 9,97 MiB (p99 10,4 MB, media 8 MB): il 20% sopra, metà del limite di Pages |
| tutti gli artwork animati (`ANIM_ART_BUDGET`) | 1 GiB, avviso all'80% (819 MiB), si salta sopra | oggi 677,7 MiB, il 66%: posto per una ventina di animazioni, e dal 2021 ne sono uscite 9-25 l'anno |
| una miniatura animata (`ANIM_THUMB_MAX_FILE`) | 1 MiB, si salta sopra | nessuna pagina le mostra (`thumb_animated_key`), e un APNG del wiki pesa circa 5 MB |

Su `dokkan_dev`, il 10 ottobre 2026: `card_art_animated` 678 MiB (170
righe: 88 collegate, 673 MiB, e 82 fotogrammi appiattiti scollegati, 4,6
MiB), `card_art` 433, `event_banner` 69, `card_thumb` 60,
`card_thumb_animated` 4,5, le icone meno di 1. Il budget conta ogni riga
del kind, anche i fotogrammi scollegati. Delle 46 carte senza pagina
nessuna ha un animato, quindi la crescita potrebbe essere quasi ferma.

- **Il tetto degli animati** lo applica `fetch-assets`: guarda la
  dimensione che `imageinfo` dà prima di scaricare (gli animati hanno un
  nome `File:` anche quando la pagina incolla un URL), e se non la sa la
  ricontrolla dopo il download. Un file oltre il tetto o oltre il budget
  si salta (l'artwork fermo è un job a parte e resta); il totale corre fra
  i download paralleli. In CI un `::warning::` quando gli animati passano
  l'80% del budget; il `--report` conta i saltati (`over_cap`,
  `over_budget`).
- **`db/prod/storage.mjs`** fa il conto: `--tree <dir>` conta l'albero che
  sta per andare su Pages (per kind, `_headers` compreso), senza `--tree`
  la tabella `asset` (`DATABASE_URL`, o `--prod` con `PROD_DATABASE_URL`;
  solo SELECT in una transazione read only). `--out` scrive la tabella per
  kind con i file contro i 20.000 e gli animati contro il budget,
  `--attention` aggiunge una riga fra le cose da guardare dall'80% in su, e
  `--guard` rifiuta il deploy ("deploy refused: production not touched")
  con troppi file o un file oltre 25 MiB.
- **Nei workflow**: un passo "Storage guard" prima di ogni `wrangler pages
  deploy` (la CI usa wrangler, non `scripts/assets-deploy.mjs`, e il
  controllo dei 20.000 file in CI prima non c'era), e la sezione "Storage"
  nel riepilogo del settimanale e del giornaliero. Nel settimanale c'è ogni
  settimana: dopo le immagini la conta il giro di prova ("Images summary");
  se quel passo non c'è stato (niente di nuovo, `GO=false`, il ripiego del
  datamine, un giro fermato prima) la conta "Storage summary" sulla
  produzione, in sola lettura, con `continue-on-error`.
- **Dal Mac** `npm run assets:deploy` stampa la stessa tabella per kind e
  gli stessi avvisi dall'80%, e rifiuta come prima un albero oltre i
  limiti.

Per cambiare una soglia si cambia la costante in `asset-limits.mjs`, con il
commento che spiega il numero, e i casi di `db/test/assets.test.mjs` che la
provano (i tetti degli animati usano le costanti, i conti dei file sono
scritti in cifre: 15.998, 16.000, 20.000).

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

**Due versioni, una pagina ciascuna.** Ogni evento ha la pagina Global
(`/events/<id>`) e quella Japan (`/events/<id>/japan`), con stato, date e
clear della sua versione e le stesse tip; le due home sono `/events` e
`/events/japan`, statiche. Quale si apre lo decide la versione scelta da
chi guarda (sezione "Versione Global/Japan"). Un evento con la run in una
versione sola si apre anche nell'altra, senza 404 né pagine vuote: lo dice
("No Japan dates", al posto dello stato) e porta alla versione dove
c'è.

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
la cui carta non abbiamo (manca anche la copertina: 19 eventi). Al posto
del banner la lista e la pagina mostrano la carta del boss, e senza nemmeno
quella un segnaposto con l'icona del tipo di evento (sezione "Segnaposto
delle immagini"). Le missioni il gioco le ha, ma non sono ancora importate.

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
  `/settings` (handle, versione del sito, artwork, metodi di accesso collegati, scollegare,
  clear nascosti, cancellare l'account). Nell'header, dentro un
  `<Suspense>`, "Sign in" oppure l'utente; sotto i 1024 px le voci vanno nel
  burger (`components/auth/menu-mobile.tsx`) e fuori resta la campanella,
  così accanto al marchio c'è posto per il nome intero.

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
  `_`, non riservato, non preso né lasciato da un altro) con
  `complete_onboarding`. Dopo si cambia da Settings, una volta ogni 30
  giorni (sezione "I profili pubblici"). Chi nasce da SQL (fixture, seed,
  test) ha `onboarded_at` già pieno.
- La regione di `/welcome` è la versione del sito (sezione "Versione
  Global/Japan"): `/welcome` propone quella già scelta sul dispositivo
  (altrimenti quella dell'account), e il form la scrive anche nel cookie
  `dts_version`. Dopo si cambia dall'interruttore del menu o da Settings >
  Display > Game version (`set_region`, 0035), e vale anche per "Plays
  Global/Japan" del profilo pubblico. All'accesso di un account completo
  vince l'account, come per il tema; l'uscita e la cancellazione lasciano
  la scelta al dispositivo.
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

**Per la produzione** servono le callback presso i provider, Google "In
production", Resend e le variabili sull'host (sezione "Messa online").
Senza `RESEND_API_KEY` o `EMAIL_FROM` il server di produzione **non
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
- *La sessione fresca.* Scollegare, collegare un provider, cambiare
  l'handle e cancellare l'account chiedono un accesso di meno di 15 minuti (`lib/auth/fresh.ts`,
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
  L'handle di ogni clear e commento porta al profilo dell'autore; da 2
  clear in su, sopra la lista c'è la barra dei filtri (sezioni "I filtri
  dei clear" e "I profili pubblici").
- **`/events/[id]/submit?region=&tier=`** e **`/events/[id]/clears/[clearId]/edit`**:
  lo stesso builder (`components/builder/`). Lo stato è un `useReducer`
  puro in `lib/clears/builder-stato.ts` e parte come un solo campo JSON;
  prima dell'invio passa `parseBuilderPayload`, lo stesso controllo
  dell'azione. Il picker è un `<dialog>` modale (a schermo pieno sotto i
  640px) su `/api/cards`, con frecce, Enter ed Escape. Propone le carte
  uscite nella versione del clear (`reg` di `/api/cards`, Global per
  difetto, 400 per un valore sconosciuto): le carte solo giapponesi si
  usano nei clear Japan. Il builder manda `reg` solo per Japan, così le
  ricerche di Global restano gli stessi URL, e le stesse voci della CDN.
  La regione la dice sempre l'URL (`submitHref` la mette anche per
  Global), non la versione scelta nel sito: si apre il builder delle run
  della pagina da cui si parte. In modifica la
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

`/cards/<id>` è pubblica e in cache come le pagine evento: non legge mai la sessione. Le letture stanno in `lib/card-page.ts` (pure, provate da `db/test/card-page-ui.test.mts`), la cache in `lib/cache/cards.ts`: la carta con il tag `card:<id>` e `catalog`, i clear che la usano con `card:<id>` e `community`, che le scritture sui clear invalidano già. Al build si prerenderizzano al massimo 100 carte (le più usate nei clear); le altre nascono alla prima visita e poi restano in cache. L'id della forma Z (quello della base più uno) porta alla base con un 308; un id che non è una carta è un 404 vero.

La pagina è una sola per le due versioni (sezione "Versione Global/Japan"). Una carta uscita in tutte e due ha due blocchi di clear, quelli di Global e quelli di Japan: la pagina li legge entrambi, e il CSS mostra quello della versione di chi guarda (`japan:hidden` e `hidden japan:block`). Una carta uscita in una versione sola ha un blocco solo, sempre visibile. Con due blocchi, quello vuoto dice di quale versione parla ("No Japan clears use this card yet.") e, se l'altra ha dei clear, lo dice col link al migliore ("On Global it's in 4 clears, the top one in …"): chi guarda ne vede uno solo, e "nessun clear" della sua versione non è vero per la carta. Le carte uscite solo in Giappone si aprono lo stesso, con "Not released on Global yet." (a chi è su Global) e i clear della versione giapponese; a chi è su Japan, una carta uscita solo su Global dice "No Japan release date on the wiki yet.". I link ai clear dei blocchi dicono la versione (`?region=global`, o il percorso `/japan`), i link agli eventi EZA no: seguono la versione di chi guarda.

La pagina mostra le skill per livello (Base, EZA, Super EZA) e si apre sul livello più alto che la carta ha. Una sezione che il wiki non riscrive per l'EZA prende il testo del livello sotto, segnato "Unchanged from EZA". Seguono link skill con l'effetto, categorie, la catena del Dokkan Awakening, i 10 clear migliori che usano la carta (prova, voti, i più recenti) con "Used in N clears". Ogni clear porta alla pagina del suo tier dove si vede davvero: la pagina si calcola con lo stesso `ORDINE_CLEAR` della lista. In fondo c'è il link alla pagina del wiki da cui vengono i testi (CC BY-SA).

L'artwork parte sempre statico: è l'immagine che si vede subito, e chi non è entrato non scarica mai l'animato (in media 4 MB, circa 25 volte lo statico). Chi è entrato sceglie il default in Settings > Display > Artwork (`set_prefers_animated`, letto da `/api/me`). Movimento ridotto o risparmio dati riportano a statico un default "Animated", ma mai la scelta fatta su una carta. Quella scelta resta nel localStorage del dispositivo (`dts:card-art`, al massimo 200 carte), mai nel database. La logica sta in `lib/card-art.ts`.

I nomi delle carte nei clear portano alla pagina nella stessa scheda, senza prefetch (20 clear per 7 carte farebbero 140 prefetch a pagina). Dal builder, l'icona dello slot e il link sotto il picker aprono una scheda nuova, perché il builder non salva la bozza. La sitemap ha tutte le carte uscite su Global.

## I filtri dei clear

La lista dei clear di un tier si può filtrare e ordinare. I filtri valgono per il tier (stage o livello EZA) e la regione scelti: non c'è una vista "tutti i clear con questa carta" fra eventi.

| Parametro | Significato |
|---|---|
| `proof=1` | con una prova raggiungibile |
| `noitems=1` / `noko=1` | senza oggetti / senza KO |
| `turns=N` | al massimo N turni (1-99); i clear che non dicono i turni restano fuori |
| `card=<id>` (fino a 3) | usa TUTTE queste carte, in qualsiasi assetto (anche i cambi a metà evento), in qualsiasi ruolo |
| `leader=<id>` | il leader dell'assetto di partenza (il friend non conta) |
| `mono=AGL\|TEQ\|INT\|STR\|PHY` | ogni carta di ogni assetto di quel tipo; la classe non conta |
| `class=super\|extreme` | ogni carta Super, o ogni carta Extreme |
| `cat=<id>` | ogni carta di ogni assetto ha quella categoria |
| `sort=top\|new\|turns` | Top (prova, poi voti: l'ordine di sempre), Newest (prima pubblicazione, una revisione non conta), Fewest turns (senza turni in fondo) |

Un valore sbagliato vale "non impostato" (mai un 500), e ogni valore arriva alle query come parametro legato; l'ORDER BY è una di tre costanti. Il parsing sta in `lib/clears/filtri.ts` (puro), la parte SQL in `lib/queries.ts` (`filtroClear`, `listClears` con i filtri, `countClears`, `getClearFacets`).

**Dove stanno.** La pagina del tier (`/events/<id>/t/<tier>`) resta statica e in cache: mostra solo la barra dei filtri (da 2 clear in su), con le opzioni contate su tutti i clear del tier (`getClearFacets`, in cache col tag `event:<id>` in `lib/cache/filters.ts`). Scegliere un filtro porta a `/events/<id>/clears?tier=...&...` (`clearListHref` in `lib/urls.ts`), una pagina dinamica (una invocazione per vista) con la stessa pagina dell'evento e la lista filtrata. Togliere tutti i filtri riporta alla pagina statica. La barra è un vero form GET: funziona anche senza JavaScript.

**Perché la lista filtrata non è in cache.** Le combinazioni dei filtri sono senza fine: in cache ogni voce occuperebbe memoria per una visita sola. Per lo stesso motivo le viste filtrate sono noindex con il canonical al tier senza filtri, `robots.txt` esclude `/events/*/clears`, e i chip dei filtri attivi sono link `rel="nofollow"` senza prefetch: un bot non deve poterle girare tutte (CPU di Vercel, query di Supabase).

**I dati delle carte.** I filtri si calcolano dal vivo su `card` e `card_category`: un import che cambia le categorie di una carta cambia anche quali clear passano il filtro. Le carte che esistono solo nei dati del gioco (0015) possono non avere categorie, e allora non passano nessun filtro di categoria: è corretto, non è provato che ci appartengano.

Le prove: `npm run test:filtri` (parametri e URL, niente database), i passi "filtri dei clear (parametri)" e "filtri dei clear" di `npm run db:test`, e `test:smoke` (noindex, canonical, valori sbagliati, `tier=abc` 404).

## I profili pubblici (migrazione 0026)

`/users/<handle>` (e `/users/<handle>/p/<n>` dalla pagina 2) è pubblica e in cache come eventi e carte: non legge mai la sessione. Mostra l'handle, la versione del gioco ("Plays Global" o "Plays Japan": è `app_user.reg`, la stessa scelta dell'interruttore della versione del sito, quindi cambiarla cambia anche il profilo, che si invalida), il mese d'iscrizione, i conteggi (clear pubblicati, voti +1 ricevuti su tutte le versioni dei clear pubblicati, commenti pubblicati su clear pubblicati) e la lista dei clear, 20 per pagina, dal più recente. Niente avatar (la privacy promette che l'immagine del provider non si mostra), niente ruolo, niente email, niente commenti. Ogni riga porta alla pagina del tier dove il clear si vede davvero, calcolata con lo stesso `ORDINE_CLEAR` della lista dell'evento, nella versione del clear (il link la dice: `?region=global` o `/japan`). Il proprietario vede in più "Edit profile" (un'isola che legge `/api/me`). I profili senza clear sono noindex, e i profili non sono nella sitemap.

Ogni handle del sito (clear, commenti, tip, Settings, header) passa da `components/handle-link.tsx`, che costruisce l'URL con `profileHref` di `lib/urls.ts`, senza prefetch. Nell'header l'handle porta al profilo e Settings ha un link suo (sul telefono sono due voci del burger).

Le letture stanno in `lib/profiles.ts` (pure) e leggono gli utenti SOLO dalla vista `public_profile`, che ha un elenco chiuso di colonne (un test lo controlla). La vista esclude chi non ha finito /welcome e chi è sospeso (`user_suspended`, 0024): il loro profilo è un 404 come quello di chi non esiste. La cache sta in `lib/cache/profiles.ts`, con i tag `profile:<handle>` (minuscolo), `community` e gli `event:<id>` degli eventi dove l'utente ha clear o commenti, così voti e commenti rinfrescano i conteggi. Al build si prerenderizzano i 20 profili con più clear.

L'handle si cambia da Settings > Handle, con un accesso recente (15 minuti, come scollegare un provider o cancellare l'account). Le regole le impone `change_handle`:
- un cambio vero ogni 30 giorni (`app_user.handle_changed_at`); cambiare solo le maiuscole è sempre libero;
- il nome lasciato va in `handle_history` e resta riservato all'utente finché l'account esiste: `/users/<vecchio>` porta al nuovo con un 308, e l'utente può riprenderselo;
- chi è sospeso non lo cambia.

Ogni presa di un handle (/welcome e Settings) passa da `handle_assert_free`, sotto un lock consultivo per handle: due richieste per lo stesso nome passano una alla volta, e la seconda riceve `handle_taken`. Cancellare l'account porta via `handle_history` (cascata), quindi i vecchi nomi tornano liberi: scelta accettata. Dopo un cambio, `afterUserChanged(userId, { extraHandles: [vecchio] })` invalida le pagine degli eventi e delle carte con i suoi clear, commenti, tip e voti, e i profili vecchio e nuovo. `userFootprint` mette nel conto anche tutti i nomi di `handle_history`: così sospensione, fine sospensione e cancellazione dell'account rinfrescano anche `/users/<vecchio>` (un 404 in cache visto durante una sospensione porta solo il tag del vecchio nome). I rifiuti hanno un nome tradotto da `lib/auth/handle-change.ts`, la stessa tabella che usa /welcome. Le verifiche sono nel passo "profili pubblici" (`db/test/profiles.test.mts`) e in `test:smoke` (un profilo, il 308 delle maiuscole, i 404).

## Logo e icone

Il marchio è l'"Anello Ki": cinque settori, uno per tipo (AGL, TEQ, INT, STR, PHY in senso orario dall'alto), con al centro il disco oro del leader. I colori sono fissi e non seguono i temi: un tema colorato potrebbe rendere due settori uguali, o un settore uguale allo sfondo. C'è una variante per i fondi chiari e una per quelli scuri, e sceglie il solo CSS (`data-theme` su `<html>`, oppure il tema del sistema), quindi l'HTML resta uguale per tutti. Le variabili `--marchio-0`…`--marchio-5` stanno in `app/globals.css`, in tre regole che valgono per la classe `marchio` (l'SVG di `components/brand/marchio.tsx`) e per `colori-marchio` (i segnaposto delle carte): la chiara, la scura col sistema scuro, la scura dei temi scuri. Stanno lì una volta sola, e non in uno `<style>` del componente: ogni segnaposto ne metteva una copia (circa 765 byte) nel payload RSC delle pagine in cache. Un tema scuro nuovo va aggiunto alla lista della terza regola; un id sconosciuto resta chiaro.

Gli SVG sorgente stanno in `scripts/brand/svg/`. Da lì si generano le icone e l'anteprima dei link:

```bash
npm run brand    # node --experimental-strip-types ... scripts/brand/genera.mjs
```

Lo script scrive `app/icon.svg`, `app/favicon.ico` (16, 32 e 48 px), `app/apple-icon.png`, `app/opengraph-image.png`, `app/twitter-image.png` e i due `.alt.txt`. Per la PWA scrive anche `public/pwa/` (icone 192 e 512, maskable 192 e 512, badge 96) e `public/offline.html` (vedi la sezione PWA). Il flag `--experimental-strip-types` serve perché la pagina offline riusa `lib/tema/temi.ts`. Next li trova per nome: sono file statici, quindi niente codice al build e niente query. `metadataBase` in `app/layout.tsx` (da `BETTER_AUTH_URL`) rende assoluti gli URL di og:image e twitter:image.

Per cambiare la forma o un colore si modifica `scripts/brand/sorgenti.mjs` (la geometria è in `anello.mjs`). Poi si lancia `node scripts/brand/sorgenti.mjs` e si ricopiano i `d` in `marchio.tsx` e i colori nelle regole del marchio di `app/globals.css`: `genera.mjs` si ferma se non coincidono (`scripts/brand/colori.mjs`, lo stesso controllo del test dei segnaposto).

Il testo dell'anteprima usa Geist Regular (SIL OFL 1.1), preso dalla copia inclusa in next.

## Temi

Il sito ha undici temi: **System** (per difetto: segue il chiaro o lo scuro del sistema operativo), **Light**, **Dark** e otto temi colorati: AGL Night, TEQ Jade, INT Nebula, STR Ember, PHY Sand, LR Gold, OLED Black e High contrast. Si sceglie dal selettore nel footer (anche senza account) o da Settings, sezione Display.

Come funziona:

- **Solo nel browser.** Il tema è l'attributo `data-theme` su `<html>`. Lo mette uno script sincrono nel `<head>` di `app/layout.tsx` prima del primo paint, leggendo `localStorage['dts:tema']`, quindi la pagina non lampeggia. L'HTML del server resta identico per tutti, e le pagine pubbliche restano in cache. Senza attributo vale System.
- **La barra del browser.** Lo script mette anche un `<meta name="theme-color">` suo in testa al `<head>`, con lo sfondo del tema: vince sui due per media query del layout, che valgono per System (`BARRA_SISTEMA`). Il colore è scritto in maiuscolo (`coloreBarra`, lo stesso per `applicaTema`): React prende come suoi i `<meta>` già nel documento confrontando `content` e `name`, non `media`, e con Light o Dark, che hanno gli stessi colori dei due del layout, prendeva il nostro. Al primo giro del layout dal server (un'azione che scrive un cookie, come l'interruttore della versione su una carta o in Settings) lo toglieva, e la barra perdeva il tema; dopo un cambio di tema, con il nostro già tolto, il commit si rompeva su `removeChild` e l'interruttore restava occupato. `db/test/temi.test.mts` controlla che nessun tema scriva un colore uguale, come testo, a uno dei due del layout. La pagina offline (`public/offline.html`) usa lo stesso script, quindi dopo un cambio qui va rigenerata.
- **I colori** stanno in `app/globals.css`: un blocco `[data-theme="..."]` per tema, ognuno con gli stessi 17 token e `color-scheme`. Gli id e i nomi stanno in `lib/tema/temi.ts`.
- **Sull'account.** Chi ha un account salva il tema anche in `app_user.theme` (migrazione 0027, `set_theme`; null = System). `/api/me` lo restituisce, e se è diverso da quello del dispositivo `ViewerProvider` lo applica e lo ricorda. Il tema dell'account vince su quello del dispositivo.
- **Accessibilità.** Testo, oro e tipi stanno ad almeno 4.5:1 su sfondo, superficie e superficie-2, e il bordo dei campi ad almeno 3:1. Il colore non è mai l'unico segnale: le etichette AGL/TEQ/INT/STR/PHY restano scritte. High contrast non si attiva mai da solo con `prefers-contrast`, perché è un tema chiaro.
- **Test.** `db/test/temi.test.mts` (il passo "temi" di `npm run db:test`) legge `app/globals.css` e controlla tutti i contrasti. Un tema nuovo va aggiunto in tre posti: `lib/tema/temi.ts`, `app/globals.css` e il vincolo `app_user_theme`, con una migrazione (più la regola scura del marchio in `app/globals.css`, se è scuro). Il test fallisce se le tre liste non coincidono.
- **In produzione** la migrazione 0027 deve arrivare prima del codice: la sessione di better-auth legge `app_user.theme`, e senza la colonna l'accesso si rompe.

## Versione Global/Japan (migrazione 0035)

Il sito mostra una versione del gioco alla volta, scelta da chi guarda: **Global** (per difetto, anche per chi non è entrato e per i motori) o **Japan**. Cambia eventi, date, clear, i blocchi della pagina della carta e le carte del picker del builder. L'origine resta una (niente host o domini per versione); le pagine evento giapponesi tengono il loro segmento `/japan`, così ogni versione è una pagina in cache, condivisibile e indicizzabile. Carte, profili, Settings e notifiche hanno un URL solo per tutte e due.

**Dove si sceglie.** Un interruttore Global | Japan (`components/versione/scelta-versione.tsx`):

- sotto i 1024 px è la **prima riga del burger**, sopra Events, perché cambia tutto quello che c'è sotto;
- dai 1024 px (niente burger) è un **controllo compatto a sinistra nell'header, subito dopo "Events"**, per tutti, anche senza account. Sta lì perché lì niente prima di lui cambia larghezza: la parte di destra arriva da `/api/me` ("Sign in", o handle, campanella e Settings) e cambia con chi guarda, e nella parte di destra il controllo si spostava a ogni caricamento. Così resta fermo dal primo paint, in ogni stato;
- in **Settings > Display** è la prima riga, "Game version" (sotto arriverà la lingua).

Sul telefono, in Japan, sull'angolo del bottone del burger c'è un tag "JP" (solo CSS, decorativo, fuori dal flusso come il pallino della campanella: a 320 px, con la campanella, il nome intero del sito ci sta solo così; sta sopra le righe dell'icona, con un bordo del colore dell'header che lo stacca; con il focus da tastiera sul bottone si toglie, `group-focus-visible:invisible`, perché sull'angolo starebbe sopra l'anello del focus, che va visto intero), e il bottone si chiama "Menu, Japan version". I link "Events" dell'header e del burger e il marchio portano alla home della versione (`components/versione/link-eventi.tsx`: `/events` nell'HTML, `/events/japan` dopo l'idratazione per chi è su Japan). I chip "Version: Global | Japan" della lista degli eventi non ci sono più.

**Lo stato.** Il cookie `dts_version`: `japan`, oppure nessun cookie (Global, che non si scrive mai come `global`). Non è un segreto e non è httpOnly (lo legge lo script del `<head>`), SameSite Lax, Path /, 400 giorni (il tetto di Chrome), Secure solo su https (`opzioniVersione`, come l'indizio `dts_signed_in`). Lo scrive **solo il server**: l'azione dell'interruttore (`setVersionAction`), l'hook di better-auth dopo l'accesso e `/welcome`. Mai `document.cookie`: Safari tiene al massimo 7 giorni un cookie scritto dal browser, e un test lo vieta. Per chi ha un account completo la scelta sta anche in `app_user.reg` (`set_region`, 0035): la stessa colonna di "Plays Global/Japan" del profilo pubblico (scelta accettata dal proprietario).

**Gli URL, e chi vince.** Un URL che dice la versione è *marcato* e vince sempre: un percorso `/japan` o un `?region=` (`global` o `japan`). Gli altri seguono la scelta di chi guarda: con `dts_version=japan` li spostano i redirect di `next.config.ts` (`redirects()`, `permanent: false` cioè 307 e mai 308, con `has` sul cookie e `missing` su `region` e sull'header `next-action`), che girano nel routing, prima delle pagine e del proxy. Su Vercel diventano regole della CDN: nessuna funzione, nessuna CPU. `proxy.ts` resta solo per `/admin`.

| con `dts_version=japan` | porta a |
|---|---|
| `/`, `/events` | `/events/japan` (la query passa, anche `?account=deleted`) |
| `/events/<id>`, `/events/<id>/t/<tier>` | `/events/<id>/japan`, `/events/<id>/japan/t/<tier>` |
| `/events/<id>/t/<tier>/p/<n>` | `/events/<id>/japan/t/<tier>`: la pagina si perde, di là può non esserci (sarebbe un 404) |
| `/events/browse`, `/events/<id>/clears` | lo stesso con `region=japan`; una pagina oltre l'ultima mostra il riquadro, non un 404 |
| `/events/<id>/submit` | lo stesso con `region=japan` (solo i link vecchi: `submitHref` la mette sempre) |

Non si spostano mai: i percorsi `/japan` e `/events/japan`, ogni URL con `region=`, le POST delle Server Action (header `next-action`), la modifica di un clear, `/cards`, `/users`, `/notifications`, `/settings`, `/welcome`, `/login`, `/admin`, `/api`, `/events/abc` (resta un 404), e chi non ha `dts_version=japan` esatto (nessun cookie, `global`, `japan2`). La query passa alla destinazione, compreso il `_rsc` delle navigazioni del client; nessuna destinazione viene spostata di nuovo. Chi non ha scelto Japan e i motori vedono esattamente le pagine di prima, con gli stessi canonical; la sitemap ha in più `/events/japan` (non le pagine evento Japan: per ora no). Le maiuscole nel percorso non contano, come nel router di Next (`experimental.caseSensitiveRoutes` resta spento): col cookie `/Events/5` e `/events/5/T/4` vanno a `/events/5/japan` e `/events/5/japan/t/4`, e `seguiVersione` fa lo stesso; la chiave della query invece conta com'è (`?REGION=global` non marca niente). Lo stesso per le barre: prima delle regole il router fa due 308 suoi, uno per le barre ripetute e le `\` (`resolve-routes`) e uno per la barra in fondo (la regola interna di `trailingSlash: false`), quindi col cookie `/events/5/` e `/events//5` arrivano a `/events/5/japan` dopo un 308 e un 307; `seguiVersione` pulisce il percorso allo stesso modo prima di leggere le regole.

| link aperto | chi è su Global (o senza cookie) | chi è su Japan |
|---|---|---|
| `/events/1/t/5` (senza versione) | la pagina Global | 307 a `/events/1/japan/t/5` |
| `/events/1/japan/t/5` | la pagina Japan, con l'avviso | la pagina Japan |
| `/events/1/t/5/p/2?region=global#clear-9` (ogni link a un clear) | la pagina Global, al clear | la pagina Global, al clear, con l'avviso |
| `/events/1/t/5/p/2#clear-9` (un link vecchio) | la pagina Global, al clear | 307 al tier Japan, senza il clear (accettato, solo per i link vecchi) |
| `/events/browse?type=story` | Global | 307 con `region=japan` |
| `/cards/1`, `/users/x`, `/notifications/<id>` | lo stesso URL | lo stesso URL; la carta mostra il blocco Japan |

Guardare l'altra versione da un link marcato vale una pagina: il primo link senza versione torna alla propria. Per restarci c'è "Use … everywhere" nell'avviso.

- **I link espliciti.** `eventHref({..., explicit: true})` aggiunge `?region=global` (prima di `#clear-N`; per Japan basta il percorso). Lo usano tutti i link a un clear preciso (le notifiche di clear e commenti, il profilo, la pagina della carta, il feed degli admin, la moderazione, i redirect delle azioni dei clear, i link "indietro" del builder) e quelli che cambiano versione apposta. Il motivo: il browser porta l'ancora attraverso un 307, e `#clear-N` finirebbe su un tier dell'altra versione, dove quel clear non c'è. La pagina non legge la query: `?region=global` è la stessa voce in cache, e il canonical resta quello pulito. I link alle tip restano senza versione: le tip non hanno regione, e `#tip-N` vale in tutte e due.
- **Le Server Action non portano mai a un URL di eventi senza versione.** Il redirect di un'azione prende la pagina nuova passando dal routing (con i cookie della risposta), ma il browser tiene l'URL scritto nell'azione (`x-action-redirect`): un redirect a `/events` mostrerebbe la lista giapponese sotto l'URL di Global. Le azioni passano da `seguiVersione(href, versione)` (lo specchio in TypeScript delle regole, `lib/versione/versione.ts`, che come il router non distingue le maiuscole nel percorso e toglie le barre doppie o in fondo) con la versione della richiesta, `await versioneRichiesta()` o la variabile che la tiene (`reg` in `/welcome`), da `homeHref(await versioneRichiesta())` o da un `eventHref({..., explicit: true})`. Un test legge col parser di TypeScript ogni file `'use server'` e ogni modulo di `lib/` che importa `redirect` o `permanentRedirect` (un redirect lanciato da un modulo che l'azione chiama, come `requireUser` di `lib/dal.ts`, è un redirect dell'azione), e giudica il primo argomento di ogni `redirect` e `permanentRedirect` (anche con un altro nome, o attraverso una funzione dello stesso file): passano quelle tre forme, un URL scritto che non è degli eventi né la radice (`/login?next=…` e `/welcome?next=…` di `lib/dal.ts`), e i due rami buoni di un ternario. Non passano un'altra funzione di `lib/urls.ts` (`eventHref` senza `explicit`, `browseHref`, `homeHref()`), una variabile, e `seguiVersione` con una versione scritta (`'global'` restituisce l'URL com'è, senza versione) o senza versione, a meno del segno `// redirect-versione: <perché>` sulla riga o su quella prima (oggi solo il gemello di `setVersionAction`, già della versione nuova). La controprova sono una trentina di redirect sbagliati di prova che il test deve prendere (anche uno nascosto in un modulo di `lib/` senza `'use server'`), e una quindicina di giusti che deve lasciare. Le pagine e i loro componenti non contano: i loro redirect li segue il browser. I redirect delle pagine e delle rotte (`/notifications/<id>`, `/welcome`) li segue il browser, quindi passano dalle regole e possono restare senza versione.
- **Lo script del `<head>`**, accanto a quello del tema e uguale per tutti: con il cookie mette `data-reg="japan"` su `<html>` prima del primo paint. Legge e basta: non scrive il cookie e non naviga. La variante `japan:` di `app/globals.css` (`@custom-variant japan (&:where([data-reg="japan"] *))`) fa il resto: Global è la base, `japan:` la sovrascrive. L'interruttore, gli avvisi, il tag JP e i blocchi della carta seguono chi guarda col solo CSS, giusti già prima dell'idratazione. L'HTML delle pagine in cache non dice mai la versione (niente `data-reg` né `aria-pressed` dal server). Le pagine pubbliche non leggono mai il cookie: `versioneRichiesta()` (`lib/versione/server.ts`) è solo per le Server Action, le rotte e `/welcome`, e eslint lo vieta a `components/`, `lib/cache/`, al layout e alle pagine pubbliche.
- **Il cambio.** `setVersionAction(v, qui)` (`lib/auth/actions.ts`, il cuore in `lib/versione/cambio.ts`): salva sull'account se l'onboarding è finito (anche da sospesi, è una preferenza; il profilo si invalida solo se la versione cambia davvero), poi scrive o toglie il cookie e, se la pagina è dell'altra versione, porta al gemello con un `replace`. Prima l'account: Next mette il `Set-Cookie` nella risposta appena lo si scrive, e lo tiene anche nel 500 di un'azione che lancia, quindi con un errore del database il dispositivo cambierebbe lo stesso dietro "Couldn't change the version". Il gemello (`gemello()`) è la stessa vista di là: `/events` e `/events/japan`, lo stesso tier senza `/p/<n>`, `?region=` e `#clear-N` (restano `#tips` e `#tip-N`), la stessa lista filtrata a pagina 1. Una pagina senza gemello (carte, profili, Settings, notifiche, il builder e la modifica: un team non salvato non si perde) resta, e cambia solo quello che segue `data-reg`. Chi guarda già la versione che sceglie (un link marcato, "Use … everywhere") resta dov'è, con il suo clear (`quiPerCambio` in `lib/versione/interruttore.ts`). Senza navigazione `data-reg` si mette quando l'azione ha risposto, non prima: la pagina di adesso non mostra per un attimo l'avviso. Con la navigazione lo rimette `SeguiVersione` (`components/versione/segui-versione.tsx`, nel layout) a ogni cambio di URL, prima del paint della pagina nuova: lo script del `<head>` non gira sulle navigazioni del client. Il redirect dell'azione arriva al client come un rifiuto già gestito dal router: si prende e non si rilancia, altrimenti il router navigherebbe due volte.
- **L'aspetto.** Un controllo a segmenti, lo stesso nei tre posti con tre misure: un binario (lo sfondo della pagina, bordo `linea`) con due segmenti larghi uguali, alti 24 px nell'header (il bersaglio minimo di WCAG 2.5.8), 44 px nel burger, 32 px in Settings. Quello scelto ha il pieno di inchiostro, come i chip dei tier e dei filtri; l'altro è `tenue` nell'header (come "Events" accanto) e `testo` nel burger e in Settings. Le due opzioni hanno lo stesso peso, quindi scegliere non cambia la larghezza. All'hover e alla pressione cambia solo l'opzione non scelta (`superficie-2`, poi `linea`); mentre il cambio gira, quella scelta ha il velo dei link che caricano (come `AttesaLink`), sempre presente, che cambia solo opacità. L'anello del focus è quello del sito, attaccato al segmento (`.segmento`, offset 0 in `app/globals.css`): sta nei 2 px fra i segmenti invece di coprire quello accanto. Un errore ha l'icona, e non sposta niente neanche quando arriva tardi (la rete risponde dopo secondi, fuori dalla finestra in cui il browser conta lo spostamento come risposta al tocco): nell'header un riquadro sotto il controllo, che se ne va cambiando pagina, con Esc o con un tocco fuori (l'header sta nel layout e non si smonta: senza, l'errore di una pagina seguirebbe chi guarda su tutte le altre); nel burger prende la cella dell'etichetta, che si nasconde finché c'è (`invisible`: il gruppo si chiama ancora "Game version"), alta quanto il controllo, così Events e le altre voci restano dove il dito le cerca (a 320 px la cella è larga 120 px e il testo va su tre righe bilanciate, 45 px su 50); in Settings al posto dell'esito, nella stessa riga riservata. Il testo è breve apposta ("Couldn't change the version. Try again.", `ERRORE_VERSIONE` in `lib/versione/interruttore.ts`): in Settings a 320 px ci sta in una riga. **Con i colori forzati** (il contrasto elevato di Windows) il browser toglie i colori dei temi, e con lo stesso peso le due opzioni sarebbero uguali: quella scelta prende il pieno di sistema delle selezioni (`Highlight` e `HighlightText`, i colori che chi guarda ha scelto) con `forced-color-adjust: none`, perché altrimenti Chrome mette dietro al testo il suo riquadro del colore della pagina e su `Highlight` il testo sparisce; anche questo col CSS e la sua `japan:`, giusto prima dell'idratazione. L'anello che il browser dà alle opzioni è dello stesso colore: su quella scelta va dentro il segmento, in `HighlightText` (`app/globals.css`).
- **Accessibilità.** Un `role="group"` col nome "Game version" (un'etichetta visibile nel burger e in Settings, solo per i lettori di schermo nell'header) e due bottoni, quello scelto `aria-pressed`. Non un radio group: un radio vuole `aria-checked`, che l'HTML in cache (uguale per tutti) non può dire, mentre `aria-pressed` si lascia fuori finché la versione non si sa (dopo l'idratazione). Tutte e due le opzioni sono nel giro del Tab; si sceglie con Spazio, Invio o il click, e l'opzione già scelta non fa niente. Mentre l'azione gira, e finché la pagina del gemello non è arrivata, il gruppo è `aria-busy` e le opzioni `aria-disabled` (non `disabled`: il focus resta). Un cambio senza navigazione dall'header, dal burger o da "Use … everywhere" lo dice una regione live sola, nel layout ("Japan version on"), che resta anche quando il burger si chiude o l'avviso sparisce; Settings invece lo dice nella sua riga `role="status"`, visibile ("Japan version on. Saved to your account.", o "Saved on this device."): accanto al controllo dai 640 px; sul telefono lì non ci sta e va sotto, in una riga che resta riservata anche vuota (`min-h-[1lh]`), perché scegliere svuota l'esito e poi lo riempie e la pagina sotto non deve saltare; la navigazione la annuncia Next; un errore è un `role="alert"`, e finché c'è descrive il gruppo (`aria-describedby`). Nel burger un tocco sulla riga non chiude il pannello; quando porta al gemello si chiude e il focus torna al bottone. Il focus è quello del sito (`:focus-visible`), attaccato al segmento. Solo token dei temi: il pieno dell'opzione scelta è quello dei chip dei tier e dei filtri (`bg-inchiostro text-sfondo`), mentre il controllo, a segmenti su un binario, è suo (l'opzione non scelta non ha un bordo). Valgono in tutti gli 11 temi, High contrast compreso, e il test prova i contrasti di ogni coppia (4.5:1 per i testi, 3:1 per il pieno sul binario e per l'anello).
- **Gli avvisi** (`components/versione/avviso-versione.tsx`, componenti del server, statici): su una pagina Japan, a chi è su Global, "This is the Japan version. Your site is set to Global." con il link alla stessa pagina in Global e "Use Japan everywhere" (`usa-versione.tsx`, un'isola); su una pagina Global, a chi è su Japan, lo specchio. Hanno la forma del banner della sospensione: l'icona (un globo, in oro), la prima frase in inchiostro, e sotto le due strade, il link con la freccia (porta altrove) e "Use … everywhere" con l'aspetto di un piccolo bottone (cambia la scelta del sito), col velo mentre gira. Se il cambio non riesce lo dice il bottone stesso, nel suo posto: l'icona e "Try again" (`RIPROVA_VERSIONE`), in `str`, al posto di "Use … everywhere". Le due etichette stanno nella stessa cella e quella nascosta tiene la larghezza, quindi l'avviso non cresce e la pagina sotto non scende (una riga in più per l'errore, arrivato tardi, la spingeva giù di 27-47 px); il testo intero è un `role="alert"` per i lettori di schermo, che descrive il bottone finché c'è. Stanno sulle liste degli eventi e sulle pagine evento. Il link di una pagina Japan è l'URL Global senza marca: lo vede solo chi è su Global, che non viene rimandato. Su una pagina evento il link c'è solo se di là l'evento ha una run: l'avviso è nell'HTML per tutti (lo nasconde il CSS), e un link al gemello di un evento di una versione sola darebbe ai motori una pagina senza date. "Use … everywhere" nasconde l'avviso in cui sta: prima, se il focus è lì, lo porta al titolo della pagina (`tabindex="-1"`), che altrimenti finirebbe in cima al documento (WCAG 2.4.3). L'occhiello "Japan version" sta sulla lista Japan e sulla pagina evento (prima "Japanese version"), e il titolo di una pagina evento Japan finisce con "(Japan)".
- **Un evento in una versione sola** non è mai un 404 né una pagina vuota: getEvent lo trova anche senza run, gli stage e le tip non hanno regione, e `/p/<n>` si perde nei redirect. Senza run in questa versione la pagina lo dice al posto dello stato, con la sua forma (l'etichetta, poi il dettaglio in `tenue`): "**No Japan dates** It may not be out in this version yet, or the wiki doesn't list it.", e solo se di là l'evento ha una run aggiunge sotto, con la freccia, il link esplicito "Global version of this event" (l'altra versione si legge in cache, con le altre letture della pagina; la stessa condizione vale per il link dell'avviso). Quel link lo vede solo chi non vede l'avviso, col meccanismo dell'avviso rovesciato (`classeVersione(reg)`, solo CSS): chi è sull'altra versione ha già nell'avviso il link di là, e due link con lo stesso scopo a pochi pixel sarebbero rumore. Le liste filtrano per versione, quindi non portano mai a queste pagine.
- **Accesso, uscita, due dispositivi.** All'accesso di un account completo vince l'account, come per il tema: l'hook `after` di better-auth (`lib/auth/config.ts`) scrive `dts_version` da `app_user.reg`, o lo toglie per Global. Solo agli accessi veri (`ACCESSI`: il magic link, il ritorno OAuth, `/sign-in/social`): better-auth dà una sessione nuova anche quando la rinnova (una volta al giorno, `updateAge`, da `/get-session` e quindi da `/api/me` e dalle azioni) e in `/update-user`, e lì una risposta partita prima di un cambio lo disfarebbe. Un account nuovo o senza handle tiene la scelta del dispositivo, che `/welcome` propone; il form la scrive nel cookie e torna al `next` già risolto per quella versione. L'uscita e la cancellazione dell'account la lasciano: è del dispositivo. Su un secondo dispositivo con una sessione già aperta, `ViewerProvider` confronta `user.reg` di `/api/me` con `data-reg` e, se diversi, rimette quella dell'account con `setVersionAction`: una volta per scheda (un flag e `sessionStorage`, dentro try/catch), mai mentre un cambio è in corso, e spostando la pagina solo se era arrivata da un link senza versione (un link marcato vince anche qui). Una scelta fatta nella scheda vale come riallineamento. `/api/me` non scrive mai il cookie: una risposta vecchia non disfa un cambio appena fatto, e dopo un cambio il provider aggiorna la sua copia dell'utente. Le altre schede rileggono il cookie quando tornano visibili (`visibilitychange`, `pageshow`): se è cambiato, `SeguiVersione` chiama `router.refresh()`, che butta la cache del router (i prefetch della versione di prima, che un link senza versione mostrerebbe senza chiedere niente al server, per 60 s su una pagina evento e 300 s su `/events`), e una pagina arrivata da un link senza versione va al gemello già risolto, come col riallineamento; una pagina marcata resta, e l'avviso la spiega. Una pagina con un testo scritto e non inviato (un commento o una tip a metà, una ricerca) resta com'è, senza refresh (che col 307 la porterebbe di là): l'avviso la spiega, e la bozza non si perde.
- **Senza JavaScript** la modalità Japan funziona (cookie e redirect), l'interruttore no, come il selettore del tema.

**I costi.** Global, chi non è entrato e i motori: zero, nessun redirect. In Japan una richiesta in più alla CDN per ogni redirect (Hobby ne include un milione al mese) e nessuna funzione; i link dell'header portano già a `/events/japan` e quelli dentro le pagine Japan hanno già la versione, quindi i redirect sono rari. Un cambio è una Server Action. `/events/japan` è statica: prima la home di chi gioca Japan era `/events/browse?region=japan`, dinamica, circa 11 ms di CPU per vista. Le pagine evento Japan nascono alla prima visita (ISR), come prima; prerenderizzarle al build per gli eventi Japan recenti non è stato fatto. La pagina della carta fa una lettura in cache in più quando si rigenera, e `/api/cards` ha qualche chiave di CDN in più.

**La lingua, dopo.** Oggi l'inglese per tutte e due (`localeDi`, `lib/versione/versione.ts`). Quando ci saranno testi giapponesi: la versione Japan li userà sui percorsi `/japan`, che già la separano nella cache; `setVersionAction` diventerà `set_version(utente, regione, lingua)` e scriverà anche `app_user.locale`; le pagine con un URL solo (carte, profili) prenderanno un segmento della lingua con lo stesso meccanismo dei redirect (per esempio `/cards/<id>` → `/ja/cards/<id>` con lo stesso cookie); `<html lang>` vorrà un layout per versione o lo script del `<head>`. Mai testi diversi sotto lo stesso URL scelti dal cookie: le pagine in cache diventerebbero diverse per chi guarda. Un cookie della lingua a parte servirà solo se la lingua diventerà indipendente dalla versione.

**I file.** `lib/versione/versione.ts` (puro: il cookie, `seguiVersione`, `gemello`, lo script del `<head>`, `localeDi`), `client.ts` (`data-reg` nel browser, `useVersione`, la regione live, il riallineamento una volta per scheda), `server.ts` (`versioneRichiesta`), `cambio.ts` (il cambio, senza Next), `interruttore.ts` (puro: quale versione mostra un URL, quando il cambio porta al gemello, i testi degli avvisi, i blocchi della carta); `components/versione/` (l'interruttore, `LinkEventi`, `SeguiVersione`, gli avvisi); le regole in `next.config.ts`; `set_region` nella 0035.

**Le prove.** Il passo "versione del sito" (`db/test/versione.test.mts`): le regole di `next.config.ts` nel valutatore di Next 16 (`unstable_getResponseFromNextConfig`: chi va dove, cosa non si tocca mai, `_rsc` che passa, nessun giro), `seguiVersione` uguale alle regole, anche con le maiuscole nel percorso (che il router vero non distingue e il valutatore di prova sì: per queste righe il test usa i matcher del router di Next, `buildCustomRoute` di `router-utils/filesystem` con la `caseSensitiveRoutes` della config, e prima controlla che sulle righe di sempre diano lo stesso del valutatore) e con le barre doppie o in fondo (i 308 del router seguiti come li segue il browser: `normalizeRepeatedSlashes` di Next e la sua prima regola, che il test controlla sia ancora quella della barra in fondo; ogni riga di sempre anche con una barra in più in fondo e con le barre doppie), `gemello` nei due sensi, il cookie e lo script del `<head>` su un document finto, `set_region` e il cambio con il database vero, e le guardie sui file (ogni redirect delle azioni e dei moduli di `lib/` che importano `redirect`, letto col parser di TypeScript, con la sua controprova; nessuno scrive il cookie dal browser). Il passo "versione del sito (interfaccia)" (`db/test/versione-ui.test.mts`, senza database): quale versione mostra un URL e se è marcato, quando il cambio porta al gemello (sempre a un URL diverso, già risolto), il riallineamento, il redirect di un'azione riconosciuto come lo riconosce Next, i testi (anche l'errore di un cambio, breve quanto basta per stare in una riga a 320 px), i blocchi della carta, i contrasti in tutti i temi, e le guardie su interruttore (`aria-pressed`, niente radio, lo stesso peso per le due opzioni, il pieno di sistema con i colori forzati, hover e pressione solo su quella non scelta, le misure dei bersagli, il focus attaccato, il velo mentre gira), burger (l'errore nella cella dell'etichetta), header (accanto a Events, fuori dalla parte che cambia con `/api/me`; l'errore che se ne va cambiando pagina), tag JP sul burger (tolto col focus da tastiera), Settings (l'esito in una riga riservata, con l'errore nello stesso posto), avvisi (il link solo verso una run, il focus di "Use … everywhere", l'errore nel bottone), la cache del router dopo un cambio in un'altra scheda, liste, pagina evento (il link esplicito solo a chi non vede l'avviso) e carta. In più i passi "account" (il cookie all'accesso e all'uscita, e mai al rinnovo della sessione), il cambio che con un errore del database non scrive il cookie, "URL degli eventi", "notifiche (app)", "attivita' del sito", la pagina della carta (i blocchi su carte vere), il builder (`/api/cards` con `reg`), "script di produzione" (`set_region` dopo harden), e `test:smoke` contro `next start` (i 307 veri col cookie, `_rsc` che passa, le pagine marcate che restano, nessun redirect senza cookie, l'HTML del server uguale per tutti con l'interruttore e gli avvisi, `/events/japan` e `?region=global` serviti dalla cache).

**In produzione: prima la 0035, poi il codice.** `npm run prod:migrate -- --yes` (migrazioni e permessi: `harden` toglie `set_region` ai ruoli della Data API come le altre funzioni), e solo dopo il deploy. Senza la 0035 `setVersionAction` fallisce per chi è entrato con un account completo (con "Couldn't change the version. Try again.", e il dispositivo resta com'era: il cookie si scrive solo dopo l'account); i redirect, lo script del `<head>` e i link funzionano anche senza, e il codice di prima sulla 0035 va (nessuno la chiama). Dopo il primo deploy:

1. che Vercel abbia compilato i redirect con `has`/`missing` in regole della CDN (`.vercel/output/config.json` di un build, o le route del deploy): le anteprime sono spente (`ignoreCommand`), quindi si guarda in produzione;
2. `curl -sI -H 'Cookie: dts_version=japan' https://<dominio>/events` risponde 307 verso `/events/japan`, senza log di funzione e senza invocazioni nuove in Observability; senza cookie 200;
3. `/events/<id>?region=global` è un `x-vercel-cache: HIT` (la stessa voce di `/events/<id>`; se non lo è, ogni pagina guardata così ha una voce ISR in più, poche, e i canonical tengono pulita l'indicizzazione);
4. a mano: in DevTools, in Japan, un clic su un link senza versione è un 307 più un 200 RSC, senza un terzo giro; a 375 px l'interruttore del burger su un tier porta al tier Japan e chiude il menu; a 1024 px l'header non trabocca con un handle di 24 caratteri; Tab, Spazio e Invio sull'interruttore; due schede, il cambio in una e un link senza versione nell'altra; gli 11 temi; nessun lampo ricaricando una pagina in Japan.

In sviluppo: `npm run db:up` porta la 0035 su `dokkan_dev` (finché manca, l'interruttore funziona per chi non è entrato e fallisce per un account completo, senza cambiare il dispositivo). `next dev` si riavvia da solo quando cambia `next.config.ts`; se non lo fa, a mano. Poi `curl -sI -H 'Cookie: dts_version=japan' http://localhost:3000/events` deve rispondere 307 verso `/events/japan`, e lo stesso senza cookie 200.

## Segnaposto delle immagini

Una carta senza miniatura e un evento senza immagine non mostrano più un riquadro vuoto. Il segnaposto è fatto solo di roba nostra (`lib/segnaposto.ts`, puro, e `components/segnaposto.tsx`): nessuna immagine e nessuna icona del wiki.

- **La carta**: un riquadro con bordo su `--superficie-2`. In alto una banda col colore del tipo: i cinque colori fissi del marchio, `--marchio-1`…`--marchio-5` nell'ordine dei settori (AGL TEQ INT STR PHY), neutra (`--tenue`, il grigio del testo secondario) per un tipo che non si sa, come una carta nota solo dall'URL dei filtri. Al centro l'iniziale del nome (la prima lettera o cifra, anche giapponese, in maiuscolo; `?` se non c'è), a sinistra la rarità. Di norma in basso, l'angolo dove la mettono le miniature del gioco; nelle squadre dei clear (`components/carta.tsx`) in alto, subito sotto la banda, perché l'etichetta Leader o Friend è larga quasi quanto il riquadro e ne copre tutta la riga in basso (anche i membri senza etichetta, così in una squadra le rarità stanno alla stessa altezza). Le misure: la banda è un sedicesimo del lato, almeno 2 px (3 a 48, 10 a 160); l'iniziale da 24 px, la rarità da 40 px; a 16 px resta la sola banda, di 4 px. Corpi e posizioni li calcola `segnapostoCarta`, e il componente li usa così come sono.
- **Tipo e classe in lettere**: nello slot del builder (40 px) e nel menu "Uses card" dei filtri (32 px) una carta senza miniatura ha accanto al nome anche tipo e classe, come `components/tipo.tsx` li scrive ovunque ("SAGL", "EINT"): il riquadro piccolo ha la banda del colore ma non la classe, e il riquadro di prima li scriveva. A vista la forma breve, per i lettori di schermo quella per esteso ("Super AGL", `tipoPerEsteso`). Con una miniatura del gioco non c'è: il tipo lo mostra lei. Il picker li scriveva già per ogni carta.
- **L'evento**: l'icona Phosphor del tipo, già nel bundle, con il tipo scritto accanto: Extreme Z-Battle un fulmine, Challenge una coppa, Story un libro, Limited una clessidra, Bonus un regalo, World Tournament una medaglia, tutto il resto un calendario. Le etichette sono quelle della pagina dell'evento (`ETICHETTA_EVENTO`). Un evento senza banner ma con la carta del boss mostra la carta, come prima.
- **Dove**: le carte dei clear (`components/carta.tsx`, 48 px), il builder (slot 40 px, picker 44 px) e il menu "Uses card" dei filtri (32 px), tutti da `components/builder/miniatura.tsx`; la catena di risveglio (48 px); l'artwork della pagina della carta quando non c'è nemmeno la miniatura (160 px, sopra "Artwork not available yet"); la squadra nel profilo (32 px); i premi delle missioni (16 px, solo le carte: gli altri premi senza icona restano solo testo); la lista degli eventi e la pagina dell'evento.
- **I temi**: la banda prende la variante chiara o scura del marchio con lo stesso CSS (la classe `colori-marchio`), il resto i token di `app/globals.css`. Il testo non sta mai sul colore del marchio: l'iniziale è `--inchiostro` e la rarità `--tenue`, su `--superficie-2`. In tutti gli 11 temi, con System chiaro e scuro: le cinque bande dei tipi e quella neutra almeno 3:1 sul fondo (il minimo è 4,04, PHY Sand; la neutra almeno 4,69), l'iniziale almeno 13,16:1, la rarità almeno 4,69:1.
- **La cornice disegnata (0034)**: una miniatura che è il solo personaggio (le LR del wiki, `asset.frame = false`) non è un segnaposto ma ci somiglia: `CorniceCarta`, nello stesso file, le mette attorno un bordo col colore del tipo e, da 40 px, l'etichetta della rarità dentro il bordo (in alto in `Carta`, sopra Leader e Friend). Le misure le dà `corniceDisegnata`; il resto nella sezione "Le miniature e la cornice".
- **Accessibilità**: dove il nome è scritto accanto il riquadro è decorativo (`aria-hidden`), come l'immagine con `alt=""` che sostituisce; nel profilo, dove la squadra è fatta di sole miniature, è un'immagine col nome (`role="img"`, `aria-label`, `title`), come la miniatura vera.
- **La cache**: nessuna isola nuova, nessuna sessione, nessuno stato, quindi l'HTML in cache cambia solo dove compare un segnaposto; i colori del marchio stanno nel foglio di stile, e una pagina con tanti segnaposto non porta il loro CSS nel payload. Le letture aggiungono solo quello che il segnaposto mostra: il tipo alle carte delle squadre dei profili (`listUserClears`) e ai premi delle missioni che sono carte (`card: { type }` in `getMissions`); a 32 e 16 px la rarità non si scrive, quindi non si legge. Le carte dei clear avevano già tipo e rarità, le opzioni dei filtri il tipo (a 32 px nemmeno lì si scrive la rarità). Nel builder la rarità sta nello stato del form solo per il segnaposto, mai nel payload dell'invio.
- **Il test**: il passo "segnaposto delle immagini" di `npm run db:test` (`db/test/segnaposto.test.mts`, senza database) prova iniziale e misure, le icone e le etichette di ogni valore di `event_kind`, i contrasti tema per tema (anche della banda neutra), che i temi scuri della regola del marchio siano esattamente quelli con `color-scheme: dark`, che `marchio.tsx` e `globals.css` coincidano ancora con gli SVG sorgente, che nessun componente rimetta uno `<style>` col marchio, che i file che mostrano immagini usino il segnaposto e che il componente resti senza sessione e senza niente del wiki. La geometria la prova con i numeri veri: per ogni riquadro che scrive la rarità (misura e angolo letti dai file) la rarità sta dentro, sotto la banda e staccata dall'iniziale, e in `Carta` sta sopra l'etichetta del ruolo, misurata dalle sue classi anche con la riga più alta (in basso, com'era, la coprirebbe). Controlla anche tipo e classe accanto al nome nello slot e nel menu dei filtri. `db/test/queries.test.mts` e `db/test/profiles.test.mts` provano che i premi carta senza miniatura e le carte delle squadre dei profili portano il tipo. Un tema scuro nuovo che manca dalla regola scura del marchio lo fa fallire.

## Menu a scelta

Ogni menu del sito (i sei filtri dei clear, Hidden Potential, il grado delle Skill Orb, il tipo di una prova, la run e la lingua della nota nel builder, i quattro filtri del picker delle carte, il tema nel footer) è un menu con la ricerca: si apre, si scrive per filtrare le voci, si sceglie. Uno solo, `<Scelta>` (`components/scelta/scelta.tsx`), con la logica pura in `lib/scelta.ts`.

- **La libreria**: Headless UI 2 (`@headlessui/react`, versione esatta 2.2.10, l'unica dipendenza nuova), il suo `Combobox`: il pattern combobox di WAI-ARIA già fatto (frecce, Home/End, Invio, Esc, Tab, `aria-activedescendant`, IME), senza stili. Le scelte, viste nel sorgente: niente `anchor` (porterebbe l'elenco in un portale sul `<body>`, inerte sotto un `<dialog>` aperto con `showModal()`, come il picker e l'editor della build), quindi il pannello sta nella scatola del campo e dove aprirlo lo decide `posizionePannello`; `modal={false}` (con `modal` bloccherebbe lo scroll e renderebbe inerte la pagina); niente `immediate` (il focus da programma non apre l'elenco); i valori sono stringhe e `name` mette un `<input type="hidden">` con lo stesso name=value del `<select>` di prima; svuotare il campo per scrivere manda `onChange(null)`, che `valoreScelto` ignora; Invio a elenco chiuso si ferma (nel builder farebbe partire la Server Action).
- **La ricerca**: ogni parola scritta, in qualsiasi ordine, nel nome, nell'epiteto o fra parole nascoste, mai nel conteggio; senza accenti né maiuscole, con le lettere a tutta larghezza e i nomi con un a capo. Prima le voci dove ogni parola comincia una parola, poi le altre, nell'ordine della lista; la prima è già evidenziata, e Invio (o Tab) la sceglie. Finché non si scrive il testo del campo è selezionato, e il primo tasto lo sostituisce comunque ci si arrivi: Tab, il clic sull'etichetta, il focus da programma (il ritorno dei filtri dopo un cambio di route, il primo campo dell'editor della build), l'apertura, e con il focus ancora lì dopo una scelta, dopo Esc o quando il valore cambia; quindi si sceglie e si cerca di nuovo senza cancellare. Dove la selezione si perde lo stesso (un clic dentro il testo, le frecce, una tastiera fisica sul telefono) `ricercaScritta` tiene solo quello aggiunto in fondo, e il primo Backspace svuota il campo. "No results" quando non resta niente, e una regione live dice quante voci restano dopo una pausa.
- **Invio e Tab**: a elenco aperto scelgono la voce attiva solo se ci si è arrivati con le frecce o scrivendo una ricerca (`voceMossa`, `sceltaDaTasto` in `lib/scelta.ts`); altrimenti chiudono l'elenco e il valore resta, e Tab porta avanti il focus come sempre. Headless sceglierebbe anche la voce che evidenzia da sé, la prima dopo un Backspace che svuota il campo: Backspace e poi Tab cambiavano la run del builder, il Leader dei filtri o il tema salvato nell'account, cosa che il `<select>` di prima non faceva mai. Svuotare il campo o chiudere l'elenco azzera le frecce; Backspace sulla voce mostrata, a elenco aperto, svuota il campo senza passare da Headless, così la voce attiva resta quella scelta (nei menu corti le righe si registrano di nuovo e la riportano lì anche dopo le frecce). Un clic o un tocco su una voce sceglie sempre. Sulla pagina statica del tier una scelta col Tab cambia route: il segno del focus dei filtri (`components/clears/fuoco-filtri.ts`) dice anche il verso del Tab, e all'arrivo il focus va al controllo dopo (o prima, con Maiuscolo), anche fuori dalla barra: dopo Sort c'è la lista.
- **L'aspetto**: quello dei campi del sito (la ricerca di `/events`): bordo `campo` su `superficie`, il raggio unico, l'anello d'oro sulla scatola (`.scelta-campo` in `app/globals.css` toglie quello del campo vero, che sta dentro); al passaggio e aperto il bordo diventa `tenue`, mai più debole di `campo` (il test lo controlla in ogni tema). Le voci sono righe separate da una linea, 32 px col mouse e 44 px e 15 px col dito come le righe del burger; quella attiva ha il fondo `superficie-2` e una barra d'oro a sinistra, quella scelta il grassetto e la spunta; con i colori forzati il pieno di sistema delle selezioni. Coi colori forzati anche il campo chiuso mostra il valore che va a capo: il campo vero, trasparente, resta fuori dai colori forzati (`forced-color-adjust: none`, col cursore `CanvasText`) finché non si scrive, se no il suo testo tornerebbe visibile in una riga sola tagliata. Davanti ai tipi (Mono AGL, i tipi del picker) un quadratino del colore del tipo, e nient'altro. Solo token dei temi: vale in tutti e 11 e con `japan:`. I nomi lunghi vanno a capo, nel campo e nelle voci: il Leader e la Category non tagliano più i nomi a 16rem, nemmeno col focus o a elenco aperto (il valore che va a capo resta finché non si scrive, poi c'è il testo del campo).
- **Il telefono**: 16 px nel campo col dito (sotto, Safari su iOS ingrandirebbe la pagina al focus) e 44 px di altezza. Fino a 12 voci niente tastiera (`inputMode="none"`, si sceglie col dito; una tastiera fisica filtra lo stesso); oltre, la tastiera, perché lì scrivere serve. L'elenco si apre sotto se ci stanno 4 righe, se no sopra se lì c'è più posto, contando quello che si vede davvero: il `visualViewport` (senza la tastiera) dentro il dialog o lo scroller che lo contiene, ricontato quando il `visualViewport` cambia (iOS non manda il resize della finestra). Se la tastiera non lascia 4 righe né sopra né sotto, il campo sale una volta in cima. L'invito a installare l'app, fisso in fondo, conta come fuori dalla vista (`data-copre-fondo`, `sopraLeCoperture`): l'elenco si apre sopra o si accorcia, e non finisce sotto (se l'invito compare a elenco aperto, il pannello gli sta sopra). Col dito anche le pillole, Filters e "Uses card" della barra dei filtri sono alti 44 px, con 15 px: una riga sola, un'altezza sola. Gli stessi 44 px e 16 px (`CAMPO_DITO` in `components/scelta/stile.ts`) li hanno i campi di testo accanto ai menu: la ricerca di `/events`, che è il modello dei menu, il nome nel picker delle carte, la ricerca di "Uses card" e delle Skill Orb, i campi del builder (il link di una prova, con Remove a 44 px, `BOTTONE_DITO`); così le etichette di una riga stanno in fila. Col mouse tutto resta a 34 px e 13 px. Oltre 50 voci l'elenco è virtuale (nel DOM solo le righe che si vedono, con un'altezza di partenza: il virtualizzatore non disegna niente in uno scroller alto 0).
- **Senza JavaScript, e prima dell'idratazione**: nell'HTML del server c'è un `<select>` nativo (`scelta-nativa.tsx`), uguale per tutti, quindi le pagine in cache restano identiche per ogni visitatore e Headless non gira sul server. La scatola mostra il valore in uno `<span>` che va a capo e il `<select>` le sta sopra trasparente: un clic apre il menu del browser, che funziona già. Il combobox lo sostituisce nella stessa scatola, con la stessa geometria: nessuno spostamento. Senza JavaScript la variante `noscript:` di Tailwind (`@media (scripting: none)`) mostra il `<select>` al posto dello `<span>`, con la stessa misura, e il form GET dei filtri manda gli stessi name=value di prima con il suo bottone Apply; per Safari prima della 17, che quella media query non la conosce, il `<noscript>` della barra ha la stessa regola. I menu del builder non hanno `name` (il builder vuole JavaScript, e la run la manda già il campo nascosto di `builder.tsx`).
- **Il caricamento**: `scelta-elenco.tsx` è l'unico file che importa Headless UI e arriva con un `import()` in un chunk suo, chiesto quando il browser è libero dopo il primo menu montato (il footer ne ha uno su ogni pagina): Headless (circa 43 kB gzip) non entra nel JavaScript del primo caricamento di nessuna pagina, che cresce di circa 3 kB gzip per la scatola, il `<select>` e la logica pura (misurato su `/events` e su una pagina evento, `next build` prima e dopo). Il modulo caricato è uno store esterno (`useSyncExternalStore`, falso sul server e all'idratazione), non una `Suspense`: il `<select>` dell'HTML resta lo stesso nodo fino al cambio, e dopo il primo caricamento le pagine nuove montano subito il combobox. Un `<select>` che ha il focus non si cambia sotto le dita (il menu del browser aperto si chiuderebbe): il cambio aspetta che lo lasci.
- **Il footer**: il selettore del tema è un menu come gli altri, con 11 voci (niente tastiera, e in fondo alla pagina si apre verso l'alto). Il tema non passa da lì: `data-theme` lo mette lo script del `<head>` prima del primo paint, quindi niente lampi, e il campo mostra System finché `useTema` non lo sa, come prima.
- **La guardia**: il passo "menu a scelta (componente)" di `npm run db:test` (`db/test/scelta.test.mts`, senza database) legge ogni sorgente di `components/` e `app/` col parser di TypeScript (JSX e `createElement('select')`, mai stringhe o commenti, con la controprova) e fallisce se compare un `<select>`, o un `<option>` fuori da un `<datalist>`, fuori da `components/scelta/scelta-nativa.tsx`, l'unico ammesso (con un `<select>` solo: è la forma del server e senza JavaScript). Un menu nuovo si fa con `<Scelta>` e il suo `<label htmlFor>`. Il test prova anche la ricerca, Invio e Tab (Backspace e poi Tab lasciano il valore, anche nella run del builder), che i testi e i valori di ogni menu siano quelli degli `<option>` di prima, dove si apre l'elenco (la tastiera, 320 px, un dialog), i contrasti in tutti i temi, Headless in un file solo e solo con `import()`, la versione esatta in `package.json`, i name del form dei filtri, `modal` e `anchor`, Invio a elenco chiuso, i colori forzati, `CAMPO_DITO` su ogni campo di testo accanto ai menu, il verso del Tab nel segno del focus. `test:smoke` controlla che l'HTML del server abbia i `<select>` e niente combobox, e (contro `next start`) che un tier con la barra sia lo stesso HTML per due visitatori diversi.
- **A mano**, su un telefono vero (la tastiera non si emula nel browser del computer): un iPhone e un Android, il Leader e la Category di un tier con tanti clear con la tastiera su, il tema nel footer, i menu nei dialog del builder.

## PWA

Il sito si installa come app (Android, iPhone e iPad, desktop Chromium). Fase 1 del piano PWA e notifiche; le push del browser (fase 4) hanno una sezione loro, sotto.

- **Manifest**: `app/manifest.ts`, servito statico a `/manifest.webmanifest`. `start_url` è `/events` (non `/`, che è un 307; chi ha scelto Japan arriva a `/events/japan` col redirect della versione, sulla CDN), `name` e `short_name` sono entrambi `Dokkan Team Sharing` (sotto l'icona il launcher lo accorcia se non ci sta), colori `#0f111d` (il fondo del marchio: contano solo per lo splash di Android, poi vince il `theme-color` del tema scelto). Le icone PNG stanno in `public/pwa/` e le genera `npm run brand`; non in `app/`, dove Next aggiungerebbe un `<link rel=icon>` per ognuna, e non in `public/assets`, che va su Cloudflare.
- **iOS**: `metadata.appleWebApp` in `app/layout.tsx` (titolo `Dokkan Team Sharing`, barra di stato `default`); l'icona è `app/apple-icon.png`. Nell'app installata il link dell'email si apre in Safari, non nell'app: `/login` e `/settings` lo dicono (solo lì, `components/pwa/avviso-ios.tsx`) e suggeriscono Discord, Google o Twitch.
- **Service worker**: `public/sw.js`, scritto a mano, URL fisso `/sw.js`, scope `/`. Fa due cose: se una navigazione GET dello stesso sito non raggiunge la rete, mostra `public/offline.html`, e mostra le push del browser (fase 4, sotto). Non intercetta `/api/` (callback OAuth e magic link comprese), `/admin`, le richieste non GET, le fetch del router (RSC), i chunk e le immagini. **Non mette in cache nient'altro**: né pagine, né chunk, né API, né immagini. Le pagine per utente non finiscono mai su un dispositivo, e dopo un deploy non resta niente di vecchio. Niente navigation preload: per una navigazione non intercettata (una callback OAuth) il browser potrebbe fare la richiesta due volte.
- **Registrazione**: `instrumentation-client.ts`, solo nei build di produzione, dopo il `load` e quando il browser è libero (`lib/pwa/registra.ts`). In `next dev` non si registra, e se trova il nostro worker (per esempio lasciato da un `next start` di prova su localhost:3000) lo toglie con le sue cache `dts-*`.
- **Versione**: `NEXT_PUBLIC_SW_VERSION` in `next.config.ts` (il commit su Vercel, un valore nuovo a ogni build in locale) va nell'URL, `/sw.js?v=...`. A ogni deploy si installa un worker nuovo che riprende la pagina offline e cancella le cache `dts-*` delle versioni prima (`skipWaiting` e `clients.claim`, senza chiedere niente). `sw.js` e `offline.html` hanno `Cache-Control: public, max-age=0, must-revalidate` (`next.config.ts`).
- **Kill switch**: se il worker va spento, si pubblica al suo posto un `sw.js` che all'install chiama `skipWaiting()` e all'activate cancella le cache `dts-*` e chiama `self.registration.unregister()`. L'URL è fisso e senza cache, quindi arriva a tutti al primo controllo. Togliere solo la registrazione non basta: i worker già installati resterebbero.
- **La pagina offline** la genera `scripts/brand/offline.mjs` (con `npm run brand`): tutto in linea, i colori dei temi presi da `app/globals.css`, lo script del tema di `lib/tema/temi.ts` (legge `dts:tema`), il marchio, "You're offline" e un bottone Try again che ricarica l'URL voluto. Si riprova anche da sola quando torna la rete. Dopo un cambio ai temi va rigenerata: il test lo controlla.
- **L'invito a installare** (`components/pwa/invito-installa.tsx`, un'isola in fondo allo schermo): solo su telefoni e tablet, mai nell'app già installata, mai su `/login`, `/welcome` e `/admin`, mai nell'HTML del server. Su Android (Chromium) compare solo dopo `beforeinstallprompt`, con un bottone Install; su Safari per iOS spiega "tap Share, then Add to Home Screen". Gli altri browser di iOS non lo mostrano. La X lo chiude per sempre su quel dispositivo (`localStorage['dts:installa-chiuso']`). Su desktop decide il browser (l'icona di installazione nella barra degli indirizzi).
- **Le notifiche push** (fase 4) sono in fondo a `public/sw.js`: `push` e `notificationclick`, senza cache. Vedi "Push del browser" sotto.

Prove:

- `npm run test:pwa` (anche il passo "PWA" di `npm run db:test`, senza database): `public/sw.js` vero in `node:vm` con `self`, `caches` e `fetch` finti. Controlla quali richieste intercetta, la pagina offline senza rete, install e activate, che con la rete non scriva niente in cache; poi la pagina offline uguale a quella generata e senza risorse esterne, il manifest con le misure vere delle icone, gli header di `next.config.ts`, il riconoscimento di iPhone, iPad, Android e desktop.
- `npm run test:smoke`: manifest (content type e campi), icone (dimensioni dall'IHDR), header di `/sw.js`, `/offline.html` con noindex, `rel="manifest"` nell'HTML, l'invito assente dall'HTML del server.
- A mano su un build di produzione (`next build && next start`, perché in dev il worker non si registra): DevTools, Application, Manifest (Installability senza errori) e Service workers; Cache storage deve avere solo `dts-offline-<versione>` con `/offline.html`. Fermando il server, una navigazione mostra la pagina offline. Lighthouse 12 non ha più la categoria PWA. Su un telefono vero: installazione su Android (splash e icona maskable) e Aggiungi a Home su iPhone (titolo `Dokkan Team Sharing`).

## Notifiche (migrazione 0028)

Fase 2 del piano PWA e notifiche: la lista nel sito, sempre accesa, con un pallino nel menu. Il digest email (fase 3), le push del browser (fase 4) e il feed dell'attività del sito per gli admin (0032) hanno le loro sezioni, sotto.

Cosa si notifica in v1 (lo ha deciso il proprietario):

- **un commento sul mio clear** (`clear_comment`), all'autore del clear, se è pubblicato e il commento non è suo. I commenti sullo stesso clear si accorpano finché la notifica non è letta: "3 new comments on your clear";
- **la moderazione dei miei contenuti**: clear, commento o tip nascosti o ripristinati (`content_hidden`, `content_unhidden`), la sospensione e la sua fine (`suspended`, `suspension_lifted`). Arrivano anche a chi è sospeso;
- **le segnalazioni aperte**, solo agli admin (`reports_open`, un gruppo solo: "3 open reports to review"). Mai a chi ha segnalato, e chi è segnalato non riceve **mai** niente, nemmeno se è admin.

Per chi li riceve, voti e Helpful **non** scrivono notifiche: il digest email della fase 3 li conta da `clear_vote.voted_at` e `tip_vote.voted_at`. L'unica eccezione è il feed degli admin (0032, sezione "Attività del sito per gli admin"): solo se un admin l'ha acceso, un voto scrive una riga per lui e tocca la sua riga di `app_user`. Senza nessun admin iscritto un voto non scrive niente, come prima.

Come funziona:

- **Le righe le scrivono solo i trigger** della migrazione (su `clear_comment`, `moderation_action` e `report`), nella stessa transazione della scrittura: l'app non crea mai notifiche. `set local dts.silent = 'on'` le spegne: lo usano il seed demo, la fixture di `db/reset.mjs` e qualsiasi import che scriva dati della community.
- **Nessun testo dei post** nelle notifiche: né commenti, né il motivo della sospensione, né la nota del moderatore. `notification_render(p_user, p_id)` e `notification_list(p_user, p_limit)` ricalcolano tutto adesso dalle tabelle vere (conteggio, handle attuale, evento, se il contenuto è ancora pubblicato). L'handle di chi segnala non esce mai; quello del moderatore non arriva mai a chi è moderato, e solo agli altri admin col feed acceso (0032), che lo vedono già nel registro di `/admin/log`.
- **Il pallino**: `app_user.notif_last_at > notif_seen_at`. Le due colonne sono negli `additionalFields` di better-auth (`notifLastAt`, `notifSeenAt`, `input: false`), quindi la sessione le legge già e `/api/me` risponde `user.unread` (un sì o un no, mai un numero) senza query in più. Lo mostra `components/notifiche/campanella.tsx` dentro `user-menu.tsx`, solo dopo `/api/me`: nell'HTML in cache non c'è mai.
- **`/notifications`** (per utente come `/settings`: `instant = false`, noindex, esclusa da `robots.txt`): le ultime 50, divise in New ed Earlier. Dalla 0032 il limite vale per famiglia: 50 personali e, per un admin col feed acceso, 50 del feed in una terza sezione, Site activity, così il feed non spinge mai fuori i commenti sui suoi clear. Aprirla segna lette quelle mostrate e, dalla 0032, anche le non lette oltre le 50 di ogni famiglia, che la lista non mostrerebbe mai (`mark_list_read`, che poi chiama `mark_notifications_read`). Per il feed non succede in silenzio: `mark_list_read` torna anche quante azioni ha segnato lette senza mostrarle (`unseen_actions`), e la pagina lo scrive sotto Site activity ("12 older actions did not fit in this list and were marked as read."); il pallino si spegne quando non resta nessuna non letta, e una notifica arrivata mentre la pagina si apre resta non letta per la visita dopo; `components/notifiche/segna-viste.tsx` lo spegne anche nell'header, che è nel layout e non rilegge `/api/me` a ogni navigazione. Il link della campanella ha `prefetch={false}`: un prefetch segnerebbe lette le notifiche senza che l'utente le abbia viste.
- **`/notifications/<id>`** (`app/notifications/[id]/route.ts`) è l'unico link di una notifica, anche per push ed email: segna letta quella sola e fa un 307 all'href calcolato in quel momento (`lib/notify/vista.ts`, con `eventHref` + `clearAnchor`, `editClearHref` per un clear nascosto, `/settings`, `/admin`). I link a un clear e a un commento dicono la versione del clear (`?region=global` prima di `#clear-N`, o il percorso `/japan`), quelli a una tip no: la tip non ha regione e segue la versione di chi guarda (sezione "Versione Global/Japan"). Il 307 della rotta lo segue il browser, quindi passa dai redirect della versione; push ed email portano solo a `/notifications/<id>` e non cambiano. Un id sconosciuto o di un altro torna alla lista; senza sessione si passa da `/login?next=`. Le righe della lista sono `<a>` semplici, non `<Link>`, perché la rotta scrive.
- **I tipi** stanno in `lib/notify/kinds.ts` e devono coincidere con `notification_kinds()` e con i check delle tabelle `notification` e `notification_pref`: un tipo nuovo va aggiunto con una migrazione e nei testi di `lib/notify/vista.ts`.
- **Preferenze**: `notification_pref(user_id, kind, channel)` e `set_notification_pref` ci sono già, per i canali per tipo. Il digest email (fase 3, sotto) ha una casella sola e non le usa; la disiscrizione dal link toglie comunque le righe con canale `email`. Le push del browser le usano: un interruttore per gruppo in Settings accende o spegne le righe con canale `push` (sezione "Push del browser").
- **Conservazione**: il cron giornaliero (`/api/cron/purge`) chiama `purge_notifications()`: le lette dopo 30 giorni dalla lettura, le non lette dopo 90 senza novità. Gli stessi giorni sono in `lib/legale.ts` per la privacy. Cancellare l'account porta via le sue notifiche e preferenze; cancellare un clear, un commento o una tip porta via le notifiche che li riguardano.

Prove: il passo "notifiche" di `npm run db:test` (`db/test/notifiche.test.mts`: trigger, destinatari, accorpamento, `dts.silent`, cascate, conservazione) e il passo "notifiche (app)" (`db/test/notifiche-app.test.mts`: i tipi uguali alla migrazione, il pallino, href e testi su righe vere senza il testo dei post, le guardie su robots, pagina, rotta e menu). `npm run test:smoke` controlla che `/notifications` senza sessione porti a `/login` e che il pallino non sia nell'HTML delle pagine in cache.

In produzione la migrazione 0028 deve arrivare **prima** del codice: la sessione di better-auth legge `notif_last_at` e `notif_seen_at`, e senza le colonne l'accesso si rompe.

## Digest email (migrazione 0029)

Fase 3 del piano PWA e notifiche. L'email è **solo un digest giornaliero**, opt-in e spento per difetto: nessuna email immediata, nemmeno per la moderazione (si vede già nel sito e nel banner di sospensione). Lo decide il proprietario, come le regole sotto.

- **La casella**: "Daily email digest" nella sezione Notifications di Settings (`components/notifiche/digest-email.tsx`, Server Action `setEmailDigestAction` in `lib/notify/actions.ts`, che chiama `set_email_digest`). Si accende solo con l'email verificata; spegnere si può sempre. Il consenso è `app_user.notify_digest_on_at` (null = spento): una colonna sola, non righe di `notification_pref`, perché voti e Helpful non sono tipi di notifica.
- **Cosa contiene** (`digest_due` in SQL, testi in `lib/notify/digest.ts`): le notifiche non lette toccate dall'ultimo digest, più "+N upvotes" sui clear e "+N players found your tips helpful", senza dire chi. Il feed degli admin (`site_activity`, 0032) **non** ci entra mai: il budget di Resend è condiviso con i magic link, e un sito attivo lo consumerebbe da solo. La moderazione è generica ("A moderator reviewed one of your posts", "There is an update about your account"), al massimo con l'evento: mai il testo dei post, il motivo della sospensione o la nota del moderatore. Ogni riga porta a `/notifications/<id>`. Un digest vuoto non parte. Chi è sospeso lo riceve lo stesso, come le notifiche nel sito.
- **Il cron**: `GET /api/cron/digest` (`vercel.json`, alle 17 UTC, su Hobby fino a 59 minuti dopo), con `Authorization: Bearer $CRON_SECRET` come la pulizia. Un giro (`lib/notify/run.ts`): se c'è la pausa si ferma; prende al massimo 40 utenti da `digest_due` (prima gli admin, poi chi ha moderazione, poi il digest più vecchio); chiede il budget per tutto il gruppo; manda i primi k con **una sola** `resend.batch.send`; segna con `digest_mark_sent` solo chi è partito. Chi non entra parte domani, con tutto quello che si è perso. Rilanciato lo stesso giorno non manda niente.
- **Idempotenza**: uno al giorno per utente lo garantisce `digest_mark_sent` (`notify_digest_day`). La Idempotency-Key di Resend vale per la richiesta intera, non per la singola email della batch: è `digest:<giorno>:<hash degli utenti>`. Se l'invio riesce e il segno no, il giro rilanciato lo stesso giorno riprende le stesse persone e la stessa chiave, e Resend non rimanda.
- **Il budget** (Resend Free: 100 al giorno e 3000 al mese, condivisi con i magic link): `email_quota` conta per giorno e tipo, senza indirizzi. I magic link si contano **dopo** l'invio (`countAuthEmail` in `lib/notify/budget.ts`, che `lib/auth/auth.ts` passa al mittente di `lib/auth/email.ts`) e non si rifiutano né si ritardano mai: un errore del contatore finisce nel log, il login va avanti. Il digest passa solo sotto 40 al giorno e 1200 al mese, dentro i totali di 60 e 2400. Al primo 429 o quota finita di Resend `notify_pause` lo ferma per 24 ore; il login no.
- **Disiscrizione**: ogni digest ha `List-Unsubscribe` e `List-Unsubscribe-Post` (RFC 8058). Il one-click è `POST /api/notifications/unsubscribe?t=<token>`, senza sessione né cookie; un GET su quell'URL porta alla pagina. `app/notifications/unsubscribe/page.tsx` (noindex, `Referrer-Policy: no-referrer`) col GET mostra solo un bottone: gli antivirus che aprono i link non disiscrivono nessuno. Il token (`lib/notify/token.ts`) è `v1.<user_id>.<notify_token_v>.<hmac>`; può solo spegnere.
- **Nessuna variabile nuova obbligatoria.** La chiave dei token si deriva da `BETTER_AUTH_SECRET` con un HMAC e un'etichetta fissa: cambiare quel segreto invalida i link vecchi (si spegne comunque da Settings). Per revocare i link di un utente solo, `notify_rotate_token` (lo fa da sé il database quando cambia l'email). Il mittente è `EMAIL_FROM`; `EMAIL_NOTIFY_FROM`, facoltativa, lo cambia per il solo digest (per esempio `Dokkan Team Sharing <notify@dokkants.emanuelemelini.dev>`, stesso dominio verificato).
- **In sviluppo** senza `RESEND_API_KEY` i digest non partono: finiscono in `dokkan-digests.log` nella cartella temporanea del sistema, accanto a `dokkan-magic-links.log`, con oggetto, header e testo. Per provare: accendi la casella, fatti commentare un clear da un altro utente, poi `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/digest`.
- **Conservazione**: `purge_email_quota()` nel cron della pulizia, i contatori dopo 40 giorni (gli stessi giorni in `lib/legale.ts`). La privacy dice che anche il digest passa da Resend, che il consenso si revoca dal link o da Settings, e cosa si conta.

Prove: il passo "digest email (SQL)" di `npm run db:test` (`db/test/digest.test.mts`: budget, selezione, contenuto, uno al giorno, disiscrizione) e il passo "digest email (app)" (`db/test/digest-app.test.mts`: firma e revoca dei token, testi e header, il mittente su file, il conteggio dei login che non fallisce mai, la rotta del cron con un mittente finto, priorità, idempotenza, pausa, la POST one-click senza cookie, la pagina e la casella).

In produzione la 0029 deve arrivare **prima** del codice: il conteggio dei login la chiama (senza, finisce solo nel log), il cron e Settings no.

## Push del browser (migrazione 0031)

Fase 4 del piano PWA e notifiche. Le push sono **opt-in e spente per difetto**: il permesso del browser si chiede solo al clic su "Turn on for this device" in Settings, mai prima (Chrome passa al prompt silenzioso per i siti che lo chiedono subito, e un `denied` non si può più richiedere). Lo decide il proprietario, come i testi sotto.

- **Cosa arriva**, gli stessi tipi della lista (fase 2): un commento sul mio clear, la moderazione dei miei contenuti e del mio account, le segnalazioni aperte (solo admin). In Settings un interruttore per gruppo (`lib/notify/push-kinds.ts`: Comments, Moderation, New reports), valido per tutti i dispositivi; scrive le righe `notification_pref(kind, 'push')` con `set_notification_pref`. Al primo "Turn on", se l'utente non ha ancora nessun tipo acceso, si accendono tutti i gruppi che vede: il clic è il consenso, e un dispositivo che non riceve niente sembrerebbe rotto.
- **Cosa dice la schermata di blocco** (`lib/notify/payload.ts`): per un commento l'handle di chi ha commentato e dove ("Goku_99 commented on your clear", "In <evento>, <stage>, <difficoltà>."), o "3 new comments on your clear"; per la moderazione una frase generica ("A moderator updated one of your posts", "A moderator updated your account"); per gli admin "N open reports". **Mai il testo di un post**: un commento nascosto un minuto dopo resterebbe sul telefono, e passa dai servizi push. Il dettaglio è nella lista del sito, che è privata.
- **Il payload** è JSON v1, al massimo 512 byte: `{ v, kind, title, body, url, tag, ts }`. `url` è sempre `/notifications/<id>` (segna letta e porta dove serve adesso), `tag` è `dts:<hash del gruppo>` (un commento nuovo sullo stesso clear sostituisce la notifica di prima), il Topic (RFC 8030) è l'hash del gruppo, così un telefono spento riceve solo l'ultima. TTL un giorno, Urgency normal.
- **iOS**: le push ci sono solo nell'app installata (iOS 16.4 o più). In Safari Settings spiega "Share, then Add to Home Screen" invece del bottone. L'app installata ha i cookie separati da Safari: lì si entra con Discord, Google o Twitch (l'avviso iOS della PWA).
- **I dispositivi** (`push_subscription`): al massimo 5 per utente, il sesto si rifiuta (Settings mostra la lista con Remove, e "This device" si riconosce da un'impronta dell'endpoint, mai l'endpoint intero). Lo stesso endpoint su un altro account passa all'ultimo che si iscrive. La label è grossolana ("Chrome on Android", `etichettaDispositivo` in `lib/pwa/piattaforma.ts`), mai lo user agent. "Send a test notification" una al minuto.
- **Chi manda**: `kickPush()` (`lib/notify/kick.ts`) fa partire un giro con `after()` di `next/server` subito dopo la scrittura che può aver creato notifiche: `addComment`, `setClearStatus`, `setCommentStatus`, `setTipStatus`, `suspendUser`, `unsuspendUser`, `reportContent`, `reportTip` e, dalla 0032 per il feed degli admin, anche `submitClear`, `reviseClear`, `deleteClear`, `voteClear`, `postTip`, `editTip`, `deleteTip`, `voteTip`, `dismissReports` (quando archivia qualcosa), `completeOnboardingAction`, `changeHandleAction` e `deleteAccountAction`. `after()` gira anche dopo un `redirect()`, e `push_claim` non chiede la sessione. Senza chiavi VAPID `kickPush` non fa nemmeno la query. Il feed non ha coalescenza né tetti, una push per azione, e non scrive `push_sent`: vedi sotto. Il giro (`runPush` in `lib/notify/push.ts`): `push_claim` con **una** query (skip locked, coalescenza di 30 minuti, i tetti contro lo spam: 20 push al giorno per destinatario, 10 l'ora per autore, 1 l'ora per coppia, nessuna da un account di meno di 24 ore o sospeso), il client pg torna subito alla pool, poi gli invii in parallelo (6 alla volta, 5 s al massimo ciascuno), poi **una** `push_report` con gli esiti. Nessun client resta aperto durante le chiamate HTTP: con 5 connessioni per istanza affamerebbe `/api/me`. Best effort, senza ritentativi: una push persa resta nella lista e nel digest.
- **Gli esiti** (`push_report`): 404 e 410 tolgono il dispositivo; un 2xx azzera gli errori; 413 e 429 si annotano e basta; tutto il resto conta un errore, e al terzo di fila il dispositivo se ne va.
- **Il mittente** (`lib/notify/push-send.ts`): `web-push` (3.6.7, versione esatta) costruisce la richiesta, cioè la cifratura aes128gcm e il token VAPID; la POST la fa `fetch`, con `redirect: 'manual'` (un 3xx non porta altrove) e `AbortSignal.timeout(5000)`. Contro l'SSRF l'host si ricontrolla un attimo prima della connessione con `lib/notify/endpoint.ts`, la stessa regola di `push_endpoint_ok` (solo https, porta 443, host di FCM, Mozilla, Apple e WNS): `db/test/push-endpoints.ts` tiene i casi che le due regole devono dare uguali.
- **Il service worker**: `push` mostra la notifica (icona `/pwa/icon-192.png`, badge `/pwa/badge-96.png`, tag); un payload che non si capisce mostra "You have new activity", perché con `userVisibleOnly` ogni push deve mostrare qualcosa. `notificationclick` accetta solo percorsi dello stesso sito: porta in primo piano una finestra già aperta e la manda all'URL, se no ne apre una. Nessun gestore per `pushsubscriptionchange`, di proposito: una rotta per rinnovare sarebbe una scrittura con i cookie fuori da una Server Action.
- **Il resync**: il client riallinea browser e server con la Server Action `resyncPushAction` a ogni visita di Settings e al massimo una volta al giorno dal menu (`components/notifiche/push-resync.tsx`, `localStorage['dts:push-resync']` con handle e ora; subito se sullo stesso browser entra un altro account). Senza iscrizione nel browser non parte nessuna richiesta. Se il server non conosce più il dispositivo (tolto da un altro browser, o un 404/410), il client toglie anche l'iscrizione del browser invece di riportarla in vita; con la chiave VAPID cambiata si iscrive di nuovo e il server sostituisce il vecchio endpoint.
- **L'uscita** (`components/auth/sign-out-button.tsx`): prima di `signOut` toglie questo dispositivo dal server mentre la sessione vale ancora (al massimo 1,5 s di attesa), poi l'iscrizione del browser. Su un computer condiviso chi entra dopo non riceve le push di prima. Cancellare l'account porta via dispositivi, registro e preferenze (cascata), e `/events?account=deleted` toglie l'iscrizione del browser.
- **Le chiavi VAPID**: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT` (`mailto:privacy@emanuelemelini.dev`, che è anche il valore per difetto), lette da `lib/notify/push-env.ts`. **Facoltative**: senza, o con un formato sbagliato, le push sono spente e basta (Settings non mostra la riga Browser, `kickPush` non fa nemmeno la query, `instrumentation.ts` scrive una riga nei log solo se sono a metà o sbagliate), quindi un deploy senza è sicuro. La pubblica arriva al browser come prop di Settings, non come `NEXT_PUBLIC_*`: cambiarla non chiede un nuovo build. Si generano con `npx web-push generate-vapid-keys` e vanno **solo** nelle variabili di Vercel Production (Sensitive), con una copia nel password manager: se la chiave si perde o cambia, tutte le iscrizioni smettono di funzionare (il resync rifà quelle dei browser che tornano sul sito). Mai in `.env.local` o in un file del repository.
- **In sviluppo** il service worker non si registra (`next dev` lo toglie), quindi Settings dice che le push vanno solo nel build di produzione. Per provarle: in una copia dell'albero, chiavi di prova nell'ambiente del solo server (`VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... npx next start`), `next build && next start` su localhost (un contesto sicuro anche senza https).
- **Conservazione**: `purge_push(90)` nel cron della pulizia: un dispositivo che il browser non conferma da 90 giorni, e il registro `push_sent` dopo 2 giorni (il tetto più lungo è di 24 ore). Gli stessi giorni sono in `lib/legale.ts`. La privacy dice quali servizi push ricevono la notifica (Google, Apple, Mozilla, Microsoft, anche fuori dall'UE), che il contenuto è cifrato, cosa si conserva e come revocare il consenso.

Prove: il passo "push del browser (SQL)" di `npm run db:test` (`db/test/push.test.mts`: host ammessi anche nel CHECK, chiavi, dispositivi, claim, tetti, esiti, conservazione, cascate); il passo "push del browser (app)" (`db/test/push-app.test.mts`, anche `npm run test:push`, senza database: `endpoint.ts` contro gli stessi casi del SQL, le chiavi VAPID, i gruppi, testi e misura del payload, il mittente vero contro un servizio push locale con il corpo decifrato secondo RFC 8291 e il token VAPID verificato, `public/sw.js` in `node:vm` per push e clic); il passo "push del browser (giro)" (`db/test/push-run.test.mts`: un giro vero sul database con un mittente finto, nessun client pg in uso durante gli invii, il 410 che toglie il dispositivo, la prova una al minuto). A mano: Chrome su Android, Firefox, Safari su macOS, iPhone con l'app installata.

In produzione la 0031 deve arrivare **prima** del codice, come le altre: Settings la legge appena ci sono le chiavi VAPID. Senza chiavi il codice nuovo non la tocca.

## Attività del sito per gli admin (migrazione 0032)

Decisione del proprietario: in Settings, nella sezione Notifications, un admin ha in più la casella **All site activity**, spenta per difetto: una notifica per **ogni** azione degli altri utenti sul sito. Il testo dice il minimo: chi (l'handle di adesso), cosa (un verbo breve) e dove (evento e stage), per esempio "alice posted a clear" con sotto "Extreme Z-Battle: ..., Level 10". Mai il testo di un post.

- **Il tipo** è `site_activity`, in coda a `notification_kinds()` e a `lib/notify/kinds.ts`. Solo per gli admin come `reports_open`: lo rifiutano `set_notification_pref` (`42501 notification_pref_admin_only`), la Server Action `setSiteActivityAction` (`lib/notify/actions.ts`) e la pagina, che rende `components/notifiche/attivita-sito.tsx` solo con `user.role === 'admin'`. Spegnere si può sempre.
- **L'interruttore** scrive insieme le righe `notification_pref(site_activity, 'list')` (il consenso: senza, non si scrive nessuna riga) e `(site_activity, 'push')` (le push, sui dispositivi dove le notifiche del browser sono accese), in una sola istruzione. Il canale `email` per questo tipo non esiste: lo rifiutano il verbo e il CHECK `notification_pref_channel_kind`. Il primo "Turn on for this device" non lo accende e non lo conta (`PUSH_SEPARATE`, `primaIscrizione` in `lib/notify/push-kinds.ts`).
- **Le azioni** (`site_activity_actions()`, ripetute in `lib/notify/attivita.ts`): clear inviato, rivisto, cancellato; commento; voto dato, cambiato o tolto; tip scritta, modificata, cancellata; Helpful dato o tolto; segnalazione; un iscritto che sceglie l'handle; un cambio di handle (anche le sole maiuscole); un account cancellato; e la moderazione degli **altri** admin (nascondere, rimostrare, archiviare le segnalazioni, sospendere, riattivare). Fuori: le proprie azioni (mai a se stessi), accessi, letture, impostazioni personali, `set_user_role` (è uno script), import, seed e fixture (`dts.silent`), le cascate (cancellare un clear o un account è **una** azione, non i voti e i commenti che si porta via) e le scritture che non cambiano niente (lo stesso voto due volte, una modifica identica, una segnalazione doppia, uno stato di moderazione già quello).
- **Chi scrive**: come in 0028, solo il database, nella stessa transazione della scrittura. I trigger per le righe nuove e la moderazione (`activity_clear`, `activity_tip`, `activity_tip_edit`, `activity_moderation_action`, `activity_app_user`); le funzioni per il resto (`revise_clear`, `delete_clear`, `vote_clear_version`, `comment_clear_version`, `delete_tip`, `vote_tip`, `delete_account`, e `notify_report` nello stesso giro di `reports_open`). Tutte passano da `activity_note`, che trova gli admin iscritti (role admin, con l'handle, non sospesi) con l'indice parziale `notification_pref_site_activity`, e da `activity_upsert`, che è `notify_upsert` per il feed (il pallino, poi la riga).
- **Le esclusioni** di 0028 valgono anche qui: chi è segnalato, anche se admin, non riceve niente; l'autore di un contenuto moderato riceve la sua notifica personale e non il feed; chi segnala non compare mai, e la riga di una segnalazione non lo tiene nemmeno come attore (`actor_id` null; `reports_open` lo tiene per i tetti delle push di 0031). L'autore del clear commentato, se è un admin col feed acceso, riceve **anche** la riga del feed oltre a `clear_comment`: la push di `clear_comment` ha la coalescenza e i tetti di 0031 (niente da un account nuovo), quella del feed no, e il feed non deve perdere azioni.
- **Una riga per gruppo** finché non è letta: il gruppo è azione e bersaglio (`act:clear_vote:<clear>`, `act:comment:<clear>`, `act:mod:hide:clear:<id>`, `act:account_deleted`...), `data.n` conta le azioni e `data.a` dice l'ultima: "4 vote changes on a clear", "latest: bob upvoted". Dopo la lettura l'azione dopo apre una riga nuova.
- **Privacy**: `data` può tenere solo `a`, `n` ed `event`/`tier` (gli id dei dati di gioco di un clear o una tip cancellati), lo impone il CHECK `notification_activity_data`. Handle, nomi dell'evento e stato si ricalcolano a ogni lettura. La colonna nuova `notification.subject_id` (a cascata) dice di chi parla una riga (iscritto, handle, sospensione): cancellato l'account, quelle righe se ne vanno, l'attore delle altre va a null ("Someone") e "An account was deleted" non lo nomina. Nessun handle si salva mai come testo, nemmeno quello lasciato. La privacy lo dice nel punto "Site activity for moderators".
- **La lettura**: `notification_rows` (ridefinita) dà per il feed `action`, `subject_handle`, il target (`profile` per iscritti, handle e sospensioni, `none` per un account cancellato), l'evento e il tier anche dai dati di un contenuto cancellato, e `visible` solo se il destinatario è ancora admin. I testi e i link sono in `lib/notify/attivita.ts`: l'ancora del clear o della tip, `/admin/hidden` per un contenuto nascosto ora (`/admin/hidden?kind=tip` per una tip), `/admin` per una segnalazione, `/admin/log` per la moderazione, il profilo per iscritti e handle, la lista per quello che non c'è più. Tutto passa da `/notifications/<id>`, come gli altri tipi.
- **Le push**: `push_claim` (ridefinita) per il feed non ha la coalescenza di 30 minuti di 0031, né un'altra: una riga già mandata e toccata dopo riparte al giro dopo, cioè a quello che `kickPush()` fa partire nell'`after()` della scrittura stessa, con il totale e l'ultima azione. Quindi **una push per azione**, e nessuna aspetta la scrittura di qualcun altro (non c'è un cron delle push). Lo stesso tag prende il posto della notifica di prima dello stesso gruppo sul dispositivo, senza suonare di nuovo (`sw.js` non chiede `renotify`), e il Topic fa lo stesso col telefono spento: una raffica di 30 voti sullo stesso clear sono 30 push, ma sul dispositivo resta una notifica sola, "30 vote changes on a clear" con l'ultimo. Se un giro non riesce (un errore nell'`after()`), il resto lo prende il primo giro dopo, fino a un giorno dall'ultima azione (`activity_push_caps()`), anche oltre la finestra dei 10 minuti, con l'indice parziale `notification_activity_pending`; oltre il giorno resta solo nella lista. Niente tetto di 20 al giorno, nessun tetto per attore e nessuna riga in `push_sent`: il feed non consuma le push dei commenti, della moderazione e delle segnalazioni, e arriva anche dagli account nuovi, che sono proprio quelli che un moderatore vuole vedere. `updated_at` e `pushed_at` del feed usano `clock_timestamp()`, così una scrittura che ha aspettato il lock di un claim non resta indietro.
- **L'ordine dei lock**: ogni azione blocca le righe di `app_user` degli admin iscritti, in ordine di id e fino al commit (il pallino). Le funzioni di chi scrive le prendono **prima** di toccare il contenuto, e `activity_note` blocca nello stesso ordine anche gli admin che salta (chi è moderato, chi cancella il proprio account), così due scritture sullo stesso clear vanno in fila senza incrociarsi. Restano possibili, rari, gli incroci con un moderatore (che ha già la sua riga da `mod_assert`), con chi cambia handle o con chi modifica una tip mentre qualcuno la vota: Postgres ne annulla uno con 40P01, e `sql()` di `lib/db.ts` riprova l'istruzione una volta (è un'istruzione sola in autocommit, annullata per intero).
- **Un admin che torna membro** (`set_user_role` o qualsiasi update del ruolo) perde il consenso: il trigger `activity_role_lost` toglie le sue preferenze di `site_activity` (da membro Settings non gliele mostra più, e non potrebbe ritirarle) e le righe del feed che aveva. Se torna admin, il feed resta spento finché non lo riaccende lui. Una segnalazione nello stesso istante non gliene lascia una nuova: `notify_report` sceglie gli admin senza lock, ma `activity_upsert` ricontrolla il ruolo sulla riga bloccata. `reports_open` resta com'era in 0028 e 0031: la preferenza push rimane, a un membro non arriva niente (le righe non sono visibili), e se torna admin le push delle segnalazioni ripartono da sole. Il ruolo si controlla comunque anche a ogni scrittura e a ogni lettura.

Prove: il passo "attivita' del sito" di `npm run db:test` (`db/test/attivita.test.mts`: spento per difetto, le preferenze, ogni azione con la sua riga, render, testi e link veri, mai a se stessi, le esclusioni, `dts.silent`, le scritture che non cambiano niente, l'accorpamento, il rollback, il limite per famiglia, il pallino che si spegne anche con più di 50 gruppi non letti e quante azioni non mostrate `mark_list_read` dice alla pagina, `push_claim` con una push per azione (una raffica di 30 voti sono 30 push col totale fin lì e lo stesso tag, il resto di un giro non riuscito anche oltre i 10 minuti) e senza tetti, il digest che non lo manda, le cascate, nessun handle dopo `delete_account`, chi segnala mai nemmeno come attore, l'admin che torna membro e perde consenso e righe del feed, anche con una segnalazione nello stesso istante su due connessioni, mentre `reports_open` resta com'era); in "notifiche (app)" le azioni uguali alla migrazione e al CHECK, testi e link su righe finte per ogni azione, la casella solo per gli admin e `kickPush()` dopo ogni scrittura; in "push del browser (app)" (`npm run test:push`) i gruppi e il tipo a parte, il testo e la misura del payload per ogni azione; in "push del browser (giro)" una push del feed con un mittente finto.

In produzione la 0032 deve arrivare **prima** del codice: Settings, la lista e le push leggono `action` e `subject_handle`, e `/notifications` chiama `mark_list_read`. Il codice vecchio sulla 0032 va: le colonne nuove sono in coda, e senza nessun admin iscritto non si scrive niente di nuovo.

## La produzione: Vercel, Supabase, Cloudflare

Deciso: tutto sui piani gratuiti, senza carta da nessuna parte. Superare
una quota ferma un servizio invece di addebitarlo, e il codice è scritto
per non arrivarci.

- **App** su Vercel Hobby (`https://dokkants.app`, CNAME sull'apex con il
  flattening di Cloudflare, in "DNS only"; `www` porta all'apex con un 308),
  funzioni in `fra1` (`vercel.json`), accanto al database. Il dominio di
  prima, `dokkants.emanuelemelini.dev`, resta su Vercel solo come redirect
  308 verso lo stesso percorso su `dokkants.app`.
- **Database** su Supabase Free a Francoforte. A runtime `DATABASE_URL` è il
  pooler Supavisor in **transaction mode** (porta 6543); migrazioni e
  restore passano dalla connessione diretta o di sessione. Il codice non usa
  niente di legato alla sessione (SET, LISTEN, lock di sessione): i lock
  sono `pg_advisory_xact_lock`, dentro la transazione.
- **Immagini** su Cloudflare Pages (`https://assets.dokkants.app`; il dominio di
  prima `dokkants-assets.emanuelemelini.dev` resta collegato, per le pagine
  e le email gia' in giro),
  caricate con `wrangler pages deploy public/assets`. `ASSET_BASE_URL` punta
  lì; il database non cambia.
- **Email** da Resend (il mittente di `EMAIL_FROM`, un indirizzo
  `@dokkants.app`), con i record sul sottodominio `send.dokkants.app` e
  `resend._domainkey.dokkants.app`: non toccano l'Email Routing dell'apex.
  La chiave API di Resend e' limitata al dominio da cui si spedisce: con un
  dominio nuovo va cambiata anche lei.

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
- `robots.ts` e `sitemap.ts`: indicizzati eventi, carte e profili; fuori
  API, accesso, Settings, `/admin`, pagine di invio e modifica e le viste
  filtrate (`/events/browse`, `/events/*/clears`). La sitemap ha `/events`,
  tutti gli eventi e le carte uscite su Global (i profili no), in cache
  per un giorno.
  **Il build legge il database** (solo SELECT): prerenderizza `/events`, la
  sitemap, fino a 100 eventi, 100 carte e 20 profili (sezione "Cache e
  budget CPU"), quindi
  `DATABASE_URL` deve rispondere anche durante il build.
  `robots.txt` è statico e prende l'URL da `BETTER_AUTH_URL` **al build**.
- `.vercelignore` lascia fuori `public/assets` (1,2 GB) e le cache
  dell'import: il build non ne ha bisogno.

Le variabili su Vercel, una per una, e tutti i passi della prima messa
online sono nella sezione seguente. Le prove: `npm run db:test` (passi
"configurazione di produzione" e "script di produzione").

## Cache e budget CPU

Vercel Hobby dà 4 ore di CPU attiva al mese, senza extra. Per questo le pagine pubbliche (`/events`, `/events/<id>/…`, `/cards/<id>`, `/users/<handle>`) non leggono mai né la sessione né la query string: sono prerender (ISR) che la CDN serve senza invocare funzioni. Chi è dentro costa una sola richiesta a `/api/me` per pagina; chi non è dentro, niente.

- **URL**: `/events` e `/events/japan` (statiche, le home di Global e Japan) · `/events/browse?region=&type=&status=&q=&page=` (viste filtrate, dinamiche, noindex, escluse da `robots.txt`) · `/events/<id>` · `/events/<id>/japan` · `/events/<id>[/japan]/t/<tier>` · `…/t/<tier>/p/<n>` (n ≥ 2) · `/events/<id>/clears?tier=&…` (la lista filtrata dei clear, dinamica, noindex, esclusa da `robots.txt`) · `/cards/<id>` · `/users/<handle>[/p/<n>]`. Si costruiscono solo con `lib/urls.ts` (`eventHref`, `browseHref`, `clearListHref`, `cardHref`, `profileHref`). Un tier che non è dell'evento, `p/1` o una pagina oltre l'ultima sono 404. Su `next start` e su Vercel la prima visita a un URL non prerenderizzato riceve lo shell con 200 e il 404 nello stream (noindex); dalla seconda visita è un 404 vero, dalla cache. `/` porta a `/events` con un 307 (`next.config.ts`). Restano con la query string le pagine per utente: `/events/<id>/submit?region=&tier=` (la regione c'è sempre, anche global) e `/events?account=deleted` dopo la cancellazione dell'account (l'avviso lo legge un'isola client). Un `?region=global` su una pagina evento la marca per chi ha scelto Japan (sezione "Versione Global/Japan"): la pagina non lo legge, è la stessa voce in cache. `/events`, `/events/japan` e ogni pagina evento hanno il loro `canonical`, quindi `?region=global` e `?account=deleted` non sono doppioni.
- **Dati**: `lib/cache/*.ts` (`'use cache'` con `cacheLife` e `cacheTag`: `data.ts`, `cards.ts`, `tips.ts`, `filters.ts`, `profiles.ts`) avvolge i moduli di query (`lib/queries.ts`, `lib/clears.ts`, `lib/card-page.ts`, `lib/tips.ts`, `lib/profiles.ts`), che restano senza cache perché i test li importano fuori da Next (lo controlla una guardia in `cache-tags.test.mts`). eslint vieta a `lib/cache/*` di importare `lib/dal`, `lib/auth` e `next/headers`. Tag: `catalog`, `events-list`, `community`, `event:<id>`, `card:<id>`, `profile:<handle>`. Lo stato degli eventi (Ongoing/Ended) scade al prossimo inizio o fine di una run (minimo 5 minuti).
- **Invalidazione** (`lib/cache/invalidate.ts`): invio, revisione, cancellazione e commento rigenerano subito l'evento (`updateTag`), e invio, revisione e cancellazione anche le carte del clear e il profilo dell'autore; il voto lo segna vecchio senza rigenerare (`revalidateTag` `'max'`): gli altri vedono il voto dopo una visita, chi vota lo vede subito da `/api/me`. Cambio di handle, cancellazione dell'account e sospensione passano da `afterUserChanged`, che raccoglie dal database eventi, carte e handle toccati (sopra 300 id invalida tutto `community`). Mai `revalidatePath('/', 'layout')`.
- **Chi guarda**: il cookie `dts_signed_in=1` (non segreto, non httpOnly) lo mette better-auth a ogni accesso e lo toglie l'uscita; solo con lui il browser chiama `/api/me` (private, no-store). Header, voto, Edit/Delete, commenti e invio sono isole client (`components/viewer`). La versione del sito è il cookie `dts_version` (non segreto, non httpOnly): lo legge lo script del `<head>`, mai una pagina pubblica, e i suoi redirect stanno in `next.config.ts`, cioè sulla CDN. Nessuna pagina cambia col cookie: con il cookie Japan un URL senza versione è un 307 (che non va in cache), e un URL marcato è lo stesso per tutti, quindi niente `Vary`. Chi non ha il cookie non paga niente, chi è su Japan una richiesta in più alla CDN per redirect, mai una funzione.
- **Import**: in produzione `db/prod/update.mjs` chiama `POST /api/revalidate` (Bearer `CRON_SECRET`, la stessa variabile del cron; serve anche `PROD_SITE_URL`, da mettere nell'ambiente degli script di produzione per la routine a mano). In locale `db:import`, `db:refresh` e `db:demo` finiscono con `npm run cache:clear`; dopo una modifica a mano con psql lancialo tu, altrimenti `next dev` mostra i dati vecchi fino al riavvio. In `next dev` senza `CRON_SECRET` la rotta è aperta.
- **Build**: legge il database (solo SELECT): fino a 100 eventi Global in corso o in arrivo, fino a 100 carte (le più usate nei clear), i 20 profili con più clear, `/events`, `/events/japan` e la sitemap (tutti gli eventi, `/events/japan` e le carte uscite su Global). Sulla macchina di sviluppo dura pochi secondi (6-9 s con la cache di Turbopack, 167 pagine generate). Se Supabase Free è in pausa, il build fallisce. Ogni deploy riparte con la cache vuota.
- **Misure** (`test/cpu.sh` su `next start` locale, 200 richieste per classe, ms di CPU per richiesta). "Prima" è la base di partenza, con ogni pagina dinamica; "fase 1" è dopo la cache; "fase 4" è la misura finale prima della messa online, l'8 ottobre 2026, con filtri e profili (stesso metodo, `next build` e `next start -p 3550` su `dokkan_dev`, `CPU_PROFILE_HANDLE=demo_rotation`):

  | classe | prima (ogni pagina dinamica) | fase 1 | fase 1, NEXT_CACHE_MEMORY=0 | fase 4 (2026-10-08) |
  |---|---|---|---|---|
  | /events | 8,50 | 1,65-1,85 (HIT) | 2,55 | 1,45 (HIT) |
  | pagina evento (20 id) | 6,10 | 1,40 (HIT) | 16,45 | 1,30 (HIT) |
  | pagina tier (16) | 5,45 | 1,30-1,85 (HIT) | 27,75 | 1,25 (HIT) |
  | /events/browse | 7,85 | 12-16 (dinamica) | 12,55 | 11,05 (dinamica) |
  | /api/cards | 1,50 | 1,2-2,2 | 1,30 | 1,60 |
  | /cards/<id> (20 dalla sitemap) | | | | 0,95 (HIT) |
  | lista filtrata dei clear (16 tier, `proof=1`) | | | | 9,70 (dinamica) |
  | /users/<handle> | | | | 1,05 (HIT) |

  In fase 4 nessuna classe ha rifatto dati (`dati MISS` 0) né rigenerato pagine (`ISR` 0) durante le 200 richieste. Le due classi dinamiche, `/events/browse` e la lista filtrata, sono le sole che su Vercel invocano una funzione a ogni vista: per questo sono noindex, fuori da `robots.txt` e raggiungibili solo dal form o da link `nofollow`. In locale anche una pagina in cache passa da Node (circa 1 ms); su Vercel esce dalla CDN e costa zero. La colonna NEXT_CACHE_MEMORY=0 è il caso peggiore: in locale le pagine generate a richiesta non restano, su Vercel stanno nella cache ISR durevole. Dopo il deploy: Vercel Observability → Functions (CPU attiva per rotta) e la pagina Usage (invocazioni, scritture ISR).
- **Come misurare**: `npm run build`; `NODE_ENV=production NEXT_PRIVATE_DEBUG_CACHE=1 npx next start -p 3100 > /tmp/next.log 2>&1 &`; `CPU_URL=http://localhost:3100 CPU_LOG=/tmp/next.log npm run test:cpu`. Le classi carte, filtri e profili prendono gli URL dalla sitemap e dalle pagine dei tier; `CPU_PROFILE_HANDLE` aggiunge un profilo. In locale servono anche `RESEND_API_KEY` ed `EMAIL_FROM` finti, e `VERCEL=1` per non fare la pulizia delle sessioni su `dokkan_dev`.

**Con `next start` (e su Vercel) una pagina dinamica risponde 200 anche quando finisce in un 404 o in un redirect.** Il layout è un prerender, quindi lo shell parte subito con 200, e `notFound()` o `redirect()` arrivano nello stream (con noindex, o con il redirect che il browser segue). Vale per `/settings` e `/welcome` senza sessione, per `/events/<id>/clears?tier=abc` e per la prima visita a un URL pubblico non prerenderizzato; dalla seconda visita quest'ultimo è un 404 o un 308 vero, dalla cache. Il 308 servito dalla cache locale non ha l'header Location (il redirect sta nel corpo): da controllare su Vercel al primo deploy. `next dev` invece risponde con i codici veri.

**In locale su macOS non provare le maiuscole diverse di un profilo contro `next start`.** La cache ISR locale sta su file, e APFS non distingue le maiuscole: il 308 di `/users/DEMO_ROTATION` prende il posto della voce di `/users/demo_rotation`, che poi risponde con un redirect a se stessa fino al build dopo. Su Vercel la cache ISR non sta su un file system locale, ma va provato al primo deploy; `test:smoke` con `SMOKE_EXPECT_CACHE=1` salta quella verifica.

Le prove: `npm run db:test` (passi "URL degli eventi" e "cache: tag e /api/revalidate") e `npm run test:smoke`, che con `SMOKE_EXPECT_CACHE=1` contro `next start` controlla anche che la seconda visita a `/events`, a un evento, a una carta e a un profilo sia un `x-nextjs-cache: HIT`.

## Messa online

L'istanza ufficiale gira su Vercel Hobby, Supabase Free e Cloudflare Pages
(sezione "La produzione"). La guida passo passo per metterla online e
tenerla aggiornata (account, domini, chiavi, la routine e il workflow
settimanale) non sta in questo repository: è in un repository privato del
proprietario.

Per un fork, in breve:

1. Un Postgres 15 o più recente con TLS e il suo certificato CA.
   `PROD_DATABASE_URL` (più `PROD_SITE_URL` e `CRON_SECRET`, per
   rinfrescare le pagine dopo l'import) nell'ambiente, poi
   `npm run prod:setup -- --yes`: migra, toglie i permessi ai ruoli API di
   Supabase sullo schema pubblico e importa i dati, senza fixture né demo.
   Gli script di `db/prod` rifiutano i database locali e quelli di
   sviluppo o di test, e senza `--yes` stampano il bersaglio e si fermano.
   Le migrazioni che arrivano dopo si portano online con
   `npm run prod:migrate -- --yes` (migrazioni e permessi, senza rifare
   l'import). L'ordine rispetto al codice dipende dalla migrazione (sezione
   "Sulle migrazioni"): una colonna che il codice nuovo legge va **prima**
   del codice (0027, 0028, 0034, e la 0035 con la funzione che chiama), un vincolo che il codice di prima non rispetta
   va **subito dopo**, a meno che il codice di prima non scriva mai in
   quel frattempo (la 0033, punto 5).
2. Le immagini di `public/assets` su un host statico
   (`npm run assets:deploy` le pubblica su Cloudflare Pages) e
   `ASSET_BASE_URL` che punta lì.
3. Sull'host Next.js le variabili `DATABASE_URL`, `DATABASE_CA_CERT`,
   `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `RESEND_API_KEY`,
   `EMAIL_FROM`, `ASSET_BASE_URL`, `CRON_SECRET`, e le coppie
   `*_CLIENT_ID` / `*_CLIENT_SECRET` dei provider OAuth che vuoi
   (Discord, Google, Twitch: un provider senza le sue due variabili non
   compare). Senza `RESEND_API_KEY` o `EMAIL_FROM` il server di
   produzione non parte, e senza `DATABASE_CA_CERT` la pool rifiuta un
   database remoto. Facoltative: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
   e `VAPID_SUBJECT` per le push del browser (senza, restano spente).
4. Il primo admin solo da script: `npm run prod:role -- <handle> admin --yes`.
5. L'aggiornamento settimanale (`.github/workflows/weekly-data.yml`) e il
   giro giornaliero delle immagini (`.github/workflows/daily-images.yml`)
   girano solo su questo repository: in una fork va adattata la condizione
   `github.repository`. Partono in prova e scrivono in produzione solo con
   la variabile `WEEKLY_APPLY=true`, la stessa per tutti e due; il commento
   in cima a ciascun file dice come tratta segreti e log in un repository
   pubblico. Il giornaliero non chiede secret nuovi. Il secret
   `OPS_ARCHIVE_TOKEN` (environment `production`) è facoltativo: senza,
   l'archivio privato del datamine si salta con una notice (sezione "Fonti
   fresche e copia del datamine"). Per la 0033: con `WEEKLY_APPLY=true`
   prima il codice che scrive `asset.source` su `main`, e subito dopo
   `npm run prod:migrate -- --yes`; in prova può andare online prima del
   codice, insieme alla 0032. Finché la 0033 manca, il settimanale
   e il giornaliero non scrivono niente: si fermano da soli a
   `migrate --check` (nel giro di prova) o a `check-schema` (in
   `prod:update`). L'ordine contrario invece fa fallire le righe nuove di
   `asset` del codice di prima (sezione "Da dove viene un'immagine").

## Cosa manca, in ordine

Il codice per la messa online è finito e verificato (`db:test`, `tsc`,
`eslint`, `next build`, `test:smoke` anche contro `next start`,
`test:auth-smoke`, `test:cpu`). Restano i passi che solo il proprietario
può fare, e poi il lavoro sui dati e sulle pagine.

0. **La messa online, a mano.** Gli account (Supabase, Cloudflare Pages,
   Resend, Vercel, le console OAuth di Discord, Google e Twitch) li crea il
   proprietario, seguendo la sua guida privata. Nessuno script crea
   account o pubblica da solo. Facoltativi: il repository privato
   `dokkan-team-sharing-ops` e il secret `OPS_ARCHIVE_TOKEN`, per la copia
   durevole del datamine (sezione "Fonti fresche e copia del datamine").
1. **Il calendario, da tenere vivo.** Il workflow settimanale rifà datamine, eventi e finestre ogni venerdì. Le prime
   settimane gira in prova (`WEEKLY_APPLY=false`, e `dry_run` acceso nei
   lanci a mano): leggi 2-3 riepiloghi, aggiusta `db/prod/limits.json` se
   serve, controlla che i file su Pages siano quelli della tabella `asset`,
   poi metti `WEEKLY_APPLY=true`. Lo stesso interruttore vale per il giro
   giornaliero delle immagini, che in prova scrive solo il piano ("Dry run:
   would fetch N files"). La 0032 e la 0033 vanno online con
   `npm run prod:migrate -- --yes` subito prima del push di questo codice
   (il settimanale è in prova: vedi la sezione della 0033), e lo stesso la
   0034, sempre prima del codice; poi un giro a mano del giornaliero ripara
   le miniature LR senza cornice (sezione "Le miniature e la cornice").
   Anche la 0035 va online prima del codice della versione Global/Japan
   (`npm run prod:migrate -- --yes`, poi il push), e dopo il deploy vanno
   fatti i controlli della sezione "Versione Global/Japan" (i redirect
   compilati dalla CDN, i 307 senza invocazioni, `?region=global` dalla
   cache). Nei riepiloghi guarda anche le sezioni "Sources"
   (la freschezza del datamine) e "Storage". Japan resta senza finestre
   vere, e 374 eventi Global restano "attivi, fine non nota" (312 del wiki,
   62 del gioco). Le corse di un'area riaperta dopo più di un mese partono
   dall'ultimo blocco: la corsa di prima non ha una run del gioco sua.
2. **Gli eventi del gioco, da completare.** Non hanno descrizione né banner
   (nessuna fonte: il datamine ha solo i percorsi dei file, il wiki non li
   carica più), e 19 non hanno nemmeno la copertina, perché il boss è una
   carta senza pagina sul wiki: al suo posto c'è il segnaposto del tipo di
   evento, e alcune copertine arriveranno con le miniature per convenzione
   di quelle carte. Restano fuori, elencati da
   `load-game-events`: i due archivi (1737 Ultimate Red Zone, 1738 Supreme
   Magnificent Battle, che andrebbero modellati come finestre permanenti
   delle edizioni che contengono), le aree 710/720 della Super Battle Road
   (due aree per 15 pagine del wiki), l'area 807 (categoria 27, tipo ignoto)
   e i capitoli della storia. Le edizioni RE e le Super EZA non sono ancora
   collegate al loro originale nell'interfaccia (il dato per le Super c'è:
   `related_game_id`). La fusione di un evento del gioco con una pagina del
   wiki scritta dopo è a mano.
3. **Le carte senza pagina sul wiki.** Il conto di 59 unità che stava qui
   era vecchio: di quelle 59 unità Global giocabili, 46 sono nella tabella
   `card` dal gioco (45 dal prossimo import, perché la pagina abbozzata di
   1034150 ora si aggancia) e 13 restano fuori di proposito, 8 copie o
   riedizioni di altre carte e 5 alla data minima del lancio (2015-10-30).
   A quelle in tabella mancano epiteto, statistiche e testi delle skill.
   Le immagini invece il wiki le ha quasi tutte: `File:Card_<id>_thumb.png`
   per 34 delle 46 e `_artwork.png` per 31, e `fetch-assets` ora le chiede
   (sezione "Le carte senza pagina: i nomi per convenzione"). 12 non hanno
   ancora nessun file. Sono anche i boss che mancano nelle copertine. In
   produzione le immagini arrivano al primo giro applicato, settimanale o
   giornaliero.
4. **Le missioni, da completare.** Ci sono (7720, con i premi) e la
   pagina evento le mostra. Restano fuori le missioni
   Burst Mode degli archivi (serve una tabella `genkai_battles` che il
   datamine non esporta), i piani 61+ della Extreme Super Battle Road (il
   wiki non ha la pagina, e un evento del gioco per loro non c'è ancora) e
   le campagne su più eventi. Japan non ha missioni: il datamine è Global.
   Solo 45 oggetti su 1677 hanno un'icona; per gli altri manca una fonte (il
   wiki non le ha, le immagini del gioco non le abbiamo), e restano solo
   testo. Una carta come premio senza miniatura ha il segnaposto.
5. **L'invio, da rifinire.** Le pagine ci sono (sotto). Mancano la storia
   delle versioni nella pagina (`getClearVersions` è pronta), un modo di
   riusare le proprie squadre invece di ricomporle. Il picker propone le
   carte uscite nella versione del clear (le solo giapponesi nei clear
   Japan); il builder accetta comunque qualsiasi carta.
6. **La lingua, e il resto della versione Japan.** Il sito è in inglese
   anche nella versione Japan: il passo dopo è il giapponese sui percorsi
   `/japan` (sezione "Versione Global/Japan", "La lingua, dopo";
   `app_user.locale` c'è già). Non fatti per ora: il prerender al build
   delle pagine Japan degli eventi recenti (`staticEventIds` è solo
   Global) e le pagine evento Japan nella sitemap (c'è solo
   `/events/japan`).
7. **Piccole cose lasciate aperte.**
   - Un commento su un evento dove l'autore non ha altri clear né commenti
     aggiorna il conteggio dei commenti del suo profilo solo alla
     rivalidazione giornaliera: l'azione del commento non invalida
     `profile:<handle>` (basterebbe passare l'handle a `afterClearWrite`
     e aggiungere i profili al caso `comment` di `tagsFor`).
   - Nessuna vista "tutti i clear con questa carta" fra eventi: la pagina
     della carta mostra i 10 migliori. `lib/clears/filtri.ts` e
     `filtroClear` sono pronti per farla senza tier.
   - Su Vercel, come con `next start`, le pagine dinamiche rispondono 200
     con il 404 o il redirect nello stream, e un 308 dalla cache può non
     avere Location (sezione "Cache e budget CPU"): da guardare al primo
     deploy.
   - Con i dati veri, controllare con EXPLAIN che la lista filtrata usi
     l'indice `clear_by_tier`: sui dati di prova il planner non lo sceglie.
   - I menu Leader e Category dei filtri tagliano i nomi lunghi oltre
     16rem.
   - Il marchio: prima del lancio, una ricerca di marchi e per immagini
     (Google Immagini, icone di Chrome e Google Foto) per escludere forme
     troppo vicine.

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
