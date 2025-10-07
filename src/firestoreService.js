import { doc, getDoc, setDoc, serverTimestamp, collection, query, where, getDocs, addDoc, updateDoc, orderBy, deleteDoc, arrayUnion, runTransaction, Timestamp, onSnapshot, increment, writeBatch } from "firebase/firestore";
import { db } from "./firebase";

// ======================================================================
// 📌 SECCIÓN DE USUARIOS Y BALANCE
// ======================================================================

export const createUserDocument = async (user, additionalData = {}) => {
    if (!user) return;
    const userRef = doc(db, "users", user.uid);
    const snapshot = await getDoc(userRef);
    if (!snapshot.exists()) {
        const { email } = user;
        const username = additionalData.username || email.split("@")[0];
        try {
            await setDoc(userRef, {
                username,
                email,
                balance: 0,
                phone: additionalData.phone || "",
                isAdmin: email === "cristhianzxz@hotmail.com" || email === "admin@oriluck.com",
                registrationDate: serverTimestamp(),
                ...additionalData
            });
            return true;
        } catch {
            return false;
        }
    }
    return true;
};

export const checkUsernameAvailability = async (username) => {
    try {
        const usersRef = collection(db, "users");
        const q = query(usersRef, where("username", "==", username.toLowerCase()));
        const querySnapshot = await getDocs(q);
        return querySnapshot.empty;
    } catch {
        return true;
    }
};

export const getUserData = async (userId) => {
    if (!userId) return null;
    try {
        const userRef = doc(db, "users", userId);
        const snapshot = await getDoc(userRef);
        if (snapshot.exists()) return { id: snapshot.id, ...snapshot.data() };
        return null;
    } catch {
        return null;
    }
};

/**
 * Aumenta o disminuye el saldo del usuario.
 * Nota: Para restar (descontar), se usa un 'amountToAdd' negativo.
 */
export const updateUserBalance = async (userId, amountToAdd) => {
    try {
        const userRef = doc(db, "users", userId);
        
        await runTransaction(db, async (transaction) => {
            const userSnapshot = await transaction.get(userRef);
            
            if (!userSnapshot.exists()) throw new Error("Usuario no encontrado.");
            
            const currentBalance = userSnapshot.data().balance || 0;
            const newBalance = currentBalance + amountToAdd;

            // Validación de saldo (para evitar saldos negativos en retiros)
            if (amountToAdd < 0 && newBalance < 0) {
                throw new Error("Saldo insuficiente o inconsistente para la operación.");
            }
            
            transaction.update(userRef, { balance: newBalance });
        });
        
        return true;
    } catch (e) {
        console.error("Error en updateUserBalance:", e.message);
        return false;
    }
};

export const setUserBalance = async (userId, newBalance) => {
    try {
        const userRef = doc(db, "users", userId);
        await updateDoc(userRef, { balance: newBalance });
        return true;
    } catch {
        return false;
    }
};

export const suspendUser = async (userId, suspend = true) => {
    try {
        const userRef = doc(db, "users", userId);
        await updateDoc(userRef, { suspended: suspend });
        return true;
    } catch {
        return false;
    }
};

export const updateUserRole = async (userId, newRole) => {
    try {
        if (!userId || !newRole) throw new Error("invalid");
        const userRef = doc(db, "users", userId);
        await updateDoc(userRef, { role: newRole });
        return true;
    } catch {
        return false;
    }
};

export const deleteUserFromFirestore = async (userId) => {
    try {
        const userRef = doc(db, "users", userId);
        await deleteDoc(userRef);
        return true;
    } catch {
        return false;
    }
};

export const getAllUsers = async () => {
    try {
        const usersRef = collection(db, "users");
        const querySnapshot = await getDocs(usersRef);
        return querySnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch {
        return [];
    }
};

// ======================================================================
// 📌 SECCIÓN DE TRANSACCIONES, RECARGAS Y RETIROS
// ======================================================================

export const createRechargeRequest = async (requestData) => {
    try {
        const rechargeRequestsRef = collection(db, "rechargeRequests");
        const docRef = await addDoc(rechargeRequestsRef, {
            ...requestData,
            status: "pending",
            createdAt: serverTimestamp(),
            processedAt: null,
            processedBy: null
        });
        return docRef.id;
    } catch (e) {
        throw e;
    }
};

export const getPendingRechargeRequests = async () => {
    try {
        const rechargeRef = collection(db, "rechargeRequests");
        const q = query(rechargeRef, where("status", "==", "pending"), orderBy("createdAt", "desc"));
        const querySnapshot = await getDocs(q);
        return querySnapshot.docs.map(d => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt || null }));
    } catch {
        return [];
    }
};

