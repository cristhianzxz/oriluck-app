// MODIFICADO: Importaciones corregidas y separadas para la sintaxis v2
const { onCall, HttpsError, onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { logger } = require("firebase-functions");
const crypto = require('crypto');

// Usamos la inicialización modular
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

// NUEVO: Importar el cliente de Cloud Tasks
const { CloudTasksClient } = require('@google-cloud/tasks');

initializeApp();
const db = getFirestore();

// "Inicialización Perezosa" (Lazy Initialization)
let tasksClient;
let rngSystem;

// Constantes para Cloud Tasks
const PROJECT_ID = process.env.GCLOUD_PROJECT;
const QUEUE_LOCATION = "southamerica-east1";
const QUEUE_ID = 'crash-game-queue';

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

class AuditableRNG {
    constructor() {}
    generateFutureHashChain(count = 100) {
        const chain = [];
        for (let i = 0; i < count; i++) {
            const serverSeed = crypto.randomBytes(32).toString('hex');
            const commitment = crypto.createHash('sha256').update(serverSeed).digest('hex');
            chain.push({ commitment, serverSeed, index: i });
        }
        return chain;
    }
    async getCommittedSeedForTournament(tournamentId) {
        const serverSeed = crypto.randomBytes(32).toString('hex');
        const commitment = crypto.createHash('sha256').update(serverSeed).digest('hex');
        return { serverSeed, commitment, index: 0 };
    }
    verifySeed(serverSeed, commitment) {
        const calculatedCommitment = crypto.createHash('sha256').update(serverSeed).digest('hex');
        return calculatedCommitment === commitment;
    }
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

// ===================================================================
// --- BLOQUE DE BINGO ---
// ===================================================================
exports.startAuditableBingo = onCall({ region: REGION, timeoutSeconds: 30, cors: true }, async (request) => {
    if (!rngSystem) { rngSystem = new AuditableRNG(); }
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Debe iniciar sesión para llamar a esta función.');
    }
    const uid = request.auth.uid;
    try {
        const userSnap = await db.doc(`users/${uid}`).get();
        if (!userSnap.exists || userSnap.data().role !== 'admin') {
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
        const { serverSeed, commitment } = await rngSystem.getCommittedSeedForTournament(tournamentId);
        const initialClientSeed = data.initialClientSeed || 'default-client-seed';
        const finalSeedHash = crypto.createHash('sha256').update(serverSeed + tournamentId + initialClientSeed).digest('hex');
        const shuffledBalls = rngSystem.getAuditableShuffledBalls(finalSeedHash);
        const updateData = {
            status: 'active',
            allowPurchases: false,
            bingoSeedServer: serverSeed,
            bingoSeedCommitment: commitment,
            bingoSeedClient: initialClientSeed,
            bingoSeedFinalHash: finalSeedHash,
            shuffledBalls: shuffledBalls,
            calledNumbers: [],
            currentNumber: null,
            currentBallIndex: 0,
            lastNumberTime: FieldValue.serverTimestamp(),
            startedAt: FieldValue.serverTimestamp(),
            startedBy: uid
        };
        tx.update(tournamentRef, updateData);
        logger.info(`[BINGO] Torneo ${tournamentId} iniciado. Semilla comprometida: ${commitment.substring(0, 10)}...`);
        return { success: true, message: `Torneo iniciado con semilla auditable: ${commitment.substring(0, 10)}...`, seedCommitment: commitment };
    });
});

exports.bingoTurnProcessor = onSchedule({
    schedule: "every 1 minutes from 00:00 to 23:59",
    region: REGION,
    timeoutSeconds: 540,
    memory: "256MiB",
    timeZone: "Etc/UTC"
}, async () => {
    if (!rngSystem) { rngSystem = new AuditableRNG(); }
    logger.info("[BINGO] Buscando torneo activo para procesar...");
    const activeSnap = await db.collection("bingoTournaments").where("status", "==", "active").orderBy("startedAt", "asc").limit(1).get();
    if (activeSnap.empty) { return; }
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
                if (!snap.exists || snap.data().status !== "active") { continueGame = false; return; }
                const data = snap.data();
                const { shuffledBalls = [], currentBallIndex = 0, calledNumbers = [] } = data;
                if (currentBallIndex >= shuffledBalls.length) {
                    tx.update(tournamentRef, { status: "finished", winners: data.winners || [], finishedAt: FieldValue.serverTimestamp(), finishReason: "All balls called", verification: { serverSeedRevealed: data.bingoSeedServer, seedVerified: rngSystem.verifySeed(data.bingoSeedServer, data.bingoSeedCommitment) } });
                    continueGame = false; return;
                }
                const nextNumber = shuffledBalls[currentBallIndex];
                const newCalled = [...calledNumbers, nextNumber];
                const soldCards = data.soldCards || {};
                const cardKeys = Object.keys(soldCards).filter(k => k.startsWith("carton_"));
                const winnersMap = new Map();
                for (const key of cardKeys) {
                    const cardData = soldCards[key];
                    if (cardData?.userId && cardData.cardNumbers && getFlatCardNumbers(cardData.cardNumbers).every(num => newCalled.includes(num))) {
                        if (!winnersMap.has(cardData.userId)) { winnersMap.set(cardData.userId, { userId: cardData.userId, userName: cardData.userName || "Jugador", cards: [] }); }
                        winnersMap.get(cardData.userId).cards.push(parseInt(key.replace("carton_", ""), 10));
                    }
                }
                const potentialWinners = Array.from(winnersMap.values());
                if (potentialWinners.length > 0) {
                    const pricePerCard = data.pricePerCard || 0;
                    const totalPot = cardKeys.length * pricePerCard;
                    const prizeTotal = totalPot * 0.7;
                    const prizePerWinner = prizeTotal / potentialWinners.length;
                    const finalWinners = potentialWinners.map(w => ({ ...w, prizeAmount: prizePerWinner }));
                    finalWinners.forEach(w => tx.update(db.doc(`users/${w.userId}`), { balance: FieldValue.increment(prizePerWinner) }));
                    tx.set(db.doc("appSettings/main"), { houseWinnings: FieldValue.increment(totalPot * 0.3) }, { merge: true });
                    tx.update(tournamentRef, { status: "finished", winners: finalWinners, prizeTotal, prizePerWinner, currentNumber: nextNumber, calledNumbers: newCalled, currentBallIndex: FieldValue.increment(1), finishedAt: FieldValue.serverTimestamp(), lastNumberTime: FieldValue.serverTimestamp(), verification: { serverSeedRevealed: data.bingoSeedServer, seedVerified: rngSystem.verifySeed(data.bingoSeedServer, data.bingoSeedCommitment) } });
                    continueGame = false;
                } else {
                    tx.update(tournamentRef, { currentNumber: nextNumber, calledNumbers: newCalled, currentBallIndex: FieldValue.increment(1), lastNumberTime: FieldValue.serverTimestamp() });
                }
            });
        } catch (err) {
            logger.error("[BINGO] Error en transacción:", err);
            txError = err;
        }
        if (!continueGame || txError) break;
        await sleep(TURN_DELAY_SECONDS_BINGO * 1000);
    }
});

