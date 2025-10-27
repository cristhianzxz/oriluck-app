/*
* filepath: dominoEngine.js
*/
const { onCall, HttpsError, onRequest } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { CloudTasksClient } = require('@google-cloud/tasks');
const admin = require('firebase-admin');

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = getFirestore();

const REGION = "southamerica-east1";
const PROJECT_ID = process.env.GCLOUD_PROJECT || 'oriluck-7e0e3';
const QUEUE_NAME = 'domino-tasks';
const LOCATION_ID = REGION;
const START_GAME_DELAY_SECONDS = 60;
const TURN_TIMEOUT_SECONDS = 30;
const PASS_TIMEOUT_SECONDS = 10;
const NEXT_ROUND_DELAY_SECONDS = 15;

const START_GAME_TRIGGER_URL = `https://${LOCATION_ID}-${PROJECT_ID}.cloudfunctions.net/startGameTrigger`;
const TURN_TIMEOUT_TRIGGER_URL = `https://${LOCATION_ID}-${PROJECT_ID}.cloudfunctions.net/turnTimeoutTrigger`;

const tasksClient = new CloudTasksClient();
const parent = tasksClient.queuePath(PROJECT_ID, LOCATION_ID, QUEUE_NAME);

const DOMINO_CONSTANTS = {
    MAX_PLAYERS: 4,
    HAND_SIZE: 7,
    TARGET_SCORE_TOURNAMENT: 100,
    USD_TO_VES_RATE: 100,
    HOUSE_COMMISSION_PERCENT: 5,
};
const ALLOWED_ENTRY_FEES_USD = [1, 2.5, 5, 10, 20];

async function scheduleTask(payload, delaySeconds, url) {
    const task = {
        httpRequest: {
            httpMethod: 'POST',
            url: url,
            headers: { 'Content-Type': 'application/json' },
            body: Buffer.from(JSON.stringify(payload)).toString('base64'),
        },
        scheduleTime: {
            seconds: Math.floor(Date.now() / 1000) + delaySeconds,
        },
    };
    try {
        const [response] = await tasksClient.createTask({ parent, task });
        logger.info(`Scheduled task ${response.name} with delay ${delaySeconds}s for URL ${url}`);
        return response.name;
    } catch (error) {
        logger.error(`Error scheduling task: Name: ${QUEUE_NAME}, Proj: ${PROJECT_ID}, Loc: ${LOCATION_ID}`, error);
        if (error.code === 5) {
             throw new HttpsError('not-found', 'Cloud Tasks queue not found. Please wait or check configuration.', error.details);
        } else if (error.code === 7) {
             throw new HttpsError('permission-denied', 'Permission denied for Cloud Tasks API.', error.details);
        }
        throw new HttpsError('internal', 'Could not schedule game task.', error.details || error.message);
    }
}

async function cancelTask(taskId) {
    if (!taskId || !taskId.includes('/tasks/')) {
        return;
    }
    try {
        await tasksClient.deleteTask({ name: taskId });
        logger.info(`Cancelled task ${taskId}`);
    } catch (error) {
        if (error.code !== 5) {
            logger.error(`Error cancelling task ${taskId}:`, error);
        } else {
             logger.info(`Task ${taskId} not found for cancellation (already executed or cancelled).`);
        }
    }
}

function tileValue(tile) {
    const top = Number(tile?.top) || 0;
    const bottom = Number(tile?.bottom) || 0;
    return top + bottom;
}

function getValidMoves(hand, board) {
    const validMoves = [];
    if (!hand || !Array.isArray(hand)) return [];
    if (!board || !Array.isArray(board) || board.length === 0) {
        hand.forEach((tile, index) => {
            if (tile) validMoves.push({ tileIndex: index, tile, position: 'start' });
        });
        return validMoves;
    }
    const firstTile = board[0];
    const lastTile = board[board.length - 1];
    if (typeof firstTile?.top !== 'number' || typeof lastTile?.bottom !== 'number') {
        logger.error("Board tiles missing or invalid top/bottom properties:", {first: firstTile, last: lastTile});
        return [];
    }
    const startValue = firstTile.top;
    const endValue = lastTile.bottom;

    hand.forEach((tile, index) => {
        if (!tile || typeof tile.top !== 'number' || typeof tile.bottom !== 'number') return;
        const canPlayStart = tile.top === startValue || tile.bottom === startValue;
        const canPlayEnd = tile.top === endValue || tile.bottom === endValue;
        if (canPlayStart) {
            validMoves.push({ tileIndex: index, tile, position: 'start' });
        }
        if (canPlayEnd && (!canPlayStart || startValue !== endValue)) {
            validMoves.push({ tileIndex: index, tile, position: 'end' });
        }
    });
    return validMoves;
}

function applyMove(board, hand, move) {
    const { tileIndex, tile, position } = move;
    let newBoard = board ? [...board] : [];
    let tileToAdd = { ...tile };
    if (newBoard.length === 0) {
        newBoard.push(tileToAdd);
    } else {
        const startValue = newBoard[0].top;
        const endValue = newBoard[newBoard.length - 1].bottom;
        if (position === 'start') {
            if (tileToAdd.bottom !== startValue) {
                [tileToAdd.top, tileToAdd.bottom] = [tileToAdd.bottom, tileToAdd.top];
            }
            newBoard.unshift(tileToAdd);
        } else {
            if (tileToAdd.top !== endValue) {
                 [tileToAdd.top, tileToAdd.bottom] = [tileToAdd.bottom, tileToAdd.top];
            }
            newBoard.push(tileToAdd);
        }
    }
    const newHand = hand.filter((_, index) => index !== tileIndex);
    return { newBoard, newHand };
}

async function processRoundEnd(tx, gameRef, winnerId, isTranque = false, playersDataMap = null) {
    // (Petición 4) Add log
    logger.info(`[processRoundEnd] Starting round end calculation for game ${gameRef.id}. Winner: ${winnerId}, Tranque: ${isTranque}`);
    
    const gameSnap = await tx.get(gameRef);
    if (!gameSnap.exists) {
        logger.error(`processRoundEnd: Game ${gameRef.id} not found.`);
        return { targetScoreReached: false, updates: [], newScores: {} };
    }
    const gameData = gameSnap.data();

    let currentPlayersMap = playersDataMap;
    if (!currentPlayersMap) {
        const playersSnap = await tx.get(gameRef.collection('players'));
        currentPlayersMap = {};
        playersSnap.forEach(doc => {
            currentPlayersMap[doc.id] = { id: doc.id, ...doc.data() };
        });
    }

    let roundPoints = 0;
    let roundWinnerId = winnerId;
    let roundWinningTeam = null;
    let losingPlayerIds = [];

    const playerHandScores = {};
    Object.entries(currentPlayersMap).forEach(([playerId, playerData]) => {
        let handScore = 0;
        if (Array.isArray(playerData.hand)) {
            handScore = playerData.hand.reduce((sum, tile) => sum + (tile ? tileValue(tile) : 0), 0);
        }
        playerHandScores[playerId] = handScore;
    });

    if (isTranque) {
        logger.info(`Calculating tranque winner for game ${gameRef.id}`);
        if (gameData.type === '2v2') {
            const teamScores = { team1: 0, team2: 0 };
            Object.entries(currentPlayersMap).forEach(([playerId, playerData]) => {
                teamScores[playerData.team] += playerHandScores[playerId];
            });

            if (teamScores.team1 < teamScores.team2) {
                roundWinningTeam = 'team1';
            } else if (teamScores.team2 < teamScores.team1) {
                roundWinningTeam = 'team2';
            } else {
                logger.info(`Tranque resulted in a team tie with ${teamScores.team1} points. No points awarded.`);
                roundWinningTeam = null;
                roundWinnerId = null;
            }

            if (roundWinningTeam) {
                losingPlayerIds = Object.keys(currentPlayersMap).filter(pid => currentPlayersMap[pid].team !== roundWinningTeam);
                roundWinnerId = Object.keys(currentPlayersMap).find(pid => currentPlayersMap[pid].team === roundWinningTeam);
                logger.info(`Tranque winner team: ${roundWinningTeam}. Losers: ${losingPlayerIds.join(', ')}`);
            }
        } else {
            let minScore = Infinity;
            let potentialWinners = [];
            Object.entries(playerHandScores).forEach(([playerId, score]) => {
                if (score < minScore) {
                    minScore = score;
                    potentialWinners = [playerId];
                } else if (score === minScore) {
                    potentialWinners.push(playerId);
                }
            });

            if (potentialWinners.length === 1) {
                roundWinnerId = potentialWinners[0];
                losingPlayerIds = Object.keys(currentPlayersMap).filter(pid => pid !== roundWinnerId);
                logger.info(`Tranque winner: ${roundWinnerId} with ${minScore} points. Losers: ${losingPlayerIds.join(', ')}`);
            } else {
                logger.info(`Tranque resulted in an individual tie with ${minScore} points. No points awarded.`);
                roundWinnerId = null;
            }
        }
    } else {
        roundWinnerId = winnerId;
        if (gameData.type === '2v2') {
            const winnerData = currentPlayersMap[roundWinnerId];
            roundWinningTeam = winnerData?.team;
            losingPlayerIds = Object.keys(currentPlayersMap).filter(pid => currentPlayersMap[pid].team !== roundWinningTeam);
        } else {
            losingPlayerIds = Object.keys(currentPlayersMap).filter(pid => pid !== roundWinnerId);
        }
        logger.info(`Domino by ${roundWinnerId}. Losers: ${losingPlayerIds.join(', ')}`);
    }

    roundPoints = losingPlayerIds.reduce((sum, pid) => sum + (playerHandScores[pid] || 0), 0);
    logger.info(`Round points calculated (sum of losers' hands): ${roundPoints}`);

    // (Petición 4) Add validation to prevent negative scores, just in case.
    if (roundPoints < 0) {
        logger.warn(`[processRoundEnd] Calculated round points are negative (${roundPoints}). Clamping to 0.`);
        roundPoints = 0;
    }

    let targetScoreReached = false;
    const currentScores = gameData.scores || {};
    const newScores = { ...currentScores };
    const playerUpdates = [];

    if ((roundWinnerId || roundWinningTeam) && roundPoints > 0) {
        if (gameData.type === '2v2' && roundWinningTeam) {
            newScores[roundWinningTeam] = (newScores[roundWinningTeam] || 0) + roundPoints;
            // (Petición 4) Add log for score update
            logger.info(`[processRoundEnd] Team ${roundWinningTeam} score updated to ${newScores[roundWinningTeam]} (Added ${roundPoints} pts)`);
            if (newScores[roundWinningTeam] >= DOMINO_CONSTANTS.TARGET_SCORE_TOURNAMENT) {
                targetScoreReached = true;
            }
            Object.values(currentPlayersMap).forEach(player => {
                if (player.team === roundWinningTeam) {
                    playerUpdates.push({
                        ref: gameRef.collection('players').doc(player.id),
                        data: { score: newScores[roundWinningTeam] }
                    });
                }
            });
        } else if (gameData.type !== '2v2' && roundWinnerId) {
            newScores[roundWinnerId] = (newScores[roundWinnerId] || 0) + roundPoints;
            // (Petición 4) Add log for score update
            logger.info(`[processRoundEnd] Player ${roundWinnerId} score updated to ${newScores[roundWinnerId]} (Added ${roundPoints} pts)`);
            playerUpdates.push({
                ref: gameRef.collection('players').doc(roundWinnerId),
                data: { score: newScores[roundWinnerId] }
            });
            if (newScores[roundWinnerId] >= DOMINO_CONSTANTS.TARGET_SCORE_TOURNAMENT) {
                targetScoreReached = true;
            }
        }
    } else {
        logger.info(`No points awarded this round (winner: ${roundWinnerId}, team: ${roundWinningTeam}, points: ${roundPoints}).`);
    }

    const gameUpdate = { scores: newScores };
    return { targetScoreReached, updates: [...playerUpdates, { ref: gameRef, data: gameUpdate }], newScores };
}


