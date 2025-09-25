const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

/**
 * Normaliza un array de números de cartón a una matriz de 25 elementos.
 * @param {Array} cardNumbers El array de números del cartón.
 * @return {Array} Un array plano de 24 o 25 números.
 */
function getFlatCardNumbers(cardNumbers) {
  if (!Array.isArray(cardNumbers)) return [];
  if (cardNumbers.length === 25 && !Array.isArray(cardNumbers[0])) {
    return cardNumbers.filter((n) => n !== "FREE");
  }
  if (cardNumbers.length === 5 && Array.isArray(cardNumbers[0])) {
    return cardNumbers.flat().filter((n) => n !== "FREE");
  }
  return [];
}

/**
 * [NUEVO] Función programada que se ejecuta cada 15 segundos.
 * Busca un torneo activo y saca una nueva bolita.
 */
exports.drawBingoNumber = functions
    .region("southamerica-east1")
    .pubsub.schedule("every 15 seconds")
    .onRun(async (_context) => {
      const activeTournaments = await db.collection("bingoTournaments")
          .where("status", "==", "active")
          .limit(1)
          .get();

      if (activeTournaments.empty) {
        return null;
      }

      const tournamentDoc = activeTournaments.docs[0];
      const tournamentData = tournamentDoc.data();
      const tournamentRef = tournamentDoc.ref;

      const BINGO_NUMBERS = Array.from({length: 75}, (_, i) => i + 1);
      const calledNumbers = tournamentData.calledNumbers || [];

      const availableNumbers = BINGO_NUMBERS.filter(
          (n) => !calledNumbers.includes(n),
      );

      if (availableNumbers.length === 0) {
        await tournamentRef.update({status: "finished", winners: []});
        return null;
      }

      const nextNumber = availableNumbers[
        Math.floor(Math.random() * availableNumbers.length)
      ];

      return tournamentRef.update({
        calledNumbers: [...calledNumbers, nextNumber],
        currentNumber: nextNumber,
      });
    });


/**
 * [MODIFICADO] Se activa cuando un torneo se actualiza.
 * Verifica si hay un ganador, distribuye premios y actualiza saldos.
 */
exports.checkBingoWinner = functions.region("southamerica-east1").firestore
    .document("bingoTournaments/{tournamentId}")
    .onUpdate(async (change, context) => {
      const beforeData = change.before.data();
      const afterData = change.after.data();
      const tournamentId = context.params.tournamentId;

      if (
        afterData.status !== "active" ||
        (beforeData.calledNumbers.length === afterData.calledNumbers.length)
      ) {
        return null;
      }

      const calledNumbers = afterData.calledNumbers;
      const soldCards = afterData.soldCards || {};
      const potentialWinners = [];

      for (const cardKey in soldCards) {
        if (Object.prototype.hasOwnProperty.call(soldCards, cardKey)) {
          const cardData = soldCards[cardKey];
          const cardNumbers = getFlatCardNumbers(cardData.cardNumbers);
          const isWinner = cardNumbers.every((num) => calledNumbers.includes(num));

          if (isWinner) {
            const existingWinner = potentialWinners.find((w) => w.userId === cardData.userId);
            const cardNumber = parseInt(cardKey.replace("carton_", ""), 10);
            if (existingWinner) {
              existingWinner.cards.push(cardNumber);
            } else {
              potentialWinners.push({
                userId: cardData.userId,
                userName: cardData.userName,
                cards: [cardNumber],
              });
            }
          }
        }
      }

      if (potentialWinners.length > 0) {
        const totalPot = (Object.keys(soldCards).length * (afterData.pricePerCard || 0));
        const totalPrize = totalPot * 0.7;
        const houseCut = totalPot * 0.3;
        const prizePerWinner = totalPrize / potentialWinners.length;

        const finalWinners = potentialWinners.map((w) => ({
          ...w,
          prizeAmount: prizePerWinner,
        }));

        return db.runTransaction(async (transaction) => {
          for (const winner of finalWinners) {
            const userRef = db.doc(`users/${winner.userId}`);
            transaction.update(userRef, {
              balance: admin.firestore.FieldValue.increment(prizePerWinner),
            });
          }

          const houseRef = db.doc("appSettings/main");
          transaction.update(houseRef, {
            houseWinnings: admin.firestore.FieldValue.increment(houseCut),
          });

          const tournamentRef = db.doc(`bingoTournaments/${tournamentId}`);
          transaction.update(tournamentRef, {
            status: "finished",
            winners: finalWinners,
          });
        });
      }

      return null;
    });