export const updateRechargeRequest = async (requestId, status, processedBy = "admin") => {
    try {
        const requestRef = doc(db, "rechargeRequests", requestId);
        await updateDoc(requestRef, {
            status,
            processedAt: serverTimestamp(),
            processedBy
        });
        return true;
    } catch {
        return false;
    }
};

export const createWithdrawRequest = async (data) => {
    try {
        const docRef = await addDoc(collection(db, "withdrawRequests"), {
            ...data,
            status: "pending",
            createdAt: serverTimestamp(),
            processedAt: null,
            processedBy: null
        });
        return docRef.id;
    } catch (e) {
        console.error("Error al crear solicitud de retiro:", e);
        throw e;
    }
};

/**
 * 🚀 NUEVA FUNCIÓN: Procesa la solicitud de retiro (Aprobación/Rechazo).
 * Si se aprueba, descuenta el saldo del usuario.
 * @param {string} requestId - ID de la solicitud de retiro.
 * @param {string} status - 'approved' o 'rejected'.
 * @param {string} processedBy - Email del administrador que procesa.
 * @param {number} amount - Monto a descontar (debe ser positivo).
 * @param {string} userId - ID del usuario.
 */
export const processWithdrawRequest = async (requestId, status, processedBy, amount, userId) => {
    const requestRef = doc(db, "withdrawRequests", requestId);

    try {
        let success = true;

        if (status === 'approved') {
            // 1. Descontar el saldo del usuario (se usa valor negativo)
            const balanceUpdated = await updateUserBalance(userId, -Math.abs(amount));

            if (!balanceUpdated) {
                console.error("Falló la actualización de saldo. Abortando aprobación.");
                success = false;
            } else {
                // 2. Crear una transacción de registro (Opcional, pero recomendado)
                await createTransaction({
                    userId,
                    type: 'withdrawal',
                    amount: -Math.abs(amount),
                    status: 'completed',
                    requestId,
                    description: `Retiro aprobado por ${processedBy}`
                });
            }
        }
        
        // Si el saldo se actualizó (o si el estado es 'rejected'), actualiza la solicitud.
        if (success || status === 'rejected') {
            await updateDoc(requestRef, {
                status,
                processedBy,
                processedAt: serverTimestamp()
            });
            return true;
        }

        return false;

    } catch (e) {
        console.error(`Error al procesar la solicitud de retiro ${requestId}:`, e);
        return false;
    }
};

// 🔥 NUEVAS FUNCIONES PARA RETIROS 🔥

export const getPendingWithdrawRequests = async () => {
    try {
        const withdrawRef = collection(db, "withdrawRequests");
        const q = query(withdrawRef, orderBy("createdAt", "desc"));
        const querySnapshot = await getDocs(q);
        return querySnapshot.docs.map(d => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt || null }));
    } catch {
        return [];
    }
};

export const updateWithdrawRequest = async (requestId, status, processedBy = "admin") => {
    try {
        const requestRef = doc(db, "withdrawRequests", requestId);
        await updateDoc(requestRef, {
            status,
            processedAt: serverTimestamp(),
            processedBy
        });
        return true;
    } catch {
        return false;
    }
};

export const getAllWithdrawRequests = async () => {
    try {
        const withdrawRef = collection(db, "withdrawRequests");
        const q = query(withdrawRef, orderBy("createdAt", "desc"));
        const querySnapshot = await getDocs(q);
        return querySnapshot.docs.map(d => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt || null }));
    } catch {
        return [];
    }
};

// ======================================================================
// 📌 TRANSACCIONES
// ======================================================================

export const createTransaction = async (transactionData) => {
    try {
        const transactionsRef = collection(db, "transactions");
        const docRef = await addDoc(transactionsRef, {
            ...transactionData,
            createdAt: serverTimestamp()
        });
        return docRef.id;
    } catch {
        return null;
    }
};

// 📌 NUEVAS TRANSACCIONES DE BINGO
// ======================================================================

