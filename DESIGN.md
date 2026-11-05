# Mochi - regole di UI e UX

Questo file non viene pubblicato: serve a chi mette le mani su Mochi per tenere l'app coerente.
Il CSS vive in due posti soltanto: `tema.css` (colori, chiaro/scuro, caratteri, variabili) e il `<style>` di `index.html`.
Niente file nuovi da pubblicare (il workflow ha un elenco fisso).

## 1. L'idea

Mochi è tondo, soffice e kawaii. Lo stile predefinito (Morbido) è rosa e sfumato; chi vuole può scegliere Cartone (un cartone kawaii dei primi anni 2000: contorno scuro morbido, colori pieni e allegri) o Quaderno. In tutti e tre deve essere prima di tutto chiaro e calmo da usare ogni giorno.

Principi, in ordine di importanza:

1. **Chiaro prima che carino.** In ogni schermata si capisce subito cosa è titolo, cosa è un'azione, cosa è un'informazione.
2. **Una sola azione principale per schermata** (il pulsante pieno). Il resto sono pulsanti con il contorno.
3. **Aria.** Le cose respirano: spazi dalla scala qui sotto, mai numeri a caso.
4. **Un solo gioco per schermata.** Un adesivo storto, un pezzo di nastro, un tondino colorato: uno, non dieci.
5. **Fatto a mano, non in serie.** Le schede non sono tutte uguali: raggio e trattamento cambiano con l'importanza.
6. **Ispirati allo spirito, mai ai personaggi.** Niente personaggi, nomi, loghi o elementi riconoscibili di cartoni esistenti.

## 2. Tre stili

In Impostazioni > Stile, in quest'ordine. L'id è il valore di `data-stile` su `<html>` e in `CUSTOM.stile`.

| Stile | id | Com'è | Selettore |
|---|---|---|---|
| **Morbido** (predefinito) | `morbido` | l'aspetto originale di Mochi: rosa sfumato, ombre morbide colorate, pulsante principale e "+" con sfumatura e alone, righe con la striscia colorata a sinistra, finestre con lo sfondo appena sfocato | `:root[data-stile="morbido"]` |
| **Cartone** | `cartone` | linea scura "da cartone", colori pieni del giardino (sole, pesca, prato), adesivi con ombra netta, niente sfumature né vetro | `:root[data-stile="cartone"]` |
| **Quaderno** | `quaderno` | carta puntinata, titoli a mano, etichette di carta, evidenziatori | `:root[data-stile="quaderno"]` |

Come è fatto il CSS:
- Le **regole base** (in alto in `index.html`) sono già "morbide": spazi, dimensioni del testo, area di tocco, contrasto e focus valgono per **tutti e tre**.
- Il blocco **STILE MORBIDO** contiene solo i ritocchi che lo tengono fedele all'originale. Lì c'è anche il colore pieno `--acc-pieno`/`--acc-pieno2`: un rosa del tema scurito, così il testo bianco sui pulsanti sfumati regge il 4.5:1.
- Il blocco **STILE CARTONE** e quello **QUADERNO** non si toccano tra loro: ogni regola è scritta per un solo stile.
- Regole che valgono per due stili (es. emoji invece delle icone a tratto): `:root:not([data-stile="quaderno"])`.
- Chi aveva già scelto `morbido` vede l'originale; un valore sconosciuto torna a `morbido` (`cleanCustom`). `privacy.js` accetta gli stessi tre valori.
- Le sezioni 6 e 7 qui sotto (linee e pulsanti a tre livelli) descrivono lo stile **Cartone**. In Morbido le schede hanno l'ombra morbida colorata (`--shadow`) e il pulsante principale la sfumatura.

## 3. Spaziature

Scala a passi di 4: usare sempre le variabili.

