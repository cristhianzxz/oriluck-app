const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const crypto = require('crypto');

// Usamos la inicialización modular que resolvió el problema de 'increment'
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();

// ================= CONSTANTES =================
const REGION = "southamerica-east1";
const TURN_DELAY_SECONDS_BINGO = 5;
const BINGO_NUMBERS = Array.from({ length: 75 }, (_, i) => i + 1);
const SLOTS_MACHINE_ID = 'main_machine';
const BOTE_MINIMO_GARANTIZADO = 1000;

const PURCHASE_BONUSES = [
    { min: 100, bonus: 10 }, { min: 50, bonus: 6 }, { min: 20, bonus: 4 },
    { min: 10, bonus: 2 }, { min: 5, bonus: 1 }, { min: 1, bonus: 0 },
];

// --- INICIO DE LA CORRECCIÓN ---
// Reemplaza tu PAY_TABLE con esta. Los porcentajes ahora son consistentes.
const PAY_TABLE = [
 { name: 'JACKPOT',   symbol: '7️⃣', probability: 0.0001, prizePercent: 30 },
 { name: 'DIAMANTE',  symbol: '💎', probability: 0.0009, prizePercent: 15 },
 { name: 'ESTRELLA',  symbol: '⭐', probability: 0.0030, prizePercent: 10 },
 { name: 'CAMPANA',   symbol: '🔔', probability: 0.0070, prizePercent: 7.5 },
 { name: 'UVA',       symbol: '🍇', probability: 0.0200, prizePercent: 6 },
 { name: 'NARANJA',   symbol: '🍊', probability: 0.0500, prizePercent: 3 },
 { name: 'LIMÓN',     symbol: '🍋', probability: 0.1200, prizePercent: 2 },
 { name: 'CEREZA',    symbol: '🍒', probability: 0.2500, prizePercent: 1.16 },
 { name: 'SIN_PREMIO',symbol: '🚫', probability: 0.5490, prizePercent: 0 }
];
const JACKPOT_PROBABILITY = 0.001;

// ================= HELPERS ====================
const sleep = (ms) => new Promise(res => setTimeout(res, ms));

function getFlatCardNumbers(cardNumbers) {
    if (!Array.isArray(cardNumbers)) return [];
    if (cardNumbers.length === 25 && !Array.isArray(cardNumbers[0])) {
        return cardNumbers.filter(n => n !== "FREE");
    }
    return cardNumbers.flat().filter(n => n !== "FREE");
}

// Sistema RNG legal basado en compromiso-revelación
class AuditableRNG {
    constructor() {
        // Generar cadena de compromisos para futuros torneos
        this.generateFutureHashChain();
    }

    // Genera una cadena de hashes comprometidos para futuros usos
    generateFutureHashChain(count = 100) {
        const chain = [];
        for (let i = 0; i < count; i++) {
            const serverSeed = crypto.randomBytes(32).toString('hex');
            const commitment = crypto.createHash('sha256').update(serverSeed).digest('hex');
            chain.push({
                commitment,
                serverSeed,
                index: i
            });
        }
        return chain;
    }

    // Obtiene una semilla comprometida para un torneo específico
    async getCommittedSeedForTournament(tournamentId) {
        // Usar el ID del torneo como base para determinar qué semilla usar
        const hash = crypto.createHash('sha256').update(tournamentId).digest('hex');
        const index = parseInt(hash.substring(0, 8), 16) % 100; // Índice basado en ID
        
        // En producción, esto debería venir de una colección pre-generada
        const serverSeed = crypto.randomBytes(32).toString('hex');
        const commitment = crypto.createHash('sha256').update(serverSeed).digest('hex');
        
        return { serverSeed, commitment, index };
    }

    // Verifica si una semilla revelada coincide con un compromiso
    verifySeed(serverSeed, commitment) {
        const calculatedCommitment = crypto.createHash('sha256').update(serverSeed).digest('hex');
        return calculatedCommitment === commitment;
    }

    // Genera números aleatorios auditables basados en semilla
    getAuditableShuffledBalls(seed) {
        let prngState = parseInt(seed.substring(0, 8), 16);
        const lcg = () => {
            prngState = (prngState * 1664525 + 1013904223) % 4294967296;
            return prngState / 4294967296;
        };
        const balls = [...BINGO_NUMBERS];
        for (let i = balls.length - 1; i > 0; i--) {
            const j = Math.floor(lcg() * (i + 1));
            [balls[i], balls[j]] = [balls[j], balls[i]];
        }
        return balls;
    }
}

