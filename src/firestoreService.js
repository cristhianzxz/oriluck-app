import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase";

export const createUserDocument = async (user, additionalData = {}) => {
  if (!user) return;

  console.log("🔍 Creando documento para usuario:", user.uid);

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
    } catch (error) {
      console.error("❌ Error creando usuario:", error);
    }
  }
};

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