| Variabile | Valore | Uso tipico |
|---|---|---|
| `--s1` | 4px | tra icona e testo piccolo |
| `--s2` | 8px | tra etichette (chip), tra filtri |
| `--s3` | 12px | tra righe di una lista, gap delle griglie |
| `--s4` | 16px | padding interno di schede e campi, tra schede grandi |
| `--s5` | 24px | sotto l'intestazione, padding delle schede "eroe" |
| `--s6` | 32px | sopra ogni titolo di sezione (`.sec`) |

- Margine laterale della pagina su telefono: 16px. Mai meno.
- Titolo di sezione: 32px sopra, 12px sotto (`.sec`).
- Liste: 12px tra una riga e l'altra (`.list`).
- Righe di elenco: padding 16px (`.item`), 12px/16px per righe più basse (`.sp-riga`, `.turno-riga`).

## 4. Tipografia

- Titoli: `--ft` (Fredoka di base). Testo: `--fb` (Nunito di base). L'utente può cambiarli: non scrivere mai nomi di caratteri nel CSS dei componenti, solo le variabili.
- Dimensioni (telefono):

| Ruolo | Dimensione | Peso | Esempio |
|---|---|---|---|
| Saluto | 22-26px (clamp) | 600 | `.top .hello h1` |
| Titolo finestra | 22px | 600 | `.sheet h2` |
| Titolo sezione | 20px | 600 | `.sec h2` |
| Numeri grandi | 30-34px | 600 | `.stat b`, `.sp-tot>b` |
| Testo di una voce | 16px | 700 | `.t` |
| Testo normale | 15px | 400 | `.bubble`, `.empty`, `.note p` |
| Etichette dei campi | 14px | 800 | `.field label` |
| Testo secondario | 13px | 600-700 | `.meta`, `small` nelle schede |
| Didascalie sotto le icone | 12-13px | 700 | `.nav .tab`, `.sp-pick small` |

- **Minimo assoluto 12px**, e solo per didascalie di 1-2 parole sotto un'icona. Il testo che si legge davvero parte da 14-15px.
- Niente maiuscolo spaziato per le etichette, niente corsivo per i titoli. L'unico corsivo è la frase del giorno (`.motto`).
- I campi di testo sono sempre 16px (sotto, iOS ingrandisce la pagina).

## 5. Colori

Il **tema** (Fragola, Matcha, Lavanda, Pesca, Cielo) decide il colore principale. Accanto ci sono i colori fissi del "giardino al sole".

| Variabile | Uso |
|---|---|
| `--bg`, `--bg2` | sfondo pagina, fondo dei segmenti |
| `--card` | schede, finestre, campi |
| `--ink` | testo principale **e linea da cartone** (`--tratto`) |
| `--ink2` | testo secondario (scurito per stare sopra 4.5:1) |
| `--pink` | colore del tema pieno: pulsante principale, scelta attiva, "+" |
| `--pink-d` | riempimento barre, interruttori accesi. **Mai per testo piccolo** |
| `--acc-t` | testo colorato del tema (link, contatori, "+ Aggiungi"): versione scura di `--pink-d`, in scuro diventa `--pink` |
| `--lav`, `--lav-t` | area Lavoro (fondo / testo) |
| `--sole`, `--pesca`, `--prato` | adesivi colorati (numerini di Oggi, totale Spese, ore dei Turni, tondini del menu) |
| `--on-acc` | testo sopra un colore pieno (`#3b2530`, scuro e caldo) |
| `--danger`, `--danger-l` | errori, scadute, eliminare |
| `--tratto`, `--tratto-m`, `--tratto-l` | linea piena (adesivi) / media (controlli, 3:1) / leggera (schede) |

Regole:
- **Testo sempre almeno 4.5:1** sul suo sfondo (3:1 solo sopra i 24px). Per il testo colorato usare `--acc-t`, non `--pink-d`.
- Sopra un colore pieno il testo è scuro (`--on-acc`), non bianco: i colori del tema sono chiari e il bianco non si leggerebbe.
- In Cartone niente sfumature, niente vetro (`backdrop-filter`), niente aloni colorati. In Morbido la sfumatura sta solo sul pulsante principale, sul "+" e sul recap.
- Scuro: la linea diventa quasi nera (`#120a0e`) come un'ombra da cartone; gli adesivi usano versioni spente dei colori del giardino.

