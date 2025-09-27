import React, { useState, useEffect, useContext } from 'react';
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
  limit
} from 'firebase/firestore';
import { db } from '../../firebase';

// Helper para construir la matriz del cartón
const buildMatrix = (flatNumbers) => {
  if (!Array.isArray(flatNumbers) || flatNumbers.length !== 25) return [];
  const matrix = [];
  for (let i = 0; i < 5; i++) {
    matrix.push(flatNumbers.slice(i * 5, i * 5 + 5));
  }
  return matrix;
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

  // --- Estados para el Historial ---
  const [showHistory, setShowHistory] = useState(false);
  const [finishedTournaments, setFinishedTournaments] = useState([]);
  const [selectedHistoryTournament, setSelectedHistoryTournament] = useState(null);

  useEffect(() => {
    if (!currentUser) return;

    const loadRate = async () => {
      try {
        const rateDoc = await getDoc(doc(db, 'appSettings', 'exchangeRate'));
        if (rateDoc.exists()) setExchangeRate(rateDoc.data().rate || 100);
      } catch (e) { console.error('Error cargando tasa:', e); }
    };
    loadRate();

    const userRef = doc(db, 'users', currentUser.uid);
    const unsubUser = onSnapshot(userRef, snap => {
      if (snap.exists()) setUserBalance(snap.data().balance || 0);
    });

    // Query para torneos activos/en espera
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

    // Query para el historial de torneos
    const finishedQuery = query(
      collection(db, 'bingoTournaments'),
      where('status', '==', 'finished'),
      orderBy('finishedAt', 'desc'),
      limit(20) // Traemos los últimos 20 torneos
    );
    const unsubFinished = onSnapshot(finishedQuery, snapshot => {
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setFinishedTournaments(data);
    }, err => { console.error('Error historial torneos:', err); });

    return () => {
      unsubUser();
      unsubActive();
      unsubFinished();
    };
  }, [currentUser, selectedTournament?.id]);

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

  const handleCardSelection = (cardNumber) => {
    if (!selectedTournament?.allowPurchases) { alert('Compra cerrada'); }
    else { setSelectedCards(prev => prev.includes(cardNumber) ? prev.filter(c => c !== cardNumber) : [...prev, cardNumber]); }
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
          const matrix = generateBingoCardNumbers();
          cardNumbersMap[n] = matrix.flat();
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
      alert(`✅ Compra realizada. Total Bs. ${totalCost.toLocaleString()}`);
      setSelectedCards([]);
    } catch (e) { console.error('Error comprando cartones:', e); alert(`❌ ${e.message}`); }
    finally { setPurchasing(false); }
  };

  const isAdmin = currentUser?.email === 'cristhianzxz@hotmail.com' || currentUser?.email === 'admin@oriluck.com';

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">Cargando...</div>;
  }

  // --- RENDERIZADO DE LA VISTA DE HISTORIAL ---
  if (showHistory) {
    const t = selectedHistoryTournament;
    const winners = t?.winners || [];
    const calledNumbers = t?.calledNumbers || [];
    const isMarked = (val) => val === 'FREE' || calledNumbers.includes(val);

    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 p-6 text-white">
        <div className="max-w-7xl mx-auto">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-3xl font-bold">📜 Historial de Torneos</h1>
            <button onClick={() => setShowHistory(false)} className="bg-gray-600 hover:bg-gray-500 px-4 py-2 rounded-lg">
              ← Volver al Lobby
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Columna Izquierda: Lista de Torneos */}
            <div className="md:col-span-1 bg-black/20 p-4 rounded-xl max-h-[75vh] overflow-y-auto">
              <h2 className="text-xl font-semibold mb-3">Torneos Finalizados</h2>
              <div className="space-y-2">
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
                  </button>
                ))}
              </div>
            </div>

            {/* Columna Derecha: Detalles del Torneo */}
            <div className="md:col-span-2 bg-black/20 p-6 rounded-xl">
              {!t ? (
                <div className="flex items-center justify-center h-full text-white/50">
                  Selecciona un torneo para ver sus detalles.
                </div>
              ) : (
                <div className="space-y-6">
                  <h2 className="text-2xl font-bold">{t.name}</h2>
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
                              {/* Info del Ganador */}
                              <div className="space-y-2">
                                <p><strong>Usuario:</strong> {winner.userName}</p>
                                <p><strong>Cartón Ganador:</strong> #{winnerCardNumber}</p>
                                <p><strong>Premio:</strong> <span className="font-bold text-green-400">Bs. {winner.prizeAmount?.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</span></p>
                              </div>
                              {/* Cartón Ganador */}
                              {cardMatrix.length > 0 && (
                                <div>
                                  <div className="grid grid-cols-5 gap-1 text-xs font-bold">
                                    {['B', 'I', 'N', 'G', 'O'].map(l => <div key={l} className="text-center text-pink-300">{l}</div>)}
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
                  {/* Números Cantados */}
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

  // --- RENDERIZADO DEL LOBBY PRINCIPAL ---
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 p-6">
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
              📜 Historial de Juegos
            </button>
            <div className="text-right">
              <div className="text-2xl font-bold text-white">Bs. {userBalance.toLocaleString()}</div>
              <div className="text-white/70">Saldo disponible</div>
            </div>
            {isAdmin && <button onClick={() => navigate('/admin/bingo')} className="bg-purple-600 hover:bg-purple-500 text-white font-bold py-3 px-6 rounded-lg">⚙️ Admin</button>}
          </div>
        </div>
      </div>

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
            const prize = (t.prizeTotal && t.prizeTotal > 0) ? t.prizeTotal : soldCount * (t.pricePerCard || 0) * 0.7;
            return (
              <div key={t.id} className={`bg-white/10 rounded-xl p-6 border-2 cursor-pointer transition-all ${selectedTournament?.id === t.id ? 'border-green-500 bg-green-500/20' : 'border-white/20 hover:border-white/40'} ${!t.allowPurchases ? 'opacity-80' : ''}`} onClick={() => { setSelectedTournament(t); setSelectedCards([]); }}>
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
                  <span className="text-white font-bold text-sm">Premio: Bs. {prize.toLocaleString()}</span>
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
          <div className="grid grid-cols-10 gap-2 mb-6">
            {Array.from({ length: 100 }, (_, i) => i + 1).map(num => {
              const isSold = selectedTournament.soldCards && selectedTournament.soldCards[`carton_${num}`];
              const isSelected = selectedCards.includes(num);
              const isAvailable = !isSold && selectedTournament.allowPurchases;
              return <button key={num} disabled={!isAvailable} onClick={() => handleCardSelection(num)} className={`p-3 rounded-lg text-center transition-all font-semibold ${isSelected ? 'bg-green-500 text-white shadow-lg shadow-green-500/50' : isAvailable ? 'bg-white/20 text-white hover:bg-white/30 hover:scale-105' : 'bg-red-500/20 text-red-300 cursor-not-allowed'}`}>{num}{isSold && <div className="text-xs">❌</div>}</button>;
            })}
          </div>
          {selectedCards.length > 0 && selectedTournament.allowPurchases && (
            <div className="bg-green-500/20 rounded-lg p-4 border border-green-500/30">
              <div className="flex justify-between items-center">
                <div>
                  <div className="text-white font-bold text-lg">{selectedCards.length} cartón(es)</div>
                  <div className="text-white/70">Total: Bs. {calculateTotal().toLocaleString()}</div>
                  <div className="text-white/60 text-sm mt-1">{selectedCards.slice().sort((a, b) => a - b).join(', ')}</div>
                </div>
                <button onClick={purchaseCards} disabled={purchasing} className="bg-green-600 hover:bg-green-500 text-white font-bold py-3 px-8 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed">{purchasing ? 'Procesando...' : 'Comprar'}</button>
              </div>
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