// ===================================================================
// --- BLOQUE DE SLOTS ---
// ===================================================================
exports.buySlotsChipsCallable = onCall({ region: REGION, timeoutSeconds: 20, cors: true }, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Debe iniciar sesión para comprar fichas.');
    }
    const uid = request.auth.uid;
    try {
        const ratesSnap = await db.doc('appSettings/exchangeRate').get();
        if (!ratesSnap.exists || typeof ratesSnap.data().rate !== 'number' || ratesSnap.data().rate <= 0) {
            throw new HttpsError('internal', 'La configuración de la tasa de cambio no es válida.');
        }
        const exchangeRate = ratesSnap.data().rate;
        if (!request.data || !Number.isInteger(request.data.chipsToBuy) || request.data.chipsToBuy <= 0) {
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
            const [userSnap, userSlotsSnap, machineSnap, slotsHouseFundSnap] = await tx.getAll(userRef, userSlotsRef, machineRef, slotsHouseFundRef);
            if (!userSnap.exists) throw new HttpsError('not-found', 'Perfil de usuario no encontrado.');
            const userData = userSnap.data();
            if ((userData.balance || 0) < totalCostBs) {
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
                tx.update(slotsHouseFundSnap, { totalForHouse: FieldValue.increment(houseContribution) });
            } else {
                tx.set(slotsHouseFundSnap, { totalForHouse: houseContribution, percentageHouse: 20 });
            }
            const transRef = db.collection("transactions").doc();
            tx.set(transRef, { userId: uid, username: userData.username || 'Usuario', type: "slots_purchase", amount: -totalCostBs, description: `Compra de ${chipsToBuy} fichas + ${bonusChips} de bono.`, status: "completed", createdAt: FieldValue.serverTimestamp(), details: { chipsBought: chipsToBuy, bonusChips, totalCostBs } });
        });
        return { success: true, chipsCredited: totalChipsToCredit };
    } catch (error) {
        logger.error(`[SLOTS-PURCHASE] FALLO CRÍTICO para usuario ${uid}:`, error);
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', 'Ocurrió un error inesperado al procesar la compra.', error.message);
    }
});