## 6. Linee, raggi, ombre (stile Cartone)

Tre livelli, riconoscibili a colpo d'occhio. Il livello si sceglie per importanza, non per abitudine.

| Livello | Cosa | Trattamento | Classi |
|---|---|---|---|
| **Adesivo** | 1-3 cose importanti per schermata, e il pulsante principale | colore pieno, linea piena `--tratto` 2px, ombra netta `0 4px 0` (pulsanti `0 3px 0`), raggio `--r-xl` 26px | `.stat`, `.umore-card`, `.pancino`, `.sp-tot`, `.ore-mese`, `.recap`, `.btn.primary`, `.nav .plus` |
| **Controllo** | cose da toccare: pulsanti secondari, pillole, campi, caselline, X | linea media `--tratto-m` 2px (contrasto almeno 3:1), niente ombra; quando è scelto diventa linea piena | `.btn`, `.fbtn`, `.input`, `.check`, `.iconbtn`, `.sheet-x` |
| **Scheda** | righe di elenco, pannelli, celle | bianca, linea leggera `--tratto-l` 2px, niente ombra, raggio `--r-l` 18px | `.item`, `.sp-riga`, `.turno-riga`, `.lcard`, `.msg`, `.cal`, `.mtile`, `.bubble` |

Raggi: `--r-s` 10px (caselline), `--r-m` 14px (campi), `--r-l` 18px (schede, pulsanti), `--r-xl` 26px (adesivi, finestre), tondo pieno per pillole, "+" e pulsanti icona.
Le ombre sono **sempre nette** (senza sfocatura), del colore della linea, e **solo sugli adesivi**: è il segno di riconoscimento.
Una lista lunga non deve mai sembrare una pila di adesivi.

## 7. Pulsanti

- **Principale** `.btn.primary`: `--pink` pieno, testo `--on-acc`, bordo e ombra d'inchiostro. Al tocco scende di 3px e perde l'ombra (si "schiaccia"). Uno per schermata o finestra, a destra.
- **Secondario** `.btn`: bianco con linea media, senza ombra. Es. "Annulla", "Chiudi".
- **Pericolo** `.btn.danger` (fondo rosa chiaro, testo `--danger`) e `.btn.danger-full` (rosso pieno, testo bianco) solo per la conferma finale.
- **Pillola** `.fbtn`: filtri e azioni piccole ("Cambia", "+ Aggiungi"), linea media. Scelta = piena di `--pink` con linea piena.
- **Link** `.more`: azioni di contorno ("+ Data, promemoria e note"), colore `--acc-t`.
- **Icona** `.iconbtn`, `.sheet-x`: tondi, 44px.
- Testo dei pulsanti: verbo chiaro ("Salva", "Aggiungi una spesa"), niente frecce aggiunte.

## 8. Schede, liste, finestre

- Una voce (`.item`): casellina tonda a sinistra, titolo 16px, sotto le etichette (`.chip`). Il colore dell'area sta nell'etichetta, non nel bordo.
- Le cose fatte: tratteggiate, più chiare, senza ombra.
- Finestre (`.sheet`): linea media in alto, maniglia, X tonda da 44px in alto a destra. Titolo con la mascotte. I pulsanti in fondo restano sempre visibili (`.sheet > .actions` sticky).
- Le intestazioni con frecce dentro una finestra (`.sheet > .calhead`) lasciano spazio alla X.
- Bacheca: post-it con un filo di contorno, puntine, sughero. Resta così.
- Calendario: la sigla del turno è una pillolina **sotto** il numero (`.day.conturno .tday-s`, 10px), mai sopra; la cella si allunga se serve.
- Vuoti dentro le finestre (es. pancino senza bocconcini): una frase che invita, non grafici a zero.

