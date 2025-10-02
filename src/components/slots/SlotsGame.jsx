import React, { useEffect, useState, useContext, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
// Nota: Las importaciones relativas (../../App, ../../firebase) y la librería (crypto-js)
// se asumen resueltas por el entorno de ejecución, como en la versión anterior.
import { AuthContext } from '../../App';
import { doc, onSnapshot, query, orderBy, limit, collection, setDoc } from 'firebase/firestore';
import { db, functions } from '../../firebase'; 
import { httpsCallable } from 'firebase/functions'; 
import CryptoJS from 'crypto-js';

// --- TABLA DE PAGOS BASE (sin cambios) ---
const PAY_TABLE = [
 { symbol: '7️⃣', name: 'JACKPOT',   probability: 0.0001, prizePercent: 30 },
 { symbol: '💎', name: 'DIAMANTE',  probability: 0.0009, prizePercent: 15 },
 { symbol: '⭐', name: 'ESTRELLA',  probability: 0.003,  prizePercent: 10 },
 { symbol: '🔔', name: 'CAMPANA',   probability: 0.007,  prizePercent: 7.5 },
 { symbol: '🍇', name: 'UVA',       probability: 0.02,   prizePercent: 6 },
 { symbol: '🍊', name: 'NARANJA',   probability: 0.05,   prizePercent: 3 },
 { symbol: '🍋', name: 'LIMÓN',     probability: 0.12,   prizePercent: 2 },
 { symbol: '🍒', name: 'CEREZA',    probability: 0.25,   prizePercent: 1.16 },
 { symbol: '',    name: 'SIN_PREMIO',probability: 0.549,  prizePercent: 0 }
];

const SlotsGame = () => {
  const { currentUser } = useContext(AuthContext);
  const navigate = useNavigate();
  
  // --- ESTADOS y LÓGICA (sin cambios funcionales) ---
  const [machine, setMachine] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reels, setReels] = useState(['🍒', '🍋', '🍊']);
  const [spinning, setSpinning] = useState(false);
  const [userChips, setUserChips] = useState(0); 
  const [userSlotsData, setUserSlotsData] = useState(null);
  const [showResult, setShowResult] = useState(false);
  const [result, setResult] = useState({ type: '', winAmount: 0, combination: [] });
  const [liveHistory, setLiveHistory] = useState([]);
  const [currentBalance, setCurrentBalance] = useState(0);

  // --- LÓGICA DE TABLA DE PREMIOS DINÁMICA (sin cambios) ---
  const dynamicPayTable = useMemo(() => {
    const currentPool = machine?.prizePool || 0;
    return PAY_TABLE
      .filter(p => p.prizePercent > 0)
      .map(prize => ({
        ...prize,
        // El cálculo se mantiene, pero el color del texto será rojo.
        value: currentPool * (prize.prizePercent / 100)
      }))
      .sort((a, b) => b.value - a.value);
  }, [machine?.prizePool]);

  const winningHistory = useMemo(() => {
    return liveHistory.filter(spin => spin.winAmount > 0);
  }, [liveHistory]);
  
  // --- LÓGICA DE FIREBASE Y FUNCIONES (sin cambios) ---
  // (Hooks de useEffect y funciones asíncronas se mantienen sin cambios)

  useEffect(() => {
    if (!currentUser) return;
    const machineRef = doc(db, 'slotsMachines', 'main_machine');
    const unsubscribe = onSnapshot(machineRef, (snap) => {
      if (snap.exists()) setMachine({ id: snap.id, ...snap.data() });
      setLoading(false);
    });
    return () => unsubscribe();
  }, [currentUser]);

  useEffect(() => {
    const spinsRef = collection(db, 'slotsSpins');
    const q = query(spinsRef, orderBy('playedAt', 'desc'), limit(20));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setLiveHistory(snapshot.docs.map(doc => {
        const data = doc.data();
        return { 
          id: doc.id, 
          ...data,
          winAmount: Number(data.winAmount) || 0,
          combination: Array.isArray(data.combination) ? data.combination : ['?', '?', '?']
        };
      }));
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    const userSlotsRef = doc(db, 'userSlots', currentUser.uid);
    const unsubscribe = onSnapshot(userSlotsRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setUserSlotsData(data);
        setUserChips(Number(data.chips) || 0);
      } else {
        createUserSlotsDocument();
      }
    });
    return () => unsubscribe();
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    const userRef = doc(db, 'users', currentUser.uid);
    const unsubscribe = onSnapshot(userRef, (snap) => {
      if (snap.exists()) setCurrentBalance(snap.data().balance || 0);
    });
    return () => unsubscribe();
  }, [currentUser]);

  const createUserSlotsDocument = async () => {
    if (!currentUser) return;
    const userSlotsRef = doc(db, 'userSlots', currentUser.uid);
    await setDoc(userSlotsRef, {
      userId: currentUser.uid, chips: 0, spins: 0, totalBsSpent: 0,
      biggestWin: 0, createdAt: new Date(), updatedAt: new Date()
    });
  };
  
  const handleSpinReels = async () => {
    if (spinning || userChips <= 0 || !machine || !currentUser) return;

    setSpinning(true);
    setShowResult(false);

    const spinInterval = setInterval(() => {
        setReels([
            PAY_TABLE[Math.floor(Math.random() * 8)].symbol,
            PAY_TABLE[Math.floor(Math.random() * 8)].symbol,
            PAY_TABLE[Math.floor(Math.random() * 8)].symbol
        ]);
    }, 100);

    try {
        const requestSpinFunction = httpsCallable(functions, 'requestSlotSpin');
        const { data: requestData } = await requestSpinFunction();
        const { spinId, serverSeedHash, nonce } = requestData;

        const clientSeed = CryptoJS.lib.WordArray.random(16).toString();
        const executeSpinFunction = httpsCallable(functions, 'executeSlotSpin');
        const { data: executeData } = await executeSpinFunction({ spinId, clientSeed });
        
        clearInterval(spinInterval);
        
        setReels(executeData.result.combination);
        setResult(executeData.result);
        setShowResult(true);

    } catch (error) {
        clearInterval(spinInterval);
        console.error('Error al girar:', error);
        alert(`Error al girar: ${error.message || 'Error desconocido. Inténtalo de nuevo.'}`);
    } finally {
        setSpinning(false);
    }
  };

  // --- COMPONENTES DE VISTA REUTILIZABLES ---
  // (Clases de estilo interno se mantienen igual para mantener el diseño)

  const UserStatsPanel = () => (
    <div className="space-y-6">
      {/* Fichas */}
      <div className="bg-gray-800 rounded-xl p-6 border border-yellow-500 shadow-neon-yellow">
        <h3 className="text-xl font-bold mb-4 text-yellow-300">💎 Tus Fichas</h3>
        <div className="text-center">
          <div className="text-5xl font-black text-yellow-400 mb-2 animate-pulse-slow">{userChips}</div>
          <div className="text-white/70 text-sm">Fichas de Apuesta</div>
        </div>
      </div>
      
      {/* Saldo */}
      <div className="bg-gray-800 rounded-xl p-6 border border-green-500 shadow-neon-green">
        <h3 className="text-xl font-bold mb-4 text-green-300">💰 Tu Saldo (Bs.)</h3>
        <div className="text-center">
          <div className="text-3xl font-bold text-green-400 mb-2">
            Bs. {currentBalance.toLocaleString('es-VE', { minimumFractionDigits: 2 })}
          </div>
          <div className="text-white/70 text-sm">Saldo disponible para cambio</div>
        </div>
      </div>
      
      {/* Estadísticas */}
      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
        <h3 className="text-xl font-bold mb-4 text-purple-300">📊 Estadísticas</h3>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between border-b border-gray-700 pb-1">
            <span>Giros Totales:</span>
            <span className="font-bold text-white">{userSlotsData?.spins || 0}</span>
          </div>
          <div className="flex justify-between">
            <span>Mayor Ganancia:</span>
            <span className="font-black text-yellow-400">Bs. {userSlotsData?.biggestWin?.toLocaleString('es-VE', { minimumFractionDigits: 2 }) || '0,00'}</span>
          </div>
        </div>
      </div>
    </div>
  );
  
  const PayTablePanel = () => (
    <div className="bg-gray-800 rounded-xl p-6 border border-red-700 shadow-neon-red">
      <h3 className="text-xl font-bold mb-4 text-red-500 drop-shadow-lg">🌟 Tabla de Premios</h3>
      <div className="space-y-2">
        {dynamicPayTable.map((prize) => (
          <div 
            key={prize.name} 
            className="grid grid-cols-[auto_1fr_auto] items-center text-md p-1 bg-gray-700/50 rounded-md gap-3"
          >
            
            {/* Columna 1: Símbolo (tamaño fijo) */}
            <span className="text-2xl drop-shadow-lg flex-shrink-0">{prize.symbol}</span>

            {/* Columna 2: Nombre (ocupa el espacio restante) */}
            <span className="font-medium text-white overflow-hidden text-ellipsis whitespace-nowrap">{prize.name}</span>

            {/* Columna 3: Valor (alineado a la derecha, sin encojerse) */}
            <span className="font-black text-red-400 text-base text-right flex-shrink-0 whitespace-nowrap">
              Bs. {prize.value.toLocaleString('es-VE', { minimumFractionDigits: 2 })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );

  const HistoryPanel = () => (
    <div className="bg-gray-800 rounded-xl p-6 border border-purple-700">
      <h3 className="text-xl font-bold mb-4 text-purple-300">🏆 Ganadores Recientes</h3>
      <div className="space-y-3 max-h-96 overflow-y-auto custom-scrollbar">
        {winningHistory.length > 0 ? winningHistory.map((spin) => ( 
          <div key={spin.id} className="bg-gray-900 rounded-lg p-3 border border-green-500/30 shadow-md">
            <div className="flex justify-between items-center mb-1">
              <span className="text-sm font-semibold text-white">{spin.username || 'Usuario'}</span>
              <span className="text-xs text-gray-400">{spin.playedAt?.toDate?.()?.toLocaleTimeString() || 'Ahora'}</span>
            </div>
            <div className="text-3xl text-center mb-1 font-extrabold text-yellow-300">{spin.combination.join(' ')}</div>
            <div className="text-green-400 font-bold text-center text-lg shadow-neon-green">
              + Bs. {spin.winAmount.toLocaleString('es-VE', { minimumFractionDigits: 2 })}
            </div>
          </div>
        )) : (
          <div className="text-center text-white/60 py-8">
            <div className="text-4xl mb-2">✨</div>
            <p>Sé el primer gran ganador de esta ronda.</p>
          </div>
        )}
      </div>
    </div>
  );

  // *************************************************************************
  // ****************************** RENDERIZADO PRINCIPAL ********************
  // *************************************************************************

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">
        <p className="text-xl animate-pulse text-purple-400">Cargando tragamonedas...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 bg-gray-900 text-white font-sans">
      <style>{`
        /* Custom Scrollbar for history (optional, but good for aesthetics) */
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background-color: #8b5cf6; /* purple-500 */
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: #1f2937; /* gray-800 */
        }
        
        /* Definición de la Animación de Neón Rojo (Reemplazando el Amarillo) */
        @keyframes pulse-neon-red {
          0%, 100% { text-shadow: 0 0 5px #f87171, 0 0 10px #f87171, 0 0 15px #f87171; } /* red-400 */
          50% { text-shadow: 0 0 8px #ef4444, 0 0 15px #ef4444, 0 0 25px #ef4444; } /* red-500 */
        }
        .animate-pulse-neon-red {
          animation: pulse-neon-red 4s infinite alternate;
        }
        
        /* Definición de Sombra Neón Roja */
        .shadow-neon-red {
            box-shadow: 0 0 10px #dc2626, 0 0 20px #dc2626; /* red-600 */
        }
      `}</style>

      <div className="max-w-7xl mx-auto">
        
        {/* CABECERA MODIFICADA (Botones de compra eliminados, título y bolsa rellenan el espacio, color rojo) */}
        <div className="flex justify-between items-center mb-8 bg-purple-900/20 rounded-2xl p-6 border-2 border-purple-700 shadow-neon-purple">
          
          {/* Contenedor del Título y la Bolsa de Premios (ocupa todo el espacio) */}
          <div className="flex-grow flex flex-col md:flex-row justify-between items-center text-center md:text-left">
            <h1 className="text-5xl font-extrabold tracking-wider text-red-700 drop-shadow-lg animate-pulse-neon-red mb-2 md:mb-0">
              🎰 ORILUCK CASINO REAL
            </h1>
            <p className="text-purple-300 mt-2 text-lg">
              BOLSA DE PREMIOS EN VIVO: 
              <span className="text-green-400 font-black text-xl ml-2 shadow-neon-green">
                Bs. {machine?.prizePool?.toLocaleString('es-VE', { minimumFractionDigits: 2 }) || '0,00'}
              </span>
            </p>
          </div>
          
          {/* Botón de Lobby (Mantener para la navegación) */}
          <button onClick={() => navigate('/slots')} className="bg-gray-700 hover:bg-gray-600 px-6 py-3 rounded-full font-semibold transition-all duration-300 ml-4">
            ← Lobby
          </button>
        </div>
        
        {/* CONTENIDO PRINCIPAL: Layout Responsive */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          
          {/* Columna Izquierda: Stats y Tabla de Premios (Tabla con color rojo) */}
          <div className="lg:col-span-1 space-y-8">
            <UserStatsPanel />
            <PayTablePanel /> {/* Usa el estilo rojo definido arriba */}
          </div>
          
          {/* Columna Central: Máquina y Botón de Giro (sin cambios) */}
          <div className="lg:col-span-2 space-y-6">
            
            <div className="bg-gray-800 rounded-3xl p-6 border-8 border-purple-800 shadow-2xl shadow-purple-900/80">
              
              {/* Ventana de Reels */}
              <div className="bg-black/90 rounded-xl p-4 mb-6 border-4 border-gray-700">
                <div className="grid grid-cols-3 gap-3">
                  {reels.map((symbol, reelIndex) => (
                    <div 
                      key={reelIndex} 
                      className={`bg-gray-900/70 rounded-lg p-3 overflow-hidden 
                        ${showResult && result.winAmount > 0 && result.combination[reelIndex] === symbol && !spinning
                          ? 'border-4 border-yellow-500 shadow-neon-yellow' 
                          : 'border-2 border-gray-700'
                        }`}
                    >
                      <div className="h-28 sm:h-36 md:h-48 flex items-center justify-center"> {/* Altura adaptable */}
                        <div className={`text-6xl sm:text-8xl transition-all duration-75 ease-in-out ${ spinning ? 'animate-spin-fast' : 'animate-pop-in' }`}>
                          {symbol}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              
              {/* Indicador de Línea de Pago */}
              <div className="bg-red-600/90 text-white text-center py-3 rounded-xl font-bold text-xl uppercase shadow-xl shadow-red-500/50 animate-pulse-slow mb-4">
                PAGA EN EL CENTRO - 3 EN LÍNEA
              </div>

            </div>
            
            {/* BOTÓN DE GIRO (sin cambios en funcionalidad) */}
            <button
              onClick={handleSpinReels}
              disabled={spinning || userChips <= 0}
              className={`w-full relative py-5 rounded-xl text-3xl font-black uppercase tracking-widest transition-all duration-300 transform 
                ${spinning || userChips <= 0 
                  ? 'bg-gray-500 text-gray-300 cursor-not-allowed opacity-70' 
                  : 'bg-red-600 text-white shadow-xl shadow-red-500/50 hover:bg-red-700 hover:scale-[1.02] active:scale-[0.98] border-b-8 border-red-800'
                }`}
            >
              <span className={`${spinning ? 'animate-spin-slow' : 'drop-shadow-lg'}`}>
                {spinning ? '🌀 GIRANDO...' : 'PULL! 1 FICHA'}
              </span>
            </button>
            
          </div>
          
          {/* Columna Derecha: Historial de Ganadores */}
          <div className="lg:col-span-1 space-y-6">
            <HistoryPanel />
          </div>
        </div>
        
        {/* MODALES: Se elimina el modal de compra de fichas. Solo se mantiene el modal de resultado. */}

        {showResult && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className={`bg-gray-900 border-4 rounded-3xl max-w-md w-full p-8 text-center animate-in zoom-in duration-300 
              ${result.winAmount > 0 ? 'border-yellow-500 shadow-neon-yellow' : 'border-red-500 shadow-neon-red'}`}> {/* El marco de derrota ahora es rojo */}
              
              <h3 className={`text-4xl font-extrabold mb-4 uppercase tracking-widest ${result.winAmount > 0 ? 'text-yellow-400 shadow-neon-yellow' : 'text-red-500 drop-shadow-lg'}`}>
                {result.type === 'SIN_PREMIO' ? '😔 MEJOR SUERTE' : `🎉 ${result.type?.replace('_', ' ') ?? 'PREMIO'}!` }
              </h3>
              
              <div className="text-6xl mb-6 flex justify-center space-x-6">
                {result.combination.map((symbol, index) => (
                  <span 
                    key={index} 
                    className={result.winAmount > 0 ? 'animate-bounce text-yellow-300 drop-shadow-xl' : 'text-white/80'}
                  >
                    {symbol}
                  </span>
                ))}
              </div>
              
              {result.winAmount > 0 ? (
                <div className="text-green-400 text-4xl font-black mb-6 animate-pulse shadow-neon-green">
                  ¡GANASTE! Bs. {result.winAmount.toLocaleString('es-VE', { minimumFractionDigits: 2 })}
                </div>
              ) : (
                <p className="text-white/70 mb-6 text-lg">
                  Sin suerte esta vez. ¡Prueba de nuevo!
                </p>
              )}
              
              <button
                onClick={() => setShowResult(false)}
                className="w-full bg-red-600 hover:bg-red-700 py-3 rounded-xl font-bold text-xl shadow-lg shadow-red-500/50 transition-all"
              >
                JUGAR OTRA VEZ
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SlotsGame;