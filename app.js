/* =========================================================
   MOCHI - app personale per cose da fare, appuntamenti e appunti
   ========================================================= */
const CFG = window.MOCHI_CONFIG || {};
const SIGNUP_OPEN = CFG.REGISTRAZIONI_APERTE !== false;
// L'app è collegata a Supabase (config.js)...
const CONFIG_ONLINE = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);
/* ...ma si può usare anche come OSPITE, senza account: tutto resta sul dispositivo, come la modalità prova.
   "mochi.ospite" nel dispositivo: "si" = si usa come ospite; "passaggio" = l'ospite sta creando un account o entrando
   (le sue cose restano sul dispositivo finché non le porta nell'account). Si decide all'avvio: cambiare modo ricarica la pagina.
   ONLINE_MODE (= "in linea") vale quindi: collegata a Supabase E non ospite. */
const PRIVACY_VERSIONE = "2026-11"; // versione dell'informativa accettata alla registrazione
const OSPITE = CONFIG_ONLINE && (() => { try { return JSON.parse(localStorage.getItem("mochi.ospite")) === "si"; } catch { return false; } })();
const ONLINE_MODE = CONFIG_ONLINE && !OSPITE;
// Le notifiche push si attivano solo quando è configurata la chiave pubblica VAPID
const PUSH_READY = ONLINE_MODE && !!CFG.VAPID_PUBLIC_KEY;
let NOME = ONLINE_MODE || OSPITE ? "" : (CFG.NOME || ""); // l'ospite non ha un nome (quello di config.js vale solo per la modalità prova)
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
    if (md.nome_app || md.mascotte || md.accessorio || md.colore || md.font || md.stile || md.moduli || md.stagione || md.suono || md.casa || md.spesa_reparti != null || md.compleanno != null || md.ricordi != null || md.fiori != null || md.pronomi != null || md.pet != null) {
      // le preferenze nuove (moduli, stagione, suono) che l'account non ha ancora restano quelle di questo dispositivo
      CUSTOM = cleanCustom({ nome_app: md.nome_app, mascotte: md.mascotte, accessorio: md.accessorio, colore: md.colore, font: md.font, stile: md.stile,
        moduli: md.moduli ?? CUSTOM.moduli, stagione: md.stagione ?? CUSTOM.stagione, suono: md.suono ?? CUSTOM.suono,
        // casetta: scelta e mobili spenti dall'account, sblocchi uniti (non si perdono mai)
        casa: md.casa ? unisciCasa(md.casa, CUSTOM.casa) : CUSTOM.casa, spesa_reparti: md.spesa_reparti ?? CUSTOM.spesa_reparti,
        // compleanno dall'account (se c'è); ricordi delle feste uniti come la casetta: non si perdono mai
        compleanno: md.compleanno ?? CUSTOM.compleanno, ricordi: unisciRicordi(md.ricordi, CUSTOM.ricordi),
        // fiori del giardino: quelli scelti sull'account, altrimenti restano quelli di questo dispositivo
        fiori: md.fiori ?? CUSTOM.fiori,
        // pronomi: quelli dell'account (anche vuoti: "tolti"), altrimenti restano quelli di questo dispositivo
        pronomi: md.pronomi ?? CUSTOM.pronomi,
        // pet: quello dell'account (anche vuoto: "rimosso"), altrimenti resta quello di questo dispositivo
        pet: md.pet ?? CUSTOM.pet });
      LS.set("mochi.custom", CUSTOM); applyCustom();
    }
  },
  async saveCustom(c) { const { data, error } = await this.sb.auth.updateUser({ data: { nome_app: c.nome_app, mascotte: c.mascotte, accessorio: c.accessorio, colore: c.colore, font: c.font, stile: c.stile, moduli: c.moduli, stagione: c.stagione, suono: c.suono, casa: c.casa, spesa_reparti: c.spesa_reparti, compleanno: c.compleanno, ricordi: c.ricordi, fiori: c.fiori, pronomi: c.pronomi, pet: c.pet } }); if (error) throw error; this.user = data.user; },
  get redirect() { return location.origin + location.pathname; },
  async login(email, password) {
    const { data, error } = await this.sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    this.user = data.user; this.applyName();
  },
  async signup(nome, email, password) {
    // il consenso all'informativa: versione e data, nei metadati dell'account (non tocca le preferenze)
    const { data, error } = await this.sb.auth.signUp({ email, password, options: { data: { nome, privacy_ok: PRIVACY_VERSIONE, privacy_ok_il: new Date().toISOString() }, emailRedirectTo: this.redirect } });
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
/* =========================================================
   LE FESTE (dati e calendario)
   Nei giorni di festa la mascotte indossa un cappellino, la casetta si decora e in giro c'è qualche sorpresa.
   Le feste decorano soltanto: non cambiano i dati e si spengono da Impostazioni → Cosa vuoi usare.
   ========================================================= */
// base = quale decorazione usa (il Capodanno usa quella del Natale); acc = ricordo che si indossa
const FESTE = {
  natale: { nome: "Natale", e: "🎄", acc: "r-natale", pioggia: ["❄️", "🎄", "⭐", "🎁"], effetto: "neve", frasi: ["Buon Natale! Che sia un giorno soffice come un mochi 🎄", "Tante belle feste da {m}! Una cioccolata calda e una cosa fatta: perfetto ☕"] },
  capodanno: { nome: "Capodanno", e: "🥂", acc: "r-natale", base: "natale", pioggia: ["🎆", "✨", "🥂", "🎉"], effetto: "neve", frasi: ["Buon anno! Che sia pieno di cose belle e di tanti bocconcini 🥂"] },
  sanvalentino: { nome: "San Valentino", e: "💗", acc: "r-cuore", pioggia: ["💗", "💕", "💖", "🌹"], effetto: "cuori", frasi: ["Oggi ti mando un cuoricino: sei una persona speciale 💗", "{m} ti vuole bene, e oggi lo dice con un fiocco rosso 🎀"] },
  pasqua: { nome: "Pasqua", e: "🐣", acc: "r-orecchie", pioggia: ["🥚", "🐣", "🌷", "🐰"], effetto: "petali", frasi: ["Buona Pasqua! Dicono che in giro per l'app si nascondano degli ovetti 🥚", "{m} ha messo le orecchie da coniglietto: buona Pasqua! 🐰"] },
  halloween: { nome: "Halloween", e: "🎃", acc: "r-strega", pioggia: ["🎃", "🦇", "👻", "🍬"], effetto: null, frasi: ["Dolcetto o scherzetto? Oggi {m} fa la streghetta 🎃", "Buon Halloween! Un pipistrellino sbircia in giro 🦇"] },
  agosto: { nome: "Estate", e: "☀️", acc: "r-paglia", pioggia: ["☀️", "🍦", "🌊", "🍉"], effetto: "sole", frasi: ["Che bella estate! Un gelato e una cosa fatta, e la giornata è perfetta 🍦", "{m} ha il cappello di paglia: buone vacanze! 🏖️"] },
  compleanno: { nome: "Compleanno", e: "🎂", acc: "r-festa", pioggia: ["🎈", "🎉", "🎂", "🎁"], effetto: null, frasi: ["Tanti auguri! Oggi è il tuo giorno e {m} fa festa con te 🎂"] }
};
// Ricordi: accessori delle feste, si sbloccano con le sorprese e restano per sempre tra gli accessori
const RICORDI = [
  { id: "r-natale", nome: "Cappellino di Natale", festa: "natale" }, { id: "r-cuore", nome: "Fiocco rosso", festa: "sanvalentino" },
  { id: "r-orecchie", nome: "Orecchie da coniglietto", festa: "pasqua" }, { id: "r-strega", nome: "Cappello da streghetta", festa: "halloween" },
  { id: "r-paglia", nome: "Cappello di paglia", festa: "agosto" }, { id: "r-festa", nome: "Cappellino da festa", festa: "compleanno" },
  { id: "r-ovetti", nome: "Corona di ovetti", festa: "pasqua" }
];
const festaBase = (f) => FESTE[f]?.base || f;
const bisestile = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
// Pasqua (calendario gregoriano, algoritmo di Gauss/Meeus): giorno e mese per un anno
function pasquaDi(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mese = Math.floor((h + l - 7 * m + 114) / 31), giorno = ((h + l - 7 * m + 114) % 31) + 1;
  return { mese, giorno };
}
// Il compleanno è solo "MM-GG" (senza anno): qualsiasi altra cosa vale "niente"
function cleanCompleanno(v) {
  if (typeof v !== "string") return "";
  const x = /^(\d{2})-(\d{2})$/.exec(v); if (!x) return "";
  const m = +x[1], g = +x[2];
  return m >= 1 && m <= 12 && g >= 1 && g <= new Date(2024, m, 0).getDate() ? v : "";
}
// Funzione pura: che festa è in quella data? (null = nessuna). Il compleanno, se c'è, vince su tutte.
function festaDi(data, compleanno = "") {
  const d = data instanceof Date ? data : new Date(data);
  if (isNaN(d)) return null;
  const y = d.getFullYear(), m = d.getMonth() + 1, g = d.getDate();
  let c = cleanCompleanno(compleanno);
  if (c === "02-29" && !bisestile(y)) c = "02-28";
  if (c && c === `${pad(m)}-${pad(g)}`) return "compleanno";
  if ((m === 12 && g === 31) || (m === 1 && g === 1)) return "capodanno";
  if (m === 12 || (m === 1 && g <= 6)) return "natale";
  if (m === 2 && g >= 10 && g <= 15) return "sanvalentino";
  if ((m === 10 && g >= 25) || (m === 11 && g === 1)) return "halloween";
  if (m === 8 && g <= 20) return "agosto";
  const p = pasquaDi(y), da = Math.round((Date.UTC(y, m - 1, g) - Date.UTC(y, p.mese - 1, p.giorno)) / 864e5);
  return da >= -3 && da <= 1 ? "pasqua" : null; // da 3 giorni prima fino a Pasquetta
}
// Temi di colore: [id, nome, colore chiaro, colore scuro] (i colori veri sono nel CSS di index.html)
const PALETTE = [
  ["fragola", "Fragola", "#ff8fb1", "#e85d8a", "🍓"], ["matcha", "Matcha", "#7cc79a", "#3f9a6b", "🍵"],
  ["lavanda", "Lavanda", "#b69cff", "#7a5fd6", "🪻"], ["pesca", "Pesca", "#ffab7a", "#e0703f", "🍑"], ["cielo", "Cielo", "#7cc0f0", "#3a86c8", "☁️"],
  ["notte", "Notte", "#8fa4ee", "#34498f", "🌙"], ["bosco", "Bosco", "#6fb08a", "#1f5c3f", "🌲"], ["grafite", "Grafite", "#f0b84e", "#8a5a0c", "🔩"]
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
  ["cartone", "Cartone", "Linee scure e colori pieni, come un cartone animato"],
  ["quaderno", "Quaderno", "Carta puntinata, titoli a mano, etichette di carta"],
  ["sobrio", "Sobrio", "Colori sobri, forme decise, niente fronzoli"]
];
// Piccole decorazioni nei testi (cuoricini e lustrini): nello stile Sobrio non ci sono
const DECO = (e) => (typeof CUSTOM === "object" && CUSTOM && CUSTOM.stile === "sobrio" ? "" : " " + e);
/* Cosa vuoi usare: ogni parte dell'app si può spegnere (Impostazioni). Spegnere nasconde, non cancella i dati.
   [id, emoji, nome, descrizione, acceso all'inizio, solo con account] */
const MODULI = [
  ["turni", "💼", "Turni di lavoro", "Calendario dei turni e ore del mese", true],
  ["spese", "👛", "Spese", "Quanto spendi ogni mese, con il budget", true],
  ["serie", "🔥", "Serie di giorni", "Quanti giorni di fila spunti qualcosa", true],
  ["focus", "🪴", "Concentrazione", "Un timer con una piantina che cresce", true],
  ["riepilogo", "🌙", "Riepilogo della domenica", "I numeri della settimana, la domenica sera", true],
  ["casa", "🏡", "La casetta", "La casa della mascotte, con i mobili in regalo", true],
  ["umore", "🌷", "Com'è andata la giornata", "Faccine nel calendario e giardino del mese", true],
  ["ricorrenti", "🔁", "Promemoria ricorrenti", "Bevi acqua, fai una pausa...", true, true],
  ["liste", "👭", "Liste condivise", "Liste da usare insieme ad altre persone", true, true],
  ["biscotto", "🥠", "Biscotto della fortuna", "Una frase da aprire ogni mattina", true],
  ["pancino", "🍣", "Il pancino", "La mascotte mangia le cose che fai e riceve regali", true],
  ["stagioni", "❄️", "Stagioni", "Neve, pioggia, sole o foglie sullo sfondo", false],
  ["feste", "🎉", "Feste", "Cappellini, decorazioni e sorprese a Natale, Pasqua, Halloween e nei compleanni", true],
  ["pet", "🐾", "Il mio pet", "La scheda del tuo animale, la routine di ogni giorno e i pesi", false]
];
/* La casetta: dati (i disegni e la pagina sono più sotto, sezione "LA CASETTA") */
// [id, nome, emoji, giorni attivi per sbloccarla (0 = subito), mascotte di casa, colori per la stanza semplice [muro, pavimento]]
const CASETTE = [
  ["laghetto", "Laghetto", "🪷", 0, ["kame", "sakura", "nori", "marimo", "bolla", "yuzu"], ["#d9f1ef", "#ecd3ab"]],
  ["stalla", "Prato con la stalla", "🌾", 0, ["zucchero", "daifuku", "tamago", "saltello"], ["#f7c7b6", "#f5df97"]],
  ["bosco", "Casetta nel bosco", "🌲", 0, ["miso", "bambu", "castagna", "mochi", "nigi"], ["#e3b88a", "#cfa275"]],
  ["spiaggia", "Spiaggia", "🏖️", 10, [], ["#e2f3fb", "#f6e3b8"]],
  ["serra", "Serra dei fiori", "🌼", 30, [], ["#e6f5e2", "#f0bd9c"]],
  ["nuvole", "Casetta sulle nuvole", "☁️", 60, [], ["#ebe4fd", "#f6f2ff"]],
  ["pasticceria", "Pasticceria", "🧁", 90, [], ["#ffe9ec", "#ffd9de"]],
  ["cameretta", "Cameretta in città", "🌆", 120, [], ["#dfe0f8", "#ebd2b0"]],
  ["baita", "Baita in montagna", "🏔️", 150, [], ["#d49a68", "#c7986a"]]
];
// [id, nome, bocconcini per averlo in regalo]  (ognuno ha il suo posto fisso nella stanza)
const MOBILI = [
  ["tappeto", "Tappeto", 1], ["cuscino", "Cuscino", 5], ["piantina", "Piantina", 10], ["quadretto", "Quadretto", 16],
  ["lampada", "Lampada", 23], ["libreria", "Libreria", 31], ["orologio", "Orologio", 40], ["fiori", "Vasetto di fiori", 50],
  ["tavolino", "Tavolino con la tazza", 62], ["mensola", "Mensola con i barattoli", 75], ["cesto", "Cesto della lana", 90], ["lucine", "Lucine", 110]
];
// Colori dei mobili: 3 varianti per mobile. Ogni riga = i colori principali del disegno (la prima e' l'aspetto di sempre, il primo colore e' il pallino).
// Le varianti 1 e 2 sostituiscono, nello stesso ordine, i colori della variante 0 (nessun disegno duplicato).
const COLORI_MOBILI = {
  tappeto: [["#ffd1dc", "#f2a9bc", "#ffe6ec"], ["#bfe8d3", "#8fcfa8", "#e4f6ec"], ["#ffe9a8", "#e8c35a", "#fff4cf"]],
  cuscino: [["#cdbcf7", "#a993e6", "#e6dbff"], ["#ffc2d4", "#e57a98", "#ffe0e8"], ["#b9ecd0", "#7fc9a0", "#dcf6e8"]],
  piantina: [["#ee9b72", "#d37a52", "#f6b088"], ["#9fd4ef", "#6fb0d6", "#bfe3f6"], ["#c9b2ff", "#a38be0", "#dccdff"]],
  quadretto: [["#f7d9a8", "#d9b27a"], ["#ffd1dc", "#f2a9bc"], ["#c8efd6", "#8fcfa8"]],
  lampada: [["#ffe08a", "#e8bf5a", "#ffd1dc", "#f2a9bc"], ["#ffc2d4", "#f08fae", "#fff0b8", "#e8c35a"], ["#b9ecd0", "#7fc9a0", "#ffffff", "#cfe9db"]],
  libreria: [["#e8c39a", "#c99b6c", "#f3dcbf"], ["#ffc9d6", "#e5849f", "#ffe6ec"], ["#bfe0f5", "#7fb4d6", "#e3f2fc"]],
  orologio: [["#ffd1dc", "#f2a9bc"], ["#c8efd6", "#8fcfa8"], ["#ffe9a8", "#e8c35a"]],
  fiori: [["#b9e3f5", "#8cc4dc"], ["#ffd1dc", "#f2a9bc"], ["#ffe9a8", "#e8c35a"]],
  tavolino: [["#f7d9a8", "#e0bb8b", "#c4955a"], ["#d4f2e1", "#b5e3cb", "#7fc09e"], ["#e6dbff", "#d0c0f5", "#a993e6"]],
  mensola: [["#e0bb8b", "#c4955a"], ["#bfe8d3", "#8fcfa8"], ["#d9ccff", "#a993e6"]],
  cesto: [["#e8c08a", "#c4955a", "#cf9f62"], ["#b9e3cc", "#7fbf9e", "#9fd1b5"], ["#d9ccff", "#a993e6", "#c0b0f0"]],
  lucine: [["#ffd76a", "#ff9db5", "#9fd4ef", "#b7e39a"], ["#ff9db5", "#c9b2ff", "#ffd76a", "#9fd4ef"], ["#9fd4ef", "#b7e39a", "#ffb48f", "#c9b2ff"]]
};
const casaDi = (id) => CASETTE.find((c) => c[0] === id) || null;
const casaHabitat = (masc) => (CASETTE.find((c) => c[4].includes(masc)) || CASETTE[2])[0];
const CASA_VUOTA = { scelta: "auto", spenti: [], casette: [], mobili: [], colori: {} };
// Preferenze della casetta: solo id conosciuti, niente doppioni (arrivano anche dall'account: mai fidarsi)
function cleanCasa(c) {
  c = c && typeof c === "object" && !Array.isArray(c) ? c : {};
  const ids = (a, ok) => [...new Set((Array.isArray(a) ? a : []).filter((x) => typeof x === "string" && ok(x)))];
  const col = c.colori && typeof c.colori === "object" && !Array.isArray(c.colori) ? c.colori : {};
  return {
    scelta: typeof c.scelta === "string" && (c.scelta === "auto" || casaDi(c.scelta)) ? c.scelta : "auto",
    spenti: ids(c.spenti, (x) => MOBILI.some((m) => m[0] === x)),
    casette: ids(c.casette, (x) => !!casaDi(x) && casaDi(x)[3] > 0),
    mobili: ids(c.mobili, (x) => MOBILI.some((m) => m[0] === x)),
    // colori: solo id di mobili esistenti con indice 0-2 (si scorre l'elenco dei mobili, non le chiavi ricevute)
    colori: Object.fromEntries(MOBILI.filter((m) => Object.prototype.hasOwnProperty.call(col, m[0]) && Number.isInteger(col[m[0]]) && col[m[0]] >= 0 && col[m[0]] <= 2).map((m) => [m[0], col[m[0]]]))
  };
}
// Unione: gli sblocchi non si perdono mai (dispositivo + account)
const unisciCasa = (a, b) => { const x = cleanCasa(a), y = cleanCasa(b); return { ...x, casette: [...new Set([...x.casette, ...y.casette])], mobili: [...new Set([...x.mobili, ...y.mobili])], colori: { ...y.colori, ...x.colori } }; };
// Effetto delle stagioni: "auto" segue il calendario, gli altri sono fissi
const STAGIONI = [["auto", "🗓️", "Segue la stagione"], ["neve", "❄️", "Neve"], ["pioggia", "🌧️", "Pioggia"], ["sole", "☀️", "Sole"], ["foglie", "🍂", "Foglie"], ["petali", "🌸", "Petali"]];
// Suoni dentro l'app (creati dal codice, nessun file): notifiche con l'app aperta, cose fatte, biscotto
const SUONI = [["campanella", "🔔", "Campana"], ["bolla", "🫧", "Bolla"], ["xilofono", "🎵", "Xilofono"], ["gocce", "💧", "Gocce"], ["spenti", "🔕", "Spenti"]];
// Il pet: UN solo animale per persona. La scheda sta in CUSTOM.pet (testi brevi e numeri, sempre ripuliti); spunte e pesi stanno nella tabella pet_registro
const PET_SPECIE = [["cane", "Cane", "🐶"], ["gatto", "Gatto", "🐱"], ["coniglio", "Coniglio", "🐰"], ["criceto", "Criceto", "🐹"], ["uccellino", "Uccellino", "🐦"], ["pesce", "Pesce", "🐟"], ["rettile", "Rettile", "🦎"], ["altro", "Altro", "🐾"]];
const PET_PASTI = [["pasto-m", "Pasto del mattino"], ["pasto-s", "Pasto della sera"]], PET_ACQUA = ["acqua", "Acqua fresca"];
const PET_ROUTINE_DEF = {
  cane: [...PET_PASTI, ["passeggiata", "Passeggiata"], PET_ACQUA], gatto: [...PET_PASTI, ["lettiera", "Lettiera pulita"], PET_ACQUA],
  coniglio: [["fieno", "Fieno fresco"], ["verdure", "Verdure fresche"], PET_ACQUA, ["gioco", "Un po' di gioco"]],
  criceto: [["cibo", "Cibo"], PET_ACQUA, ["ruota", "Gioco e ruota"], ["pulizia", "Angolino pulito"]],
  uccellino: [["semi", "Semi e frutta"], PET_ACQUA, ["volo", "Fuori dalla gabbia"], ["fondo", "Fondo pulito"]],
  pesce: [["pasto", "Pasto"], ["controllo", "Controllo dell'acqua"]],
  rettile: [["pasto", "Pasto"], PET_ACQUA, ["temperatura", "Controllo temperatura"]],
  altro: [...PET_PASTI, PET_ACQUA]
};
const PET_RE_ID = /^[a-z][a-z0-9-]{0,23}$/; // sempre con una lettera iniziale (il database accetterebbe anche il trattino, il client no)
const PET_VUOTO = { nome: "", specie: "", dt: "", g: 0, m: 0, a: 0, vet: "", tel: "", note: "", routine: null };
const petTesto = (v, n, nota) => taglia((typeof v === "string" ? v : "").replace(nota ? /[\u0000-\u0009\u000b-\u001f\u007f]/g : /[\u0000-\u001f\u007f<>]/g, ""), n).trim();
// Telefono: solo cifre, "+" iniziale e spazi (da 3 a 15 cifre); qualsiasi altra cosa = niente
function cleanPetTel(v) {
  const t = (typeof v === "string" ? v : "").trim();
  if (!t || t.length > 20 || /[^0-9+ ]/.test(t) || t.lastIndexOf("+") > 0) return "";
  const n = (t.match(/\d/g) || []).length;
  return n >= 3 && n <= 15 ? t.replace(/ +/g, " ") : "";
}
// Compleanno o arrivo: giorno, mese e anno sono facoltativi; il giorno vuole il mese; date impossibili o nel futuro = scartate
function cleanPetData(p) {
  const int = (x, lo, hi) => (Number.isInteger(x) && x >= lo && x <= hi ? x : 0);
  const adesso = new Date();
  let m = int(p.m, 1, 12), g = int(p.g, 1, 31), a = int(p.a, 1980, adesso.getFullYear());
  if (!m) g = 0;
  if (m && g && g > new Date(2024, m, 0).getDate()) { m = 0; g = 0; }
  if (a && m && g && (!realDate(a, m - 1, g) || new Date(a, m - 1, g) > adesso)) { m = 0; g = 0; }
  if (a && m && !g && new Date(a, m - 1, 1) > adesso) { m = 0; a = 0; }
  const dt = (p.dt === "n" || p.dt === "a") && (g || m || a) ? p.dt : "";
  return dt ? { dt, g, m, a } : { dt: "", g: 0, m: 0, a: 0 };
}
// Routine: al massimo 8 voci con id (lettera iniziale) e titolo; null = quella predefinita della specie
function cleanPetRoutine(r) {
  if (!Array.isArray(r)) return null;
  const out = [], visti = new Set();
  for (const x of r.slice(0, 40)) {
    if (out.length >= 8) break;
    if (!x || typeof x !== "object" || Array.isArray(x)) continue;
    const id = str(x.id), t = petTesto(x.t, 24);
    if (!PET_RE_ID.test(id) || !t || visti.has(id)) continue;
    visti.add(id); out.push({ id, t });
  }
  return out.length || !r.length ? out : null;
}
function cleanPet(p) {
  p = p && typeof p === "object" && !Array.isArray(p) ? p : {};
  const out = { nome: petTesto(p.nome, 20), specie: typeof p.specie === "string" && PET_SPECIE.some((s) => s[0] === p.specie) ? p.specie : "", ...cleanPetData(p),
    vet: petTesto(p.vet, 40), tel: cleanPetTel(p.tel), note: petTesto(p.note, 300, true), routine: cleanPetRoutine(p.routine) };
  // nei metadati dell'account il pet deve restare sotto i 2 KB: se serve si accorcia la nota
  const peso = () => new TextEncoder().encode(JSON.stringify(out)).length;
  while (out.note && peso() > 2000) out.note = [...out.note].slice(0, -20).join("").trim();
  if (peso() > 2000) out.routine = null;
  return out;
}
const petPresente = (p) => !!(p && (p.nome || p.specie));
const DEFAULT_CUSTOM = { nome_app: "Mochi", mascotte: "mochi", accessorio: "auto", colore: "fragola", font: "morbido", stile: "morbido",
  moduli: Object.fromEntries(MODULI.map((m) => [m[0], m[4]])), stagione: "auto", suono: "campanella", casa: CASA_VUOTA, spesa_reparti: true, compleanno: "", ricordi: [], fiori: { modo: "uno", fiore: "classico" }, pronomi: "", pet: PET_VUOTO };
// I pronomi: servono solo ad adattare i testi (Benvenuta / Benvenuto / Rieccoti). Solo "lei", "lui", "loro" o vuoto (= non specificato); tutto il resto scartato
const PRONOMI = [["", "Non specificato"], ["lei", "Lei"], ["lui", "Lui"], ["loro", "Loro"]];
const cleanPronomi = (p) => (typeof p === "string" && ["lei", "lui", "loro"].includes(p) ? p : "");
// I fiori del giardino: solo modo e fiore conosciuti, tutto il resto scartato (arriva anche dall'account: mai fidarsi)
const FIORI_UNO = ["classico", "margherita", "tulipano", "girasole", "rosa", "campanula"];
const FIORI_UMORE = { 1: "campanula", 2: "tulipano", 3: "margherita", 4: "girasole", 5: "rosa" }; // il set fisso, uno per livello
function cleanFiori(f) {
  f = f && typeof f === "object" && !Array.isArray(f) ? f : {};
  return { modo: f.modo === "umore" ? "umore" : "uno", fiore: typeof f.fiore === "string" && FIORI_UNO.includes(f.fiore) ? f.fiore : "classico" };
}
// Ricordi delle feste: solo id conosciuti, niente doppioni (arrivano anche dall'account: mai fidarsi)
const cleanRicordi = (a) => [...new Set((Array.isArray(a) ? a : []).filter((x) => typeof x === "string" && RICORDI.some((r) => r.id === x)))];
const unisciRicordi = (a, b) => [...new Set([...cleanRicordi(a), ...cleanRicordi(b)])];
function cleanCustom(c) {
  c = c && typeof c === "object" ? c : {};
  const nome = typeof c.nome_app === "string" ? c.nome_app.replace(/[<>]/g, "").trim().slice(0, 24) : "";
  const acc = typeof c.accessorio === "string" && (c.accessorio === "auto" || c.accessorio === "none" || TRAGUARDI.some((t) => t.id === c.accessorio) || RICORDI.some((r) => r.id === c.accessorio)) ? c.accessorio : "auto";
  const colore = typeof c.colore === "string" && PALETTE.some((x) => x[0] === c.colore) ? c.colore : "fragola";
  const font = typeof c.font === "string" && FONTI.some((x) => x[0] === c.font) ? c.font : "morbido";
  const stile = typeof c.stile === "string" && STILI.some((x) => x[0] === c.stile) ? c.stile : "morbido";
  // solo i moduli conosciuti, solo vero/falso; quelli mancanti prendono il valore iniziale
  const m = c.moduli && typeof c.moduli === "object" && !Array.isArray(c.moduli) ? c.moduli : {};
  const moduli = Object.fromEntries(MODULI.map(([k, , , , def]) => [k, typeof m[k] === "boolean" ? m[k] : def]));
  const stagione = typeof c.stagione === "string" && STAGIONI.some((x) => x[0] === c.stagione) ? c.stagione : "auto";
  const suono = typeof c.suono === "string" && SUONI.some((x) => x[0] === c.suono) ? c.suono : "campanella";
  return { colore, font, stile, moduli, stagione, suono, casa: cleanCasa(c.casa), spesa_reparti: c.spesa_reparti !== false, compleanno: cleanCompleanno(c.compleanno), ricordi: cleanRicordi(c.ricordi), fiori: cleanFiori(c.fiori), pronomi: cleanPronomi(c.pronomi), pet: cleanPet(c.pet), nome_app: nome || DEFAULT_CUSTOM.nome_app, mascotte: typeof c.mascotte === "string" && Object.prototype.hasOwnProperty.call(MASC.list, c.mascotte) ? c.mascotte : DEFAULT_CUSTOM.mascotte, accessorio: acc };
}
let CUSTOM = cleanCustom(LS.get("mochi.custom", DEFAULT_CUSTOM));
// Testi che si adattano: gen(neutro, lei, lui). Chi non sceglie (o sceglie "loro") legge sempre la forma neutra.
const gen = (neutro, lei, lui) => (CUSTOM.pronomi === "lei" ? lei : CUSTOM.pronomi === "lui" ? lui : neutro);
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
  festaTesta();
  for (const id of ["topMascot", "loginMascot"]) {
    const el = document.getElementById(id);
    const key = CUSTOM.mascotte + "|" + (accWorn()?.id || "") + "|" + (festaCappello() || "");
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
  if (CUSTOM.stile === "sobrio") return; // niente cuoricini che salgono
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
  if (CUSTOM.accessorio !== "auto") {
    if (RICORDI.some((r) => r.id === CUSTOM.accessorio)) { if (CUSTOM.ricordi.includes(CUSTOM.accessorio)) return { id: CUSTOM.accessorio, ricordo: true }; }
    else { const t = got.find((x) => x.id === CUSTOM.accessorio); if (t) return t; }
  }
  return got[got.length - 1] || null;
}
// L'accessorio sta DENTRO il corpo della mascotte: respira e saltella insieme a lei.
// Posizione scelta per ogni personaggio, appoggiata sulla testa (coordinate del disegno).
const ACC_POS = { mochi: [322, 182, 62], nigi: [150, 200, 62], bolla: [250, 196, 58] };
function withAcc(svgStr, id) {
  const a = accWorn(), fc = festaCappello(id);
  // il cappellino della festa vince su quello dei ricordi; l'accessorio scelto resta, spostato di lato se serve
  let cap = fc || (a?.ricordo ? a.id : null);
  if (cap === "r-orecchie" && ORECCHIE_SUE.includes(id)) cap = "r-ovetti"; // ha già le orecchie lunghe: un solo paio (anche col ricordo indossato)
  let t = "";
  if (a && !a.ricordo) {
    let [x, y, fs] = ACC_POS[id] || ACC_POS.mochi;
    if (fc) { const hx = (CAPPELLI_POS[id] || CAPPELLI_POS.mochi)[0]; if (Math.abs(x - hx) < 75) { x = hx + 88; y += 6; fs = Math.min(fs, 50); } }
    t = `<text class="acc" x="${x}" y="${y}" font-size="${fs}" text-anchor="middle">${a.e}</text>`;
  }
  const c = cap ? cappelloSvg(cap, id) : "";
  if (!t && !c) return svgStr;
  // il disegno termina chiudendo il gruppo del corpo: inserisco l'accessorio appena prima
  return svgStr.replace(/<\/g>\s*<\/svg>$/, `${t}${c}</g></svg>`);
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
    ${days.some((d) => d[1]) ? `<div class="week7">${days.map(([d, n]) => `<div>${n ? `<i style="height:${Math.round((n / max) * 100)}%"></i>` : ""}<b>${n || ""}</b><span>${GIORNI[d.getDay()].slice(0, 3)}</span></div>`).join("")}</div>`
      : `<p class="empty pc-vuoto">Questa settimana il pancino è ancora vuoto.<br>Spunta una cosa fatta e ${esc(MN())} riceve il primo bocconcino.</p>`}
    <div class="sec"><h2>Regali</h2><span class="count">${TRAGUARDI.filter((t) => tot >= t.n).length}/${TRAGUARDI.length}</span></div>
    <div class="regali">${TRAGUARDI.map((t) => tot >= t.n
      ? `<button class="${worn === t.id ? "on" : ""}" data-act="wear" data-v="${t.id}"><span class="e">${t.e}</span><b>${t.nome}</b><small>${worn === t.id ? "Lo indossa" : "Tocca per metterlo"}</small></button>`
      : `<button class="lock" disabled><span class="e">${t.e}</span><b>${t.nome}</b><small>a ${t.n} bocconcini</small></button>`).join("")}
      <button class="${worn === "none" ? "on" : ""}" data-act="wear" data-v="none"><span class="e">🫧</span><b>Niente</b><small>Al naturale</small></button></div>
    ${mod("feste") || CUSTOM.ricordi.length ? `<div class="sec"><h2>Ricordi delle feste</h2><span class="count">${CUSTOM.ricordi.length}/${RICORDI.length}</span></div>
    <div class="regali">${RICORDI.map((r) => CUSTOM.ricordi.includes(r.id)
      ? `<button class="${worn === r.id ? "on" : ""}" data-act="wear" data-v="${r.id}"><span class="e"><svg class="ric-ico" viewBox="-70 -112 140 124" aria-hidden="true">${CAPPELLI[r.id]}</svg></span><b>${r.nome}</b><small>${worn === r.id ? "Lo indossa" : "Tocca per metterlo"}</small></button>`
      : `<button class="lock" disabled><span class="e">🎁</span><b>???</b><small>Si trova in una festa</small></button>`).join("")}</div>` : ""}
    <p class="hint" style="margin:10px 4px 14px">Ogni cosa che spunti è un bocconcino. ${esc(MN())} non ha mai fame e non si offende: festeggia solo quello che fai.</p>
    ${mod("casa") ? `<button class="more" data-act="open-casa">🏡 Vai alla casetta di ${esc(MN())}</button>` : ""}
    <div class="actions"><button class="btn primary" data-act="close">Ciao ${esc(MN())}${DECO("💗")}</button></div>`);
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
      <div class="say">${t.n} bocconcini: si è guadagnato il ${t.nome.toLowerCase()}. Grazie a te${DECO("💗")}</div></div>
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
  spese: { voci: [], budget: null }, speseMese: null, stAperti: new Set(), giorni: new Set(), pet: { righe: [] }
};

function setSync(ok) { state.synced = ok; const el = $("#syncDot"); if (el) el.className = "sync" + (ok ? "" : " off"); }

function greeting() {
  const h = new Date().getHours();
  const s = h < 6 ? "Buonanotte" : h < 13 ? "Buongiorno" : h < 18 ? "Buon pomeriggio" : "Buonasera";
  return `${s}${NOME ? ", " + NOME : ""}!`;
}
/* -------- frase del giorno (frasi.js) -------- */
const FRASI = Array.isArray(window.MOCHI_FRASI) && window.MOCHI_FRASI.length ? window.MOCHI_FRASI.map((f) => (Array.isArray(f) ? f.slice(0, 3).map(String) : String(f))) : ["Una cosa alla volta è comunque un passo avanti."];
let mottoShift = 0;
function fraseDelGiorno() {
  const d = new Date();
  const day = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5);
  const f = FRASI[(day + d.getFullYear() * 7 + mottoShift) % FRASI.length];
  return Array.isArray(f) ? gen(f[0], f[1] ?? f[0], f[2] ?? f[0]) : f; // una frase puo' essere [neutro, lei, lui]
}

function headerUpdate() {
  $("#hello").textContent = greeting();
  const m = $("#motto"); if (m) m.innerHTML = `<span class="emo">💭 </span>${esc(fraseDelGiorno())}`;
  const d = new Date();
  $("#today").innerHTML = `${GIORNI[d.getDay()].replace(/^./, (c) => c.toUpperCase())} ${d.getDate()} ${MESI[d.getMonth()]} ${OSPITE ? "· ospite" : ONLINE_MODE ? `· <span id="syncDot" class="sync${state.synced ? "" : " off"}"><i></i>${state.synced ? "sincronizzato" : "offline"}</span>` : "· modalità prova"}`;
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
  const pmk = petMarca(it);
  if (pmk && mod("pet")) chips.push(`<span class="chip"><span class="emo">🐾 </span>Pet</span>`);
  if (pmk ? pmk.resto : it.body) chips.push(`<span class="chip">📝</span>`);
  // lista da spuntare: "3/7" si apre e si spunta senza aprire l'editor
  const st = it.sottotask || [], aperto = st.length && state.stAperti.has(it.id);
  if (st.length) chips.push(`<button class="chip st-chip ${aperto ? "on" : ""} ${st.every((x) => x.f) ? "tutte" : ""}" data-act="st-apri" data-id="${esc(it.id)}" aria-expanded="${aperto ? "true" : "false"}" aria-label="Lista da spuntare: ${st.filter((x) => x.f).length} su ${st.length}">☑ ${st.filter((x) => x.f).length}/${st.length}<span class="st-fr">${aperto ? "▴" : "▾"}</span></button>`);
  return `<div class="item ${area} ${it.done ? "done" : ""}" data-act="edit" data-id="${esc(it.id)}">
    ${left}
    <div class="body"><div class="t">${esc(it.title)}</div><div class="meta">${chips.join("")}</div>${aperto ? `<div class="st-lista">${voceListaHtml(it)}</div>` : ""}</div>
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

  let h = `<div class="bubble detto">${nigiSays()}</div>${invitoOspite()}`;
  h += `<div class="stats">
    <div class="stat"><b>${ev.length}</b><span>appuntamenti</span></div>
    <div class="stat"><b>${todo.length + late.length}</b><span>da fare</span></div>
    <div class="stat"><b>${doneT.length}</b><span>fatte oggi</span></div></div>`;
  h += riepilogoCard();
  if (mod("serie")) h += serieCard();
  { const tu = turnoDi(t); if (tu && tu.k !== "") h += rigaTurno(t, true); }
  if (mod("umore")) h += umoreCard();
  if (mod("pancino")) h += pancinoCard();
  if (late.length) h += `<div class="sec"><h2>Rimaste indietro</h2><span class="count">${late.length}</span></div><div class="list">${late.map(itemRow).join("")}</div>`;
  h += `<div class="sec"><h2>Appuntamenti di oggi</h2></div>`;
  h += ev.length ? `<div class="list">${ev.map(itemRow).join("")}</div>` : `<div class="empty" style="padding:10px">Nessun appuntamento oggi ☁️</div>`;
  h += `<div class="sec"><h2>Da fare oggi</h2></div>`;
  h += todo.length ? `<div class="list">${todo.map(itemRow).join("")}</div>` : `<div class="empty" style="padding:10px">Niente in scadenza oggi${DECO("✨")}</div>`;
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
    cells += `<button class="day ${d.getMonth() !== m.getMonth() ? "out" : ""} ${s === todayStr() ? "today" : ""} ${s === sel ? "sel" : ""} ${um ? "has-um" : ""} ${tu && tu.k !== "" ? "conturno" : ""}" ${um ? `style="--um:${UMORI[um.livello].colore}"` : ""} data-act="${act}" data-v="${s}"><span class="dn">${d.getDate()}</span><span class="dots">${dots}</span>${tu && tu.k !== "" ? `<span class="tday-s" style="--tc:${TURNO_COLORI[tu.colore - 1]}">${esc(tu.sigla)}</span>` : ""}</button>`;
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
  // Sezioni sempre aperte, ordinate per scopo; una sezione senza voci (moduli spenti) non compare
  const sez = (titolo, voci) => { const h = voci.join("").trim(); return h ? `<h3 class="msec">${titolo}</h3><div class="mgrid">${h}</div>` : ""; };
  return `<div class="sec" style="margin-top:0"><h2>Menu</h2></div>
    ${sez("Ogni giorno", [
voce('data-tab="appunti"', "📝", "Appunti", "Idee, liste, cose da tenere"),
mod("spese") ? voce('data-tab="spese"', "👛", "Spese", (() => { const t = totaleMese(new Date()); return t ? `${euro(t)} questo mese` : "Quanto spendi nel mese"; })()) : "",
mod("turni") ? voce('data-tab="turni"', "💼", "Turni di lavoro", turniAttivi() ? (() => { const o = oreMese(new Date()); return `${fmtOre(o.min)} questo mese`; })() : "Il calendario del lavoro") : "",
mod("liste") ? voce('data-act="open-liste"', "👭", "Liste condivise", state.liste.length ? state.liste.map((l) => esc(l.emoji)).join(" ") : "Da usare insieme") : "",
mod("ricorrenti") ? voce('data-act="open-ricorrenti"', "🔁", "Ricorrenti", "Bevi acqua, fai una pausa...") : ""])}
    ${sez("Benessere e gioco", [
mod("focus") ? voce('data-tab="focus"', "🪴", "Concentrazione", (() => { const n = serraDi(todayStr()).length; return n ? `${n} ${n === 1 ? "piantina" : "piantine"} oggi` : "Un timer con la piantina"; })()) : "",
mod("umore") ? voce('data-act="giardino-apri"', "🌷", "Il giardino del mese", "Le tue giornate in fiori") : "",
mod("biscotto") ? voce('data-act="open-biscotto"', "🥠", "Biscotto del giorno", "La frase di oggi") : "",
mod("pancino") ? voce('data-act="open-pancino"', "🍣", `Il pancino di ${esc(MN())}`, "Bocconcini e regali") : "",
mod("casa") ? voce('data-tab="casa"', "🏡", "La casetta", (() => { const n = mobiliAvuti().length; return n ? `${n} ${n === 1 ? "mobile" : "mobili"} in regalo` : "La casa di " + esc(MN()); })()) : "",
mod("pet") ? voce('data-tab="pet"', petSp(CUSTOM.pet.specie)[2], esc(petTitolo()), petPresente(CUSTOM.pet) ? (() => { const v = petVoci(); return v.length ? `Fatto oggi ${v.filter((x) => petFatte(todayStr()).has(x.id)).length}/${v.length}` : "Scheda, routine e pesi"; })() : "Scheda, routine e pesi") : ""])}
    ${sez("Riepiloghi", [
voce('data-act="open-recap"', "🎀", "Recap del mese", "Com'è andato il mese")])}
    ${sez("Aiuto", [
ONLINE_MODE ? voce('data-act="open-consiglio"', "💌", "Consiglia", "Scrivi alla sviluppatrice") : "",
isAdmin ? voce('data-act="open-inbox"', "📬", "Messaggi ricevuti", adminUnread ? `${adminUnread} da leggere` : "Tutti letti") : "",
voce('data-act="open-settings"', "⚙️", "Impostazioni", "Colori, cosa usare, suoni")])}`;
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
      ${n.sottotask?.length ? `<div class="st-note">${voceListaHtml(n, 10)}</div>` : ""}
      <div class="when">${n.sottotask?.length ? `☑ ${n.sottotask.filter((x) => x.f).length}/${n.sottotask.length} · ` : ""}${n.lista_id && listaById(n.lista_id) ? esc(listaById(n.lista_id).emoji) : n.area === "lavoro" ? "💼" : "🌷"} ${niceDate(ymd(new Date(n.updated_at || n.created_at)))}</div></div>`).join("")}</div>`;
  return h;
}

// Pagine che appartengono a un modulo: se è spento si torna a Oggi
const PAGINA_MODULO = { turni: "turni", spese: "spese", liste: "liste", ricorrenti: "ricorrenti", focus: "focus", casa: "casa", pet: "pet" };
function render() {
  applyCustom();
  headerUpdate();
  if (PAGINA_MODULO[state.tab] && !mod(PAGINA_MODULO[state.tab])) state.tab = "oggi";
  // fuori dalla pagina Concentrazione non resta nessuna sessione a metà (timer, schermo acceso)
  if (state.tab !== "focus" && focusS) focusChiudi();
  if (!mod("liste")) { if (state.todoFilter.startsWith("l:")) state.todoFilter = "tutte"; if (state.noteFilter.startsWith("l:")) state.noteFilter = "tutte"; }
  const v = ({ oggi: viewOggi, todo: viewTodo, agenda: viewAgenda, appunti: viewAppunti, liste: viewListe, ricorrenti: viewRicorrenti, turni: viewTurni, spese: viewSpese, focus: viewFocus, casa: viewCasa, pet: viewPet, menu: viewMenu }[state.tab] || viewOggi)();
  const el = $("#view");
  el.innerHTML = `<div class="view">${v}</div>`;
  document.querySelectorAll(".nav .tab, .nav .side").forEach((b) => b.classList.toggle("on", b.dataset.tab === state.tab));
  document.querySelectorAll(".nav .side-admin").forEach((b) => b.classList.toggle("hidden", !isAdmin));
  festaDopoRender();
  const nl = document.querySelector(".nav .pet-lbl"); if (nl) nl.textContent = petTitolo();
  // voci della barra laterale: solo con account (online-only) e/o solo se il modulo è acceso (data-mod)
  document.querySelectorAll(".nav .online-only, .nav [data-mod]").forEach((b) => b.classList.toggle("hidden", (b.classList.contains("online-only") && !ONLINE_MODE) || (!!b.dataset.mod && !mod(b.dataset.mod))));
  // Intestazioni della barra laterale: spariscono se tutte le voci della sezione sono nascoste
  document.querySelectorAll(".nav .side-head").forEach((h) => { let n = h.nextElementSibling, vis = false; while (n && !n.classList.contains("side-head")) { if ((n.classList.contains("side") || n.classList.contains("tab")) && !n.classList.contains("hidden")) vis = true; n = n.nextElementSibling; } h.classList.toggle("hidden", !vis); });
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
// Tastiera: chi ha aperto la finestra (per ridargli il focus alla chiusura)
let sheetOpener = null;
function openSheet(html) {
  const ae = document.activeElement;
  if (!$("#sheet").classList.contains("on") && ae && ae !== document.body && !$("#sheet").contains(ae)) sheetOpener = ae;
  $("#sheet").innerHTML = `<div class="sheet-bar"><div class="grab"></div><button class="sheet-x" data-act="close" aria-label="Chiudi">✕</button></div>${html}`;
  $("#sheet").scrollTop = 0;
  bloccaPagina(); sheetSuTastiera();
  $("#scrim").classList.add("on"); $("#sheet").inert = false; $("#sheet").classList.add("on"); document.body.classList.add("sheet-open");
}
function closeSheet() {
  const sh = $("#sheet");
  const avevaFocus = sh.contains(document.activeElement);
  if (avevaFocus) document.activeElement.blur();
  $("#scrim").classList.remove("on"); sh.classList.remove("on"); sh.inert = true; document.body.classList.remove("sheet-open"); draft = null;
  sbloccaPagina();
  // il focus torna dove era (solo pulsanti e link: un campo di testo riaprirebbe la tastiera sul telefono)
  const op = sheetOpener; sheetOpener = null;
  if (avevaFocus && op && op.isConnected && !/^(INPUT|TEXTAREA|SELECT)$/.test(op.tagName) && op.getClientRects().length) op.focus({ preventScroll: true });
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
  const pm = petMarca(it);
  draft = { ...it, body: pm ? pm.resto : it.body, _pet: pm ? { tipo: pm.tipo, rep: pm.rep, anchor: pm.anchor } : null, sottotask: cleanSottotask(it.sottotask), _new: isNew, _autoRemind: isNew || !it.due_date, _spesa: isSpesa(it), _spesaScelta: sceltaSpesa(it) !== null };
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
    ${listeUsate().length && !d._pet ? `<div class="field"><label>Dove</label><select class="input" id="fLista">
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
  t.addEventListener("input", () => { if (!draft) return; draft.title = t.value; previewParse(); if (!draft._spesa && !draft._spesaScelta && titoloSpesa(t.value)) { draft._spesa = true; drawSt(); } });
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
    box.addEventListener("input", (e) => {
      if (e.target.id === "stNew") { aggiornaSuggerimenti(e.target.value); return; } // lista della spesa: cose già scritte in passato
      const i = e.target.closest(".st-in[data-sid]"); const x = i && draft?.sottotask.find((s) => s.id === i.dataset.sid); if (x) x.t = i.value; });
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
  const spesa = !!draft?._spesa, perReparto = spesa && CUSTOM.spesa_reparti !== false, daTitolo = spesa && !draft._spesaScelta && titoloSpesa(draft.title);
  const riga = (x, i, su) => `<div class="st-row ${x.f ? "fatto" : ""}">
      <button class="st-check" data-act="st-toggle" data-v="${esc(x.id)}" aria-label="${x.f ? "Togli la spunta" : "Spunta"}">${x.f ? "✓" : ""}</button>
      <input class="st-in" data-sid="${esc(x.id)}" value="${esc(x.t)}" maxlength="120" autocomplete="off" enterkeyhint="next" aria-label="Voce ${i + 1}">
      ${su ? `<button class="st-btn" data-act="st-su" data-v="${esc(x.id)}" aria-label="Sposta su" ${i ? "" : "disabled"}>↑</button>` : ""}
      <button class="st-btn" data-act="st-del" data-v="${esc(x.id)}" aria-label="Togli">✕</button></div>`;
  const righe = perReparto ? gruppiSpesa(st).map((g) => `<div class="sp-rep">${REPARTI[g.i][2]} ${REPARTI[g.i][1]}</div>${g.voci.map((x) => riga(x, st.indexOf(x), false)).join("")}`).join("") : st.map((x, i) => riga(x, i, true)).join("");
  const rc = spesa && st.length < MAX_ST ? ricompri(st) : [];
  return `<div class="sp-opz"><button class="pin-toggle mini-t ${spesa ? "on" : ""}" data-act="st-spesa" aria-pressed="${spesa}"><span><b>È una lista della spesa</b><small>${daTitolo ? "L'ho capito dal titolo" : "Suggerimenti e reparti del supermercato"}</small></span><span class="sw2"></span></button>
    ${spesa ? `<button class="pin-toggle mini-t ${perReparto ? "on" : ""}" data-act="st-reparti" aria-pressed="${perReparto}"><span><b>Raggruppa per reparto</b><small>Nell'ordine del giro del supermercato</small></span><span class="sw2"></span></button>` : ""}</div>
    ${righe}
    ${st.length < MAX_ST ? `<div class="st-row nuovo"><span class="st-plus">+</span><input class="st-in" id="stNew" maxlength="120" placeholder="${st.length ? "Aggiungi un'altra e premi Invio" : "Es. latte, uova... e premi Invio"}" autocomplete="off" enterkeyhint="enter" aria-label="Nuova voce"></div>` : `<p class="hint">Massimo ${MAX_ST} voci.</p>`}
    ${spesa ? `<div class="sp-sugg-box" id="stSugg" aria-live="polite"></div>` : ""}
    ${rc.length ? `<div class="sp-ricompri"><span class="sp-sugg-l">Ricompri spesso:</span>${rc.map(chipSugg).join("")}</div>` : ""}
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
  const visti = new Set(draft.sottotask.map((x) => x.id));
  draft.sottotask.push({ id: (draft._spesa ? MARCA_SPESA : draft._spesaScelta ? MARCA_NO_SPESA : "") + nuovoStId(visti), t, f: false });
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
  if (d._pet) { if (d.kind === "todo") { d.lista_id = null; const mk = petMarcaTesto(d._pet); d.body = mk + d.body.slice(0, 20000 - mk.length); } } // scadenza del pet: il marcatore resta (e resta privata)
  const modoSpesa = d._spesaScelta ? (d._spesa ? "on" : "off") : (d._spesa || titoloSpesa(d.title) ? "on" : null);
  d.sottotask = cleanSottotask(marcaSpesa(cleanSottotask(d.sottotask), modoSpesa));
  ricordaSpesaOff(d.id, modoSpesa === "off" && !d.sottotask.length);
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
    if (d.kind !== "event") festaParola(d.title);
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
    : `${gen("Mese da record.", "Mese da campionessa.", "Mese da campione.")} ${MN()} ti offre un sushi immaginario 🍣🏆`;
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
    ${mod("serie") ? (() => { const n = [...state.giorni].filter((g) => g.startsWith(key)).length, mx = serie().maxPerMese[key] || 0; return n ? `<div class="bubble" style="margin:12px 0 0;text-align:center">🔥 <b>${n}</b> ${n === 1 ? "giorno attivo" : "giorni attivi"}, con una serie fino a <b>${mx}</b> ${mx === 1 ? "giorno" : "giorni"} di fila</div>` : ""; })() : ""}
    ${mod("umore") ? `<div class="sec"><h2>Il giardino del mese</h2></div>${giardinoSvg(m)}` : ""}
    ${all.length ? `<div class="sec"><h2>Lavoro e vita</h2></div>
      <div class="bar2"><i style="width:${pLav}%;background:var(--lav-d)"></i><i style="width:${100 - pLav}%;background:var(--pink)"></i></div>
      <div class="legend"><span><span class="emo">💼 </span>Lavoro ${lav}</span><span><span class="emo">🌷 </span>Personale ${per}</span></div>` : ""}
    ${done.length ? `<div class="sec"><h2>Cose che hai portato a casa</h2></div>
      <div class="list">${done.sort((a, b) => b.done_at.localeCompare(a.done_at)).slice(0, 10).map((i) => `<div class="item ${i.area} done" style="opacity:1"><span class="check">✓</span><div class="body"><div class="t" style="text-decoration:none">${esc(i.title)}</div></div></div>`).join("")}</div>` : ""}
    <div class="actions" style="margin-top:16px"><button class="btn primary" data-act="close">Grazie ${MN()}${DECO("💗")}</button></div>`);
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
/* Impostazioni a gruppi (fisarmonica): un solo gruppo aperto, ricordato solo nella sessione (niente nei dati) */
let sgAperto = null;
function sgApri(id, e, t, r) {
  const o = sgAperto === id;
  return `<section class="sgrp${o ? " open" : ""}" data-g="${id}"><button type="button" class="sgrp-h" id="sgh-${id}" data-act="sg-toggle" data-v="${id}" aria-expanded="${o}" aria-controls="sgp-${id}"><span class="sgrp-e" aria-hidden="true">${e}</span><span class="sgrp-t"><b>${t}</b><small>${r}</small></span><span class="sgrp-ch" aria-hidden="true">›</span></button><div class="sgrp-b" id="sgp-${id}" role="region" aria-labelledby="sgh-${id}"${o ? "" : " hidden"}>`;
}
const SG_FINE = `</div></section>`;
function riassuntoProfilo() { const p = PRONOMI.find((x) => x[0] === CUSTOM.pronomi); return esc(CUSTOM.nome_app) + ", " + esc(MN()) + (CUSTOM.pronomi && p ? ", " + esc(p[1].toLowerCase()) : ""); }
function riassuntoUsare() { const l = MODULI.filter((m) => !m[5] || ONLINE_MODE); const n = l.filter((m) => mod(m[0])).length; return n === l.length ? `Tutto acceso (${n})` : `${n} su ${l.length} accesi`; }
function riassuntoAspetto() { const st = STILI.find((x) => x[0] === CUSTOM.stile), co = PALETTE.find((x) => x[0] === CUSTOM.colore), fo = FONTI.find((x) => x[0] === CUSTOM.font); return `Stile ${esc(st ? st[1] : "")}, colori ${esc(co ? co[1] : "")}, carattere ${esc(fo ? fo[1].replace(/^Dello/, "dello") : "")}`; }
function riassuntoDati() { return ONLINE_MODE ? "Recap, backup, privacy, account" : OSPITE ? "Recap, backup, privacy, esci" : "Recap e backup"; }
function sgToggle(id) {
  sgAperto = sgAperto === id ? null : id;
  document.querySelectorAll("#sheet .sgrp").forEach((g) => { const o = g.dataset.g === sgAperto; g.classList.toggle("open", o); g.querySelector(".sgrp-h").setAttribute("aria-expanded", String(o)); g.querySelector(".sgrp-b").hidden = !o; });
  if (sgAperto) document.getElementById("sgh-" + id)?.scrollIntoView({ block: "nearest" });
}
function openSettings(gruppo) {
  if (gruppo) sgAperto = gruppo;
  const perm = "Notification" in window ? Notification.permission : "unsupported";
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const theme = document.documentElement.dataset.theme || "auto";
  const rName = ONLINE_MODE ? `<div class="setrow"><div><b>Il tuo nome</b><small>${esc(NOME || "Non impostato")} · ${esc(store.user?.email || "")}</small></div><button class="fbtn" data-act="set-name">Cambia</button></div>` : "";
  const rDati = ONLINE_MODE ? `<div class="setrow"><div><b>Esci</b><small>Su questo dispositivo</small></div><button class="fbtn" data-act="logout">Esci</button></div>
    <div class="setrow"><div><b>Privacy</b><small>Come vengono trattati i tuoi dati</small></div><a class="fbtn" style="text-decoration:none" href="privacy.html">Leggi</a></div>
    <div class="setrow"><div><b style="color:var(--danger)">Elimina account</b><small>Cancella per sempre account e dati</small></div><button class="fbtn" style="color:var(--danger)" data-act="delete-account">Elimina</button></div>` : OSPITE ? `<div class="setrow"><div><b>Privacy</b><small>Come ospite le tue cose restano su questo dispositivo</small></div><a class="fbtn" style="text-decoration:none" href="privacy.html">Leggi</a></div>
    <div class="setrow"><div><b>Esci</b><small>Dalla modalità ospite</small></div><button class="fbtn" data-act="ospite-esci">Esci</button></div>` : `<div class="setrow"><div><b>Modalità prova</b><small>I dati restano solo su questo dispositivo</small></div></div>`;
  openSheet(`
    <h2><span class="mbox">${mascot()}</span>Impostazioni</h2>
    ${OSPITE ? schedaOspite() : ""}${ONLINE_MODE ? rigaPassaggio() : ""}
    <div class="setrow" id="pushRow">${pushRowHtml(!ONLINE_MODE ? "offline" : !PUSH_READY ? "soon" : perm === "unsupported" ? (!standalone && /iPhone|iPad/.test(navigator.userAgent) ? "home" : "unsupported") : perm === "denied" ? "denied" : "checking")}</div>
    ${sgApri("profilo", "👤", "Profilo", riassuntoProfilo())}
    <div class="setrow"><div><b>Nome e mascotte</b><small>${esc(CUSTOM.nome_app)} · ${esc(MN())}</small></div><button class="fbtn on" data-act="open-custom">Cambia</button></div>
    <div class="setrow col" id="setPron"><div><b>I tuoi pronomi</b><small>Facoltativo. Servono solo ad adattare i testi dell'app a te (ad esempio "orgogliosa" o "orgoglioso"). Restano privati: non li vede nessun altro e non cambiano nient'altro. Se non scegli, uso parole neutre. Li cambi o li togli quando vuoi${ONLINE_MODE ? " · su tutti i tuoi dispositivi" : ""}.</small></div>
      <div class="filters" style="flex-wrap:wrap" role="group" aria-label="I tuoi pronomi">${PRONOMI.map(([k, n]) => `<button class="fbtn ${CUSTOM.pronomi === k ? "on" : ""}" data-act="pick-pronomi" data-v="${k || "non"}" aria-pressed="${CUSTOM.pronomi === k}">${n}</button>`).join("")}</div></div>
    ${mod("feste") ? `<div class="setrow col" id="setCompl"><div><b>Il tuo compleanno</b><small>Facoltativo: solo giorno e mese, niente anno. Quel giorno ${esc(MN())} ti fa gli auguri${ONLINE_MODE ? " · su tutti i tuoi dispositivi" : ""}</small></div>
      <div class="compl">${(() => { const [mm, gg] = CUSTOM.compleanno ? CUSTOM.compleanno.split("-").map(Number) : [0, 0];
        return `<select class="input" id="cGiorno" aria-label="Giorno del compleanno"><option value="">Giorno</option>${Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}" ${gg === i + 1 ? "selected" : ""}>${i + 1}</option>`).join("")}</select>
        <select class="input" id="cMese" aria-label="Mese del compleanno"><option value="">Mese</option>${MESI.map((n, i) => `<option value="${i + 1}" ${mm === i + 1 ? "selected" : ""}>${n.replace(/^./, (c) => c.toUpperCase())}</option>`).join("")}</select>`; })()}
        ${CUSTOM.compleanno ? `<button class="fbtn" data-act="compleanno-togli">Togli</button>` : ""}</div></div>` : ""}
    ${rName}
    ${SG_FINE}
    ${sgApri("usare", "🧩", "Cosa vuoi usare", riassuntoUsare())}
    <div class="setrow col" id="setModuli"><div><b>Cosa vuoi usare</b><small>Quello che spegni sparisce dappertutto, ma i dati restano${ONLINE_MODE ? " · su tutti i tuoi dispositivi" : ""}</small></div>
      <div class="moduli">${MODULI.filter((m) => !m[5] || ONLINE_MODE).map(([k, e, n, d]) => `<button class="pin-toggle ${mod(k) ? "on" : ""}" data-act="modulo" data-v="${k}" aria-pressed="${mod(k)}"><span class="e">${e}</span><span><b>${n}</b><small>${d}</small></span><span class="sw2"></span></button>`).join("")}</div>
      ${mod("stagioni") ? `<div class="stag-scelta"><small>Che tempo fa sullo sfondo?</small><div class="filters" style="flex-wrap:wrap">${STAGIONI.map(([k, e, n]) => `<button class="fbtn ${CUSTOM.stagione === k ? "on" : ""}" data-act="pick-stagione" data-v="${k}">${e} ${n}</button>`).join("")}</div>${menoMoto() ? `<small>Il tuo dispositivo chiede meno animazioni: l'effetto resta fermo.</small>` : ""}</div>` : ""}</div>
    ${mod("umore") ? `<div class="setrow"><div><b>I fiori del giardino</b><small>${riassuntoFiori()}</small></div><button class="fbtn on" data-act="fiori-apri">Scegli</button></div>` : ""}
    ${SG_FINE}
    ${sgApri("aspetto", "🎨", "Aspetto e suoni", riassuntoAspetto())}
    <div class="setrow"><div><b>Chiaro o scuro</b><small>Automatico segue il telefono</small></div>
      <select class="input" style="width:auto;padding:8px 12px" id="themeSel">
        <option value="auto" ${theme === "auto" ? "selected" : ""}>Auto</option><option value="light" ${theme === "light" ? "selected" : ""}>Chiaro</option><option value="dark" ${theme === "dark" ? "selected" : ""}>Scuro</option></select></div>
    <div class="setrow col"><div><b>Stile</b><small>Cambia l'aspetto di tutta l'app${ONLINE_MODE ? " · su tutti i tuoi dispositivi" : ""}</small></div>
      <div class="stili">${STILI.map(([id, nome, d]) => `<button class="stile-${id} ${CUSTOM.stile === id ? "on" : ""}" data-act="pick-stile" data-v="${id}"><span class="anteprima"><i></i><i></i><i></i></span><b>${nome}</b><small>${d}</small></button>`).join("")}</div></div>
    <div class="setrow col"><div><b>Colori</b><small>${esc(PALETTE.find((x) => x[0] === CUSTOM.colore)[1])}${ONLINE_MODE ? " · su tutti i tuoi dispositivi" : ""}</small></div>
      <div class="palettes">${PALETTE.map(([id, nome, a, b, e]) => `<button class="${CUSTOM.colore === id ? "on" : ""}" data-act="pick-palette" data-v="${id}" aria-label="${nome}" title="${nome}"><span class="sw" style="background:linear-gradient(145deg,${a}55,${b}88)">${e}</span><small>${nome}</small></button>`).join("")}</div></div>
    <div class="setrow col"><div><b>Carattere</b><small>${esc(FONTI.find((x) => x[0] === CUSTOM.font)[1])}${ONLINE_MODE ? " · su tutti i tuoi dispositivi" : ""}</small></div>
      <div class="fonts">${FONTI.map(([id, nome, fam]) => `<button class="${CUSTOM.font === id ? "on" : ""}" data-act="pick-font" data-v="${id}"><span class="aa" style="font-family:${fam}">Aa</span><small>${nome}</small></button>`).join("")}</div></div>
    <div class="setrow col" id="setSuoni"><div><b>Suoni</b><small>Quando arriva un promemoria ad app aperta, quando spunti una cosa fatta e quando apri il biscotto. Tocca per sentirli.</small></div>
      <div class="suoni">${SUONI.map(([k, e, n]) => `<button class="${CUSTOM.suono === k ? "on" : ""}" data-act="pick-suono" data-v="${k}" aria-pressed="${CUSTOM.suono === k}"><span class="sw">${e}</span><small>${n}</small></button>`).join("")}</div></div>
    ${SG_FINE}
    ${sgApri("dati", "🗂️", "I tuoi dati", riassuntoDati())}
    <div class="setrow"><div><b>Recap mensile</b><small>Il riassunto del mese con ${MN()}</small></div><button class="fbtn" data-act="open-recap">Apri</button></div>
    <div class="setrow"><div><b>Backup</b><small>Scarica tutte le tue cose in un file</small></div><button class="fbtn" data-act="export">Scarica</button></div>
    ${rDati}
    ${SG_FINE}
    <div class="actions"><button class="btn" data-act="close">Chiudi</button></div>`);
  $("#themeSel").addEventListener("change", (e) => setTheme(e.target.value));
  const salvaCompleanno = async () => {
    const g = $("#cGiorno")?.value, m = $("#cMese")?.value; if (!g || !m) return;
    const c = cleanCompleanno(`${pad(+m)}-${pad(+g)}`);
    if (!c) { toast("Quel giorno non esiste in quel mese 📅"); return; }
    await saveCustom({ compleanno: c }); riapriImpostazioni(); toast("Compleanno salvato 🎂");
  };
  $("#cGiorno")?.addEventListener("change", salvaCompleanno); $("#cMese")?.addEventListener("change", salvaCompleanno);
  if (PUSH_READY && (perm === "granted" || perm === "default")) refreshPushRow();
}

/* Stato dei promemoria su QUESTO dispositivo.
   Conta l'iscrizione alle notifiche, non il permesso del browser: il permesso
   un sito non può toglierlo da solo, l'iscrizione sì (ed è quella che usa il server). */
function pushRowHtml(s) {
  const txt = {
    offline: OSPITE ? "Con un account ti avviso all'orario giusto, anche ad app chiusa" : "Disponibili dopo aver collegato Supabase",
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
    ["pet", "🐾", "<b>Il tuo pet</b>: la scheda del tuo animale, la routine di ogni giorno, i pesi e le scadenze di vaccini e visite con il promemoria. Si accende da Impostazioni → Cosa vuoi usare.", "pet"],
    ["sobrio", "🎨", "Nuovo stile <b>Sobrio</b> e tre palette nuove (Notte, Bosco, Grafite): colori sobri e forme più decise, per chi preferisce un aspetto più serio. Lo trovi in Impostazioni → Stile e Colori."],
    ["feste", "🎉", "<b>Feste</b>: a Natale, Capodanno, San Valentino, Pasqua, Halloween e in estate la mascotte si veste a festa e la casetta si decora, da sola. Se aggiungi il tuo compleanno in Impostazioni, ti fa gli auguri. In giro ci sono anche sorprese nascoste... Si spegne da Impostazioni → Cosa vuoi usare.", "feste"],
    ["spesa-smart", "🛒", "<b>Lista della spesa intelligente</b>: nelle liste da spuntare della spesa ti suggerisco le cose che compri di solito e le metto in ordine per reparto, come il giro del supermercato."],
    ["riepilogo", "🌙", "<b>Riepilogo della domenica</b>: la domenica sera i numeri della tua settimana (cose fatte, giorni attivi, turni e spese), con il confronto con quella prima.", "riepilogo"],
    ["casette", "🏡", "<b>La casetta</b>: la tua mascotte ha una casa tutta sua. I mobili arrivano in regalo spuntando le cose fatte, le casette nuove si aprono con i giorni attivi. La trovi nel menu (o tieni premuta la mascotte in alto).", "casa"],
    ["cartone", "🖍️", "Nuovo stile <b>Cartone</b>: linee scure, colori pieni e tutto tondo, come nei cartoni animati. Lo trovi in Impostazioni → Stile, accanto a Morbido e Quaderno."],
    ["serie", "🔥", "<b>Serie di giorni</b>: in Oggi vedi quanti giorni di fila hai spuntato qualcosa. Ogni settimana c'è un giorno di riposo che non spezza la serie, e il record resta tuo.", "serie"],
    ["focus", "🪴", "<b>Concentrazione</b>: un timer da 15, 25 o 45 minuti con una piantina che cresce mentre lavori. Lo trovi nel menu.", "focus"],
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
const EMOJI_LISTE = ["🏠", "🛒", "🍣", "✈️", "🎁", "🐶", "💼", "📚", "🌸", "🍳", "🎉", "🫂"];
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
  if (!ONLINE_MODE) return OSPITE ? invitoAccount("Le liste condivise si usano insieme ad altre persone: crea un account per usare questa funzione.") : emptyBox("Le liste condivise funzionano quando l'app è collegata a un account 🌸");
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
          ${l.proprietaria === me ? `<button class="fbtn" style="color:var(--danger)" data-act="l-elimina" data-id="${esc(l.id)}">Elimina</button>` : ""}
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
    <div class="field"><label>Simbolo</label><div class="emojis">${EMOJI_LISTE.map((e) => `<button class="${listaDraft.emoji === e ? "on" : ""}" data-act="l-emoji" data-v="${e}">${e}</button>`).join("")}</div>
      <label for="lsEmoji" style="margin-top:10px">Aggiungi la tua emoji</label>
      <input class="input" id="lsEmoji" maxlength="8" placeholder="Scrivi una emoji" value="${EMOJI_LISTE.includes(listaDraft.emoji) ? "" : esc(listaDraft.emoji)}" autocomplete="off" aria-describedby="lsEmojiAiuto">
      <p class="hint" id="lsEmojiAiuto">Una sola emoji, dalla tastiera</p></div>
    <div class="actions"><button class="btn" data-act="l-indietro">Indietro</button><button class="btn primary" data-act="l-salva">Salva</button></div>`);
  const i = $("#lsNome"); i.addEventListener("input", () => { listaDraft.nome = i.value; });
  const ie = $("#lsEmoji");
  ie.addEventListener("input", () => {
    const e = emojiValida(ie.value);
    ie.setAttribute("aria-invalid", ie.value.trim() && !e ? "true" : "false");
    if (!ie.value.trim() && !EMOJI_LISTE.includes(listaDraft.emoji)) { // campo svuotato: torna al simbolo di base
      listaDraft.emoji = "🏠";
      document.querySelector('.emojis [data-v="🏠"]')?.classList.add("on");
    }
    if (!e) return;
    listaDraft.emoji = e;
    document.querySelectorAll('.emojis [data-act="l-emoji"]').forEach((b) => b.classList.remove("on"));
  });
}
// Emoji scritta da chi crea la lista: un solo simbolo, con le stesse regole del database
// (1-8 caratteri, niente lettere, cifre o < > " ' &). Restituisce "" se non va bene.
function emojiValida(v) {
  const s = String(v || "").trim();
  if (!s || s.length > 8 || /[<>"'&A-Za-z0-9\s]/.test(s) || !/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(s)) return "";
  if (typeof Intl !== "undefined" && Intl.Segmenter && [...new Intl.Segmenter("it", { granularity: "grapheme" }).segment(s)].length !== 1) return "";
  return s;
}
async function salvaLista(btn) {
  const nome = listaDraft.nome.trim();
  if (!nome) { toast("Dai un nome alla lista 🌸"); return; }
  const mia = $("#lsEmoji")?.value.trim();
  if (mia && !emojiValida(mia)) { toast("Scrivi una sola emoji, oppure scegline una 🌸"); return; }
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
    cheer(); toast(`${gen("Eccoti in", "Benvenuta in", "Benvenuto in")} ${str(info.emoji)} ${str(info.nome)}!${DECO("💗")}`);
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
  try { await store.esciLista(id); await loadListe(); state.items = await store.list(); if (state.todoFilter === "l:" + id) state.todoFilter = "tutte"; if (state.noteFilter === "l:" + id) state.noteFilter = "tutte"; render(); openListe(); toast(gen("Hai lasciato la lista", "Sei uscita dalla lista", "Sei uscito dalla lista")); }
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

// ---- I fiori del giardino: una tabella sola (id -> disegno). Per cambiare un fiore del set "un fiore per ogni umore"
// basta cambiare una riga di FIORI_UMORE (o il disegno qui sotto). Niente id negli SVG: si possono mettere in fila quanti si vuole.
const _f = (n) => (+n).toFixed(1);
const _CONTORNO = `stroke="#4a2f3a" stroke-opacity=".25" stroke-width=".9" stroke-linejoin="round"`;
const _petalo = (x, y, rx, ry, deg, fill) => `<ellipse cx="${_f(x)}" cy="${_f(y)}" rx="${_f(rx)}" ry="${_f(ry)}" transform="rotate(${deg.toFixed(0)} ${_f(x)} ${_f(y)})" fill="${fill}" ${_CONTORNO}/>`;
const _corona = (x, y, r, n, dist, lung, larg, fill) => { let o = ""; for (let p = 0; p < n; p++) { const a = (p / n) * Math.PI * 2; o += _petalo(x + Math.cos(a) * r * dist, y + Math.sin(a) * r * dist, r * lung, r * larg, a * 180 / Math.PI, fill); } return o; };
// visino kawaii: due occhietti e un sorriso, grande quanto il centro del fiore
const _visino = (x, y, s, col) => `<circle cx="${_f(x - s * .36)}" cy="${_f(y - s * .1)}" r="${_f(Math.max(s * .15, .8))}" fill="${col}"/><circle cx="${_f(x + s * .36)}" cy="${_f(y - s * .1)}" r="${_f(Math.max(s * .15, .8))}" fill="${col}"/><path d="M${_f(x - s * .2)} ${_f(y + s * .2)} Q${_f(x)} ${_f(y + s * .45)} ${_f(x + s * .2)} ${_f(y + s * .2)}" stroke="${col}" stroke-width="1" fill="none" stroke-linecap="round"/>`;
const _luce = (x, y, rx, ry) => `<ellipse cx="${_f(x)}" cy="${_f(y)}" rx="${_f(rx)}" ry="${_f(ry)}" fill="#fff" opacity=".35"/>`;
const FIORI = {
  // il fiore di sempre (identico a prima)
  classico: { nome: "Classico", plur: "", draw(cx, cy, r, c, l, g) {
    let petali = ""; const n = l >= 4 ? 6 : 5;
    for (let p = 0; p < n; p++) { const a = (p / n) * Math.PI * 2 - Math.PI / 2 + (g % 3) * .2; petali += `<ellipse cx="${(cx + Math.cos(a) * r).toFixed(1)}" cy="${(cy + Math.sin(a) * r).toFixed(1)}" rx="${(r * .62).toFixed(1)}" ry="${(r * .5).toFixed(1)}" transform="rotate(${(a * 180 / Math.PI).toFixed(0)} ${(cx + Math.cos(a) * r).toFixed(1)} ${(cy + Math.sin(a) * r).toFixed(1)})" fill="${c}"/>`; }
    return petali + `<circle cx="${cx}" cy="${cy}" r="${(r * .55).toFixed(1)}" fill="#ffe28a" stroke="#f2c14e" stroke-width="1.5"/>`; } },
  margherita: { nome: "Margherita", plur: "margherite", draw(x, y, r, c) {
    return _corona(x, y, r, 10, .95, .55, .22, c) + `<circle cx="${_f(x)}" cy="${_f(y)}" r="${_f(r * .5)}" fill="#ffe28a" stroke="#f2c14e" stroke-width="1.2"/>` + _visino(x, y + r * .02, r * .5, "#4a2f3a"); } },
  tulipano: { nome: "Tulipano", plur: "tulipani", draw(x, y, r, c) {
    // calice alto e stretto: due petali laterali che si aprono e uno centrale a punta, separati da una linea
    const P = (a, b) => `${_f(x + a * r)} ${_f(y + b * r)}`;
    const lato = (m) => `<path d="M${P(m * .9, -1.5)} C${P(m * 1.05, -.5)} ${P(m * .7, .5)} ${P(0, .9)} L${P(0, -.2)} C${P(m * .3, -.6)} ${P(m * .5, -1.1)} ${P(m * .9, -1.5)} Z" fill="${c}" ${_CONTORNO}/>`;
    return lato(-1) + lato(1) + `<path d="M${P(0, -1.8)} C${P(.55, -1.1)} ${P(.55, .25)} ${P(0, .9)} C${P(-.55, .25)} ${P(-.55, -1.1)} ${P(0, -1.8)} Z" fill="${c}" ${_CONTORNO}/>`
      + `<path d="M${P(0, -1.8)} C${P(.55, -1.1)} ${P(.55, .25)} ${P(0, .9)} C${P(-.55, .25)} ${P(-.55, -1.1)} ${P(0, -1.8)} Z" fill="#fff" opacity=".2"/>` + _luce(x - r * .2, y - r * .55, r * .09, r * .35); } },
  girasole: { nome: "Girasole", plur: "girasoli", draw(x, y, r, c) {
    let sem = ""; for (let p = 0; p < 5; p++) { const a = p / 5 * Math.PI * 2 + .6; sem += `<circle cx="${_f(x + Math.cos(a) * r * .6)}" cy="${_f(y + Math.sin(a) * r * .6)}" r="${_f(r * .06)}" fill="#6b4129" opacity=".6"/>`; }
    return _corona(x, y, r, 12, 1.0, .5, .2, c) + `<circle cx="${_f(x)}" cy="${_f(y)}" r="${_f(r * .78)}" fill="#8a5a3c" stroke="#6b4129" stroke-width="1.2"/>` + sem + _visino(x, y, r * .62, "#fff4e0"); } },
  rosa: { nome: "Rosa", plur: "rose", draw(x, y, r, c) {
    // rosa vera: giro esterno di petali, giro intermedio, bocciolo scuro al centro e due fogliette
    const C = (a, b, k) => `<circle cx="${_f(x + a * r)}" cy="${_f(y + b * r)}" r="${_f(k * r)}" fill="${c}" ${_CONTORNO}/>`;
    const foglia = (m) => `<ellipse cx="${_f(x + m * 1.05 * r)}" cy="${_f(y + .95 * r)}" rx="${_f(r * .42)}" ry="${_f(r * .2)}" transform="rotate(${m * -28} ${_f(x + m * 1.05 * r)} ${_f(y + .95 * r)})" fill="#9fd3a8" ${_CONTORNO}/>`;
    let ext = "", mid = "";
    for (let p = 0; p < 5; p++) { const a = p / 5 * Math.PI * 2 - Math.PI / 2; ext += C(Math.cos(a) * .78, Math.sin(a) * .78, .58); }
    for (let p = 0; p < 5; p++) { const a = p / 5 * Math.PI * 2 - Math.PI / 2 + Math.PI / 5; mid += C(Math.cos(a) * .42, Math.sin(a) * .42, .46); }
    return foglia(-1) + foglia(1) + ext + `<circle cx="${_f(x)}" cy="${_f(y)}" r="${_f(r * 1.0)}" fill="#4a2f3a" opacity=".1"/>` + mid
      + `<circle cx="${_f(x)}" cy="${_f(y)}" r="${_f(r * .42)}" fill="#4a2f3a" opacity=".22"/>` + C(0, 0, .3) + `<path d="M${_f(x - r * .16)} ${_f(y + r * .02)} Q${_f(x)} ${_f(y - r * .22)} ${_f(x + r * .16)} ${_f(y + r * .02)}" stroke="#4a2f3a" stroke-opacity=".5" stroke-width="1" fill="none" stroke-linecap="round"/>` + _luce(x - r * .55, y - r * .8, r * .2, r * .11); } },
  campanula: { nome: "Campanula", plur: "campanule", draw(x, y, r, c) {
    // tre campanelle penzolanti di grandezza diversa su uno stelo curvo, bordo svasato con 5 festoni
    const P = (a, b) => `${_f(x + a * r)} ${_f(y + b * r)}`;
    const camp = (ax, ay, s) => { let f = ""; for (let i = 0; i < 5; i++) { const x0 = .6 - i * .24, x1 = x0 - .24; f += ` Q${P(ax + (x0 + x1) / 2 * s, ay + 1.5 * s + .3 * s)} ${P(ax + x1 * s, ay + 1.5 * s)}`; }
      return `<path d="M${P(ax - .2 * s, ay + .2 * s)} Q${P(ax, ay)} ${P(ax + .2 * s, ay + .2 * s)} C${P(ax + .28 * s, ay + .7 * s)} ${P(ax + .55 * s, ay + 1 * s)} ${P(ax + .6 * s, ay + 1.5 * s)}${f} C${P(ax - .55 * s, ay + 1 * s)} ${P(ax - .28 * s, ay + .7 * s)} ${P(ax - .2 * s, ay + .2 * s)} Z" fill="${c}" ${_CONTORNO}/>`; };
    const ramo = (d) => `<path d="${d}" stroke="#7cb98a" stroke-width="1.4" fill="none" stroke-linecap="round"/>`;
    return ramo(`M${P(0, 1.2)} C${P(0, .3)} ${P(-.05, -1)} ${P(.45, -1.6)}`) + ramo(`M${P(-.02, -.3)} L${P(-.75, -.5)}`) + ramo(`M${P(.02, -.1)} L${P(1.0, -.3)}`)
      + camp(-.75, -.5, 1.1) + camp(1.0, -.3, .9) + camp(.5, -1.6, .7) + _luce(x - r * .85, y - r * .1, r * .08, r * .22); } }
};
function idFiore(l) { return CUSTOM.fiori.modo === "umore" ? FIORI_UMORE[l] : CUSTOM.fiori.fiore; }
function fioreDisegno(id, cx, cy, l, c, g, r) { return FIORI[id].draw(cx, cy, r || 7 + l * 1.3, c, l, g); }
// descrizione per chi non vede il disegno ("Il giardino di novembre: 12 fiori, margherite")
function etichettaFiori() {
  if (CUSTOM.fiori.modo === "umore") return ", un fiore diverso per ogni umore";
  const p = FIORI[CUSTOM.fiori.fiore].plur; return p ? `, ${p}` : "";
}
const riassuntoFiori = () => CUSTOM.fiori.modo === "umore" ? "Un fiore per ogni umore" : `Sempre lo stesso: ${FIORI[CUSTOM.fiori.fiore].nome.toLowerCase()}`;
// anteprima nella scelta: lo stesso fiore in tre giornate (Pesante, Normale, Bellissima)
const anteprimaFiore = (id) => `<svg viewBox="-27 -26 158 52" aria-hidden="true">${[1, 3, 5].map((l, i) => fioreDisegno(id, i * 52, 0, l, UMORI[l].colore, 0, 7 + l * 1.3)).join("")}</svg>`;
let fioriAperto = false;
function pannelloFiori() {
  const uno = CUSTOM.fiori.modo === "uno";
  return `<details class="fiori-scelta" ${fioriAperto ? "open" : ""}><summary><b>I fiori del giardino</b><small>${riassuntoFiori()}</small></summary>
    <div class="fiori-modi" role="group" aria-label="Come sono i fiori"><button class="fbtn ${uno ? "on" : ""}" data-act="fiori-modo" data-v="uno" aria-pressed="${uno}">Sempre lo stesso fiore</button><button class="fbtn ${uno ? "" : "on"}" data-act="fiori-modo" data-v="umore" aria-pressed="${!uno}">Un fiore per ogni umore</button></div>
    ${uno ? `<div class="fiori-griglia">${FIORI_UNO.map((id) => `<button class="fiore-op ${CUSTOM.fiori.fiore === id ? "on" : ""}" data-act="fiori-scegli" data-v="${id}" aria-pressed="${CUSTOM.fiori.fiore === id}" aria-label="${FIORI[id].nome}">${anteprimaFiore(id)}<b>${FIORI[id].nome}</b></button>`).join("")}</div>`
      : `<div class="fiori-set">${[1, 2, 3, 4, 5].map((l) => `<div class="fiore-um"><svg viewBox="-26 -26 52 52" aria-hidden="true">${fioreDisegno(idFiore(l), 0, 0, l, UMORI[l].colore, 0, 11)}</svg><b>${UMORI[l].nome}</b><small>${FIORI[idFiore(l)].nome}</small></div>`).join("")}</div><p class="small" style="margin:6px 0 0">Un set scelto per te, dal più sobrio al più rigoglioso.</p>`}
  </details>`;
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
      fiori += gambo + fioreDisegno(idFiore(u.livello), cx, cy, u.livello, UMORI[u.livello].colore, g);
    } else if (k <= oggi) {
      fiori += gambo + `<ellipse cx="${cx}" cy="${cy + 2}" rx="5" ry="7" fill="#cfe7d3"/>`;
    }
    fiori += `<text x="${cx}" y="${cy + 50}" text-anchor="middle" font-size="11" fill="#8a6a77" font-family="Nunito, sans-serif">${g}</text>`;
    if (k <= oggi) fiori += `<rect class="fiore-tocco" x="${cx - 30}" y="${cy - 24}" width="60" height="76" rx="10" fill="transparent" data-act="giardino-fiore" data-id="${k}"><title>${g} ${MESI[mo]}: tocca per cambiare</title></rect>`;
  }
  const conta = Object.keys(state.umori).filter((k) => k.startsWith(`${y}-${String(mo + 1).padStart(2, "0")}`)).length;
  return `<svg class="giardino" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Il giardino di ${MESI[mo]}: ${conta} fiori${etichettaFiori()}">
    <rect x="0" y="0" width="${W}" height="${H}" rx="22" fill="#fffaf5"/>
    <rect x="0" y="${H - 26}" width="${W}" height="26" fill="#e9f5e6"/>
    <text x="${W / 2}" y="42" text-anchor="middle" font-size="26" fill="#4a2f3a" font-family="'Patrick Hand', Fredoka, sans-serif">Il giardino di ${MESI[mo]}</text>
    <text x="${W / 2}" y="64" text-anchor="middle" font-size="12.5" fill="#8a6a77" font-family="Nunito, sans-serif">${conta ? `${conta} ${conta === 1 ? "fiore" : "fiori"}, uno per ogni giornata raccontata` : "Racconta le tue giornate e qui sboccia un fiore per ognuna"}</text>
    ${fiori}</svg>`;
}
function legendaUmori() {
  // modo "un fiore per ogni umore": accanto al nome c'è il suo fiore; altrimenti il pallino colorato di sempre
  const segno = (l) => CUSTOM.fiori.modo === "umore" ? `<svg viewBox="-24 -24 48 48" aria-hidden="true">${fioreDisegno(idFiore(l), 0, 0, l, UMORI[l].colore, 0, 11)}</svg>` : `<i style="background:${UMORI[l].colore}"></i>`;
  return `<div class="u-legenda">${[1, 2, 3, 4, 5].map((l) => `<span>${segno(l)}${UMORI[l].nome}</span>`).join("")}</div>`;
}
let giardinoMese = null;
function apriGiardino(m) {
  giardinoMese = m || new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const cur = monthKey(giardinoMese) === monthKey(new Date());
  openSheet(`<div class="calhead" style="margin-bottom:10px">
      <button class="iconbtn" data-act="giardino-move" data-v="-1">‹</button>
      <span class="fred" style="font-size:16px;color:var(--ink2)">Il giardino del mese</span>
      <button class="iconbtn" data-act="giardino-move" data-v="1" ${cur ? "disabled style='opacity:.3'" : ""}>›</button></div>
    ${giardinoSvg(giardinoMese)}${legendaUmori()}
    ${pannelloFiori()}
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
  if (!ONLINE_MODE) return OSPITE ? invitoAccount("I promemoria ricorrenti arrivano come notifiche: crea un account per usare questa funzione.") : emptyBox("I promemoria ricorrenti funzionano quando l'app è collegata a un account 🌸");
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
        <div class="msg-a"><button class="fbtn" data-act="ric-modifica" data-id="${esc(r.id)}">Modifica</button><button class="fbtn" style="color:var(--danger)" data-act="ric-elimina" data-id="${esc(r.id)}">Elimina</button></div>
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
    celle += `<button class="tday ${d.getMonth() !== m.getMonth() ? "out" : ""} ${s === todayStr() ? "today" : ""} ${t && t.k !== "" ? "on" : ""} ${t?.manuale ? "man" : ""}" ${t && t.colore ? `style="--tc:${TURNO_COLORI[t.colore - 1]}"` : ""} data-act="turno-giorno" data-v="${s}" aria-label="${d.getDate()} ${MESI[d.getMonth()]}${t ? `: ${esc(t.nome)}${t.inizio ? ` dalle ${t.inizio}` : ""}` : ""}"><span class="dn">${d.getDate()}</span>${t ? (t.k === "" ? `<span class="tn riposo" aria-hidden="true">💤</span>` : `<span class="tn"><span class="tn-c">${esc([...t.nome].slice(0, 5).join(""))}</span><span class="tn-l">${esc(t.nome)}</span></span>${t.inizio ? `<span class="th">${t.inizio}</span>` : ""}`) : ""}</button>`;
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
function apriSpesa(sp, cat) {
  const ultima = LS.get("mochi.spesa.cat", "spesa");
  spesaDraft = sp ? { ...sp, _nuova: false } : { id: null, giorno: todayStr(), importo_cent: null, categoria: cat ? catSpesa(cat)[0] : catSpesa(ultima)[0], nota: "", _nuova: true, _daPet: !!cat };
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
    LS.set("mochi.speseCache", state.spese); if (!d._daPet) LS.set("mochi.spesa.cat", sp.categoria);
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
   RIEPILOGO DELLA DOMENICA (in app)
   La notifica la manda il database la domenica alle 20 (14-riepilogo.sql). Qui, da domenica sera a mercoledì,
   una card chiudibile in Oggi con gli stessi numeri e il confronto con la settimana prima: si calcola sul dispositivo,
   quindi funziona anche da ospite e senza notifiche.
   ========================================================= */
// Il lunedì della settimana da raccontare (null = non è il momento)
function lunediRiepilogo(ora = new Date()) {
  const dow = (ora.getDay() + 6) % 7; // 0 = lunedì ... 6 = domenica
  if (dow === 6 && ora.getHours() >= 20) return ymd(addDays(ora, -6));
  if (dow <= 2) return ymd(addDays(ora, -dow - 7));
  return null;
}
function numeriSettimana(lun) {
  const giorni = Array.from({ length: 7 }, (_, i) => ymd(addDays(parseYmd(lun), i))), dentro = (g) => g >= giorni[0] && g <= giorni[6];
  const fatte = bocconcini().filter((i) => dentro(ymd(new Date(i.done_at)))).length;
  const attivi = [...state.giorni].filter(dentro).length;
  const spese = state.spese.voci.filter((v) => dentro(v.giorno)).reduce((a, v) => a + v.importo_cent, 0);
  let turni = 0, minuti = 0;
  for (let i = 7; i < 14; i++) { const t = turnoDi(ymd(addDays(parseYmd(lun), i))); if (t && t.k !== "" && t.inizio) { turni++; minuti += minutiTipo(t); } }
  return { fatte, attivi, spese, turni, minuti };
}
const confronto = (a, b, fmt = (x) => x) => (a === b ? "come la settimana prima" : `${fmt(Math.abs(a - b))} in ${a > b ? "più" : "meno"} della settimana prima`);
function riepilogoCard() {
  if (!mod("riepilogo")) return "";
  const lun = lunediRiepilogo(); if (!lun || LS.get("mochi.riepilogo.chiuso", "") === lun) return "";
  const n = numeriSettimana(lun), p = numeriSettimana(ymd(addDays(parseYmd(lun), -7)));
  if (!n.fatte && !n.attivi && !n.spese && !n.turni) return "";
  const righe = [`<li><b>${plur(n.fatte, "cosa fatta", "cose fatte")}</b><small>${confronto(n.fatte, p.fatte)}</small></li>`];
  if (mod("serie")) righe.push(`<li><b>${plur(n.attivi, "giorno attivo", "giorni attivi")}</b><small>${confronto(n.attivi, p.attivi)}</small></li>`);
  if (turniAttivi() && n.turni) righe.push(`<li><b>Settimana prossima: ${plur(n.turni, "turno", "turni")} (${fmtOre(n.minuti)})</b></li>`);
  if (mod("spese") && n.spese) righe.push(`<li><b>Spese: ${euro(n.spese)}</b><small>${confronto(n.spese, p.spese, euro)}</small></li>`);
  const fine = parseYmd(lun); const dom = addDays(fine, 6);
  return `<div class="riepilogo-card" role="region" aria-label="La tua settimana">
    <div class="rp-testa"><b>🌙 La tua settimana</b><small>dal ${fine.getDate()} ${fine.getMonth() !== dom.getMonth() ? MESI[fine.getMonth()] + " " : ""}${[8, 11].includes(dom.getDate()) ? "all'" : "al "}${dom.getDate()} ${MESI[dom.getMonth()]}</small>
      <button class="iconbtn rp-x" data-act="riepilogo-chiudi" data-v="${lun}" aria-label="Chiudi il riepilogo">✕</button></div>
    <ul class="rp-righe">${righe.join("")}</ul></div>`;
}

/* =========================================================
   SCORCIATOIE (Android: tieni premuta l'icona)
   ?azione=todo | evento | spesa | nuova-spesa  (solo questi). Si legge all'avvio, si toglie subito dall'indirizzo
   e si esegue appena l'app è pronta (anche da ospite, o dopo l'accesso). Su iPhone non ci sono: nessun effetto.
   ========================================================= */
const AZIONI = ["todo", "evento", "spesa", "nuova-spesa"];
function leggiAzioneDaLink() {
  const p = new URLSearchParams(location.search), a = p.get("azione");
  if (a !== null) {
    if (AZIONI.includes(a)) { try { sessionStorage.setItem("mochi.azione", a); } catch {} }
    p.delete("azione"); history.replaceState(null, "", location.pathname + (p.toString() ? "?" + p : "") + location.hash);
  }
}
function eseguiAzione() {
  let a = null; try { a = sessionStorage.getItem("mochi.azione"); sessionStorage.removeItem("mochi.azione"); } catch {}
  if (!AZIONI.includes(a)) return;
  if (a === "todo") openEditor(newItem({ kind: "todo", lista_id: null }), true);
  else if (a === "evento") openEditor(newItem({ kind: "event", due_date: todayStr(), lista_id: null }), true);
  else if (a === "spesa") {
    // la lista della spesa più recente ancora aperta; se non c'è, una nuova
    const l = state.items.filter((i) => isSpesa(i) && !i.done).sort((x, y) => (y.updated_at || "").localeCompare(x.updated_at || ""))[0];
    openEditor(l || newItem({ kind: "note", title: "Lista della spesa", lista_id: null }), !l);
    setTimeout(() => { const n = $("#stNew"); if (n) { n.focus(); n.scrollIntoView({ block: "center" }); } }, 300);
  } else if (a === "nuova-spesa") {
    if (!mod("spese")) { toast("Le spese sono spente: le accendi in Impostazioni"); return; }
    state.tab = "spese"; render(); apriSpesa(null);
  }
}

/* =========================================================
   LISTA DELLA SPESA INTELLIGENTE
   Si appoggia alle liste da spuntare (sottotask): funziona anche nelle liste condivise, nessun dato nuovo nel database.
   Una voce è "lista della spesa" se il titolo contiene una parola come "spesa" o "supermercato", oppure se la si segna
   con l'interruttore: il segno è il prefisso "sp-" negli id delle righe (invisibile, già accettato dal controllo del
   database, e chi ha l'app vecchia aperta vede e modifica la lista come sempre).
   ========================================================= */
const PAROLE_SPESA = ["spesa", "supermercato", "supermarket", "ipermercato", "compere", "alimentari", "da comprare", "cose da prendere", "lista spesa", "discount", "lidl", "conad", "coop", "esselunga", "carrefour", "eurospin"];
// Reparti nell'ordine del percorso tipico del supermercato, con le parole più comuni
const REPARTI = [
  ["frutta", "Frutta e verdura", "🥦", "mela pera banana arancia mandarino limone pesca albicocca ciliegia fragola uva kiwi ananas melone anguria mango avocado mirtilli prugna noci mandorle insalata lattuga rucola spinaci cavolo cavolfiore broccoli carota patata cipolla aglio pomodoro pomodorini zucchina melanzana peperone cetriolo sedano finocchio carciofi asparagi funghi zucca porro radicchio fagiolini basilico prezzemolo rosmarino zenzero verdura frutta"],
  ["pane", "Pane e dolci", "🥖", "pane panino baguette focaccia piadina grissini crackers fette-biscottate pancarre cornetti brioche croissant biscotti torta crostata merendine dolci cioccolato nutella marmellata miele cereali muesli"],
  ["latte", "Latticini e uova", "🥛", "latte yogurt burro panna formaggio mozzarella parmigiano grana pecorino ricotta mascarpone stracchino gorgonzola provola scamorza philadelphia uova"],
  ["carne", "Carne e pesce", "🍗", "carne pollo tacchino manzo vitello maiale macinato hamburger salsiccia wurstel prosciutto salame mortadella bresaola speck pancetta affettati pesce* salmone tonno merluzzo orata branzino gamberi cozze vongole calamari polpo alici"],
  ["dispensa", "Dispensa", "🥫", "pasta spaghetti penne fusilli rigatoni lasagne gnocchi riso farina zucchero sale pepe olio aceto passata pelati sugo pesto fagioli ceci lenticchie mais olive capperi brodo dado spezie origano lievito caffe the tisana camomilla cacao patatine ketchup maionese"],
  ["surgelati", "Surgelati", "🧊", "surgelati gelato ghiaccioli bastoncini sofficini pizza minestrone patatine-fritte"],
  ["bevande", "Bevande", "🧃", "acqua frizzante succo aranciata coca cola birra vino prosecco spumante bibite latte-soia latte-mandorla latte-avena"],
  ["casa", "Casa e pulizia", "🧽", "detersivo ammorbidente candeggina sgrassatore anticalcare spugne stracci scopa sacchetti spazzatura carta-cucina scottex tovaglioli piatti bicchieri pellicola alluminio carta-forno lampadine pile batterie pastiglie lavastoviglie"],
  ["igiene", "Igiene e cura", "🧴", "shampoo balsamo bagnoschiuma sapone dentifricio spazzolino collutorio deodorante carta-igienica fazzoletti assorbenti salviette cotone dischetti crema rasoio cerotti"],
  ["animali", "Animali", "🐾", "crocchette croccantini scatolette lettiera cibo-gatto cibo-cane biscotti-cane sabbietta"],
  ["altro", "Altro", "🧺", ""]
];
// "Latte", "latte ", "Mele"/"mela", "pomodori"/"pomodoro" -> stessa chiave (plurali semplici: si toglie la vocale finale)
const ECCEZIONI_STEM = { pesce: "pesce*", pesci: "pesce*", "pesce*": "pesce*" };
function stem(w) {
  if (ECCEZIONI_STEM[w]) return ECCEZIONI_STEM[w];
  if (w.length < 4) return w;
  let s = w.replace(/[aeiou]$/, "");
  if (/[cg]h$/.test(s)) s = s.slice(0, -1);
  return s;
}
const normSpesa = (t) => str(t).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9* ]+/g, " ").replace(/\s+/g, " ").trim();
const chiaveSpesa = (t) => normSpesa(t).split(" ").filter(Boolean).map(stem).join(" ");
const titoloSpesa = (t) => { const n = ` ${normSpesa(t)} `; return PAROLE_SPESA.some((p) => n.includes(` ${p} `)); };
const MARCA_SPESA = "sp-", MARCA_NO_SPESA = "ns-";
// La scelta "spento" dell'utente sta nello stesso posto della scelta "acceso": un prefisso negli id delle righe ("ns-", invisibile,
// valido per il controllo del database, quindi nessuna colonna nuova e vale anche nelle liste condivise e da ospite).
// Una lista senza righe non ha id dove scriverlo: in quel caso il "spento" resta solo su questo dispositivo (mochi.spesaOff).
const spesaOffLocale = () => { const a = LS.get("mochi.spesaOff", []); return Array.isArray(a) ? a.filter((x) => typeof x === "string" && x.length <= 64).slice(-200) : []; };
function ricordaSpesaOff(id, off) { if (!id) return; const s = new Set(spesaOffLocale()); if (off) s.add(id); else s.delete(id); LS.set("mochi.spesaOff", [...s].slice(-200)); }
// Scelta esplicita: "on", "off" oppure null (mai scelto: decide il titolo)
function sceltaSpesa(it) {
  const st = it?.sottotask || [];
  if (st.some((x) => x.id.startsWith(MARCA_SPESA))) return "on";
  if (st.some((x) => x.id.startsWith(MARCA_NO_SPESA))) return "off";
  if (!st.length && it?.id && spesaOffLocale().includes(it.id)) return "off";
  return null;
}
const isSpesa = (it) => { if (!it || it.kind === "event") return false; const c = sceltaSpesa(it); return c ? c === "on" : titoloSpesa(it.title); };
// Mette o toglie il segno "lista della spesa" negli id delle righe (sempre unici e validi)
// modo: "on" (sp-), "off" (ns-) oppure null (nessun segno)
function marcaSpesa(st, modo) {
  const visti = new Set(), pre = modo === "on" ? MARCA_SPESA : modo === "off" ? MARCA_NO_SPESA : "";
  return (st || []).map((x) => {
    const nudo = x.id.replace(/^((sp|ns)-)+/, ""); // anche i prefissi accumulati da un'app vecchia (sp-ns-...)
    let id = (pre + (nudo || nuovoStId())).slice(0, 40);
    if (!RE_STID.test(id) || visti.has(id)) id = pre + nuovoStId(visti);
    visti.add(id); return { ...x, id };
  });
}
// Dizionario: chiave della parola (o di due parole unite da "-") -> indice del reparto
const DIZ_REPARTI = (() => { const m = new Map(); REPARTI.forEach(([, , , parole], i) => parole.split(" ").filter(Boolean).forEach((p) => { const k = p.split("-").map(stem).join(" "); if (!m.has(k)) m.set(k, i); })); return m; })();
const PAROLINE = new Set(["di", "de", "del", "della", "dei", "delle", "per", "il", "lo", "la", "le", "i", "gli", "da", "al", "alla", "con", "e", "in", "un", "una"]);
function repartoDi(t) {
  const w = normSpesa(t).split(" ").filter((x) => x && !PAROLINE.has(x)).map(stem);
  for (let i = 0; i < w.length - 1; i++) { const k = DIZ_REPARTI.get(w[i] + " " + w[i + 1]); if (k != null) return k; } // prima le coppie ("carta igienica")
  for (const x of w) { const k = DIZ_REPARTI.get(x); if (k != null) return k; }
  return REPARTI.length - 1;
}
// Righe raggruppate per reparto, in ordine di percorso; le spuntate in fondo al loro reparto
function gruppiSpesa(st) {
  const g = REPARTI.map(() => []);
  (st || []).forEach((x) => g[repartoDi(x.t)].push(x));
  return g.map((v, i) => ({ i, voci: [...v.filter((x) => !x.f), ...v.filter((x) => x.f)] })).filter((x) => x.voci.length);
}
const raggruppaSpesa = (it) => isSpesa(it) && CUSTOM.spesa_reparti !== false;
// Le cose scritte in passato nelle liste della spesa (tutte le voci caricate, anche condivise): frequenza + recenza
let memoSugg = { items: null, n: -1, v: null };
function storicoSpesa() {
  if (memoSugg.items === state.items && memoSugg.n === state.items.length && memoSugg.v) return memoSugg.v;
  const m = new Map(), ora = Date.now();
  for (const it of state.items) {
    if (!isSpesa(it) || !it.sottotask?.length) continue;
    const quando = Date.parse(it.updated_at) || 0, fresco = ora - quando < 30 * 864e5 ? 1 : 0;
    for (const x of it.sottotask) {
      const k = chiaveSpesa(x.t); if (!k) continue;
      const e = m.get(k) || { k, t: x.t, n: 0, comprato: 0, ultima: 0, fresco: 0 };
      e.n++; if (x.f) e.comprato++; e.fresco += fresco;
      if (quando >= e.ultima) { e.ultima = quando; e.t = x.t; } // si mostra come è stata scritta l'ultima volta
      m.set(k, e);
    }
  }
  const v = [...m.values()].map((e) => ({ ...e, punti: e.n * 2 + e.comprato + e.fresco * 1.5 })).sort((a, b) => b.punti - a.punti || b.ultima - a.ultima);
  memoSugg = { items: state.items, n: state.items.length, v };
  return v;
}
function suggerisci(testo, giaNellaLista, quanti = 5) {
  const k = chiaveSpesa(testo); if (!k) return [];
  const gia = new Set(giaNellaLista.map((x) => chiaveSpesa(x.t)));
  return storicoSpesa().filter((e) => !gia.has(e.k) && e.k !== k && (e.k.startsWith(k) || normSpesa(e.t).startsWith(normSpesa(testo)))).slice(0, quanti);
}
const ricompri = (st, quanti = 8) => { const gia = new Set((st || []).map((x) => chiaveSpesa(x.t))); return storicoSpesa().filter((e) => e.comprato > 0 && !gia.has(e.k)).sort((a, b) => b.comprato - a.comprato || b.punti - a.punti).slice(0, quanti); };
const chipSugg = (e) => `<button class="sp-sugg" data-act="st-sugg" data-v="${esc(e.t)}">${esc(e.t)}</button>`;
function aggiornaSuggerimenti(v) {
  const box = $("#stSugg"); if (!box || !draft) return;
  const s = draft._spesa ? suggerisci(v, draft.sottotask) : [];
  box.innerHTML = s.length ? `<span class="sp-sugg-l">Forse:</span>${s.map(chipSugg).join("")}` : "";
}
// La card della bacheca e la riga aperta delle cose da fare: per reparto, se è una lista della spesa
function voceListaHtml(it, max = 0) {
  const st = it.sottotask || [];
  if (!raggruppaSpesa(it)) { const v = max ? st.slice(0, max) : st; return v.map((x) => stVoce(it, x)).join("") + (max && st.length > max ? `<small>e altre ${st.length - max}...</small>` : ""); }
  let n = 0, h = "";
  for (const g of gruppiSpesa(st)) {
    if (max && n >= max) break;
    h += `<span class="sp-rep">${REPARTI[g.i][2]} ${REPARTI[g.i][1]}</span>`;
    for (const x of g.voci) { if (max && n >= max) break; h += stVoce(it, x); n++; }
  }
  return h + (max && st.length > max ? `<small>e altre ${st.length - max}...</small>` : "");
}

/* =========================================================
   OSPITE (senza account) E PASSAGGIO ALL'ACCOUNT
   Come ospite l'app funziona come la modalità prova: tutto resta in questo dispositivo.
   Creando un account (o entrando in uno esistente) le cose dell'ospite si portano nell'account:
   si carica tutto con chiavi stabili (ripetere non crea doppioni, non si sovrascrive niente di quello che c'era)
   e SOLO alla fine, se è andato tutto bene, si svuota il dispositivo.
   ========================================================= */
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHIAVI_OSPITE = ["mochi.items", "mochi.umori", "mochi.turni", "mochi.spese", "mochi.giorniAttivi", "mochi.petRegistro", "mochi.ospite.custom"];
// Spiegazione prima di entrare come ospite (dalla schermata di accesso)
function apriOspite() {
  const passaggio = LS.get("mochi.ospite", null) === "passaggio";
  if (passaggio) { entraOspite(); return; }
  openSheet(`<h2><span class="mbox">${mascot()}</span>Prova senza account</h2>
    <p class="ospite-testo">Come ospite le tue cose restano solo su questo dispositivo. Se crei un account le ritrovi anche sul computer e sugli altri dispositivi, e non le perdi se cambi telefono.</p>
    <p class="ospite-testo piccolo">Puoi creare un account quando vuoi: le cose che hai scritto le porti con te. <a href="privacy.html" target="_blank" rel="noopener">Leggi l'informativa privacy</a></p>
    <div class="actions"><button class="btn" data-act="close">Annulla</button><button class="btn primary" data-act="ospite-entra">Entra come ospite</button></div>`);
}
function entraOspite() { LS.set("mochi.ospite", "si"); location.reload(); }
// Da ospite: "Crea account" o "Ho già un account". Le cose restano nel dispositivo finché non arrivano nell'account.
function vaiAdAccount(modo) {
  if (!OSPITE) return;
  lasciaOspite(); LS.set("mochi.ospite.modo", modo); LS.set("mochi.ospite.origine", "account"); // è l'ospite stesso che entra
  location.reload();
}
/* L'ospite lascia il dispositivo (per entrare in un account o con "Esci"): le sue cose restano in attesa e le sue
   preferenze (colori, mascotte, casetta con gli sblocchi) passano nella sua copia. Chi entra trova le preferenze pulite:
   arrivano in un account solo con il passaggio confermato. */
function lasciaOspite() {
  LS.set("mochi.ospite.custom", CUSTOM); LS.set("mochi.ospite", "passaggio");
  LS.set("mochi.custom", cleanCustom({ stile: CUSTOM.stile })); // resta solo lo stile della schermata di accesso
}
const invitoAccount = (testo) => `<div class="empty"><div class="mbox">${mascot()}</div><div>${esc(testo)}</div>
  <div class="actions ospite-azioni"><button class="btn primary" data-act="ospite-account" data-v="signup">Crea un account</button></div></div>`;
// Impostazioni: scheda in alto per l'ospite
const schedaOspite = () => `<div class="ospite-scheda"><b>Sei ospite</b><small>Le tue cose restano solo su questo dispositivo. Con un account le ritrovi ovunque e non le perdi se cambi telefono.</small>
  <div class="ospite-bottoni"><button class="fbtn" data-act="ospite-account" data-v="login">Ho già un account</button><button class="fbtn on" data-act="ospite-account" data-v="signup">Crea account</button></div></div>`;
// Oggi: un invito discreto, al massimo una volta ogni 7 giorni (si chiude con la X)
function invitoOspite() {
  if (!OSPITE || !state.items.length || Date.now() - LS.get("mochi.ospite.invito", 0) < 7 * 864e5) return "";
  return `<div class="ospite-invito"><span>Le tue cose sono solo su questo dispositivo. <button class="more" data-act="ospite-account" data-v="signup">Crea un account</button> per ritrovarle ovunque.</span>
    <button class="iconbtn ospite-x" data-act="ospite-invito-chiudi" aria-label="Chiudi l'invito">✕</button></div>`;
}
// Esci da ospite: le cose restano sul dispositivo (oppure si cancellano, chiedendo due volte)
function esciOspite() {
  const n = quanteCose(datiOspite());
  openSheet(`<h2><span class="mbox">${mascot()}</span>Uscire da ospite?</h2>
    <p class="ospite-testo">${n ? `Le ${n} cose che hai scritto restano su questo dispositivo: le ritrovi se rientri come ospite, oppure le porti in un account quando entri.` : "Tornerai alla schermata di accesso."}</p>
    ${n ? `<button class="more ospite-cancella" data-act="ospite-cancella">Cancella le mie cose da questo dispositivo ed esci</button>` : ""}
    <div class="actions"><button class="btn" data-act="close">Annulla</button><button class="btn primary" data-act="ospite-esci-ok">Esci</button></div>`);
}
async function cancellaOspite() {
  const ok = await ask({ title: "Cancellare tutto?", text: "Le cose che hai scritto come ospite spariranno per sempre da questo dispositivo.", ok: "Cancella ed esci", danger: true });
  if (!ok) { esciOspite(); return; }
  CHIAVI_OSPITE.forEach((k) => localStorage.removeItem(k)); localStorage.removeItem("mochi.ospite");
  location.reload();
}
// Le cose dell'ospite nel dispositivo, ripulite come all'avvio della modalità prova
function datiOspite() {
  const items = normalizeAll(LS.get("mochi.items", []));
  const u = LS.get("mochi.umori", {}), umori = {};
  if (u && typeof u === "object") for (const k in u) if (validYmd(k) && cleanUmore(u[k])) umori[k] = cleanUmore(u[k]);
  const t = LS.get("mochi.turni", {}) || {}, giorniT = {};
  for (const k in (t.giorni && typeof t.giorni === "object" ? t.giorni : {})) if (validYmd(k) && /^[a-z0-9]{0,8}$/.test(str(t.giorni[k]))) giorniT[k] = str(t.giorni[k]);
  const sp = LS.get("mochi.spese", {}) || {};
  const ga = LS.get("mochi.giorniAttivi", []);
  return { items, umori, turni: { imp: cleanTurniImp(t.imp), giorni: giorniT },
    spese: { voci: (Array.isArray(sp.voci) ? sp.voci : []).map(cleanSpesa).filter(Boolean).slice(0, 5000), budget: cleanBudget(sp.budget) },
    giorni: (Array.isArray(ga) ? ga : []).map(str).filter(giornoValido), pet: petDaLS("mochi.petRegistro") };
}
const quanteCose = (d) => d.items.length + Object.keys(d.umori).length + Object.keys(d.turni.giorni).length + d.spese.voci.length + (d.pet.length ? 1 : 0);
const haDatiOspite = (d) => quanteCose(d) > 0 || d.pet.length > 0 || d.giorni.length > 0 || d.turni.imp.tipi.length > 0 || !!d.spese.budget;
const plur = (n, a, b) => `${n} ${n === 1 ? a : b}`;
function elencoCose(d) {
  const v = d.items.filter((i) => i.kind !== "note").length, a = d.items.length - v, out = [];
  if (v) out.push(plur(v, "cosa da fare o appuntamento", "cose da fare e appuntamenti"));
  if (a) out.push(plur(a, "appunto", "appunti"));
  if (Object.keys(d.umori).length) out.push(plur(Object.keys(d.umori).length, "giornata colorata", "giornate colorate"));
  if (Object.keys(d.turni.giorni).length) out.push(plur(Object.keys(d.turni.giorni).length, "turno", "turni"));
  if (d.spese.voci.length) out.push(plur(d.spese.voci.length, "spesa", "spese"));
  if (d.pet.length) out.push("routine e pesi del tuo pet");
  return out;
}
// Impostazioni (con account): le cose dell'ospite ancora da portare
function rigaPassaggio() {
  if (LS.get("mochi.ospite", null) !== "passaggio" || nonMieDaMe()) return "";
  const n = quanteCose(datiOspite());
  return n ? `<div class="ospite-scheda"><b>Cose da portare nell'account</b><small>Su questo dispositivo ${n === 1 ? "c'è 1 cosa scritta" : `ci sono ${n} cose scritte`} come ospite. Se sono tue, puoi portarle nel tuo account.</small>
    <div class="ospite-bottoni"><button class="fbtn" data-act="passaggio-non-mie">Non sono mie</button><button class="fbtn on" data-act="passaggio-proponi">Portale qui</button></div></div>` : "";
}
/* Telefono condiviso: chi entra potrebbe non essere l'ospite. Le scelte valgono per QUESTO account (id):
   "Più tardi" = non chiedo per 7 giorni; "Non sono mie, lasciale" = non chiedo più a questo account
   (un altro account che entra se le vede proporre: potrebbe essere proprio la persona che le ha scritte). */
const chiaveRimando = () => "mochi.ospite.dopo." + (store.user?.id || "");
const nonMieDaMe = () => { const a = LS.get("mochi.ospite.non_mie", []); return Array.isArray(a) && a.includes(store.user?.id); };
const rimandaPassaggio = () => LS.set(chiaveRimando(), Date.now());
function nonSonoMie() {
  const n = quanteCose(datiOspite());
  openSheet(`<h2><span class="mbox">${mascot()}</span>Non sono tue?</h2>
    <p class="ospite-testo">Nessun problema: non le porto nel tuo account. Cosa faccio con ${n === 1 ? "la cosa scritta" : `le ${n} cose scritte`} come ospite su questo dispositivo?</p>
    <button class="more ospite-cancella" data-act="passaggio-cancella">Cancellale da questo dispositivo</button>
    <div class="actions"><button class="btn" data-act="close">Annulla</button><button class="btn primary" data-act="passaggio-lascia">Lasciale qui</button></div>`);
}
function lasciaSulDispositivo() {
  const a = LS.get("mochi.ospite.non_mie", []), id = store.user?.id;
  if (id) LS.set("mochi.ospite.non_mie", [...new Set([...(Array.isArray(a) ? a : []), id])].slice(-20));
  closeSheet(); toast("Restano su questo dispositivo: non te lo chiedo più");
}
async function cancellaCoseOspite() {
  const ok = await ask({ title: "Cancellarle dal dispositivo?", text: "Le cose scritte come ospite spariranno per sempre da questo dispositivo. Il tuo account non cambia.", ok: "Cancella", danger: true });
  if (!ok) { nonSonoMie(); return; }
  finePassaggio(); toast("Cancellate dal dispositivo");
}
// Dopo l'accesso: proposta di portare le cose dell'ospite
async function proponiPassaggio(subito = false) {
  if (!ONLINE_MODE || !store.user || LS.get("mochi.ospite", null) !== "passaggio") return;
  const d = datiOspite();
  // senza cose scritte: le preferenze dell'ospite vanno solo a un account nuovo, che non ne ha di sue
  // senza cose scritte: le preferenze dell'ospite si portano da sole SOLO se è l'ospite stesso a entrare
  // (da "Crea account" / "Ho già un account") in un account che non ne ha; dopo "Esci" non si applicano mai a chi entra
  if (!haDatiOspite(d)) { if (LS.get("mochi.ospite.origine", "") === "account" && !accountHaPreferenze()) { try { await portaPreferenze(); finePassaggio(); } catch {} } else finePassaggio(); return; }
  if (!subito && (nonMieDaMe() || Date.now() - LS.get(chiaveRimando(), 0) < 7 * 864e5)) return;
  const n = quanteCose(d), giaPieno = state.items.length > 0 || state.spese.voci.length > 0 || Object.keys(state.umori).length > 0;
  const apri = () => { rimandaPassaggio(); openSheet(`<h2><span class="mbox">${mascot()}</span>Cose scritte come ospite</h2>
    <p class="ospite-testo"><b>Su questo dispositivo ${n === 1 ? "c'è 1 cosa scritta" : `ci sono ${n} cose scritte`} come ospite. Sono tue?</b></p>
    ${elencoCose(d).length ? `<ul class="ospite-elenco">${elencoCose(d).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    <p class="ospite-testo piccolo">${giaPieno ? "Nell'account ci sono già delle cose: le unisco, non cancello e non sostituisco niente. " : ""}Porto qui anche colori, stile, mascotte e casetta. Finché non è tutto nell'account, sul dispositivo non tocco niente.</p>
    <button class="more" data-act="passaggio-non-mie">Non sono mie</button>
    <div class="actions"><button class="btn" data-act="passaggio-tardi">Più tardi</button><button class="btn primary" data-act="passaggio-via">Sì, portale nel mio account</button></div>`); };
  if (subito) apri(); else setTimeout(() => whenSheetFree(apri), 900);
}
// Id stabili per voci e spese (servono uuid): se ne manca uno lo creo e lo SALVO nel dispositivo prima di caricare,
// così un nuovo tentativo usa gli stessi id e il database riconosce quello che ha già (niente doppioni)
function idStabili() {
  const it = LS.get("mochi.items", []);
  if (Array.isArray(it) && it.some((x) => x && typeof x === "object" && !RE_UUID.test(String(x.id)))) LS.set("mochi.items", it.map((x) => (x && typeof x === "object" && !RE_UUID.test(String(x.id)) ? { ...x, id: crypto.randomUUID() } : x)));
  const sp = LS.get("mochi.spese", {});
  if (sp && Array.isArray(sp.voci) && sp.voci.some((x) => x && !RE_UUID.test(String(x.id)))) LS.set("mochi.spese", { ...sp, voci: sp.voci.map((x) => (x && typeof x === "object" && !RE_UUID.test(String(x.id)) ? { ...x, id: crypto.randomUUID() } : x)) });
}
const aBlocchi = async (righe, n, fn) => { for (let i = 0; i < righe.length; i += n) await fn(righe.slice(i, i + n)); };
const giu = (r) => { if (r.error) throw r.error; return r; };
// Preferenze: se l'account non ne ha, prende quelle dell'ospite; altrimenti restano quelle dell'account
// (gli sblocchi della casetta si uniscono sempre: non si perdono mai)
const accountHaPreferenze = () => { const md = store.user?.user_metadata || {}; return ["nome_app", "mascotte", "accessorio", "colore", "font", "stile", "moduli", "stagione", "suono", "casa", "compleanno", "ricordi", "fiori"].some((k) => md[k] != null) || cleanPronomi(md.pronomi) !== "" || petPresente(cleanPet(md.pet)); };
async function portaPreferenze() {
  const copia = LS.get("mochi.ospite.custom", null); if (!copia) return; // solo la copia dell'ospite, mai le preferenze di chi è entrato
  const ospite = cleanCustom(copia);
  CUSTOM = cleanCustom(accountHaPreferenze() ? { ...CUSTOM, casa: unisciCasa(CUSTOM.casa, ospite.casa), ricordi: unisciRicordi(CUSTOM.ricordi, ospite.ricordi), fiori: store.user?.user_metadata?.fiori != null ? CUSTOM.fiori : ospite.fiori, pronomi: cleanPronomi(store.user?.user_metadata?.pronomi) !== "" ? CUSTOM.pronomi : ospite.pronomi, pet: petPresente(cleanPet(store.user?.user_metadata?.pet)) ? CUSTOM.pet : ospite.pet } : { ...ospite });
  LS.set("mochi.custom", CUSTOM); applyCustom();
  await store.saveCustom(CUSTOM); // se non riesce, l'errore ferma il passaggio: la copia resta e si può riprovare
}
function finePassaggio() { CHIAVI_OSPITE.forEach((k) => localStorage.removeItem(k)); ["mochi.ospite", "mochi.ospite.non_mie", "mochi.ospite.origine"].forEach((k) => localStorage.removeItem(k)); }
let passaggioInCorso = false;
async function eseguiPassaggio(btn) {
  if (passaggioInCorso || !ONLINE_MODE || !store.user) return;
  passaggioInCorso = true; localStorage.removeItem(chiaveRimando()); if (btn) { btn.disabled = true; btn.textContent = "Porto le tue cose..."; }
  const sb = store.sb, me = store.user.id;
  try {
    idStabili();
    const d = datiOspite(), giaPieno = state.items.length > 0 || state.spese.voci.length > 0;
    // 1) voci (cose da fare, appuntamenti, appunti con sottotask e posizione); quelle già presenti si lasciano come sono
    const righe = d.items.map((it) => ({ ...store.clean({ ...it, lista_id: null }) }));
    await aBlocchi(righe, 200, async (b) => {
      let r = await sb.from("items").upsert(b, { onConflict: "id", ignoreDuplicates: true });
      if (r.error && store.manca(r.error)) r = await sb.from("items").upsert(b.map(({ sottotask, ...x }) => x), { onConflict: "id", ignoreDuplicates: true });
      giu(r);
    });
    // 2) com'è andata la giornata (se un giorno c'è già nell'account, resta quello)
    const um = Object.entries(d.umori).map(([giorno, u]) => ({ user_id: me, giorno, livello: u.livello, nota: u.nota || null }));
    await aBlocchi(um, 500, async (b) => giu(await sb.from("umori").upsert(b, { onConflict: "user_id,giorno", ignoreDuplicates: true })));
    // 3) turni: i tipi si uniscono (per codice), il ciclo resta quello dell'account se c'è; i giorni già segnati restano
    if (d.turni.imp.tipi.length || Object.keys(d.turni.giorni).length) {
      const a = giu(await sb.from("turni_impostazioni").select("tipi,ciclo,ciclo_inizio").maybeSingle()).data;
      const acc = cleanTurniImp(a || {}), tipi = [...acc.tipi];
      d.turni.imp.tipi.forEach((t) => { if (tipi.length < 12 && !tipi.some((x) => x.k === t.k)) tipi.push(t); });
      const imp = acc.ciclo.length ? { ...acc, tipi } : { tipi, ciclo: d.turni.imp.ciclo, ciclo_inizio: d.turni.imp.ciclo_inizio };
      giu(await sb.from("turni_impostazioni").upsert({ user_id: me, tipi: imp.tipi, ciclo: imp.ciclo, ciclo_inizio: imp.ciclo_inizio }, { onConflict: "user_id" }));
      const tg = Object.entries(d.turni.giorni).map(([giorno, tipo]) => ({ user_id: me, giorno, tipo }));
      await aBlocchi(tg, 500, async (b) => giu(await sb.from("turni").upsert(b, { onConflict: "user_id,giorno", ignoreDuplicates: true })));
    }
    // 4) spese (con il loro id: ripetere non le raddoppia) e budget, se l'account non ne ha uno
    const spr = d.spese.voci.map((v) => ({ id: v.id, giorno: v.giorno, importo_cent: v.importo_cent, categoria: v.categoria, nota: v.nota || null }));
    await aBlocchi(spr, 200, async (b) => giu(await sb.from("spese").upsert(b, { onConflict: "id", ignoreDuplicates: true })));
    if (d.spese.budget) {
      const b = giu(await sb.from("spese_impostazioni").select("budget_cent").maybeSingle()).data;
      if (!b?.budget_cent) giu(await sb.from("spese_impostazioni").upsert({ user_id: me, budget_cent: d.spese.budget }, { onConflict: "user_id" }));
    }
    // 5) giorni attivi della serie
    if (d.giorni.length) await GiorniStore.aggiungi(d.giorni);
    // 5b) routine e pesi del pet (quelli già nell'account restano come sono)
    if (d.pet.length) await portaPetOspite(d.pet);
    // 6) preferenze (colori, stile, mascotte, moduli, casetta)
    await portaPreferenze();
    // tutto arrivato: solo adesso si svuota il dispositivo
    finePassaggio();
    closeSheet(); await loadAndRender();
    const n = quanteCose(d);
    openSheet(`<div class="recap"><div class="mbox">${mascot("happy")}</div><h2 class="fred">Fatto!</h2>
      <div class="say">Ho portato nell'account ${plur(n, "cosa", "cose")}${giaPieno ? ", insieme a quelle che c'erano già" : ""}. Ora le ritrovi su tutti i tuoi dispositivi 💗</div></div>
      <div class="actions"><button class="btn primary" data-act="close">Che bello!</button></div>`);
    confetti(innerWidth / 2, innerHeight * .35, 30); cheer(1800);
  } catch (e) {
    console.warn("Passaggio da ospite non riuscito", e);
    const msg = /limite/i.test(e?.message || "") ? "Nell'account c'è il limite di voci raggiunto." : /fetch|network|Failed/i.test(e?.message || "") ? "La connessione si è interrotta." : "Qualcosa non è andato.";
    openSheet(`<h2><span class="mbox">${mascot()}</span>Non sono riuscita a portare tutto</h2>
      <p class="ospite-testo">${esc(msg)} Le tue cose sono al sicuro su questo dispositivo: non ho cancellato niente. Riprova tra poco: quello che è già arrivato non verrà doppiato.</p>
      <div class="actions"><button class="btn" data-act="close">Più tardi</button><button class="btn primary" data-act="passaggio-via">Riprova</button></div>`);
  } finally { passaggioInCorso = false; }
}

/* =========================================================
   IL MIO PET
   La scheda (CUSTOM.pet) viaggia con le preferenze. Spunte della routine e pesi stanno nella tabella pet_registro
   (una riga per voce e giorno, una per peso e giorno), con la stessa coda "da inviare" dei giorni attivi:
   una riga rifiutata dal server si scarta, le altre arrivano; senza rete si riprova; uscendo la coda non inviata resta.
   Da ospite (o in modalità prova) tutto sta nel dispositivo e passa nell'account col passaggio da ospite.
   ========================================================= */
const PET_MAX_RIGHE = 5000;
const petSp = (id) => PET_SPECIE.find((s) => s[0] === id) || PET_SPECIE[PET_SPECIE.length - 1];
const petIcona = (id) => `<span class="emo">${petSp(id)[2]}</span><svg class="ico q" aria-hidden="true"><use href="#i-pet-${petSp(id)[0]}"/></svg>`;
const petTitolo = () => (CUSTOM.pet.nome ? "Il mio " + CUSTOM.pet.nome : "Il mio pet");
const petMinGiorno = () => ymd(addDays(new Date(), -1800));
const petGiornoOk = (g) => validYmd(g) && g >= petMinGiorno() && g <= todayStr();
const petRound2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const petK = (r) => `${r.tipo}|${r.giorno}|${r.chiave}`;
// Una riga del registro, ripulita (arriva anche dal dispositivo e dal server: mai fidarsi). Non valida = null
function petPulisciRiga(r) {
  if (!r || typeof r !== "object") return null;
  const tipo = str(r.tipo), giorno = str(r.giorno).slice(0, 10), chiave = str(r.chiave);
  if (!petGiornoOk(giorno)) return null;
  if (tipo === "routine") return PET_RE_ID.test(chiave) ? { tipo, giorno, chiave, valore: 1 } : null;
  if (tipo === "peso") {
    const v = typeof r.valore === "number" ? r.valore : /^\d{1,6}(\.\d{1,6})?$/.test(str(r.valore)) ? parseFloat(r.valore) : NaN;
    if (chiave !== "kg" || !Number.isFinite(v)) return null;
    const kg = petRound2(v);
    return kg >= 0.01 && kg <= 999.99 ? { tipo, giorno, chiave: "kg", valore: kg } : null;
  }
  return null;
}
const petUnici = (righe) => [...new Map(righe.map((r) => [petK(r), r])).values()];
function petPulisciOp(o) {
  if (!o || typeof o !== "object") return null;
  const a = o.a === "set" ? "set" : o.a === "del" ? "del" : null; if (!a) return null;
  const r = petPulisciRiga({ tipo: o.tipo, giorno: o.giorno, chiave: o.chiave, valore: a === "del" ? 1 : o.valore });
  return r ? { a, ...r } : null;
}
const petApplica = (righe, o) => { const f = righe.filter((r) => petK(r) !== petK(o)); if (o.a === "set") f.push({ tipo: o.tipo, giorno: o.giorno, chiave: o.chiave, valore: o.valore }); return f; };
const petCoda = () => { const q = LS.get(chiaveGiorni("petDaInviare"), []); return (Array.isArray(q) ? q : []).map(petPulisciOp).filter(Boolean).slice(-2000); };
const petDaLS = (k) => { const a = LS.get(k, []); return petUnici((Array.isArray(a) ? a : []).slice(0, PET_MAX_RIGHE * 2).map(petPulisciRiga).filter(Boolean)).slice(0, PET_MAX_RIGHE); };
function petSalvaLocale() {
  if (ONLINE_MODE) LS.set(chiaveGiorni("petCache"), state.pet.righe); else LS.set("mochi.petRegistro", state.pet.righe);
}
// Subito, senza rete: quello che il dispositivo conosce (online: ultima copia + cose ancora da inviare)
function petDaCache() {
  let righe = petDaLS(ONLINE_MODE ? chiaveGiorni("petCache") : "mochi.petRegistro");
  if (ONLINE_MODE) for (const o of petCoda()) righe = petApplica(righe, o);
  state.pet.righe = righe;
}
let petVer = 0, invioPet = Promise.resolve();
// Il server ha rifiutato proprio quella riga (valore o giorno fuori dai limiti, tetto): si scarta. Tutto il resto (rete, sessione) si riprova
const petRifiutata = (e) => /^(22|23|P0|42501)/.test(String(e?.code || "")) || /violates|fuori dai limiti|limite/i.test(String(e?.message || ""));
function inviaPet() {
  if (!ONLINE_MODE || !store.user) return invioPet;
  invioPet = invioPet.then(async () => {
    const k = chiaveGiorni("petDaInviare"), coda = petCoda(); if (!coda.length) return;
    const me = store.user.id, sb = store.sb;
    const manda = async (ops) => {
      const sets = ops.filter((o) => o.a === "set").map((o) => ({ user_id: me, tipo: o.tipo, giorno: o.giorno, chiave: o.chiave, valore: o.valore }));
      for (let i = 0; i < sets.length; i += 200) { const { error } = await sb.from("pet_registro").upsert(sets.slice(i, i + 200), { onConflict: "user_id,tipo,giorno,chiave" }); if (error) throw error; }
      for (const o of ops.filter((x) => x.a === "del")) { const { error } = await sb.from("pet_registro").delete().eq("tipo", o.tipo).eq("giorno", o.giorno).eq("chiave", o.chiave); if (error) throw error; }
    };
    const fatte = [];
    try { await manda(coda); fatte.push(...coda); }
    catch (e) {
      if (erroreDiRete(e)) return; // senza rete: si tiene tutto e si riprova
      // il lotto non è passato: una riga alla volta, così le buone arrivano e quella cattiva non blocca la coda
      for (const o of coda) {
        try { await manda([o]); fatte.push(o); }
        catch (e2) { if (erroreDiRete(e2)) break; if (petRifiutata(e2)) { console.warn("Riga del pet rifiutata dal server, scartata:", o.tipo, o.giorno, e2?.message || e2); fatte.push(o); } }
      }
    }
    const chiave = (o) => JSON.stringify([o.a, o.tipo, o.giorno, o.chiave, o.valore]), inviate = new Set(fatte.map(chiave));
    LS.set(k, petCoda().filter((o) => !inviate.has(chiave(o)))); // quello aggiunto nel frattempo resta in coda
  }).catch(() => {});
  return invioPet;
}
// Imposta o toglie una riga: subito sullo schermo e nel dispositivo, poi (con account) in coda verso il server
function petImposta(op) {
  const o = petPulisciOp(op); if (!o) return false;
  petVer++;
  state.pet.righe = petApplica(state.pet.righe, o);
  if (!ONLINE_MODE) {
    if (state.pet.righe.length > PET_MAX_RIGHE) state.pet.righe = [...state.pet.righe].sort((a, b) => (a.tipo === "peso") - (b.tipo === "peso") || (a.giorno < b.giorno ? 1 : -1)).slice(0, PET_MAX_RIGHE);
    petSalvaLocale(); return true;
  }
  LS.set(chiaveGiorni("petDaInviare"), [...petCoda().filter((x) => petK(x) !== petK(o)), o].slice(-2000));
  petSalvaLocale(); inviaPet(); return true;
}
// Dal server: le spunte di oggi e gli ultimi 10 pesi. Restituisce true se è cambiato qualcosa
async function caricaPet() {
  if (!ONLINE_MODE) { const prima = JSON.stringify(state.pet.righe); petDaCache(); return prima !== JSON.stringify(state.pet.righe); }
  if (!store.user) return false;
  await inviaPet(); // prima si manda quello che è rimasto in coda
  if (!mod("pet")) return false;
  const ver = petVer;
  try {
    const q = () => store.sb.from("pet_registro").select("tipo,giorno,chiave,valore");
    const [a, b] = await Promise.all([q().eq("tipo", "routine").eq("giorno", todayStr()), q().eq("tipo", "peso").order("giorno", { ascending: false }).limit(10)]);
    if (a.error || b.error) return false;
    if (ver !== petVer) return false; // nel frattempo hai toccato qualcosa: vale quello
    let righe = petUnici([...(a.data || []), ...(b.data || [])].map(petPulisciRiga).filter(Boolean));
    for (const o of petCoda()) righe = petApplica(righe, o);
    const cambiato = JSON.stringify(righe) !== JSON.stringify(state.pet.righe);
    state.pet.righe = righe; petSalvaLocale();
    return cambiato;
  } catch { return false; }
}
// Tutte le righe, per il backup (a pagine da 1000); senza rete resta quello che c'è sul dispositivo
async function petTutteLeRighe() {
  if (!ONLINE_MODE || !store.user) return petUnici(state.pet.righe);
  try {
    const out = [];
    for (let da = 0; da < PET_MAX_RIGHE + 1000; da += 1000) {
      const { data, error } = await store.sb.from("pet_registro").select("tipo,giorno,chiave,valore").order("giorno").range(da, da + 999);
      if (error) throw error;
      (data || []).forEach((r) => out.push(r));
      if (!data || data.length < 1000) break;
    }
    let righe = petUnici(out.map(petPulisciRiga).filter(Boolean));
    for (const o of petCoda()) righe = petApplica(righe, o);
    return righe;
  } catch { return petUnici(state.pet.righe); }
}
// Passaggio da ospite: le righe nel dispositivo vanno nell'account; quelle già presenti restano come sono
async function portaPetOspite(righe) {
  const me = store.user.id;
  await aBlocchi(righe.map((r) => ({ user_id: me, ...r })), 200, async (b) => giu(await store.sb.from("pet_registro").upsert(b, { onConflict: "user_id,tipo,giorno,chiave", ignoreDuplicates: true })));
}
// Tolgo il pet: via anche spunte e pesi (prima dal server; se non si riesce non si cancella niente)
async function petCancellaRegistro() {
  if (ONLINE_MODE && store.user) {
    const uid_ = myId(); if (!uid_) throw new Error("utente non trovato");
    const { error } = await store.sb.from("pet_registro").delete().eq("user_id", uid_).in("tipo", ["routine", "peso"]);
    if (error) throw error;
    LS.set(chiaveGiorni("petDaInviare"), []);
  }
  petVer++; state.pet.righe = []; petSalvaLocale();
}

const petVoci = () => { const p = CUSTOM.pet; return p.routine ? p.routine : (PET_ROUTINE_DEF[p.specie || "altro"] || PET_ROUTINE_DEF.altro).map(([id, t]) => ({ id, t })); };
const petFatte = (g) => new Set(state.pet.righe.filter((r) => r.tipo === "routine" && r.giorno === g).map((r) => r.chiave));
const petPesi = () => state.pet.righe.filter((r) => r.tipo === "peso").map((r) => ({ giorno: r.giorno, kg: r.valore })).sort((a, b) => (a.giorno < b.giorno ? -1 : 1)).slice(-10);
const fmtKg = (k) => (+k).toLocaleString("it-IT", { maximumFractionDigits: 2 });
const petNuovoId = (usati) => { let id; do { id = ("v" + Math.random().toString(36).slice(2, 10) + "00000000").slice(0, 9); } while (usati.includes(id) || !PET_RE_ID.test(id)); return id; };
// "12,5" o "12.5", da 0,01 a 999,99 kg; più di due decimali si arrotondano
function petParseKg(s) {
  const t = str(s).trim();
  if (!/^\d{1,6}([.,]\d{1,6})?$/.test(t)) return null;
  const k = petRound2(parseFloat(t.replace(",", ".")));
  return Number.isFinite(k) && k >= 0.01 && k <= 999.99 ? k : null;
}
function petDataTesto(p) {
  if (!p.dt) return "";
  const parti = [p.g || "", p.m ? MESI[p.m - 1] : "", p.a || ""].filter(Boolean).join(" ");
  let t = (p.dt === "n" ? "Compleanno: " : "Arrivo: ") + parti;
  if (p.a) {
    const d = new Date(); let anni = d.getFullYear() - p.a;
    if (p.m && (d.getMonth() + 1 < p.m || (d.getMonth() + 1 === p.m && p.g && d.getDate() < p.g))) anni--;
    if (anni >= 1) t += ` (${anni} ${anni === 1 ? "anno" : "anni"})`;
  }
  return t;
}
function petCompleannoOggi(p) {
  if (p.dt !== "n" || !p.g || !p.m) return false;
  const d = new Date(); let g = p.g;
  if (p.m === 2 && g === 29 && !bisestile(d.getFullYear())) g = 28;
  return d.getMonth() + 1 === p.m && d.getDate() === g;
}
function petGrafico(pesi) {
  const W = 300, H = 112, px = 22, py = 22, n = pesi.length, ks = pesi.map((x) => x.kg), mn = Math.min(...ks), mx = Math.max(...ks);
  const X = (i) => (n === 1 ? W / 2 : px + ((W - 2 * px) * i) / (n - 1)), Y = (k) => (mx === mn ? H / 2 : H - py - ((k - mn) / (mx - mn)) * (H - 2 * py));
  const pts = pesi.map((x, i) => `${X(i).toFixed(1)},${Y(x.kg).toFixed(1)}`);
  return `<svg class="pet-graf" viewBox="0 0 ${W} ${H}" role="img" aria-label="Andamento del peso: ${n === 1 ? `${fmtKg(ks[0])} kg` : `da ${fmtKg(ks[0])} a ${fmtKg(ks[n - 1])} kg`}, ${plur(n, "misurazione", "misurazioni")}">
    ${n > 1 ? `<polyline class="pet-linea" points="${pts.join(" ")}"/>` : ""}
    ${pesi.map((x, i) => `<circle class="pet-pt" cx="${X(i).toFixed(1)}" cy="${Y(x.kg).toFixed(1)}" r="4"/>`).join("")}
    <text x="${X(0).toFixed(1)}" y="${(Y(ks[0]) - 9).toFixed(1)}" text-anchor="${n === 1 ? "middle" : "start"}">${fmtKg(ks[0])}</text>
    ${n > 1 ? `<text x="${X(n - 1).toFixed(1)}" y="${(Y(ks[n - 1]) - 9).toFixed(1)}" text-anchor="end">${fmtKg(ks[n - 1])}</text>` : ""}</svg>`;
}
// ---- Scadenze del pet: sono cose da fare normali (con data e promemoria) che iniziano con un marcatore invisibile nelle note.
// Marcatore: U+2063 (separatore invisibile) + "pet:tipo:ripetizione:giornoAncora" + U+2063. Nel titolo non c'è niente di speciale (è l'unico testo che arriva nelle notifiche push),
// le note sono libere nel database (nessuna colonna nuova), l'editor lo nasconde e lo rimette. Mai in una lista condivisa (lista_id vuoto).
const PET_SCAD_TIPI = [["vaccino", "Vaccino"], ["antiparassitario", "Antiparassitario"], ["visita", "Visita"], ["farmaco", "Farmaco"], ["toelettatura", "Toelettatura"], ["peso", "Controllo peso"], ["altro", "Altro"]];
const PET_REP = [["-", "Non si ripete"], ["m1", "Ogni mese"], ["m3", "Ogni 3 mesi"], ["m6", "Ogni 6 mesi"], ["m12", "Ogni anno"], ["d", "Ogni tot giorni"]];
const PET_MARCA_RE = /^⁣pet:([a-z]{3,16}):(-|m1|m3|m6|m12|d[0-9]{1,3}):([0-9]{1,2})⁣/;
const petMarcaTesto = (m) => `⁣pet:${m.tipo}:${m.rep}:${m.anchor}⁣`;
function petMarca(it) {
  if (!it || it.kind !== "todo" || it.lista_id || typeof it.body !== "string" || it.body.charCodeAt(0) !== 0x2063) return null;
  const m = PET_MARCA_RE.exec(it.body); if (!m || !PET_SCAD_TIPI.some((t) => t[0] === m[1])) return null;
  if (m[2][0] === "d" && !(+m[2].slice(1) >= 1 && +m[2].slice(1) <= 365)) return null;
  return { tipo: m[1], rep: m[2], anchor: +m[3] >= 1 && +m[3] <= 31 ? +m[3] : 0, resto: it.body.slice(m[0].length) };
}
const petRepTesto = (rep) => rep === "-" ? "" : rep[0] === "d" ? `Ogni ${+rep.slice(1) === 1 ? "giorno" : rep.slice(1) + " giorni"}` : PET_REP.find((r) => r[0] === rep)?.[1] || "";
// La prossima data: mesi (ancorati al giorno scelto: 31 gen + 1 mese = 28/29 feb, poi di nuovo il 31) o giorni; sempre dopo oggi
function petProssima(due, rep, anchor, oggi = todayStr()) {
  if (!validYmd(due) || !/^(m(1|3|6|12)|d[0-9]{1,3})$/.test(rep)) return null;
  const n = +rep.slice(1); if (!(n >= 1)) return null;
  let out;
  if (rep[0] === "d") { out = ymd(addDays(parseYmd(due), n)); if (out <= oggi) out = ymd(addDays(parseYmd(oggi), n)); }
  else if (rep[0] === "m") {
    const [y, m] = due.split("-").map(Number), g = anchor >= 1 ? anchor : +due.slice(8, 10);
    for (let k = n; k <= 1200; k += n) {
      const t = y * 12 + (m - 1) + k, yy = Math.floor(t / 12), mm = t % 12, dim = new Date(yy, mm + 1, 0).getDate();
      out = `${yy}-${pad(mm + 1)}-${pad(Math.min(g, dim))}`;
      if (out > oggi) break;
    }
  } else return null;
  return validYmd(out) && out <= "2100-12-31" ? out : null;
}
const petScadenze = () => state.items.filter((i) => !i.done && petMarca(i)).sort((a, b) => ((a.due_date || "9") + a.title < (b.due_date || "9") + b.title ? -1 : 1));
function petScTitolo(tipo, det = "") {
  const t = PET_SCAD_TIPI.find((x) => x[0] === tipo)?.[1] || "Scadenza", nome = CUSTOM.pet.nome, d = taglia(det.trim(), 60);
  if (tipo === "altro") return d ? (nome ? `${d} (${nome})` : d) : (nome ? `Scadenza di ${nome}` : "Scadenza del pet");
  return `${t}${nome ? " di " + nome : ""}${d ? ": " + d : ""}`;
}
function petScStato(it) {
  const oggi = todayStr(); if (!it.due_date) return { late: false, testo: "Senza data" };
  const diff = Math.round((parseYmd(oggi) - parseYmd(it.due_date)) / 864e5);
  if (diff > 0) return { late: true, testo: `In ritardo di ${plur(diff, "giorno", "giorni")} (${niceDate(it.due_date)})` };
  return { late: false, testo: niceDate(it.due_date) };
}
function petScadHtml() {
  const lista = petScadenze(), mostra = lista.slice(0, 10);
  return `<div class="sec"><h2>Prossime scadenze</h2><button class="fbtn on" data-act="pet-scad-new">Aggiungi</button></div>
    ${mostra.length ? `<div class="list pet-scads">${mostra.map((it) => { const s = petScStato(it), m = petMarca(it), r = petRepTesto(m.rep);
      return `<div class="pet-scad ${s.late ? "late" : ""}"><button class="check" data-act="pet-scad-fatta" data-id="${esc(it.id)}" aria-label="Segna come fatto: ${esc(it.title)}"></button>
        <button class="pet-scad-b" data-act="pet-scad-edit" data-id="${esc(it.id)}" aria-label="Modifica: ${esc(it.title)}"><b>${esc(it.title)}</b><small class="${s.late ? "pet-ritardo" : ""}">${s.late ? "⚠ " : ""}${esc(s.testo)}${r ? " · " + esc(r) : ""}</small></button></div>`; }).join("")}</div>
      ${lista.length > mostra.length ? `<p class="small">Altre ${lista.length - mostra.length} le trovi in Da fare e Agenda.</p>` : ""}`
      : `<p class="small">Nessuna scadenza. Vaccini, antiparassitari, visite: te le ricordo io.</p>`}`;
}
let petScDraft = null;
function apriPetScad(id) {
  const it = id ? state.items.find((x) => x.id === id) : null, m = it && petMarca(it);
  if (id && !m) return;
  const dd = it ? it.due_date || todayStr() : todayStr();
  petScDraft = { id: it ? it.id : null, tipo: m ? m.tipo : "vaccino" };
  const rep = m ? (m.rep[0] === "d" ? "d" : m.rep) : "-", n = m && m.rep[0] === "d" ? +m.rep.slice(1) : 30;
  const rem = it ? (["none", "morning", "1440"].includes(it.remind) ? it.remind : "morning") : "morning";
  openSheet(`<h2><span class="mbox">${mascot()}</span>${it ? "Modifica la scadenza" : "Nuova scadenza"}</h2>
    <div class="field"><label id="psTL">Di che cosa si tratta?</label><div class="pet-dt" id="psTipi" role="group" aria-labelledby="psTL">${PET_SCAD_TIPI.map(([k, n2]) => `<button type="button" class="fbtn ${petScDraft.tipo === k ? "on" : ""}" data-act="pet-s-tipo" data-v="${k}" aria-pressed="${petScDraft.tipo === k}">${n2}</button>`).join("")}</div></div>
    <div class="field"><label for="psTit">Titolo</label><input class="input" id="psTit" maxlength="100" autocomplete="off" value="${esc(it ? it.title : petScTitolo(petScDraft.tipo))}"></div>
    <div class="field"><label for="psData">Data</label><input class="input" type="date" id="psData" value="${dd}" min="2000-01-01" max="2100-12-31"></div>
    <div class="field"><label for="psRep">Si ripete?</label><select class="input" id="psRep">${PET_REP.map(([k, l]) => `<option value="${k}" ${rep === k ? "selected" : ""}>${l}</option>`).join("")}</select>
      <input class="input" type="number" id="psN" min="1" max="365" inputmode="numeric" value="${n}" aria-label="Ogni quanti giorni" style="margin-top:8px" ${rep === "d" ? "" : "hidden"}></div>
    <div class="field"><label for="psRem">Promemoria 🔔</label><select class="input" id="psRem">${[["morning", "Alle 9 del giorno stesso"], ["1440", "Il giorno prima"], ["none", "Nessun promemoria"]].map(([k, l]) => `<option value="${k}" ${rem === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
    <div class="actions">${it ? `<button class="btn danger" data-act="pet-scad-del" aria-label="Elimina la scadenza">🗑</button>` : ""}<button class="btn" data-act="close">Annulla</button><button class="btn primary" data-act="pet-scad-salva">Salva</button></div>`);
  $("#psRep").addEventListener("change", (e) => { $("#psN").hidden = e.target.value !== "d"; });
}
async function salvaPetScad() {
  const d = petScDraft; if (!d) return;
  const tit = taglia($("#psTit").value.trim(), 100); if (!tit) { toast("Scrivi un titolo 🍙"); $("#psTit").focus(); return; }
  const data = $("#psData").value; if (!validYmd(data) || data < "2000-01-01" || data > "2100-12-31") { toast("Controlla la data 📅"); return; }
  let rep = $("#psRep").value;
  if (rep === "d") { const n = parseInt($("#psN").value, 10); if (!(n >= 1 && n <= 365)) { toast("Ogni quanti giorni? Da 1 a 365"); $("#psN").focus(); return; } rep = "d" + n; }
  else if (!["-", "m1", "m3", "m6", "m12"].includes(rep)) rep = "-";
  const rem = ["none", "morning", "1440"].includes($("#psRem").value) ? $("#psRem").value : "morning";
  const marca = { tipo: PET_SCAD_TIPI.some((t) => t[0] === d.tipo) ? d.tipo : "altro", rep, anchor: +data.slice(8, 10) };
  let it = d.id ? state.items.find((x) => x.id === d.id) : null; const nuova = !it;
  const resto = it ? (petMarca(it)?.resto ?? it.body) : "";
  const campi = { title: tit, body: petMarcaTesto(marca) + resto, due_date: data, remind: rem, lista_id: null, kind: "todo", updated_at: new Date().toISOString() };
  if (nuova) it = newItem({ ...campi, area: "personale", remind: rem }); else Object.assign(it, campi);
  const prima = it.remind_at; it.remind_at = computeRemind(it); if (it.remind_at !== prima) it.reminded = false;
  if (nuova) state.items.push(it);
  closeSheet(); petScDraft = null; render();
  await store.save(it);
  toast(nuova ? "Scadenza salvata 🐾" : "Scadenza aggiornata");
  if (nuova && it.remind_at && ONLINE_MODE) maybeAskPush();
}
async function eliminaPetScad() {
  const id = petScDraft?.id, it = state.items.find((x) => x.id === id); if (!it) return;
  const ok = await ask({ title: "Eliminare la scadenza?", text: `"${it.title}" sparirà per sempre.`, ok: "Elimina", danger: true });
  if (!ok) { apriPetScad(id); return; }
  state.items = state.items.filter((x) => x.id !== id); petScDraft = null; render(); await store.remove(id); toast("Eliminata");
}
// Alla scadenza fatta (da qui, da Da fare o da Oggi) con una ripetizione: propongo la prossima
async function petProponiProssima(it) {
  const m = petMarca(it); if (!m || m.rep === "-" || !mod("pet") || !it.due_date) return;
  const prox = petProssima(it.due_date, m.rep, m.anchor); if (!prox) return;
  if (state.items.some((x) => !x.done && x.id !== it.id && x.title === it.title && x.due_date === prox && petMarca(x))) return; // già messa
  await new Promise((r) => setTimeout(r, 450));
  const si = await ask({ title: "Metto la prossima?", text: `${it.title}\nLa prossima sarebbe ${parseYmd(prox).getDate()} ${MESI[parseYmd(prox).getMonth()]} ${parseYmd(prox).getFullYear()} (${petRepTesto(m.rep).toLowerCase()}).`, ok: "Sì, aggiungila" });
  if (!si) return;
  const n = newItem({ kind: "todo", title: it.title, body: petMarcaTesto({ tipo: m.tipo, rep: m.rep, anchor: m.anchor || +it.due_date.slice(8, 10) }) + m.resto, due_date: prox, remind: ["none", "morning", "1440"].includes(it.remind) ? it.remind : "morning", lista_id: null, area: "personale" });
  n.remind_at = computeRemind(n);
  state.items.push(n); render(); await store.save(n); toast("Prossima scadenza aggiunta 🐾");
}
// Spese del pet: le spese esistenti con categoria "animali" (nessuna categoria nuova, il DB non ne accetta altre). Solo con il modulo spese acceso.
const PET_CAT_SPESA = "animali";
function petSpeseHtml() {
  if (!mod("spese")) return "";
  const oggi = new Date(), mk = monthKey(oggi), ak = String(oggi.getFullYear());
  const v = state.spese.voci.filter((x) => x.categoria === PET_CAT_SPESA).sort(ordineSpese);
  const somma = (k) => v.filter((x) => x.giorno.startsWith(k)).reduce((a, x) => a + x.importo_cent, 0);
  return `<div class="sec"><h2>Spese del pet</h2><button class="fbtn on" data-act="pet-spesa-nuova">Aggiungi spesa pet</button></div>
    <div class="pet-spese-tot"><div><small>Questo mese</small><b>${euro(somma(mk))}</b></div><div><small>Quest'anno</small><b>${euro(somma(ak))}</b></div></div>
    ${v.length ? `<div class="list pet-scads">${v.slice(0, 5).map((x) => { const c = catSpesa(x.categoria); return `<button class="sp-riga" data-act="spesa-modifica" data-id="${esc(x.id)}">
      <span class="sp-e" style="--cc:${c[3]}">${c[1]}</span><span class="sp-t"><b>${esc(x.nota || c[2])}</b><small>${x.nota ? `${c[2]} · ` : ""}${niceDate(x.giorno)}</small></span><b class="sp-i">${euro(x.importo_cent)}</b></button>`; }).join("")}</div>`
      : `<p class="small">Ancora nessuna spesa per il tuo pet. Cibo, veterinario, giochi: segna qui quanto spendi.</p>`}`;
}
function viewPet() {
  const p = CUSTOM.pet;
  if (!petPresente(p)) return `<div class="sec" style="margin-top:0"><h2>Il mio pet</h2></div>
    <div class="empty"><div class="mbox">${mascot()}</div><div>Qui tieni la scheda del tuo animale: il nome, il veterinario, la routine di ogni giorno e il peso nel tempo.</div>
    <div class="actions ospite-azioni"><button class="btn primary" data-act="pet-edit">Crea la scheda</button></div></div>`;
  const oggi = todayStr(), voci = petVoci(), fatte = petFatte(oggi), n = voci.filter((v) => fatte.has(v.id)).length, pesi = petPesi();
  const festa = petCompleannoOggi(p), dataT = petDataTesto(p);
  const telHref = p.tel ? "tel:" + p.tel.replace(/ /g, "") : "";
  return `<div class="sec" style="margin-top:0"><h2>${esc(petTitolo())}</h2></div>
    <div class="pet-card">
      <div class="pet-ico ${festa ? "festa" : ""}">${petIcona(p.specie)}</div>
      <div class="pet-id"><b>${esc(p.specie ? petSp(p.specie)[1] : "Il mio pet")}</b>${dataT ? `<small>${esc(dataT)}</small>` : ""}</div>
      <button class="fbtn" data-act="pet-edit" aria-label="Modifica la scheda di ${esc(p.nome || "il tuo pet")}">Modifica</button>
    </div>
    ${festa ? `<div class="pet-festa" role="status">Oggi è il compleanno ${p.nome ? "di " + esc(p.nome) : "del tuo pet"}!${DECO("🎂")}</div>` : ""}
    <div class="sec"><h2>Routine di oggi</h2><span class="count" aria-live="polite">Fatto oggi ${n}/${voci.length}</span></div>
    ${voci.length ? `<div class="pet-routine" role="group" aria-label="Routine di oggi${p.nome ? " di " + esc(p.nome) : ""}">${voci.map((v) => { const f = fatte.has(v.id);
      return `<button class="pin-toggle pet-voce ${f ? "on" : ""}" data-act="pet-spunta" data-v="${esc(v.id)}" aria-pressed="${f}"><span><b>${esc(v.t)}</b></span><span class="sw2" aria-hidden="true"></span></button>`; }).join("")}</div>`
      : `<p class="small">Nessuna voce nella routine. Aggiungine qualcuna.</p>`}
    <div class="more-row"><button class="more" data-act="pet-routine">Cambia la routine</button></div>
    ${petScadHtml()}
    ${petSpeseHtml()}
    <div class="sec"><h2>Peso</h2><button class="fbtn on" data-act="pet-peso" data-v="">Aggiungi peso</button></div>
    ${pesi.length ? `<div class="pet-peso-box">${petGrafico(pesi)}<ul class="pet-pesi">${[...pesi].reverse().map((x) => `<li><button class="pet-peso-riga" data-act="pet-peso" data-v="${x.giorno}" aria-label="Modifica il peso del ${esc(niceDate(x.giorno))}: ${fmtKg(x.kg)} kg"><span>${esc(niceDate(x.giorno))}</span><b>${fmtKg(x.kg)} kg</b></button></li>`).join("")}</ul></div>`
      : `<p class="small">Ancora nessun peso segnato. Con qualche misura vedi come cambia nel tempo.</p>`}
    ${p.vet || p.tel ? `<div class="sec"><h2>Veterinario</h2></div><div class="pet-vet">${p.vet ? `<b>${esc(p.vet)}</b>` : ""}${p.tel ? `<a class="pet-tel" href="${esc(telHref)}" aria-label="Chiama${p.vet ? " " + esc(p.vet) : ""} al ${esc(p.tel)}">${esc(p.tel)}</a>` : ""}</div>` : ""}
    ${p.note ? `<div class="sec"><h2>Note</h2></div><p class="pet-note">${esc(p.note)}</p>` : ""}`;
}
// ---- Scheda: crea, modifica, rimuovi
function apriPet() {
  const p = CUSTOM.pet, mesi = MESI.map((n, i) => `<option value="${i + 1}" ${p.m === i + 1 ? "selected" : ""}>${n.replace(/^./, (c) => c.toUpperCase())}</option>`).join("");
  openSheet(`<h2><span class="mbox">${mascot()}</span>${petPresente(p) ? "La scheda del tuo pet" : "Il tuo pet"}</h2>
    <div class="field"><label for="ptNome">Nome</label><input class="input" id="ptNome" maxlength="20" autocomplete="off" placeholder="Es. Briciola" value="${esc(p.nome)}"></div>
    <div class="field"><label id="ptSpL">Che animale è?</label><div class="sp-pick" id="ptSpecie" role="group" aria-labelledby="ptSpL">${PET_SPECIE.map(([k, n]) => `<button type="button" class="${p.specie === k ? "on" : ""}" data-act="pet-specie" data-v="${k}" aria-pressed="${p.specie === k}"><span class="e">${petIcona(k)}</span><small>${n}</small></button>`).join("")}</div></div>
    <div class="field"><label id="ptDtL">Una data, se vuoi</label>
      <div class="pet-dt" id="ptDt" role="group" aria-labelledby="ptDtL"><button type="button" class="fbtn ${p.dt !== "a" ? "on" : ""}" data-act="pet-dt" data-v="n" aria-pressed="${p.dt !== "a"}">Compleanno</button><button type="button" class="fbtn ${p.dt === "a" ? "on" : ""}" data-act="pet-dt" data-v="a" aria-pressed="${p.dt === "a"}">Arrivo a casa</button></div>
      <div class="pet-data"><select class="input" id="ptG" aria-label="Giorno"><option value="">Giorno</option>${Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}" ${p.g === i + 1 ? "selected" : ""}>${i + 1}</option>`).join("")}</select>
        <select class="input" id="ptM" aria-label="Mese"><option value="">Mese</option>${mesi}</select>
        <input class="input" id="ptA" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="Anno" aria-label="Anno, facoltativo" value="${p.a || ""}"></div></div>
    <div class="field"><label for="ptVet">Veterinario</label><input class="input" id="ptVet" maxlength="40" autocomplete="off" placeholder="Nome dello studio" value="${esc(p.vet)}"></div>
    <div class="field"><label for="ptTel">Telefono del veterinario</label><input class="input" id="ptTel" type="tel" inputmode="tel" maxlength="20" autocomplete="off" placeholder="Es. +39 02 1234567" value="${esc(p.tel)}"></div>
    <div class="field"><label for="ptNote">Note</label><textarea class="input" id="ptNote" rows="3" maxlength="300" placeholder="Allergie, cibo preferito, cose da ricordare">${esc(p.note)}</textarea></div>
    ${petPresente(p) ? `<button class="more ospite-cancella" data-act="pet-rimuovi">Rimuovi il pet e i suoi dati</button>` : ""}
    <div class="actions"><button class="btn" data-act="close">Annulla</button><button class="btn primary" data-act="pet-salva">Salva</button></div>`);
  if (!petPresente(p)) setTimeout(() => $("#ptNome")?.focus(), 250);
}
async function salvaPet() {
  const specie = $("#ptSpecie .on")?.dataset.v || "", dt = $("#ptDt .on")?.dataset.v === "a" ? "a" : "n";
  const g = +$("#ptG").value || 0, m = +$("#ptM").value || 0, as = $("#ptA").value.trim(), a = as === "" ? 0 : /^\d{4}$/.test(as) ? +as : -1;
  const tel = $("#ptTel").value.trim();
  if (a < 0 || (a && (a < 1980 || a > new Date().getFullYear()))) { toast("Controlla l'anno 📅"); $("#ptA").focus(); return; }
  if (g && !m) { toast("Scegli anche il mese 📅"); $("#ptM").focus(); return; }
  if (g && m && g > new Date(2024, m, 0).getDate()) { toast("Quel giorno non esiste in quel mese 📅"); return; }
  if (tel && !cleanPetTel(tel)) { toast("Il telefono può avere solo cifre, spazi e un + all'inizio"); $("#ptTel").focus(); return; }
  const pet = cleanPet({ nome: $("#ptNome").value, specie, dt, g, m, a, vet: $("#ptVet").value, tel, note: $("#ptNote").value, routine: CUSTOM.pet.routine });
  if ((g || m || a) && !pet.dt) { toast("Quella data non è valida 📅"); return; }
  if (!petPresente(pet)) { toast("Scegli che animale è o scrivi il suo nome"); $("#ptNome").focus(); return; }
  await saveCustom({ pet }); closeSheet(); toast("Scheda salvata 🐾");
}
async function rimuoviPet() {
  const ok = await ask({ title: "Rimuovere il pet?", text: "Cancello la scheda, le spunte della routine e tutti i pesi. Non si può annullare.", ok: "Rimuovi", danger: true });
  if (!ok) { apriPet(); return; }
  try { await petCancellaRegistro(); } catch (e) { toast(erroreDiRete(e) ? "Sei offline: riprova tra poco" : "Non sono riuscita a rimuoverlo"); return; }
  await saveCustom({ pet: cleanPet(null) }); toast("Pet rimosso");
}
// ---- Routine: fino a 8 voci
let petBozza = null;
function petLeggiBozza() { if (petBozza) document.querySelectorAll(".pet-rin").forEach((i) => { const v = petBozza.find((x) => x.id === i.dataset.id); if (v) v.t = i.value; }); }
function apriPetRoutine(bozza) {
  if (bozza) petBozza = bozza; else petBozza = petVoci().map((v) => ({ id: v.id, t: v.t }));
  const b = petBozza;
  openSheet(`<h2><span class="mbox">${mascot()}</span>La routine${CUSTOM.pet.nome ? " di " + esc(CUSTOM.pet.nome) : ""}</h2>
    <p class="ospite-testo">Le cose da fare ogni giorno, fino a 8. Ogni giorno ricominciano da capo.</p>
    <div class="pet-rlista">${b.map((v) => `<div class="pet-rriga"><input class="input pet-rin" data-id="${esc(v.id)}" maxlength="24" autocomplete="off" aria-label="Nome della voce" value="${esc(v.t)}"><button type="button" class="iconbtn pet-rdel" data-act="pet-r-del" data-v="${esc(v.id)}" aria-label="Togli ${esc(v.t || "la voce")}">✕</button></div>`).join("")}</div>
    <div class="more-row">${b.length < 8 ? `<button class="more" data-act="pet-r-add">Aggiungi una voce</button>` : `<small class="small">Hai raggiunto le 8 voci.</small>`}<button class="more" data-act="pet-r-ripristina">Ripristina quelle di base</button></div>
    <div class="actions"><button class="btn" data-act="close">Annulla</button><button class="btn primary" data-act="pet-r-salva">Salva</button></div>`);
}
async function salvaPetRoutine() {
  petLeggiBozza();
  const r = cleanPetRoutine((petBozza || []).map((v) => ({ id: v.id, t: v.t })).filter((v) => str(v.t).trim()));
  await saveCustom({ pet: { ...CUSTOM.pet, routine: r || [] } }); petBozza = null; closeSheet(); toast("Routine salvata");
}
// ---- Pesi
function apriPetPeso(giorno) {
  const g = petGiornoOk(giorno) ? giorno : todayStr(), ex = state.pet.righe.find((r) => r.tipo === "peso" && r.giorno === g);
  openSheet(`<h2><span class="mbox">${mascot()}</span>${ex ? "Modifica il peso" : "Aggiungi il peso"}</h2>
    <div class="field"><label for="ptKg">Peso in kg</label><input class="input big" id="ptKg" inputmode="decimal" enterkeyhint="done" maxlength="9" autocomplete="off" placeholder="Es. 4,5" value="${ex ? fmtKg(ex.valore) : ""}"></div>
    <div class="field"><label for="ptGiorno">Giorno</label><input class="input" type="date" id="ptGiorno" value="${g}" min="${petMinGiorno()}" max="${todayStr()}"></div>
    <div class="actions">${ex ? `<button class="btn danger" data-act="pet-peso-togli" data-v="${g}" aria-label="Togli questo peso">🗑</button>` : ""}<button class="btn" data-act="close">Annulla</button><button class="btn primary" data-act="pet-peso-salva">Salva</button></div>`);
  $("#ptKg").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); petAzione("pet-peso-salva"); } });
  setTimeout(() => $("#ptKg")?.focus(), 250);
}
function petFesta(g, el) {
  const k = chiaveGiorni("petFesta");
  if (LS.get(k, "") === g) return; // una sola volta al giorno
  LS.set(k, g);
  toast(`Tutto fatto${CUSTOM.pet.nome ? " per " + CUSTOM.pet.nome : ""}! 🐾`);
  if (menoMoto() || CUSTOM.stile === "sobrio") return;
  const r = (el || document.body).getBoundingClientRect();
  confetti(r.left + r.width / 2, r.top + 10, 24); cheer(1700);
}
async function petAzione(act, v, el) {
  switch (act) {
    case "pet-edit": apriPet(); break;
    case "pet-specie": document.querySelectorAll("#ptSpecie button").forEach((b) => { const on = b === el; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); }); break;
    case "pet-dt": document.querySelectorAll("#ptDt button").forEach((b) => { const on = b === el; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); }); break;
    case "pet-salva": await salvaPet(); break;
    case "pet-rimuovi": await rimuoviPet(); break;
    case "pet-spunta": {
      if (!mod("pet") || !petVoci().some((x) => x.id === v)) break;
      const g = todayStr(), fatta = petFatte(g).has(v);
      petImposta(fatta ? { a: "del", tipo: "routine", giorno: g, chiave: v } : { a: "set", tipo: "routine", giorno: g, chiave: v, valore: 1 });
      if (!fatta) suona("spunta");
      render();
      const nuovo = document.querySelector(`.pet-voce[data-v="${v}"]`); nuovo?.focus({ preventScroll: true });
      const voci = petVoci(), fatte = petFatte(g);
      if (!fatta && voci.length && voci.every((x) => fatte.has(x.id))) petFesta(g, nuovo);
      break;
    }
    case "pet-routine": apriPetRoutine(); break;
    case "pet-scad-new": apriPetScad(null); break;
    case "pet-spesa-nuova": if (mod("spese")) apriSpesa(null, PET_CAT_SPESA); break;
    case "pet-scad-edit": apriPetScad(el.dataset.id); break;
    case "pet-s-tipo": if (petScDraft && PET_SCAD_TIPI.some((t) => t[0] === v)) {
      const tit = $("#psTit"); if (tit && tit.value === petScTitolo(petScDraft.tipo)) tit.value = petScTitolo(v);
      petScDraft.tipo = v; document.querySelectorAll("#psTipi button").forEach((b) => { const on = b === el; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); }); } break;
    case "pet-scad-salva": await salvaPetScad(); break;
    case "pet-scad-del": await eliminaPetScad(); break;
    case "pet-scad-fatta": { const it = state.items.find((x) => x.id === el.dataset.id); if (it && petMarca(it) && !it.done) await spuntaVoce(it, el); break; }
    case "pet-r-add": { petLeggiBozza(); if (petBozza.length < 8) { petBozza.push({ id: petNuovoId(petBozza.map((x) => x.id)), t: "" }); apriPetRoutine(petBozza); setTimeout(() => document.querySelector(".pet-rriga:last-child .pet-rin")?.focus(), 250); } break; }
    case "pet-r-del": petLeggiBozza(); petBozza = petBozza.filter((x) => x.id !== v); apriPetRoutine(petBozza); break;
    case "pet-r-ripristina": petBozza = (PET_ROUTINE_DEF[CUSTOM.pet.specie || "altro"] || PET_ROUTINE_DEF.altro).map(([id, t]) => ({ id, t })); apriPetRoutine(petBozza); break;
    case "pet-r-salva": await salvaPetRoutine(); break;
    case "pet-peso": apriPetPeso(v); break;
    case "pet-peso-salva": {
      const kg = petParseKg($("#ptKg")?.value), giorno = $("#ptGiorno")?.value;
      if (kg === null) { toast("Scrivi un peso valido, es. 4,5 (da 0,01 a 999,99 kg)"); $("#ptKg")?.focus(); break; }
      if (!petGiornoOk(giorno)) { toast("Controlla il giorno 📅"); break; }
      petImposta({ a: "set", tipo: "peso", giorno, chiave: "kg", valore: kg });
      closeSheet(); render(); toast(`Peso segnato: ${fmtKg(kg)} kg`); break;
    }
    case "pet-peso-togli": if (petGiornoOk(v)) { petImposta({ a: "del", tipo: "peso", giorno: v, chiave: "kg" }); closeSheet(); render(); toast("Peso tolto"); } break;
  }
}

/* =========================================================
   LA CASETTA
   Ogni mascotte ha una casa: le casette sono poche e condivise per "habitat".
   Le casette in più si sbloccano con i giorni attivi (serie().totali), i mobili arrivano in regalo con i bocconcini.
   Gli sblocchi restano per sempre: si salvano in CUSTOM.casa (sincronizzato nell'account) e si ricalcolano dai numeri.
   Per aggiungere una casetta: una riga in CASETTE (se non ha un disegno suo usa la stanza semplice con i colori della riga).
   I disegni sono SVG fatti dal codice, nello stile delle mascotte: forme tonde, colori pastello, contorno di un tono più scuro.
   ========================================================= */
const bocconciniTot = () => bocconcini().length;
const casetteAperte = () => { const tot = serie().totali; return CASETTE.filter((c) => !c[3] || tot >= c[3] || CUSTOM.casa.casette.includes(c[0])).map((c) => c[0]); };
const mobiliAvuti = () => { const b = bocconciniTot(); return MOBILI.filter((m) => b >= m[2] || CUSTOM.casa.mobili.includes(m[0])).map((m) => m[0]); };
function casaScelta() {
  const s = CUSTOM.casa.scelta;
  return s !== "auto" && casetteAperte().includes(s) ? s : casaHabitat(CUSTOM.mascotte);
}

/* ---------- Disegni ---------- */
const CINK = "#4a2f3a";
const el = (tag, a, dentro = "") => `<${tag} ${Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(" ")}${dentro === null ? "/>" : `>${dentro}</${tag}>`}`;
const sh = (tag, a) => el(tag, a, null);
// foglia a goccia: base (x,y), lunghezza, angolo (gradi, 0 = in su)
const foglia = (x, y, l, a, f = "#9ad88f", s = "#6fb874", w = .42) => sh("path", { d: `M0 0 C ${l * w} ${-l * .3}, ${l * w * .8} ${-l * .85}, 0 ${-l} C ${-l * w * .8} ${-l * .85}, ${-l * w} ${-l * .3}, 0 0 Z`, fill: f, stroke: s, "stroke-width": 2, "stroke-linejoin": "round", transform: `translate(${x} ${y}) rotate(${a})` });
const stella = (x, y, r, f = "#ffe28a", s = "#f0c24e", sw = 1.6) => {
  let d = ""; for (let i = 0; i < 10; i++) { const rr = i % 2 ? r * .48 : r, a = Math.PI / 5 * i - Math.PI / 2; d += `${i ? "L" : "M"}${(x + Math.cos(a) * rr).toFixed(1)} ${(y + Math.sin(a) * rr).toFixed(1)} `; }
  return sh("path", { d: d + "Z", fill: f, stroke: s, "stroke-width": sw, "stroke-linejoin": "round" });
};
const fiorellino = (x, y, r, f, c = "#ffe28a") => { let p = ""; for (let i = 0; i < 5; i++) { const a = i * 72 * Math.PI / 180; p += sh("circle", { cx: (x + Math.cos(a) * r * .62).toFixed(1), cy: (y + Math.sin(a) * r * .62).toFixed(1), r: (r * .5).toFixed(1), fill: f }); } return p + sh("circle", { cx: x, cy: y, r: (r * .38).toFixed(1), fill: c }); };
const nuvoletta = (x, y, s = 1, f = "#fff", o = 1) => `<g transform="translate(${x} ${y}) scale(${s})" opacity="${o}">${sh("path", { d: "M-22 6 Q-24 -6 -12 -6 Q-10 -16 2 -14 Q12 -20 18 -8 Q28 -8 26 4 Q26 10 18 10 L-16 10 Q-22 10 -22 6Z", fill: f, stroke: "#dfe7f2", "stroke-width": 1.6 })}</g>`;

/* La finestra: cornice, vista dentro (ritagliata) e davanzale. Di sera la vista diventa cielo blu con luna e stelle. */
function finestra(uid, forma, cornice, bordo, vista, senzaSera = false) {
  const clip = forma === "tonda" ? sh("circle", { cx: 200, cy: 66, r: 42 }) : forma === "arco" ? sh("path", { d: "M152 108 L152 62 Q152 24 200 24 Q248 24 248 62 L248 108 Z" }) : sh("rect", { x: 152, y: 26, width: 96, height: 82, rx: 10 });
  const sera = `<g class="cs-sera">${sh("rect", { x: 140, y: 14, width: 120, height: 100, fill: "#33407a" })}${sh("circle", { cx: 222, cy: 50, r: 11, fill: "#fff3c4" })}${sh("circle", { cx: 228, cy: 46, r: 10, fill: "#33407a" })}${stella(172, 44, 4, "#fff6d6", "#fff6d6", 1)}${stella(186, 76, 3, "#fff6d6", "#fff6d6", 1)}${stella(236, 86, 3.4, "#fff6d6", "#fff6d6", 1)}</g>`;
  const telaio = forma === "tonda" ? sh("circle", { cx: 200, cy: 66, r: 42, fill: "none", stroke: cornice, "stroke-width": 9 }) + sh("circle", { cx: 200, cy: 66, r: 46.5, fill: "none", stroke: bordo, "stroke-width": 2 }) + sh("circle", { cx: 200, cy: 66, r: 37.5, fill: "none", stroke: bordo, "stroke-width": 1.6 })
    : forma === "arco" ? sh("path", { d: "M152 108 L152 62 Q152 24 200 24 Q248 24 248 62 L248 108", fill: "none", stroke: cornice, "stroke-width": 9, "stroke-linejoin": "round" }) + sh("path", { d: "M147.5 108 L147.5 62 Q147.5 19.5 200 19.5 Q252.5 19.5 252.5 62 L252.5 108", fill: "none", stroke: bordo, "stroke-width": 2 }) + sh("path", { d: "M200 26 L200 108 M152 70 L248 70", stroke: cornice, "stroke-width": 5 })
    : sh("rect", { x: 152, y: 26, width: 96, height: 82, rx: 10, fill: "none", stroke: cornice, "stroke-width": 9 }) + sh("rect", { x: 147.5, y: 21.5, width: 105, height: 91, rx: 13, fill: "none", stroke: bordo, "stroke-width": 2 }) + sh("path", { d: "M200 28 L200 106 M154 67 L246 67", stroke: cornice, "stroke-width": 5 });
  return `<defs><clipPath id="cf${uid}">${clip}</clipPath></defs><g clip-path="url(#cf${uid})">${vista}${senzaSera ? "" : sera}</g>${telaio}
    ${sh("rect", { x: 138, y: 106, width: 124, height: 9, rx: 4, fill: cornice, stroke: bordo, "stroke-width": 2 })}`;
}
// pareti, pavimento e battiscopa
const stanza = (muro, motivoMuro, pav, motivoPav, battiscopa, bb) => `${sh("rect", { width: 400, height: 200, fill: muro })}${motivoMuro}
  ${sh("rect", { y: 196, width: 400, height: 84, fill: pav })}${motivoPav}
  ${sh("rect", { y: 190, width: 400, height: 9, fill: battiscopa })}${sh("path", { d: "M0 190.5 H400 M0 198.5 H400", stroke: bb, "stroke-width": 2 })}`;

const DISEGNI_CASA = {
  laghetto(u) {
    let onde = ""; for (let y = 22; y < 190; y += 34) for (let x = (y / 34 % 2) * 26; x < 400; x += 52) onde += `M${x} ${y} q8 -6 16 0 t16 0 `;
    let assi = ""; for (let x = 0; x <= 400; x += 50) assi += `M${x} 199 L${x - (x - 200) * .25} 280 `;
    const vista = `${sh("rect", { x: 140, y: 14, width: 120, height: 100, fill: "#cdeefe" })}${nuvoletta(178, 40, .7)}
      ${sh("path", { d: "M140 70 Q200 62 260 70 L260 114 L140 114Z", fill: "#8fd3e8", stroke: "#6bbcd6", "stroke-width": 2 })}
      ${sh("path", { d: "M160 84 q6 -3 12 0 M214 96 q6 -3 12 0 M188 104 q5 -3 10 0", stroke: "#fff", "stroke-width": 2, fill: "none", "stroke-linecap": "round", opacity: .8 })}
      ${sh("path", { d: "M168 92 a11 6 0 1 0 2 -9 l-6 6z", fill: "#9ad88f", stroke: "#6fb874", "stroke-width": 1.6 })}${fiorellino(166, 86, 6, "#ffb3cc")}
      ${sh("path", { d: "M226 82 a9 5 0 1 0 2 -8 l-5 5z", fill: "#9ad88f", stroke: "#6fb874", "stroke-width": 1.6 })}
      ${sh("ellipse", { cx: 246, cy: 74, rx: 14, ry: 8, fill: "#c9c3bd", stroke: "#a9a29b", "stroke-width": 1.6 })}`;
    // fissi: campanelle di bambù (parete), sassi in pila e canne (pavimento), salvagente
    const canne = [0, 1, 2, 3].map((i) => sh("rect", { x: 260 + i * 8, y: 40 + (i % 2) * 6, width: 6, height: 40 - i * 4, rx: 3, fill: "#c6e3a6", stroke: "#98c27a", "stroke-width": 1.6 })).join("");
    const sassi = `${sh("ellipse", { cx: 102, cy: 206, rx: 24, ry: 9, fill: "#c9c3bd", stroke: "#a9a29b", "stroke-width": 2 })}${sh("ellipse", { cx: 100, cy: 192, rx: 17, ry: 8, fill: "#ddd7d1", stroke: "#a9a29b", "stroke-width": 2 })}${sh("ellipse", { cx: 102, cy: 180, rx: 10, ry: 6, fill: "#ebe6e1", stroke: "#a9a29b", "stroke-width": 2 })}
      ${sh("path", { d: "M84 202 q6 -3 12 0", stroke: "#fff", "stroke-width": 2, fill: "none", opacity: .7 })}`;
    const giunchi = [-12, 0, 12].map((d, i) => sh("path", { d: `M${124 + d / 3} 212 Q${122 + d} ${170} ${124 + d * 1.4} ${140 + i * 8}`, stroke: "#7cc08a", "stroke-width": 3, fill: "none", "stroke-linecap": "round" }) + sh("rect", { x: 120 + d * 1.4, y: 136 + i * 8, width: 8, height: 18, rx: 4, fill: "#b07a55", stroke: "#8e5c3c", "stroke-width": 1.5 })).join("");
    const salvagente = `${sh("circle", { cx: 126, cy: 70, r: 15, fill: "none", stroke: "#ff9b8a", "stroke-width": 9 })}${sh("path", { d: "M126 55 v8 M126 77 v8 M111 70 h8 M133 70 h8", stroke: "#fff", "stroke-width": 9 })}${sh("circle", { cx: 126, cy: 70, r: 19.5, fill: "none", stroke: "#e07a6a", "stroke-width": 1.8 })}${sh("circle", { cx: 126, cy: 70, r: 10.5, fill: "none", stroke: "#e07a6a", "stroke-width": 1.8 })}`;
    return { base: stanza("#d9f1ef", sh("path", { d: onde, stroke: "#c1e6e2", "stroke-width": 2.5, fill: "none", "stroke-linecap": "round" }), "#ecd3ab", sh("path", { d: assi + "M0 240 H400", stroke: "#d8b886", "stroke-width": 2, fill: "none" }), "#b9dfda", "#97cbc4"),
      finestra: finestra(u, "tonda", "#a8d8d3", "#7fbfb8", vista), fissi: salvagente + sh("path", { d: "M256 34 H294", stroke: "#98c27a", "stroke-width": 3, "stroke-linecap": "round" }) + canne + giunchi + sassi };
  },
  stalla(u) {
    let assi = ""; for (let x = 20; x < 400; x += 40) assi += `M${x} 0 V190 `;
    let paglia = ""; for (let i = 0; i < 46; i++) { const x = (i * 83) % 400, y = 206 + (i * 37) % 70; paglia += `M${x} ${y} l${8 + (i % 3) * 3} ${i % 2 ? -3 : 3} `; }
    const vista = `${sh("rect", { x: 140, y: 14, width: 120, height: 100, fill: "#cdeefe" })}${sh("circle", { cx: 230, cy: 44, r: 9, fill: "#ffe28a" })}${nuvoletta(176, 44, .6)}
      ${sh("path", { d: "M140 84 Q176 64 210 80 Q236 68 260 78 L260 114 L140 114Z", fill: "#a8dc8e", stroke: "#86c46c", "stroke-width": 2 })}
      ${sh("path", { d: "M140 96 H260 M140 88 H260", stroke: "#f2dcc0", "stroke-width": 3 })}${[148, 168, 188, 208, 228, 248].map((x) => sh("rect", { x, y: 82, width: 5, height: 20, rx: 2, fill: "#f7e6cf", stroke: "#d8b88f", "stroke-width": 1.2 })).join("")}
      ${fiorellino(160, 106, 4, "#fff")}${fiorellino(238, 108, 4, "#ffb3cc")}`;
    const fieno = `${sh("rect", { x: 74, y: 170, width: 56, height: 42, rx: 9, fill: "#f6d77c", stroke: "#dcb24e", "stroke-width": 2.5 })}${sh("path", { d: "M86 171 V211 M118 171 V211", stroke: "#c98f5a", "stroke-width": 3 })}${sh("path", { d: "M80 182 l8 -2 M96 196 l9 1 M106 178 l7 3 M80 202 l6 -2 M120 190 l5 3", stroke: "#dcb24e", "stroke-width": 2, "stroke-linecap": "round" })}
      ${sh("path", { d: "M74 172 q4 -6 10 -2 M118 170 q6 -6 10 0", stroke: "#dcb24e", "stroke-width": 2, fill: "none" })}`;
    const ferro = `${sh("path", { d: "M114 58 C112 82 140 82 138 58", stroke: "#b9b0bf", "stroke-width": 7, fill: "none", "stroke-linecap": "round" })}${sh("path", { d: "M114 58 C112 82 140 82 138 58", stroke: "#fff", "stroke-width": 2, fill: "none", "stroke-dasharray": "2 6", "stroke-linecap": "round" })}${sh("circle", { cx: 126, cy: 44, r: 2.4, fill: "#b07a55" })}${sh("path", { d: "M126 44 L115 56 M126 44 L137 56", stroke: "#b07a55", "stroke-width": 1.6 })}`;
    const campanaccio = `${sh("path", { d: "M276 26 V44", stroke: "#b07a55", "stroke-width": 2.5 })}${sh("path", { d: "M266 72 L268 52 Q276 42 284 52 L286 72 Z", fill: "#ffd76a", stroke: "#dfae3c", "stroke-width": 2.2, "stroke-linejoin": "round" })}${sh("circle", { cx: 276, cy: 76, r: 3.6, fill: "#dfae3c" })}${sh("path", { d: "M268 50 Q276 46 284 50", stroke: "#ff9db5", "stroke-width": 4, fill: "none" })}`;
    const travi = sh("path", { d: "M0 16 H400", stroke: "#e59f8b", "stroke-width": 10 }) + sh("path", { d: "M0 10 H400 M0 22 H400", stroke: "#d98a76", "stroke-width": 1.5 });
    return { base: stanza("#f7c7b6", sh("path", { d: assi, stroke: "#eaa995", "stroke-width": 2.2 }) + travi, "#f5df97", sh("path", { d: paglia, stroke: "#dfbf62", "stroke-width": 2, "stroke-linecap": "round" }), "#eaa995", "#d98a76"),
      finestra: finestra(u, "quadra", "#fff6ef", "#d98a76", vista), fissi: ferro + campanaccio + fieno };
  },
  bosco(u) {
    let tronchi = ""; for (let y = 14; y < 190; y += 22) tronchi += `M0 ${y} H400 `;
    let nodi = ""; for (let y = 25; y < 190; y += 44) nodi += sh("circle", { cx: 6, cy: y, r: 8, fill: "#edc9a0", stroke: "#c48d5c", "stroke-width": 2 }) + sh("circle", { cx: 394, cy: y + 22, r: 8, fill: "#edc9a0", stroke: "#c48d5c", "stroke-width": 2 });
    let assi = ""; for (let y = 216; y < 280; y += 20) assi += `M0 ${y} H400 `; for (let x = 0; x <= 400; x += 64) assi += `M${x} 199 L${x - (x - 200) * .3} 280 `;
    const pino = (x, y, s, f = "#6fb38a") => `<g transform="translate(${x} ${y}) scale(${s})">${sh("rect", { x: -2, y: 0, width: 4, height: 8, fill: "#a87452" })}${sh("path", { d: "M0 -34 L14 -10 H6 L16 4 H-16 L-6 -10 H-14Z", fill: f, stroke: "#4f9a6f", "stroke-width": 1.6, "stroke-linejoin": "round" })}</g>`;
    const vista = `${sh("rect", { x: 140, y: 14, width: 120, height: 100, fill: "#d6efff" })}${nuvoletta(222, 40, .6)}${sh("path", { d: "M140 90 Q190 70 260 86 L260 114 L140 114Z", fill: "#bfe3a8" })}${pino(168, 92, 1.1)}${pino(196, 98, .8, "#88c79c")}${pino(232, 94, 1.2)}`;
    const camino = `${sh("rect", { x: 106, y: 0, width: 30, height: 118, fill: "#d8cfc8", stroke: "#b5aaa1", "stroke-width": 2 })}${sh("path", { d: "M106 30 H136 M106 60 H136 M106 90 H136 M121 0 V30 M114 30 V60 M128 60 V90 M118 90 V118", stroke: "#b5aaa1", "stroke-width": 1.6 })}
      ${sh("rect", { x: 74, y: 116, width: 72, height: 10, rx: 4, fill: "#b07a55", stroke: "#8e5c3c", "stroke-width": 2 })}
      ${sh("path", { d: "M78 126 H142 V212 H78 Z", fill: "#d8cfc8", stroke: "#b5aaa1", "stroke-width": 2 })}${sh("path", { d: "M78 150 H90 M130 150 H142 M78 176 H88 M132 176 H142", stroke: "#b5aaa1", "stroke-width": 1.6 })}${sh("path", { d: "M92 212 V160 Q92 140 110 140 Q128 140 128 160 V212 Z", fill: "#5d4250", stroke: "#4a2f3a", "stroke-width": 2 })}
      <g class="cs-fuoco">${sh("path", { d: "M98 210 Q96 192 104 182 Q106 194 110 188 Q110 172 118 166 Q118 184 124 194 Q126 204 120 210 Z", fill: "#ffab5c", stroke: "#f08a3c", "stroke-width": 1.6 })}${sh("path", { d: "M105 210 Q104 200 109 194 Q112 202 116 198 Q118 206 115 210Z", fill: "#ffe28a" })}</g>
      ${sh("rect", { x: 96, y: 206, width: 28, height: 6, rx: 3, fill: "#a87452" })}`;
    const appesi = `${sh("path", { d: "M258 30 H296", stroke: "#8e5c3c", "stroke-width": 3, "stroke-linecap": "round" })}
      ${sh("path", { d: "M266 32 V66", stroke: "#b5aaa1", "stroke-width": 3 })}${sh("ellipse", { cx: 266, cy: 72, rx: 6, ry: 7, fill: "#d8cfc8", stroke: "#a9a29b", "stroke-width": 1.8 })}
      ${sh("path", { d: "M282 32 V44", stroke: "#8e5c3c", "stroke-width": 2 })}${sh("circle", { cx: 282, cy: 60, r: 13, fill: "#ff9b8a", stroke: "#e07a6a", "stroke-width": 2 })}${sh("circle", { cx: 282, cy: 60, r: 7.5, fill: "#ffc4b8" })}${sh("rect", { x: 280, y: 42, width: 4, height: 6, fill: "#8e5c3c" })}`;
    return { base: stanza("#e3b88a", sh("path", { d: tronchi, stroke: "#cf9c6a", "stroke-width": 2.5 }) + nodi, "#c08d5e", sh("path", { d: assi, stroke: "#a87a4e", "stroke-width": 2 }), "#8e6440", "#74502f"),
      finestra: finestra(u, "quadra", "#f2d7b0", "#b88a5c", vista), fissi: camino + appesi, luce: sh("circle", { cx: 110, cy: 192, r: 46, fill: "url(#casaAlone)" }) };
  },
  spiaggia(u) {
    let righe = ""; for (let x = 0; x < 400; x += 40) righe += sh("rect", { x, y: 0, width: 20, height: 190, fill: "#c6e6f7" });
    let sabbia = ""; for (let i = 0; i < 40; i++) sabbia += sh("circle", { cx: (i * 97) % 400, cy: 206 + (i * 41) % 72, r: 1.6, fill: "#e8cf98" });
    const vista = `${sh("rect", { x: 140, y: 14, width: 120, height: 100, fill: "#cdeefe" })}${sh("circle", { cx: 228, cy: 42, r: 11, fill: "#ffe28a", stroke: "#f6c94a", "stroke-width": 2 })}
      ${sh("path", { d: "M140 72 H260 V92 H140Z", fill: "#7ccbe8" })}${sh("path", { d: "M150 80 q6 -3 12 0 M200 86 q6 -3 12 0 M232 78 q6 -3 12 0", stroke: "#fff", "stroke-width": 2, fill: "none", "stroke-linecap": "round" })}
      ${sh("path", { d: "M140 92 Q200 86 260 92 V114 H140Z", fill: "#f6e3b8", stroke: "#e8cf98", "stroke-width": 1.6 })}
      ${sh("path", { d: "M170 106 L174 76", stroke: "#b07a55", "stroke-width": 2 })}${sh("path", { d: "M156 80 Q174 62 192 76 Z", fill: "#ff9db5", stroke: "#e57a98", "stroke-width": 1.6 })}${sh("path", { d: "M168 68 L174 77 L180 68", fill: "#fff" })}`;
    const castello = `${sh("path", { d: "M72 212 V188 H80 V182 H86 V188 H96 V176 H102 V170 H110 V176 H116 V188 H124 V182 H130 V188 V212 Z", fill: "#f2d49a", stroke: "#d8b46c", "stroke-width": 2.2, "stroke-linejoin": "round" })}${sh("path", { d: "M98 212 V200 Q101 194 104 200 V212", fill: "#d8b46c" })}
      ${sh("path", { d: "M106 170 V154", stroke: "#b07a55", "stroke-width": 2 })}${sh("path", { d: "M106 154 L118 158 L106 162Z", fill: "#ff9db5" })}`;
    const tavola = `${sh("path", { d: "M128 212 Q111 150 126 76 Q128 68 130 76 Q145 150 128 212Z", fill: "#ffd76a", stroke: "#e8b83c", "stroke-width": 2.2 })}${sh("path", { d: "M128 80 Q130 150 128 208", stroke: "#ff9db5", "stroke-width": 3.5, fill: "none" })}${sh("path", { d: "M122 110 Q120 140 122 170", stroke: "#fff", "stroke-width": 2, fill: "none", opacity: .7 })}`;
    const stellaMare = `<g transform="rotate(12 276 56)">${stella(276, 56, 17, "#ffab8f", "#e88a6c", 2.2)}</g>${sh("circle", { cx: 272, cy: 52, r: 1.8, fill: "#fff" })}${sh("circle", { cx: 281, cy: 58, r: 1.8, fill: "#fff" })}`;
    const conchiglia = (x, y, f) => `${sh("path", { d: `M${x - 9} ${y} Q${x} ${y - 16} ${x + 9} ${y} Q${x} ${y + 4} ${x - 9} ${y}Z`, fill: f, stroke: "#e5a6b2", "stroke-width": 1.8 })}${sh("path", { d: `M${x} ${y + 1} L${x} ${y - 9} M${x - 4} ${y + 1} L${x - 3} ${y - 7} M${x + 4} ${y + 1} L${x + 3} ${y - 7}`, stroke: "#e5a6b2", "stroke-width": 1.2 })}`;
    return { base: stanza("#eef8fd", righe, "#f6e3b8", sabbia, "#bfe0f2", "#95c4de"),
      finestra: finestra(u, "quadra", "#fff", "#95c4de", vista), fissi: tavola + castello + stellaMare + conchiglia(372, 272, "#ffe1e8") + conchiglia(390, 262, "#fff2d6") };
  },
  serra(u) {
    let vetri = ""; for (let x = 0; x <= 400; x += 50) vetri += `M${x} 0 V190 `; vetri += "M0 64 H400 M0 128 H400";
    let piastre = ""; for (let x = 0; x <= 400; x += 40) piastre += `M${x} 199 L${x - (x - 200) * .3} 280 `; piastre += "M0 228 H400 M0 256 H400";
    const vista = `${sh("rect", { x: 140, y: 14, width: 120, height: 100, fill: "#d8f1ff" })}${sh("circle", { cx: 226, cy: 46, r: 10, fill: "#ffe28a" })}${sh("path", { d: "M140 88 Q200 78 260 88 V114 H140Z", fill: "#b7e39a" })}
      ${[[160, 92, "#ff9db5"], [178, 100, "#ffe28a"], [198, 90, "#c9b2ff"], [218, 100, "#ff9db5"], [238, 92, "#fff"]].map(([x, y, c]) => sh("path", { d: `M${x} ${y + 12} V${y}`, stroke: "#6fb874", "stroke-width": 2 }) + fiorellino(x, y, 6, c)).join("")}`;
    const appesa = (x, l, f) => {
      const tralcio = (dx, lun) => { let p = sh("path", { d: `M${x + dx} ${l + 10} q${dx / 2} ${lun / 2} ${dx / 3} ${lun}`, stroke: "#6fb874", "stroke-width": 1.8, fill: "none" }); for (let k = 1; k <= 3; k++) p += foglia(x + dx + dx / 6 * k / 3, l + 10 + lun * k / 3.4, 8, dx < 0 ? 200 : 160, k % 2 ? "#9ad88f" : "#b7e39a"); return p; };
      return `${sh("path", { d: `M${x} 0 L${x - 11} ${l} M${x} 0 L${x + 11} ${l}`, stroke: "#c9a27a", "stroke-width": 1.6 })}${tralcio(-9, 34)}${tralcio(9, 26)}
      ${foglia(x - 4, l + 1, 14, -30)}${foglia(x + 4, l + 1, 15, 28, "#b7e39a")}${foglia(x, l, 12, 0)}
      ${sh("path", { d: `M${x - 13} ${l} H${x + 13} L${x + 9} ${l + 15} Q${x} ${l + 19} ${x - 9} ${l + 15} Z`, fill: f, stroke: "#d37a52", "stroke-width": 2 })}${sh("path", { d: `M${x - 10} ${l + 6} H${x + 10}`, stroke: "#fff", "stroke-width": 1.6, opacity: .6 })}`;
    };
    const annaffiatoio = `${sh("path", { d: "M84 212 V184 Q84 176 92 176 H112 Q120 176 120 184 V212 Z", fill: "#9fd4ef", stroke: "#6fb0d6", "stroke-width": 2.2 })}${sh("path", { d: "M120 194 L136 176", stroke: "#6fb0d6", "stroke-width": 6, "stroke-linecap": "round" })}${sh("ellipse", { cx: 137, cy: 175, rx: 4, ry: 6, fill: "#6fb0d6", transform: "rotate(40 137 175)" })}
      ${sh("path", { d: "M90 178 Q102 160 114 178", stroke: "#6fb0d6", "stroke-width": 4, fill: "none" })}${fiorellino(102, 196, 6, "#fff")}`;
    const vasetti = `${sh("path", { d: "M74 212 L76 198 H92 L94 212Z", fill: "#ee9b72", stroke: "#d37a52", "stroke-width": 1.8 })}${foglia(84, 198, 16, -20)}${foglia(84, 198, 14, 25, "#b7e39a")}`;
    return { base: stanza("#e6f5e2", sh("path", { d: vetri, stroke: "#fff", "stroke-width": 5 }) + sh("path", { d: vetri, stroke: "#bfe0b6", "stroke-width": 1.5 }), "#f0bd9c", sh("path", { d: piastre, stroke: "#dc9e7a", "stroke-width": 2 }), "#cfe8c6", "#a9d39d"),
      finestra: finestra(u, "arco", "#fff", "#a9d39d", vista), fissi: appesa(126, 52, "#f6b088") + appesa(276, 40, "#ffd0b0") + annaffiatoio + vasetti };
  },
  nuvole(u) {
    let stelle = ""; [[30, 40], [96, 24], [60, 150], [130, 120], [270, 140], [350, 110], [380, 36], [320, 160], [24, 100]].forEach(([x, y], i) => { stelle += stella(x, y, 4 + (i % 3), "#fff", "#e0d6fb", 1.2); });
    let fiocchi = ""; for (let x = -10; x < 420; x += 46) fiocchi += sh("circle", { cx: x, cy: 206, r: 22, fill: "#fff", stroke: "#ddd3f6", "stroke-width": 2 });
    const vista = `${sh("rect", { x: 140, y: 14, width: 120, height: 100, fill: "#cfe6ff" })}${nuvoletta(180, 80, .9)}${nuvoletta(228, 50, .7)}${sh("circle", { cx: 214, cy: 36, r: 9, fill: "#ffe28a" })}`;
    const arcobaleno = ["#ff9db5", "#ffd76a", "#b7e39a", "#9fd4ef", "#c9b2ff"].map((c, i) => sh("path", { d: `M${76 + i * 5} 212 A${28 - i * 5} ${28 - i * 5} 0 0 1 ${132 - i * 5} 212`, stroke: c, "stroke-width": 5, fill: "none" })).join("") + nuvoletta(78, 206, .55) + nuvoletta(130, 206, .55);
    const appese = [[116, 46, 6], [128, 70, 5], [138, 34, 4.5]].map(([x, l, r]) => sh("path", { d: `M${x} 0 V${l - r}`, stroke: "#c9b2ff", "stroke-width": 1.4 }) + stella(x, l, r * 1.6)).join("");
    const luna = `${sh("path", { d: "M276 0 V34", stroke: "#c9b2ff", "stroke-width": 1.4 })}${sh("path", { d: "M286 40 A20 20 0 1 0 288 76 A15 15 0 1 1 286 40Z", fill: "#ffe8a3", stroke: "#f0c24e", "stroke-width": 2 })}${sh("circle", { cx: 270, cy: 60, r: 1.8, fill: CINK })}${sh("path", { d: "M268 66 q3 3 6 0", stroke: CINK, "stroke-width": 1.6, fill: "none", "stroke-linecap": "round" })}`;
    return { base: stanza("#ebe4fd", stelle, "#f6f2ff", fiocchi, "#ddd3f6", "#c9bdf0"),
      finestra: finestra(u, "tonda", "#fff", "#c9bdf0", vista), fissi: appese + luna + arcobaleno };
  },
  pasticceria(u) {
    let righe = ""; for (let x = 0; x < 400; x += 40) righe += sh("rect", { x, y: 0, width: 20, height: 190, fill: "#fff3ee" });
    let tenda = ""; for (let x = 0; x < 400; x += 40) tenda += sh("path", { d: `M${x} 0 H${x + 40} V12 Q${x + 30} 24 ${x + 20} 12 Q${x + 10} 24 ${x} 12 Z`, fill: (x / 40) % 2 ? "#fff" : "#ffc9d6", stroke: "#f2a9bc", "stroke-width": 1.5 });
    let scacchi = ""; for (let r = 0; r < 4; r++) for (let c = 0; c < 9; c++) if ((r + c) % 2 === 0) scacchi += sh("rect", { x: c * 48 - 12, y: 200 + r * 21, width: 48, height: 21, fill: "#fff6f2" });
    const torta = (x, y, w, h, f, g, s) => `${sh("rect", { x: x - w / 2, y: y - h, width: w, height: h, rx: 3, fill: f, stroke: s, "stroke-width": 1.6 })}${sh("rect", { x: x - w / 2, y: y - h, width: w, height: 5, rx: 2.5, fill: g, stroke: s, "stroke-width": 1.2 })}${sh("circle", { cx: x, cy: y - h - 3, r: 3.2, fill: "#ff6f8f", stroke: "#d94a6c", "stroke-width": 1 })}`;
    const cup = (x, y, f, g) => `${sh("path", { d: `M${x - 8} ${y} L${x - 6} ${y - 9} H${x + 6} L${x + 8} ${y} Z`, fill: f, stroke: "#e3b77e", "stroke-width": 1.5, "stroke-linejoin": "round" })}${sh("ellipse", { cx: x, cy: y - 12, rx: 9, ry: 6, fill: g, stroke: "#f2a9bc", "stroke-width": 1.5 })}${sh("circle", { cx: x, cy: y - 18, r: 2.6, fill: "#ff6f8f" })}`;
    const vista = `${sh("rect", { x: 140, y: 14, width: 120, height: 100, fill: "#fff3ec" })}${sh("rect", { x: 140, y: 62, width: 120, height: 5, fill: "#e8c39a" })}${sh("rect", { x: 140, y: 92, width: 120, height: 5, fill: "#e8c39a" })}
      ${torta(170, 62, 24, 14, "#ffe9c4", "#ffd1dc", "#e3b77e")}${cup(204, 62, "#ffe2b8", "#ffd1dc")}${torta(234, 62, 24, 16, "#e9d4ff", "#fff", "#b9a0e6")}
      ${cup(166, 92, "#ffe2b8", "#c8efd6")}${torta(202, 92, 30, 18, "#ffd1dc", "#fff", "#f2a9bc")}${cup(238, 92, "#ffe2b8", "#fff3b0")}`;
    const bancone = `${sh("rect", { x: 2, y: 170, width: 104, height: 42, rx: 6, fill: "#ffc9d6", stroke: "#f2a9bc", "stroke-width": 2.4 })}${sh("path", { d: "M24 172 V210 M46 172 V210 M68 172 V210 M90 172 V210", stroke: "#fff", "stroke-width": 5, opacity: .7 })}${sh("rect", { x: -2, y: 164, width: 112, height: 8, rx: 4, fill: "#fff", stroke: "#e8d3c6", "stroke-width": 2.2 })}
      ${torta(36, 162, 26, 12, "#ffe9c4", "#ffd1dc", "#e3b77e")}${cup(76, 162, "#ffe2b8", "#c8efd6")}${sh("path", { d: "M14 162 Q14 134 36 134 Q58 134 58 162", fill: "#dff1fb", opacity: .55, stroke: "#9fc9e0", "stroke-width": 2 })}${sh("path", { d: "M22 144 q4 -6 11 -7", stroke: "#fff", "stroke-width": 2.2, fill: "none", "stroke-linecap": "round", opacity: .9 })}`;
    const forno = `${sh("rect", { x: 308, y: 132, width: 86, height: 80, rx: 10, fill: "#c8efd6", stroke: "#8fcfa8", "stroke-width": 2.4 })}${sh("rect", { x: 304, y: 124, width: 94, height: 10, rx: 5, fill: "#e8f7ef", stroke: "#8fcfa8", "stroke-width": 2 })}
      ${[326, 346, 366].map((x) => sh("circle", { cx: x, cy: 143, r: 4, fill: "#fff", stroke: "#8fcfa8", "stroke-width": 1.8 })).join("")}
      ${sh("rect", { x: 318, y: 152, width: 66, height: 52, rx: 8, fill: "#fff8f1", stroke: "#8fcfa8", "stroke-width": 2.2 })}${sh("rect", { x: 324, y: 164, width: 54, height: 34, rx: 5, fill: "#ffb86b", stroke: "#e58f3c", "stroke-width": 1.6 })}
      <g class="cs-fuoco">${sh("ellipse", { cx: 340, cy: 190, rx: 9, ry: 5, fill: "#ffe2b8", stroke: "#e3b77e", "stroke-width": 1.4 })}${sh("ellipse", { cx: 362, cy: 190, rx: 9, ry: 5, fill: "#ffd1dc", stroke: "#f2a9bc", "stroke-width": 1.4 })}${sh("ellipse", { cx: 351, cy: 176, rx: 12, ry: 5, fill: "#fff3c4", opacity: .7 })}</g>
      ${sh("rect", { x: 326, y: 156, width: 50, height: 4, rx: 2, fill: "#8fcfa8" })}${sh("rect", { x: 316, y: 210, width: 10, height: 5, rx: 2, fill: "#8fcfa8" })}${sh("rect", { x: 376, y: 210, width: 10, height: 5, rx: 2, fill: "#8fcfa8" })}`;
    const toque = (x, y, nastro) => `${sh("path", { d: `M${x} 22 V${y - 6}`, stroke: "#b07a55", "stroke-width": 1.6 })}${[-6.5, 0, 6.5].map((d, i) => sh("circle", { cx: x + d, cy: y - (i === 1 ? 4 : 1), r: 6.5, fill: "#fff", stroke: "#dccfc6", "stroke-width": 1.6 })).join("")}${sh("rect", { x: x - 9, y: y + 2, width: 18, height: 11, rx: 3, fill: "#fff", stroke: "#dccfc6", "stroke-width": 1.8 })}${nastro ? sh("path", { d: `M${x - 9} ${y + 8} H${x + 9}`, stroke: "#ff9db5", "stroke-width": 3 }) : ""}`;
    const cappelli = `${sh("path", { d: "M6 22 H50", stroke: "#b07a55", "stroke-width": 3, "stroke-linecap": "round" })}${toque(18, 44, true)}${toque(38, 42, false)}`;
    return { base: stanza("#ffe9ec", righe + tenda, "#ffd9de", scacchi, "#fff", "#f2c9d0"),
      finestra: finestra(u, "quadra", "#fff", "#f2a9bc", vista, true), fissi: `<g transform="translate(26 0)">${bancone}</g>` + forno + cappelli, luce: sh("circle", { cx: 351, cy: 178, r: 46, fill: "url(#casaAlone)" }) };
  },
  cameretta(u) {
    let pois = ""; for (let y = 34; y < 190; y += 34) for (let x = (y / 34 % 2) * 20 + 10; x < 400; x += 40) pois += sh("circle", { cx: x, cy: y, r: 2.4, fill: "#cfd0f0" });
    let assi = ""; for (let x = 0; x <= 400; x += 50) assi += `M${x} 199 L${x - (x - 200) * .25} 280 `; assi += "M0 226 H400 M0 254 H400";
    const palazzi = [[148, 70, 22, 44], [172, 56, 18, 58], [192, 78, 22, 36], [216, 62, 20, 52], [238, 74, 24, 40]];
    let finestrelle = ""; palazzi.forEach(([x, y, w, h], k) => { for (let j = 0; j < 4; j++) for (let i = 0; i < 3; i++) if ((i * 3 + j * 5 + k) % 3 !== 0 && y + 8 + j * 10 < 112) finestrelle += sh("rect", { x: x + 4 + i * 6, y: y + 8 + j * 10, width: 3.4, height: 4.6, rx: .8, fill: "#ffe28a" }); });
    const vista = `${sh("rect", { x: 140, y: 14, width: 120, height: 100, fill: "#a79de6" })}${sh("rect", { x: 140, y: 62, width: 120, height: 52, fill: "#f2b8cc" })}${sh("circle", { cx: 174, cy: 40, r: 8, fill: "#fff3c4" })}${stella(222, 34, 3, "#fff6d6", "#fff6d6", 1)}${stella(200, 50, 2.4, "#fff6d6", "#fff6d6", 1)}${stella(244, 52, 2.4, "#fff6d6", "#fff6d6", 1)}
      ${palazzi.map(([x, y, w, h]) => sh("rect", { x, y, width: w, height: h + 4, fill: "#5f5a9e" })).join("")}${sh("path", { d: "M172 56 L181 47 L190 56Z M216 62 L226 53 L236 62Z", fill: "#4a4585" })}${sh("rect", { x: 228, y: 50, width: 3, height: 7, fill: "#4a4585" })}${sh("path", { d: "M198 78 V68 M198 70 l-4 -2 M198 70 l4 -2", stroke: "#4a4585", "stroke-width": 1.4, fill: "none" })}${finestrelle}`;
    const letto = `${sh("rect", { x: 0, y: 160, width: 9, height: 52, rx: 3, fill: "#c79a6b", stroke: "#a6784a", "stroke-width": 2 })}${sh("rect", { x: 4, y: 202, width: 98, height: 10, rx: 3, fill: "#c79a6b", stroke: "#a6784a", "stroke-width": 2 })}
      ${sh("rect", { x: 8, y: 182, width: 94, height: 24, rx: 10, fill: "#9fd4ef", stroke: "#6fb0d6", "stroke-width": 2.2 })}${sh("path", { d: "M42 183 V205 M68 183 V205", stroke: "#fff", "stroke-width": 3, opacity: .7 })}${stella(86, 194, 6)}
      ${sh("rect", { x: 12, y: 170, width: 30, height: 16, rx: 8, fill: "#fff", stroke: "#dfe7f2", "stroke-width": 2 })}${sh("path", { d: "M18 176 q6 -3 12 0", stroke: "#dfe7f2", "stroke-width": 1.6, fill: "none" })}`;
    const neon = `${sh("path", { d: "M36 22 A18 18 0 1 0 38 60 A14 14 0 1 1 36 22Z", fill: "none", stroke: "#ff7aa8", "stroke-width": 3.2, "stroke-linejoin": "round" })}${sh("path", { d: "M36 22 A18 18 0 1 0 38 60 A14 14 0 1 1 36 22Z", fill: "none", stroke: "#fff", "stroke-width": 1, opacity: .7 })}${stella(44, 34, 4.2, "none", "#ff7aa8", 2)}${sh("path", { d: "M26 62 V70 M38 62 V70", stroke: "#b8b3dd", "stroke-width": 1.4 })}`;
    return { base: stanza("#dfe0f8", pois, "#ebd2b0", sh("path", { d: assi, stroke: "#d4b88f", "stroke-width": 2, fill: "none" }), "#c9c6ee", "#aeaae0"),
      finestra: finestra(u, "arco", "#f6f2ff", "#aeaae0", vista, true), fissi: `<g transform="translate(132 0) scale(-1 1)">${letto}</g>` + neon, luce: sh("circle", { cx: 32, cy: 42, r: 30, fill: "#ff9db5", opacity: .28 }) };
  },
  baita(u) {
    let assi = ""; for (let x = 25; x < 400; x += 25) assi += `M${x} 0 V190 `;
    let tavole = ""; for (let y = 216; y < 280; y += 20) tavole += `M0 ${y} H400 `; for (let x = 0; x <= 400; x += 64) tavole += `M${x} 199 L${x - (x - 200) * .3} 280 `;
    const travi = `${sh("rect", { x: 0, y: 0, width: 400, height: 14, fill: "#a8693f", stroke: "#8a5230", "stroke-width": 1.5 })}${sh("path", { d: "M0 14 L40 14 L0 54Z M400 14 L360 14 L400 54Z", fill: "#a8693f", stroke: "#8a5230", "stroke-width": 1.5, "stroke-linejoin": "round" })}`;
    const pino = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})">${sh("rect", { x: -2, y: 0, width: 4, height: 8, fill: "#8e6440" })}${sh("path", { d: "M0 -34 L14 -10 H6 L16 4 H-16 L-6 -10 H-14Z", fill: "#5aa17a", stroke: "#3f7f5c", "stroke-width": 1.4, "stroke-linejoin": "round" })}${sh("path", { d: "M0 -34 L6 -22 Q0 -19 -6 -22Z M-9 -8 Q-2 -5 5 -8 L6 -10 H-6Z", fill: "#fff" })}</g>`;
    let neve = ""; [[150, 24], [166, 44], [184, 30], [204, 50], [222, 26], [240, 42], [156, 70], [232, 66], [196, 18], [176, 60]].forEach(([x, y]) => { neve += sh("circle", { cx: x, cy: y, r: 1.8, fill: "#fff" }); });
    const vista = `${sh("rect", { x: 140, y: 14, width: 120, height: 100, fill: "#cfe6fb" })}${sh("path", { d: "M140 88 L168 46 L186 70 L212 32 L246 84 L260 68 V114 H140Z", fill: "#b3c4e6", stroke: "#97aad6", "stroke-width": 1.6, "stroke-linejoin": "round" })}
      ${sh("path", { d: "M168 46 L157 63 L164 60 L169 66 L175 59 L180 62Z M212 32 L198 54 L206 50 L212 57 L219 49 L226 54Z", fill: "#fff", stroke: "#e3ecf8", "stroke-width": 1, "stroke-linejoin": "round" })}
      ${sh("path", { d: "M140 98 Q190 84 260 96 V114 H140Z", fill: "#fff", stroke: "#e3ecf8", "stroke-width": 1.6 })}${pino(166, 98, .8)}${pino(232, 98, .9)}${neve}`;
    const stufa = `${sh("rect", { x: 340, y: 14, width: 12, height: 112, fill: "#8b8197", stroke: "#6b6477", "stroke-width": 2 })}${sh("rect", { x: 336, y: 108, width: 20, height: 8, rx: 2, fill: "#6b6477" })}
      ${sh("rect", { x: 312, y: 150, width: 70, height: 60, rx: 12, fill: "#ff8f8f", stroke: "#d95b6a", "stroke-width": 2.6 })}${sh("rect", { x: 308, y: 142, width: 78, height: 10, rx: 5, fill: "#8b8197", stroke: "#6b6477", "stroke-width": 2 })}
      ${sh("rect", { x: 326, y: 162, width: 42, height: 32, rx: 8, fill: "#4a2f3a", stroke: "#d95b6a", "stroke-width": 2.2 })}
      <g class="cs-fuoco">${sh("path", { d: "M334 192 Q332 178 340 170 Q342 180 346 176 Q346 168 352 164 Q352 178 358 184 Q360 190 356 192 Z", fill: "#ffab5c", stroke: "#f08a3c", "stroke-width": 1.4 })}${sh("path", { d: "M341 192 Q340 184 345 180 Q347 186 351 184 Q352 190 350 192Z", fill: "#ffe28a" })}</g>
      ${sh("rect", { x: 316, y: 208, width: 9, height: 6, rx: 2, fill: "#6b6477" })}${sh("rect", { x: 370, y: 208, width: 9, height: 6, rx: 2, fill: "#6b6477" })}
      ${sh("ellipse", { cx: 334, cy: 132, rx: 12, ry: 9, fill: "#c9b2ff", stroke: "#a38be0", "stroke-width": 2 })}${sh("path", { d: "M345 128 L354 120", stroke: "#a38be0", "stroke-width": 4, "stroke-linecap": "round" })}${sh("path", { d: "M325 124 H343", stroke: "#a38be0", "stroke-width": 3, "stroke-linecap": "round" })}${sh("path", { d: "M334 118 q-4 -6 0 -10 M341 117 q-4 -6 0 -10", stroke: "#cfc6c0", "stroke-width": 2, fill: "none", "stroke-linecap": "round", class: "cs-vapore" })}`;
    const panca = `${sh("rect", { x: 2, y: 190, width: 98, height: 9, rx: 3, fill: "#c79a6b", stroke: "#a6784a", "stroke-width": 2 })}${sh("path", { d: "M12 199 V212 M90 199 V212", stroke: "#a6784a", "stroke-width": 4, "stroke-linecap": "round" })}
      ${sh("rect", { x: 8, y: 170, width: 40, height: 21, rx: 6, fill: "#ff9b8a", stroke: "#e07a6a", "stroke-width": 2 })}${sh("path", { d: "M20 171 V190 M34 171 V190 M9 180 H47", stroke: "#fff", "stroke-width": 2.4, opacity: .8 })}
      ${sh("rect", { x: 44, y: 176 , width: 46, height: 15, rx: 6, fill: "#9fd4ef", stroke: "#6fb0d6", "stroke-width": 2 })}${sh("path", { d: "M56 177 V190 M70 177 V190 M45 183 H89", stroke: "#fff", "stroke-width": 2.2, opacity: .75 })}
      ${sh("rect", { x: 20, y: 160, width: 38, height: 11, rx: 5.5, fill: "#fff0c8", stroke: "#e8c76a", "stroke-width": 2 })}`;
    const lanterna = `${sh("path", { d: "M118 14 V30", stroke: "#6b6477", "stroke-width": 2 })}${sh("rect", { x: 109, y: 30, width: 18, height: 4, rx: 2, fill: "#6b6477" })}${sh("rect", { x: 111, y: 34, width: 14, height: 20, rx: 4, fill: "#ffe08a", stroke: "#e8bf5a", "stroke-width": 2 })}${sh("rect", { x: 109, y: 54, width: 18, height: 4, rx: 2, fill: "#6b6477" })}${sh("path", { d: "M118 36 V52", stroke: "#fff", "stroke-width": 1.6, opacity: .7 })}`;
    return { base: stanza("#d49a68", sh("path", { d: assi, stroke: "#b67c4c", "stroke-width": 2.4 }) + travi, "#c7986a", sh("path", { d: tavole, stroke: "#a97a4e", "stroke-width": 2 }), "#8e6440", "#74502f"),
      finestra: finestra(u, "quadra", "#f4e2c8", "#a8693f", vista, true), fissi: lanterna + stufa + `<g transform="translate(32 0)">${panca}</g>`,
      luce: sh("circle", { cx: 347, cy: 180, r: 50, fill: "url(#casaAlone)" }) + sh("circle", { cx: 118, cy: 44, r: 28, fill: "url(#casaAlone)" }) };
  }
};
// Stanza semplice per le casette che non hanno (ancora) un disegno loro
function casaSemplice(c, u) {
  const [muro, pav] = c[5] || ["#f3e9e2", "#e8d3bd"];
  return { base: stanza(muro, "", pav, "", "#ffffff", "#e6d6cb"), finestra: finestra(u, "quadra", "#fff", "#e6d6cb", sh("rect", { x: 140, y: 14, width: 120, height: 100, fill: "#cdeefe" }) + nuvoletta(200, 60, .8)), fissi: "" };
}

/* I mobili: stessi posti in ogni casetta. "dietro" = contro la parete (dietro la mascotte), "davanti" = in primo piano */
const DISEGNI_MOBILI = {
  lucine: { box: "0 0 400 50", strato: "parete", d() {
    let s = sh("path", { d: "M6 8 Q200 44 394 8", stroke: "#b99a8a", "stroke-width": 2, fill: "none" }), luce = "";
    const C = ["#ffd76a", "#ff9db5", "#9fd4ef", "#b7e39a"];
    for (let i = 1; i < 12; i++) { const t = i / 12, x = (1 - t) ** 2 * 6 + 2 * (1 - t) * t * 200 + t * t * 394, y = (1 - t) ** 2 * 8 + 2 * (1 - t) * t * 44 + t * t * 8;
      s += sh("rect", { x: (x - 2.5).toFixed(1), y: (y - 1).toFixed(1), width: 5, height: 4, rx: 1, fill: "#b99a8a" }) + sh("ellipse", { cx: x.toFixed(1), cy: (y + 7).toFixed(1), rx: 4.2, ry: 5.6, fill: C[i % 4], stroke: "rgba(74,47,58,.25)", "stroke-width": 1.2, class: "lucina" });
      luce += sh("circle", { cx: x.toFixed(1), cy: (y + 7).toFixed(1), r: 14, fill: "url(#casaAlone)" }); }
    return [s, luce]; } },
  quadretto: { box: "44 30 68 72", strato: "parete", d: () => [`${sh("path", { d: "M78 34 L62 50 M78 34 L94 50", stroke: "#c9a27a", "stroke-width": 1.6 })}${sh("circle", { cx: 78, cy: 34, r: 2.4, fill: "#c9a27a" })}
    ${sh("rect", { x: 52, y: 48, width: 52, height: 46, rx: 6, fill: "#f7d9a8", stroke: "#d9b27a", "stroke-width": 2.5 })}${sh("rect", { x: 59, y: 55, width: 38, height: 32, rx: 3, fill: "#dff3ff" })}
    ${sh("path", { d: "M59 80 Q70 70 80 78 Q88 72 97 78 V87 H59Z", fill: "#b7e39a" })}${sh("circle", { cx: 88, cy: 64, r: 5, fill: "#ffe28a" })}${sh("path", { d: "M70 80 V72", stroke: "#6fb874", "stroke-width": 1.6 })}${fiorellino(70, 70, 4.4, "#ff9db5")}`] },
  orologio: { box: "290 36 64 60", strato: "parete", d: () => [`${sh("circle", { cx: 309, cy: 51, r: 7, fill: "#ffd1dc", stroke: "#f2a9bc", "stroke-width": 2 })}${sh("circle", { cx: 335, cy: 51, r: 7, fill: "#ffd1dc", stroke: "#f2a9bc", "stroke-width": 2 })}
    ${sh("circle", { cx: 322, cy: 70, r: 21, fill: "#fff8f1", stroke: "#f2a9bc", "stroke-width": 3.5 })}${[0, 90, 180, 270].map((a) => sh("circle", { cx: (322 + Math.sin(a * Math.PI / 180) * 15).toFixed(1), cy: (70 - Math.cos(a * Math.PI / 180) * 15).toFixed(1), r: 1.8, fill: "#e5a6b2" })).join("")}
    ${sh("path", { d: "M322 70 V58 M322 70 L331 74", stroke: CINK, "stroke-width": 2.6, "stroke-linecap": "round" })}${sh("circle", { cx: 322, cy: 70, r: 2.4, fill: CINK })}${sh("path", { d: "M310 60 q4 -6 10 -7", stroke: "#fff", "stroke-width": 2.4, fill: "none", "stroke-linecap": "round", opacity: .8 })}`] },
  mensola: { box: "262 88 76 40", strato: "parete", d: () => [`${sh("rect", { x: 276, y: 96, width: 18, height: 20, rx: 6, fill: "#ffe2b8", stroke: "#e3b77e", "stroke-width": 2 })}${sh("rect", { x: 274, y: 92, width: 22, height: 6, rx: 2, fill: "#ff9db5", stroke: "#e57a98", "stroke-width": 1.6 })}
    ${sh("rect", { x: 302, y: 100, width: 15, height: 16, rx: 5, fill: "#d8f0ff", stroke: "#9fc9e0", "stroke-width": 2 })}${sh("rect", { x: 300, y: 97, width: 19, height: 5, rx: 2, fill: "#9ad88f", stroke: "#6fb874", "stroke-width": 1.6 })}
    ${sh("circle", { cx: 325, cy: 109, r: 6, fill: "#ffd1dc", stroke: "#f2a9bc", "stroke-width": 1.8 })}${sh("rect", { x: 268, y: 116, width: 66, height: 6, rx: 3, fill: "#e0bb8b", stroke: "#c4955a", "stroke-width": 2 })}${sh("path", { d: "M276 122 v6 M326 122 v6", stroke: "#c4955a", "stroke-width": 3, "stroke-linecap": "round" })}`] },
  libreria: { box: "4 96 70 120", strato: "dietro", d() {
    const libri = (y, cols) => { let x = 16, s = ""; cols.forEach(([c, h, w]) => { s += sh("rect", { x, y: y - h, width: w, height: h, rx: 2, fill: c, stroke: "rgba(74,47,58,.22)", "stroke-width": 1.3 }); x += w + 1.5; }); return s; };
    return [`${sh("rect", { x: 10, y: 112, width: 58, height: 100, rx: 6, fill: "#e8c39a", stroke: "#c99b6c", "stroke-width": 2.5 })}${sh("rect", { x: 15, y: 118, width: 48, height: 88, rx: 3, fill: "#f3dcbf" })}
      ${sh("path", { d: "M15 145 H63 M15 177 H63", stroke: "#c99b6c", "stroke-width": 2.5 })}
      ${libri(144, [["#ff9db5", 22, 7], ["#9fd4ef", 18, 8], ["#ffe28a", 24, 6], ["#b7e39a", 20, 9]])}${libri(176, [["#c9b2ff", 24, 8], ["#ffb48f", 20, 7], ["#9fd4ef", 26, 6], ["#ff9db5", 18, 8]])}${libri(205, [["#b7e39a", 22, 9], ["#ffe28a", 18, 8]])}
      ${sh("circle", { cx: 52, cy: 197, r: 8, fill: "#fff", stroke: "#e5a6b2", "stroke-width": 1.8 })}${sh("path", { d: "M46 104 L58 104 L56 112 L48 112Z", fill: "#ee9b72", stroke: "#d37a52", "stroke-width": 1.6 })}${foglia(52, 104, 12, -25)}${foglia(52, 104, 11, 30, "#b7e39a")}`]; } },
  lampada: { box: "340 90 56 126", strato: "dietro", d: () => [`${sh("ellipse", { cx: 370, cy: 211, rx: 14, ry: 4.5, fill: "#d9c2a8", stroke: "#b49a7e", "stroke-width": 2 })}${sh("rect", { x: 368, y: 124, width: 4, height: 86, rx: 2, fill: "#d9c2a8" })}
    ${sh("path", { d: "M352 128 L388 128 L380 100 Q370 94 360 100 Z", fill: "#ffe08a", stroke: "#e8bf5a", "stroke-width": 2.5, "stroke-linejoin": "round" })}${sh("path", { d: "M352 128 q4.5 5 9 0 q4.5 5 9 0 q4.5 5 9 0 q4.5 5 9 0", fill: "#ffd1dc", stroke: "#f2a9bc", "stroke-width": 1.6 })}${sh("path", { d: "M362 106 L358 122", stroke: "#fff", "stroke-width": 2.4, "stroke-linecap": "round", opacity: .8 })}`,
    sh("circle", { cx: 370, cy: 130, r: 62, fill: "url(#casaAlone)" })] },
  piantina: { box: "286 138 60 80", strato: "dietro", d: () => [`${[-58, -30, -4, 22, 48].map((a, i) => foglia(317, 184, 34 - Math.abs(a) * .12, a, i % 2 ? "#b7e39a" : "#9ad88f")).join("")}
    ${sh("path", { d: "M299 188 L335 188 L331 212 Q330 215 326 215 L308 215 Q304 215 303 212 Z", fill: "#ee9b72", stroke: "#d37a52", "stroke-width": 2.2 })}${sh("rect", { x: 295, y: 182, width: 44, height: 9, rx: 4, fill: "#f6b088", stroke: "#d37a52", "stroke-width": 2.2 })}${sh("circle", { cx: 317, cy: 202, r: 3, fill: "#fff", opacity: .6 })}`] },
  fiori: { box: "212 70 36 40", strato: "parete", d: () => [`${sh("path", { d: "M226 92 Q222 84 223 78 M232 92 V74 M238 92 Q242 84 241 80", stroke: "#6fb874", "stroke-width": 2, fill: "none" })}${fiorellino(223, 78, 7, "#ff9db5")}${fiorellino(232, 73, 7, "#ffe28a", "#ff9db5")}${fiorellino(241, 80, 6.5, "#c9b2ff")}
    ${sh("path", { d: "M224 92 H240 Q244 100 240 106 Q232 109 224 106 Q220 100 224 92Z", fill: "#b9e3f5", stroke: "#8cc4dc", "stroke-width": 2 })}${sh("path", { d: "M226 97 q2 4 0 7", stroke: "#fff", "stroke-width": 1.8, fill: "none", opacity: .8 })}`] },
  tappeto: { box: "98 244 204 36", strato: "tappeto", d: () => [`${sh("ellipse", { cx: 200, cy: 262, rx: 98, ry: 15, fill: "#ffd1dc", stroke: "#f2a9bc", "stroke-width": 2.5 })}${sh("ellipse", { cx: 200, cy: 262, rx: 82, ry: 10, fill: "none", stroke: "#fff", "stroke-width": 2.6, "stroke-dasharray": "7 6", opacity: .9 })}${sh("ellipse", { cx: 200, cy: 262, rx: 40, ry: 4.5, fill: "#ffe6ec" })}`] },
  cuscino: { box: "52 228 72 40", strato: "davanti", d: () => [`${sh("ellipse", { cx: 88, cy: 258, rx: 32, ry: 9, fill: "#cdbcf7", stroke: "#a993e6", "stroke-width": 2.2 })}${sh("path", { d: "M57 252 Q57 236 88 236 Q119 236 119 252 Q119 262 88 262 Q57 262 57 252Z", fill: "#e6dbff", stroke: "#a993e6", "stroke-width": 2.5 })}${sh("circle", { cx: 88, cy: 248, r: 3.2, fill: "#a993e6" })}${sh("path", { d: "M68 244 q8 -6 16 -6", stroke: "#fff", "stroke-width": 2.6, fill: "none", "stroke-linecap": "round", opacity: .85 })}`] },
  tavolino: { box: "314 206 62 72", strato: "davanti", d: () => [`<g transform="translate(18 10)">${sh("ellipse", { cx: 326, cy: 263, rx: 14, ry: 4, fill: "#e0bb8b", stroke: "#c4955a", "stroke-width": 2 })}${sh("rect", { x: 323, y: 234, width: 6, height: 28, rx: 2, fill: "#e0bb8b", stroke: "#c4955a", "stroke-width": 1.6 })}${sh("ellipse", { cx: 326, cy: 233, rx: 27, ry: 7.5, fill: "#f7d9a8", stroke: "#c4955a", "stroke-width": 2.2 })}
    ${sh("path", { d: "M318 210 q-4 -6 0 -10 M326 208 q-4 -6 0 -10", stroke: "#cfc6c0", "stroke-width": 2, fill: "none", "stroke-linecap": "round", class: "cs-vapore" })}
    ${sh("ellipse", { cx: 324, cy: 230, rx: 13, ry: 3.2, fill: "#fff", stroke: "#f2a9bc", "stroke-width": 1.6 })}${sh("path", { d: "M314 213 H334 L332 226 Q331 230 327 230 L321 230 Q317 230 316 226 Z", fill: "#fff", stroke: "#f2a9bc", "stroke-width": 2 })}${sh("path", { d: "M334 216 q7 0 6 6 q-1 4 -7 4", stroke: "#f2a9bc", "stroke-width": 2, fill: "none" })}
    ${sh("path", { d: "M324 222 l-3 -3 a2 2 0 0 1 3 -2.6 a2 2 0 0 1 3 2.6z", fill: "#ff9db5" })}</g>`] },
  cesto: { box: "2 226 54 52", strato: "davanti", d: () => [`${sh("circle", { cx: 20, cy: 244, r: 8.5, fill: "#ff9db5", stroke: "#e57a98", "stroke-width": 2 })}${sh("path", { d: "M14 240 q6 2 10 9 M18 237 q6 4 7 11", stroke: "#e57a98", "stroke-width": 1.4, fill: "none" })}
    ${sh("circle", { cx: 36, cy: 242, r: 9.5, fill: "#9fd4ef", stroke: "#6fb0d6", "stroke-width": 2 })}${sh("path", { d: "M29 238 q7 1 12 10 M33 234 q8 4 8 13", stroke: "#6fb0d6", "stroke-width": 1.4, fill: "none" })}${sh("path", { d: "M40 230 L48 252 M46 228 L44 252", stroke: "#c4955a", "stroke-width": 2, "stroke-linecap": "round" })}
    ${sh("path", { d: "M6 248 L50 248 L46 270 Q45 274 41 274 L15 274 Q11 274 10 270 Z", fill: "#e8c08a", stroke: "#c4955a", "stroke-width": 2.2 })}${sh("path", { d: "M9 256 H47 M10 264 H46 M18 249 V273 M28 249 V274 M38 249 V273", stroke: "#cf9f62", "stroke-width": 1.4 })}`] }
};
const STRATI = ["parete", "dietro", "tappeto", "davanti"];

let casaN = 0;
// La scena intera: stanza, finestra, oggetti fissi, mobili accesi, luci di sera, mascotte appoggiata a terra
const colora = (m, s, v) => { const A = COLORI_MOBILI[m]; return !v || !A || !A[v] ? s : s.replace(/#[0-9a-f]{6}/gi, (h) => { const i = A[0].indexOf(h.toLowerCase()); return i < 0 ? h : A[v][i]; }); };
function scenaCasa(id, { masc = CUSTOM.mascotte, mobili = null, conMascotte = true, sagoma = false, label = "", uovo = false, colori = CUSTOM.casa.colori } = {}) {
  const c = casaDi(id) || CASETTE[0], u = "c" + (++casaN);
  const dis = (DISEGNI_CASA[c[0]] || ((uu) => casaSemplice(c, uu)))(u);
  if (sagoma) return `<svg class="casa-svg sagoma" viewBox="0 0 400 280" aria-hidden="true">${sh("rect", { width: 400, height: 280, rx: 18, fill: "currentColor", opacity: .08 })}${sh("rect", { y: 196, width: 400, height: 84, fill: "currentColor", opacity: .06 })}<g class="sagoma-g">${dis.finestra}${dis.fissi}</g></svg>`;
  const accesi = (mobili || mobiliAccesi()).filter((m) => DISEGNI_MOBILI[m]);
  const strato = (s) => accesi.filter((m) => DISEGNI_MOBILI[m].strato === s).map((m) => `<g class="mob mob-${m}">${colora(m, DISEGNI_MOBILI[m].d()[0], colori[m] || 0)}</g>`).join("");
  const fd = conMascotte ? festaCasa() : null; // decorazione di festa: nel posto libero tra libreria e mascotte
  const luci = accesi.map((m) => DISEGNI_MOBILI[m].d()[1] || "").join("") + (dis.luce || "") + (fd ? fd[1] : "");
  let ms = "";
  if (conMascotte) {
    const vb = (MASC.list[masc] || MASC.list.mochi).viewBox;
    ms = `<g class="casa-masc" data-act="casa-poke">${withAcc(MASC.svg(masc), masc).replace("<svg ", `<svg x="128" y="112" width="144" height="156" preserveAspectRatio="xMidYMax meet" `).replace(/viewBox="[^"]*"/, `viewBox="${vb}"`)}</g>`;
  }
  return `<svg class="casa-svg" viewBox="0 0 400 280" role="img" aria-label="${esc(label || c[1])}" xmlns="http://www.w3.org/2000/svg">
    <g class="cs-stanza">${dis.base}${dis.finestra}${dis.fissi}${strato("parete")}${strato("dietro")}${fd ? `<g class="festa-casa">${fd[0]}</g>` : ""}${strato("tappeto")}${uovo && uovoVisibile("casa") ? uovoCasaSvg() : ""}</g>
    <g class="cs-luci">${luci}</g>${ms}<g class="cs-stanza">${strato("davanti")}</g></svg>`;
}
function mobiliAccesi() { const avuti = mobiliAvuti(); return MOBILI.map((m) => m[0]).filter((m) => avuti.includes(m) && !CUSTOM.casa.spenti.includes(m)); }
// icona di un mobile da solo (per l'elenco)
const iconaMobile = (m, chiuso) => `<svg class="mob-ico${chiuso ? " chiuso" : ""}" viewBox="${DISEGNI_MOBILI[m].box}" aria-hidden="true">${colora(m, DISEGNI_MOBILI[m].d()[0], chiuso ? 0 : CUSTOM.casa.colori[m] || 0)}</svg>`;

/* ---------- Pagina ---------- */
function openCasa() { if ($("#sheet").classList.contains("on")) closeSheet(); state.tab = "casa"; render(); window.scrollTo({ top: 0 }); }
function viewCasa() {
  const scelta = casaScelta(), c = casaDi(scelta), aperte = casetteAperte(), avuti = mobiliAvuti(), tot = serie().totali, b = bocconciniTot();
  const accesi = mobiliAccesi();
  const scena = `<div class="casa-scena">${scenaCasa(scelta, { uovo: true, label: `${c[1]}: ${MN()} è a casa${accesi.length ? `, con ${accesi.length} ${accesi.length === 1 ? "mobile" : "mobili"}` : ""}. Tocca la mascotte per salutarla` })}</div>`;
  const nomeCibo = mod("pancino") ? ["bocconcino", "bocconcini"] : ["cosa fatta", "cose fatte"];
  const scelte = `<div class="sec"><h2>Le casette</h2><span class="count">${aperte.length}/${CASETTE.length}</span></div>
    <div class="casa-scelte">${CASETTE.map((x) => {
      const ok = aperte.includes(x[0]), on = x[0] === scelta, mia = x[4].includes(CUSTOM.mascotte);
      return ok ? `<button class="casa-scelta ${on ? "on" : ""}" data-act="casa-scegli" data-v="${x[0]}" aria-pressed="${on}">${scenaCasa(x[0], { conMascotte: false, mobili: [], label: x[1] })}<b>${x[1]}</b><small>${on ? "Qui adesso" : mia ? `La casa di ${esc(MN())}` : "Tocca per andarci"}</small></button>`
        : `<div class="casa-scelta chiusa" role="group" aria-label="${x[1]}: si apre con ${x[3]} giorni attivi">${scenaCasa(x[0], { sagoma: true })}<span class="lucchetto" aria-hidden="true">🔒</span><b>${x[1]}</b><small>Ancora ${x[3] - tot} ${x[3] - tot === 1 ? "giorno attivo" : "giorni attivi"}</small></div>`;
    }).join("")}</div>`;
  const mobili = `<div class="sec"><h2>I mobili</h2><span class="count">${avuti.length}/${MOBILI.length}</span></div>
    <div class="casa-mobili">${MOBILI.map(([id, nome, soglia]) => {
      if (!avuti.includes(id)) return `<div class="pin-toggle mob-riga chiuso">${iconaMobile(id, true)}<span><b>${nome}</b><small>Tra ${soglia - b} ${soglia - b === 1 ? nomeCibo[0] : nomeCibo[1]}</small></span></div>`;
      const on = !CUSTOM.casa.spenti.includes(id);
      const sc = CUSTOM.casa.colori[id] || 0;
      const pallini = [0, 1, 2].map((i) => `<button type="button" class="mob-colore${i === sc ? " on" : ""}" data-act="casa-colore" data-v="${id}:${i}" aria-pressed="${i === sc}" aria-label="Colore ${i + 1} di ${nome}" style="--c:${COLORI_MOBILI[id][i][0]}"><span></span></button>`).join("");
      return `<div class="mob-item"><button class="pin-toggle mob-riga ${on ? "on" : ""}" data-act="casa-mobile" data-v="${id}" aria-pressed="${on}">${iconaMobile(id)}<span><b>${nome}</b><small>${on ? "In casa" : "Messo via"}</small></span><span class="sw2"></span></button><div class="mob-colori" role="group" aria-label="Colori di ${nome}">${pallini}</div></div>`;
    }).join("")}</div>
    <p class="hint casa-hint">I mobili arrivano in regalo spuntando le cose fatte. Le casette nuove si aprono con i giorni attivi della serie.</p>`;
  return `<div class="sec" style="margin-top:0"><h2><span class="emo">🏡 </span>La casetta di ${esc(MN())}</h2></div>
    <div class="split casa"><div class="col-main">${scena}${scelte}</div><div class="col-side">${mobili}</div></div>`;
}
// Sblocchi: si calcolano dai numeri e si salvano per sempre; una festa per ogni cosa nuova (una volta sola)
let sblocchiInCorso = false;
async function aggiornaSblocchi() {
  if (!mod("casa") || sblocchiInCorso) return;
  const tot = serie().totali, b = bocconciniTot(), h = CUSTOM.casa;
  const nuoveC = CASETTE.filter((c) => c[3] > 0 && tot >= c[3] && !h.casette.includes(c[0])).map((c) => c[0]);
  const nuoviM = MOBILI.filter((m) => b >= m[2] && !h.mobili.includes(m[0])).map((m) => m[0]);
  if (!nuoveC.length && !nuoviM.length) return;
  sblocchiInCorso = true;
  try { await saveCustom({ casa: { ...h, casette: [...h.casette, ...nuoveC], mobili: [...h.mobili, ...nuoviM] } }); } finally { sblocchiInCorso = false; }
  if (nuoviM.length) {
    const nomi = nuoviM.map((m) => MOBILI.find((x) => x[0] === m)[1].toLowerCase());
    setTimeout(() => { toast(nuoviM.length === 1 ? `🎁 Un regalo per la casetta: ${nomi[0]}` : `🎁 ${nuoviM.length} mobili nuovi per la casetta`); confetti(innerWidth / 2, innerHeight * .4, 16); }, 900);
  }
  if (nuoveC.length) setTimeout(() => whenSheetFree(() => {
    const x = casaDi(nuoveC[nuoveC.length - 1]);
    openSheet(`<div class="recap casa-festa"><div class="casa-scena mini">${scenaCasa(x[0], { label: x[1] })}</div>
      <h2 class="fred">${nuoveC.length === 1 ? `Nuova casetta: ${x[1]}!` : `${nuoveC.length} casette nuove!`}</h2>
      <div class="say">${nuoveC.length === 1 ? `Con ${x[3]} giorni attivi si è aperta una casetta nuova.` : `Si sono aperte: ${nuoveC.map((k) => casaDi(k)[1]).join(", ")}.`} ${esc(MN())} non vede l'ora di andarci.</div></div>
      <div class="actions"><button class="btn" data-act="close">Più tardi</button><button class="btn primary" data-act="casa-vai" data-v="${x[0]}">Andiamo!</button></div>`);
    confetti(innerWidth / 2, innerHeight * .35, 40); suona("notifica"); cheer(2000);
  }), 1600);
}
// tocco lungo sulla mascotte in alto: si va alla casetta
(function toccoLungo() {
  let t = 0, lungo = 0;
  document.addEventListener("pointerdown", (e) => { if (!e.target.closest("#topMascot") || !mod("casa")) return; clearTimeout(t); t = setTimeout(() => { lungo = Date.now(); openCasa(); }, 550); });
  ["pointerup", "pointercancel", "pointerleave"].forEach((ev) => document.addEventListener(ev, () => clearTimeout(t)));
  document.addEventListener("click", (e) => { if (Date.now() - lungo < 600 && e.target.closest("#topMascot")) { e.stopPropagation(); e.preventDefault(); } }, true);
  document.addEventListener("contextmenu", (e) => { if (e.target.closest("#topMascot")) e.preventDefault(); });
})();

/* =========================================================
   SERIE DI GIORNI
   Un giorno è "attivo" se hai spuntato almeno una cosa da fare o un appuntamento (giorno del dispositivo).
   Regola del riposo: in ogni settimana (da lunedì a domenica) un giorno saltato non spezza la serie, il secondo sì.
   Oggi non ancora attivo non spezza niente: c'è tempo fino a mezzanotte.
   I giorni si salvano a parte (tabella giorni_attivi, o il dispositivo in modalità prova):
   eliminare o togliere la spunta a una voce non cancella i giorni già fatti.
   ========================================================= */
const TRAGUARDI_SERIE = [3, 7, 14, 30, 50, 100, 200, 365];
const domani = () => ymd(addDays(new Date(), 1));
const giornoValido = (g) => validYmd(g) && g >= "2000-01-01" && g <= domani();
const chiaveGiorni = (k) => `mochi.${k}.${store.user?.id || "local"}`;
// Giorni attivi che si ricavano dalle voci spuntate da me (anche nelle liste condivise: conta chi ha spuntato)
const giorniDaVoci = () => bocconcini().map((i) => ymd(new Date(i.done_at))).filter(giornoValido);
function giorniCache() {
  const c = ONLINE_MODE ? LS.get(chiaveGiorni("giorniCache"), []) : LS.get("mochi.giorniAttivi", []);
  return (Array.isArray(c) ? c : []).map(str).filter(giornoValido);
}
const GiorniStore = {
  // tutti i giorni salvati (a pagine da 1000: il server non ne manda di più in una volta)
  async carica() {
    if (!ONLINE_MODE) return giorniCache();
    const out = [];
    for (let da = 0; da < 12000; da += 1000) {
      const { data, error } = await store.sb.from("giorni_attivi").select("giorno").order("giorno").range(da, da + 999);
      if (error) throw error;
      (data || []).forEach((r) => out.push(str(r.giorno).slice(0, 10)));
      if (!data || data.length < 1000) break;
    }
    return out.filter(giornoValido);
  },
  // aggiunge i giorni (quelli che ci sono già restano come sono)
  async aggiungi(giorni) {
    if (!ONLINE_MODE) return;
    for (let i = 0; i < giorni.length; i += 500) {
      const righe = giorni.slice(i, i + 500).map((giorno) => ({ user_id: store.user.id, giorno }));
      const { error } = await store.sb.from("giorni_attivi").upsert(righe, { onConflict: "user_id,giorno", ignoreDuplicates: true });
      if (error) throw error;
    }
  }
};
function salvaGiorniLocali() {
  const tutti = [...state.giorni].sort();
  if (ONLINE_MODE) LS.set(chiaveGiorni("giorniCache"), tutti); else LS.set("mochi.giorniAttivi", tutti);
}
// Manda al server i giorni che non ha ancora; se non ci riesce (offline) li tiene da parte e riprova al prossimo caricamento
let invioGiorni = Promise.resolve();
const erroreDiRete = (e) => !!e?.network || /fetch|network|Failed|Load failed|timeout/i.test(String(e?.message || e || ""));
function inviaGiorni(giorni) {
  if (!ONLINE_MODE || !store.user) return invioGiorni;
  invioGiorni = invioGiorni.then(async () => {
    const k = chiaveGiorni("giorniDaInviare");
    const tutti = [...new Set([...LS.get(k, []), ...giorni].map(str).filter(giornoValido))].sort();
    if (!tutti.length) return;
    try { await GiorniStore.aggiungi(tutti); LS.set(k, []); }
    catch (e) {
      // senza rete: si tiene tutto e si riprova più tardi
      if (erroreDiRete(e)) { LS.set(k, tutti.slice(-2000)); return; }
      // il server ha rifiutato il lotto (es. un giorno "nel futuro" per l'orologio sbagliato):
      // si riprova un giorno alla volta, così i giorni buoni arrivano e quelli rifiutati si scartano
      const resta = [];
      for (const g of tutti) {
        try { await GiorniStore.aggiungi([g]); }
        catch (e2) { if (erroreDiRete(e2)) resta.push(g); else console.warn("Giorno attivo rifiutato dal server, scartato:", g, e2?.message || e2); }
      }
      LS.set(k, resta.slice(-2000));
    }
  });
  return invioGiorni;
}
/* All'avvio: giorni conosciuti (cache) + giorni ricavati dalle voci già spuntate (recupero una tantum, si può rifare
   senza danni) + quelli rimasti da inviare; poi quelli del server. Restituisce true se è cambiato qualcosa. */
async function caricaGiorni() {
  const prima = state.giorni;
  const daInviare = ONLINE_MODE ? LS.get(chiaveGiorni("giorniDaInviare"), []) : [];
  const conosciuti = new Set([...giorniCache(), ...(Array.isArray(daInviare) ? daInviare : []).map(str), ...(mod("serie") ? giorniDaVoci() : [])].filter(giornoValido));
  state.giorni = conosciuti;
  if (!ONLINE_MODE) { salvaGiorniLocali(); return !stessiGiorni(prima, state.giorni); }
  if (!store.user) return false;
  let server;
  try { server = new Set(await GiorniStore.carica()); } catch { salvaGiorniLocali(); return !stessiGiorni(prima, state.giorni); }
  const mancanti = [...conosciuti].filter((g) => !server.has(g));
  state.giorni = new Set([...server, ...conosciuti]);
  salvaGiorniLocali();
  if (mancanti.length && mod("serie")) await inviaGiorni(mancanti);
  return !stessiGiorni(prima, state.giorni);
}
const stessiGiorni = (a, b) => a.size === b.size && [...a].every((g) => b.has(g));
// Oggi hai spuntato qualcosa: il giorno diventa attivo (una volta sola) e magari arriva un traguardo
function giornoFatto() {
  if (!mod("serie")) return;
  const g = todayStr(); if (state.giorni.has(g)) return;
  const prima = serie().attuale;
  state.giorni = new Set([...state.giorni, g]); salvaGiorniLocali(); inviaGiorni([g]);
  festaSerie(prima);
}
// Numeri di giorno senza ore: niente sorprese con l'ora legale o i fusi
const numGiorno = (g) => Date.UTC(+g.slice(0, 4), +g.slice(5, 7) - 1, +g.slice(8, 10)) / 864e5;
const daNumGiorno = (n) => new Date(n * 864e5).toISOString().slice(0, 10);
const settimanaDi = (n) => Math.floor((n + 3) / 7);
const fineSettimana = (n) => ((n + 3) % 7 + 7) % 7 >= 5; // sabato e domenica (0 = lunedì) // le settimane iniziano di lunedì (il giorno 0 era un giovedì)
/* Calcolo della serie (funzione pura, riusabile: servirà anche per le casette).
   Restituisce: attuale, record, totali (giorni attivi di sempre), riposiSettimana (0 o 1), settimana (7 pallini lun-dom),
   maxPerMese ({ "2026-11": serie più lunga raggiunta in quel mese }) */
function calcolaSerie(giorni, oggi = todayStr()) {
  const nOggi = numGiorno(oggi), set = new Set();
  for (const g of giorni) if (validYmd(g)) { const n = numGiorno(g); if (Number.isFinite(n) && n <= nOggi) set.add(n); }
  const nums = [...set].sort((a, b) => a - b), sOggi = settimanaDi(nOggi), lun = sOggi * 7 - 3;
  const r = { attuale: 0, record: 0, totali: nums.length, riposiSettimana: 0, settimana: [], maxPerMese: {} };
  const riposi = {}, stati = {};
  let run = 0;
  if (nums.length) for (let n = nums[0]; n <= nOggi; n++) {
    const w = settimanaDi(n); let st;
    if (set.has(n)) { run++; st = "fatto"; }                                 // anche sabato e domenica, se attivi, contano
    else if (fineSettimana(n)) st = "weekend";                               // sabato e domenica vuoti: neutri, non rompono e non usano il riposo
    else if (n === nOggi) st = "oggi";                                      // c'è tempo fino a mezzanotte
    else if (run > 0 && !riposi[w]) { riposi[w] = 1; st = "riposo"; }       // il giorno di riposo della settimana (solo lun-ven)
    else { run = 0; st = "saltato"; }
    if (run > r.record) r.record = run;
    const mk = daNumGiorno(n).slice(0, 7); if (!(r.maxPerMese[mk] >= run)) r.maxPerMese[mk] = run;
    if (n >= lun) stati[n] = st;
  }
  r.attuale = run; r.riposiSettimana = riposi[sOggi] || 0;
  for (let i = 0; i < 7; i++) { const n = lun + i; r.settimana.push({ g: daNumGiorno(n), stato: stati[n] || (fineSettimana(n) ? "weekend" : n > nOggi ? "futuro" : n === nOggi ? "oggi" : "saltato"), oggi: n === nOggi }); }
  return r;
}
// La serie di adesso (ricalcolata solo quando cambiano i giorni o la data)
let serieMemo = { set: null, n: -1, oggi: "", r: null };
function serie() {
  const oggi = todayStr();
  if (serieMemo.set !== state.giorni || serieMemo.n !== state.giorni.size || serieMemo.oggi !== oggi) serieMemo = { set: state.giorni, n: state.giorni.size, oggi, r: calcolaSerie(state.giorni, oggi) };
  return serieMemo.r;
}
const LETTERE_SETT = ["L", "M", "M", "G", "V", "S", "D"];
const NOMI_STATO = { fatto: "fatto", riposo: "giorno di riposo", oggi: "oggi, ancora da fare", saltato: "saltato", futuro: "deve ancora arrivare", weekend: "fine settimana libero" };
const lunaSvg = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.6 2.6a5.6 5.6 0 1 0 2.8 9.7A6.3 6.3 0 0 1 10.6 2.6z"/></svg>`;
function pallini(s, grande = false) {
  return `<span class="serie-sett ${grande ? "grande" : ""}">${s.settimana.map((d, i) => `<span class="sd-g ${d.oggi ? "oggi" : ""}"${grande ? ` aria-label="${GIORNI[(i + 1) % 7]}: ${NOMI_STATO[d.stato]}"` : ""}><i class="sd ${d.stato}${d.oggi ? " oggi" : ""}">${d.stato === "fatto" ? "✓" : d.stato === "riposo" ? lunaSvg : ""}</i><small>${LETTERE_SETT[i]}</small></span>`).join("")}</span>`;
}
function serieTesti(s) {
  const oggiFatto = state.giorni.has(todayStr());
  if (s.attuale > 0) return {
    n: s.attuale, titolo: s.attuale === 1 ? "giorno di fila" : "giorni di fila",
    sotto: !oggiFatto ? `Spunta una cosa oggi e arrivi a ${s.attuale + 1}` : s.record > s.attuale ? `Il tuo record: ${s.record} giorni` : s.attuale >= 2 ? "È il tuo record!" : "Si comincia! Domani si continua"
  };
  if (s.record > 0) return { n: 0, titolo: "Si ricomincia da 1", sotto: `Il record resta tuo: ${s.record} ${s.record === 1 ? "giorno" : "giorni"}` };
  return { n: 0, titolo: "Inizia la tua serie", sotto: "Spunta una cosa fatta: è il primo giorno" };
}
// Adesivo in Oggi: numero, record e pallini della settimana; si tocca per i dettagli
function serieCard() {
  const s = serie(), t = serieTesti(s);
  return `<button class="serie-card" data-act="serie-apri" aria-label="Serie di giorni: ${t.n} ${t.titolo}. ${t.sotto}. Tocca per i dettagli">
    <span class="serie-top"><span class="serie-n" aria-hidden="true">${t.n}</span>
      <span class="serie-txt" aria-hidden="true"><b>${t.titolo}</b><small>${t.sotto}</small></span><span class="serie-freccia" aria-hidden="true">›</span></span>
    <span aria-hidden="true">${pallini(s)}</span></button>`;
}
function apriSerie() {
  const s = serie(), t = serieTesti(s);
  openSheet(`<h2><span class="mbox">${mascot(s.attuale ? "happy" : "")}</span>La tua serie</h2>
    <div class="serie-numeri">
      <div><b>${s.attuale}</b><span>${s.attuale === 1 ? "giorno di fila" : "giorni di fila"}</span></div>
      <div><b>${s.record}</b><span>il tuo record</span></div>
      <div><b>${s.totali}</b><span>${s.totali === 1 ? "giorno attivo" : "giorni attivi"} in tutto</span></div>
    </div>
    <p class="serie-frase">${esc(t.sotto)}</p>
    <div class="sec"><h2>Questa settimana</h2></div>
    ${pallini(s, true)}
    <div class="serie-legenda"><span><i class="sd fatto">✓</i>Fatto</span><span><i class="sd riposo">${lunaSvg}</i>Riposo</span><span><i class="sd oggi"></i>Oggi</span><span><i class="sd weekend"></i>Weekend libero</span></div>
    <p class="serie-riposo">${s.riposiSettimana ? "Il giorno di riposo di questa settimana l'hai già usato: se salti un altro giorno dal lunedì al venerdì, si ricomincia da 1." : "Il giorno di riposo di questa settimana è ancora libero."}</p>
    <div class="sec"><h2>Come funziona</h2></div>
    <p class="serie-spiega">Un giorno conta quando spunti almeno una cosa da fare o un appuntamento. <b>Il fine settimana non conta</b>: se ti riposi sabato e domenica la serie resta (e se fai qualcosa, vale come un giorno in più). E in settimana hai anche <b>un giorno di riposo</b>: se salti un giorno dal lunedì al venerdì, la serie non si spezza. Se ne salti due nella stessa settimana si ricomincia da 1, ma il record resta tuo. Togliere una spunta o eliminare una voce non cancella i giorni già fatti.</p>
    <div class="sec"><h2>Traguardi</h2></div>
    <div class="serie-trag">${TRAGUARDI_SERIE.map((n) => `<span class="${s.record >= n ? "on" : ""}">${n}</span>`).join("")}</div>
    <div class="actions"><button class="btn primary" data-act="close">Ok</button></div>`);
}
// Festa ai traguardi (3, 7, 14...): una volta sola per traguardo su questo dispositivo
function festaSerie(prima) {
  if (!mod("serie")) return;
  const s = serie(); if (s.attuale <= prima) return;
  const t = TRAGUARDI_SERIE.find((n) => n === s.attuale); if (!t) return;
  const k = "mochi.serie.feste." + (store.user?.id || "local"), viste = LS.get(k, []);
  if (!Array.isArray(viste) || viste.includes(t)) return;
  LS.set(k, [...viste, t]);
  const frase = { 3: "Tre giorni di fila: sta nascendo un'abitudine.", 7: "Una settimana intera! Un passo alla volta, ogni giorno.", 14: "Due settimane di fila. Che costanza!", 30: "Un mese intero di giorni attivi. Fantastico!", 365: "Un anno intero. Non ci sono parole: solo coriandoli!" }[t] || `${t} giorni di fila: sei davvero costante.`;
  setTimeout(() => whenSheetFree(() => {
    openSheet(`<div class="recap"><div class="mbox">${mascot("happy")}</div>
      <h2 class="fred">${t} giorni di fila!</h2>
      <div class="say">${esc(frase)} ${esc(MN())} è fiera di te 💗</div></div>
      <div class="actions"><button class="btn primary" data-act="close">Evviva!</button></div>`);
    confetti(innerWidth / 2, innerHeight * 0.35, 40); suona("notifica"); cheer(2000);
  }), 1400);
}

/* =========================================================
   CONCENTRAZIONE
   Un timer con l'app aperta: la mascotte lavora e accanto una piantina cresce in 5 stadi.
   Il tempo si calcola dagli orari (non da un contatore): se l'app va in sottofondo e torna, il timer è giusto.
   Lo schermo resta acceso dove si può (Screen Wake Lock). Le sessioni finite (la "serra") restano su questo dispositivo.
   ========================================================= */
const FOCUS_DURATE = [15, 25, 45], FOCUS_PAUSA = 5;
const focusPrep = {
  min: FOCUS_DURATE.includes(LS.get("mochi.focus.durata", 25)) ? LS.get("mochi.focus.durata", 25) : 25,
  pausaDopo: LS.get("mochi.focus.pausaDopo", false) === true, voce: ""
};
let focusS = null, focusT = 0, wakeLock = null;
// Sessione salvata: si controlla tutto (arriva dal dispositivo, ma meglio non fidarsi)
function cleanFocus(o) {
  if (!o || typeof o !== "object") return null;
  const fase = o.fase === "pausa" ? "pausa" : o.fase === "lavoro" ? "lavoro" : null;
  const stato = ["corre", "ferma", "finita"].includes(o.stato) ? o.stato : null;
  const min = fase === "pausa" ? FOCUS_PAUSA : FOCUS_DURATE.includes(o.min) ? o.min : null;
  if (!fase || !stato || !min || typeof o.id !== "string" || !RE_STID.test(o.id)) return null;
  const ora = Date.now(), fineAt = Number(o.fineAt), resta = Number(o.resta);
  if (!Number.isFinite(fineAt) || fineAt > ora + min * 60000 + 5000 || fineAt < ora - 2 * 864e5) return null;
  return { id: o.id, fase, stato, min, fineAt, resta: Number.isFinite(resta) ? Math.min(Math.max(0, resta), min * 60000) : 0,
    pausaDopo: o.pausaDopo === true, voce: typeof o.voce === "string" && RE_ID.test(o.voce) ? o.voce : "", fatta: o.fatta === true };
}
const salvaFocus = () => { if (focusS) LS.set("mochi.focus.sessione", focusS); else localStorage.removeItem("mochi.focus.sessione"); };
const focusInCorso = () => !!focusS && focusS.fase === "lavoro" && focusS.stato !== "finita";
const restaMs = () => (!focusS ? 0 : focusS.stato === "ferma" ? focusS.resta : focusS.stato === "finita" ? 0 : Math.max(0, focusS.fineAt - Date.now()));
const fmtTempo = (ms) => { const s = Math.ceil(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
// 0 seme, 1 germoglio, 2 foglioline, 3 piantina, 4 bocciolo, 5 fiore (a sessione finita)
const stadioPianta = () => !focusS ? 0 : focusS.fase === "pausa" || focusS.stato === "finita" ? 5 : Math.min(4, Math.floor((1 - restaMs() / (focusS.min * 60000)) * 5));
// La serra: una piantina per ogni sessione finita { g: giorno, m: minuti, id }
function serraCarica() {
  const a = LS.get("mochi.focus.serra", []);
  return (Array.isArray(a) ? a : []).filter((x) => x && validYmd(x.g) && FOCUS_DURATE.includes(x.m) && typeof x.id === "string" && RE_STID.test(x.id)).slice(-2000);
}
const serraDi = (g) => serraCarica().filter((x) => x.g === g);
const fmtMinuti = (m) => (m < 60 ? `${m} ${m === 1 ? "minuto" : "minuti"}` : fmtOre(m));

/* La piantina in vaso, disegnata a mano: contorno da cartone, vaso di terracotta, foglie che spuntano a ogni stadio */
function piantaSvg(st, mini = false) {
  const INK = "#4a2f3a", stelo = [0, 74, 62, 50, 40, 40][st];
  const foglia = (x, y, verso, sc = 1, cls = "") => `<path class="${cls}" d="M${x} ${y} c ${verso * 6 * sc} ${-9 * sc}, ${verso * 17 * sc} ${-9 * sc}, ${verso * 20 * sc} ${-3 * sc} c ${-verso * 6 * sc} ${7 * sc}, ${-verso * 15 * sc} ${8 * sc}, ${-verso * 20 * sc} ${3 * sc} z" fill="#9ad88f" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>`;
  let su = "";
  if (st === 0) su = `<ellipse class="cresce" cx="60" cy="85" rx="6.5" ry="4.5" fill="#c99560" stroke="${INK}" stroke-width="2.4"/>`;
  else {
    su = `<path d="M60 89 C 59 ${(89 + stelo) / 2}, 61 ${(89 + stelo) / 2}, 60 ${stelo}" stroke="#5aa86a" stroke-width="4.5" stroke-linecap="round" fill="none"/>`;
    if (st >= 1) su += foglia(60, stelo + 3, -1, st === 1 ? .7 : 1, st === 1 ? "cresce" : "") + foglia(60, stelo + 3, 1, st === 1 ? .7 : 1, st === 1 ? "cresce" : "");
    if (st >= 3) su += foglia(60, 74, -1, .9, st === 3 ? "cresce" : "") + foglia(60, 70, 1, .9, st === 3 ? "cresce" : "");
    if (st === 4) su += `<g class="cresce"><ellipse cx="60" cy="33" rx="7" ry="10" style="fill:var(--pink)" stroke="${INK}" stroke-width="2.4"/><path d="M53 38 q7 6 14 0" fill="#9ad88f" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/></g>`;
    if (st === 5) {
      let petali = "";
      for (let p = 0; p < 6; p++) { const a = (p / 6) * Math.PI * 2; petali += `<ellipse cx="${(60 + Math.cos(a) * 10).toFixed(1)}" cy="${(30 + Math.sin(a) * 10).toFixed(1)}" rx="8" ry="6.2" transform="rotate(${Math.round(a * 180 / Math.PI)} ${(60 + Math.cos(a) * 10).toFixed(1)} ${(30 + Math.sin(a) * 10).toFixed(1)})" style="fill:var(--pink)" stroke="${INK}" stroke-width="2.2"/>`; }
      su += `<g class="${mini ? "" : "cresce"}">${petali}<circle cx="60" cy="30" r="6.5" fill="#ffd76a" stroke="${INK}" stroke-width="2.2"/></g>`;
    }
  }
  return `<svg class="pianta${mini ? " mini" : ""}" viewBox="14 10 92 138" aria-hidden="true">
    <g class="pianta-su">${su}</g>
    <path d="M29 99 L91 99 L84 139 Q83 144 78 144 L42 144 Q37 144 36 139 Z" fill="#ee9b72" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
    <rect x="23" y="87" width="74" height="15" rx="5" fill="#f6b088" stroke="${INK}" stroke-width="3"/>
    <ellipse cx="60" cy="88.5" rx="31" ry="3.6" fill="#7b5444"/>
    <path d="M39 108 L37 128" stroke="#fff" stroke-width="3.5" stroke-linecap="round" opacity=".45"/></svg>`;
}
const voceFocus = () => (focusS?.voce ? state.items.find((i) => i.id === focusS.voce) || null : null);
// Pagina "Concentrazione"
function viewFocus() {
  const s = focusS, oggi = serraDi(todayStr());
  const sett = (() => { const lun = addDays(new Date(), -((new Date().getDay() + 6) % 7)), da = ymd(lun); return serraCarica().filter((x) => x.g >= da && x.g <= todayStr()); })();
  const serra = `<div class="sec"><h2>La serra</h2>${oggi.length ? `<span class="count">${oggi.length} oggi</span>` : ""}</div>
    <div class="serra">${oggi.length ? `<div class="serra-vasi">${oggi.slice(0, 12).map(() => piantaSvg(5, true)).join("")}${oggi.length > 12 ? `<span class="serra-piu">+${oggi.length - 12}</span>` : ""}</div>` : `<p class="serra-vuota">Ogni sessione finita lascia qui una piantina fiorita.</p>`}
      <p class="serra-sett">Questa settimana: <b>${sett.length}</b> ${sett.length === 1 ? "piantina" : "piantine"} · <b>${fmtMinuti(sett.reduce((a, x) => a + x.m, 0))}</b> di concentrazione</p></div>`;
  const avviso = `<p class="focus-avviso">Tieni l'app aperta: se esci il timer continua, ma non ti posso avvisare quando finisce.</p>`;
  let main;
  if (!s) {
    const aperte = state.items.filter((i) => i.kind === "todo" && !i.done).sort(byDue).slice(0, 60);
    if (focusPrep.voce && !aperte.some((i) => i.id === focusPrep.voce)) focusPrep.voce = "";
    main = `<div class="focus-scena pronta"><span class="mbox">${mascot()}</span>${piantaSvg(0)}</div>
      <div class="field"><label id="fdLab">Quanto tempo?</label><div class="focus-durate" role="group" aria-labelledby="fdLab">${FOCUS_DURATE.map((m) => `<button class="${focusPrep.min === m ? "on" : ""}" data-act="focus-durata" data-v="${m}" aria-pressed="${focusPrep.min === m}"><b>${m}</b><small>minuti</small></button>`).join("")}</div></div>
      <div class="field"><button class="pin-toggle ${focusPrep.pausaDopo ? "on" : ""}" data-act="focus-pausa-dopo" aria-pressed="${focusPrep.pausaDopo}"><span class="e">☕</span><span><b>Poi una pausa di ${FOCUS_PAUSA} minuti</b><small>Alla fine ti propongo di staccare un attimo</small></span><span class="sw2"></span></button></div>
      <div class="field"><label id="fvLab">Su cosa ti concentri? <span class="facolt">(se vuoi)</span></label>
        <select class="input" id="focusVoce" aria-labelledby="fvLab"><option value="">Niente in particolare</option>${aperte.map((i) => `<option value="${esc(i.id)}" ${focusPrep.voce === i.id ? "selected" : ""}>${esc(taglia(i.title, 70))}</option>`).join("")}</select></div>
      <button class="btn primary focus-via" data-act="focus-inizia">Inizia ${focusPrep.min} minuti</button>${avviso}`;
  } else {
    const v = voceFocus(), pausa = s.fase === "pausa", fine = s.stato === "finita";
    const titolo = fine ? (pausa ? "La pausa è finita" : `Fatto! ${s.min} minuti di concentrazione`) : pausa ? `Pausa di ${FOCUS_PAUSA} minuti` : s.stato === "ferma" ? "In pausa" : `${s.min} minuti di concentrazione`;
    const sotto = fine ? (pausa ? "Quando vuoi, si ricomincia." : `La piantina è fiorita ed è andata nella serra.${s.pausaDopo && !pausa ? ` Ora ${FOCUS_PAUSA} minuti di pausa?` : ""}`)
      : pausa ? "Alzati, sgranchisciti, bevi un sorso d'acqua." : v ? `Su: <b>${esc(v.title)}</b>` : `${esc(MN())} lavora con te in silenzio.`;
    const pct = Math.round((1 - restaMs() / (s.min * 60000)) * 100);
    const azioni = fine
      ? `<button class="btn" data-act="focus-basta">Basta così</button>${!pausa && s.pausaDopo ? `<button class="btn primary" data-act="focus-pausa-breve">Fai una pausa</button>` : `<button class="btn primary" data-act="focus-inizia">Ricomincia</button>`}`
      : pausa ? `<button class="btn primary" data-act="focus-basta">Salta la pausa</button>`
      : `<button class="btn" data-act="focus-termina">Termina</button>${s.stato === "ferma" ? `<button class="btn primary" data-act="focus-riprendi">Riprendi</button>` : `<button class="btn primary" data-act="focus-ferma">Pausa</button>`}`;
    main = `<div class="focus-scena ${fine ? "fine" : pausa ? "relax" : s.stato === "ferma" ? "ferma" : "lavora"}">
        <span class="mbox">${mascot(fine ? "happy" : !pausa && s.stato === "corre" ? "lavora" : "")}</span><span id="focusPianta" data-s="${stadioPianta()}">${piantaSvg(stadioPianta())}</span></div>
      <div class="focus-tempo-box"><h2 class="focus-titolo">${titolo}</h2>
        ${fine ? "" : `<div class="focus-tempo" id="focusTempo" role="timer" aria-label="Tempo che resta">${fmtTempo(restaMs())}</div>
        <span class="pc-bar focus-bar"><i id="focusBar" style="width:${pct}%"></i></span>`}
        <p class="focus-sotto">${sotto}</p></div>
      ${fine && !pausa && v ? (v.done ? `<p class="focus-voce fatta">✓ <b>${esc(v.title)}</b> è spuntata</p>` : `<div class="focus-voce"><span>Hai finito <b>${esc(v.title)}</b>?</span><button class="fbtn" data-act="focus-spunta">Sì, spuntala</button></div>`) : ""}
      <div class="actions focus-azioni">${azioni}</div>${fine ? "" : avviso}`;
  }
  return `<div class="sec" style="margin-top:0"><h2><span class="emo">🪴 </span>Concentrazione</h2></div>
    <div class="split focus"><div class="col-main">${main}</div><div class="col-side">${serra}</div></div>`;
}
document.addEventListener("change", (e) => { if (e.target.id === "focusVoce") focusPrep.voce = RE_ID.test(e.target.value) ? e.target.value : ""; });
// Ogni secondo: aggiorna solo il tempo, la barra e (se serve) la piantina. La pagina non si ridisegna.
function focusTick() {
  if (!focusS) return;
  if (focusS.stato === "corre" && Date.now() >= focusS.fineAt) { focusFinisce(); return; }
  const t = $("#focusTempo"); if (t) t.textContent = fmtTempo(restaMs());
  const b = $("#focusBar"); if (b) b.style.width = Math.round((1 - restaMs() / (focusS.min * 60000)) * 100) + "%";
  const p = $("#focusPianta"), st = String(stadioPianta());
  if (p && p.dataset.s !== st) { p.dataset.s = st; p.innerHTML = piantaSvg(+st); }
}
function focusOrologio() { clearInterval(focusT); focusT = focusS && focusS.stato === "corre" ? setInterval(focusTick, 1000) : 0; }
// Schermo acceso durante la sessione (dove si può; altrimenti niente errori)
async function schermoAcceso() {
  try {
    if (!navigator.wakeLock || document.visibilityState !== "visible" || (wakeLock && !wakeLock.released)) return;
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock?.addEventListener?.("release", () => { wakeLock = null; });
  } catch { wakeLock = null; }
}
function schermoLibero() { try { wakeLock?.release?.(); } catch {} wakeLock = null; }
function focusInizia(fase) {
  const min = fase === "pausa" ? FOCUS_PAUSA : focusPrep.min;
  const voce = fase === "pausa" ? focusS?.voce || "" : focusPrep.voce;
  focusS = { id: nuovoStId(), fase, stato: "corre", min, fineAt: Date.now() + min * 60000, resta: 0, pausaDopo: focusPrep.pausaDopo, voce: RE_ID.test(voce) ? voce : "", fatta: false };
  salvaFocus(); state.tab = "focus"; render(); window.scrollTo({ top: 0 }); focusOrologio(); schermoAcceso();
}
function focusFerma() { if (!focusS || focusS.stato !== "corre") return; focusS.resta = restaMs(); focusS.stato = "ferma"; salvaFocus(); focusOrologio(); schermoLibero(); render(); }
function focusRiprendi() { if (!focusS || focusS.stato !== "ferma") return; focusS.fineAt = Date.now() + focusS.resta; focusS.stato = "corre"; salvaFocus(); render(); focusOrologio(); schermoAcceso(); }
async function focusTermina() {
  if (!focusInCorso()) { focusChiudi(); render(); return; }
  const ok = await ask({ title: "Terminare adesso?", text: "La piantina non è ancora fiorita: questa sessione non andrà nella serra.", ok: "Termina" });
  if (ok && focusS) { focusChiudi(); render(); }
}
// Fine sessione: piantina nella serra (una volta sola), suono, mascotte felice
function focusFinisce() {
  if (!focusS || focusS.stato === "finita") return;
  const s = focusS; s.stato = "finita"; s.resta = 0;
  if (s.fase === "lavoro") {
    const serra = serraCarica();
    if (!serra.some((x) => x.id === s.id)) LS.set("mochi.focus.serra", [...serra, { g: todayStr(), m: s.min, id: s.id }].slice(-2000));
  }
  salvaFocus(); focusOrologio(); schermoLibero();
  if (state.tab === "focus") {
    render(); suona("notifica"); setTimeout(() => cheer(2400), 50);
    if (s.fase === "lavoro" && document.visibilityState === "visible") confetti(innerWidth / 2, innerHeight * 0.35, 30);
  }
}
// Chiude la sessione senza salvare niente (Termina, Basta così, uscita confermata, modulo spento)
function focusChiudi() { focusS = null; salvaFocus(); focusOrologio(); schermoLibero(); }
// All'avvio: una sessione lasciata a metà (app chiusa o ricaricata) riprende da dove era, con il tempo giusto
function focusRiprendiDaSalvata() {
  focusS = cleanFocus(LS.get("mochi.focus.sessione", null));
  if (!focusS || !mod("focus")) { focusS = null; salvaFocus(); return; }
  state.tab = "focus";
  if (focusS.stato === "corre" && Date.now() >= focusS.fineAt) { setTimeout(focusFinisce, 300); return; }
  focusOrologio(); schermoAcceso();
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !focusS) return;
  focusTick(); // se nel frattempo è finita, mostra la fine
  if (focusS?.stato === "corre") schermoAcceso(); // lo schermo acceso si perde quando l'app va in sottofondo
});

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
  const COL = tipo === "foglie" ? ["#e8a25a", "#d9763d", "#c9a24a", "#b5653a"] : document.documentElement.dataset.stile === "sobrio" ? ["#9fb0c6", "#b8c4d4", "#8fa2bb", "#c6d0dd"] /* Sobrio: petali e cuori in grigio azzurro, niente rosa */ : tipo === "cuori" ? ["#ff8fb1", "#ff6f8f", "#ffb3c6", "#f7a1bb"] : ["#ffb7c9", "#ffc8d8", "#f7a1bb", "#ffd9e4"];
  return { x: rnd(0, w), y, r: tipo === "foglie" ? rnd(5, 8) : tipo === "cuori" ? rnd(4, 7) : rnd(3.5, 5.5), v: tipo === "foglie" ? rnd(.6, 1.2) : rnd(.45, .9), f: rnd(0, 6.28), o: rnd(.6, 1.6), a: rnd(0, 6.28), va: rnd(-.04, .04), c: COL[Math.floor(Math.random() * COL.length)] };
}
function stagioniMisura() {
  const cv = $("#stagioni"); if (!cv) return;
  stag.dpr = Math.min(2, window.devicePixelRatio || 1); stag.w = innerWidth; stag.h = innerHeight;
  cv.width = Math.round(stag.w * stag.dpr); cv.height = Math.round(stag.h * stag.dpr);
}
function stagioniAggiorna() {
  const cv = $("#stagioni"); if (!cv) return;
  // le stagioni, se accese; altrimenti un'ombra di effetto per la festa (solo nello stile Morbido); o una sorpresa breve
  const fe = festaOggi(), festaEff = fe && CUSTOM.stile === "morbido" ? FESTE[fe].effetto : null;
  const tipo = !menoMoto() && !$("#app").classList.contains("hidden") ? burstAttivo() || (mod("stagioni") ? stagioneDiOggi() : festaEff) : null;
  const leggero = !burstAttivo() && !mod("stagioni");
  if (!tipo) { cancelAnimationFrame(stag.raf); stag.raf = 0; stag.tipo = null; stag.p = []; cv.classList.remove("on"); cv.getContext("2d")?.clearRect(0, 0, cv.width, cv.height); return; }
  if (tipo !== stag.tipo || !stag.p.length) {
    stagioniMisura(); stag.tipo = tipo;
    const n = Math.round(Math.min(34, Math.max(12, (stag.w * stag.h) / 26000)) * (tipo === "pioggia" ? 1.4 : tipo === "sole" ? .9 : 1) * (leggero ? .6 : 1));
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
      c.save(); c.translate(p.x, p.y); c.rotate(tipo === "cuori" ? Math.sin(p.f) * .4 : p.a + Math.sin(p.f) * .5); c.globalAlpha = scuro ? .6 : .7; c.fillStyle = p.c;
      c.beginPath();
      if (tipo === "foglie") { c.moveTo(0, -p.r); c.quadraticCurveTo(p.r * .9, 0, 0, p.r); c.quadraticCurveTo(-p.r * .9, 0, 0, -p.r); }
      else if (tipo === "cuori") { const r = p.r; c.moveTo(0, r * .9); c.bezierCurveTo(-r * 1.6, -r * .2, -r * .9, -r * 1.3, 0, -r * .45); c.bezierCurveTo(r * .9, -r * 1.3, r * 1.6, -r * .2, 0, r * .9); }
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
   LE FESTE (disegni e sorprese)
   Tutto è SVG fatto dal codice, nello stile delle mascotte: forme tonde, pastello, contorno più scuro.
   I cappellini si appoggiano sulla testa (punto d'appoggio per ogni mascotte), la decorazione della casetta ha
   un posto fisso (x 76-126, y 104-224 della stanza) dove non c'è nessun mobile.
   ========================================================= */
// Cappellini: origine = centro della testa, sopra = y negativo. Niente id: si possono mettere più volte nella pagina.
const CAPPELLI = {
  "r-natale": `<path d="M-46 -4 C-46 -52 -8 -86 24 -80 C46 -76 60 -56 58 -34 C56 -22 54 -12 50 -4 Z" fill="#ef5a6f" stroke="#c63f58" stroke-width="5" stroke-linejoin="round"/>
    <path d="M-30 -38 C-22 -56 -8 -67 8 -71" stroke="#fff" stroke-width="5" stroke-linecap="round" fill="none" opacity=".45"/>
    <rect x="-54" y="-18" width="108" height="23" rx="11.5" fill="#fff" stroke="#e6dbe0" stroke-width="4"/>
    <circle cx="58" cy="-30" r="13" fill="#fff" stroke="#e6dbe0" stroke-width="4"/>`,
  "r-cuore": `<path d="M-2 -12 C-16 -40 -54 -42 -56 -20 C-56 0 -22 0 -2 -12 Z" fill="#ff6f8f" stroke="#d94a6c" stroke-width="5" stroke-linejoin="round"/>
    <path d="M2 -12 C16 -40 54 -42 56 -20 C56 0 22 0 2 -12 Z" fill="#ff6f8f" stroke="#d94a6c" stroke-width="5" stroke-linejoin="round"/>
    <path d="M-40 -26 C-34 -34 -24 -34 -18 -28 M40 -26 C34 -34 24 -34 18 -28" stroke="#fff" stroke-width="4" stroke-linecap="round" fill="none" opacity=".55"/>
    <circle cx="0" cy="-12" r="11" fill="#ff8fa9" stroke="#d94a6c" stroke-width="5"/>`,
  "r-orecchie": `<g transform="translate(-32 6) rotate(-13)"><path d="M-15 0 C-23 -32 -19 -80 -2 -96 C15 -80 19 -32 15 0 Z" fill="#fff7f9" stroke="#e8c6d2" stroke-width="5" stroke-linejoin="round"/><path d="M-7 -8 C-11 -30 -9 -62 -2 -76 C5 -62 9 -30 7 -8 Z" fill="#ffc4d4"/></g>
    <g transform="translate(32 6) rotate(13)"><path d="M-15 0 C-23 -32 -19 -80 -2 -96 C15 -80 19 -32 15 0 Z" fill="#fff7f9" stroke="#e8c6d2" stroke-width="5" stroke-linejoin="round"/><path d="M-7 -8 C-11 -30 -9 -62 -2 -76 C5 -62 9 -30 7 -8 Z" fill="#ffc4d4"/></g>`,
  "r-strega": `<ellipse cx="0" cy="-4" rx="58" ry="13" fill="#8f73d6" stroke="#6f55b8" stroke-width="5"/>
    <path d="M-32 -8 C-30 -40 -16 -60 2 -76 C12 -86 34 -84 38 -72 C26 -74 22 -66 24 -52 C26 -34 30 -20 32 -8 Z" fill="#a58be6" stroke="#6f55b8" stroke-width="5" stroke-linejoin="round"/>
    <path d="M-31 -16 C-14 -9 14 -9 31 -16 L 30 -30 C 14 -23 -14 -23 -30 -30 Z" fill="#ffab6b" stroke="#e0834a" stroke-width="4" stroke-linejoin="round"/>
    <rect x="-7" y="-27" width="14" height="14" rx="3" fill="#ffe28a" stroke="#e8bf5a" stroke-width="3"/>
    <path d="M-20 -52 C-16 -62 -10 -66 -4 -68" stroke="#fff" stroke-width="4" stroke-linecap="round" fill="none" opacity=".4"/>`,
  "r-paglia": `<ellipse cx="0" cy="-6" rx="64" ry="14" fill="#f8dc8e" stroke="#d9ab4f" stroke-width="5"/>
    <path d="M-36 -8 C-38 -54 38 -54 36 -8 Z" fill="#fae6a4" stroke="#d9ab4f" stroke-width="5" stroke-linejoin="round"/>
    <path d="M-36 -14 C-14 -6 14 -6 36 -14 L 36 -27 C 14 -19 -14 -19 -36 -27 Z" fill="#ff8fa3" stroke="#e0637e" stroke-width="4" stroke-linejoin="round"/>
    <path d="M-14 -46 V-30 M0 -48 V-28 M14 -46 V-30" stroke="#d9ab4f" stroke-width="3" stroke-linecap="round" opacity=".55"/>
    <circle cx="30" cy="-23" r="5" fill="#fff"/><circle cx="30" cy="-23" r="2" fill="#ffd76a"/>`,
  "r-festa": `<path d="M-32 0 L2 -90 L36 0 Z" fill="#ffd76a" stroke="#e8b640" stroke-width="5" stroke-linejoin="round"/>
    <path d="M-20 -30 L 20 -44 M-9 -58 L 12 -66" stroke="#ff8fb1" stroke-width="7" stroke-linecap="round"/>
    <circle cx="-6" cy="-14" r="4" fill="#9fd4ef"/><circle cx="18" cy="-18" r="4" fill="#ff8fb1"/><circle cx="2" cy="-76" r="3" fill="#9fd4ef"/>
    <ellipse cx="2" cy="1" rx="37" ry="6.5" fill="#ff8fb1" stroke="#e0637e" stroke-width="4"/>
    <circle cx="2" cy="-94" r="10" fill="#fff" stroke="#e6dbe0" stroke-width="4"/>`,
  "r-ovetti": `<path d="M-52 2 Q0 -12 52 2 L52 -10 Q0 -24 -52 -10 Z" fill="#b7e39a" stroke="#6fb874" stroke-width="4" stroke-linejoin="round"/>
    ${[["#ff9db5", -42, -17], ["#9fd4ef", -21, -24], ["#ffe28a", 0, -27], ["#c9b2ff", 21, -24], ["#b7e39a", 42, -17]].map(([c, x, y]) => `<ellipse cx="${x}" cy="${y - 11}" rx="10" ry="13" fill="${c}" stroke="rgba(74,47,58,.3)" stroke-width="3"/><path d="M${x - 9} ${y - 10} l4.5 -4 l4.5 4 l4.5 -4 l4.5 4" stroke="#fff" stroke-width="3" fill="none" stroke-linejoin="round" opacity=".85"/>`).join("")}`
};
// Dove si appoggia il cappellino su ogni mascotte: [x, y, rotazione, scala] (coordinate del disegno)
const CAPPELLI_POS = {
  mochi: [200, 122, -8, 1.1], nigi: [205, 153, -8, 1.1], bolla: [250, 170, 0, 1], miso: [250, 152, 0, 1.05], bambu: [205, 158, -8, 1.1],
  daifuku: [250, 162, 0, 1.05], tamago: [205, 162, -8, 1.05], kame: [250, 132, 0, 1.05], saltello: [250, 160, 0, 1.05], castagna: [250, 152, 0, 1.1],
  yuzu: [205, 188, -8, 1.1], marimo: [250, 144, 0, 1.05], sakura: [250, 168, 0, 1.1], nori: [250, 168, 0, 1.1], zucchero: [215, 130, -6, 1.05]
};
const cappelloSvg = (cid, masc) => {
  if (!Object.prototype.hasOwnProperty.call(CAPPELLI, cid)) return "";
  const [x, y, r, s] = CAPPELLI_POS[masc] || CAPPELLI_POS.mochi;
  return `<g class="acc-festa" transform="translate(${x} ${y}) rotate(${r}) scale(${s})">${CAPPELLI[cid]}</g>`;
};
// Quale cappellino indossa la mascotte per la festa di oggi (se il modulo è acceso)
let FESTA_FORZATA = null; // solo per le prove in locale (?festa=natale su localhost): decora, non cambia nessun dato
try { if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) { const f = new URLSearchParams(location.search).get("festa"); if (f && Object.prototype.hasOwnProperty.call(FESTE, f)) FESTA_FORZATA = f; } } catch {}
const festaOggi = () => (mod("feste") ? FESTA_FORZATA || festaDi(new Date(), CUSTOM.compleanno) : null);
// a Pasqua le mascotte che hanno già le orecchie lunghe (coniglietti, canguro, unicorno) portano la corona di ovetti: niente doppie orecchie
const ORECCHIE_SUE = ["bolla", "daifuku", "saltello", "zucchero"];
const festaCappello = (masc = CUSTOM.mascotte) => { const f = festaOggi(); if (!f) return null; const a = FESTE[f].acc; return a === "r-orecchie" && ORECCHIE_SUE.includes(masc) ? "r-ovetti" : a; };
const festaFrase = (f) => { const a = FESTE[f].frasi; return a[Math.floor((Date.now() / 864e5)) % a.length].replace("{m}", MN()); };

/* ---------- La casetta: una decorazione per festa, sempre nello stesso posto libero ---------- */
const cuoreD = (x, y, s) => `M${x} ${y + s * .9}C${x - s * 1.6} ${y - s * .2} ${x - s * .9} ${y - s * 1.3} ${x} ${y - s * .45}C${x + s * .9} ${y - s * 1.3} ${x + s * 1.6} ${y - s * .2} ${x} ${y + s * .9}Z`;
const DECORI = {
  natale() {
    const luci = [[96, 132, "#ffd76a"], [108, 140, "#ff9db5"], [92, 160, "#9fd4ef"], [110, 166, "#ffd76a"], [88, 190, "#ff9db5"], [102, 196, "#9fd4ef"], [116, 192, "#ffd76a"]];
    return [`<rect x="97" y="212" width="8" height="11" rx="2" fill="#b98862" stroke="#8a6244" stroke-width="2"/>
      <path d="M101 164 L77 216 Q101 223 125 216 Z" fill="#6fc28b" stroke="#4a9a68" stroke-width="3" stroke-linejoin="round"/>
      <path d="M101 138 L81 184 Q101 190 121 184 Z" fill="#7fd09a" stroke="#4a9a68" stroke-width="3" stroke-linejoin="round"/>
      <path d="M101 114 L85 156 Q101 161 117 156 Z" fill="#8fdba8" stroke="#4a9a68" stroke-width="3" stroke-linejoin="round"/>
      <path d="M101 105 l2.6 5.4 l5.9 .8 l-4.3 4.2 l1 5.9 l-5.2 -2.8 l-5.2 2.8 l1 -5.9 l-4.3 -4.2 l5.9 -.8 Z" fill="#ffe28a" stroke="#f0c24e" stroke-width="1.8" stroke-linejoin="round"/>
      ${luci.map(([x, y, c]) => `<circle class="fd-luce" cx="${x}" cy="${y}" r="3.2" fill="${c}" stroke="rgba(74,47,58,.25)" stroke-width="1"/>`).join("")}
      <rect x="79" y="205" width="17" height="15" rx="3" fill="#ff9db5" stroke="#e57a98" stroke-width="2"/><path d="M87.5 205 V220 M79 212.5 H96" stroke="#fff" stroke-width="2.4"/><path d="M87.5 205 q-6 -7 -2 -8 q4 0 2 8 q-2 -8 2 -8 q4 1 -2 8" fill="#fff" stroke="#e57a98" stroke-width="1.2"/>
      <rect x="106" y="209" width="15" height="12" rx="3" fill="#9fd4ef" stroke="#6fb0d6" stroke-width="2"/><path d="M113.5 209 V221 M106 215 H121" stroke="#fff" stroke-width="2.2"/>`,
      luci.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="9" fill="url(#casaAlone)"/>`).join("")];
  },
  sanvalentino() {
    return [`<path d="M92 150 Q96 180 100 206 M112 142 Q106 176 102 206" stroke="#c9a2b0" stroke-width="1.6" fill="none"/>
      <path class="fd-fluttua" d="${cuoreD(92, 136, 12)}" fill="#ff6f8f" stroke="#d94a6c" stroke-width="2.4" stroke-linejoin="round"/>
      <path class="fd-fluttua f2" d="${cuoreD(112, 128, 11)}" fill="#ffb3c6" stroke="#f0839f" stroke-width="2.4" stroke-linejoin="round"/>
      <path d="M86 128 q3 -5 8 -4" stroke="#fff" stroke-width="2.4" stroke-linecap="round" fill="none" opacity=".7"/>
      <rect x="86" y="206" width="30" height="17" rx="4" fill="#ff8fa9" stroke="#d94a6c" stroke-width="2.4"/><path d="M101 206 V223" stroke="#fff" stroke-width="3"/>
      <path d="M101 206 q-9 -9 -4 -10 q6 0 4 10 q-2 -10 4 -10 q5 1 -4 10" fill="#fff" stroke="#d94a6c" stroke-width="1.4" stroke-linejoin="round"/>`, ""];
  },
  pasqua() {
    const uova = [["#ff9db5", 90, 196], ["#9fd4ef", 103, 193], ["#ffe28a", 116, 197]];
    return [`${uova.map(([c, x, y]) => `<ellipse cx="${x}" cy="${y}" rx="7.5" ry="10" fill="${c}" stroke="rgba(74,47,58,.3)" stroke-width="2"/><path d="M${x - 7} ${y} l3.5 -3 l3.5 3 l3.5 -3 l3.5 3" stroke="#fff" stroke-width="2" fill="none" stroke-linejoin="round" opacity=".9"/>`).join("")}
      <path d="M82 206 Q80 196 86 198 M120 206 Q124 196 118 198 M96 204 Q95 196 99 199" stroke="#6fb874" stroke-width="3" stroke-linecap="round" fill="none"/>
      <path d="M78 204 L124 204 L119 222 Q118 224 115 224 L87 224 Q84 224 83 222 Z" fill="#e8c08a" stroke="#c4955a" stroke-width="2.6" stroke-linejoin="round"/>
      <path d="M80 211 H122 M82 217 H120 M92 205 V223 M101 205 V224 M110 205 V223" stroke="#cf9f62" stroke-width="1.5"/>
      <path d="M81 204 Q101 168 121 204" stroke="#c4955a" stroke-width="3.2" fill="none" stroke-linecap="round"/>
      <path d="M101 181 q-9 -8 -4 -10 q6 0 4 10 q-2 -10 4 -10 q5 2 -4 10" fill="#ff9db5" stroke="#e57a98" stroke-width="1.4" stroke-linejoin="round"/>
      <ellipse cx="86" cy="216" rx="4.4" ry="5.6" fill="#c9b2ff" stroke="rgba(74,47,58,.3)" stroke-width="2" transform="rotate(-18 86 216)"/>`, ""];
  },
  halloween() {
    return [`<g class="fd-pipistrello"><path d="M101 128 C95 122 86 122 80 128 C84 128 86 131 88 134 C90 132 93 132 95 135 C97 133 99 133 101 135 C103 133 105 133 107 135 C109 132 112 132 114 134 C116 131 118 128 122 128 C116 122 107 122 101 128 Z" fill="#6a5a8e" stroke="#4a3d6b" stroke-width="2.4" stroke-linejoin="round"/><ellipse cx="101" cy="132" rx="5.5" ry="6.5" fill="#6a5a8e" stroke="#4a3d6b" stroke-width="2.4"/><path d="M98 126 l-1 -5 l4 3 l4 -3 l-1 5" fill="#6a5a8e" stroke="#4a3d6b" stroke-width="2" stroke-linejoin="round"/><circle cx="99.2" cy="132" r="1.2" fill="#ffe28a"/><circle cx="102.8" cy="132" r="1.2" fill="#ffe28a"/></g>
      <ellipse cx="116" cy="215" rx="8" ry="8" fill="#ffb066" stroke="#d9772a" stroke-width="2.4"/><path d="M116 207 V203" stroke="#6fb874" stroke-width="3" stroke-linecap="round"/><path d="M111 214 q2 -2 4 0 M118 214 q2 -2 4 0" stroke="#4a2f3a" stroke-width="1.6" fill="none" stroke-linecap="round"/>
      <ellipse cx="89" cy="206" rx="10.5" ry="15" fill="#ff9d4f" stroke="#d9772a" stroke-width="2.6"/>
      <ellipse cx="101" cy="206" rx="12" ry="16.5" fill="#ffa95f" stroke="#d9772a" stroke-width="2.6"/>
      <path d="M101 190 Q100 183 106 180 Q105 187 108 190" fill="#8fd18a" stroke="#5aa564" stroke-width="2.2" stroke-linejoin="round"/>
      <path d="M91 202 L96 196 L99 203 Z M103 203 L106 196 L111 202 Z" fill="#ffe28a" stroke="#d9772a" stroke-width="1.6" stroke-linejoin="round"/>
      <path d="M92 211 Q101 220 110 211 Q101 215 92 211 Z" fill="#ffe28a" stroke="#d9772a" stroke-width="1.6" stroke-linejoin="round"/>`,
      `<circle cx="101" cy="207" r="17" fill="url(#casaAlone)"/>`];
  },
  agosto() {
    return [`<path d="M101 224 V134" stroke="#c9a27a" stroke-width="3.4" stroke-linecap="round"/>
      <path d="M76 142 C78 112 124 112 126 142 Q119 136 113 142 Q107 136 101 142 Q95 136 89 142 Q83 136 76 142 Z" fill="#ff9a85" stroke="#e07a65" stroke-width="2.8" stroke-linejoin="round"/>
      <path d="M101 117 L89 141 Q95 135 101 141 Z M101 117 L113 141 Q107 135 101 141 Z" fill="#fff" opacity=".92"/>
      <circle cx="101" cy="115" r="3" fill="#ffd76a" stroke="#e8b640" stroke-width="1.6"/>
      <circle cx="110" cy="209" r="11.5" fill="none" stroke="#ff8fb1" stroke-width="7"/><circle cx="110" cy="209" r="11.5" fill="none" stroke="#fff" stroke-width="7" stroke-dasharray="9 9"/><circle cx="110" cy="209" r="15" fill="none" stroke="rgba(74,47,58,.22)" stroke-width="1.4"/><circle cx="110" cy="209" r="8" fill="none" stroke="rgba(74,47,58,.22)" stroke-width="1.4"/>
      <path d="M82 222 Q90 216 96 222" stroke="#f2cf8a" stroke-width="5" stroke-linecap="round" fill="none"/>`, ""];
  },
  compleanno() {
    return [`<path d="M88 146 Q92 176 82 206 M114 138 Q108 172 120 206" stroke="#c9a2b0" stroke-width="1.6" fill="none"/>
      <ellipse class="fd-fluttua" cx="88" cy="134" rx="10" ry="12.5" fill="#ff8fb1" stroke="#e0637e" stroke-width="2.4"/><path class="fd-fluttua" d="M84 128 q2 -4 6 -4" stroke="#fff" stroke-width="2.4" stroke-linecap="round" fill="none" opacity=".7"/>
      <ellipse class="fd-fluttua f2" cx="114" cy="126" rx="10" ry="12.5" fill="#9fd4ef" stroke="#6fb0d6" stroke-width="2.4"/><path class="fd-fluttua f2" d="M110 120 q2 -4 6 -4" stroke="#fff" stroke-width="2.4" stroke-linecap="round" fill="none" opacity=".7"/>
      <rect x="78" y="207" width="46" height="5" rx="2.5" fill="#e0bb8b" stroke="#c4955a" stroke-width="2"/><path d="M84 212 V224 M118 212 V224" stroke="#c4955a" stroke-width="3.4" stroke-linecap="round"/>
      <rect x="84" y="191" width="34" height="16" rx="4" fill="#ffd1dc" stroke="#f2a9bc" stroke-width="2.2"/>
      <path d="M84 196 q4.2 5 8.5 0 q4.2 5 8.5 0 q4.2 5 8.5 0 q4.2 5 8.5 0" fill="#fff" stroke="#f2a9bc" stroke-width="1.8"/>
      <rect x="92" y="177" width="18" height="14" rx="4" fill="#fff" stroke="#f2a9bc" stroke-width="2.2"/><path d="M92 182 q4.5 5 9 0 q4.5 5 9 0" fill="#ffd1dc" stroke="#f2a9bc" stroke-width="1.6"/>
      <rect x="99" y="164" width="4" height="13" rx="1.6" fill="#9fd4ef" stroke="#6fb0d6" stroke-width="1.4"/>
      <ellipse class="fd-fiamma" cx="101" cy="160" rx="3.2" ry="5.2" fill="#ffd76a" stroke="#f0a83a" stroke-width="1.4"/>`,
      `<circle cx="101" cy="160" r="12" fill="url(#casaAlone)"/>`];
  }
};
// Decorazione della casetta per la festa di oggi: [disegno, luci della sera] oppure null
const festaCasa = () => { const f = festaOggi(); return f ? DECORI[festaBase(f)]() : null; };
// Ovetto nascosto in una casetta (Pasqua): piccolo, sul pavimento
const uovoCasaSvg = () => `<g class="uovo-casa" data-act="uovo" data-v="casa" role="button" tabindex="0" aria-label="Un ovetto nascosto! Toccalo"><ellipse cx="288" cy="268" rx="9" ry="11.5" fill="#ffe28a" stroke="rgba(74,47,58,.35)" stroke-width="2"/><path d="M279.5 268 l4.2 -3.6 l4.2 3.6 l4.2 -3.6 l4.2 3.6" stroke="#ff9db5" stroke-width="2.6" fill="none" stroke-linejoin="round"/></g>`;

/* ---------- Intestazione: una ghirlandina che cambia con la festa ---------- */
const GHIRLANDE = {
  natale: [["lampadina", "#ef5a6f"], ["lampadina", "#ffd76a"], ["lampadina", "#6fc28b"]],
  sanvalentino: [["cuore", "#ff6f8f"], ["cuore", "#ffb3c6"]],
  pasqua: [["uovo", "#ff9db5"], ["uovo", "#9fd4ef"], ["uovo", "#ffe28a"], ["uovo", "#b7e39a"]],
  halloween: [["zucca", "#ffa24d"], ["pipistrello", "#6a5a8e"]],
  agosto: [["bandierina", "#ff9a85"], ["bandierina", "#ffd76a"], ["bandierina", "#7fd0d8"]],
  compleanno: [["bandierina", "#ff8fb1"], ["bandierina", "#ffd76a"], ["bandierina", "#9fd4ef"], ["bandierina", "#b7e39a"]]
};
function ghirlandaSvg(f) {
  const el = GHIRLANDE[festaBase(f)]; if (!el) return "";
  const W = 54, tot = el.length * W;
  const pezzo = ([t, c], i) => {
    const x = i * W + W / 2, y = 11;
    if (t === "lampadina") return `<rect x="${x - 2.5}" y="${y}" width="5" height="4" rx="1" fill="#b99a8a"/><ellipse class="fd-luce" cx="${x}" cy="${y + 10}" rx="4.4" ry="6" fill="${c}" stroke="rgba(74,47,58,.3)" stroke-width="1.2"/>`;
    if (t === "cuore") return `<path d="${cuoreD(x, y + 8, 6.5)}" fill="${c}" stroke="rgba(74,47,58,.28)" stroke-width="1.2" stroke-linejoin="round"/>`;
    if (t === "uovo") return `<ellipse cx="${x}" cy="${y + 10}" rx="5" ry="6.6" fill="${c}" stroke="rgba(74,47,58,.3)" stroke-width="1.2"/><path d="M${x - 4.6} ${y + 10} l2.3 -2 l2.3 2 l2.3 -2 l2.3 2" stroke="#fff" stroke-width="1.5" fill="none" opacity=".9"/>`;
    if (t === "zucca") return `<path d="M${x} ${y} v3" stroke="#6fb874" stroke-width="2"/><ellipse cx="${x}" cy="${y + 10}" rx="7" ry="6.2" fill="${c}" stroke="#d9772a" stroke-width="1.4"/><path d="M${x - 3} ${y + 9} l1.6 -2 l1.4 2 z M${x + 1.5} ${y + 9} l1.6 -2 l1.4 2 z" fill="#4a2f3a"/><path d="M${x - 3} ${y + 12} q3 2.4 6 0" stroke="#4a2f3a" stroke-width="1.2" fill="none"/>`;
    if (t === "pipistrello") return `<path d="M${x} ${y + 6} C${x - 4} ${y + 1} ${x - 10} ${y + 2} ${x - 13} ${y + 6} C${x - 10} ${y + 6} ${x - 9} ${y + 8} ${x - 8} ${y + 10} C${x - 6} ${y + 8} ${x - 4} ${y + 8} ${x - 2.5} ${y + 10} C${x - 1} ${y + 8} ${x + 1} ${y + 8} ${x + 2.5} ${y + 10} C${x + 4} ${y + 8} ${x + 6} ${y + 8} ${x + 8} ${y + 10} C${x + 9} ${y + 8} ${x + 10} ${y + 6} ${x + 13} ${y + 6} C${x + 10} ${y + 2} ${x + 4} ${y + 1} ${x} ${y + 6} Z" fill="${c}" stroke="#4a3d6b" stroke-width="1.2" stroke-linejoin="round"/>`;
    return `<path d="M${x - 7} ${y - 1} L${x + 7} ${y - 1} L${x} ${y + 14} Z" fill="${c}" stroke="rgba(74,47,58,.28)" stroke-width="1.2" stroke-linejoin="round"/>`; // bandierina
  };
  const corda = Array.from({ length: el.length }, (_, i) => `<path d="M${i * W} 3 Q${i * W + W / 2} 19 ${(i + 1) * W} 3" stroke="#b99a8a" stroke-width="1.6" fill="none"/>`).join("");
  return `<svg width="100%" height="28" aria-hidden="true" focusable="false"><defs><pattern id="fgPat" width="${tot}" height="28" patternUnits="userSpaceOnUse">${corda}${el.map(pezzo).join("")}</pattern></defs><rect width="100%" height="28" fill="url(#fgPat)"/></svg>`;
}
let festaTestaChiave = "";
function festaTesta() {
  const top = document.querySelector("header.top"); if (!top) return;
  const f = festaOggi(), k = f ? f + "|" + (GHIRLANDE[festaBase(f)] ? 1 : 0) : "";
  if (k === festaTestaChiave) return;
  festaTestaChiave = k;
  let d = top.querySelector(".festa-deco");
  top.classList.toggle("con-festa", !!(f && GHIRLANDE[festaBase(f)]));
  if (!f || !GHIRLANDE[festaBase(f)]) { d?.remove(); return; }
  if (!d) { d = document.createElement("div"); d.className = "festa-deco"; d.setAttribute("aria-hidden", "true"); top.prepend(d); }
  d.innerHTML = ghirlandaSvg(f);
}

/* ---------- Sorprese ---------- */
// Pioggia di emoji della festa (ferma se il telefono chiede meno animazioni)
function pioggiaFesta(f, n = 16) {
  if (menoMoto()) return;
  const em = FESTE[f].pioggia;
  for (let i = 0; i < n; i++) {
    const s = document.createElement("span");
    s.className = "festa-cade"; s.textContent = em[i % em.length];
    s.style.left = Math.round(Math.random() * 92 + 2) + "vw"; s.style.animationDelay = (Math.random() * .7).toFixed(2) + "s"; s.style.fontSize = Math.round(18 + Math.random() * 14) + "px";
    document.body.appendChild(s); setTimeout(() => s.remove(), 2600);
  }
}
// Fuochini: piccole esplosioni di coriandoli in punti diversi dello schermo
function fuochini(n = 4) {
  if (menoMoto()) return;
  for (let i = 0; i < n; i++) setTimeout(() => confetti(innerWidth * (.2 + Math.random() * .6), innerHeight * (.18 + Math.random() * .3), 26), i * 380);
}
// Nevicata (o altro) per un attimo, anche se le stagioni sono spente
let burstFino = 0, burstTipo = null;
function effettoBreve(tipo, ms = 5500) {
  if (tipo === "coriandoli") { confetti(innerWidth / 2, innerHeight * .3, 40); fuochini(2); return; }
  if (menoMoto()) { toast("✨ Una sorpresa!"); return; }
  burstTipo = tipo; burstFino = Date.now() + ms;
  stagioniAggiorna();
  setTimeout(stagioniAggiorna, ms + 60);
}
const burstAttivo = () => (Date.now() < burstFino ? burstTipo : null);
// Il ricordo si sblocca una volta sola e resta per sempre (sincronizzato nell'account)
async function sbloccaRicordo(id) {
  const r = RICORDI.find((x) => x.id === id); if (!r || CUSTOM.ricordi.includes(id)) return false;
  await saveCustom({ ricordi: [...CUSTOM.ricordi, id] });
  setTimeout(() => toast(`🎁 Un ricordo per ${MN()}: ${r.nome.toLowerCase()}! Lo trovi nel pancino`), 400);
  return true;
}
// Cinque tocchi veloci sulla mascotte in un giorno di festa: festa speciale e il cappellino diventa un ricordo
let toccoFesta = { n: 0, t: 0 };
function festaTocco() {
  const f = festaOggi(); if (!f) return;
  const ora = Date.now();
  toccoFesta = { n: ora - toccoFesta.t < 1600 ? toccoFesta.n + 1 : 1, t: ora };
  if (toccoFesta.n < 5) return;
  toccoFesta = { n: 0, t: 0 };
  document.querySelectorAll(".mascotte").forEach((m) => { m.classList.add("festa-giro"); setTimeout(() => m.classList.remove("festa-giro"), 1500); });
  cheer(1800); pioggiaFesta(f); confetti(innerWidth / 2, innerHeight * .3, 30); suona("notifica");
  if (navigator.vibrate) navigator.vibrate([20, 40, 20]);
  sbloccaRicordo(FESTE[f].acc);
}
// Parole magiche scritte in una cosa da fare: un piccolo effetto nei giorni giusti
const PAROLE_FESTA = { natale: [/auguri/i, "neve"], capodanno: [/auguri|buon anno/i, "neve"], sanvalentino: [/amore|ti amo|cuore/i, "cuori"], pasqua: [/pasqua|ovetto|uovo/i, "petali"],
  halloween: [/dolcetto|scherzetto|zucca/i, "foglie"], agosto: [/mare|ferragosto|gelato/i, "sole"], compleanno: [/compleanno|auguri/i, "coriandoli"] };
function festaParola(titolo) {
  const f = festaOggi(), p = f && PAROLE_FESTA[f];
  if (p && typeof titolo === "string" && p[0].test(titolo)) setTimeout(() => { effettoBreve(p[1]); cheer(1500); }, 500);
}
// Caccia agli ovetti di Pasqua: cinque nascosti in giro, trovarli tutti regala la corona di ovetti
const UOVA = ["oggi", "agenda", "bacheca", "casa", "menu"];
const uovaChiave = () => "mochi.feste.uova." + (store.user?.id || "local") + "." + new Date().getFullYear();
const uovaTrovate = () => { const a = LS.get(uovaChiave(), []); return Array.isArray(a) ? a.filter((x) => UOVA.includes(x)) : []; };
const uovoVisibile = (dove) => festaOggi() === "pasqua" && !uovaTrovate().includes(dove);
const uovoBtn = (dove) => `<button class="uovo-nasc u-${dove}" data-act="uovo" data-v="${dove}" aria-label="Un ovetto nascosto! Toccalo"><svg viewBox="0 0 24 30" aria-hidden="true"><ellipse cx="12" cy="17" rx="9.5" ry="12" fill="${{ oggi: "#ff9db5", agenda: "#9fd4ef", bacheca: "#ffe28a", menu: "#c9b2ff" }[dove] || "#b7e39a"}" stroke="rgba(74,47,58,.35)" stroke-width="2"/><path d="M3.5 17 l4.2 -3.6 l4.2 3.6 l4.2 -3.6 l4.2 3.6" stroke="#fff" stroke-width="2.6" fill="none" stroke-linejoin="round"/></svg></button>`;
// Dopo ogni disegno della pagina: mette l'ovetto nel suo angolo (tranne la casetta, che lo ha dentro la scena)
function festaDopoRender() {
  festaTesta();
  const v = $("#view .view"); if (!v) return;
  const dove = { oggi: "oggi", agenda: "agenda", appunti: "bacheca", menu: "menu" }[state.tab];
  if (!dove || !uovoVisibile(dove)) return;
  const host = dove === "bacheca" ? ($(".notes", v) || v) : dove === "agenda" ? ($(".col-main", v) || v) : v; // Oggi e Menu: in fondo alla pagina
  if (getComputedStyle(host).position === "static") host.style.position = "relative";
  host.insertAdjacentHTML("beforeend", uovoBtn(dove));
}
async function festaUovo(dove, el) {
  if (!UOVA.includes(dove) || !uovoVisibile(dove)) return;
  const r = el.getBoundingClientRect();
  const nuove = [...uovaTrovate(), dove]; LS.set(uovaChiave(), nuove);
  confetti(r.left + r.width / 2, r.top + r.height / 2, 14); heartAt(el); cheer(1200); if (navigator.vibrate) navigator.vibrate(15);
  render();
  if (nuove.length < UOVA.length) { toast(nuove.length === 1 ? "🥚 Hai trovato un ovetto! Ce ne sono 5 nascosti in giro per l'app" : `🥚 Ovetto ${nuove.length} su ${UOVA.length}!`); return; }
  const nuovo = !CUSTOM.ricordi.includes("r-ovetti");
  setTimeout(() => whenSheetFree(() => {
    openSheet(`<div class="recap"><div class="mbox">${mascot("happy")}</div><h2 class="fred">Li hai trovati tutti! 🥚</h2>
      <div class="say">${nuovo ? `Cinque ovetti su cinque. ${esc(MN())} ti regala la corona di ovetti: resta sua per sempre e la trovi nel pancino.` : "Cinque ovetti su cinque, anche quest'anno: che occhio!"}</div></div>
      <div class="actions"><button class="btn primary" data-act="close">Che bello!</button></div>`);
    confetti(innerWidth / 2, innerHeight * .35, 50); fuochini(3); suona("notifica");
  }), 500);
  if (nuovo) await sbloccaRicordo("r-ovetti");
}
// All'apertura: auguri della mascotte, una sola volta al giorno per ogni festa
function festeApri() {
  const f = festaOggi(); if (!f) return;
  const k = `mochi.feste.visto.${store.user?.id || "local"}.${todayStr()}.${f}`;
  if (LS.get(k, 0)) return;
  LS.set(k, 1);
  setTimeout(() => {
    if (f === "compleanno" || f === "capodanno") whenSheetFree(() => {
      openSheet(`<div class="recap"><div class="mbox">${mascot("happy")}</div><h2 class="fred">${f === "compleanno" ? "Buon compleanno!" : "Buon anno!"} ${FESTE[f].e}</h2>
        <div class="say">${esc(festaFrase(f))}</div></div><div class="actions"><button class="btn primary" data-act="close">Grazie ${esc(MN())}${DECO("💗")}</button></div>`);
      confetti(innerWidth / 2, innerHeight * .3, 50); fuochini(f === "capodanno" ? 5 : 3); cheer(2400); suona("notifica");
    });
    else toast(festaFrase(f));
  }, 2200);
}

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

async function exportData() {
  // chi usa il pet: nel file anche la scheda e le righe di routine e pesi (dal server, con un tempo massimo; senza rete quelle del dispositivo)
  const usaPet = petPresente(CUSTOM.pet) || mod("pet") || state.pet.righe.length > 0;
  const petRighe = usaPet ? await Promise.race([petTutteLeRighe(), new Promise((ok) => setTimeout(() => ok(petUnici(state.pet.righe)), 5000))]) : [];
  const blob = new Blob([JSON.stringify({ esportato_il: new Date().toISOString(), voci: state.items, umori: state.umori, turni: { impostazioni: state.turniImp, giorni: state.turni },
    spese: { budget_mensile_cent: state.spese.budget, voci: [...state.spese.voci].sort(ordineSpese) },
    giorni_attivi: [...state.giorni].sort(), concentrazione: serraCarica(),
    ...(usaPet ? { pet: { scheda: CUSTOM.pet, registro: [...petRighe].sort((a, b) => (a.giorno + a.tipo + a.chiave < b.giorno + b.tipo + b.chiave ? -1 : 1)) } } : {}) }, null, 2)], { type: "application/json" });
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
// Spuntare (o togliere la spunta a) una cosa da fare: dall'elenco e dalla fine di una sessione di Concentrazione
async function spuntaVoce(it, el) {
  const prima = bocconcini().length;
  it.done = !it.done; it.done_at = it.done ? new Date().toISOString() : null; it.updated_at = new Date().toISOString();
  if (it.done) { const r = el.getBoundingClientRect(); confetti(r.left + 13, r.top + 13); suona("spunta"); if (navigator.vibrate) navigator.vibrate(15); feed(el, it); setTimeout(() => cheer(), 650); checkRegalo(prima); giornoFatto(); aggiornaSblocchi(); }
  else applyCustom();
  setTimeout(render, it.done ? 280 : 0);
  await store.save(it);
  if (it.done) petProponiProssima(it);
}
document.addEventListener("click", async (e) => {
  const tab = e.target.closest("[data-tab]");
  if (tab) {
    let t = tab.dataset.tab;
    if (t === "menu" && state.tab === "menu") t = state.tabPrima && state.tabPrima !== "menu" ? state.tabPrima : "oggi"; // ☰ di nuovo: si richiude
    // si esce dalla Concentrazione mentre il timer corre: prima si chiede
    if (state.tab === "focus" && t !== "focus" && focusInCorso()) {
      const esci = await ask({ title: "Interrompere la concentrazione?", text: "Se esci adesso la sessione si ferma e la piantina non va nella serra.", ok: "Esci e interrompi" });
      if (!esci) return;
      focusChiudi();
    }
    if (t === "menu") state.tabPrima = state.tab;
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
      await spuntaVoce(it, el); break;
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
    case "st-spesa": if (draft) { draft._spesa = !draft._spesa; draft._spesaScelta = true; drawSt(); } break;
    case "st-reparti": await saveCustom({ spesa_reparti: CUSTOM.spesa_reparti === false }); if (draft) drawSt(); break;
    case "st-sugg": if (draft && v) aggiungiSt(v); break;
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
    // ospite
    case "riepilogo-chiudi": LS.set("mochi.riepilogo.chiuso", v || ""); render(); break;
    case "ospite-entra": entraOspite(); break;
    case "ospite-account": vaiAdAccount(v === "login" ? "login" : "signup"); break;
    case "ospite-esci": esciOspite(); break;
    case "ospite-esci-ok": lasciaOspite(); LS.set("mochi.ospite.origine", "esci"); location.reload(); break;
    case "ospite-cancella": cancellaOspite(); break;
    case "ospite-invito-chiudi": LS.set("mochi.ospite.invito", Date.now()); render(); break;
    case "passaggio-proponi": proponiPassaggio(true); break;
    case "passaggio-tardi": rimandaPassaggio(); closeSheet(); break;
    case "passaggio-non-mie": nonSonoMie(); break;
    case "passaggio-lascia": lasciaSulDispositivo(); break;
    case "passaggio-cancella": cancellaCoseOspite(); break;
    case "passaggio-via": eseguiPassaggio(el); break;
    // serie di giorni
    case "serie-apri": apriSerie(); break;
    // casetta
    case "open-casa": openCasa(); break;
    case "casa-vai": if (casaDi(v) && casetteAperte().includes(v)) await saveCustom({ casa: { ...CUSTOM.casa, scelta: v } }); openCasa(); break;
    case "casa-scegli": if (casaDi(v) && casetteAperte().includes(v)) { await saveCustom({ casa: { ...CUSTOM.casa, scelta: v } }); cheer(1200); } break;
    case "casa-colore": { const m = /^([a-z]+):([0-2])$/.exec(String(v)), mid = m && m[1], n = m && Number(m[2]); if (m && mobiliAvuti().includes(mid)) await saveCustom({ casa: { ...CUSTOM.casa, colori: { ...CUSTOM.casa.colori, [mid]: n } } }); break; }
    case "casa-mobile": if (mobiliAvuti().includes(v)) { const sp = CUSTOM.casa.spenti; await saveCustom({ casa: { ...CUSTOM.casa, spenti: sp.includes(v) ? sp.filter((x) => x !== v) : [...sp, v] } }); } break;
    case "casa-poke": { const sv = el.querySelector(".mascotte"); if (sv) { sv.classList.add("happy"); setTimeout(() => sv.classList.remove("happy"), 1400); } heartAt(el); if (navigator.vibrate) navigator.vibrate(10); festaTocco(); break; }
    // concentrazione
    case "focus-durata": if (FOCUS_DURATE.includes(+v)) { focusPrep.min = +v; LS.set("mochi.focus.durata", +v); render(); } break;
    case "focus-pausa-dopo": focusPrep.pausaDopo = !focusPrep.pausaDopo; LS.set("mochi.focus.pausaDopo", focusPrep.pausaDopo); render(); break;
    case "focus-inizia": focusInizia("lavoro"); break;
    case "focus-pausa-breve": focusInizia("pausa"); break;
    case "focus-ferma": focusFerma(); break;
    case "focus-riprendi": focusRiprendi(); break;
    case "focus-termina": focusTermina(); break;
    case "focus-basta": focusChiudi(); render(); break;
    case "focus-spunta": {
      const it = focusS && state.items.find((x) => x.id === focusS.voce);
      if (it && !it.done) { await spuntaVoce(it, el); toast("Spuntata! 🌸"); }
      break;
    }
    // impostazioni: moduli, stagioni, suoni
    case "modulo": {
      const m = MODULI.find((x) => x[0] === v); if (!m) break;
      const acceso = !mod(v);
      // I ricorrenti li manda il server: spegnendo il modulo vanno messi in pausa, altrimenti continuerebbero ad arrivare
      if (v === "ricorrenti" && ONLINE_MODE) { const r = await moduloRicorrenti(acceso); if (r === "annulla") { riapriImpostazioni(); break; } if (r === "errore") break; }
      if (v === "focus" && !acceso) focusChiudi();
      await saveCustom({ moduli: { ...CUSTOM.moduli, [v]: acceso } });
      riapriImpostazioni();
      if (v === "ricorrenti" && acceso && ricorrenti.some((x) => !x.attiva)) toast("I tuoi promemoria ricorrenti sono in pausa: riattivali dalla pagina Ricorrenti");
      else toast(acceso ? `${m[1]} ${m[2]}: acceso` : `${m[1]} ${m[2]}: spento. I dati restano al sicuro`);
      break;
    }
    case "pet-spesa-nuova": case "pet-scad-new": case "pet-scad-edit": case "pet-s-tipo": case "pet-scad-salva": case "pet-scad-del": case "pet-scad-fatta": case "pet-edit": case "pet-specie": case "pet-dt": case "pet-salva": case "pet-rimuovi": case "pet-spunta": case "pet-routine": case "pet-r-add": case "pet-r-del": case "pet-r-ripristina": case "pet-r-salva": case "pet-peso": case "pet-peso-salva": case "pet-peso-togli": await petAzione(act, v, el); break;
    case "pick-stagione": if (STAGIONI.some((x) => x[0] === v)) { await saveCustom({ stagione: v }); riapriImpostazioni(); } break;
    case "pick-pronomi": { const p = v === "non" ? "" : v; if (PRONOMI.some((x) => x[0] === p)) { await saveCustom({ pronomi: p }); riapriImpostazioni(); } break; }
    case "pick-suono": if (SUONI.some((x) => x[0] === v)) { suona("notifica", v); await saveCustom({ suono: v }); riapriImpostazioni(); } break;
    case "poke": { const sv = el.querySelector(".mascotte"); if (sv) { sv.classList.add("happy"); setTimeout(() => sv.classList.remove("happy"), 1400); } heartAt(el); if (navigator.vibrate) navigator.vibrate(10); festaTocco(); break; }
    case "uovo": festaUovo(v, el); break;
    case "compleanno-togli": await saveCustom({ compleanno: "" }); riapriImpostazioni(); toast("Compleanno tolto"); break;
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
    case "fiori-apri": if (mod("umore")) { fioriAperto = true; closeSheet(); apriGiardino(); } break;
    case "fiori-modo": case "fiori-scegli": {
      if (!mod("umore")) break; // modulo Umore spento: la scelta non esiste, l'azione si ignora
      const nuovo = act === "fiori-modo" ? { ...CUSTOM.fiori, modo: v } : { modo: "uno", fiore: v };
      if (act === "fiori-modo" ? (v === "uno" || v === "umore") : FIORI_UNO.includes(v)) { fioriAperto = true; const y = $("#sheet").scrollTop; await saveCustom({ fiori: nuovo }); if (giardinoMese) { apriGiardino(giardinoMese); $("#sheet").scrollTop = y; } }
      break; }
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
      closeSheet(); setTimeout(() => cheer(), 200); toast(`Ciao! Ora sono ${MN()}${DECO("💗")}`);
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
    case "sg-toggle": sgToggle(v); break;
    case "open-settings": openSettings(); break;
    case "enable-push": enablePush(); break;
    case "disable-push": disablePush(); break;
    case "export": toast("Preparo il backup…"); exportData(); break;
    case "logout": {
      const yes = await ask({ title: "Vuoi uscire?", text: "Su questo dispositivo dovrai rientrare con email e password.", ok: "Esci" });
      // prima di uscire: i giorni attivi ancora da inviare si provano a mandare (se non partono, restano per quell'utente)
      if (yes) { try { await Promise.race([inviaGiorni([]), new Promise((r) => setTimeout(r, 4000))]); } catch {} await store.logout(); clearLocal(); location.reload(); }
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
      try { toast("Preparo il backup…"); await exportData(); await store.deleteAccount(); clearLocal(); Object.keys(localStorage).filter((k) => k.startsWith("mochi.giorniDaInviare.") || k.startsWith("mochi.petDaInviare.")).forEach((k) => localStorage.removeItem(k)); toast(`Account eliminato. Ti ho scaricato un backup. Ciao da ${MN()} 🍣`); setTimeout(() => location.reload(), 3000); }
      catch (err) { toast("Errore: " + (err.message || err)); }
      break;
    }
  }
});
// Con una finestra aperta Tab e Maiusc+Tab girano solo dentro la finestra
const FOCUSABILI = 'button:not([disabled]),a[href],input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
document.addEventListener("keydown", (e) => {
  if (e.key !== "Tab") return;
  const box = $(".biscotto-wrap") || ($("#sheet").classList.contains("on") ? $("#sheet") : null);
  if (!box) return;
  const el = [...box.querySelectorAll(FOCUSABILI)].filter((x) => x.getClientRects().length && getComputedStyle(x).visibility !== "hidden" && !x.closest("[inert]"));
  if (!el.length) return;
  const first = el[0], last = el[el.length - 1], ae = document.activeElement;
  if (!box.contains(ae)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
  else if (e.shiftKey && ae === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && ae === last) { e.preventDefault(); first.focus(); }
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
  petDaCache();
  const petPronto = caricaPet(); // in sottofondo: spunte di oggi e pesi dal server
  // giorni attivi: subito quelli che si conoscono, poi (in sottofondo) quelli salvati sul server
  const giorniPronti = caricaGiorni();
  render(); maybeAutoRecap(); checkListeSconosciute();
  giorniPronti.then(() => aggiornaSblocchi());
  petPronto.then((c) => { if (c && state.tab === "pet" && !$("#sheet").classList.contains("on")) render(); });
  if (await giorniPronti && !$("#sheet").classList.contains("on") && state.tab !== "focus") render();
}
async function boot() {
  leggiInvitoDaLink();
  leggiAzioneDaLink();
  applyCustom();
  focusRiprendiDaSalvata();
  const th = LS.get("mochi.theme", "auto"); if (th !== "auto") document.documentElement.dataset.theme = th;
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

  if (!ONLINE_MODE) { showApp(); await loadAndRender(); maybeShowInstallHint();
    // ospite con un link d'invito: l'invito resta da parte (lo propongo dopo l'accesso)
    eseguiAzione();
    if (OSPITE) { let c = null; try { c = sessionStorage.getItem("mochi.invito"); } catch {} if (c && RE_INVITO.test(c)) setTimeout(() => toast("Crea un account per entrare nella lista"), 1200); } if (!OSPITE) maybeShowNovita(); else LS.set("mochi.novita.viste", NOVITA.punti.map((p) => p[0])); maybeBiscotto(); festeApri(); return; }

  // Modalità online: mostra subito la cache, poi verifica la sessione
  let logged = false;
  try { logged = await store.init(); } catch (e) {
    if (LS.get("mochi.cache", null)) { showApp(); state.items = normalizeAll(LS.get("mochi.cache", [])); setSync(false); render(); return; }
    setLoginMode("login"); $("#lErr").textContent = "Connessione assente. Riprova tra poco."; return;
  }
  if (/type=recovery/.test(location.hash)) { setLoginMode("newpass"); return; }
  if (!logged) { const modo = LS.get("mochi.ospite.modo", "login"); localStorage.removeItem("mochi.ospite.modo"); setLoginMode(modo === "signup" && SIGNUP_OPEN ? "signup" : "login"); maybeShowInstallHint(); return; }
  startOnline();
}
async function startOnline() {
  showApp();
  state.liste = LS.get("mochi.liste", []); if (!Array.isArray(state.liste)) state.liste = [];
  state.items = normalizeAll(LS.get("mochi.cache", [])); state.giorni = new Set(giorniCache()); render();
  await loadAndRender();
  maybeShowInstallHint();
  eseguiAzione();
  maybeShowNovita();
  maybeBiscotto();
  festeApri();
  proponiPassaggio();
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
function clearLocal() {
  ["mochi.spesaOff", "mochi.cache", "mochi.outbox", "mochi.recapSeen", "mochi.askedPush", "mochi.liste", "mochi.umoriCache", "mochi.turniCache", "mochi.speseCache", "mochi.focus.sessione"].forEach((k) => localStorage.removeItem(k));
  // la cache dei giorni si cancella; la coda "da inviare" è per utente e resta finché non è vuota (riparte al suo prossimo accesso)
  Object.keys(localStorage).filter((k) => k.startsWith("mochi.giorniCache.") || k.startsWith("mochi.petCache.") || k.startsWith("mochi.petFesta.") || (k.startsWith("mochi.petDaInviare.") && !(LS.get(k, []) || []).length) || (k.startsWith("mochi.giorniDaInviare.") && !(LS.get(k, []) || []).length)).forEach((k) => localStorage.removeItem(k));
  // gli sblocchi della casetta sono di chi esce: chi entra dopo su questo dispositivo non li eredita (i suoi tornano dall'account)
  const c = LS.get("mochi.custom", null); if (c && typeof c === "object") { c.casa = CASA_VUOTA; c.ricordi = []; c.compleanno = ""; c.fiori = cleanFiori(null); c.pronomi = ""; c.pet = cleanPet(null); LS.set("mochi.custom", c); }
  state.pet.righe = [];
  CUSTOM = cleanCustom({ ...CUSTOM, casa: CASA_VUOTA, ricordi: [], compleanno: "", fiori: null, pronomi: "", pet: null });
}
function setLoginMode(m) {
  loginMode = m;
  $("#login").classList.remove("hidden"); $("#app").classList.add("hidden"); $("#nav").classList.add("hidden");
  const T = {
    login:   ["Ciao!", `${MN()} custodisce le tue cose.<br>Entra per vederle.`, "Entra"],
    signup:  [gen("Che bello averti qui!", "Benvenuta!", "Benvenuto!"), "Crea il tuo spazio personale.<br>Le tue cose le vedi solo tu.", "Crea account"],
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
  // ospite: "Prova senza account", oppure "Continua come ospite" se ci sono già cose sul dispositivo
  const passaggio = LS.get("mochi.ospite", null) === "passaggio";
  $("#lOspite").classList.toggle("hidden", m === "newpass");
  $("#lOspite").textContent = passaggio ? "Continua come ospite" : "Prova senza account";
  $("#lOspiteNota").classList.toggle("hidden", !passaggio || m === "newpass" || m === "forgot");
  $("#lPrivacyRow").classList.remove("errore"); $("#lPrivacyErr").textContent = "";
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
$("#lPrivacy").addEventListener("change", () => { if ($("#lPrivacy").checked) { $("#lPrivacyRow").classList.remove("errore"); $("#lPrivacyErr").textContent = ""; } });
$("#lOspite").addEventListener("click", () => apriOspite());

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
      if (!$("#lPrivacy").checked) { $("#lPrivacyRow").classList.add("errore"); $("#lPrivacyErr").textContent = "Per creare l'account spunta la casella dell'informativa privacy"; $("#lPrivacy").focus(); throw new Error(""); }
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
  } catch (x) { err.style.color = ""; err.textContent = x.message === "" ? "" : x.message || "Qualcosa è andato storto"; }
  finally { btn.disabled = false; btn.style.opacity = ""; }
});

// aggiorna saluto e "rimaste indietro" ogni minuto
// (la pagina Concentrazione si aggiorna da sola ogni secondo: ridisegnarla farebbe ripartire le animazioni)
setInterval(() => { if (!$("#sheet").classList.contains("on") && !$("#app").classList.contains("hidden") && state.tab !== "focus") render(); }, 60000);

boot();
