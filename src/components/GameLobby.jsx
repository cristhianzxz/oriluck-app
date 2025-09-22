import React from 'react';
import { auth } from '../firebase';
import { signOut } from 'firebase/auth';

const GameLobby = () => {
  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Error signing out: ", error);
    }
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

  const handleGameClick = (game) => {
    if (game.status === "active") {
      if (game.name === "BINGO") {
        alert("🎰 Redirigiendo al Bingo VIP...");
      }
    } else {
      alert("🚧 Este juego premium estará disponible próximamente");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 relative overflow-hidden">
      {/* Efecto de partículas de lujo */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-transparent via-black/20 to-black/60"></div>
      
      {/* Header de lujo */}
      <header className="relative z-10 bg-black/40 backdrop-blur-lg border-b border-gold-500/30 shadow-2xl">
        <div className="container mx-auto px-6 py-4">
          <div className="flex justify-between items-center">
            {/* Logo Premium */}
            <div className="flex items-center space-x-4">
              <div className="text-4xl font-bold bg-gradient-to-r from-yellow-400 to-yellow-200 bg-clip-text text-transparent">
                🎩 ORI<span className="text-green-400">LUCK</span> VIP
              </div>
              <div className="text-white/80">
                <div className="text-sm opacity-60">SALA PREMIUM</div>
                <div className="font-light text-gold-200">Bienvenido, Jugador Elite</div>
              </div>
            </div>

            {/* Panel de control */}
            <div className="flex items-center space-x-4">
              {/* Saldo de lujo */}
              <div className="bg-gradient-to-r from-yellow-500/10 to-yellow-600/10 border border-yellow-500/30 rounded-xl px-6 py-3 backdrop-blur-sm">
                <div className="text-xs text-yellow-300/80 font-medium">SALDO DISPONIBLE</div>
                <div className="text-2xl font-bold text-yellow-300 flex items-center">
                  💎 Bs. 10,000.00
                </div>
              </div>

              {/* Botones de acción */}
              <div className="flex space-x-3">
                <button className="bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 text-white font-semibold px-6 py-3 rounded-xl transition-all duration-300 transform hover:scale-105 shadow-lg shadow-green-500/25">
                  💰 Recargar
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
        {/* Título elegante */}
        <div className="text-center mb-16">
          <h1 className="text-6xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent mb-4">
            SALA DE JUEGOS VIP
          </h1>
          <p className="text-xl text-gray-300/80 font-light">
            Experimenta la excelencia en gaming de alta stakes
          </p>
        </div>

        {/* Grid de juegos de lujo */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-7xl mx-auto">
          {games.map((game) => (
            <div
              key={game.id}
              onClick={() => handleGameClick(game)}
              className={`group relative bg-gradient-to-br ${game.color} rounded-2xl p-8 text-white cursor-pointer transform transition-all duration-500 hover:scale-105 hover:rotate-1 ${game.glow} border border-white/10 overflow-hidden`}
            >
              {/* Efecto de brillo al hover */}
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent transform -skew-x-12 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000"></div>
              
              {/* Icono del juego */}
              <div className="text-6xl mb-6 text-center filter drop-shadow-2xl">
                {game.icon}
              </div>
              
              {/* Contenido del juego */}
              <div className="relative z-10 text-center">
                <h3 className="text-2xl font-bold mb-2 text-shadow">{game.name}</h3>
                <p className="text-white/90 text-sm mb-4 font-light">{game.description}</p>
                
                {/* Badge de estado */}
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

        {/* Footer elegante */}
        <div className="text-center mt-16 pt-8 border-t border-white/10">
          <p className="text-gray-400/60 text-sm font-light">
            🎩 ORI LUCK VIP - Donde la elegancia se encuentra con la fortuna • 2024
          </p>
        </div>
      </main>

      {/* Efectos decorativos adicionales */}
      <div className="absolute top-20 left-10 w-32 h-32 bg-yellow-500/10 rounded-full blur-xl"></div>
      <div className="absolute bottom-20 right-10 w-48 h-48 bg-purple-500/10 rounded-full blur-2xl"></div>
      <div className="absolute top-1/2 left-1/4 w-24 h-24 bg-green-500/5 rounded-full blur-lg"></div>
    </div>
  );
};

export default GameLobby;