async function processGameEnd(tx, gameRef, playersSnap, currentScores) {
    const gameSnap = await tx.get(gameRef);
    if (!gameSnap.exists) return { updates: [] };
    const gameData = gameSnap.data();

    const totalPrize = gameData.prizePoolVES || 0;
    const commission = totalPrize * (DOMINO_CONSTANTS.HOUSE_COMMISSION_PERCENT / 100);
    const netPrize = totalPrize - commission;

    let winners = [];
    let winningTeam = null;

    const finalScores = currentScores || gameData.scores || {};

    if (gameData.type === '2v2') {
         const score1 = finalScores.team1 || 0;
         const score2 = finalScores.team2 || 0;
         const target = DOMINO_CONSTANTS.TARGET_SCORE_TOURNAMENT;

         if (score1 >= target && score2 >= target) {
             winningTeam = score1 >= score2 ? 'team1' : 'team2';
         } else if (score1 >= target) {
             winningTeam = 'team1';
         } else if (score2 >= target) {
             winningTeam = 'team2';
         }

         if (winningTeam) {
             playersSnap.forEach(doc => {
                 if (doc.data().team === winningTeam) winners.push(doc.id);
             });
         }
    } else {
         let highestScore = -1;
         playersSnap.forEach(doc => {
             const playerId = doc.id;
             const score = finalScores[playerId] || 0;
             if (score >= DOMINO_CONSTANTS.TARGET_SCORE_TOURNAMENT) {
                 if (score > highestScore) {
                     highestScore = score;
                     winners = [playerId];
                 } else if (score === highestScore) {
                     winners.push(playerId);
                 }
             }
         });
    }

    const updates = [];
    let prizePerWinner = 0;

    if (winners.length > 0 && netPrize > 0) {
         prizePerWinner = netPrize / winners.length;
         winners.forEach(winnerId => {
             const userRef = db.doc(`users/${winnerId}`);
             updates.push({ ref: userRef, data: { balance: FieldValue.increment(prizePerWinner) } });
         });
         logger.info(`Game ${gameRef.id} end payout: ${prizePerWinner} VES each to ${winners.join(', ')}.`);
         updates.push({
             ref: db.collection('domino_payouts').doc(gameRef.id),
             data: {
                 gameId: gameRef.id,
                 timestamp: FieldValue.serverTimestamp(),
                 winners: winners,
                 winningTeam: winningTeam,
                 totalPrize: totalPrize,
                 commission: commission,
                 netPrize: netPrize,
                 prizePerWinner: prizePerWinner,
                 gameType: gameData.type,
                 finalScores: finalScores
             },
             type: 'set'
         });
    } else {
         logger.warn(`Game ${gameRef.id} ended with no winners reaching score or zero net prize.`);
    }

    updates.push({ ref: gameRef, data: { status: 'finished', finishedAt: FieldValue.serverTimestamp(), winner: winners[0] || null, winningTeam: winningTeam } });
    playersSnap.forEach(playerDoc => {
         const userRef = db.doc(`users/${playerDoc.id}`);
         updates.push({ ref: userRef, data: { activeDominoGames: FieldValue.arrayRemove({ gameId: gameRef.id, templateId: gameData.tournamentTemplateId }) } });
         updates.push({ ref: playerDoc.ref, data: { score: 0 } });
    });

    return { updates };
}


