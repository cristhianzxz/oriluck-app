import React, { useEffect, useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../../App'; // Ajusta la ruta según tu estructura
import { doc, onSnapshot } from 'firebase/firestore';
// Importa 'db' y 'functions' desde tu archivo centralizado 'firebase.js'
import { db, functions } from '../../firebase'; 
import { getSlotsExchangeRate } from '../../firestoreService';
// Solo necesitas 'httpsCallable' de 'firebase/functions' aquí
import { httpsCallable } from "firebase/functions";

// --- (El resto de tus componentes de UI permanecen intactos) ---

const AnimatedPrizeIcon = ({ type }) => {
    const neonStyle = (color) => ({ 
        textShadow: `0 0 5px ${color}, 0 0 10px ${color}, 0 0 15px ${color}` 
    });
    let icon = '';
    let style = {};
    let sizeClass = 'text-2xl';
    switch (type) {
        case 'JACKPOT':
            icon = '7';
            sizeClass = 'text-3xl font-black';
            style = neonStyle('#ef4444');
            break;
        case 'DIAMANTE':
            icon = '💎';
            style = neonStyle('#0ff');
            break;
        case 'ESTRELLA':
            icon = '⭐';
            style = neonStyle('#ffff00');
            break;
        case 'CAMPANA':
            icon = '🔔';
            style = neonStyle('#bfff00');
            break;
        case 'UVA':
            icon = '🍇';
            style = neonStyle('#a855f7');
            break;
        case 'NARANJA':
            icon = '🍊';
            style = neonStyle('#f97316');
            break;
        case 'LIMÓN':
            icon = '🍋';
            style = neonStyle('#bef264');
            break;
        case 'CEREZA':
            icon = '🍒';
            style = neonStyle('#f43f5e');
            break;
        default:
            icon = '❓';
            break;
    }
    return (
        <span 
            className={`flex-shrink-0 mr-2 animate-pulse-light ${sizeClass}`}
            style={style}
        >
            {icon}
        </span>
    );
};

const AvailablePrizes = () => {
    const prizes = [
        { name: "JACKPOT", type: "JACKPOT", percent: "30%" },
        { name: "DIAMANTE", type: "DIAMANTE", percent: "15%" },
        { name: "ESTRELLA", type: "ESTRELLA", percent: "10%" },
        { name: "CAMPANA", type: "CAMPANA", percent: "7.5%" },
        { name: "UVA", type: "UVA", percent: "5%" },
        { name: "NARANJA", type: "NARANJA", percent: "2.5%" },
        { name: "LIMÓN", type: "LIMÓN", percent: "1%" },
        { name: "CEREZA", type: "CEREZA", percent: "0.5%" },
    ];
    return (
        <div className="bg-white/5 rounded-xl p-6 border-l-4 border-yellow-400 shadow-lg shadow-black/30 animate-fadeIn delay-300">
            <h3 className="text-lg font-semibold mb-4 text-yellow-400">
                <span role="img" aria-label="trophy">🏆</span> Premios Disponibles
            </h3>
            <div className="space-y-3">
                {prizes.map((prize, index) => (
                    <div key={index} className="flex justify-between items-center p-2 bg-purple-900/20 rounded transition duration-200 hover:bg-purple-900/40">
                        <span className="text-white font-medium flex items-center">
                            <AnimatedPrizeIcon type={prize.type} /> 
                            {prize.name}
                        </span>
                        <span className="font-bold text-lg text-yellow-300" 
                              style={{ textShadow: '0 0 5px rgba(253, 224, 71, 0.3)' }}>
                            {prize.percent}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
};

const HighRollerDesk = ({ children }) => {
    return (
        <div className="relative w-full max-w-xl mx-auto my-0 p-1 animate-fadeIn">
            <div className="absolute inset-0 bg-cyan-500 opacity-20 blur-xl rounded-2xl z-0 pointer-events-none animate-pulse-slow"></div> 
            <div className="relative bg-gray-900 rounded-2xl shadow-2xl p-6 border-4 border-cyan-500 z-10">
                <div className="bg-black p-4 rounded-t-lg -mt-6 -mx-6 mb-6 shadow-inner border-b-2 border-cyan-400">
                    <h2 className="text-4xl font-black text-center text-white tracking-widest uppercase"
                        style={{ textShadow: '0 0 10px #22d3ee, 0 0 20px #06b6d4' }}>
                        INTERCAMBIO DE FICHAS
                    </h2>
                </div>
                <h3 className="text-2xl font-bold text-center text-gray-200 mb-6 border-b border-gray-700 pb-3">SELECCIONA TUS FICHAS</h3>
                {children}
            </div>
        </div>
    );
};

const HowToPlaySidebar = () => {
    const steps = [
        "1. Compra fichas de diferentes valores",
        "2. Selecciona tu ficha preferida",
        "3. Gira los rodillos y cruza los dedos",
        "4. 80% de cada ficha va a la bolsa",
        "5. Los premios son % de la bolsa",
        "6. ¡Gana grandes premios en Bs!",
    ];
    return (
        <div className="relative w-full h-full p-4 bg-white/5 rounded-xl border-2 border-purple-600 shadow-2xl shadow-purple-900/50 animate-fadeIn mb-6 lg:mb-0"
             style={{ 
                 minHeight: '400px',
                 background: 'linear-gradient(180deg, rgba(82, 14, 126, 0.4) 0%, rgba(20, 0, 40, 0.4) 100%)'
             }}>
            <h3 className="text-2xl font-black mb-6 text-center text-purple-400" 
                style={{ textShadow: '0 0 8px #a855f7' }}>
                <span role="img" aria-label="checklist">📋</span> CÓMO JUGAR
            </h3>
            <div className="flex flex-col space-y-4">
                {steps.map((step, index) => {
                    const number = step.split('.')[0];
                    const text = step.split('.').slice(1).join('.');
                    return (
                        <div key={index} className="flex items-start space-x-3 p-2 rounded-lg transition duration-200 hover:bg-purple-700/30">
                            <div className={`flex-shrink-0 text-xl font-extrabold text-green-400`}
                                 style={{ textShadow: '0 0 5px #4ade80' }}>
                                {number}.
                            </div>
                            <p className="text-lg font-medium text-white/90">
                                {text.trim()}
                            </p>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};


const SlotsLobby = () => {
    const { currentUser, userData } = useContext(AuthContext); 
    const navigate = useNavigate();

    const buySlotsChipsCallable = httpsCallable(functions, 'buySlotsChipsCallable');

    const [exchangeRate, setExchangeRate] = useState(100);
    const [loading, setLoading] = useState(true);
    const [userSlotStats, setUserSlotStats] = useState({ 
        chips: 0,
        spins: 0,
        biggestWin: 0
    });
    const [liveBalance, setLiveBalance] = useState(userData?.balance ?? 0);
    const [selectedChipValue, setSelectedChipValue] = useState(null); 
    const [customAmount, setCustomAmount] = useState('');
    const [purchaseError, setPurchaseError] = useState(null);
    const [purchaseMessage, setPurchaseMessage] = useState(null);
    const [isProcessingPurchase, setIsProcessingPurchase] = useState(false);

    const CHIP_VALUES = [1, 5, 10, 20, 50, 100];

    const handleBuyChips = async () => {
        setPurchaseError(null);
        setPurchaseMessage(null);

        if (!currentUser?.uid) {
             setPurchaseError("❌ Debes estar autenticado para comprar fichas.");
             return;
        }

        let amountInChips = 0;
        if (selectedChipValue) {
            amountInChips = selectedChipValue;
        } else if (customAmount && !isNaN(parseInt(customAmount)) && parseInt(customAmount) > 0) {
            amountInChips = parseInt(customAmount);
        } else {
            setPurchaseError("Por favor, selecciona una ficha o ingresa un monto válido mayor a 0.");
            return;
        }

        const totalCostBs = amountInChips * exchangeRate;
        const currentBalance = liveBalance; 
        
        if (currentBalance < totalCostBs) {
             setPurchaseError(`❌ Saldo insuficiente. Necesitas Bs. ${totalCostBs.toLocaleString()} para comprar ${amountInChips} fichas.`);
             return;
        }

        setIsProcessingPurchase(true);
        try {
            const response = await buySlotsChipsCallable({ chipsToBuy: amountInChips });
            
            if (response.data && response.data.success) {
                const { chipsCredited } = response.data;
                setPurchaseMessage(`✅ ¡Compra exitosa! Has recibido ${chipsCredited} fichas en total.`);
                setSelectedChipValue(null);
                setCustomAmount('');
            } else {
                throw new Error("Respuesta inesperada del servidor.");
            }
        } catch (err) {
            console.error("Error inesperado en handleBuyChips:", err);
            setPurchaseError(`❌ Error: ${err.message || 'Inténtalo de nuevo.'}`);
        } finally {
            setIsProcessingPurchase(false);
        }
    };

    useEffect(() => {
        const loadExchangeRate = async () => {
            try {
                const rate = await getSlotsExchangeRate(); 
                setExchangeRate(rate);
            } catch (error) {
                console.error("Error cargando tasa de slots:", error);
                setExchangeRate(1);
            }
        };
        loadExchangeRate();
    }, []);

    useEffect(() => {
        if (!currentUser?.uid) {
            if (loading) setLoading(false);
            return;
        }
        const userSlotsRef = doc(db, 'userSlots', currentUser.uid);
        const unsubscribeSlots = onSnapshot(userSlotsRef, (snap) => {
            if (snap.exists()) {
                const data = snap.data();
                setUserSlotStats({
                    chips: data.chips || 0,
                    spins: data.chips || 0,
                    biggestWin: data.biggestWin || 0
                });
            } else {
                setUserSlotStats({ chips: 0, spins: 0, biggestWin: 0 });
            }
            if (loading) {
                 setLoading(false);
            }
        }, (error) => {
            console.error("Error en listener de userSlots:", error);
            setUserSlotStats({ chips: 0, spins: 0, biggestWin: 0 });
            if (loading) setLoading(false);
        });
        return () => {
            unsubscribeSlots();
        };
    }, [currentUser?.uid, loading]);

    useEffect(() => {
        if (!currentUser?.uid) return;
        const userRef = doc(db, 'users', currentUser.uid);
        const unsubscribe = onSnapshot(userRef, (snap) => {
            if (snap.exists()) {
                setLiveBalance(snap.data().balance ?? 0);
            }
        });
        return () => unsubscribe();
    }, [currentUser?.uid]);

    const startGame = () => {
        navigate('/slots/game');
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 text-white">
                <div className="text-xl animate-pulse">Cargando la elegancia del casino...</div>
            </div>
        );
    }
    
    const currentBalance = liveBalance; 

    const currentSelectedAmount = selectedChipValue || (customAmount && !isNaN(parseInt(customAmount)) ? parseInt(customAmount) : 0);
    const amountInBs = currentSelectedAmount * exchangeRate;
    const isBuyDisabled = currentSelectedAmount === 0 || isProcessingPurchase;

    return (
        <div className="min-h-screen flex flex-col p-4 font-sans relative overflow-hidden"
            style={{ 
                background: 'linear-gradient(135deg, #10061e 0%, #1e0037 40%, #520e7e 80%, #000000 100%)',
                boxShadow: 'inset 0 0 200px rgba(0, 0, 0, 0.5)'
            }}>
            
            <style>{`
                @keyframes pulse-slow {
                    0%, 100% { opacity: 0.1; }
                    50% { opacity: 0.3; }
                }
                @keyframes pulse-light {
                    0%, 100% { opacity: 0.8; }
                    50% { opacity: 1; }
                }
                .animate-fadeIn {
                    animation: fadeIn 0.8s ease-out;
                }
            `}</style>

            <div className="absolute inset-0 z-0 opacity-10" 
                 style={{ background: 'radial-gradient(circle at 50% 50%, rgba(138, 43, 226, 0.2) 0%, rgba(25, 25, 112, 0) 70%)' }}>
            </div>

            <div className="max-w-7xl mx-auto text-white relative z-10 flex-grow flex flex-col">
                
                <div className="flex flex-col sm:flex-row justify-between items-center mb-6 bg-white/5 rounded-xl p-4 border-l-4 border-cyan-500 shadow-lg shadow-black/30 animate-fadeIn">
                    <div className="flex flex-col sm:flex-row items-center space-y-2 sm:space-y-0 sm:space-x-4 mb-2 sm:mb-0 w-full sm:w-auto">
                        <div className="text-center sm:text-left">
                            <h1 className="text-2xl sm:text-3xl font-bold">💎 CENTRO DE INTERCAMBIO DE FICHAS</h1>
                            <p className="text-white/60 text-xs sm:text-sm">Tu puerta de entrada a la fortuna.</p>
                        </div>
                        
                        <button 
                            onClick={() => navigate('/lobby')}
                            className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg font-semibold text-xs sm:text-sm transition duration-200 shadow-md shadow-black/30 active:scale-[0.98]
                                       border border-gray-600 hover:border-gray-500 w-full sm:w-auto"
                            style={{ 
                                textShadow: '0 0 5px rgba(255,255,255,0.2)',
                                boxShadow: '0 0 10px rgba(100,100,100,0.3)'
                            }}
                        >
                            ← VOLVER AL LOBBY
                        </button>
                        
                        {/* --- INICIO DE LA MODIFICACIÓN --- */}
                        {userData?.role === 'admin' && (
                            <button 
                                onClick={() => navigate('/admin/slots')}
                                className="bg-purple-700 hover:bg-purple-600 px-4 py-2 rounded-lg font-semibold text-xs sm:text-sm transition duration-200 shadow-md shadow-black/30 active:scale-[0.98]
                                           border border-purple-600 hover:border-purple-500 w-full sm:w-auto"
                                style={{ 
                                    textShadow: '0 0 5px rgba(255,255,255,0.2)',
                                    boxShadow: '0 0 10px rgba(168, 85, 247, 0.4)'
                                }}
                            >
                                ⚙️ ADMIN TRAGAMONEDAS
                            </button>
                        )}
                        {/* --- FIN DE LA MODIFICACIÓN --- */}

                    </div>

                    <div className="text-center sm:text-right w-full sm:w-auto">
                         <div className="text-xs sm:text-sm text-white/70">Tu Saldo:</div>
                         <div className="text-xl sm:text-2xl font-black text-green-400"
                              style={{ textShadow: '0 0 5px #4ade80' }}>
                              Bs. {currentBalance.toLocaleString()} 
                         </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 flex-grow">
                    
                    <div className="lg:col-span-1 order-3 lg:order-1">
                        <HowToPlaySidebar />
                    </div>
                    
                    <div className="lg:col-span-2 flex flex-col items-center order-1 lg:order-2">
                        <HighRollerDesk>
                            
                            <div className="grid grid-cols-3 gap-4 mb-8">
                                {CHIP_VALUES.map(value => {
                                    const chipBgColors = {
                                        1: 'bg-blue-800', 5: 'bg-red-800', 10: 'bg-green-800',
                                        20: 'bg-purple-800', 50: 'bg-orange-800', 100: 'bg-yellow-700'
                                    };
                                    const chipNeonColors = {
                                        1: 'shadow-blue-500/80', 5: 'shadow-red-500/80', 10: 'shadow-green-500/80',
                                        20: 'shadow-purple-500/80', 50: 'shadow-orange-500/80', 100: 'shadow-yellow-500/80'
                                    };
                                    const isSelected = selectedChipValue === value;

                                    return (
                                        <button
                                            key={value}
                                            onClick={() => {
                                                setSelectedChipValue(value);
                                                setCustomAmount('');
                                                setPurchaseError(null);
                                                setPurchaseMessage(null);
                                            }}
                                            className={`
                                                ${chipBgColors[value] || 'bg-gray-800'} 
                                                text-white w-24 h-24 sm:w-32 sm:h-32 rounded-full flex flex-col items-center justify-center 
                                                font-extrabold shadow-2xl transition duration-200 
                                                hover:scale-[1.1] hover:shadow-neon active:scale-[0.9]
                                                border-[6px] sm:border-[8px] border-white/10
                                                ${isSelected 
                                                    ? `ring-4 ring-cyan-400 ${chipNeonColors[value]} shadow-xl` 
                                                    : 'shadow-inner'
                                                }
                                                relative overflow-hidden
                                            `}
                                            disabled={isProcessingPurchase}
                                        >
                                            <div className="absolute inset-1.5 bg-black/30 rounded-full flex flex-col items-center justify-center border-2 border-white/40">
                                                <span className="block text-3xl sm:text-4xl font-black leading-none drop-shadow-lg" 
                                                      style={{ textShadow: `0 0 5px ${value === 100 ? '#fde047' : '#ffffff'}` }}>
                                                    ${value}
                                                </span>
                                                <span className="block text-xs sm:text-sm font-semibold mt-1 opacity-80" 
                                                      style={{ textShadow: '0 0 3px #000000' }}>
                                                    Bs. { (value * exchangeRate).toLocaleString() }
                                                </span>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>

                            <div className="mb-6">
                                <label htmlFor="customAmount" className="block text-center text-sm font-medium text-gray-400 mb-2">MONTO PERSONALIZADO (en $):</label>
                                <input
                                    id="customAmount"
                                    type="number"
                                    min="1"
                                    value={customAmount}
                                    onChange={(e) => {
                                        setCustomAmount(e.target.value);
                                        setSelectedChipValue(null);
                                        setPurchaseError(null);
                                        setPurchaseMessage(null);
                                    }}
                                    className="w-full px-4 py-3 border border-cyan-500 rounded-lg text-lg text-white bg-gray-800 shadow-inner focus:ring-2 focus:ring-cyan-400 transition duration-200"
                                    placeholder="Ej: 3, 8, 13..."
                                    disabled={isProcessingPurchase}
                                />
                            </div>

                            {(purchaseError || purchaseMessage) && (
                                <div className={`p-3 rounded-lg text-center mb-4 font-semibold animate-fadeIn ${purchaseError ? 'bg-red-700 text-white shadow-lg shadow-red-900/50' : 'bg-green-700 text-white shadow-lg shadow-green-900/50'}`}>
                                    {purchaseError || purchaseMessage}
                                </div>
                            )}
                            
                            <button
                                onClick={handleBuyChips}
                                disabled={isBuyDisabled}
                                className={`
                                    w-full py-4 rounded-xl font-black text-xl transition duration-200 tracking-wide
                                    ${isBuyDisabled 
                                        ? 'bg-gray-700 text-gray-500 cursor-not-allowed' 
                                        : 'bg-gradient-to-r from-yellow-400 to-orange-400 hover:from-yellow-500 hover:to-orange-500 text-gray-900 shadow-2xl shadow-yellow-800/70 hover:scale-[1.01] active:scale-[0.99]'
                                    }
                                `}
                            >
                                {isProcessingPurchase 
                                    ? '🛒 PROCESANDO COMPRA...' 
                                    : (isBuyDisabled 
                                        ? 'SELECCIONA UN MONTO' 
                                        : `COMPRAR ${currentSelectedAmount} FICHAS (Bs. ${amountInBs.toLocaleString()})`
                                      )
                                }
                            </button>
                        </HighRollerDesk>
                    </div>

                    <div className="lg:col-span-2 space-y-6 order-2 lg:order-3">
                        
                        <button 
                            onClick={startGame}
                            className="w-full bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white font-extrabold text-xl sm:text-2xl py-4 sm:py-5 rounded-xl shadow-neon-blue transition duration-200 hover:scale-[1.03] active:scale-[0.97] border-b-6 sm:border-b-8 border-cyan-800"
                            style={{ boxShadow: '0 0 20px rgba(6, 182, 212, 0.7)' }}
                        >
                            <span className="animate-pulse">🎰 ENTRAR AL JUEGO</span>
                        </button>

                        <div className="bg-white/5 rounded-xl p-6 border-l-4 border-white/20 shadow-lg shadow-black/30 animate-fadeIn delay-100">
                            <h3 className="text-lg font-semibold mb-4 text-cyan-400">👤 TUS ESTADÍSTICAS</h3>
                            <div className="space-y-3">
                                <div className="flex justify-between">
                                    <span className="text-white/70">Billetera (Bs.):</span>
                                    <span className="font-bold text-green-400">Bs. {currentBalance.toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-white/70">Tus Fichas:</span>
                                    <span className="font-bold text-yellow-400">{userSlotStats.chips}</span> 
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-white/70">Giros Disponibles:</span>
                                    <span className="font-bold">{userSlotStats.spins}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-white/70">Mayor Ganancia:</span>
                                    <span className="font-bold text-yellow-400">Bs. {userSlotStats.biggestWin.toLocaleString()}</span>
                                </div>
                            </div>
                        </div>

                        <AvailablePrizes />

                    </div>
                </div>
            </div>
        </div>
    );
};

export default SlotsLobby;