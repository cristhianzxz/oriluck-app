const { db, logger, onCall, HttpsError, onRequest, FieldValue, crypto, REGION, sleep } = require('./index.js');
const { CloudTasksClient } = require('@google-cloud/tasks');

let tasksClient;

const PROJECT_ID = process.env.GCLOUD_PROJECT;
const QUEUE_LOCATION = "southamerica-east1";
const QUEUE_ID = 'crash-game-queue';

const SERVICE_ACCOUNT_EMAIL = "bingo-task-invoker@oriluck-7e0e3.iam.gserviceaccount.com";

const CRASH_CONSTANTS = {
    BETTING_TIME_MS: 10000,
    PAUSE_BETWEEN_ROUNDS_MS: 7000,
    GROWTH_FACTOR: 0.05,
    TARGET_RTP: 97.0,
};

const allowedOrigins = [
    "http://localhost:5173",
    "https://oriluck-casino.onrender.com"
];

function getProvablyFairCrashPoint(serverSeed) {
    const hmac = crypto.createHmac('sha256', serverSeed).update("oriluck-crash-game-salt-v2").digest('hex');
    const hashInt = parseInt(hmac.substring(0, 8), 16);
    const e = Math.pow(2, 32);
    const probability = hashInt / e;
    if (probability < 0.0001) {
        return parseFloat((50 + Math.random() * (10000 - 50)).toFixed(2));
    }
    let crashPoint = 1 / (1 - probability);
    crashPoint = Math.max(1.00, Math.min(crashPoint, 50.00));
    return parseFloat(crashPoint.toFixed(2));
}

