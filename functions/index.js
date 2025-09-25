/* Cloud Functions backend para Bingo Oriluck
   - Avanza la bolita cada 5s con Cloud Tasks, incluso sin usuarios conectados
   - Declara ganadores por BLACKOUT y finaliza el torneo
*/
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { CloudTasksClient } = require("@google-cloud/tasks");

admin.initializeApp();
const db = admin.firestore();

// Configuración
const REGION = "us-central1"; // ajusta si usas otra región
const QUEUE_ID = "bingo-ticks"; // crea esta cola en Cloud Tasks
const INTERVAL_MS = 5000; // 5s
const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
const TICK_URL = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net/tickBingo`;
const TICK_SECRET = process.env.TICK_SECRET || "set-me";

const tasksClient = new CloudTasksClient();

async function scheduleTick(tournamentId, delayMs = INTERVAL_MS) {
  const parent = tasksClient.queuePath(PROJECT_ID, REGION, QUEUE_ID);
  const payload = JSON.stringify({ tournamentId });

  const task = {
    httpRequest: {
      httpMethod: "POST",
      url: TICK_URL,
      headers: {
        "Content-Type": "application/json",
        "X-ORILUCK-TICK": TICK_SECRET
      },
      body: Buffer.from(payload).toString("base64")
    },
    scheduleTime: {
      seconds: Math.floor(Date.now() / 1000) + Math.ceil(delayMs / 1000)
    }
  };

  await tasksClient.createTask({ parent, task });
}

// Normaliza a matriz 5x5 por columnas (B,I,N,G,O)
function normalizeToColumnMatrix(input) {
  const ensureFreeCenter = (m) => {
    const matrix = m.map(col => col.slice());
    if (matrix[2][2] !== "FREE") matrix[2][2] = "FREE";
    return matrix;
  };

  if (Array.isArray(input) && Array.isArray(input[0])) {
    const arr = input;
    if (arr.length === 5 && arr.every(c => Array.isArray(c) && c.length === 5)) {
      const inRange = (n, min, max) => typeof n === "number" && n >= min && n <= max;
      const ranges = [[1,15],[16,30],[31,45],[46,60],[61,75]];
      const score = arr.reduce((acc, col, ci) => {
        const [mn, mx] = ranges[ci];
        return acc + col.reduce((s, v) => s + (v === "FREE" || inRange(v, mn, mx) ? 1 : 0), 0);
      }, 0);
      if (score >= 20) return ensureFreeCenter(arr);

      // Trasponer (venía como filas)
      const cols = Array.from({ length: 5 }, () => Array(5).fill(null));
      for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) cols[c][r] = arr[r][c];
      return ensureFreeCenter(cols);
    }
  }

  if (Array.isArray(input) && !Array.isArray(input[0])) {
    const flat = input.slice(0, 25);
    if (flat.length === 25) {
      const cols = [];
      for (let c = 0; c < 5; c++) cols.push(flat.slice(c * 5, c * 5 + 5));
      return ensureFreeCenter(cols);
    }
  }

  return null;
}

function hasBlackout(matrixCols, called) {
  if (!Array.isArray(matrixCols) || matrixCols.length !== 5) return false;
  const calledSet = new Set(called || []);
  const isMarked = (val) => val === "FREE" || calledSet.has(val);

  for (let c = 0; c < 5; c++) {
    for (let r = 0; r < 5; r++) {
      if (!isMarked(matrixCols[c]?.[r])) return false;
    }
  }
  return true;
}

// HTTP: ejecuta un “tick” (canta número, evalúa ganadores y re-agenda)
exports.tickBingo = functions.region(REGION).https.onRequest(async (req, res) => {
  try {
    if (req.get("X-ORILUCK-TICK") !== TICK_SECRET) {
      res.status(403).send("Forbidden");
      return;
    }

    const { tournamentId } = req.body || {};
    if (!tournamentId) {
      res.status(400).send("Missing tournamentId");
      return;
    }

    let shouldReschedule = false;

    await db.runTransaction(async (tx) => {
      const tRef = db.doc(`bingoTournaments/${tournamentId}`);
      const snap = await tx.get(tRef);
      if (!snap.exists) return;

      const cur = snap.data();
      if (cur.status !== "active") return;

      const winnersAlready = Array.isArray(cur.winners) ? cur.winners : [];
      if (winnersAlready.length > 0) return;

      const existing = Array.isArray(cur.calledNumbers) ? cur.calledNumbers : [];
      if (existing.length >= 75) {
        tx.update(tRef, { status: "finished" });
        return;
      }

      const last = cur.lastNumberTime && cur.lastNumberTime.toDate ? cur.lastNumberTime.toDate().getTime() : 0;
      const now = Date.now();
      const timeOk = !last || (now - last >= INTERVAL_MS - 50);

      let numbers = existing;
      let didDraw = false;

      if (timeOk) {
        const all = Array.from({ length: 75 }, (_, i) => i + 1);
        const set = new Set(existing);
        const available = all.filter((n) => !set.has(n));

        if (available.length === 0) {
          tx.update(tRef, { status: "finished" });
          return;
        }

        const newNumber = available[Math.floor(Math.random() * available.length)];
        numbers = [...existing, newNumber];
        didDraw = true;

        tx.update(tRef, {
          currentNumber: newNumber,
          calledNumbers: numbers,
          lastNumberTime: admin.firestore.FieldValue.serverTimestamp()
        });
      }

      const shouldEval = didDraw || (numbers.length >= 75);
      if (!shouldEval) {
        shouldReschedule = true;
        return;
      }

      // Buscar ganadores por BLACKOUT
      const called = numbers;
      const sold = cur.soldCards || {};
      const winnersNow = [];

      Object.keys(sold).forEach((cardKey) => {
        const cardData = sold[cardKey];
        const matrix = normalizeToColumnMatrix(cardData.cardNumbers);
        if (matrix && hasBlackout(matrix, called)) {
          const cardNumber = parseInt(cardKey.replace("carton_", ""), 10);
          winnersNow.push({
            userId: cardData.userId,
            userName: cardData.userName,
            cardNumber
          });
        }
      });

      if (winnersNow.length > 0) {
        const totalSold = Object.keys(cur.soldCards || {}).length;
        const pricePerCard = cur.pricePerCard || 100;
        const prizePool = Math.floor(totalSold * pricePerCard * 0.7);
        const prizePerWinner = Math.floor(prizePool / winnersNow.length);

        tx.update(tRef, {
          winners: winnersNow.map((w) => ({
            ...w,
            prizeAmount: prizePerWinner,
            winTime: admin.firestore.FieldValue.serverTimestamp(),
            pattern: "BLACKOUT"
          })),
          status: "finished"
        });
        shouldReschedule = false;
      } else if (numbers.length >= 75) {
        tx.update(tRef, { status: "finished" });
        shouldReschedule = false;
      } else {
        shouldReschedule = true;
      }
    });

    if (shouldReschedule) {
      await scheduleTick(tournamentId, INTERVAL_MS);
    }

    res.status(200).send("ok");
  } catch (err) {
    console.error("tickBingo error:", err);
    res.status(500).send("Internal error");
  }
});

// Cuando un torneo pasa a “active”, arrancamos el primer tick inmediato
exports.onTournamentActivated = functions
  .region(REGION)
  .firestore.document("bingoTournaments/{tournamentId}")
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();

    if (before?.status !== "active" && after?.status === "active") {
      try {
        await scheduleTick(context.params.tournamentId, 0);
      } catch (e) {
        console.error("scheduleTick initial error:", e);
      }
    }
  });