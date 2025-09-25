import React, { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../../App';
import {
  collection, doc, getDocs, getDoc, addDoc, updateDoc,
  onSnapshot, serverTimestamp, arrayUnion, writeBatch, increment,
  query, orderBy, runTransaction
} from 'firebase/firestore';
import { db } from '../../firebase';

const BingoAdmin = () => {
  const navigate = useNavigate();
  const { currentUser } = useContext(AuthContext);
  const [tournaments, setTournaments] = useState([]);
  const [selectedTournament, setSelectedTournament] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('tournaments');
  const [newTournament, setNewTournament] = useState({
    name: '',
    startTime: ''
  });

  const isAdmin = currentUser?.email === "cristhianzxz@hotmail.com" || currentUser?.email === "admin@oriluck.com";

  useEffect(() => {
    if (!isAdmin) {
      navigate('/bingo');
      return;
    }
    loadTournaments();
  }, [isAdmin, navigate]);

  const loadTournaments = () => {
    const q = query(collection(db, 'bingoTournaments'), orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const tournamentsData = [];
      snapshot.forEach(doc => {
        tournamentsData.push({ id: doc.id, ...doc.data() });
      });
      setTournaments(tournamentsData);
      setLoading(false);
    });

    return unsubscribe;
  };

  const createTournament = async () => {
    if (!newTournament.name || !newTournament.startTime) {
      alert('Completa el nombre y la fecha/hora de inicio');
      return;
    }

    try {
      const rateDoc = await getDoc(doc(db, 'appSettings', 'exchangeRate'));
      const exchangeRate = rateDoc.exists() ? rateDoc.data().rate : 100;
      const startTime = new Date(newTournament.startTime);

      const tournamentData = {
        name: newTournament.name,
        startTime: startTime,
        pricePerCard: exchangeRate,
        status: 'waiting',
        availableCards: Array.from({ length: 100 }, (_, i) => i + 1),
        soldCards: {},
        calledNumbers: [],
        winners: [],
        allowPurchases: true,
        autoStart: true,
        createdAt: serverTimestamp(),
        createdBy: currentUser.email,
        exchangeRate: exchangeRate
      };

      await addDoc(collection(db, 'bingoTournaments'), tournamentData);

      alert('✅ Torneo creado exitosamente! Se iniciará automáticamente a la hora programada.');
      setNewTournament({ name: '', startTime: '' });
    } catch (error) {
      console.error('Error creando torneo:', error);
      alert('❌ Error al crear el torneo');
    }
  };

  const startTournament = async (tournamentId) => {
    try {
      await updateDoc(doc(db, 'bingoTournaments', tournamentId), {
        status: 'active',
        allowPurchases: false,
        startedAt: serverTimestamp()
      });
      alert('🎮 Torneo iniciado! La compra de cartones ha sido cerrada.');
    } catch (error) {
      console.error('Error iniciando torneo:', error);
      alert('❌ Error al iniciar el torneo');
    }
  };

  const finishTournament = async (tournamentId) => {
    try {
      await updateDoc(doc(db, 'bingoTournaments', tournamentId), {
        status: 'finished',
        finishedAt: serverTimestamp()
      });
      alert('🏆 Torneo finalizado!');
    } catch (error) {
      console.error('Error finalizando torneo:', error);
      alert('❌ Error al finalizar el torneo');
    }
  };

  const generateUniqueNumber = (existingNumbers) => {
    const allNumbers = Array.from({ length: 75 }, (_, i) => i + 1);
    const availableNumbers = allNumbers.filter(num => !existingNumbers.includes(num));
    return availableNumbers.length > 0 ? availableNumbers[Math.floor(Math.random() * availableNumbers.length)] : null;
  };

  const callNumberManually = async (tournamentId) => {
    const tournament = tournaments.find(t => t.id === tournamentId);
    if (!tournament) return;

    const newNumber = generateUniqueNumber(tournament.calledNumbers || []);
    if (!newNumber) {
      alert('🎯 Todos los números ya han sido llamados!');
      return;
    }

    try {
      await updateDoc(doc(db, 'bingoTournaments', tournamentId), {
        currentNumber: newNumber,
        calledNumbers: arrayUnion(newNumber),
        lastNumberTime: serverTimestamp()
      });
    } catch (error) {
      console.error('Error llamando número:', error);
      alert('❌ Error al llamar número');
    }
  };

  // Normalizador a matriz por columnas (B,I,N,G,O)
  const normalizeToColumnMatrix = (input) => {
    const ensureFreeCenter = (m) => {
      const matrix = m.map(col => col.slice());
      if (matrix[2][2] !== 'FREE') matrix[2][2] = 'FREE';
      return matrix;
    };

    if (Array.isArray(input) && Array.isArray(input[0])) {
      const arr = input;
      if (arr.length === 5 && arr.every(c => Array.isArray(c) && c.length === 5)) {
        // Heurística simple: si no es columnas, trasponer
        const inRange = (n, min, max) => typeof n === 'number' && n >= min && n <= max;
        const ranges = [[1,15],[16,30],[31,45],[46,60],[61,75]];
        const score = arr.reduce((acc, col, ci) => {
          const [mn, mx] = ranges[ci];
          return acc + col.reduce((s, v) => s + (v === 'FREE' || inRange(v, mn, mx) ? 1 : 0), 0);
        }, 0);
        if (score >= 20) return ensureFreeCenter(arr);

        const cols = Array.from({ length: 5 }, () => Array(5).fill(null));
        for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) cols[c][r] = arr[r][c];
        return ensureFreeCenter(cols);
      }
    }

    if (Array.isArray(input) && !Array.isArray(input[0])) {
      const flat = input.slice(0, 25);
      if (flat.length === 25) {
        const cols = [];
        for (let c = 0; c < 5; c++) cols.push(flat.slice(c * 5, c * 5 + 5));
        return ensureFreeCenter(cols);
      }
    }

    return null;
  };

  const hasBlackout = (matrixCols, called) => {
    if (!Array.isArray(matrixCols) || matrixCols.length !== 5) return false;
    const calledSet = new Set(called || []);
    const isMarked = (val) => val === 'FREE' || calledSet.has(val);

    for (let c = 0; c < 5; c++) {
      for (let r = 0; r < 5; r++) {
        if (!isMarked(matrixCols[c]?.[r])) return false;
      }
    }
    return true;
  };

  // Declaración manual: calcula TODOS los ganadores (blackout) y divide premio
  const declareManualWinner = async (tournamentId) => {
    try {
      await runTransaction(db, async (tx) => {
        const tRef = doc(db, 'bingoTournaments', tournamentId);
        const tSnap = await tx.get(tRef);
        if (!tSnap.exists()) throw new Error('Torneo no encontrado');

        const cur = tSnap.data();
        if (cur.status === 'finished' || (cur.winners && cur.winners.length > 0)) {
          throw new Error('El torneo ya tiene ganador(es).');
        }

        const called = cur.calledNumbers || [];
        const sold = cur.soldCards || {};

        const winnersList = [];
        Object.keys(sold).forEach((cardKey) => {
          const cardData = sold[cardKey];
          const matrix = normalizeToColumnMatrix(cardData.cardNumbers);
          if (matrix && hasBlackout(matrix, called)) {
            winnersList.push({
              userId: cardData.userId,
              userName: cardData.userName,
              cardNumber: parseInt(cardKey.replace('carton_', ''), 10)
            });
          }
        });

        if (winnersList.length === 0) throw new Error('No hay jugadores con BLACKOUT.');

        const totalSold = Object.keys(cur.soldCards || {}).length;
        const pricePerCard = cur.pricePerCard || 100;
        const prizePool = Math.floor(totalSold * pricePerCard * 0.7);
        const prizePerWinner = Math.floor(prizePool / winnersList.length);

        const updatedWinners = [
          ...(cur.winners || []),
          ...winnersList.map((w) => ({
            ...w,
            prizeAmount: prizePerWinner,
            winTime: serverTimestamp(),
            manualDeclaration: true,
            pattern: 'BLACKOUT'
          }))
        ];

        tx.update(tRef, {
          winners: updatedWinners,
          status: 'finished'
        });

        winnersList.forEach((w) => {
          const userRef = doc(db, 'users', w.userId);
          tx.update(userRef, { balance: increment(prizePerWinner) });

          const transactionRef = doc(collection(db, 'transactions'));
          tx.set(transactionRef, {
            userId: w.userId,
            type: 'bingo_prize',
            amount: prizePerWinner,
            description: `🏆 Premio BINGO (Manual - Blackout) - ${cur.name} - Cartón ${w.cardNumber}`,
            status: 'completed',
            timestamp: serverTimestamp(),
            tournamentId
          });
        });
      });

      alert('✅ Ganador(es) declarado(s) por BLACKOUT y premio dividido correctamente.');
    } catch (error) {
      console.error('Error declarando ganadores:', error);
      alert(`❌ ${error.message || 'Error al declarar ganadores'}`);
    }
  };

  const deleteTournament = async (tournamentId) => {
    if (!window.confirm('¿Estás seguro de eliminar este torneo? Esta acción no se puede deshacer.')) return;

    try {
      await updateDoc(doc(db, 'bingoTournaments', tournamentId), {
        status: 'deleted',
        deletedAt: serverTimestamp(),
        deletedBy: currentUser.email
      });
      alert('✅ Torneo eliminado');
    } catch (error) {
      console.error('Error eliminando torneo:', error);
      alert('❌ Error al eliminar torneo');
    }
  };

  const TournamentStats = ({ tournament }) => {
    const [showDetails, setShowDetails] = useState(false);

    return (
      <div className="bg-white/5 rounded-xl p-4 mb-4">
        <div className="flex justify-between items-center cursor-pointer" onClick={() => setShowDetails(!showDetails)}>
          <div>
            <h4 className="font-bold text-white">{tournament.name}</h4>
            <div className="text-white/70 text-sm">
              {tournament.startTime?.toDate().toLocaleString('es-VE')}
            </div>
          </div>
          <div className="text-right">
            <div className="text-white">{Object.keys(tournament.soldCards || {}).length} cartones</div>
            <div className="text-green-400 text-sm">
              Bs. {((Object.keys(tournament.soldCards || {}).length * (tournament.pricePerCard || 100)) * 0.7).toLocaleString()}
            </div>
          </div>
          <button className="text-white/70">
            {showDetails ? '▲' : '▼'}
          </button>
        </div>

        {showDetails && (
          <div className="mt-4 p-4 bg-white/10 rounded-lg">
            <h5 className="font-bold text-white mb-3">👥 Jugadores y Cartones</h5>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {Object.entries(tournament.soldCards || {}).map(([cardKey, data]) => (
                <div key={cardKey} className="flex justify-between items-center py-2 border-b border-white/10">
                  <div>
                    <div className="text-white font-semibold">{data.userName}</div>
                    <div className="text-white/70 text-sm">Cartón: {cardKey.replace('carton_', '')}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-green-400 text-sm">Bs. {tournament.pricePerCard || 100}</div>
                    <div className="text-white/60 text-xs">
                      {data.purchaseTime?.toDate?.().toLocaleString('es-VE', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {tournament.winners && tournament.winners.length > 0 && (
              <div className="mt-4 bg-green-500/20 rounded-lg p-3">
                <h5 className="font-bold text-green-300 mb-2">🏆 Ganadores</h5>
                {tournament.winners.map((winner, index) => (
                  <div key={index} className="text-white text-sm">
                    {winner.userName} - Cartón #{winner.cardNumber} - Bs. {winner.prizeAmount?.toLocaleString()}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  if (!isAdmin) {
    return null;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 flex items-center justify-center">
        <div className="text-white text-xl">Cargando panel de Bingo...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-green-900 to-gray-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white">🎯 ADMIN BINGO</h1>
            <p className="text-white/70">Gestión completa del sistema de Bingo</p>
          </div>
          <div className="flex space-x-3">
            <button
              onClick={() => navigate('/bingo')}
              className="bg-gray-600 hover:bg-gray-700 text-white px-6 py-3 rounded-lg"
            >
              ← Volver al Bingo
            </button>
            <button
              onClick={() => navigate('/admin')}
              className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-lg"
            >
              ⚙️ Panel Principal
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex space-x-4 mb-6">
          {['tournaments', 'create', 'stats'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-6 py-3 rounded-lg font-semibold transition-all ${
                activeTab === tab
                  ? 'bg-green-600 text-white shadow-lg'
                  : 'bg-white/10 text-white hover:bg-white/20'
              }`}
            >
              {tab === 'tournaments' && '🎮 Torneos Activos'}
              {tab === 'create' && '➕ Crear Torneo'}
              {tab === 'stats' && '📊 Estadísticas'}
            </button>
          ))}
        </div>

        {/* Contenido */}
        <div className="bg-white/10 rounded-2xl p-6 backdrop-blur-lg border border-white/20">
          {activeTab === 'tournaments' && (
            <div>
              <h2 className="text-2xl font-bold text-white mb-6">Gestión de Torneos en Tiempo Real</h2>

              {tournaments.filter(t => t.status !== 'deleted').length === 0 ? (
                <div className="text-center py-12">
                  <div className="text-6xl mb-4">📭</div>
                  <p className="text-white/70 text-lg">No hay torneos creados</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {tournaments.filter(t => t.status !== 'deleted').map(tournament => (
                    <div key={tournament.id} className="bg-white/5 rounded-xl p-6 border border-white/10">
                      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-center">
                        <div>
                          <h3 className="font-bold text-white text-lg">{tournament.name}</h3>
                          <div className="text-white/70 text-sm">
                            {tournament.startTime?.toDate().toLocaleString('es-VE')}
                          </div>
                          <span className={`px-2 py-1 rounded text-xs ${
                            tournament.status === 'active' ? 'bg-green-500/20 text-green-400' :
                            tournament.status === 'finished' ? 'bg-red-500/20 text-red-400' :
                            'bg-yellow-500/20 text-yellow-400'
                          }`}>
                            {tournament.status?.toUpperCase()}
                          </span>
                        </div>

                        <div>
                          <div className="text-white font-bold">
                            {Object.keys(tournament.soldCards || {}).length}/100 cartones
                          </div>
                          <div className="text-white/70 text-sm">
                            Tasa: Bs. {tournament.pricePerCard || 100} por cartón
                          </div>
                          <div className="text-white/70 text-sm">
                            Premio: Bs. {((Object.keys(tournament.soldCards || {}).length * (tournament.pricePerCard || 100)) * 0.7).toLocaleString()}
                          </div>
                        </div>

                        <div>
                          <div className="text-white/70 text-sm">Números:</div>
                          <div className="text-white font-bold">
                            {(tournament.calledNumbers || []).length}/75
                          </div>
                          <div className="text-white/70 text-sm">
                            Actual: {tournament.currentNumber || '--'}
                          </div>
                        </div>

                        <div className="space-y-2">
                          {tournament.status === 'waiting' && (
                            <button
                              onClick={() => startTournament(tournament.id)}
                              className="w-full bg-green-600 hover:bg-green-500 text-white py-2 px-4 rounded text-sm"
                            >
                              ▶️ Iniciar Ahora
                            </button>
                          )}

                          {tournament.status === 'active' && (
                            <>
                              <button
                                onClick={() => callNumberManually(tournament.id)}
                                className="w-full bg-blue-600 hover:bg-blue-500 text-white py-2 px-4 rounded text-sm"
                              >
                                🔢 Llamar Número
                              </button>
                              <button
                                onClick={() => declareManualWinner(tournament.id)}
                                className="w-full bg-yellow-600 hover:bg-yellow-500 text-white py-2 px-4 rounded text-sm"
                              >
                                🏆 Declarar Ganador(es) BLACKOUT
                              </button>
                              <button
                                onClick={() => finishTournament(tournament.id)}
                                className="w-full bg-red-600 hover:bg-red-500 text-white py-2 px-4 rounded text-sm"
                              >
                                ⏹️ Finalizar
                              </button>
                            </>
                          )}

                          <button
                            onClick={() => deleteTournament(tournament.id)}
                            className="w-full bg-gray-600 hover:bg-gray-500 text-white py-2 px-4 rounded text-sm"
                          >
                            🗑️ Eliminar
                          </button>
                        </div>
                      </div>

                      {/* Ganadores */}
                      {tournament.winners && tournament.winners.length > 0 && (
                        <div className="mt-4 p-3 bg-green-500/20 rounded-lg">
                          <h4 className="font-bold text-green-300 mb-2">🏆 Ganadores:</h4>
                          {tournament.winners.map((winner, index) => (
                            <div key={index} className="text-white text-sm">
                              {winner.userName} - Cartón #{winner.cardNumber} - Bs. {winner.prizeAmount?.toLocaleString()}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'create' && (
            <div className="max-w-md">
              <h2 className="text-2xl font-bold text-white mb-6">Crear Nuevo Torneo</h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-white font-semibold mb-2">🎯 Nombre del Torneo</label>
                  <input
                    type="text"
                    value={newTournament.name}
                    onChange={(e) => setNewTournament({...newTournament, name: e.target.value})}
                    className="w-full p-3 rounded-lg bg-white/10 border border-white/20 text-white"
                    placeholder="Ej: Torneo VIP Nocturno"
                  />
                </div>

                <div>
                  <label className="block text-white font-semibold mb-2">⏰ Fecha y Hora de Inicio</label>
                  <input
                    type="datetime-local"
                    value={newTournament.startTime}
                    onChange={(e) => setNewTournament({...newTournament, startTime: e.target.value})}
                    className="w-full p-3 rounded-lg bg-white/10 border border-white/20 text-white"
                  />
                </div>

                <div className="bg-blue-500/20 rounded-lg p-4 border border-blue-500/30">
                  <h4 className="font-bold text-blue-300 mb-2">💡 Información Automática</h4>
                  <div className="text-white/80 text-sm space-y-1">
                    <div>• Precio por cartón: Se ajusta automáticamente a la tasa BCV del día</div>
                    <div>• Inicio: Automático a la hora programada</div>
                    <div>• Compra: Se cierra automáticamente al iniciar</div>
                  </div>
                </div>

                <button
                  onClick={createTournament}
                  className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-3 px-6 rounded-lg transition-all"
                >
                  🎯 Crear Torneo
                </button>
              </div>
            </div>
          )}

          {activeTab === 'stats' && (
            <div>
              <h2 className="text-2xl font-bold text-white mb-6">📊 Estadísticas Completas del Bingo</h2>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
                <div className="bg-white/10 rounded-xl p-6 text-center">
                  <div className="text-3xl font-bold text-white">{tournaments.filter(t => t.status !== 'deleted').length}</div>
                  <div className="text-white/70">Total Torneos</div>
                </div>

                <div className="bg-green-500/20 rounded-xl p-6 text-center border border-green-500/30">
                  <div className="text-3xl font-bold text-green-400">
                    {tournaments.filter(t => t.status === 'active').length}
                  </div>
                  <div className="text-green-400/70">Activos Ahora</div>
                </div>

                <div className="bg-blue-500/20 rounded-xl p-6 text-center border border-blue-500/30">
                  <div className="text-3xl font-bold text-blue-400">
                    {tournaments.reduce((total, t) => total + Object.keys(t.soldCards || {}).length, 0)}
                  </div>
                  <div className="text-blue-400/70">Cartones Totales</div>
                </div>

                <div className="bg-purple-500/20 rounded-xl p-6 text-center border border-purple-500/30">
                  <div className="text-3xl font-bold text-purple-400">
                    {tournaments.reduce((total, t) => total + (t.winners?.length || 0), 0)}
                  </div>
                  <div className="text-purple-400/70">Ganadores Totales</div>
                </div>
              </div>

              <div className="bg-white/5 rounded-xl p-6">
                <h3 className="text-xl font-bold text-white mb-4">📈 Estadísticas por Torneo</h3>
                <div className="space-y-3">
                  {tournaments
                    .filter(t => t.status !== 'deleted')
                    .sort((a, b) => b.startTime?.toDate() - a.startTime?.toDate())
                    .map(tournament => (
                      <TournamentStats key={tournament.id} tournament={tournament} />
                    ))
                  }
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BingoAdmin;