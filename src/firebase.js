import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";

// Tu configuración real de Firebase.
const firebaseConfig = {
    apiKey: "AIzaSyCcF2BDA2qfONH8B1EGPZ6FB1gKSqLRSZQ",
    authDomain: "oriluck-7e0e3.firebaseapp.com",
    projectId: "oriluck-7e0e3",
    storageBucket: "oriluck-7e0e3.appspot.com", // Usando el valor estándar
    messagingSenderId: "916983029756",
    appId: "1:916983029756:web:b1fbf4fd6f7f0210a79c79"
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
