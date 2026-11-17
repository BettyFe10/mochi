// Edge Function "send-reminders"
// Viene chiamata ogni minuto da pg_cron: cerca i promemoria scaduti e li invia come notifiche push.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
// Chiave server: quella nuova (sb_secret_ "default") se c'è, altrimenti la vecchia service_role.
// Resta solo dentro la funzione, non arriva mai al browser.
function serverKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    if (typeof keys.default === "string" && keys.default) return keys.default;
  } catch { /* formato inatteso: uso la chiave vecchia */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}
const SERVICE_ROLE = serverKey();
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:mochi@example.com";
const CRON_SECRET = Deno.env.get("CRON_SECRET")!;

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

// Confronto a tempo costante: non rivela il segreto un carattere alla volta
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// --- inizio helper (provati da ~/Desktop/mochi-test/t_v66_reminders.mjs)
type Esito = { ok: number; passeggeri: number };
// Una notifica: se il servizio push risponde con un errore passeggero (rete, 429, 5xx) riprovo una volta dopo un secondo
async function mandaConRetry(invio: () => Promise<unknown>, pausa = 1000, puoiRiprovare = true): Promise<"ok" | "scaduta" | "passeggero" | "rifiutata"> {
  for (let tentativo = 0; tentativo < 2; tentativo++) {
    try { await invio(); return "ok"; }
    catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) return "scaduta";
      const passeggero = code === undefined || code === 429 || code >= 500;
      if (!passeggero) return "rifiutata"; // 400/401/403/413: riprovare non cambia nulla
      if (!puoiRiprovare) return "passeggero"; // giro quasi al limite di tempo: niente attese, ci pensa il giro dopo
      if (tentativo === 0) await new Promise((r) => setTimeout(r, pausa));
    }
  }
  return "passeggero";
}
// Il promemoria si segna "inviato" solo se è arrivato ad almeno un dispositivo oppure non c'è modo di consegnarlo
// (nessuna iscrizione, iscrizioni scadute o rifiutate). Con soli errori passeggeri resta da inviare: il giro dopo (ogni minuto)
// riprova, e il database lo scarta da solo dopo 2 ore.
function daSegnareInviato(e: Esito) { return e.ok > 0 || e.passeggeri === 0; }
// --- fine helper

const KIND_EMOJI: Record<string, string> = { todo: "✅", event: "📅", note: "📝" };

Deno.serve(async (req) => {
  // Solo il cron (che conosce il segreto) può far partire l'invio
  const given = req.headers.get("x-cron-secret") ?? "";
  if (!CRON_SECRET || CRON_SECRET.length < 24 || !safeEqual(given, CRON_SECRET)) {
    return new Response("Non autorizzato", { status: 401 });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Promemoria scaduti (coda equa calcolata dal database). Con le liste condivise
  // ogni promemoria va a tutte le persone della lista ("destinatari").
  let { data: due, error } = await sb.rpc("promemoria_da_inviare_v2");
  if (error && /promemoria_da_inviare_v2/.test(error.message)) {
    // database non ancora aggiornato con le liste: uso la versione di prima
    ({ data: due, error } = await sb.rpc("promemoria_da_inviare"));
  }
  if (error) return new Response(error.message, { status: 500 });
  due = (due ?? []).map((d: Record<string, unknown>) => ({ ...d, destinatari: (d.destinatari as string[]) ?? [d.user_id as string] }));

  // Notifiche di attività nelle liste condivise ("Giulia ha aggiunto...", "Giulia ha fatto...")
  const { data: att } = await sb.rpc("notifiche_da_inviare");
  const attivita = (att ?? []) as { destinatario: string; titolo: string; corpo: string; item_id: string | null }[];

  // Promemoria ricorrenti ("bevi acqua ogni 2 ore"): il database dice quali tocca adesso e calcola già il prossimo
  const { data: ric } = await sb.rpc("ricorrenti_da_inviare");
  const ricorrenti = (ric ?? []) as { id: string; user_id: string; titolo: string; emoji: string; ogni_minuti: number }[];

  if (!due.length && !attivita.length && !ricorrenti.length) return Response.json({ sent: 0 });

  const userIds = [...new Set([...due.flatMap((d: { destinatari: string[] }) => d.destinatari), ...attivita.map((a) => a.destinatario), ...ricorrenti.map((r) => r.user_id)])];
  const { data: subs } = await sb.from("push_subscriptions").select("*").in("user_id", userIds);

  const inizio = Date.now(); // il giro dura al massimo un minuto: dopo 30 secondi non faccio più attese per i nuovi tentativi
  let sent = 0, ritentati = 0;
  async function invia(utenti: string[], payload: string): Promise<Esito> {
    const esito: Esito = { ok: 0, passeggeri: 0 };
    for (const s of (subs ?? []).filter((x) => utenti.includes(x.user_id))) {
      const r = await mandaConRetry(() => webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600 }), 1000, Date.now() - inizio < 30000);
      if (r === "ok") { sent++; esito.ok++; }
      else if (r === "passeggero") esito.passeggeri++;
      // Iscrizione scaduta (es. app disinstallata): la rimuovo
      else if (r === "scaduta") await sb.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
    }
    return esito;
  }

  for (const item of due) {
    const when = item.due_time ? `alle ${item.due_time}` : "oggi";
    const esito = await invia(item.destinatari, JSON.stringify({
      id: item.id,
      title: `${KIND_EMOJI[item.kind] ?? "🍣"} ${String(item.title).slice(0, 120)}`,
      body: item.kind === "event" ? `Appuntamento ${when}. Te lo ricordo io 🌸` : `Da fare ${when}. Ce la fai! 💪`,
    }));
    if (daSegnareInviato(esito)) await sb.from("items").update({ reminded: true }).eq("id", item.id);
    else ritentati++; // errore passeggero del servizio push: lo riprovo al giro dopo
  }

  for (const a of attivita) {
    await invia([a.destinatario], JSON.stringify({
      id: a.item_id ? `att-${a.item_id}` : undefined,
      title: a.titolo.slice(0, 80),
      body: a.corpo.slice(0, 200),
    }));
  }

  for (const r of ricorrenti) {
    const ogni = r.ogni_minuti >= 1440 ? "ogni giorno" : r.ogni_minuti % 60 === 0 ? `ogni ${r.ogni_minuti / 60 === 1 ? "ora" : `${r.ogni_minuti / 60} ore`}` : `ogni ${r.ogni_minuti} minuti`;
    await invia([r.user_id], JSON.stringify({
      id: `ric-${r.id}`,   // stessa etichetta: la nuova sostituisce la vecchia invece di accumularsi
      title: `${r.emoji} ${r.titolo}`.slice(0, 90),
      body: `Promemoria ricorrente, ${ogni} 🌸`,
    }));
  }

  return Response.json({ sent, ritentati, items: due.length, attivita: attivita.length, ricorrenti: ricorrenti.length });
});
