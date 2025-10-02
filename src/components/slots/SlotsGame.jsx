import React, { useEffect, useState, useContext, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../../App';
import { doc, onSnapshot, query, orderBy, limit, collection, setDoc } from 'firebase/firestore';
import { db, functions } from '../../firebase'; 
import { httpsCallable } from 'firebase/functions'; 
import CryptoJS from 'crypto-js';

// --- TABLA DE PAGOS BASE (sin cambios) ---
// Esta tabla ahora solo define los porcentajes y símbolos.
const PAY_TABLE = [
 { symbol: '7️⃣', name: 'JACKPOT',   probability: 0.0001, prizePercent: 30 },
 { symbol: '💎', name: 'DIAMANTE',  probability: 0.0009, prizePercent: 15 },
 { symbol: '⭐', name: 'ESTRELLA',  probability: 0.003,  prizePercent: 10 },
 { symbol: '🔔', name: 'CAMPANA',   probability: 0.007,  prizePercent: 7.5 },
 { symbol: '🍇', name: 'UVA',       probability: 0.02,   prizePercent: 6 },
 { symbol: '🍊', name: 'NARANJA',   probability: 0.05,   prizePercent: 3 },
 { symbol: '🍋', name: 'LIMÓN',     probability: 0.12,   prizePercent: 2 },
 { symbol: '🍒', name: 'CEREZA',    probability: 0.25,   prizePercent: 1.16 },
 { symbol: '',   name: 'SIN_PREMIO',probability: 0.549,  prizePercent: 0 }
];

const SlotsGame = () => {
  const { currentUser } = useContext(AuthContext);
  const navigate = useNavigate();
  
  // --- ESTADOS (sin cambios) ---
  const [machine, setMachine] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reels, setReels] = useState(['🍒', '🍋', '🍊']);
  const [spinning, setSpinning] = useState(false);
  const [userChips, setUserChips] = useState(0); 
  const [userSlotsData, setUserSlotsData] = useState(null);
  const [showResult, setShowResult] = useState(false);
  const [result, setResult] = useState({ type: '', winAmount: 0, combination: [] });
  const [showChipPurchase, setShowChipPurchase] = useState(false);
  const [liveHistory, setLiveHistory] = useState([]);
  const [currentBalance, setCurrentBalance] = useState(0);

  // =======================================================================
  // --- LÓGICA DE TABLA DE PREMIOS DINÁMICA (sin cambios en la lógica) ---
  // =======================================================================
  const dynamicPayTable = useMemo(() => {
    const currentPool = machine?.prizePool || 0;
    // Calculamos el valor en Bs. de cada premio basado en la bolsa actual
    return PAY_TABLE
      .filter(p => p.prizePercent > 0) // Excluimos "SIN_PREMIO"
      .map(prize => ({
        ...prize,
        value: currentPool * (prize.prizePercent / 100)
      }))
      .sort((a, b) => b.value - a.value); // Ordenamos de mayor a menor premio
  }, [machine?.prizePool]); // Se recalcula automáticamente cuando la bolsa cambia
  // =======================================================================

  const winningHistory = useMemo(() => {
    return liveHistory.filter(spin => spin.winAmount > 0);
  }, [liveHistory]);
  
  // --- LÓGICA DE CARGA DE DATOS (sin cambios) ---
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
  
  // --- LÓGICA DE GIRO (sin cambios) ---
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
        verifySpin(executeData.verification, serverSeedHash);

    } catch (error) {
        clearInterval(spinInterval);
        console.error('Error al girar:', error);
        alert(`Error al girar: ${error.message || 'Error desconocido. Inténtalo de nuevo.'}`);
    } finally {
        setSpinning(false);
    }
  };

  const verifySpin = (verification, originalServerSeedHash) => {
    const { serverSeed, clientSeed, nonce, finalHash } = verification;
    const revealedHash = CryptoJS.SHA256(serverSeed).toString();
    if (revealedHash !== originalServerSeedHash) {
        console.error("¡ALERTA DE VERIFICACIÓN FALLIDA! El hash de la semilla del servidor no coincide.");
        return;
    }
    const hmac = CryptoJS.HmacSHA256(`${clientSeed}-${nonce}`, serverSeed).toString();
    if (hmac !== finalHash) {
        console.error("¡ALERTA DE VERIFICACIÓN FALLIDA! El hash del resultado no coincide.");
        return;
    }
    console.log(`%c✅ Verificación de Giro Exitosa (ID: ${nonce})`, 'color: #22c55e; font-weight: bold; font-size: 14px;');
    console.table({ "Promesa del Servidor (Hash)": originalServerSeedHash, "Semilla del Servidor (Revelada)": serverSeed, "Tu Semilla (Cliente)": clientSeed, "Hash Final (Resultado)": finalHash });
  };
  
  // --- RENDERIZADO (sin cambios en la lógica de datos) ---
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 text-white">
        Cargando tragamonedas...
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 text-white">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-center mb-8 bg-white/5 rounded-xl p-4">
          <div>
            <h1 className="text-3xl font-bold">🎰 TRAGAMONEDAS ORI LUCK</h1>
            <p className="text-white/60">
              Bolsa de Premios: <span className="text-green-400 font-semibold">Bs. {machine?.prizePool?.toLocaleString('es-VE', { minimumFractionDigits: 2 }) || '0,00'}</span>
            </p>
          </div>
          <div className="flex gap-2 mt-4 md:mt-0">
            <button onClick={() => setShowChipPurchase(true)} className="bg-green-600 hover:bg-green-500 px-4 py-2 rounded-lg font-semibold">
              💵 Comprar Fichas
            </button>
            <button onClick={() => navigate('/slots')} className="bg-gray-600 hover:bg-gray-500 px-4 py-2 rounded-lg">
              ← Volver al Lobby
            </button>
          </div>
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-white/5 rounded-xl p-6">
              <h3 className="text-lg font-semibold mb-4">Tus Fichas</h3>
              <div className="text-center">
                <div className="text-4xl font-bold text-yellow-400 mb-2">{userChips}</div>
                <div className="text-white/70 text-sm">Fichas disponibles</div>
              </div>
            </div>
            <div className="bg-white/5 rounded-xl p-6 border border-green-500/30">
              <h3 className="text-lg font-semibold mb-4 text-green-300">💰 Tu Saldo</h3>
              <div className="text-center">
                <div className="text-3xl font-bold text-green-400 mb-2">
                  Bs. {currentBalance.toLocaleString('es-VE', { minimumFractionDigits: 2 })}
                </div>
                <div className="text-white/70 text-sm">Saldo disponible</div>
              </div>
            </div>
            <div className="bg-white/5 rounded-xl p-6">
              <h3 className="text-lg font-semibold mb-4">Estadísticas</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Giros Totales:</span>
                  <span className="font-bold">{userSlotsData?.spins || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span>Mayor Ganancia:</span>
                  <span className="font-bold text-yellow-400">Bs. {userSlotsData?.biggestWin?.toLocaleString('es-VE', { minimumFractionDigits: 2 }) || '0,00'}</span>
                </div>
              </div>
            </div>
            <button
              onClick={handleSpinReels}
              disabled={spinning || userChips <= 0}
              className="w-full bg-gradient-to-r from-yellow-500 to-yellow-600 hover:from-yellow-400 hover:to-yellow-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-4 rounded-xl text-xl transition-all transform hover:scale-105"
            >
              {spinning ? '🎰 GIRANDO...' : '🎯 GIRAR (1 FICHA)'}
            </button>
          </div>
          <div className="lg:col-span-2">
            <div className="bg-gradient-to-b from-purple-800 to-purple-900 rounded-2xl p-8 border-4 border-yellow-500 shadow-2xl">
              <div className="bg-black rounded-xl p-6 mb-6 border-2 border-yellow-400">
                <div className="grid grid-cols-3 gap-4">
                  {reels.map((symbol, reelIndex) => (
                    <div key={reelIndex} className="bg-gray-800 rounded-lg p-4 border-2 border-gray-600">
                      <div className="h-32 flex items-center justify-center">
                        <div className={`text-6xl transition-all duration-300 ${ spinning ? 'animate-pulse' : '' }`}>
                          {symbol}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-yellow-500/90 text-black text-center py-2 rounded-lg font-bold text-lg">
                LÍNEA DE PAGO - 3 SÍMBOLOS IGUALES
              </div>
            </div>
          </div>
          {/* Columna 3 (Ganadores Recientes y Tabla de Premios) */}
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-white/5 rounded-xl p-6 border border-green-500/30">
              <h3 className="text-lg font-semibold mb-4 text-green-300">🏆 Ganadores Recientes</h3>
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {winningHistory.length > 0 ? winningHistory.map((spin) => ( 
                  <div key={spin.id} className="bg-white/5 rounded-lg p-3 border border-white/10">
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-sm font-semibold text-white">{spin.username || 'Usuario'}</span>
                    </div>
                    <div className="text-2xl text-center mb-2">{spin.combination.join(' ')}</div>
                    <div className="text-green-400 font-bold text-center">
                      🎉 GANÓ Bs. {spin.winAmount.toLocaleString('es-VE', { minimumFractionDigits: 2 })}
                    </div>
                    <div className="text-xs text-gray-400 text-center mt-1">
                      {spin.playedAt?.toDate?.()?.toLocaleTimeString() || 'Ahora'}
                    </div>
                  </div>
                )) : (
                  <div className="text-center text-white/60 py-8">
                    <div className="text-4xl mb-2">🎰</div>
                    <p>Aún no hay ganadores recientes</p>
                  </div>
                )}
              </div>
            </div>
          
            {/* ======================================================================= */}
            {/* --- TABLA DE PREMIOS REUBICADA AQUÍ --- */}
            {/* ======================================================================= */}
            <div className="bg-white/5 rounded-xl p-6">
              <h3 className="text-lg font-semibold mb-4 text-yellow-300">🌟 Tabla de Premios Actual</h3>
              <div className="space-y-2">
                {dynamicPayTable.map((prize) => (
                  <div key={prize.name} className="flex justify-between items-center text-sm">
                    <span className="flex items-center gap-2">
                      <span className="text-xl">{prize.symbol}</span>
                      <span>{prize.name}</span>
                    </span>
                    <span className="font-bold text-yellow-400">
                      Bs. {prize.value.toLocaleString('es-VE', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            {/* ======================================================================= */}
            {/* --- FIN DE LA REUBICACIÓN --- */}
            {/* ======================================================================= */}
          </div>
        </div>
        
        {showChipPurchase && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-gradient-to-br from-purple-900 to-gray-900 border border-purple-500 rounded-2xl max-w-md w-full p-6">
              <h3 className="text-2xl font-bold mb-4 text-center">Comprar Fichas</h3>
              <p className='text-center text-white/70 mb-4'>La compra de fichas se realiza en el Lobby.</p>
              <button
                onClick={() => setShowChipPurchase(false)}
                className="w-full bg-gray-600 hover:bg-gray-500 py-3 rounded-lg font-semibold"
              >
                Cerrar
              </button>
            </div>
          </div>
        )}

        {showResult && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-gradient-to-br from-purple-900 to-gray-900 border border-purple-500 rounded-2xl max-w-md w-full p-6 text-center">
              <h3 className="text-2xl font-bold mb-4">
                {result.type === 'SIN_PREMIO' ? '😔 Sin Premio' : `🎉 ¡${result.type}!` }
              </h3>
              <div className="text-4xl mb-4 flex justify-center space-x-4">
                {result.combination.map((symbol, index) => (<span key={index}>{symbol}</span>))}
              </div>
              {result.winAmount > 0 ? (
                <div className="text-yellow-300 text-3xl font-bold mb-4">
                  GANASTE: Bs. {result.winAmount.toLocaleString('es-VE', { minimumFractionDigits: 2 })}
                </div>
              ) : (
                <p className="text-white/70 mb-4">
                  Sigue intentando, ¡la suerte está de tu lado!
                </p>
              )}
              <button
                onClick={() => setShowResult(false)}
                className="w-full bg-green-600 hover:bg-green-500 py-3 rounded-lg font-semibold"
              >
                Continuar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SlotsGame;