## 9. Icone ed emoji

- Morbido e Cartone usano le emoji (`.emo`), Quaderno le icone a tratto (`.ico.q`). Ogni voce di menu ha entrambe.
- Le emoji servono da icona, non da decorazione del testo: al massimo una per frase, mai nei titoli di sezione.
- Nel menu le emoji stanno dentro un tondino colorato con contorno (adesivo).

## 10. Movimento

- Solo in risposta a un gesto: pulsanti che si schiacciano, finestra che sale, coriandoli quando si finisce una cosa.
- L'unico movimento "da solo" è la mascotte che respira (e le Stagioni se accese).
- Tutto si ferma con `prefers-reduced-motion` (anche le inclinazioni degli adesivi).

## 11. Stati

- **Vuoto** (`.empty`): mascotte, una frase che invita a fare qualcosa, eventuale pulsante. Mai solo "Niente qui".
- **Errore** (`.err`, toast): dice cosa è successo e cosa fare ("Connessione assente. Riprova tra poco."). Colore `--danger`.
- **Caricamento**: il pallino `.sync`; niente spinner a tutto schermo.
- **Fatto**: casellina piena del colore del tema con spunta scura, coriandoli, la mascotte salta.

## 12. Accessibilità

- Area di tocco **almeno 44x44px**. Se il disegno è più piccolo (casellina 28px, "1/3"), l'area si allarga con uno `::after` invisibile (vedi `.check::after`).
- Focus da tastiera sempre visibile: `outline:3px solid var(--acc-t)` (Quaderno: tratteggiato).
- Finestre: con una finestra (o il biscotto) aperta, Tab e Maiusc+Tab girano solo dentro; chiudendo, il focus torna al pulsante che l'aveva aperta. Esc chiude.
- Contrasto testo AA (4.5:1). Lo controlla `design_giro/contrast.js` nello scratchpad.
- Le immagini decorative hanno `aria-hidden`, i pulsanti icona hanno `aria-label`.

## 13. Responsive

| Larghezza | Cosa cambia |
|---|---|
| 340 | il minimo: tutto deve stare, niente scroll orizzontale, griglie a 4 colonne al massimo |
| 390 / 430 | telefono tipico: barra in basso con "+" al centro |
| 768 | tablet: una colonna larga al massimo 660px, calendario al massimo 480px, bacheca a 3 colonne |
| 1024 | barra laterale a sinistra, pagine a due colonne (`.split`), finestre centrate |
| 1440 | come 1024, contenuto al massimo 1320px, menu in griglia fitta (max 1000px), voci laterali alte 44px |

## 14. Cosa NON fare

- In Cartone: bordi grigini, ombre sfocate colorate, sfumature, vetro, aloni (in Morbido invece sono il suo carattere, ma sempre con testo leggibile).
- Testo bianco su rosa chiaro, testo colorato con `--pink-d`.
- Tutte le schede uguali, stesso raggio ovunque.
- Più di un "gioco" decorativo per schermata.
- Etichette in MAIUSCOLO spaziato, emoji in ogni frase, trattini lunghi nei testi (usare "-").
- Spazi inventati (13px, 9px, 7px): usare la scala.
- Nuovi file CSS/JS/immagini da pubblicare.

## 15. Esempi di classi

```html
<!-- sezione con contatore -->
<div class="sec"><h2>Da fare</h2><span class="count">4</span></div>
<!-- voce -->
<div class="item personale"><button class="check" data-act="toggle" aria-label="Completa"></button>
  <div class="body"><div class="t">Chiamare la nonna</div><div class="meta"><span class="chip per">Personale</span></div></div></div>
<!-- pulsanti di una finestra -->
<div class="actions"><button class="btn" data-act="close">Annulla</button><button class="btn primary">Salva</button></div>
```