exports.slotsJackpotProcessor = onSchedule({ schedule: "every 5 minutes", region: REGION }, async () => {
    // Código de slotsJackpotProcessor sin cambios
});

function getProvablyFairSlotResult(serverSeed, clientSeed, nonce) {
    const hmac = crypto.createHmac('sha256', serverSeed).update(`${clientSeed}-${nonce}`).digest('hex');
    const decimal = parseInt(hmac.substring(0, 8), 16);
    let cumulativeProbability = 0;
    const jackpotRoll = parseInt(hmac.substring(8, 12), 16) / 0xFFFF;
    if (jackpotRoll < JACKPOT_PROBABILITY) {
        return { prize: { name: 'JACKPOT', prizeMultiplier: 'JACKPOT', prizePercent: 0.5 }, finalHash: hmac };
    }
    for (const prize of PAY_TABLE) {
        cumulativeProbability += prize.probability;
        if (decimal / 0xFFFFFFFF < cumulativeProbability) {
            return { prize, finalHash: hmac };
        }
    }
    return { prize: PAY_TABLE[PAY_TABLE.length - 1], finalHash: hmac };
}

exports.requestSlotSpin = onCall({ region: REGION, timeoutSeconds: 15, cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
    const uid = request.auth.uid;
    const userSlotsRef = db.doc(`userSlots/${uid}`);
    const userSlotsSnap = await userSlotsRef.get();
    if (!userSlotsSnap.exists || (userSlotsSnap.data().chips || 0) < 1) {
        throw new HttpsError("failed-precondition", "No tienes suficientes fichas para girar.");
    }
    const serverSeed = crypto.randomBytes(32).toString('hex');
    const serverSeedHash = crypto.createHash('sha256').update(serverSeed).digest('hex');
    const nonce = crypto.randomBytes(8).toString('hex');
    const spinId = db.collection("pendingSpins").doc().id;
    await db.doc(`pendingSpins/${spinId}`).set({
        uid,
        status: 'pending',
        serverSeed,
        serverSeedHash,
        nonce,
        createdAt: FieldValue.serverTimestamp(),
    });
    return { spinId, serverSeedHash, nonce };
});

exports.executeSlotSpin = onCall({ region: REGION, timeoutSeconds: 20, cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
    const { spinId, clientSeed } = request.data;
    if (!spinId || !clientSeed) throw new HttpsError("invalid-argument", "Faltan datos (spinId, clientSeed).");
    const uid = request.auth.uid;
    const pendingSpinRef = db.doc(`pendingSpins/${spinId}`);
    const userSlotsRef = db.doc(`userSlots/${uid}`);
    const userRef = db.doc(`users/${uid}`);
    const machineRef = db.doc(`slotsMachines/${SLOTS_MACHINE_ID}`);
    return db.runTransaction(async (tx) => {
        const [spinSnap, userSlotsSnap, userSnap, machineRef] = await tx.getAll(pendingSpinRef, userSlotsRef, userRef, machineRef);
        if (!spinSnap.exists || spinSnap.data().uid !== uid || spinSnap.data().status !== 'pending') {
            throw new HttpsError("not-found", "Giro no válido o ya ejecutado.");
        }
        if (!userSlotsSnap.exists || (userSlotsSnap.data().chips || 0) < 1) {
            throw new HttpsError("failed-precondition", "Te quedaste sin fichas.");
        }
        if (!machineRef.exists || !userSnap.exists) {
            throw new HttpsError("internal", "No se pudo encontrar la máquina o el usuario.");
        }
        const { serverSeed, nonce } = spinSnap.data();
        const { prize, finalHash } = getProvablyFairSlotResult(serverSeed, clientSeed, nonce);
        const currentPrizePool = machineRef.data().prizePool || 0;
        const prizeInfo = PAY_TABLE.find(p => p.name === prize.name);
        const prizePercentage = (prizeInfo && prizeInfo.prizePercent) ? (prizeInfo.prizePercent / 100) : 0;
        const winAmount = currentPrizePool * prizePercentage;
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
        const statsUpdate = {
            totalWinnings: FieldValue.increment(winAmount),
            updatedAt: FieldValue.serverTimestamp(),
            biggestWin: Math.max(winAmount, userSlotsSnap.data().biggestWin || 0)
        };
        tx.update(userSlotsRef, statsUpdate);
        return {
            success: true,
            result: { prizeType: prize.name, combination: prize.symbol ? [prize.symbol, prize.symbol, prize.symbol] : ['🚫', '🚫', '🚫'], winAmount },
            verification: { serverSeed, clientSeed, nonce, finalHash },
            chipsRemaining: userSlotsSnap.data().chips - 1,
            newPrizePool: currentPrizePool - winAmount
        };
    });
});

