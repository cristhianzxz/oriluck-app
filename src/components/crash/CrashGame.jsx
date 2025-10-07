import React, { useEffect, useState, useRef, useContext } from 'react';
import { Link } from 'react-router-dom';
import { AuthContext } from '../../App';
import { db, functions } from '../../firebase';
import { doc, onSnapshot, collection, query, orderBy, limit } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

// --- NASA Neon Theme ---
const COLORS = {
  bgSpace: 'linear-gradient(135deg, #010024 0%, #090979 60%, #00d4ff 100%)',
  neonBlue: '#00d4ff',
  neonGreen: '#39ff14',
};

const ROCKET_PATH_K = 0.00006;
const MAX_MULTIPLIER_VISUAL = 40;
const toMillis = (ts) => (ts?.toMillis ? ts.toMillis() : ts instanceof Date ? ts.getTime() : null);

const NotificationBar = ({ message, type }) => {
  if (!message) return null;
  return (
    <div className={`fixed top-6 left-1/2 -translate-x-1/2 px-6 py-3 rounded-xl shadow-2xl z-[99] font-bold text-base
      ${type === 'error' ? 'bg-red-700 text-white border-2 border-red-500' : 'bg-blue-700 text-white border-2 border-blue-500'}
      animate-fadeIn`}>
      {type === 'error' ? '🚫 Error: ' : '🚀'} {message}
    </div>
  );
};