/**
 * Registra una transacción de compra de cartones de bingo.
 * @param {string} userId - ID del usuario.
 * @param {string} username - Nombre del usuario.
 * @param {number} amount - Monto total gastado.
 * @param {number} quantity - Cantidad de cartones comprados.
 * @param {number} pricePerCard - Precio por cartón.
 * @param {string} tournamentId - ID del torneo.
 * @param {string} tournamentName - Nombre del torneo.
 * @param {number} balanceBefore - Saldo antes de la operación.
 * @param {number} balanceAfter - Saldo después de la operación.
 */
export const createBingoPurchaseTransaction = async ({
    userId,
    username,
    amount,
    quantity,
    pricePerCard,
    tournamentId,
    tournamentName,
    balanceBefore,
    balanceAfter
}) => {
    try {
        const transactionsRef = collection(db, "transactions");
        const docRef = await addDoc(transactionsRef, {
            userId,
            username,
            type: "bingo_purchase",
            amount: -Math.abs(amount), // Negativo porque es un gasto
            description: `Compra de ${quantity} cartón(es) a ${pricePerCard} Bs c/u en "${tournamentName}"`,
            status: "completed",
            createdAt: serverTimestamp(),
            // Nuevos campos
            quantity,
            pricePerCard,
            tournamentId,
            tournamentName,
            balanceBefore,
            balanceAfter
        });
        return docRef.id;
    } catch (e) {
        console.error("Error al crear transacción de bingo:", e);
        return null;
    }
};

/**
 * Registra una transacción de premio ganado en bingo.
 * @param {string} userId - ID del usuario.
 * @param {string} username - Nombre del usuario.
 * @param {number} amount - Monto del premio.
 * @param {string} tournamentId - ID del torneo.
 * @param {string} tournamentName - Nombre del torneo.
 * @param {number} balanceBefore - Saldo antes de la operación.
 * @param {number} balanceAfter - Saldo después de la operación.
 */
export const createBingoPrizeTransaction = async ({
    userId,
    username,
    amount,
    tournamentId,
    tournamentName,
    balanceBefore,
    balanceAfter
}) => {
    try {
        const transactionsRef = collection(db, "transactions");
        const docRef = await addDoc(transactionsRef, {
            userId,
            username,
            type: "bingo_prize",
            amount: Math.abs(amount), // Positivo porque es un ingreso
            description: `Premio ganado en "${tournamentName}"`,
            status: "completed",
            createdAt: serverTimestamp(),
            // Nuevos campos
            tournamentId,
            tournamentName,
            balanceBefore,
            balanceAfter
        });
        return docRef.id;
    } catch (e) {
        console.error("Error al crear transacción de premio de bingo:", e);
        return null;
    }
};

// ======================================================================
// 📌 TRANSACCIONES DE TRAGAMONEDAS
// ======================================================================

/**
 * Registra una transacción de apuesta en tragamonedas.
 * @param {string} userId - ID del usuario.
 * @param {string} username - Nombre del usuario.
 * @param {number} betAmount - Monto de la apuesta.
 * @param {number} balanceBefore - Saldo antes de la operación.
 * @param {number} balanceAfter - Saldo después de la operación.
 * @param {string} gameResult - Resultado del juego (ej. "win", "loss").
 * @param {number} winAmount - Monto ganado (0 si perdió).
 */
export const createSlotsBetTransaction = async ({
    userId,
    username,
    betAmount,
    balanceBefore,
    balanceAfter,
    gameResult,
    winAmount = 0
}) => {
    try {
        const transactionsRef = collection(db, "transactions");
        const docRef = await addDoc(transactionsRef, {
            userId,
            username,
            type: "slots_bet",
            amount: -Math.abs(betAmount), // Negativo porque es una apuesta
            description: `Apuesta en tragamonedas: ${gameResult === 'win' ? 'ganaste' : 'perdiste'} ${winAmount} Bs`,
            status: "completed",
            createdAt: serverTimestamp(),
            // Nuevos campos
            gameResult,
            winAmount,
            betAmount,
            balanceBefore,
            balanceAfter
        });
        return docRef.id;
    } catch (e) {
        console.error("Error al crear transacción de tragamonedas:", e);
        return null;
    }
};

/**
 * Registra una transacción de premio en tragamonedas.
 * @param {string} userId - ID del usuario.
 * @param {string} username - Nombre del usuario.
 * @param {number} amount - Monto del premio.
 * @param {string} jackpotType - Tipo de premio (ej. "jackpot", "bonus", "regular").
 * @param {string} slotMachine - Nombre de la máquina tragamonedas.
 * @param {number} balanceBefore - Saldo antes de la operación.
 * @param {number} balanceAfter - Saldo después de la operación.
 */
