const { db, logger, onCall, onRequest, onSchedule, HttpsError, FieldValue, crypto, REGION } = require('./index.js');
const { CloudTasksClient } = require('@google-cloud/tasks');

const tasksClient = new CloudTasksClient();
const PROJECT_ID = process.env.GCLOUD_PROJECT;
const QUEUE_NAME = 'bingo-turn-processor';
const QUEUE_LOCATION = REGION;

const SERVICE_ACCOUNT_EMAIL = "bingo-task-invoker@oriluck-7e0e3.iam.gserviceaccount.com";

const allowedOrigins = [
    "http://localhost:5173",
    "https://oriluck-casino.onrender.com"
];

const BINGO_NUMBERS = Array.from({ length: 75 }, (_, i) => i + 1);

function getFlatCardNumbers(cardNumbers) {
    if (!Array.isArray(cardNumbers)) return [];
    if (cardNumbers.length === 25 && !Array.isArray(cardNumbers[0])) {
        return cardNumbers.filter(n => n !== "FREE");
    }
    return cardNumbers.flat().filter(n => n !== "FREE");
}

function generateSingleBingoCardNumbers() {
    const ranges = [
        { min: 1, max: 15 }, { min: 16, max: 30 }, { min: 31, max: 45 },
        { min: 46, max: 60 }, { min: 61, max: 75 }
    ];
    const card = [];
    for (let c = 0; c < 5; c++) {
        const col = []; const used = new Set();
        for (let r = 0; r < 5; r++) {
            if (c === 2 && r === 2) { col.push('FREE'); }
            else {
                let n;
                do { n = Math.floor(Math.random() * (ranges[c].max - ranges[c].min + 1)) + ranges[c].min; }
                while (used.has(n));
                used.add(n); col.push(n);
            }
        }
        card.push(col);
    }
    return card.flat();
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

let rngSystem = new AuditableRNG();

async function scheduleBingoTurn(tournamentId, delayInSeconds, expectedIndex) {
    try {
        const functionUrl = `https://${QUEUE_LOCATION}-${PROJECT_ID}.cloudfunctions.net/processBingoTurn`;
        const parent = tasksClient.queuePath(PROJECT_ID, QUEUE_LOCATION, QUEUE_NAME);
        const payload = { tournamentId, expectedIndex };
        const task = {
            httpRequest: {
                httpMethod: 'POST',
                url: functionUrl,
                headers: { 'Content-Type': 'application/json' },
                body: Buffer.from(JSON.stringify(payload)).toString('base64'),
                oidcToken: {
                    serviceAccountEmail: SERVICE_ACCOUNT_EMAIL,
                },
            },
            scheduleTime: {
                seconds: Math.floor(Date.now() / 1000) + delayInSeconds,
            },
        };
        const [request] = await tasksClient.createTask({ parent, task });
        logger.info(`[BINGO] Tarea segura programada para ${tournamentId} (bola ${expectedIndex}) en ${delayInSeconds}s.`);
        return { success: true, taskId: request.name };
    } catch (error) {
        logger.error(`[BINGO] Fallo crítico al programar tarea segura para ${tournamentId}:`, error);
        try {
            await db.doc(`bingoTournaments/${tournamentId}`).update({
                status: 'error',
                errorDetails: `Failed to schedule next turn task for index ${expectedIndex}.`,
                finishedAt: FieldValue.serverTimestamp()
            });
        } catch (dbError) {
            logger.error(`[BINGO] No se pudo ni marcar el torneo ${tournamentId} como error:`, dbError);
        }
        return { success: false, error: error.message };
    }
}

async function _startAuditableBingoLogic(tournamentId, startInitiatorUid, ballInterval = 3) {
    if (!rngSystem) { rngSystem = new AuditableRNG(); }
    const tournamentRef = db.doc(`bingoTournaments/${tournamentId}`);

    const txResult = await db.runTransaction(async (tx) => {
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
            startedBy: startInitiatorUid,
            ballIntervalSeconds: ballInterval
        };
        tx.update(tournamentRef, updateData);
        return { commitment };
    });

    await scheduleBingoTurn(tournamentId, ballInterval, 0);
    logger.info(`[BINGO] Torneo ${tournamentId} iniciado por ${startInitiatorUid}. Semilla comprometida: ${txResult.commitment.substring(0, 10)}... Primera bola programada.`);
    return {
        success: true,
        message: `Torneo iniciado con semilla auditable: ${txResult.commitment.substring(0, 10)}...`,
        seedCommitment: txResult.commitment
    };
}

