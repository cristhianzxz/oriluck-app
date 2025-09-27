const { onSchedule } = require("firebase-functions/v2/scheduler");
const { logger } = require("firebase-functions");
const admin = require("firebase-admin");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

// ================= Constantes =================
const REGION = "southamerica-east1";
const TURN_DELAY_SECONDS = 5; // cada cuánto canta un número dentro del bucle
const BINGO_NUMBERS = Array.from({ length: 75 }, (_, i) => i + 1);

// ================= Helpers ====================
const sleep = (ms) => new Promise(res => setTimeout(res, ms));

// Aplana carta y elimina el 'FREE'
function getFlatCardNumbers(cardNumbers) {
  if (!Array.isArray(cardNumbers)) return [];
  // Si ya es plano (25) y no es anidado
  if (cardNumbers.length === 25 && !Array.isArray(cardNumbers[0])) {
    return cardNumbers.filter(n => n !== "FREE");
  }
  // Si es 5x5
  return cardNumbers.flat().filter(n => n !== "FREE");
}

// ===================================================
// Procesador principal: toma SOLO 1 torneo activo (secuencial)
// y dentro de la ejecución canta números cada 5s hasta:
// - que haya ganador(es)
// - se acaben los números
// - el torneo cambie de estado
// - o llegue el timeout de la función
// ===================================================
exports.bingoTurnProcessor = onSchedule({
  schedule: "every 1 minutes",
  region: REGION,
  timeoutSeconds: 540, // 9 minutos máximo
  memory: "256MiB",
}, async () => {
  logger.info("[BINGO] Buscando torneo activo...");

  const activeSnap = await db.collection("bingoTournaments")
    .where("status", "==", "active")
    .orderBy("startTime", "asc")
    .limit(1)
    .get();

  if (activeSnap.empty) {
    logger.info("[BINGO] No hay torneos activos.");
    return;
  }

  const tournamentDoc = activeSnap.docs[0];
  const tournamentRef = tournamentDoc.ref;
  const tournamentId = tournamentDoc.id;

  logger.info(`[BINGO] Procesando torneo activo: ${tournamentId}`);

  while (true) {
    let continueGame = true;
    let txError = null;

    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(tournamentRef);
        if (!snap.exists) {
          continueGame = false;
          return;
        }
        const data = snap.data();
        if (data.status !== "active") {
          logger.info(`[BINGO] Torneo ${tournamentId} ya no está activo.`);
          continueGame = false;
          return;
        }

        const calledNumbers = data.calledNumbers || [];
        const available = BINGO_NUMBERS.filter(n => !calledNumbers.includes(n));

        if (available.length === 0) {
          // Se acabaron los números sin ganadores registrados
            tx.update(tournamentRef, {
            status: "finished",
            winners: [],
            finishedAt: admin.firestore.FieldValue.serverTimestamp()
          });
          logger.info(`[BINGO] Sin números restantes. Torneo ${tournamentId} finalizado.`);
          continueGame = false;
          return;
        }

        // Elegir siguiente número
        const nextNumber = available[Math.floor(Math.random() * available.length)];
        const newCalled = [...calledNumbers, nextNumber];

        // Evaluar posibles ganadores (FULL CARD)
        const soldCards = data.soldCards || {};
        const cardKeys = Object.keys(soldCards).filter(k => k.startsWith("carton_"));

        const winnersMap = new Map(); // userId -> { userId, userName, cards: [] }

        for (const key of cardKeys) {
          const cardData = soldCards[key];
          if (!cardData?.userId || !cardData?.cardNumbers) continue;

          const flat = getFlatCardNumbers(cardData.cardNumbers); // 24 números (FREE excluido)
          if (flat.length === 24 && flat.every(num => newCalled.includes(num))) {
            // BINGO completo
            if (!winnersMap.has(cardData.userId)) {
              winnersMap.set(cardData.userId, {
                userId: cardData.userId,
                userName: cardData.userName || "Jugador",
                cards: []
              });
            }
            winnersMap.get(cardData.userId).cards.push(
              parseInt(key.replace("carton_", ""), 10)
            );
          }
        }

        const potentialWinners = Array.from(winnersMap.values());

        if (potentialWinners.length > 0) {
          // ---- Cálculo del premio CORRECTO ----
          const pricePerCard = data.pricePerCard || 0;
          const totalCards = cardKeys.length; // sin restar 1
          const totalPot = totalCards * pricePerCard;
          const prizeTotal = totalPot * 0.7; // 70% a los jugadores
          const prizePerWinner = prizeTotal / potentialWinners.length;

          const finalWinners = potentialWinners.map(w => ({
            ...w,
            prizeAmount: prizePerWinner
          }));

          // Acreditar premios
          finalWinners.forEach(w => {
            tx.update(db.doc(`users/${w.userId}`), {
              balance: admin.firestore.FieldValue.increment(prizePerWinner)
            });
          });

          // Ganancia de la casa (30%)
          tx.set(
            db.doc("appSettings/main"),
            { houseWinnings: admin.firestore.FieldValue.increment(totalPot * 0.3) },
            { merge: true }
          );

          // Cerrar torneo
          tx.update(tournamentRef, {
            status: "finished",
            winners: finalWinners,
            prizeTotal,
            prizePerWinner,
            currentNumber: nextNumber,
            calledNumbers: newCalled,
            finishedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastNumberTime: admin.firestore.FieldValue.serverTimestamp()
          });

          logger.info(`[BINGO] ¡Ganadores en torneo ${tournamentId}! Premios repartidos.`);
          continueGame = false;
        } else {
          // Continuar cantando
          tx.update(tournamentRef, {
            currentNumber: nextNumber,
            calledNumbers: newCalled,
            lastNumberTime: admin.firestore.FieldValue.serverTimestamp()
          });
          logger.info(`[BINGO] Número cantado (${nextNumber}) en torneo ${tournamentId}. Total cantados: ${newCalled.length}`);
        }
      });
    } catch (err) {
      logger.error("[BINGO] Error en transacción:", err);
      txError = err;
    }

    if (!continueGame || txError) break;

    // Esperar X segundos antes del siguiente número
    await sleep(TURN_DELAY_SECONDS * 1000);
  }

  logger.info(`[BINGO] Bucle terminado para torneo ${tournamentId}.`);
});

// La función bingoSequentialActivator ha sido eliminada.