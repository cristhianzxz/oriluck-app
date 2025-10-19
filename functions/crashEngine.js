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
    TARGET_RTP: 95.0,
    RECOVERY_BUFFER: 1000,
    RECOVERY_TARGET_INCREASE: 10000
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

function getRandomInRange(min, max) {
     return parseFloat((min + Math.random() * (max - min)).toFixed(2));
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
    let roundId = '';

    try {
        const [configSnap, initialFinancialsSnap, limitsSnap] = await Promise.all([
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
        const initialFinancials = initialFinancialsSnap.data() || { totalIn: 0, totalOut: 0, netProfit: 0, recoveryCooldownRounds: 0, recoveryTargetProfit: null, lastRecoveryCrashPoint: null };

        const previousPlayersSnap = await gameDocRef.collection('players').get();
        let roundTotalInPrevious = 0;
        let roundTotalOutPrevious = 0;
        if (!previousPlayersSnap.empty) {
            const deleteBatch = db.batch();
            previousPlayersSnap.forEach(doc => {
                const playerData = doc.data();
                roundTotalInPrevious += playerData.bet;
                if (playerData.status === 'cashed_out') {
                    roundTotalOutPrevious += playerData.winnings;
                }
                deleteBatch.delete(doc.ref);
            });
            await deleteBatch.commit();
        }

        const currentNetProfitBeforeRound = initialFinancials.netProfit;
        const newTotalIn = (initialFinancials.totalIn || 0) + roundTotalInPrevious;
        const newTotalOut = (initialFinancials.totalOut || 0) + roundTotalOutPrevious;
        const newNetProfit = newTotalIn - newTotalOut;

        let recoveryTargetProfit = initialFinancials.recoveryTargetProfit || null;
        let currentCooldown = initialFinancials.recoveryCooldownRounds > 0 ? initialFinancials.recoveryCooldownRounds - 1 : 0;
        let recoveryJustEnded = false;

        if (recoveryTargetProfit === null && newNetProfit < CRASH_CONSTANTS.RECOVERY_BUFFER) {
            recoveryTargetProfit = newNetProfit + CRASH_CONSTANTS.RECOVERY_TARGET_INCREASE;
            logger.warn(`[CRASH ENGINE] Iniciando modo recuperación. NetProfit actual: ${newNetProfit.toFixed(2)}, Objetivo: ${recoveryTargetProfit.toFixed(2)}`);
        } else if (recoveryTargetProfit !== null && newNetProfit >= recoveryTargetProfit) {
             logger.info(`[CRASH ENGINE] Finalizando modo recuperación. NetProfit actual: ${newNetProfit.toFixed(2)}, Objetivo superado: ${recoveryTargetProfit.toFixed(2)}`);
             recoveryTargetProfit = null;
             currentCooldown = engineConfig.recoveryCooldown || 3;
             recoveryJustEnded = true;
        }

        await financialsRef.set({
            totalIn: newTotalIn,
            totalOut: newTotalOut,
            netProfit: newNetProfit,
            recoveryCooldownRounds: currentCooldown,
            recoveryTargetProfit: recoveryTargetProfit,
            lastRecoveryCrashPoint: initialFinancials.lastRecoveryCrashPoint
        }, { merge: true });

        roundId = db.collection('dummy').doc().id;
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

        const latestFinancialsSnap = await financialsRef.get();
        const latestFinancials = latestFinancialsSnap.data();
        const currentNetProfit = latestFinancials.netProfit;
        const currentRecoveryTarget = latestFinancials.recoveryTargetProfit;
        const currentCooldownNow = latestFinancials.recoveryCooldownRounds;
        const lastRecoveryCrashPoint = latestFinancials.lastRecoveryCrashPoint || 0;

        const inRecovery = (currentRecoveryTarget !== null && currentNetProfit < currentRecoveryTarget) || currentCooldownNow > 0;

        let finalCrashPoint = getProvablyFairCrashPoint(serverSeed);
        let wasRecoveryCrash = false;

        if (inRecovery && !recoveryJustEnded) {
             wasRecoveryCrash = true;
             const { recoveryModeMinCrash = 1.0, recoveryModeMaxCrash = 1.5 } = engineConfig; // Rangos base
             const p = Math.random();
             let recoveryCrash;

             if (p < 0.85) { // 85% chance: 1.00 - 1.49
                 do {
                      recoveryCrash = getRandomInRange(1.00, 1.49);
                 } while (recoveryCrash === lastRecoveryCrashPoint);
                 logger.warn(`[CRASH ENGINE] Recovery (85%). Crash: ${recoveryCrash}x (Last: ${lastRecoveryCrashPoint}x)`);

             } else if (p < 0.97) { // 12% chance: 1.50 - 1.97
                 recoveryCrash = getRandomInRange(1.50, 1.97);
                 logger.warn(`[CRASH ENGINE] Recovery (12%). Crash: ${recoveryCrash}x`);

             } else { // 3% chance: 1.98 - 2.89
                 recoveryCrash = getRandomInRange(1.98, 2.89);
                 logger.warn(`[CRASH ENGINE] Recovery (3%). Crash: ${recoveryCrash}x`);
             }
             finalCrashPoint = recoveryCrash;

        } else {
             const currentRTP = latestFinancials.totalIn > 0 ? (latestFinancials.totalOut / latestFinancials.totalIn) * 100 : 100;
             if (currentRTP > CRASH_CONSTANTS.TARGET_RTP && finalCrashPoint > 2.0) { // Mantenemos el cap de 2.0x por ahora
                 logger.info(`RTP (${currentRTP.toFixed(2)}%) > ${CRASH_CONSTANTS.TARGET_RTP}%. Capando crashPoint de ${finalCrashPoint}x a 2.00x.`);
                 finalCrashPoint = 2.00;
             }
        }

        const timeToCrashSeconds = finalCrashPoint > 1 ? (Math.log(finalCrashPoint) / CRASH_CONSTANTS.GROWTH_FACTOR) : 0;
        const timeToCrashMs = Math.max(100, timeToCrashSeconds * 1000);
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
            const currentMultiplier = Math.exp((elapsed / 1000) * CRASH_CONSTANTS.GROWTH_FACTOR);
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
        let roundTotalInCurrent = 0;
        let roundTotalOutCurrent = 0;
        finalPlayersSnap.forEach(doc => {
            const playerData = doc.data();
            roundTotalInCurrent += playerData.bet || 0;
            if (playerData.status === 'cashed_out') {
                roundTotalOutCurrent += playerData.winnings || 0;
            }
            playersData.push(playerData);
        });

        const roundNetProfit = roundTotalInCurrent - roundTotalOutCurrent;

        if (wasRecoveryCrash) {
             await financialsRef.set({ lastRecoveryCrashPoint: finalCrashPoint }, { merge: true });
        }

        if (roundNetProfit > 0) {
            const houseRef = db.doc('houseFunds/crash');
            const gainsHistoryRef = db.collection('houseGainsHistory').doc();
            const batch = db.batch();
            batch.set(houseRef, { totalForHouse: FieldValue.increment(roundNetProfit) }, { merge: true });
            batch.set(gainsHistoryRef, {
                game: 'Crash',
                amount: roundNetProfit,
                roundId: roundId,
                timestamp: FieldValue.serverTimestamp()
            });
            await batch.commit();
        }

        await historyCollectionRef.doc(roundId).set({
            crashPoint: finalCrashPoint,
            totalPot: roundTotalInCurrent,
            netProfit: roundNetProfit,
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
        logger.error(`[CRASH ENGINE] Error crítico procesando ronda ${roundId || '(ID no generado)'}:`, error);
        try {
             await gameDocRef.set({ gameState: 'stopped', error: error.message }, { merge: true });
        } catch(stopError) {
             logger.error(`[CRASH ENGINE] No se pudo ni marcar el juego como detenido tras error:`, stopError);
        }
        return res.status(500).send("Error en el motor del juego.");
    }
});

const startCrashEngineLoop = onCall({ region: REGION, cors: allowedOrigins }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Autenticación requerida.');
    const adminSnap = await db.doc(`users/${request.auth.uid}`).get();
     if (!adminSnap.exists || !['admin', 'owner'].includes(adminSnap.data().role)) {
         throw new HttpsError('permission-denied', 'No tienes permisos para esta acción.');
     }
    if (!tasksClient) { tasksClient = new CloudTasksClient(); }
    logger.info(`[CRASH ENGINE] Iniciando el bucle del motor...`);
    await db.doc('game_crash/engine_config').set({ status: 'enabled' }, { merge: true });
    await db.doc('game_crash/live_game').set({ gameState: 'stopped' }, { merge: true });
    await db.doc('game_crash/financials').set({ totalIn: 0, totalOut: 0, netProfit: 0, recoveryCooldownRounds: 0, recoveryTargetProfit: null, lastRecoveryCrashPoint: null }, { merge: true });
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
     try {
         await tasksClient.createTask({ parent: queuePath, task });
         return { success: true, message: "El bucle del motor de Crash ha sido iniciado." };
     } catch(error){
         logger.error("Error al crear la tarea inicial:", error);
         throw new HttpsError('internal', 'No se pudo iniciar el motor.');
     }
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
     if (status === 'disabled') {
          await db.doc('game_crash/live_game').set({ gameState: 'stopped' }, { merge: true });
          logger.info(`[CRASH_ENGINE] Estado del juego en vivo establecido a 'stopped'.`);
     }
    return { success: true, message: `Motor del juego ${status === 'enabled' ? 'activado' : 'desactivado'}.` };
});

const updateCrashLimits = onCall({ region: REGION, cors: allowedOrigins }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Autenticación requerida.');
    const adminSnap = await db.doc(`users/${request.auth.uid}`).get();
    if (!adminSnap.exists || !['admin', 'owner'].includes(adminSnap.data().role)) {
        throw new HttpsError('permission-denied', 'No tienes permisos para esta acción.');
    }
    const { minBet, maxBet, maxProfit, recoveryModeMaxBet } = request.data;
    if (typeof minBet !== 'number' || typeof maxBet !== 'number' || typeof maxProfit !== 'number' || typeof recoveryModeMaxBet !== 'number' || minBet <= 0 || maxBet <= minBet || maxProfit <= 0 || recoveryModeMaxBet < minBet || recoveryModeMaxBet > maxBet ) {
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
     if (autoCashoutTarget !== null && (typeof autoCashoutTarget !== 'number' || autoCashoutTarget < 1.01)) {
         throw new HttpsError('invalid-argument', 'El objetivo de auto-retiro debe ser 1.01 o mayor, o nulo.');
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
            const financials = financialsSnap.exists ? financialsSnap.data() : { netProfit: 0, recoveryTargetProfit: null, recoveryCooldownRounds: 0 };
            const inRecovery = (financials.recoveryTargetProfit !== null && financials.netProfit < financials.recoveryTargetProfit) || financials.recoveryCooldownRounds > 0;
            const maxBetAllowed = inRecovery && limits.recoveryModeMaxBet ? limits.recoveryModeMaxBet : limits.maxBet;
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
    } else if (autoCashoutTarget !== null) {
         throw new HttpsError('invalid-argument', 'El objetivo de auto-retiro debe ser 1.01 o mayor, o nulo.');
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
        if (elapsed < 0) {
             throw new HttpsError('failed-precondition', 'El juego aún no ha comenzado.');
        }
        const elapsedSeconds = elapsed / 1000;
        const k = gameData.rocketPathK > 0.001 ? gameData.rocketPathK : CRASH_CONSTANTS.GROWTH_FACTOR;
        let currentMultiplier = Math.exp(elapsedSeconds * k);
        if (elapsed >= (gameData.animationDurationMs || 0) || currentMultiplier >= gameData.crashPoint) {
            tx.update(playerDocRef, { status: 'lost' });
            if(playerData.betId) {
               const betHistoryRef = db.doc(`crash_bets/${playerData.betId}`);
               tx.update(betHistoryRef, { status: 'lost', crashPoint: gameData.crashPoint });
            }
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