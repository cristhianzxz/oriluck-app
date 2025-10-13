const assets = {
  fondo: "assets/fondo.jpeg",
  cohete: "assets/cohete.jpeg",
  meteorito: "assets/meteorito.jpeg",
  explosion: "assets/explosión.jpeg",
  boton: "assets/botón.jpeg",
  panelApuestas: "assets/panelapuestas.jpeg",
  rondas: "assets/rondas.jpeg",
  chat: "assets/chat.jpeg"
};

const canvas = document.getElementById('crashCanvas');
const ctx = canvas.getContext('2d');
const loaded = {};
let assetsLoaded = 0;
let totalAssets = Object.keys(assets).length;

// --- Estado del juego ---
let running = false;
let multiplier = 1.0;
let crashPoint = 2 + Math.random() * 30;
let rocketX = 120;
let rocketY = canvas.height - 180;
let cashedOut = false;
let animationFrame = null;
let lastCashout = null;

// Datos ficticios para historial y chat demo
let historialRondas = [
  { ronda: 1, mult: 2.41 },
  { ronda: 2, mult: 4.12 },
  { ronda: 3, mult: 8.90 },
  { ronda: 4, mult: 1.73 },
  { ronda: 5, mult: 13.77 }
];
let chatMensajes = [
  { usuario: "ReyCasino", mensaje: "¡Vamos con todo en esta ronda!" },
  { usuario: "EstrellaVIP", mensaje: "Retiré en 5.40x, buen crash!" },
  { usuario: "Player1", mensaje: "Alguien llegó a 10x hoy?" }
];

// --- Preload images ---
for (const key in assets) {
  loaded[key] = new Image();
  loaded[key].src = assets[key];
  loaded[key].onload = () => {
    assetsLoaded++;
    if (assetsLoaded === totalAssets) drawInitialUI();
  };
}

// --- Dibuja la UI completa ---
function drawInitialUI() {
  ctx.drawImage(loaded.fondo, 0, 0, canvas.width, canvas.height);
  drawPanelesUI();
  ctx.drawImage(loaded.cohete, rocketX, rocketY, 90, 90);
}

// --- Dibuja paneles, historial, chat, botón ---
function drawPanelesUI() {
  // Panel de apuestas
  ctx.drawImage(loaded.panelApuestas, 30, canvas.height - 300, 320, 270);

  // Botón principal
  ctx.drawImage(loaded.boton, canvas.width - 160, canvas.height - 120, 120, 120);

  // Panel historial de rondas (arriba)
  ctx.drawImage(loaded.rondas, canvas.width/2 - 200, 30, 400, 100);
  ctx.save();
  ctx.font = "bold 22px Arial";
  ctx.fillStyle = "#39ffeb";
  ctx.textAlign = "center";
  historialRondas.slice(-5).forEach((r, i) => {
    ctx.fillText(`${r.mult.toFixed(2)}x`, canvas.width/2 - 120 + i*60, 105);
  });
  ctx.restore();

  // Panel de chat (derecha)
  ctx.drawImage(loaded.chat, canvas.width - 330, 40, 300, 320);
  ctx.save();
  ctx.font = "18px Arial";
  ctx.fillStyle = "#39ffeb";
  chatMensajes.slice(-4).forEach((msg, i) => {
    ctx.fillText(`${msg.usuario}: ${msg.mensaje}`, canvas.width - 310, 110 + i*55);
  });
  ctx.restore();

  // Botón CASHOUT si está corriendo
  if (running && !cashedOut) {
    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = "#39ff14";
    ctx.strokeStyle = "#003600";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(canvas.width - 260, canvas.height - 200, 88, 48, 12);
    ctx.fill();
    ctx.stroke();
    ctx.font = "bold 24px Arial";
    ctx.fillStyle = "#222";
    ctx.textAlign = "center";
    ctx.fillText("CASHOUT", canvas.width - 216, canvas.height - 168);
    ctx.restore();
  }
}