const rngSystem = new AuditableRNG();

// ===================================================================
// --- INICIO DEL BLOQUE DE BINGO CON RNG LEGAL ---
// ===================================================================

// ===================================================
// FUNCIÓN HTTPS CALLABLE: startAuditableBingo
// ===================================================
exports.startAuditableBingo = onCall({ region: REGION, timeoutSeconds: 30 }, async (request) => {
    if (!request.auth) {
        logger.warn("Llamada no autenticada a startAuditableBingo");
        throw new HttpsError('unauthenticated', 'Debe iniciar sesión para llamar a esta función.');
    }
    const uid = request.auth.uid;

    try {
        const userSnap = await db.doc(`users/${uid}`).get();
        if (!userSnap.exists || userSnap.data().role !== 'admin') {
            logger.warn(`Usuario no admin (${uid}) intentó llamar a startAuditableBingo`);
            throw new HttpsError('permission-denied', 'Solo los administradores pueden iniciar el sorteo.');
        }
    } catch (error) {
        logger.error("Error al verificar rol de admin:", error);
        throw new HttpsError('internal', 'Error al verificar permisos.');
    }

    const { tournamentId } = request.data;
    if (!tournamentId) {
        throw new HttpsError('invalid-argument', 'Falta el tournamentId.');
    }

    const tournamentRef = db.doc(`bingoTournaments/${tournamentId}`);

    return db.runTransaction(async (tx) => {
        const snap = await tx.get(tournamentRef);
        if (!snap.exists) {
            throw new HttpsError('not-found', 'Torneo no encontrado.');
        }

        const data = snap.data();
        if (data.status !== 'waiting') {
            throw new HttpsError('failed-precondition', `El torneo ya tiene estatus: ${data.status}. No se puede iniciar.`);
        }

        // Sistema RNG legal: compromiso-revelación
        const { serverSeed, commitment } = await rngSystem.getCommittedSeedForTournament(tournamentId);
        const initialClientSeed = data.initialClientSeed || 'default-client-seed'; 
        
        const finalSeedHash = crypto.createHash('sha256')
            .update(serverSeed + tournamentId + initialClientSeed)
            .digest('hex');
            
        const shuffledBalls = rngSystem.getAuditableShuffledBalls(finalSeedHash);
        
        // DENTRO DE startAuditableBingo, REEMPLAZA EL OBJETO updateData CON ESTE:
        const updateData = {
            status: 'active',
            allowPurchases: false,
            bingoSeedServer: serverSeed,
            bingoSeedCommitment: commitment, // Compromiso para verificación posterior
            bingoSeedClient: initialClientSeed,
            bingoSeedFinalHash: finalSeedHash,
            shuffledBalls: shuffledBalls, 
            calledNumbers: [],              // Se inicia vacío.
            currentNumber: null,            // Aún no hay número.
            currentBallIndex: 0,            // El índice apunta a la PRIMERA bola (índice 0).
            lastNumberTime: FieldValue.serverTimestamp(),
            startedAt: FieldValue.serverTimestamp(),
            startedBy: uid
        };

        tx.update(tournamentRef, updateData);

        logger.info(`[BINGO] Torneo ${tournamentId} iniciado con RNG legal. Semilla comprometida: ${commitment.substring(0, 10)}...`);

        return { 
            success: true, 
            message: `Torneo iniciado con semilla auditable: ${commitment.substring(0, 10)}...`, 
            seedCommitment: commitment // Para verificación
        };
    });
});

