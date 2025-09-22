// src/components/GamesGrid.jsx
import React from "react";

const GamesGrid = () => {
  const games = [
    {
      id: 1,
      name: "BINGO",
      icon: "🎯",
      status: "active",
      description: "Juega al clásico Bingo con premios increíbles",
      color: "from-red-500 to-pink-500",
    },
    {
      id: 2,
      name: "TRAGAMONEDAS",
      icon: "🎰",
      status: "construction",
      description: "Próximamente - Máquinas tragamonedas emocionantes",
      color: "from-blue-500 to-purple-500",
    },
    {
      id: 3,
      name: "RULETA",
      icon: "🎡",
      status: "construction",
      description: "Próximamente - Ruleta clásica y moderna",
      color: "from-green-500 to-teal-500",
    },
    {
      id: 4,
      name: "PÓKER",
      icon: "🎴",
      status: "construction",
      description: "Próximamente - Texas Hold'em y variantes",
      color: "from-yellow-500 to-orange-500",
    },
    {
      id: 5,
      name: "BLACKJACK",
      icon: "🃏",
      status: "construction",
      description: "Próximamente - 21 contra la casa",
      color: "from-indigo-500 to-blue-500",
    },
    {
      id: 6,
      name: "LOTERÍA",
      icon: "🎫",
      status: "construction",
      description: "Próximamente - Sorteos y loterías",
      color: "from-purple-500 to-pink-500",
    },
  ];

  const handleGameClick = (game) => {
    if (game.status === "active") {
      if (game.name === "BINGO") {
        alert("Redirigiendo al Bingo...");
        // Aquí irá la navegación al juego de Bingo
      }
    } else {
      alert("🚧 Este juego aún está en construcción.");
    }
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {games.map((game) => (
        <div
          key={game.id}
          onClick={() => handleGameClick(game)}
          className={`cursor-pointer bg-gradient-to-br ${game.color} rounded-xl p-6 text-white shadow-lg transform hover:scale-105 transition`}
        >
          <div className="text-5xl mb-4">{game.icon}</div>
          <h3 className="text-2xl font-bold">{game.name}</h3>
          <p className="text-sm opacity-80">{game.description}</p>
        </div>
      ))}
    </div>
  );
};

export default GamesGrid;