// --- ROCKET ANIMATION ---
const RocketDisplay = ({ gameState, multiplier, waitUntil, serverTimeOffset, crashPoint }) => {
  const [countdownMs, setCountdownMs] = useState(0);
  const rocketRef = useRef(null);

  useEffect(() => {
    let interval;
    if (gameState === 'waiting' && waitUntil) {
      const tick = () => {
        const remaining = toMillis(waitUntil) - (Date.now() - serverTimeOffset);
        setCountdownMs(Math.max(0, remaining));
      };
      tick();
      interval = setInterval(tick, 100);
    } else {
      setCountdownMs(0);
    }
    return () => clearInterval(interval);
  }, [gameState, waitUntil, serverTimeOffset]);

  useEffect(() => {
    if (!rocketRef.current) return;
    if (gameState === 'running' && multiplier > 1) {
      const currentT = Math.log(multiplier) / ROCKET_PATH_K;
      const logM = Math.log(multiplier);
      const logMaxVisual = Math.log(MAX_MULTIPLIER_VISUAL);
      const yPercent = Math.min(85, Math.max(0, 100 - (logM / logMaxVisual) * 100));
      const xPercent = Math.min(85, (currentT / (Math.log(100) / ROCKET_PATH_K)) * 100);
      const rotation = Math.min(75, currentT / 250);
      rocketRef.current.style.transform = `translate3d(${xPercent}%, ${yPercent}%, 0) rotateZ(-${rotation + 45}deg)`;
      rocketRef.current.style.opacity = 1;
      rocketRef.current.style.transition = 'transform 0.08s linear, opacity 0.5s';
    } else if (gameState === 'crashed') {
      rocketRef.current.style.opacity = 0.2;
      rocketRef.current.style.transform += ' scale(0.7)';
    } else if (gameState === 'waiting') {
      rocketRef.current.style.transform = 'translate3d(-50%, 100%, 0) rotateZ(-45deg)';
      rocketRef.current.style.opacity = 0.2;
    }
  }, [gameState, multiplier]);

  // SVG Rocket con llama animada
  const rocketSVG = (
    <svg width="80" height="80" viewBox="0 0 80 80" style={{ filter: 'drop-shadow(0 0 16px #00d4ff)' }}>
      <g className="rocket-body">
        <polygon points="40,5 48,22 32,22" fill="#39ff14" stroke="#fff" strokeWidth="1.5" />
        <rect x="36" y="20" width="8" height="30" rx="4" fill="#212d3b" stroke="#00d4ff" strokeWidth="1.5" />
        <circle cx="40" cy="30" r="4" fill="#fff" stroke="#00d4ff" strokeWidth="1.5" />
        <path d="M32 50 L32 55 Q40 60 48 55 L48 50 Z" fill="#212d3b" stroke="#00d4ff" strokeWidth="1.5" />
      </g>
      <g className="flame">
        <polygon points="36,50 44,50 40,65" fill="rgba(255, 220, 0, 0.9)" />
        <polygon points="37,50 43,50 40,60" fill="rgba(255, 100, 0, 1)" />
      </g>
    </svg>
  );

  const multiplierColor = gameState === 'running' ? 'text-blue-300 animate-pulse-slow'
    : gameState === 'crashed' ? 'text-red-500 animate-shake' : 'text-cyan-400';

  const displayValue = gameState === 'crashed' ? (crashPoint ?? 1).toFixed(2) : multiplier.toFixed(2);
  const countdownText = (countdownMs / 1000).toFixed(1);

  const rocketPositionStyle = rocketRef.current ? { top: rocketRef.current.style.top, left: rocketRef.current.style.left } : {};

  return (
    <div className="bg-gradient-to-br from-[#0e1948] via-[#020024] to-[#001e3c] border-4 border-cyan-600/30 rounded-2xl shadow-2xl relative aspect-video min-h-[400px] overflow-hidden w-full">
      <div className="absolute inset-0 bg-space-stars z-0" />
      <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center pointer-events-none z-20">
        <div className={`text-7xl md:text-[8rem] font-black ${multiplierColor} drop-shadow-[0_0_30px_#00d4ff] transition-colors duration-500`}>{displayValue}x</div>
        <div className="mt-4 text-2xl md:text-4xl font-semibold text-cyan-200">
          {gameState === 'waiting' && <div className="text-blue-400 bg-gray-900/80 px-8 py-4 rounded-full border-2 border-blue-500/50 shadow-lg animate-pulse">LANZAMIENTO EN: <span className="font-mono text-5xl font-bold">{countdownText}s</span></div>}
          {gameState === 'crashed' && <div className="text-red-600 bg-gray-900/80 px-8 py-4 rounded-full border-2 border-red-500 shadow-lg animate-pulse">¡CRASH! 🚨</div>}
          {gameState === 'running' && <div className="text-neon-green bg-gray-900/80 px-8 py-4 rounded-full">COHETE EN ASCENSO</div>}
        </div>
      </div>
      <div
        ref={rocketRef}
        className="absolute bottom-0 left-0 w-24 h-24 flex items-center justify-center origin-bottom-left transition-transform z-40"
        style={{ transform: 'translate3d(-50%, 100%, 0) rotateZ(-45deg)', opacity: 0.2 }}>
        {gameState !== 'crashed' && rocketSVG}
      </div>
      {gameState === 'crashed' && (
        <div className="absolute w-64 h-64 pointer-events-none z-50" style={rocketPositionStyle}>
          <svg viewBox="0 0 200 200" className="w-full h-full">
            <circle cx="100" cy="100" r="0" fill="white" className="animate-flash" />
            <circle cx="100" cy="100" r="0" fill="none" stroke="#ffdd00" strokeWidth="2" className="animate-shockwave" style={{ animationDelay: '0s' }} />
            <circle cx="100" cy="100" r="0" fill="none" stroke="#ff8800" strokeWidth="2" className="animate-shockwave" style={{ animationDelay: '0.15s' }} />
            <circle cx="100" cy="100" r="0" fill="none" stroke="#ff4400" strokeWidth="2" className="animate-shockwave" style={{ animationDelay: '0.3s' }} />
          </svg>
        </div>
      )}
    </div>
  );
};

