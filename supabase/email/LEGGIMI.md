# Email di Mochi (accesso, password, cambio email)

Modelli in italiano per le email che Supabase manda a chi si iscrive. Non fanno parte del sito (la cartella `supabase/` non viene pubblicata) e non contengono chiavi.

| File | Dove si incolla in Supabase (Authentication > Emails > Templates) | Oggetto consigliato |
|---|---|---|
| `conferma-iscrizione.html` | Confirm signup | Conferma la tua email per entrare in Mochi 🍑 |
| `password-dimenticata.html` | Reset password | Una nuova password per Mochi 🍑 |
| `cambio-email.html` | Change email address | Conferma il nuovo indirizzo di Mochi |
| `invito-utente.html` | Invite user | C'è un posto per te in Mochi 🍑 |
| `link-magico.html` | Magic Link | Il tuo link per entrare in Mochi 🍑 |
| `conferma-codice.html` | Reauthentication (mostra un codice, `{{ .Token }}`) | Il tuo codice di conferma per Mochi |

Le parti tra doppie graffe (`{{ .ConfirmationURL }}`, `{{ .Token }}`) le riempie Supabase: non toglierle. Oggi l'app usa solo conferma iscrizione e password dimenticata; gli altri modelli servono perché, se un giorno Supabase manda una di quelle email, sia bella anche lei. Se nel tuo progetto compaiono altri modelli (per esempio avvisi di sicurezza come "password cambiata"), dimmelo e li faccio uguali.
L'immagine in alto è l'icona del sito (`icons/icon-180.png` su GitHub Pages): se il programma di posta non la mostra, l'email si legge lo stesso.

## Mandare le email da un Gmail dedicato (gratis, senza dominio)

1. Crea un account Gmail solo per l'app (es. `mochi.app.xxx@gmail.com`). Non usare il tuo personale.
2. Attiva la verifica in due passaggi: myaccount.google.com/security.
3. Crea una "password per le app": myaccount.google.com/apppasswords, nome "Mochi". Google mostra 16 caratteri: copiali subito. **Non scriverli in chat, nel repository o in config.js.**
   Se Google dice "L'impostazione che stai cercando non è disponibile per il tuo account": la verifica in due passaggi non è attiva nel modo giusto. Attivala con un numero di telefono (non solo con una chiave di sicurezza o una passkey), controlla che non ci sia la "Protezione avanzata" e che l'account non sia di un'organizzazione, aspetta qualche minuto e riprova. Se la pagina non compare comunque, usa un dominio proprio con Resend (vedi "Se un giorno vuoi di più").
4. In Supabase: Authentication > Emails > SMTP Settings (o Project Settings > Authentication > SMTP), attiva "Enable custom SMTP":
   - Sender email: l'indirizzo Gmail dedicato per intero (es. `myappmochi@gmail.com`)
   - Sender name: `Mochi`
   - Host: `smtp.gmail.com`
   - Port: `465`
   - Username: **lo stesso indirizzo Gmail per intero** (es. `myappmochi@gmail.com`), non una parola o un nome
   - Password: i 16 caratteri della password per le app
5. In Authentication > Emails > Templates incolla oggetto e HTML dei modelli qui sopra.
6. In Authentication > Rate Limits controlla il limite di email all'ora (con SMTP proprio parte basso, 30): alzalo se pensi a molte iscrizioni insieme. Gmail permette circa 500 email al giorno.

## Prova (prima di dire che è fatto)

- Crea un account di prova con un altro indirizzo: deve arrivare l'email di conferma, con il tuo mittente e il pulsante rosa.
- Controlla anche la cartella Spam. Poi prova "Password dimenticata".
- Cancella l'account di prova da Impostazioni > Elimina account.

## Se un giorno vuoi di più

Con un dominio proprio (circa 10 euro l'anno) si può usare Resend (gratis, 3000 email al mese): mittente con il tuo nome e consegna più affidabile. Cambia solo i campi SMTP al punto 4.

## Privacy

Mandando le email da Gmail, Google tratta l'indirizzo email di chi si iscrive e il testo dell'email di conferma. Aggiungilo all'informativa (privacy.html) insieme a Supabase.
