import React, { useState, useEffect, useContext, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../../App';
import {
    collection,
    doc,
    getDoc,
    onSnapshot,
    query,
    where,
    orderBy,
    runTransaction,
    increment,
    arrayRemove,
    serverTimestamp,
    limit,
    updateDoc,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { addToBingoHouseFund } from '../../firestoreService';

// Helper para construir la matriz del cartón
const buildMatrix = (flatNumbers) => {
    if (!Array.isArray(flatNumbers) || flatNumbers.length !== 25) return [];
    const matrix = [];
    for (let i = 0; i < 5; i++) {
        matrix.push(flatNumbers.slice(i * 5, i * 5 + 5));
    }
    return matrix;
};

// Generador de números de cartón de Bingo
const generateBingoCardNumbers = () => {
    const ranges = [
        { min: 1, max: 15 }, { min: 16, max: 30 }, { min: 31, max: 45 },
        { min: 46, max: 60 }, { min: 61, max: 75 }
    ];
    const card = [];
    for (let c = 0; c < 5; c++) {
        const col = []; const used = new Set();
        for (let r = 0; r < 5; r++) {
            if (c === 2 && r === 2) { col.push('FREE'); }
            else {
                let n;
                do { n = Math.floor(Math.random() * (ranges[c].max - ranges[c].min + 1)) + ranges[c].min; }
                while (used.has(n));
                used.add(n); col.push(n);
            }
        }
        card.push(col);
    }
    return card;
};

// Componente para mostrar la previsualización en línea - AJUSTADO para estabilidad
const CardInlinePreview = ({ cardNum, numbers, isVisible }) => {
    if (!isVisible || !numbers) return null;
    const matrix = buildMatrix(numbers);
    
    return (
        // AJUSTE: top-full, left-1/2, transform -translate-x-1/2 para centrar la previsualización debajo del botón padre. Ancho fijo para control.
        <div className="absolute top-full left-1/2 transform -translate-x-1/2 mt-1 w-52 sm:w-60 bg-gray-700 p-2 rounded-lg shadow-xl border border-purple-500 z-30 transition-all duration-300">
            <h4 className="text-xs font-bold text-white mb-1 text-center">Cartón #{cardNum}</h4>
            <div className="bg-white p-1 rounded-md">
                {/* Encabezado BINGO más pequeño */}
                <div className="grid grid-cols-5 gap-0.5 text-[0.6rem] font-bold mb-0.5">
                    {['B', 'I', 'N', 'G', 'O'].map(l => <div key={l} className="text-center text-purple-700">{l}</div>)}
                </div>
                {/* Cuadrícula de números más pequeña */}
                <div className="grid grid-cols-5 gap-0.5">
                    {matrix.flat().map((val, idx) => (
                        <div key={idx} 
                             // Altura y texto minimizado para caber en móvil
                             className={`h-4 sm:h-5 flex items-center justify-center rounded text-[0.6rem] sm:text-xs font-semibold ${val === 'FREE' ? 'bg-yellow-300 text-gray-800' : 'bg-gray-100 text-gray-800'}`}>
                            {val}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};


const BingoLobby = () => {
    const navigate = useNavigate();
    const { currentUser } = useContext(AuthContext);

    const [tournaments, setTournaments] = useState([]);
    const [selectedTournament, setSelectedTournament] = useState(null);
    const [userBalance, setUserBalance] = useState(0);
    const [exchangeRate, setExchangeRate] = useState(100);
    const [selectedCards, setSelectedCards] = useState([]);
    const [loading, setLoading] = useState(true);
    const [purchasing, setPurchasing] = useState(false);
    const [purchaseSuccessMsg, setPurchaseSuccessMsg] = useState("");

    const [currentUserData, setCurrentUserData] = useState(undefined);

    const [cardDetails, setCardDetails] = useState({});
    const [cardBeingViewed, setCardBeingViewed] = useState(null);

    const [showHistory, setShowHistory] = useState(false);
    const [finishedTournaments, setFinishedTournaments] = useState([]);
    const [selectedHistoryTournament, setSelectedHistoryTournament] = useState(null);

    const isAdmin = currentUserData?.role === "admin";

    const generateAndStoreCardDetails = useCallback(async (tournamentId, existingDetails) => {
        const tRef = doc(db, 'bingoTournaments', tournamentId);
        const updates = {};
        let generatedCount = 0;
        const newDetails = { ...existingDetails };

        for (let i = 1; i <= 100; i++) {
            if (!existingDetails[i]) {
                const matrix = generateBingoCardNumbers();
                const flatNumbers = matrix.flat();
                updates[`cardDetails.${i}`] = flatNumbers;
                newDetails[i] = flatNumbers;
                generatedCount++;
            }
        }

        if (generatedCount > 0) {
            await updateDoc(tRef, updates)
                .catch(err => console.error("Error al guardar cardDetails en Firestore:", err));
        }

        setCardDetails(newDetails);
    }, []);

    useEffect(() => {
        if (!selectedTournament) {
            setCardDetails({});
            return;
        }

        const loadDetails = async () => {
            const tournamentRef = doc(db, 'bingoTournaments', selectedTournament.id);
            const snap = await getDoc(tournamentRef);
            const data = snap.data();
            const existingDetails = data?.cardDetails || {};
            await generateAndStoreCardDetails(selectedTournament.id, existingDetails);
        };

        loadDetails();
    }, [selectedTournament, generateAndStoreCardDetails]);

    useEffect(() => {
        if (!currentUser?.uid) {
            setCurrentUserData(null);
            setLoading(false);
            return;
        }
        const userRef = doc(db, "users", currentUser.uid);
        const unsub = onSnapshot(userRef, (snap) => {
            if (snap.exists()) {
                setCurrentUserData(snap.data());
                setUserBalance(snap.data().balance || 0);
            } else {
                setCurrentUserData({ role: "user" });
                setUserBalance(0);
            }
        });
        return () => unsub();
    }, [currentUser?.uid]);

    useEffect(() => {
        if (currentUser === undefined || currentUserData === undefined || currentUser === null) {
            return;
        }

        const loadRate = async () => {
            try {
                const rateDoc = await getDoc(doc(db, 'appSettings', 'exchangeRate'));
                if (rateDoc.exists()) setExchangeRate(rateDoc.data().rate || 100);
            } catch (e) { console.error('Error cargando tasa:', e); }
        };
        loadRate();

        const activeQuery = query(
            collection(db, 'bingoTournaments'),
            where('status', 'in', ['waiting', 'active']),
            orderBy('startTime', 'asc')
        );
        const unsubActive = onSnapshot(activeQuery, snapshot => {
            const data = snapshot.docs.map(d => ({
                id: d.id, ...d.data(),
                allowPurchases: d.data().status === 'waiting' && d.data().allowPurchases !== false
            }));
            setTournaments(data);
            if (selectedTournament) {
                const updated = data.find(t => t.id === selectedTournament.id);
                setSelectedTournament(updated || null);
            }
            setLoading(false);
        }, err => { console.error('Error torneos activos:', err); setLoading(false); });

        const finishedQuery = query(
            collection(db, 'bingoTournaments'),
            where('status', '==', 'finished'),
            orderBy('finishedAt', 'desc'),
            limit(20)
        );
        const unsubFinished = onSnapshot(finishedQuery, snapshot => {
            const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            setFinishedTournaments(data);
        }, err => { console.error('Error historial torneos:', err); });

        return () => {
            unsubActive();
            unsubFinished();
        };
    }, [currentUser, currentUserData, selectedTournament]);

    useEffect(() => {
        if (!selectedTournament) return;
        const tournamentRef = doc(db, 'bingoTournaments', selectedTournament.id);
        const unsub = onSnapshot(tournamentRef, (snap) => {
            if (snap.exists()) {
                const newData = snap.data();
                setSelectedTournament(prev => ({ ...prev, ...newData }));
                const sold = newData.soldCards || {};
                setSelectedCards(prevSelected =>
                    prevSelected.filter(cardNum => !sold[`carton_${cardNum}`])
                );
                setCardDetails(newData.cardDetails || {});
            }
        });
        return () => unsub();
    }, [selectedTournament?.id]);

    const handleCardToggle = (e, cardNumber) => {
        e.stopPropagation(); 
        if (cardBeingViewed === cardNumber) {
            setCardBeingViewed(null); // Ocultar
        } else {
            setCardBeingViewed(cardNumber); // Mostrar
        }
    };

    const handleCardSelection = (cardNumber) => {
        const isSold = selectedTournament?.soldCards && selectedTournament.soldCards[`carton_${cardNumber}`];
        if (!selectedTournament?.allowPurchases || isSold) {
            alert(isSold ? "Este cartón fue comprado por otro usuario." : "Compra cerrada");
            return;
        }
        setSelectedCards(prev => prev.includes(cardNumber)
            ? prev.filter(c => c !== cardNumber)
            : [...prev, cardNumber]);
    };

    const calculateTotal = () => selectedCards.length * (selectedTournament?.pricePerCard || exchangeRate);

    const purchaseCards = async () => {
        if (!currentUser || !selectedTournament) return;
        if (selectedCards.length === 0) { alert('Selecciona al menos un cartón'); return; }
        if (purchasing) return;
        const totalCost = calculateTotal();
        setPurchasing(true);
        try {
            await runTransaction(db, async (tx) => {
                const tournamentRef = doc(db, 'bingoTournaments', selectedTournament.id);
                const userRef = doc(db, 'users', currentUser.uid);
                const [tournamentSnap, userSnap] = await Promise.all([tx.get(tournamentRef), tx.get(userRef)]);
                if (!tournamentSnap.exists()) throw new Error('Torneo no existe');
                if (!userSnap.exists()) throw new Error('Perfil no encontrado');
                const tournamentData = tournamentSnap.data();

                if (tournamentData.status !== 'waiting' || tournamentData.allowPurchases === false) throw new Error('Compra cerrada');

                const sold = tournamentData.soldCards || {};
                const unavailable = selectedCards.filter(n => sold[`carton_${n}`]);
                if (unavailable.length) throw new Error(`Cartones vendidos: ${unavailable.join(', ')}`);

                const userProfile = userSnap.data();
                const balance = userProfile.balance || 0;
                if (balance < totalCost) throw new Error('Saldo insuficiente');

                const userEmail = userProfile.email || currentUser.email || null;
                const userPhone = userProfile.phoneNumber || userProfile.phone || null;

                const cardNumbersMap = {};
                selectedCards.forEach(n => {
                    const numbers = cardDetails[n];
                    if (!numbers) throw new Error(`Números del cartón ${n} no encontrados.`);
                    cardNumbersMap[n] = numbers;
                });

                tx.update(userRef, { balance: increment(-totalCost) });

                const bingoTxRef = doc(collection(db, 'bingoTransactions'));
                tx.set(bingoTxRef, {
                    userId: currentUser.uid,
                    userName: userProfile.userName || userProfile.username || userProfile.displayName || userEmail,
                    userEmail, userPhone,
                    tournamentId: selectedTournament.id,
                    tournamentName: tournamentData.name,
                    cardsBought: selectedCards,
                    cardDetails: selectedCards.map(n => ({ cardNumber: n, cardNumbers: cardNumbersMap[n] })),
                    totalAmount: totalCost,
                    purchaseTime: serverTimestamp(),
                    status: 'completed'
                });

                const updates = {};
                selectedCards.forEach(n => {
                    updates[`soldCards.carton_${n}`] = {
                        userId: currentUser.uid,
                        userName: userProfile.userName || userProfile.username || userProfile.displayName || userEmail,
                        userEmail, userPhone,
                        purchaseTime: serverTimestamp(),
                        cardNumbers: cardNumbersMap[n]
                    };
                });

                tx.update(tournamentRef, { ...updates, availableCards: arrayRemove(...selectedCards) });
            });
            await addToBingoHouseFund(totalCost);
            setPurchaseSuccessMsg(`✅ Compra realizada. Total Bs. ${totalCost.toLocaleString()}`);
            setTimeout(() => setPurchaseSuccessMsg(""), 3000);
            setSelectedCards([]);
        } catch (e) {
            console.error('Error comprando cartones:', e);
            alert(`❌ ${e.message}`);
        }
        finally { setPurchasing(false); }
    };

    if (currentUser === undefined || currentUserData === undefined || loading) {
        return <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">Cargando...</div>;
    }

    // --- Historial (código omitido) ---
    if (showHistory) {
        const t = selectedHistoryTournament;
        const soldCount = t ? Object.keys(t.soldCards || {}).length : 0;
        const percentHouse = typeof t?.percentageHouse === "number" ? t.percentageHouse : 30;
        const percentPrize = 100 - percentHouse;
        const computedPrizeTotal = soldCount * (t?.pricePerCard || 0) * (percentPrize / 100);
        const prizeTotal = t?.prizeTotal && t.prizeTotal > 0 ? t.prizeTotal : computedPrizeTotal;
        const winners = t?.winners || [];
        const calledNumbers = t?.calledNumbers || [];
        const isMarked = (val) => val === 'FREE' || calledNumbers.includes(val);

        return (
            <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 p-6 text-white">
                <div className="max-w-7xl mx-auto">
                    <div className="flex justify-between items-center mb-6">
                        <h1 className="text-3xl font-bold">📜 Historial de Torneos</h1>
                        <button onClick={() => { setShowHistory(false); setSelectedHistoryTournament(null); }} className="bg-gray-600 hover:bg-gray-500 px-4 py-2 rounded-lg">
                            ← Volver al Lobby
                        </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="md:col-span-1 bg-black/20 p-4 rounded-xl max-h-[75vh] overflow-y-auto">
                            <h2 className="text-xl font-semibold mb-3">Torneos Finalizados</h2>
                            <div className="space-y-2">
                                {finishedTournaments.length === 0 && (
                                    <div className="text-white/60 text-center py-12">
                                        No hay torneos finalizados para mostrar.
                                    </div>
                                )}
                                {finishedTournaments
                                    .sort((a, b) => (b.finishedAt?.toDate() || 0) - (a.finishedAt?.toDate() || 0))
                                    .map(tourney => (
                                        <button
                                            key={tourney.id}
                                            onClick={() => setSelectedHistoryTournament(tourney)}
                                            className={`w-full text-left p-3 rounded-lg transition-colors ${selectedHistoryTournament?.id === tourney.id ? 'bg-purple-600' : 'bg-white/10 hover:bg-white/20'}`}
                                        >
                                            <p className="font-bold">{tourney.name}</p>
                                            <p className="text-xs text-white/70">{tourney.finishedAt?.toDate().toLocaleString('es-VE')}</p>
                                            <div className="text-xs text-green-300 font-semibold mt-1">
                                                Premio total ({100 - (typeof tourney.percentageHouse === "number" ? tourney.percentageHouse : 30)}%): Bs. {((tourney.prizeTotal && tourney.prizeTotal > 0) ? tourney.prizeTotal : Object.keys(tourney.soldCards || {}).length * (tourney.pricePerCard || 0) * ((100 - (typeof tourney.percentageHouse === "number" ? tourney.percentageHouse : 30))/100)).toLocaleString()}
                                            </div>
                                        </button>
                                    ))}
                            </div>
                        </div>
                        <div className="md:col-span-2 bg-black/20 p-6 rounded-xl">
                            {!t ? (
                                <div className="flex items-center justify-center h-full text-white/50">
                                    Selecciona un torneo para ver sus detalles.
                                </div>
                            ) : (
                                <div className="space-y-6">
                                    <h2 className="text-2xl font-bold">{t.name}</h2>
                                    <div className="font-semibold mb-2 text-green-400">
                                        Premio total ({percentPrize}%): Bs. {prizeTotal.toLocaleString()}
                                    </div>
                                    {winners.length > 0 ? (
                                        <div className="space-y-6">
                                            {winners.map((winner, index) => {
                                                const winnerCardNumber = winner?.cards?.[0];
                                                const winnerCardData = winnerCardNumber ? t?.soldCards?.[`carton_${winnerCardNumber}`] : null;
                                                const cardMatrix = winnerCardData ? buildMatrix(winnerCardData.cardNumbers) : [];

                                                return (
                                                    <div key={index} className="bg-black/20 p-4 rounded-lg border border-yellow-500/30">
                                                        <h3 className="text-lg font-semibold text-yellow-300 mb-3">🏆 Ganador {winners.length > 1 ? `#${index + 1}` : ''}</h3>
                                                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                                            <div className="space-y-2">
                                                                <p><strong>Usuario:</strong> {winner.userName}</p>
                                                                <p><strong>Cartón Ganador:</strong> #{winnerCardNumber}</p>
                                                                <p><strong>Premio:</strong> <span className="font-bold text-green-400">Bs. {winner.prizeAmount?.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</span></p>
                                                            </div>
                                                            {cardMatrix.length > 0 && (
                                                                <div>
                                                                    <div className="grid grid-cols-5 gap-1 text-xs font-bold">
                                                                        {['B', 'I', 'N', 'G', 'O'].map(l => <div key={l} className="text-center text-pink-300">{l}</div>)}
                                                                    </div>
                                                                    <div className="grid grid-cols-5 gap-0.5">
                                                                        {cardMatrix.flat().map((val, idx) => (
                                                                            <div key={idx} className={`h-9 flex items-center justify-center rounded text-sm ${isMarked(val) ? 'bg-green-500' : 'bg-white/10'}`}>
                                                                                {val}
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <p className="text-yellow-400">Este torneo finalizó sin ganadores.</p>
                                    )}
                                    <div>
                                        <h3 className="text-lg font-semibold mb-2">Números Cantados ({calledNumbers.length})</h3>
                                        <div className="flex flex-wrap gap-2 bg-black/30 p-3 rounded-lg">
                                            {calledNumbers.map(n => <div key={n} className="w-8 h-8 flex items-center justify-center rounded-full bg-purple-500/50 text-sm">{n}</div>)}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    }
    // --- Fin Historial ---


    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 p-6">
            {purchaseSuccessMsg && (
                <div className="fixed top-8 left-1/2 transform -translate-x-1/2 bg-green-600 text-white px-6 py-3 rounded-xl shadow-lg z-50 text-lg font-bold transition-all">
                    {purchaseSuccessMsg}
                </div>
            )}
            <div className="max-w-7xl mx-auto mb-8">
                <div className="flex justify-between items-center mb-4">
                    <div className="flex items-center gap-4">
                        <button onClick={() => navigate('/lobby')} className="bg-gray-600 hover:bg-gray-700 text-white px-3 py-2 rounded-lg text-sm">← Volver</button>
                        <div>
                            <h1 className="text-4xl font-bold text-white">🎯 BINGO ORILUCK</h1>
                            <p className="text-white/70">Selecciona un torneo y compra tus cartones</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                        <button onClick={() => setShowHistory(true)} className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 px-6 rounded-lg">
                            📜 Historial de Torneos
                        </button>
                        <div className="text-right">
                            <div className="text-2xl font-bold text-white">Bs. {userBalance.toLocaleString()}</div>
                            <div className="text-white/70">Saldo disponible</div>
                        </div>
                        {isAdmin && <button onClick={() => navigate('/admin/bingo')} className="bg-purple-600 hover:bg-purple-500 text-white font-bold py-3 px-6 rounded-lg">⚙️ Admin</button>}
                    </div>
                </div>
            </div>
            
            {/* Renderizado de Torneos */}
            {tournaments.length === 0 && !selectedTournament && (
                <div className="text-center mb-8 bg-yellow-500/20 rounded-xl p-6 border border-yellow-500/30">
                    <div className="text-6xl mb-4">🎯</div>
                    <h3 className="text-2xl font-bold text-yellow-300 mb-2">No hay torneos activos</h3>
                    <p className="text-white/80 mb-4">Cuando se creen torneos aparecerán aquí.</p>
                    {isAdmin && <button onClick={() => navigate('/admin/bingo')} className="bg-yellow-600 hover:bg-yellow-500 text-white font-bold py-3 px-6 rounded-lg">Crear Torneo</button>}
                </div>
            )}
            {tournaments.length > 0 && (
                <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
                    {tournaments.map(t => {
                        const soldCount = Object.keys(t.soldCards || {}).length;
                        const percentHouse = typeof t.percentageHouse === "number" ? t.percentageHouse : 30;
                        const percentPrize = 100 - percentHouse;
                        const prizeTotal = t.prizeTotal && t.prizeTotal > 0
                            ? t.prizeTotal
                            : soldCount * (t.pricePerCard || 0) * (percentPrize / 100);
                        return (
                            <div 
                                key={t.id} 
                                className={`bg-white/10 rounded-xl p-6 border-2 cursor-pointer transition-all 
                                    ${selectedTournament?.id === t.id ? 'border-green-500 bg-green-500/20' : 'border-white/20 hover:border-white/40'} 
                                    ${!t.allowPurchases ? 'opacity-80' : ''}`} 
                                onClick={() => { setSelectedTournament(t); setSelectedCards([]); setCardBeingViewed(null); }}
                            >
                                <h3 className="text-xl font-bold text-white mb-2">{t.name}</h3>
                                <div className="text-white/70 mb-2">{t.startTime?.toDate?.().toLocaleString('es-VE')}</div>
                                <div className="flex justify-between text-sm mb-2">
                                    <span className={t.allowPurchases ? 'text-green-400' : 'text-red-400'}>{t.allowPurchases ? '🟢 COMPRA ABIERTA' : '🔴 COMPRA CERRADA'}</span>
                                    <span className="text-yellow-400">Bs. {(t.pricePerCard || exchangeRate).toLocaleString()} / cartón</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-blue-400">{soldCount}/100 cartones</span>
                                    <span className={`px-2 py-1 rounded text-xs ${t.status === 'active' ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'}`}>{t.status === 'active' ? '🎮 JUGANDO' : '⏳ ESPERA'}</span>
                                </div>
                                <div className="mt-2 text-center bg-purple-500/20 rounded-lg py-1">
                                    <span className="text-white font-bold text-sm">
                                        Premio total ({percentPrize}%): <span className="text-green-400 font-semibold">Bs. {prizeTotal.toLocaleString()}</span>
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {selectedTournament && (
                <div className="max-w-7xl mx-auto bg-white/10 rounded-xl p-6">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-2xl font-bold text-white">Cartones - {selectedTournament.name}</h3>
                        <span className={`px-3 py-1 rounded-full text-sm font-semibold ${selectedTournament.allowPurchases ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/30'}`}>{selectedTournament.allowPurchases ? '🟢 COMPRA ABIERTA' : '🔴 COMPRA CERRADA'}</span>
                    </div>
                    {!selectedTournament.allowPurchases && <div className="bg-red-500/20 border border-red-500/30 rounded-lg p-3 mb-4 text-center text-red-300">Compra de cartones cerrada.</div>}
                    
                    {/* Contenedor de Cartones: 4 columnas en móvil, 6 en md, 10 en lg (PC) */}
                    <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-10 gap-2 mb-6"> 
                        {Array.from({ length: 100 }, (_, i) => i + 1).map(num => {
                            const isSold = selectedTournament.soldCards && selectedTournament.soldCards[`carton_${num}`];
                            const isSelected = selectedCards.includes(num);
                            const isAvailable = !isSold && selectedTournament.allowPurchases;
                            const cardNumbersForPreview = cardDetails[num];
                            const isCurrentView = cardBeingViewed === num;
                            
                            // Muestra la flecha si es disponible O si está vendido
                            const showToggle = cardNumbersForPreview && (isAvailable || isSold);

                            return (
                                <div key={num} className="relative col-span-1"> 
                                    
                                    {/* CONTENEDOR AJUSTADO: Utilizamos FLEX y ASPEC-SQUARE para la alineación perfecta */}
                                    <div className="flex items-stretch gap-1 h-full">
                                        
                                        {/* Botón de Cartón: Usa aspecto cuadrado y flex para centrar. */}
                                        <button 
                                            disabled={!isAvailable} 
                                            onClick={() => handleCardSelection(num)} 
                                            // CLAVE: w-full y aspect-square garantizan la proporción
                                            className={`flex-grow w-full aspect-square flex flex-col items-center justify-center p-1 rounded-lg text-center transition-all font-bold text-lg lg:text-xs relative z-10 
                                                ${isSelected ? 'bg-green-500 text-white shadow-lg shadow-green-500/50' : 
                                                isAvailable ? 'bg-white/20 text-white hover:bg-white/30 hover:scale-[1.02]' : 
                                                'bg-red-500/20 text-red-300 cursor-not-allowed'}`}
                                        >
                                            <div className="flex flex-col items-center justify-center">
                                                <span>{num}</span>
                                                {isSold && <span className="text-xs text-red-400 font-normal mt-[-2px]">❌</span>} 
                                            </div>
                                        </button>
                                        
                                        {/* Flecha de Previsualización: Ancho y alto fijos para no interferir con el botón */}
                                        {showToggle && (
                                            <button 
                                                onClick={(e) => handleCardToggle(e, num)}
                                                // CLAVE: h-full para que ocupe toda la altura y quede alineado al lado
                                                className={`bg-purple-600 hover:bg-purple-500 text-white w-6 h-full flex-shrink-0 rounded-lg flex items-center justify-center text-xs z-20 shadow-md transition-transform ${isCurrentView ? 'transform rotate-180' : ''}`}
                                                title={isCurrentView ? "Ocultar cartón" : "Ver cartón"}
                                            >
                                                {isCurrentView ? '▲' : '▼'}
                                            </button>
                                        )}
                                    </div>
                                    
                                    {/* Previsualización en Línea */}
                                    <CardInlinePreview 
                                        cardNum={num} 
                                        numbers={cardNumbersForPreview} 
                                        isVisible={isCurrentView} 
                                    />
                                </div>
                            );
                        })}
                    </div>
                    
                    {/* Sección de Compra */}
                    {selectedCards.length > 0 && selectedTournament.allowPurchases && (
                        <div className="bg-green-500/20 rounded-lg p-4 border border-green-500/30">
                            <div className="flex flex-col md:flex-row justify-between items-center">
                                <p className="text-xl font-bold text-white mb-2 md:mb-0">
                                    Total: {selectedCards.length} cartones x Bs. {(selectedTournament.pricePerCard || exchangeRate).toLocaleString()} = <span className="text-green-400">Bs. {calculateTotal().toLocaleString()}</span>
                                </p>
                                <button
                                    onClick={purchaseCards}
                                    disabled={purchasing || userBalance < calculateTotal()}
                                    className={`py-3 px-8 rounded-lg font-bold transition-all ${
                                        purchasing || userBalance < calculateTotal()
                                        ? 'bg-gray-500/50 text-gray-300 cursor-not-allowed'
                                        : 'bg-green-600 hover:bg-green-700 text-white shadow-md'
                                    }`}
                                >
                                    {purchasing ? 'Comprando...' : 'Comprar Ahora'}
                                </button>
                            </div>
                            {userBalance < calculateTotal() && (
                                <p className="text-red-400 text-sm mt-2 text-center md:text-left">Saldo insuficiente para completar la compra.</p>
                            )}
                        </div>
                    )}

                    <div className="mt-6 text-center">
                        <button onClick={() => navigate('/bingo/game', { state: { tournament: selectedTournament } })} className="bg-red-600 hover:bg-red-500 text-white font-bold py-4 px-12 rounded-lg text-lg transition-all transform hover:scale-105 shadow-lg shadow-red-500/25">Entrar al Juego</button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default BingoLobby;