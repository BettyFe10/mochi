// Crea config.js al momento della pubblicazione, leggendo le chiavi dai Secrets di GitHub.
// Nel repository config.js resta vuoto: chi copia il progetto non trova le tue chiavi.
import { writeFileSync } from "node:fs";

const out = process.argv[2];
const env = (k) => (process.env[k] || "").trim();

const cfg = {
  SUPABASE_URL: env("SUPABASE_URL"),
  SUPABASE_ANON_KEY: env("SUPABASE_ANON_KEY"),
  VAPID_PUBLIC_KEY: env("VAPID_PUBLIC_KEY"),
  REGISTRAZIONI_APERTE: env("REGISTRAZIONI_APERTE") !== "false",
  NOME: "",
  TITOLARE_PRIVACY: env("TITOLARE_PRIVACY"),
  EMAIL_PRIVACY: env("EMAIL_PRIVACY"),
};

// Controlli: meglio fermare la pubblicazione che mettere online un'app che non si collega
const errors = [];
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(cfg.SUPABASE_URL)) errors.push("SUPABASE_URL mancante o non valido (atteso https://xxxx.supabase.co)");
if (!/^[A-Za-z0-9._-]{20,}$/.test(cfg.SUPABASE_ANON_KEY)) errors.push("SUPABASE_ANON_KEY mancante o non valida");
if (cfg.VAPID_PUBLIC_KEY && !/^[A-Za-z0-9_-]{40,}$/.test(cfg.VAPID_PUBLIC_KEY)) errors.push("VAPID_PUBLIC_KEY non valida");
if (/^sb_secret_/i.test(cfg.SUPABASE_ANON_KEY) || /service_role/i.test(Buffer.from(cfg.SUPABASE_ANON_KEY.split(".")[1] || "", "base64").toString())) {
  errors.push("ATTENZIONE: hai inserito la chiave service_role. Va usata la publishable key (sb_publishable_...) o la vecchia anon public, mai la secret key o la service_role nel sito");
}
if (errors.length) {
  console.error("Pubblicazione fermata:\n - " + errors.join("\n - "));
  process.exit(1);
}

cfg.SUPABASE_URL = cfg.SUPABASE_URL.replace(/\/$/, "");
writeFileSync(out, `// Generato automaticamente alla pubblicazione. Non modificare.\nwindow.MOCHI_CONFIG = ${JSON.stringify(cfg, null, 2)};\n`);
console.log("config.js creato ✅");
