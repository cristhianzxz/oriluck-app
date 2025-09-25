import { doc, getDoc, setDoc, serverTimestamp, collection, query, where, getDocs, addDoc, updateDoc, orderBy, deleteDoc, arrayUnion } from "firebase/firestore";
import { db } from "./firebase";

// 📌 Crear usuario en Firestore
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
      console.log("✅ Usuario creado en Firestore");
      return true;
    } catch (error) {
      console.error("❌ Error creando usuario:", error);
      return false;
    }
  }
  return true;
};

// 📌 Verificar si el username está disponible (VERSIÓN DEBUG)
export const checkUsernameAvailability = async (username) => {
  try {
    console.log("🔍 checkUsernameAvailability llamado con:", username);
    
    const usersRef = collection(db, "users");
    console.log("🔍 Colección users accedida");
    
    // 🔥 PRIMERO: Listar TODOS los usuarios para debug
    const allUsersSnapshot = await getDocs(usersRef);
    console.log("🔍 Todos los usuarios en Firestore:", allUsersSnapshot.docs.map(doc => ({
      id: doc.id,
      data: doc.data()
    })));
    
    // 🔥 SEGUNDO: Hacer la consulta específica
    const q = query(usersRef, where("username", "==", username.toLowerCase()));
    console.log("🔍 Query creada, ejecutando...");
    
    const querySnapshot = await getDocs(q);
    console.log("🔍 QuerySnapshot empty?:", querySnapshot.empty);
    console.log("🔍 Número de documentos encontrados:", querySnapshot.size);
    
    if (querySnapshot.size > 0) {
      console.log("🔍 Usuarios encontrados con ese username:");
      querySnapshot.forEach((doc) => {
        console.log("  -", doc.id, doc.data());
      });
    }
    
    return querySnapshot.empty;
  } catch (error) {
    console.error("❌ Error DETALLADO en checkUsernameAvailability:");
    console.error("🔴 Código:", error.code);
    console.error("🔴 Mensaje:", error.message);
    
    // Si es error de índice, dar link para crearlo
    if (error.code === 'failed-precondition') {
      console.error("🔴 Se necesita un índice. Haz click en el enlace del error.");
    }
    
    return true; // Por seguridad, permitir registro
  }
};

// 📌 Obtener datos del usuario
export const getUserData = async (userId) => {
  if (!userId) return null;
  try {
    const userRef = doc(db, "users", userId);
    const snapshot = await getDoc(userRef);
    if (snapshot.exists()) return { id: snapshot.id, ...snapshot.data() };
    return null;
  } catch (error) {
    console.error("Error obteniendo usuario:", error);
    return null;
  }
};

// 📌 Actualizar saldo del usuario (CORREGIDA - SUMA AL SALDO ACTUAL)
export const updateUserBalance = async (userId, amountToAdd) => {
  try {
    console.log("🔍 Actualizando saldo para userId:", userId, "Monto a agregar:", amountToAdd);
    
    const userRef = doc(db, "users", userId);
    
    // 1. Primero obtener el saldo actual
    const userSnapshot = await getDoc(userRef);
    if (!userSnapshot.exists()) {
      console.error("❌ Usuario no encontrado:", userId);
      return false;
    }
    
    const currentBalance = userSnapshot.data().balance || 0;
    const newBalance = currentBalance + amountToAdd;
    
    console.log("🔍 Saldo actual:", currentBalance, "Nuevo saldo:", newBalance);
    
    // 2. Actualizar con el nuevo saldo
    await updateDoc(userRef, {
      balance: newBalance
    });
    
    console.log("✅ Saldo actualizado correctamente");
    return true;
  } catch (error) {
    console.error("❌ Error actualizando saldo:", error);
    return false;
  }
};

