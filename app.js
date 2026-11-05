/* =========================================================
   MOCHI - app personale per cose da fare, appuntamenti e appunti
   ========================================================= */
const CFG = window.MOCHI_CONFIG || {};
const SIGNUP_OPEN = CFG.REGISTRAZIONI_APERTE !== false;
const ONLINE_MODE = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);
// Le notifiche push si attivano solo quando è configurata la chiave pubblica VAPID
const PUSH_READY = ONLINE_MODE && !!CFG.VAPID_PUBLIC_KEY;
let NOME = ONLINE_MODE ? "" : (CFG.NOME || "");
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now() + "-" + Math.random().toString(16).slice(2));
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};

/* ---------------- date ---------------- */
const MESI = ["gennaio","febbraio","marzo","aprile","maggio","giugno","luglio","agosto","settembre","ottobre","novembre","dicembre"];
const GIORNI = ["domenica","lunedì","martedì","mercoledì","giovedì","venerdì","sabato"];
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const todayStr = () => ymd(new Date());
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
function niceDate(s) {
  if (!s) return "";
  const t = todayStr();
  if (s === t) return "Oggi";
  if (s === ymd(addDays(new Date(), 1))) return "Domani";
  if (s === ymd(addDays(new Date(), -1))) return "Ieri";
  const d = parseYmd(s);
  const diff = Math.round((d - parseYmd(t)) / 864e5);
  if (diff > 1 && diff < 7) return GIORNI[d.getDay()].replace(/^./, (c) => c.toUpperCase());
  const y = d.getFullYear() !== new Date().getFullYear() ? " " + d.getFullYear() : "";
  return `${d.getDate()} ${MESI[d.getMonth()].slice(0, 3)}${y}`;
}
const dueDateTime = (it) => it.due_date ? new Date(`${it.due_date}T${it.due_time || "23:59"}:00`) : null;
const isLate = (it) => it.kind === "todo" && !it.done && it.due_date && dueDateTime(it) < new Date();

