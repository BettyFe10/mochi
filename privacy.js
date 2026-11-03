  const c = window.MOCHI_CONFIG || {};
  try { const m = JSON.parse(localStorage.getItem("mochi.custom") || "{}").mascotte; if (["nigi","mochi","bolla","miso","bambu","daifuku","tamago","kame","saltello","castagna","yuzu","marimo","sakura","nori","zucchero"].includes(m)) document.getElementById("pm").src = "icons/icon-" + m + "-192.png"; } catch {}
  if (c.TITOLARE_PRIVACY) document.getElementById("tit").textContent = c.TITOLARE_PRIVACY;
  if (c.EMAIL_PRIVACY) { const a = document.createElement("a"); a.href = "mailto:" + c.EMAIL_PRIVACY; a.textContent = c.EMAIL_PRIVACY; const m = document.getElementById("mail"); m.textContent = ""; m.appendChild(a); }

// Indietro / chiudi: se la pagina è stata aperta in una nuova scheda la chiude, altrimenti torna all'app
function tornaIndietro() {
  if (history.length > 1) { history.back(); return; }
  window.close();
  setTimeout(() => { location.href = "./"; }, 250); // se il browser non permette di chiuderla
}
document.querySelectorAll(".js-back").forEach((b) => b.addEventListener("click", tornaIndietro));
