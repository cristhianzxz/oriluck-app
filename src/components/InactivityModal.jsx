import React, { useContext } from 'react';
import { useLocation } from 'react-router-dom';
import { AuthContext } from '../AuthContext';

const InactivityModal = () => {
  const { inactiveWarning, setInactiveWarning } = useContext(AuthContext);
  const location = useLocation();
  const isAuthPage = location.pathname === "/";

  if (!inactiveWarning || isAuthPage) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-white rounded-2xl p-8 max-w-md w-full shadow-2xl text-center">
        <h3 className="text-xl font-bold mb-4 text-red-600">⏳ Inactividad detectada</h3>
        <p className="text-black mb-4">
          Tu cuenta ha estado inactiva por más de 5 minutos.<br />
          Serás desconectado en 15 segundos.
        </p>
        <button
          className="bg-green-600 hover:bg-green-500 text-white font-bold py-2 px-6 rounded-xl"
          onClick={() => setInactiveWarning(false)}
        >
          Sigo aquí
        </button>
      </div>
    </div>
  );
};

export default InactivityModal;