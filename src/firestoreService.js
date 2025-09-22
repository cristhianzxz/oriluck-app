import { doc, getDoc, setDoc, serverTimestamp, collection, query, where, getDocs, addDoc, updateDoc, orderBy } from "firebase/firestore";
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
        isAdmin: email === "admin@oriluck.com",
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

// 📌 Verificar si el username está disponible
export const checkUsernameAvailability = async (username) => {
  try {
    const usersRef = collection(db, "users");
    const q = query(usersRef, where("username", "==", username.toLowerCase()));
    const querySnapshot = await getDocs(q);
    
    return querySnapshot.empty; // true = disponible, false = ya existe
  } catch (error) {
    console.error("Error verificando username:", error);
    return false;
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

// 📌 Actualizar saldo del usuario
export const updateUserBalance = async (userId, newBalance) => {
  try {
    const userRef = doc(db, "users", userId);
    await updateDoc(userRef, {
      balance: newBalance
    });
    return true;
  } catch (error) {
    console.error("Error actualizando saldo:", error);
    return false;
  }
};

// 📌 Crear solicitud de recarga
export const createRechargeRequest = async (rechargeData) => {
  try {
    const rechargeRef = collection(db, "rechargeRequests");
    const docRef = await addDoc(rechargeRef, {
      ...rechargeData,
      status: "pending",
      createdAt: serverTimestamp(),
      processedAt: null
    });
    return docRef.id;
  } catch (error) {
    console.error("Error creando solicitud de recarga:", error);
    return null;
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

// 📌 Actualizar estado de solicitud de recarga (NUEVA FUNCIÓN)
export const updateRechargeRequest = async (requestId, status, processedBy = "admin") => {
  try {
    const requestRef = doc(db, "rechargeRequests", requestId);
    await updateDoc(requestRef, {
      status: status,
      processedAt: serverTimestamp(),
      processedBy: processedBy
    });
    return true;
  } catch (error) {
    console.error("Error actualizando solicitud:", error);
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