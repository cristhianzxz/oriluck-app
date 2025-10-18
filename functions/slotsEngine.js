const { db, logger, onCall, onSchedule, HttpsError, FieldValue, crypto, REGION } = require('./index.js');

const SLOTS_MACHINE_ID = 'main_machine';
const BOTE_MINIMO_GARANTIZADO = 1000;

const allowedOrigins = [
    "http://localhost:5173",
    "https://oriluck-casino.onrender.com"
];

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

function getProvablyFairSlotResult(serverSeed, clientSeed, nonce) {
    const hmac = crypto.createHmac('sha256', serverSeed).update(`${clientSeed}-${nonce}`).digest('hex');
    const decimal = parseInt(hmac.substring(0, 8), 16);
    let cumulativeProbability = 0;
    const jackpotRoll = parseInt(hmac.substring(8, 12), 16) / 0xFFFF;
    if (jackpotRoll < JACKPOT_PROBABILITY) {
        return { prize: { name: 'JACKPOT', prizeMultiplier: 'JACKPOT', prizePercent: 0.5 }, finalHash: hmac };
    }
    for (const prize of PAY_TABLE) {
         if (prize.name === 'JACKPOT') continue;
        cumulativeProbability += prize.probability;
        if (decimal / 0xFFFFFFFF < cumulativeProbability) {
            return { prize, finalHash: hmac };
        }
    }
    return { prize: PAY_TABLE.find(p => p.name === 'SIN_PREMIO'), finalHash: hmac };
}


const buySlotsChipsCallable = onCall({ region: REGION, timeoutSeconds: 20, cors: allowedOrigins }, async (request) => {
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
                tx.update(slotsHouseFundRef, { totalForHouse: FieldValue.increment(houseContribution) });
            } else {
                tx.set(slotsHouseFundRef, { totalForHouse: houseContribution, percentageHouse: 20 });
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


const slotsJackpotProcessor = onSchedule({ schedule: "every 5 minutes", region: REGION }, async () => {
    logger.info("[SLOTS-JACKPOT] Verificando estado del jackpot (lógica pendiente)...");
});

const requestSlotSpin = onCall({ region: REGION, timeoutSeconds: 15, cors: allowedOrigins }, async (request) => {
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


const executeSlotSpin = onCall({ region: REGION, timeoutSeconds: 20, cors: allowedOrigins }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
    const { spinId, clientSeed } = request.data;
    if (!spinId || !clientSeed) throw new HttpsError("invalid-argument", "Faltan datos (spinId, clientSeed).");
    const uid = request.auth.uid;
    const pendingSpinRef = db.doc(`pendingSpins/${spinId}`);
    const userSlotsRef = db.doc(`userSlots/${uid}`);
    const userRef = db.doc(`users/${uid}`);
    const machineRef = db.doc(`slotsMachines/${SLOTS_MACHINE_ID}`);
    return db.runTransaction(async (tx) => {
        const [spinSnap, userSlotsSnap, userSnap, machineRefSnap] = await tx.getAll(pendingSpinRef, userSlotsRef, userRef, machineRef);
        if (!spinSnap.exists || spinSnap.data().uid !== uid || spinSnap.data().status !== 'pending') {
            throw new HttpsError("not-found", "Giro no válido o ya ejecutado.");
        }
        if (!userSlotsSnap.exists || (userSlotsSnap.data().chips || 0) < 1) {
            tx.update(pendingSpinRef, { status: 'failed', reason: 'Insufficient chips' });
            throw new HttpsError("failed-precondition", "Te quedaste sin fichas.");
        }
        if (!machineRefSnap.exists || !userSnap.exists) {
            tx.update(pendingSpinRef, { status: 'failed', reason: 'Internal error (machine/user)' });
            throw new HttpsError("internal", "No se pudo encontrar la máquina o el usuario.");
        }
        const { serverSeed, nonce } = spinSnap.data();
        const { prize, finalHash } = getProvablyFairSlotResult(serverSeed, clientSeed, nonce);
        const currentPrizePool = machineRefSnap.data().prizePool || BOTE_MINIMO_GARANTIZADO;
        let winAmount = 0;
        let isJackpotWin = false;
        if (prize.name === 'JACKPOT') {
            isJackpotWin = true;
            const jackpotPercentage = prize.prizePercent / 100;
            winAmount = currentPrizePool * jackpotPercentage;
            tx.update(machineRef, { prizePool: BOTE_MINIMO_GARANTIZADO });
        } else {
            const prizeInfo = PAY_TABLE.find(p => p.name === prize.name);
            const prizePercentage = (prizeInfo && prizeInfo.prizePercent) ? (prizeInfo.prizePercent / 100) : 0;
            winAmount = currentPrizePool * prizePercentage;
            if (winAmount > 0) {
                tx.update(machineRef, { prizePool: FieldValue.increment(-winAmount) });
            }
        }
        tx.update(userSlotsRef, { chips: FieldValue.increment(-1) });
        if (winAmount > 0) {
            tx.update(userRef, { balance: FieldValue.increment(winAmount) });
        }
        tx.update(pendingSpinRef, {
            status: 'completed',
            clientSeed,
            finalHash,
            prizeWon: prize.name,
            winAmount,
            completedAt: FieldValue.serverTimestamp()
        });
        const spinLogRef = db.collection("slotsSpins").doc(spinId);
        tx.set(spinLogRef, {
            userId: uid,
            username: userSnap.data().username || 'Anónimo',
            type: prize.name,
            combination: prize.symbol ? [prize.symbol, prize.symbol, prize.symbol] : ['🚫', '🚫', '🚫'],
            winAmount,
            isJackpot: isJackpotWin,
            playedAt: FieldValue.serverTimestamp(),
            serverSeedHash: spinSnap.data().serverSeedHash,
            clientSeed,
            nonce
        });
        const statsUpdate = {
            totalWinnings: FieldValue.increment(winAmount),
            updatedAt: FieldValue.serverTimestamp(),
            biggestWin: Math.max(winAmount, userSlotsSnap.data().biggestWin || 0)
        };
        tx.update(userSlotsRef, statsUpdate);
        return {
            success: true,
            result: {
                prizeType: prize.name,
                combination: prize.symbol ? [prize.symbol, prize.symbol, prize.symbol] : ['🚫', '🚫', '🚫'],
                winAmount,
                isJackpot: isJackpotWin
            },
            verification: { serverSeed, clientSeed, nonce, finalHash },
            chipsRemaining: userSlotsSnap.data().chips - 1,
            newPrizePool: isJackpotWin ? BOTE_MINIMO_GARANTIZADO : currentPrizePool - winAmount
        };
    });
});


module.exports = {
    buySlotsChipsCallable,
    slotsJackpotProcessor,
    requestSlotSpin,
    executeSlotSpin
};