/* -------- interpretazione del testo rapido ("dentista domani alle 15 #lavoro") -------- */
// Restituisce la data solo se esiste davvero (niente 31 febbraio che diventa 3 marzo)
function realDate(y, m, d) {
  const x = new Date(y, m, d);
  return x.getDate() === d && y >= 2000 && y <= 2100 ? x : null;
}
function parseQuick(raw) {
  let text = " " + String(raw).slice(0, 300) + " ";
  let date = null, time = null, area = null;
  const now = new Date();
  const take = (re, fn) => { const m = text.match(re); if (m) { fn(m); text = text.replace(m[0], " "); } };

  take(/\s#(lavoro|work|ufficio)\b/i, () => area = "lavoro");
  take(/\s#(personale|casa|me)\b/i, () => area = "personale");

  // ora: "alle 15", "alle 15:30", "ore 9", "h 9.30", "15:30"
  const okTime = (hh, mm) => +hh < 24 && +mm < 60;
  take(/\s(?:alle|all'|ore|h)\s?(\d{1,2})(?:[:.](\d{2}))?\b/i, (m) => { if (okTime(m[1], m[2] || 0)) time = `${pad(+m[1])}:${m[2] || "00"}`; });
  if (!time) take(/\s(\d{1,2})[:.](\d{2})\b/, (m) => { if (okTime(m[1], m[2])) time = `${pad(+m[1])}:${m[2]}`; });
  take(/\sstasera\b/i, () => { date = new Date(now); if (!time) time = "20:00"; });
  take(/\sstamattina\b/i, () => { date = new Date(now); if (!time) time = "09:00"; });

  take(/\sdopodomani\b/i, () => date = addDays(now, 2));
  take(/\sdomani\b/i, () => date = addDays(now, 1));
  take(/\soggi\b/i, () => date = new Date(now));
  take(/\stra\s(\d{1,2})\s(giorni|giorno|settimane|settimana)\b/i, (m) => date = addDays(now, +m[1] * (/settiman/i.test(m[2]) ? 7 : 1)));

  // giorno della settimana: "lunedì", "venerdi", "sab"
  const wd = [["dom", 0], ["lun", 1], ["mar(?!zo)", 2], ["mer", 3], ["gio", 4], ["ven", 5], ["sab", 6]];
  if (!date) for (const [k, n] of wd) {
    const re = new RegExp("\\s(?:il\\s|la\\s|prossim[oa]\\s)?(" + k + "[a-zìí']*)(?=\\s)", "i");
    const m = text.match(re);
    if (m && /^(dom(enica)?|lun(ed[iì])?|mar(ted[iì])?|mer(coled[iì])?|gio(ved[iì])?|ven(erd[iì])?|sab(ato)?)$/i.test(m[1])) {
      let diff = (n - now.getDay() + 7) % 7; if (diff === 0) diff = 7;
      date = addDays(now, diff); text = text.replace(m[0], " "); break;
    }
  }
  // "12/11", "12/11/2026", "12-11"
  if (!date) take(/\s(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/, (m) => {
    let y = m[3] ? +m[3] : now.getFullYear(); if (y < 100) y += 2000;
    date = realDate(y, +m[2] - 1, +m[1]);
    if (date && !m[3] && date < addDays(now, -1)) date = realDate(y + 1, +m[2] - 1, +m[1]);
  });
  // "12 novembre", "il 3 dic"
  if (!date) take(new RegExp("\\s(?:il\\s)?(\\d{1,2})\\s(" + MESI.map((x) => x.slice(0, 3)).join("|") + ")[a-z]*\\b", "i"), (m) => {
    const mi = MESI.findIndex((x) => x.startsWith(m[2].toLowerCase()));
    date = realDate(now.getFullYear(), mi, +m[1]);
    if (date && date < addDays(now, -1)) date = realDate(now.getFullYear() + 1, mi, +m[1]);
  });
  // "il 12" (giorno del mese)
  if (!date) take(/\s(?:il|l')\s?(\d{1,2})\b(?!\s*[:.])/i, (m) => {
    const d = +m[1]; if (d >= 1 && d <= 31) {
      date = realDate(now.getFullYear(), now.getMonth(), d);
      if (!date || date < addDays(now, -1)) date = realDate(now.getFullYear(), now.getMonth() + 1, d) || realDate(now.getFullYear(), now.getMonth() + 2, d);
    }
  });
  if (time && !date) { date = new Date(now); const [h, mi] = time.split(":").map(Number); if (h * 60 + mi < now.getHours() * 60 + now.getMinutes()) date = addDays(now, 1); }

  const title = text.replace(/\s+/g, " ").trim().replace(/\s(alle|ore|il|la|per)$/i, "").replace(/^./, (c) => c.toUpperCase());
  return { title, date: date ? ymd(date) : null, time, area };
}

/* ---------------- promemoria ---------------- */
const REMIND_OPTS = [
  ["none", "Nessun promemoria"], ["0", "All'ora indicata"], ["10", "10 minuti prima"],
  ["30", "30 minuti prima"], ["60", "1 ora prima"], ["1440", "Il giorno prima"], ["morning", "Alle 9 del giorno stesso"]
];
// Promemoria proposto: appuntamento con ora = 30 minuti prima, cosa da fare con ora = all'ora, solo giorno = alle 9
function defaultRemind(it) {
  return it.due_date ? (it.due_time ? (it.kind === "event" ? "30" : "0") : "morning") : "none";
}
function computeRemind(it) {
  if (!it.remind || it.remind === "none" || !it.due_date) return null;
  if (it.remind === "morning") return new Date(`${it.due_date}T09:00:00`).toISOString();
  const base = new Date(`${it.due_date}T${it.due_time || "09:00"}:00`);
  return new Date(base.getTime() - Number(it.remind) * 60000).toISOString();
}

/* -------- difesa: ogni voce viene ripulita prima di essere usata -------- */
const RE_DATE = /^\d{4}-\d{2}-\d{2}$/, RE_TIME = /^([01]\d|2[0-3]):[0-5]\d$/, RE_ID = /^[A-Za-z0-9-]{1,64}$/;
const REMIND_VALUES = ["none", "auto", "0", "10", "30", "60", "1440", "morning"];
const isIso = (s) => typeof s === "string" && !isNaN(Date.parse(s));
const str = (v) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const validYmd = (s) => typeof s === "string" && RE_DATE.test(s) && !!realDate(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
// Taglia un testo senza spezzare le emoji (una emoja a metà fa rifiutare tutto il salvataggio dal database)
const taglia = (v, n) => { const a = [...str(v)]; return a.length > n ? a.slice(0, n).join("") : str(v); };
/* Lista da spuntare dentro una voce (sottotask): al massimo 50, testo fino a 120 caratteri.
   Formato: [{ id, t: testo, f: fatto }] - lo stesso controllato dal database (sottotask_ok). */
const MAX_ST = 50, RE_STID = /^[A-Za-z0-9-]{1,40}$/;
const nuovoStId = (visti) => { let id; do id = Math.random().toString(36).slice(2, 10); while (!RE_STID.test(id) || visti?.has(id)); return id; };
function cleanSottotask(a) {
  if (!Array.isArray(a)) return [];
  const out = [], visti = new Set();
  for (const x of a) {
    if (!x || typeof x !== "object") continue;
    const t = taglia(str(x.t).replace(/\s+/g, " ").trim(), 120);
    if (!t) continue;
    let id = typeof x.id === "string" && RE_STID.test(x.id) ? x.id : null;
    if (!id || visti.has(id)) id = nuovoStId(visti);
    visti.add(id); out.push({ id, t, f: x.f === true });
    if (out.length >= MAX_ST) break;
  }
  return out;
}
function normalize(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.id === "string" && RE_ID.test(raw.id) ? raw.id : null;
  if (!id) return null;
  const date = validYmd(raw.due_date) ? raw.due_date : null;
  return {
    id,
    kind: ["todo", "event", "note"].includes(raw.kind) ? raw.kind : "todo",
    title: str(raw.title).slice(0, 300) || "(senza titolo)",
    body: str(raw.body).slice(0, 20000),
    area: raw.area === "lavoro" ? "lavoro" : "personale",
    due_date: date,
    due_time: date && typeof raw.due_time === "string" && RE_TIME.test(raw.due_time) ? raw.due_time : null,
    remind: REMIND_VALUES.includes(String(raw.remind)) ? String(raw.remind) : "none",
    remind_at: isIso(raw.remind_at) ? raw.remind_at : null,
    reminded: raw.reminded === true,
    done: raw.done === true,
    done_at: isIso(raw.done_at) ? raw.done_at : null,
    color: Math.min(12, Math.max(1, parseInt(raw.color, 10) || 1)),
    pinned: raw.pinned === true,
    posizione: Number.isFinite(raw.posizione) && Math.abs(raw.posizione) < 1e15 ? raw.posizione : null,
    lista_id: typeof raw.lista_id === "string" && RE_ID.test(raw.lista_id) ? raw.lista_id : null,
    sottotask: cleanSottotask(raw.sottotask),
    user_id: typeof raw.user_id === "string" && RE_ID.test(raw.user_id) ? raw.user_id : null,
    done_by: typeof raw.done_by === "string" && RE_ID.test(raw.done_by) ? raw.done_by : null,
    created_at: isIso(raw.created_at) ? raw.created_at : new Date().toISOString(),
    updated_at: isIso(raw.updated_at) ? raw.updated_at : new Date().toISOString()
  };
}
const normalizeAll = (arr) => (Array.isArray(arr) ? arr : []).map(normalize).filter(Boolean).slice(0, 5000);

/* =========================================================
   ARCHIVIO DATI
   Locale (modalità prova) oppure Supabase (login + sync)
   ========================================================= */
const LocalStore = {
  mode: "local",
  async init() { return true; },
  async list() { return normalizeAll(LS.get("mochi.items", [])); },
  async save(it) { const all = LS.get("mochi.items", []); const i = all.findIndex((x) => x.id === it.id); i >= 0 ? (all[i] = it) : all.push(it); LS.set("mochi.items", all); },
  async remove(id) { LS.set("mochi.items", LS.get("mochi.items", []).filter((x) => x.id !== id)); },
  subscribe() {}
};

const SupaStore = {
  mode: "online", sb: null, user: null,
  loadLib() {
    return new Promise((res, rej) => {
      if (window.supabase) return res();
      const s = document.createElement("script");
      s.src = "vendor/supabase-2.118.0.js";
      s.onload = res; s.onerror = () => rej(new Error("Impossibile caricare Supabase"));
      document.head.appendChild(s);
    });
  },
  async init() {
    await this.loadLib();
    this.sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
    // Link di recupero password: Supabase apre la sessione e segnala PASSWORD_RECOVERY
    this.sb.auth.onAuthStateChange((ev) => { if (ev === "PASSWORD_RECOVERY") setLoginMode("newpass"); });
    const { data } = await this.sb.auth.getSession();
    this.user = data.session?.user || null;
    this.applyName();
    return !!this.user && !/type=recovery/.test(location.hash);
  },
  applyName() {
    const md = this.user?.user_metadata || {};
    NOME = md.nome || "";
    if (md.nome_app || md.mascotte || md.accessorio || md.colore || md.font || md.stile || md.moduli || md.stagione || md.suono) {
      // le preferenze nuove (moduli, stagione, suono) che l'account non ha ancora restano quelle di questo dispositivo
      CUSTOM = cleanCustom({ nome_app: md.nome_app, mascotte: md.mascotte, accessorio: md.accessorio, colore: md.colore, font: md.font, stile: md.stile,
        moduli: md.moduli ?? CUSTOM.moduli, stagione: md.stagione ?? CUSTOM.stagione, suono: md.suono ?? CUSTOM.suono });
      LS.set("mochi.custom", CUSTOM); applyCustom();
    }
  },
  async saveCustom(c) { const { data, error } = await this.sb.auth.updateUser({ data: { nome_app: c.nome_app, mascotte: c.mascotte, accessorio: c.accessorio, colore: c.colore, font: c.font, stile: c.stile, moduli: c.moduli, stagione: c.stagione, suono: c.suono } }); if (error) throw error; this.user = data.user; },
  get redirect() { return location.origin + location.pathname; },
  async login(email, password) {
    const { data, error } = await this.sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    this.user = data.user; this.applyName();
  },
  async signup(nome, email, password) {
    const { data, error } = await this.sb.auth.signUp({ email, password, options: { data: { nome }, emailRedirectTo: this.redirect } });
    if (error) throw error;
    if (data.session) { this.user = data.user; this.applyName(); return "logged"; }
    return "confirm";
  },
  async forgot(email) {
    const { error } = await this.sb.auth.resetPasswordForEmail(email, { redirectTo: this.redirect });
    if (error) throw error;
  },
  async newPassword(password) {
    const { data, error } = await this.sb.auth.updateUser({ password });
    if (error) throw error;
    this.user = data.user; this.applyName();
  },
  async setName(nome) {
    const { data, error } = await this.sb.auth.updateUser({ data: { nome } });
    if (error) throw error;
    this.user = data.user; NOME = nome;
  },
  async deleteAccount() {
    const { error } = await this.sb.rpc("elimina_il_mio_account");
    if (error) throw error;
    await this.sb.auth.signOut({ scope: "local" });
  },
  // All'uscita il dispositivo smette di ricevere i promemoria di questo account
  async dropPush() {
    try {
      const reg = await navigator.serviceWorker?.ready;
      const sub = await reg?.pushManager?.getSubscription();
      if (sub) { await this.sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint); await sub.unsubscribe(); }
    } catch {}
  },
  async logout() { await this.dropPush(); await this.sb.auth.signOut(); this.user = null; },
  // Gli item vengono tenuti anche in cache locale: l'app si apre subito e funziona offline
  async list() {
    const cached = LS.get("mochi.cache", []);
    try {
      await this.flush();
      const { data, error } = await this.sb.from("items").select("*").order("created_at");
      if (error) throw error;
      const clean = normalizeAll(data);
      LS.set("mochi.cache", clean);
      setSync(true);
      return clean;
    } catch (e) { setSync(false); return normalizeAll(cached); }
  },
  // noSub: il database non ha ancora la colonna "sottotask" (aggiornamento 11 non lanciato): si salva senza, così il resto funziona
  noSub: false,
  clean(it) {
    const { id, kind, title, body, area, due_date, due_time, remind, remind_at, reminded, done, done_at, color, pinned, created_at, updated_at, lista_id, posizione } = it;
    const row = { id, kind, title, body, area, due_date, due_time, remind, remind_at, reminded, done, done_at, color, pinned, created_at, updated_at, lista_id: lista_id || null, posizione: Number.isFinite(posizione) ? posizione : null };
    if (!this.noSub) { const st = cleanSottotask(it.sottotask); row.sottotask = st.length ? st : null; }
    return row;
  },
  // solo l'errore "colonna mancante" (non le altre, es. il controllo items_sottotask_ok che rifiuta un dato sbagliato)
  manca(error) { const m = String(error?.message || ""); if (!this.noSub && /sottotask/i.test(m) && /schema cache|column .*does not exist|could not find/i.test(m)) { this.noSub = true; return true; } return false; },
  queue(op) { const q = LS.get("mochi.outbox", []); q.push(op); LS.set("mochi.outbox", q); },
  async flush() {
    const q = LS.get("mochi.outbox", []); if (!q.length) return;
    const rest = [];
    for (const op of q) {
      try {
        if (op.t === "save" && this.noSub) delete op.it.sottotask;
        let r = op.t === "save" ? await this.sb.from("items").upsert(op.it) : await this.sb.from("items").delete().eq("id", op.id);
        if (r.error && op.t === "save" && this.manca(r.error)) { delete op.it.sottotask; r = await this.sb.from("items").upsert(op.it); }
        if (r.error) throw r.error;
      } catch { rest.push(op); }
    }
    LS.set("mochi.outbox", rest);
  },
  async save(it) {
    const row = this.clean(it);
    LS.set("mochi.cache", state.items);
    const { error } = await this.sb.from("items").upsert(row).then((r) => r, (e) => ({ error: { network: true, message: String(e) } }));
    if (!error) { setSync(true); return; }
    if (this.manca(error)) return this.save(it);
    // errore di rete: riprova più tardi. Errore del server (limite, dato non valido): non insistere
    if (error.network || /fetch|network|Failed/i.test(error.message || "")) { this.queue({ t: "save", it: row }); setSync(false); }
    else {
      toast(/limite/i.test(error.message) ? "Hai raggiunto il limite di voci 🍱" : /row-level|policy/i.test(error.message) ? "Non hai più accesso a quella lista" : "Non sono riuscita a salvare");
      // riallineo con quello che c'è davvero sul server
      setTimeout(() => loadAndRender(), 400);
    }
  },
  async remove(id) {
    LS.set("mochi.cache", state.items);
    try { const { error } = await this.sb.from("items").delete().eq("id", id); if (error) throw error; }
    catch { this.queue({ t: "del", id }); setSync(false); }
  },
  subscribe(cb) {
    this.sb.channel("items-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "items" }, (p) => cb(p))
      .subscribe();
  },
  // Promemoria ricorrenti: ognuno vede solo i suoi; il prossimo invio lo calcola il database
  async ricorrenti() { const { data, error } = await this.sb.from("ricorrenti").select("*").order("created_at"); if (error) throw error; return data || []; },
  async salvaRicorrente(r) {
    const row = { titolo: r.titolo, emoji: r.emoji, ogni_minuti: r.ogni_minuti, dalle: r.dalle, alle: r.alle, giorni: r.giorni, fuso: r.fuso, attiva: r.attiva };
    const q = r.id ? this.sb.from("ricorrenti").update(row).eq("id", r.id) : this.sb.from("ricorrenti").insert(row);
    const { error } = await q; if (error) throw error;
  },
  async eliminaRicorrente(id) { const { error } = await this.sb.from("ricorrenti").delete().eq("id", id); if (error) throw error; },
  // Liste condivise: tutte le regole (chi vede cosa, inviti, limiti) le fa rispettare il database
  async liste() { const { data, error } = await this.sb.rpc("le_mie_liste"); if (error) throw error; return data || []; },
  async creaLista(nome, emoji) { const { data, error } = await this.sb.rpc("crea_lista", { p_nome: nome, p_emoji: emoji }); if (error) throw error; return data; },
  async modificaLista(id, nome, emoji) { const { error } = await this.sb.rpc("modifica_lista", { p_lista: id, p_nome: nome, p_emoji: emoji }); if (error) throw error; },
  async creaInvito(id) { const { data, error } = await this.sb.rpc("crea_invito", { p_lista: id }); if (error) throw error; return data; },
  async anteprimaInvito(c) { const { data, error } = await this.sb.rpc("anteprima_invito", { p_codice: c }); if (error) throw error; return (data || [])[0] || null; },
  async accettaInvito(c) { const { data, error } = await this.sb.rpc("accetta_invito", { p_codice: c }); if (error) throw error; return data; },
  async esciLista(id) { const { error } = await this.sb.rpc("esci_dalla_lista", { p_lista: id }); if (error) throw error; },
  async eliminaLista(id) { const { error } = await this.sb.rpc("elimina_lista", { p_lista: id }); if (error) throw error; },
  // Pannello messaggi: il database decide chi è amministratrice, l'app si limita a chiedere
  async isAdmin() { const { data, error } = await this.sb.rpc("sono_amministratrice"); return !error && data === true; },
  async readConsigli() { const { data, error } = await this.sb.rpc("leggi_consigli"); if (error) throw error; return data || []; },
  async rispondiConsiglio(id, stato, risposta) { const { error } = await this.sb.rpc("rispondi_consiglio", { p_id: id, p_stato: stato, p_risposta: risposta || null }); if (error) throw error; },
  async mieiConsigli() { const { data, error } = await this.sb.rpc("miei_consigli"); if (error) throw error; return data || []; },
  async risposteViste() { const { error } = await this.sb.rpc("risposte_viste"); if (error) throw error; },
  async markConsiglio(id, letto) { const { error } = await this.sb.rpc("segna_consiglio", { p_id: id, p_letto: letto }); if (error) throw error; },
  async sendConsiglio(tipo, testo) {
    const { error } = await this.sb.rpc("invia_consiglio", { p_tipo: tipo, p_testo: testo, p_dispositivo: dispositivo() });
    if (error) throw error;
  },
  async savePush(sub) {
    const j = sub.toJSON();
    const { error } = await this.sb.rpc("registra_dispositivo", { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
    if (error) throw error;
  }
};

const store = ONLINE_MODE ? SupaStore : LocalStore;

/* =========================================================
   PERSONALIZZAZIONE: nome dell'app e mascotte
   ========================================================= */
const MASC = window.MOCHI_MASCOTTE;
// Regali della mascotte (vedi "Il pancino" più sotto)
const TRAGUARDI = [
  { id: "fiocco", n: 5, e: "🎀", nome: "Fiocco" },
  { id: "fiore", n: 15, e: "🌸", nome: "Fiorellino" },
  { id: "cappello", n: 30, e: "👒", nome: "Cappellino" },
  { id: "stella", n: 60, e: "⭐", nome: "Stellina" },
  { id: "corona", n: 100, e: "👑", nome: "Corona" },
  { id: "arcobaleno", n: 200, e: "🌈", nome: "Arcobaleno" }
];
// Temi di colore: [id, nome, colore chiaro, colore scuro] (i colori veri sono nel CSS di index.html)
const PALETTE = [
  ["fragola", "Fragola", "#ff8fb1", "#e85d8a", "🍓"], ["matcha", "Matcha", "#7cc79a", "#3f9a6b", "🍵"],
  ["lavanda", "Lavanda", "#b69cff", "#7a5fd6", "🪻"], ["pesca", "Pesca", "#ffab7a", "#e0703f", "🍑"], ["cielo", "Cielo", "#7cc0f0", "#3a86c8", "☁️"]
];
// Caratteri: [id, nome, famiglia per l'anteprima] (i font sono in vendor/fonts, nessuna richiesta esterna)
const FONTI = [
  ["morbido", "Dello stile", "'Patrick Hand', Fredoka, sans-serif"], ["tondo", "Tondo", "Quicksand, sans-serif"],
  ["mano", "A mano", "'Patrick Hand', sans-serif"], ["pastello", "Pastello", "Comfortaa, sans-serif"],
  ["leggibile", "Leggibile", "'Atkinson Hyperlegible', sans-serif"], ["sistema", "Classico", "-apple-system, BlinkMacSystemFont, system-ui, sans-serif"]
];
// Stili: cambiano l'aspetto di tutta l'app (i colori restano quelli scelti a parte)
const STILI = [
  ["morbido", "Morbido", "Tondo e soffice, con sfumature e ombre leggere"],
  ["quaderno", "Quaderno", "Carta puntinata, titoli a mano, etichette di carta"]
];
/* Cosa vuoi usare: ogni parte dell'app si può spegnere (Impostazioni). Spegnere nasconde, non cancella i dati.
   [id, emoji, nome, descrizione, acceso all'inizio, solo con account] */
const MODULI = [
  ["turni", "💼", "Turni di lavoro", "Calendario dei turni e ore del mese", true],
  ["spese", "👛", "Spese", "Quanto spendi ogni mese, con il budget", true],
  ["umore", "🌷", "Com'è andata la giornata", "Faccine nel calendario e giardino del mese", true],
  ["ricorrenti", "🔁", "Promemoria ricorrenti", "Bevi acqua, fai una pausa...", true, true],
  ["liste", "👭", "Liste condivise", "Liste da usare insieme ad altre persone", true, true],
  ["biscotto", "🥠", "Biscotto della fortuna", "Una frase da aprire ogni mattina", true],
  ["pancino", "🍣", "Il pancino", "La mascotte mangia le cose che fai e riceve regali", true],
  ["stagioni", "❄️", "Stagioni", "Neve, pioggia, sole o foglie sullo sfondo", false]
];
// Effetto delle stagioni: "auto" segue il calendario, gli altri sono fissi
const STAGIONI = [["auto", "🗓️", "Segue la stagione"], ["neve", "❄️", "Neve"], ["pioggia", "🌧️", "Pioggia"], ["sole", "☀️", "Sole"], ["foglie", "🍂", "Foglie"], ["petali", "🌸", "Petali"]];
// Suoni dentro l'app (creati dal codice, nessun file): notifiche con l'app aperta, cose fatte, biscotto
const SUONI = [["campanella", "🔔", "Campana"], ["bolla", "🫧", "Bolla"], ["xilofono", "🎵", "Xilofono"], ["gocce", "💧", "Gocce"], ["spenti", "🔕", "Spenti"]];
const DEFAULT_CUSTOM = { nome_app: "Mochi", mascotte: "mochi", accessorio: "auto", colore: "fragola", font: "morbido", stile: "morbido",
  moduli: Object.fromEntries(MODULI.map((m) => [m[0], m[4]])), stagione: "auto", suono: "campanella" };
function cleanCustom(c) {
  c = c && typeof c === "object" ? c : {};
  const nome = typeof c.nome_app === "string" ? c.nome_app.replace(/[<>]/g, "").trim().slice(0, 24) : "";
  const acc = typeof c.accessorio === "string" && (c.accessorio === "auto" || c.accessorio === "none" || TRAGUARDI.some((t) => t.id === c.accessorio)) ? c.accessorio : "auto";
  const colore = typeof c.colore === "string" && PALETTE.some((x) => x[0] === c.colore) ? c.colore : "fragola";
  const font = typeof c.font === "string" && FONTI.some((x) => x[0] === c.font) ? c.font : "morbido";
  const stile = typeof c.stile === "string" && STILI.some((x) => x[0] === c.stile) ? c.stile : "morbido";
  // solo i moduli conosciuti, solo vero/falso; quelli mancanti prendono il valore iniziale
  const m = c.moduli && typeof c.moduli === "object" && !Array.isArray(c.moduli) ? c.moduli : {};
  const moduli = Object.fromEntries(MODULI.map(([k, , , , def]) => [k, typeof m[k] === "boolean" ? m[k] : def]));
  const stagione = typeof c.stagione === "string" && STAGIONI.some((x) => x[0] === c.stagione) ? c.stagione : "auto";
  const suono = typeof c.suono === "string" && SUONI.some((x) => x[0] === c.suono) ? c.suono : "campanella";
  return { colore, font, stile, moduli, stagione, suono, nome_app: nome || DEFAULT_CUSTOM.nome_app, mascotte: typeof c.mascotte === "string" && Object.prototype.hasOwnProperty.call(MASC.list, c.mascotte) ? c.mascotte : DEFAULT_CUSTOM.mascotte, accessorio: acc };
}
let CUSTOM = cleanCustom(LS.get("mochi.custom", DEFAULT_CUSTOM));
// Il modulo è acceso? (quelli che richiedono un account sono spenti in modalità prova)
const mod = (k) => CUSTOM.moduli[k] !== false && !(MODULI.find((m) => m[0] === k)?.[5] && !ONLINE_MODE);
const MN = () => MASC.list[CUSTOM.mascotte].nome;
const mascot = (cls = "") => withAcc(MASC.svg(CUSTOM.mascotte, { cls }), CUSTOM.mascotte);

function setLink(rel, href) {
  let l = document.querySelector(`link[rel="${rel}"]`);
  if (!l) { l = document.createElement("link"); l.rel = rel; document.head.appendChild(l); }
  l.href = href;
}
// Applica nome e icona: titolo, nome sotto l'icona e icona usata quando la si aggiunge a Home/Dock
// La barra in alto del telefono prende il colore di sfondo del tema (chiaro o scuro)
function syncBarColor() {
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  if (bg) document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg);
}
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => syncBarColor());
function applyCustom() {
  if (CUSTOM.colore === "fragola") delete document.documentElement.dataset.palette; else document.documentElement.dataset.palette = CUSTOM.colore;
  if (CUSTOM.font === "morbido") delete document.documentElement.dataset.font; else document.documentElement.dataset.font = CUSTOM.font;
  document.documentElement.dataset.stile = CUSTOM.stile;
  document.title = CUSTOM.nome_app;
  const bn = document.getElementById("brandName"); if (bn) bn.textContent = CUSTOM.nome_app;
  document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute("content", CUSTOM.nome_app);
  setLink("apple-touch-icon", `icons/icon-${CUSTOM.mascotte}-180.png`);
  setLink("icon", `icons/${CUSTOM.mascotte}.svg`);
  syncBarColor();
  stagioniAggiorna();
  for (const id of ["topMascot", "loginMascot"]) {
    const el = document.getElementById(id);
    const key = CUSTOM.mascotte + "|" + (accWorn()?.id || "");
    if (el && el.dataset.m !== key) { el.innerHTML = mascot(); el.dataset.m = key; }
  }
}
async function saveCustom(c) {
  CUSTOM = cleanCustom({ ...CUSTOM, ...c });
  LS.set("mochi.custom", CUSTOM);
  applyCustom(); render();
  if (ONLINE_MODE && store.user) { try { await store.saveCustom(CUSTOM); } catch {} }
}

// La mascotte fa festa: occhi felici, sorriso e saltelli
let cheerT;
function cheer(ms = 1700) {
  document.querySelectorAll(".mascotte").forEach((m) => m.classList.add("happy"));
  clearTimeout(cheerT);
  cheerT = setTimeout(() => document.querySelectorAll(".mascotte").forEach((m) => m.classList.remove("happy")), ms);
}
function heartAt(el) {
  const r = el.getBoundingClientRect();
  const s = document.createElement("span");
  s.className = "heart"; s.textContent = ["💗", "🌸", "✨", "💕"][Math.floor(Math.random() * 4)];
  s.style.left = r.left + r.width / 2 + "px"; s.style.top = r.top + "px";
  document.body.appendChild(s); setTimeout(() => s.remove(), 1100);
}

/* =========================================================
   IL PANCINO DELLA MASCOTTE
   Ogni cosa spuntata è un bocconcino. La felicità sale e non scende mai:
   niente fame, niente tristezza, niente sensi di colpa. Solo ricompense.
   ========================================================= */

const CIBI = ["🍣", "🍙", "🍡", "🍤", "🥟", "🍓", "🍥", "🧁"];
// Un bocconcino per ogni cosa fatta (non gli appunti). Togliere la spunta lo "restituisce": è onesto.
// Nelle liste condivise conta chi ha spuntato: i bocconcini sono solo i tuoi
const bocconcini = () => state.items.filter((i) => i.kind !== "note" && i.done && i.done_at && (i.done_by ? i.done_by === myId() : !i.user_id || i.user_id === myId()));
const cibo = (id) => CIBI[[...String(id)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % CIBI.length];
function accWorn() {
  const tot = bocconcini().length;
  const got = TRAGUARDI.filter((t) => tot >= t.n);
  if (CUSTOM.accessorio === "none") return null;
  if (CUSTOM.accessorio !== "auto") { const t = got.find((x) => x.id === CUSTOM.accessorio); if (t) return t; }
  return got[got.length - 1] || null;
}
// L'accessorio sta DENTRO il corpo della mascotte: respira e saltella insieme a lei.
// Posizione scelta per ogni personaggio, appoggiata sulla testa (coordinate del disegno).
const ACC_POS = { mochi: [322, 182, 62], nigi: [150, 200, 62], bolla: [250, 196, 58] };
function withAcc(svgStr, id) {
  const a = accWorn(); if (!a) return svgStr;
  const [x, y, fs] = ACC_POS[id] || ACC_POS.mochi;
  const t = `<text class="acc" x="${x}" y="${y}" font-size="${fs}" text-anchor="middle">${a.e}</text>`;
  // il disegno termina chiudendo il gruppo del corpo: inserisco l'accessorio appena prima
  return svgStr.replace(/<\/g>\s*<\/svg>$/, `${t}</g></svg>`);
}
function umore(oggi) {
  return oggi >= 5 ? ["Al settimo cielo", "🌈"] : oggi >= 3 ? ["Felicissimo", "💗"] : oggi >= 1 ? ["Contento", "😊"] : ["Tranquillo", "🍵"];
}
const oggiCount = () => { const t = todayStr(); return bocconcini().filter((i) => ymd(new Date(i.done_at)) === t).length; };
function pancinoCard() {
  const tot = bocconcini().length, oggi = oggiCount(), [mood] = umore(oggi);
  const next = TRAGUARDI.find((t) => tot < t.n);
  const prevN = [...TRAGUARDI].reverse().find((t) => tot >= t.n)?.n || 0;
  const pct = next ? Math.round(((tot - prevN) / (next.n - prevN)) * 100) : 100;
  return `<button class="pancino" data-act="open-pancino">
    <span class="mbox">${mascot(oggi ? "happy" : "")}</span>
    <span class="pc-txt"><b>${esc(MN())} è ${mood.toLowerCase()}</b>
      <small>${oggi ? `Oggi ha mangiato ${oggi} ${oggi === 1 ? "bocconcino" : "bocconcini"} ${"🍣".repeat(Math.min(oggi, 5))}` : "Spunta una cosa fatta e gli dai un bocconcino"}</small>
      <span class="pc-bar"><i style="width:${pct}%"></i></span>
      <small>${next ? `Ancora ${next.n - tot} per il ${next.nome.toLowerCase()} ${next.e}` : "Ha tutti i regali! 🏆"}</small></span>
  </button>`;
}
function openPancino() {
  const tot = bocconcini().length, oggi = oggiCount(), [mood, me] = umore(oggi);
  const days = [];
  for (let k = 6; k >= 0; k--) { const d = addDays(new Date(), -k); days.push([d, bocconcini().filter((i) => ymd(new Date(i.done_at)) === ymd(d)).length]); }
  const max = Math.max(3, ...days.map((d) => d[1]));
  const worn = accWorn()?.id || "none";
  openSheet(`
    <div class="recap">
      <div class="mbox">${mascot("happy")}</div>
      <h2 class="fred">Il pancino di ${esc(MN())}</h2>
      <div class="say">${mood} ${me} · in tutto ${tot} ${tot === 1 ? "bocconcino" : "bocconcini"}</div>
    </div>
    <div class="sec"><h2>Ultimi 7 giorni</h2></div>
    <div class="week7">${days.map(([d, n]) => `<div><i style="height:${Math.round((n / max) * 100)}%"></i><b>${n || ""}</b><span>${GIORNI[d.getDay()].slice(0, 3)}</span></div>`).join("")}</div>
    <div class="sec"><h2>Regali</h2><span class="count">${TRAGUARDI.filter((t) => tot >= t.n).length}/${TRAGUARDI.length}</span></div>
    <div class="regali">${TRAGUARDI.map((t) => tot >= t.n
      ? `<button class="${worn === t.id ? "on" : ""}" data-act="wear" data-v="${t.id}"><span class="e">${t.e}</span><b>${t.nome}</b><small>${worn === t.id ? "Lo indossa" : "Tocca per metterlo"}</small></button>`
      : `<button class="lock" disabled><span class="e">${t.e}</span><b>${t.nome}</b><small>a ${t.n} bocconcini</small></button>`).join("")}
      <button class="${worn === "none" ? "on" : ""}" data-act="wear" data-v="none"><span class="e">🫧</span><b>Niente</b><small>Al naturale</small></button></div>
    <p class="hint" style="margin:10px 4px 14px">Ogni cosa che spunti è un bocconcino. ${esc(MN())} non ha mai fame e non si offende: festeggia solo quello che fai.</p>
    <div class="actions"><button class="btn primary" data-act="close">Ciao ${esc(MN())} 💗</button></div>`);
}
// Il bocconcino vola dalla spunta alla mascotte in alto
function feed(fromEl, it) {
  const m = $("#topMascot"); if (!m || !mod("pancino")) return;
  const a = fromEl.getBoundingClientRect(), b = m.getBoundingClientRect();
  if (b.bottom < 0 || b.top > innerHeight || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const f = document.createElement("span");
  f.className = "boccone"; f.textContent = cibo(it.id);
  f.style.left = a.left + a.width / 2 + "px"; f.style.top = a.top + a.height / 2 + "px";
  document.body.appendChild(f);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    f.style.transform = `translate(${b.left + b.width / 2 - (a.left + a.width / 2)}px, ${b.top + b.height * 0.6 - (a.top + a.height / 2)}px) scale(.5)`;
    f.style.opacity = ".2";
  }));
  setTimeout(() => { f.remove(); m.classList.add("nom"); heartAt(m); setTimeout(() => m.classList.remove("nom"), 700); }, 650);
}
// Nuovo regalo sbloccato: festa una volta sola
function checkRegalo(prima) {
  if (!mod("pancino")) return;
  const dopo = bocconcini().length;
  const t = TRAGUARDI.find((x) => prima < x.n && dopo >= x.n); if (!t) return;
  const k = "mochi.regali." + (store.user?.id || "local");
  const visti = LS.get(k, []); if (visti.includes(t.id)) return;
  LS.set(k, [...visti, t.id]);
  applyCustom();
  setTimeout(() => {
    openSheet(`<div class="recap"><div class="mbox">${mascot("happy")}</div>
      <h2 class="fred">Un regalo per ${esc(MN())}! ${t.e}</h2>
      <div class="say">${t.n} bocconcini: si è guadagnato il ${t.nome.toLowerCase()}. Grazie a te 💗</div></div>
      <div class="actions"><button class="btn primary" data-act="close">Che bello!</button></div>`);
    confetti(innerWidth / 2, innerHeight * 0.35, 40);
  }, 1100);
}

function openMascotPicker() {
  openSheet(`
    <h2><span class="mbox">${mascot()}</span>Personalizza</h2>
    <div class="field"><label>Nome dell'app</label>
      <input class="input big" id="cName" maxlength="24" value="${esc(CUSTOM.nome_app)}" placeholder="Mochi" autocomplete="off"></div>
    <div class="field"><label>Mascotte</label></div>
    <div class="mpick">${Object.entries(MASC.list).map(([id, m]) => `
      <button class="${CUSTOM.mascotte === id ? "on" : ""}" data-act="pick-mascot" data-v="${id}">
        <span class="mbox">${MASC.svg(id)}</span><b>${esc(m.nome)}</b><small>${esc(m.descr)}</small>
      </button>`).join("")}</div>
    <p class="hint" style="margin:0 4px 14px">L'icona sulla Home o sul Dock si sceglie quando aggiungi l'app. Per cambiarla dopo: rimuovi l'app dalla Home e aggiungila di nuovo.</p>
    <div class="actions"><button class="btn" data-act="close">Chiudi</button><button class="btn primary" data-act="save-custom">Salva</button></div>`);
}

/* =========================================================
   STATO E RENDER
   ========================================================= */
const state = {
  items: [], liste: [], umori: {}, turni: {}, turniImp: { tipi: [], ciclo: [], ciclo_inizio: null }, tab: "oggi", todoFilter: "tutte", noteFilter: "tutte",
  calMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  calSel: todayStr(), recapMonth: null, synced: true,
  spese: { voci: [], budget: null }, speseMese: null, stAperti: new Set()
};

function setSync(ok) { state.synced = ok; const el = $("#syncDot"); if (el) el.className = "sync" + (ok ? "" : " off"); }

function greeting() {
  const h = new Date().getHours();
  const s = h < 6 ? "Buonanotte" : h < 13 ? "Buongiorno" : h < 18 ? "Buon pomeriggio" : "Buonasera";
  return `${s}${NOME ? ", " + NOME : ""}!`;
}
/* -------- frase del giorno (frasi.js) -------- */
const FRASI = Array.isArray(window.MOCHI_FRASI) && window.MOCHI_FRASI.length ? window.MOCHI_FRASI.map(String) : ["Una cosa alla volta è comunque un passo avanti."];
let mottoShift = 0;
function fraseDelGiorno() {
  const d = new Date();
  const day = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5);
  return FRASI[(day + d.getFullYear() * 7 + mottoShift) % FRASI.length];
}

function headerUpdate() {
  $("#hello").textContent = greeting();
  const m = $("#motto"); if (m) m.innerHTML = `<span class="emo">💭 </span>${esc(fraseDelGiorno())}`;
  const d = new Date();
  $("#today").innerHTML = `${GIORNI[d.getDay()].replace(/^./, (c) => c.toUpperCase())} ${d.getDate()} ${MESI[d.getMonth()]} ${ONLINE_MODE ? `· <span id="syncDot" class="sync${state.synced ? "" : " off"}"><i></i>${state.synced ? "sincronizzato" : "offline"}</span>` : "· modalità prova"}`;
}

const byDue = (a, b) => (a.due_date || "9999") .localeCompare(b.due_date || "9999") || (a.due_time || "99").localeCompare(b.due_time || "99");

function itemRow(it) {
  const area = it.area === "lavoro" ? "lavoro" : "personale";
  const left = it.kind === "event"
    ? `<span class="evdot"><span class="emo">📅</span><svg class="ico q" aria-hidden="true"><use href="#i-agenda"/></svg></span>`
    : `<button class="check" data-act="toggle" data-id="${esc(it.id)}" aria-label="Completa">${it.done ? "✓" : ""}</button>`;
  const chips = [];
  if (it.due_date) chips.push(`<span class="chip ${isLate(it) ? "late" : ""}">${isLate(it) ? "⏰ " : ""}${niceDate(it.due_date)}${it.due_time ? " · " + it.due_time : ""}</span>`);
  chips.push(`<span class="chip ${area === "lavoro" ? "lav" : "per"}">${area === "lavoro" ? '<span class="emo">💼 </span>Lavoro' : '<span class="emo">🌷 </span>Personale'}</span>`);
  const lst = it.lista_id ? listaById(it.lista_id) : null;
  if (lst) chips.push(`<span class="chip lst">${esc(lst.emoji)} ${esc(lst.nome)}</span>`);
  if (lst && it.user_id && it.user_id !== myId()) chips.push(`<span class="chip">da ${esc(nomeMembro(lst, it.user_id))}</span>`);
  if (lst && it.done && it.done_by && it.done_by !== myId()) chips.push(`<span class="chip">✓ ${esc(nomeMembro(lst, it.done_by))}</span>`);
  if (it.remind_at && !it.reminded) chips.push(`<span class="chip">🔔</span>`);
  if (it.body) chips.push(`<span class="chip">📝</span>`);
  // lista da spuntare: "3/7" si apre e si spunta senza aprire l'editor
  const st = it.sottotask || [], aperto = st.length && state.stAperti.has(it.id);
  if (st.length) chips.push(`<button class="chip st-chip ${aperto ? "on" : ""} ${st.every((x) => x.f) ? "tutte" : ""}" data-act="st-apri" data-id="${esc(it.id)}" aria-expanded="${aperto ? "true" : "false"}" aria-label="Lista da spuntare: ${st.filter((x) => x.f).length} su ${st.length}">☑ ${st.filter((x) => x.f).length}/${st.length}<span class="st-fr">${aperto ? "▴" : "▾"}</span></button>`);
  return `<div class="item ${area} ${it.done ? "done" : ""}" data-act="edit" data-id="${esc(it.id)}">
    ${left}
    <div class="body"><div class="t">${esc(it.title)}</div><div class="meta">${chips.join("")}</div>${aperto ? `<div class="st-lista">${st.map((x) => stVoce(it, x)).join("")}</div>` : ""}</div>
  </div>`;
}
const stVoce = (it, x) => `<button class="st-voce ${x.f ? "fatto" : ""}" data-act="st-spunta" data-id="${esc(it.id)}" data-v="${esc(x.id)}" aria-pressed="${x.f ? "true" : "false"}"><span class="st-box">${x.f ? "✓" : ""}</span><span class="st-tx">${esc(x.t)}</span></button>`;
const emptyBox = (msg) => `<div class="empty"><div class="mbox">${mascot()}</div><div>${msg}</div></div>`;

function nigiSays() {
  const t = todayStr();
  const late = state.items.filter(isLate).length;
  const todayTodo = state.items.filter((i) => i.kind === "todo" && !i.done && i.due_date === t).length;
  const todayEv = state.items.filter((i) => i.kind === "event" && i.due_date === t).length;
  const doneToday = state.items.filter((i) => i.done && i.done_at && ymd(new Date(i.done_at)) === t).length;
  if (!state.items.length) return `Ciao, sono <b>${MN()}</b>! Tocca il <b>+</b> e scrivi come parli: <i>"dentista giovedì alle 17"</i>. Al resto penso io 🍣`;
  if (late) return `Psst... ci sono <b>${late}</b> ${late === 1 ? "cosa rimasta" : "cose rimaste"} indietro. Una alla volta, ce la fai 💪`;
  if (doneToday >= 3) return `Oggi hai già completato <b>${doneToday}</b> cose. Sei una macchina da sushi! 🍱`;
  if (todayEv || todayTodo) return `Oggi hai ${todayEv ? `<b>${todayEv}</b> ${todayEv === 1 ? "appuntamento" : "appuntamenti"}` : ""}${todayEv && todayTodo ? " e " : ""}${todayTodo ? `<b>${todayTodo}</b> ${todayTodo === 1 ? "cosa da fare" : "cose da fare"}` : ""}. Ci penso io a ricordartelo 🌸`;
  return `Giornata libera! Se ti viene in mente qualcosa, dimmelo e lo tengo io 💭`;
}

function viewOggi() {
  const t = todayStr();
  const ev = state.items.filter((i) => i.kind === "event" && i.due_date === t).sort((a, b) => (a.done - b.done) || byDue(a, b));
  const late = state.items.filter(isLate).sort(byDue);
  const todo = state.items.filter((i) => i.kind === "todo" && !i.done && i.due_date === t && !isLate(i)).sort(byDue);
  const noDate = state.items.filter((i) => i.kind === "todo" && !i.done && !i.due_date).slice(-5).reverse();
  const doneT = state.items.filter((i) => i.kind === "todo" && i.done && i.done_at && ymd(new Date(i.done_at)) === t);
  const week = [];
  for (let k = 1; k <= 6; k++) week.push(ymd(addDays(new Date(), k)));
  const soon = state.items.filter((i) => !i.done && week.includes(i.due_date) && i.kind !== "note").sort(byDue).slice(0, 6);

  let h = `<div class="bubble detto">${nigiSays()}</div>`;
  h += `<div class="stats">
    <div class="stat"><b>${ev.length}</b><span>appuntamenti</span></div>
    <div class="stat"><b>${todo.length + late.length}</b><span>da fare</span></div>
    <div class="stat"><b>${doneT.length}</b><span>fatte oggi</span></div></div>`;
  { const tu = turnoDi(t); if (tu && tu.k !== "") h += rigaTurno(t, true); }
  if (mod("umore")) h += umoreCard();
  if (mod("pancino")) h += pancinoCard();
  if (late.length) h += `<div class="sec"><h2>Rimaste indietro</h2><span class="count">${late.length}</span></div><div class="list">${late.map(itemRow).join("")}</div>`;
  h += `<div class="sec"><h2>Appuntamenti di oggi</h2></div>`;
  h += ev.length ? `<div class="list">${ev.map(itemRow).join("")}</div>` : `<div class="empty" style="padding:10px">Nessun appuntamento oggi ☁️</div>`;
  h += `<div class="sec"><h2>Da fare oggi</h2></div>`;
  h += todo.length ? `<div class="list">${todo.map(itemRow).join("")}</div>` : `<div class="empty" style="padding:10px">Niente in scadenza oggi ✨</div>`;
  if (noDate.length) h += `<div class="sec"><h2>Quando hai tempo</h2></div><div class="list">${noDate.map(itemRow).join("")}</div>`;
  if (doneT.length) h += `<div class="sec"><h2>Fatte oggi<span class="emo"> 🎉</span></h2></div><div class="list">${doneT.map(itemRow).join("")}</div>`;
  const now = new Date(), cm = new Date(now.getFullYear(), now.getMonth(), 1);
  let side = `<div class="desk-only"><div class="sec"><h2 style="text-transform:capitalize">${MESI[cm.getMonth()]}</h2></div>
    <div class="cal mini">${monthGrid(cm, itemsByDay(), "", "cal-jump")}</div></div>`;
  side += `<div class="sec"><h2>Nei prossimi giorni</h2></div>`;
  side += soon.length ? `<div class="list">${soon.map(itemRow).join("")}</div>` : `<div class="empty" style="padding:10px">Settimana tranquilla 🍃</div>`;
  return `<div class="split"><div class="col-main">${h}</div><div class="col-side">${side}</div></div>`;
}

function viewTodo() {
  const f = state.todoFilter;
  let list = state.items.filter((i) => i.kind === "todo");
  if (f === "lavoro" || f === "personale") list = list.filter((i) => i.area === f);
  if (f.startsWith("l:")) list = list.filter((i) => i.lista_id === f.slice(2));
  const open = list.filter((i) => !i.done).sort(byDue);
  const done = list.filter((i) => i.done).sort((a, b) => (b.done_at || "").localeCompare(a.done_at || "")).slice(0, 15);
  const fb = (k, l) => `<button class="fbtn ${f === k ? "on" : ""}" data-act="todo-filter" data-v="${k}">${l}</button>`;
  let h = `<div class="filters">${fb("tutte", "Tutte")}${fb("personale", '<span class="emo">🌷 </span>Personale')}${fb("lavoro", '<span class="emo">💼 </span>Lavoro')}${listeUsate().map((l) => fb("l:" + l.id, `${esc(l.emoji)} ${esc(l.nome)}`)).join("")}</div>`;
  h += `<div class="sec"><h2>Da fare</h2><span class="count">${open.length}</span></div>`;
  h += open.length ? `<div class="list">${open.map(itemRow).join("")}</div>` : emptyBox(`Tutto fatto! ${MN()} è fiera di te 🌸`);
  if (done.length) h += `<div class="sec"><h2>Completate</h2></div><div class="list">${done.map(itemRow).join("")}</div>`;
  return h;
}

function itemsByDay() {
  const map = {};
  state.items.forEach((i) => { if (i.due_date && i.kind !== "note") (map[i.due_date] = map[i.due_date] || []).push(i); });
  return map;
}

/** Griglia di un mese. act = azione al tocco di un giorno ("cal-sel" in Agenda, "cal-jump" dal mini calendario) */
function monthGrid(m, map, sel, act) {
  const first = new Date(m.getFullYear(), m.getMonth(), 1);
  const start = addDays(first, -((first.getDay() + 6) % 7));
  let cells = "";
  for (let k = 0; k < 42; k++) {
    const d = addDays(start, k), s = ymd(d);
    if (k >= 35 && d.getMonth() !== m.getMonth()) break;
    const its = map[s] || [];
    const dots = its.slice(0, 3).map((i) => `<i class="${i.area === "lavoro" ? "l" : ""}"></i>`).join("");
    const um = mod("umore") ? state.umori[s] : null, tu = act === "cal-sel" ? turnoDi(s) : null;
    cells += `<button class="day ${d.getMonth() !== m.getMonth() ? "out" : ""} ${s === todayStr() ? "today" : ""} ${s === sel ? "sel" : ""} ${um ? "has-um" : ""}" ${um ? `style="--um:${UMORI[um.livello].colore}"` : ""} data-act="${act}" data-v="${s}"><span class="dn">${d.getDate()}</span><span class="dots">${dots}</span>${tu && tu.k !== "" ? `<span class="tday-s" style="--tc:${TURNO_COLORI[tu.colore - 1]}">${esc(tu.sigla)}</span>` : ""}</button>`;
  }
  return `<div class="dow"><div>L</div><div>M</div><div>M</div><div>G</div><div>V</div><div>S</div><div>D</div></div><div class="days">${cells}</div>`;
}

function viewAgenda() {
  const m = state.calMonth;
  const map = itemsByDay();
  const sel = (map[state.calSel] || []).sort((a, b) => (a.done - b.done) || (a.kind === "event" ? -1 : 1) - (b.kind === "event" ? -1 : 1) || byDue(a, b));
  const sd = parseYmd(state.calSel);
  return `<div class="split agenda">
    <div class="col-main">
      <div class="calhead">
        <button class="iconbtn" data-act="cal-move" data-v="-1">‹</button>
        <h2>${MESI[m.getMonth()]} ${m.getFullYear()}</h2>
        <button class="iconbtn" data-act="cal-move" data-v="1">›</button></div>
      <div class="cal">${monthGrid(m, map, state.calSel, "cal-sel")}</div>
    </div>
    <div class="col-side">
      <div class="sec"><h2>${GIORNI[sd.getDay()].replace(/^./, (c) => c.toUpperCase())} ${sd.getDate()} ${MESI[sd.getMonth()]}</h2>
        <button class="fbtn" data-act="new-on-day">+ Aggiungi</button></div>
      ${rigaTurno(state.calSel)}
      ${sel.length ? `<div class="list">${sel.map(itemRow).join("")}</div>` : `<div class="empty" style="padding:12px">${(() => { const tu = turnoDi(state.calSel); return tu && tu.inizio ? "Nient'altro in programma" : "Giornata libera 🌤️"; })()}</div>`}
      ${!mod("umore") ? "" : state.calSel <= todayStr() ? (state.umori[state.calSel]
        ? `<button class="umore-riga" data-act="umore-apri" data-v="${state.calSel}">${faccina(state.umori[state.calSel].livello, 30)}<span><b>${UMORI[state.umori[state.calSel].livello].nome}</b>${state.umori[state.calSel].nota ? `<small>${esc(state.umori[state.calSel].nota)}</small>` : ""}</span></button>`
        : `<button class="umore-riga vuota" data-act="umore-apri" data-v="${state.calSel}"><span class="pallino"></span><span><b>Com'è andata?</b><small>Tocca per colorare questo giorno</small></span></button>`) : ""}
      ${mod("umore") ? `${legendaUmori()}
      <button class="fbtn" style="margin-top:10px" data-act="giardino-apri">Il giardino del mese</button>` : ""}
    </div></div>`;
}

// Bacheca da computer: ogni foglietto ha una sua inclinazione e una puntina di un colore,
// sempre le stesse per quel foglietto (calcolate dal suo id), così non "ballano" a ogni apertura.
const PUNTINE = ["#e85d8a", "#3a86c8", "#3f9a6b", "#f2b233", "#7a5fd6", "#e0703f"];
function bachecaStile(id) {
  const h = [...String(id)].reduce((a, c) => (a * 33 + c.charCodeAt(0)) >>> 0, 5381);
  const rot = ((h % 9) - 4) * 0.7; // da -2.8 a +2.8 gradi
  return `--rot:${rot.toFixed(1)}deg;--pinc:${PUNTINE[(h >>> 4) % PUNTINE.length]}`;
}
// Menu completo (su telefono: dal pulsante ☰ in alto; su computer è già tutto nella barra a sinistra)
function viewMenu() {
  const voce = (attr, e, t, d) => `<button class="mtile" ${attr}><span class="e">${e}</span><b>${t}</b><small>${d}</small></button>`;
  return `<div class="sec" style="margin-top:0"><h2>Menu</h2></div>
    <div class="mgrid">
      ${voce('data-tab="appunti"', "📝", "Appunti", "Idee, liste, cose da tenere")}
      ${mod("spese") ? voce('data-tab="spese"', "👛", "Spese", (() => { const t = totaleMese(new Date()); return t ? `${euro(t)} questo mese` : "Quanto spendi nel mese"; })()) : ""}
      ${mod("liste") ? voce('data-act="open-liste"', "👭", "Liste condivise", state.liste.length ? state.liste.map((l) => esc(l.emoji)).join(" ") : "Da usare insieme") : ""}
      ${mod("ricorrenti") ? voce('data-act="open-ricorrenti"', "🔁", "Ricorrenti", "Bevi acqua, fai una pausa...") : ""}
      ${mod("turni") ? voce('data-tab="turni"', "💼", "Turni di lavoro", turniAttivi() ? (() => { const o = oreMese(new Date()); return `${fmtOre(o.min)} questo mese`; })() : "Il calendario del lavoro") : ""}
      ${mod("biscotto") ? voce('data-act="open-biscotto"', "🥠", "Biscotto del giorno", "La frase di oggi") : ""}
      ${mod("umore") ? voce('data-act="giardino-apri"', "🌷", "Il giardino del mese", "Le tue giornate in fiori") : ""}
      ${voce('data-act="open-recap"', "🎀", "Recap del mese", "Com'è andato il mese")}
      ${mod("pancino") ? voce('data-act="open-pancino"', "🍣", `Il pancino di ${esc(MN())}`, "Bocconcini e regali") : ""}
      ${ONLINE_MODE ? voce('data-act="open-consiglio"', "💌", "Consiglia", "Scrivi alla sviluppatrice") : ""}
      ${isAdmin ? voce('data-act="open-inbox"', "📬", "Messaggi ricevuti", adminUnread ? `${adminUnread} da leggere` : "Tutti letti") : ""}
      ${voce('data-act="open-settings"', "⚙️", "Impostazioni", "Colori, cosa usare, suoni")}
    </div>`;
}
// Ordine dei post-it: prima i fissati, poi l'ordine scelto trascinando; quelli nuovi (senza posizione) in cima
function ordineNote(a, b) {
  if (b.pinned !== a.pinned) return b.pinned - a.pinned;
  const pa = a.posizione, pb = b.posizione;
  if (pa != null && pb != null && pa !== pb) return pa - pb;
  if (pa == null && pb != null) return -1;
  if (pb == null && pa != null) return 1;
  return (b.updated_at || "").localeCompare(a.updated_at || "");
}

/* Trascinare i post-it: con il mouse si trascina subito, con il dito dopo aver tenuto premuto un attimo
   (così lo scorrimento della pagina continua a funzionare). */
const trasc = { el: null, ghost: null, timer: 0, attivo: false, x0: 0, y0: 0, dx: 0, dy: 0, blocca: 0 };
function trascInizia(el, x, y) {
  const r = el.getBoundingClientRect();
  trasc.attivo = true; trasc.dx = x - r.left; trasc.dy = y - r.top;
  const g = el.cloneNode(true); g.classList.add("note-ghost"); g.removeAttribute("data-act");
  g.style.width = r.width + "px"; g.style.left = r.left + "px"; g.style.top = r.top + "px";
  document.body.appendChild(g); trasc.ghost = g;
  el.classList.add("trascinata"); document.body.classList.add("trascinando");
  if (navigator.vibrate) navigator.vibrate(12);
}
function trascMuovi(x, y) {
  const g = trasc.ghost; if (!g) return;
  g.style.left = x - trasc.dx + "px"; g.style.top = y - trasc.dy + "px";
  const sotto = document.elementFromPoint(x, y)?.closest(".notes .note");
  if (!sotto || sotto === trasc.el || sotto.classList.contains("fissa") !== trasc.el.classList.contains("fissa")) return;
  const r = sotto.getBoundingClientRect(), dopo = x > r.left + r.width / 2 || y > r.bottom - 10;
  sotto.parentNode.insertBefore(trasc.el, dopo ? sotto.nextSibling : sotto);
}
async function trascFine() {
  clearTimeout(trasc.timer);
  const el = trasc.el, attivo = trasc.attivo;
  trasc.el = null; trasc.attivo = false;
  if (trasc.ghost) { trasc.ghost.remove(); trasc.ghost = null; }
  document.body.classList.remove("trascinando");
  if (!el || !attivo) return;
  el.classList.remove("trascinata"); trasc.blocca = Date.now();
  // nuovo ordine = quello che si vede adesso nella bacheca
  const ids = [...document.querySelectorAll(".notes .note")].map((n) => n.dataset.id);
  const voci = ids.map((id) => state.items.find((i) => i.id === id)).filter(Boolean);
  const k = voci.findIndex((v) => v.id === el.dataset.id); if (k < 0) return;
  const cambiate = [];
  const prima = voci[k - 1], poi = voci[k + 1];
  if ((prima && prima.posizione == null) || (poi && poi.posizione == null) || (prima && poi && poi.posizione - prima.posizione < 1e-6)) {
    voci.forEach((v, i) => { const p = (i + 1) * 1000; if (v.posizione !== p) { v.posizione = p; cambiate.push(v); } });
  } else {
    const nuova = prima && poi ? (prima.posizione + poi.posizione) / 2 : prima ? prima.posizione + 1000 : poi ? poi.posizione - 1000 : 1000;
    voci[k].posizione = nuova; cambiate.push(voci[k]);
  }
  render();
  for (const v of cambiate) await store.save(v);
}
document.addEventListener("pointerdown", (e) => {
  const el = e.target.closest(".notes .note"); if (!el || e.button > 0 || state.tab !== "appunti") return;
  trasc.el = el; trasc.x0 = e.clientX; trasc.y0 = e.clientY;
  if (e.pointerType === "touch") trasc.timer = setTimeout(() => { if (trasc.el === el) trascInizia(el, trasc.x0, trasc.y0); }, 380);
});
document.addEventListener("pointermove", (e) => {
  if (!trasc.el) return;
  if (trasc.attivo) { trascMuovi(e.clientX, e.clientY); return; }
  const lontano = Math.hypot(e.clientX - trasc.x0, e.clientY - trasc.y0) > 7;
  if (e.pointerType === "touch") { if (lontano) { clearTimeout(trasc.timer); trasc.el = null; } return; } // sta scorrendo
  if (lontano) trascInizia(trasc.el, e.clientX, e.clientY);
});
// col dito: mentre trascini la pagina non deve scorrere
document.addEventListener("touchmove", (e) => { if (trasc.attivo) { e.preventDefault(); const t = e.touches[0]; trascMuovi(t.clientX, t.clientY); } }, { passive: false });
document.addEventListener("pointerup", trascFine);
document.addEventListener("pointercancel", (e) => { if (!trasc.attivo) { clearTimeout(trasc.timer); trasc.el = null; } });
document.addEventListener("touchend", () => { if (trasc.attivo) trascFine(); });
// dopo aver trascinato, il "clic" finale non deve aprire il post-it
document.addEventListener("click", (e) => { if (Date.now() - trasc.blocca < 350 && e.target.closest(".notes .note")) { e.stopPropagation(); e.preventDefault(); } }, true);
document.addEventListener("contextmenu", (e) => { if (trasc.attivo || trasc.timer && e.target.closest(".notes .note")) e.preventDefault(); });

function viewAppunti() {
  const f = state.noteFilter;
  let list = state.items.filter((i) => i.kind === "note");
  if (f.startsWith("l:")) list = list.filter((i) => i.lista_id === f.slice(2));
  else if (f !== "tutte") list = list.filter((i) => i.area === f);
  list.sort(ordineNote);
  const fb = (k, l) => `<button class="fbtn ${f === k ? "on" : ""}" data-act="note-filter" data-v="${k}">${l}</button>`;
  let h = `<div class="filters">${fb("tutte", "Tutti")}${fb("personale", '<span class="emo">🌷 </span>Personale')}${fb("lavoro", '<span class="emo">💼 </span>Lavoro')}${listeUsate().map((l) => fb("l:" + l.id, `${esc(l.emoji)} ${esc(l.nome)}`)).join("")}</div>`;
  if (!list.length) return h + emptyBox("Nessun appunto. Idee, liste della spesa, password del wifi di casa della nonna... 📝");
  h += `<div class="notes">${list.map((n) => `<div class="note c${n.color || 1} ${n.pinned ? "fissa" : ""}" style="${bachecaStile(n.id)}" data-act="edit" data-id="${esc(n.id)}">
      ${n.pinned ? `<span class="pin">📌</span>` : ""}
      <h3>${esc(n.title)}</h3>${n.body ? `<p>${esc(n.body)}</p>` : ""}
      ${n.sottotask?.length ? `<div class="st-note">${n.sottotask.slice(0, 10).map((x) => stVoce(n, x)).join("")}${n.sottotask.length > 10 ? `<small>e altre ${n.sottotask.length - 10}...</small>` : ""}</div>` : ""}
      <div class="when">${n.sottotask?.length ? `☑ ${n.sottotask.filter((x) => x.f).length}/${n.sottotask.length} · ` : ""}${n.lista_id && listaById(n.lista_id) ? esc(listaById(n.lista_id).emoji) : n.area === "lavoro" ? "💼" : "🌷"} ${niceDate(ymd(new Date(n.updated_at || n.created_at)))}</div></div>`).join("")}</div>`;
  return h;
}

// Pagine che appartengono a un modulo: se è spento si torna a Oggi
const PAGINA_MODULO = { turni: "turni", spese: "spese", liste: "liste", ricorrenti: "ricorrenti" };
function render() {
  applyCustom();
  headerUpdate();
  if (PAGINA_MODULO[state.tab] && !mod(PAGINA_MODULO[state.tab])) state.tab = "oggi";
  if (!mod("liste")) { if (state.todoFilter.startsWith("l:")) state.todoFilter = "tutte"; if (state.noteFilter.startsWith("l:")) state.noteFilter = "tutte"; }
  const v = ({ oggi: viewOggi, todo: viewTodo, agenda: viewAgenda, appunti: viewAppunti, liste: viewListe, ricorrenti: viewRicorrenti, turni: viewTurni, spese: viewSpese, menu: viewMenu }[state.tab] || viewOggi)();
  const el = $("#view");
  el.innerHTML = `<div class="view">${v}</div>`;
  document.querySelectorAll(".nav .tab, .nav .side").forEach((b) => b.classList.toggle("on", b.dataset.tab === state.tab));
  document.querySelectorAll(".nav .side-admin").forEach((b) => b.classList.toggle("hidden", !isAdmin));
  // voci della barra laterale: solo con account (online-only) e/o solo se il modulo è acceso (data-mod)
  document.querySelectorAll(".nav .online-only, .nav [data-mod]").forEach((b) => b.classList.toggle("hidden", (b.classList.contains("online-only") && !ONLINE_MODE) || (!!b.dataset.mod && !mod(b.dataset.mod))));
}

/* =========================================================
   FOGLIO DI MODIFICA (nuovo / modifica)
   ========================================================= */
let draft = null, advanced = false;

/* Mentre una finestra è aperta la pagina sotto resta ferma (su telefono):
   niente scorrimenti "a catena" né pagina che si sposta quando si apre la tastiera. */
let bloccoY = null;
const telefono = () => !matchMedia("(min-width:1024px)").matches;
function bloccaPagina() {
  if (bloccoY !== null || !telefono()) return;
  bloccoY = scrollY;
  Object.assign(document.body.style, { position: "fixed", top: -bloccoY + "px", left: "0", right: "0", width: "100%" });
}
function sbloccaPagina() {
  if (bloccoY === null) return;
  const y = bloccoY; bloccoY = null;
  Object.assign(document.body.style, { position: "", top: "", left: "", right: "", width: "" });
  window.scrollTo(0, y);
}
function openSheet(html) {
  $("#sheet").innerHTML = `<div class="grab"></div><button class="sheet-x" data-act="close" aria-label="Chiudi">✕</button>${html}`;
  $("#sheet").scrollTop = 0;
  bloccaPagina(); sheetSuTastiera();
  $("#scrim").classList.add("on"); $("#sheet").inert = false; $("#sheet").classList.add("on"); document.body.classList.add("sheet-open");
}
function closeSheet() {
  const sh = $("#sheet");
  if (sh.contains(document.activeElement)) document.activeElement.blur();
  $("#scrim").classList.remove("on"); sh.classList.remove("on"); sh.inert = true; document.body.classList.remove("sheet-open"); draft = null;
  sbloccaPagina();
  if (askResolve) { const r = askResolve; askResolve = null; r(null); }
  // finestre automatiche in attesa (novità, invito alla Home): una alla volta, dopo questa
  if (sheetQueue.length) { const next = sheetQueue.shift(); setTimeout(next, 450); }
}
// Le finestre che si aprono da sole aspettano il loro turno invece di andare perse
const sheetQueue = [];
function whenSheetFree(fn) {
  if ($("#sheet").classList.contains("on")) sheetQueue.push(() => whenSheetFree(fn)); else fn();
}

/* -------- conferme e domande dentro l'app (al posto delle finestre del browser) -------- */
let askResolve = null;
function ask({ title, text = "", ok = "Conferma", danger = false, input = false, value = "", placeholder = "", maxlength = 40, inputmode = "" }) {
  return new Promise((resolve) => {
    if (askResolve) { const r = askResolve; askResolve = null; r(null); }
    openSheet(`<h2><span class="mbox">${mascot()}</span>${esc(title)}</h2>
      ${text ? `<p style="margin:0 0 14px;color:var(--ink2);white-space:pre-line">${esc(text)}</p>` : ""}
      ${input ? `<div class="field"><input class="input big" id="askInput" maxlength="${maxlength}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off"${inputmode === "decimal" ? ' inputmode="decimal"' : ""}></div>` : ""}
      <div class="actions"><button class="btn" data-act="ask-cancel">Annulla</button>
        <button class="btn ${danger ? "danger-full" : "primary"}" data-act="ask-ok">${esc(ok)}</button></div>`);
    askResolve = resolve;
    const i = $("#askInput");
    if (i) {
      setTimeout(() => i.focus(), 250);
      i.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); finishAsk(true); } });
    }
  });
}
function finishAsk(confirmed) {
  const r = askResolve;
  if (!r) return;
  askResolve = null;
  const i = $("#askInput");
  const val = confirmed ? (i ? i.value : true) : null;
  closeSheet();
  r(val);
}

function openEditor(it, isNew) {
  // _autoRemind: il promemoria lo sceglie Mochi finché l'utente non lo cambia a mano
  // la lista da spuntare è copiata: "Annulla" non deve toccare la voce vera
  draft = { ...it, sottotask: cleanSottotask(it.sottotask), _new: isNew, _autoRemind: isNew || !it.due_date };
  advanced = !isNew || draft.kind === "note";
  drawEditor();
  setTimeout(() => { const i = $("#fTitle"); if (i && isNew) i.focus(); }, 250);
}

function drawEditor() {
  const d = draft;
  const kindBtn = (k, l) => `<button class="${d.kind === k ? "on" : ""}" data-act="d-kind" data-v="${k}">${l}</button>`;
  const areaBtn = (k, l, c) => `<button class="${c} ${d.area === k ? "on" : ""}" data-act="d-area" data-v="${k}">${l}</button>`;
  const isNote = d.kind === "note";
  openSheet(`
    <h2><span class="mbox">${mascot()}</span>${d._new ? "Cosa ti ricordo?" : "Modifica"}</h2>
    <div class="seg">${kindBtn("todo", `<span class=e><span class="emo">✅</span><svg class="ico q" aria-hidden="true"><use href="#i-todo"/></svg></span>Da fare`)}${kindBtn("event", `<span class=e><span class="emo">📅</span><svg class="ico q" aria-hidden="true"><use href="#i-agenda"/></svg></span>Appuntamento`)}${kindBtn("note", `<span class=e><span class="emo">📝</span><svg class="ico q" aria-hidden="true"><use href="#i-appunti"/></svg></span>Appunto`)}</div>
    <div class="field">
      <input class="input big" id="fTitle" maxlength="300" placeholder="${isNote ? "Titolo dell'appunto" : "Es. dentista giovedì alle 17"}" value="${esc(d.title)}" autocomplete="off" enterkeyhint="done">
      ${d._new && !isNote ? `<div class="hint" id="fHint">Scrivi come parli: oggi, domani, venerdì, 12/11, alle 15, #lavoro</div>` : ""}
    </div>
    <div class="field"><div class="areas">${areaBtn("personale", '<span class="emo">🌷 </span>Personale', "per")}${areaBtn("lavoro", '<span class="emo">💼 </span>Lavoro', "lav")}</div></div>
    ${listeUsate().length ? `<div class="field"><label>Dove</label><select class="input" id="fLista">
      <option value="" ${d.lista_id && d.user_id && d.user_id !== myId() ? "disabled" : ""}>🔒 Solo mia</option>${state.liste.map((l) => `<option value="${esc(l.id)}" ${d.lista_id === l.id ? "selected" : ""}>${esc(l.emoji)} ${esc(l.nome)} · condivisa</option>`).join("")}</select></div>` : ""}
    ${!advanced ? `<div class="more-row"><button class="more" data-act="d-more">+ Data, promemoria e note</button><button class="more" data-act="d-lista">+ Lista da spuntare</button></div>` : `
      ${!isNote ? `<div class="row">
        <div class="field"><label>Giorno</label><input class="input" type="date" id="fDate" value="${d.due_date || ""}"></div>
        <div class="field"><label>Ora</label><input class="input" type="time" id="fTime" value="${d.due_time || ""}"></div>
      </div>
      <div class="field"><label>Promemoria 🔔</label><select class="input" id="fRemind">${REMIND_OPTS.map(([v, l]) => `<option value="${v}" ${String(d.remind) === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>` : `
      <div class="field"><label>Colore</label><div class="colors">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((c) => `<button class="note c${c} ${+d.color === c ? "on" : ""}" data-act="d-color" data-v="${c}" aria-label="Colore ${c}"></button>`).join("")}</div></div>
      <div class="field"><button class="pin-toggle ${d.pinned ? "on" : ""}" data-act="d-pin"><span class="e">📌</span><span><b>${d.pinned ? "Fissato in alto" : "Fissa in alto"}</b><small>Resta sempre in cima agli appunti</small></span><span class="sw2"></span></button></div>`}
      <div class="field"><label>Lista da spuntare</label><div class="st-ed" id="stBox">${stEditorHtml()}</div></div>
      <div class="field"><label>${isNote ? "Testo" : "Note"}</label><textarea class="input" id="fBody" maxlength="20000" placeholder="${isNote ? "Scrivi qui..." : "Dettagli, indirizzo, cosa portare..."}">${esc(d.body || "")}</textarea></div>
    `}
    <div class="actions">
      ${!d._new ? `<button class="btn danger" data-act="d-delete">🗑</button>` : ""}
      <button class="btn" data-act="close">Annulla</button>
      <button class="btn primary" data-act="d-save">Salva</button>
    </div>`);
  const t = $("#fTitle");
  t.addEventListener("input", () => { if (!draft) return; draft.title = t.value; previewParse(); });
  t.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveDraft(); } });
  ["fDate", "fTime", "fRemind", "fBody", "fLista"].forEach((id) => {
    const el = $("#" + id); if (!el) return;
    el.addEventListener("input", () => {
      if (!draft) return;
      if (id === "fDate") draft.due_date = el.value || null;
      if (id === "fTime") draft.due_time = el.value || null;
      if (id === "fRemind") { draft.remind = el.value; draft._remindManual = true; draft._autoRemind = false; }
      // Data o ora cambiate: se il promemoria non l'ha scelto lei, lo aggiorno io
      if ((id === "fDate" || id === "fTime") && draft._autoRemind && !draft._remindManual && draft.kind !== "note") {
        draft.remind = defaultRemind(draft);
        const sel = $("#fRemind"); if (sel) sel.value = draft.remind;
      }
      if (id === "fBody") draft.body = el.value;
      if (id === "fLista") draft.lista_id = el.value || null;
    });
  });
  const box = $("#stBox");
  if (box) {
    // rinominare una voce: si scrive direttamente nella riga
    box.addEventListener("input", (e) => { const i = e.target.closest(".st-in[data-sid]"); const x = i && draft?.sottotask.find((s) => s.id === i.dataset.sid); if (x) x.t = i.value; });
    box.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.isComposing) return;
      if (e.target.id === "stNew") { e.preventDefault(); aggiungiSt(e.target.value); }
      else if (e.target.matches(".st-in[data-sid]")) { e.preventDefault(); $("#stNew")?.focus(); }
    });
  }
  previewParse();
}
/* Lista da spuntare nell'editor: si ridisegna solo lei (la finestra non salta e il cursore resta dov'è) */
function stEditorHtml() {
  const st = draft?.sottotask || [], fatti = st.filter((x) => x.f).length;
  return `${st.map((x, i) => `<div class="st-row ${x.f ? "fatto" : ""}">
      <button class="st-check" data-act="st-toggle" data-v="${esc(x.id)}" aria-label="${x.f ? "Togli la spunta" : "Spunta"}">${x.f ? "✓" : ""}</button>
      <input class="st-in" data-sid="${esc(x.id)}" value="${esc(x.t)}" maxlength="120" autocomplete="off" enterkeyhint="next" aria-label="Voce ${i + 1}">
      <button class="st-btn" data-act="st-su" data-v="${esc(x.id)}" aria-label="Sposta su" ${i ? "" : "disabled"}>↑</button>
      <button class="st-btn" data-act="st-del" data-v="${esc(x.id)}" aria-label="Togli">✕</button></div>`).join("")}
    ${st.length < MAX_ST ? `<div class="st-row nuovo"><span class="st-plus">+</span><input class="st-in" id="stNew" maxlength="120" placeholder="${st.length ? "Aggiungi un'altra e premi Invio" : "Es. latte, uova... e premi Invio"}" autocomplete="off" enterkeyhint="enter" aria-label="Nuova voce"></div>` : `<p class="hint">Massimo ${MAX_ST} voci.</p>`}
    ${st.length ? `<div class="st-prog">${fatti}/${st.length} fatte</div>` : ""}`;
}
function drawSt(focusNew = false) {
  const box = $("#stBox"); if (!box || !draft) return;
  box.innerHTML = stEditorHtml();
  if (focusNew) { const n = $("#stNew"); if (n) { n.focus(); n.scrollIntoView({ block: "nearest" }); } }
}
function aggiungiSt(v) {
  const t = taglia(String(v || "").replace(/\s+/g, " ").trim(), 120);
  if (!t || !draft) return;
  if (draft.sottotask.length >= MAX_ST) { toast(`Massimo ${MAX_ST} voci`); return; }
  draft.sottotask.push({ id: nuovoStId(new Set(draft.sottotask.map((x) => x.id))), t, f: false });
  drawSt(true);
}

function previewParse() {
  const h = $("#fHint"); if (!h || !draft._new || draft.kind === "note") return;
  const p = parseQuick(draft.title || "");
  if (!draft.title) { h.innerHTML = "Scrivi come parli: oggi, domani, venerdì, 12/11, alle 15, #lavoro"; return; }
  const bits = [];
  if (p.date) bits.push(`📅 <b>${niceDate(p.date)}</b>`);
  if (p.time) bits.push(`🕐 <b>${p.time}</b>`);
  if (p.area) bits.push(p.area === "lavoro" ? "💼 <b>Lavoro</b>" : "🌷 <b>Personale</b>");
  h.innerHTML = bits.length ? `Ho capito: ${bits.join(" · ")}` : "&nbsp;";
}

async function saveDraft() {
  if (!draft) return;
  // una voce scritta nella lista ma senza premere Invio non va persa
  const sn = $("#stNew"); if (sn && sn.value.trim() && draft.sottotask.length < MAX_ST) draft.sottotask.push({ id: nuovoStId(new Set(draft.sottotask.map((x) => x.id))), t: taglia(sn.value.trim(), 120), f: false });
  const d = { ...draft };
  const t = $("#fTitle"); if (t) d.title = t.value;
  // Interpreta il testo rapido solo per le nuove voci (senza sovrascrivere scelte manuali)
  if (d._new && d.kind !== "note") {
    const p = parseQuick(d.title || "");
    if (p.title) d.title = p.title;
    if (p.date && !d._dateManual) d.due_date = d.due_date || p.date;
    if (p.time) d.due_time = d.due_time || p.time;
    if (p.area) d.area = p.area;
    if (p.time && d.kind === "todo" && !d._kindManual) d.kind = "event";
    if (!d._remindManual && (d.remind === undefined || d.remind === "auto" || (d._autoRemind && d.remind === "none"))) d.remind = defaultRemind(d);
  }
  if (!d.title || !d.title.trim()) { toast("Scrivi almeno il titolo 🍙"); return; }
  d.title = d.title.trim().slice(0, 300);
  d.body = String(d.body || "").slice(0, 20000);
  d.sottotask = cleanSottotask(d.sottotask);
  if (d.due_time && !RE_TIME.test(d.due_time)) d.due_time = null;
  if (d.due_date && (!validYmd(d.due_date) || d.due_date < "2000-01-01" || d.due_date > "2100-12-31")) { toast("Data non valida 📅"); return; }
  if (!d.due_date) d.due_time = null;
  if (d.kind === "note") { d.due_date = null; d.due_time = null; d.remind = "none"; }
  if (d.remind === "auto") d.remind = "none";
  const prevRemind = state.items.find((x) => x.id === d.id)?.remind_at;
  d.remind_at = computeRemind(d);
  if (d.remind_at !== prevRemind) d.reminded = false;
  d.updated_at = new Date().toISOString();
  const isNew = d._new;
  if (isNew && d.kind === "note") { const pos = state.items.filter((i) => i.kind === "note" && i.posizione != null).map((i) => i.posizione); if (pos.length) d.posizione = Math.min(...pos) - 1000; }
  Object.keys(d).filter((k) => k.startsWith("_")).forEach((k) => delete d[k]);
  const i = state.items.findIndex((x) => x.id === d.id);
  i >= 0 ? (state.items[i] = d) : state.items.push(d);
  closeSheet(); render();
  await store.save(d);
  if (isNew) {
    setTimeout(() => cheer(1200), 250);
    toast(d.kind === "note" ? "Appunto salvato 📝" : d.due_date ? `Fatto! Te lo ricordo ${niceDate(d.due_date).toLowerCase()}${d.due_time ? " alle " + d.due_time : ""} 🌸` : "Salvato! 🍣");
    if (d.remind_at && ONLINE_MODE) maybeAskPush();
  }
}

function newItem(extra = {}) {
  const kind = state.tab === "appunti" ? "note" : "todo";
  return {
    id: uid(), kind, title: "", body: "", area: state.todoFilter === "lavoro" || state.noteFilter === "lavoro" ? "lavoro" : "personale",
    due_date: null, due_time: null, remind: "auto", remind_at: null, reminded: false, done: false, done_at: null,
    lista_id: state.tab === "todo" && state.todoFilter.startsWith("l:") ? state.todoFilter.slice(2) : state.tab === "appunti" && state.noteFilter.startsWith("l:") ? state.noteFilter.slice(2) : null,
    color: 1 + Math.floor(Math.random() * 5), pinned: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...extra
  };
}

/* =========================================================
   RECAP MENSILE
   ========================================================= */
function openRecap(month) {
  const m = month || new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  state.recapMonth = m;
  const key = monthKey(m);
  const inM = (iso) => iso && monthKey(new Date(iso)) === key;
  const done = state.items.filter((i) => i.kind === "todo" && i.done && inM(i.done_at));
  const events = state.items.filter((i) => i.kind === "event" && i.due_date && i.due_date.startsWith(key));
  const notes = state.items.filter((i) => i.kind === "note" && inM(i.created_at));
  const all = [...done, ...events];
  const lav = all.filter((i) => i.area === "lavoro").length;
  const per = all.length - lav;
  const pLav = all.length ? Math.round((lav / all.length) * 100) : 50;
  const wd = [0, 0, 0, 0, 0, 0, 0];
  done.forEach((i) => wd[new Date(i.done_at).getDay()]++);
  const best = done.length ? GIORNI[wd.indexOf(Math.max(...wd))] : null;
  const total = done.length + events.length;
  const say = total === 0 ? "Un mese tranquillo. Anche il riposo conta 🍵"
    : total < 10 ? "Un mese leggero ma pieno di cose belle 🌸"
    : total < 30 ? "Che mese! Hai tenuto tutto sotto controllo 💪"
    : `Mese da campionessa. ${MN()} ti offre un sushi immaginario 🍣🏆`;
  const isCur = key === monthKey(new Date());
  openSheet(`
    <div class="calhead" style="margin-bottom:12px">
      <button class="iconbtn" data-act="recap-move" data-v="-1">‹</button>
      <span class="fred" style="font-size:15px;color:var(--ink2)">Recap mensile</span>
      <button class="iconbtn" data-act="recap-move" data-v="1" ${isCur ? "disabled style='opacity:.3'" : ""}>›</button>
    </div>
    <div class="recap">
      <div class="mbox">${mascot("happy")}</div>
      <h2 class="fred">Il tuo ${MESI[m.getMonth()]}${isCur ? " (finora)" : ""}</h2>
      <div class="say">${say}</div>
      <div class="grid">
        <div class="cell"><b>${done.length}</b><span>cose completate ✅</span></div>
        <div class="cell"><b>${events.length}</b><span>appuntamenti 📅</span></div>
        <div class="cell"><b>${notes.length}</b><span>appunti scritti 📝</span></div>
        <div class="cell"><b style="font-size:${best ? 20 : 28}px;padding:4px 0">${best ? best : "-"}</b><span>giorno più produttivo ⭐</span></div>
      </div>
    </div>
    ${(() => { const nb = mod("pancino") ? bocconcini().filter((i) => inM(i.done_at)).length : 0; return nb ? `<div class="bubble" style="margin:12px 0 0;text-align:center">Questo mese hai dato a ${esc(MN())} <b>${nb} ${nb === 1 ? "bocconcino" : "bocconcini"}</b> ${cibo(key)}</div>` : ""; })()}
    ${turniAttivi() ? (() => { const o = oreMese(m); return o.turni ? `<div class="bubble" style="margin:12px 0 0;text-align:center">💼 Hai lavorato <b>${fmtOre(o.min)}</b> in ${o.turni} ${o.turni === 1 ? "turno" : "turni"}</div>` : ""; })() : ""}
    ${mod("spese") ? (() => { const sp = totaleMese(m); return sp ? `<div class="bubble" style="margin:12px 0 0;text-align:center">👛 Hai speso <b>${euro(sp)}</b>${state.spese.budget ? (sp > state.spese.budget ? `, ${euro(sp - state.spese.budget)} oltre il budget` : `, dentro il budget`) : ""}</div>` : ""; })() : ""}
    ${mod("umore") ? `<div class="sec"><h2>Il giardino del mese</h2></div>${giardinoSvg(m)}` : ""}
    ${all.length ? `<div class="sec"><h2>Lavoro e vita</h2></div>
      <div class="bar2"><i style="width:${pLav}%;background:var(--lav-d)"></i><i style="width:${100 - pLav}%;background:var(--pink)"></i></div>
      <div class="legend"><span><span class="emo">💼 </span>Lavoro ${lav}</span><span><span class="emo">🌷 </span>Personale ${per}</span></div>` : ""}
    ${done.length ? `<div class="sec"><h2>Cose che hai portato a casa</h2></div>
      <div class="list">${done.sort((a, b) => b.done_at.localeCompare(a.done_at)).slice(0, 10).map((i) => `<div class="item ${i.area} done" style="opacity:1"><span class="check">✓</span><div class="body"><div class="t" style="text-decoration:none">${esc(i.title)}</div></div></div>`).join("")}</div>` : ""}
    <div class="actions" style="margin-top:16px"><button class="btn primary" data-act="close">Grazie ${MN()} 💗</button></div>`);
  if (total >= 5) setTimeout(() => confetti(window.innerWidth / 2, window.innerHeight * .35, 40), 350);
}

function maybeAutoRecap() {
  const now = new Date();
  if (now.getDate() > 7) return;
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const k = monthKey(prev);
  if (LS.get("mochi.recapSeen", "") === k) return;
  const has = state.items.some((i) => (i.done_at && monthKey(new Date(i.done_at)) === k) || (i.due_date && i.due_date.startsWith(k)));
  if (!has) return;
  LS.set("mochi.recapSeen", k);
  setTimeout(() => openRecap(prev), 600);
}

/* =========================================================
   IMPOSTAZIONI E NOTIFICHE
   ========================================================= */
function openSettings() {
  const perm = "Notification" in window ? Notification.permission : "unsupported";
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const theme = document.documentElement.dataset.theme || "auto";
  openSheet(`
    <h2><span class="mbox">${mascot()}</span>Impostazioni</h2>
    <div class="setrow" id="pushRow">${pushRowHtml(!ONLINE_MODE ? "offline" : !PUSH_READY ? "soon" : perm === "unsupported" ? (!standalone && /iPhone|iPad/.test(navigator.userAgent) ? "home" : "unsupported") : perm === "denied" ? "denied" : "checking")}</div>
    <div class="setrow"><div><b>Nome e mascotte</b><small>${esc(CUSTOM.nome_app)} · ${esc(MN())}</small></div><button class="fbtn on" data-act="open-custom">Cambia</button></div>
    <div class="setrow col" id="setModuli"><div><b>Cosa vuoi usare</b><small>Quello che spegni sparisce dappertutto, ma i dati restano${ONLINE_MODE ? " · su tutti i tuoi dispositivi" : ""}</small></div>
      <div class="moduli">${MODULI.filter((m) => !m[5] || ONLINE_MODE).map(([k, e, n, d]) => `<button class="pin-toggle ${mod(k) ? "on" : ""}" data-act="modulo" data-v="${k}" aria-pressed="${mod(k)}"><span class="e">${e}</span><span><b>${n}</b><small>${d}</small></span><span class="sw2"></span></button>`).join("")}</div>
      ${mod("stagioni") ? `<div class="stag-scelta"><small>Che tempo fa sullo sfondo?</small><div class="filters" style="flex-wrap:wrap">${STAGIONI.map(([k, e, n]) => `<button class="fbtn ${CUSTOM.stagione === k ? "on" : ""}" data-act="pick-stagione" data-v="${k}">${e} ${n}</button>`).join("")}</div>${menoMoto() ? `<small>Il tuo dispositivo chiede meno animazioni: l'effetto resta fermo.</small>` : ""}</div>` : ""}</div>
    <div class="setrow col" id="setSuoni"><div><b>Suoni</b><small>Quando arriva un promemoria ad app aperta, quando spunti una cosa fatta e quando apri il biscotto. Tocca per sentirli.</small></div>
      <div class="suoni">${SUONI.map(([k, e, n]) => `<button class="${CUSTOM.suono === k ? "on" : ""}" data-act="pick-suono" data-v="${k}" aria-pressed="${CUSTOM.suono === k}"><span class="sw">${e}</span><small>${n}</small></button>`).join("")}</div></div>
    <div class="setrow"><div><b>Chiaro o scuro</b><small>Automatico segue il telefono</small></div>
      <select class="input" style="width:auto;padding:8px 12px" id="themeSel">
        <option value="auto" ${theme === "auto" ? "selected" : ""}>Auto</option><option value="light" ${theme === "light" ? "selected" : ""}>Chiaro</option><option value="dark" ${theme === "dark" ? "selected" : ""}>Scuro</option></select></div>
    <div class="setrow col"><div><b>Stile</b><small>Cambia l'aspetto di tutta l'app${ONLINE_MODE ? " · su tutti i tuoi dispositivi" : ""}</small></div>
      <div class="stili">${STILI.map(([id, nome, d]) => `<button class="stile-${id} ${CUSTOM.stile === id ? "on" : ""}" data-act="pick-stile" data-v="${id}"><span class="anteprima"><i></i><i></i><i></i></span><b>${nome}</b><small>${d}</small></button>`).join("")}</div></div>
    <div class="setrow col"><div><b>Colori</b><small>${esc(PALETTE.find((x) => x[0] === CUSTOM.colore)[1])}${ONLINE_MODE ? " · su tutti i tuoi dispositivi" : ""}</small></div>
      <div class="palettes">${PALETTE.map(([id, nome, a, b, e]) => `<button class="${CUSTOM.colore === id ? "on" : ""}" data-act="pick-palette" data-v="${id}" aria-label="${nome}" title="${nome}"><span class="sw" style="background:linear-gradient(145deg,${a}55,${b}88)">${e}</span><small>${nome}</small></button>`).join("")}</div></div>
    <div class="setrow col"><div><b>Carattere</b><small>${esc(FONTI.find((x) => x[0] === CUSTOM.font)[1])}${ONLINE_MODE ? " · su tutti i tuoi dispositivi" : ""}</small></div>
      <div class="fonts">${FONTI.map(([id, nome, fam]) => `<button class="${CUSTOM.font === id ? "on" : ""}" data-act="pick-font" data-v="${id}"><span class="aa" style="font-family:${fam}">Aa</span><small>${nome}</small></button>`).join("")}</div></div>
    <div class="setrow"><div><b>Recap mensile</b><small>Il riassunto del mese con ${MN()}</small></div><button class="fbtn" data-act="open-recap">Apri</button></div>
    <div class="setrow"><div><b>Backup</b><small>Scarica tutte le tue cose in un file</small></div><button class="fbtn" data-act="export">Scarica</button></div>
    ${ONLINE_MODE ? `<div class="setrow"><div><b>Il tuo nome</b><small>${esc(NOME || "Non impostato")} · ${esc(store.user?.email || "")}</small></div><button class="fbtn" data-act="set-name">Cambia</button></div>
    <div class="setrow"><div><b>Esci</b><small>Su questo dispositivo</small></div><button class="fbtn" data-act="logout">Esci</button></div>
    <div class="setrow"><div><b>Privacy</b><small>Come vengono trattati i tuoi dati</small></div><a class="fbtn" style="text-decoration:none" href="privacy.html">Leggi</a></div>
    <div class="setrow"><div><b style="color:#c0394e">Elimina account</b><small>Cancella per sempre account e dati</small></div><button class="fbtn" style="color:#c0394e" data-act="delete-account">Elimina</button></div>` :
    `<div class="setrow"><div><b>Modalità prova</b><small>I dati restano solo su questo dispositivo</small></div></div>`}
    <div class="actions"><button class="btn" data-act="close">Chiudi</button></div>`);
  $("#themeSel").addEventListener("change", (e) => setTheme(e.target.value));
  if (PUSH_READY && (perm === "granted" || perm === "default")) refreshPushRow();
}

/* Stato dei promemoria su QUESTO dispositivo.
   Conta l'iscrizione alle notifiche, non il permesso del browser: il permesso
   un sito non può toglierlo da solo, l'iscrizione sì (ed è quella che usa il server). */
function pushRowHtml(s) {
  const txt = {
    offline: "Disponibili dopo aver collegato Supabase",
    soon: "In arrivo: le notifiche non sono ancora attive 🌸",
    home: "Prima aggiungi l'app alla Home",
    unsupported: "Questo browser non supporta le notifiche",
    denied: "Bloccate: riattivale dalle impostazioni del browser o del telefono",
    checking: "Controllo in corso...",
    on: "Attivi su questo dispositivo ✅",
    off: "Ricevi una notifica all'orario giusto",
  }[s];
  const btn = s === "on" ? `<button class="fbtn" data-act="disable-push">Disattiva</button>`
    : s === "off" ? `<button class="fbtn on" data-act="enable-push">Attiva</button>` : "";
  return `<div><b>Promemoria</b><small>${txt}</small></div>${btn}`;
}
async function pushActive() {
  try {
    const reg = await navigator.serviceWorker?.ready;
    return !!(await reg?.pushManager?.getSubscription()) && Notification.permission === "granted";
  } catch { return false; }
}
async function refreshPushRow() {
  const on = await pushActive();
  const row = $("#pushRow");
  if (row) row.innerHTML = pushRowHtml(on ? "on" : "off");
}
// All'avvio: se questo dispositivo ha già le notifiche attive, riconferma l'iscrizione al server.
// Ripara i casi in cui il database l'ha persa (es. account cambiato, pulizia delle iscrizioni scadute).
async function resyncPush() {
  if (!PUSH_READY || !("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const reg = await navigator.serviceWorker?.ready;
    const sub = await reg?.pushManager?.getSubscription();
    if (sub) await store.savePush(sub);
  } catch (e) { console.warn("Promemoria: riconferma non riuscita", e); }
}
async function disablePush() {
  const ok = await ask({ title: "Disattivare i promemoria?", text: "Su questo dispositivo non arriveranno più notifiche. Gli altri dispositivi non cambiano e puoi riattivarli quando vuoi.", ok: "Disattiva" });
  if (!ok) { openSettings(); return; }
  await store.dropPush();
  toast("Promemoria disattivati su questo dispositivo 🔕");
  openSettings();
}
function setTheme(v) {
  if (v === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = v;
  LS.set("mochi.theme", v);
  syncBarColor();
}
// Riapre le impostazioni dopo una scelta senza tornare in cima alla finestra
function riapriImpostazioni() { const y = $("#sheet").scrollTop; openSettings(); $("#sheet").scrollTop = y; }

function b64ToU8(b64) {
  const p = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + p).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
async function enablePush() {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) { toast("Su iPhone: Condividi > Aggiungi a Home, poi apri da lì 📲"); return; }
    if (!CFG.VAPID_PUBLIC_KEY) { toast("Manca la chiave VAPID in config.js"); return; }
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { toast("Notifiche non autorizzate"); return; }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(CFG.VAPID_PUBLIC_KEY) });
    await store.savePush(sub);
    toast("Promemoria attivi 🔔");
    closeSheet();
  } catch (e) { console.error(e); toast("Non sono riuscita ad attivarli: " + (e.message || e)); }
}
/* iPhone: Safari non permette ai siti di installarsi da soli (su Mac/Android sì).
   Il massimo possibile è spiegare i due tocchi, una volta, e riproporlo dopo una settimana. */
function maybeShowInstallHint() {
  const ios = /iPhone|iPod/.test(navigator.userAgent) || (/iPad/.test(navigator.userAgent));
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if (!ios || standalone) return;
  const last = LS.get("mochi.installHint", 0);
  if (Date.now() - last < 7 * 864e5) return;
  setTimeout(() => whenSheetFree(() => {
    if (Date.now() - LS.get("mochi.installHint", 0) < 7 * 864e5) return;
    LS.set("mochi.installHint", Date.now());
    openSheet(`<h2><span class="mbox">${mascot()}</span>Mettimi nella Home!</h2>
      <p style="margin:0 0 12px;color:var(--ink2)">Così mi apri con un tocco, come un'app vera, e posso mandarti i promemoria.</p>
      <ol style="margin:0 0 16px;padding-left:20px;line-height:1.7">
        <li>Tocca <b>Condividi</b> <span aria-hidden="true">⬆️</span> nella barra di Safari</li>
        <li>Scegli <b>Aggiungi alla schermata Home</b></li>
        <li>Poi aprimi da lì ed entra con il tuo account 🌸</li>
      </ol>
      <div class="actions"><button class="btn primary" data-act="close">Ho capito</button></div>`);
  }), 1500);
}

/* Novità: si mostrano dopo un aggiornamento, a chi usava già l'app.
   Per annunciare qualcosa basta aggiungere un punto in cima, con un nome nuovo. */
// Ogni novità ha un suo nome: a chi riapre l'app si mostrano solo quelle che non ha ancora visto.
// Le nuove vanno in cima. Il quarto valore (se c'è) è il modulo: se è spento, la novità non si mostra.
const NOVITA = {
  titolo: "Novità in Mochi!",
  punti: [
    ["spese", "👛", "<b>Spese</b>: segna quanto spendi in pochi tocchi, guarda il totale del mese per categoria e, se vuoi, un budget mensile. Le trovi nel menu.", "spese"],
    ["sottotask", "☑️", "<b>Liste da spuntare</b> dentro le cose da fare e gli appunti, perfette per la spesa: le spunti anche senza aprire la voce, e nelle liste condivise le vedete tutte."],
    ["moduli", "🧩", "<b>Cosa vuoi usare</b>: in Impostazioni puoi spegnere quello che non ti serve (turni, spese, umore...). Sparisce dall'app, ma i dati restano."],
    ["suoni", "🔔", "<b>Suoni</b>: un piccolo suono quando spunti una cosa fatta, apri il biscotto o arriva un promemoria ad app aperta. Scegli quale (o spegnili) in Impostazioni."],
    ["stagioni", "❄️", "<b>Stagioni</b>: neve, pioggia, sole, foglie o petali sullo sfondo. Da accendere in Impostazioni → Cosa vuoi usare."],
    ["emoji-ric", "🍝", "<b>Nuovi simboli</b> per i promemoria ricorrenti: piatto di pasta, tè, nanna, piante, telefono e tanti altri.", "ricorrenti"],
    ["finestre", "👆", "Le finestre ora <b>restano ferme</b> mentre scrivi o scorri: si chiudono trascinando giù dalla parte in alto."],
    ["risposte", "💌", "<b>Risposte ai tuoi consigli</b>: quando la sviluppatrice legge o realizza una tua idea, lo vedi in Consiglia e ti arriva una notifica."],
    ["turni", "💼", "<b>Turni di lavoro</b>: segna i tuoi turni, imposta un ciclo che si ripete da solo e guarda quante ore hai lavorato nel mese. Li trovi nel menu.", "turni"],
    ["bacheca-mobile", "📌", "<b>La bacheca di sughero</b> ora c'è anche sul telefono, e i post-it non spariscono più."],
    ["trascina-note", "✋", "<b>Sposta i post-it</b> come vuoi: dal computer trascinali, dal telefono tienili premuti un attimo e poi trascina."],
    ["fiori-passati", "🌼", "<b>Giardino del mese</b>: tocca un fiore per cambiare com'è andata quella giornata.", "umore"],
    ["q1", "🌷", "<b>Com'è andata la giornata?</b>: ogni giorno una faccina colora il calendario, e a fine mese diventa il giardino del mese.", "umore"],
    ["q2", "🥠", "<b>Il biscotto della fortuna</b>: ogni mattina, alla prima apertura, c'è un biscotto da aprire con la frase del giorno.", "biscotto"],
    ["q3", "📓", "<b>Nuovo stile Quaderno</b> da provare: carta puntinata, titoli scritti a mano ed etichette di carta. In Impostazioni → Stile."],
    ["q4", "🐾", "<b>12 nuove mascotte</b>: gattino, panda, coniglietta, pulcino, tartaruga, canguro, riccio, capibara, marimo, axolotl, lontra e cavallino. In Impostazioni → Nome e mascotte."],
    ["q5", "☰", "<b>Menu completo</b>: liste condivise, ricorrenti, recap e tutto il resto sono a portata di tocco dal pulsante ☰ in alto."],
    ["q6", "🔁", "<b>Promemoria ricorrenti</b>: bevi acqua ogni 2 ore, una pausa ogni ora... Li trovi in Impostazioni.", "ricorrenti"],
    ["q7", "🔤", "<b>Caratteri</b> e <b>12 colori</b> per gli appunti; da computer gli appunti stanno su una bacheca di sughero 📌"],
    ["q8", "👭", "<b>Liste condivise</b>: crea una lista come \"Casa\" o \"Spesa\", invita chi vuoi con un codice e la usate insieme. In Impostazioni.", "liste"],
    ["q9", "💌", "<b>Consiglia alla sviluppatrice</b>: idee, problemi o complimenti arrivano direttamente a chi ha creato l'app. Lo trovi in Impostazioni."],
    ["q10", "🎨", "<b>Colori</b>: Fragola, Matcha, Lavanda, Pesca e Cielo. Li trovi in Impostazioni."],
    ["q11", "🍣", "<b>Il pancino</b>: ogni cosa che spunti è un bocconcino per la mascotte, che si guadagna dei regali.", "pancino"],
    ["q12", "👇", "Le finestre si chiudono <b>trascinandole giù</b>."],
    ["q13", "👁️", "Con l'occhiolino puoi <b>vedere la password</b> mentre la scrivi."]
  ]
};
function maybeShowNovita() {
  const k = "mochi.novita.viste";
  let viste = LS.get(k, null);
  if (!Array.isArray(viste)) {
    // chi aveva già visto l'annuncio di novembre (vecchio sistema) ha già visto tutti i punti "q"
    viste = LS.get("mochi.novita", "") === "2026-11-quaderno" ? NOVITA.punti.filter((p) => p[0].startsWith("q")).map((p) => p[0]) : [];
  }
  // chi apre l'app per la prima volta non ha "novità": le scopre da sé
  if (!state.items.length) { LS.set(k, NOVITA.punti.map((p) => p[0])); return; }
  // quelle dei moduli spenti non si mostrano (e restano "viste": riaccendendo il modulo non spuntano vecchie notizie)
  const nuove = () => NOVITA.punti.filter((p) => !viste.includes(p[0]) && (!p[3] || mod(p[3])));
  if (!nuove().length) { LS.set(k, NOVITA.punti.map((p) => p[0])); return; }
  setTimeout(() => whenSheetFree(() => {
    const da = nuove(); if (!da.length) return;
    LS.set(k, NOVITA.punti.map((p) => p[0]));
    openSheet(`<h2><span class="mbox">${mascot("happy")}</span>${da.length === 1 ? "Una novità in Mochi!" : NOVITA.titolo}</h2>
      <div class="list" style="gap:10px;margin-bottom:16px">${da.map(([, e, t]) => `<div style="display:flex;gap:12px;align-items:flex-start"><span style="font-size:24px;line-height:1.2">${e}</span><span style="color:var(--ink2)">${t}</span></div>`).join("")}</div>
      <div class="actions"><button class="btn primary" data-act="close">Che bello!</button></div>`);
    setTimeout(() => cheer(), 300);
  }), 1300);
}

/* =========================================================
   LISTE CONDIVISE
   Le regole vere (chi vede cosa, chi entra, limiti) le applica il database:
   qui c'è solo l'interfaccia. Nomi di liste e persone li scrivono altri utenti: sempre esc().
   ========================================================= */
const myId = () => store.user?.id || null;
const listaById = (id) => state.liste.find((l) => l.id === id) || null;
// Liste da proporre nei filtri e nell'editor: nessuna se il modulo è spento (le voci condivise restano visibili)
const listeUsate = () => (mod("liste") ? state.liste : []);
const nomeMembro = (l, uid) => (l?.membri || []).find((m) => m.user_id === uid)?.nome || "qualcuno";
const EMOJI_LISTE = ["🏠", "🛒", "🍣", "✈️", "🎁", "🐶", "💼", "📚", "🌸", "🍳", "🎉", "💪"];
const RE_INVITO = /^[0-9A-Fa-f]{16}$/;
let listeT;
async function loadListe() {
  if (!ONLINE_MODE || !store.user) return;
  try {
    const raw = await store.liste();
    state.liste = raw.filter((l) => l && RE_ID.test(String(l.id))).map((l) => ({
      id: String(l.id), nome: str(l.nome).slice(0, 40) || "Lista", emoji: str(l.emoji).slice(0, 8) || "🏠",
      proprietaria: String(l.proprietaria || ""),
      membri: Array.isArray(l.membri) ? l.membri.filter((m) => m && RE_ID.test(String(m.user_id))).map((m) => ({ user_id: String(m.user_id), nome: str(m.nome).slice(0, 40) || "Senza nome" })) : []
    }));
    LS.set("mochi.liste", state.liste);
  } catch { state.liste = LS.get("mochi.liste", []); }
}
// Arriva una voce di una lista che non conosco (es. appena entrata da un altro dispositivo): ricarico le liste
function checkListeSconosciute() {
  if (state.items.some((i) => i.lista_id && !listaById(i.lista_id))) { clearTimeout(listeT); listeT = setTimeout(async () => { await loadListe(); render(); }, 800); }
}

// Pagina "Liste condivise" (nel menu, non nelle impostazioni)
function openListe() { if ($("#sheet").classList.contains("on")) closeSheet(); state.tab = "liste"; render(); window.scrollTo({ top: 0 }); }
function viewListe() {
  if (!ONLINE_MODE) return emptyBox("Le liste condivise funzionano quando l'app è collegata a un account 🌸");
  const me = myId();
  return `<div class="sec" style="margin-top:0"><h2><span class="emo">👭 </span>Liste condivise</h2></div>
    <p style="margin:0 0 12px;color:var(--ink2)">Tutto quello che metti in una lista lo vedono, modificano e spuntano tutte le persone della lista. Le altre tue cose restano private.</p>
    <div class="list">${state.liste.map((l) => `
      <div class="lcard">
        <div class="lcard-h"><span class="e">${esc(l.emoji)}</span><div><b>${esc(l.nome)}</b>
          <small>${l.membri.map((m) => esc(m.user_id === me ? "tu" : m.nome)).join(", ")}</small></div></div>
        <div class="msg-a">
          <button class="fbtn on" data-act="l-invita" data-id="${esc(l.id)}">Invita</button>
          <button class="fbtn" data-act="l-modifica" data-id="${esc(l.id)}">Modifica</button>
          <button class="fbtn" data-act="l-esci" data-id="${esc(l.id)}">Esci</button>
          ${l.proprietaria === me ? `<button class="fbtn" style="color:#c0394e" data-act="l-elimina" data-id="${esc(l.id)}">Elimina</button>` : ""}
        </div>
      </div>`).join("") || `<div class="empty" style="padding:8px">Ancora nessuna lista. Creane una, ad esempio "Casa" o "Spesa" 🛒</div>`}</div>
    <div class="actions" style="margin-top:14px"><button class="btn" data-act="l-codice">Ho un codice</button><button class="btn primary" data-act="l-nuova">+ Nuova lista</button></div>`;
}
let listaDraft = { id: null, nome: "", emoji: "🏠" };
function openListaEditor(l) {
  listaDraft = l ? { id: l.id, nome: l.nome, emoji: l.emoji } : { id: null, nome: "", emoji: "🏠" };
  drawListaEditor();
}
function drawListaEditor() {
  openSheet(`<h2><span class="mbox">${mascot()}</span>${listaDraft.id ? "Modifica lista" : "Nuova lista"}</h2>
    <div class="field"><label>Nome</label><input class="input big" id="lsNome" maxlength="40" placeholder="Casa, Spesa, Vacanze..." value="${esc(listaDraft.nome)}" autocomplete="off"></div>
    <div class="field"><label>Simbolo</label><div class="emojis">${EMOJI_LISTE.map((e) => `<button class="${listaDraft.emoji === e ? "on" : ""}" data-act="l-emoji" data-v="${e}">${e}</button>`).join("")}</div></div>
    <div class="actions"><button class="btn" data-act="l-indietro">Indietro</button><button class="btn primary" data-act="l-salva">Salva</button></div>`);
  const i = $("#lsNome"); i.addEventListener("input", () => { listaDraft.nome = i.value; });
}
async function salvaLista(btn) {
  const nome = listaDraft.nome.trim();
  if (!nome) { toast("Dai un nome alla lista 🌸"); return; }
  btn.disabled = true;
  try {
    if (listaDraft.id) await store.modificaLista(listaDraft.id, nome, listaDraft.emoji);
    else { const id = await store.creaLista(nome, listaDraft.emoji); toast(`Lista creata! Ora invita qualcuno ${listaDraft.emoji}`); listaDraft.id = id; }
    await loadListe(); render(); openListe();
  } catch (e) { btn.disabled = false; toast(/massimo/.test(e?.message || "") ? e.message : "Non sono riuscita a salvarla"); }
}

async function invita(id) {
  const l = listaById(id); if (!l) return;
  let code;
  try { code = await store.creaInvito(id); } catch (e) { toast(/10 persone|Troppi/.test(e?.message || "") ? e.message : "Non sono riuscita a creare l'invito"); return; }
  if (!RE_INVITO.test(String(code))) { toast("Invito non valido, riprova"); return; }
  const link = `${location.origin}${location.pathname}?invito=${code}`;
  const testo = `Ti invito nella lista ${l.emoji} ${l.nome} su ${CUSTOM.nome_app}! Apri questo link: ${link} (oppure inserisci il codice ${code})`;
  openSheet(`<h2><span class="mbox">${mascot("happy")}</span>Invito per ${esc(l.emoji)} ${esc(l.nome)}</h2>
    <p style="margin:0 0 10px;color:var(--ink2)">Mandalo alla persona che vuoi: vale <b>7 giorni</b> e si usa <b>una volta sola</b>. Chi lo riceve deve avere un account ${esc(CUSTOM.nome_app)}.</p>
    <div class="codice">${code.replace(/(.{4})/g, "$1 ").trim()}</div>
    <div class="actions" style="margin-top:14px">
      <button class="btn" data-act="l-copia">Copia</button>
      <button class="btn primary" data-act="l-condividi">Condividi 💌</button></div>`);
  invitoCorrente = { link, testo };
}
let invitoCorrente = null;
async function condividiInvito(copia) {
  if (!invitoCorrente) return;
  if (!copia && navigator.share) { try { await navigator.share({ text: invitoCorrente.testo }); return; } catch (e) { if (e?.name === "AbortError") return; } }
  try { await navigator.clipboard.writeText(invitoCorrente.testo); toast("Invito copiato! Incollalo dove vuoi 📋"); }
  catch { toast("Non riesco a copiarlo: copia il codice a mano"); }
}

// Entrare in una lista con un codice (dal link o scritto a mano)
async function proponiInvito(code) {
  code = String(code || "").replace(/\s+/g, "");
  if (!RE_INVITO.test(code)) { toast("Il codice non sembra giusto: sono 16 caratteri"); return; }
  let info;
  try { info = await store.anteprimaInvito(code); } catch (e) { toast(/Troppi/.test(e?.message || "") ? e.message : "Non riesco a controllare l'invito"); return; }
  if (!info) { toast("Invito non valido o scaduto 😕"); return; }
  if (info.gia_dentro) { toast(`Sei già nella lista ${str(info.emoji)} ${str(info.nome)}`); return; }
  const ok = await ask({ title: `${str(info.emoji)} ${str(info.nome)}`, text: `${str(info.da_chi)} ti invita nella sua lista condivisa. Tutte le persone della lista vedranno quello che c'è dentro; le altre tue cose restano private.`, ok: "Unisciti" });
  if (!ok) return;
  try {
    const id = await store.accettaInvito(code);
    if (!id) { toast("Invito non valido o scaduto 😕"); return; }
    await loadListe(); state.items = await store.list(); state.todoFilter = "l:" + id; state.tab = "todo"; render();
    cheer(); toast(`Benvenuta in ${str(info.emoji)} ${str(info.nome)}! 💗`);
  } catch (e) { toast(/10 persone|massimo/.test(e?.message || "") ? e.message : "Non sono riuscita a entrare"); }
}
async function chiediCodice() {
  const c = await ask({ title: "Hai un codice di invito?", text: "Scrivi i 16 caratteri che ti hanno mandato.", ok: "Controlla", input: true, placeholder: "ABCD 1234 ...", maxlength: 24 });
  if (c) proponiInvito(c);
}
// Link con ?invito=...: lo tengo da parte finché non si è entrati, poi lo propongo
function leggiInvitoDaLink() {
  const p = new URLSearchParams(location.search), c = p.get("invito");
  if (c && RE_INVITO.test(c)) { try { sessionStorage.setItem("mochi.invito", c); } catch {} }
  if (c) { p.delete("invito"); history.replaceState(null, "", location.pathname + (p.toString() ? "?" + p : "") + location.hash); }
}
function invitoInSospeso() {
  let c = null; try { c = sessionStorage.getItem("mochi.invito"); sessionStorage.removeItem("mochi.invito"); } catch {}
  if (c && RE_INVITO.test(c) && !mod("liste")) { setTimeout(() => toast("Per usare l'invito accendi le Liste condivise in Impostazioni"), 1200); return; }
  if (c && RE_INVITO.test(c)) setTimeout(() => whenSheetFree(() => proponiInvito(c)), 1200);
}
async function esciLista(id) {
  const l = listaById(id); if (!l) return;
  const solo = l.membri.length <= 1;
  const ok = await ask({ title: `Uscire da ${l.emoji} ${l.nome}?`, text: solo ? "Sei l'unica persona nella lista: uscendo la lista e tutte le sue voci verranno cancellate." : "Non vedrai più le voci della lista. Le altre persone continueranno a vederle.", ok: "Esci", danger: true });
  if (!ok) return;
  try { await store.esciLista(id); await loadListe(); state.items = await store.list(); if (state.todoFilter === "l:" + id) state.todoFilter = "tutte"; if (state.noteFilter === "l:" + id) state.noteFilter = "tutte"; render(); openListe(); toast("Sei uscita dalla lista"); }
  catch { toast("Non sono riuscita a uscire"); }
}
async function eliminaLista(id) {
  const l = listaById(id); if (!l) return;
  const v = await ask({ title: `Eliminare ${l.emoji} ${l.nome}?`, text: `La lista e TUTTE le sue voci spariranno per tutte le persone (${l.membri.length}). Per confermare scrivi ELIMINA.`, ok: "Elimina per tutte", danger: true, input: true, placeholder: "ELIMINA", maxlength: 10 });
  if (v === null) return;
  if (String(v).trim().toUpperCase() !== "ELIMINA") { toast("Non eliminata: serviva scrivere ELIMINA"); openListe(); return; }
  try { await store.eliminaLista(id); await loadListe(); state.items = await store.list(); state.todoFilter = "tutte"; state.noteFilter = "tutte"; render(); openListe(); toast("Lista eliminata"); }
  catch (e) { toast(/Solo chi/.test(e?.message || "") ? e.message : "Non sono riuscita a eliminarla"); }
}

/* =========================================================
   COM'È ANDATA LA GIORNATA
   Un umore al giorno (1-5): colora il calendario e a fine mese diventa
   "il giardino del mese", un disegno con un fiore per ogni giorno.
   ========================================================= */
const UMORI = [
  null,
  { nome: "Pesante", colore: "#9fb3d9" },
  { nome: "Così così", colore: "#c3b1e6" },
  { nome: "Normale", colore: "#f2d27a" },
  { nome: "Bella", colore: "#ffb48f" },
  { nome: "Bellissima", colore: "#ff8fb8" }
];
// Faccina disegnata: occhi e bocca cambiano con l'umore
function faccina(l, size = 40) {
  const u = UMORI[l]; if (!u) return "";
  const bocca = { 1: "M13 27 Q20 21 27 27", 2: "M13 26 Q20 23.5 27 26", 3: "M13.5 25.5 L26.5 25.5", 4: "M13 24 Q20 30 27 24", 5: "M12 23 Q20 33 28 23 Z" }[l];
  return `<svg viewBox="0 0 40 40" width="${size}" height="${size}" aria-hidden="true"><circle cx="20" cy="20" r="18" fill="${u.colore}"/>
    <circle cx="14" cy="17" r="2.4" fill="#4a2f3a"/><circle cx="26" cy="17" r="2.4" fill="#4a2f3a"/>
    <circle cx="10.5" cy="22.5" r="3" fill="#fff" opacity=".35"/><circle cx="29.5" cy="22.5" r="3" fill="#fff" opacity=".35"/>
    <path d="${bocca}" stroke="#4a2f3a" stroke-width="2.4" stroke-linecap="round" fill="${l === 5 ? "#4a2f3a" : "none"}"/></svg>`;
}
const RE_YMD = /^\d{4}-\d{2}-\d{2}$/;
function cleanUmore(r) {
  const l = parseInt(r?.livello, 10);
  return l >= 1 && l <= 5 ? { livello: l, nota: str(r.nota).slice(0, 200) } : null;
}
const UmoriStore = {
  async carica() {
    if (!ONLINE_MODE) { const o = LS.get("mochi.umori", {}); const out = {}; for (const k in o) if (RE_YMD.test(k) && cleanUmore(o[k])) out[k] = cleanUmore(o[k]); return out; }
    const da = ymd(addDays(new Date(), -400));
    const { data, error } = await store.sb.from("umori").select("giorno,livello,nota").gte("giorno", da).order("giorno");
    if (error) throw error;
    const out = {}; (data || []).forEach((r) => { if (RE_YMD.test(String(r.giorno)) && cleanUmore(r)) out[r.giorno] = cleanUmore(r); });
    return out;
  },
  async salva(giorno, livello, nota) {
    if (!ONLINE_MODE) { const o = LS.get("mochi.umori", {}); o[giorno] = { livello, nota }; LS.set("mochi.umori", o); return; }
    const { error } = await store.sb.from("umori").upsert({ user_id: store.user.id, giorno, livello, nota: nota || null }, { onConflict: "user_id,giorno" });
    if (error) throw error;
  },
  async togli(giorno) {
    if (!ONLINE_MODE) { const o = LS.get("mochi.umori", {}); delete o[giorno]; LS.set("mochi.umori", o); return; }
    const { error } = await store.sb.from("umori").delete().eq("giorno", giorno);
    if (error) throw error;
  }
};
async function caricaUmori() {
  try { state.umori = await UmoriStore.carica(); LS.set("mochi.umoriCache", state.umori); }
  catch { state.umori = LS.get("mochi.umoriCache", {}) || {}; }
}
// Riquadro nella pagina Oggi
function umoreCard() {
  const oggi = todayStr(), u = state.umori[oggi];
  if (u) return `<div class="umore-card fatto">
      <span class="faccia">${faccina(u.livello, 44)}</span>
      <div class="u-txt"><b>Oggi: ${UMORI[u.livello].nome.toLowerCase()}</b>${u.nota ? `<small>${esc(u.nota)}</small>` : `<small>Ogni giorno colora il tuo calendario</small>`}</div>
      <button class="fbtn" data-act="umore-apri" data-v="${oggi}">Cambia</button></div>`;
  return `<div class="umore-card">
      <b class="u-domanda">Com'è andata oggi?</b>
      <div class="facce">${[1, 2, 3, 4, 5].map((l) => `<button data-act="umore-set" data-v="${l}" data-id="${oggi}" aria-label="${UMORI[l].nome}">${faccina(l, 40)}<small>${UMORI[l].nome}</small></button>`).join("")}</div></div>`;
}
async function setUmore(giorno, livello) {
  if (!RE_YMD.test(giorno) || giorno > todayStr()) return;
  const prima = state.umori[giorno];
  state.umori[giorno] = { livello, nota: prima?.nota || "" };
  render(); cheer(900);
  try { await UmoriStore.salva(giorno, livello, prima?.nota || ""); toast(`${UMORI[livello].nome}: segnato nel calendario`); }
  catch { if (prima) state.umori[giorno] = prima; else delete state.umori[giorno]; render(); toast("Non sono riuscita a salvarlo"); }
}
let umoreDalGiardino = false;
function apriUmore(giorno, dalGiardino = false) {
  if (!RE_YMD.test(giorno) || giorno > todayStr()) return;
  umoreDalGiardino = dalGiardino;
  const u = state.umori[giorno] || { livello: 0, nota: "" };
  const d = parseYmd(giorno);
  openSheet(`<h2><span class="mbox">${mascot()}</span>${giorno === todayStr() ? "Com'è andata oggi?" : `Com'è andato ${GIORNI[d.getDay()]} ${d.getDate()}?`}</h2>
    <div class="facce grandi">${[1, 2, 3, 4, 5].map((l) => `<button class="${u.livello === l ? "on" : ""}" data-act="umore-scegli" data-v="${l}">${faccina(l, 46)}<small>${UMORI[l].nome}</small></button>`).join("")}</div>
    <div class="field"><label>Due parole, se vuoi</label><textarea class="input" id="uNota" maxlength="200" placeholder="Cosa ti ha fatto sorridere? O cosa ti ha pesato?">${esc(u.nota || "")}</textarea></div>
    <div class="actions">${state.umori[giorno] ? `<button class="btn danger" data-act="umore-togli" data-id="${giorno}">Togli</button>` : ""}<button class="btn" data-act="umore-annulla">Annulla</button><button class="btn primary" data-act="umore-salva" data-id="${giorno}">Salva</button></div>`);
  umoreScelto = u.livello;
}
let umoreScelto = 0;
// Se si arrivava dal giardino, si torna al giardino (aggiornato) invece di chiudere tutto
function tornaDaUmore() { if (umoreDalGiardino && giardinoMese) { umoreDalGiardino = false; apriGiardino(giardinoMese); } else closeSheet(); }
async function salvaUmoreSheet(giorno) {
  if (!umoreScelto) { toast("Scegli una faccina"); return; }
  const nota = ($("#uNota")?.value || "").trim().slice(0, 200), prima = state.umori[giorno];
  state.umori[giorno] = { livello: umoreScelto, nota }; tornaDaUmore(); render(); cheer(900);
  try { await UmoriStore.salva(giorno, umoreScelto, nota); } catch { if (prima) state.umori[giorno] = prima; else delete state.umori[giorno]; render(); toast("Non sono riuscita a salvarlo"); }
}
async function togliUmore(giorno) {
  const prima = state.umori[giorno]; delete state.umori[giorno]; tornaDaUmore(); render();
  try { await UmoriStore.togli(giorno); } catch { state.umori[giorno] = prima; render(); toast("Non sono riuscita a toglierlo"); }
}

// Il giardino del mese: un fiore per ogni giorno, del colore della giornata
function giardinoSvg(m) {
  const y = m.getFullYear(), mo = m.getMonth(), giorni = new Date(y, mo + 1, 0).getDate();
  const off = (new Date(y, mo, 1).getDay() + 6) % 7, oggi = todayStr();
  const W = 7 * 60 + 20, righe = Math.ceil((off + giorni) / 7), H = righe * 76 + 92;
  let fiori = "";
  for (let g = 1; g <= giorni; g++) {
    const i = off + g - 1, cx = 40 + (i % 7) * 60, cy = 98 + Math.floor(i / 7) * 76;
    const k = `${y}-${String(mo + 1).padStart(2, "0")}-${String(g).padStart(2, "0")}`, u = state.umori[k];
    const gambo = `<path d="M${cx} ${cy + 6} C ${cx - 4} ${cy + 18}, ${cx + 3} ${cy + 26}, ${cx} ${cy + 34}" stroke="#7cb98a" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M${cx} ${cy + 24} C ${cx + 8} ${cy + 18}, ${cx + 14} ${cy + 22}, ${cx + 13} ${cy + 26} C ${cx + 8} ${cy + 28}, ${cx + 3} ${cy + 27}, ${cx} ${cy + 24} Z" fill="#9fd3a8"/>`;
    if (u) {
      const c = UMORI[u.livello].colore, r = 7 + u.livello * 1.3;
      let petali = ""; const n = u.livello >= 4 ? 6 : 5;
      for (let p = 0; p < n; p++) { const a = (p / n) * Math.PI * 2 - Math.PI / 2 + (g % 3) * .2; petali += `<ellipse cx="${(cx + Math.cos(a) * r).toFixed(1)}" cy="${(cy + Math.sin(a) * r).toFixed(1)}" rx="${(r * .62).toFixed(1)}" ry="${(r * .5).toFixed(1)}" transform="rotate(${(a * 180 / Math.PI).toFixed(0)} ${(cx + Math.cos(a) * r).toFixed(1)} ${(cy + Math.sin(a) * r).toFixed(1)})" fill="${c}"/>`; }
      fiori += gambo + petali + `<circle cx="${cx}" cy="${cy}" r="${(r * .55).toFixed(1)}" fill="#ffe28a" stroke="#f2c14e" stroke-width="1.5"/>`;
    } else if (k <= oggi) {
      fiori += gambo + `<ellipse cx="${cx}" cy="${cy + 2}" rx="5" ry="7" fill="#cfe7d3"/>`;
    }
    fiori += `<text x="${cx}" y="${cy + 50}" text-anchor="middle" font-size="11" fill="#8a6a77" font-family="Nunito, sans-serif">${g}</text>`;
    if (k <= oggi) fiori += `<rect class="fiore-tocco" x="${cx - 28}" y="${cy - 26}" width="56" height="80" rx="12" fill="transparent" data-act="giardino-fiore" data-id="${k}"><title>${g} ${MESI[mo]}: tocca per cambiare</title></rect>`;
  }
  const conta = Object.keys(state.umori).filter((k) => k.startsWith(`${y}-${String(mo + 1).padStart(2, "0")}`)).length;
  return `<svg class="giardino" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Il giardino di ${MESI[mo]}: ${conta} fiori">
    <rect x="0" y="0" width="${W}" height="${H}" rx="22" fill="#fffaf5"/>
    <rect x="0" y="${H - 26}" width="${W}" height="26" fill="#e9f5e6"/>
    <text x="${W / 2}" y="42" text-anchor="middle" font-size="26" fill="#4a2f3a" font-family="'Patrick Hand', Fredoka, sans-serif">Il giardino di ${MESI[mo]}</text>
    <text x="${W / 2}" y="64" text-anchor="middle" font-size="12.5" fill="#8a6a77" font-family="Nunito, sans-serif">${conta ? `${conta} ${conta === 1 ? "fiore" : "fiori"}, uno per ogni giornata raccontata` : "Racconta le tue giornate e qui sboccia un fiore per ognuna"}</text>
    ${fiori}</svg>`;
}
function legendaUmori() { return `<div class="u-legenda">${[1, 2, 3, 4, 5].map((l) => `<span><i style="background:${UMORI[l].colore}"></i>${UMORI[l].nome}</span>`).join("")}</div>`; }
let giardinoMese = null;
function apriGiardino(m) {
  giardinoMese = m || new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const cur = monthKey(giardinoMese) === monthKey(new Date());
  openSheet(`<div class="calhead" style="margin-bottom:10px">
      <button class="iconbtn" data-act="giardino-move" data-v="-1">‹</button>
      <span class="fred" style="font-size:16px;color:var(--ink2)">Il giardino del mese</span>
      <button class="iconbtn" data-act="giardino-move" data-v="1" ${cur ? "disabled style='opacity:.3'" : ""}>›</button></div>
    ${giardinoSvg(giardinoMese)}${legendaUmori()}
    <p class="small" style="text-align:center;margin:6px 0 0">Tocca un fiore per cambiare quella giornata</p>
    <div class="actions" style="margin-top:12px"><button class="btn" data-act="giardino-salva">Salva l'immagine</button><button class="btn primary" data-act="close">Che bello</button></div>`);
}
// Trasforma il disegno in un'immagine PNG da tenere o condividere
async function salvaGiardino() {
  const svg = $("#sheet .giardino"); if (!svg) return;
  const vb = svg.viewBox.baseVal, scala = 3;
  const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob), img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas"); c.width = vb.width * scala; c.height = vb.height * scala;
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
    c.toBlob(async (png) => {
      const nome = `giardino-${monthKey(giardinoMese)}.png`;
      const file = new File([png], nome, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: "Il mio giardino del mese" }); return; } catch (e) { if (e?.name === "AbortError") return; } }
      const a = document.createElement("a"); a.href = URL.createObjectURL(png); a.download = nome; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, "image/png");
  };
  img.onerror = () => toast("Non sono riuscita a creare l'immagine");
  img.src = url;
}

