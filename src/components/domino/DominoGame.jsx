/*
* filepath: DominoGame.jsx
*/
import React, { useState, useEffect, useContext, useRef, useMemo } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import './DominoGame.css';
import { db, functions } from '../../firebase';
import { AuthContext } from '../../App';
import {
    collection, query, orderBy, limit, onSnapshot,
    doc, updateDoc, getDoc
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

const formatCurrency = (value) => {
    const number = Number(value) || 0;
    return new Intl.NumberFormat('es-VE', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(number);
};

const DOMINO_CONSTANTS = {
    TARGET_SCORE_TOURNAMENT: 100,
    MAX_PLAYERS: 4,
};

const START_GAME_DELAY_SECONDS = 60;
const TURN_TIMEOUT_SECONDS = 30; // Default, backend puede sobreescribir
const PASS_TIMEOUT_SECONDS = 10; // Para referencia en frontend

const EMOJI_REACTIONS = ['😂', '😎', '😠', '😢', '🔥', '👍'];

// --- INICIO LÓGICA DE POSICIONAMIENTO DEL TABLERO (PETICIÓN 6, 1, 2) ---
const TILE_WIDTH_NORMAL = 70;
const TILE_HEIGHT_NORMAL = 35;
const TILE_WIDTH_DOUBLE = 35;
const TILE_HEIGHT_DOUBLE = 70;
const TILE_GAP = 5; // Espacio entre fichas
const BOARD_PADDING = 15; // Padding estético dentro del contenedor

/**
 * (Petición 2)
 * Función getValidMoves sincronizada con el backend (dominoEngine.js)
 * para evitar inconsistencias de UI.
 */
function getValidMoves(hand, board) {
    const validMoves = [];
    if (!hand || !Array.isArray(hand)) return [];
    if (!board || !Array.isArray(board) || board.length === 0) {
        hand.forEach((tile, index) => {
            if (tile) validMoves.push({ tileIndex: index, tile, position: 'start' });
        });
        return validMoves;
    }
    const firstTile = board[0];
    const lastTile = board[board.length - 1];
    // Se usa console.error en lugar de logger.error y se chequea la propiedad
    if (typeof firstTile?.top !== 'number' || typeof lastTile?.bottom !== 'number') {
        console.error("Board tiles missing or invalid top/bottom properties:", {first: firstTile, last: lastTile});
        return [];
    }
    const startValue = firstTile.top;
    const endValue = lastTile.bottom;

    hand.forEach((tile, index) => {
        // Se usa chequeo de tipo 'number' como en el backend
        if (!tile || typeof tile.top !== 'number' || typeof tile.bottom !== 'number') return;
        const canPlayStart = tile.top === startValue || tile.bottom === startValue;
        const canPlayEnd = tile.top === endValue || tile.bottom === endValue;
        if (canPlayStart) {
            validMoves.push({ tileIndex: index, tile, position: 'start' });
        }
        if (canPlayEnd && (!canPlayStart || startValue !== endValue)) {
            validMoves.push({ tileIndex: index, tile, position: 'end' });
        }
    });
    return validMoves;
}


/**
 * Calcula la posición (x, y, rotación) de cada ficha en el tablero, corrigiendo
 * la lógica de giros, alineación, espaciado y orientación de dobles.
 */
function calculateBoardLayout(board, containerWidth, containerHeight) {
    if (!board || board.length === 0 || containerWidth === 0) {
        return { layout: [], ends: { start: null, end: null } };
    }
    
    const chain = new Array(board.length);
    const midIndex = Math.floor(board.length / 2);
    const openerTile = board[midIndex];
    
    const limits = {
        minX: BOARD_PADDING,
        maxX: containerWidth - BOARD_PADDING,
        minY: BOARD_PADDING,
        maxY: containerHeight - BOARD_PADDING,
    };

    const getTileProps = (tile, dir) => {
        const isDouble = tile.top === tile.bottom;
        let w, h, rotation, orientationClass;
        
        const isHorizontalLine = dir[0] !== 0;

        if (isDouble) {
            // Doble en línea horizontal -> se pone Vertical (rotado 90)
            // Doble en línea vertical -> se pone Horizontal (rotado 0)
            w = isHorizontalLine ? TILE_WIDTH_DOUBLE : TILE_WIDTH_NORMAL;
            h = isHorizontalLine ? TILE_HEIGHT_DOUBLE : TILE_HEIGHT_NORMAL;
            rotation = isHorizontalLine ? 90 : 0;
            orientationClass = isHorizontalLine ? 'double' : 'normal';
        } else {
            // Normal en línea horizontal -> se pone Horizontal (rotado 0)
            // Normal en línea vertical -> se pone Vertical (rotado 90)
            w = isHorizontalLine ? TILE_WIDTH_NORMAL : TILE_WIDTH_DOUBLE;
            h = isHorizontalLine ? TILE_HEIGHT_NORMAL : TILE_HEIGHT_DOUBLE;
            rotation = isHorizontalLine ? 0 : 90;
            orientationClass = isHorizontalLine ? 'normal' : 'double';
        }

        return { w, h, rotation, isDouble, orientationClass };
    };
    
    const openerProps = getTileProps(openerTile, [1, 0]); // Opener siempre se considera en línea horizontal
    const midLayout = {
        tile: openerTile,
        x: containerWidth / 2,
        y: containerHeight / 2,
        ...openerProps,
    };
    chain[midIndex] = midLayout;

    // --- Crecer hacia el 'end' (derecha) ---
    let endHead = {
        x: midLayout.x,
        y: midLayout.y,
        dir: [1, 0], // Iniciar hacia la derecha
        prevLayout: midLayout,
    };

    for (let i = midIndex + 1; i < board.length; i++) {
        const tile = board[i];
        let { w, h, rotation, orientationClass, isDouble } = getTileProps(tile, endHead.dir);
        let prevLayout = endHead.prevLayout;
        
        let anchorX = endHead.x;
        let anchorY = endHead.y;
        
        const prevIsHorizontal = prevLayout.rotation === 0;
        const currentIsHorizontal = rotation === 0;

        // Ajustar ancla al borde correcto de la ficha anterior
        if (prevIsHorizontal) {
            anchorX += endHead.dir[0] * (prevLayout.w / 2);
        } else {
            anchorY += endHead.dir[1] * (prevLayout.h / 2);
        }

        let nextX = anchorX + endHead.dir[0] * (w / 2 + TILE_GAP);
        let nextY = anchorY + endHead.dir[1] * (h / 2 + TILE_GAP);

        const boundingBox = {
            left: nextX - w / 2, right: nextX + w / 2,
            top: nextY - h / 2, bottom: nextY + h / 2,
        };

        const willTurnRight = boundingBox.right > limits.maxX && endHead.dir[0] === 1;

        if (willTurnRight && isDouble) {
            const prevTileIndex = i - 1;
            if (chain[prevTileIndex]) {
                chain[prevTileIndex].y += TILE_HEIGHT_NORMAL / 3;
                endHead.y = chain[prevTileIndex].y;
                prevLayout = chain[prevTileIndex];
            }
        }

        if (willTurnRight) {
            endHead.dir = [0, -1]; // Girar hacia ARRIBA
            ({ w, h, rotation, orientationClass, isDouble } = getTileProps(tile, endHead.dir));

            anchorX = endHead.x + (prevLayout.w / 4);
            anchorY = endHead.y - (prevLayout.h / 2);

            nextX = anchorX;
            nextY = anchorY - (h / 2 + TILE_GAP);
        }
        
        const finalLayout = { tile, x: nextX, y: nextY, w, h, rotation, orientationClass, isDouble };
        chain[i] = finalLayout;
        endHead = { x: nextX, y: nextY, dir: endHead.dir, prevLayout: finalLayout };
    }
    
    // --- Crecer hacia el 'start' (izquierda) ---
    let startHead = {
        x: midLayout.x,
        y: midLayout.y,
        dir: [-1, 0],
        prevLayout: midLayout,
    };
    
    for (let i = midIndex - 1; i >= 0; i--) {
        const tile = board[i];
        let { w, h, rotation, orientationClass, isDouble } = getTileProps(tile, startHead.dir);
        let prevLayout = startHead.prevLayout;

        let anchorX = startHead.x;
        let anchorY = startHead.y;

        const prevIsHorizontal = prevLayout.rotation === 0;
        
        if (prevIsHorizontal) {
            anchorX += startHead.dir[0] * (prevLayout.w / 2);
        } else {
            anchorY += startHead.dir[1] * (prevLayout.h / 2);
        }

        let nextX = anchorX + startHead.dir[0] * (w / 2 + TILE_GAP);
        let nextY = anchorY + startHead.dir[1] * (h / 2 + TILE_GAP);
        
        const boundingBox = {
            left: nextX - w / 2, right: nextX + w / 2,
            top: nextY - h / 2, bottom: nextY + h / 2,
        };

        const willTurnLeft = boundingBox.left < limits.minX && startHead.dir[0] === -1;

        if (willTurnLeft && isDouble) {
            const prevTileIndex = i + 1;
            if (chain[prevTileIndex]) {
                chain[prevTileIndex].y += TILE_HEIGHT_NORMAL / 3;
                startHead.y = chain[prevTileIndex].y;
                prevLayout = chain[prevTileIndex];
            }
        }

        if (willTurnLeft) {
            startHead.dir = [0, 1]; // Girar hacia ABAJO
            ({ w, h, rotation, orientationClass, isDouble } = getTileProps(tile, startHead.dir));

            anchorX = startHead.x - (prevLayout.w / 4);
            anchorY = startHead.y + (prevLayout.h / 2);

            nextX = anchorX;
            nextY = anchorY + (h / 2 + TILE_GAP);
        }
        
        const finalLayout = { tile, x: nextX, y: nextY, w, h, rotation, orientationClass, isDouble };
        chain[i] = finalLayout;
        startHead = { x: nextX, y: nextY, dir: startHead.dir, prevLayout: finalLayout };
    }

    // --- Calcular extremos (Highlights) ---
    const startLayout = chain[0];
    const endLayout = chain[chain.length - 1];
    
    const getEndHighlightProps = (layoutTile, isStart) => {
        if (!layoutTile) return null;
        // (Petición 1/2 Fix) w, h, rotation son de la *ficha base* (70x35)
        const { x, y, w, h, rotation } = layoutTile; 
        const highlightW = 40;
        const highlightH = 80;
        let endRotation = (rotation === 90 || rotation === -90) ? 90 : 0;
        let offsetX = 0;
        let offsetY = 0;
        
        if (rotation === 90 || rotation === -90) { // Ficha Renderizada Vertical (base 70x35)
            // w = 70, h = 35. El offset es en el eje Y (del centro de la ficha base)
            offsetY = (isStart ? -1 : 1) * (w / 4); // Usar w (70)
        } else { // Ficha Renderizada Horizontal (base 70x35)
            // w = 70, h = 35. El offset es en el eje X
            // (Petición 2 Fix) rotation 180 fue eliminado, la lógica es simple.
            offsetX = (isStart ? -1 : 1) * (w / 4); // Usar w (70)
        }

        return { x: x + offsetX, y: y + offsetY, w: highlightW, h: highlightH, rotation: endRotation };
    };

    return {
        layout: chain,
        ends: {
            start: getEndHighlightProps(startLayout, true),
            end: getEndHighlightProps(endLayout, false)
        }
    };
}
// --- FIN LÓGICA DE POSICIONAMIENTO DEL TABLERO ---


const calculateRemainingTime = (startTime, durationSeconds) => {
    if (!startTime?.seconds) return durationSeconds;
    const now = Date.now() / 1000;
    const elapsed = now - startTime.seconds;
    return Math.max(0, Math.ceil(durationSeconds - elapsed));
};

const PlayerAvatar = ({ player, className, entryFee, gameData }) => {
    const { username, name = 'En espera', score = 0, avatar, flag = '🏳️', isTurn, currentReaction, isReady } = player || {};
    const displayName = username || name;
    const turnClass = isTurn ? 'isTurn' : '';
    const readyClass = isReady ? 'isReadyGlow' : '';

    return (
        <div className={`avatarContainer ${className || ''} ${isTurn ? 'isTurnContainer' : ''} ${!player ? 'waiting' : ''}`}>
            <div className={`avatarImageWrapper ${turnClass} ${readyClass}`}>
                <img src={avatar || '/default-avatar.png'} alt={displayName} className="avatarImage" />
                {currentReaction && (
                    <span className="playerReaction">{currentReaction}</span>
                )}
                 {/* Mostrar ✓ solo cuando está 'full' y antes de que inicie la primera ronda */}
                 {player && isReady && gameData?.status === 'full' && (!gameData.turnOrder || gameData.turnOrder.length === 0) && <span className="readyIndicator">✓</span>}
            </div>

            <div className="playerInfo">
                <div className="name">
                    <span className="flag">{flag}:</span> {displayName}
                </div>
                {player && (
                    <div className="balanceCount">
                        <span className="currencySymbol">VES</span>
                        {formatCurrency(entryFee)}
                    </div>
                )}
            </div>

            {player && <div className="scoreBadge">{score}</div>}
        </div>
    );
};

const Pips = ({ value }) => {
    const pips = [];
    const pipLayouts = {
        0: [], 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9],
    };

    if (pipLayouts[value] !== undefined) {
        pipLayouts[value].forEach((pos, index) => {
            pips.push(<div key={index} className={`pip pip-${pos}`}></div>);
        });
    }
    return <div className={`pipContainer pips-${value}`}>{pips}</div>;
};

const DominoTile = ({ topValue, bottomValue, isInHand = false, onClick, isDisabled = false, isPlayableHighlight = false, isSelectedHighlight = false, isDouble, className = '', orientationClass: propOrientationClass }) => {
    
    // (Petición 1/2 Fix) If in hand, use old logic (isDouble). If on board, use passed prop.
    const orientationClass = isInHand
        ? (isDouble ? 'double' : 'normal')
        : (propOrientationClass || 'normal'); // Fallback to 'normal'

    const safeTopValue = Number.isInteger(topValue) ? topValue : 0;
    const safeBottomValue = Number.isInteger(bottomValue) ? bottomValue : 0;
    const tileClasses = `tile ${isInHand ? 'inHand' : 'onBoard'} ${orientationClass} ${isDisabled ? 'disabled' : ''} ${isPlayableHighlight ? 'playableHighlight' : ''} ${isSelectedHighlight ? 'selectedHighlight' : ''} ${className}`;

    return (
        <div className={tileClasses} onClick={!isDisabled ? onClick : undefined}>
            <div className="half">
                <Pips value={safeTopValue} />
            </div>
            <div className="divider"></div>
            <div className="half">
                <Pips value={safeBottomValue} />
            </div>
        </div>
    );
};

const OpponentHand = ({ hand, position }) => {
    if (!hand || hand.length === 0) return null;
    const handClasses = `opponentHand ${position}`;

    return (
      <div className={handClasses}>
        {hand.map((tile, index) => (
          <div key={`opp-tile-${index}-${tile?.top ?? 'x'}-${tile?.bottom ?? 'y'}`} className="opponentTileWrapper">
            {tile && (
                <DominoTile
                topValue={tile.top}
                bottomValue={tile.bottom}
                isDouble={tile.top === tile.bottom}
                isInHand={true}
                className="opponentTile"
                isDisabled={true}
                />
            )}
          </div>
        ))}
      </div>
    );
};

function DominoGame() {
    const { gameId } = useParams();
    const navigate = useNavigate();
    const { currentUser } = useContext(AuthContext);
    const { search } = useLocation();
    const queryParams = new URLSearchParams(search);
    const isSpectator = queryParams.get('spectate') === 'true';

    const [gameData, setGameData] = useState(null);
    const [players, setPlayers] = useState({});
    const [myHand, setMyHand] = useState([]);
    const [messages, setMessages] = useState([]);
    const [chatInput, setChatInput] = useState('');
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [isEmojiPanelOpen, setIsEmojiPanelOpen] = useState(false);
    const [isMyPlayerReady, setIsMyPlayerReady] = useState(false);
    const chatMessagesEndRef = useRef(null);
    const [loadingAction, setLoadingAction] = useState(false);
    const [startCountdownRemaining, setStartCountdownRemaining] = useState(null);
    const [turnTimerRemaining, setTurnTimerRemaining] = useState(null);

    const [selectedTileInfo, setSelectedTileInfo] = useState(null);
    const [playableEnds, setPlayableEnds] = useState({ start: false, end: false });

    const [showPassButton, setShowPassButton] = useState(false);

    // --- INICIO ESTADO Y REF PARA TABLERO (PETICIÓN 6) ---
    const boardContainerRef = useRef(null);
    const [boardLimits, setBoardLimits] = useState({ width: 0, height: 0 });
    const [boardLayout, setBoardLayout] = useState([]);
    const [boardEnds, setBoardEnds] = useState({ start: null, end: null });

    // Efecto para medir el contenedor del tablero
    useEffect(() => {
        const container = boardContainerRef.current;
        if (!container) return;
        
        const resizeObserver = new ResizeObserver(entries => {
            if (entries[0]) {
                const { width, height } = entries[0].contentRect;
                setBoardLimits({ width, height });
            }
        });
        
        resizeObserver.observe(container);
        // Set initial size
        const { width, height } = container.getBoundingClientRect();
        if (width > 0 && height > 0) {
            setBoardLimits({ width, height });
        }

        return () => resizeObserver.disconnect();
    }, []);

    // Efecto para recalcular el layout del tablero cuando las fichas o el tamaño cambian
    useEffect(() => {
        if (!gameData?.board || boardLimits.width === 0) {
            setBoardLayout([]);
            setBoardEnds({ start: null, end: null });
            return;
        }
        
        const { layout, ends } = calculateBoardLayout(gameData.board, boardLimits.width, boardLimits.height);
        setBoardLayout(layout);
        setBoardEnds(ends);

    }, [gameData?.board, boardLimits]);
    // --- FIN ESTADO Y REF PARA TABLERO (PETICIÓN 6) ---


    useEffect(() => {
        if (!gameId) return;
        const gameDocRef = doc(db, "domino_tournament_games", gameId);

        const unsubscribeGame = onSnapshot(gameDocRef, (docSnap) => {
            if (docSnap.exists()) {
                const newData = docSnap.data();
                setGameData(newData);

                if (selectedTileInfo && (newData.currentTurn !== currentUser?.uid || newData.status !== 'playing')) {
                    setSelectedTileInfo(null);
                    setPlayableEnds({ start: false, end: false });
                }
            } else {
                console.error("Game not found!");
                alert("La partida ya no existe o ha finalizado.");
                setSelectedTileInfo(null);
                setPlayableEnds({ start: false, end: false });
                navigate('/domino');
            }
        }, (error) => {
            console.error("Error listening to game:", error);
        });

        const playersColRef = collection(db, "domino_tournament_games", gameId, "players");
        const unsubscribePlayers = onSnapshot(playersColRef, (snapshot) => {
            const playersMap = {};
            let foundMyHandData = false;
            snapshot.docs.forEach(doc => {
                const playerData = { id: doc.id, ...doc.data() };
                playersMap[doc.id] = playerData;
                if (doc.id === currentUser?.uid) {
                    setMyHand(playerData.hand || []);
                    setIsMyPlayerReady(playerData.isReady || false);
                    foundMyHandData = true;
                }
            });
            setPlayers(playersMap);
            if (!foundMyHandData && !isSpectator) {
                 setMyHand([]);
                 setIsMyPlayerReady(false);
            }
        }, (error) => {
             console.error("Error listening to players:", error);
        });

        return () => {
            unsubscribeGame();
            unsubscribePlayers();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gameId, currentUser, navigate, isSpectator]);

    useEffect(() => {
         if (!gameId) return;
        const q = query(collection(db, "domino_chat", gameId, "messages"), orderBy("timestamp", "desc"), limit(20));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const msgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setMessages(msgs.reverse());
        });
        return () => unsubscribe();
    }, [gameId]);

     useEffect(() => {

         if (isChatOpen) {
            chatMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
         }
     }, [messages, isChatOpen]);

    useEffect(() => {
        let startTimerId;
        let turnTimerId;

        if (gameData?.startCountdownAt && gameData.status === 'full') {
            const updateStartCountdown = () => {
                const remaining = calculateRemainingTime(gameData.startCountdownAt, START_GAME_DELAY_SECONDS);
                setStartCountdownRemaining(remaining);
                if (remaining > 0) {
                    startTimerId = setTimeout(updateStartCountdown, 1000);
                } else {
                     setStartCountdownRemaining(null);
                }
            };
            updateStartCountdown();
        } else {
            setStartCountdownRemaining(null);
        }

        if (gameData?.turnStartTime && gameData.status === 'playing' && gameData.currentTurn) {
            const updateTurnTimer = () => {

                const duration = gameData.turnTimeoutSeconds || TURN_TIMEOUT_SECONDS;
                const remaining = calculateRemainingTime(gameData.turnStartTime, duration);
                setTurnTimerRemaining(remaining);
                if (remaining > 0) {
                    turnTimerId = setTimeout(updateTurnTimer, 1000);
                } else {
                     setTurnTimerRemaining(null);

                }
            };
            updateTurnTimer();
        } else {
            setTurnTimerRemaining(null);
        }

        return () => {
            clearTimeout(startTimerId);
            clearTimeout(turnTimerId);
        };
    }, [gameData]);


    const handleSendChat = async (e) => {
         e.preventDefault();
        const trimmedInput = chatInput.trim();
        const myUsername = players[currentUser?.uid]?.username || 'Jugador';
        if (!trimmedInput || !currentUser || !myUsername || !gameId || isSpectator) return;
        setChatInput('');
        try {
            const sendMessageFunc = httpsCallable(functions, 'sendDominoMessage');
            await sendMessageFunc({ gameId: gameId, text: trimmedInput });
        } catch (error) {
            console.error("Error sending chat:", error);
            setChatInput(trimmedInput);
            alert(`Error al enviar mensaje: ${error.message}`);
        }
    };

    const handleSendReaction = async (emoji) => {
        if (!currentUser || !gameId || isSpectator) return;
        setIsEmojiPanelOpen(false);
        const playerDocRef = doc(db, "domino_tournament_games", gameId, "players", currentUser.uid);
        const currentReaction = players[currentUser.uid]?.currentReaction;
        try {

            setPlayers(prev => ({ ...prev, [currentUser.uid]: { ...(prev[currentUser.uid] || {}), currentReaction: emoji } }));
            await updateDoc(playerDocRef, { currentReaction: emoji });

            setTimeout(async () => {
                try {

                    const playerSnap = await getDoc(playerDocRef);
                    if (playerSnap.exists() && playerSnap.data().currentReaction === emoji) {
                         await updateDoc(playerDocRef, { currentReaction: null });

                    }
                } catch (error) {
                    console.error("Error clearing reaction:", error);
                }
            }, 3000);
        } catch (error) {
            console.error("Error sending reaction:", error);

             setPlayers(prev => ({ ...prev, [currentUser.uid]: { ...(prev[currentUser.uid] || {}), currentReaction: currentReaction } }));
            alert(`Error al enviar reacción: ${error.message}`);
        }
    };

    const handleToggleReady = async () => {
        // (Petición 1) La guarda principal está aquí, la condición de render es más simple.
        if (!currentUser || !gameId || gameData?.status !== 'full' || isSpectator || loadingAction) return;
        setLoadingAction(true);
        try {
            const toggleReadyFunc = httpsCallable(functions, 'handleReadyToggle');
            await toggleReadyFunc({ gameId: gameId });

        } catch (error) {
            console.error("Error toggling ready:", error);
            alert(`Error al marcar listo: ${error.message}`);
        } finally {
            setLoadingAction(false);
        }
    };

    const executePlayTile = async (tile, position) => {
        setLoadingAction(true);
        setSelectedTileInfo(null);
        setPlayableEnds({ start: false, end: false });
        try {
            const playTileFunc = httpsCallable(functions, 'playDominoTile');
            await playTileFunc({ gameId: gameId, tile: tile, position: position });
        } catch (error) {
            console.error(`Error playing tile at ${position}:`, error);
            alert(`Error al jugar ficha: ${error.message}`);
        } finally {
            setLoadingAction(false);
        }
    };

    const handleTileClick = (clickedTile, indexInHand) => {
        if (!currentUser || !gameId || gameData?.currentTurn !== currentUser?.uid || loadingAction || isSpectator || gameData.status !== 'playing') return;

        // (Petición 3a) Validar primera jugada 6/6
        const scores = gameData.scores || {};
        const isFirstRound = Object.values(scores).every(s => s === 0);
        if (isFirstRound && (gameData.board || []).length === 0) {
            const hasSixDouble = myHand.some(t => t.top === 6 && t.bottom === 6);
            if (hasSixDouble && (clickedTile.top !== 6 || clickedTile.bottom !== 6)) {
                alert("Debes salir con el doble 6.");
                return;
            }
        }

        if (selectedTileInfo?.index === indexInHand) {
            setSelectedTileInfo(null);
            setPlayableEnds({ start: false, end: false });
            return;
        }

        const movesForThisTile = getValidMoves([clickedTile], gameData.board).map(move => move.position);

        if (movesForThisTile.length === 0) return;

        if (movesForThisTile.length === 1) {
            setSelectedTileInfo(null);
            setPlayableEnds({ start: false, end: false });
            executePlayTile(clickedTile, movesForThisTile[0]);
        } else if (movesForThisTile.length === 2) {
            setSelectedTileInfo({ tile: clickedTile, index: indexInHand });
            setPlayableEnds({
                start: movesForThisTile.includes('start'),
                end: movesForThisTile.includes('end')
            });
        }
    };

    const handleBoardEndClick = (position) => {
        if (!selectedTileInfo || !playableEnds[position]) return;
        executePlayTile(selectedTileInfo.tile, position);
    };


    const handlePassTurn = async () => {
        if (!currentUser || !gameId || gameData?.currentTurn !== currentUser?.uid || loadingAction || isSpectator || selectedTileInfo) return;

        // (Petición 3a) Validar pase 6/6
        const scores = gameData.scores || {};
        const isFirstRound = Object.values(scores).every(s => s === 0);
        if (isFirstRound && (gameData.board || []).length === 0) {
            const hasSixDouble = myHand.some(t => t.top === 6 && t.bottom === 6);
            if (hasSixDouble) {
                alert("No puedes pasar, debes salir con el doble 6.");
                return;
            }
        }

        const moves = getValidMoves(myHand, gameData?.board);
        if (moves.length > 0) {
             console.warn("Intento de pasar con jugadas válidas.");
             alert("Tienes jugadas disponibles, no puedes pasar.");
             return;
        }

        setLoadingAction(true);
        try {
            const passTurnFunc = httpsCallable(functions, 'passDominoTurn');
            await passTurnFunc({ gameId: gameId });
        } catch (error) {
            console.error("Error passing turn:", error);
            alert(`Error al pasar turno: ${error.message}`);
        } finally {
            setLoadingAction(false);
        }
    };

    const { playableTileIndices } = useMemo(() => {
        // (Petición 3a) Lógica para botón de pasar (considerando 6/6)
        let hasNoMoves = false;
        let canPass = false;
        if (myHand && gameData?.board) {
            const moves = getValidMoves(myHand, gameData.board);
            hasNoMoves = moves.length === 0;

            const scores = gameData.scores || {};
            const isFirstRound = Object.values(scores).every(s => s === 0);
            if (isFirstRound && gameData.board.length === 0) {
                const hasSixDouble = myHand.some(t => t.top === 6 && t.bottom === 6);
                canPass = hasNoMoves && !hasSixDouble; // Solo puede pasar si NO tiene 6/6
            } else {
                canPass = hasNoMoves;
            }
        }
        
        const shouldShow = gameData?.status === 'playing' &&
                           gameData.currentTurn === currentUser?.uid &&
                           !isSpectator &&
                           !selectedTileInfo &&
                           canPass; // Usar la nueva variable 'canPass'
        setShowPassButton(shouldShow);

        if (gameData?.status !== 'playing' || gameData.currentTurn !== currentUser?.uid || !gameData?.board || isSpectator || !myHand || selectedTileInfo) {
            return { playableTileIndices: new Set() };
        }

        const moves = getValidMoves(myHand, gameData.board);
        const indices = new Set(moves.map(m => m.tileIndex));
        
        // (Petición 3a) Si es la primera ronda y tiene 6/6, solo esa es jugable
        const scores = gameData.scores || {};
        const isFirstRound = Object.values(scores).every(s => s === 0);
        if (isFirstRound && gameData.board.length === 0) {
            let sixDoubleIndex = -1;
            for (let i = 0; i < myHand.length; i++) {
                if (myHand[i]?.top === 6 && myHand[i]?.bottom === 6) {
                    sixDoubleIndex = i;
                    break;
                }
            }
            if (sixDoubleIndex !== -1) {
                // Solo el 6/6 es jugable
                return { playableTileIndices: new Set([sixDoubleIndex]) };
            }
        }

        return { playableTileIndices: indices };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gameData, myHand, currentUser, isSpectator, selectedTileInfo]);


    const playerPositions = ['playerBottom', 'playerLeft', 'playerTop', 'playerRight'];
    let playerSlots = playerPositions.map(pos => ({ position: pos, player: null, isTurn: false }));


    if (gameData?.status && gameData.status !== 'finished' && Object.keys(players).length > 0) {
        const maxPlayers = gameData.maxPlayers || DOMINO_CONSTANTS.MAX_PLAYERS;
        if (gameData.turnOrder && gameData.turnOrder.length === maxPlayers) {
            const turnOrder = gameData.turnOrder;
            let myIndex = 0;

            if (currentUser && !isSpectator) {
                const idx = turnOrder.indexOf(currentUser.uid);
                if (idx !== -1) {
                    myIndex = idx;
                } else {
                    console.warn("Jugador actual no encontrado en turnOrder establecido.");
                }
            }
            
            // (Petición 3c) Reconstrucción de UI anti-horaria
            // El backend define el turnOrder (ej: [P1, P2, P3, P4])
            // P1 es el líder. El turno va P1 -> P4 -> P3 -> P2
            // Si yo soy P1 (myIndex 0), el orden en UI debe ser:
            // Bottom: P1 (yo)
            // Right: P2 (siguiente en turnOrder)
            // Top: P3 (siguiente)
            // Left: P4 (siguiente)
            
            const uiOrder = new Array(maxPlayers).fill(null);
            if (maxPlayers === 4) {
                uiOrder[0] = turnOrder[myIndex]; // Yo (Bottom)
                uiOrder[1] = turnOrder[(myIndex + 1) % maxPlayers]; // Derecha (playerRight)
                uiOrder[2] = turnOrder[(myIndex + 2) % maxPlayers]; // Arriba (playerTop)
                uiOrder[3] = turnOrder[(myIndex + 3) % maxPlayers]; // Izquierda (playerLeft)
            
                // Mapeo a slots de UI
                const rotatedPlayerSlots = [];
                rotatedPlayerSlots[0] = { pos: 'playerBottom', playerId: uiOrder[0] }; // Yo
                rotatedPlayerSlots[1] = { pos: 'playerLeft', playerId: uiOrder[3] }; // Izquierda
                rotatedPlayerSlots[2] = { pos: 'playerTop', playerId: uiOrder[2] }; // Arriba
                rotatedPlayerSlots[3] = { pos: 'playerRight', playerId: uiOrder[1] }; // Derecha
                
                playerSlots = rotatedPlayerSlots.map(slot => {
                    const player = slot.playerId ? players[slot.playerId] : null;
                    let currentScore = player?.score ?? 0;
                    if (gameData.scores) {
                        currentScore = gameData.scores[player?.team || player?.id] ?? currentScore;
                    }
                    return { ...(player || {}), position: slot.pos, isTurn: gameData.currentTurn === slot.playerId, isReady: player?.isReady || false, score: currentScore };
                });

            } else {
                // Fallback para < 4 jugadores (usando la lógica original horario)
                const rotatedTurnOrder = [...turnOrder.slice(myIndex), ...turnOrder.slice(0, myIndex)];
                playerSlots = playerPositions.slice(0, maxPlayers).map((pos, index) => {
                    const playerId = rotatedTurnOrder[index];
                    const player = playerId ? players[playerId] : null;
                    let currentScore = player?.score ?? 0;
                    if (gameData.scores) {
                        currentScore = gameData.scores[player?.team || player?.id] ?? currentScore;
                    }
                    return { ...(player || {}), position: pos, isTurn: gameData.currentTurn === playerId, isReady: player?.isReady || false, score: currentScore };
                });
            }

        }
        else {
            // Lógica de llenado de sala (pre-turnOrder)
            const playerList = Object.values(players);
            const slots = new Array(maxPlayers).fill(null);
            let me = null;
            let myTeam = null;
            const partners = [];
            const opponents = [];


            if (currentUser && !isSpectator) {
                 me = playerList.find(p => p.id === currentUser.uid);
                 if (me) myTeam = me.team;
            }


            if (me && gameData.type === '2v2') {
                playerList.forEach(player => {
                    if (player.id === me.id) return;
                    if (player.team === myTeam) partners.push(player);
                    else opponents.push(player);
                });

                opponents.sort((a,b)=>(a.joinedAt?.toMillis() || 0) - (b.joinedAt?.toMillis() || 0));
                partners.sort((a,b)=>(a.joinedAt?.toMillis() || 0) - (b.joinedAt?.toMillis() || 0));

                // (Petición 3c) Mapeo anti-horario 2v2
                slots[0] = me; // Bottom
                slots[1] = opponents[0] || null; // Right
                slots[2] = partners[0] || null; // Top
                slots[3] = opponents[1] || null; // Left
                
                playerSlots = [
                     { ...(slots[0] || {}), position: 'playerBottom', isTurn: false, isReady: slots[0]?.isReady || false },
                     { ...(slots[3] || {}), position: 'playerLeft', isTurn: false, isReady: slots[3]?.isReady || false },
                     { ...(slots[2] || {}), position: 'playerTop', isTurn: false, isReady: slots[2]?.isReady || false },
                     { ...(slots[1] || {}), position: 'playerRight', isTurn: false, isReady: slots[1]?.isReady || false },
                ];
            }
            else {
                // Lógica 1v1v1v1
                let sortedPlayerList = [...playerList].sort((a,b)=>(a.joinedAt?.toMillis() || 0) - (b.joinedAt?.toMillis() || 0));

                if (me) {
                    const myIndex = sortedPlayerList.findIndex(p => p.id === me.id);
                    if (myIndex > 0) {
                        sortedPlayerList = [...sortedPlayerList.slice(myIndex), ...sortedPlayerList.slice(0, myIndex)];
                    }
                }
                for (let i = 0; i < maxPlayers; i++) {
                   if (sortedPlayerList[i]) slots[i] = sortedPlayerList[i];
                }
                
                // (Petición 3c) Mapeo anti-horario para 4 jugadores (1v1v1v1)
                if (maxPlayers === 4) {
                     const rotatedPlayerSlots = [];
                     rotatedPlayerSlots[0] = { pos: 'playerBottom', player: slots[0] }; // Yo
                     rotatedPlayerSlots[1] = { pos: 'playerLeft', player: slots[3] }; // Izquierda
                     rotatedPlayerSlots[2] = { pos: 'playerTop', player: slots[2] }; // Arriba
                     rotatedPlayerSlots[3] = { pos: 'playerRight', player: slots[1] }; // Derecha
                     
                     playerSlots = rotatedPlayerSlots.map(slot => {
                         const player = slot.player;
                         return { ...(player || {}), position: slot.pos, isTurn: false, isReady: player?.isReady || false };
                     });
                }
                else {
                    // Fallback (lógica original)
                    playerSlots = playerPositions.slice(0, maxPlayers).map((pos, index) => {
                        const player = slots[index];
                        return { ...(player || {}), position: pos, isTurn: false, isReady: player?.isReady || false };
                    });
                }
            }
        }
    }


    const currentPlayerCount = Object.keys(players).length;
    const requiredPlayers = gameData?.maxPlayers || DOMINO_CONSTANTS.MAX_PLAYERS;

    const getWinnerNames = () => {
        if (!gameData || gameData.status !== 'finished') return null;
        if (gameData.type === '2v2' && gameData.winningTeam) {
            return Object.values(players)
                .filter(p => p.team === gameData.winningTeam)
                .map(p => p.username || 'Jugador')
                .join(' y ');
        } else if (gameData.winner) {
            return players[gameData.winner]?.username || 'Jugador';
        }
        return '¿Empate?';
    };
    const winnerNames = getWinnerNames();


    return (
        <div className="gameContainer">
            <div className="topBar">
                 <div>{gameData?.name || `Torneo ${gameId?.substring(0, 6)}`} - Meta: {DOMINO_CONSTANTS.TARGET_SCORE_TOURNAMENT} Pts</div>
                 {turnTimerRemaining !== null && gameData?.currentTurn && (
                      <div className="turnTimerDisplay">
                           Turno: {players[gameData.currentTurn]?.username || '?'} ({turnTimerRemaining}s)
                           {gameData.turnTimeoutSeconds === PASS_TIMEOUT_SECONDS && <span className='passIndicator'>(P)</span>}
                      </div>
                 )}
                 <div className="topRightInfo">
                      <div>Pozo: {formatCurrency(gameData?.prizePoolVES || 0)} VES</div>
                 </div>
            </div>

            <div className="playersArea">
                {playerSlots.map((playerInfo, index) => (
                    <React.Fragment key={playerInfo?.id || `slot-${index}`}>
                        <PlayerAvatar
                            player={playerInfo}
                            className={playerInfo?.position || playerPositions[index]}
                            entryFee={gameData?.entryFeeVES}
                            gameData={gameData}
                        />
                        {gameData?.status === 'round_over' && playerInfo.id && playerInfo.id !== currentUser?.uid && (
                          <OpponentHand
                            hand={players[playerInfo.id]?.hand}
                            position={playerInfo?.position || playerPositions[index]}
                          />
                        )}
                    </React.Fragment>
                ))}
            </div>

             <div className="gameBoard">
                 {gameData?.status === 'waiting' && currentPlayerCount < requiredPlayers && (
                      <div className="waitingMessage">Esperando jugadores... {currentPlayerCount}/{requiredPlayers}</div>
                 )}
                 {gameData?.status === 'waiting' && currentPlayerCount === requiredPlayers && (!gameData.turnOrder || gameData.turnOrder.length === 0) && (
                      <div className="waitingMessage">Esperando jugadores... {currentPlayerCount}/{requiredPlayers}</div>
                 )}
                 {gameData?.status === 'full' && startCountdownRemaining !== null && (
                      <div className="waitingMessage countdownMessage">Iniciando en: {startCountdownRemaining}s</div>
                 )}
                  {/* Condición ajustada para "Esperando listos" */}
                  {gameData?.status === 'full' && startCountdownRemaining === null && (!gameData.turnOrder || gameData.turnOrder.length === 0) && !Object.values(players).every(p => p.isReady) && (
                      <div className="waitingMessage">Esperando que todos estén listos...</div>
                 )}
                 {gameData?.status === 'round_over' && (
                      <div className="waitingMessage">Ronda terminada. Siguiente ronda iniciando...</div>
                 )}
                 {gameData?.status === 'finished' && (
                     <div className="gameOverOverlay">
                         <div className="gameOverContent">
                             <h2>¡Partida Finalizada!</h2>
                             <p className="winnerAnnouncement">
                                 {gameData.type === '2v2' ? 'Equipo Ganador:' : 'Ganador:'}
                                 <br />
                                 <span className="winnerNames">{winnerNames}</span>
                             </p>
                             <div className="finalScores">
                                 <h3>Puntuación Final</h3>
                                 {gameData.type === '2v2' ? (
                                     <>
                                         <p>Equipo 1: {gameData.scores?.team1 || 0}</p>
                                         <p>Equipo 2: {gameData.scores?.team2 || 0}</p>
                                     </>
                                 ) : (
                                     Object.entries(gameData.scores || {}).map(([playerId, score]) => (
                                         <p key={playerId}>{players[playerId]?.username || 'Jugador'}: {score}</p>
                                     ))
                                 )}
                             </div>
                             <button onClick={() => navigate('/domino')} className="backToLobbyButton">Volver al Lobby</button>
                         </div>
                     </div>
                 )}


                 <div className="watermark">DOMINO</div>
                 
                 {/* --- INICIO RENDER TABLERO ABSOLUTO (PETICIÓN 6) --- */}
                 <div className="boardTilesContainer" ref={boardContainerRef}>
                      {boardLayout.map((layoutTile, index) => {
                         if (!layoutTile) {
                             console.warn("Missing layout tile at index", index);
                             return null;
                         }
                         return (
                             <div
                                 key={`board-${index}-${layoutTile.tile.top}-${layoutTile.tile.bottom}`}
                                 className="boardTileWrapper"
                                 style={{
                                     left: `${layoutTile.x}px`,
                                     top: `${layoutTile.y}px`,
                                     transform: `translate(-50%, -50%) rotate(${layoutTile.rotation}deg)`,
                                     zIndex: index,
                                 }}
                             >
                                 <DominoTile
                                     topValue={layoutTile.tile.top}
                                     bottomValue={layoutTile.tile.bottom}
                                     // (Petición 1/2 Fix) Pass calculated orientation class
                                     orientationClass={layoutTile.orientationClass} 
                                     isDouble={layoutTile.tile.top === layoutTile.tile.bottom} // Keep isDouble for inHand logic
                                 />
                             </div>
                         );
                      })}
                     
                     {/* Nuevos Board End Highlights (Petición 6) */}
                     {boardEnds.start && (
                         <div
                             className={`boardEndHighlight start ${playableEnds.start ? 'active' : ''}`}
                             style={{
                                 left: `${boardEnds.start.x}px`,
                                 top: `${boardEnds.start.y}px`,
                                 width: `${boardEnds.start.w}px`,
                                 height: `${boardEnds.start.h}px`,
                                 transform: `translate(-50%, -50%) rotate(${boardEnds.start.rotation}deg)`
                             }}
                             onClick={() => handleBoardEndClick('start')}
                         />
                     )}
                     {boardEnds.end && (
                         <div
                             className={`boardEndHighlight end ${playableEnds.end ? 'active' : ''}`}
                             style={{
                                 left: `${boardEnds.end.x}px`,
                                 top: `${boardEnds.end.y}px`,
                                 width: `${boardEnds.end.w}px`,
                                 height: `${boardEnds.end.h}px`,
                                 transform: `translate(-50%, -50%) rotate(${boardEnds.end.rotation}deg)`
                             }}
                             onClick={() => handleBoardEndClick('end')}
                         />
                     )}
                 </div>
                 {/* --- FIN RENDER TABLERO ABSOLUTO (PETICIÓN 6) --- */}


                 {/* (Petición 1) Botón Listo: Condición simplificada para mostrar solo en 'full' */}
                 {gameData?.status === 'full' && (
                      <button
                           onClick={handleToggleReady}
                           disabled={loadingAction || !players[currentUser?.uid] || isSpectator}
                           className={`readyButton ${isMyPlayerReady ? 'readyButtonActive' : ''}`}
                      >
                           {loadingAction ? '...' : (isMyPlayerReady ? '¡Listo!' : 'Marcar Listo')}
                      </button>
                 )}

                 {showPassButton && gameData?.currentTurn === currentUser?.uid && !selectedTileInfo && (
                     <button
                          onClick={handlePassTurn}
                          disabled={loadingAction}
                          className="passButton"
                     >
                          Pasar
                     </button>
                 )}
            </div>

            {isChatOpen && (
                 <div className="chatContainer">
                     <div className="chatMessages">
                          {messages.map(msg => (
                              <div key={msg.id} className="chatMessage">
                                   <span className="chatUser" style={{ color: msg.userId === currentUser?.uid ? '#ffd700' : '#aaa' }}>{msg.username || '?'}:</span>
                                   <span className="chatText">{msg.text}</span>
                              </div>
                          ))}
                          <div ref={chatMessagesEndRef} />
                     </div>
                     <form className="chatInputArea" onSubmit={handleSendChat}>
                          <input
                              type="text"
                              className="chatInput"
                              value={chatInput}
                              onChange={(e) => setChatInput(e.target.value)}
                              placeholder="Escribe un mensaje..."
                              maxLength={100}
                              disabled={isSpectator}
                          />
                          <button type="submit" className="chatSendButton" disabled={isSpectator || !chatInput.trim()}>➢</button>
                     </form>
                 </div>
            )}
            {isEmojiPanelOpen && (
                 <div className="emojiPanel">
                     {EMOJI_REACTIONS.map(emoji => (
                         <button key={emoji} className="emojiButton" onClick={() => handleSendReaction(emoji)} disabled={isSpectator}>
                             {emoji}
                         </button>
                     ))}
                 </div>
            )}

            <div className="playerHandTray">
                <div className="handTiles">
                    {myHand && myHand.map((tile, index) => {
                        if (!tile) return null;
                        const isPlayable = playableTileIndices.has(index);
                        const isSelected = selectedTileInfo?.index === index;
                        return (
                            <DominoTile
                                key={`${tile.top}-${tile.bottom}-${index}-${Math.random()}`}
                                topValue={tile.top}
                                bottomValue={tile.bottom}
                                isInHand={true}
                                isDouble={tile.top === tile.bottom}
                                isDisabled={gameData?.currentTurn !== currentUser?.uid || !isPlayable || loadingAction || gameData.status === 'round_over' || gameData.status === 'finished'}
                                isPlayableHighlight={isPlayable && !loadingAction && !selectedTileInfo && gameData?.currentTurn === currentUser?.uid && gameData.status === 'playing'}
                                isSelectedHighlight={isSelected}
                                onClick={() => handleTileClick(tile, index)}
                            />
                        );
                    })}
                </div>
                 <div className="bottomIcons">
                      <button className="iconButton" onClick={() => { setIsChatOpen(o => !o); setIsEmojiPanelOpen(false); }}>💬</button>
                      <button className="iconButton" onClick={() => { setIsEmojiPanelOpen(o => !o); setIsChatOpen(false); }} disabled={isSpectator}>😊</button>
                 </div>
            </div>
        </div>
    );
}

export default DominoGame;