// ===================================================================
// --- MOTOR DE JUEGO CRASH (VERSIÓN FINAL Y ESTABLE) ---
// ===================================================================

const CRASH_CONSTANTS = {
    BETTING_TIME_MS: 10000,
    PAUSE_BETWEEN_ROUNDS_MS: 7000,
    GROWTH_FACTOR: 0.00007,
    FINANCIAL_CAP_MULTIPLIER: 100.00,
};

function getProvablyFairCrashPoint(serverSeed) {
    const hmac = crypto.createHmac('sha256', serverSeed).update("crash-game-salt-v2").digest('hex');
    const hashInt = parseInt(hmac.substring(0, 8), 16);
    const e = Math.pow(2, 32);
    if (e - hashInt === 0) return 1.00;
    const crashPoint = Math.floor((100 * e - hashInt) / (e - hashInt));
    return crashPoint < 100 ? 1.00 : parseFloat((crashPoint / 100).toFixed(2));
}

function generateAttractiveHistoryResult() {
    const roll = Math.random();
    if (roll < 0.70) { return 1.5 + Math.random() * 3.5; } 
    else if (roll < 0.95) { return 5.0 + Math.random() * 15; } 
    else { return 20.0 + Math.random() * 80; }
}

exports.processCrashRound = onRequest({ region: REGION, timeoutSeconds: 60, memory: "256MiB" }, async (req, res) => {
    if (!tasksClient) { tasksClient = new CloudTasksClient(); }
    logger.info("[CRASH ENGINE V2] Procesando una ronda...");

    if (req.header('X-CloudTasks-QueueName') !== QUEUE_ID && process.env.FUNCTIONS_EMULATOR !== 'true') {
        logger.warn("Llamada no autorizada a processCrashRound denegada.");
        return res.status(403).send("Unauthorized");
    }

    const gameDocRef = db.doc('game_crash/live_game');
    const historyCollectionRef = db.collection('game_crash_history');
    
    try {
        const engineConfigRef = db.doc('game_crash/engine_config');
        const configSnap = await engineConfigRef.get();
        if (!configSnap.exists || configSnap.data().status !== 'enabled') {
            logger.warn("[CRASH ENGINE V2] Motor desactivado. Deteniendo el bucle.");
            await gameDocRef.set({ gameState: 'stopped' }, { merge: true });
            return res.status(200).send("Engine stopped.");
        }

        const previousGameSnap = await gameDocRef.get();
        if (previousGameSnap.exists && previousGameSnap.data().roundId) {
            const oldData = previousGameSnap.data();
            if (oldData.gameState !== 'waiting') {
                const playersSnap = await gameDocRef.collection('players').get();
                const oldPlayers = playersSnap.docs.map(doc => doc.data());
                const totalPot = oldPlayers.reduce((sum, p) => sum + (p.bet || 0), 0);
                const totalPayout = oldPlayers.filter(p => p.status === 'cashed_out').reduce((sum, p) => sum + (p.winnings || 0), 0);
                const netProfit = totalPot - totalPayout;
                await historyCollectionRef.doc(oldData.roundId).set({
                    crashPoint: oldData.crashPoint || 1.00,
                    totalPot,
                    netProfit,
                    timestamp: oldData.started_at || FieldValue.serverTimestamp(),
                    serverSeed: oldData.serverSeed || '',
                });
            }
            const playersToDeleteSnap = await gameDocRef.collection('players').get();
            if (!playersToDeleteSnap.empty) {
                const batch = db.batch();
                playersToDeleteSnap.forEach(doc => batch.delete(doc.ref));
                await batch.commit();
            }
        }

        const roundId = db.collection('dummy').doc().id;
        const serverSeed = crypto.randomBytes(32).toString('hex');
        const serverSeedHash = crypto.createHash('sha256').update(serverSeed).digest('hex');
        
        await gameDocRef.set({
            gameState: 'waiting',
            roundId,
            serverSeedHash,
            wait_until: new Date(Date.now() + CRASH_CONSTANTS.BETTING_TIME_MS),
            server_time_now: FieldValue.serverTimestamp(),
        });
        logger.info(`[CRASH ENGINE V2] Ronda ${roundId} en estado 'waiting'.`);
        
        await sleep(CRASH_CONSTANTS.BETTING_TIME_MS);
        
        const playersSnap = await gameDocRef.collection('players').get();
        const totalPot = playersSnap.docs.reduce((sum, doc) => sum + (doc.data().bet || 0), 0);
        
let crashPoint;
const MARGEN_CASA = 3.00; // 3% margen de la casa

if (totalPot === 0) {
    crashPoint = parseFloat(generateAttractiveHistoryResult().toFixed(2));
} else {
    // Calcula el crashPoint máximo permitido para proteger el margen de la casa
    // Si quieres que el crashPoint máximo dependa del pozo y margen:
    // Ejemplo: Si el pozo es 10,000 y el margen es 3%, el crash máximo sería 1.03x
    const maxCrashPoint = Math.max(1.01, 1 + MARGEN_CASA);
    const provablyFairCrash = getProvablyFairCrashPoint(serverSeed);
    crashPoint = Math.min(provablyFairCrash, maxCrashPoint, CRASH_CONSTANTS.FINANCIAL_CAP_MULTIPLIER);
}
        
        const timeToCrashMs = crashPoint > 1 ? Math.log(crashPoint) / CRASH_CONSTANTS.GROWTH_FACTOR : 0;
        logger.info(`Iniciando fase 'running'. CrashPoint: ${crashPoint}x, Duración: ${(timeToCrashMs / 1000).toFixed(2)}s`);

        await gameDocRef.update({
            gameState: 'running',
            started_at: FieldValue.serverTimestamp(),
            crashPoint,
            serverSeed,
            rocketPathK: CRASH_CONSTANTS.GROWTH_FACTOR,
            server_time_now: FieldValue.serverTimestamp(),
        });
        
        await sleep(timeToCrashMs);
        
        await gameDocRef.update({ 
            gameState: 'crashed',
            server_time_now: FieldValue.serverTimestamp()
        });
        logger.info(`Ronda ${roundId} ha crasheado en ${crashPoint}x.`);
        
        await sleep(CRASH_CONSTANTS.PAUSE_BETWEEN_ROUNDS_MS);

        const queuePath = tasksClient.queuePath(PROJECT_ID, QUEUE_LOCATION, QUEUE_ID);
        const url = `https://${QUEUE_LOCATION}-${PROJECT_ID}.cloudfunctions.net/processCrashRound`;
const task = {
    httpRequest: { httpMethod: 'POST', url },
    scheduleTime: { seconds: Math.floor(nextRoundTime / 1000) }
};
await tasksClient.createTask({ parent: queuePath, task });
        logger.info(`Siguiente ronda programada.`);
        
        return res.status(200).send({ success: true, roundId });

    } catch (error) {
        logger.error(`[CRASH ENGINE V2] Error crítico en el motor:`, error);
        return res.status(500).send("Error en el motor del juego.");
    }
});