export const createSlotsPrizeTransaction = async ({
    userId,
    username,
    amount,
    jackpotType,
    slotMachine,
    balanceBefore,
    balanceAfter
}) => {
    try {
        const transactionsRef = collection(db, "transactions");
        const docRef = await addDoc(transactionsRef, {
            userId,
            username,
            type: "slots_prize",
            amount: Math.abs(amount), // Positivo porque es un ingreso
            description: `Premio ${jackpotType} en ${slotMachine}: ${amount} Bs`,
            status: "completed",
            createdAt: serverTimestamp(),
            // Nuevos campos
            jackpotType,
            slotMachine,
            balanceBefore,
            balanceAfter
        });
        return docRef.id;
    } catch (e) {
        console.error("Error al crear transacción de premio de tragamonedas:", e);
        return null;
    }
};

/**
 * Procesa la compra de fichas para tragamonedas.
 * Descuenta el saldo del usuario y actualiza sus fichas/spins en userSlots.
 * @param {string} userId - ID del usuario.
 * @param {number} chipsToBuy - Número de fichas a comprar.
 * @param {number} totalCostBs - Costo total en Bs.
 * @param {number} exchangeRate - Tasa de cambio usada (para registro).
 * @returns {Promise<boolean>} - Verdadero si la operación fue exitosa.
 */


// ======================================================================

export const getUserTransactions = async (userId) => {
    try {
        const transactionsRef = collection(db, "transactions");
        const q = query(transactionsRef, where("userId", "==", userId), orderBy("createdAt", "desc"));
        const querySnapshot = await getDocs(q);
        return querySnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch {
        return [];
    }
};

export const getAllRechargeRequests = async () => {
    try {
        const rechargeRef = collection(db, "rechargeRequests");
        const q = query(rechargeRef, orderBy("createdAt", "desc"));
        const querySnapshot = await getDocs(q);
        return querySnapshot.docs.map(d => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt || null }));
    } catch {
        return [];
    }
};

export const findTransactionByRequestId = async (requestId) => {
    try {
        const transactionsRef = collection(db, "transactions");
        const q = query(transactionsRef, where("requestId", "==", requestId));
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
            const docSnap = querySnapshot.docs[0];
            return { id: docSnap.id, ...docSnap.data() };
        }
        return null;
    } catch {
        return null;
    }
};

export const updateTransactionStatus = async (transactionId, newStatus, adminEmail) => {
    try {
        const transactionRef = doc(db, "transactions", transactionId);
        await updateDoc(transactionRef, {
            status: newStatus,
            admin: adminEmail,
            updatedAt: serverTimestamp()
        });
        return true;
    } catch {
        return false;
    }
};
// ======================================================================
// 📌 SECCIÓN DE CONFIGURACIÓN Y TASAS
// ======================================================================

export const getExchangeRate = async () => {
    try {
        const rateRef = doc(db, "appSettings", "exchangeRate");
        const snapshot = await getDoc(rateRef);
        if (snapshot.exists()) return snapshot.data().rate;
        await setDoc(rateRef, { rate: 100 });
        return 100;
    } catch {
        return 100;
    }
};

export const updateExchangeRate = async (newRate) => {
    try {
        const rateRef = doc(db, "appSettings", "exchangeRate");
        await setDoc(rateRef, { rate: newRate }, { merge: true });
        return true;
    } catch {
        return false;
    }
};

// 🚀 FUNCIÓN NUEVA: OBTENER TASA DE CAMBIO DE TRAGAMONEDAS
export const getSlotsExchangeRate = async () => {
    try {
        const rateRef = doc(db, "appSettings", "slotsExchangeRate"); // Misma subcolección específica
        const snapshot = await getDoc(rateRef);
        if (snapshot.exists()) {
            return snapshot.data().rate; // Devuelve el valor específico de slots
        }
        // Si no existe, inicialízala con el valor general o un valor por defecto
        // Opcional: puedes inicializarla con el valor general
        const generalRate = await getExchangeRate(); // Asumiendo que esta función devuelve un número
        await setDoc(rateRef, { rate: generalRate }, { merge: true }); // Inicializa con el general
        return generalRate; // Devuelve el valor general que acabamos de usar para inicializar
    } catch (error) {
        console.error("Error obteniendo tasa de slots:", error);
        // En caso de error, podrías devolver la tasa general como fallback
        return await getExchangeRate(); // Fallback a la tasa general
    }
};