const startManualBingo = onCall({
    region: REGION,
    timeoutSeconds: 30,
    cors: allowedOrigins
}, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Debe iniciar sesión para llamar a esta función.');
    }
    const uid = request.auth.uid;
    const { tournamentId } = request.data;
    if (!tournamentId) {
        throw new HttpsError('invalid-argument', 'Falta el tournamentId.');
    }

    try {
        const userSnap = await db.doc(`users/${uid}`).get();
        if (!userSnap.exists || userSnap.data().role !== 'admin') {
            throw new HttpsError('permission-denied', 'Solo los administradores pueden iniciar el sorteo manualmente.');
        }
    } catch (error) {
        logger.error("Error al verificar rol de admin:", error);
        throw new HttpsError('internal', 'Error al verificar permisos.');
    }

    const tournamentRef = db.doc(`bingoTournaments/${tournamentId}`);
    const tournamentSnap = await tournamentRef.get();
    if (!tournamentSnap.exists) {
        throw new HttpsError('not-found', 'Torneo no encontrado.');
    }
    const tournamentData = tournamentSnap.data();
    if (tournamentData.autoStart === true) {
         throw new HttpsError('failed-precondition', 'Este torneo está configurado para inicio automático.');
    }
    if (tournamentData.status !== 'waiting') {
         throw new HttpsError('failed-precondition', `El torneo ya tiene estatus: ${tournamentData.status}. No se puede iniciar.`);
    }

    const ballInterval = tournamentData.ballIntervalSeconds || 3;
    return await _startAuditableBingoLogic(tournamentId, uid, ballInterval);
});

const checkAutoStartBingo = onSchedule({ schedule: "every 1 minutes", region: REGION }, async (context) => {
    const configRef = db.doc('bingoSettings/autoStartConfig');
    let isEnabled = true; // Default to enabled if config doesn't exist

    try {
        const configSnap = await configRef.get();
        if (configSnap.exists && configSnap.data().enabled === false) {
            isEnabled = false;
        }
    } catch (error) {
        logger.error("[BINGO-AUTOSTART] Error al leer la configuración:", error);
        // Continue assuming enabled in case of read error
    }

    if (!isEnabled) {
        logger.info("[BINGO-AUTOSTART] La verificación automática está desactivada. Saliendo.");
        return null;
    }

    logger.info("[BINGO-AUTOSTART] Verificando torneos para inicio automático...");
    const now = new Date();
    const q = db.collection('bingoTournaments')
        .where('status', '==', 'waiting')
        .where('autoStart', '==', true)
        .where('startTime', '<=', now);

    try {
        const snapshot = await q.get();
        if (snapshot.empty) {
            logger.info("[BINGO-AUTOSTART] No hay torneos pendientes para auto-iniciar.");
            return null;
        }

        const startPromises = [];
        snapshot.forEach(doc => {
            logger.info(`[BINGO-AUTOSTART] Iniciando torneo automático: ${doc.id}`);
            const ballInterval = doc.data().ballIntervalSeconds || 3;
            startPromises.push(_startAuditableBingoLogic(doc.id, 'system', ballInterval));
        });

        await Promise.allSettled(startPromises);
        logger.info(`[BINGO-AUTOSTART] Procesados ${snapshot.size} torneos.`);
        return { processed: snapshot.size };

    } catch (error) {
        logger.error("[BINGO-AUTOSTART] Error crítico al verificar torneos:", error);
        return null;
    }
});