/* =========================================================
   IL BISCOTTO DELLA FORTUNA
   Alla prima apertura di ogni giorno (dalle 5 del mattino): un biscotto da aprire
   con la frase del giorno, la stessa che poi resta sotto il saluto.
   ========================================================= */
function maybeBiscotto() {
  if (!mod("biscotto")) return;
  const oggi = todayStr();
  if (LS.get("mochi.biscotto", "") === oggi || new Date().getHours() < 5) return;
  setTimeout(() => whenSheetFree(() => {
    if (LS.get("mochi.biscotto", "") === oggi || $(".biscotto-wrap")) return;
    LS.set("mochi.biscotto", oggi);
    apriBiscotto();
  }), 1700);
}
function apriBiscotto() {
  if ($(".biscotto-wrap")) return;
  const w = document.createElement("div");
  w.className = "biscotto-wrap";
  w.innerHTML = `<div class="biscotto-card" role="dialog" aria-modal="true" aria-label="Il biscotto della fortuna">
      <p class="b-titolo">Il biscotto di oggi</p>
      <button class="b-cookie" data-act="b-apri" aria-label="Apri il biscotto">
        <span class="b-carta"><span></span></span>
        <svg viewBox="0 0 200 140" aria-hidden="true">
          <g class="b-l"><path d="M101 30 C 70 22, 34 34, 16 70 C 12 80, 22 84, 30 80 C 50 72, 72 84, 86 104 C 92 112, 101 108, 101 100 Z" fill="#f4c27e" stroke="#c98a3e" stroke-width="4" stroke-linejoin="round"/>
            <path d="M36 62 C 54 48, 76 44, 94 48" stroke="#fbe0b5" stroke-width="6" stroke-linecap="round" fill="none"/></g>
          <g class="b-r"><path d="M99 30 C 130 22, 166 34, 184 70 C 188 80, 178 84, 170 80 C 150 72, 128 84, 114 104 C 108 112, 99 108, 99 100 Z" fill="#efb66c" stroke="#c98a3e" stroke-width="4" stroke-linejoin="round"/>
            <path d="M99 34 C 104 60, 104 80, 100 100" stroke="#c98a3e" stroke-width="3.5" stroke-linecap="round" fill="none" opacity=".55"/></g>
        </svg>
      </button>
      <p class="b-hint">Tocca il biscotto per aprirlo<br><button class="b-dopo" data-act="b-chiudi">Più tardi</button></p>
      <div class="b-azioni"><button class="btn primary" data-act="b-chiudi">Buona giornata!</button></div>
    </div>`;
  $(".b-carta span", w).textContent = fraseDelGiorno();
  w.addEventListener("click", (e) => { if (e.target === w) chiudiBiscotto(); }); // tocco fuori dal biglietto
  document.body.appendChild(w);
  requestAnimationFrame(() => w.classList.add("on"));
  setTimeout(() => $(".b-cookie", w)?.focus(), 300);
}
function rompiBiscotto() {
  const w = $(".biscotto-wrap"); if (!w || w.classList.contains("aperto")) return;
  w.classList.add("aperto");
  suona("biscotto");
  if (navigator.vibrate) navigator.vibrate([12, 40, 18]);
  const r = $(".b-cookie", w).getBoundingClientRect();
  setTimeout(() => confetti(r.left + r.width / 2, r.top + r.height / 2, 22), 250);
  setTimeout(() => cheer(), 400);
}
function chiudiBiscotto() {
  const w = $(".biscotto-wrap"); if (!w) return;
  w.classList.remove("on");
  setTimeout(() => { w.remove(); if (sheetQueue.length) sheetQueue.shift()(); }, 300);
}