// 🚀 FUNCIÓN YA EXISTENTE: ACTUALIZAR TASA DE CAMBIO DE TRAGAMONEDAS
export const updateSlotsExchangeRate = async (newRate) => {
    try {
        const rateRef = doc(db, "appSettings", "slotsExchangeRate"); // Misma subcolección específica
        await setDoc(rateRef, { rate: newRate }, { merge: true }); // Usar set con merge
        return true;
    } catch (error) {
        console.error("Error actualizando tasa de slots:", error);
        return false;
    }
};

// ======================================================================
// 📌 SISTEMA DE SOPORTE - TICKETS (Listener Agregado)
// ======================================================================

// >>>>> REEMPLAZA ESTA FUNCIÓN COMPLETA en firestoreService.js <<<<<
export const createSupportTicket = async (ticketData) => {
    try {
        const ticketsRef = collection(db, "supportTickets");
        const ticketRef = doc(ticketsRef); // Crea una referencia con un ID único
        
        const finalTicket = {
            ticketId: `TKT-${new Date().getFullYear()}-${ticketRef.id.substring(0, 4).toUpperCase()}`,
            userId: ticketData.userId,
            userName: ticketData.userName,
            email: ticketData.email,
            subject: ticketData.subject,
            category: ticketData.category,
            status: "abierto",
            priority: ticketData.priority || "medio",
            // Estos SÍ pueden usar serverTimestamp porque no están en un array
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            assignedAdmin: null,
            hasUnreadForAdmin: true,
            hasUnreadForUser: false,
            handlingHistory: [],
            messages: [
                {
                    sender: ticketData.userId,
                    senderType: "user",
                    message: ticketData.message,
                    // --- CORRECCIÓN FINAL ---
                    // Usamos new Date() porque serverTimestamp() no funciona en arrays
                    timestamp: new Date() 
                }
            ]
        };

        await setDoc(ticketRef, finalTicket);
        return finalTicket.ticketId;

    } catch (e) {
        console.error("Error crítico en createSupportTicket:", e);
        throw e;
    }
};
export const getUserSupportTickets = async (userId) => {
    try {
        const ticketsRef = collection(db, "supportTickets");
        const q = query(ticketsRef, where("userId", "==", userId), orderBy("updatedAt", "desc"));
        const querySnapshot = await getDocs(q);
        return querySnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch {
        return [];
    }
};

export const getAllSupportTickets = async () => {
    try {
        const ticketsRef = collection(db, "supportTickets");
        const q = query(ticketsRef, orderBy("createdAt", "desc"));
        const querySnapshot = await getDocs(q);
        return querySnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch {
        return [];
    }
};

export const addMessageToTicket = async (ticketId, messageData, extraData = {}) => {
    try {
        const ticketRef = doc(db, "supportTickets", ticketId);
        const newMessage = { ...messageData, timestamp: new Date() };
        const updatePayload = {
            messages: arrayUnion(newMessage),
            updatedAt: serverTimestamp(),
            ...extraData
        };
        await updateDoc(ticketRef, updatePayload);
        return true;
    } catch {
        return false;
    }
};

export const updateTicketData = async (ticketId, dataToUpdate) => {
    try {
        const ticketRef = doc(db, "supportTickets", ticketId);
        const updatePayload = { ...dataToUpdate, updatedAt: serverTimestamp() };
        await updateDoc(ticketRef, updatePayload);
        return true;
    } catch {
        return false;
    }
};

export const listenSupportTickets = (callback) => {
    const ticketsRef = collection(db, "supportTickets");
    const q = query(ticketsRef, orderBy("createdAt", "desc"));
    return onSnapshot(q, (querySnapshot) => {
        const tickets = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        callback(tickets);
    });
};

// ======================================================================
// 📌 SISTEMA DE JUEGO: POZOS DE ÚLTIMO SEGUNDO (LAST-MAN-STANDING)
// ======================================================================

const POOLS_COLLECTION = 'lastSecondPools';

const getPoolConfig = (size) => {
    switch (size) {
        case 'S':
            return { maxTickets: 100, activationThreshold: 50, timerDurationHours: 24 };
        case 'M':
            return { maxTickets: 500, activationThreshold: 250, timerDurationHours: 24 };
        case 'L':
            return { maxTickets: 1000, activationThreshold: 500, timerDurationHours: 24 };
        default:
            throw new Error("Tamaño de pozo inválido. Use 'S', 'M', o 'L'.");
    }
};

export const createLastSecondPool = async (poolSize) => {
    try {
        const config = getPoolConfig(poolSize);
        
        const newPool = {
            status: "OPEN", 
            poolSize: poolSize,
            entryCost: 1.00,
            rakePercentage: 0.30, 
            maxTickets: config.maxTickets,
            activationThreshold: config.activationThreshold,
            timerDurationHours: config.timerDurationHours,
            ticketsSold: 0,
            totalRevenue: 0,
            prizePool: 0,
            activationTimestamp: null,
            closureTimestamp: null,
            createdAt: serverTimestamp(),
            winnerUserId: null,
            secondPlaceUserId: null,
        };

        const docRef = await addDoc(collection(db, POOLS_COLLECTION), newPool);
        return docRef;

    } catch (error) {
        console.error("❌ Error al crear el pozo:", error);
        throw error;
    }
};

export const buyTicket = async (poolId, userId) => {
    if (!poolId || !userId) {
        throw new Error("Pool ID y User ID son requeridos para la compra.");
    }
    
    try {
        const poolRef = doc(db, POOLS_COLLECTION, poolId);
        
        await runTransaction(db, async (transaction) => {
            const poolDoc = await transaction.get(poolRef);

            if (!poolDoc.exists()) throw new Error("El pozo especificado no existe.");
            
            const poolData = poolDoc.data();
            
            // VALIDACIONES
            if (poolData.status !== 'OPEN' && poolData.status !== 'ACTIVE') throw new Error("El pozo no está disponible para tickets.");
            if (poolData.ticketsSold >= poolData.maxTickets) throw new Error("El pozo ha alcanzado su límite máximo de tickets.");
            
            // CÁLCULOS
            const newTicketsSold = poolData.ticketsSold + 1;
            const newTotalRevenue = newTicketsSold * poolData.entryCost;
            const newPrizePool = newTotalRevenue * (1 - poolData.rakePercentage);

            let newStatus = poolData.status;
            let newActivationTimestamp = poolData.activationTimestamp;
            let newClosureTimestamp = poolData.closureTimestamp;
            
            // LÓGICA DE ACTIVACIÓN
            if (poolData.status === 'OPEN' && newTicketsSold >= poolData.activationThreshold) {
                newStatus = 'ACTIVE';
                newActivationTimestamp = Timestamp.fromDate(new Date());
                
                const closureDate = new Date(newActivationTimestamp.toMillis());
                closureDate.setHours(closureDate.getHours() + poolData.timerDurationHours);
                newClosureTimestamp = Timestamp.fromDate(closureDate);
            }

            // ACTUALIZACIÓN DE POZO
            transaction.update(poolRef, {
                ticketsSold: newTicketsSold,
                totalRevenue: newTotalRevenue,
                prizePool: newPrizePool,
                status: newStatus,
                activationTimestamp: newActivationTimestamp,
                closureTimestamp: newClosureTimestamp,
            });
            
            // REGISTRO DE TICKET (Subcolección)
            const ticketRef = doc(poolRef, 'tickets', newTicketsSold.toString());
            transaction.set(ticketRef, {
                userId: userId,
                ticketNumber: newTicketsSold,
                purchaseTime: serverTimestamp(),
            });
        });

        return true;
    } catch (error) {
        console.error("❌ Error en la compra del ticket:", error.message);
        throw error;
    }
};

/**
 * Función anterior de auditoría. Se mantiene para referencia pero la nueva 'logAdminMovement' es más completa.
 */
// export async function logAudit(action, details, adminEmail, role) {
//     await addDoc(collection(db, "auditLogs"), {
//         action,
//         details,
//         adminEmail,
//         role,
//         timestamp: serverTimestamp()
//     });
// }

// ======================================================================
// 📌 FONDOS DE LA CASA: BINGO
// ======================================================================

/** Obtiene la configuración de la bolsa de la casa para bingo */
export async function getBingoHouseConfig() {
    const ref = doc(db, "houseFunds", "bingo");
    const snap = await getDoc(ref);
    if (snap.exists()) {
        return snap.data();
    }
    await updateDoc(ref, {
        totalForHouse: 0,
        percentageHouse: 30,
        lastUpdated: serverTimestamp()
    });
    return {
        totalForHouse: 0,
        percentageHouse: 30,
    };
}

/** Actualiza el porcentaje de la casa en Firestore (usado por OwnerPanel) */
export async function setBingoHousePercent(percent) {
    const ref = doc(db, "houseFunds", "bingo");
    await updateDoc(ref, {
        percentageHouse: percent,
        lastUpdated: serverTimestamp()
    });
}

/** Suma el porcentaje de la venta a la bolsa de la casa */
export async function addToBingoHouseFund(totalCartonSale) {
    const ref = doc(db, "houseFunds", "bingo");
    await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        let percentHouse = 30;
        if (snap.exists()) {
            percentHouse = snap.data().percentageHouse || 30;
        }
        const amountToHouse = Math.round(totalCartonSale * percentHouse / 100);
        if (!snap.exists()) {
            tx.set(ref, {
                totalForHouse: amountToHouse,
                percentageHouse: percentHouse,
                lastUpdated: serverTimestamp()
            });
        } else {
            tx.update(ref, {
                totalForHouse: increment(amountToHouse),
                lastUpdated: serverTimestamp()
            });
        }
    });
}