const processBingoTurn = onRequest({ region: REGION, timeoutSeconds: 60, memory: "256MiB" }, async (req, res) => {
    const { tournamentId, expectedIndex } = req.body;
    if (!tournamentId) {
        logger.warn("[BINGO-TASK] processBingoTurn llamado sin tournamentId.");
        res.status(400).send("Bad Request: Missing tournamentId");
        return;
    }
    if (expectedIndex === undefined) {
         logger.warn(`[BINGO-TASK] processBingoTurn llamado sin expectedIndex para ${tournamentId}.`);
         res.status(400).send("Bad Request: Missing expectedIndex");
         return;
    }
    if (!rngSystem) { rngSystem = new AuditableRNG(); }
    const tournamentRef = db.doc(`bingoTournaments/${tournamentId}`);
    let txResult = {
        scheduleNext: false,
        nextIndex: -1,
        nextInterval: 3,
        status: "processing"
    };
    try {
        txResult = await db.runTransaction(async (tx) => {
            const snap = await tx.get(tournamentRef);
            if (!snap.exists) {
                logger.error(`[BINGO-TASK] Task run for non-existent tournament: ${tournamentId}`);
                return { scheduleNext: false, status: "not-found" };
            }
            const data = snap.data();
            if (data.status !== "active") {
                logger.info(`[BINGO-TASK] Task run for inactive tournament ${tournamentId} (status: ${data.status}). Deteniendo cadena.`);
                return { scheduleNext: false, status: "inactive" };
            }
            if (data.currentBallIndex !== expectedIndex) {
                logger.warn(`[BINGO-TASK] Task mismatch para ${tournamentId}. Esperado: ${expectedIndex}, DB: ${data.currentBallIndex}. Ignorando tarea duplicada.`);
                return { scheduleNext: false, status: "duplicate" };
            }
            const { shuffledBalls = [], currentBallIndex = 0, calledNumbers = [] } = data;
            const ballInterval = data.ballIntervalSeconds || 3;
            if (currentBallIndex >= shuffledBalls.length) {
                logger.info(`[BINGO-TASK] Todas las bolas cantadas para ${tournamentId}. Finalizando.`);
                tx.update(tournamentRef, {
                    status: "finished",
                    winners: data.winners || [],
                    finishedAt: FieldValue.serverTimestamp(),
                    finishReason: "All balls called",
                    verification: { serverSeedRevealed: data.bingoSeedServer, seedVerified: rngSystem.verifySeed(data.bingoSeedServer, data.bingoSeedCommitment) }
                });
                return { scheduleNext: false, status: "finished-noballs" };
            }
            const nextNumber = shuffledBalls[currentBallIndex];
            const newCalled = [...calledNumbers, nextNumber];
            const nextIndex = currentBallIndex + 1;
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
                logger.info(`[BINGO-TASK] ¡Ganadores encontrados para ${tournamentId}!`);
                const pricePerCard = data.pricePerCard || 0;
                const totalPot = cardKeys.length * pricePerCard;
                const percentHouse = typeof data.percentageHouse === "number" ? data.percentageHouse : 30;
                const percentPrize = 100 - percentHouse;
                const prizeTotal = totalPot * (percentPrize / 100);
                const houseWinnings = totalPot - prizeTotal;
                const prizePerWinner = prizeTotal / potentialWinners.length;
                const finalWinners = potentialWinners.map(w => ({ ...w, prizeAmount: prizePerWinner }));

                finalWinners.forEach(w => tx.update(db.doc(`users/${w.userId}`), { balance: FieldValue.increment(prizePerWinner) }));

                const houseFundRef = db.doc("houseFunds/bingo");
                tx.set(houseFundRef, { totalForHouse: FieldValue.increment(houseWinnings) }, { merge: true });

                if (houseWinnings > 0) {
                    const gainsHistoryRef = db.collection('houseGainsHistory').doc();
                    tx.set(gainsHistoryRef, {
                        game: 'Bingo',
                        amount: houseWinnings,
                        roundId: tournamentId,
                        timestamp: FieldValue.serverTimestamp()
                    });
                }

                tx.update(tournamentRef, {
                    status: "finished",
                    winners: finalWinners,
                    prizeTotal,
                    prizePerWinner,
                    currentNumber: nextNumber,
                    calledNumbers: newCalled,
                    currentBallIndex: nextIndex,
                    finishedAt: FieldValue.serverTimestamp(),
                    lastNumberTime: FieldValue.serverTimestamp(),
                    verification: { serverSeedRevealed: data.bingoSeedServer, seedVerified: rngSystem.verifySeed(data.bingoSeedServer, data.bingoSeedCommitment) }
                });
                return { scheduleNext: false, status: "finished-winner" };
            } else {
                tx.update(tournamentRef, {
                    currentNumber: nextNumber,
                    calledNumbers: newCalled,
                    currentBallIndex: nextIndex,
                    lastNumberTime: FieldValue.serverTimestamp()
                });
                return { scheduleNext: true, nextIndex: nextIndex, nextInterval: ballInterval, status: "continued" };
            }
        });
    } catch (err) {
        logger.error(`[BINGO-TASK] Error en transacción ${tournamentId} (bola ${expectedIndex}):`, err);
        res.status(500).send("Transaction Error");
        return;
    }
    if (txResult.scheduleNext) {
        await scheduleBingoTurn(tournamentId, txResult.nextInterval, txResult.nextIndex);
        res.status(200).send(`OK (Ball ${expectedIndex} processed. Next task scheduled for index ${txResult.nextIndex})`);
    } else {
        logger.info(`[BINGO-TASK] Cadena de tareas finalizada para ${tournamentId}. Razón: ${txResult.status}`);
        res.status(200).send(`OK (Chain finished. Reason: ${txResult.status})`);
    }
});

