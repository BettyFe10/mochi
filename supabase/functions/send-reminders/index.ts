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

  let sent = 0;
  async function invia(utenti: string[], payload: string) {
    for (const s of (subs ?? []).filter((x) => utenti.includes(x.user_id))) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600 });
        sent++;
      } catch (e) {
        // Iscrizione scaduta (es. app disinstallata): la rimuovo
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await sb.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
      }
    }
  }

  for (const item of due) {
    const when = item.due_time ? `alle ${item.due_time}` : "oggi";
    await invia(item.destinatari, JSON.stringify({
      id: item.id,
      title: `${KIND_EMOJI[item.kind] ?? "🍣"} ${String(item.title).slice(0, 120)}`,
      body: item.kind === "event" ? `Appuntamento ${when}. Te lo ricordo io 🌸` : `Da fare ${when}. Ce la fai! 💪`,
    }));
    await sb.from("items").update({ reminded: true }).eq("id", item.id);
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

  return Response.json({ sent, items: due.length, attivita: attivita.length, ricorrenti: ricorrenti.length });
});