const CrashGame = () => {
  const { currentUser, userData, loading: authLoading } = useContext(AuthContext);
  const [userBalance, setUserBalance] = useState(0);
  const [game, setGame] = useState({ state: 'loading', roundId: null, crashPoint: null, startedAt: null, waitUntil: null });
  const [currentMultiplier, setCurrentMultiplier] = useState(1.0);
  const [playerBet, setPlayerBet] = useState(null);
  const [betAmount, setBetAmount] = useState('10.00');
  const [isProcessing, setIsProcessing] = useState(false);
  const [notification, setNotification] = useState({ message: '', type: '', key: 0 });
  const [livePlayers, setLivePlayers] = useState([]);
  const [recentRounds, setRecentRounds] = useState([]);
  const animationFrameId = useRef();
  const serverTimeOffset = useRef(0);

  const placeBetCallable = httpsCallable(functions, 'placeBet_crash');
  const cashOutCallable = httpsCallable(functions, 'cashOut_crash');

  const showNotification = (message, type = 'success') => {
    setNotification({ message, type, key: Date.now() });
  };

  useEffect(() => {
    if (!currentUser) return;
    const userRef = doc(db, 'users', currentUser.uid);
    const unsubUser = onSnapshot(userRef, (snap) => {
      if (snap.exists()) setUserBalance(snap.data().balance || 0);
    });

    const gameRef = doc(db, 'game_crash', 'live_game');
    const unsubGame = onSnapshot(gameRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setGame({
          state: data.gameState || 'waiting',
          roundId: data.roundId || null,
          crashPoint: data.crashPoint || null,
          startedAt: data.started_at || null,
          waitUntil: data.wait_until || data.next_round_at || null,
        });
        if (serverTimeOffset.current === 0 && data.server_time_now)
          serverTimeOffset.current = Date.now() - toMillis(data.server_time_now);
      }
    });

    const playersRef = collection(db, 'game_crash', 'live_game', 'players');
    const unsubPlayers = onSnapshot(playersRef, (snap) => {
      const playersData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setLivePlayers(playersData);
      const myBet = playersData.find(p => p.id === currentUser.uid);
      setPlayerBet(myBet || null);
    });

    const historyQuery = query(collection(db, 'game_crash_history'), orderBy('timestamp', 'desc'), limit(16));
    const unsubHistory = onSnapshot(historyQuery, (snap) => {
      setRecentRounds(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    return () => {
      unsubUser();
      unsubGame();
      unsubPlayers();
      unsubHistory();
    };
  }, [currentUser]);

  useEffect(() => {
    const animate = () => {
      const startedMs = toMillis(game.startedAt);
      if (game.state === 'running' && startedMs) {
        const elapsed = (Date.now() - serverTimeOffset.current) - startedMs;
        const newMultiplier = Math.max(1, Math.floor(100 * Math.exp(ROCKET_PATH_K * elapsed)) / 100);
        setCurrentMultiplier(newMultiplier);
        animationFrameId.current = requestAnimationFrame(animate);
      }
    };
    if (game.state === 'running') {
      animationFrameId.current = requestAnimationFrame(animate);
    } else {
      cancelAnimationFrame(animationFrameId.current);
      if (game.state === 'crashed') setCurrentMultiplier(game.crashPoint || 1.0);
      else setCurrentMultiplier(1.0);
    }
    return () => cancelAnimationFrame(animationFrameId.current);
  }, [game.state, game.startedAt, game.crashPoint]);

  // --- ACTION HANDLERS ---
  const handlePlaceBet = async () => {
    if (authLoading) return;
    if (!currentUser || !currentUser.uid) {
      showNotification('Debes iniciar sesión para apostar.', 'error');
      return;
    }
    if (isProcessing || game.state !== 'waiting' || !game.roundId) {
      showNotification('No se puede apostar en este momento.', 'error');
      return;
    }
    const amount = parseFloat(betAmount);
    if (isNaN(amount) || amount <= 0) {
      showNotification('Monto de apuesta inválido.', 'error');
      return;
    }
    if (amount > userBalance) {
      showNotification('Saldo insuficiente.', 'error');
      return;
    }
    setIsProcessing(true);
    try {
      await placeBetCallable({ amount, roundId: game.roundId });
      showNotification(`Apuesta de ${amount.toFixed(2)} Bs. aceptada.`);
    } catch (error) {
      showNotification('No se pudo apostar. Intenta de nuevo.', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCashOut = async () => {
    if (authLoading) return;
    if (!currentUser || !currentUser.uid) {
      showNotification('Debes iniciar sesión para retirar.', 'error');
      return;
    }
    if (isProcessing || game.state !== 'running' || !playerBet || playerBet.cashedOut) {
      showNotification('No se puede retirar ahora.', 'error');
      return;
    }
    setIsProcessing(true);
    try {
      const result = await cashOutCallable();
      const winAmount = result.data.winnings || 0;
      showNotification(`¡Retiro exitoso! Ganaste ${winAmount.toFixed(2)} Bs.`);
    } catch (error) {
      showNotification('No se pudo retirar. Intenta de nuevo.', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  // --- BUTTON LOGIC ---
  const canBet = game.state === 'waiting' && !playerBet && !!currentUser;
  const canCashOut = game.state === 'running' && playerBet && !playerBet.cashedOut && !!currentUser;

  let buttonAction = () => {};
  let buttonText = 'ESPERANDO LANZAMIENTO...';
  let buttonColor = 'bg-gray-700 cursor-not-allowed';

  if (canBet) {
    buttonAction = handlePlaceBet;
    buttonText = 'LANZAR COHETE';
    buttonColor = 'bg-blue-600 hover:bg-blue-500 animate-pulse-neon';
  } else if (canCashOut) {
    buttonAction = handleCashOut;
    const potentialWin = (currentMultiplier * (playerBet.bet || 0));
    buttonText = `RETIRAR ${potentialWin.toFixed(2)} Bs.`;
    buttonColor = 'bg-green-600 hover:bg-green-500 animate-pulse';
  } else if (playerBet?.cashedOut) {
    buttonText = `GANASTE ${playerBet.winnings?.toFixed(2) ?? '0.00'} Bs. 🚀`;
    buttonColor = 'bg-green-800 cursor-not-allowed';
  } else if (playerBet) {
    buttonText = 'APUESTA ACTIVA';
    buttonColor = 'bg-blue-700 cursor-not-allowed';
  }

  // --- PANELS ---
  const PlayersList = ({ players }) => (
    <div className="bg-gradient-to-br from-[#090979] via-[#212d3b] to-[#002244] border-2 border-blue-600/40 rounded-xl p-4 shadow-xl">
      <div className="flex items-center justify-between mb-4 border-b-2 border-blue-700/50 pb-2">
        <h3 className="text-2xl font-bold text-cyan-300">Astronautas en la ronda</h3>
        <span className="text-xl text-blue-400 font-bold font-mono">{players.length}</span>
      </div>
      <div className="max-h-72 overflow-y-auto custom-scrollbar">
        <table className="w-full text-sm md:text-base">
          <thead className="text-left text-cyan-400 sticky top-0 bg-[#212d3b] z-10">
            <tr>
              <th className="py-2 pr-2">Jugador</th>
              <th className="py-2 pr-2 text-right">Apuesta</th>
              <th className="py-2 pr-2 text-center">Retiro</th>
              <th className="py-2 pr-2 text-right">Ganancia</th>
            </tr>
          </thead>
          <tbody>
            {players.sort((a, b) => b.bet - a.bet).map((p) => {
              const isCashedOut = p.status === 'cashed_out';
              const isYou = currentUser?.uid === p.id;
              return (
                <tr key={p.id} className={`border-t border-blue-800/10 ${isCashedOut ? 'text-green-400' : 'text-white'} ${isYou ? 'bg-blue-900/30' : ''}`}>
                  <td className="py-2 pr-2 truncate max-w-[80px] text-blue-300 font-mono text-xs">{isYou ? 'TÚ' : (p.username || p.id.substring(0, 6))}</td>
                  <td className="py-2 pr-2 text-right font-mono">{p.bet?.toFixed(2) ?? '0.00'}</td>
                  <td className="py-2 pr-2 text-center">{isCashedOut ? <span className="px-2 py-1 rounded-full text-xs font-bold bg-green-900/50 border border-green-700/50">{p.cashOutMultiplier?.toFixed(2) ?? '1.00'}x</span> : <span className="text-gray-500">--</span>}</td>
                  <td className="py-2 pr-2 text-right font-mono">{isCashedOut ? `+${p.winnings?.toFixed(2) ?? '0.00'}` : 'En juego'}</td>
                </tr>
              );
            })}
            {players.length === 0 && (<tr><td colSpan={4} className="py-4 text-center text-cyan-500">Esperando astronautas...</td></tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );

  const HistoryBar = ({ rounds }) => (
    <div className="bg-gradient-to-br from-[#212d3b] to-[#002244] border-2 border-blue-600/30 rounded-xl p-3 flex items-center gap-3 overflow-x-auto shadow-xl">
      <h3 className="text-xl font-bold text-blue-400 flex-shrink-0 ml-1">Rondas previas:</h3>
      <div className="flex gap-3">
        {rounds.map((r) => {
          const cp = r.crashPoint || 0;
          const color =
            cp < 1.5 ? 'bg-red-800/50 text-red-300 border-red-700/50'
              : cp < 5 ? 'bg-yellow-600/50 text-yellow-200 border-yellow-700/50'
                : 'bg-green-800/50 text-green-300 border-green-700/50';
          return (
            <div key={r.id} className={`px-4 py-2 rounded-full border text-base font-extrabold whitespace-nowrap font-mono ${color}`}>
              {cp.toFixed(2)}x
            </div>
          );
        })}
      </div>
    </div>
  );

  // --- MAIN RENDER ---
  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white">
        <div className="text-2xl font-bold">Cargando sesión...</div>
      </div>
    );
  }
  if (!currentUser || !currentUser.uid) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white">
        <h2 className="text-3xl font-bold text-red-500 mb-4">🚫 Debes iniciar sesión para jugar Crash.</h2>
        <p className="text-lg text-gray-300">Inicia sesión para apostar y jugar.</p>
      </div>
    );
  }

  return (
    <div
      className="w-full min-h-screen font-sans relative"
      style={{
        background: COLORS.bgSpace,
        boxShadow: 'inset 0 0 120px #010a1a',
      }}
    >
      <style>{`
        .custom-scrollbar::-webkit-scrollbar{width:8px}
        .custom-scrollbar::-webkit-scrollbar-thumb{background-color:${COLORS.neonBlue};border-radius:10px}
        .custom-scrollbar::-webkit-scrollbar-track{background:#1f2937}
        @keyframes shake{0%,100%{transform:translateX(0)}10%,30%,50%,70%,90%{transform:translateX(-5px)}20%,40%,60%,80%{transform:translateX(5px)}}
        .animate-shake{animation:shake .6s cubic-bezier(.36,.07,.19,.97) both}
        @keyframes pulse-neon{0%,100%{box-shadow:0 0 20px #00d4ff,0 0 40px #39ff14}50%{box-shadow:0 0 30px #00d4ff,0 0 60px #39ff14}}
        .animate-pulse-neon{animation:pulse-neon 3s infinite}
        @keyframes pulse-slow{0%,100%{text-shadow:0 0 8px #00d4ff,0 0 16px #39ff14}50%{text-shadow:0 0 20px #39ff14,0 0 35px #00d4ff}}
        .animate-pulse-slow{animation:pulse-slow 3.5s infinite}

        /* --- Nuevas Animaciones --- */
        @keyframes flame {
          0%, 100% { transform: scaleY(1) translateY(0); }
          50% { transform: scaleY(1.2) translateY(5px); }
        }
        .flame { animation: flame 0.15s infinite; }

        @keyframes flash {
          0% { r: 0; opacity: 1; }
          50% { r: 100px; opacity: 0.5; }
          100% { r: 100px; opacity: 0; }
        }
        .animate-flash { animation: flash 0.5s ease-out forwards; }

        @keyframes shockwave {
          0% { r: 0; opacity: 1; }
          100% { r: 100px; opacity: 0; }
        }
        .animate-shockwave { animation: shockwave 0.7s ease-out forwards; }

        @keyframes move-stars-bg { from { background-position: 0 0; } to { background-position: -10000px 5000px; } }
        .bg-space-stars {
          background: transparent;
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 1;
        }
        .bg-space-stars::before, .bg-space-stars::after {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-image:
            radial-gradient(1px 1px at 20px 30px, #eee, rgba(0,0,0,0)),
            radial-gradient(1px 1px at 40px 70px, #fff, rgba(0,0,0,0)),
            radial-gradient(1px 1px at 50px 160px, #ddd, rgba(0,0,0,0)),
            radial-gradient(1px 1px at 90px 40px, #fff, rgba(0,0,0,0)),
            radial-gradient(2px 2px at 160px 100px, #fff, rgba(0,0,0,0)),
            radial-gradient(2px 2px at 40px 200px, #ddd, rgba(0,0,0,0)),
            radial-gradient(3px 3px at 180px 80px, #fff, rgba(0,0,0,0));
          background-repeat: repeat;
          background-size: 300px 300px;
          animation: move-stars-bg 200s linear infinite;
        }
        .bg-space-stars::after {
          background-size: 600px 600px;
          animation-duration: 400s;
          animation-direction: reverse;
        }
      `}</style>
      <NotificationBar key={notification.key} message={notification.message} type={notification.type} />

      {['admin', 'owner'].includes(userData?.role) && (
        <Link
          to="/admin/crash"
          className="absolute top-5 right-5 z-50 p-2 bg-gray-800/50 rounded-full hover:bg-blue-600/70 transition-colors"
          title="Panel de Administración de Crash"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </Link>
      )}

      <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
        <header className="mb-7 flex flex-col md:flex-row justify-between items-center bg-gradient-to-br from-[#001e3c] via-[#212d3b] to-[#002244] p-5 rounded-2xl border-4 border-blue-700/30 shadow-2xl">
          <h1 className="text-5xl md:text-6xl font-extrabold tracking-wide text-blue-400 drop-shadow-neon flex items-center gap-3">
            🚀 ASCENSO ESTELAR
            <span className="text-base md:text-xl font-bold text-cyan-200 ml-2">| NASA Neon</span>
          </h1>
          <div className="flex items-center gap-6 mt-4 md:mt-0">
            <div className="text-right">
              <div className="text-cyan-300 text-sm">{currentUser?.email}</div>
              <div className="text-white font-bold text-2xl md:text-3xl drop-shadow-neon-green">
                Bs. {userBalance.toLocaleString('es-VE', { minimumFractionDigits: 2 })}
              </div>
            </div>
            <p className="text-md text-blue-300 font-mono bg-blue-800/50 px-5 py-2 rounded-lg border border-blue-600/50">Ronda #{game.roundId ?? '...'}</p>
          </div>
        </header>
        <HistoryBar rounds={recentRounds} />
        <div className="grid grid-cols-1 lg:grid-cols-10 gap-8 mt-7">
          <div className="lg:col-span-7 order-1">
            <RocketDisplay
              gameState={game.state}
              multiplier={currentMultiplier}
              waitUntil={game.waitUntil}
              serverTimeOffset={serverTimeOffset.current}
              crashPoint={game.crashPoint}
            />
          </div>
          <div className="lg:col-span-3 order-2 space-y-7">
            <div className="bg-gradient-to-br from-[#212d3b] via-[#001e3c] to-[#090979] border-4 border-blue-700/20 rounded-2xl p-7 shadow-2xl space-y-5">
              <h3 className="text-3xl font-bold text-white mb-4 border-b-2 border-blue-700/30 pb-2">
                PANEL DE CONTROL DE MISIÓN
              </h3>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={betAmount}
                  onChange={(e) => setBetAmount(e.target.value)}
                  disabled={!canBet || isProcessing}
                  placeholder="0.00 Bs."
                  className="flex-1 bg-[#031436] border border-blue-600 rounded-lg px-4 py-3 text-2xl font-mono text-white focus:outline-none focus:ring-4 focus:ring-blue-400/50 disabled:opacity-60"
                />
              </div>
              <div className="grid grid-cols-4 gap-2 pt-3">
                {[1, 5, 10, 25, 50, 100].map(val => (
                  <button
                    key={val}
                    onClick={() => setBetAmount(v => (parseFloat(v) || 0) + val)}
                    disabled={!canBet}
                    className="px-3 py-3 text-base bg-[#142c4c] hover:bg-blue-700/80 rounded-lg transition disabled:opacity-50 font-bold shadow-md"
                  >
                    + {val}
                  </button>
                ))}
                <button
                  onClick={() => setBetAmount(v => (parseFloat(v) / 2).toFixed(2))}
                  disabled={!canBet}
                  className="px-3 py-3 text-base bg-[#142c4c] hover:bg-blue-700/80 rounded-lg transition disabled:opacity-50 font-bold"
                >
                  1/2
                </button>
                <button
                  onClick={() => setBetAmount(v => (parseFloat(v) * 2).toFixed(2))}
                  disabled={!canBet}
                  className="px-3 py-3 text-base bg-[#142c4c] hover:bg-blue-700/80 rounded-lg transition disabled:opacity-50 font-bold"
                >
                  2X
                </button>
              </div>
              <button
                onClick={buttonAction}
                disabled={isProcessing || (!canBet && !canCashOut)}
                className={`w-full px-6 py-5 rounded-xl font-black text-white uppercase text-xl transition-all ${buttonColor} shadow-xl disabled:opacity-60`}
              >
                {isProcessing ? 'PROCESANDO...' : buttonText}
              </button>
              <div className="mt-4 text-center text-sm text-blue-200 italic">
                “¡Prepárate para el lanzamiento estelar y retira antes del crash!”
              </div>
            </div>
            <PlayersList players={livePlayers} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default CrashGame;