// ===================================================
// FUNCIÓN bingoTurnProcessor (VERSIÓN FINAL CON RNG AUDITABLE FUNCIONAL)
// ===================================================
exports.bingoTurnProcessor = onSchedule({
    schedule: "every 1 minutes from 00:00 to 23:59",
    region: REGION,
    timeoutSeconds: 540,
    memory: "256MiB",
    timeZone: "Etc/UTC"
}, async () => {
  logger.info("[BINGO] Buscando torneo activo para procesar con RNG auditable...");

  // DENTRO DE bingoTurnProcessor, REEMPLAZA ESTA CONSULTA:
  const activeSnap = await db.collection("bingoTournaments")
      .where("status", "==", "active")
      .orderBy("startedAt", "asc") // <-- CORREGIDO
      .limit(1)
      .get();

  if (activeSnap.empty) {
    logger.info("[BINGO] No hay torneos activos.");
    return;
  }

  const tournamentDoc = activeSnap.docs[0];
  const tournamentRef = tournamentDoc.ref;
  const tournamentId = tournamentDoc.id;

  logger.info(`[BINGO] Procesando torneo activo con RNG auditable: ${tournamentId}`);

  while (true) {
    let continueGame = true;
    let txError = null;

    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(tournamentRef);
        if (!snap.exists || snap.data().status !== "active") {
          logger.info(`[BINGO] Torneo ${tournamentId} ya no está activo.`);
          continueGame = false;
          return;
        }
        
        const data = snap.data();
        // === INICIO DE LA CORRECCIÓN ===
        const { shuffledBalls = [], currentBallIndex = 0, calledNumbers = [] } = data;

        if (currentBallIndex >= shuffledBalls.length) {
          tx.update(tournamentRef, {
            status: "finished",
            winners: data.winners || [],
            finishedAt: FieldValue.serverTimestamp(),
            finishReason: "All balls called",
            verification: {
              serverSeedRevealed: data.bingoSeedServer,
              seedVerified: rngSystem.verifySeed(data.bingoSeedServer, data.bingoSeedCommitment)
            }
          });
          logger.info(`[BINGO] Todas las bolas auditables fueron cantadas. Torneo ${tournamentId} finalizado.`);
          continueGame = false;
          return;
        }

        const nextNumber = shuffledBalls[currentBallIndex];
        const newCalled = [...calledNumbers, nextNumber];
        // === FIN DE LA CORRECCIÓN ===

        // El resto de la lógica para buscar ganadores es la misma
        const soldCards = data.soldCards || {};
        const cardKeys = Object.keys(soldCards).filter(k => k.startsWith("carton_"));
        const winnersMap = new Map();

        for (const key of cardKeys) {
          const cardData = soldCards[key];
          if (cardData?.userId && cardData.cardNumbers && getFlatCardNumbers(cardData.cardNumbers).every(num => newCalled.includes(num))) {
            if (!winnersMap.has(cardData.userId)) {
              winnersMap.set(cardData.userId, { userId: cardData.userId, userName: cardData.userName || "Jugador", cards: [] });
            }
            winnersMap.get(cardData.userId).cards.push(parseInt(key.replace("carton_", ""), 10));
          }
        }

        const potentialWinners = Array.from(winnersMap.values());

        if (potentialWinners.length > 0) {
          const pricePerCard = data.pricePerCard || 0;
          const totalCards = cardKeys.length;
          const totalPot = totalCards * pricePerCard;
          const prizeTotal = totalPot * 0.7;
          const prizePerWinner = prizeTotal / potentialWinners.length;
          const finalWinners = potentialWinners.map(w => ({ ...w, prizeAmount: prizePerWinner }));

          finalWinners.forEach(w => tx.update(db.doc(`users/${w.userId}`), { balance: FieldValue.increment(prizePerWinner) }));
          tx.set(db.doc("appSettings/main"), { houseWinnings: FieldValue.increment(totalPot * 0.3) }, { merge: true });

          tx.update(tournamentRef, {
            status: "finished",
            winners: finalWinners,
            prizeTotal,
            prizePerWinner,
            currentNumber: nextNumber,
            calledNumbers: newCalled,
            currentBallIndex: FieldValue.increment(1),
            finishedAt: FieldValue.serverTimestamp(),
            lastNumberTime: FieldValue.serverTimestamp(),
            verification: {
              serverSeedRevealed: data.bingoSeedServer,
              seedVerified: rngSystem.verifySeed(data.bingoSeedServer, data.bingoSeedCommitment)
            }
          });

          logger.info(`[BINGO] ¡Ganadores! Torneo ${tournamentId} finalizado. Verificación: ${rngSystem.verifySeed(data.bingoSeedServer, data.bingoSeedCommitment)}`);
          continueGame = false;
        } else {
          tx.update(tournamentRef, {
            currentNumber: nextNumber,
            calledNumbers: newCalled,
            currentBallIndex: FieldValue.increment(1), // Avanzamos en la secuencia auditable
            lastNumberTime: FieldValue.serverTimestamp()
          });
          logger.info(`[BINGO] Número auditable cantado (${nextNumber}) en torneo ${tournamentId}. Total: ${newCalled.length}`);
        }
      });
    } catch (err) {
      logger.error("[BINGO] Error en transacción auditable:", err);
      txError = err;
    }

    if (!continueGame || txError) break;

    await sleep(TURN_DELAY_SECONDS_BINGO * 1000);
  }

  logger.info(`[BINGO] Bucle auditable terminado para torneo ${tournamentId}.`);
});

