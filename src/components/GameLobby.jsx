import React from 'react';
import { auth } from '../firebase';
import { signOut } from 'firebase/auth';

const GameLobby = () => {
  const handleLogout = async () => {
    try {
      await signOut(auth);
      // The user will be redirected to the login page by the auth state listener in App.jsx
    } catch (error) {
      console.error("Error signing out: ", error);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-800 text-white">
      <div className="absolute top-4 right-4 flex items-center space-x-4">
        <p>Saldo: 100.00 Bs.</p>
        <button className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded">
          Recargar Saldo
        </button>
        <button
          onClick={handleLogout}
          className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded"
        >
          Cerrar Sesión
        </button>
      </div>

      <h1 className="text-5xl font-bold mb-8">Bienvenido al Lobby de Juegos</h1>

      <div className="grid grid-cols-3 gap-8">
        {/* Bingo Game */}
        <div className="flex flex-col items-center">
          <div className="w-32 h-32 bg-blue-500 rounded-full flex items-center justify-center text-2xl font-bold cursor-pointer hover:bg-blue-600">
            Bingo
          </div>
          <p className="mt-2">Jugar Bingo</p>
        </div>

        {/* Other Games - Coming Soon */}
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex flex-col items-center">
            <div className="w-32 h-32 bg-gray-600 rounded-full flex items-center justify-center text-center p-4 text-lg font-bold cursor-not-allowed">
              Próximamente
            </div>
            <p className="mt-2">Juego {i + 2}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default GameLobby;
