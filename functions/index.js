const { onCall, HttpsError, onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { logger } = require("firebase-functions");
const crypto = require('crypto');
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();
const REGION = "southamerica-east1";
const sleep = (ms) => new Promise(res => setTimeout(res, ms));

module.exports.db = db;
module.exports.logger = logger;
module.exports.onCall = onCall;
module.exports.HttpsError = HttpsError;
module.exports.onRequest = onRequest;
module.exports.onSchedule = onSchedule;
module.exports.FieldValue = FieldValue;
module.exports.crypto = crypto;
module.exports.REGION = REGION;
module.exports.sleep = sleep;

const { startManualBingo, checkAutoStartBingo, processBingoTurn, buyBingoCard_bingo, toggleBingoAutoStart } = require('./bingoEngine');
const { buySlotsChipsCallable, requestSlotSpin, executeSlotSpin, slotsJackpotProcessor } = require('./slotsEngine');
const { processCrashRound, startCrashEngineLoop, toggleCrashEngine, updateCrashLimits, placeBet_crash, updateAutoCashout_crash, cashOut_crash, cancelBet_crash, sendChatMessage } = require('./crashEngine');

Object.assign(module.exports, {
  startManualBingo,
  checkAutoStartBingo,
  processBingoTurn,
  buyBingoCard_bingo,
  toggleBingoAutoStart,
  buySlotsChipsCallable,
  requestSlotSpin,
  executeSlotSpin,
  slotsJackpotProcessor,
  processCrashRound,
  startCrashEngineLoop,
  toggleCrashEngine,
  updateCrashLimits,
  placeBet_crash,
  updateAutoCashout_crash,
  cashOut_crash,
  cancelBet_crash,
  sendChatMessage
});