const processCrashRound = onRequest({ region: REGION, timeoutSeconds: 300, memory: "256MiB" }, async (req, res) => {
    if (!tasksClient) { tasksClient = new CloudTasksClient(); }
    logger.info("[CRASH ENGINE] Procesando una ronda...");
    if (req.header('X-CloudTasks-QueueName') !== QUEUE_ID && process.env.FUNCTIONS_EMULATOR !== 'true') {
        logger.warn("Llamada no autorizada denegada.");
        return res.status(403).send("Unauthorized");
    }
    const gameDocRef = db.doc('game_crash/live_game');
    const historyCollectionRef = db.collection('game_crash_history');
    const financialsRef = db.doc('game_crash/financials');
    const engineConfigRef = db.doc('game_crash/engine_config');
    const limitsRef = db.doc('appSettings/crashLimits');
    try {
        const [configSnap, financialsSnap, limitsSnap] = await Promise.all([
            engineConfigRef.get(),
            financialsRef.get(),
            limitsRef.get()
        ]);
        if (!configSnap.exists || configSnap.data().status !== 'enabled') {
            logger.warn("[CRASH ENGINE] Motor desactivado.");
            await gameDocRef.set({ gameState: 'stopped' }, { merge: true });
            return res.status(200).send("Engine stopped.");
        }
        const maxProfit = limitsSnap.exists ? limitsSnap.data().maxProfit : Infinity;
        const engineConfig = configSnap.data();
        const financials = financialsSnap.data() || { totalIn: 0, totalOut: 0, netProfit: 0, recoveryCooldownRounds: 0 };
        const previousPlayersSnap = await gameDocRef.collection('players').get();
        if (!previousPlayersSnap.empty) {
            const batch = db.batch();
            let roundTotalIn = 0;
            let roundTotalOut = 0;
            previousPlayersSnap.forEach(doc => {
                const playerData = doc.data();
                roundTotalIn += playerData.bet;
                if (playerData.status === 'cashed_out') {
                    roundTotalOut += playerData.winnings;
                }
                batch.delete(doc.ref);
            });
            const newTotalIn = (financials.totalIn || 0) + roundTotalIn;
            const newTotalOut = (financials.totalOut || 0) + roundTotalOut;
            const newNetProfit = newTotalIn - newTotalOut;
            let newCooldown = financials.recoveryCooldownRounds > 0 ? financials.recoveryCooldownRounds - 1 : 0;
            if (financials.netProfit < 0 && newNetProfit >= 0) {
                 newCooldown = engineConfig.recoveryCooldown || 3;
            }
            batch.set(financialsRef, {
                totalIn: newTotalIn,
                totalOut: newTotalOut,
                netProfit: newNetProfit,
                recoveryCooldownRounds: newCooldown
            }, { merge: true });
            await batch.commit();
        }
        const roundId = db.collection('dummy').doc().id;
        const serverSeed = crypto.randomBytes(32).toString('hex');
        const serverSeedHash = crypto.createHash('sha256').update(serverSeed).digest('hex');
        await gameDocRef.set({
            gameState: 'waiting',
            roundId,
            serverSeedHash,
            wait_until: new Date(Date.now() + CRASH_CONSTANTS.BETTING_TIME_MS),
        });
        logger.info(`Ronda ${roundId} en 'waiting'.`);
        await sleep(CRASH_CONSTANTS.BETTING_TIME_MS);
        const updatedFinancialsSnap = await financialsRef.get();
        const currentFinancials = updatedFinancialsSnap.data();
        const netProfit = currentFinancials.netProfit;
        const inRecovery = netProfit < 0 || currentFinancials.recoveryCooldownRounds > 0;
        let finalCrashPoint = getProvablyFairCrashPoint(serverSeed);
        if (inRecovery) {
             const { recoveryModeMinCrash = 1.0, recoveryModeMaxCrash = 1.5, recoveryLowChance = 85 } = engineConfig;
             const isLowCrash = (Math.random() * 100) < recoveryLowChance;
             if(isLowCrash) {
                 const recoveryCrash = parseFloat((recoveryModeMinCrash + Math.random() * (recoveryModeMaxCrash - recoveryModeMinCrash)).toFixed(2));
                 logger.warn(`[ANTI-QUIEBRE] Modo recuperación. CrashPoint original: ${finalCrashPoint}x. Nuevo: ${recoveryCrash}x`);
                 finalCrashPoint = recoveryCrash;
             } else {
                 logger.warn(`[ANTI-QUIEBRE] Modo recuperación pero se permite crash alto por probabilidad.`);
             }
        } else {
             const currentRTP = currentFinancials.totalIn > 0 ? (currentFinancials.totalOut / currentFinancials.totalIn) * 100 : 100;
             if (currentRTP > CRASH_CONSTANTS.TARGET_RTP && finalCrashPoint > 2.0) {
                 logger.info(`RTP alto (${currentRTP.toFixed(2)}%), aplicando CAP al crashPoint de ${finalCrashPoint}x a 2.00x.`);
                 finalCrashPoint = 2.00;
             }
        }
        const timeToCrashSeconds = finalCrashPoint > 1 ? (Math.log(finalCrashPoint) / CRASH_CONSTANTS.GROWTH_FACTOR) : 0;
        const timeToCrashMs = timeToCrashSeconds * 1000;
        const startTimeMs = Date.now();
        await gameDocRef.update({
            gameState: 'running',
            crashPoint: finalCrashPoint,
            animationDurationMs: timeToCrashMs,
            startedAtMs: startTimeMs,
            rocketPathK: CRASH_CONSTANTS.GROWTH_FACTOR,
            serverSeed: serverSeed
        });
        logger.info(`Ronda ${roundId} en 'running'. CrashPoint Secreto: ${finalCrashPoint}x`);
        let elapsed = 0;
        const tickRate = 100;
        while (elapsed < timeToCrashMs) {
            await sleep(Math.min(tickRate, timeToCrashMs - elapsed));
            elapsed = Date.now() - startTimeMs;
            const elapsedSeconds = elapsed / 1000;
            const currentMultiplier = Math.exp(elapsedSeconds * CRASH_CONSTANTS.GROWTH_FACTOR);
            const autoCashoutQuery = gameDocRef.collection('players')
                .where('status', '==', 'playing')
                .where('autoCashoutTarget', '<=', currentMultiplier);
            const playersToCashoutSnap = await autoCashoutQuery.get();
            if (!playersToCashoutSnap.empty) {
                const batch = db.batch();
                playersToCashoutSnap.forEach(playerDoc => {
                    const playerData = playerDoc.data();
                    if (playerData.status === 'playing') {
                        const winnings = playerData.bet * playerData.autoCashoutTarget;
                        const finalWinnings = Math.min(winnings, maxProfit);
                        batch.update(playerDoc.ref, {
                            status: 'cashed_out',
                            winnings: finalWinnings,
                            cashOutMultiplier: playerData.autoCashoutTarget
                        });
                        const userRef = db.doc(`users/${playerDoc.id}`);
                        batch.update(userRef, { balance: FieldValue.increment(finalWinnings) });
                        if (playerData.betId) {
                            const betHistoryRef = db.doc(`crash_bets/${playerData.betId}`);
                            batch.update(betHistoryRef, {
                                status: 'cashed_out',
                                winnings: finalWinnings,
                                cashOutMultiplier: playerData.autoCashoutTarget
                            });
                        }
                    }
                });
                await batch.commit();
            }
        }
        await gameDocRef.update({ gameState: 'crashed' });
        logger.info(`Ronda ${roundId} ha crasheado en ${finalCrashPoint}x.`);
        const playersLostSnap = await gameDocRef.collection('players').where('status', '==', 'playing').get();
        if (!playersLostSnap.empty) {
            const batch = db.batch();
            playersLostSnap.forEach(doc => {
                batch.update(doc.ref, { status: 'lost' });
                const betId = doc.data().betId;
                if (betId) {
                    const betHistoryRef = db.doc(`crash_bets/${betId}`);
                    batch.update(betHistoryRef, { status: 'lost', crashPoint: finalCrashPoint });
                }
            });
            await batch.commit();
        }
        const finalPlayersSnap = await gameDocRef.collection('players').get();
        const playersData = [];
        let roundTotalIn = 0;
        let roundTotalOut = 0;
        finalPlayersSnap.forEach(doc => {
            const playerData = doc.data();
            roundTotalIn += playerData.bet || 0;
            if (playerData.status === 'cashed_out') {
                roundTotalOut += playerData.winnings || 0;
            }
            playersData.push(playerData);
        });
        await historyCollectionRef.doc(roundId).set({
            crashPoint: finalCrashPoint,
            totalPot: roundTotalIn,
            netProfit: roundTotalIn - roundTotalOut,
            serverSeed: serverSeed,
            timestamp: FieldValue.serverTimestamp(),
            players: playersData,
            roundId: roundId,
        });
        await sleep(CRASH_CONSTANTS.PAUSE_BETWEEN_ROUNDS_MS);
        const nextRoundTime = Date.now();
        const queuePath = tasksClient.queuePath(PROJECT_ID, QUEUE_LOCATION, QUEUE_ID);
        const url = `https://${QUEUE_LOCATION}-${PROJECT_ID}.cloudfunctions.net/processCrashRound`;
        const task = {
            httpRequest: {
                httpMethod: 'POST',
                url,
                oidcToken: { serviceAccountEmail: SERVICE_ACCOUNT_EMAIL }
            },
            scheduleTime: { seconds: Math.floor(nextRoundTime / 1000) }
        };
        await tasksClient.createTask({ parent: queuePath, task });
        logger.info(`Siguiente ronda programada.`);
        return res.status(200).send({ success: true, roundId });
    } catch (error) {
        logger.error(`[CRASH ENGINE] Error crítico:`, error);
        await gameDocRef.set({ gameState: 'stopped', error: error.message }, { merge: true });
        return res.status(500).send("Error en el motor del juego.");
    }
});