/* =========================================================
   PROMEMORIA RICORRENTI ("bevi acqua ogni 2 ore")
   Li manda il server alle ore giuste anche ad app chiusa, solo sui dispositivi con i promemoria attivi.
   ========================================================= */
const RE_HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const OGNI_OPZ = [[30, "Ogni 30 minuti"], [60, "Ogni ora"], [90, "Ogni ora e mezza"], [120, "Ogni 2 ore"], [180, "Ogni 3 ore"], [240, "Ogni 4 ore"], [360, "Ogni 6 ore"], [1440, "Una volta al giorno"]];
// 30 simboli: 5 righe ordinate da 6 sul telefono. Niente lettere, cifre o simboli HTML (regola "ricorrenti_ok" del database)
const EMOJI_RIC = ["💧", "🧘", "👀", "🚶", "🌿", "🍎", "☕", "💊", "🛏️", "🐶", "📖", "🦷",
  "🍝", "🍽️", "🥗", "🍵", "💤", "🧴", "📚", "🪴", "💻", "📞", "🧺", "🧹", "🐱", "🛁", "🎵", "🌞", "✍️", "🤸"];
const GG = ["L", "M", "M", "G", "V", "S", "D"];
const PRESET_RIC = [
  { emoji: "💧", titolo: "Bevi un bicchiere d'acqua", ogni_minuti: 120, dalle: "09:00", alle: "21:00", giorni: [1, 2, 3, 4, 5, 6, 7] },
  { emoji: "🧘", titolo: "Sgranchisciti un attimo", ogni_minuti: 60, dalle: "09:00", alle: "18:00", giorni: [1, 2, 3, 4, 5] },
  { emoji: "👀", titolo: "Riposa gli occhi dallo schermo", ogni_minuti: 60, dalle: "09:00", alle: "19:00", giorni: [1, 2, 3, 4, 5] },
  { emoji: "🚶", titolo: "Fai due passi", ogni_minuti: 180, dalle: "10:00", alle: "19:00", giorni: [1, 2, 3, 4, 5, 6, 7] },
  { emoji: "🌿", titolo: "Annaffia le piante", ogni_minuti: 1440, dalle: "19:00", alle: "23:59", giorni: [1, 4] }
];
let ricorrenti = [], ricDraft = null;
const descrOgni = (r) => r.ogni_minuti >= 1440 ? `Ogni giorno alle ${r.dalle}` : `${(OGNI_OPZ.find((o) => o[0] === r.ogni_minuti) || [0, `Ogni ${r.ogni_minuti} min`])[1]}, ${r.dalle}-${r.alle}`;
const descrGiorni = (g) => g.length === 7 ? "tutti i giorni" : g.join() === "1,2,3,4,5" ? "dal lunedì al venerdì" : g.join() === "6,7" ? "nel weekend" : g.map((d) => ["lun", "mar", "mer", "gio", "ven", "sab", "dom"][d - 1]).join(", ");
function cleanRic(r) {
  return {
    id: typeof r.id === "string" && RE_ID.test(r.id) ? r.id : null,
    titolo: str(r.titolo).slice(0, 80) || "Promemoria",
    emoji: EMOJI_RIC.includes(r.emoji) ? r.emoji : "💧",
    ogni_minuti: OGNI_OPZ.some((o) => o[0] === +r.ogni_minuti) ? +r.ogni_minuti : 120,
    dalle: RE_HHMM.test(str(r.dalle).slice(0, 5)) ? str(r.dalle).slice(0, 5) : "09:00",
    alle: RE_HHMM.test(str(r.alle).slice(0, 5)) ? str(r.alle).slice(0, 5) : "21:00",
    giorni: Array.isArray(r.giorni) ? [...new Set(r.giorni.map(Number).filter((d) => d >= 1 && d <= 7))].sort() : [1, 2, 3, 4, 5, 6, 7],
    attiva: r.attiva !== false,
    prossimo_invio: isIso(r.prossimo_invio) ? r.prossimo_invio : null
  };
}
// Pagina "Promemoria ricorrenti" (nel menu, non nelle impostazioni)
let ricPushOn = true, ricCaricati = false;
async function openRicorrenti(refresh = true) {
  if (refresh || !ricCaricati) { try { ricorrenti = (await store.ricorrenti()).map(cleanRic); ricCaricati = true; } catch { toast("Non riesco a caricarli, riprova"); return; } }
  ricPushOn = await pushActive();
  if ($("#sheet").classList.contains("on")) closeSheet();
  const giaQui = state.tab === "ricorrenti";
  state.tab = "ricorrenti"; render(); if (!giaQui) window.scrollTo({ top: 0 });
}
function viewRicorrenti() {
  if (!ONLINE_MODE) return emptyBox("I promemoria ricorrenti funzionano quando l'app è collegata a un account 🌸");
  if (!ricCaricati) { openRicorrenti(); return emptyBox("Un attimo... 🌸"); }
  const pushOn = ricPushOn;
  const quando = (r) => r.attiva && r.prossimo_invio ? `Prossimo: ${new Date(r.prossimo_invio).toLocaleString("it-IT", { weekday: "short", hour: "2-digit", minute: "2-digit" })}` : "In pausa";
  return `<div class="sec" style="margin-top:0"><h2><span class="emo">🔁 </span>Promemoria ricorrenti</h2></div>
    <p style="margin:0 0 12px;color:var(--ink2)">Piccole abitudini che ${esc(MN())} ti ricorda a intervalli, anche ad app chiusa.</p>
    ${!pushOn ? `<div class="bubble" style="margin:0 0 12px">🔔 Su questo dispositivo i promemoria non sono attivi: ${PUSH_READY ? `<button class="fbtn on" data-act="enable-push" style="margin-left:6px">Attiva</button>` : "non arriverebbero."}</div>` : ""}
    <div class="list">${ricorrenti.map((r) => `
      <div class="lcard ric ${r.attiva ? "" : "off"}">
        <div class="lcard-h"><span class="e">${esc(r.emoji)}</span><div style="flex:1;min-width:0"><b>${esc(r.titolo)}</b>
          <small>${esc(descrOgni(r))} · ${esc(descrGiorni(r.giorni))}</small><small>${esc(quando(r))}</small></div>
          <button class="pin-toggle mini ${r.attiva ? "on" : ""}" data-act="ric-toggle" data-id="${esc(r.id)}" aria-label="${r.attiva ? "Metti in pausa" : "Riattiva"}"><span class="sw2"></span></button></div>
        <div class="msg-a"><button class="fbtn" data-act="ric-modifica" data-id="${esc(r.id)}">Modifica</button><button class="fbtn" style="color:#c0394e" data-act="ric-elimina" data-id="${esc(r.id)}">Elimina</button></div>
      </div>`).join("") || `<div class="empty" style="padding:8px">Nessuno per ora. Inizia da uno di questi 👇</div>`}</div>
    ${ricorrenti.length < 10 ? `<div class="sec"><h2>Idee veloci</h2></div>
    <div class="filters" style="flex-wrap:wrap">${PRESET_RIC.map((p, i) => `<button class="fbtn" data-act="ric-preset" data-v="${i}">${p.emoji} ${esc(p.titolo)}</button>`).join("")}</div>` : `<p class="hint">Hai raggiunto il massimo di 10.</p>`}
    ${ricorrenti.length < 10 ? `<div class="actions" style="margin-top:14px"><button class="btn primary" data-act="ric-nuovo">+ Nuovo promemoria</button></div>` : ""}`;
}
function editRicorrente(r) {
  ricDraft = cleanRic(r || { titolo: "", emoji: "💧", ogni_minuti: 120, dalle: "09:00", alle: "21:00", giorni: [1, 2, 3, 4, 5, 6, 7] });
  if (!r) ricDraft.titolo = "";
  drawRicorrente();
}
function drawRicorrente() {
  const d = ricDraft, giorno = d.ogni_minuti >= 1440;
  openSheet(`<h2><span class="mbox">${mascot()}</span>${d.id ? "Modifica promemoria" : "Nuovo promemoria"}</h2>
    <div class="field"><label>Cosa ti ricordo</label><input class="input big" id="rTitolo" maxlength="80" placeholder="Bevi un bicchiere d'acqua" value="${esc(d.titolo)}" autocomplete="off"></div>
    <div class="field"><label>Simbolo</label><div class="emojis">${EMOJI_RIC.map((e) => `<button class="${d.emoji === e ? "on" : ""}" data-act="ric-emoji" data-v="${e}">${e}</button>`).join("")}</div></div>
    <div class="field"><label>Quanto spesso</label><select class="input" id="rOgni">${OGNI_OPZ.map(([v, l]) => `<option value="${v}" ${d.ogni_minuti === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
    <div class="row">
      <div class="field"><label>${giorno ? "Alle" : "Dalle"}</label><input class="input" type="time" id="rDalle" value="${d.dalle}"></div>
      ${giorno ? "" : `<div class="field"><label>Alle</label><input class="input" type="time" id="rAlle" value="${d.alle}"></div>`}
    </div>
    <div class="field"><label>Giorni</label><div class="giorni">${GG.map((g, i) => `<button class="${d.giorni.includes(i + 1) ? "on" : ""}" data-act="ric-giorno" data-v="${i + 1}">${g}</button>`).join("")}</div></div>
    <div class="actions"><button class="btn" data-act="ric-indietro">Indietro</button><button class="btn primary" data-act="ric-salva">Salva</button></div>`);
  $("#rTitolo").addEventListener("input", (e) => { ricDraft.titolo = e.target.value; });
  $("#rOgni").addEventListener("change", (e) => { ricDraft.ogni_minuti = +e.target.value; if (ricDraft.ogni_minuti >= 1440) ricDraft.alle = "23:59"; else if (ricDraft.alle === "23:59") ricDraft.alle = "21:00"; drawRicorrente(); });
  $("#rDalle").addEventListener("input", (e) => { ricDraft.dalle = e.target.value; });
  $("#rAlle")?.addEventListener("input", (e) => { ricDraft.alle = e.target.value; });
}
async function salvaRicorrente(btn) {
  const d = ricDraft; d.titolo = d.titolo.trim();
  if (!d.titolo) { toast("Scrivi cosa devo ricordarti 🌸"); return; }
  if (!RE_HHMM.test(d.dalle) || !RE_HHMM.test(d.alle)) { toast("Controlla gli orari"); return; }
  if (d.ogni_minuti >= 1440) d.alle = "23:59";
  if (d.dalle >= d.alle) { toast("L'orario di fine deve venire dopo quello di inizio"); return; }
  if (!d.giorni.length) { toast("Scegli almeno un giorno"); return; }
  btn.disabled = true;
  try {
    d.fuso = Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Rome";
    await store.salvaRicorrente(d);
    toast(d.id ? "Aggiornato 🌸" : `${d.emoji} Fatto! Te lo ricordo io`); cheer();
    openRicorrenti();
  } catch (e) { btn.disabled = false; toast(/massimo/.test(e?.message || "") ? e.message : "Non sono riuscita a salvarlo"); }
}
async function toggleRicorrente(id) {
  const r = ricorrenti.find((x) => x.id === id); if (!r) return;
  try { await store.salvaRicorrente({ ...r, attiva: !r.attiva, fuso: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Rome" }); openRicorrenti(); }
  catch { toast("Non sono riuscita a cambiarlo"); }
}
// Accendere/spegnere il modulo: allo spegnimento, con conferma, mette in pausa quelli attivi.
// Restituisce "ok", "annulla" (resta acceso) o "errore" (resta com'era).
async function moduloRicorrenti(acceso) {
  try { ricorrenti = (await store.ricorrenti()).map(cleanRic); ricCaricati = true; }
  catch { toast("Non riesco a controllare i promemoria ricorrenti, riprova"); return "errore"; }
  if (acceso) return "ok";
  const attivi = ricorrenti.filter((r) => r.attiva);
  if (!attivi.length) return "ok";
  const n = attivi.length;
  const ok = await ask({ title: n === 1 ? "Metto in pausa il tuo promemoria ricorrente?" : `Metto in pausa i tuoi ${n} promemoria ricorrenti?`, text: "Non ti arriveranno più finché non riaccendi il modulo e li riattivi dalla pagina Ricorrenti.", ok: "Metti in pausa" });
  if (!ok) return "annulla";
  const fuso = Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Rome";
  let errori = 0;
  for (const r of attivi) { try { await store.salvaRicorrente({ ...r, attiva: false, fuso }); r.attiva = false; } catch { errori++; } }
  if (errori) { toast("Non sono riuscita a metterli tutti in pausa: il modulo resta acceso, riprova"); riapriImpostazioni(); return "errore"; }
  return "ok";
}
async function eliminaRicorrente(id) {
  const r = ricorrenti.find((x) => x.id === id); if (!r) return;
  const ok = await ask({ title: `Eliminare "${r.titolo}"?`, text: "Non ti arriveranno più questi promemoria.", ok: "Elimina", danger: true });
  if (!ok) return;
  try { await store.eliminaRicorrente(id); toast("Eliminato"); openRicorrenti(); } catch { toast("Non sono riuscita a eliminarlo"); }
}

/* =========================================================
   TURNI DI LAVORO
   Tipi di turno decisi da lei + un ciclo che si ripete + cambi a mano sui singoli giorni.
   Privati: li vede solo chi li scrive (lo garantisce il database).
   ========================================================= */
const TURNO_COLORI = ["#ffb3c7", "#ffd29a", "#fff09a", "#bfe8b0", "#a8e0dc", "#b5d4ff", "#d2c2ff", "#f5c2f0", "#ffc6a8", "#ddd3c6", "#c7c7d6", "#e3f0a8"];
const TURNI_BASE = [
  { k: "m", nome: "Mattina", sigla: "M", colore: 2, inizio: "06:00", fine: "14:00", pausa: 0 },
  { k: "p", nome: "Pomeriggio", sigla: "P", colore: 6, inizio: "14:00", fine: "22:00", pausa: 0 },
  { k: "n", nome: "Notte", sigla: "N", colore: 7, inizio: "22:00", fine: "06:00", pausa: 0 },
  { k: "f", nome: "Ferie", sigla: "F", colore: 4, inizio: "", fine: "", pausa: 0 }
];
const RIPOSO = { k: "", nome: "Riposo", sigla: "R", colore: 0, inizio: "", fine: "", pausa: 0 };
const RE_TK = /^[a-z0-9]{1,8}$/;
const PAUSE = [0, 15, 30, 45, 60, 90, 120];
function cleanTipo(t) {
  if (!t || !RE_TK.test(str(t.k))) return null;
  const nome = str(t.nome).replace(/[<>]/g, "").trim().slice(0, 20);
  const sigla = [...str(t.sigla).replace(/[<>"'&]/g, "").trim()].slice(0, 3).join("") || [...nome][0] || "?";
  const c = parseInt(t.colore, 10), p = parseInt(t.pausa, 10);
  const conOrario = RE_HHMM.test(str(t.inizio)) && RE_HHMM.test(str(t.fine)) && t.inizio !== t.fine;
  return { k: t.k, nome: nome || "Turno", sigla, colore: c >= 1 && c <= 12 ? c : 1,
    inizio: conOrario ? t.inizio : "", fine: conOrario ? t.fine : "", pausa: conOrario && p >= 0 && p <= 240 ? p : 0 };
}
function cleanTurniImp(r) {
  const tipi = [], visti = new Set();
  (Array.isArray(r?.tipi) ? r.tipi : []).forEach((t) => { const c = cleanTipo(t); if (c && !visti.has(c.k) && tipi.length < 12) { visti.add(c.k); tipi.push(c); } });
  const ciclo = (Array.isArray(r?.ciclo) ? r.ciclo : []).map(str).filter((k) => k === "" || RE_TK.test(k)).slice(0, 62);
  const ini = str(r?.ciclo_inizio).slice(0, 10);
  return { tipi, ciclo, ciclo_inizio: RE_YMD.test(ini) ? ini : null };
}
const TurniStore = {
  async carica() {
    if (!ONLINE_MODE) {
      const o = LS.get("mochi.turni", {}) || {}, g = {};
      for (const k in o.giorni || {}) if (RE_YMD.test(k) && /^[a-z0-9]{0,8}$/.test(str(o.giorni[k]))) g[k] = o.giorni[k];
      return { imp: cleanTurniImp(o.imp), giorni: g };
    }
    const da = ymd(addDays(new Date(), -400));
    const [a, b] = await Promise.all([
      store.sb.from("turni_impostazioni").select("tipi,ciclo,ciclo_inizio").maybeSingle(),
      store.sb.from("turni").select("giorno,tipo").gte("giorno", da)
    ]);
    if (a.error) throw a.error; if (b.error) throw b.error;
    const g = {}; (b.data || []).forEach((r) => { if (RE_YMD.test(String(r.giorno)) && /^[a-z0-9]{0,8}$/.test(str(r.tipo))) g[r.giorno] = r.tipo; });
    return { imp: cleanTurniImp(a.data || {}), giorni: g };
  },
  _local() { LS.set("mochi.turni", { imp: state.turniImp, giorni: state.turni }); },
  async salvaImp(imp) {
    if (!ONLINE_MODE) { this._local(); return; }
    const { error } = await store.sb.from("turni_impostazioni").upsert({ user_id: store.user.id, tipi: imp.tipi, ciclo: imp.ciclo, ciclo_inizio: imp.ciclo_inizio }, { onConflict: "user_id" });
    if (error) throw error;
  },
  async segna(giorno, tipo) {
    if (!ONLINE_MODE) { this._local(); return; }
    const { error } = await store.sb.from("turni").upsert({ user_id: store.user.id, giorno, tipo }, { onConflict: "user_id,giorno" });
    if (error) throw error;
  },
  async togli(giorno) {
    if (!ONLINE_MODE) { this._local(); return; }
    const { error } = await store.sb.from("turni").delete().eq("giorno", giorno);
    if (error) throw error;
  }
};
async function caricaTurni() {
  try { const r = await TurniStore.carica(); state.turniImp = r.imp; state.turni = r.giorni; LS.set("mochi.turniCache", r); }
  catch { const c = LS.get("mochi.turniCache", null); state.turniImp = cleanTurniImp(c?.imp); state.turni = c?.giorni && typeof c.giorni === "object" ? c.giorni : {}; }
}
const turniAttivi = () => mod("turni") && state.turniImp.tipi.length > 0;
const tipoDa = (k) => (k === "" ? RIPOSO : state.turniImp.tipi.find((t) => t.k === k) || null);
const giorniTra = (a, b) => Math.round((Date.UTC(...b.split("-").map((x, i) => i === 1 ? x - 1 : +x)) - Date.UTC(...a.split("-").map((x, i) => i === 1 ? x - 1 : +x))) / 864e5);
// Dal ciclo: che turno toccherebbe quel giorno (null = il ciclo non dice niente)
function turnoDaCiclo(g) {
  const { ciclo, ciclo_inizio } = state.turniImp;
  if (!ciclo.length || !ciclo_inizio || g < ciclo_inizio) return null;
  return ciclo[giorniTra(ciclo_inizio, g) % ciclo.length];
}
// Il turno di un giorno: prima i cambi a mano, poi il ciclo
function turnoDi(g) {
  if (!turniAttivi()) return null;
  const manuale = Object.prototype.hasOwnProperty.call(state.turni, g);
  const k = manuale ? state.turni[g] : turnoDaCiclo(g);
  if (k == null) return null;
  const t = tipoDa(k);
  return t ? { ...t, manuale } : null;
}
function minutiTipo(t) {
  if (!t.inizio) return 0;
  const [h1, m1] = t.inizio.split(":").map(Number), [h2, m2] = t.fine.split(":").map(Number);
  let d = h2 * 60 + m2 - (h1 * 60 + m1); if (d <= 0) d += 1440; // turno che passa la mezzanotte
  return Math.max(0, d - t.pausa);
}
const fmtOre = (min) => `${Math.floor(min / 60)} h${min % 60 ? ` ${String(min % 60).padStart(2, "0")}` : ""}`;
const orarioTipo = (t) => (t.inizio ? `${t.inizio}-${t.fine}${t.pausa ? ` · pausa ${t.pausa} min` : ""}` : t.k === "" ? "Giorno libero" : "Senza orario");
// Ore e turni di un mese (le notti contano nel giorno in cui iniziano)
function oreMese(m) {
  const y = m.getFullYear(), mo = m.getMonth(), n = new Date(y, mo + 1, 0).getDate();
  let min = 0, turni = 0; const per = {};
  for (let d = 1; d <= n; d++) {
    const t = turnoDi(ymd(new Date(y, mo, d)));
    if (!t || t.k === "") continue;
    per[t.k] = (per[t.k] || 0) + 1;
    if (t.inizio) { turni++; min += minutiTipo(t); }
  }
  return { min, turni, per };
}
const chipTurno = (t, cls = "") => `<span class="tchip ${cls} ${t.colore ? "" : "riposo"}" style="--tc:${t.colore ? TURNO_COLORI[t.colore - 1] : "transparent"}">${esc(t.sigla)}</span>`;
// Riga nel giorno scelto dell'agenda e in Oggi
function rigaTurno(g, oggi = false) {
  if (!turniAttivi()) return "";
  const t = turnoDi(g);
  return `<button class="turno-riga" data-act="turno-giorno" data-v="${g}">${t ? chipTurno(t) : `<span class="tchip vuoto">+</span>`}
    <span><b>${t ? (t.k === "" ? "Riposo" : `${oggi ? "Oggi: " : ""}${esc(t.nome)}`) : "Nessun turno"}</b><small>${t ? esc(orarioTipo(t)) + (t.manuale ? " · cambiato a mano" : "") : "Tocca per segnare il turno"}</small></span></button>`;
}

// Pagina "Turni di lavoro"
function openTurni() { if ($("#sheet").classList.contains("on")) closeSheet(); state.tab = "turni"; render(); window.scrollTo({ top: 0 }); }
function viewTurni() {
  const imp = state.turniImp;
  if (!turniAttivi()) return `<div class="sec" style="margin-top:0"><h2><span class="emo">💼 </span>Turni di lavoro</h2></div>
    <div class="empty"><div class="mbox">${mascot()}</div><div>Segna i tuoi turni: ${esc(MN())} li mette nell'agenda e ti conta le ore del mese.</div></div>
    <div class="actions"><button class="btn" data-act="turno-tipo-nuovo">Creo i miei</button><button class="btn primary" data-act="turni-base">Mattina, Pomeriggio, Notte, Ferie</button></div>
    <p class="hint" style="text-align:center">Potrai cambiare nomi, orari e colori quando vuoi.</p>`;
  const m = state.turniMese || (state.turniMese = new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const first = new Date(m.getFullYear(), m.getMonth(), 1), start = addDays(first, -((first.getDay() + 6) % 7));
  let celle = "";
  for (let k = 0; k < 42; k++) {
    const d = addDays(start, k), s = ymd(d); if (k >= 35 && d.getMonth() !== m.getMonth()) break;
    const t = d.getMonth() === m.getMonth() ? turnoDi(s) : null;
    celle += `<button class="tday ${d.getMonth() !== m.getMonth() ? "out" : ""} ${s === todayStr() ? "today" : ""} ${t && t.k !== "" ? "on" : ""} ${t?.manuale ? "man" : ""}" ${t && t.colore ? `style="--tc:${TURNO_COLORI[t.colore - 1]}"` : ""} data-act="turno-giorno" data-v="${s}"><span class="dn">${d.getDate()}</span>${t ? `<span class="ts">${esc(t.sigla)}</span>` : ""}</button>`;
  }
  const o = oreMese(m), cicloTxt = imp.ciclo.length && imp.ciclo_inizio
    ? `${imp.ciclo.length} giorni, dal ${parseYmd(imp.ciclo_inizio).getDate()} ${MESI[parseYmd(imp.ciclo_inizio).getMonth()]} ${parseYmd(imp.ciclo_inizio).getFullYear()}`
    : "Nessun ciclo: segni i turni giorno per giorno";
  return `<div class="sec" style="margin-top:0"><h2><span class="emo">💼 </span>Turni di lavoro</h2></div>
    <div class="split turni"><div class="col-main">
      <div class="calhead"><button class="iconbtn" data-act="turni-mese" data-v="-1">‹</button><h2>${MESI[m.getMonth()]} ${m.getFullYear()}</h2><button class="iconbtn" data-act="turni-mese" data-v="1">›</button></div>
      <div class="cal"><div class="dow"><div>L</div><div>M</div><div>M</div><div>G</div><div>V</div><div>S</div><div>D</div></div><div class="days">${celle}</div></div>
      <p class="hint" style="text-align:center;margin-top:8px">Tocca un giorno per cambiarlo. Il puntino indica un cambio fatto a mano.</p>
    </div><div class="col-side">
      <div class="ore-mese"><b>${fmtOre(o.min)}</b><span>di lavoro in ${o.turni} ${o.turni === 1 ? "turno" : "turni"} a ${MESI[m.getMonth()]}</span>
        ${Object.keys(o.per).length ? `<div class="ore-per">${imp.tipi.filter((t) => o.per[t.k]).map((t) => `<span>${chipTurno(t, "mini")} ${esc(t.nome)} ×${o.per[t.k]}</span>`).join("")}</div>` : ""}</div>
      <div class="sec"><h2>Il ciclo</h2><button class="fbtn" data-act="turni-ciclo">${imp.ciclo.length ? "Modifica" : "Imposta"}</button></div>
      <p style="margin:0 0 6px;color:var(--ink2)">${esc(cicloTxt)}</p>
      ${imp.ciclo.length ? `<div class="ciclo-seq">${imp.ciclo.map((k) => { const t = tipoDa(k); return t ? chipTurno(t, "mini") : ""; }).join("")}</div>` : ""}
      <div class="sec"><h2>Tipi di turno</h2>${imp.tipi.length < 12 ? `<button class="fbtn" data-act="turno-tipo-nuovo">+ Nuovo</button>` : ""}</div>
      <div class="list">${imp.tipi.map((t) => `<button class="turno-riga" data-act="turno-tipo" data-id="${t.k}">${chipTurno(t)}<span><b>${esc(t.nome)}</b><small>${esc(orarioTipo(t))}${t.inizio ? ` · ${fmtOre(minutiTipo(t))}` : ""}</small></span></button>`).join("")}</div>
    </div></div>`;
}
// Scegliere il turno di un giorno
function apriTurnoGiorno(g) {
  if (!RE_YMD.test(g)) return;
  if (!turniAttivi()) { openTurni(); return; }
  const d = parseYmd(g), att = turnoDi(g), daCiclo = turnoDaCiclo(g);
  const btn = (t) => `<button class="tpick ${att && att.k === t.k ? "on" : ""}" data-act="turno-scegli" data-id="${t.k}" data-v="${g}">${chipTurno(t)}<span><b>${esc(t.nome)}</b><small>${esc(orarioTipo(t))}</small></span></button>`;
  openSheet(`<h2><span class="mbox">${mascot()}</span>${GIORNI[d.getDay()].replace(/^./, (c) => c.toUpperCase())} ${d.getDate()} ${MESI[d.getMonth()]}</h2>
    <div class="tpicks">${state.turniImp.tipi.map(btn).join("")}${btn(RIPOSO)}</div>
    ${att?.manuale ? `<p class="hint">${daCiclo != null ? `Secondo il ciclo sarebbe: <b>${esc(tipoDa(daCiclo)?.nome || "nessun turno")}</b>` : "Segnato a mano"}</p>` : ""}
    <div class="actions">${att?.manuale ? `<button class="btn" data-act="turno-togli" data-v="${g}">${daCiclo != null ? "Segui il ciclo" : "Togli"}</button>` : ""}<button class="btn primary" data-act="close">Fatto</button></div>`);
}
async function scegliTurno(g, k) {
  if (!RE_YMD.test(g) || !(k === "" || tipoDa(k))) return;
  const prima = Object.prototype.hasOwnProperty.call(state.turni, g) ? state.turni[g] : undefined;
  const togli = turnoDaCiclo(g) === k; // uguale al ciclo: niente cambio a mano
  if (togli) delete state.turni[g]; else state.turni[g] = k;
  closeSheet(); render();
  try { if (togli) { if (prima !== undefined) await TurniStore.togli(g); } else await TurniStore.segna(g, k); LS.set("mochi.turniCache", { imp: state.turniImp, giorni: state.turni }); }
  catch { if (prima === undefined) delete state.turni[g]; else state.turni[g] = prima; render(); toast("Non sono riuscita a salvarlo"); }
}
async function togliTurno(g) {
  const prima = state.turni[g]; delete state.turni[g]; closeSheet(); render();
  try { await TurniStore.togli(g); LS.set("mochi.turniCache", { imp: state.turniImp, giorni: state.turni }); }
  catch { state.turni[g] = prima; render(); toast("Non sono riuscita a toglierlo"); }
}
async function salvaImpTurni(nuove, msg) {
  const prima = state.turniImp; state.turniImp = cleanTurniImp(nuove);
  try { await TurniStore.salvaImp(state.turniImp); LS.set("mochi.turniCache", { imp: state.turniImp, giorni: state.turni }); if (msg) toast(msg); return true; }
  catch { state.turniImp = prima; toast("Non sono riuscita a salvarlo"); return false; }
  finally { render(); }
}
// Modificare o creare un tipo di turno
let tipoDraft = null;
function apriTipoTurno(k) {
  const t = state.turniImp.tipi.find((x) => x.k === k);
  tipoDraft = t ? { ...t } : { k: "", nome: "", sigla: "", colore: (state.turniImp.tipi.length % 12) + 1, inizio: "09:00", fine: "17:00", pausa: 0 };
  disegnaTipoTurno();
}
function disegnaTipoTurno() {
  const d = tipoDraft, conOrario = !!d.inizio;
  openSheet(`<h2><span class="mbox">${mascot()}</span>${d.k ? "Modifica turno" : "Nuovo tipo di turno"}</h2>
    <div class="row"><div class="field" style="flex:3"><label>Nome</label><input class="input big" id="tNome" maxlength="20" placeholder="Mattina" value="${esc(d.nome)}" autocomplete="off"></div>
      <div class="field" style="flex:1"><label>Sigla</label><input class="input big" id="tSigla" maxlength="3" placeholder="M" value="${esc(d.sigla)}" autocomplete="off"></div></div>
    <div class="field"><label>Colore</label><div class="tcolori">${TURNO_COLORI.map((c, i) => `<button class="${d.colore === i + 1 ? "on" : ""}" style="background:${c}" data-act="tipo-colore" data-v="${i + 1}" aria-label="Colore ${i + 1}"></button>`).join("")}</div></div>
    <button class="pin-toggle ${conOrario ? "on" : ""}" data-act="tipo-orario"><span class="e">🕘</span><span style="flex:1"><b>Con orario</b><small style="display:block;color:var(--ink2)">Spegnilo per ferie, permessi, malattia: non contano nelle ore</small></span><span class="sw2"></span></button>
    ${conOrario ? `<div class="row" style="margin-top:10px">
      <div class="field"><label>Inizio</label><input class="input" type="time" id="tIni" value="${d.inizio}"></div>
      <div class="field"><label>Fine</label><input class="input" type="time" id="tFine" value="${d.fine}"></div>
      <div class="field"><label>Pausa</label><select class="input" id="tPausa">${PAUSE.map((p) => `<option value="${p}" ${d.pausa === p ? "selected" : ""}>${p ? `${p} min` : "Nessuna"}</option>`).join("")}</select></div></div>
      <p class="hint" id="tOre"></p>` : ""}
    <div class="actions">${d.k ? `<button class="btn danger" data-act="tipo-elimina">Elimina</button>` : ""}<button class="btn" data-act="tipo-indietro">Indietro</button><button class="btn primary" data-act="tipo-salva">Salva</button></div>`);
  const leggi = () => { d.nome = $("#tNome").value; d.sigla = $("#tSigla").value; if ($("#tIni")) { d.inizio = $("#tIni").value; d.fine = $("#tFine").value; d.pausa = +$("#tPausa").value; } };
  const ore = () => { leggi(); const o = $("#tOre"); if (o) { const c = cleanTipo({ ...d, k: "x" }); o.textContent = c.inizio ? `${fmtOre(minutiTipo(c))} di lavoro${c.fine <= c.inizio ? " (finisce il giorno dopo)" : ""}` : "Controlla gli orari"; } };
  $("#sheet").querySelectorAll("input,select").forEach((el) => el.addEventListener("input", ore));
  ore();
}
function leggiTipoDraft() { const d = tipoDraft; d.nome = $("#tNome")?.value ?? d.nome; d.sigla = $("#tSigla")?.value ?? d.sigla; if ($("#tIni")) { d.inizio = $("#tIni").value; d.fine = $("#tFine").value; d.pausa = +$("#tPausa").value; } }
async function salvaTipoTurno() {
  leggiTipoDraft(); const d = tipoDraft;
  if (!d.nome.trim()) { toast("Dai un nome al turno"); return; }
  if (d.inizio && (!RE_HHMM.test(d.inizio) || !RE_HHMM.test(d.fine) || d.inizio === d.fine)) { toast("Controlla gli orari"); return; }
  const tipi = [...state.turniImp.tipi];
  if (d.k) { const i = tipi.findIndex((t) => t.k === d.k); if (i >= 0) tipi[i] = d; }
  else { if (tipi.length >= 12) { toast("Massimo 12 tipi di turno"); return; } let k; do { k = "t" + Math.random().toString(36).slice(2, 7); } while (tipi.some((t) => t.k === k)); tipi.push({ ...d, k }); }
  if (await salvaImpTurni({ ...state.turniImp, tipi }, d.k ? "Turno aggiornato" : `${d.nome.trim()} aggiunto`)) { closeSheet(); if (state.tab !== "turni") openTurni(); }
}
async function eliminaTipoTurno() {
  const d = tipoDraft; if (!d?.k) return;
  const nelCiclo = state.turniImp.ciclo.includes(d.k);
  const ok = await ask({ title: `Eliminare "${d.nome}"?`, text: nelCiclo ? "Nel ciclo i suoi giorni diventano riposo." : "I giorni segnati con questo turno torneranno vuoti.", ok: "Elimina", danger: true });
  if (!ok) return;
  const imp = state.turniImp;
  if (await salvaImpTurni({ ...imp, tipi: imp.tipi.filter((t) => t.k !== d.k), ciclo: imp.ciclo.map((k) => (k === d.k ? "" : k)) }, "Eliminato")) closeSheet();
}
// Il ciclo che si ripete
let cicloDraft = null;
function apriCiclo() {
  const imp = state.turniImp;
  cicloDraft = { ciclo: [...imp.ciclo], inizio: imp.ciclo_inizio || todayStr() };
  disegnaCiclo();
}
function disegnaCiclo() {
  const d = cicloDraft;
  openSheet(`<h2><span class="mbox">${mascot()}</span>Il ciclo dei turni</h2>
    <p style="margin:0 0 10px;color:var(--ink2)">Componi la sequenza giorno per giorno (es. M M P P N N R R): quando finisce ricomincia da capo, da sola.</p>
    <div class="ciclo-seq grande">${d.ciclo.map((k, i) => { const t = tipoDa(k); return t ? `<button data-act="ciclo-togli" data-v="${i}" title="Togli">${chipTurno(t)}<small>${i + 1}</small></button>` : ""; }).join("") || `<span class="hint">Ancora vuoto: aggiungi i giorni qui sotto</span>`}</div>
    <div class="field"><label>Aggiungi un giorno</label><div class="tpicks mini">${[...state.turniImp.tipi, RIPOSO].map((t) => `<button class="tpick" data-act="ciclo-aggiungi" data-id="${t.k}" ${d.ciclo.length >= 62 ? "disabled" : ""}>${chipTurno(t)}<span><b>${esc(t.nome)}</b></span></button>`).join("")}</div></div>
    <div class="field"><label>Il giorno 1 del ciclo è</label><input class="input" type="date" id="cIni" value="${d.inizio}"></div>
    <p class="hint">Tocca un giorno della sequenza per toglierlo. I cambi fatti a mano restano.</p>
    <div class="actions">${state.turniImp.ciclo.length ? `<button class="btn danger" data-act="ciclo-cancella">Niente ciclo</button>` : ""}<button class="btn" data-act="close">Annulla</button><button class="btn primary" data-act="ciclo-salva">Salva</button></div>`);
  $("#cIni").addEventListener("input", (e) => { cicloDraft.inizio = e.target.value; });
}
async function salvaCiclo(vuoto = false) {
  const d = cicloDraft;
  if (!vuoto) {
    if (!d.ciclo.length) { toast("Aggiungi almeno un giorno"); return; }
    if (!RE_YMD.test(d.inizio || "")) { toast("Scegli il giorno di inizio"); return; }
  }
  if (await salvaImpTurni({ ...state.turniImp, ciclo: vuoto ? [] : d.ciclo, ciclo_inizio: vuoto ? null : d.inizio }, vuoto ? "Ciclo tolto" : "Ciclo salvato 🌸")) { closeSheet(); if (!vuoto) cheer(); }
}

/* =========================================================
   SPESE
   Private: le vede solo chi le scrive (lo garantisce il database), mai nelle liste condivise.
   Gli importi sono in centesimi (niente arrotondamenti strani), le categorie sono fisse.
   ========================================================= */
// [id, emoji, nome, colore della barra]
const CATEGORIE_SPESA = [
  ["spesa", "🛒", "Spesa", "#bfe8b0"], ["casa", "🏠", "Casa", "#ffd29a"], ["bollette", "💡", "Bollette", "#fff09a"],
  ["trasporti", "🚗", "Trasporti", "#b5d4ff"], ["ristoranti", "🍝", "Ristoranti", "#ffc6a8"], ["svago", "🎬", "Svago", "#d2c2ff"],
  ["salute", "💊", "Salute", "#a8e0dc"], ["abbigliamento", "👗", "Vestiti", "#f5c2f0"], ["regali", "🎁", "Regali", "#ffb3c7"],
  ["animali", "🐶", "Animali", "#e3f0a8"], ["altro", "✨", "Altro", "#ddd3c6"]
];
const MAX_CENT = 99999999; // 999.999,99 €
const catSpesa = (k) => CATEGORIE_SPESA.find((c) => c[0] === k) || CATEGORIE_SPESA[CATEGORIE_SPESA.length - 1];
const euro = (cent) => (cent / 100).toLocaleString("it-IT", { style: "currency", currency: "EUR" });
// "12,50" "12.5" "1.234,56" "€ 3" -> centesimi (null se non è un importo valido)
function parseImporto(raw) {
  let s = String(raw ?? "").replace(/[\s€]/g, "").slice(0, 20);
  if (!s) return null;
  if (s.includes(",") && s.includes(".")) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (s.includes(",")) s = s.replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ""); // 1.234 = milleduecentotrentaquattro
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(s)) return null;
  const [i, d = ""] = s.split(".");
  const cent = parseInt(i, 10) * 100 + parseInt((d + "00").slice(0, 2), 10);
  return cent >= 1 && cent <= MAX_CENT ? cent : null;
}
const fmtImporto = (cent) => (cent / 100).toFixed(2).replace(".", ",");
function cleanSpesa(r) {
  if (!r || typeof r !== "object") return null;
  const id = typeof r.id === "string" && RE_ID.test(r.id) ? r.id : null;
  const c = Number(r.importo_cent);
  if (!id || !validYmd(r.giorno) || !Number.isInteger(c) || c < 1 || c > MAX_CENT) return null;
  return { id, giorno: r.giorno, importo_cent: c, categoria: catSpesa(str(r.categoria))[0], nota: taglia(str(r.nota).trim(), 120), created_at: isIso(r.created_at) ? r.created_at : "" };
}
const cleanBudget = (v) => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= MAX_CENT ? n : null; };
const SpeseStore = {
  async carica() {
    if (!ONLINE_MODE) { const o = LS.get("mochi.spese", {}) || {}; return { voci: (Array.isArray(o.voci) ? o.voci : []).map(cleanSpesa).filter(Boolean).slice(0, 5000), budget: cleanBudget(o.budget) }; }
    const [a, b] = await Promise.all([
      store.sb.from("spese").select("id,giorno,importo_cent,categoria,nota,created_at").order("giorno", { ascending: false }).limit(5000),
      store.sb.from("spese_impostazioni").select("budget_cent").maybeSingle()
    ]);
    if (a.error) throw a.error; if (b.error) throw b.error;
    return { voci: (a.data || []).map((r) => cleanSpesa({ ...r, id: String(r.id) })).filter(Boolean), budget: cleanBudget(b.data?.budget_cent) };
  },
  _local() { LS.set("mochi.spese", { voci: state.spese.voci, budget: state.spese.budget }); },
  // Restituisce la spesa salvata (una nuova riceve l'id dal database)
  async salva(sp, nuova) {
    if (!ONLINE_MODE) return sp;
    const row = { giorno: sp.giorno, importo_cent: sp.importo_cent, categoria: sp.categoria, nota: sp.nota || null };
    if (nuova) {
      const { data, error } = await store.sb.from("spese").insert(row).select("id,created_at").single();
      if (error) throw error;
      return { ...sp, id: String(data.id), created_at: data.created_at };
    }
    const { error } = await store.sb.from("spese").update(row).eq("id", sp.id);
    if (error) throw error;
    return sp;
  },
  async elimina(id) {
    if (!ONLINE_MODE) return;
    const { error } = await store.sb.from("spese").delete().eq("id", id);
    if (error) throw error;
  },
  async salvaBudget(cent) {
    if (!ONLINE_MODE) return;
    const { error } = await store.sb.from("spese_impostazioni").upsert({ user_id: store.user.id, budget_cent: cent }, { onConflict: "user_id" });
    if (error) throw error;
  }
};
async function caricaSpese() {
  try { state.spese = await SpeseStore.carica(); LS.set("mochi.speseCache", state.spese); }
  catch { const c = LS.get("mochi.speseCache", null); state.spese = { voci: (Array.isArray(c?.voci) ? c.voci : []).map(cleanSpesa).filter(Boolean), budget: cleanBudget(c?.budget) }; }
}
const speseDelMese = (m) => { const k = monthKey(m); return state.spese.voci.filter((v) => v.giorno.startsWith(k)); };
const totaleMese = (m) => speseDelMese(m).reduce((a, v) => a + v.importo_cent, 0);
const ordineSpese = (a, b) => b.giorno.localeCompare(a.giorno) || (b.created_at || "").localeCompare(a.created_at || "");

// Pagina "Spese"
function viewSpese() {
  const m = state.speseMese || (state.speseMese = new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const voci = speseDelMese(m).sort(ordineSpese), tot = voci.reduce((a, v) => a + v.importo_cent, 0), bud = state.spese.budget;
  const per = {}; voci.forEach((v) => { per[v.categoria] = (per[v.categoria] || 0) + v.importo_cent; });
  const cats = Object.entries(per).sort((a, b) => b[1] - a[1]), max = cats.length ? cats[0][1] : 1;
  const cur = monthKey(m) === monthKey(new Date());
  const barra = bud ? (() => {
    const pct = Math.min(100, Math.round((tot / bud) * 100)), oltre = tot > bud;
    return `<div class="sp-bud ${oltre ? "oltre" : ""}"><span class="sp-bar"><i style="width:${pct}%"></i></span>
      <small>${oltre ? `Oltre il budget di <b>${euro(tot - bud)}</b>` : `Restano <b>${euro(bud - tot)}</b> su ${euro(bud)}`}</small>
      <button class="fbtn" data-act="spese-budget">Cambia</button></div>`;
  })() : `<button class="fbtn" data-act="spese-budget" style="margin-top:10px">Imposta un budget mensile</button>`;
  return `<div class="sec" style="margin-top:0"><h2><span class="emo">👛 </span>Spese</h2></div>
    <div class="split spese"><div class="sp-top">
      <div class="calhead"><button class="iconbtn" data-act="spese-mese" data-v="-1" aria-label="Mese prima">‹</button><h2>${MESI[m.getMonth()]} ${m.getFullYear()}</h2><button class="iconbtn" data-act="spese-mese" data-v="1" aria-label="Mese dopo">›</button></div>
      <div class="sp-tot"><span>${cur ? "Questo mese hai speso" : `A ${MESI[m.getMonth()]} hai speso`}</span><b>${euro(tot)}</b>${barra}</div>
      <button class="btn primary sp-add" data-act="spesa-nuova">+ Aggiungi una spesa</button>
    </div><div class="col-side">
      <div class="sec"><h2>Per categoria</h2></div>
      ${cats.length ? `<div class="sp-cats">${cats.map(([k, c]) => { const x = catSpesa(k); return `<div class="sp-cat"><span class="sp-e" style="--cc:${x[3]}">${x[1]}</span>
          <span class="sp-cn"><b>${x[2]}</b><span class="sp-bar"><i style="width:${Math.max(3, Math.round((c / max) * 100))}%;background:${x[3]}"></i></span></span>
          <span class="sp-cv"><b>${euro(c)}</b><small>${Math.round((c / tot) * 100)}%</small></span></div>`; }).join("")}</div>`
        : `<p class="hint" style="margin:0 4px">Qui vedrai dove vanno i tuoi soldi, categoria per categoria.</p>`}
    </div><div class="sp-lista">
      <div class="sec"><h2>Le spese del mese</h2>${voci.length ? `<span class="count">${voci.length}</span>` : ""}</div>
      ${voci.length ? `<div class="list">${voci.map((v) => { const c = catSpesa(v.categoria); return `<button class="sp-riga" data-act="spesa-modifica" data-id="${esc(v.id)}">
          <span class="sp-e" style="--cc:${c[3]}">${c[1]}</span><span class="sp-t"><b>${esc(v.nota || c[2])}</b><small>${v.nota ? `${c[2]} · ` : ""}${niceDate(v.giorno)}</small></span><b class="sp-i">${euro(v.importo_cent)}</b></button>`; }).join("")}</div>`
        : `<div class="empty"><div class="mbox">${mascot()}</div><div>Nessuna spesa a ${MESI[m.getMonth()]}. Tocca <b>+ Aggiungi una spesa</b>: bastano importo e categoria.</div></div>`}
    </div></div>`;
}
let spesaDraft = null;
function apriSpesa(sp) {
  const ultima = LS.get("mochi.spesa.cat", "spesa");
  spesaDraft = sp ? { ...sp, _nuova: false } : { id: null, giorno: todayStr(), importo_cent: null, categoria: catSpesa(ultima)[0], nota: "", _nuova: true };
  const d = spesaDraft, oggi = todayStr(), ieri = ymd(addDays(new Date(), -1));
  openSheet(`<h2><span class="mbox">${mascot()}</span>${d._nuova ? "Nuova spesa" : "Modifica spesa"}</h2>
    <div class="field sp-imp"><input class="input big" id="sImporto" inputmode="decimal" enterkeyhint="done" placeholder="0,00" maxlength="14" autocomplete="off" value="${d.importo_cent ? fmtImporto(d.importo_cent) : ""}" aria-label="Importo in euro"><span class="eur">€</span></div>
    <div class="field"><label>Categoria</label><div class="sp-pick">${CATEGORIE_SPESA.map(([k, e, n, c]) => `<button class="${d.categoria === k ? "on" : ""}" style="--cc:${c}" data-act="spesa-cat" data-v="${k}"><span class="e">${e}</span><small>${n}</small></button>`).join("")}</div></div>
    <div class="field"><label>Quando</label><div class="sp-quando">
      <button class="fbtn ${d.giorno === oggi ? "on" : ""}" data-act="spesa-giorno" data-v="${oggi}">Oggi</button><button class="fbtn ${d.giorno === ieri ? "on" : ""}" data-act="spesa-giorno" data-v="${ieri}">Ieri</button>
      <input class="input" type="date" id="sGiorno" value="${d.giorno}" min="2000-01-01" max="2100-12-31" aria-label="Giorno"></div></div>
    <div class="field"><label>Nota, se vuoi</label><input class="input" id="sNota" maxlength="120" placeholder="Es. pizza con le amiche" autocomplete="off" value="${esc(d.nota)}"></div>
    <div class="actions">${d._nuova ? "" : `<button class="btn danger" data-act="spesa-elimina" aria-label="Elimina">🗑</button>`}<button class="btn" data-act="close">Annulla</button><button class="btn primary" data-act="spesa-salva">Salva</button></div>`);
  const imp = $("#sImporto");
  imp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); salvaSpesa($("[data-act=spesa-salva]")); } });
  $("#sGiorno").addEventListener("input", (e) => { spesaDraft.giorno = e.target.value; document.querySelectorAll(".sp-quando .fbtn").forEach((b) => b.classList.toggle("on", b.dataset.v === e.target.value)); });
  if (d._nuova) setTimeout(() => imp.focus(), 250);
}
async function salvaSpesa(btn) {
  const d = spesaDraft; if (!d) return;
  const cent = parseImporto($("#sImporto")?.value);
  if (cent === null) { toast(/\d/.test($("#sImporto")?.value || "") ? "Importo non valido: es. 12,50 (massimo 999.999,99 €)" : "Scrivi quanto hai speso, es. 12,50"); $("#sImporto")?.focus(); return; }
  const giorno = $("#sGiorno")?.value || d.giorno;
  if (!validYmd(giorno) || giorno < "2000-01-01" || giorno > "2100-12-31") { toast("Controlla il giorno 📅"); return; }
  const sp = { id: d.id, giorno, importo_cent: cent, categoria: catSpesa(d.categoria)[0], nota: taglia(($("#sNota")?.value || "").trim(), 120), created_at: d.created_at || new Date().toISOString() };
  if (d._nuova) sp.id = uid();
  if (btn) btn.disabled = true;
  const prima = state.spese.voci;
  try {
    const salvata = await SpeseStore.salva(sp, d._nuova);
    state.spese.voci = d._nuova ? [salvata, ...prima] : prima.map((v) => (v.id === d.id ? salvata : v));
    if (!ONLINE_MODE) SpeseStore._local();
    LS.set("mochi.speseCache", state.spese); LS.set("mochi.spesa.cat", sp.categoria);
    state.speseMese = new Date(+giorno.slice(0, 4), +giorno.slice(5, 7) - 1, 1);
    closeSheet(); render();
    toast(d._nuova ? `${catSpesa(sp.categoria)[1]} ${euro(cent)} segnati` : "Spesa aggiornata");
  } catch (e) {
    state.spese.voci = prima; if (btn) btn.disabled = false;
    toast(/limite/i.test(e?.message || "") ? "Hai raggiunto il limite di 5000 spese" : /fetch|network|Failed/i.test(e?.message || "") ? "Sei offline: riprova tra poco" : "Non sono riuscita a salvarla");
  }
}
async function eliminaSpesa() {
  const d = spesaDraft; if (!d?.id) return;
  const keep = { ...d };
  const ok = await ask({ title: "Eliminare questa spesa?", text: `${euro(d.importo_cent)} · ${catSpesa(d.categoria)[2]}${d.nota ? ` · ${d.nota}` : ""}`, ok: "Elimina", danger: true });
  if (!ok) { apriSpesa(keep); return; }
  const prima = state.spese.voci;
  state.spese.voci = prima.filter((v) => v.id !== d.id); render();
  try { await SpeseStore.elimina(d.id); if (!ONLINE_MODE) SpeseStore._local(); LS.set("mochi.speseCache", state.spese); toast("Spesa eliminata"); }
  catch { state.spese.voci = prima; render(); toast("Non sono riuscita a eliminarla"); }
}
async function chiediBudget() {
  const b = state.spese.budget;
  const v = await ask({ title: "Budget mensile", text: "Quanto vuoi spendere al massimo ogni mese? Lascia vuoto per toglierlo.", input: true, value: b ? fmtImporto(b) : "", placeholder: "Es. 800", ok: "Salva", maxlength: 14, inputmode: "decimal" });
  if (v === null) return;
  const cent = String(v).trim() ? parseImporto(v) : null;
  if (String(v).trim() && cent === null) { toast("Importo non valido"); return; }
  const prima = state.spese.budget; state.spese.budget = cent; render();
  try { await SpeseStore.salvaBudget(cent); if (!ONLINE_MODE) SpeseStore._local(); LS.set("mochi.speseCache", state.spese); toast(cent ? `Budget: ${euro(cent)} al mese` : "Budget tolto"); }
  catch { state.spese.budget = prima; render(); toast("Non sono riuscita a salvarlo"); }
}

/* =========================================================
   STAGIONI
   Un velo leggero sullo sfondo, dietro alle schede: poche particelle su un canvas che non riceve tocchi.
   Si ferma quando la pagina è nascosta e se il telefono chiede meno animazioni.
   ========================================================= */
const stag = { tipo: null, p: [], raf: 0, last: 0, w: 0, h: 0, dpr: 1, t: 0 };
function stagioneDiOggi() {
  if (CUSTOM.stagione !== "auto") return CUSTOM.stagione;
  const d = new Date(), m = d.getMonth();
  if (m === 11 || m <= 1) return "neve";
  if (m <= 4) return "petali";
  if (m <= 7) return "sole";
  // autunno: foglie, e un giorno su quattro pioggia
  const g = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5);
  return g % 4 === 0 ? "pioggia" : "foglie";
}
const menoMoto = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const temaScuro = () => { const t = document.documentElement.dataset.theme; return t === "dark" || (t !== "light" && matchMedia("(prefers-color-scheme: dark)").matches); };
const rnd = (a, b) => a + Math.random() * (b - a);
function nuovaParticella(tipo, sparsa) {
  const w = stag.w, h = stag.h, y = sparsa ? rnd(0, h) : rnd(-40, -10);
  if (tipo === "pioggia") return { x: rnd(-40, w), y: sparsa ? rnd(0, h) : rnd(-60, -10), v: rnd(7, 10), l: rnd(10, 18) };
  if (tipo === "sole") return { x: rnd(0, w), y: rnd(0, h), r: rnd(2.6, 5), f: rnd(0, 6.28), v: rnd(.15, .35) };
  if (tipo === "neve") return { x: rnd(0, w), y, r: rnd(1.4, 3.4), v: rnd(.4, 1), f: rnd(0, 6.28), o: rnd(.4, 1.2) };
  const COL = tipo === "foglie" ? ["#e8a25a", "#d9763d", "#c9a24a", "#b5653a"] : ["#ffb7c9", "#ffc8d8", "#f7a1bb", "#ffd9e4"];
  return { x: rnd(0, w), y, r: tipo === "foglie" ? rnd(5, 8) : rnd(3.5, 5.5), v: tipo === "foglie" ? rnd(.6, 1.2) : rnd(.45, .9), f: rnd(0, 6.28), o: rnd(.6, 1.6), a: rnd(0, 6.28), va: rnd(-.04, .04), c: COL[Math.floor(Math.random() * COL.length)] };
}
function stagioniMisura() {
  const cv = $("#stagioni"); if (!cv) return;
  stag.dpr = Math.min(2, window.devicePixelRatio || 1); stag.w = innerWidth; stag.h = innerHeight;
  cv.width = Math.round(stag.w * stag.dpr); cv.height = Math.round(stag.h * stag.dpr);
}
function stagioniAggiorna() {
  const cv = $("#stagioni"); if (!cv) return;
  const tipo = mod("stagioni") && !menoMoto() && !$("#app").classList.contains("hidden") ? stagioneDiOggi() : null;
  if (!tipo) { cancelAnimationFrame(stag.raf); stag.raf = 0; stag.tipo = null; stag.p = []; cv.classList.remove("on"); cv.getContext("2d")?.clearRect(0, 0, cv.width, cv.height); return; }
  if (tipo !== stag.tipo || !stag.p.length) {
    stagioniMisura(); stag.tipo = tipo;
    const n = Math.round(Math.min(34, Math.max(12, (stag.w * stag.h) / 26000)) * (tipo === "pioggia" ? 1.4 : tipo === "sole" ? .9 : 1));
    stag.p = Array.from({ length: n }, () => nuovaParticella(tipo, true));
  }
  cv.classList.add("on");
  if (!stag.raf && document.visibilityState === "visible") stag.raf = requestAnimationFrame(stagioniFrame);
}
function stagioniFrame(now) {
  stag.raf = 0;
  if (!stag.tipo || document.visibilityState !== "visible") return;
  stag.raf = requestAnimationFrame(stagioniFrame);
  if (now - stag.last < 33) return; // circa 30 immagini al secondo bastano e risparmiano batteria
  const k = stag.last ? Math.min(3, (now - stag.last) / 33) : 1; stag.last = now; stag.t += k;
  const cv = $("#stagioni"), c = cv.getContext("2d"), { w, h, tipo } = stag, scuro = temaScuro();
  c.setTransform(stag.dpr, 0, 0, stag.dpr, 0, 0); c.clearRect(0, 0, w, h);
  if (tipo === "sole") {
    const g = c.createRadialGradient(w - 40, 30, 10, w - 40, 30, 190);
    g.addColorStop(0, scuro ? "rgba(255,214,120,.16)" : "rgba(255,200,90,.22)"); g.addColorStop(1, "rgba(255,200,90,0)");
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  }
  stag.p.forEach((p, i) => {
    if (tipo === "pioggia") {
      p.y += p.v * k; p.x += p.v * .18 * k;
      c.strokeStyle = scuro ? "rgba(190,210,255,.32)" : "rgba(100,135,190,.32)"; c.lineWidth = 1.2; c.lineCap = "round";
      c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x - p.l * .18, p.y - p.l); c.stroke();
      if (p.y - p.l > h) stag.p[i] = nuovaParticella(tipo, false);
      return;
    }
    if (tipo === "sole") {
      p.f += .05 * k; p.y -= p.v * k;
      const a = (Math.sin(p.f) + 1) / 2, r = p.r * (.6 + a * .6);
      c.fillStyle = scuro ? `rgba(255,226,140,${.25 + a * .45})` : `rgba(240,180,50,${.22 + a * .4})`;
      c.beginPath(); c.moveTo(p.x, p.y - r * 2); c.quadraticCurveTo(p.x, p.y, p.x + r * 2, p.y); c.quadraticCurveTo(p.x, p.y, p.x, p.y + r * 2);
      c.quadraticCurveTo(p.x, p.y, p.x - r * 2, p.y); c.quadraticCurveTo(p.x, p.y, p.x, p.y - r * 2); c.fill();
      if (p.y < -10) { stag.p[i] = nuovaParticella(tipo, true); stag.p[i].y = h + 10; }
      return;
    }
    p.f += .02 * k; p.y += p.v * k; p.x += Math.sin(p.f) * p.o * .5 * k;
    if (tipo === "neve") {
      c.fillStyle = scuro ? "rgba(255,255,255,.7)" : "rgba(150,172,212,.55)";
      c.beginPath(); c.arc(p.x, p.y, p.r, 0, 6.283); c.fill();
    } else {
      p.a += p.va * k;
      c.save(); c.translate(p.x, p.y); c.rotate(p.a + Math.sin(p.f) * .5); c.globalAlpha = scuro ? .6 : .7; c.fillStyle = p.c;
      c.beginPath();
      if (tipo === "foglie") { c.moveTo(0, -p.r); c.quadraticCurveTo(p.r * .9, 0, 0, p.r); c.quadraticCurveTo(-p.r * .9, 0, 0, -p.r); }
      else c.ellipse(0, 0, p.r, p.r * .62, 0, 0, 6.283);
      c.fill(); c.restore();
    }
    if (p.y > h + 12) stag.p[i] = nuovaParticella(tipo, false);
  });
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { stag.last = 0; stagioniAggiorna(); } else { cancelAnimationFrame(stag.raf); stag.raf = 0; } });
addEventListener("resize", () => { if (stag.tipo) { stagioniMisura(); stag.p.forEach((p) => { if (p.x > stag.w) p.x = rnd(0, stag.w); if (p.y > stag.h) p.y = rnd(0, stag.h); }); } });
matchMedia("(prefers-reduced-motion: reduce)").addEventListener?.("change", () => stagioniAggiorna());

/* =========================================================
   SUONI (dentro l'app)
   Il suono delle notifiche del telefono lo decide il sistema: da una web app non si può cambiare.
   Questi suoni sono creati dal codice con WebAudio (nessun file), a volume basso.
   ========================================================= */
let actx = null;
function audio() {
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
  if (!actx) { try { actx = new AC(); } catch { return null; } }
  if (actx.state === "suspended") actx.resume().catch(() => {});
  return actx;
}
// iPhone: l'audio parte solo dopo un tocco. Al primo tocco lo preparo, in silenzio.
function sbloccaAudio() {
  ["pointerdown", "touchend", "keydown"].forEach((ev) => document.removeEventListener(ev, sbloccaAudio, true));
  if (CUSTOM.suono === "spenti") return;
  const a = audio(); if (!a) return;
  try { const s = a.createBufferSource(); s.buffer = a.createBuffer(1, 1, 22050); s.connect(a.destination); s.start(0); } catch {}
}
["pointerdown", "touchend", "keydown"].forEach((ev) => document.addEventListener(ev, sbloccaAudio, { capture: true, passive: true }));
function nota(a, out, t, f, dur, tipo = "sine", vol = 1, f2 = 0) {
  const o = a.createOscillator(), g = a.createGain();
  o.type = tipo; o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur * .7);
  g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + .012); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + .05);
}
// lungo = notifica e biscotto; corto = cosa fatta
const MOTIVI = {
  campanella: (a, o, t, lungo) => { nota(a, o, t, 1318.5, 1.1, "sine", .6); nota(a, o, t, 2637, .5, "sine", .15); if (lungo) { nota(a, o, t + .2, 1760, 1.3, "sine", .5); nota(a, o, t + .2, 3520, .4, "sine", .1); } },
  bolla: (a, o, t, lungo) => { nota(a, o, t, 380, .2, "sine", .9, 950); if (lungo) nota(a, o, t + .17, 520, .22, "sine", .8, 1300); },
  xilofono: (a, o, t, lungo) => { (lungo ? [1046.5, 1318.5, 1568, 2093] : [1568, 2093]).forEach((f, i) => { nota(a, o, t + i * .11, f, .4, "triangle", .7); nota(a, o, t + i * .11, f * 4, .07, "sine", .1); }); },
  gocce: (a, o, t, lungo) => { nota(a, o, t, 1500, .16, "sine", .7, 700); if (lungo) { nota(a, o, t + .18, 1800, .15, "sine", .6, 850); nota(a, o, t + .38, 1300, .2, "sine", .5, 600); } }
};
function suona(evento, quale = CUSTOM.suono) {
  if (!MOTIVI[quale]) return; // "spenti"
  const a = audio(); if (!a) return;
  try {
    const out = a.createGain(); out.gain.value = evento === "spunta" ? .07 : .12; out.connect(a.destination);
    MOTIVI[quale](a, out, a.currentTime + .02, evento !== "spunta");
  } catch {}
}
// Promemoria arrivato mentre l'app è aperta: il service worker avvisa, l'app suona e lo mostra
navigator.serviceWorker?.addEventListener("message", (e) => {
  const d = e.data;
  if (!d || typeof d !== "object" || d.tipo !== "mochi-notifica" || document.visibilityState !== "visible") return;
  if (d.ric === true && !mod("ricorrenti")) return; // promemoria ricorrente con il modulo spento: in silenzio
  suona("notifica");
  const t = taglia(str(d.title).trim(), 80), b = taglia(str(d.body).trim(), 120);
  if (t || b) toast(`${t}${t && b ? ": " : ""}${b}`);
});

/* ---------- Consiglia alla sviluppatrice ---------- */
// Solo il tipo di dispositivo (niente modello, versione o altro): serve a capire dove c'è un problema
function dispositivo() {
  const u = navigator.userAgent;
  if (/iPhone|iPod/.test(u)) return "iPhone";
  if (/iPad/.test(u) || (/Macintosh/.test(u) && navigator.maxTouchPoints > 1)) return "iPad";
  if (/Android/.test(u)) return "Android";
  if (/Macintosh/.test(u)) return "Mac";
  if (/Windows/.test(u)) return "Windows";
  return "Altro";
}
let consiglio = { tipo: "idea", testo: "" };
const TIPI_CONSIGLIO = [["idea", "💡", "Idea"], ["problema", "🐞", "Problema"], ["complimento", "💗", "Complimento"]];
const STATI_MSG = { ricevuto: ["💌", "Ricevuto"], in_corso: ["🛠️", "Ci sto lavorando"], fatto: ["✅", "Fatto"], no: ["🌙", "Non per ora"] };
const statoMsg = (k) => STATI_MSG[k] || STATI_MSG.ricevuto;
let mieiMsg = [];
const fmtMsg = (d) => new Date(d).toLocaleString("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
function rigaMioMsg(m) {
  const [e, l] = statoMsg(m.stato);
  return `<div class="msg ${m.risposta_vista === false ? "new" : ""}"><div class="msg-h"><span class="e">${e}</span><div><b>${esc(l)}</b><small>${esc({ idea: "Idea", problema: "Problema", complimento: "Complimento" }[m.tipo] || "Messaggio")} · ${fmtMsg(m.created_at)}</small></div></div>
    <div class="msg-t" style="color:var(--ink2)">${esc(m.testo.length > 160 ? m.testo.slice(0, 160) + "…" : m.testo)}</div>
    ${m.risposta ? `<div class="msg-risp"><b>Risposta</b>${esc(m.risposta)}</div>` : ""}</div>`;
}
// All'avvio: se la sviluppatrice ha risposto, lo si fa vedere una volta
async function controllaRisposte() {
  if (!ONLINE_MODE) return;
  try { mieiMsg = (await store.mieiConsigli()).filter((m) => m && typeof m.testo === "string"); } catch { return; }
  const nuove = mieiMsg.filter((m) => m.risposta_vista === false);
  if (!nuove.length) return;
  setTimeout(() => whenSheetFree(() => {
    openSheet(`<h2><span class="mbox">${mascot("happy")}</span>${nuove.length === 1 ? "Hai una risposta!" : `Hai ${nuove.length} risposte!`}</h2>
      <p style="margin:0 0 12px;color:var(--ink2)">La sviluppatrice ha letto i tuoi messaggi.</p>
      <div class="list">${nuove.map(rigaMioMsg).join("")}</div>
      <div class="actions" style="margin-top:14px"><button class="btn primary" data-act="close">Grazie!</button></div>`);
    if (nuove.some((m) => m.stato === "fatto")) setTimeout(() => cheer(), 300);
    store.risposteViste().then(() => nuove.forEach((m) => (m.risposta_vista = true))).catch(() => {});
  }), 1800);
}
function openConsiglio() {
  const ph = { idea: "Mi piacerebbe che Mochi...", problema: "Cosa è successo? Cosa stavi facendo?", complimento: "Cosa ti piace di più?" }[consiglio.tipo];
  openSheet(`<h2><span class="mbox">${mascot("happy")}</span>Consiglia alla sviluppatrice</h2>
    <p style="margin:0 0 12px;color:var(--ink2)">Il messaggio arriva solo a chi ha creato ${esc(CUSTOM.nome_app)}, insieme al tuo nome e alla tua email per poterti rispondere.</p>
    <div class="seg" style="margin-bottom:12px">${TIPI_CONSIGLIO.map(([v, e, l]) => `<button class="${consiglio.tipo === v ? "on" : ""}" data-act="c-tipo" data-v="${v}"><span class=e>${e}</span>${l}</button>`).join("")}</div>
    <div class="field"><textarea class="input" id="cTesto" maxlength="2000" placeholder="${ph}">${esc(consiglio.testo)}</textarea>
      <div class="hint" id="cCount" style="text-align:right">${consiglio.testo.length}/2000</div></div>
    <div class="actions"><button class="btn" data-act="close">Annulla</button><button class="btn primary" data-act="c-send">Invia 💌</button></div>
    ${mieiMsg.length ? `<div class="sec"><h2>I tuoi messaggi</h2></div><div class="list">${mieiMsg.slice(0, 20).map(rigaMioMsg).join("")}</div>` : ""}`);
  const t = $("#cTesto");
  t.addEventListener("input", () => { consiglio.testo = t.value; $("#cCount").textContent = `${t.value.length}/2000`; });
}
async function sendConsiglio(btn) {
  const testo = consiglio.testo.trim();
  if (testo.length < 3) { toast("Scrivi qualche parola in più 🌸"); return; }
  btn.disabled = true; btn.textContent = "Invio...";
  try {
    await store.sendConsiglio(consiglio.tipo, testo.slice(0, 2000));
    consiglio = { tipo: "idea", testo: "" };
    closeSheet(); cheer(); toast("Grazie! Messaggio arrivato 💌");
    try { mieiMsg = await store.mieiConsigli(); } catch {}
  } catch (e) {
    btn.disabled = false; btn.textContent = "Invia 💌";
    const m = String(e?.message || "");
    toast(/messaggi oggi|limite di messaggi/.test(m) ? m : /fetch|network|Failed/i.test(m) ? "Sei offline: riprova tra poco" : "Non sono riuscita a mandarlo, riprova");
  }
}

/* ---------- Messaggi ricevuti (visibile solo all'amministratrice) ----------
   Tutto ciò che arriva da qui è scritto da altri utenti: va sempre trattato come testo (esc). */
let isAdmin = false, adminUnread = 0, inbox = [];
async function checkAdmin() {
  try {
    isAdmin = await store.isAdmin(); if (!isAdmin) return;
    inbox = await store.readConsigli();
    adminUnread = inbox.filter((m) => !m.letto).length;
    if (adminUnread) setTimeout(() => toast(`Hai ${adminUnread} ${adminUnread === 1 ? "messaggio nuovo" : "messaggi nuovi"} 📬`), 2500);
  } catch { isAdmin = false; }
}
const RE_EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;
async function openInbox(refresh = true) {
  if (refresh) { try { inbox = await store.readConsigli(); } catch { toast("Non riesco a leggere i messaggi"); return; } }
  adminUnread = inbox.filter((m) => !m.letto).length;
  const em = { idea: "💡", problema: "🐞", complimento: "💗" };
  const fmt = (d) => new Date(d).toLocaleString("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  openSheet(`<h2><span class="mbox">${mascot()}</span>Messaggi ricevuti</h2>
    <p style="margin:0 0 12px;color:var(--ink2)">${inbox.length ? `${inbox.length} in tutto · ${adminUnread} da leggere` : "Ancora nessun messaggio 🌸"}</p>
    <div class="list">${inbox.map((m) => `
      <div class="msg ${m.letto ? "" : "new"}">
        <div class="msg-h"><span class="e">${em[m.tipo] || "💌"}</span><div><b>${esc(m.nome || "Senza nome")}</b><small>${esc(m.email || "")} · ${esc(m.dispositivo || "")} · ${fmt(m.created_at)}</small></div></div>
        <div class="msg-t">${esc(m.testo)}</div>
        ${m.stato ? `<div class="msg-stato">${statoMsg(m.stato)[0]} ${esc(statoMsg(m.stato)[1])}</div>` : ""}
        ${m.risposta ? `<div class="msg-risp"><b>La tua risposta</b>${esc(m.risposta)}</div>` : ""}
        <div class="msg-a">
          ${RE_EMAIL.test(m.email || "") ? `<a class="fbtn" style="text-decoration:none" href="mailto:${esc(encodeURIComponent(m.email))}?subject=${encodeURIComponent("Il tuo messaggio su " + CUSTOM.nome_app)}">Email</a>` : ""}
          <button class="fbtn ${m.letto ? "" : "on"}" data-act="inbox-read" data-id="${esc(m.id)}">${m.letto ? "Da leggere" : "Letto"}</button>
          ${m.stato ? `<button class="fbtn on" data-act="inbox-rispondi" data-id="${esc(m.id)}">Rispondi</button>` : ""}
        </div>
      </div>`).join("")}</div>
    <div class="actions" style="margin-top:14px"><button class="btn primary" data-act="close">Chiudi</button></div>`);
}
// Rispondere dentro l'app: stato + commento facoltativo, chi ha scritto riceve una notifica
let rispDraft = null;
function apriRisposta(id) {
  const m = inbox.find((x) => x.id === id); if (!m) return;
  rispDraft = rispDraft?.id === id ? rispDraft : { id, stato: m.stato === "ricevuto" ? "fatto" : m.stato || "fatto", risposta: m.risposta || "" };
  openSheet(`<h2><span class="mbox">${mascot()}</span>Rispondi a ${esc(m.nome || "chi ha scritto")}</h2>
    <div class="msg" style="margin-bottom:12px"><div class="msg-t" style="margin:0">${esc(m.testo)}</div></div>
    <div class="field"><label>Stato</label><div class="tpicks">${Object.entries(STATI_MSG).map(([k, [e, l]]) => `<button class="tpick ${rispDraft.stato === k ? "on" : ""}" data-act="risp-stato" data-v="${k}"><span style="font-size:20px">${e}</span><span><b>${l}</b></span></button>`).join("")}</div></div>
    <div class="field"><label>Un commento, se vuoi</label><textarea class="input" id="rTesto" maxlength="500" placeholder="Fatto! Lo trovi nel menu 🌸">${esc(rispDraft.risposta)}</textarea></div>
    <p class="hint">Lo vede solo chi ha scritto, nell'app, insieme a una notifica.</p>
    <div class="actions"><button class="btn" data-act="risp-indietro">Indietro</button><button class="btn primary" data-act="risp-salva">Invia risposta</button></div>`);
  $("#rTesto").addEventListener("input", (e) => { rispDraft.risposta = e.target.value; });
}
async function salvaRisposta(btn) {
  const d = rispDraft; if (!d) return;
  const r = d.risposta.trim().slice(0, 500);
  btn.disabled = true;
  try {
    await store.rispondiConsiglio(d.id, d.stato, r);
    const m = inbox.find((x) => x.id === d.id); if (m) { m.stato = d.stato; m.risposta = r || null; m.letto = true; }
    rispDraft = null; toast("Risposta inviata 💌"); openInbox(false);
  } catch { btn.disabled = false; toast("Non sono riuscita a mandarla"); }
}
async function toggleRead(id) {
  const m = inbox.find((x) => x.id === id); if (!m) return;
  try { await store.markConsiglio(id, !m.letto); m.letto = !m.letto; openInbox(false); }
  catch { toast("Non sono riuscita a salvarlo"); }
}

function maybeAskPush() {
  if (!PUSH_READY || !("Notification" in window) || Notification.permission !== "default" || LS.get("mochi.askedPush", false)) return;
  LS.set("mochi.askedPush", true);
  setTimeout(() => openSheet(`<h2><span class="mbox">${mascot()}</span>Vuoi che ti avvisi io?</h2>
    <p style="margin:0 0 16px;color:var(--ink2)">Attiva le notifiche e ti mando un promemoria all'orario giusto, anche ad app chiusa.</p>
    <div class="actions"><button class="btn" data-act="close">Più tardi</button><button class="btn primary" data-act="enable-push">Sì, avvisami 🔔</button></div>`), 900);
}

function exportData() {
  const blob = new Blob([JSON.stringify({ esportato_il: new Date().toISOString(), voci: state.items, umori: state.umori, turni: { impostazioni: state.turniImp, giorni: state.turni },
    spese: { budget_mensile_cent: state.spese.budget, voci: [...state.spese.voci].sort(ordineSpese) } }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `mochi-backup-${todayStr()}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* =========================================================
   EFFETTI
   ========================================================= */
let toastT;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 2600); }
/* Trascina giù la finestra per chiuderla (su telefono), come nelle app native.
   La finestra si muove SOLO se il dito parte:
   - dalla maniglia / intestazione (la fascia in alto), oppure
   - dal contenuto, ma solo se è già in cima, nessun campo è attivo (tastiera chiusa) e si tira verso il basso.
   In tutti gli altri casi il dito scorre il contenuto e basta: la finestra resta ferma e la pagina sotto non si muove. */
const ZONA_MANIGLIA = 48;
const campo = (el) => el && el.closest && el.closest("input,textarea,select,[contenteditable]");
// C'è un elemento (fino alla finestra compresa) che può ancora scorrere in quella direzione?
function puoScorrere(el, sh, dx, dy) {
  for (let n = el; n && n !== sh.parentNode; n = n.parentNode) {
    if (n.nodeType !== 1) continue;
    const s = getComputedStyle(n);
    if (Math.abs(dy) >= Math.abs(dx)) {
      if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 1) {
        if (dy < 0 && n.scrollTop + n.clientHeight < n.scrollHeight - 1) return true; // dito in su: scorre verso il basso
        if (dy > 0 && n.scrollTop > 0) return true;
      }
    } else if (/(auto|scroll)/.test(s.overflowX) && n.scrollWidth > n.clientWidth + 1) {
      if (dx < 0 && n.scrollLeft + n.clientWidth < n.scrollWidth - 1) return true;
      if (dx > 0 && n.scrollLeft > 0) return true;
    }
    if (n === sh) break;
  }
  return false;
}
(function sheetSwipe() {
  const sh = $("#sheet"), scrim = $("#scrim");
  let g = null; // gesto in corso
  sh.addEventListener("touchstart", (e) => {
    g = null;
    if (!telefono() || !sh.classList.contains("on") || e.touches.length !== 1) return;
    const t = e.touches[0], top = sh.getBoundingClientRect().top;
    const maniglia = t.clientY - top <= ZONA_MANIGLIA && !campo(e.target);
    const tastiera = !!campo(document.activeElement) && sh.contains(document.activeElement);
    g = { x0: t.clientX, y0: t.clientY, t0: Date.now(), dy: 0, dragging: false, deciso: false,
      // dal contenuto: solo se in cima, fuori dai campi e con la tastiera chiusa
      puo: maniglia || (sh.scrollTop <= 0 && !campo(e.target) && !tastiera) };
  }, { passive: true });
  sh.addEventListener("touchmove", (e) => {
    if (!g || e.touches.length !== 1) return;
    const t = e.touches[0], dx = t.clientX - g.x0, d = t.clientY - g.y0;
    if (!g.deciso) {
      if (Math.abs(d) < 6 && Math.abs(dx) < 6) return;
      g.deciso = true;
      // tira giù, in verticale, da un punto consentito, e niente dentro può ancora scorrere verso l'alto
      if (g.puo && d > 0 && Math.abs(d) > Math.abs(dx) && sh.scrollTop <= 0 && !puoScorrere(e.target, sh, 0, 1)) {
        g.dragging = true; sh.style.transition = "none";
      }
    }
    if (g.dragging) {
      g.dy = Math.max(0, d);
      sh.style.transform = `translateY(${g.dy}px)`;
      e.preventDefault(); return;
    }
    // scorrimento normale: se niente può più scorrere in quella direzione, il gesto si ferma qui
    // (altrimenti su iPhone si muoverebbe tutta la pagina, finestra compresa)
    if (e.cancelable && !puoScorrere(e.target, sh, dx, d)) e.preventDefault();
  }, { passive: false });
  const end = () => {
    if (!g) return;
    const { dragging, dy, t0 } = g; g = null;
    if (!dragging) return;
    const fast = dy / Math.max(1, Date.now() - t0) > 0.5;
    sh.style.transition = ""; sh.style.transform = "";
    if (dy > 110 || (fast && dy > 40)) closeSheet();
  };
  sh.addEventListener("touchend", end); sh.addEventListener("touchcancel", end);
  // toccando lo sfondo scuro la pagina sotto non scorre
  scrim.addEventListener("touchmove", (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });
})();
/* iPhone con la tastiera aperta: la finestra resta appoggiata sopra la tastiera, dentro la parte visibile */
function sheetSuTastiera() {
  const vv = window.visualViewport, sh = $("#sheet"); if (!vv || !sh) return;
  if (!telefono()) { sh.style.removeProperty("--vv-b"); sh.style.removeProperty("--vv-h"); return; }
  const sotto = Math.max(0, document.documentElement.clientHeight - (vv.offsetTop + vv.height));
  sh.style.setProperty("--vv-b", Math.round(sotto) + "px");
  sh.style.setProperty("--vv-h", Math.round(vv.height) + "px");
}
window.visualViewport?.addEventListener("resize", sheetSuTastiera);
window.visualViewport?.addEventListener("scroll", sheetSuTastiera);

