const { db, logger, onCall, onRequest, HttpsError, FieldValue, crypto, REGION } = require('./index.js');
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

const startAuditableBingo = onCall({
    region: REGION,
    timeoutSeconds: 30,
    cors: allowedOrigins
}, async (request) => {
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
    const ballInterval = request.data.ballIntervalSeconds || 3;
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
            startedBy: uid,
            ballIntervalSeconds: ballInterval
        };
        tx.update(tournamentRef, updateData);
        return { commitment };
    });
    await scheduleBingoTurn(tournamentId, ballInterval, 0);
    logger.info(`[BINGO] Torneo ${tournamentId} iniciado. Semilla comprometida: ${txResult.commitment.substring(0, 10)}... Primera bola programada.`);
    return {
        success: true,
        message: `Torneo iniciado con semilla auditable: ${txResult.commitment.substring(0, 10)}...`,
        seedCommitment: txResult.commitment
    };
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
                tx.set(db.doc("appSettings/main"), { houseWinnings: FieldValue.increment(houseWinnings) }, { merge: true });
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

module.exports = {
    startAuditableBingo,
    processBingoTurn
};