const buyBingoCard_bingo = onCall({
    region: REGION,
    timeoutSeconds: 30,
    cors: allowedOrigins
}, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Debe iniciar sesión para comprar cartones.');
    }
    const uid = request.auth.uid;
    const { tournamentId, cardNumbersToBuy } = request.data;

    if (!tournamentId || !Array.isArray(cardNumbersToBuy) || cardNumbersToBuy.length === 0) {
        throw new HttpsError('invalid-argument', 'Faltan datos (tournamentId, cardNumbersToBuy).');
    }

    const tournamentRef = db.doc(`bingoTournaments/${tournamentId}`);
    const userRef = db.doc(`users/${uid}`);
    const houseFundRef = db.doc("houseFunds/bingo");

    try {
        await db.runTransaction(async (tx) => {
            const [tournamentSnap, userSnap] = await Promise.all([tx.get(tournamentRef), tx.get(userRef)]);

            if (!tournamentSnap.exists) throw new HttpsError('not-found', 'Torneo no encontrado.');
            if (!userSnap.exists) throw new HttpsError('not-found', 'Perfil de usuario no encontrado.');

            const tournamentData = tournamentSnap.data();
            const userProfile = userSnap.data();

            if (tournamentData.status !== 'waiting' || tournamentData.allowPurchases === false) {
                throw new HttpsError('failed-precondition', 'La compra de cartones está cerrada para este torneo.');
            }

            const pricePerCard = tournamentData.pricePerCard || 100;
            const totalCost = cardNumbersToBuy.length * pricePerCard;
            const balance = userProfile.balance || 0;
            const balanceBefore = balance;

            if (balance < totalCost) {
                throw new HttpsError('resource-exhausted', 'Saldo insuficiente.');
            }

            const sold = tournamentData.soldCards || {};
            const cardDetails = tournamentData.cardDetails || {};
            const unavailable = cardNumbersToBuy.filter(n => sold[`carton_${n}`]);
            if (unavailable.length > 0) {
                throw new HttpsError('failed-precondition', `Los siguientes cartones ya no están disponibles: ${unavailable.join(', ')}`);
            }

            const cardNumbersMap = {};
            const updatesForCardDetails = {};
            let detailsNeedUpdate = false;

            for (const n of cardNumbersToBuy) {
                let numbers = cardDetails[n];
                if (!numbers) {
                    logger.warn(`[BINGO-PURCHASE] Números para cartón ${n} no encontrados en ${tournamentId}. Generando...`);
                    numbers = generateSingleBingoCardNumbers();
                    updatesForCardDetails[`cardDetails.${n}`] = numbers;
                    detailsNeedUpdate = true;
                }
                cardNumbersMap[n] = numbers;
            }

            const percentHouse = typeof tournamentData.percentageHouse === "number" ? tournamentData.percentageHouse : 30;
            const houseShareTotal = totalCost * (percentHouse / 100);

            tx.update(userRef, { balance: FieldValue.increment(-totalCost) });
            const balanceAfter = balance - totalCost;

            const updatesForSoldCards = {};
            cardNumbersToBuy.forEach(n => {
                updatesForSoldCards[`soldCards.carton_${n}`] = {
                    userId: uid,
                    userName: userProfile.userName || userProfile.username || userProfile.displayName || userProfile.email,
                    userEmail: userProfile.email || null,
                    userPhone: userProfile.phoneNumber || userProfile.phone || null,
                    purchaseTime: FieldValue.serverTimestamp(),
                    cardNumbers: cardNumbersMap[n]
                };
            });

            const finalTournamentUpdates = {
                ...updatesForSoldCards,
                availableCards: FieldValue.arrayRemove(...cardNumbersToBuy),
                ...(detailsNeedUpdate ? updatesForCardDetails : {})
            };
            tx.update(tournamentRef, finalTournamentUpdates);


            tx.set(houseFundRef, { totalForHouse: FieldValue.increment(houseShareTotal) }, { merge: true });

            const txRef = db.collection('transactions').doc();
            tx.set(txRef, {
                userId: uid,
                username: userProfile.username || userProfile.displayName || userProfile.email,
                type: "bingo_purchase",
                amount: -Math.abs(totalCost),
                description: `Compra de ${cardNumbersToBuy.length} cartón(es) a ${pricePerCard} Bs c/u en "${tournamentData.name}"`,
                status: 'completed',
                createdAt: FieldValue.serverTimestamp(),
                quantity: cardNumbersToBuy.length,
                pricePerCard: pricePerCard,
                tournamentId: tournamentId,
                tournamentName: tournamentData.name,
                balanceBefore,
                balanceAfter
            });

            const bingoTxRef = db.collection('bingoTransactions').doc();
             tx.set(bingoTxRef, {
                 userId: uid,
                 userName: userProfile.userName || userProfile.username || userProfile.displayName || userProfile.email,
                 userEmail: userProfile.email || null,
                 userPhone: userProfile.phoneNumber || userProfile.phone || null,
                 tournamentId: tournamentId,
                 tournamentName: tournamentData.name,
                 cardsBought: cardNumbersToBuy,
                 cardDetails: cardNumbersToBuy.map(n => ({ cardNumber: n, cardNumbers: cardNumbersMap[n] })),
                 totalAmount: totalCost,
                 purchaseTime: FieldValue.serverTimestamp(),
                 status: 'completed'
             });

            if (houseShareTotal > 0) {
                 const gainsHistoryRef = db.collection('houseGainsHistory').doc();
                 tx.set(gainsHistoryRef, {
                     game: 'Bingo',
                     amount: houseShareTotal,
                     roundId: `purchase-${bingoTxRef.id}`,
                     timestamp: FieldValue.serverTimestamp()
                 });
            }
        });

        logger.info(`[BINGO-PURCHASE] Usuario ${uid} compró ${cardNumbersToBuy.length} cartones para ${tournamentId}.`);
        return { success: true, message: `Compra exitosa de ${cardNumbersToBuy.length} cartones.` };

    } catch (error) {
        logger.error(`[BINGO-PURCHASE] Error comprando cartones para ${uid} en ${tournamentId}:`, error);
        if (error instanceof HttpsError) {
            throw error;
        } else {
            throw new HttpsError('internal', 'Ocurrió un error al procesar la compra.', error.message);
        }
    }
});