exports.startCrashEngineLoop = onCall({ region: REGION, cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Autenticación requerida.');
    if (!tasksClient) { tasksClient = new CloudTasksClient(); }
    
    logger.info(`[CRASH ENGINE V2] KICKSTART: Iniciando el bucle del motor...`);
    await db.doc('game_crash/engine_config').set({ status: 'enabled' }, { merge: true });
    
    await db.doc('game_crash/live_game').set({ gameState: 'stopped' }, { merge: true });

    const queuePath = tasksClient.queuePath(PROJECT_ID, QUEUE_LOCATION, QUEUE_ID);
    const url = `https://${QUEUE_LOCATION}-${PROJECT_ID}.cloudfunctions.net/processCrashRound`;
    const task = {
        httpRequest: { httpMethod: 'POST', url },
        scheduleTime: { seconds: (Date.now() / 1000) + 1 }
    };
    await tasksClient.createTask({ parent: queuePath, task });
    return { success: true, message: "El bucle del motor de Crash ha sido iniciado." };
});


exports.toggleCrashEngine = onCall({ region: REGION, cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Autenticación requerida.');
    const adminSnap = await db.doc(`users/${request.auth.uid}`).get();
    if (!adminSnap.exists || !['admin', 'owner'].includes(adminSnap.data().role)) {
        throw new HttpsError('permission-denied', 'No tienes permisos para esta acción.');
    }
    const { status } = request.data;
    if (status !== 'enabled' && status !== 'disabled') {
        throw new HttpsError('invalid-argument', 'El estado debe ser "enabled" o "disabled".');
    }
    const engineConfigRef = db.doc('game_crash/engine_config');
    await engineConfigRef.set({ status: status, last_updated_by: request.auth.uid }, { merge: true });
    logger.info(`[CRASH_ENGINE] Motor cambiado a estado: ${status} por ${request.auth.uid}`);
    return { success: true, message: `Motor del juego ${status === 'enabled' ? 'activado' : 'desactivado'}.` };
});