// 📌 Crear solicitud de recarga (MODIFICADA - SIN CREAR TRANSACCIÓN AUTOMÁTICA)
export const createRechargeRequest = async (requestData) => {
  try {
    console.log("🔍 Creando solicitud de recarga:", requestData);
    
    const rechargeRequestsRef = collection(db, 'rechargeRequests');
    
    // Solo crear la solicitud, NO la transacción
    const docRef = await addDoc(rechargeRequestsRef, {
      ...requestData,
      status: 'pending',
      createdAt: serverTimestamp(),
      processedAt: null,
      processedBy: null
    });
    
    console.log("✅ Solicitud de recarga creada con ID:", docRef.id);
    
    // 🔥 ELIMINADO: No crear transacción automáticamente aquí
    // La transacción se creará solo cuando el admin apruebe/rechace
    
    return docRef.id;
  } catch (error) {
    console.error("❌ Error creando solicitud de recarga:", error);
    throw error;
  }
};

// 📌 Obtener solicitudes de recarga pendientes (MEJORADA con ordenamiento)
export const getPendingRechargeRequests = async () => {
  try {
    const rechargeRef = collection(db, "rechargeRequests");
    const q = query(rechargeRef, where("status", "==", "pending"), orderBy("createdAt", "desc"));
    const querySnapshot = await getDocs(q);
    
    return querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      // Convertir Timestamp a Date si existe
      createdAt: doc.data().createdAt || null
    }));
  } catch (error) {
    console.error("Error obteniendo solicitudes:", error);
    return [];
  }
};

// 📌 Actualizar estado de solicitud de recarga (MEJORADA)
export const updateRechargeRequest = async (requestId, status, processedBy = "admin") => {
  try {
    console.log("🔍 Actualizando solicitud:", requestId, "Estado:", status);
    const requestRef = doc(db, "rechargeRequests", requestId);
    
    const updateData = {
      status: status,
      processedAt: serverTimestamp(),
      processedBy: processedBy
    };
    
    await updateDoc(requestRef, updateData);
    console.log("✅ Solicitud actualizada correctamente");
    return true;
  } catch (error) {
    console.error("❌ Error actualizando solicitud:", error);
    return false;
  }
};

// 📌 Obtener tasa de cambio (NUEVA FUNCIÓN)
export const getExchangeRate = async () => {
  try {
    const rateRef = doc(db, "appSettings", "exchangeRate");
    const snapshot = await getDoc(rateRef);
    
    if (snapshot.exists()) {
      return snapshot.data().rate;
    }
    // Valor por defecto si no existe
    await setDoc(rateRef, { rate: 100 });
    return 100;
  } catch (error) {
    console.error("Error obteniendo tasa:", error);
    return 100;
  }
};

// 📌 Actualizar tasa de cambio (NUEVA FUNCIÓN)
export const updateExchangeRate = async (newRate) => {
  try {
    const rateRef = doc(db, "appSettings", "exchangeRate");
    await setDoc(rateRef, { rate: newRate }, { merge: true });
    return true;
  } catch (error) {
    console.error("Error actualizando tasa:", error);
    return false;
  }
};

// 📌 Crear transacción en el historial
export const createTransaction = async (transactionData) => {
  try {
    console.log("🔍 Creando transacción:", transactionData);
    const transactionsRef = collection(db, "transactions");
    const docRef = await addDoc(transactionsRef, {
      ...transactionData,
      createdAt: serverTimestamp()
    });
    console.log("✅ Transacción creada con ID:", docRef.id);
    return docRef.id;
  } catch (error) {
    console.error("❌ Error creando transacción:", error);
    return null;
  }
};

