# Aggiornamenti del database

Script già lanciati sul database in uso, in ordine. Restano qui come storico.

Per un progetto nuovo non servono: basta `../schema.sql`, che li contiene tutti, più `../cron.sql`.

Un aggiornamento nuovo va lanciato nel SQL Editor **prima** di pubblicare la versione dell'app che lo usa.

Da lanciare con la versione del 4 novembre (prima di pubblicarla, in quest'ordine):
- `11-sottotask.sql`: liste da spuntare dentro le voci (colonna `sottotask` su `items`)
- `12-spese.sql`: tabelle `spese` e `spese_impostazioni`

Da lanciare con la versione "Serie di giorni + Concentrazione" (prima di pubblicarla):
- `13-giorni-attivi.sql`: tabella `giorni_attivi` (le date in cui hai spuntato qualcosa, per la serie)