// ======================================================================
// 📌 FUNCIONES DE ADMINISTRACIÓN PELIGROSAS
// ======================================================================

/**
 * Función para eliminar TODAS las transacciones de Firestore.
 * Esta acción es irreversible.
 */
export const deleteAllTransactionsFromFirestore = async () => {
    try {
        const transactionsRef = collection(db, "transactions");
        const snapshot = await getDocs(transactionsRef);

        if (snapshot.empty) {
            console.log("No hay documentos en la colección de transacciones para eliminar.");
            return true;
        }

        // Usa un batch para eliminar múltiples documentos de forma eficiente.
        const batch = writeBatch(db);
        snapshot.docs.forEach((doc) => {
            // Usamos deleteDoc para eliminar un documento. En un batch, usamos batch.delete(doc.ref)
            batch.delete(doc.ref);
        });

        await batch.commit();
        console.log(`✅ ${snapshot.size} transacciones eliminadas con éxito.`);
        return true;

    } catch (error) {
        console.error("❌ Error al eliminar todas las transacciones:", error);
        throw error; // Propaga el error para que el AdminPanel pueda manejarlo y notificar al usuario.
    }
};

// ======================================================================
// 📌 FUNCIONES ADICIONALES (Faltantes)
// ======================================================================

/**
 * Agregada para cumplir con el AdminPanel: Actualiza el estado 'active' del usuario.
 */
