import { useState, useCallback, useContext, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './RocketCrashGame.css';
import { AuthContext } from '../../App';
import { db } from '../../../firebase';
import { collection, query, orderBy, limit, onSnapshot, doc } from 'firebase/firestore';

// Hooks
import { useGameState } from './hooks/useGameState';
import { usePlayerBets } from './hooks/usePlayerBets';

// Componentes
import BetControls from './components/BetControls';
import GameAnimation from './components/GameAnimation';
import PersonalHistory from './components/PersonalHistory';

// --- SUBCOMPONENTES ---

const Header = ({ balance, onRulesClick, userData }) => {
    const navigate = useNavigate();
    return (
        <header className="bg-gray-900 border-b border-gray-700/50 p-3 shadow-lg flex-shrink-0">
            <div className="flex items-center">
                <div className="flex-1">
                    <button onClick={() => navigate('/lobby')} className="bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-2 px-6 rounded-lg transition-colors">Lobby</button>
                </div>
                <div className="flex-1 text-center">
                    <h1 className="text-2xl font-bold tracking-widest uppercase text-cyan-400" style={{ textShadow: '0 0 5px rgba(34,211,238,0.5)' }}>UNIVERS CRASH</h1>
                </div>
                <div className="flex-1 flex justify-end items-center gap-6">
                    <button onClick={onRulesClick} className="flex items-center gap-2 text-gray-400 hover:text-white">
                        <span className="text-lg">📁</span> Reglas del Juego
                    </button>
                    <div className="text-right">
                        <p className="text-gray-400 text-sm">Saldo</p>
                        <p id="balance" className="text-2xl font-bold text-green-400">{balance.toFixed(2)} VES</p>
                    </div>
                    {userData?.role === 'admin' && (
                        <button onClick={() => navigate('/admin/crash')} className="text-3xl p-2 rounded-full hover:bg-gray-700 transition-colors">⚙️</button>
                    )}
                </div>
            </div>
        </header>
    );
};

const HistoryPanel = ({ history }) => (
    <div className="panel p-4 flex-shrink-0">
        <h2 className="text-lg font-bold mb-3 border-b border-gray-700 pb-2">Historial de Rondas</h2>
        <div id="history-list" className="grid grid-cols-3 gap-2">
            {history.map((crashPoint, index) => {
                let colorClass;
                if (crashPoint < 2) { colorClass = 'text-red-500'; }
                else if (crashPoint < 5) { colorClass = 'text-yellow-500'; }
                else { colorClass = 'text-green-500'; }
                return (
                    <span key={index} className={`bg-gray-800 px-3 py-1 rounded-md font-semibold text-center ${colorClass}`}>
                        {crashPoint.toFixed(2)}x
                    </span>
                );
            })}
        </div>
    </div>
);

const RightColumn = ({ activeBets, currentUser, currentBet, gameState }) => {
    const [activeTab, setActiveTab] = useState('active');

    const getStatusText = (bet) => {
        if (bet.status === 'cashed_out') return { text: `Retirado @ ${bet.cashOutMultiplier.toFixed(2)}x`, color: 'text-green-400' };
        if (gameState === 'crashed' && bet.status === 'playing') return { text: 'Perdió', color: 'text-red-400' };
        if (gameState === 'running' && bet.status === 'playing') return { text: 'En juego', color: 'text-yellow-400' };
        return { text: 'Esperando...', color: 'text-gray-400' };
    };

    return (
        <div className="right-column panel p-4 flex flex-col">
            <div className="flex border-b border-gray-700 mb-2">
                <button onClick={() => setActiveTab('active')} className={`tab-button flex-1 py-2 font-semibold ${activeTab === 'active' ? 'active' : ''}`}>Apuestas Activas</button>
                <button onClick={() => setActiveTab('my')} className={`tab-button flex-1 py-2 font-semibold ${activeTab === 'my' ? 'active' : ''}`}>Mis Apuestas</button>
            </div>
            <div className={`flex-grow overflow-y-auto text-sm space-y-2 pr-2 ${activeTab !== 'active' ? 'hidden' : ''}`}>
                {activeBets.map((bet) => { const status = getStatusText(bet); return ( <div key={bet.id} className="grid grid-cols-3 gap-2 items-center bg-gray-900/50 p-2 rounded-md"><span>{bet.username}</span><span className="text-right">{bet.bet.toFixed(2)} VES</span><span className={`text-right font-semibold ${status.color}`}>{status.text}</span></div> ); })}
            </div>
            <div className={`flex-grow ${activeTab !== 'my' ? 'hidden' : ''}`}>
                <PersonalHistory currentUser={currentUser} currentBet={currentBet} />
            </div>
        </div>
    );
};

const RulesModal = ({ isOpen, onClose }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div className="panel max-w-4xl w-full max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center border-b border-gray-700 p-4"><h2 className="text-xl font-bold text-cyan-400">Reglas del Juego: UNIVERS CRASH</h2><button onClick={onClose} className="text-2xl hover:text-white">&times;</button></div>
                <div className="p-6 overflow-y-auto space-y-6 text-gray-300">
                    {/* Contenido de las reglas... */}
                </div>
            </div>
        </div>
    );
};

