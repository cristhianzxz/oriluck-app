const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

/**
 * Normaliza un array de números de cartón a una matriz de 25 elementos.
 * @param {Array} cardNumbers El array de números del cartón.
 * @return {Array} Un array plano de 24 o 25 números.
 */
function getFlatCardNumbers(cardNumbers) {
  if (!Array.isArray(cardNumbers)) return [];
  // Si ya es un array plano de 25, lo usamos
  if (cardNumbers.length === 25 && !Array.isArray(cardNumbers[0])) {
    return cardNumbers.filter((n) => n !== "FREE");
  }
  // Si es una matriz de 5x5, la aplanamos
  if (cardNumbers.length === 5 && Array.isArray(cardNumbers[0])) {
    return cardNumbers.flat().filter((n) => n !== "FREE");
  }
  return [];
}

exports.checkBingoWinner = functions.region("southamerica-east1").firestore
    .document("bingoTournaments/{tournamentId}")
    .onUpdate(async (change, _context) => {
      const beforeData = change.before.data();
      const afterData = change.after.data();

      // 1. Salir si no se agregaron números o si el juego ya terminó.
      if (
        afterData.status !== "active" ||
        (beforeData.calledNumbers.length === afterData.calledNumbers.length)
      ) {
        return null;
      }

      const calledNumbers = afterData.calledNumbers;
      const soldCards = afterData.soldCards || {};
      const potentialWinners = [];

      // 2. Revisar todos los cartones vendidos.
      for (const cardKey in soldCards) {
        if (Object.prototype.hasOwnProperty.call(soldCards, cardKey)) {
          const cardData = soldCards[cardKey];
          const cardNumbers = getFlatCardNumbers(cardData.cardNumbers);

          // Verificar si todos los números del cartón han sido cantados (Blackout)
          const isWinner = cardNumbers.every((num) => calledNumbers.includes(num));

          if (isWinner) {
            // Agrupamos por usuario para manejar múltiples cartones ganadores por persona
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

      // 3. Si se encontraron ganadores, finalizar el torneo.
      if (potentialWinners.length > 0) {
        const totalPrize =
          (Object.keys(soldCards).length * (afterData.pricePerCard || 100)) * 0.7;
        const prizePerWinner = totalPrize / potentialWinners.length;

        const finalWinners = potentialWinners.map((w) => ({
          ...w,
          prizeAmount: prizePerWinner,
        }));

        // Actualizar el documento del torneo con los ganadores y el estado.
        return change.after.ref.update({
          status: "finished",
          winners: finalWinners,
        });
      }

      return null;
    });