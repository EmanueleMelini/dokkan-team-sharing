# Dokkan Category Helper — Specifica di progetto

> Nota: l'app ora si chiama **DokkanTS Category Helper** (package `it.emanuelemelini.dokkants.categoryhelper`); qui resta il nome originale della specifica.

> Specifica originale, conservata come riferimento storico: le fasi sono tutte fatte (stato ed esito della Fase 0 in [README.md](../README.md)), e le scelte cambiate dopo sono nel README, «Rispetto alla specifica».

## Obiettivo

App Android personale (APK locale, niente Play Store, niente pubblicità, niente rete) che aiuta a filtrare le **categorie** in *Dragon Ball Z Dokkan Battle* versione **giapponese**.

Flusso utente:
1. Apro Dokkan JP → compare automaticamente una piccola bolla semitrasparente.
2. Tocco la bolla → si espande un pannello con campo di ricerca.
3. Scrivo il nome della categoria **in inglese** (es. "pure saiyans", alias "ssj3").
4. Seleziono il risultato → il testo **giapponese** viene inserito direttamente nel campo di ricerca del gioco. Se non è possibile, finisce nella clipboard da incollare a mano.
5. Esco da Dokkan JP → la bolla sparisce.

La versione Global non deve mostrare l'overlay (è già in inglese).

## Stack

- Kotlin, Gradle Kotlin DSL
- minSdk 26, targetSdk ultima stabile
- UI impostazioni: Jetpack Compose
- UI overlay: View classiche, oppure Compose (in quel caso impostare manualmente `ViewTreeLifecycleOwner` e `ViewTreeSavedStateRegistryOwner` sulla view aggiunta al `WindowManager`)
- Persistenza: DataStore per le impostazioni, JSON per il dizionario
- **Nessun permesso INTERNET**

## Architettura

### Componente centrale: `DokkanAccessibilityService`

Un unico `AccessibilityService` gestisce:
- il rilevamento dell'app in primo piano;
- la visualizzazione dell'overlay con `TYPE_ACCESSIBILITY_OVERLAY`, che non richiede `SYSTEM_ALERT_WINDOW`. Se si rivela problematico (es. focus della tastiera), fallback su `TYPE_APPLICATION_OVERLAY` + permesso `SYSTEM_ALERT_WINDOW`;
- l'inserimento del testo nel campo del gioco.

Configurazione (`res/xml/accessibility_service_config.xml`):
- eventi: `typeWindowStateChanged | typeViewFocused | typeWindowContentChanged`
- flag: `flagReportViewIds | flagRetrieveInteractiveWindows | flagIncludeNotImportantViews`
- `canRetrieveWindowContent="true"`
- **Non** filtrare per `packageNames` nella config: servono anche gli eventi delle altre app per capire quando si esce da Dokkan. Filtrare nel codice.

### Rilevamento Dokkan JP

- Package di default: JP `com.bandainamcogames.dbzdokkan`, Global `com.bandainamcogames.dbzdokkanww`. **Da verificare** con `adb shell pm list packages | grep -i dokkan` e rendere configurabile nelle impostazioni.
- Mostrare l'overlay quando la finestra applicativa attiva appartiene al package JP.
- Nasconderlo quando in primo piano va un'altra app. Ignorare gli eventi di IME (tastiera), System UI e del package stesso dell'app, altrimenti l'overlay lampeggia. Usare `windows` / `rootInActiveWindow` per determinare l'app attiva in modo affidabile.

### Overlay

- **Stato compatto:** bolla piccola, trascinabile, opacità configurabile (default ~35%), aggancio al bordo dello schermo, posizione salvata. Finestra `FLAG_NOT_FOCUSABLE` per non rubare input al gioco.
- **Stato espanso:** pannello con campo di ricerca, lista risultati, sezioni "Recenti" e "Preferiti". Togliere `FLAG_NOT_FOCUSABLE` per poter scrivere. Si chiude toccando fuori, con il tasto indietro o dopo una selezione.

### Dizionario categorie

File `assets/categories.json`, copiato al primo avvio in storage interno e poi modificabile dall'app:

```json
{
  "version": 1,
  "categories": [
    { "id": "pure_saiyans",   "en": "Pure Saiyans",   "jp": "純粋サイヤ人", "aliases": ["pure", "saiyan"] },
    { "id": "hybrid_saiyans", "en": "Hybrid Saiyans", "jp": "混血サイヤ人", "aliases": ["hybrid", "half saiyan"] }
  ]
}
```

- Le due voci sono solo d'esempio, **da verificare**; il dizionario completo lo popolo io.
- La JP riceve categorie nuove prima della Global: per quelle, `en` sarà la traduzione della community.
- Funzioni nell'app: aggiungi/modifica/elimina voce, import/export JSON tramite Storage Access Framework.

### Ricerca

