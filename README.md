# Dokkan Team Sharing

Un indice di clear per Dragon Ball Z Dokkan Battle: per ogni evento, i team
che l'hanno chiuso davvero — con build, rotazioni e una prova.

La cosa che nessun altro sito fa non è il database eventi né il team builder:
quelli esistono già e sono presidiati bene. È **l'aggancio fra un clear e
l'evento che ha chiuso**, in forma di dato interrogabile. L'analisi che porta
a questa conclusione sta in `docs/`.

## Stato

Lo strato database è completo e verificato, e dentro ci sono le carte vere.
Il codice applicativo non è ancora iniziato: quello che c'è è lo scheletro
Next.js appena generato.

- **42 tabelle, 3 view, 4 trigger, 16 funzioni** su PostgreSQL 15
- **2651 carte** importate dal wiki, con link skill, categorie, statistiche
  e date di uscita separate per Japan e Global
- **599 eventi** con 5618 stage e 6916 difficoltà, banner compresi; più
  **192 eventi dal gioco** che il wiki non documenta (2025-2026, EZA e Super
  EZA), con 1667 stage e 1890 difficoltà, senza banner né descrizione
- **7720 missioni Global** dal gioco su 642 eventi, con 13322 premi
  strutturati (1677 oggetti, ognuno col suo nome)
- **6246 immagini** ospitate da noi
- **262 verifiche automatiche** in `db:test`, tutte verdi, su un database
  a parte che non è quello di sviluppo
- **0 righe** di codice applicativo

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

### I test, e perché girano su un database a parte

`npm run db:test` è un comando solo, che mette in fila tutto su
**`dokkan_test`**, un database che esiste solo per questo:

1. lo ricrea da zero con le migrazioni e la fixture (`db/reset.mjs --fixture`);
2. verifica **schema e vincoli** (`schema.test.sh`, 28 controlli) e
   **l'API di scrittura** (`write_api.test.sh`, 68);
3. ci importa i dati veri dalle cache locali (carte, eventi, datamine), senza
   nessuna richiesta di rete;
4. verifica le **query che alimentano le pagine** chiamando le funzioni vere
   di `lib/queries.ts` (`queries.test.mts`, 124) e i **parametri dell'URL**
   di `lib/parametri.ts` (`parametri.test.mts`, 42).

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
codici HTTP e i testi chiave della lista eventi, della ricerca con `_`, `%`
e `%00`, delle pagine che non esistono (404, non 500), di un'EZA e di una
sfida. Gli eventi da aprire li prende dalla lista: servono i dati importati,
non i clear dimostrativi.

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
db/
  migrations/               NNNN_*.sql, applicate in ordine, mai modificate
    0001_schema.sql         tabelle, view, indici, trigger dei punteggi
    0002_write_api.sql      proof_host, trigger di congelamento, funzioni
    0016_clear_builder.sql  invio e revisione dal sito in una transazione, assetti congelati
    0017_rerun_stages.sql   stage.game_quest_id: gli stage che una riedizione aggiunge
    0018_slot_builds.sql    le build degli slot (Hidden Potential, Skill Orb), congelate con la versione
    0019_account_settings.sql  Settings: unlink_provider, delete_account, le segnalazioni col bersaglio
  seed/                     demo-clears.mjs: tre clear dimostrativi su un evento vero (db:demo)
  queries/reference.sql     le query di lettura principali, documentate
  test/                     le verifiche: run.sh le mette in fila (npm run db:test)
  import/
    fetch-wiki.mjs          scarica il wikitext delle carte, in cache
    fetch-events.mjs        scarica il wikitext degli eventi, in cache
    load-cards.mjs          interpreta le carte e le scrive, idempotente
    load-game-cards.mjs     le carte uscite su Global senza pagina wiki, dal datamine (db:game-cards)
    game-cards.mjs          la sua scelta: quali righe del datamine sono carte che mancano davvero
    load-events.mjs         idem per eventi, stage e difficoltà
    load-game-events.mjs    gli eventi che il wiki non ha, dal datamine del gioco
    game-events/            i suoi moduli: classify, build, write, i legami del wiki, gli stage delle riedizioni
    quest-refs.mjs          i legami per quest (Super Battle Road, archivi), per load-windows
    load-missions.mjs       le missioni Global e i loro premi, dal datamine (db:missions)
    missions/               i suoi moduli: owner (di che evento), text, rewards, write
    load-equipment.mjs      le Skill Orb e le abilita' del Hidden Potential, per le build (db:equipment)
    fetch-assets.mjs        scarica le immagini e le registra in asset
    .cache/                 il wikitext scaricato (non versionato)
public/assets/              le immagini ospitate da noi (non versionate)
  migrate.mjs               runner: applica le pendenti, una transazione ciascuna
  reset.mjs                 ricostruisce il database di sviluppo da zero
  local.sh                  avvia/ferma il cluster locale
docs/                       l'analisi competitiva e le decisioni di progetto
test/smoke.sh               prova di fumo sul sito che gira (npm run test:smoke)
test/auth-smoke.sh          il giro del magic link sul sito che gira (npm run test:auth-smoke)
lib/auth/                   better-auth: configurazione, mittente del link, Server Action
lib/dal.ts                  chi e' l'utente: requireUser / requireOnboardedUser
lib/clears/                 le Server Action dei clear, i loro validatori e le frasi d'errore
lib/clears.ts               le letture del builder e del clear: modifica, cambi, voti, commenti
lib/cards.ts                la ricerca delle carte per il picker (anche GET /api/cards)
lib/equipment.ts            la ricerca delle Skill Orb per le build (anche GET /api/equipment)
components/builder/         il builder dei clear: slot, picker delle carte, build, dettagli, prove
components/clears/          la scheda di un clear: squadre, cambi, voti, commenti, Delete
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

