# Aggiornamenti del database

Script già lanciati sul database in uso, in ordine. Restano qui come storico.

Per un progetto nuovo non servono: basta `../schema.sql`, che li contiene tutti, più `../cron.sql`.

Un aggiornamento nuovo va lanciato nel SQL Editor **prima** di pubblicare la versione dell'app che lo usa.

Da lanciare con la versione del 4 novembre (prima di pubblicarla, in quest'ordine):
- `11-sottotask.sql`: liste da spuntare dentro le voci (colonna `sottotask` su `items`)
- `12-spese.sql`: tabelle `spese` e `spese_impostazioni`

Da lanciare con la versione "Serie di giorni + Concentrazione" (prima di pubblicarla):
- `13-giorni-attivi.sql`: tabella `giorni_attivi` (le date in cui hai spuntato qualcosa, per la serie)

Da lanciare con la versione "Spesa intelligente + Riepilogo della domenica" (prima di pubblicarla):
- `14-riepilogo.sql`: funzione `riepilogo_settimanale()`, tabella `riepilogo_inviati` e il cron `mochi-riepilogo`
  (ogni ora la domenica, UTC; manda solo quando a Roma sono le 20). Serve pg_cron attivo, come per i promemoria:
  se lo script è lanciato prima di attivarlo, rilancialo dopo (si può rilanciare).

Da lanciare con la versione "Pet" (prima di pubblicarla):
- `15-pet.sql`: tabella `pet_registro` (spunte della routine e storico dei pesi del pet, solo tue; limite 5000 righe)

Da lanciare con la versione "Più animali" (v35, prima di pubblicarla. Va lanciato INSIEME alla pubblicazione: la v34 già aperta sui telefoni non salva più peso e routine dopo lo script):
- `16-animali.sql`: tabella `pet_animali` (fino a 5 animali per persona), `animale_id` su `pet_registro`, `items` e `spese`, funzione `pet_elimina_animale`. Migra la scheda attuale in un animale e i tag della v33 in animale_id. Nessun animale "principale" salvato: il primo creato è il default. Si può rilanciare.

Da lanciare con la versione "Il ciclo dei turni può finire" (v45, prima di pubblicarla):
- `17-turni-fine.sql`: colonna `ciclo_fine` su `turni_impostazioni` (l'ultimo giorno del ciclo, vuoto = per sempre) e funzione `riepilogo_numeri()` che la rispetta. Chi ha la app vecchia aperta continua a vedere il ciclo senza fine finché non la riapre.

Da lanciare quando vuoi (limiti di sicurezza, non serve una versione nuova della app):
- `18-limiti.sql`: tetto di 20 MB per account tra testi e liste da spuntare delle voci (`items`; scatta solo quando una voce cresce, eliminare e accorciare passa sempre), routine dell'animale al massimo 4000 byte, e `elimina_il_mio_account()` non si blocca più se una voce condivisa ha un animale. Non cambia nessun dato. Si può rilanciare.

Da lanciare con la versione "Salvadanaio" (v67, prima di pubblicarla; le versioni vecchie aperte sui telefoni non lo vedono e non si rompono):
- `19-salvadanaio.sql`: tabelle `salvadanai` (mete: emoji, nome, nota, obiettivo facoltativo; al massimo 10 a persona) e `salvadanaio_mov` (registro dei versamenti e prelievi, ognuno con la sua data e ora, scelta da te e correggibile; al massimo 1000 per meta; il saldo non va sotto zero; dell'importo non si cambia niente, si toglie e si rifà). Separate dalle spese. Solo tue, nemmeno nelle liste condivise. L'eliminazione dell'account le porta via. In fondo c'è la query di controllo (ogni colonna deve valere true).

Da lanciare con la versione "Mi manchi" (v68, prima di pubblicarla; vale anche per la funzione `send-reminders` da ripubblicare):
- `20-mi-manchi.sql`: tabella `attivita_utente` (ultimo accesso, ultimo avviso, interruttore, avviso visto; una riga a persona, scritta solo con le funzioni) e le funzioni `registra_accesso`, `imposta_mi_manca`, `avviso_mi_manca_visto` (per l'app) e `mi_manca_da_inviare`, `mi_manca_segna` (solo per `send-reminders`). Notifica "la tua mascotte sente la tua mancanza": una volta per assenza di 2 giorni, alle 18:00 ora di Roma, solo a chi ha le notifiche e ha visto l'avviso; si spegne in Impostazioni. L'eliminazione dell'account porta via la riga. In fondo c'è la query di controllo (ogni colonna deve valere true).

Da lanciare quando vuoi (correzione, non serve una versione nuova della app):
- `21-eredita-voci.sql`: `elimina_il_mio_account()` ora passa a chi resta anche le voci che avevi lasciato in liste da cui eri gia' uscita/o (prima sparivano con il tuo account e chi restava le perdeva). Eredita il membro piu' anziano di ogni lista. Non controlla i tetti dell'erede (5000 voci, 20 MB): l'eliminazione non fallisce mai; l'erede, se sopra il tetto, non perde niente ma deve liberare spazio prima di aggiungere voci. Non cambia nessun dato. Si puo' rilanciare. In fondo c'e' la query di controllo (deve rispondere true, true).