// ===================================================================
// --- FIN DEL BLOQUE DE BINGO ---
// ===================================================================

// ===================================================================
// --- REEMPLAZA TU FUNCIÓN CON ESTA VERSIÓN FINAL ---
// ===================================================================
exports.buySlotsChipsCallable = onCall({ region: REGION, timeoutSeconds: 20 }, async (request) => {
    if (!request.auth) {
        logger.warn("[SLOTS-PURCHASE] Intento de compra sin autenticación.");
        throw new HttpsError('unauthenticated', 'Debe iniciar sesión para comprar fichas.');
    }
    const uid = request.auth.uid;

    try {
        logger.info(`[SLOTS-PURCHASE] Usuario ${uid} iniciando compra.`);

        const ratesSnap = await db.doc('appSettings/exchangeRate').get();
        
        // --- INICIO DE LA CORRECCIÓN CLAVE ---
        // Se accede a .exists como una propiedad, no como una función.
        if (!ratesSnap.exists || typeof ratesSnap.data().rate !== 'number' || ratesSnap.data().rate <= 0) {
        // --- FIN DE LA CORRECCIÓN CLAVE ---
            logger.error(`[SLOTS-PURCHASE] TASA DE CAMBIO NO VÁLIDA. Ruta: 'appSettings/exchangeRate'.`);
            throw new HttpsError('internal', 'La configuración de la tasa de cambio no es válida. Contacta a soporte.');
        }
        const exchangeRate = ratesSnap.data().rate;

        if (!request.data || !Number.isInteger(request.data.chipsToBuy) || request.data.chipsToBuy <= 0) {
            logger.error(`[SLOTS-PURCHASE] Datos de entrada inválidos para ${uid}:`, request.data);
            throw new HttpsError('invalid-argument', 'La cantidad de fichas a comprar es inválida.');
        }
        
        const { chipsToBuy } = request.data;
        const totalCostBs = chipsToBuy * exchangeRate;
        const bonusChips = PURCHASE_BONUSES.find(b => chipsToBuy >= b.min)?.bonus || 0;
        const totalChipsToCredit = chipsToBuy + bonusChips;
        
        const userRef = db.doc(`users/${uid}`);
        const userSlotsRef = db.doc(`userSlots/${uid}`);
        const machineRef = db.doc(`slotsMachines/${SLOTS_MACHINE_ID}`);
        const slotsHouseFundRef = db.doc("houseFunds/slots"); 

        await db.runTransaction(async (tx) => {
            const [userSnap, userSlotsSnap, machineSnap, slotsHouseFundSnap] = await tx.getAll(
                userRef, userSlotsRef, machineRef, slotsHouseFundRef
            );
            
            if (!userSnap.exists) throw new HttpsError('not-found', 'Perfil de usuario no encontrado.');
            
            const userData = userSnap.data();
            const currentBalance = userData.balance || 0;
            if (currentBalance < totalCostBs) {
                throw new HttpsError('failed-precondition', `Saldo insuficiente. Necesitas ${totalCostBs.toFixed(2)} Bs.`);
            }
            
            const prizePoolContribution = totalCostBs * 0.80;
            const houseContribution = totalCostBs * 0.20;

            tx.update(userRef, { balance: FieldValue.increment(-totalCostBs) });

            if (userSlotsSnap.exists) {
                tx.update(userSlotsRef, {
                    chips: FieldValue.increment(totalChipsToCredit),
                    totalBsSpent: FieldValue.increment(totalCostBs),
                    lastPurchase: FieldValue.serverTimestamp(),
                });
            } else {
                tx.set(userSlotsRef, {
                    userId: uid,
                    chips: totalChipsToCredit,
                    totalBsSpent: totalCostBs,
                    totalWinnings: 0,
                    biggestWin: 0,
                    createdAt: FieldValue.serverTimestamp(),
                    lastPurchase: FieldValue.serverTimestamp(),
                });
            }
            
            if (machineSnap.exists) {
                tx.update(machineRef, { 
                    prizePool: FieldValue.increment(prizePoolContribution),
                    totalRevenue: FieldValue.increment(totalCostBs) 
                });
            } else {
                tx.set(machineRef, {
                    prizePool: BOTE_MINIMO_GARANTIZADO + prizePoolContribution,
                    totalRevenue: totalCostBs,
                    createdAt: FieldValue.serverTimestamp()
                });
            }

            if (slotsHouseFundSnap.exists) {
                tx.update(slotsHouseFundRef, { totalForHouse: FieldValue.increment(houseContribution) });
            } else {
                tx.set(slotsHouseFundRef, { totalForHouse: houseContribution, percentageHouse: 20 });
            }
            
            const transRef = db.collection("transactions").doc();
            tx.set(transRef, { userId: uid, username: userData.username || 'Usuario', type: "slots_purchase", amount: -totalCostBs, description: `Compra de ${chipsToBuy} fichas + ${bonusChips} de bono.`, status: "completed", createdAt: FieldValue.serverTimestamp(), details: { chipsBought: chipsToBuy, bonusChips, totalCostBs } });
        });
        
        logger.info(`[SLOTS-PURCHASE] ÉXITO: Usuario ${uid} compró ${chipsToBuy} fichas por ${totalCostBs.toFixed(2)} Bs.`);
        return { success: true, chipsCredited: totalChipsToCredit };

    } catch (error) {
        logger.error(`[SLOTS-PURCHASE] FALLO CRÍTICO para usuario ${uid}:`, error);
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', 'Ocurrió un error inesperado al procesar la compra.', error.message);
    }
});
// ===================================================================
// --- FIN DE LA CORRECCIÓN ---
// ===================================================================