async function startDominoRound(tx, gameRef) {
    const gameSnap = await tx.get(gameRef);
    const playersSnap = await tx.get(gameRef.collection('players'));

    if (!gameSnap.exists) {
        logger.error(`startDominoRound: Game ${gameRef.id} not found.`);
        return { updates: [], firstPlayerId: null, taskPayload: null, firstTurnDuration: 0 };
    }
    const gameData = gameSnap.data();
    const maxPlayers = gameData.maxPlayers || DOMINO_CONSTANTS.MAX_PLAYERS;

    if (playersSnap.size !== maxPlayers) {
        logger.error(`startDominoRound precondition failed for ${gameRef.id}: Found ${playersSnap.size}/${maxPlayers} players.`);
        return { updates: [], firstPlayerId: null, taskPayload: null, firstTurnDuration: 0 };
    }
    
    // (Petición 3a) Determinar si es la primera ronda del torneo (puntajes en 0)
    const scores = gameData.scores || {};
    const isFirstRound = Object.values(scores).every(s => s === 0);
    logger.info(`[startDominoRound] Game ${gameRef.id}. Is first round: ${isFirstRound}`);

    let deck = [];
    for (let i = 0; i <= 6; i++) { for (let j = i; j <= 6; j++) deck.push({ top: i, bottom: j }); }
    deck.sort(() => Math.random() - 0.5);

    let startingPlayerId = null;
    let highestDouble = -1;
    const playerIds = playersSnap.docs.map(doc => doc.id);
    const playerHands = {};
    const playerJoinedAt = {};

    playersSnap.docs.forEach(doc => {
         const hand = deck.splice(0, DOMINO_CONSTANTS.HAND_SIZE);
         playerHands[doc.id] = hand;
         const joinedAtMillis = doc.data().joinedAt?.toMillis();
         playerJoinedAt[doc.id] = typeof joinedAtMillis === 'number' ? joinedAtMillis : Date.now();
    });

    // (Petición 3a) Lógica de inicio de ronda venezolana
    if (isFirstRound) {
        // 1. Buscar 6/6
        for (const pid of playerIds) {
            if (playerHands[pid] && playerHands[pid].some(t => t.top === 6 && t.bottom === 6)) {
                startingPlayerId = pid;
                highestDouble = 6; // Marcar que 6/6 fue encontrado
                logger.info(`[startDominoRound] ${pid} tiene el 6/6. Inicia la primera ronda.`);
                break;
            }
        }
    }

    // 2. Si no es la primera ronda, o si 6/6 no se encontró, buscar el doble más alto
    if (!startingPlayerId) {
        playersSnap.docs.forEach(doc => {
            const hand = playerHands[doc.id];
            if (Array.isArray(hand)) {
                 hand.forEach(tile => {
                      if (tile && tile.top === tile.bottom) {
                          if (tile.top > highestDouble) {
                              highestDouble = tile.top;
                              startingPlayerId = doc.id;
                          } else if (tile.top === highestDouble) {
                              if(startingPlayerId && playerJoinedAt[doc.id] < playerJoinedAt[startingPlayerId]){
                                   startingPlayerId = doc.id;
                              } else if (!startingPlayerId) {
                                   startingPlayerId = doc.id;
                              }
                          }
                      }
                 });
            }
        });
        if (startingPlayerId) {
             logger.info(`[startDominoRound] ${startingPlayerId} tiene el doble más alto (${highestDouble}).`);
        }
    }
    
    let turnOrder = gameData.turnOrder;
    let turnOrderUpdate = null;

    // (Petición 3b) Rotación anti-horaria para rondas siguientes
    if (turnOrder && turnOrder.length === maxPlayers) {
        if (!isFirstRound) {
            // [A, B, C, D] -> [D, A, B, C] (Anti-horario)
            turnOrder = [turnOrder[turnOrder.length - 1], ...turnOrder.slice(0, turnOrder.length - 1)];
            turnOrderUpdate = { turnOrder: turnOrder };
            logger.info(`[startDominoRound] Rotación anti-horaria. Nuevo orden: ${turnOrder.join(', ')}`);
        }
    } else {
         // Lógica de reconstrucción de turnOrder (se ejecuta la primera vez)
         logger.warn(`Invalid or missing turnOrder in ${gameRef.id}, reconstructing.`);
         let reconstructedTurnOrder = [];
         const sortedPlayerIds = [...playerIds].sort((a, b) => playerJoinedAt[a] - playerJoinedAt[b]);

         if (gameData.type === '2v2' && maxPlayers === 4) {
             const team1 = [], team2 = [];
             const playersData = {}; playersSnap.forEach(d => playersData[d.id] = d.data());
             sortedPlayerIds.forEach(pid => {
                 const pData = playersData[pid];
                 if(pData?.team === 'team1') team1.push(pid); else if (pData?.team === 'team2') team2.push(pid);
             });
             if (team1.length === 2 && team2.length === 2) {
                 reconstructedTurnOrder = [team1[0], team2[0], team1[1], team2[1]];
             } else {
                 logger.error(`Error reconstructing 2v2 order ${gameRef.id}. Teams mismatch. Fallback to join order.`);
                 reconstructedTurnOrder = sortedPlayerIds;
             }
         } else {
             reconstructedTurnOrder = sortedPlayerIds;
         }
         turnOrder = reconstructedTurnOrder;
         turnOrderUpdate = { turnOrder: turnOrder };
    }

    // (Petición 3b) Si no hay dobles (startingPlayerId = null), empieza el líder del turno (ya rotado)
    if (!startingPlayerId) {
        if (turnOrder && turnOrder.length > 0) {
            startingPlayerId = turnOrder[0];
            logger.info(`[startDominoRound] No hay dobles. Inicia el jugador en turno (post-rotación): ${startingPlayerId}`);
        } else {
            // Fallback total (el código original lo tiene)
            startingPlayerId = [...playerIds].sort((a, b) => playerJoinedAt[a] - playerJoinedAt[b])[0];
            logger.warn(`[startDominoRound] Fallback de jugador inicial (join order): ${startingPlayerId}`);
        }
    }

    // Re-ordenar turnOrder para que el 'startingPlayerId' esté en [0]
    const starterIndex = turnOrder.indexOf(startingPlayerId);
    if (starterIndex > 0) {
        turnOrder = [...turnOrder.slice(starterIndex), ...turnOrder.slice(0, starterIndex)];
        turnOrderUpdate = { turnOrder: turnOrder };
    } else if (starterIndex === -1) {
        logger.error(`Starter ${startingPlayerId} not found in turnOrder ${turnOrder} for ${gameRef.id}. Prepending.`);
        turnOrder.unshift(startingPlayerId);
        turnOrder = turnOrder.slice(0, maxPlayers);
        turnOrderUpdate = { turnOrder: turnOrder };
    }

    const firstPlayerHand = playerHands[startingPlayerId] || [];
    
    // (Petición 3a) Validar primera jugada del torneo (solo 6/6)
    let firstPlayerMoves;
    if (isFirstRound && highestDouble === 6) {
        // Solo permitir 6/6
        firstPlayerMoves = [];
        const sixDoubleIndex = firstPlayerHand.findIndex(t => t.top === 6 && t.bottom === 6);
        if (sixDoubleIndex !== -1) {
            firstPlayerMoves.push({ tileIndex: sixDoubleIndex, tile: firstPlayerHand[sixDoubleIndex], position: 'start' });
        } else {
            logger.error(`[startDominoRound] Error crítico: ${startingPlayerId} debía tener 6/6 pero no se encontró.`);
        }
    } else {
        // Lógica normal (cualquier ficha si el tablero está vacío)
        firstPlayerMoves = getValidMoves(firstPlayerHand, []);
    }
    
    const firstTurnDuration = firstPlayerMoves.length > 0 ? TURN_TIMEOUT_SECONDS : PASS_TIMEOUT_SECONDS;

    const updates = [];
    playerIds.forEach(playerId => {
        updates.push({
            ref: gameRef.collection('players').doc(playerId),
            data: { hand: playerHands[playerId] || [], isReady: false }
        });
    });

    const gameUpdateData = {
        status: 'playing',
        boneyard: deck,
        board: [],
        currentTurn: startingPlayerId,
        turnStartTime: FieldValue.serverTimestamp(),
        turnTimerTaskId: null,
        turnTimeoutSeconds: firstTurnDuration,
        countdownTaskId: null,
        startCountdownAt: null,
        passCount: 0,
        lastMove: null,
        winner: null,
        roundWinner: null,
        roundPoints: 0,
        ...(turnOrderUpdate || {})
    };
    updates.push({ ref: gameRef, data: gameUpdateData });

    const taskPayload = { gameId: gameRef.id, expectedPlayerId: startingPlayerId };

    return { updates, firstPlayerId: startingPlayerId, taskPayload, firstTurnDuration };
}

module.exports.createTournamentTemplate = onCall({ region: REGION }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Autenticación requerida.');
    const adminSnap = await db.doc(`users/${request.auth.uid}`).get();
    if (!adminSnap.exists || adminSnap.data().role !== 'admin') {
        throw new HttpsError('permission-denied', 'No tienes permisos de administrador.');
    }
    const { name, type, entryFeeUSD } = request.data;
    if (!name || typeof name !== 'string' || name.length < 3 || name.length > 50) {
        throw new HttpsError('invalid-argument', 'Nombre de torneo inválido (3-50 caracteres).');
    }
    if (type !== '1v1v1v1' && type !== '2v2') {
        throw new HttpsError('invalid-argument', 'Tipo de torneo inválido (solo "1v1v1v1" o "2v2").');
    }
    const numericEntryFee = Number(entryFeeUSD);
    if (isNaN(numericEntryFee) || !ALLOWED_ENTRY_FEES_USD.includes(numericEntryFee)) {
        throw new HttpsError('invalid-argument', `Tarifa de entrada inválida. Permitidas: ${ALLOWED_ENTRY_FEES_USD.join(', ')} USD.`);
    }
    const entryFeeVES = numericEntryFee * DOMINO_CONSTANTS.USD_TO_VES_RATE;
    const newTemplateRef = db.collection('domino_tournaments').doc();
    try {
        await newTemplateRef.set({
            name: name, type: type, entryFeeUSD: numericEntryFee, entryFeeVES: entryFeeVES,
            createdAt: FieldValue.serverTimestamp(), status: 'open', createdBy: request.auth.uid,
            maxPlayers: DOMINO_CONSTANTS.MAX_PLAYERS
        });
        logger.info(`Plantilla de torneo creada: ${newTemplateRef.id} por ${request.auth.uid}`);
        return { success: true, templateId: newTemplateRef.id };
    } catch (error) {
        logger.error("Error creating tournament template:", error);
        throw new HttpsError('internal', 'Error al crear la plantilla.', error.message);
    }
});

module.exports.updateDominoSettings = onCall({ region: REGION }, async (request) => {
     if (!request.auth) throw new HttpsError('unauthenticated', 'Autenticación requerida.');
    const adminSnap = await db.doc(`users/${request.auth.uid}`).get();
    if (!adminSnap.exists || adminSnap.data().role !== 'admin') {
        throw new HttpsError('permission-denied', 'No tienes permisos de administrador.');
    }
    const { commissionPercent, minBet } = request.data;
    const settings = {};
    if (typeof commissionPercent === 'number' && commissionPercent >= 0 && commissionPercent <= 50) settings.commissionPercent = commissionPercent;
    if (typeof minBet === 'number' && minBet >= 0) settings.minBet = minBet;
    if (Object.keys(settings).length === 0) throw new HttpsError('invalid-argument', 'No se proporcionaron ajustes válidos.');
    const settingsRef = db.doc('domino_settings/config');
    try {
        await settingsRef.set(settings, { merge: true });
        logger.info(`Ajustes de dominó actualizados por ${request.auth.uid}:`, settings);
        return { success: true };
    } catch (error) {
        logger.error("Error updating domino settings:", error);
        throw new HttpsError('internal', 'Error al actualizar ajustes.', error.message);
    }
});

