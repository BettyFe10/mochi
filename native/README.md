# Mochi nativa - iPhone e Mac 🍣

App SwiftUI unica per **iPhone e Mac**, con **widget** e **promemoria locali**.
Usa lo **stesso database Supabase** della web app: una voce scritta sull'iPhone compare sul Mac e nella versione web, e viceversa.

| | Web app (PWA) | App nativa |
|---|---|---|
| Dispositivi | Tutti, Android compreso | iPhone, iPad, Mac |
| Widget su Home, blocco e Mac | No | **Sì** |
| Promemoria | Push dal server | **Locali, li programma il dispositivo** |
| Icona che cambia con la mascotte | No | **Sì, su iPhone** |
| Dati | Supabase | Supabase (gli stessi) |

---

## Struttura

```
native/
├── project.yml                 ← definizione del progetto (XcodeGen)
├── Config/
│   ├── Base.xcconfig           ← identificativi e valori vuoti
│   └── Secrets.example.xcconfig← modello per le tue chiavi
├── App/                        ← l'app (login, schermate, sync, promemoria)
├── Widget/                     ← i widget
├── Shared/                     ← codice comune ad app e widget (modelli, parser, colori)
└── Resources/
    ├── AppIcons.xcassets       ← icone Nigi, Mochi, Bolla per iPhone e Mac
    └── Mascotte.xcassets       ← mascotte in 3 stati (normale, felice, occhi chiusi)
```

---

## 1. Preparazione (una volta sola) - 20 minuti

1. Installa **Xcode** dal Mac App Store e aprilo una volta per accettare la licenza.
2. Installa **Homebrew** (brew.sh) e poi XcodeGen:
   ```bash
   brew install xcodegen
   ```
3. In Xcode: **Settings → Accounts → +** e aggiungi il tuo Apple ID. Annota il **Team ID** (10 caratteri) che vedi nel tuo team.

## 2. Configurazione

1. **Identificativi unici**: in `Config/Base.xcconfig` cambia `it.bettyfe` con un prefisso tuo, sia in `MOCHI_BUNDLE_ID` sia in `MOCHI_APP_GROUP`. Devono essere unici in tutto l'App Store.
2. **Chiavi**: copia `Config/Secrets.example.xcconfig` in `Config/Secrets.xcconfig` e compila:
   - `MOCHI_TEAM_ID`: il Team ID
   - `SUPABASE_URL` e `SUPABASE_ANON_KEY`: gli stessi della web app
   - `WEB_APP_URL`: l'indirizzo della web app, usato per conferma email, recupero password e informativa privacy

   Negli `.xcconfig` gli indirizzi si scrivono `https:/$()/...` invece di `https://...` (in questi file `//` è un commento).

   `Secrets.xcconfig` è nel `.gitignore`: **le chiavi non finiscono mai su GitHub**. Chi copia il progetto ottiene l'app in modalità prova e non può toccare il tuo database.

3. Genera il progetto e aprilo:
   ```bash
   cd native
   xcodegen
   open Mochi.xcodeproj
   ```
   Ogni volta che aggiungi o sposti file, rilancia `xcodegen`.

## 3. Prima esecuzione

- In alto in Xcode scegli lo schema **Mochi** e la destinazione **My Mac** → **▶︎ Run**.
- Se Xcode segnala problemi di firma: target **Mochi** e **MochiWidget** → **Signing & Capabilities** → seleziona il tuo team. Se l'App Group non compare, premi **+ Capability → App Groups** e spunta quello di `Base.xcconfig`.

## 4. Installazione su iPhone

**Con Apple ID gratuito (per provare)**
1. Collega l'iPhone al Mac, sull'iPhone attiva **Impostazioni → Privacy e sicurezza → Modalità sviluppatore**.
2. In Xcode scegli l'iPhone come destinazione → **Run**.
3. Al primo avvio: **Impostazioni → Generali → VPN e gestione dispositivi** → autorizza il tuo profilo sviluppatore.

⚠️ Con l'account gratuito l'app sull'iPhone **smette di aprirsi dopo 7 giorni** e va reinstallata da Xcode. Sul Mac invece continua a funzionare.

**Con Apple Developer Program (99 €/anno): consigliato per regalarla**
1. Iscriviti su developer.apple.com.
2. In Xcode: destinazione **Any iOS Device** → **Product → Archive** → **Distribute App → TestFlight & App Store**.
3. Su **App Store Connect** aggiungi Federica come tester interna di TestFlight.
4. Federica installa **TestFlight** dall'App Store e da lì installa Mochi. Ogni build dura 90 giorni: basta caricarne una nuova.

Da lì puoi anche pubblicarla sull'App Store: l'app ha già eliminazione account e manifesto privacy, due requisiti di Apple.

## 5. Widget

- **iPhone**: tieni premuto sulla Home → **+** → cerca "Mochi". Piccolo, medio e, sulla schermata di blocco, rotondo, rettangolare e in linea.
- **Mac**: clic destro sulla scrivania → **Modifica widget** → "Mochi".

I widget mostrano le cose di oggi, quelle rimaste indietro e le prossime, con la mascotte che sorride quando la giornata è libera. Si aggiornano quando l'app salva qualcosa e da soli ogni 30 minuti.

## 6. Come convive con la web app

- **Stesso account, stessi dati**: si entra con la stessa email e password.
- **Nome dell'app, mascotte e nome personale** sono salvati nell'account: valgono ovunque.
- **Promemoria**: l'app nativa li programma sul dispositivo; la web app li riceve dal server. Su un iPhone dove c'è l'app nativa conviene **non** attivare le notifiche della web app, altrimenti arrivano doppie.
- **Conferma email e recupero password** aprono la web app nel browser: da lì si sceglie la nuova password, poi si entra nell'app nativa.

## Note

- Su Mac l'icona nel Dock resta quella di Nigi: macOS non permette di cambiarla da un'app nel modo in cui lo fa iOS.
- **App Group su Mac**: se i widget sul Mac non mostrano i dati, usa per l'App Group il formato con il Team ID davanti (es. `ABCDE12345.group.it.tuonome.mochi`) solo per il Mac.
- Il codice è stato scritto e controllato sintatticamente, ma non compilato (serve Xcode su Mac). Se alla prima compilazione Xcode segnala un errore, copiamelo e lo sistemiamo.