export const updateActiveUserStatus = async (userId, isActive) => {
    try {
        const userRef = doc(db, "users", userId);
        await updateDoc(userRef, { active: isActive });
        return true;
    } catch {
        return false;
    }
};

/**
 * Agregada para cumplir con el AdminPanel: Obtiene el conteo de usuarios sin un campo 'role' (asumiendo que son "nuevos").
 * Esto usa un listener en tiempo real.
 */
export const getPendingUsersCount = (callback) => {
    const usersRef = collection(db, "users");
    // Buscamos usuarios que no tengan rol o cuyo campo de registro sea muy reciente (ejemplo).
    // Para simplificar, asumiremos que un usuario sin campo 'role' es el pendiente.
    const q = query(usersRef, where("role", "==", null)); 

    return onSnapshot(q, (querySnapshot) => {
        callback(querySnapshot.size);
    });
};

/**
 * Agregada para cumplir con el AdminPanel: Actualiza las tasas de cambio de los torneos.
 * (Función dummy, debe ser implementada según tu lógica de torneos).
 */
export const updateTournamentExchangeRates = async (newRate) => {
    console.log(`Simulando la actualización de las tasas de cambio de torneos a: ${newRate}`);
    // Aquí iría la lógica real para iterar sobre la colección de torneos y actualizar su tasa.
    return true;
};

// ======================================================================
// 📌 REGISTRO DE MOVIMIENTOS ADMINISTRATIVOS
// ======================================================================

/**
 * Registra cualquier movimiento administrativo relevante en Firestore.
 * actionType: string ('crear_torneo', 'cambiar_tasa', 'suspender_usuario', etc.)
 * adminData: {id, name, email, role}
 * targetId: string (ID del elemento afectado, puede ser null)
 * targetType: string ('usuario', 'torneo', 'bolsa', 'solicitud', etc.)
 * details: objeto con info específica (antes/después, motivo, monto, etc.)
 * description: string breve para mostrar en historial
 */