module.exports.buyTournamentEntry = onCall({ region: REGION }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Autenticación requerida.');
    const { tournamentTemplateId, selectedTeam } = request.data;
    if (!tournamentTemplateId) throw new HttpsError('invalid-argument', 'ID de plantilla de torneo requerido.');
    const userId = request.auth.uid;
    const templateRef = db.doc(`domino_tournaments/${tournamentTemplateId}`);
    const userRef = db.doc(`users/${userId}`);
    const gamesCollectionRef = db.collection('domino_tournament_games');

    let scheduledTaskId = null;
    let gameIdResult = null;

    try {
        await db.runTransaction(async (tx) => {
            const templateSnap = await tx.get(templateRef);
            const userSnap = await tx.get(userRef);
            if (!templateSnap.exists) throw new HttpsError('not-found', 'Plantilla de torneo no encontrada.');
            if (!userSnap.exists) throw new HttpsError('not-found', 'Tu perfil de usuario no existe.');
            const templateData = templateSnap.data();
            const userData = userSnap.data();
            const entryFee = templateData.entryFeeVES;
            const is2v2 = templateData.type === '2v2';
            const maxPlayers = templateData.maxPlayers || DOMINO_CONSTANTS.MAX_PLAYERS;

            if (is2v2 && !['team1', 'team2'].includes(selectedTeam)) throw new HttpsError('invalid-argument', 'Equipo inválido seleccionado.');
            if (templateData.status !== 'open') throw new HttpsError('failed-precondition', 'Este torneo no está aceptando entradas.');
            if ((userData.balance || 0) < entryFee) throw new HttpsError('resource-exhausted', 'Saldo insuficiente.');

            const q = gamesCollectionRef.where('tournamentTemplateId', '==', tournamentTemplateId).where('status', '==', 'waiting');
            const waitingGamesSnap = await tx.get(q);

            let targetGameRef = null;
            let existingGameData = null;
            let currentPlayersSnap = null;

            for (const doc of waitingGamesSnap.docs) {
                 const gameDataLoop = doc.data();
                 const playersSnapLoop = await tx.get(doc.ref.collection('players'));
                 if (playersSnapLoop.size < maxPlayers) {
                     if (is2v2) {
                         let teamCount = 0; playersSnapLoop.forEach(pDoc => { if (pDoc.data().team === selectedTeam) teamCount++; });
                         if (teamCount < (maxPlayers / 2)) {
                             targetGameRef = doc.ref; existingGameData = gameDataLoop; currentPlayersSnap = playersSnapLoop; break;
                         }
                     } else {
                         targetGameRef = doc.ref; existingGameData = gameDataLoop; currentPlayersSnap = playersSnapLoop; break;
                     }
                 }
            }

            let isNewGame = false;
            if (!targetGameRef) {
                 targetGameRef = gamesCollectionRef.doc();
                 isNewGame = true;
                 currentPlayersSnap = { docs: [], size: 0 };
                 existingGameData = {};
            }
            gameIdResult = targetGameRef.id;

            const playerRef = targetGameRef.collection('players').doc(userId);
            const playerSnap = await tx.get(playerRef);
            if (playerSnap.exists) throw new HttpsError('already-exists', 'Ya estás en esta partida.');

            const currentPlayerCount = currentPlayersSnap.size;
            const newPlayerCount = currentPlayerCount + 1;
            const isNowFull = newPlayerCount === maxPlayers;
            const newStatus = isNowFull ? 'full' : 'waiting';
            let finalTurnOrder = existingGameData?.turnOrder || [];
            const newPlayerDataForSet = { uid: userId, username: userData.username || 'Jugador', avatar: userData.avatar || null, team: is2v2 ? selectedTeam : null, joinedAt: FieldValue.serverTimestamp(), isReady: false, hand: [], score: 0 };

            if (isNowFull) {
                const existingPlayersDataWithTimestamp = currentPlayersSnap.docs.map(d => ({ id: d.id, ...d.data(), joinedAtMillis: d.data().joinedAt?.toMillis() || Date.now() }));
                const allPlayersData = [...existingPlayersDataWithTimestamp, { ...newPlayerDataForSet, id: userId, joinedAtMillis: Date.now() }];
                allPlayersData.sort((a, b) => a.joinedAtMillis - b.joinedAtMillis);

                if (is2v2 && maxPlayers === 4) {
                    const team1 = allPlayersData.filter(p => p.team === 'team1').map(p => p.id);
                    const team2 = allPlayersData.filter(p => p.team === 'team2').map(p => p.id);
                    if (team1.length === 2 && team2.length === 2) {
                        finalTurnOrder = [team1[0], team2[0], team1[1], team2[1]];
                    } else {
                        logger.error(`Error constructing 2v2 order ${targetGameRef.id}. Teams mismatch. Fallback.`); finalTurnOrder = allPlayersData.map(p => p.id);
                    }
                } else {
                    finalTurnOrder = allPlayersData.map(p => p.id);
                }
                logger.info(`Game ${targetGameRef.id} full. Initial Order: ${JSON.stringify(finalTurnOrder)}`);
            }

            const updates = [];
            updates.push({ ref: playerRef, data: newPlayerDataForSet, type: 'set' });
            updates.push({ ref: userRef, data: { balance: FieldValue.increment(-entryFee), activeDominoGames: FieldValue.arrayUnion({ gameId: targetGameRef.id, templateId: tournamentTemplateId }) } });
            if (isNewGame) {
                updates.push({ ref: targetGameRef, data: { tournamentTemplateId, name: templateData.name, type: templateData.type, entryFeeVES: entryFee, status: newStatus, createdAt: FieldValue.serverTimestamp(), prizePoolVES: entryFee, playerCount: 1, turnOrder: finalTurnOrder, currentTurn: null, startCountdownAt: null, countdownTaskId: null, boneyard: [], board: [], scores: is2v2 ? { team1: 0, team2: 0 } : {}, maxPlayers: maxPlayers }, type: 'set' });
            } else {
                const gameUpdates = { prizePoolVES: FieldValue.increment(entryFee), playerCount: FieldValue.increment(1), status: newStatus };
                if (isNowFull) gameUpdates.turnOrder = finalTurnOrder;
                updates.push({ ref: targetGameRef, data: gameUpdates });
            }
            if (isNowFull) {
                 const taskPayload = { gameId: targetGameRef.id };
                 scheduledTaskId = await scheduleTask(taskPayload, START_GAME_DELAY_SECONDS, START_GAME_TRIGGER_URL);
                 updates.push({ ref: targetGameRef, data: { startCountdownAt: FieldValue.serverTimestamp(), countdownTaskId: scheduledTaskId } });
            }

            updates.forEach(op => {
                if (op.type === 'set') tx.set(op.ref, op.data);
                else tx.update(op.ref, op.data);
            });
        });

        return { success: true, gameId: gameIdResult };

    } catch (error) {
        logger.error(`Error in buyTournamentEntry tx for user ${userId}, template ${tournamentTemplateId}:`, error);
        if (scheduledTaskId) {
             logger.warn(`Transaction failed after scheduling task ${scheduledTaskId}, attempting cancellation.`);
             await cancelTask(scheduledTaskId);
        }
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', 'Error processing entry purchase.', error.message);
    }
});

module.exports.refundTournamentEntry = onCall({ region: REGION }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Autenticación requerida.');
    const { gameId } = request.data;
    if (!gameId) throw new HttpsError('invalid-argument', 'ID de partida requerido.');
    const userId = request.auth.uid;
    const gameRef = db.doc(`domino_tournament_games/${gameId}`);
    const playerRef = gameRef.collection('players').doc(userId);
    const userRef = db.doc(`users/${userId}`);

    let taskToCancel = null;

    try {
        await db.runTransaction(async (tx) => {
            const gameSnap = await tx.get(gameRef);
            const playerSnap = await tx.get(playerRef);
            if (!gameSnap.exists) throw new HttpsError('not-found', 'Partida no encontrada.');
            if (!playerSnap.exists) throw new HttpsError('not-found', 'No estás registrado en esta partida.');
            const gameData = gameSnap.data();
            const entryFee = gameData.entryFeeVES;
            const templateId = gameData.tournamentTemplateId;
            const maxPlayers = gameData.maxPlayers || DOMINO_CONSTANTS.MAX_PLAYERS;

            if (!entryFee || typeof entryFee !== 'number' || entryFee <= 0) throw new HttpsError('internal', 'Error al obtener tarifa de entrada de la partida.');
            if (!['waiting', 'full'].includes(gameData.status) || (gameData.status === 'full' && gameData.turnOrder?.length > 0)) {
                throw new HttpsError('failed-precondition', 'No puedes reembolsar una partida que ya ha comenzado.');
            }

            const updates = [];
            if (gameData.status === 'full' && gameData.countdownTaskId) {
                taskToCancel = gameData.countdownTaskId;
                updates.push({ ref: gameRef, data: { countdownTaskId: null, startCountdownAt: null, status: 'waiting' } });
            } else if (gameData.status === 'full') {
                 updates.push({ ref: gameRef, data: { status: 'waiting' } });
            }

            updates.push({ ref: userRef, data: { balance: FieldValue.increment(entryFee), activeDominoGames: FieldValue.arrayRemove({ gameId: gameId, templateId: templateId }) } });
            updates.push({ ref: playerRef, type: 'delete' });
            updates.push({ ref: gameRef, data: { prizePoolVES: FieldValue.increment(-entryFee), playerCount: FieldValue.increment(-1) } });

            updates.forEach(op => {
                if (op.type === 'delete') tx.delete(op.ref);
                else tx.update(op.ref, op.data);
            });
        });

        if (taskToCancel) await cancelTask(taskToCancel);

        return { success: true, message: 'Entrada reembolsada.' };
    } catch (error) {
        logger.error(`Error refunding entry for ${userId} in ${gameId}:`, error);
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', 'Error al procesar reembolso.', error.message);
    }
});

module.exports.handleReadyToggle = onCall({ region: REGION }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Auth required.');
    const { gameId } = request.data;
    if (!gameId) throw new HttpsError('invalid-argument', 'gameId required.');
    const userId = request.auth.uid;
    const gameRef = db.doc(`domino_tournament_games/${gameId}`);
    const playerRef = gameRef.collection('players').doc(userId);

    let startRoundResults = null;
    let countdownTaskIdToCancel = null;
    let startRoundNow = false;
    let firstTurnDuration = TURN_TIMEOUT_SECONDS;

    try {
        await db.runTransaction(async (tx) => {
            const gameSnap = await tx.get(gameRef);
            const playerSnap = await tx.get(playerRef);
            if (!gameSnap.exists || !playerSnap.exists) throw new HttpsError('not-found', 'Game or player not found.');
            const gameData = gameSnap.data();
            const playerData = playerSnap.data();
            const maxPlayers = gameData.maxPlayers || DOMINO_CONSTANTS.MAX_PLAYERS;

            if (gameData.status !== 'full') {
                 throw new HttpsError('failed-precondition', 'Solo puedes marcarte listo cuando la sala está llena.');
            }
            if (gameData.currentTurn) {
                throw new HttpsError('failed-precondition', 'La partida ya ha comenzado.');
            }

            const newReadyState = !playerData.isReady;
            let allReady = false;

            if (newReadyState) {
                 const playersSnap = await tx.get(gameRef.collection('players'));
                 allReady = playersSnap.docs.every(doc => (doc.id === userId ? newReadyState : doc.data().isReady));
                 if (playersSnap.size !== maxPlayers) {
                      allReady = false;
                 }
            }

            const updates = [];
            updates.push({ ref: playerRef, data: { isReady: newReadyState } });

            if (allReady) {
                 logger.info(`All players ready for game ${gameId}. Starting immediately.`);
                 startRoundNow = true;
                 countdownTaskIdToCancel = gameData.countdownTaskId;
                 startRoundResults = await startDominoRound(tx, gameRef);
                 if (startRoundResults.taskPayload) {
                      firstTurnDuration = startRoundResults.firstTurnDuration;
                      updates.push(...startRoundResults.updates);
                 } else {
                      logger.warn(`handleReadyToggle: startDominoRound failed preconditions for ${gameId}. Reverting start.`);
                      startRoundNow = false;
                 }
            }

            updates.forEach(op => {
                 if (op.type === 'set') tx.set(op.ref, op.data);
                 else tx.update(op.ref, op.data);
            });
        });

        if (countdownTaskIdToCancel) {
             await cancelTask(countdownTaskIdToCancel);
        }
        if (startRoundNow && startRoundResults?.taskPayload) {
             const turnTimerTaskId = await scheduleTask(startRoundResults.taskPayload, firstTurnDuration, TURN_TIMEOUT_TRIGGER_URL);
             await gameRef.update({ turnTimerTaskId: turnTimerTaskId });
        }

        return { success: true };

    } catch (error) {
        logger.error(`Error in handleReadyToggle for game ${gameId}, user ${userId}:`, error);
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', 'Failed to toggle ready status.', error.message);
    }
});

