import React, { useState, useEffect, createContext } from "react";
import { auth, db } from "../firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { getUserData } from "../firestoreService";
import { updateDoc, doc, serverTimestamp } from "firebase/firestore";
import InactivityModal from "../components/InactivityModal";

// Contexto de autenticación
export const AuthContext = createContext(null);

// Proveedor de autenticación con lógica de inactividad
export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);

  // Inactividad global
  const [inactiveWarning, setInactiveWarning] = useState(false);
  const [inactiveTimeout, setInactiveTimeout] = useState(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          const userDoc = await getUserData(user.uid);
          setUserData(userDoc);
          setCurrentUser(user);
          await updateDoc(doc(db, "users", user.uid), { active: true, lastActive: serverTimestamp() });
        } catch (error) {
          console.error("Error cargando datos del usuario:", error);
          setCurrentUser(user);
        }
      } else {
        setCurrentUser(null);
        setUserData(null);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  // Mantén registro de la última actividad en Firestore (cada 1 min)
  useEffect(() => {
    if (!currentUser) return;
    const interval = setInterval(() => {
      updateDoc(doc(db, "users", currentUser.uid), { lastActive: serverTimestamp() });
    }, 60000);
    return () => clearInterval(interval);
  }, [currentUser]);

  // Lógica de inactividad (solo logueado)
  useEffect(() => {
    if (!currentUser) return;
    let lastActivity = Date.now();

    const resetTimer = () => {
      lastActivity = Date.now();
      if (inactiveWarning) setInactiveWarning(false);
      if (inactiveTimeout) clearTimeout(inactiveTimeout);
    };

    const events = ["mousemove", "keydown", "click", "scroll"];
    events.forEach(event => window.addEventListener(event, resetTimer));

    const checkInactivity = () => {
      if (Date.now() - lastActivity > 5 * 60 * 1000) {
        setInactiveWarning(true);
        const timeout = setTimeout(async () => {
          // Marcar usuario como inactivo antes de desconectar
          await updateDoc(doc(db, "users", currentUser.uid), { active: false });
          await signOut(auth);
          window.location.href = "/";
        }, 15000);
        setInactiveTimeout(timeout);
      }
    };

    const interval = setInterval(checkInactivity, 10000);

    return () => {
      events.forEach(event => window.removeEventListener(event, resetTimer));
      clearInterval(interval);
      if (inactiveTimeout) clearTimeout(inactiveTimeout);
    };
  }, [currentUser, inactiveWarning, inactiveTimeout]);

  const value = {
    currentUser,
    userData,
    loading,
    inactiveWarning,
    setInactiveWarning
  };

  return (
    <AuthContext.Provider value={value}>
      <InactivityModal />
      {children}
    </AuthContext.Provider>
  );
};