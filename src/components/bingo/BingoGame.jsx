import React, { useState, useEffect, useContext } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { AuthContext } from '../../App';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';

const BingoGame = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentUser } = useContext(AuthContext);

  const [tournament, setTournament] = useState(null);
  const [calledNumbers, setCalledNumbers] = useState([]);
  const [currentNumber, setCurrentNumber] = useState(null);
  const [gameStatus, setGameStatus] = useState('waiting');
  const [winners, setWinners] = useState([]);
  const [userCards, setUserCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isWinnerModalClosed, setIsWinnerModalClosed] = useState(false);

  useEffect(() => {
    if (!location.state?.tournament) {
      navigate('/bingo');
      return;
    }
    const t = location.state.tournament;
    const unsub = onSnapshot(doc(db, 'bingoTournaments', t.id), (snap) => {
      if (!snap.exists()) {
        setLoading(false);
        return;
      }
      const data = { id: snap.id, ...snap.data() };
      setTournament(data);
      setCalledNumbers(data.calledNumbers || []);
      setCurrentNumber(data.currentNumber || null);
      setGameStatus(data.status || 'waiting');
      setWinners(data.winners || []);
      setUserCards(extractUserCards(data, currentUser?.uid));
      setLoading(false);

      if (data.winners && data.winners.length > 0) {
        setIsWinnerModalClosed(false);
      }
    });
    return () => unsub();
  }, [location, navigate, currentUser?.uid]);

  // *** FUNCIÓN CORREGIDA ***
  // Reconstruye la matriz 5x5 a partir del array plano guardado en Firestore.
  function normalizeToColumnMatrix(flatArray) {
    if (!Array.isArray(flatArray) || flatArray.length !== 25) {
      // Devuelve una matriz vacía si los datos son incorrectos
      return Array(5).fill(Array(5).fill(null));
    }
    const columns = [];
    for (let c = 0; c < 5; c++) {
      // Corta el array plano en 5 trozos de 5 elementos cada uno (las columnas)
      columns.push(flatArray.slice(c * 5, c * 5 + 5));
    }
    return columns;
  }

  function extractUserCards(tData, uid) {
    if (!uid || !tData?.soldCards) return [];
    const cards = [];
    Object.keys(tData.soldCards).forEach((key) => {
      const cd = tData.soldCards[key];
      if (cd.userId === uid) {
        const cardNumber = parseInt(key.replace('carton_', ''), 10);
        // Usamos la nueva función para reconstruir la matriz
        const numbers = normalizeToColumnMatrix(cd.cardNumbers);
        cards.push({ cardNumber, cardData: cd, numbers });
      }
    });
    return cards.sort((a, b) => a.cardNumber - b.cardNumber);
  }

  const getNumberColor = (number) => {
    if (number === 'FREE') return 'bg-purple-500 text-white';
    if (!calledNumbers.includes(number)) return 'bg-white/10 text-white';
    if (number === currentNumber) return 'bg-yellow-500 text-white animate-pulse';
    return 'bg-green-500 text-white';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 flex items-center justify-center">
        <div className="text-white text-xl">Cargando juego de Bingo...</div>
      </div>
    );
  }

  if (!tournament) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 flex items-center justify-center">
        <div className="text-white text-xl">Error cargando el torneo</div>
        <button onClick={() => navigate('/bingo')} className="ml-4 bg-blue-600 text-white px-4 py-2 rounded">
          Volver al Lobby
        </button>
      </div>
    );
  }

  const pricePerCard = tournament.pricePerCard || 100;
  const totalPrize = (Object.keys(tournament.soldCards || {}).length * pricePerCard) * 0.7;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 p-4">
      <div className="max-w-7xl mx-auto mb-6">
        <div className="flex justify-between items-center bg-black/40 rounded-xl p-4">
          <div>
            <h1 className="text-3xl font-bold text-white">🎰 BINGO EN VIVO</h1>
            <p className="text-white/70">{tournament.name}</p>
            <p className="text-white/60 text-sm">
              {tournament.startedAt?.toDate().toLocaleString('es-VE')}
            </p>
          </div>
          <div className="flex items-center space-x-4">
            <button
              onClick={() => navigate('/bingo')}
              className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg"
            >
              ← Volver al Lobby
            </button>
            <button
              onClick={() => navigate('/lobby')}
              className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg"
            >
              🎮 Sala de Juegos
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-white/10 rounded-xl p-6 text-center border-2 border-yellow-500/50">
            <div className="text-white/70 text-sm mb-2">NÚMERO ACTUAL</div>
            <div className="text-6xl font-bold text-yellow-400 mb-2">
              {currentNumber || '--'}
            </div>
            <div className="text-white/60">
              {calledNumbers.length}/75 números cantados
            </div>
          </div>

          <div
            className={`rounded-xl p-4 text-center border-2 ${
              gameStatus === 'active'
                ? 'bg-green-500/20 border-green-500/50'
                : gameStatus === 'finished'
                ? 'bg-red-500/20 border-red-500/50'
                : 'bg-yellow-500/20 border-yellow-500/50'
            }`}
          >
            <div className="text-white font-bold text-lg mb-1">
              {gameStatus === 'active'
                ? '🎮 JUGANDO'
                : gameStatus === 'finished'
                ? '🏆 TERMINADO'
                : '⏳ ESPERANDO'}
            </div>
            <div className="text-white/70 text-sm">
              {gameStatus === 'active'
                ? 'El sorteo es automático...'
                : gameStatus === 'finished'
                ? `Ganadore${(winners?.length || 0) === 1 ? '' : 's'}: ${winners?.length || 0}`
                : 'El torneo comenzará pronto'}
            </div>
          </div>

          <div className="bg-white/10 rounded-xl p-4">
            <h3 className="text-white font-bold mb-3">Últimos Números</h3>
            <div className="grid grid-cols-5 gap-2">
              {calledNumbers.slice(-15).reverse().map((num, index) => (
                <div
                  key={index}
                  className={`text-center py-2 rounded ${
                    num === currentNumber ? 'bg-yellow-500/30 text-yellow-300' : 'bg-white/10 text-white'
                  }`}
                >
                  {num}
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white/10 rounded-xl p-4">
            <h3 className="text-white font-bold mb-3">📊 Información</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-white/70">Cartones vendidos:</span>
                <span className="text-white">{Object.keys(tournament.soldCards || {}).length}/100</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/70">Premio total:</span>
                <span className="text-green-400">
                  Bs. {totalPrize.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/70">Tus cartones:</span>
                <span className="text-yellow-400">{userCards.length}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2">
          <h2 className="text-2xl font-bold text-white mb-4">
            Tus Cartones ({userCards.length})
          </h2>

          {userCards.length === 0 ? (
            <div className="text-center py-12 bg-white/5 rounded-xl">
              <div className="text-6xl mb-4">📭</div>
              <p className="text-white/70 text-lg">No tienes cartones en este torneo</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {userCards.map((card) => (
                <div key={card.cardNumber} className="bg-white/5 rounded-xl p-4 border border-white/10">
                  <div className="text-center mb-3">
                    <span className="bg-purple-500/20 text-purple-300 px-3 py-1 rounded-full text-sm">
                      Cartón #{card.cardNumber}
                    </span>
                  </div>

                  <div className="grid grid-cols-5 gap-1">
                    {['B', 'I', 'N', 'G', 'O'].map((letter, colIndex) => (
                      <div key={letter} className="text-center">
                        <div className="font-bold text-red-400 text-sm mb-1">{letter}</div>
                        {(card.numbers[colIndex] || []).map((number, rowIndex) => (
                          <div
                            key={`${colIndex}-${rowIndex}`}
                            className={`p-2 m-1 rounded text-sm font-bold transition-all ${getNumberColor(number)}`}
                          >
                            {number}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {winners.length > 0 && !isWinnerModalClosed && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="bg-gradient-to-br from-green-500 to-emerald-600 rounded-2xl p-8 max-w-2xl w-full mx-4 text-center relative">
            <button 
              onClick={() => setIsWinnerModalClosed(true)}
              className="absolute top-2 right-2 bg-white/20 text-white rounded-full w-8 h-8 flex items-center justify-center hover:bg-white/40 transition-colors"
            >
              X
            </button>
            <div className="text-6xl mb-4">🎉</div>
            <h2 className="text-4xl font-bold text-white mb-4">¡BINGO!</h2>
            <div className="text-white text-lg mb-6">
              {winners.length === 1 ? '¡Tenemos un ganador!' : `¡Tenemos ${winners.length} ganadores!`}
            </div>

            <div className="space-y-3 mb-6 max-h-60 overflow-y-auto">
              {winners.map((winner, index) => (
                <div key={index} className="bg-white/20 rounded-lg p-3">
                  <div className="font-bold text-white text-lg">{winner.userName}</div>
                  <div className="text-white/80">
                    Carton{winner.cards?.length > 1 ? 'es' : ''}: #{winner.cards?.join(', ')}
                  </div>
                  <div className="text-yellow-300 font-bold text-xl">
                    Premio: Bs. {winner.prizeAmount?.toLocaleString('es-VE', { minimumFractionDigits: 2 })}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex space-x-4 justify-center">
              <button
                onClick={() => navigate('/bingo')}
                className="bg-white text-green-600 font-bold py-3 px-8 rounded-lg text-lg hover:bg-gray-100 transition-all"
              >
                Volver al Lobby
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BingoGame;