function confetti(x, y, n = 18) {
  const cols = ["#ff8fb1", "#ff9e7a", "#ffd6e4", "#bfe8d4", "#e5dcff", "#fff1c2"];
  for (let i = 0; i < n; i++) {
    const c = document.createElement("i");
    c.className = "conf";
    c.style.left = x + "px"; c.style.top = y + "px"; c.style.background = cols[i % cols.length];
    c.style.setProperty("--dx", (Math.random() * 220 - 110) + "px");
    c.style.setProperty("--dy", (Math.random() * 180 - 140) + "px");
    document.body.appendChild(c); setTimeout(() => c.remove(), 1000);
  }
}

/* =========================================================
   EVENTI
   ========================================================= */
document.addEventListener("click", async (e) => {
  const tab = e.target.closest("[data-tab]");
  if (tab) {
    let t = tab.dataset.tab;
    if (t === "menu" && state.tab === "menu") t = state.tabPrima && state.tabPrima !== "menu" ? state.tabPrima : "oggi"; // ☰ di nuovo: si richiude
    else if (t === "menu") state.tabPrima = state.tab;
    state.tab = t; render(); window.scrollTo({ top: 0, behavior: "smooth" }); return;
  }
  if (e.target.id === "scrim") { closeSheet(); return; }
  const el = e.target.closest("[data-act]"); if (!el) return;
  const act = el.dataset.act, v = el.dataset.v, id = el.dataset.id;
  switch (act) {
    case "new": openEditor(newItem(state.tab === "agenda" ? { due_date: state.calSel } : {}), true); break;
    case "new-on-day": openEditor(newItem({ due_date: state.calSel, kind: "event" }), true); break;
    case "edit": { e.stopPropagation(); const it = state.items.find((x) => x.id === id); if (it) openEditor(it, false); break; }
    case "toggle": {
      e.stopPropagation();
      const it = state.items.find((x) => x.id === id); if (!it) break;
      const prima = bocconcini().length;
      it.done = !it.done; it.done_at = it.done ? new Date().toISOString() : null; it.updated_at = new Date().toISOString();
      if (it.done) { const r = el.getBoundingClientRect(); confetti(r.left + 13, r.top + 13); suona("spunta"); if (navigator.vibrate) navigator.vibrate(15); feed(el, it); setTimeout(() => cheer(), 650); checkRegalo(prima); }
      else applyCustom();
      setTimeout(render, it.done ? 280 : 0);
      await store.save(it); break;
    }
    case "close": closeSheet(); break;
    // lista da spuntare: nell'elenco e sulla bacheca (senza aprire l'editor)
    case "st-apri": { e.stopPropagation(); if (state.stAperti.has(id)) state.stAperti.delete(id); else state.stAperti.add(id); render(); break; }
    case "st-spunta": {
      e.stopPropagation();
      const it = state.items.find((x) => x.id === id), x = it?.sottotask?.find((s) => s.id === v); if (!x) break;
      x.f = !x.f; it.updated_at = new Date().toISOString();
      if (x.f) { const r = el.getBoundingClientRect(); confetti(r.left + 12, r.top + r.height / 2, 8); suona("spunta"); }
      render(); await store.save(it); break;
    }
    // lista da spuntare: dentro l'editor
    case "st-toggle": { const x = draft?.sottotask.find((s) => s.id === v); if (x) { x.f = !x.f; drawSt(); } break; }
    case "st-del": if (draft) { draft.sottotask = draft.sottotask.filter((s) => s.id !== v); drawSt(); } break;
    case "st-su": { const a = draft?.sottotask, i = a ? a.findIndex((s) => s.id === v) : -1; if (i > 0) { [a[i - 1], a[i]] = [a[i], a[i - 1]]; drawSt(); } break; }
    // spese
    case "spesa-nuova": apriSpesa(null); break;
    case "spesa-modifica": { const sp = state.spese.voci.find((x) => x.id === id); if (sp) apriSpesa(sp); break; }
    case "spesa-cat": if (spesaDraft && CATEGORIE_SPESA.some((c) => c[0] === v)) { spesaDraft.categoria = v; document.querySelectorAll(".sp-pick button").forEach((b) => b.classList.toggle("on", b.dataset.v === v)); } break;
    case "spesa-giorno": if (spesaDraft && validYmd(v)) { spesaDraft.giorno = v; $("#sGiorno").value = v; document.querySelectorAll(".sp-quando .fbtn").forEach((b) => b.classList.toggle("on", b.dataset.v === v)); } break;
    case "spesa-salva": salvaSpesa(el); break;
    case "spesa-elimina": eliminaSpesa(); break;
    case "spese-mese": { const g = state.speseMese || new Date(); state.speseMese = new Date(g.getFullYear(), g.getMonth() + (+v), 1); render(); break; }
    case "spese-budget": chiediBudget(); break;
    // impostazioni: moduli, stagioni, suoni
    case "modulo": {
      const m = MODULI.find((x) => x[0] === v); if (!m) break;
      const acceso = !mod(v);
      // I ricorrenti li manda il server: spegnendo il modulo vanno messi in pausa, altrimenti continuerebbero ad arrivare
      if (v === "ricorrenti" && ONLINE_MODE) { const r = await moduloRicorrenti(acceso); if (r === "annulla") { riapriImpostazioni(); break; } if (r === "errore") break; }
      await saveCustom({ moduli: { ...CUSTOM.moduli, [v]: acceso } });
      riapriImpostazioni();
      if (v === "ricorrenti" && acceso && ricorrenti.some((x) => !x.attiva)) toast("I tuoi promemoria ricorrenti sono in pausa: riattivali dalla pagina Ricorrenti");
      else toast(acceso ? `${m[1]} ${m[2]}: acceso` : `${m[1]} ${m[2]}: spento. I dati restano al sicuro`);
      break;
    }
    case "pick-stagione": if (STAGIONI.some((x) => x[0] === v)) { await saveCustom({ stagione: v }); riapriImpostazioni(); } break;
    case "pick-suono": if (SUONI.some((x) => x[0] === v)) { suona("notifica", v); await saveCustom({ suono: v }); riapriImpostazioni(); } break;
    case "poke": { const sv = el.querySelector(".mascotte"); if (sv) { sv.classList.add("happy"); setTimeout(() => sv.classList.remove("happy"), 1400); } heartAt(el); if (navigator.vibrate) navigator.vibrate(10); break; }
    case "open-custom": openMascotPicker(); break;
    case "open-pancino": openPancino(); break;
    case "open-consiglio": openConsiglio(); if (ONLINE_MODE) store.mieiConsigli().then((r) => { mieiMsg = r.filter((m) => m && typeof m.testo === "string"); if ($("#cTesto")) openConsiglio(); }).catch(() => {}); break;
    case "open-inbox": openInbox(); break;
    case "open-liste": openListe(); break;
    case "open-ricorrenti": openRicorrenti(); break;
    case "b-apri": rompiBiscotto(); break;
    case "umore-set": setUmore(id, +v); break;
    case "umore-apri": apriUmore(v); break;
    case "umore-scegli": umoreScelto = +v; document.querySelectorAll(".facce.grandi button").forEach((b) => b.classList.toggle("on", b.dataset.v === v)); break;
    case "umore-salva": salvaUmoreSheet(id); break;
    case "umore-togli": togliUmore(id); break;
    case "umore-annulla": tornaDaUmore(); break;
    case "turno-giorno": apriTurnoGiorno(v); break;
    case "turno-scegli": scegliTurno(v, id || ""); break;
    case "turno-togli": togliTurno(v); break;
    case "turni-mese": { const g = state.turniMese || new Date(); state.turniMese = new Date(g.getFullYear(), g.getMonth() + (+v), 1); render(); break; }
    case "turni-base": salvaImpTurni({ ...state.turniImp, tipi: TURNI_BASE }, "Fatto! Ora tocca un giorno o imposta il ciclo"); break;
    case "turno-tipo-nuovo": apriTipoTurno(null); break;
    case "turno-tipo": apriTipoTurno(id); break;
    case "tipo-colore": leggiTipoDraft(); tipoDraft.colore = +v; disegnaTipoTurno(); break;
    case "tipo-orario": leggiTipoDraft(); if (tipoDraft.inizio) { tipoDraft.inizio = ""; tipoDraft.fine = ""; tipoDraft.pausa = 0; } else { tipoDraft.inizio = "09:00"; tipoDraft.fine = "17:00"; } disegnaTipoTurno(); break;
    case "tipo-indietro": closeSheet(); break;
    case "tipo-salva": salvaTipoTurno(); break;
    case "tipo-elimina": eliminaTipoTurno(); break;
    case "turni-ciclo": apriCiclo(); break;
    case "ciclo-aggiungi": if (cicloDraft && cicloDraft.ciclo.length < 62 && (id === "" || id == null || tipoDa(id))) { cicloDraft.ciclo.push(id || ""); disegnaCiclo(); } break;
    case "ciclo-togli": if (cicloDraft) { cicloDraft.ciclo.splice(+v, 1); disegnaCiclo(); } break;
    case "ciclo-salva": salvaCiclo(); break;
    case "ciclo-cancella": salvaCiclo(true); break;
    case "giardino-fiore": if (RE_YMD.test(id || "")) apriUmore(id, true); break;
    case "giardino-apri": apriGiardino(new Date(state.calMonth.getFullYear(), state.calMonth.getMonth(), 1)); break;
    case "giardino-move": { const g = giardinoMese; const n = new Date(g.getFullYear(), g.getMonth() + (+v), 1); if (monthKey(n) <= monthKey(new Date())) apriGiardino(n); break; }
    case "giardino-salva": salvaGiardino(); break;
    case "b-chiudi": chiudiBiscotto(); break;
    case "open-biscotto": apriBiscotto(); break;
    case "ric-nuovo": editRicorrente(null); break;
    case "ric-preset": { const p = PRESET_RIC[+v]; if (p) { ricDraft = cleanRic({ ...p }); drawRicorrente(); } break; }
    case "ric-modifica": editRicorrente(ricorrenti.find((x) => x.id === id)); break;
    case "ric-emoji": ricDraft.emoji = EMOJI_RIC.includes(v) ? v : "💧"; drawRicorrente(); break;
    case "ric-giorno": { const g = +v; ricDraft.giorni = ricDraft.giorni.includes(g) ? ricDraft.giorni.filter((x) => x !== g) : [...ricDraft.giorni, g].sort(); drawRicorrente(); break; }
    case "ric-indietro": closeSheet(); break;
    case "ric-salva": salvaRicorrente(el); break;
    case "ric-toggle": toggleRicorrente(id); break;
    case "ric-elimina": eliminaRicorrente(id); break;
    case "l-nuova": openListaEditor(null); break;
    case "l-modifica": openListaEditor(listaById(id)); break;
    case "l-emoji": listaDraft.emoji = EMOJI_LISTE.includes(v) ? v : "🏠"; drawListaEditor(); break;
    case "l-indietro": closeSheet(); break;
    case "l-salva": salvaLista(el); break;
    case "l-invita": invita(id); break;
    case "l-copia": condividiInvito(true); break;
    case "l-condividi": condividiInvito(false); break;
    case "l-codice": chiediCodice(); break;
    case "l-esci": esciLista(id); break;
    case "l-elimina": eliminaLista(id); break;
    case "inbox-read": toggleRead(id); break;
    case "inbox-rispondi": apriRisposta(id); break;
    case "risp-stato": if (rispDraft && STATI_MSG[v]) { rispDraft.risposta = $("#rTesto")?.value ?? rispDraft.risposta; rispDraft.stato = v; apriRisposta(rispDraft.id); } break;
    case "risp-indietro": rispDraft = null; openInbox(false); break;
    case "risp-salva": salvaRisposta(el); break;
    case "c-tipo": consiglio.tipo = v; openConsiglio(); break;
    case "c-send": sendConsiglio(el); break;
    case "pick-palette": await saveCustom({ colore: v }); riapriImpostazioni(); cheer(); break;
    case "pick-font": await saveCustom({ font: v }); riapriImpostazioni(); cheer(); break;
    case "pick-stile": await saveCustom({ stile: v }); riapriImpostazioni(); cheer(); break;
    case "wear": await saveCustom({ accessorio: v }); openPancino(); cheer(); break;
    case "pick-mascot": {
      document.querySelectorAll(".mpick button").forEach((b) => b.classList.toggle("on", b.dataset.v === v));
      el.querySelector(".mascotte")?.classList.add("happy");
      setTimeout(() => el.querySelector(".mascotte")?.classList.remove("happy"), 1400);
      break;
    }
    case "save-custom": {
      const sel = document.querySelector(".mpick button.on")?.dataset.v || CUSTOM.mascotte;
      await saveCustom({ nome_app: $("#cName").value, mascotte: sel });
      closeSheet(); setTimeout(() => cheer(), 200); toast(`Ciao! Ora sono ${MN()} 💗`);
      break;
    }
    case "d-kind": draft.kind = v; draft._kindManual = true; if (v === "note") advanced = true;
      if (draft._autoRemind && !draft._remindManual && v !== "note" && draft.remind !== "auto") draft.remind = defaultRemind(draft);
      drawEditor(); break;
    case "d-area": draft.area = v; drawEditor(); break;
    case "d-lista":
    case "d-more": advanced = true;
      if (draft._new && draft.title) { const p = parseQuick(draft.title); draft.due_date = draft.due_date || p.date; draft.due_time = draft.due_time || p.time; }
      if (draft.remind === "auto") draft.remind = defaultRemind(draft);
      drawEditor();
      if (act === "d-lista") setTimeout(() => { const n = $("#stNew"); if (n) { n.focus(); n.scrollIntoView({ block: "center" }); } }, 60);
      break;
    case "d-color": draft.color = +v; drawEditor(); break;
    case "d-pin": draft.pinned = !draft.pinned; drawEditor(); break;
    case "d-save": saveDraft(); break;
    case "d-delete": {
      const keep = { ...draft }, keepAdv = advanced;
      const yes = await ask({ title: "Eliminare questa voce?", text: `"${keep.title}" sparirà per sempre.`, ok: "Elimina", danger: true });
      if (!yes) { draft = keep; advanced = keepAdv; drawEditor(); break; }
      state.items = state.items.filter((x) => x.id !== keep.id);
      render(); await store.remove(keep.id); toast("Eliminato");
      break;
    }
    case "ask-ok": finishAsk(true); break;
    case "motto": {
      mottoShift++;
      const m = $("#motto"); m.classList.remove("swap"); void m.offsetWidth; m.classList.add("swap");
      headerUpdate(); cheer(1200); break;
    }
    case "ask-cancel": finishAsk(false); break;
    case "todo-filter": state.todoFilter = v; render(); break;
    case "note-filter": state.noteFilter = v; render(); break;
    case "cal-move": state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() + +v, 1); render(); break;
    case "cal-sel": state.calSel = v; render(); break;
    case "cal-jump": { state.calSel = v; const d = parseYmd(v); state.calMonth = new Date(d.getFullYear(), d.getMonth(), 1); state.tab = "agenda"; render(); window.scrollTo({ top: 0 }); break; }
    case "open-recap": openRecap(); break;
    case "recap-move": { const m = state.recapMonth; const n = new Date(m.getFullYear(), m.getMonth() + +v, 1); if (n <= new Date()) openRecap(n); break; }
    case "open-settings": openSettings(); break;
    case "enable-push": enablePush(); break;
    case "disable-push": disablePush(); break;
    case "export": exportData(); break;
    case "logout": {
      const yes = await ask({ title: "Vuoi uscire?", text: "Su questo dispositivo dovrai rientrare con email e password.", ok: "Esci" });
      if (yes) { await store.logout(); clearLocal(); location.reload(); }
      break;
    }
    case "set-name": {
      const n = await ask({ title: `Come vuoi che ti chiami ${MN()}?`, input: true, value: NOME || "", placeholder: "Il tuo nome", ok: "Salva" });
      if (n === null || !String(n).trim()) break;
      try { await store.setName(n.trim().slice(0, 40)); closeSheet(); render(); toast(`Piacere, ${NOME}! 🍣`); } catch { toast("Non sono riuscita a salvarlo"); }
      break;
    }
    case "delete-account": {
      const ok = await ask({ title: "Eliminare l'account?", text: "Verranno cancellati per sempre il tuo account e tutte le tue cose.\nPer confermare scrivi ELIMINA.", input: true, placeholder: "ELIMINA", maxlength: 10, ok: "Elimina per sempre", danger: true });
      if (ok === null) break;
      if (String(ok).trim() !== "ELIMINA") { toast("Eliminazione annullata"); break; }
      try { exportData(); await store.deleteAccount(); clearLocal(); toast(`Account eliminato. Ti ho scaricato un backup. Ciao da ${MN()} 🍣`); setTimeout(() => location.reload(), 3000); }
      catch (err) { toast("Errore: " + (err.message || err)); }
      break;
    }
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { if ($(".biscotto-wrap")) chiudiBiscotto(); else closeSheet(); return; }
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "");
  if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && (e.key === "n" || e.key === "N")
      && !$("#sheet").classList.contains("on") && !$("#app").classList.contains("hidden")) {
    e.preventDefault(); openEditor(newItem(state.tab === "agenda" ? { due_date: state.calSel } : {}), true);
  }
});

