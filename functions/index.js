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

// --- CONSTANTES PARA CRASH GAME ---
const CRASH_HOUSE_EDGE = 0.03; // 3% de margen para la casa

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

// --- CRASH GAME ALGORITHM ---
// Implementación estándar de la industria para un juego de Crash "Provably Fair".
function getProvablyFairCrashPoint(serverSeed) {
    const hmac = crypto.createHmac('sha256', serverSeed).digest('hex');
    const h = parseInt(hmac.slice(0, 13), 16); // Usar 52 bits para una buena distribución
    const e = Math.pow(2, 52);

    // El 3% de los resultados será un crash instantáneo (margen de la casa).
    if (h % 33 < 1) { // 1/33 ~= 3%
        return 1.00;
    }

    // Fórmula principal que genera la curva de resultados.
    const crashPoint = (Math.floor((100 * e - h) / (e - h))) / 100;

    return parseFloat(Math.max(1.00, crashPoint).toFixed(2));
}


// ===================================================================
// --- INICIO DEL NUEVO "MOTOR DE JUEGO" PARA CRASH ---
// ===================================================================

exports.crashGameEngine = onSchedule({
    schedule: "every 1 minutes",
    region: REGION,
    timeoutSeconds: 59,
    memory: "256MiB"
}, async () => {
    logger.info("[CRASH_ENGINE] Iniciando ciclo de procesamiento de rondas...");

    const engineConfigRef = db.doc('game_crash/engine_config');
    const configSnap = await engineConfigRef.get();

    if (!configSnap.exists || configSnap.data().status !== 'enabled') {
        logger.warn("[CRASH_ENGINE] El motor está desactivado. Omitiendo ciclo.");
        return;
    }

    for (let i = 0; i < 2; i++) { // Procesamos 2 rondas de 30 segundos cada una.
        const roundStartTime = Date.now();
        logger.info(`[CRASH_ENGINE] Procesando ronda #${i + 1} de 2...`);

        try {
            const gameDocRef = db.doc('game_crash/live_game');
            const historyCollectionRef = db.collection('game_crash_history');

            const previousGameSnap = await gameDocRef.get();
            if (previousGameSnap.exists && previousGameSnap.data().gameState !== 'waiting') {
                const oldData = previousGameSnap.data();
                const playersSnap = await gameDocRef.collection('players').get();
                const oldPlayers = playersSnap.docs.map(doc => doc.data());

                const totalPot = oldPlayers.reduce((sum, p) => sum + (p.bet || 0), 0);
                const totalPayout = oldPlayers.filter(p => p.status === 'cashed_out').reduce((sum, p) => sum + p.winnings, 0);
                const netProfit = totalPot - totalPayout;

                if (oldData.roundId) {
                    await historyCollectionRef.doc(oldData.roundId).set({
                        crashPoint: oldData.crashPoint,
                        totalPot,
                        netProfit,
                        timestamp: oldData.started_at || FieldValue.serverTimestamp(),
                        serverSeed: oldData.serverSeed,
                    });
                }
            }

            const playersToDeleteSnap = await gameDocRef.collection('players').get();
            const batch = db.batch();
            playersToDeleteSnap.forEach(doc => batch.delete(doc.ref));
            await batch.commit();

            const serverSeed = crypto.randomBytes(32).toString('hex');
            const serverSeedHash = crypto.createHash('sha256').update(serverSeed).digest('hex');
            const roundId = db.collection('dummy').doc().id;

            await gameDocRef.set({
                gameState: 'waiting',
                roundId,
                serverSeedHash,
                wait_until: new Date(Date.now() + 10000), // 10s para apostar
                server_time_now: FieldValue.serverTimestamp(),
            });

            await sleep(10000);

            const crashPoint = getProvablyFairCrashPoint(serverSeed);
            logger.info(`[CRASH_ENGINE] Ronda ${roundId}: CrashPoint fijado en ${crashPoint}x.`);

            await gameDocRef.update({
                gameState: 'running',
                started_at: FieldValue.serverTimestamp(),
                crashPoint: crashPoint,
                serverSeed: serverSeed,
            });

            const crashTimeMs = Math.log(crashPoint) / 0.00006;
            await sleep(Math.min(crashTimeMs, 18000));

            await gameDocRef.update({ gameState: 'crashed' });

        } catch (error) {
            logger.error(`[CRASH_ENGINE] Error procesando ronda #${i + 1}:`, error);
        }

        const roundEndTime = Date.now();
        const elapsed = roundEndTime - roundStartTime;
        const delay = Math.max(0, 30000 - elapsed);
        await sleep(delay);
    }

    logger.info("[CRASH_ENGINE] Ciclo de procesamiento de rondas completado.");
});

