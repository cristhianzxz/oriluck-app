import { doc, getDoc, setDoc, serverTimestamp, collection, query, where, getDocs, addDoc, updateDoc, orderBy, deleteDoc, arrayUnion, runTransaction, Timestamp, onSnapshot } from "firebase/firestore";
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


// ======================================================================
// 📌 SISTEMA DE SOPORTE - TICKETS (Listener Agregado)
// ======================================================================

export const createSupportTicket = async (ticketData) => {
    try {
        const ticketsRef = collection(db, "supportTickets");
        const ticketRef = doc(ticketsRef);
        const ticketId = `TKT-${new Date().getFullYear()}-${ticketRef.id.substring(0, 4).toUpperCase()}`;
        const firstMessage = {
            sender: ticketData.userId,
            senderType: "user",
            message: ticketData.message,
            timestamp: new Date()
        };
        const ticket = {
            ticketId,
            userId: ticketData.userId,
            username: ticketData.username,
            email: ticketData.email,
            subject: ticketData.subject,
            message: ticketData.message,
            category: ticketData.category,
            status: "abierto",
            priority: ticketData.priority || "medio",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            assignedAdmin: null,
            messages: [firstMessage],
            hasUnreadForAdmin: true,
            hasUnreadForUser: false
        };
        await setDoc(ticketRef, ticket);
        return ticketId;
    } catch (e) {
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