const startCrashEngineLoop = onCall({ region: REGION, cors: allowedOrigins }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Autenticación requerida.');
    if (!tasksClient) { tasksClient = new CloudTasksClient(); }
    logger.info(`[CRASH ENGINE] Iniciando el bucle del motor...`);
    await db.doc('game_crash/engine_config').set({ status: 'enabled' }, { merge: true });
    await db.doc('game_crash/live_game').set({ gameState: 'stopped' }, { merge: true });
    await db.doc('game_crash/financials').set({ totalIn: 0, totalOut: 0, netProfit: 0, recoveryCooldownRounds: 0 }, { merge: true });
    const queuePath = tasksClient.queuePath(PROJECT_ID, QUEUE_LOCATION, QUEUE_ID);
    const url = `https://${QUEUE_LOCATION}-${PROJECT_ID}.cloudfunctions.net/processCrashRound`;
    const task = {
        httpRequest: {
            httpMethod: 'POST',
            url,
            oidcToken: { serviceAccountEmail: SERVICE_ACCOUNT_EMAIL }
        },
        scheduleTime: { seconds: (Date.now() / 1000) + 1 }
    };
    await tasksClient.createTask({ parent: queuePath, task });
    return { success: true, message: "El bucle del motor de Crash ha sido iniciado." };
});