export async function logAdminMovement({
    actionType,
    adminData,      // {id, name, email, role}
    targetId,       // string o null
    targetType,     // string
    details,        // object (personalizado según acción)
    description     // string
}) {
    await addDoc(collection(db, "adminMovements"), {
        actionType,
        adminId: adminData?.id || "",
        adminName: adminData?.name || "",
        adminEmail: adminData?.email || "",
        adminRole: adminData?.role || "",
        targetId: targetId || "",
        targetType: targetType || "",
        details: details || {},
        description: description || "",
        timestamp: serverTimestamp()
    });
}

// ======================================================================
// 📌 EJEMPLOS DE USO PARA INTEGRAR EN TU LÓGICA DE NEGOCIO
// ======================================================================

// EJEMPLO: Cuando un admin suma/resta saldo a un usuario
// (Llama esto después de hacer la operación real)
export async function logUserBalanceChange({ adminData, userId, userEmail, saldoAntes, saldoDespues, monto, motivo }) {
    await logAdminMovement({
        actionType: "ajustar_saldo_usuario",
        adminData,
        targetId: userId,
        targetType: "usuario",
        details: { saldoAntes, saldoDespues, monto, motivo, userEmail },
        description: `Ajustó saldo de usuario ${userEmail}: de ${saldoAntes} Bs a ${saldoDespues} Bs (${monto > 0 ? "+" : ""}${monto} Bs)`
    });
}

// EJEMPLO: Cuando un admin crea un torneo
export async function logCreateTournament({ adminData, torneoId, torneoNombre, torneoPrecio }) {
    await logAdminMovement({
        actionType: "crear_torneo",
        adminData,
        targetId: torneoId,
        targetType: "torneo",
        details: { nombre: torneoNombre, precioCarton: torneoPrecio },
        description: `Creó el torneo "${torneoNombre}" con precio de cartón ${torneoPrecio} Bs`
    });
}

// EJEMPLO: Cuando se suma/resta de la bolsa de la casa
export async function logEditHouseFund({ adminData, monto, saldoAntes, saldoDespues, motivo }) {
    await logAdminMovement({
        actionType: "ajustar_bolsa",
        adminData,
        targetType: "bolsa",
        details: { monto, saldoAntes, saldoDespues, motivo },
        description: `Ajustó la bolsa de la casa: de ${saldoAntes} Bs a ${saldoDespues} Bs (${monto > 0 ? "+" : ""}${monto} Bs)`
    });
}

export const listenUserTransactions = (userId, callback) => {
  if (!userId) return;
  const transactionsRef = collection(db, "transactions");
  const q = query(transactionsRef, where("userId", "==", userId));
  return onSnapshot(q, (querySnapshot) => {
    const txs = querySnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    callback(txs);
  });
};

// ======================================================================
// 📌 FONDOS DE LA CASA: TRAGAMONEDAS
// ======================================================================

/** Obtiene la configuración de la bolsa de la casa para tragamonedas */
export async function getSlotsHouseConfig() {
    const ref = doc(db, "houseFunds", "slots");
    const snap = await getDoc(ref);
    if (snap.exists()) {
        return snap.data();
    }
    await updateDoc(ref, {
        totalForHouse: 0,
        percentageHouse: 30,
        lastUpdated: serverTimestamp()
    });
    return {
        totalForHouse: 0,
        percentageHouse: 30,
    };
}

/** Actualiza el porcentaje de la casa en Firestore para tragamonedas */
export async function setSlotsHousePercent(percent) {
    const ref = doc(db, "houseFunds", "slots");
    await updateDoc(ref, {
        percentageHouse: percent,
        lastUpdated: serverTimestamp()
    });
}

/** Suma el porcentaje de las apuestas a la bolsa de la casa */
export async function addToSlotsHouseFund(totalBetAmount) {
    const ref = doc(db, "houseFunds", "slots");
    await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        let percentHouse = 30;
        if (snap.exists()) {
            percentHouse = snap.data().percentageHouse || 30;
        }
        const amountToHouse = Math.round(totalBetAmount * percentHouse / 100);
        if (!snap.exists()) {
            tx.set(ref, {
                totalForHouse: amountToHouse,
                percentageHouse: percentHouse,
                lastUpdated: serverTimestamp()
            });
        } else {
            tx.update(ref, {
                totalForHouse: increment(amountToHouse),
                lastUpdated: serverTimestamp()
            });
        }
    });
}