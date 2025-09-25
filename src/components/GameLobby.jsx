import React, { useContext, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../firebase';
import { signOut } from 'firebase/auth';
import { AuthContext } from '../App';
import { getUserData } from "../firestoreService";

const GameLobby = () => {
  const navigate = useNavigate();
  const { currentUser } = useContext(AuthContext);
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadUserData = async () => {
      if (currentUser) {
        try {
          console.log("🔍 Cargando datos del usuario...");
          const userDataFromFirestore = await getUserData(currentUser.uid);
          
          if (userDataFromFirestore) {
            setUserData({
              username: userDataFromFirestore.username || currentUser.email?.split('@')[0] || "Usuario",
              balance: userDataFromFirestore.balance || 0,
              isAdmin: userDataFromFirestore.isAdmin || false,
              email: currentUser.email
            });
            console.log("✅ Datos del usuario cargados:", userDataFromFirestore);
          } else {
            setUserData({
              username: currentUser.email?.split('@')[0] || "Usuario",
              balance: 0,
              isAdmin: currentUser.email === "cristhianzxz@hotmail.com",
              email: currentUser.email
            });
          }
        } catch (error) {
          console.error("❌ Error cargando datos del usuario:", error);
          setUserData({
            username: currentUser.email?.split('@')[0] || "Usuario",
            balance: 0,
            isAdmin: currentUser.email === "cristhianzxz@hotmail.com",
            email: currentUser.email
          });
        }
      }
      setLoading(false);
    };

    loadUserData();
  }, [currentUser]);

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Error signing out: ", error);
    }
  };

  const handleRechargeClick = () => {
    navigate('/recharge');
  };

  const handleAdminClick = () => {
    navigate('/admin');
  };

  const games = [
    {
      id: 1,
      name: "BINGO",
      icon: "🎯",
      status: "active",
      description: "Juega al clásico Bingo con premios millonarios",
      color: "from-red-500 to-pink-500",
      glow: "shadow-lg shadow-red-500/30"
    },
    {
      id: 2,
      name: "TRAGAMONEDAS",
      icon: "🎰",
      status: "construction",
      description: "Próximamente - Máquinas exclusivas de alta gama",
      color: "from-blue-500 to-purple-500",
      glow: "shadow-lg shadow-blue-500/20"
    },
    {
      id: 3,
      name: "RULETA",
      icon: "🎡",
      status: "construction", 
      description: "Próximamente - Ruleta europea premium",
      color: "from-green-500 to-teal-500",
      glow: "shadow-lg shadow-green-500/20"
    },
    {
      id: 4,
      name: "PÓKER",
      icon: "🎴",
      status: "construction",
      description: "Próximamente - Texas Hold'em VIP",
      color: "from-yellow-500 to-orange-500",
      glow: "shadow-lg shadow-yellow-500/20"
    },
    {
      id: 5,
      name: "BLACKJACK",
      icon: "🃏",
      status: "construction",
      description: "Próximamente - 21 contra crupieres expertos",
      color: "from-indigo-500 to-blue-500",
      glow: "shadow-lg shadow-indigo-500/20"
    },
    {
      id: 6,
      name: "LOTERÍA",
      icon: "🎫",
      status: "construction",
      description: "Próximamente - Sorteos millonarios exclusivos",
      color: "from-purple-500 to-pink-500",
      glow: "shadow-lg shadow-purple-500/20"
    }
  ];

  // 🔥 CORRECCIÓN: Función actualizada para manejar clics en juegos
  const handleGameClick = (game) => {
    if (game.status === "active" && game.name === "BINGO") {
      // ✅ Navegar directamente a /bingo sin alert
      navigate('/bingo');
    } else if (game.status === "construction") {
      alert("🚧 Este juego premium estará disponible próximamente");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 flex items-center justify-center">
        <div className="text-white text-xl">Cargando sala VIP...</div>
      </div>
    );
  }

  if (!userData) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 flex items-center justify-center">
        <div className="text-white text-xl">Error cargando datos del usuario</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 relative overflow-hidden">
      {/* Efectos de fondo */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-transparent via-black/20 to-black/60"></div>
      <div className="absolute top-20 left-10 w-32 h-32 bg-yellow-500/10 rounded-full blur-xl"></div>
      <div className="absolute bottom-20 right-10 w-48 h-48 bg-purple-500/10 rounded-full blur-2xl"></div>
      
      {/* Header */}
      <header className="relative z-10 bg-black/40 backdrop-blur-lg border-b border-gold-500/30 shadow-2xl">
        <div className="container mx-auto px-6 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-4">
              <div className="text-4xl font-bold bg-gradient-to-r from-yellow-400 to-yellow-200 bg-clip-text text-transparent">
                🎩 ORI<span className="text-green-400">LUCK</span> VIP
              </div>
              <div className="text-white/80">
                <div className="text-sm opacity-60">SALA PREMIUM</div>
                <div className="font-light text-gold-200">Bienvenido, {userData.username}</div>
              </div>
            </div>

            <div className="flex items-center space-x-4">
              {/* Saldo */}
              <div className="bg-gradient-to-r from-yellow-500/10 to-yellow-600/10 border border-yellow-500/30 rounded-xl px-6 py-3 backdrop-blur-sm">
                <div className="text-xs text-yellow-300/80 font-medium">SALDO DISPONIBLE</div>
                <div className="text-2xl font-bold text-yellow-300 flex items-center">
                  💎 Bs. {userData.balance.toLocaleString()}
                </div>
              </div>

              {/* Botones de acción */}
              <div className="flex space-x-3">
                <button 
                  onClick={() => navigate('/support')}
                  className="bg-blue-600 hover:bg-blue-500 text-white font-semibold px-6 py-3 rounded-xl transition-all duration-300 transform hover:scale-105 shadow-lg shadow-blue-500/25"
                >
                  🆘 Soporte
                </button>
                
                <button 
                  onClick={handleRechargeClick}
                  className="bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 text-white font-semibold px-6 py-3 rounded-xl transition-all duration-300 transform hover:scale-105 shadow-lg shadow-green-500/25"
                >
                  💰 Recargar
                </button>

                {userData.isAdmin && (
                  <button 
                    onClick={handleAdminClick}
                    className="bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 text-white font-semibold px-6 py-3 rounded-xl transition-all duration-300 transform hover:scale-105 shadow-lg shadow-red-500/25"
                  >
                    ⚙️ Admin
                  </button>
                )}

                <button 
                  onClick={() => navigate('/history')}
                  className="bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-semibold px-6 py-3 rounded-xl transition-all duration-300 transform hover:scale-105 shadow-lg shadow-blue-500/25"
                >
                  📊 Historial
                </button>

                <button
                  onClick={handleLogout}
                  className="bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 text-white font-semibold px-6 py-3 rounded-xl transition-all duration-300 transform hover:scale-105 shadow-lg shadow-red-500/25"
                >
                  🚪 Salir
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Contenido principal */}
      <main className="relative z-10 container mx-auto px-6 py-12">
        {/* Título */}
        <div className="text-center mb-16">
          <h1 className="text-6xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent mb-4">
            SALA DE JUEGOS VIP
          </h1>
          <p className="text-xl text-gray-300/80 font-light">
            Experimenta la excelencia en gaming de alta stakes
          </p>
        </div>

        {/* Grid de juegos */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-7xl mx-auto">
          {games.map((game) => (
            <div
              key={game.id}
              onClick={() => handleGameClick(game)}
              className={`group relative bg-gradient-to-br ${game.color} rounded-2xl p-8 text-white cursor-pointer transform transition-all duration-500 hover:scale-105 hover:rotate-1 ${game.glow} border border-white/10 overflow-hidden`}
            >
              {/* Efecto de brillo */}
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent transform -skew-x-12 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000"></div>
              
              <div className="text-6xl mb-6 text-center filter drop-shadow-2xl">
                {game.icon}
              </div>
              
              <div className="relative z-10 text-center">
                <h3 className="text-2xl font-bold mb-2">{game.name}</h3>
                <p className="text-white/90 text-sm mb-4 font-light">{game.description}</p>
                
                <div className={`inline-flex items-center px-4 py-2 rounded-full text-xs font-semibold ${
                  game.status === "active" 
                    ? "bg-green-500/20 text-green-300 border border-green-500/30" 
                    : "bg-gray-500/20 text-gray-300 border border-gray-500/30"
                }`}>
                  {game.status === "active" ? "🟢 DISPONIBLE" : "🕐 PRÓXIMAMENTE"}
                </div>
              </div>

              {/* Efecto de borde luminoso */}
              <div className="absolute inset-0 rounded-2xl border-2 border-transparent bg-gradient-to-r from-white/10 to-white/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="text-center mt-16 pt-8 border-t border-white/10">
          <p className="text-gray-400/60 text-sm font-light">
            🎩 ORI LUCK VIP - Donde la elegancia se encuentra con la fortuna • 2024
          </p>
        </div>
      </main>
    </div>
  );
};

export default GameLobby;