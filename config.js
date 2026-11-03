// Configurazione di Mochi.
// Lasciando vuoti i campi Supabase l'app funziona in "modalità prova": i dati restano solo su questo dispositivo.
// Compilali con i valori del progetto Supabase (Project Settings > API) per attivare account e sincronizzazione.
window.MOCHI_CONFIG = {
  SUPABASE_URL: "",             // es. "https://abcdefgh.supabase.co"
  SUPABASE_ANON_KEY: "",        // chiave "anon public": è pensata per stare nel browser, la protezione la fa la Row Level Security
  VAPID_PUBLIC_KEY: "",         // chiave pubblica per le notifiche push (vedi README)
  REGISTRAZIONI_APERTE: true,   // false = nasconde "Crea account" (va chiusa anche su Supabase, vedi README)
  NOME: "Federica",             // usato solo in modalità prova; con gli account ognuno ha il suo nome
  TITOLARE_PRIVACY: "",         // nome e cognome di chi gestisce l'app, mostrato nell'informativa
  EMAIL_PRIVACY: ""             // email di contatto per richieste privacy
};
