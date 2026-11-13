// Service worker di Mochi: funzionamento offline + notifiche push
const CACHE = "mochi-v46";
const SHELL = [
  "./",
  "./index.html",
  "./tema.css",
  "./config.js",
  "./app.js",
  "./mascotte.js",
  "./frasi.js",
  "./privacy.js",
  "./manifest.webmanifest",
  "./privacy.html",
  "./vendor/supabase-2.118.0.js",
  "./vendor/fonts/fonts.css",
  "./vendor/fonts/fredoka-latin-500-normal.woff2",
  "./vendor/fonts/fredoka-latin-600-normal.woff2",
  "./vendor/fonts/fredoka-latin-700-normal.woff2",
  "./vendor/fonts/nunito-latin-400-normal.woff2",
  "./vendor/fonts/nunito-latin-600-normal.woff2",
  "./vendor/fonts/nunito-latin-700-normal.woff2",
  "./vendor/fonts/nunito-latin-800-normal.woff2",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/nigi.svg",
  "./icons/mochi.svg",
  "./icons/bolla.svg",
  "./icons/icon-nigi-180.png",
  "./icons/icon-nigi-192.png",
  "./icons/icon-nigi-512.png",
  "./icons/icon-mochi-180.png",
  "./icons/icon-mochi-192.png",
  "./icons/icon-mochi-512.png",
  "./icons/icon-bolla-180.png",
  "./icons/icon-bolla-192.png",
  "./icons/icon-bolla-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Le chiamate a Supabase non passano mai dalla cache
  if (url.hostname.endsWith("supabase.co") || url.hostname.endsWith("supabase.in")) return;

  // File dell'app (pagine, codice, configurazione): prima la rete, così correzioni e nuove chiavi
  // arrivano subito; la cache serve solo quando si è offline. Ogni file è salvato con il suo nome.
  if (url.origin === location.origin) {
    e.respondWith(
      // "no-cache": chiede sempre al server se il file è cambiato (risposta minima se non lo è).
      // Senza, Safari usa copie vecchie fino a 10 minuti e può mescolare pagina vecchia e codice nuovo.
      fetch(req, { cache: "no-cache" })
        .then((res) => {
          if (res.ok && res.type === "basic") { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === "navigate" ? caches.match("./index.html") : undefined)))
    );
    return;
  }
});

self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { title: "Mochi", body: e.data ? e.data.text() : "" }; }
  const title = data.title || "Mochi ti ricorda 🍡", body = data.body || "";
  e.waitUntil(Promise.all([
    self.registration.showNotification(title, {
      body,
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      tag: data.id || undefined,
      data: { url: "./" }
    }),
    // se l'app è aperta, la avviso: suona e mostra il promemoria anche dentro l'app
    self.clients.matchAll({ type: "window", includeUncontrolled: true })
      .then((list) => list.forEach((c) => c.postMessage({ tipo: "mochi-notifica", ric: String(data.id || "").startsWith("ric-"), title: String(title).slice(0, 120), body: String(body).slice(0, 300) })))
      .catch(() => {})
  ]));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ("focus" in c) return c.focus(); }
      return self.clients.openWindow("./");
    })
  );
});