const toggleCrashEngine = onCall({ region: REGION, cors: allowedOrigins }, async (request) => {
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

const updateCrashLimits = onCall({ region: REGION, cors: allowedOrigins }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Autenticación requerida.');
    const adminSnap = await db.doc(`users/${request.auth.uid}`).get();
    if (!adminSnap.exists || !['admin', 'owner'].includes(adminSnap.data().role)) {
        throw new HttpsError('permission-denied', 'No tienes permisos para esta acción.');
    }
    const { minBet, maxBet, maxProfit, recoveryModeMaxBet } = request.data;
    if (typeof minBet !== 'number' || typeof maxBet !== 'number' || typeof maxProfit !== 'number' || typeof recoveryModeMaxBet !== 'number' || minBet <= 0 || maxBet <= minBet) {
      throw new HttpsError('invalid-argument', 'Los valores de los límites no son válidos.');
    }
    await db.doc('appSettings/crashLimits').set({
        minBet: minBet,
        maxBet: maxBet,
        maxProfit: maxProfit,
        recoveryModeMaxBet: recoveryModeMaxBet
    }, { merge: true });
    return { success: true, message: 'Límites del juego actualizados correctamente.' };
});

const sendChatMessage = onCall({ region: REGION, cors: allowedOrigins }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Debes iniciar sesión para enviar un mensaje.');
    const uid = request.auth.uid;
    const { text } = request.data;
    if (!text || typeof text !== 'string' || text.trim().length === 0 || text.length > 200) {
        throw new HttpsError('invalid-argument', 'El mensaje no es válido.');
    }
    const userSnap = await db.doc(`users/${uid}`).get();
    if (!userSnap.exists) {
        throw new HttpsError('not-found', 'Usuario no encontrado.');
    }
    const username = userSnap.data().username || 'Jugador';
    const chatRef = db.collection('crash_chat');
    await chatRef.add({
        userId: uid,
        username: username,
        text: text.trim(),
        timestamp: FieldValue.serverTimestamp()
    });
    const chatSize = 50;
    const snapshot = await chatRef.orderBy('timestamp', 'desc').get();
    if (snapshot.size > chatSize) {
        const batch = db.batch();
        snapshot.docs.slice(chatSize).forEach(doc => {
            batch.delete(doc.ref);
        });
        await batch.commit();
    }
    return { success: true };
});