module.exports.playDominoTile = onCall({ region: REGION }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Auth required.');
    const { gameId, tile, position } = request.data;
    if (!gameId || !tile || !tile.hasOwnProperty('top') || !tile.hasOwnProperty('bottom') || !['start', 'end'].includes(position)) {
        throw new HttpsError('invalid-argument', 'Missing or invalid params.');
    }
    const userId = request.auth.uid;
    const gameRef = db.doc(`domino_tournament_games/${gameId}`);
    const playerRef = gameRef.collection('players').doc(userId);

    let roundOver = false;
    let gameOver = false;
    let taskToCancel = null;
    let taskToSchedule = null;
    let nextRoundTask = null;
    let nextTurnDuration = TURN_TIMEOUT_SECONDS;

    try {
        await db.runTransaction(async (tx) => {
            const gameSnap = await tx.get(gameRef);
            const playerSnap = await tx.get(playerRef);
            if (!gameSnap.exists || !playerSnap.exists) throw new HttpsError('not-found', 'Game or player not found.');
            const gameData = gameSnap.data();
            const playerData = playerSnap.data();

            if (gameData.status !== 'playing') throw new HttpsError('failed-precondition', 'Game not in progress.');
            if (gameData.currentTurn !== userId) throw new HttpsError('failed-precondition', 'Not your turn.');
            
            // (Petición 3a) Validar primera jugada 6/6
            const scores = gameData.scores || {};
            const isFirstRound = Object.values(scores).every(s => s === 0);
            if (isFirstRound && (gameData.board || []).length === 0) {
                const hasSixDouble = playerData.hand.some(t => t.top === 6 && t.bottom === 6);
                if (hasSixDouble && (tile.top !== 6 || tile.bottom !== 6)) {
                    throw new HttpsError('failed-precondition', 'Debes salir con el doble 6.');
                }
            }

            const tileIndexInHand = playerData.hand.findIndex(t => t?.top === tile.top && t?.bottom === tile.bottom);
            if (tileIndexInHand === -1) throw new HttpsError('invalid-argument', 'You do not have this tile.');
            const playedTile = playerData.hand[tileIndexInHand];
            const validMoves = getValidMoves(playerData.hand, gameData.board);
            const isValidMove = validMoves.some(m => m.tileIndex === tileIndexInHand && m.position === position);
            if (!isValidMove) throw new HttpsError('invalid-argument', 'Invalid move.');

            const { newBoard, newHand } = applyMove(gameData.board, playerData.hand, { tileIndex: tileIndexInHand, tile: playedTile, position });
            const roundWinnerId = newHand.length === 0 ? userId : null;
            let roundEndResults = null;

            const updates = [];
            updates.push({ ref: playerRef, data: { hand: newHand } });

            if (roundWinnerId) {
                roundOver = true;
                logger.info(`Player ${userId} won round in ${gameId}.`);
                const playersSnap = await tx.get(gameRef.collection('players'));
                const playersMap = {}; playersSnap.forEach(doc => { playersMap[doc.id] = { id: doc.id, ...doc.data()}; });
                playersMap[userId].hand = newHand;
                roundEndResults = await processRoundEnd(tx, gameRef, roundWinnerId, false, playersMap);
                updates.push(...roundEndResults.updates);

                const gameUpdateData = {
                    status: 'round_over', winner: roundWinnerId, board: newBoard,
                    currentTurn: null, turnTimerTaskId: null, turnStartTime: null,
                    turnTimeoutSeconds: null,
                    lastMove: { userId, tile: playedTile, position, timestamp: FieldValue.serverTimestamp() }, passCount: 0
                };
                updates.push({ ref: gameRef, data: gameUpdateData});

                if (roundEndResults.targetScoreReached) {
                    gameOver = true;
                    const gameEndResult = await processGameEnd(tx, gameRef, playersSnap, roundEndResults.newScores);
                    updates.push(...gameEndResult.updates);
                } else {
                     nextRoundTask = { gameId: gameId };
                }

            } else {
                const turnOrder = gameData.turnOrder;
                const currentIndex = turnOrder.indexOf(userId);
                // (Petición 3c) Turno anti-horario
                const nextIndex = (currentIndex - 1 + turnOrder.length) % turnOrder.length;
                const nextPlayerId = turnOrder[nextIndex];

                const nextPlayerRef = gameRef.collection('players').doc(nextPlayerId);
                const nextPlayerSnap = await tx.get(nextPlayerRef);
                const nextPlayerHand = nextPlayerSnap.exists ? nextPlayerSnap.data().hand : [];
                const nextPlayerMoves = getValidMoves(nextPlayerHand, newBoard);
                nextTurnDuration = nextPlayerMoves.length > 0 ? TURN_TIMEOUT_SECONDS : PASS_TIMEOUT_SECONDS;

                const gameUpdateData = {
                     board: newBoard, currentTurn: nextPlayerId,
                     turnStartTime: FieldValue.serverTimestamp(), turnTimerTaskId: null,
                     turnTimeoutSeconds: nextTurnDuration,
                     lastMove: { userId, tile: playedTile, position, timestamp: FieldValue.serverTimestamp() }, passCount: 0
                };
                updates.push({ ref: gameRef, data: gameUpdateData });
                taskToSchedule = { gameId: gameId, expectedPlayerId: nextPlayerId };
            }

            taskToCancel = gameData.turnTimerTaskId;

            updates.forEach(op => {
                 if (op.type === 'set') tx.set(op.ref, op.data);
                 else tx.update(op.ref, op.data);
            });
        });

        if (taskToCancel) await cancelTask(taskToCancel);
        if (taskToSchedule) {
             const nextTurnTimerTaskId = await scheduleTask(taskToSchedule, nextTurnDuration, TURN_TIMEOUT_TRIGGER_URL);
             const currentStatus = (await gameRef.get()).data()?.status;
             if (currentStatus === 'playing') {
                await gameRef.update({ turnTimerTaskId: nextTurnTimerTaskId });
             } else if (nextTurnTimerTaskId) {
                logger.info(`Game ${gameId} status changed, cancelling task ${nextTurnTimerTaskId}`);
                await cancelTask(nextTurnTimerTaskId);
             }
        }
        if (nextRoundTask) {
             await scheduleTask(nextRoundTask, NEXT_ROUND_DELAY_SECONDS, START_GAME_TRIGGER_URL);
        }

        return { success: true, roundOver: roundOver, gameOver: gameOver };

    } catch (error) {
        logger.error(`Error in playDominoTile for game ${gameId}, user ${userId}:`, error);
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', 'Failed to play tile.', error.message);
    }
});