const ToastContainer = ({ toasts }) => (
    <div id="toast-container">
        {toasts.map(toast => (<div key={toast.id} className={`toast ${toast.type}`}>{toast.message}</div>))}
    </div>
);

// --- COMPONENTE PRINCIPAL ---
const RocketCrashGame = () => {
    const { currentUser, userData } = useContext(AuthContext);
    const [balance, setBalance] = useState(0);
    const [isRulesModalOpen, setRulesModalOpen] = useState(false);
    const [history, setHistory] = useState([]);
    const [toasts, setToasts] = useState([]);
    
    const addToast = useCallback((message, type = 'info') => {
        const id = Date.now() + Math.random();
        setToasts(prev => [...prev, { id, message, type }]);
        setTimeout(() => setToasts(current => current.filter(t => t.id !== id)), 3000);
    }, []);

    const { gameState, multiplier, countdown } = useGameState();
    const { activeBets, currentBet, handleBet, handleCashout, handleCancelBet } = usePlayerBets(currentUser, gameState, multiplier, addToast);

    useEffect(() => {
        if (!currentUser) return;
        const unsub = onSnapshot(doc(db, 'users', currentUser.uid), (doc) => { if (doc.exists()) setBalance(doc.data().balance || 0); });
        return () => unsub();
    }, [currentUser]);

    useEffect(() => {
        const q = query(collection(db, 'game_crash_history'), orderBy('timestamp', 'desc'), limit(15));
        const unsub = onSnapshot(q, (snapshot) => { setHistory(snapshot.docs.map(doc => doc.data().crashPoint)); });
        return () => unsub();
    }, []);

    return (
        <div className="bg-gray-900 text-white flex flex-col h-screen overflow-hidden">
            <ToastContainer toasts={toasts} />
            <Header balance={balance} onRulesClick={() => setRulesModalOpen(true)} userData={userData} />
            <main className="flex-grow min-h-0">
                <div className="main-grid">
                    <div className="left-column flex flex-col gap-6 min-h-0">
                        <HistoryPanel history={history} />
                        {/* El chat puede ser su propio componente completo */}
                    </div>
                    <div className="center-column">
                        <GameAnimation gameState={gameState} multiplier={multiplier} countdown={countdown} />
                        <BetControls
                            onBet={handleBet}
                            onCancel={handleCancelBet}
                            onCashout={handleCashout}
                            gameState={gameState}
                            currentBet={currentBet}
                            multiplier={multiplier}
                        />
                    </div>
                    <RightColumn activeBets={activeBets} currentUser={currentUser} currentBet={currentBet} gameState={gameState} />
                </div>
            </main>
            <RulesModal isOpen={isRulesModalOpen} onClose={() => setRulesModalOpen(false)} />
        </div>
    );
};

export default RocketCrashGame;