const placeBet_crash = onCall({ region: REGION, cors: allowedOrigins }, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }
    const { amount, autoCashoutTarget } = request.data;
    const uid = request.auth.uid;
    if (typeof amount !== 'number' || amount <= 0) {
        throw new HttpsError('invalid-argument', 'El monto de la apuesta no es válido.');
    }
    const gameDocRef = db.doc('game_crash/live_game');
    const userRef = db.doc(`users/${uid}`);
    const limitsRef = db.doc('appSettings/crashLimits');
    const financialsRef = db.doc('game_crash/financials');
    try {
        await db.runTransaction(async (tx) => {
            const [gameSnap, userSnap, playerSnap, limitsSnap, financialsSnap] = await Promise.all([
                tx.get(gameDocRef),
                tx.get(userRef),
                tx.get(gameDocRef.collection('players').doc(uid)),
                tx.get(limitsRef),
                tx.get(financialsRef)
            ]);
            if (!limitsSnap.exists) {
                throw new HttpsError('internal', 'La configuración de límites del juego no se encuentra.');
            }
            const limits = limitsSnap.data();
            const financials = financialsSnap.data() || { netProfit: 0 };
            const inRecovery = financials.netProfit < 0;
            const maxBetAllowed = inRecovery ? limits.recoveryModeMaxBet : limits.maxBet;
            if (amount < limits.minBet || amount > maxBetAllowed) {
                 throw new HttpsError('invalid-argument', `El monto debe estar entre ${limits.minBet.toFixed(2)} y ${maxBetAllowed.toFixed(2)} Bs.`);
            }
            if (playerSnap.exists) {
                throw new HttpsError('failed-precondition', 'Ya tienes una apuesta activa en esta ronda.');
            }
            if (!gameSnap.exists) {
                throw new HttpsError('unavailable', 'El juego no está disponible en este momento.');
            }
            const gameData = gameSnap.data();
            if (gameData.gameState !== 'waiting') {
                throw new HttpsError('failed-precondition', 'La fase de apuestas ha terminado.');
            }
            if (!userSnap.exists) {
                throw new HttpsError('not-found', 'Perfil de usuario no encontrado.');
            }
            if ((userSnap.data().balance || 0) < amount) {
                throw new HttpsError('resource-exhausted', 'Saldo insuficiente.');
            }
            const betId = db.collection('crash_bets').doc().id;
            const betHistoryRef = db.doc(`crash_bets/${betId}`);
            const playerDocRef = gameDocRef.collection('players').doc(uid);
            tx.update(userRef, { balance: FieldValue.increment(-amount) });
            tx.set(playerDocRef, {
                bet: amount,
                username: userSnap.data().username || 'Jugador',
                status: 'playing',
                userId: uid,
                betId: betId,
                autoCashoutTarget: autoCashoutTarget || null
            });
            tx.set(betHistoryRef, {
                userId: uid,
                username: userSnap.data().username || 'Jugador',
                roundId: gameData.roundId,
                amount: amount,
                status: 'playing',
                autoCashoutTarget: autoCashoutTarget || null,
                timestamp: FieldValue.serverTimestamp()
            });
        });
        return { success: true, message: "Apuesta realizada con éxito." };
    } catch (error) {
        if (error instanceof HttpsError) throw error;
        logger.error(`Fallo inesperado al realizar apuesta para ${uid}:`, error);
        throw new HttpsError('internal', 'Ocurrió un error al procesar tu apuesta.');
    }
});

const updateAutoCashout_crash = onCall({ region: REGION, cors: allowedOrigins }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
    const { autoCashoutTarget } = request.data;
    const uid = request.auth.uid;
    let targetValue = null;
    if (typeof autoCashoutTarget === 'number' && autoCashoutTarget >= 1.01) {
        targetValue = parseFloat(autoCashoutTarget.toFixed(2));
    }
    const gameDocRef = db.doc('game_crash/live_game');
    const playerDocRef = gameDocRef.collection('players').doc(uid);
    try {
        await db.runTransaction(async (tx) => {
            const [gameSnap, playerSnap] = await tx.getAll(gameDocRef, playerDocRef);
            if (!gameSnap.exists || gameSnap.data().gameState !== 'waiting') {
                throw new HttpsError('failed-precondition', 'Solo puedes ajustar el auto-retiro antes de que inicie la ronda.');
            }
            if (!playerSnap.exists || playerSnap.data().status !== 'playing') {
                return;
            }
            tx.update(playerDocRef, { autoCashoutTarget: targetValue });
            const betId = playerSnap.data().betId;
            if (betId) {
                const betHistoryRef = db.doc(`crash_bets/${betId}`);
                tx.update(betHistoryRef, { autoCashoutTarget: targetValue });
            }
        });
        return { success: true, newTarget: targetValue };
    } catch (error) {
        if (error instanceof HttpsError) throw error;
        logger.error(`Error al actualizar auto-retiro para ${uid}:`, error);
        throw new HttpsError('internal', 'Ocurrió un error al actualizar el auto-retiro.');
    }
});