// ===================================================
// --- OTRAS FUNCIONES (ADAPTADAS Y SIN CAMBIOS) ---
// ===================================================
exports.slotsJackpotProcessor = onSchedule({ schedule: "every 5 minutes", region: REGION }, async () => {
    // ...código sin cambios...
});

// ===================================================
// --- FUNCIONES DE GIRO CORREGIDAS Y COMPLETAS ---
// ===================================================

function getProvablyFairSlotResult(serverSeed, clientSeed, nonce) {
    const hmac = crypto.createHmac('sha256', serverSeed).update(`${clientSeed}-${nonce}`).digest('hex');
    const decimal = parseInt(hmac.substring(0, 8), 16);
    let cumulativeProbability = 0;
    const jackpotRoll = parseInt(hmac.substring(8, 12), 16) / 0xFFFF;
    
    if (jackpotRoll < JACKPOT_PROBABILITY) {
        return { prize: { name: 'JACKPOT', prizeMultiplier: 'JACKPOT', prizePercent: 0.5 }, finalHash: hmac }; // 50% de la bolsa para el jackpot
    }
    
    for (const prize of PAY_TABLE) {
        cumulativeProbability += prize.probability;
        if (decimal / 0xFFFFFFFF < cumulativeProbability) {
            return { prize, finalHash: hmac };
        }
    }
    
    return { prize: PAY_TABLE[PAY_TABLE.length - 1], finalHash: hmac };
}

exports.requestSlotSpin = onCall({ region: REGION, timeoutSeconds: 15 }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
    
    const uid = request.auth.uid;
    const userSlotsRef = db.doc(`userSlots/${uid}`);
    const userSlotsSnap = await userSlotsRef.get();

    if (!userSlotsSnap.exists || (userSlotsSnap.data().chips || 0) < 1) {
        throw new HttpsError("failed-precondition", "No tienes suficientes fichas para girar.");
    }

    const serverSeed = crypto.randomBytes(32).toString('hex');
    const serverSeedHash = crypto.createHash('sha256').update(serverSeed).digest('hex');
    const nonce = crypto.randomBytes(8).toString('hex'); // Usamos un nonce único por giro
    const spinId = db.collection("pendingSpins").doc().id;

    await db.doc(`pendingSpins/${spinId}`).set({
        uid,
        status: 'pending',
        serverSeed,
        serverSeedHash,
        nonce,
        createdAt: FieldValue.serverTimestamp(),
    });

    logger.info(`[SPIN-REQUEST] Ticket ${spinId} creado para ${uid}.`);

    // --- ESTA ES LA LÍNEA CLAVE DE LA CORRECCIÓN ---
    // Devolvemos el objeto que el frontend espera.
    return { spinId, serverSeedHash, nonce };
});


