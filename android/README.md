# DokkanTS Category Helper

L'app Android di Dokkan Team Sharing per cercare le **categorie** di *Dragon Ball Z Dokkan Battle* JP scrivendo in inglese e ottenere il nome giapponese da inserire nel campo di ricerca del gioco: una bolla sopra il gioco, un pannello di ricerca, appunti e inserimento diretto, un editor del dizionario.

- Il nome è **DokkanTS Category Helper** (Info app, installazione, Accessibilità, titolo dell'app, release); sulla home del telefono l'icona dice solo **Category Helper**, perché il nome intero verrebbe tagliato (`launcher_name`, l'etichetta della sola activity di avvio). Package (`applicationId` e `namespace`): `it.emanuelemelini.dokkants.categoryhelper`.
- Interfaccia in inglese, in italiano se il telefono è in italiano.
- Istruzioni per chi la usa: <https://dokkants.app/category-helper> (anche dal link **Instructions** nelle impostazioni dell'app).
- Specifica originale: [docs/SPEC.md](docs/SPEC.md). Le scelte cambiate dopo sono sotto, in «Rispetto alla specifica».

## Stato

| Versione | Contenuto | Stato |
|---|---|---|
| Fase 0 | Prototipo diagnostico | ✅ (esito in fondo) |
| Fase 1 | Bolla che appare/sparisce con Dokkan JP, trascinabile, opacità e dimensione configurabili | ✅ |
| Fase 2 | Dizionario, ricerca, appunti, recenti/preferiti | ✅ |
| Fase 3 | Inserimento diretto nel campo del gioco | ✅ |
| Fase 4 | Editor del dizionario, import/export | ✅ (v0.4.0) |
| 1.0.0 | Interfaccia in inglese (con l'italiano), `gameId` nel dizionario, dizionario dai dati del gioco, «Check for updates» (dalla 1.2.0 «Update categories»), release firmate | da provare sul telefono |
| 1.1.0 | «Check for updates» automatico, al massimo una volta al giorno quando si apre Dokkan; interruttore nelle impostazioni (dalla 1.2.0 «Check automatically»); avviso solo quando aggiunge categorie | da provare sul telefono |
| 1.2.0 | Aggiornamenti dell'app da GitHub: controllo al massimo una volta al giorno, pallino sulla bolla, riga nel pannello e finestra nell'app con le note; aggiornamento dall'app; «What's new» dopo un aggiornamento; «Update categories» e «Check automatically» al posto dei nomi di prima; le note di ogni versione negli asset | da provare sul telefono |

## Rispetto alla specifica

- Interfaccia in inglese con la traduzione italiana (la specifica diceva stringhe in italiano).
- Permesso INTERNET, per due cose sole. **Update categories**: una richiesta al sito quando la tocchi e, con **Check automatically** acceso (default), quando apri Dokkan, al massimo una al giorno o un'ora dopo un controllo fallito. Dalla 1.2.0 **le versioni nuove dell'app**: una richiesta a GitHub con la stessa regola, quando apri Dokkan o l'app (solo nella build di release), e quando tocchi **Check for app updates**; l'APK si scarica da GitHub solo toccando **Update**. Niente lavori pianificati o periodici, niente analytics.
- Dalla 1.2.0 il permesso `REQUEST_INSTALL_PACKAGES`, per installare gli aggiornamenti dall'app: la prima volta Android chiede di consentire le installazioni da questa fonte.
- Eventi di accessibilità `typeWindowStateChanged|typeWindowsChanged|typeViewFocused`, senza `typeWindowContentChanged` (non serve e consuma batteria).
- Oltre all'APK locale, release firmate su GitHub, automatiche a ogni tag (sotto, «Il rilascio»).

## Struttura

`android/` è la radice di Gradle, un progetto a parte rispetto al sito: il sito non importa niente da qui, Vercel non lo carica (`/android` in `.vercelignore`) e un commit che tocca solo `android/` non fa deploy (`android` è in `NON_RUNTIME` di `scripts/vercel-ignore-decidi.mjs`). Anche eslint e tsc della radice lo ignorano.

- `app/src/main/java/…`: il codice (sotto, «Mappa del codice»);
- `app/src/main/res/values/strings.xml` (inglese) e `values-it/strings.xml` (italiano);
- `app/src/main/assets/categories.json`: il dizionario incluso, generato (sotto);
- l'icona e la bolla, generate dal marchio del sito (l'Anello Ki con la lente al posto del disco): `app/src/main/res/drawable/ic_launcher_foreground.xml`, `ic_launcher_monochrome.xml` (icone a tema) e `ic_bubble_foreground.xml` (la bolla e la sua anteprima: lo stesso disegno ritagliato ai 72 dp che il launcher mostra), `mipmap-anydpi/ic_launcher.xml`, `values/ic_launcher_background.xml`. Non si modificano a mano: dalla radice del repository `node scripts/brand/icona-android.mjs` (o `npm run brand`, che rifà anche le icone del sito). `db/test/android-icon.test.mjs` è rosso finché non coincidono col marchio, e il workflow della release si ferma;
- `app/src/test/…`: i test unitari (formato del dizionario, avvio e categorie eliminate, ricerca, regola e richiesta di Update categories, quando parte il controllo automatico e cosa ne resta; per gli aggiornamenti dell'app la risposta di GitHub e la sua richiesta, le versioni, le note, quando si cerca e quando si offre una versione nuova, «What's new», lo scaricamento dell'APK, quale sessione d'installazione conta ancora);
- `app/src/main/assets/release-notes/X.Y.Z.md`: le note di ogni versione, in inglese con l'italiano in un blocco nascosto. Lo stesso file è il testo della release su GitHub e, nell'app, le note della finestra dell'aggiornamento e di «What's new» (sotto, «Il rilascio»). Fino alla 1.1.0 stavano in `release-notes/`. La release la fa `.github/workflows/category-helper-release.yml`, dalla radice del repository.

### Mappa del codice

In `app/src/main/java/it/emanuelemelini/dokkants/categoryhelper/`:

- `service/DokkanAccessibilityService`: l'unico servizio. Legge le impostazioni, decide l'app in primo piano (`service/ForegroundApp`: la finestra attiva) e mostra o nasconde la bolla (300 ms prima di nasconderla; con l'app in primo piano sconosciuta non cambia niente; nascosta a schermo spento o bloccato). Quando l'app monitorata arriva in primo piano fa partire, se è il momento, il controllo automatico delle categorie (sotto, «Il controllo automatico») e quello delle versioni nuove dell'app (sotto, «Aggiornamenti dell'app»).
- `overlay/BubbleOverlay`: la bolla (View classiche). `overlay/MessageOverlay`: gli avvisi brevi sopra il gioco, una finestra `TYPE_ACCESSIBILITY_OVERLAY` che non prende né il focus né i tocchi, al posto dei toast (da Android 13 il sistema scarta i toast di un servizio di accessibilità senza il permesso delle notifiche, che l'app non chiede). `overlay/SearchPanel`: il pannello, una finestra a schermo intero `TYPE_ACCESSIBILITY_OVERLAY` che prende il focus e ospita Compose (`OverlayLifecycleOwner`); `SearchPanelContent` è la scheda.
- `service/TextInserter`: il testo in attesa (30 s, un tentativo) e l'inserimento nel campo con il focus dell'app monitorata: `SET_TEXT`, poi `PASTE`, poi l'avviso.
- `dictionary/Category`: `id` (lo slug, la chiave di recenti e preferiti, non cambia mai), `en`, `jp`, `aliases`, `gameId` facoltativo. `dictionary/DictionaryFormat`: lettura tollerante, scrittura, `uniqueId`, `merge`. `dictionary/DictionaryRepository`: il dizionario condiviso da servizio ed editor, i file in memoria interna. `dictionary/StoredDictionary`: le sue regole pure (quale dizionario all'avvio, i `gameId` dallo slug, le categorie eliminate).
- `update/CategoryUpdates`: il payload dell'API e la regola di cosa aggiungere (puri). `update/UpdateCheck`: la richiesta HTTP e l'esito. `update/AutoUpdatePolicy`: quando parte il controllo automatico e cosa ne resta (puro).
- `appupdate/`: gli aggiornamenti dell'app. `AppUpdater` (uno per processo, condiviso da `MainActivity`, servizio e ricevitore dell'installazione: il controllo, automatico o a mano, lo stato delle finestre, l'installazione, «What's new»), `GitHubReleases` (la richiesta a GitHub e la lettura della risposta), `AppVersion` (le versioni X.Y.Z e il confronto), `ReleaseNotes` (i punti delle note per lingua, dal corpo della release o dal file), `AppUpdatePolicy` (quando si cerca e quando si offre una versione nuova, **Later**; puro), `ApkDownload` e `ApkUrls` (lo scaricamento dell'APK e da dove può arrivare), `AppUpdateInstaller` e `AppUpdateReceiver` (la sessione di `PackageInstaller` e il suo esito), `InstallSessions` (quale sessione è del tentativo in corso: le risposte su una sessione di prima non contano; puro), `AppUpdateStore` (cosa resta nel DataStore), `WhatsNew` (`Changelog`, le note incluse nell'app, e `WhatsNewPolicy`, quali mostrare; puro). `ui/AppUpdateDialogs`: le finestre sopra `MainActivity` («What's new», la versione nuova, il permesso, il download, gli errori) e la riga di **Check for app updates**.
- `ui/SettingsScreen` (le impostazioni), `DictionaryActivity` e `ui/DictionaryScreen` (l'editor), `ui/UpdateUi` (i messaggi di Update categories, anche l'avviso e la riga del controllo automatico, il link Instructions).
- `search/CategorySearch`: normalizzazione e ordine dei risultati. `history/HistoryRepository`: recenti e preferiti. `settings/`: il DataStore e le impostazioni. `AppInfo`: versione e URL delle istruzioni. `diagnostics/`: il log (`DebugLog`) e il dump dei nodi.

## Build

Serve l'Android SDK con la piattaforma 37. Il JDK lo sceglie Gradle: un JDK 25 di qualunque vendor (su GitHub Actions è Temurin 25), da `gradle/gradle-daemon-jvm.properties`; se sulla macchina non c'è, Gradle lo scarica la prima volta. Per lanciare il wrapper basta un JDK 17 o più recente. Il percorso dell'SDK va in `android/local.properties` (`sdk.dir=…`, file non tracciato che Android Studio scrive da solo) oppure nella variabile `ANDROID_HOME`.

```bash
cd android
./gradlew testDebugUnitTest assembleDebug
```

L'APK di debug esce in `app/build/outputs/apk/debug/app-debug.apk`.

Si usano i task di debug: `./gradlew build`, `./gradlew assemble` e `assembleRelease` costruiscono anche la release, e senza la firma (sotto, «Il rilascio») si fermano su `checkReleaseSigning`. `test` e `lint` invece girano.

## Installazione

- **Dalla release** (chi usa l'app): scarica [dokkants-category-helper.apk](https://github.com/EmanueleMelini/dokkan-team-sharing/releases/latest/download/dokkants-category-helper.apk) sul telefono, aprilo e consenti l'installazione da quella fonte. È il link della pagina `/category-helper` del sito.
- **Per lo sviluppo**: `adb install -r app/build/outputs/apk/debug/app-debug.apk`. Con più telefoni collegati serve `adb -s <seriale>` (vedi `adb devices`); su quali telefoni provare lo dicono le note private del proprietario, non questo repository.
- **Debug e release convivono.** La build di debug ha un id suo, `it.emanuelemelini.dokkants.categoryhelper.debug` (`applicationIdSuffix` in `app/build.gradle.kts`), la versione con `-debug` (anche nello User-Agent delle richieste), e in `app/src/debug/res/` un nome suo («DokkanTS Category Helper (debug)», «CH debug» sotto l'icona) e uno sfondo color ruggine per l'icona e la bolla. Sul telefono sono due app, con dati separati, firme diverse e due servizi di accessibilità: accendine uno alla volta, se no compaiono due bolle. La release resta `it.emanuelemelini.dokkants.categoryhelper`. Per spostare il dizionario fra le due: ⋮ → **Export JSON…** nell'una, **Import JSON…** nell'altra.
- Le build di debug fatte prima della 1.1.0 avevano l'id della release, firmato con la chiave di debug: Android non ci installa sopra la release. Va disinstallata, dopo aver esportato il dizionario se serve.
- **Gli aggiornamenti.** Dalla 1.2.0 l'app si aggiorna dall'interno: tocchi **Update** e confermi (sotto, «Aggiornamenti dell'app»). La 1.0.0 e la 1.1.0 si aggiornano come la prima installazione: si scarica di nuovo l'APK e lo si installa sopra, e dizionario e impostazioni restano.

## Attivare il servizio

1. Apri l'app → **Open accessibility settings** → (App scaricate / Servizi installati) → **DokkanTS Category Helper** → attiva e conferma.
2. Se l'interruttore è grigio o compare «Impostazione con restrizioni» (Android 13+, tipico degli APK installati da file): **Info app → menu ⋮ → Consenti impostazioni con restrizioni**, poi ripeti il punto 1. Con `adb install` di solito il blocco non c'è.
3. Tornando nell'app, la scheda **Accessibility service** deve dire **On**.

Su ColorOS/OxygenOS conviene togliere l'ottimizzazione batteria all'app, altrimenti il sistema può spegnere il servizio.

## Impostazioni

- **Visibility**: bolla automatica sì/no e package dell'app da monitorare (default Dokkan JP, oppure scegli tra le app Dokkan installate).
- **Insertion**: **Automatic** (default) oppure **Clipboard only**.
- **Bubble**: opacità (default 35%) e dimensione (36-72 dp) con anteprima; riporta la bolla al bordo destro.
- **Dictionary**: numero di categorie, preferiti e recenti; **Open the editor**, **Clear recents**, **Update categories**; **Check automatically** (acceso di default: le categorie nuove dal sito e le versioni nuove dell'app da GitHub) e, dopo il primo controllo automatico delle categorie, quando è stato fatto e com'è andato.
- **Diagnostics**: log in Logcat dell'app in primo piano e dei campi che prendono il focus in Dokkan (`adb logcat -s DokkanHelper`).
- **About**: la versione, **Check for app updates** con la riga dell'esito (l'app è aggiornata, c'è una versione nuova, il controllo non è riuscito; mentre cerca la riga non c'è e il pulsante dice **Checking…**), il pulsante **Update** finché c'è una versione nuova (anche dopo **Later**), **What's new** e il link **Instructions** (apre <https://dokkants.app/category-helper> nel browser).

## Come funziona

**La bolla.** Compare quando la finestra attiva è quella del package monitorato e sparisce quando in primo piano passa un'altra app (dopo 300 ms, per non lampeggiare nei cambi rapidi). Tastiera, tendina notifiche, Game Assistant e finestre di Play Store sopra il gioco non la fanno sparire; se l'app attiva non si può determinare, la bolla resta com'è. Sparisce con schermo spento o bloccato. Si trascina ovunque e al rilascio si aggancia al bordo più vicino; la posizione resta salvata. Non prende mai il focus, quindi non chiude la tastiera del gioco.

**Il pannello di ricerca.** Si apre toccando la bolla, con la tastiera già pronta; si chiude toccando fuori, con indietro, con ✕ o dopo una scelta. La ricerca è in inglese su nome e alias (anche sul nome giapponese) e si aggiorna a ogni lettera. Ordine: nome identico, inizia con, parola che inizia con, contiene, parole in qualsiasi ordine, poi errori di battitura (1 errore fino a 5 lettere, 2 oltre). Maiuscole, punteggiatura, apostrofi e spazi non contano. Invio sceglie il primo risultato. Scegliere una categoria copia il nome giapponese negli appunti e la aggiunge ai recenti. Con il campo vuoto il pannello mostra preferiti (♥ su ogni riga), recenti (ultimi 10) e tutte le categorie in ordine alfabetico.

**L'inserimento diretto.** In **Automatic**, dopo la scelta il nome giapponese è negli appunti e resta in attesa per 30 secondi: la bolla diventa piena, con un bordo bianco.

1. Se il campo di ricerca del gioco era già aperto e torna attivo alla chiusura del pannello, il nome entra subito.
2. Altrimenti tocca il campo di ricerca del gioco: appena prende il focus il servizio prova `SET_TEXT`, poi `PASTE`.
3. Se entrambi vengono rifiutati compare un avviso («incolla a mano»); il nome resta negli appunti.

Il testo in attesa viene scritto una volta sola, solo in un campo dell'app monitorata, e si annulla dopo 30 s, uscendo dal gioco o spegnendo lo schermo.

## Il dizionario

Impostazioni → **Dictionary** → **Open the editor**:

- lista alfabetica con ricerca (la stessa del pannello);
- **+** aggiunge una categoria, toccare una riga la modifica o la elimina (con **Undo** nella barra in basso). Obbligatori nome inglese e giapponese; gli alias si separano con la virgola. L'ID si genera dal nome inglese e non cambia più, perché recenti e preferiti puntano lì; l'ID del gioco, se c'è, resta anche dopo una modifica;
- menu ⋮: **Update categories**, **Import JSON…** (con scelta tra *Merge* e *Replace*), **Export JSON…**, **Restore the bundled dictionary**.

Le modifiche arrivano subito nel pannello sopra il gioco.

**Backup e telefono nuovo.** Il backup di Android è acceso: il backup sull'account Google e il passaggio a un telefono nuovo copiano dizionario (con i file `categories.edited` e `categories.removed`), preferiti, recenti e impostazioni. Dopo un ripristino l'app riparte da lì come dopo un aggiornamento: un dizionario mai modificato può ancora essere sostituito da quello incluso, uno modificato resta. Le regole sono in `res/xml/data_extraction_rules.xml` (Android 12 e successivi) e `res/xml/backup_rules.xml` (Android 8-11), e devono escludere gli stessi percorsi: oggi solo i file temporanei delle scritture atomiche (`categories.json.tmp`, `categories.removed.tmp`, `datastore/settings.preferences_pb.tmp`), che esistono solo se l'app si ferma a metà di una scrittura. Un file nuovo in `filesDir` viaggia da solo: se non deve, va escluso in tutti e due i file. `backupInForeground="true"` serve perché, con il servizio di accessibilità acceso, il processo conta sempre come in primo piano e Android rimanderebbe all'infinito il backup notturno; dopo il backup Android riavvia il processo e il sistema ricollega il servizio. Il sito non riceve niente; l'esportazione JSON resta il modo per spostare il dizionario a mano.

### Formato JSON

```json
{
  "version": 3,
  "categories": [
    { "id": "pure_saiyans", "gameId": 17, "en": "Pure Saiyans", "jp": "純粋サイヤ人", "aliases": ["pure", "saiyan", "ps"] }
  ]
}
```

L'import è tollerante, per liste preparate a mano:

- va bene anche un semplice array `[ { "en": …, "jp": … }, … ]`;
- `id`, `gameId` e `aliases` sono facoltativi: senza `id` lo genera dal nome inglese;
- `gameId` è l'ID della categoria nel gioco (un numero intero positivo, anche fra virgolette); se non è valido si ignora e la voce resta;
- sono ammessi commenti `//` e virgole finali;
- le voci senza nome inglese o giapponese, o con un `id` già usato, vengono scartate e contate.

*Merge* aggiorna la voce con lo stesso `id`, altrimenti quella con lo stesso `gameId`, altrimenti quella con lo stesso nome inglese (mantenendo l'`id` esistente, e il `gameId` esistente se il file non ce l'ha, come un export di prima della 1.0.0); aggiunge le altre. *Replace* rimpiazza tutto. Recenti e preferiti di categorie che non esistono più vengono ripuliti. L'export non scrive `gameId` per le voci fatte a mano.

### Il dizionario incluso nell'app

`app/src/main/assets/categories.json` viene copiato in memoria interna al primo avvio. Versione 3 (16/11/2026): le 99 categorie del gioco; rispetto alla versione 2 cambia solo il `gameId` su ogni voce.

**Le fonti.** I dati del gioco, attraverso Dokkan Team Sharing: ID e nomi inglesi da `card_categories.csv` del datamine Global, nomi giapponesi dalle missioni dei titoli in `missions.csv` (`db/import/categories/japanese-names.mjs`), alias da `db/import/categories/aliases.mjs` (le iniziali dei nomi composti, come `tb`, `rog`, `ss3`, più alcuni soprannomi, come `ssj`, `ssj3`, `great ape`, `top`, `u7`). Sono gli stessi dati che il sito salva nel database e serve all'app da `/api/v1/categories`. Prima della versione 3 i nomi venivano da dokkaninfo.com: ora non più.

**Il file non si scrive a mano**: lo genera, dalla radice del repository,

```bash
node db/import/categories/export-android.mjs           # scrive il file se cambia
node db/import/categories/export-android.mjs --check   # esce 1 se va rigenerato
```

con le regole di `db/import/categories/android-dictionary.mjs`:

- l'`id` (lo slug) di una categoria non cambia mai, anche se cambia il nome inglese; una categoria nuova lo prende dal nome inglese con la stessa regola dell'app (`DictionaryFormat.uniqueId`), senza riusarne uno;
- se le missioni non danno il nome giapponese di una categoria resta l'ultimo noto; senza nessun nome la categoria resta fuori, con un avviso;
- `version` sale di uno solo quando le categorie cambiano.

`db/test/android-dictionary.test.mjs`, un passo di `npm run db:test` (puro, niente database), è rosso finché il file nel repository non è quello che il generatore scriverebbe adesso. Dopo un `npm run db:fetch` che porta una categoria nuova: rigenera il file, rilancia i test e fai uscire una release dell'app.

**Quando il dizionario incluso sostituisce quello sul telefono.** Finché il dizionario non è stato modificato nell'app, un'installazione con una `version` più alta lo sostituisce. Dopo la prima modifica o import gli aggiornamenti dell'app non lo toccano più, salvo **Restore the bundled dictionary**. Le categorie aggiunte da Update categories non contano come modifica (sotto).

## Update categories

Impostazioni → **Dictionary** → **Update categories**, oppure nell'editor ⋮ → **Update categories** (fino alla 1.1.0 si chiamava **Check for updates**). Con **Check automatically** acceso (default) l'app fa lo stesso controllo anche da sola quando apri Dokkan, al massimo una volta al giorno o un'ora dopo un controllo fallito (sotto, «Il controllo automatico»).

- Una sola richiesta `GET https://dokkants.app/api/v1/categories` (timeout 10 s per la connessione, 15 s per la risposta, risposta di 1 MiB al massimo, User-Agent `DokkanTSCategoryHelper/<versione> (Android)`), quando la tocchi o quando parte il controllo automatico. È l'unico accesso al sito; l'altro accesso alla rete dell'app è GitHub, per le versioni nuove dell'app (sotto, «Aggiornamenti dell'app»). La risposta: `{"version":1,"categories":[{"id":1,"name_en":"Fusion","name_ja":"フュージョン","aliases":[…]}, …]}`, in ordine di ID, con `name_ja` a `null` se il nome giapponese non c'è ancora.
- **Aggiunge e basta.** Una categoria del sito si salta se non ha il nome giapponese, se una voce sul telefono ha lo stesso `gameId`, o se una voce senza `gameId` (fatta a mano o importata) ha lo stesso nome inglese o lo stesso nome giapponese (normalizzati come nella ricerca: così una categoria uscita prima in JP, aggiunta a mano con il nome della community, non si raddoppia quando arriva su Global con il nome ufficiale). Le voci esistenti, modificate o no, non cambiano mai e non vengono eliminate; recenti e preferiti restano come sono. Le nuove prendono il `gameId` e uno slug libero.
- **Non riaggiunge quello che hai tolto.** I `gameId` delle categorie eliminate, o lasciate fuori da un import *Replace*, restano in un file a parte (`categories.removed`, non negli export), e il controllo li salta; **Undo** o un *Merge* che le riporta li tolgono da lì, **Restore the bundled dictionary** li dimentica. Una voce senza `gameId` prende quello della voce inclusa con lo stesso `id`, se nessun'altra ce l'ha: un dizionario della 0.4.0 (o un suo export) ha gli stessi slug, così le sue voci si riconoscono anche con i nomi cambiati. Per un dizionario modificato della 0.4.0 le categorie del gioco 1-99 che non ha contano come eliminate.
- **Non segna il dizionario come modificato.** Aggiunge solo quello che c'è nei dati del gioco e manca sul telefono: un dizionario mai toccato resta «not edited», quindi un'app nuova con un dizionario incluso più recente (fatto dagli stessi dati) può ancora sostituirlo; uno modificato resta «edited». **Restore the bundled dictionary** toglie anche le categorie aggiunte così: il controllo successivo le riaggiunge, con lo stesso slug.
- Toccando il pulsante, l'esito arriva in basso: «Added N new categories», «Already up to date», oppure l'errore (niente connessione, HTTP diverso da 200, risposta inattesa, oppure un formato più nuovo che chiede di aggiornare l'app).
- Finché il sito con `/api/v1/categories` non è in produzione la richiesta finisce in errore; finché il giro settimanale non ha scritto i nomi giapponesi, `name_ja` è `null` e il controllo non aggiunge niente.

### Il controllo automatico

Dalla 1.1.0, Impostazioni → **Dictionary** → **Check automatically** (fino alla 1.1.0 **Check for updates automatically**), acceso di default. Dalla 1.2.0 lo stesso interruttore accende anche il controllo delle versioni nuove dell'app (sotto, «Aggiornamenti dell'app»), con la stessa regola ma registrato a parte; qui si parla delle categorie.

- **Quando parte.** Nel momento in cui l'app monitorata (Dokkan JP) arriva in primo piano e compare la bolla: il passaggio da un'altra app, dalla home o dallo schermo bloccato a Dokkan, non ogni evento mentre resta aperto. Conta anche l'accensione del servizio con Dokkan già aperto. Con **Show the bubble when Dokkan is open** spento non parte.
- **Quanto spesso** (`update/AutoUpdatePolicy`): mai con l'interruttore spento; la prima volta subito; poi quando sono passate 24 ore dall'ultimo tentativo, oppure 1 ora se l'ultimo è fallito (alla prima apertura di Dokkan dopo quell'ora); se l'orologio del telefono è tornato indietro (l'ultimo tentativo risulta nel futuro), subito.
- **Niente lavori pianificati.** Niente WorkManager né AlarmManager, nessun permesso o dipendenza nuova, il telefono non viene mai svegliato: se non apri Dokkan, il controllo automatico non parte.
- **Uno alla volta.** L'ora del tentativo si salva prima della richiesta, e finché il controllo non finisce conta come fallito; un altro arrivo di Dokkan nel frattempo non ne fa partire un secondo. Il controllo gira nel servizio, fuori dal thread degli eventi, e si annulla se il servizio si ferma: allora resta «fallito» e si riprova dopo un'ora.
- **Stessa richiesta, stessa regola** del pulsante (`UpdateCheck.run`): stesso URL, User-Agent, timeout e tetto di 1 MiB; aggiunge e basta, non riaggiunge le categorie eliminate, non segna il dizionario come modificato.
- **L'esito.** Se aggiunge categorie compare per qualche secondo un breve avviso in basso, sopra il gioco, «DokkanTS Category Helper: Added N new categories» (in italiano «DokkanTS Category Helper: Aggiunte N categorie nuove»). Non è un toast ma una finestra del servizio come la bolla (`overlay/MessageOverlay`): i toast del servizio, da Android 13, il sistema li scarta. L'avviso compare solo se Dokkan è ancora in primo piano e l'interruttore è ancora acceso; se il dizionario è già aggiornato o il controllo fallisce, niente. Nelle impostazioni, sotto l'interruttore, la riga dell'ultimo controllo automatico: data e ora, e «Already up to date», «Added N new categories» oppure «Failed». Prima del primo controllo la riga non c'è; mentre un controllo è in corso dice «Failed», finché non finisce.
- **Cosa salva**, nel DataStore `settings` (quindi anche nel backup): `auto_update` (l'interruttore), `last_auto_check_at` (l'ora del tentativo, in millisecondi), `last_auto_check_failed`, `last_auto_check_added`. Il pulsante non le tocca. Spegnere l'interruttore ferma subito i controlli automatici successivi; il pulsante funziona sempre.

## Aggiornamenti dell'app

Dalla 1.2.0 l'app sa quando su GitHub esce una versione nuova e la installa dall'app quando tocchi **Update**, senza passare dal browser.

- **La richiesta** (`appupdate/GitHubReleases`): `GET https://api.github.com/repos/EmanueleMelini/dokkan-team-sharing/releases/latest` con `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28` e lo User-Agent dell'app, senza token (GitHub ne concede 60 all'ora per indirizzo IP); timeout 10 s per la connessione e 15 s per la risposta, risposta di 1 MiB al massimo. Conta solo una release col tag `category-helper-vX.Y.Z` e l'asset che si chiama esattamente `dokkants-category-helper.apk` (il suo URL e la sua misura); dal corpo della release prende le note. `releases/latest` è la release segnata *Latest*: per questo le release del repository sono solo dell'app (sotto, «Il rilascio»).
- **Quando** (`appupdate/AppUpdatePolicy`, la regola di `update/AutoUpdatePolicy`): da sola al massimo una volta al giorno, o un'ora dopo un controllo fallito, con **Check automatically** acceso, quando Dokkan arriva in primo piano (come il controllo delle categorie, ma registrato a parte) e quando si apre l'app. Solo nelle build di release: la build di debug non cerca da sola. **Check for app updates**, in Impostazioni → **About**, cerca subito, in ogni build, e la riga sotto dice com'è andata. Mentre un controllo è in corso, a mano o automatico, il pulsante dice **Checking…** e la riga non c'è (fino alla fine il controllo conta come fallito).
- **Dove si vede**, finché la versione su GitHub è più nuova di quella installata: un pallino rosso sulla bolla, sempre pieno anche se la bolla è trasparente (è una vista a parte, accanto al disco che prende l'opacità delle impostazioni); in cima al pannello di ricerca la riga «Version X.Y.Z available», che chiude il pannello e apre l'app con la finestra dell'aggiornamento; all'apertura dell'app la finestra «Version X.Y.Z is available» con le note, **Update** e **Later**. **Later** (o chiudere la finestra) rimanda al giorno dopo solo la finestra che si apre da sola: pallino e riga restano finché la versione nuova non è installata, perché sono promemoria discreti.
- **Le note** della finestra sono quelle della release su GitHub, cioè il file `X.Y.Z.md` della versione nuova (sotto, «Il rilascio»): con l'app in italiano i punti del blocco `<!-- dch-notes:it`, se ci sono, se no quelli in inglese.
- **L'installazione.** Toccando **Update**, se Android non permette ancora all'app di installare app, la finestra lo spiega e apre l'impostazione «Installa app sconosciute» dell'app; tornando nell'app si continua. L'APK si scarica direttamente in una sessione di `PackageInstaller` (nessun file nella memoria dell'app, quindi niente da escludere dal backup), con l'avanzamento e il pulsante per annullare. Si accetta solo un URL `https://github.com/EmanueleMelini/dokkan-team-sharing/releases/download/…` (i redirect verso l'host degli asset di GitHub, solo https), con la misura dichiarata da GitHub e mai più di 64 MiB. Poi Android installa la versione nuova (di solito chiedendo di confermare) sopra quella che c'è, con lo stesso id e la stessa firma: dizionario e impostazioni restano. Se qualcosa va storto la finestra dice il motivo (la rete, lo spazio che manca, un'app installata che non corrisponde, per esempio firmata con un'altra chiave) e offre **Download in the browser**, il link `releases/latest/download/dokkants-category-helper.apk` della pagina del sito. Contano solo le risposte di Android sulla sessione del tentativo in corso (`appupdate/InstallSessions`): **Cancel** abbandona la sessione, anche se il download era già finito, e un tentativo nuovo abbandona quelle di prima, così la loro risposta tardiva non chiude né cambia la finestra.
- **La build di debug** (`.debug`) non può aggiornarsi da GitHub: la release ha un altro id e un'altra firma. Nella sua finestra il pulsante principale è **Install the release app**, che installa la release di GitHub con l'id della release (senza `.debug`): serve a provare download e installazione sul telefono. Sopra una release già installata va solo se è più vecchia, e con la firma di GitHub.
- **Cosa salva** (`appupdate/AppUpdateStore`, le chiavi `app_update_*` e `whats_new_seen_*` del DataStore `settings`, quindi anche nel backup): l'ultima release conosciuta (versione, note, URL e misura dell'APK, pagina della release), l'ora dell'ultimo controllo della versione, automatico o a mano, e se è fallito, fino a quando vale **Later**, l'ultima versione di cui si sono viste le note per «What's new».
- **La privacy.** Le richieste a GitHub non portano account, identificativi del telefono o il dizionario; GitHub vede l'indirizzo IP, come per ogni download. Lo dicono la pagina `/category-helper` e la Privacy Policy del sito, e `service_description`.

## Novità

- Al primo avvio dopo un aggiornamento (l'ultimo `versionCode` visto è più basso di quello attuale) l'app mostra **What's new** («Novità»): le note di ogni versione inclusa più nuova dell'ultima vista, dalla più recente, nella lingua dell'app (`appupdate/WhatsNew`).
- Dopo un'installazione da zero salva il `versionCode` e non mostra niente. Dopo un aggiornamento dalla 1.1.0 o da prima, che non lo salvavano, mostra solo le note della versione nuova.
- Le note sono i file `app/src/main/assets/release-notes/X.Y.Z.md`, gli stessi delle release su GitHub (sotto, «Il rilascio»): si leggono anche senza rete.
- Si riaprono da Impostazioni → **About** → **What's new**, tutte.
- Le note di una versione già uscita non cambiano: descrivono quella versione. Per esempio quelle della 1.0.0 dicono che **Check for updates** era l'unico accesso alla rete, come allora.

## Il rilascio (lo fa il proprietario)

Le release di GitHub di questo repository sono riservate all'app: il sito linka <https://github.com/EmanueleMelini/dokkan-team-sharing/releases/latest/download/dokkants-category-helper.apk>, che punta all'asset `dokkants-category-helper.apk` della release segnata come *Latest*. Una release del sito segnata *Latest*, o un asset con un altro nome, romperebbe il link e gli aggiornamenti dall'app, che leggono la *Latest* dall'API di GitHub.

Le release le fa GitHub Actions, come per le altre app Android del proprietario: a ogni tag `category-helper-vX.Y.Z` il workflow [`.github/workflows/category-helper-release.yml`](../.github/workflows/category-helper-release.yml) gira in due job.

- **build** (sola lettura sul repository, con i secret della firma) controlla che il commit del tag sia su `main`, che il tag corrisponda a `versionName`, che ci siano le note con il blocco italiano e che l'icona sia quella generata dal marchio del sito; poi test, lint e `:app:releaseApk` con la chiave dei secret, il controllo della firma (mai quella di debug; lo SHA-256 del certificato va nel riepilogo del giro) e della versione dentro l'APK.
- **publish**, l'unico che può scrivere nel repository, senza secret e senza Gradle, prende quell'APK, controlla che la release *Latest* di adesso, se c'è, abbia una versione più vecchia, un `versionCode` più basso e lo stesso certificato, e pubblica la release del tag, segnata *Latest*, con l'APK e le note.

Un giro alla volta: un secondo tag aspetta che il primo finisca. `db/test/android-release.test.mjs` (un passo di `npm run db:test`, puro) tiene allineati workflow, `build.gradle.kts`, il link del sito, le note (la loro forma, in ogni file), le costanti con cui l'app cerca e scarica le versioni nuove (`GitHubReleases` e `ApkUrls`: il repository, il prefisso del tag, il nome dell'asset, che un'app installata tiene per sempre) e questa sezione.

### Una volta sola

1. **La chiave.** Crea un keystore fuori dal repository, oppure usane uno che hai già, e **tienine una copia di sicurezza, insieme alla password**: ogni versione dopo va firmata con la stessa chiave, altrimenti Android non la installa sopra la precedente (bisognerebbe disinstallare l'app, perdendo il dizionario).

   ```bash
   keytool -genkeypair -v -keystore <percorso>/dokkants-category-helper.jks -alias <alias> -keyalg RSA -keysize 4096 -validity 10000
   ```

   Un keystore creato così (PKCS12) ha una password sola. Uno JKS più vecchio può averne una diversa per la chiave: allora servono anche `dch.key.password` e il secret `DCH_KEY_PASSWORD`. I file `*.jks`, `*.keystore`, `*.p12`, `*.pfx` e `keystore.properties` sono in `.gitignore`.
2. **La firma in locale**, per le build di release su questa macchina, in `android/local.properties` (non tracciato, mai nel repository):

   ```properties
   dch.keystore.path=<percorso/del/keystore.jks>
   dch.keystore.password=<PASSWORD_DEL_KEYSTORE>
   dch.key.alias=<ALIAS>
   # Solo se diversa da quella del keystore
   dch.key.password=<PASSWORD_DELLA_CHIAVE>
   ```

   `dch.keystore.path` è un percorso assoluto, o relativo ad `android/`, senza `~` (Gradle non lo espande). Le variabili d'ambiente `DCH_KEYSTORE_PATH`, `DCH_KEYSTORE_PASSWORD`, `DCH_KEY_ALIAS` e `DCH_KEY_PASSWORD` vincono su `local.properties` **valore per valore**: una variabile impostata sostituisce solo la sua chiave, e le altre restano quelle di `local.properties` (per firmare in locale con un altro keystore, imposta tutte le variabili, non solo il percorso). È così che il workflow passa i secret: sul runner `local.properties` non c'è. Un valore vuoto conta come mancante. Senza percorso, password del keystore e alias ogni build di release si ferma subito (`checkReleaseSigning`) con un messaggio che dice cosa manca: la chiave di debug non firma mai una release.
3. **I secret del repository** (Settings → Secrets and variables → Actions; `DCH` sta per DokkanTS Category Helper):

   | Secret | Valore |
   |---|---|
   | `DCH_KEYSTORE_BASE64` | il keystore in base64 |
   | `DCH_KEYSTORE_PASSWORD` | la password del keystore |
   | `DCH_KEY_ALIAS` | l'alias della chiave |
   | `DCH_KEY_PASSWORD` | la password della chiave, solo se diversa da quella del keystore |

   Con la GitHub CLI (`gh` chiede il valore senza mostrarlo):

   ```bash
   base64 -i <percorso/del/keystore.jks> | gh secret set DCH_KEYSTORE_BASE64 -R EmanueleMelini/dokkan-team-sharing
   ```

   ```bash
   gh secret set DCH_KEYSTORE_PASSWORD -R EmanueleMelini/dokkan-team-sharing
   ```

   ```bash
   gh secret set DCH_KEY_ALIAS -R EmanueleMelini/dokkan-team-sharing
   ```

   Solo se la password della chiave è diversa:

   ```bash
   gh secret set DCH_KEY_PASSWORD -R EmanueleMelini/dokkan-team-sharing
   ```

   Con `DCH_KEYSTORE_BASE64` vuoto il workflow si ferma prima della build.
4. **Le protezioni del repository** (consigliate, in Settings). Il workflow non le richiede, ma chiudono quello che il token di un giro qualunque potrebbe fare:
   - **Rules → Rulesets**: uno sui rami `main` e `release` (niente force push, niente cancellazione, aggiornamenti solo da chi è nella bypass list, cioè il proprietario) e uno sui tag `category-helper-v*` (niente spostamento né cancellazione, il proprietario nella bypass list). Così nessun workflow può spostare `release`, da cui parte il deploy del sito, né un tag già rilasciato.
   - **General → Releases**, l'immutabilità delle release: una release pubblicata non cambia più, né l'APK né il tag. `gh release create` crea la release come bozza, carica l'APK e solo dopo la pubblica, quindi il workflow va bene anche così.
   - Facoltativo: i secret `DCH_*` in un environment (Settings → Environments) che accetta solo i tag `category-helper-v*`, con `environment:` sul job `build` del workflow e `gh secret set --env <nome> ...`. Oggi sono secret del repository, come nelle altre app.

### A ogni release

1. **La versione.** In `app/build.gradle.kts`: `versionCode` + 1 (sempre più alto della release prima: Android non installa un aggiornamento con un `versionCode` più basso, e «What's new» guarda lui) e `versionName` = `X.Y.Z`. Il workflow si ferma se il tag non corrisponde, e `publish` se il `versionCode` non sale rispetto alla *Latest*.
2. **Le note** in `app/src/main/assets/release-notes/X.Y.Z.md`, in questa forma:

   ```markdown
   DokkanTS Category Helper X.Y.Z does something new.

   - A short English bullet.
   - Another one.

   <!-- dch-notes:it
   - Lo stesso punto in italiano.
   - Un altro.
   -->
   ```

   Una riga di introduzione facoltativa (solo su GitHub: l'app mostra i punti), i punti `- ` in inglese, poi gli stessi punti in italiano fra la riga `<!-- dch-notes:it` e la riga `-->`, e dopo niente. Il blocco è un commento HTML: GitHub non lo mostra, l'app lo legge quando è in italiano. Fuori da quelle due righe non ci devono essere `<!--` né `-->` (aprirebbero o chiuderebbero il commento nel posto sbagliato). Un punto per riga: l'app legge una riga per punto, quindi dopo il primo punto inglese solo punti `- ` e righe vuote, niente righe che continuano un punto né punti annidati. Testo semplice, senza Markdown (l'app lo mostra così com'è), al massimo 30 punti per lingua di 500 caratteri; frasi brevi, senza lineette lunghe, a capo LF. Lo stesso file è il testo della release su GitHub e, nell'app, le note della finestra dell'aggiornamento e di «What's new»: le note delle versioni già uscite restano. Senza il file, o con un'altra forma, il workflow si ferma; `db/test/android-release.test.mjs` è rosso finché la versione di `build.gradle.kts` non ha il suo file, e controlla la forma di ogni file (anche tanti punti in italiano quanti in inglese, i limiti dell'app e niente Markdown).
3. **Il dizionario**, dalla radice del repository: `node db/import/categories/export-android.mjs --check` (se esce 1, rigenera il file senza `--check`) e `node db/test/android-dictionary.test.mjs`.
4. **Commit e push su `main`**: il workflow pubblica solo un commit che sta su `main`.
5. **Il tag**, annotato, sull'ultimo commit di `origin/main` (non su `HEAD`: si lavora su `dev`, e il tag deve prendere proprio il codice di `main`):

   ```bash
   git fetch origin
   git tag -a category-helper-vX.Y.Z -m "DokkanTS Category Helper X.Y.Z" origin/main
   git push origin category-helper-vX.Y.Z
   ```

6. **Il giro**: segui **Category Helper release** in Actions, prima `build` e poi `publish`. Nel riepilogo di `build` c'è lo SHA-256 del certificato; `publish` lo confronta da solo con quello della *Latest* di prima e si ferma se è diverso. Alla prima release non c'è niente con cui confrontarlo: annotalo, accanto alla copia di sicurezza del keystore.
7. **Il link**: apri <https://github.com/EmanueleMelini/dokkan-team-sharing/releases/latest/download/dokkants-category-helper.apk> da un browser senza login: deve scaricare l'APK nuovo.

Se il giro si ferma prima di pubblicare, la release non esce. Un secret sbagliato si corregge e si rilancia il giro (**Re-run all jobs**, stesso tag e stesso commit; se si è fermato solo `publish`, basta **Re-run failed jobs**: l'APK di `build` resta per un giorno). Un errore nel codice, o un tag sbagliato (la versione non aggiornata, un commit che non è su `main`), si corregge su `main`; finché la release del tag non esiste, il tag si toglie e si rifà con la stessa versione, dal punto 5:

```bash
git tag -d category-helper-vX.Y.Z
git push origin :refs/tags/category-helper-vX.Y.Z
```

Una release già pubblicata non si tocca: si esce con una versione nuova. `publish` non rimette mai *Latest* una versione più vecchia: il **Re-run** di un tag già superato da uno più nuovo si ferma.

### La build firmata in locale (facoltativa)

Con la firma in `local.properties` (punto 2), da `android/`:

```bash
./gradlew testDebugUnitTest :app:releaseApk
```

L'APK firmato esce già con il nome dell'asset: `app/build/dist/dokkants-category-helper.apk`. Ogni build di release svuota prima `app/build/dist/`: se si ferma, lì non resta l'APK di una build di prima. La firma si controlla con `apksigner` dei build-tools dell'SDK (l'SDK da `ANDROID_HOME` o, se non c'è, da `sdk.dir` di `local.properties`):

```bash
SDK="${ANDROID_HOME:-$(sed -n 's/^sdk\.dir=//p' local.properties)}"
"$(ls -d "$SDK"/build-tools/* | sort -V | tail -1)/apksigner" verify --verbose --print-certs app/build/dist/dokkants-category-helper.apk
```

Deve dire `Verified using v2 scheme (APK Signature Scheme v2): true` e mostrare il tuo certificato, non `CN=Android Debug`.

## Test sul telefono

**Fase 1 (bolla).**

1. Apri Dokkan JP: la bolla compare (in alto a destra la prima volta).
2. Trascinala e lasciala: si aggancia al bordo. Chiudi e riapri Dokkan: torna nello stesso punto.
3. Torna alla home, apri un'altra app, usa le app recenti: la bolla sparisce e ricompare solo rientrando in Dokkan, senza lampeggiare.
4. In Dokkan apri la tendina notifiche, la tastiera della ricerca categorie e il Game Assistant: la bolla resta.
5. Spegni e riaccendi lo schermo con Dokkan aperto: con lo schermo bloccato la bolla non c'è, dopo lo sblocco torna.
6. Cambia opacità e dimensione nelle impostazioni, rientra in Dokkan e verifica; spegni **Show the bubble when Dokkan is open** e verifica che non compaia più.

**Fase 2 (pannello).**

1. In Dokkan tocca la bolla: si apre il pannello sopra il gioco con la tastiera già aperta sul campo di ricerca.
2. Con il campo vuoto vedi **All categories (99)** (in italiano **Tutte le categorie (99)**). Scrivi `pure`, `saiy`, `hybird` (errore voluto), `half saiyan`: i risultati cambiano a ogni lettera.
3. Tocca un risultato: il pannello si chiude, torna la bolla e il nome giapponese è negli appunti. Apri la ricerca categorie del gioco e incollalo: la lista si filtra.
4. Riapri il pannello: la categoria scelta è nei recenti. Tocca ♥ su una riga: compare nei preferiti; toccalo di nuovo per toglierla.
5. Chiudi il pannello in tutti i modi: tocco fuori dalla scheda, ✕, gesto/tasto indietro (col primo indietro può chiudersi solo la tastiera). Dopo la chiusura deve tornare la bolla.
6. Con il pannello aperto premi Home: il pannello sparisce e non ricompare finché non rientri in Dokkan.

**Fase 3 (inserimento)**, con **Automatic** e il log diagnostico acceso se vuoi i dettagli:

1. **Campo chiuso**: senza la ricerca categorie aperta, tocca la bolla e scegli una categoria. La bolla diventa piena col bordo bianco. Apri la ricerca categorie e tocca il campo: il nome entra da solo e la lista si filtra.
2. **Campo già aperto**: tocca il campo di ricerca del gioco, poi la bolla, scegli una categoria. Annota se il nome entra subito alla chiusura del pannello o solo toccando di nuovo il campo.
3. **Scadenza**: scegli una categoria e aspetta più di 30 s: la bolla torna normale e toccando il campo non entra niente.
4. **Uscita**: scegli una categoria, vai alla home e rientra: niente viene scritto da solo.
5. **Clipboard only**: ripeti il punto 1: il campo resta vuoto e il nome va incollato a mano.

**Fase 4 (editor).**

1. **Open the editor**: 99 voci, il sottotitolo dice «not edited» («non modificato» col telefono in italiano). Una voce del gioco mostra **Game ID** nella finestra di modifica.
2. **+**: aggiungi una categoria (es. `Test Category` / `テスト`, alias `tc`). Il sottotitolo passa a «edited» («modificato»). In Dokkan cerca `tc`: c'è, e l'inserimento funziona.
3. Modifica una voce (cambia gli alias), poi eliminane una e premi **Undo**: torna com'era. Eliminala di nuovo senza annullare: sparisce anche dai recenti/preferiti.
4. Scrivi lo stesso nome inglese di una voce esistente: compare l'avviso di duplicato (si può salvare comunque).
5. ⋮ → **Export JSON…**, poi ⋮ → **Import JSON…** dello stesso file → *Merge*: il numero di categorie non cambia.
6. Importa un file preparato a mano (anche solo `[ { "en": "Androids", "jp": "人造人間" } ]`): con *Merge* aggiorna la voce esistente, con *Replace* resta solo quella.
7. ⋮ → **Restore the bundled dictionary** → conferma: tornano le 99 voci e il sottotitolo «not edited» («non modificato»).

**1.0.0.**

1. **Lingua**: con il telefono in inglese l'app è in inglese, in italiano è in italiano (anche la descrizione del servizio nelle impostazioni di accessibilità).
2. **Update categories senza rete** (modalità aereo): messaggio di errore di connessione, niente cambia.
3. **Update categories con la rete**, a sito pubblicato: «Already up to date» («Il dizionario è già aggiornato») con il dizionario incluso; il sottotitolo dell'editor non cambia.
4. **Le categorie eliminate restano eliminate**: elimina una voce del gioco (senza Undo), poi **Update categories**: «Already up to date», la voce non torna. Dopo **Restore the bundled dictionary** torna.
5. **Aggiornamento dalla 0.4.0** (debug sopra debug): il dizionario non modificato passa alla versione 3, recenti e preferiti restano. Uno modificato resta com'è, e Update categories non riaggiunge le categorie eliminate nella 0.4.0.
6. **Instructions** in **About**: si apre la pagina del sito nel browser.
7. **Release**: disinstallata la debug, l'APK della release si installa e il servizio si attiva (Android 13+: impostazioni con restrizioni).

**1.1.0** (con il log diagnostico acceso: le righe `automatic update check` e `message shown` in `adb logcat -s DokkanHelper`). Per non aspettare un giorno si può spostare in avanti la data del telefono (Impostazioni → Data e ora, togli quella automatica); rimetterla giusta conta come orologio tornato indietro, e il controllo riparte all'apertura successiva. Per rifare il primo arrivo da zero: Info app → Spazio di archiviazione → Cancella dati (si perdono dizionario modificato e impostazioni; se Android spegne il servizio, riattivalo).

1. **Primo arrivo**: con la 1.1.0 appena installata o aggiornata, apri Dokkan: parte un controllo, uno solo anche aprendo e chiudendo il pannello o passando dalla tendina notifiche. Nelle impostazioni compare la riga «Last automatic check» con data e ora (dalla 1.2.0 «Last automatic category check»).
2. **Una volta al giorno**: esci e rientra in Dokkan più volte: nessun altro controllo nel log fino a 24 ore dopo.
3. **Avviso**: quando il sito ha una categoria che il telefono non ha (per esempio una uscita dopo il dizionario incluso), a controllo dovuto apri Dokkan: in basso, sopra il gioco, compare per qualche secondo «DokkanTS Category Helper: Added N new categories», i tocchi passano al gioco, e la riga dice «Added N new categories». Con il dizionario già aggiornato non compare niente.
4. **Senza rete** (modalità aereo), a controllo dovuto: apri Dokkan, nessun avviso, la riga dice «Failed». Riattiva la rete: rientrando in Dokkan prima di un'ora non parte niente, dopo un'ora sì.
5. **Interruttore spento**: spegni **Check automatically** (nella 1.1.0 **Check for updates automatically**): aprendo Dokkan non parte più niente, anche a controllo dovuto, e **Update categories** a mano funziona.
6. **Bolla automatica spenta**: con **Show the bubble when Dokkan is open** spento e l'interruttore acceso, a controllo dovuto aprendo Dokkan non parte niente (lo dice anche il testo sotto l'interruttore).

**1.2.0** (la release sopra la 1.1.0, come la installa chi usa l'app; per vedere una versione nuova serve una release più nuova su GitHub, oppure la build di debug con **Install the release app**). Con il log diagnostico acceso si seguono i controlli in `adb logcat -s DokkanHelper`.

1. **Nomi**: in Impostazioni → **Dictionary** ci sono **Update categories** e **Check automatically**, nell'editor ⋮ → **Update categories**, in **About** **Check for app updates** e **What's new**. Col telefono in italiano: «Aggiorna le categorie», «Controlla in automatico», «Cerca aggiornamenti dell'app», «Novità».
2. **What's new dopo l'aggiornamento**: installata la 1.2.0 sopra la 1.1.0, alla prima apertura compare «What's new» con le note della 1.2.0, nella lingua del telefono; alla seconda no. Dopo un'installazione da zero (dati cancellati e app reinstallata) non compare. In **About** → **What's new** si riapre.
3. **Check for app updates** con la 1.2.0 *Latest* su GitHub: la riga dice che l'app è aggiornata. In modalità aereo: controllo non riuscito.
4. **Install the release app** (build di debug, con una release su GitHub più nuova di quella installata, o nessuna release installata): **About** → **Check for app updates**, poi la finestra con **Install the release app**. La prima volta compare la finestra dell'app **Allow updates**: **Open settings** apre «Installa app sconosciute» per la debug; consenti e torna indietro, il download parte con l'avanzamento; conferma l'installazione e la release c'è. Riprova annullando a metà: non resta niente, e non arriva nessuna conferma di Android.
5. **Pallino, riga e finestra** (alla prima release dopo la 1.2.0): con la 1.2.0 installata e una versione più nuova su GitHub, a controllo dovuto apri Dokkan: sulla bolla compare il pallino, in cima al pannello la riga «Version X.Y.Z available», che chiude il pannello e apre l'app con la finestra e le note; tornando a Dokkan la bolla ricompare. **Later**: la finestra non si riapre da sola fino al giorno dopo, pallino e riga restano. **Update**: l'app si aggiorna, dizionario e impostazioni restano, e alla prima apertura compare «What's new».
6. **Interruttore spento**: con **Check automatically** spento, aprendo Dokkan o l'app non parte né il controllo delle categorie né quello dell'app; i due pulsanti funzionano.
7. **Download che non riesce** (modalità aereo durante il download): la finestra dice il motivo e offre **Download in the browser**, che apre il link dell'APK.

## Esito della Fase 0

Test del 15/11/2026 sul telefono Android 16 del proprietario:

- [x] package name: JP `com.bandainamcogames.dbzdokkan` («ドッカン», v6.6.7). La Global (`com.bandainamcogames.dbzdokkanww` da specifica) non è installata su nessun telefono di test, quindi resta il default.
- [x] all'apertura della ricerca categorie esiste un `EditText` nativo (hint «フィルタするカテゴリ名を入力»), con le azioni `SET_TEXT` e `PASTE`
- [x] `ACTION_SET_TEXT` e `ACTION_PASTE` funzionano, anche nel flusso «in attesa»; la lista del gioco si filtra con il testo inserito (verificato a schermo)
- [x] il gioco non reagisce al servizio attivo: avvio da zero e login senza avvisi, nessun crash

Il Piano B (tastiera custom) quindi non serve.