const toggleBingoAutoStart = onCall({
    region: REGION,
    cors: allowedOrigins
}, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Autenticación requerida.');
    }
    const uid = request.auth.uid;

    try {
        const userSnap = await db.doc(`users/${uid}`).get();
        if (!userSnap.exists || userSnap.data().role !== 'admin') {
            throw new HttpsError('permission-denied', 'Solo los administradores pueden cambiar esta configuración.');
        }
    } catch (error) {
        logger.error("Error al verificar rol de admin para toggle:", error);
        throw new HttpsError('internal', 'Error al verificar permisos.');
    }

    const configRef = db.doc('bingoSettings/autoStartConfig');
    try {
        const configSnap = await configRef.get();
        const currentState = configSnap.exists ? configSnap.data().enabled : true; // Default to true if not set
        const newState = !currentState;
        await configRef.set({ enabled: newState }, { merge: true });
        logger.info(`[BINGO-AUTOSTART] Estado cambiado a ${newState} por admin ${uid}`);
        return { success: true, newState: newState };
    } catch (error) {
        logger.error(`[BINGO-AUTOSTART] Error al cambiar estado por admin ${uid}:`, error);
        throw new HttpsError('internal', 'No se pudo actualizar la configuración.');
    }
});


module.exports = {
    startManualBingo,
    checkAutoStartBingo,
    processBingoTurn,
    buyBingoCard_bingo,
    toggleBingoAutoStart
};