- Normalizzazione: minuscolo, rimozione punteggiatura e spazi multipli.
- Match su `en` + `aliases`. Ordinamento: prefisso esatto > contiene > fuzzy (Levenshtein o token match).
- Risultati aggiornati a ogni carattere digitato; la lista mostra EN e JP.

### Inserimento del testo (strategie in cascata)

Problema chiave: quando scrivo nell'overlay, il campo del gioco perde il focus e la tastiera del gioco si chiude. Per questo è previsto il **flusso "inserimento in attesa"**:

1. Seleziono la categoria nell'overlay → il testo JP viene **sempre** copiato in clipboard e salvato come `pendingText`. L'overlay torna compatto.
2. Tocco il campo di ricerca del gioco → al primo evento `TYPE_VIEW_FOCUSED` (o nodo editabile con focus input) nel package Dokkan JP, il servizio prova in ordine:
   - `ACTION_SET_TEXT` sul nodo editabile con focus;
   - `ACTION_PASTE` sul nodo, se il primo fallisce;
   - nessuna azione: il testo resta in clipboard e un toast avvisa "Incolla manualmente".
3. `pendingText` si azzera dopo l'inserimento o dopo un timeout (es. 30 s).

Variante da provare in parallelo: se il nodo editabile del gioco era già focalizzato **prima** di aprire l'overlay, salvarne il riferimento, chiamare `refresh()` dopo la selezione e tentare `ACTION_SET_TEXT` subito.

Nota tecnica: Dokkan disegna la UI col motore di gioco, quindi l'albero di accessibilità è quasi vuoto. Probabilmente all'apertura della tastiera il motore crea un `EditText` nativo: va verificato nella Fase 0.

## Fasi di sviluppo

### Fase 0 — Prototipo diagnostico (PRIMA di tutto il resto)

Servizio di accessibilità minimale che:
- logga in Logcat (tag `DokkanProbe`) package, classe ed eventi delle finestre;
- a ogni `TYPE_VIEW_FOCUSED` e `TYPE_WINDOW_CONTENT_CHANGED` nel package Dokkan, fa il dump ricorsivo dell'albero dei nodi (classe, viewId, text, isEditable, isFocused, azioni supportate);
- ha un pulsante di test che esegue `ACTION_SET_TEXT` con una stringa fissa sul nodo editabile con focus.

**Criteri di uscita:**
- [ ] confermati i package name JP/Global;
- [ ] verificato se all'apertura della ricerca categorie esiste un nodo editabile;
- [ ] verificato se `ACTION_SET_TEXT` e/o `ACTION_PASTE` funzionano;
- [ ] verificato che il gioco **non** reagisca al servizio di accessibilità attivo (nessun avviso, crash o blocco al login). Se lo rileva → valutare il piano B.

**STOP:** a Fase 0 completata, non procedere oltre. Attendi i risultati dei test dall'utente.

### Fase 1 — Overlay + rilevamento app
Bolla che appare/sparisce con Dokkan JP, trascinabile, opacità configurabile.

### Fase 2 — Dizionario + ricerca + clipboard
Pannello espanso funzionante, copia in clipboard, recenti/preferiti.

### Fase 3 — Inserimento diretto
Flusso "inserimento in attesa" con le strategie in cascata.

### Fase 4 — Gestione dizionario
Editor voci nell'app, import/export JSON.

## Piano B (se l'inserimento via accessibilità non funziona o il gioco rileva il servizio)

Tastiera custom (`InputMethodService`) con ricerca categorie integrata: si cerca in inglese dentro la tastiera e questa scrive il giapponese con `currentInputConnection.commitText()`. Funziona con qualsiasi campo di testo e non richiede il servizio di accessibilità. Il costo è dover cambiare tastiera.

## Schermata principale (impostazioni)

- Stato permessi, con pulsanti che aprono le schermate di sistema: servizio di accessibilità ed eventuale overlay.
- **Avviso Android 13+:** per un APK installato da file, il servizio di accessibilità è bloccato finché non si abilitano le "impostazioni con restrizioni" (Info app → menu ⋮ → "Consenti impostazioni con restrizioni"). Mostrare queste istruzioni nell'app.
- Toggle: apparizione automatica on/off.
- Package da monitorare (modificabile).
- Opacità e dimensione della bolla.
- Modalità inserimento: automatica / solo clipboard.
- Accesso all'editor del dizionario.

## Vincoli

- Uso personale, APK installato via `adb install` o da file.
- Nessuna rete, nessun analytics, nessuna pubblicità.
- Nessuna interazione automatica col gioco oltre all'inserimento del testo richiesto (niente click automatici).
- Codice e commenti in inglese, stringhe UI in italiano.

## Build

- `./gradlew assembleDebug` → `adb install -r app/build/outputs/apk/debug/app-debug.apk`
- Log diagnostici: `adb logcat -s DokkanProbe`