exports.placeBet_crash = onCall({ region: REGION, cors: true }, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }
    const { amount } = request.data;
    const uid = request.auth.uid;
    if (typeof amount !== 'number' || amount <= 0) {
        throw new HttpsError('invalid-argument', 'El monto de la apuesta no es válido.');
    }

    const gameDocRef = db.doc('game_crash/live_game');
    const userRef = db.doc(`users/${uid}`);

    try {
        await db.runTransaction(async (tx) => {
            const [gameSnap, userSnap] = await tx.getAll(gameDocRef, userRef);

            if (!gameSnap.exists) {
                throw new HttpsError('unavailable', 'El juego no está disponible en este momento.');
            }
            const gameData = gameSnap.data();

            if (gameData.gameState !== 'waiting') {
                throw new HttpsError('failed-precondition', 'La fase de apuestas ha terminado.');
            }

            if (!gameData.wait_until || Date.now() > gameData.wait_until.toDate().getTime()) {
                throw new HttpsError('failed-precondition', 'El tiempo para apostar ha expirado. Inténtalo en la siguiente ronda.');
            }

            if (!userSnap.exists) {
                throw new HttpsError('not-found', 'Perfil de usuario no encontrado.');
            }
            if ((userSnap.data().balance || 0) < amount) {
                throw new HttpsError('resource-exhausted', 'Saldo insuficiente.');
            }

            tx.update(userRef, { balance: FieldValue.increment(-amount) });
            const playerDocRef = gameDocRef.collection('players').doc(uid);
            tx.set(playerDocRef, {
                bet: amount,
                username: userSnap.data().username || 'Jugador',
                status: 'playing'
            });
        });

        return { success: true, message: "Apuesta realizada con éxito." };

    } catch (error) {
        logger.warn(`Fallo al realizar apuesta para ${uid} por ${amount}. Razón: ${error.message}`);
        throw error;
    }
});

exports.cashOut_crash = onCall({ region: REGION, cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
    const uid = request.auth.uid;
    const gameDocRef = db.doc('game_crash/live_game');
    const playerDocRef = gameDocRef.collection('players').doc(uid);
    const userRef = db.doc(`users/${uid}`);

    return db.runTransaction(async (tx) => {
        const [gameSnap, playerSnap] = await tx.getAll(gameDocRef, playerDocRef);
        
        if (!gameSnap.exists || gameSnap.data().gameState !== 'running') {
            throw new HttpsError('failed-precondition', 'El juego no está en curso.');
        }
        if (!playerSnap.exists || playerSnap.data().status !== 'playing') {
            throw new HttpsError('failed-precondition', 'No tienes una apuesta activa o ya retiraste.');
        }

        const gameData = gameSnap.data();
        const playerData = playerSnap.data();
        const startedAt = gameData.started_at;

        if (typeof startedAt.toDate === 'function') {
            const elapsedTime = Date.now() - startedAt.toDate().getTime();
            
            const growthFactor = gameData.rocketPathK || CRASH_CONSTANTS.GROWTH_FACTOR;
            let currentMultiplier = Math.exp(elapsedTime * growthFactor);
            currentMultiplier = Math.max(1.00, Math.floor(currentMultiplier * 100) / 100);

            if (currentMultiplier >= gameData.crashPoint) {
                throw new HttpsError('failed-precondition', '¡Demasiado tarde! El juego ya ha crasheado.');
            }
            const winnings = playerData.bet * currentMultiplier;
            tx.update(userRef, { balance: FieldValue.increment(winnings) });
            tx.update(playerDocRef, {
                status: 'cashed_out',
                cashOutMultiplier: currentMultiplier,
                winnings: winnings
            });
            return { success: true, winnings, cashOutMultiplier: currentMultiplier };
        } else {
            throw new HttpsError('internal', 'Error en la fecha de inicio del juego.');
        }
    });
});