// 📌 Obtener historial de transacciones del usuario (VERSIÓN CORRECTA CON ÍNDICE)
export const getUserTransactions = async (userId) => {
  try {
    console.log("🔍 Obteniendo transacciones para userId:", userId);
    
    const transactionsRef = collection(db, 'transactions');
    
    // ✅ AHORA CON ÍNDICE HABILITADO - usar la consulta completa
    const q = query(
      transactionsRef, 
      where('userId', '==', userId),
      orderBy('createdAt', 'desc') // ← ESTO DEBERÍA FUNCIONAR AHORA
    );
    
    const querySnapshot = await getDocs(q);
    const transactions = [];
    
    querySnapshot.forEach((doc) => {
      transactions.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    console.log("✅ Transacciones obtenidas con índice:", transactions.length);
    
    // Debug: mostrar info de cada transacción
    transactions.forEach((transaction, index) => {
      console.log(`📄 Transacción ${index + 1}:`, {
        id: transaction.id,
        type: transaction.type,
        status: transaction.status,
        amount: transaction.amount,
        description: transaction.description,
        createdAt: transaction.createdAt,
        userId: transaction.userId
      });
    });
    
    return transactions;
  } catch (error) {
    console.error("❌ Error obteniendo transacciones:", error);
    
    // Si aún hay error, puede ser de permisos
    if (error.code === 'permission-denied') {
      console.error("🔐 Error de permisos. Verifica las reglas de Firestore.");
    }
    
    return []; // Devolver array vacío en caso de error
  }
};

// 📌 Obtener TODAS las solicitudes de recarga (para admin)
export const getAllRechargeRequests = async () => {
  try {
    console.log("🔍 Obteniendo todas las solicitudes...");
    const rechargeRef = collection(db, "rechargeRequests");
    const q = query(rechargeRef, orderBy("createdAt", "desc"));
    const querySnapshot = await getDocs(q);
    
    const requests = querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt || null
    }));
    
    console.log("✅ Todas las solicitudes obtenidas:", requests.length);
    return requests;
  } catch (error) {
    console.error("❌ Error obteniendo todas las solicitudes:", error);
    return [];
  }
};

// 📌 Buscar transacción por requestId
export const findTransactionByRequestId = async (requestId) => {
  try {
    const transactionsRef = collection(db, 'transactions');
    const q = query(transactionsRef, where('requestId', '==', requestId));
    const querySnapshot = await getDocs(q);
    if (!querySnapshot.empty) {
      const docSnap = querySnapshot.docs[0];
      return { id: docSnap.id, ...docSnap.data() };
    }
    return null;
  } catch (error) {
    console.error("Error buscando transacción:", error);
    return null;
  }
};

// 📌 Actualizar estado de transacción existente
export const updateTransactionStatus = async (transactionId, newStatus, adminEmail) => {
  try {
    const transactionRef = doc(db, 'transactions', transactionId);
    await updateDoc(transactionRef, {
      status: newStatus,
      admin: adminEmail,
      updatedAt: serverTimestamp()
    });
    return true;
  } catch (error) {
    console.error("Error actualizando transacción:", error);
    return false;
  }
};


// Eliminar usuario de Firestore
export const deleteUserFromFirestore = async (userId) => {
  try {
    const userRef = doc(db, "users", userId);
    await deleteDoc(userRef);
    return true;
  } catch (error) {
    console.error("Error eliminando usuario:", error);
    return false;
  }
};
// Obtener todos los usuarios
export const getAllUsers = async () => {
  try {
    const usersRef = collection(db, "users");
    const querySnapshot = await getDocs(usersRef);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error("Error obteniendo usuarios:", error);
    return [];
  }
};
export const setUserBalance = async (userId, newBalance) => {
  try {
    const userRef = doc(db, "users", userId);
    await updateDoc(userRef, { balance: newBalance });
    return true;
  } catch (error) {
    console.error("Error actualizando saldo:", error);
    return false;
  }
};
export const suspendUser = async (userId, suspend = true) => {
  try {
    const userRef = doc(db, "users", userId);
    await updateDoc(userRef, { suspended: suspend });
    return true;
  } catch (error) {
    console.error("Error suspendiendo usuario:", error);
    return false;
  }
};

// Agregar al final de firestoreService.js

// 📌 SISTEMA DE SOPORTE - TICKETS

