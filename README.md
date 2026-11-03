# Mochi 🍡

Un'app per le cose da fare, gli appuntamenti e gli appunti, con una mascotte che ti tiene compagnia.
Funziona nel browser e si installa sulla Home dell'iPhone o nel Dock del Mac.

Cosa c'è dentro:
- cose da fare, appuntamenti e post-it su una bacheca di sughero
- si scrive come si parla: `dentista domani alle 17`, `riunione venerdì 10:30 #lavoro`
- promemoria push anche ad app chiusa, e promemoria ricorrenti (bevi acqua ogni 2 ore...)
- liste condivise con altre persone, tramite un codice d'invito
- turni di lavoro con ciclo che si ripete e ore del mese
- com'è andata la giornata, con il giardino del mese
- recap mensile, biscotto della fortuna, 15 mascotte, colori, caratteri e due stili (Morbido e Quaderno)
- funziona anche offline

Ognuno vede solo i propri dati. Costa 0 €: GitHub Pages più il piano gratuito di Supabase.

## Com'è fatta

```
index.html      la pagina (stili compresi)
app.js          tutta l'app
mascotte.js     le mascotte animate
frasi.js        le frasi del giorno
sw.js           offline e notifiche
privacy.html    informativa
config.js       vuoto nel repository: le chiavi arrivano dalla pubblicazione
vendor/         libreria Supabase e caratteri, inclusi (niente CDN)
icons/          icone per Home e Dock, una per mascotte
supabase/
  schema.sql      tutto il database: tabelle, regole di accesso, funzioni
  cron.sql        invio dei promemoria e pulizia notturna
  functions/      la funzione che manda le notifiche
  aggiornamenti/  gli script già lanciati sul database in uso, in ordine
native/         app SwiftUI per iPhone e Mac (prima versione, indietro rispetto alla web app)
```

Senza chiavi in `config.js` l'app parte in modalità prova e salva tutto nel browser: basta aprire `index.html`.

## Messa in funzione

**Supabase**
1. Nuovo progetto, regione Central EU (Frankfurt).
2. SQL Editor: incolla `supabase/schema.sql` e premi Run.
3. Authentication → Email: conferma email attiva, password di almeno 8 caratteri.
4. Authentication → URL Configuration: Site URL e Redirect URL con l'indirizzo dell'app.
5. Per più di 2-3 persone serve un servizio email vero (es. Resend) in Authentication → Emails → SMTP: quello incluso ne manda pochissime.
6. Solo il tuo sito può usare il database:
   ```sql
   insert into public.origini_consentite values ('https://<utente>.github.io');
   ```

**Pubblicazione**
Le chiavi non stanno nel repository. Vanno in Settings → Secrets and variables → Actions:
`SUPABASE_URL`, `SUPABASE_ANON_KEY` (mai la service_role), `VAPID_PUBLIC_KEY`, `TITOLARE_PRIVACY`, `EMAIL_PRIVACY`.
Poi Settings → Pages → Source: GitHub Actions. Ogni push su `main` ripubblica il sito.

**Notifiche**
```bash
npx web-push generate-vapid-keys
supabase functions deploy send-reminders --no-verify-jwt
supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:... CRON_SECRET=...
```
`CRON_SECRET` di almeno 24 caratteri. Poi abilita pg_cron e pg_net e lancia `supabase/cron.sql` con i tuoi valori.

## Aggiornare

- Se una modifica tocca il database, lo script va lanciato **prima** del push. Poi si copia in `supabase/aggiornamenti/` e si aggiunge in fondo a `schema.sql`.
- Ad ogni versione alza `CACHE` in `sw.js`, così i telefoni scaricano i file nuovi.
- Le novità da mostrare a chi riapre l'app sono in `NOVITA`, dentro `app.js`.

## Privacy

Con altri utenti sei titolare del trattamento. Chi gestisce il progetto Supabase può vedere i dati di tutti, quindi attiva la verifica in due passaggi su Supabase e su GitHub. Il piano gratuito non fa backup scaricabili: ognuno può scaricare i propri dati dalle Impostazioni.
