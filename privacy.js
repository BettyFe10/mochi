// Informativa privacy: stessi colori, chiaro/scuro, carattere e stile scelti nell'app.
// Gira nella <head>, prima che la pagina si disegni (così non c'è il lampo di un tema diverso).
(function tema() {
  const leggi = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
  const c = leggi("mochi.custom", {}) || {}, root = document.documentElement;
  // solo valori conosciuti (gli stessi ammessi dall'app)
  if (["matcha", "lavanda", "pesca", "cielo"].includes(c.colore)) root.dataset.palette = c.colore;
  if (["tondo", "mano", "pastello", "leggibile", "sistema"].includes(c.font)) root.dataset.font = c.font;
  root.dataset.stile = ["quaderno", "cartone"].includes(c.stile) ? c.stile : "morbido";
  const th = leggi("mochi.theme", "auto");
  if (th === "light" || th === "dark") root.dataset.theme = th;
})();

document.addEventListener("DOMContentLoaded", () => {
  const c = window.MOCHI_CONFIG || {};
  try { const m = JSON.parse(localStorage.getItem("mochi.custom") || "{}").mascotte; if (["nigi","mochi","bolla","miso","bambu","daifuku","tamago","kame","saltello","castagna","yuzu","marimo","sakura","nori","zucchero"].includes(m)) document.getElementById("pm").src = "icons/icon-" + m + "-192.png"; } catch {}
  if (c.TITOLARE_PRIVACY) document.getElementById("tit").textContent = c.TITOLARE_PRIVACY;
  if (c.EMAIL_PRIVACY) { const a = document.createElement("a"); a.href = "mailto:" + c.EMAIL_PRIVACY; a.textContent = c.EMAIL_PRIVACY; const m = document.getElementById("mail"); m.textContent = ""; m.appendChild(a); }
  document.querySelectorAll(".js-back").forEach((b) => b.addEventListener("click", tornaIndietro));
});

// Indietro / chiudi: se la pagina è stata aperta in una nuova scheda la chiude, altrimenti torna all'app
function tornaIndietro() {
  if (history.length > 1) { history.back(); return; }
  window.close();
  setTimeout(() => { location.href = "./"; }, 250); // se il browser non permette di chiuderla
}
