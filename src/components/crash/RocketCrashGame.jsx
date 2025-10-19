import React, { useState, useEffect, useRef, useCallback, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import './RocketCrashGame.css';
import { db, functions } from '../../firebase';
import { httpsCallable } from 'firebase/functions';
import { doc, onSnapshot, collection, query, orderBy, limit, where } from 'firebase/firestore';
import { AuthContext } from '../../App';

const formatCurrency = (value) => {
    const number = Number(value) || 0;
    return new Intl.NumberFormat('es-VE', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(number);
};

const parseInputToNumber = (input) => {
    if (typeof input !== 'string' || !input) return 0;
    const standardized = input.replace(',', '.');
    const cleaned = standardized.replace(/[^0-9.]/g, '');
    const parts = cleaned.split('.');
    if (parts.length > 2) {
        const validNumberString = parts.slice(0, -1).join('') + '.' + parts[parts.length - 1];
        return parseFloat(validNumberString) || 0;
    }
    const number = parseFloat(cleaned);
    return isNaN(number) ? 0 : number;
};

const Header = ({ balance, onRulesClick }) => {
 const navigate = useNavigate();
 const { userData } = useContext(AuthContext);

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
                    <p id="balance" className="text-2xl font-bold text-green-400">{formatCurrency(balance)} VES</p>
                </div>
                {userData?.role === 'admin' && (
                  <button
                    onClick={() => navigate('/admin/crash')}
                    className="text-3xl p-2 rounded-full hover:bg-gray-700 transition-colors"
                  >
                    ⚙️
                  </button>
                )}
            </div>
        </div>
    </header>
  );
};

const HistoryPanel = ({ history }) => (
    <div className="panel p-4 flex-shrink-0">
        <h2 className="text-lg font-bold mb-3 border-b border-gray-700 pb-2">Historial de Rondas</h2>
        <div id="history-list" className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-3 gap-2">
            {history.map((crashPoint, index) => {
                let colorClass = '';
                let textShadowStyle = {};

                if (crashPoint < 3) { // 1.00x - 2.99x
                    colorClass = 'text-green-500';
                } else if (crashPoint < 10) { // 3.00x - 9.99x
                    colorClass = 'text-purple-400';
                    textShadowStyle = { textShadow: '0 0 5px rgba(192, 132, 252, 0.5)' }; // Soft purple glow
                } else { // 10.00x+
                    colorClass = 'text-red-500 font-bold'; // Make it bold too
                    textShadowStyle = { textShadow: '0 0 8px rgba(239, 68, 68, 0.7)' }; // Stronger red glow
                }
                return (
                    <span
                        key={index}
                        className={`bg-gray-800 px-3 py-1 rounded-md font-semibold text-center ${colorClass}`}
                        style={textShadowStyle} // Apply neon effect style
                    >
                        {formatCurrency(crashPoint)}x
                    </span>
                );
            })}
        </div>
    </div>
);

const ChatPanel = () => {
    const { currentUser } = useContext(AuthContext);
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const chatEndRef = useRef(null);

    useEffect(() => {
        const q = query(collection(db, "crash_chat"), orderBy("timestamp", "asc"));
        const unsubscribe = onSnapshot(q, (querySnapshot) => {
            const msgs = [];
            querySnapshot.forEach((doc) => {
                msgs.push({ id: doc.id, ...doc.data() });
            });
            setMessages(msgs);
        });
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    const handleSend = async () => {
        if (input.trim() && currentUser) {
            const tempInput = input;
            setInput('');
            try {
                const sendChatMessage = httpsCallable(functions, 'sendChatMessage');
                await sendChatMessage({ text: tempInput });
            } catch (error) {
                console.error("Error sending message:", error);
                setInput(tempInput);
            }
        }
    };

    return (
        <div className="panel p-4 flex flex-col flex-grow min-h-0">
            <h2 className="text-lg font-bold mb-3 border-b border-gray-700 pb-2">Chat de Jugadores</h2>
            <div id="chat-messages" className="flex-grow overflow-y-auto pr-2 space-y-3 text-sm">
                {messages.map((msg) => (
                    <div key={msg.id}><span className={`font-bold ${msg.userId === currentUser?.uid ? 'text-cyan-400' : 'text-purple-400'}`}>{msg.username}: </span><span>{msg.text}</span></div>
                ))}
                <div ref={chatEndRef} />
            </div>
            <div className="mt-4 flex">
                <input type="text" value={input} onChange={(e) => setInput(e.target.value)} onKeyPress={(e) => e.key === 'Enter' && handleSend()} placeholder="Escribe un mensaje..." className="bg-gray-900 border border-gray-700 rounded-l-md px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-cyan-500" />
                <button onClick={handleSend} className="bg-cyan-600 hover:bg-cyan-700 px-4 rounded-r-md font-semibold text-sm">Enviar</button>
            </div>
        </div>
    );
};


const GameScreen = ({ gameState, multiplier, countdown, rocketPosition, gridOffset, onConfettiTrigger }) => {
    const gridCanvasRef = useRef(null);
    const bgCanvasRef = useRef(null);
    const confettiCanvasRef = useRef(null);

    useEffect(() => {
        const canvas = bgCanvasRef.current; if (!canvas) return;
        const ctx = canvas.getContext('2d');
        let stars = []; let animationFrameId;
        const init = () => {
            const dpr = window.devicePixelRatio || 1;
            canvas.width = canvas.offsetWidth * dpr; canvas.height = canvas.offsetHeight * dpr;
            ctx.scale(dpr, dpr);
            stars = [];
            for (let i = 0; i < 200; i++) stars.push({ x: Math.random() * canvas.offsetWidth, y: Math.random() * canvas.offsetHeight, radius: Math.random() * 1.2 + 0.5, alpha: Math.random() * 0.5 + 0.5, twinkleSpeed: Math.random() * 0.015 });
        };
        const drawAndUpdate = () => {
            ctx.clearRect(0, 0, canvas.offsetWidth, canvas.offsetHeight);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            stars.forEach(star => {
                star.alpha += star.twinkleSpeed;
                if (star.alpha > 1 || star.alpha < 0.3) star.twinkleSpeed *= -1;
                if (gameState === 'running' && multiplier > 1.5) { star.y += 0.5; if (star.y > canvas.offsetHeight) { star.y = 0; star.x = Math.random() * canvas.offsetWidth; } }
                ctx.globalAlpha = star.alpha; ctx.beginPath(); ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2); ctx.fill();
            });
            ctx.globalAlpha = 1;
            animationFrameId = requestAnimationFrame(drawAndUpdate);
        };
        init(); drawAndUpdate();
        window.addEventListener('resize', init);
        return () => { cancelAnimationFrame(animationFrameId); window.removeEventListener('resize', init); };
    }, [gameState, multiplier]);

    const drawGrid = useCallback((yPixelOffset = 0) => {
        const canvas = gridCanvasRef.current; if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        canvas.width = canvas.offsetWidth * dpr; canvas.height = canvas.offsetHeight * dpr;
        ctx.scale(dpr, dpr);
        const width = canvas.offsetWidth; const height = canvas.offsetHeight;
        ctx.clearRect(0, 0, width, height);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)'; ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.font = '12px Poppins'; ctx.setLineDash([2, 4]);
        const yMultiplierRange = 1.0;
        const pixelsPerMultiplier = (height * 0.9) / yMultiplierRange;
        const startMultiplier = 1.0 + (yPixelOffset / pixelsPerMultiplier);
        const yStep = 0.25;
        const firstLineMultiplier = Math.floor(startMultiplier / yStep) * yStep;
        for (let i = 0; i < 7; i++) {
            const currentMultiplier = firstLineMultiplier + i * yStep; if (currentMultiplier < 1) continue;
            const yPos = height - ((currentMultiplier - startMultiplier) * pixelsPerMultiplier) - (height * 0.05);
            ctx.beginPath(); ctx.moveTo(0, yPos); ctx.lineTo(width, yPos); ctx.stroke();
            ctx.fillText(formatCurrency(currentMultiplier) + 'x', 10, yPos - 5);
        }
        for (let i = 1; i <= 5; i++) {
            const x = (i / 6) * width;
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
        }
    }, []);

    useEffect(() => {
        drawGrid(gridOffset);
        const handleResize = () => drawGrid(gridOffset);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [gridOffset, drawGrid]);

    useEffect(() => {
        if (onConfettiTrigger === 0) return;
        const canvas = confettiCanvasRef.current; const ctx = canvas.getContext('2d');
        let particles = []; let animationFrameId;
        const animate = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            particles.forEach((p, i) => {
                p.x += p.vx; p.y += p.vy; p.vy += 0.2; p.alpha -= 0.015;
                if (p.alpha <= 0) particles.splice(i, 1);
                ctx.globalAlpha = p.alpha; ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2); ctx.fill();
            });
            ctx.globalAlpha = 1;
            if (particles.length > 0) animationFrameId = requestAnimationFrame(animate); else ctx.clearRect(0, 0, canvas.width, canvas.height);
        };
        canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight;
        for (let i = 0; i < 100; i++) particles.push({ x: canvas.width / 2, y: canvas.height / 2, color: `hsl(${Math.random() * 360}, 100%, 75%)`, radius: Math.random() * 3 + 2, vx: (Math.random() - 0.5) * 15, vy: (Math.random() - 0.5) * 15 - 5, alpha: 1 });
        animate();
        return () => cancelAnimationFrame(animationFrameId);
    }, [onConfettiTrigger]);

    const showRoundElements = gameState === 'running' || gameState === 'crashed';

    return (
        <div className="game-screen flex flex-col items-center justify-center">
            <canvas ref={bgCanvasRef} id="background-canvas"></canvas>
            <canvas ref={confettiCanvasRef} id="confetti-canvas"></canvas>
            <canvas ref={gridCanvasRef} id="game-grid"></canvas>
            <div id="particle-container" className="absolute inset-0 z-5 pointer-events-none"></div>
            {gameState === 'waiting' && (<div id="game-status" className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/50 px-4 py-2 rounded-lg font-semibold z-30">Iniciando ronda en {countdown.toFixed(1)}s</div>)}
            {showRoundElements && <div id="multiplier-display" className={`multiplier ${gameState === 'crashed' ? 'crashed' : ''}`}>{formatCurrency(multiplier)}x</div>}
            {showRoundElements && <div id="rocket" style={{ left: `${rocketPosition.x}%`, bottom: `${rocketPosition.y}px`, opacity: gameState === 'crashed' ? 0 : 1 }} className={gameState === 'running' ? 'is-flying' : ''}>🚀</div>}
            {showRoundElements && <div id="explosion" style={{ left: `calc(${rocketPosition.x}% - 150px)`, top: `calc(100% - ${rocketPosition.y}px - 150px)` }} className={gameState === 'crashed' ? 'active' : ''}><svg className="explosion-svg" viewBox="0 0 200 200"><circle className="flash" cx="100" cy="100" r="100" /><g stroke="orange"><path className="spark" d="M100 100 L180 100" /><path className="spark" d="M100 100 L155 155" /><path className="spark" d="M100 100 L100 180" /><path className="spark" d="M100 100 L45 155" /><path className="spark" d="M100 100 L20 100" /><path className="spark" d="M100 100 L45 45" /><path className="spark" d="M100 100 L100 20" /><path className="spark" d="M100 100 L155 45" /></g></svg></div>}
        </div>
    );
};

const BetPanel = ({ onBet, onCancel, onCashout, onUpdateAutoCashout, gameState, currentBet, multiplier, isPlacingBet, limits, addToast, nextRoundBet, setNextRoundBet }) => {
    const [betAmountString, setBetAmountString] = useState('0,00');
    const [autoCashoutString, setAutoCashoutString] = useState('');
    
    const [isAutoBet, setIsAutoBet] = useState(false);
    const [isAutoCashout, setIsAutoCashout] = useState(false);
    
    const [betAmountError, setBetAmountError] = useState('');
    const [autoCashoutError, setAutoCashoutError] = useState('');

    const autoCashoutDebounceRef = useRef(null);

    const checkBetAmountValidity = useCallback((value) => {
        if (limits.minBet === null || limits.maxBet === null) return true;
        const amount = parseInputToNumber(value);
        return amount >= limits.minBet && amount <= limits.maxBet;
    }, [limits]);

    const checkAutoCashoutValidity = useCallback((value) => {
        if (!value) return true;
        const amount = parseInputToNumber(value);
        return amount >= 1.01;
    }, []);


    const validateBetAmount = useCallback((value) => {
        const isValid = checkBetAmountValidity(value);
        if (!isValid) {
            setBetAmountError(`Monto entre ${formatCurrency(limits.minBet)} y ${formatCurrency(limits.maxBet)}`);
        } else {
            setBetAmountError('');
        }
        return isValid;
    }, [limits, checkBetAmountValidity, formatCurrency]);

    const validateAutoCashout = useCallback((value) => {
         const isValid = checkAutoCashoutValidity(value);
         if (!value && isAutoCashout) {
             setAutoCashoutError('Este campo es requerido.');
             return false;
         } else if (value && !isValid) {
             setAutoCashoutError('Debe ser > 1.00x');
         } else {
             setAutoCashoutError('');
         }
         return isValid;
    }, [isAutoCashout, checkAutoCashoutValidity]);
    
    const handleAutoBetToggle = () => {
        if (isAutoBet) {
            setIsAutoBet(false);
            return;
        }
        
        const amount = parseInputToNumber(betAmountString);
        if (amount === 0) {
            addToast('El monto de la apuesta no puede ser cero.', 'error');
            setBetAmountError('El monto no puede ser cero.');
            return;
        }

        if (checkBetAmountValidity(betAmountString)) {
            setIsAutoBet(true);
            if (nextRoundBet) {
                setNextRoundBet(null);
                addToast('Apuesta para la siguiente ronda cancelada debido a la activación de Auto-Apuesta.', 'info');
            }
        } else {
            addToast('El monto de la apuesta es inválido para activar Auto-Apuesta.', 'error');
            validateBetAmount(betAmountString);
        }
    }
    
    const handleAutoCashoutToggle = () => {
        if (isAutoCashout) {
            setIsAutoCashout(false);
            return;
        }

        if (!autoCashoutString || autoCashoutString.trim() === '') {
             addToast('Debes introducir un multiplicador para el retiro automático.', 'error');
             setAutoCashoutError('Este campo es requerido.');
             return;
        }

        if (checkAutoCashoutValidity(autoCashoutString)) {
            setIsAutoCashout(true);
        } else {
             addToast('El multiplicador de auto-retiro es inválido.', 'error');
             validateAutoCashout(autoCashoutString);
        }
    }

    useEffect(() => {
        if (currentBet && currentBet.status === 'playing' && gameState === 'waiting') {
            
            if (autoCashoutDebounceRef.current) {
                clearTimeout(autoCashoutDebounceRef.current);
            }

            autoCashoutDebounceRef.current = setTimeout(() => {
                let targetValue = null;
                
                if (isAutoCashout) {
                    const isValid = checkAutoCashoutValidity(autoCashoutString);
                    if (isValid) {
                        const num = parseInputToNumber(autoCashoutString);
                        if (num >= 1.01) {
                            targetValue = num;
                        }
                    }
                }
                
                onUpdateAutoCashout(targetValue);

            }, 400);
        }

        return () => {
            if (autoCashoutDebounceRef.current) {
                clearTimeout(autoCashoutDebounceRef.current);
            }
        };
    
    }, [isAutoCashout, autoCashoutString, currentBet, gameState, onUpdateAutoCashout, checkAutoCashoutValidity]);

    useEffect(() => {
        if (gameState === 'waiting' && !currentBet && !isPlacingBet) {
            let betAmountNum = 0;
            let autoTarget = null;
            let placeThisBet = false;

            const isBetAmountCurrentlyValid = checkBetAmountValidity(betAmountString);
            const isAutoCashoutCurrentlyValid = checkAutoCashoutValidity(autoCashoutString);
            const autoCashoutNum = parseInputToNumber(autoCashoutString);

            if (isAutoBet && isBetAmountCurrentlyValid) {
                betAmountNum = parseInputToNumber(betAmountString);
                if (isAutoCashout && isAutoCashoutCurrentlyValid && autoCashoutNum > 1) {
                    autoTarget = autoCashoutNum;
                }
                placeThisBet = true;
            } else if (nextRoundBet) {
                betAmountNum = nextRoundBet.amount;
                if (isAutoCashout && isAutoCashoutCurrentlyValid && autoCashoutNum > 1) {
                    autoTarget = autoCashoutNum;
                } else {
                    autoTarget = nextRoundBet.autoCashoutTarget;
                }
                placeThisBet = true;
                setNextRoundBet(null);
            }

            if(placeThisBet && betAmountNum > 0) {
                onBet(betAmountNum, autoTarget);
            } else if (nextRoundBet) {
                setNextRoundBet(null);
                addToast("No se pudo colocar la apuesta preparada (datos inválidos).", "error");
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gameState, currentBet, isPlacingBet, isAutoBet, nextRoundBet, onBet, setNextRoundBet, addToast, isAutoCashout, autoCashoutString, betAmountString]);


    const handleQueueNextBet = () => {
        if (isAutoBet) {
            addToast('Desactiva la opción "Auto" para apostar manualmente en la siguiente ronda.', 'error');
            return;
        }
        const isBetValid = validateBetAmount(betAmountString);
        const isCashoutValid = validateAutoCashout(autoCashoutString);

        if (isBetValid && isCashoutValid) {
            const betAmountNum = parseInputToNumber(betAmountString);
            const autoCashoutNum = parseInputToNumber(autoCashoutString);
            const autoTarget = (isAutoCashout && autoCashoutNum > 1) ? autoCashoutNum : null;
            setNextRoundBet({ amount: betAmountNum, autoCashoutTarget: autoTarget });
            addToast(`Apuesta de ${formatCurrency(betAmountNum)} Bs. preparada para la siguiente ronda.`, 'info');
        } else {
             addToast('Verifica el monto y el multiplicador antes de preparar la apuesta.', 'error');
        }
    };

    const handleActionClick = (action) => {
        switch(action) {
            case 'cashout':
                onCashout();
                break;
            case 'cancel':
                if (isAutoBet) setIsAutoBet(false);
                onCancel();
                break;
            case 'bet':
                const isBetValid = validateBetAmount(betAmountString);
                const isCashoutValid = validateAutoCashout(autoCashoutString);
                if (isBetValid && isCashoutValid) {
                    const betAmountNum = parseInputToNumber(betAmountString);
                    const autoCashoutNum = parseInputToNumber(autoCashoutString);
                    const autoTarget = (isAutoCashout && autoCashoutNum > 1) ? autoCashoutNum : null;
                    onBet(betAmountNum, autoTarget);
                } else {
                    addToast('Verifica el monto y el multiplicador antes de apostar.', 'error');
                }
                break;
            case 'queueNext':
                handleQueueNextBet();
                break;
            case 'cancelNext':
                setNextRoundBet(null);
                addToast('Apuesta para la siguiente ronda cancelada.', 'info');
                break;
            default:
                break;
        }
    };
    
    const getButtonStates = useCallback(() => {
        const buttons = [];
        let mainButtonState = null;
        let nextRoundButtonState = null;

        const isBetAmountCurrentlyValid = checkBetAmountValidity(betAmountString);
        const isAutoCashoutCurrentlyValid = checkAutoCashoutValidity(autoCashoutString);


        if (currentBet) {
            if (currentBet.status === 'playing') {
                if (gameState === 'waiting') mainButtonState = { id: 'main', text: "CANCELAR APUESTA", className: "btn-cancel", disabled: false, action: 'cancel' };
                if (gameState === 'running') mainButtonState = { id: 'main', text: `RETIRAR ${formatCurrency((currentBet.bet || 0) * (multiplier || 1))} VES`, className: "btn-cashout", disabled: false, action: 'cashout' };
            } else if (currentBet.status === 'cashed_out') {
                mainButtonState = { id: 'main', text: `GANASTE ${formatCurrency(currentBet.winnings || 0)} VES`, className: "btn-success", disabled: true, action: 'none' };
            } else if (currentBet.status === 'lost') {
                mainButtonState = { id: 'main', text: `PERDISTE`, className: "btn-cancel", disabled: true, action: 'none' };
            }

            if (currentBet.status === 'cashed_out' || currentBet.status === 'lost') {
                 if (nextRoundBet) {
                     nextRoundButtonState = { id: 'next', text: "Cancelar Próx.", className: "btn-cancel", disabled: false, action: 'cancelNext' };
                 } else {
                     const canQueue = !isAutoBet && isBetAmountCurrentlyValid && isAutoCashoutCurrentlyValid;
                     nextRoundButtonState = { id: 'next', text: "Siguiente Ronda", className: "btn-queue", disabled: !canQueue, action: 'queueNext' };
                 }
            }
        } else if (isPlacingBet) {
             mainButtonState = { id: 'main', text: "Apostando...", className: "btn-play", disabled: true, action: 'none' };
        } else if (gameState === 'running' || gameState === 'crashed') {
            if (nextRoundBet) {
                mainButtonState = { id: 'main', text: "Cancelar Próx.", className: "btn-cancel", disabled: false, action: 'cancelNext' };
            } else {
                 const canQueue = !isAutoBet && isBetAmountCurrentlyValid && isAutoCashoutCurrentlyValid;
                mainButtonState = { id: 'main', text: "Siguiente Ronda", className: "btn-queue", disabled: !canQueue, action: 'queueNext' };
            }
        } else if (gameState === 'waiting') {
            mainButtonState = { id: 'main', text: "JUGAR", className: "btn-play", disabled: !(isBetAmountCurrentlyValid && isAutoCashoutCurrentlyValid), action: 'bet' };
        } else {
             mainButtonState = { id: 'main', text: "CARGANDO...", className: "btn-play", disabled: true, action: 'none' };
        }

        if(mainButtonState) buttons.push(mainButtonState);
        if(nextRoundButtonState) buttons.push(nextRoundButtonState);
        
        return buttons;

    }, [gameState, currentBet, multiplier, isPlacingBet, nextRoundBet, isAutoBet, betAmountString, autoCashoutString, checkBetAmountValidity, checkAutoCashoutValidity, formatCurrency]);


    const buttonStates = getButtonStates();
    const isBetAmountLocked = (!!currentBet && currentBet.status === 'playing') || !!nextRoundBet || isPlacingBet;
    const isAutoCashoutInputLocked = (!!currentBet && currentBet.status === 'playing' && gameState === 'running');


    const handleBetChange = (e) => {
        setBetAmountString(e.target.value);
        const isValid = validateBetAmount(e.target.value);
        if(!isValid && isAutoBet) setIsAutoBet(false);
    };

    const handleBetBlur = () => {
        const num = parseInputToNumber(betAmountString);
        const formatted = formatCurrency(num);
        setBetAmountString(formatted);
        const isValid = validateBetAmount(formatted);
         if(!isValid && isAutoBet) setIsAutoBet(false);
    };

    const handleCashoutChange = (e) => {
        setAutoCashoutString(e.target.value);
        const isValid = validateAutoCashout(e.target.value);
        if(!isValid && isAutoCashout) setIsAutoCashout(false);
    };

    const handleCashoutBlur = () => {
        const num = parseInputToNumber(autoCashoutString);
        const formatted = num > 1 ? formatCurrency(num) : '';
        setAutoCashoutString(formatted);
        const isValid = validateAutoCashout(formatted);
        if(!isValid && isAutoCashout) setIsAutoCashout(false);
    };
    
    return (
        <div className="bet-panel panel p-4 flex flex-col space-y-3">
            <div className="flex items-center gap-4">
                <div className="flex flex-col items-center pt-5"><label className="text-sm font-medium text-gray-400">Auto</label><div onClick={handleAutoBetToggle} className={`toggle-switch mt-1 ${isAutoBet ? 'active' : ''}`}><div className="toggle-switch-slider"></div></div></div>
                <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-400 mb-1">Monto de Apuesta</label>
                    <div className="relative"><span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">VES</span><input type="text" value={betAmountString} onChange={handleBetChange} onBlur={handleBetBlur} disabled={isBetAmountLocked} className={`bg-gray-900 border ${betAmountError ? 'border-red-500' : 'border-gray-700'} rounded-lg w-full py-2 pl-10 pr-4 disabled:opacity-50`} /></div>
                    {betAmountError && <p className="text-red-500 text-xs mt-1">{betAmountError}</p>}
                </div>
                <div className="grid grid-cols-3 gap-2 pt-5">{[10, 50, 100].map(p => <button key={p} onClick={() => { const newValue = parseInputToNumber(betAmountString) + p; setBetAmountString(formatCurrency(newValue)); validateBetAmount(String(newValue)); }} disabled={isBetAmountLocked} className="bg-gray-700 hover:bg-gray-600 rounded-md px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed">+{p}</button>)}</div>
            </div>
            <div className="flex items-center gap-4">
                <div className="flex flex-col items-center pt-5"><label className="text-sm font-medium text-gray-400">Auto</label><div onClick={!isAutoCashoutInputLocked ? handleAutoCashoutToggle : undefined} className={`toggle-switch mt-1 ${isAutoCashout ? 'active' : ''} ${isAutoCashoutInputLocked ? 'disabled' : ''}`}><div className="toggle-switch-slider"></div></div></div>
                <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-400 mb-1">Retiro Automático</label>
                    <div className="relative"><span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">@</span><input type="text" value={autoCashoutString} onChange={handleCashoutChange} onBlur={handleCashoutBlur} placeholder="2,00" disabled={isAutoCashoutInputLocked} className={`bg-gray-900 border ${autoCashoutError ? 'border-red-500' : 'border-gray-700'} rounded-lg w-full py-2 pl-7 pr-4 disabled:opacity-50`} /></div>
                    {autoCashoutError && <p className="text-red-500 text-xs mt-1">{autoCashoutError}</p>}
                </div>
                <div className="grid grid-cols-3 gap-2 pt-5">{[2, 5, 10].map(m => <button key={m} onClick={() => { setAutoCashoutString(formatCurrency(m)); validateAutoCashout(String(m)); }} disabled={isAutoCashoutInputLocked} className="bg-gray-700 hover:bg-gray-600 rounded-md px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed">{m}x</button>)}</div>
            </div>
            <div className="w-full mt-2 flex gap-2">
                 {buttonStates.map(state => (
                     <button 
                         key={state.id} 
                         onClick={() => handleActionClick(state.action)} 
                         disabled={state.disabled} 
                         className={`py-3 rounded-xl text-lg font-bold transition-all duration-300 ${state.className} ${buttonStates.length > 1 ? 'flex-1' : 'w-full'}`}
                     >
                         {state.text}
                     </button>
                 ))}
            </div>
        </div>
    );
};

const RightColumn = ({ myBets, activeBets, gameState }) => {
    const [activeTab, setActiveTab] = useState('active');
    const getStatusText = (bet) => {
        if (bet.status === 'cashed_out') return { text: `Retirado @ ${formatCurrency(bet.cashOutMultiplier || 1)}x`, color: 'text-green-400' };
        if (bet.status === 'lost') return { text: 'Perdió', color: 'text-red-400' };
        if (gameState === 'running' && bet.status === 'playing') return { text: 'En juego', color: 'text-yellow-400' };
        return { text: 'Esperando...', color: 'text-gray-400' };
    };
    return (
        <div className="right-column panel p-4 flex flex-col min-h-0"><div className="flex border-b border-gray-700 mb-2"><button onClick={() => setActiveTab('active')} className={`tab-button flex-1 py-2 font-semibold ${activeTab === 'active' ? 'active' : ''}`}>Apuestas Activas</button><button onClick={() => setActiveTab('my')} className={`tab-button flex-1 py-2 font-semibold ${activeTab === 'my' ? 'active' : ''}`}>Mis Apuestas</button></div>
            <div className={`flex-grow overflow-y-auto text-sm space-y-2 pr-2 ${activeTab !== 'active' ? 'hidden' : ''}`}>
                 {activeBets.map((bet) => { const status = getStatusText(bet); return ( <div key={bet.id} className="grid grid-cols-3 gap-2 items-center bg-gray-900/50 p-2 rounded-md"><span>{bet.username}</span><span className="text-right">{formatCurrency(bet.bet || 0)} VES</span><span className={`text-right font-semibold ${status.color}`}>{status.text}</span></div> ); })}
            </div>
            <div className={`flex-grow overflow-y-auto text-sm space-y-2 pr-2 ${activeTab !== 'my' ? 'hidden' : ''}`}>
                {myBets.map((bet) => {
                    const isWin = bet.status === 'cashed_out';
                    const isLoss = bet.status === 'lost';
                    let profitLossText;
                    let colorClass = 'text-gray-400';

                    if (isWin) {
                        profitLossText = `+ ${formatCurrency(bet.winnings || 0)}`;
                        colorClass = 'text-green-400';
                    } else if (isLoss) {
                        profitLossText = `- ${formatCurrency(bet.amount || 0)}`;
                        colorClass = 'text-red-400';
                    } else {
                        // Assuming any other status implies a loss or pending loss of the bet amount for history display
                        profitLossText = `- ${formatCurrency(bet.amount || 0)}`;
                        // Keep colorClass gray or decide based on more statuses if needed
                    }


                    return (
                        <div key={bet.id} className="grid grid-cols-3 gap-2 items-center bg-gray-900/50 p-2 rounded-md">
                            <span className={`font-semibold ${colorClass}`}>{profitLossText} VES</span>
                            <span className="text-center">@ {formatCurrency(bet.cashOutMultiplier || bet.crashPoint || 1)}x</span>
                            <span className="text-right text-gray-400">{bet.timestamp}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

const RulesModal = ({ isOpen, onClose, limits }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div className="panel max-w-4xl w-full max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center border-b border-gray-700 p-4"><h2 className="text-xl font-bold text-cyan-400">Reglas del Juego: UNIVERS CRASH</h2><button onClick={onClose} className="text-2xl hover:text-white">&times;</button></div>
                <div className="p-6 overflow-y-auto space-y-6 text-gray-300">
                    <div className="text-center space-y-2"><h3 className="text-2xl font-bold">CONSIGUE UNA EXPERIENCIA SUPER EMOCIONANTE</h3><p>Es fácil de jugar y divertido para los que se arriesgan.</p><p>Aquí tenemos a un Cohete volando. Varios jugadores realizan apuestas e intentan retirar el dinero antes de que el cohete explote (crash). Con el paso del tiempo, el multiplicador aumenta.</p><h4 className="text-3xl font-bold text-yellow-400 pt-2">¡Qué tengas suerte!</h4></div>
                    <div className="grid md:grid-cols-2 gap-6 text-sm">
                        <ul className="space-y-3 list-disc list-inside">
                            <li>La ganancia se calcula multiplicando el multiplicador recogido por el monto de tu apuesta.</li>
                            <li>El multiplicador mínimo es 1.00x y puede crecer teóricamente hasta 10000x.</li>
                            <li>Solo puedes realizar una apuesta por ronda.</li>
                            <li>Puedes cancelar tu apuesta en cualquier momento antes de que el cohete despegue (durante la fase de espera).</li>
                            <li>Puedes configurar tu apuesta manualmente y retirarla en cualquier momento durante el vuelo haciendo clic en "RETIRAR".</li>
                            <li>Puedes establecer un "Retiro Automático". Introduce un multiplicador (ej: 2.00) y activa "Auto". Tu apuesta se retirará automáticamente si se alcanza ese multiplicador.</li>
                            <li>Puedes activar la "Apuesta Automática" para repetir tu apuesta en cada ronda, hasta que la desactives.</li>
                        </ul>
                        <ul className="space-y-3 list-disc list-inside">
                            <li>Al hacer clic en el historial de rondas (panel izquierdo), podrás ver los últimos resultados.</li>
                            <li>En la sección "Mis Apuestas" puedes ver tu historial de apuestas personal.</li>
                            <li>En la sección "Apuestas Activas" puedes ver las apuestas de otros jugadores en la ronda actual.</li>
                            <li>Puedes activar o modificar tu retiro automático únicamente durante la fase de 'espera', antes de que comience la ronda.</li>
                            <li>Se recomienda usar la opción de "Retiro Automático" para asegurar tu ganancia en caso de problemas de conexión.</li>
                        </ul>
                    </div>
                    <div>
                        <h4 className="text-lg font-bold mb-2">Límites</h4>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-gray-900/50"><tr><th className="px-4 py-2">Moneda</th><th className="px-4 py-2">Mínima Apuesta</th><th className="px-4 py-2">Máxima Apuesta</th><th className="px-4 py-2">Límite Máximo de Ganancia</th></tr></thead>
                                <tbody>
                                    <tr className="border-t border-gray-700">
                                        <td className="px-4 py-2 font-bold">VES</td>
                                        <td className="px-4 py-2">{limits.minBet !== null ? formatCurrency(limits.minBet) : '...'}</td>
                                        <td className="px-4 py-2">{limits.maxBet !== null ? formatCurrency(limits.maxBet) : '...'}</td>
                                        <td className="px-4 py-2">{limits.maxProfit !== null ? formatCurrency(limits.maxProfit) : '...'}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                        <p className="text-xs text-gray-400 mt-2">Nota: La apuesta máxima puede ser reducida temporalmente si el sistema entra en modo de recuperación financiera.</p>
                    </div>
                     <div className="text-sm list-disc list-inside"><li>El juego opera con un Retorno Teórico al Jugador (RTP) objetivo del 95%. El sistema puede ajustar los resultados de las rondas para mantenerse cerca de este objetivo y asegurar la sostenibilidad del juego.</li></div>
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

const RocketCrashGame = () => {
    const { currentUser } = useContext(AuthContext);
    const [balance, setBalance] = useState(0);
    const [isRulesModalOpen, setRulesModalOpen] = useState(false);
    const [history, setHistory] = useState([]);
    const [myBets, setMyBets] = useState([]);
    const [activeBets, setActiveBets] = useState([]);
    const [toasts, setToasts] = useState([]);
    const [confettiTrigger, setConfettiTrigger] = useState(0);
    const [isPlacingBet, setIsPlacingBet] = useState(false);
    const [betLimits, setBetLimits] = useState({ minBet: null, maxBet: null, maxProfit: null });

    const [gameState, setGameState] = useState('stopped');
    const [gameStateData, setGameStateData] = useState(null);
    const [multiplier, setMultiplier] = useState(1.00);
    const [countdown, setCountdown] = useState(0);
    
    const [currentBet, setCurrentBet] = useState(null);
    const [nextRoundBet, setNextRoundBet] = useState(null);
    
    const [rocketPosition, setRocketPosition] = useState({ x: 10, y: 30 });
    const [gridOffset, setGridOffset] = useState(0);

    const animationFrameRef = useRef();
    const intervalsRef = useRef({});

    const addToast = useCallback((message, type = 'info') => {
        const id = Date.now() + Math.random();
        setToasts(prev => [...prev, { id, message, type }]);
        setTimeout(() => setToasts(current => current.filter(t => t.id !== id)), 3000);
    }, []);
    
    const handleCashout = useCallback(async () => {
        if (gameState !== 'running' || !currentBet || currentBet.status !== 'playing') return;
        
        try {
            const cashOutFunc = httpsCallable(functions, 'cashOut_crash');
            const result = await cashOutFunc();
            addToast(`¡Retiro exitoso de ${formatCurrency(result.data.winnings)} VES!`, 'success');
            setConfettiTrigger(Date.now());
        } catch (error) {
            console.error("Error al retirar:", error);
            addToast(error.message, 'error');
        }
    }, [gameState, currentBet, addToast]);
    
    useEffect(() => {
        if (!currentUser) return;
        const unsubUser = onSnapshot(doc(db, 'users', currentUser.uid), (doc) => { if (doc.exists()) setBalance(doc.data().balance || 0); });
        const unsubLimits = onSnapshot(doc(db, 'appSettings', 'crashLimits'), (doc) => { if (doc.exists()) setBetLimits(doc.data()); });

        return () => {
            unsubUser();
            unsubLimits();
        };
    }, [currentUser]);

    useEffect(() => {
        const q = query(collection(db, 'game_crash_history'), orderBy('timestamp', 'desc'), limit(15));
        const unsub = onSnapshot(q, (snapshot) => { setHistory(snapshot.docs.map(doc => doc.data().crashPoint || 1.00).reverse()); });
        return () => unsub();
    }, []);
    
    useEffect(() => {
        if (!currentUser?.uid) return;
        const q = query(collection(db, "crash_bets"), where("userId", "==", currentUser.uid), orderBy("timestamp", "desc"), limit(20));
        const unsub = onSnapshot(q, (snapshot) => {
            const betsData = snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    amount: data.amount,
                    status: data.status,
                    winnings: data.winnings || 0,
                    cashOutMultiplier: data.cashOutMultiplier || 1.00,
                    crashPoint: data.crashPoint || 1.00,
                    timestamp: data.timestamp?.toDate().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' }) || ''
                };
            });
            setMyBets(betsData);
        });
        return () => unsub();
    }, [currentUser]);

    useEffect(() => {
        const gameDocRef = doc(db, 'game_crash', 'live_game');
        const unsubGame = onSnapshot(gameDocRef, (snap) => {
            if (snap.exists()) {
                setGameStateData(snap.data());
            }
        });

        const playersRef = collection(db, 'game_crash', 'live_game', 'players');
        const unsubPlayers = onSnapshot(playersRef, (playersSnap) => {
            const betsData = playersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setActiveBets(betsData);
            if (currentUser) {
                const userBet = betsData.find(bet => bet.id === currentUser.uid);
                setCurrentBet(userBet || null);
            }
        });

        return () => {
            unsubGame();
            unsubPlayers();
        };
    }, [currentUser]);

    useEffect(() => {
        const cleanup = () => {
            clearInterval(intervalsRef.current.countdown);
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };

        if (!gameStateData) return cleanup;

        const remoteGameState = gameStateData.gameState;
        
        cleanup();

        if (remoteGameState === 'waiting') {
            setGameState('waiting');
            setMultiplier(1.00);
            setRocketPosition({ x: 10, y: 30 });
            setGridOffset(0);

            if (gameStateData.wait_until) {
                intervalsRef.current.countdown = setInterval(() => {
                    const timeLeft = gameStateData.wait_until.toMillis() - Date.now();
                    setCountdown(Math.max(0, timeLeft / 1000));
                }, 100);
            }
        } else if (remoteGameState === 'running') {
            setGameState('running');
            const { startedAtMs, animationDurationMs, crashPoint, rocketPathK } = gameStateData;
            
            if (!startedAtMs || !animationDurationMs || !crashPoint || !rocketPathK) return;
            
            const animate = () => {
                const elapsed = Date.now() - startedAtMs;
                const elapsedSeconds = elapsed / 1000;

                if (elapsed >= animationDurationMs) {
                    setMultiplier(crashPoint);
                    setGameState('crashed');
                    return;
                }
                
                const currentMultiplier = Math.exp(elapsedSeconds * rocketPathK);
                setMultiplier(Math.min(currentMultiplier, crashPoint));
                
                const gameScreen = document.querySelector('.game-screen');
                if (gameScreen) {
                    const pixelsPerMultiplier = (gameScreen.clientHeight * 0.9) / 1.0;
                    const totalTravelY = (currentMultiplier - 1) * pixelsPerMultiplier;
                    const scrollThreshold = gameScreen.clientHeight * 0.5;
                    
                    setRocketPosition({ 
                        x: 10 + Math.min(elapsedSeconds / 50, 1) * 65,
                        y: (gameScreen.clientHeight * 0.05) + Math.min(totalTravelY, scrollThreshold) 
                    });
                    setGridOffset(totalTravelY > scrollThreshold ? totalTravelY - scrollThreshold : 0);
                }

                animationFrameRef.current = requestAnimationFrame(animate);
            };
            animationFrameRef.current = requestAnimationFrame(animate);

        } else if (remoteGameState === 'crashed') {
            setGameState('crashed');
            if (gameStateData.crashPoint) {
                setMultiplier(gameStateData.crashPoint);
            }
        }
        
        return cleanup;
    }, [gameStateData]);
    
    const handleBet = async (amount, autoCashoutTarget) => {
        if (!currentUser || isPlacingBet || currentBet) {
             if (!currentBet) addToast('No se puede apostar en este momento.', 'error');
             return;
        }
        setIsPlacingBet(true);
        try {
            const placeBetFunc = httpsCallable(functions, 'placeBet_crash');
            await placeBetFunc({ amount, autoCashoutTarget });
        } catch (error) {
            console.error("Error al realizar la apuesta:", error);
            addToast(error.message, 'error');
        } finally {
            setIsPlacingBet(false);
        }
    };

    const handleUpdateAutoCashout = useCallback(async (targetValue) => {
        if (!currentBet || currentBet.status !== 'playing' || gameState !== 'waiting') {
            return;
        }
        try {
            const updateAutoCashoutFunc = httpsCallable(functions, 'updateAutoCashout_crash');
            await updateAutoCashoutFunc({ autoCashoutTarget: targetValue });
        } catch (error) {
            console.error("Error al actualizar auto-cashout:", error);
        }
    }, [currentBet, gameState]);
    
    const handleCancelBet = async () => {
        if (!currentBet || gameState !== 'waiting') {
            addToast("No se puede cancelar la apuesta ahora.", "error");
            return;
        }
        try {
            const cancelBetFunc = httpsCallable(functions, 'cancelBet_crash');
            await cancelBetFunc();
            addToast('Apuesta cancelada.', 'info');
        } catch (error) {
            console.error("Error al cancelar la apuesta:", error);
            addToast(error.message, 'error');
        }
    };

    return (
        <div className="bg-gray-900 text-white flex flex-col h-screen overflow-hidden">
            <ToastContainer toasts={toasts} />
            <Header balance={balance} onRulesClick={() => setRulesModalOpen(true)} />
            <main className="flex-grow min-h-0">
                <div className="main-grid">
                    <div className="left-column flex flex-col gap-6 min-h-0">
                        <HistoryPanel history={history} />
                        <ChatPanel />
                    </div>
                    <div className="center-column">
                        <div className="panel flex justify-center items-center px-4 py-2 text-sm text-gray-400">
                             <div className="flex flex-wrap justify-center gap-x-6 gap-y-2">
                                 <span>Apuesta mínima: <strong className="text-white">{betLimits.minBet !== null ? formatCurrency(betLimits.minBet) : '...'} VES</strong></span>
                                 <span>Apuesta máxima: <strong className="text-white">{betLimits.maxBet !== null ? formatCurrency(betLimits.maxBet) : '...'} VES</strong></span>
                                 <span>Max Profit: <strong className="text-white">{betLimits.maxProfit !== null ? formatCurrency(betLimits.maxProfit) : '...'} VES</strong></span>
                             </div>
                        </div>
                        <GameScreen gameState={gameState} multiplier={multiplier} countdown={countdown} rocketPosition={rocketPosition} gridOffset={gridOffset} onConfettiTrigger={confettiTrigger} />
                        <BetPanel 
                            onBet={handleBet} 
                            onCancel={handleCancelBet} 
                            onCashout={handleCashout} 
                            onUpdateAutoCashout={handleUpdateAutoCashout}
                            gameState={gameState} 
                            currentBet={currentBet} 
                            multiplier={multiplier} 
                            isPlacingBet={isPlacingBet} 
                            limits={betLimits} 
                            addToast={addToast} 
                            nextRoundBet={nextRoundBet} 
                            setNextRoundBet={setNextRoundBet} 
                        />
                    </div>
                    <RightColumn myBets={myBets} activeBets={activeBets} gameState={gameState} />
                </div>
            </main>
            <RulesModal isOpen={isRulesModalOpen} onClose={() => setRulesModalOpen(false)} limits={betLimits} />
        </div>
    );
};

export default RocketCrashGame;