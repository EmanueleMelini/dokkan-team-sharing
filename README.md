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
- **2651 carte** importate dal wiki, con link skill, categorie, statistiche
  e date di uscita separate per Japan e Global
- **599 eventi** con 5618 stage e 6916 difficoltà, banner compresi; più
  **192 eventi dal gioco** che il wiki non documenta (2025-2026, EZA e Super
  EZA), con 1667 stage e 1890 difficoltà, senza banner né descrizione
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
`load-datamine` (che corregge), `load-game-events` (gli eventi che il wiki
non ha, dal gioco) prima di `load-windows` (che dà le finestre anche a
loro), e `fetch-assets` per ultimo. `db:import` e `db:refresh` li mettono in
fila:

```
load-cards → load-events → load-datamine → load-game-events → load-windows → fetch-assets
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
  seed/                     demo-clears.mjs: tre clear dimostrativi su un evento vero (db:demo)
  queries/reference.sql     le query di lettura principali, documentate
  test/                     le verifiche: run.sh le mette in fila (npm run db:test)
  import/
    fetch-wiki.mjs          scarica il wikitext delle carte, in cache
    fetch-events.mjs        scarica il wikitext degli eventi, in cache
    load-cards.mjs          interpreta le carte e le scrive, idempotente
    load-events.mjs         idem per eventi, stage e difficoltà
    load-game-events.mjs    gli eventi che il wiki non ha, dal datamine del gioco
    game-events/            i suoi moduli: classify, build, write, i legami del wiki
    quest-refs.mjs          i legami per quest (Super Battle Road, archivi), per load-windows
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

**Si uniscono sull'id del gioco**, verificato: i 2651 id ricavati dal wiki
esistono tutti nel datamine, 2651 su 2651. Per questo `load-datamine` non
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
sono in questa condizione. Gli eventi creati dal gioco (`imported_from =
'datamine'`) hanno invece un id ricavato da quello di gioco, lontano dai
pageid: vedi "Gli eventi che il wiki non ha".

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
- **Evento nuovo anche con lo stesso nome**: i remix `: RE [...]`, le
  edizioni con boss diversi (Dokkan Ultimate Speed Battle 1757), i remake
  DbStory (come 901-917, che hanno già un evento ciascuno).
- **Million Arena** sono quattro aree (preliminari, semifinale, finale, in
  singolo) e un evento solo, 1000001717, con sei stage.
- **Le Super EZA** sono eventi a sé; il legame ricorda la Normal da cui
  pendono (`event_game_ref.related_game_id`), così il sito potrà collegarle.

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
4. **Le missioni dal gioco.** Il legame con le aree c'è (`event_game_ref`),
   le missioni no: `mission` è ancora vuota, e `mission.reward` →
   `reward_item` aspetta loro.
5. **L'autenticazione.** Serve un account per inviare.
6. **La prima fetta verticale:** una pagina evento che elenca i suoi clear,
   più il form di invio dietro il login.
7. **Il team builder.** Il grosso del lavoro di interfaccia, e il collo di
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