/* =========================================================
   AVVIO
   ========================================================= */
function showApp() {
  $("#login").classList.add("hidden");
  $("#app").classList.remove("hidden"); $("#nav").classList.remove("hidden");
}
async function loadAndRender() {
  if (ONLINE_MODE && store.user) await loadListe();
  await caricaUmori();
  await caricaTurni();
  await caricaSpese();
  state.items = await store.list();
  render(); maybeAutoRecap(); checkListeSconosciute();
}
async function boot() {
  leggiInvitoDaLink();
  applyCustom();
  const th = LS.get("mochi.theme", "auto"); if (th !== "auto") document.documentElement.dataset.theme = th;
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

  if (!ONLINE_MODE) { showApp(); await loadAndRender(); maybeShowInstallHint(); maybeShowNovita(); maybeBiscotto(); return; }

  // Modalità online: mostra subito la cache, poi verifica la sessione
  let logged = false;
  try { logged = await store.init(); } catch (e) {
    if (LS.get("mochi.cache", null)) { showApp(); state.items = normalizeAll(LS.get("mochi.cache", [])); setSync(false); render(); return; }
    setLoginMode("login"); $("#lErr").textContent = "Connessione assente. Riprova tra poco."; return;
  }
  if (/type=recovery/.test(location.hash)) { setLoginMode("newpass"); return; }
  if (!logged) { setLoginMode("login"); maybeShowInstallHint(); return; }
  startOnline();
}
async function startOnline() {
  showApp();
  state.liste = LS.get("mochi.liste", []); if (!Array.isArray(state.liste)) state.liste = [];
  state.items = normalizeAll(LS.get("mochi.cache", [])); render();
  await loadAndRender();
  maybeShowInstallHint();
  maybeShowNovita();
  maybeBiscotto();
  resyncPush();
  checkAdmin();
  controllaRisposte();
  invitoInSospeso();
  store.subscribe((p) => {
    if (p.eventType === "DELETE") state.items = state.items.filter((x) => x.id !== p.old?.id);
    else { const n = normalize(p.new); if (!n) return; const i = state.items.findIndex((x) => x.id === n.id); i >= 0 ? (state.items[i] = n) : state.items.push(n); }
    LS.set("mochi.cache", state.items);
    if (!$("#sheet").classList.contains("on")) render();
    checkListeSconosciute();
  });
  // Quando l'app torna in primo piano (es. da iPhone dopo ore) ricarica i dati
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") loadAndRender(); });
  window.addEventListener("online", () => loadAndRender());
}

