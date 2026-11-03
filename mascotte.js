// =========================================================
// Mascotte di Mochi: personaggi originali con parti animabili
// (.eyes = occhi aperti, .eyes-happy = occhi felici, .mouth / .mouth-happy = bocca)
// Usato dall'app e dallo script che genera le icone.
// =========================================================
(function (root) {
  const INK = "#4a2f3a";

  // Viso condiviso: occhi che sbattono, guance rosa, sorriso che si allarga quando è felice
  function face(cx, cy, gap, s = 1, blush = "#ff9ab8") {
    const r = 14 * s, hl = 5 * s, my = cy + 26 * s, w = 20 * s;
    return `
      <ellipse cx="${cx - gap - 30 * s}" cy="${cy + 28 * s}" rx="${22 * s}" ry="${13 * s}" fill="${blush}" opacity=".75"/>
      <ellipse cx="${cx + gap + 30 * s}" cy="${cy + 28 * s}" rx="${22 * s}" ry="${13 * s}" fill="${blush}" opacity=".75"/>
      <g class="eyes">
        <g class="eye"><circle cx="${cx - gap}" cy="${cy}" r="${r}" fill="${INK}"/><circle cx="${cx - gap + 4 * s}" cy="${cy - 5 * s}" r="${hl}" fill="#fff"/></g>
        <g class="eye"><circle cx="${cx + gap}" cy="${cy}" r="${r}" fill="${INK}"/><circle cx="${cx + gap + 4 * s}" cy="${cy - 5 * s}" r="${hl}" fill="#fff"/></g>
      </g>
      <g class="eyes-happy" fill="none" stroke="${INK}" stroke-width="${7 * s}" stroke-linecap="round">
        <path d="M${cx - gap - 13 * s} ${cy + 4 * s} Q${cx - gap} ${cy - 12 * s} ${cx - gap + 13 * s} ${cy + 4 * s}"/>
        <path d="M${cx + gap - 13 * s} ${cy + 4 * s} Q${cx + gap} ${cy - 12 * s} ${cx + gap + 13 * s} ${cy + 4 * s}"/>
      </g>
      <g class="eyes-closed" fill="none" stroke="${INK}" stroke-width="${7 * s}" stroke-linecap="round">
        <path d="M${cx - gap - 12 * s} ${cy + 2 * s} L${cx - gap + 12 * s} ${cy + 2 * s}"/>
        <path d="M${cx + gap - 12 * s} ${cy + 2 * s} L${cx + gap + 12 * s} ${cy + 2 * s}"/>
      </g>
      <path class="mouth" d="M${cx - w} ${my - 2 * s} Q${cx - w / 2} ${my + 12 * s} ${cx} ${my} Q${cx + w / 2} ${my + 12 * s} ${cx + w} ${my - 2 * s}"
        fill="none" stroke="${INK}" stroke-width="${7 * s}" stroke-linecap="round" stroke-linejoin="round"/>
      <path class="mouth-happy" d="M${cx - 22 * s} ${my - 4 * s} Q${cx} ${my + 34 * s} ${cx + 22 * s} ${my - 4 * s} Z" fill="${INK}"/>
      <path class="mouth-happy" d="M${cx - 11 * s} ${my + 13 * s} Q${cx} ${my + 6 * s} ${cx + 11 * s} ${my + 13 * s} Q${cx} ${my + 24 * s} ${cx - 11 * s} ${my + 13 * s} Z" fill="#ff7fa6"/>`;
  }

  const MASCOTTE = {
    mochi: {
      nome: "Mochi",
      descr: "Un dolcetto di riso alla fragola, morbido morbido",
      bg: ["#ffe1ea", "#ffc7d6"],
      viewBox: "60 70 380 360",
      art: () => `
        <ellipse class="shadow" cx="250" cy="408" rx="150" ry="20" fill="#e88aa8" opacity=".4"/>
        <g class="body">
          <path d="M90 300 C 90 180, 170 140, 250 140 C 330 140, 410 180, 410 300 C 410 380, 340 400, 250 400 C 160 400, 90 380, 90 300 Z" fill="#ffd3df" stroke="#f4b6c8" stroke-width="6"/>
          <path d="M130 250 C 150 200, 200 175, 240 172" stroke="#fff" stroke-width="14" stroke-linecap="round" fill="none" opacity=".7"/>
          <circle cx="330" cy="200" r="5" fill="#fff" opacity=".9"/><circle cx="150" cy="350" r="5" fill="#fff" opacity=".8"/><circle cx="360" cy="340" r="4" fill="#fff" opacity=".8"/>
          <g class="hat flower" style="transform-origin:250px 150px">
            <path d="M250 150 C 220 110, 180 112, 168 128 C 196 140, 222 150, 250 150 Z" fill="#7cc79a"/>
            <path d="M250 150 C 282 106, 324 108, 336 126 C 306 140, 280 150, 250 150 Z" fill="#64b487"/>
            <path d="M250 150 C 248 120, 256 100, 266 92" stroke="#4f9a6f" stroke-width="8" stroke-linecap="round" fill="none"/>
          </g>
          ${face(250, 290, 56, 1, "#ff8fb1")}
        </g>`
    },

    nigi: {
      nome: "Nigi",
      descr: "Un nigiri al salmone con un fiore di ciliegio",
      bg: ["#ffd6e4", "#ffb3cc"],
      viewBox: "70 90 380 350",
      art: () => `
        <ellipse class="shadow" cx="256" cy="418" rx="150" ry="22" fill="#e88aa8" opacity=".45"/>
        <g class="body">
          <rect x="96" y="210" width="320" height="200" rx="100" fill="#fffdf8" stroke="#f1d9df" stroke-width="6"/>
          <circle cx="150" cy="370" r="6" fill="#f3e6e0"/><circle cx="370" cy="360" r="6" fill="#f3e6e0"/><circle cx="330" cy="392" r="5" fill="#f3e6e0"/>
          <g class="hat">
            <path d="M84 222 C 120 130, 392 120, 432 214 C 440 238, 410 252, 380 244 C 300 222, 210 222, 132 246 C 100 256, 74 246, 84 222 Z" fill="#ff8f74"/>
            <path d="M150 196 C 200 168, 250 162, 300 170" stroke="#fff3ee" stroke-width="12" stroke-linecap="round" fill="none" opacity=".9"/>
            <path d="M136 226 C 196 198, 270 192, 340 202" stroke="#fff3ee" stroke-width="10" stroke-linecap="round" fill="none" opacity=".75"/>
            <rect x="232" y="200" width="48" height="84" rx="12" fill="#2f4a3a"/>
            <rect x="239" y="208" width="8" height="68" rx="4" fill="#3f6150" opacity=".7"/>
            <g class="flower"><g transform="translate(372 132)">
              <circle cx="0" cy="-22" r="16" fill="#fff0f5"/><circle cx="21" cy="-7" r="16" fill="#fff0f5"/>
              <circle cx="13" cy="18" r="16" fill="#fff0f5"/><circle cx="-13" cy="18" r="16" fill="#fff0f5"/>
              <circle cx="-21" cy="-7" r="16" fill="#fff0f5"/><circle cx="0" cy="0" r="9" fill="#ff7fa6"/>
            </g></g>
          </g>
          ${face(256, 322, 60)}
        </g>`
    },

    bolla: {
      nome: "Bolla",
      descr: "Una creaturina tascabile che vive nelle bolle di sapone",
      bg: ["#e9e1ff", "#cfc0ff"],
      viewBox: "50 60 400 380",
      art: () => `
        <ellipse class="shadow" cx="250" cy="414" rx="140" ry="20" fill="#9d86e6" opacity=".35"/>
        <g class="body">
          <path class="tail" style="transform-origin:380px 330px" d="M372 336 C 420 330, 440 290, 418 262 C 404 246, 384 256, 392 272 C 400 288, 392 306, 366 312 Z" fill="#b9a4ff"/>
          <g class="hat">
            <path d="M150 196 C 118 150, 120 104, 150 96 C 178 92, 196 140, 200 178 Z" fill="#b9a4ff"/>
            <path d="M156 178 C 140 150, 142 122, 154 118 C 168 116, 178 146, 182 168 Z" fill="#ffd1e6"/>
            <path d="M350 196 C 382 150, 380 104, 350 96 C 322 92, 304 140, 300 178 Z" fill="#b9a4ff"/>
            <path d="M344 178 C 360 150, 358 122, 346 118 C 332 116, 322 146, 318 168 Z" fill="#ffd1e6"/>
          </g>
          <ellipse cx="250" cy="290" rx="150" ry="122" fill="#c9b6ff"/>
          <ellipse cx="250" cy="338" rx="84" ry="62" fill="#f1ebff"/>
          <path d="M160 214 C 186 186, 220 176, 248 176" stroke="#fff" stroke-width="12" stroke-linecap="round" fill="none" opacity=".55"/>
          <ellipse cx="150" cy="398" rx="30" ry="16" fill="#b9a4ff"/><ellipse cx="350" cy="398" rx="30" ry="16" fill="#b9a4ff"/>
          <g class="flower" style="transform-origin:410px 150px">
            <circle cx="410" cy="150" r="26" fill="#ffffff" opacity=".35" stroke="#fff" stroke-width="4"/>
            <circle cx="400" cy="140" r="7" fill="#fff" opacity=".9"/>
            <circle cx="440" cy="108" r="12" fill="#ffffff" opacity=".3" stroke="#fff" stroke-width="3"/>
          </g>
          ${face(250, 270, 54, 1, "#ff9ac7")}
        </g>`
    },

    // ---------- Animaletti (personaggi originali) ----------
    miso: {
      nome: "Miso",
      descr: "Un gattino color caramello che fa le fusa quando spunti una cosa",
      bg: ["#ffe9d6", "#ffd2ae"],
      viewBox: "60 70 380 360",
      art: () => `
        <ellipse class="shadow" cx="250" cy="410" rx="148" ry="20" fill="#e8a27a" opacity=".38"/>
        <g class="body">
          <path class="tail" style="transform-origin:380px 360px" d="M372 362 C 428 352, 446 300, 420 270 C 406 254, 386 262, 394 280 C 404 304, 396 330, 366 336 Z" fill="#f7b98a" stroke="#eba274" stroke-width="5"/>
          <g class="hat">
            <path d="M138 214 L158 112 C 162 100, 172 98, 180 106 L238 172 Z" fill="#ffd7b0" stroke="#eba274" stroke-width="6" stroke-linejoin="round"/>
            <path d="M160 190 L172 136 L208 172 Z" fill="#ffb8c4"/>
            <path d="M362 214 L342 112 C 338 100, 328 98, 320 106 L262 172 Z" fill="#ffd7b0" stroke="#eba274" stroke-width="6" stroke-linejoin="round"/>
            <path d="M340 190 L328 136 L292 172 Z" fill="#ffb8c4"/>
          </g>
          <path d="M92 300 C 92 190, 170 152, 250 152 C 330 152, 408 190, 408 300 C 408 382, 340 406, 250 406 C 160 406, 92 382, 92 300 Z" fill="#ffd7b0" stroke="#eba274" stroke-width="6"/>
          <path d="M226 166 C 228 184, 230 196, 232 206 M250 160 L250 204 M274 166 C 272 184, 270 196, 268 206" stroke="#f2a46c" stroke-width="9" stroke-linecap="round" fill="none"/>
          <path d="M130 230 C 146 206, 172 190, 200 184" stroke="#fff" stroke-width="12" stroke-linecap="round" fill="none" opacity=".6"/>
          <g stroke="#c98a6a" stroke-width="4" stroke-linecap="round" opacity=".7">
            <path d="M104 318 L150 322"/><path d="M108 340 L150 334"/><path d="M396 318 L350 322"/><path d="M392 340 L350 334"/>
          </g>
          ${face(250, 290, 56, 1, "#ff9fb2")}
        </g>`
    },

    bambu: {
      nome: "Bambù",
      descr: "Un pandino dormiglione con una fogliolina sempre in testa",
      bg: ["#eef4ef", "#d6e8da"],
      viewBox: "60 70 380 360",
      art: () => `
        <ellipse class="shadow" cx="250" cy="410" rx="148" ry="20" fill="#8fb39a" opacity=".35"/>
        <g class="body">
          <g class="hat">
            <circle cx="150" cy="176" r="40" fill="#4f3f4a"/><circle cx="150" cy="176" r="20" fill="#7a6672"/>
            <circle cx="350" cy="176" r="40" fill="#4f3f4a"/><circle cx="350" cy="176" r="20" fill="#7a6672"/>
          </g>
          <path d="M92 300 C 92 192, 170 156, 250 156 C 330 156, 408 192, 408 300 C 408 382, 340 406, 250 406 C 160 406, 92 382, 92 300 Z" fill="#fffdfb" stroke="#e2d9de" stroke-width="6"/>
          <ellipse cx="194" cy="292" rx="40" ry="32" fill="#d9ccd4" transform="rotate(-18 194 292)"/>
          <ellipse cx="306" cy="292" rx="40" ry="32" fill="#d9ccd4" transform="rotate(18 306 292)"/>
          <path d="M132 236 C 150 210, 176 196, 204 190" stroke="#fff" stroke-width="12" stroke-linecap="round" fill="none" opacity=".8"/>
          <g class="flower" style="transform-origin:262px 160px">
            <path d="M262 162 C 262 140, 270 124, 284 114" stroke="#5aa06f" stroke-width="7" stroke-linecap="round" fill="none"/>
            <path d="M284 114 C 304 100, 328 104, 336 116 C 318 126, 298 126, 284 114 Z" fill="#7cc79a"/>
          </g>
          ${face(250, 290, 56, 1, "#ffb0c4")}
        </g>`
    },

    daifuku: {
      nome: "Daifuku",
      descr: "Una coniglietta morbida come il dolcetto da cui prende il nome",
      bg: ["#fff0f5", "#ffd9e6"],
      viewBox: "60 30 380 400",
      art: () => `
        <ellipse class="shadow" cx="250" cy="410" rx="148" ry="20" fill="#e88aa8" opacity=".35"/>
        <g class="body">
          <circle class="tail" style="transform-origin:404px 352px" cx="404" cy="352" r="26" fill="#fff" stroke="#f3c9d6" stroke-width="5"/>
          <g class="hat">
            <path d="M196 188 C 160 150, 150 70, 180 52 C 210 36, 236 110, 236 172 Z" fill="#fff6f9" stroke="#f3c9d6" stroke-width="6" stroke-linejoin="round"/>
            <path d="M204 168 C 184 140, 178 90, 190 78 C 204 70, 220 120, 222 160 Z" fill="#ffc7d8"/>
            <path d="M304 188 C 340 150, 350 70, 320 52 C 290 36, 264 110, 264 172 Z" fill="#fff6f9" stroke="#f3c9d6" stroke-width="6" stroke-linejoin="round"/>
            <path d="M296 168 C 316 140, 322 90, 310 78 C 296 70, 280 120, 278 160 Z" fill="#ffc7d8"/>
          </g>
          <path d="M92 304 C 92 196, 170 162, 250 162 C 330 162, 408 196, 408 304 C 408 384, 340 406, 250 406 C 160 406, 92 384, 92 304 Z" fill="#fff6f9" stroke="#f3c9d6" stroke-width="6"/>
          <path d="M132 240 C 150 214, 176 200, 204 196" stroke="#fff" stroke-width="12" stroke-linecap="round" fill="none" opacity=".9"/>
          <circle cx="330" cy="214" r="5" fill="#fff"/><circle cx="160" cy="360" r="5" fill="#fff"/>
          ${face(250, 296, 54, 1, "#ff9ab8")}
        </g>`
    },

    tamago: {
      nome: "Tamago",
      descr: "Un pulcino appena uscito dall'uovo, curioso di tutto",
      bg: ["#fff7d6", "#ffe9a3"],
      viewBox: "60 70 380 360",
      art: () => `
        <ellipse class="shadow" cx="250" cy="410" rx="148" ry="20" fill="#e3b54d" opacity=".35"/>
        <g class="body">
          <path class="tail" style="transform-origin:396px 320px" d="M392 286 C 428 290, 438 330, 414 352 C 404 332, 394 318, 382 312 Z" fill="#ffd95e" stroke="#efbf3a" stroke-width="5"/>
          <path d="M108 286 C 72 290, 62 330, 86 352 C 96 332, 106 318, 118 312 Z" fill="#ffd95e" stroke="#efbf3a" stroke-width="5"/>
          <g class="hat">
            <path d="M236 160 C 226 128, 236 108, 252 104 C 248 124, 252 142, 258 160 Z" fill="#ffd95e" stroke="#efbf3a" stroke-width="5" stroke-linejoin="round"/>
            <path d="M256 160 C 262 134, 280 122, 296 126 C 282 138, 274 150, 272 164 Z" fill="#ffd95e" stroke="#efbf3a" stroke-width="5" stroke-linejoin="round"/>
          </g>
          <path d="M96 300 C 96 196, 170 156, 250 156 C 330 156, 404 196, 404 300 C 404 382, 340 406, 250 406 C 160 406, 96 382, 96 300 Z" fill="#ffe680" stroke="#efbf3a" stroke-width="6"/>
          <path d="M134 238 C 152 212, 178 198, 206 192" stroke="#fff" stroke-width="12" stroke-linecap="round" fill="none" opacity=".75"/>
          <path d="M100 330 C 140 312, 180 326, 210 312 C 240 300, 262 322, 292 310 C 320 300, 352 318, 400 330 C 396 380, 340 406, 250 406 C 160 406, 104 380, 100 330 Z" fill="#fffaf0" stroke="#efe0bf" stroke-width="5"/>
          <path d="M241 288 L259 288 L250 300 Z" fill="#ff9e5e"/>
          ${face(250, 280, 54, 1, "#ffa8b8")}
        </g>`
    },

    kame: {
      nome: "Kame",
      descr: "Una tartarughina che va piano ma arriva sempre in fondo alla lista",
      bg: ["#eaf7e4", "#cdebc2"],
      viewBox: "60 80 380 350",
      art: () => `
        <ellipse class="shadow" cx="250" cy="414" rx="150" ry="18" fill="#7fb07a" opacity=".35"/>
        <g class="body">
          <ellipse cx="130" cy="392" rx="30" ry="18" fill="#bfe8a8" stroke="#86c47e" stroke-width="5"/>
          <ellipse cx="370" cy="392" rx="30" ry="18" fill="#bfe8a8" stroke="#86c47e" stroke-width="5"/>
          <g class="hat">
            <path d="M96 300 C 96 190, 170 132, 250 132 C 330 132, 404 190, 404 300 Z" fill="#8fcf7f" stroke="#5f9f58" stroke-width="7" stroke-linejoin="round"/>
            <path d="M250 150 L292 178 L292 222 L250 248 L208 222 L208 178 Z" fill="#a9dd98" stroke="#5f9f58" stroke-width="5" stroke-linejoin="round"/>
            <path d="M208 200 L150 196 M292 200 L350 196 M208 222 L168 264 M292 222 L332 264 M250 150 L250 136" stroke="#5f9f58" stroke-width="5" stroke-linecap="round"/>
          </g>
          <path d="M126 310 C 126 262, 180 240, 250 240 C 320 240, 374 262, 374 310 C 374 372, 324 400, 250 400 C 176 400, 126 372, 126 310 Z" fill="#d6f2c3" stroke="#86c47e" stroke-width="6"/>
          <path d="M154 290 C 166 270, 186 258, 210 254" stroke="#fff" stroke-width="10" stroke-linecap="round" fill="none" opacity=".7"/>
          ${face(250, 312, 46, .9, "#ffaab5")}
        </g>`
    },

    saltello: {
      nome: "Saltello",
      descr: "Un canguro piccolino con una tasca piena di cose da fare (già fatte)",
      bg: ["#fff0e0", "#ffd9b5"],
      viewBox: "60 40 380 390",
      art: () => `
        <ellipse class="shadow" cx="250" cy="414" rx="146" ry="18" fill="#d99a6c" opacity=".35"/>
        <g class="body">
          <path class="tail" style="transform-origin:390px 380px" d="M380 372 C 430 372, 456 340, 448 300 C 440 330, 418 346, 384 346 Z" fill="#e2a874" stroke="#c98a58" stroke-width="5"/>
          <g class="hat">
            <path d="M200 176 C 168 150, 156 84, 176 66 C 198 50, 226 110, 232 166 Z" fill="#e8b17e" stroke="#c98a58" stroke-width="6" stroke-linejoin="round"/>
            <path d="M206 160 C 188 138, 182 96, 192 86 C 204 78, 218 116, 220 152 Z" fill="#ffc9b6"/>
            <path d="M300 176 C 332 150, 344 84, 324 66 C 302 50, 274 110, 268 166 Z" fill="#e8b17e" stroke="#c98a58" stroke-width="6" stroke-linejoin="round"/>
            <path d="M294 160 C 312 138, 318 96, 308 86 C 296 78, 282 116, 280 152 Z" fill="#ffc9b6"/>
          </g>
          <path d="M92 300 C 92 196, 170 160, 250 160 C 330 160, 408 196, 408 300 C 408 382, 340 406, 250 406 C 160 406, 92 382, 92 300 Z" fill="#eebb88" stroke="#c98a58" stroke-width="6"/>
          <ellipse cx="250" cy="312" rx="64" ry="44" fill="#fbe1c4"/>
          <path d="M184 352 C 214 372, 286 372, 316 352 C 312 390, 290 400, 250 400 C 210 400, 188 390, 184 352 Z" fill="#fbe1c4" stroke="#d9a77a" stroke-width="5"/>
          <path d="M134 238 C 152 212, 178 198, 206 192" stroke="#fff" stroke-width="12" stroke-linecap="round" fill="none" opacity=".6"/>
          ${face(250, 288, 56, 1, "#ff9fae")}
        </g>`
    },

    castagna: {
      nome: "Castagna",
      descr: "Un riccio tutto punte fuori e tutto coccole dentro",
      bg: ["#f6ece4", "#e6d2c2"],
      viewBox: "60 70 380 360",
      art: () => `
        <ellipse class="shadow" cx="250" cy="412" rx="150" ry="18" fill="#a88a72" opacity=".35"/>
        <g class="body">
          <g class="hat">
            <path d="M84 318 L70 276 L104 270 L88 226 L126 228 L120 182 L160 196 L166 150 L200 172 L218 128 L246 160 L272 126 L292 166 L330 146 L336 192 L376 180 L374 226 L412 224 L398 268 L432 276 L416 318 Z" fill="#8a6650" stroke="#6b4c3a" stroke-width="6" stroke-linejoin="round"/>
          </g>
          <path d="M112 312 C 112 226, 176 196, 250 196 C 324 196, 388 226, 388 312 C 388 382, 334 406, 250 406 C 166 406, 112 382, 112 312 Z" fill="#fbe6cf" stroke="#d9b896" stroke-width="6"/>
          <path d="M150 262 C 166 240, 190 228, 214 224" stroke="#fff" stroke-width="10" stroke-linecap="round" fill="none" opacity=".7"/>
          ${face(250, 300, 52, .95, "#ffa3b1")}
        </g>`
    },

    yuzu: {
      nome: "Yuzu",
      descr: "Una capibara tranquillissima, con un agrume in testa come alle terme giapponesi",
      bg: ["#f7efe2", "#ead6b8"],
      viewBox: "60 70 380 360",
      art: () => `
        <ellipse class="shadow" cx="250" cy="412" rx="150" ry="18" fill="#b39373" opacity=".35"/>
        <g class="body">
          <g class="hat">
            <ellipse cx="160" cy="190" rx="22" ry="18" fill="#a77b55" stroke="#8a6142" stroke-width="5"/>
            <ellipse cx="340" cy="190" rx="22" ry="18" fill="#a77b55" stroke="#8a6142" stroke-width="5"/>
          </g>
          <path d="M100 290 C 100 214, 164 182, 250 182 C 336 182, 400 214, 400 290 C 400 380, 344 406, 250 406 C 156 406, 100 380, 100 290 Z" fill="#c99a6c" stroke="#a37650" stroke-width="6"/>
          <ellipse cx="250" cy="312" rx="74" ry="50" fill="#ddb68e"/>
          <ellipse cx="238" cy="294" rx="5" ry="3.5" fill="#6b4c3a"/><ellipse cx="262" cy="294" rx="5" ry="3.5" fill="#6b4c3a"/>
          <path d="M140 246 C 156 226, 180 214, 206 210" stroke="#fff" stroke-width="10" stroke-linecap="round" fill="none" opacity=".45"/>
          <g class="flower" style="transform-origin:250px 180px">
            <circle cx="250" cy="160" r="30" fill="#ffc83d" stroke="#e8a51c" stroke-width="5"/>
            <circle cx="240" cy="150" r="7" fill="#fff" opacity=".7"/>
            <path d="M250 130 C 254 118, 268 112, 278 116 C 270 126, 260 130, 250 130 Z" fill="#7cc79a"/>
          </g>
          ${face(250, 278, 60, 1, "#ffa8a8")}
        </g>`
    },

    marimo: {
      nome: "Marimo",
      descr: "Una pallina di muschio che vive in un barattolo e porta fortuna",
      bg: ["#e6f6ee", "#c4e8d4"],
      viewBox: "60 70 380 360",
      art: () => `
        <ellipse class="shadow" cx="250" cy="410" rx="140" ry="18" fill="#6fae8a" opacity=".35"/>
        <g class="body">
          <circle cx="250" cy="282" r="132" fill="#6cbf7f" stroke="#4f9e64" stroke-width="16" stroke-dasharray="3 7" stroke-linecap="round"/>
          <circle cx="250" cy="282" r="124" fill="#79c98b"/>
          <g fill="#5fae72" opacity=".75">
            <circle cx="180" cy="210" r="6"/><circle cx="320" cy="230" r="5"/><circle cx="160" cy="330" r="6"/><circle cx="340" cy="340" r="5"/>
            <circle cx="210" cy="372" r="4"/><circle cx="300" cy="190" r="4"/><circle cx="355" cy="285" r="4"/><circle cx="145" cy="270" r="4"/>
          </g>
          <path d="M160 222 C 176 198, 200 184, 228 178" stroke="#fff" stroke-width="12" stroke-linecap="round" fill="none" opacity=".45"/>
          <g class="flower" style="transform-origin:300px 156px">
            <circle cx="318" cy="140" r="12" fill="#ffffff" opacity=".45" stroke="#fff" stroke-width="3"/>
            <circle cx="342" cy="112" r="7" fill="#ffffff" opacity=".35" stroke="#fff" stroke-width="2"/>
          </g>
          ${face(250, 282, 52, 1, "#ff9fae")}
        </g>`
    },

    sakura: {
      nome: "Sakura",
      descr: "Un axolotl rosa che sorride sempre, anche il lunedì",
      bg: ["#ffeaf2", "#ffcde0"],
      viewBox: "50 70 400 360",
      art: () => `
        <ellipse class="shadow" cx="250" cy="412" rx="150" ry="18" fill="#e88aa8" opacity=".35"/>
        <g class="body">
          <path class="tail" style="transform-origin:384px 360px" d="M380 356 C 420 350, 448 372, 440 398 C 420 384, 400 380, 376 384 Z" fill="#ffc2d4" stroke="#f29ab8" stroke-width="5"/>
          <g class="hat">
            <path d="M120 236 C 84 222, 70 196, 80 184 C 98 194, 112 210, 128 222 Z M112 270 C 70 270, 52 252, 58 236 C 80 242, 98 252, 116 256 Z M118 304 C 82 316, 60 306, 60 290 C 82 288, 100 290, 118 292 Z" fill="#ff8fb1" stroke="#ef6f98" stroke-width="4" stroke-linejoin="round"/>
            <path d="M380 236 C 416 222, 430 196, 420 184 C 402 194, 388 210, 372 222 Z M388 270 C 430 270, 448 252, 442 236 C 420 242, 402 252, 384 256 Z M382 304 C 418 316, 440 306, 440 290 C 418 288, 400 290, 382 292 Z" fill="#ff8fb1" stroke="#ef6f98" stroke-width="4" stroke-linejoin="round"/>
          </g>
          <path d="M92 300 C 92 196, 170 168, 250 168 C 330 168, 408 196, 408 300 C 408 382, 340 406, 250 406 C 160 406, 92 382, 92 300 Z" fill="#ffd3e0" stroke="#f4a7c0" stroke-width="6"/>
          <path d="M134 238 C 152 212, 178 198, 206 192" stroke="#fff" stroke-width="12" stroke-linecap="round" fill="none" opacity=".6"/>
          <circle cx="180" cy="356" r="5" fill="#fff" opacity=".8"/><circle cx="330" cy="370" r="4" fill="#fff" opacity=".8"/>
          ${face(250, 292, 64, 1, "#ff8fb1")}
        </g>`
    },

    nori: {
      nome: "Nori",
      descr: "Una lontra che tiene per mano chi le vuole bene (e il suo sassolino preferito)",
      bg: ["#efe6df", "#dcc8ba"],
      viewBox: "60 70 380 360",
      art: () => `
        <ellipse class="shadow" cx="250" cy="412" rx="150" ry="18" fill="#a2826c" opacity=".35"/>
        <g class="body">
          <g class="hat">
            <circle cx="150" cy="196" r="24" fill="#9a7259" stroke="#7d5a44" stroke-width="5"/><circle cx="150" cy="196" r="11" fill="#d8b49a"/>
            <circle cx="350" cy="196" r="24" fill="#9a7259" stroke="#7d5a44" stroke-width="5"/><circle cx="350" cy="196" r="11" fill="#d8b49a"/>
          </g>
          <path d="M92 300 C 92 196, 170 168, 250 168 C 330 168, 408 196, 408 300 C 408 382, 340 406, 250 406 C 160 406, 92 382, 92 300 Z" fill="#a97e62" stroke="#7d5a44" stroke-width="6"/>
          <path d="M150 290 C 150 236, 196 218, 250 218 C 304 218, 350 236, 350 290 C 350 350, 306 372, 250 372 C 194 372, 150 350, 150 290 Z" fill="#f1dccb"/>
          <ellipse cx="250" cy="300" rx="12" ry="8" fill="#4a2f3a"/>
          <g stroke="#b99a84" stroke-width="4" stroke-linecap="round"><path d="M176 316 L136 310"/><path d="M178 330 L140 334"/><path d="M324 316 L364 310"/><path d="M322 330 L360 334"/></g>
          <ellipse cx="250" cy="392" rx="26" ry="16" fill="#c9c3cf" stroke="#a9a2b0" stroke-width="4"/>
          ${face(250, 282, 50, .95, "#ffa8b3")}
        </g>`
    },

    zucchero: {
      nome: "Zucchero",
      descr: "Un cavallino dalla criniera morbida che corre a festeggiare ogni cosa fatta",
      bg: ["#fdf0f7", "#f3d6ea"],
      viewBox: "60 50 380 380",
      art: () => `
        <ellipse class="shadow" cx="250" cy="412" rx="148" ry="18" fill="#c99ab8" opacity=".35"/>
        <g class="body">
          <path class="tail" style="transform-origin:392px 340px" d="M392 330 C 440 320, 456 360, 440 396 C 432 372, 416 360, 394 360 Z" fill="#c8a7f0" stroke="#a987d8" stroke-width="5"/>
          <g class="hat">
            <path d="M176 182 L166 108 C 166 96, 178 92, 186 100 L226 160 Z" fill="#fff4ea" stroke="#e8c9b4" stroke-width="6" stroke-linejoin="round"/>
            <path d="M182 160 L178 120 L204 154 Z" fill="#ffc9d6"/>
            <path d="M324 182 L334 108 C 334 96, 322 92, 314 100 L274 160 Z" fill="#fff4ea" stroke="#e8c9b4" stroke-width="6" stroke-linejoin="round"/>
            <path d="M318 160 L322 120 L296 154 Z" fill="#ffc9d6"/>
          </g>
          <path d="M92 300 C 92 196, 170 158, 250 158 C 330 158, 408 196, 408 300 C 408 382, 340 406, 250 406 C 160 406, 92 382, 92 300 Z" fill="#fff4ea" stroke="#e8c9b4" stroke-width="6"/>
          <g class="flower" style="transform-origin:250px 170px">
            <path d="M196 196 C 186 150, 214 120, 250 124 C 290 120, 318 146, 306 190 C 296 170, 280 162, 266 172 C 258 150, 236 150, 228 172 C 216 160, 202 170, 196 196 Z" fill="#c8a7f0" stroke="#a987d8" stroke-width="5" stroke-linejoin="round"/>
            <path d="M226 136 C 238 128, 254 126, 266 130" stroke="#fff" stroke-width="6" stroke-linecap="round" fill="none" opacity=".7"/>
          </g>
          <ellipse cx="250" cy="322" rx="70" ry="44" fill="#ffe1d2"/>
          <ellipse cx="222" cy="340" rx="5" ry="4" fill="#d6a99a"/><ellipse cx="278" cy="340" rx="5" ry="4" fill="#d6a99a"/>
          <path d="M134 246 C 152 222, 176 208, 204 202" stroke="#fff" stroke-width="12" stroke-linecap="round" fill="none" opacity=".8"/>
          ${face(250, 280, 58, 1, "#ffa8c0")}
        </g>`
    }
  };

  // SVG completo: senza sfondo (dentro l'app) o con sfondo arrotondato (icona Home/Dock)
  // Versione statica in uno stato preciso (per esportare immagini): normal | happy | blink
  function still(id, state = "normal") {
    const m = Object.prototype.hasOwnProperty.call(MASCOTTE, id) ? MASCOTTE[id] : MASCOTTE.mochi;
    const hide = { normal: ".eyes-happy,.mouth-happy,.eyes-closed", happy: ".eyes,.mouth,.eyes-closed", blink: ".eyes,.eyes-happy,.mouth-happy" }[state];
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${m.viewBox}"><style>${hide}{display:none}</style>${m.art()}</svg>`;
  }

  function svg(id, { icon = false, cls = "" } = {}) {
    const m = Object.prototype.hasOwnProperty.call(MASCOTTE, id) ? MASCOTTE[id] : MASCOTTE.mochi;
    if (!icon) return `<svg class="mascotte ${cls}" viewBox="${m.viewBox}" xmlns="http://www.w3.org/2000/svg" aria-label="${m.nome}">${m.art()}</svg>`;
    const [x, y, w, h] = m.viewBox.split(" ").map(Number);
    const size = Math.max(w, h) * 1.28, ox = x - (size - w) / 2, oy = y - (size - h) / 2;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${ox} ${oy} ${size} ${size}">
      <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${m.bg[0]}"/><stop offset="1" stop-color="${m.bg[1]}"/></linearGradient></defs>
      <rect x="${ox}" y="${oy}" width="${size}" height="${size}" rx="${size * 0.22}" fill="url(#bg)"/>
      <style>.eyes-happy,.mouth-happy,.eyes-closed{display:none}</style>${m.art()}</svg>`;
  }

  root.MOCHI_MASCOTTE = { list: MASCOTTE, svg, still };
  if (typeof module !== "undefined") module.exports = root.MOCHI_MASCOTTE;
})(typeof window !== "undefined" ? window : globalThis);