const cashOut_crash = onCall({ region: REGION, cors: allowedOrigins }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
    const uid = request.auth.uid;
    const gameDocRef = db.doc('game_crash/live_game');
    const playerDocRef = gameDocRef.collection('players').doc(uid);
    const userRef = db.doc(`users/${uid}`);
    const limitsRef = db.doc('appSettings/crashLimits');
    return db.runTransaction(async (tx) => {
        const [gameSnap, playerSnap, limitsSnap] = await tx.getAll(gameDocRef, playerDocRef, limitsRef);
        if (!gameSnap.exists || gameSnap.data().gameState !== 'running') {
            throw new HttpsError('failed-precondition', 'El juego no está en curso o ya ha terminado.');
        }
        if (!playerSnap.exists || playerSnap.data().status !== 'playing') {
            throw new HttpsError('failed-precondition', 'No tienes una apuesta activa o ya retiraste.');
        }
        const gameData = gameSnap.data();
        const playerData = playerSnap.data();
        const startedAt = gameData.startedAtMs;
        if (typeof startedAt !== 'number') {
            throw new HttpsError('internal', 'Error en la fecha de inicio del juego.');
        }
        const maxProfit = limitsSnap.exists ? limitsSnap.data().maxProfit : Infinity;
        const elapsed = Date.now() - startedAt;
        const elapsedSeconds = elapsed / 1000;
        const k = gameData.rocketPathK > 0.001 ? gameData.rocketPathK : 0.05;
        let currentMultiplier = Math.exp(elapsedSeconds * k);
        if (currentMultiplier >= gameData.crashPoint) {
            throw new HttpsError('failed-precondition', 'El cohete ya ha explotado.');
        }
        currentMultiplier = Math.floor(currentMultiplier * 100) / 100;
        currentMultiplier = Math.max(1.00, currentMultiplier);
        const winnings = playerData.bet * currentMultiplier;
        const finalWinnings = Math.min(winnings, maxProfit);
        tx.update(userRef, { balance: FieldValue.increment(finalWinnings) });
        tx.update(playerDocRef, {
            status: 'cashed_out',
            cashOutMultiplier: currentMultiplier,
            winnings: finalWinnings
        });
        if(playerData.betId) {
            const betHistoryRef = db.doc(`crash_bets/${playerData.betId}`);
            tx.update(betHistoryRef, {
                status: 'cashed_out',
                winnings: finalWinnings,
                cashOutMultiplier: currentMultiplier
            });
        }
        return { success: true, winnings: finalWinnings, cashOutMultiplier: currentMultiplier };
    });
});

const cancelBet_crash = onCall({ region: REGION, cors: allowedOrigins }, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }
    const uid = request.auth.uid;
    const gameDocRef = db.doc('game_crash/live_game');
    const userRef = db.doc(`users/${uid}`);
    try {
        await db.runTransaction(async (tx) => {
            const playerDocRef = gameDocRef.collection('players').doc(uid);
            const [gameSnap, playerSnap] = await tx.getAll(gameDocRef, playerDocRef);
            if (!gameSnap.exists || gameSnap.data().gameState !== 'waiting') {
                throw new HttpsError('failed-precondition', 'Solo puedes cancelar apuestas durante la fase de espera.');
            }
            if (!playerSnap.exists || playerSnap.data().status !== 'playing') {
                throw new HttpsError('not-found', 'No se encontró una apuesta activa para cancelar.');
            }
            const playerData = playerSnap.data();
            const betAmount = playerData.bet;
            const betId = playerData.betId;
            tx.update(userRef, { balance: FieldValue.increment(betAmount) });
            tx.delete(playerDocRef);
            if (betId) {
                const betHistoryRef = db.doc(`crash_bets/${betId}`);
                tx.delete(betHistoryRef);
            }
        });
        return { success: true, message: "Apuesta cancelada y saldo reembolsado." };
    } catch (error) {
        if (error instanceof HttpsError) throw error;
        logger.error(`Error al cancelar la apuesta para ${uid}:`, error);
        throw new HttpsError('internal', 'Ocurrió un error al cancelar la apuesta.');
    }
});

module.exports = {
    processCrashRound,
    startCrashEngineLoop,
    toggleCrashEngine,
    updateCrashLimits,
    sendChatMessage,
    placeBet_crash,
    updateAutoCashout_crash,
    cashOut_crash,
    cancelBet_crash
};