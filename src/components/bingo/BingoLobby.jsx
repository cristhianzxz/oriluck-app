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
  writeBatch,
  increment,
  arrayRemove,
  getDocs
} from 'firebase/firestore';
import { db } from '../../firebase';

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

  useEffect(() => {
    if (!currentUser) return;

    const loadStaticData = async () => {
      try {
        const rateDoc = await getDoc(doc(db, 'appSettings', 'exchangeRate'));
        if (rateDoc.exists()) setExchangeRate(rateDoc.data().rate || 100);

        const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
        if (userDoc.exists()) setUserBalance(userDoc.data().balance || 0);
      } catch (error) {
        console.error("Error cargando datos estáticos:", error);
      }
    };

    loadStaticData();

    const tournamentsQuery = query(
      collection(db, 'bingoTournaments'),
      where('status', 'in', ['waiting', 'active']),
      orderBy('startTime', 'asc')
    );

    const unsubscribe = onSnapshot(tournamentsQuery, (snapshot) => {
      const tournamentsData = snapshot.docs.map(docSnap => ({
        id: docSnap.id,
        ...docSnap.data(),
        allowPurchases: docSnap.data().status === 'waiting' && docSnap.data().allowPurchases !== false
      }));
      
      setTournaments(tournamentsData);

      if (selectedTournament) {
        const updatedSelected = tournamentsData.find(t => t.id === selectedTournament.id);
        if (updatedSelected) {
          setSelectedTournament(updatedSelected);
        } else {
          setSelectedTournament(null);
        }
      }
      
      setLoading(false);
    }, (error) => {
      console.error("Error en el listener de torneos:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser, selectedTournament?.id]);


  const generateBingoCardNumbers = () => {
    const ranges = [
      { min: 1, max: 15 }, { min: 16, max: 30 }, { min: 31, max: 45 }, { min: 46, max: 60 }, { min: 61, max: 75 }
    ];
    const card = [];
    for (let col = 0; col < 5; col++) {
      const column = [];
      const usedNumbers = new Set();
      for (let row = 0; row < 5; row++) {
        if (col === 2 && row === 2) {
          column.push('FREE');
        } else {
          let num;
          do {
            num = Math.floor(Math.random() * (ranges[col].max - ranges[col].min + 1)) + ranges[col].min;
          } while (usedNumbers.has(num));
          usedNumbers.add(num);
          column.push(num);
        }
      }
      card.push(column);
    }
    return card;
  };

  const handleCardSelection = (cardNumber) => {
    if (!selectedTournament?.allowPurchases) {
      alert('❌ La compra de cartones está cerrada para este torneo');
      return;
    }
    setSelectedCards((prev) => {
      if (prev.includes(cardNumber)) {
        return prev.filter((card) => card !== cardNumber);
      } else if (prev.length < 10) {
        return [...prev, cardNumber];
      } else {
        alert('🚫 Máximo 10 cartones por compra');
        return prev;
      }
    });
  };

  const calculateTotal = () => {
    return selectedCards.length * exchangeRate;
  };

  const purchaseCards = async () => {
    if (selectedCards.length === 0) {
      alert('Selecciona al menos un cartón');
      return;
    }
    if (purchasing) return;
    const totalCost = calculateTotal();
    if (userBalance < totalCost) {
      alert('❌ Saldo insuficiente');
      return;
    }
    setPurchasing(true);

    try {
      const currentTournamentDoc = await getDoc(doc(db, 'bingoTournaments', selectedTournament.id));
      if (!currentTournamentDoc.exists()) throw new Error('Torneo no encontrado');
      
      const updatedTournament = currentTournamentDoc.data();
      if (updatedTournament.status !== 'waiting' || updatedTournament.allowPurchases === false) {
        alert('❌ La compra de cartones está cerrada para este torneo');
        setSelectedCards([]);
        setPurchasing(false);
        return;
      }

      const unavailableCards = selectedCards.filter(
        (cardNumber) => updatedTournament.soldCards && updatedTournament.soldCards[`carton_${cardNumber}`]
      );
      if (unavailableCards.length > 0) {
        alert(`❌ Los siguientes cartones ya no están disponibles: ${unavailableCards.join(', ')}`);
        setSelectedCards(selectedCards.filter((card) => !unavailableCards.includes(card)));
        setPurchasing(false);
        return;
      }

      const batch = writeBatch(db);
      batch.update(doc(db, 'users', currentUser.uid), { balance: increment(-totalCost) });

      const cardsPayload = selectedCards.map((cardNumber) => ({
        cardNumber,
        matrix: generateBingoCardNumbers()
      }));

      const transactionRef = doc(collection(db, 'bingoTransactions'));
      batch.set(transactionRef, {
        userId: currentUser.uid,
        userName: currentUser.displayName || currentUser.email,
        tournamentId: selectedTournament.id,
        tournamentName: selectedTournament.name,
        cardsBought: selectedCards,
        cardDetails: cardsPayload.map(({ cardNumber, matrix }) => ({
          cardNumber,
          // *** CORRECCIÓN DEL ERROR ***
          // Aplanamos la matriz para evitar el error de "nested arrays".
          numbers: matrix.flat() 
        })),
        totalAmount: totalCost,
        purchaseTime: new Date(),
        status: 'completed'
      });

      cardsPayload.forEach(({ cardNumber, matrix }) => {
        const cardField = `soldCards.carton_${cardNumber}`;
        batch.update(doc(db, 'bingoTournaments', selectedTournament.id), {
          [cardField]: {
            userId: currentUser.uid,
            userName: currentUser.displayName || currentUser.email,
            purchaseTime: new Date(),
            // *** CORRECCIÓN DEL ERROR ***
            // También aplanamos la matriz aquí.
            cardNumbers: matrix.flat(),
            transactionId: transactionRef.id
          },
          availableCards: arrayRemove(cardNumber)
        });
      });

      await batch.commit();
      alert(`✅ ¡Cartones comprados exitosamente! Total: Bs. ${totalCost.toLocaleString()}`);
      setSelectedCards([]);
      const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
      setUserBalance(userDoc.data().balance);
    } catch (error) {
      console.error('Error comprando cartones:', error);
      alert('❌ Error al realizar la compra. Intenta nuevamente.');
    }
    setPurchasing(false);
  };

  const isAdmin = currentUser?.email === 'cristhianzxz@hotmail.com' || currentUser?.email === 'admin@oriluck.com';

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 flex items-center justify-center">
        <div className="text-white text-xl">Cargando torneos de Bingo...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 p-6">
      <div className="max-w-7xl mx-auto mb-8">
        <div className="flex justify-between items-center mb-4">
          {/* --- MEJORA DE UI --- */}
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/lobby')}
              className="bg-gray-600 hover:bg-gray-700 text-white px-3 py-2 rounded-lg text-sm"
            >
              ← Volver
            </button>
            <div>
              <h1 className="text-4xl font-bold text-white">🎯 BINGO ORILUCK</h1>
              <p className="text-white/70">Selecciona un torneo y compra tus cartones</p>
            </div>
          </div>

          <div className="flex items-center space-x-4">
            <div className="text-right">
              <div className="text-2xl font-bold text-white">Bs. {userBalance.toLocaleString()}</div>
              <div className="text-white/70">Saldo disponible</div>
            </div>
            {isAdmin && (
              <button
                onClick={() => navigate('/admin/bingo')}
                className="bg-purple-600 hover:bg-purple-500 text-white font-bold py-3 px-6 rounded-lg transition-all"
              >
                ⚙️ Admin
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ... El resto del código es idéntico ... */}
      {tournaments.length === 0 && (
        <div className="text-center mb-8 bg-yellow-500/20 rounded-xl p-6 border border-yellow-500/30">
          <div className="text-6xl mb-4">🎯</div>
          <h3 className="text-2xl font-bold text-yellow-300 mb-2">No hay torneos activos</h3>
          <p className="text-white/80 mb-4">Los torneos aparecerán aquí cuando sean creados por un administrador.</p>
          {isAdmin && (
            <button
              onClick={() => navigate('/admin/bingo')}
              className="bg-yellow-600 hover:bg-yellow-500 text-white font-bold py-3 px-6 rounded-lg transition-all"
            >
              ⚙️ Crear Torneo en Panel Admin
            </button>
          )}
        </div>
      )}

      {tournaments.length > 0 && (
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {tournaments.map((tournament) => (
            <div
              key={tournament.id}
              className={`bg-white/10 rounded-xl p-6 border-2 cursor-pointer transition-all ${
                selectedTournament?.id === tournament.id
                  ? 'border-green-500 bg-green-500/20'
                  : 'border-white/20 hover:border-white/40'
              } ${!tournament.allowPurchases ? 'opacity-80' : ''}`}
              onClick={() => {
                setSelectedTournament(tournament);
                setSelectedCards([]);
              }}
            >
              <h3 className="text-xl font-bold text-white mb-2">{tournament.name}</h3>
              <div className="text-white/70 mb-2">{tournament.startTime?.toDate().toLocaleString('es-VE')}</div>
              <div className="flex justify-between text-sm mb-2">
                <span className={`${tournament.allowPurchases ? 'text-green-400' : 'text-red-400'}`}>
                  {tournament.allowPurchases ? '🟢 COMPRA ABIERTA' : '🔴 COMPRA CERRADA'}
                </span>
                <span className="text-yellow-400">Bs. {exchangeRate} por cartón</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-blue-400">
                  {Object.keys(tournament.soldCards || {}).length}/100 cartones
                </span>
                <span
                  className={`px-2 py-1 rounded text-xs ${
                    tournament.status === 'active'
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-yellow-500/20 text-yellow-400'
                  }`}
                >
                  {tournament.status === 'active' ? '🎮 JUGANDO' : '⏳ ESPERA'}
                </span>
              </div>
              <div className="mt-2 text-center bg-purple-500/20 rounded-lg py-1">
                <span className="text-white font-bold text-sm">
                  Premio: Bs.{' '}
                  {((Object.keys(tournament.soldCards || {}).length * exchangeRate) * 0.7).toLocaleString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedTournament && (
        <div className="max-w-7xl mx-auto bg-white/10 rounded-xl p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-2xl font-bold text-white">Cartones - {selectedTournament.name}</h3>
            <span
              className={`px-3 py-1 rounded-full text-sm font-semibold ${
                selectedTournament.allowPurchases
                  ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                  : 'bg-red-500/20 text-red-400 border border-red-500/30'
              }`}
            >
              {selectedTournament.allowPurchases ? '🟢 COMPRA ABIERTA' : '🔴 COMPRA CERRADA'}
            </span>
          </div>
          {!selectedTournament.allowPurchases && (
            <div className="bg-red-500/20 border border-red-500/30 rounded-lg p-3 mb-4">
              <p className="text-red-300 text-center">
                ❌ La compra de cartones está cerrada. Este torneo ya comenzó o finalizó.
              </p>
            </div>
          )}
          <div className="grid grid-cols-10 gap-2 mb-6">
            {Array.from({ length: 100 }, (_, i) => i + 1).map((cardNumber) => {
              const isSold = selectedTournament.soldCards && selectedTournament.soldCards[`carton_${cardNumber}`];
              const isSelected = selectedCards.includes(cardNumber);
              const isAvailable = !isSold && selectedTournament.allowPurchases;
              return (
                <button
                  key={cardNumber}
                  disabled={!isAvailable}
                  onClick={() => handleCardSelection(cardNumber)}
                  className={`p-3 rounded-lg text-center transition-all font-semibold ${
                    isSelected
                      ? 'bg-green-500 text-white shadow-lg shadow-green-500/50'
                      : isAvailable
                      ? 'bg-white/20 text-white hover:bg-white/30 hover:scale-105'
                      : 'bg-red-500/20 text-red-300 cursor-not-allowed'
                  }`}
                >
                  {cardNumber}
                  {isSold && <div className="text-xs">❌</div>}
                </button>
              );
            })}
          </div>
          {selectedCards.length > 0 && selectedTournament.allowPurchases && (
            <div className="bg-green-500/20 rounded-lg p-4 border border-green-500/30">
              <div className="flex justify-between items-center">
                <div>
                  <div className="text-white font-bold text-lg">{selectedCards.length} cartón(es) seleccionado(s)</div>
                  <div className="text-white/70">Total: Bs. {calculateTotal().toLocaleString()}</div>
                  <div className="text-white/60 text-sm mt-1">
                    Cartones: {selectedCards.sort((a, b) => a - b).join(', ')}
                  </div>
                </div>
                <button
                  onClick={purchaseCards}
                  disabled={purchasing}
                  className="bg-green-600 hover:bg-green-500 text-white font-bold py-3 px-8 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {purchasing ? '🔄 Procesando...' : '💰 Comprar Cartones'}
                </button>
              </div>
            </div>
          )}
          {selectedTournament.status === 'active' && (
            <div className="mt-6 text-center">
              <button
                onClick={() => navigate('/bingo/game', { state: { tournament: selectedTournament } })}
                className="bg-red-600 hover:bg-red-500 text-white font-bold py-4 px-12 rounded-lg text-lg transition-all transform hover:scale-105 shadow-lg shadow-red-500/25"
              >
                🎮 Entrar al Juego en Vivo
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default BingoLobby;