**Per la produzione (da fare a mano).** `dokkan.example.com` qui sotto sta
per il dominio vero, che ancora non c'è.

1. **Dominio e variabili.** `BETTER_AUTH_URL=https://dokkan.example.com`,
   un `BETTER_AUTH_SECRET` nuovo (non quello di sviluppo), i sei
   `*_CLIENT_ID`/`*_CLIENT_SECRET`, `RESEND_API_KEY` e `EMAIL_FROM` (per
   esempio `Dokkan Team Sharing <login@mail.dokkan.example.com>`). Senza
   `RESEND_API_KEY` o `EMAIL_FROM` il server **non parte**, apposta.
2. **Resend.** Aggiungi un dominio di invio (`mail.dokkan.example.com`),
   metti nel DNS i record SPF e DKIM che mostra (DMARC consigliato), aspetta
   "Verified", poi crea una API key con "Sending access" solo per quel
   dominio. Il piano gratuito: 3000 email al mese, 100 al giorno.
3. **Callback di produzione presso ogni provider**, accanto a quelli di
   sviluppo (`http://localhost:3000/api/auth/callback/<provider>`):
   - Discord (discord.com/developers, OAuth2 → Redirects):
     `https://dokkan.example.com/api/auth/callback/discord`
   - Google (console.cloud.google.com, Clients → Authorized redirect URIs):
     `https://dokkan.example.com/api/auth/callback/google`
   - Twitch (dev.twitch.tv/console, OAuth Redirect URLs):
     `https://dokkan.example.com/api/auth/callback/twitch`
4. **Google "In production".** Nella OAuth consent screen (Google Auth
   Platform → Audience) porta il Publishing status da Testing a **In
   production**: in Testing entrano solo 100 utenti di prova e le loro
   autorizzazioni scadono dopo 7 giorni. Gli scope sono solo `openid email
   profile`, quindi non serve la verifica dell'app (quella del brand è
   facoltativa e chiede homepage, privacy policy e dominio verificato).
5. **Dietro un proxy.** Il limite per IP legge l'IP dagli header
   (`x-forwarded-for` per difetto). Quando l'host è noto, imposta in
   `lib/auth/config.ts` `advanced.ipAddress.ipAddressHeaders` (e
   `trustedProxies`) sull'header che il proxy scrive davvero: altrimenti un
   client può inventarsi l'header, o tutti finiscono in un solo secchio.
6. **Una privacy policy**, che Google chiede per la verifica del brand e
   che comunque serve: salviamo email, handle, IP e user agent delle sessioni.

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
  `delete_clear`). Dopo, `signOut` toglie il cookie e si torna a
  `/events?account=deleted`, con un avviso che chi è dentro non vede.
- Il limite è nella natura: si cancella una volta, e si scollegano al più
  tre provider. Entrambe le azioni partono da `requireUser`.
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

- **Pagina evento.** Nel pannello del livello scelto c'è "Submit a clear"
  (chi non è entrato vede "Sign in to submit a clear", con `?next=` al
  builder dello stesso livello). Ogni clear mostra i cambi di squadra sotto
  la partenza, i voti (su e giù, il voto di chi guarda, `useOptimistic`),
  i commenti della versione corrente in un `<details>` chiuso, e per
  l'autore Edit e Delete (con conferma). I dati in più li legge
  `lib/clears/vista.ts`, poche query per pagina.
- **`/events/[id]/submit?tier=`** e **`/events/[id]/clears/[clearId]/edit`**:
  lo stesso builder (`components/builder/`). Lo stato è un `useReducer`
  puro in `lib/clears/builder-stato.ts` e parte come un solo campo JSON;
  prima dell'invio passa `parseBuilderPayload`, lo stesso controllo
  dell'azione. Il picker è un `<dialog>` modale (a schermo pieno sotto i
  640px) su `/api/cards`, con frecce, Enter ed Escape. In modifica la
  ricorrenza non si cambia: `revise_clear_from_builder` non la prende.
  La modifica di un clear altrui risponde 404.

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
  ci punta. Chi può montare quale sfera (esclusive per carta, categoria,
  tipo) sta in `equipment_skill_limitations`: non lo importiamo ancora, e
  il database non lo controlla.
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
  e la nota. Un cambio di squadra parte con le build della squadra sopra;
  in modifica il form parte dalle build della versione corrente. Nei clear
  la build è una riga piccola sotto la carta, solo se c'è.

Le verifiche sono in `db/test/builds.test.mts` (e i suoi moduli
`builds-revise.ts`, `builds-pure.ts`): 83 controlli.

## Cosa manca, in ordine

1. **Il calendario, da tenere vivo.** Rifare il datamine con `--fresh`
   ogni settimana, poi `db:game-events` e `db:windows`: gli eventi nuovi
   arrivano da lì, il wiki non ne scrive più. Japan resta senza finestre
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
5. **Gli account, da rifinire.** Scollegare e cancellare non chiedono un
   accesso recente: chi ha in mano una sessione aperta può cancellare
   l'account scrivendo l'handle, che è pubblico.
6. **L'invio, da rifinire.** Le pagine ci sono (sotto). Mancano la storia
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