module.exports.passDominoTurn = onCall({ region: REGION }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Auth required.');
    const { gameId } = request.data;
    if (!gameId) throw new HttpsError('invalid-argument', 'gameId required.');
    const userId = request.auth.uid;
    const gameRef = db.doc(`domino_tournament_games/${gameId}`);

    // (Petición 4) Add log
    logger.info(`[passDominoTurn] User ${userId} attempting to pass turn for game ${gameId}.`);

    let isTranque = false;
    let gameOver = false;
    let taskToCancel = null;
    let taskToSchedule = null;
    let nextRoundTask = null;
    let nextTurnDuration = TURN_TIMEOUT_SECONDS;
    let maxPlayers = DOMINO_CONSTANTS.MAX_PLAYERS;

    try {
        await db.runTransaction(async (tx) => {
            const gameSnap = await tx.get(gameRef);
            const playerSnap = await tx.get(gameRef.collection('players').doc(userId));
            if (!gameSnap.exists || !playerSnap.exists) throw new HttpsError('not-found', 'Game or player not found.');
            const gameData = gameSnap.data();
            const playerData = playerSnap.data();
            maxPlayers = gameData.maxPlayers || DOMINO_CONSTANTS.MAX_PLAYERS;

            if (gameData.status !== 'playing') throw new HttpsError('failed-precondition', 'Game not in progress.');
            if (gameData.currentTurn !== userId) throw new HttpsError('failed-precondition', 'Not your turn.');
            
            // (Petición 3a) No se puede pasar si es la primera jugada 6/6
            const scores = gameData.scores || {};
            const isFirstRound = Object.values(scores).every(s => s === 0);
            if (isFirstRound && (gameData.board || []).length === 0) {
                const hasSixDouble = playerData.hand.some(t => t.top === 6 && t.bottom === 6);
                if (hasSixDouble) {
                    throw new HttpsError('failed-precondition', 'No puedes pasar, debes salir con el doble 6.');
                }
            }

            const validMoves = getValidMoves(playerData.hand, gameData.board);
            if (validMoves.length > 0) throw new HttpsError('failed-precondition', 'You have valid moves, cannot pass.');

            const turnOrder = gameData.turnOrder;
            const currentIndex = turnOrder.indexOf(userId);
            // (Petición 3c) Turno anti-horario
            const nextIndex = (currentIndex - 1 + turnOrder.length) % turnOrder.length;
            const nextPlayerId = turnOrder[nextIndex];
            const currentPassCount = (gameData.passCount || 0) + 1;
            let roundEndResults = null;

            const updates = [];

            let canAnyonePlay = false;
            const allPlayersSnap = await tx.get(gameRef.collection('players'));
            for(const playerDoc of allPlayersSnap.docs) {
                if(playerDoc.id !== userId) {
                    const otherPlayerHand = playerDoc.data().hand || [];
                    const otherPlayerMoves = getValidMoves(otherPlayerHand, gameData.board);
                    if(otherPlayerMoves.length > 0) {
                        canAnyonePlay = true;
                        break;
                    }
                }
            }

            if (!canAnyonePlay) {
                 isTranque = true;
                 logger.info(`Tranque INMEDIATO detectado en ${gameId} on pass attempt by ${userId}.`);
                 const playersMap = {};
                 allPlayersSnap.forEach(doc => { playersMap[doc.id] = { id: doc.id, ...doc.data() }; });

                 roundEndResults = await processRoundEnd(tx, gameRef, null, true, playersMap);
                 updates.push(...roundEndResults.updates);

                 const gameUpdateData = {
                     status: 'round_over', winner: null, currentTurn: null,
                     turnTimerTaskId: null, turnStartTime: null,
                     turnTimeoutSeconds: null,
                     lastMove: { userId, action: 'pass_tranque_immediate', timestamp: FieldValue.serverTimestamp() },
                     passCount: currentPassCount
                 };
                 updates.push({ ref: gameRef, data: gameUpdateData});

                 if (roundEndResults.targetScoreReached) {
                     gameOver = true;
                     const gameEndResult = await processGameEnd(tx, gameRef, allPlayersSnap, roundEndResults.newScores);
                     updates.push(...gameEndResult.updates);
                 } else {
                      nextRoundTask = { gameId: gameId };
                 }

            } else {
                // (Petición 4) Lógica de tranque consecutivo (ya estaba correcta)
                // Comprobar tranque por pases consecutivos
                if (currentPassCount >= maxPlayers) {
                    logger.info(`Tranque CONSECUTIVO detectado en ${gameId} on pass by ${userId}. Pass count: ${currentPassCount}`);
                    isTranque = true;
                    const playersMap = {};
                    allPlayersSnap.forEach(doc => { playersMap[doc.id] = { id: doc.id, ...doc.data() }; });
                    
                    roundEndResults = await processRoundEnd(tx, gameRef, null, true, playersMap);
                    updates.push(...roundEndResults.updates);

                    const gameUpdateData = {
                        status: 'round_over', winner: null, currentTurn: null,
                        turnTimerTaskId: null, turnStartTime: null,
                        turnTimeoutSeconds: null,
                        lastMove: { userId, action: 'pass_tranque_consecutive', timestamp: FieldValue.serverTimestamp() },
                        passCount: currentPassCount
                    };
                    updates.push({ ref: gameRef, data: gameUpdateData});

                    if (roundEndResults.targetScoreReached) {
                        gameOver = true;
                        const gameEndResult = await processGameEnd(tx, gameRef, allPlayersSnap, roundEndResults.newScores);
                        updates.push(...gameEndResult.updates);
                    } else {
                        nextRoundTask = { gameId: gameId };
                    }
                } else {
                    // Lógica original: pasar el turno
                    // (Petición 4) Add log for normal pass
                    logger.info(`[passDominoTurn] Normal pass. Pass count: ${currentPassCount}. Next player: ${nextPlayerId}.`);
                    const nextPlayerRef = gameRef.collection('players').doc(nextPlayerId);
                    const nextPlayerSnap = await tx.get(nextPlayerRef);
                    const nextPlayerHand = nextPlayerSnap.exists ? nextPlayerSnap.data().hand : [];
                    const nextPlayerMoves = getValidMoves(nextPlayerHand, gameData.board);
                    nextTurnDuration = nextPlayerMoves.length > 0 ? TURN_TIMEOUT_SECONDS : PASS_TIMEOUT_SECONDS;

                    const gameUpdateData = {
                        currentTurn: nextPlayerId, turnStartTime: FieldValue.serverTimestamp(),
                        turnTimerTaskId: null,
                        turnTimeoutSeconds: nextTurnDuration,
                        lastMove: { userId, action: 'pass', timestamp: FieldValue.serverTimestamp() },
                        passCount: currentPassCount
                    };
                    updates.push({ ref: gameRef, data: gameUpdateData });
                    taskToSchedule = { gameId: gameId, expectedPlayerId: nextPlayerId };
                }
            }

            taskToCancel = gameData.turnTimerTaskId;

            updates.forEach(op => {
                 if (op.type === 'set') tx.set(op.ref, op.data);
                 else if (op.type === 'delete') tx.delete(op.ref);
                 else tx.update(op.ref, op.data);
            });
        });

        if (taskToCancel) await cancelTask(taskToCancel);
        if (taskToSchedule) {
             const nextTurnTimerTaskId = await scheduleTask(taskToSchedule, nextTurnDuration, TURN_TIMEOUT_TRIGGER_URL);
             const currentStatus = (await gameRef.get()).data()?.status;
             if (currentStatus === 'playing') {
                await gameRef.update({ turnTimerTaskId: nextTurnTimerTaskId });
             } else if (nextTurnTimerTaskId) {
                 logger.info(`Game ${gameId} status changed during pass, cancelling task ${nextTurnTimerTaskId}`);
                 await cancelTask(nextTurnTimerTaskId);
             }
        }
        if (nextRoundTask) {
             await scheduleTask(nextRoundTask, NEXT_ROUND_DELAY_SECONDS, START_GAME_TRIGGER_URL);
        }

        return { success: true, tranque: isTranque, gameOver: gameOver };

    } catch (error) {
        logger.error(`Error in passDominoTurn for game ${gameId}, user ${userId}:`, error);
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', 'Failed to pass turn.', error.message);
    }
});

module.exports.sendDominoMessage = onCall({ region: REGION }, async (request) => {
     if (!request.auth) throw new HttpsError('unauthenticated', 'Debes iniciar sesión para enviar un mensaje.');
    const { gameId, text } = request.data;
    if (!gameId || !text || typeof text !== 'string' || text.trim().length === 0 || text.length > 200) {
        throw new HttpsError('invalid-argument', 'El mensaje no es válido.');
    }
    const uid = request.auth.uid;
    try {
        const userSnap = await db.doc(`users/${uid}`).get();
        if (!userSnap.exists) throw new HttpsError('not-found', 'Usuario no encontrado.');
        const username = userSnap.data().username || 'Jugador';
        const playerRef = db.doc(`domino_tournament_games/${gameId}/players/${uid}`);
        const playerSnap = await playerRef.get();
        if (!playerSnap.exists) {
             // (Petición 4) Permitir espectadores
             // const gameSnap = await db.doc(`domino_tournament_games/${gameId}`).get();
             // if (!gameSnap.exists) {
                throw new HttpsError('permission-denied', 'No eres parte de esta partida.');
             // }
        }

        const chatRef = db.collection('domino_chat').doc(gameId).collection('messages');
        await chatRef.add({
            userId: uid, username: username, text: text.trim(), timestamp: FieldValue.serverTimestamp()
        });

        const snapshot = await chatRef.orderBy('timestamp', 'desc').limit(50).get();
        if (snapshot.size > 20) {
            const batch = db.batch();
            snapshot.docs.slice(20).forEach(doc => batch.delete(doc.ref));
            await batch.commit();
        }
        return { success: true };
    } catch (error) {
        logger.error(`Error sending domino message for user ${uid}, game ${gameId}:`, error);
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', 'Error al enviar mensaje.', error.message);
    }
});

module.exports.deleteTournamentTemplate = onCall({ region: REGION }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Autenticación requerida.');
    const adminSnap = await db.doc(`users/${request.auth.uid}`).get();
    if (!adminSnap.exists || adminSnap.data().role !== 'admin') throw new HttpsError('permission-denied', 'Admin required.');
    const { templateId } = request.data;
    if (!templateId) throw new HttpsError('invalid-argument', 'templateId required.');
    logger.info(`Admin ${request.auth.uid} initiating deletion of template ${templateId}`);
    try {
        const templateRef = db.doc(`domino_tournaments/${templateId}`);
        const gamesQuery = db.collection('domino_tournament_games').where('tournamentTemplateId', '==', templateId);
        const gamesSnap = await gamesQuery.get();
        const deletePromises = []; const batchSize = 50;
        for (const gameDoc of gamesSnap.docs) {
             logger.warn(`Deleting game ${gameDoc.id} associated with template ${templateId}`);
             const gameData = gameDoc.data();
             if (gameData.countdownTaskId) deletePromises.push(cancelTask(gameData.countdownTaskId));
             if (gameData.turnTimerTaskId) deletePromises.push(cancelTask(gameData.turnTimerTaskId));
             deletePromises.push(deleteCollection(`domino_tournament_games/${gameDoc.id}/players`, batchSize));
             deletePromises.push(deleteCollection(`domino_chat/${gameDoc.id}/messages`, batchSize));
             deletePromises.push(db.doc(`domino_payouts/${gameDoc.id}`).delete().catch(()=>{ logger.warn(`Payout doc for ${gameDoc.id} not found, skipping.`);}));
             deletePromises.push(gameDoc.ref.delete());
        }
        await Promise.all(deletePromises);
        await templateRef.delete();
        logger.info(`Deletion of template ${templateId} completed.`);
        return { success: true, message: 'Template and associated games deleted.' };
    } catch (error) {
        logger.error(`Error deleting template ${templateId}:`, error);
        throw new HttpsError('internal', 'Error occurred during deletion.', error.message);
    }
});

