import React, { useState, useEffect, useContext } from "react";
import { auth } from "./firebase";
import { signOut } from "firebase/auth";
import { AuthContext } from "./App";
import { getUserData } from "./firestoreService";
import GamesGrid from "./GamesGrid";
import Recharge from "./Recharge";
import AdminPanel from "./AdminPanel";

const Dashboard = () => {
  const [currentView, setCurrentView] = useState("games");
  const [userData, setUserData] = useState({
    username: "Usuario",
    balance: 0,
    isAdmin: false,
  });
  const [loading, setLoading] = useState(true);
  const { currentUser } = useContext(AuthContext);

  useEffect(() => {
    const loadUserData = async () => {
      if (currentUser) {
        const userDataFromFirestore = await getUserData(currentUser.uid);
        if (userDataFromFirestore) {
          setUserData({
            username: userDataFromFirestore.username,
            balance: userDataFromFirestore.balance || 1000,
            isAdmin: userDataFromFirestore.isAdmin || currentUser.email === "admin@oriluck.com",
          });
        } else {
          // Datos por defecto si no hay en Firestore
          setUserData({
            username: currentUser.email.split("@")[0],
            balance: 1000,
            isAdmin: currentUser.email === "admin@oriluck.com",
          });
        }
        setLoading(false);
      }
    };
    
    loadUserData();
  }, [currentUser]);

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Error al cerrar sesión:", error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-white text-xl">Cargando...</div>
      </div>
    );
  }

  // INTERFAZ ORIGINAL COMPLETA
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900">
      {/* Header */}
      <header className="bg-black bg-opacity-50 border-b border-yellow-500">
        <div className="container mx-auto px-4 py-3">
          <div className="flex justify-between items-center">
            {/* Logo + Bienvenida */}
            <div className="flex items-center space-x-4">
              <h1 className="text-3xl font-bold text-white">
                <span className="text-yellow-400">ORI</span>
                <span className="text-green-400">LUCK</span>
              </h1>
              <div className="text-white">
                <div className="text-sm opacity-80">Bienvenido</div>
                <div className="font-semibold">{userData.username}</div>
              </div>
            </div>

            {/* Menú + Saldo */}
            <div className="flex items-center space-x-6">
              <div className="bg-yellow-500 bg-opacity-20 border border-yellow-300 rounded-lg px-4 py-2">
                <div className="text-xs text-yellow-200">SALDO</div>
                <div className="text-white font-bold text-lg">
                  Bs. {userData.balance.toLocaleString()}
                </div>
              </div>

              {/* Navegación */}
              <div className="flex space-x-2">
                <button
                  onClick={() => setCurrentView("games")}
                  className={`px-4 py-2 rounded-lg transition ${
                    currentView === "games"
                      ? "bg-yellow-500 text-black"
                      : "bg-white bg-opacity-10 text-white hover:bg-opacity-20"
                  }`}
                >
                  🎮 Juegos
                </button>

                <button
                  onClick={() => setCurrentView("recharge")}
                  className={`px-4 py-2 rounded-lg transition ${
                    currentView === "recharge"
                      ? "bg-green-500 text-white"
                      : "bg-white bg-opacity-10 text-white hover:bg-opacity-20"
                  }`}
                >
                  💰 Recargar
                </button>

                {userData.isAdmin && (
                  <button
                    onClick={() => setCurrentView("admin")}
                    className={`px-4 py-2 rounded-lg transition ${
                      currentView === "admin"
                        ? "bg-red-500 text-white"
                        : "bg-white bg-opacity-10 text-white hover:bg-opacity-20"
                    }`}
                  >
                    ⚙️ Admin
                  </button>
                )}

                <button
                  onClick={handleLogout}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition"
                >
                  🚪 Salir
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Contenido Principal */}
      <main className="container mx-auto px-4 py-8">
        {currentView === "games" && <GamesGrid />}
        {currentView === "recharge" && <Recharge userData={userData} />}
        {currentView === "admin" && userData.isAdmin && <AdminPanel />}
      </main>
    </div>
  );
};

export default Dashboard;