// --- Animación del juego ---
function gameLoop() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(loaded.fondo, 0, 0, canvas.width, canvas.height);
  drawPanelesUI();

  // Multiplicador animado
  ctx.save();
  ctx.font = "bold 50px Arial";
  ctx.fillStyle = "#39ff14";
  ctx.shadowColor = "#39ff14";
  ctx.shadowBlur = 16;
  ctx.textAlign = "center";
  ctx.fillText(multiplier.toFixed(2) + "x", rocketX + 45, rocketY - 25);
  ctx.restore();

  // Ascenso del cohete
  if (running) {
    multiplier += 0.018 * multiplier;
    rocketX += 5;

    // Meteorito aparece cerca del crash
    if (multiplier > crashPoint * 0.75) {
      let meteorX = rocketX + 80;
      let meteorY = rocketY - 60;
      ctx.drawImage(loaded.meteorito, meteorX, meteorY, 90, 90);
    }

    ctx.drawImage(loaded.cohete, rocketX, rocketY, 90, 90);

    // CASHOUT visual si lo hizo el usuario
    if (cashedOut) {
      ctx.save();
      ctx.globalAlpha = 0.90;
      ctx.drawImage(loaded.explosion, rocketX - 30, rocketY - 30, 150, 150);
      ctx.restore();
      ctx.save();
      ctx.font = "bold 60px Arial";
      ctx.fillStyle = "#39ff14";
      ctx.shadowColor = "#39ff14";
      ctx.shadowBlur = 24;
      ctx.textAlign = "center";
      ctx.fillText("¡RETIRASTE!", canvas.width/2, canvas.height/2 - 60);
      ctx.font = "bold 44px Arial";
      ctx.fillText(lastCashout.toFixed(2) + "x", canvas.width/2, canvas.height/2 + 10);
      ctx.restore();
      return;
    }

    // Crash
    if (multiplier >= crashPoint) {
      running = false;
      historialRondas.push({ ronda: historialRondas.length + 1, mult: multiplier });
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.drawImage(loaded.explosion, rocketX - 30, rocketY - 30, 150, 150);
      ctx.restore();
      ctx.save();
      ctx.font = "bold 64px Arial";
      ctx.fillStyle = "#F87171";
      ctx.textAlign = "center";
      ctx.shadowColor = "#F87171";
      ctx.shadowBlur = 24;
      ctx.fillText("💥 CRASH!", canvas.width/2, canvas.height/2 - 70);
      ctx.font = "bold 50px Arial";
      ctx.fillStyle = "#39ff14";
      ctx.shadowColor = "#39ff14";
      ctx.shadowBlur = 20;
      ctx.fillText(multiplier.toFixed(2) + "x", canvas.width/2, canvas.height/2 + 10);
      ctx.restore();
      return;
    }

    animationFrame = requestAnimationFrame(gameLoop);
  } else {
    ctx.drawImage(loaded.cohete, rocketX, rocketY, 90, 90);
  }
}

// --- Botón para jugar ---
document.body.insertAdjacentHTML('beforeend',
  `<button id="startBtn" style="position:fixed;top:24px;right:40px;padding:12px 26px;font-size:1.2em;background:#39ff14;color:#232c4b;border:none;border-radius:8px;font-weight:bold;box-shadow:0 0 12px #39ff14;z-index:99;">JUGAR</button>`
);
document.getElementById('startBtn').onclick = startGame;

function startGame() {
  running = true;
  multiplier = 1.0;
  crashPoint = 2 + Math.random() * 30;
  rocketX = 120;
  rocketY = canvas.height - 180;
  cashedOut = false;
  lastCashout = null;
  if (animationFrame) cancelAnimationFrame(animationFrame);
  gameLoop();
}

// --- Evento cashout (click CASHOUT en canvas) ---
canvas.addEventListener('click', function(e) {
  if (!running || cashedOut) return;
  // Ubicación del botón CASHOUT visual
  const bx = canvas.width - 260, by = canvas.height - 200, bw = 88, bh = 48;
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  if (mx >= bx && mx <= bx + bw && my >= by && my <= by + bh) {
    cashedOut = true;
    lastCashout = multiplier;
    historialRondas.push({ ronda: historialRondas.length + 1, mult: multiplier });
    setTimeout(() => { running = false; }, 1200);
  }
});

// --- Puedes expandir: lógica real de apuestas, chat funcional, historial real desde backend ---