module.exports.startGameTrigger = onRequest({ region: REGION, secrets: [] }, async (req, res) => {
     try {
         const { gameId } = req.body;
         if (!gameId) { logger.error("startGameTrigger missing gameId."); res.status(400).send("Bad Request: gameId missing."); return; }
         const gameRef = db.doc(`domino_tournament_games/${gameId}`);

         let startRoundResults = null;
         let countdownTaskIdToCancel = null;
         let firstTurnDuration = TURN_TIMEOUT_SECONDS;

         await db.runTransaction(async (tx) => {
              const gameSnap = await tx.get(gameRef);
              if (!gameSnap.exists) { logger.warn(`startGameTrigger: Game ${gameId} not found.`); return; }
              const gameData = gameSnap.data();
              const maxPlayers = gameData.maxPlayers || DOMINO_CONSTANTS.MAX_PLAYERS;

              let canStart = false;
              if (gameData.status === 'round_over') {
                   canStart = true;
              } else if (gameData.status === 'full') {
                   const playersSnap = await tx.get(gameRef.collection('players'));
                   if (playersSnap.size === maxPlayers) {
                        logger.info(`startGameTrigger: 60s timer elapsed for game ${gameId}. Forcing start.`);
                        canStart = true;
                        countdownTaskIdToCancel = gameData.countdownTaskId;
                   } else {
                        logger.warn(`startGameTrigger: Cannot start ${gameId}, expected ${maxPlayers} players but found ${playersSnap.size}. Aborting start.`);
                        if (gameData.countdownTaskId) {
                            countdownTaskIdToCancel = gameData.countdownTaskId;
                        }
                        tx.update(gameRef, { status: 'waiting', startCountdownAt: null, countdownTaskId: null });
                        canStart = false;
                   }
              }

              if (canStart) {
                   logger.info(`startGameTrigger: Starting/Restarting round for ${gameId}.`);
                   startRoundResults = await startDominoRound(tx, gameRef);
                   if(startRoundResults.taskPayload) {
                      firstTurnDuration = startRoundResults.firstTurnDuration;
                      startRoundResults.updates.forEach(op => {
                           if (op.type === 'set') tx.set(op.ref, op.data);
                           else tx.update(op.ref, op.data);
                      });
                   } else {
                      logger.warn(`startGameTrigger: startDominoRound failed preconditions for ${gameId}. Game might not start.`);
                      startRoundResults = null;
                   }
              } else {
                   logger.info(`startGameTrigger: Game ${gameId} not in state to start (status: ${gameData.status}). Task might be outdated or conditions not met.`);
              }
         });

         if (countdownTaskIdToCancel) await cancelTask(countdownTaskIdToCancel);
         if (startRoundResults?.taskPayload) {
              const turnTimerTaskId = await scheduleTask(startRoundResults.taskPayload, firstTurnDuration, TURN_TIMEOUT_TRIGGER_URL);
              const currentStatus = (await gameRef.get()).data()?.status;
              if (currentStatus === 'playing') {
                   await gameRef.update({ turnTimerTaskId: turnTimerTaskId });
              } else if (turnTimerTaskId) {
                   logger.warn(`Game ${gameId} status is ${currentStatus}, cancelling scheduled turn task ${turnTimerTaskId}`);
                   await cancelTask(turnTimerTaskId);
              }
         }

         res.status(200).send("OK");
     } catch (error) {
         logger.error("Error in startGameTrigger:", error);
         let statusCode = 500;
         if (error instanceof HttpsError) {
             switch (error.code) {
                 case 'not-found': statusCode = 404; break;
                 case 'permission-denied': statusCode = 403; break;
                 case 'invalid-argument': statusCode = 400; break;
                 case 'failed-precondition': statusCode = 412; break;
                 default: statusCode = 500;
             }
         } else if (error.code && error.httpErrorCode?.status) {
             statusCode = error.httpErrorCode.status;
         }
         res.status(statusCode).send(error.message || "Internal Server Error");
     }
});


