import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";

// Tu configuración real de Firebase.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_API_KEY,
  authDomain: import.meta.env.VITE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_APP_ID
};

// Inicializamos Firebase
const app = initializeApp(firebaseConfig);

// Obtenemos las instancias de los servicios
const db = getFirestore(app);
const auth = getAuth(app);
const functions = getFunctions(app, 'southamerica-east1');

// =======================================================================
// --- INICIO DE LA MODIFICACIÓN: Emuladores Desactivados ---
// =======================================================================
// He comentado el bloque que se conectaba a los emuladores.
// Ahora, la aplicación SIEMPRE se conectará a los servicios reales en la nube.
/*
if (window.location.hostname === "localhost") {
  console.log("🔥 Modo desarrollo local. Conectando a los emuladores...");

  connectAuthEmulator(auth, "http://127.0.0.1:9099");
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectFunctionsEmulator(functions, "127.0.0.1', 5001);
  
  console.log("✅ Emuladores conectados.");
}
*/
console.log("🚀 Conectado directamente a los servicios de Firebase en la nube (Producción).");
// =======================================================================
// --- FIN DE LA MODIFICACIÓN ---
// =======================================================================

// Exportamos todo para que lo use tu aplicación
export { app, db, auth, functions };