exports.toggleCrashEngine = onCall({
    region: REGION,
    cors: ["http://localhost:5173", "http://localhost:3000", "https://oriluck-casino.onrender.com"]
}, async (request) => {
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

exports.placeBet_crash = onCall({
    region: REGION,
    cors: ["http://localhost:5173", "http://localhost:3000", "https://oriluck-casino.onrender.com"]
}, async (request) => {
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
    return db.runTransaction(async (tx) => {
        const [gameSnap, userSnap] = await tx.getAll(gameDocRef, userRef);
        if (!gameSnap.exists) throw new HttpsError('failed-precondition', 'No hay una ronda activa.');
        if (gameSnap.data().gameState !== 'waiting') throw new HttpsError('failed-precondition', 'La fase de apuestas ha terminado.');
        if (!userSnap.exists) throw new HttpsError('not-found', 'Perfil de usuario no encontrado.');
        if ((userSnap.data().balance || 0) < amount) throw new HttpsError('failed-precondition', 'Saldo insuficiente.');
        tx.update(userRef, { balance: FieldValue.increment(-amount) });
        const playerDocRef = gameDocRef.collection('players').doc(uid);
        tx.set(playerDocRef, { bet: amount, username: userSnap.data().username || 'Jugador', status: 'playing' });
        return { success: true };
    });
});

exports.cashOut_crash = onCall({
    region: REGION,
    cors: ["http://localhost:5173", "http://localhost:3000", "https://oriluck-casino.onrender.com"]
}, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
    
    const uid = request.auth.uid;
    const gameDocRef = db.doc('game_crash/live_game');
    const playerDocRef = gameDocRef.collection('players').doc(uid);
    const userRef = db.doc(`users/${uid}`);

    return db.runTransaction(async (tx) => {
        const [gameSnap, playerSnap] = await tx.getAll(gameDocRef, playerDocRef);
        if (!gameSnap.exists) throw new HttpsError('failed-precondition', 'No hay una ronda activa.');
        if (gameSnap.data().gameState !== 'running') throw new HttpsError('failed-precondition', 'El juego no está en curso.');
        if (!playerSnap.exists || playerSnap.data().status !== 'playing') throw new HttpsError('failed-precondition', 'No tienes una apuesta activa o ya has retirado.');
        
        const gameData = gameSnap.data();
        const playerData = playerSnap.data();
        
        const startedAt = gameData.started_at;
        const elapsedTime = Date.now() - startedAt.toDate().getTime();
        const currentMultiplier = Math.max(1.00, Math.floor(100 * Math.exp(0.00006 * elapsedTime)) / 100);

        if (currentMultiplier >= gameData.crashPoint) throw new HttpsError('failed-precondition', '¡Demasiado tarde! El juego ya ha crasheado.');

        const winnings = playerData.bet * currentMultiplier;
        tx.update(userRef, { balance: FieldValue.increment(winnings) });
        tx.update(playerDocRef, { status: 'cashed_out', cashOutMultiplier: currentMultiplier, winnings: winnings });
        return { success: true, winnings, cashOutMultiplier: currentMultiplier };
    });
});