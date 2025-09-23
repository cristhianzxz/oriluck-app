import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

// 🔹 Configuración DIRECTA de Firebase (sin variables de entorno)
const firebaseConfig = {
  apiKey: "AIzaSyCcF2BDA2qfONH8B1EGPZ6FB1gKSqLRSZQ",
  authDomain: "oriluck-7e0e3.firebaseapp.com",
  projectId: "oriluck-7e0e3",
  storageBucket: "oriluck-7e0e3.firebasestorage.app",
  messagingSenderId: "916983029756",
  appId: "1:916983029756:web:b1fbf4fd6f7f0210a79c79"
};

// 🔹 Inicializamos Firebase
const app = initializeApp(firebaseConfig);

// 🔹 Exportamos Firestore y Auth para usarlos en la app
export const db = getFirestore(app);
export const auth = getAuth(app);