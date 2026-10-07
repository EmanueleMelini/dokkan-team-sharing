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

- **39 tabelle, 3 view, 4 trigger, 16 funzioni** su PostgreSQL 15
- **2632 carte** importate dal wiki, con link skill, categorie, statistiche
  e date di uscita separate per Japan e Global
- **599 eventi** con 5618 stage e 6916 difficoltà, banner compresi
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
`load-datamine` (che corregge), e `fetch-assets` per ultimo. `db:refresh`
li mette in fila.

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
  seed/                     demo-clears.mjs: tre clear dimostrativi su un evento vero (db:demo)
  queries/reference.sql     le query di lettura principali, documentate
  test/                     le verifiche: run.sh le mette in fila (npm run db:test)
  import/
    fetch-wiki.mjs          scarica il wikitext delle carte, in cache
    fetch-events.mjs        scarica il wikitext degli eventi, in cache
    load-cards.mjs          interpreta le carte e le scrive, idempotente
    load-events.mjs         idem per eventi, stage e difficoltà
    fetch-assets.mjs        scarica le immagini e le registra in asset
    .cache/                 il wikitext scaricato (non versionato)
public/assets/              le immagini ospitate da noi (non versionate)
  migrate.mjs               runner: applica le pendenti, una transazione ciascuna
  reset.mjs                 ricostruisce il database di sviluppo da zero
  local.sh                  avvia/ferma il cluster locale
docs/                       l'analisi competitiva e le decisioni di progetto
test/smoke.sh               prova di fumo sul sito che gira (npm run test:smoke)
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

**Si uniscono sull'id del gioco**, verificato: i 2632 id ricavati dal wiki
esistono tutti nel datamine, 2632 su 2632. Per questo `load-datamine` non
sostituisce le carte, le *corregge*, e `load-cards` deve girare prima.

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

Su 2670 pagine, **2632 importate** e 38 scartate, ognuna con il suo motivo
stampato: 18 sono oggetti di supporto e non unità, 10 condividono la stessa
immagine fra varianti a cinque tipi (quindi l'id di gioco non le distingue),
9 non hanno un id ricavabile, 1 ha un tipo malformato.

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
| challenge | 209 | 742 |
| zbattle (Extreme Z-Battle) | 150 | 3718 |
| limited | 113 | 327 |
| story | 84 | 604 |
| other | 22 | 189 |
| bonus | 20 | 26 |
| world_tournament | 1 | 12 |

La classificazione viene dal template di navigazione in fondo alla pagina:
è il wiki stesso a dire in che elenco sta un evento. I 22 `other` sono
quelli senza navigazione e senza un titolo riconoscibile — inventare una
categoria plausibile sarebbe stato peggio che ammettere di non saperlo.

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
dedicata, e il wiki stesso rimanda al gioco. `mission` resta vuota: serve
un'altra fonte. È la ragione per cui `mission.reward` non è ancora
collegato a `reward_item`.

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
sono in questa condizione.

## Gli oggetti dei premi

29 oggetti con icona, ricavati dallo switch di `Template:ItemsEvent`: orb,
pesi, medaglie, dragon stone, zeni. Sono i **drop mostrati sulle pagine
evento**, non i premi delle missioni — quelli seguono le missioni, che non
ci sono.

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
chiave che ha deciso e la confidenza, e si ricostruisce a ogni giro:

| tipo | legati | | tipo | legati |
|---|---|---|---|---|
| zbattle | 152 / 152 | | other | 22 / 22 |
| challenge | 193 / 208 | | bonus | 18 / 20 |
| limited | 109 / 113 | | world_tournament | 1 / 1 |
| story | 84 / 84 | | **totale** | **579 / 600** (534 high, 45 medium) |

I 21 non legati restano col calendario del wiki, ed è voluto: le 15 pagine
della Super Battle Road (90 piani su due aree del gioco, una chiave sola),
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
  Ricordi (a chiavi) non conta come attivo; le Super EZA non si guardano.
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

| Global | prima | dopo |
|---|---|---|
| attivi con la fine | 0 | 6 (fino al 20 ottobre) |
| attivi permanenti (EZA) | 0 | 147 |
| attivi, fine non nota | 560 | 306 |
| conclusi | 0 | 120 |
| in arrivo | 0 | 0 |

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
- **Gli eventi più nuovi del wiki in cache non ci sono proprio**: la cache
  si ferma a gennaio 2025, quindi 9 delle 15 aree aperte oggi e 58 EZA
  recenti non hanno un evento nostro a cui attaccarsi.

## Cosa manca, in ordine

1. **Il calendario, da tenere vivo.** Rifare `fetch-events` (il wiki in
   cache si ferma a gennaio 2025) e il datamine con `--fresh` ogni
   settimana. Japan resta senza finestre vere, e 306 eventi Global restano
   "attivi, fine non nota" (vedi il calendario). Le corse di un'area
   riaperta dopo più di un mese partono dall'ultimo blocco: la corsa di
   prima non ha una run del gioco sua.
2. **Le missioni dal gioco.** Il legame con le aree c'è (`event_game_ref`),
   le missioni no: `mission` è ancora vuota, e `mission.reward` →
   `reward_item` aspetta loro.
3. **L'autenticazione.** Serve un account per inviare.
4. **La prima fetta verticale:** una pagina evento che elenca i suoi clear,
   più il form di invio dietro il login.
5. **Il team builder.** Il grosso del lavoro di interfaccia, e il collo di
   bottiglia dell'invio. Ora ha dati veri e immagini su cui girare.

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