// Crear nuevo ticket de soporte
export const createSupportTicket = async (ticketData) => {
  try {
    console.log("🔍 Creando ticket de soporte:", ticketData);
    
    const ticketsRef = collection(db, 'supportTickets');
    const ticketRef = doc(ticketsRef);
    
    const ticketId = `TKT-${new Date().getFullYear()}-${ticketRef.id.substring(0, 4).toUpperCase()}`;
    
    // 🔥 CORRECCIÓN: Crear el primer mensaje SIN serverTimestamp() en el array
    const firstMessage = {
      sender: ticketData.userId,
      senderType: 'user',
      message: ticketData.message,
      timestamp: new Date() // ← Usar Date() normal en lugar de serverTimestamp()
    };
    
    const ticket = {
      ticketId,
      userId: ticketData.userId,
      username: ticketData.username,
      email: ticketData.email,
      subject: ticketData.subject,
      message: ticketData.message, // Mensaje original por separado
      category: ticketData.category,
      status: 'abierto',
      priority: ticketData.priority || 'medio',
      createdAt: serverTimestamp(), // ← Este SÍ puede usar serverTimestamp()
      updatedAt: serverTimestamp(),
      adminAssignee: null,
      messages: [firstMessage] // ← Array con el primer mensaje
    };
    
    await setDoc(ticketRef, ticket);
    console.log("✅ Ticket creado con ID:", ticketId);
    return ticketId;
    
  } catch (error) {
    console.error("❌ Error creando ticket:", error);
    throw error;
  }
};

// Obtener tickets del usuario
export const getUserSupportTickets = async (userId) => {
  try {
    const ticketsRef = collection(db, 'supportTickets');
    const q = query(
      ticketsRef, 
      where('userId', '==', userId),
      orderBy('createdAt', 'desc')
    );
    
    const querySnapshot = await getDocs(q);
    const tickets = [];
    
    querySnapshot.forEach((doc) => {
      tickets.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    console.log("✅ Tickets del usuario obtenidos:", tickets.length);
    return tickets;
    
  } catch (error) {
    console.error("❌ Error obteniendo tickets:", error);
    return [];
  }
};

// Obtener todos los tickets (para admin)
export const getAllSupportTickets = async () => {
  try {
    const ticketsRef = collection(db, 'supportTickets');
    const q = query(ticketsRef, orderBy('createdAt', 'desc'));
    
    const querySnapshot = await getDocs(q);
    const tickets = [];
    
    querySnapshot.forEach((doc) => {
      tickets.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    console.log("✅ Todos los tickets obtenidos:", tickets.length);
    return tickets;
    
  } catch (error) {
    console.error("❌ Error obteniendo todos los tickets:", error);
    return [];
  }
};

// Agregar mensaje a un ticket
export const addMessageToTicket = async (ticketId, messageData) => {
  try {
    const ticketRef = doc(db, 'supportTickets', ticketId);
    
    const newMessage = {
      sender: messageData.sender,
      senderType: messageData.senderType,
      message: messageData.message,
      timestamp: new Date() // ← Usar Date() normal aquí también
    };
    
    await updateDoc(ticketRef, {
      messages: arrayUnion(newMessage),
      status: messageData.senderType === 'admin' ? 'en_proceso' : 'abierto',
      updatedAt: serverTimestamp(),
      adminAssignee: messageData.senderType === 'admin' ? messageData.sender : null
    });
    
    console.log("✅ Mensaje agregado al ticket:", ticketId);
    return true;
    
  } catch (error) {
    console.error("❌ Error agregando mensaje:", error);
    return false;
  }
};

// Actualizar estado del ticket
export const updateTicketStatus = async (ticketId, newStatus, adminId = null) => {
  try {
    const ticketRef = doc(db, 'supportTickets', ticketId);
    
    const updateData = {
      status: newStatus,
      updatedAt: serverTimestamp()
    };
    
    if (adminId) {
      updateData.adminAssignee = adminId;
    }
    
    await updateDoc(ticketRef, updateData);
    console.log("✅ Estado del ticket actualizado:", ticketId, newStatus);
    return true;
    
  } catch (error) {
    console.error("❌ Error actualizando estado:", error);
    return false;
  }
};