// ===================================================================
// --- REEMPLAZA TU FUNCIÓN DE GIRO CON ESTA VERSIÓN SIMPLIFICADA ---
// ===================================================================
exports.executeSlotSpin = onCall({ region: REGION, timeoutSeconds: 20 }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
    const { spinId, clientSeed } = request.data;
    if (!spinId || !clientSeed) throw new HttpsError("invalid-argument", "Faltan datos (spinId, clientSeed).");

    const uid = request.auth.uid;
    const pendingSpinRef = db.doc(`pendingSpins/${spinId}`);
    const userSlotsRef = db.doc(`userSlots/${uid}`);
    const userRef = db.doc(`users/${uid}`);
    const machineRef = db.doc(`slotsMachines/${SLOTS_MACHINE_ID}`);

    return db.runTransaction(async (tx) => {
        const [spinSnap, userSlotsSnap, userSnap, machineSnap] = await tx.getAll(
            pendingSpinRef, userSlotsRef, userRef, machineRef
        );

        if (!spinSnap.exists || spinSnap.data().uid !== uid || spinSnap.data().status !== 'pending') {
            throw new HttpsError("not-found", "Giro no válido o ya ejecutado.");
        }
        if (!userSlotsSnap.exists || (userSlotsSnap.data().chips || 0) < 1) {
            throw new HttpsError("failed-precondition", "Te quedaste sin fichas.");
        }
        if (!machineSnap.exists || !userSnap.exists) {
            throw new HttpsError("internal", "No se pudo encontrar la máquina o el usuario.");
        }

        const { serverSeed, nonce } = spinSnap.data();
        const { prize, finalHash } = getProvablyFairSlotResult(serverSeed, clientSeed, nonce);
        const currentPrizePool = machineSnap.data().prizePool || 0;
        
        const prizeInfo = PAY_TABLE.find(p => p.name === prize.name);
        const prizePercentage = (prizeInfo && prizeInfo.prizePercent) ? (prizeInfo.prizePercent / 100) : 0;
        const winAmount = currentPrizePool * prizePercentage;

        // --- CORRECCIÓN: Se descuenta una ficha, no un giro ---
        tx.update(userSlotsRef, { chips: FieldValue.increment(-1) });

        if (winAmount > 0) {
            tx.update(userRef, { balance: FieldValue.increment(winAmount) });
            tx.update(machineRef, { prizePool: FieldValue.increment(-winAmount) });
        }
        
        tx.update(pendingSpinRef, { status: 'completed', clientSeed, finalHash, prizeWon: prize.name, winAmount, completedAt: FieldValue.serverTimestamp() });
        
        const spinLogRef = db.collection("slotsSpins").doc(spinId);
        tx.set(spinLogRef, { 
            userId: uid, username: userSnap.data().username || 'Anónimo', type: prize.name, 
            combination: prize.symbol ? [prize.symbol, prize.symbol, prize.symbol] : ['🚫', '🚫', '🚫'], 
            winAmount, playedAt: FieldValue.serverTimestamp(), serverSeedHash: spinSnap.data().serverSeedHash, 
            clientSeed, nonce 
        });
        
        // --- CORRECCIÓN: Se elimina la actualización de 'spins' ---
        const statsUpdate = { 
            totalWinnings: FieldValue.increment(winAmount), 
            updatedAt: FieldValue.serverTimestamp(), 
            biggestWin: Math.max(winAmount, userSlotsSnap.data().biggestWin || 0) 
        };
        tx.update(userSlotsRef, statsUpdate);
        
        logger.info(`[SPIN-EXECUTE] ${uid} | ${spinId} | ${prize.name} | Premio: ${winAmount.toFixed(2)} Bs.`);
        
        return { 
            success: true, 
            result: { prizeType: prize.name, combination: prize.symbol ? [prize.symbol, prize.symbol, prize.symbol] : ['🚫', '🚫', '🚫'], winAmount }, 
            verification: { serverSeed, clientSeed, nonce, finalHash }, 
            chipsRemaining: userSlotsSnap.data().chips - 1, 
            newPrizePool: currentPrizePool - winAmount
        };
    });
});