module.exports.turnTimeoutTrigger = onRequest({ region: REGION, secrets: [] }, async (req, res) => {
     try {
         const { gameId, expectedPlayerId } = req.body;
         if (!gameId || !expectedPlayerId) { logger.error("turnTimeoutTrigger missing params."); res.status(400).send("Bad Request: Missing params."); return; }
         const gameRef = db.doc(`domino_tournament_games/${gameId}`);

         let isTranque = false;
         let roundOver = false;
         let gameOver = false;
         let taskToSchedule = null;
         let nextRoundTask = null;
         let nextTurnDuration = TURN_TIMEOUT_SECONDS;
         let maxPlayers = DOMINO_CONSTANTS.MAX_PLAYERS;

         await db.runTransaction(async (tx) => {
              const gameSnap = await tx.get(gameRef);
              const playerRef = gameRef.collection('players').doc(expectedPlayerId);
              const playerSnap = await tx.get(playerRef);

              if (!gameSnap.exists || !playerSnap.exists) { logger.warn(`turnTimeoutTrigger: Game ${gameId} or Player ${expectedPlayerId} not found.`); return; }
              const gameData = gameSnap.data();
              const playerData = playerSnap.data();
              maxPlayers = gameData.maxPlayers || DOMINO_CONSTANTS.MAX_PLAYERS;

              if (gameData.status !== 'playing' || gameData.currentTurn !== expectedPlayerId) {
                   logger.info(`turnTimeoutTrigger: Timeout for ${expectedPlayerId} irrelevant in ${gameId} (status: ${gameData.status}, current: ${gameData.currentTurn}). Task outdated.`); return;
              }
              logger.info(`turnTimeoutTrigger: Processing timeout for ${expectedPlayerId} in ${gameId}.`);
              
              // (Petición 3a) Validar auto-pase de 6/6
              const scores = gameData.scores || {};
              const isFirstRound = Object.values(scores).every(s => s === 0);
              if (isFirstRound && (gameData.board || []).length === 0) {
                  const hasSixDouble = playerData.hand.some(t => t.top === 6 && t.bottom === 6);
                  if (hasSixDouble) {
                       // Tiene 6/6, no puede pasar. Debe auto-jugarlo.
                       logger.info(`Player ${expectedPlayerId} timed out but has 6/6. Auto-playing.`);
                       // Forzar auto-juego del 6/6 (la lógica de "Auto-Jugar" más abajo lo manejará)
                  }
              }

              const validMoves = getValidMoves(playerData.hand, gameData.board);

              const updates = [];
              let roundEndResults = null;

              if (validMoves.length === 0) { // Auto-Pasar
                   logger.info(`Player ${expectedPlayerId} auto-passing via timeout.`);
                   const turnOrder = gameData.turnOrder; 
                   const currentIndex = turnOrder.indexOf(expectedPlayerId); 
                   // (Petición 3c) Turno anti-horario
                   const nextIndex = (currentIndex - 1 + turnOrder.length) % turnOrder.length; 
                   const nextPlayerId = turnOrder[nextIndex];
                   const currentPassCount = (gameData.passCount || 0) + 1;

                   let canAnyonePlay = false;
                   const allPlayersSnap = await tx.get(gameRef.collection('players'));
                   for(const playerDoc of allPlayersSnap.docs) {
                        if(playerDoc.id !== expectedPlayerId) {
                            const otherPlayerHand = playerDoc.data().hand || [];
                            const otherPlayerMoves = getValidMoves(otherPlayerHand, gameData.board);
                            if(otherPlayerMoves.length > 0) {
                                canAnyonePlay = true;
                                break;
                            }
                        }
                   }

                   if (!canAnyonePlay) { // ¡Tranque detectado por auto-pase!
                        isTranque = true; roundOver = true;
                        logger.info(`Tranque INMEDIATO detectado via timeout/auto-pass in ${gameId}.`);
                        const playersMap = {};
                        allPlayersSnap.forEach(doc => { playersMap[doc.id] = { id: doc.id, ...doc.data() }; });
                        roundEndResults = await processRoundEnd(tx, gameRef, null, true, playersMap);
                        updates.push(...roundEndResults.updates);

                        const gameUpdateData = { status: 'round_over', winner: null, currentTurn: null, turnTimerTaskId: null, turnStartTime: null, turnTimeoutSeconds: null, lastMove: { userId: expectedPlayerId, action: 'auto-pass-tranque', timestamp: FieldValue.serverTimestamp() }, passCount: currentPassCount };
                        updates.push({ ref: gameRef, data: gameUpdateData });

                        if (roundEndResults.targetScoreReached) {
                             gameOver = true;
                             const gameEndResult = await processGameEnd(tx, gameRef, allPlayersSnap, roundEndResults.newScores);
                             updates.push(...gameEndResult.updates);
                        } else {
                              nextRoundTask = { gameId: gameId };
                        }
                   } else { 
                        // (Petición 4) Lógica de tranque consecutivo (ya estaba correcta)
                        // Comprobar tranque por pases consecutivos
                        if (currentPassCount >= maxPlayers) {
                            logger.info(`Tranque CONSECUTIVO detectado via timeout in ${gameId}. Pass count: ${currentPassCount}`);
                            isTranque = true; roundOver = true;
                            const playersMap = {};
                            allPlayersSnap.forEach(doc => { playersMap[doc.id] = { id: doc.id, ...doc.data() }; });
                            
                            roundEndResults = await processRoundEnd(tx, gameRef, null, true, playersMap);
                            updates.push(...roundEndResults.updates);

                            const gameUpdateData = { status: 'round_over', winner: null, currentTurn: null, turnTimerTaskId: null, turnStartTime: null, turnTimeoutSeconds: null, lastMove: { userId: expectedPlayerId, action: 'auto-pass-tranque-consecutive', timestamp: FieldValue.serverTimestamp() }, passCount: currentPassCount };
                            updates.push({ ref: gameRef, data: gameUpdateData });

                            if (roundEndResults.targetScoreReached) {
                                gameOver = true;
                                const gameEndResult = await processGameEnd(tx, gameRef, allPlayersSnap, roundEndResults.newScores);
                                updates.push(...gameEndResult.updates);
                            } else {
                                nextRoundTask = { gameId: gameId };
                            }
                        } else {
                            // Lógica original: No hay tranque inmediato, pasar turno normalmente
                            const nextPlayerRef = gameRef.collection('players').doc(nextPlayerId);
                            const nextPlayerSnap = await tx.get(nextPlayerRef);
                            const nextPlayerHand = nextPlayerSnap.exists ? nextPlayerSnap.data().hand : [];
                            const nextPlayerMoves = getValidMoves(nextPlayerHand, gameData.board);
                            nextTurnDuration = nextPlayerMoves.length > 0 ? TURN_TIMEOUT_SECONDS : PASS_TIMEOUT_SECONDS;

                            const gameUpdateData = { currentTurn: nextPlayerId, turnStartTime: FieldValue.serverTimestamp(), turnTimerTaskId: null, turnTimeoutSeconds: nextTurnDuration, lastMove: { userId: expectedPlayerId, action: 'auto-pass', timestamp: FieldValue.serverTimestamp() }, passCount: currentPassCount };
                            updates.push({ ref: gameRef, data: gameUpdateData });
                            taskToSchedule = { gameId: gameId, expectedPlayerId: nextPlayerId };
                        }
                   }
              } else { // Auto-Jugar
                   let randomMove;
                   // (Petición 3a) Forzar 6/6 si es la primera jugada
                   if (isFirstRound && (gameData.board || []).length === 0) {
                        const sixDoubleMove = validMoves.find(m => m.tile.top === 6 && m.tile.bottom === 6);
                        if (sixDoubleMove) {
                            logger.info(`Auto-playing 6/6 for ${expectedPlayerId} via timeout.`);
                            randomMove = sixDoubleMove;
                        }
                   }
                   
                   if (!randomMove) {
                       randomMove = validMoves[Math.floor(Math.random() * validMoves.length)];
                       logger.info(`Auto-playing for ${expectedPlayerId} via timeout: Tile ${JSON.stringify(randomMove.tile)} at ${randomMove.position}`);
                   }
                   
                   const tileIndexInHand = playerData.hand.findIndex(t => t?.top === randomMove.tile.top && t?.bottom === randomMove.tile.bottom);
                   if (tileIndexInHand === -1) {
                        logger.error(`Could not find random move tile in player's hand during auto-play for ${expectedPlayerId}`);
                        const turnOrder = gameData.turnOrder; 
                        const currentIndex = turnOrder.indexOf(expectedPlayerId); 
                        // (Petición 3c) Turno anti-horario
                        const nextIndex = (currentIndex - 1 + turnOrder.length) % turnOrder.length; 
                        const nextPlayerId = turnOrder[nextIndex]; 
                        const currentPassCount = (gameData.passCount || 0) + 1;
                        const nextPlayerRef = gameRef.collection('players').doc(nextPlayerId); const nextPlayerSnap = await tx.get(nextPlayerRef); const nextPlayerHand = nextPlayerSnap.exists ? nextPlayerSnap.data().hand : []; const nextPlayerMoves = getValidMoves(nextPlayerHand, gameData.board); nextTurnDuration = nextPlayerMoves.length > 0 ? TURN_TIMEOUT_SECONDS : PASS_TIMEOUT_SECONDS;
                        const gameUpdateData = { currentTurn: nextPlayerId, turnStartTime: FieldValue.serverTimestamp(), turnTimerTaskId: null, turnTimeoutSeconds: nextTurnDuration, lastMove: { userId: expectedPlayerId, action: 'auto-pass-forced', timestamp: FieldValue.serverTimestamp() }, passCount: currentPassCount };
                        updates.push({ ref: gameRef, data: gameUpdateData });
                        taskToSchedule = { gameId: gameId, expectedPlayerId: nextPlayerId };

                   } else {
                       const { newBoard, newHand } = applyMove(gameData.board, playerData.hand, { ...randomMove, tileIndex: tileIndexInHand });
                       updates.push({ ref: playerSnap.ref, data: { hand: newHand } });

                       const roundWinnerId = newHand.length === 0 ? expectedPlayerId : null;
                       if (roundWinnerId) {
                            roundOver = true;
                            logger.info(`Player ${expectedPlayerId} won via auto-play timeout in ${gameId}.`);
                            const allPlayersSnap = await tx.get(gameRef.collection('players'));
                            const playersMap = {}; allPlayersSnap.forEach(doc => { playersMap[doc.id] = { id: doc.id, ...doc.data()}; });
                            playersMap[expectedPlayerId].hand = newHand;
                            roundEndResults = await processRoundEnd(tx, gameRef, roundWinnerId, false, playersMap);
                            updates.push(...roundEndResults.updates);

                            const gameUpdateData = { status: 'round_over', winner: roundWinnerId, board: newBoard, currentTurn: null, turnTimerTaskId: null, turnStartTime: null, turnTimeoutSeconds: null, lastMove: { userId: expectedPlayerId, tile: randomMove.tile, position: randomMove.position, action: 'auto-play-win', timestamp: FieldValue.serverTimestamp() }, passCount: 0 };
                            updates.push({ ref: gameRef, data: gameUpdateData });

                            if (roundEndResults.targetScoreReached) {
                                 gameOver = true;
                                 const gameEndResult = await processGameEnd(tx, gameRef, allPlayersSnap, roundEndResults.newScores);
                                 updates.push(...gameEndResult.updates);
                            } else {
                                  nextRoundTask = { gameId: gameId };
                            }
                       } else {
                            const turnOrder = gameData.turnOrder; 
                            const currentIndex = turnOrder.indexOf(expectedPlayerId); 
                            // (Petición 3c) Turno anti-horario
                            const nextIndex = (currentIndex - 1 + turnOrder.length) % turnOrder.length; 
                            const nextPlayerId = turnOrder[nextIndex];

                            const nextPlayerRef = gameRef.collection('players').doc(nextPlayerId);
                            const nextPlayerSnap = await tx.get(nextPlayerRef);
                            const nextPlayerHand = nextPlayerSnap.exists ? nextPlayerSnap.data().hand : [];
                            const nextPlayerMoves = getValidMoves(nextPlayerHand, newBoard);
                            nextTurnDuration = nextPlayerMoves.length > 0 ? TURN_TIMEOUT_SECONDS : PASS_TIMEOUT_SECONDS;

                            const gameUpdateData = { board: newBoard, currentTurn: nextPlayerId, turnStartTime: FieldValue.serverTimestamp(), turnTimerTaskId: null, turnTimeoutSeconds: nextTurnDuration, lastMove: { userId: expectedPlayerId, tile: randomMove.tile, position: randomMove.position, action: 'auto-play', timestamp: FieldValue.serverTimestamp() }, passCount: 0 };
                            updates.push({ ref: gameRef, data: gameUpdateData });
                            taskToSchedule = { gameId: gameId, expectedPlayerId: nextPlayerId };
                       }
                   }
              }

              updates.forEach(op => {
                   if (op.type === 'set') tx.set(op.ref, op.data);
                   else if (op.type === 'delete') tx.delete(op.ref);
                   else tx.update(op.ref, op.data);
              });
         });

         if (taskToSchedule) {
              const nextTurnTimerTaskId = await scheduleTask(taskToSchedule, nextTurnDuration, TURN_TIMEOUT_TRIGGER_URL);
              const currentStatus = (await gameRef.get()).data()?.status;
              if (currentStatus === 'playing') {
                   await gameRef.update({ turnTimerTaskId: nextTurnTimerTaskId });
              } else if (nextTurnTimerTaskId) {
                   logger.info(`Game ${gameId} status changed during timeout trigger, cancelling task ${nextTurnTimerTaskId}`);
                   await cancelTask(nextTurnTimerTaskId);
              }
         }
         if (nextRoundTask) {
              await scheduleTask(nextRoundTask, NEXT_ROUND_DELAY_SECONDS, START_GAME_TRIGGER_URL);
         }

         res.status(200).send("OK");
     } catch (error) {
         logger.error("Error in turnTimeoutTrigger:", error);
         let statusCode = 500;
         if (error instanceof HttpsError) {
             switch (error.code) {
                 case 'not-found': statusCode = 404; break;
                 case 'permission-denied': statusCode = 403; break;
                 case 'invalid-argument': statusCode = 400; break;
                 case 'failed-precondition': statusCode = 412; break;
                 default: statusCode = 500;
             }
         } else if (error.code && error.httpErrorCode?.status) {
             statusCode = error.httpErrorCode.status;
         }
         res.status(statusCode).send(error.message || "Internal Server Error");
     }
});

async function deleteCollection(collectionPath, batchSize) {
    const collectionRef = db.collection(collectionPath);
    const query = collectionRef.orderBy('__name__').limit(batchSize);
    return new Promise((resolve, reject) => {
        deleteQueryBatch(query, resolve).catch(reject);
    });
}
async function deleteQueryBatch(query, resolve) {
    const snapshot = await query.get();
    if (snapshot.size === 0) {
        return resolve();
    }
    const batch = db.batch();
    snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
    });
    await batch.commit();
    process.nextTick(() => {
        deleteQueryBatch(query, resolve);
    });
}