/* ---------------- schermata di accesso: entra / crea account / password dimenticata / nuova password ---------------- */
let loginMode = "login";
function clearLocal() { ["mochi.cache", "mochi.outbox", "mochi.recapSeen", "mochi.askedPush", "mochi.liste", "mochi.umoriCache", "mochi.turniCache", "mochi.speseCache"].forEach((k) => localStorage.removeItem(k)); }
function setLoginMode(m) {
  loginMode = m;
  $("#login").classList.remove("hidden"); $("#app").classList.add("hidden"); $("#nav").classList.add("hidden");
  const T = {
    login:   ["Ciao!", `${MN()} custodisce le tue cose.<br>Entra per vederle.`, "Entra"],
    signup:  ["Benvenuta!", "Crea il tuo spazio personale.<br>Le tue cose le vedi solo tu.", "Crea account"],
    forgot:  ["Niente panico", "Scrivi la tua email,<br>ti mando un link per una nuova password.", "Inviami il link"],
    newpass: ["Nuova password", "Scegline una di almeno 8 caratteri.", "Salva e entra"]
  }[m];
  $("#lTitle").textContent = T[0]; $("#lSub").innerHTML = T[1]; $("#lBtn").textContent = T[2]; $("#lErr").textContent = "";
  $("#lName").classList.toggle("hidden", m !== "signup");
  $("#lPrivacyRow").classList.toggle("hidden", m !== "signup");
  $("#lEmail").classList.toggle("hidden", m === "newpass");
  $("#lPassWrap").classList.toggle("hidden", m === "forgot");
  showPass(false);
  $("#lPass").autocomplete = m === "login" ? "current-password" : "new-password";
  $("#lSwitch").classList.toggle("hidden", m === "newpass" || (!SIGNUP_OPEN && m === "login"));
  $("#lSwitch").textContent = m === "login" ? "Non hai un account? Creane uno" : "Hai già un account? Entra";
  $("#lForgot").classList.toggle("hidden", m !== "login");
}
// Occhiolino: mostra o nasconde la password mentre la scrivi
function showPass(on) {
  const p = $("#lPass"), b = $("#lEye"); if (!p || !b) return;
  p.type = on ? "text" : "password";
  b.setAttribute("aria-pressed", on ? "true" : "false");
  b.setAttribute("aria-label", on ? "Nascondi password" : "Mostra password");
}
$("#lEye").addEventListener("click", () => { showPass($("#lPass").type === "password"); $("#lPass").focus(); });
$("#lSwitch").addEventListener("click", () => setLoginMode(loginMode === "login" ? "signup" : "login"));
$("#lForgot").addEventListener("click", () => setLoginMode("forgot"));

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#lErr"); err.textContent = "";
  const email = $("#lEmail").value.trim(), pass = $("#lPass").value, nome = $("#lName").value.trim();
  const btn = $("#lBtn"); btn.disabled = true; btn.style.opacity = .6;
  try {
    if (loginMode !== "newpass" && !/^\S+@\S+\.\S+$/.test(email)) throw new Error("Controlla l'email 🙈");
    if (loginMode !== "forgot" && pass.length < 8) throw new Error("La password deve avere almeno 8 caratteri");
    if (loginMode === "login") {
      try { await store.login(email, pass); } catch (x) {
        throw new Error(/confirm/i.test(x.message) ? "Prima conferma l'email: ti ho mandato un link 📬" : "Email o password non corrette 🙈");
      }
      startOnline();
    } else if (loginMode === "signup") {
      if (!nome) throw new Error("Dimmi come ti chiami 🌸");
      if (!$("#lPrivacy").checked) throw new Error("Spunta l'informativa privacy per continuare");
      const r = await store.signup(nome, email, pass).catch((x) => {
        throw new Error(/registered|exists/i.test(x.message) ? "Questa email ha già un account" : /signup.*disabled|not allowed/i.test(x.message) ? "Le registrazioni sono chiuse" : x.message);
      });
      if (r === "logged") startOnline();
      else { setLoginMode("login"); $("#lEmail").value = email; $("#lErr").style.color = "var(--mint-d)"; $("#lErr").textContent = "Ti ho mandato un'email: apri il link e poi entra 📬"; }
    } else if (loginMode === "forgot") {
      await store.forgot(email);
      setLoginMode("login"); $("#lEmail").value = email; $("#lErr").style.color = "var(--mint-d)"; $("#lErr").textContent = "Fatto! Controlla la posta 📬";
    } else if (loginMode === "newpass") {
      await store.newPassword(pass);
      history.replaceState(null, "", location.pathname);
      toast("Password aggiornata 🔐"); startOnline();
    }
  } catch (x) { err.style.color = ""; err.textContent = x.message || "Qualcosa è andato storto"; }
  finally { btn.disabled = false; btn.style.opacity = ""; }
});

// aggiorna saluto e "rimaste indietro" ogni minuto
setInterval(() => { if (!$("#sheet").classList.contains("on") && !$("#app").classList.contains("hidden")) render(); }, 60000);

boot();
