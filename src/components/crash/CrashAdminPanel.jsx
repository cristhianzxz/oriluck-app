import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { db, functions } from '../../firebase';
import { collection, doc, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

const CrashAdminPanel = () => {
  // Estados Firestore en vivo
  const [liveGameData, setLiveGameData] = useState(null);
  const [livePlayers, setLivePlayers] = useState([]);
  const [roundHistory, setRoundHistory] = useState([]);
  const [engineStatus, setEngineStatus] = useState('loading');
  const [loading, setLoading] = useState(true);
  const [isToggling, setIsToggling] = useState(false);

  // Métricas calculadas
  const [liveMetrics, setLiveMetrics] = useState({ pot: 0, payout: 0, profit: 0 });
  const [globalMetrics, setGlobalMetrics] = useState({ totalProfit: 0, rtp: 0 });

  // Funciones "llamables" para controlar el motor
  const toggleCrashEngineCallable = httpsCallable(functions, 'toggleCrashEngine');
  const startCrashEngineLoopCallable = httpsCallable(functions, 'startCrashEngineLoop'); // <-- FUNCIÓN AÑADIDA

  // Parámetros visibles (solo lectura)
  const gameConfig = {
    houseEdge: 3.0, // %
    instantCrashProb: 1.0, // %
  };

  // Helpers
  const toDate = (ts) => {
    if (!ts) return null;
    if (typeof ts.toDate === 'function') return ts.toDate();
    if (ts.seconds) return new Date(ts.seconds * 1000);
    if (typeof ts === 'number') return new Date(ts);
    if (ts instanceof Date) return ts;
    return null;
  };

  const formatDateTime = (ts) => {
    const d = toDate(ts);
    if (!d) return '';
    return d.toLocaleString('es-VE', { hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit', year: '2-digit' });
  };

  const stateLabel = (state) => {
    switch ((state || '').toLowerCase()) {
      case 'waiting': return 'Esperando';
      case 'running': return 'En Curso';
      case 'crashed': return 'Crasheado';
      default: return 'N/A';
    }
  };

  // --- LÓGICA DEL BOTÓN CORREGIDA ---
  const handleToggleEngine = async () => {
    const isCurrentlyEnabled = engineStatus === 'enabled';
    const action = isCurrentlyEnabled ? 'DESACTIVAR' : 'ACTIVAR';

    if (!window.confirm(`¿Estás seguro de que quieres ${action} el motor del juego?`)) {
        return;
    }

    setIsToggling(true);
    try {
        let result;
        if (isCurrentlyEnabled) {
            // Si está encendido, lo apagamos (usando la función de siempre)
            result = await toggleCrashEngineCallable({ status: 'disabled' });
        } else {
            // Si está apagado, lo arrancamos por primera vez (usando la nueva función de arranque)
            result = await startCrashEngineLoopCallable();
        }
        alert(`✅ Éxito: ${result.data.message}`);
    } catch (error) {
        console.error("Error al cambiar el estado del motor:", error);
        alert(`❌ Error: ${error.message}`);
    } finally {
        setIsToggling(false);
    }
  };

  // Listeners de Firestore
  useEffect(() => {
    const unsubLiveGame = onSnapshot(doc(db, 'game_crash', 'live_game'), (snap) => {
      if (snap.exists()) setLiveGameData(snap.data());
    });

    const unsubPlayers = onSnapshot(collection(db, 'game_crash', 'live_game', 'players'), (snap) => {
      const playersData = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setLivePlayers(playersData);
    });

    const unsubEngineConfig = onSnapshot(doc(db, 'game_crash', 'engine_config'), (snap) => {
      if (snap.exists()) {
        setEngineStatus(snap.data().status || 'disabled');
      } else {
        setEngineStatus('disabled');
      }
    });

    const historyQuery = query(collection(db, 'game_crash_history'), orderBy('timestamp', 'desc'), limit(100));
    const unsubHistory = onSnapshot(historyQuery, (snap) => {
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setRoundHistory(data);
      setLoading(false);
    });

    return () => {
      unsubLiveGame();
      unsubPlayers();
      unsubEngineConfig();
      unsubHistory();
    };
  }, []);

  // Cálculos de métricas
  useEffect(() => {
    const totalPot = livePlayers.reduce((sum, p) => sum + Number(p?.bet || 0), 0);
    const totalPayout = livePlayers
      .filter((p) => p.status === 'cashed_out')
      .reduce((sum, p) => sum + Number(p.winnings || 0), 0);

    setLiveMetrics({ pot: totalPot, payout: totalPayout, profit: totalPot - totalPayout });

    const now = Date.now();
    const last24hRounds = roundHistory.filter(r => (now - toDate(r.timestamp).getTime()) <= 24 * 60 * 60 * 1000);

    if (last24hRounds.length > 0) {
      const totalNetProfit = last24hRounds.reduce((sum, r) => sum + Number(r?.netProfit || 0), 0);
      const totalBet = last24hRounds.reduce((sum, r) => sum + Number(r?.totalPot || 0), 0);
      const rtp = totalBet > 0 ? ((totalBet - totalNetProfit) / totalBet) * 100 : 0;
      setGlobalMetrics({ totalProfit: totalNetProfit, rtp });
    } else {
      setGlobalMetrics({ totalProfit: 0, rtp: 0 });
    }
  }, [livePlayers, roundHistory]);

  if (loading) {
    return <div className="text-center p-10 text-white">Cargando panel de control...</div>;
  }

  return (
   <div className="p-6 bg-gray-900 text-white min-h-screen">
        {/* Sección 1: Estado en vivo y control del motor */}
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-cyan-400">🚀 Panel de Administrador - Ascenso Estelar</h1>
        <Link to="/crash" className="bg-blue-500 hover:bg-blue-400 text-white font-bold py-2 px-4 rounded-lg transition-colors">
          Volver al Juego
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="md:col-span-2 bg-gray-800 p-6 rounded-lg border border-white/10">
          <h2 className="text-xl font-semibold mb-4">Ronda Actual: #{liveGameData?.roundId ?? '...'}</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <div>
              <p className="text-sm text-gray-400">Estado</p>
              <p className={`text-lg font-bold ${(liveGameData?.gameState === 'running') ? 'text-green-400' : 'text-yellow-400'}`}>
                {stateLabel(liveGameData?.gameState)}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-400">Pozo Actual</p>
              <p className="text-lg font-bold">{liveMetrics.pot.toFixed(2)} Bs.</p>
            </div>
            <div>
              <p className="text-sm text-gray-400">Jugadores</p>
              <p className="text-lg font-bold">{livePlayers.length}</p>
            </div>
            <div>
              <p className="text-sm text-gray-400">Ganancia/Pérdida</p>
              <p className={`text-lg font-bold ${liveMetrics.profit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                {liveMetrics.profit.toFixed(2)} Bs.
              </p>
            </div>
          </div>
        </div>

        <div className="md:col-span-1 bg-gray-800 p-6 rounded-lg border border-white/10 flex flex-col justify-between">
          <div>
            <h2 className="text-xl font-semibold mb-4">Control del Motor y Métricas</h2>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Margen de la Casa:</span>
                <span className="font-mono bg-blue-500/20 text-blue-300 px-2 rounded">{gameConfig.houseEdge.toFixed(1)}%</span>
              </div>
              <div className="flex justify-between text-sm pt-2 border-t border-white/10">
                <span className="text-gray-400">Ganancia Neta (24h):</span>
                <span className={`font-bold ${globalMetrics.totalProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>{globalMetrics.totalProfit.toFixed(2)} Bs.</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">RTP % (24h):</span>
                <span className="font-bold">{globalMetrics.rtp.toFixed(2)}%</span>
              </div>
            </div>
          </div>

          <div className="mt-6">
            <div className="text-center mb-3">
              <p className="text-gray-400">Estado del Motor</p>
              {engineStatus === 'loading' ? (
                <p className="font-bold text-lg text-yellow-400">Cargando...</p>
              ) : (
                <p className={`font-bold text-lg ${engineStatus === 'enabled' ? 'text-green-400' : 'text-red-400'}`}>
                  {engineStatus === 'enabled' ? '● ACTIVADO' : '● DESACTIVADO'}
                </p>
              )}
            </div>
            <button
              onClick={handleToggleEngine}
              disabled={isToggling || engineStatus === 'loading'}
              className={`w-full font-bold py-3 rounded-lg shadow-lg transition-all transform hover:scale-105 disabled:opacity-50 disabled:cursor-wait
                ${engineStatus === 'enabled' ? 'bg-red-600 hover:bg-red-500' : 'bg-green-600 hover:bg-green-500'}`}
            >
              {isToggling ? 'Cambiando...' : (engineStatus === 'enabled' ? 'Apagar Motor' : 'Encender Motor')}
            </button>
          </div>
        </div>
      </div>

      {/* Sección 2: Historial de rondas */}
      <div className="bg-gray-800 p-6 rounded-lg border border-white/10">
        <h2 className="text-xl font-semibold mb-4">Historial de Rondas Recientes</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-gray-400">
              <tr>
                <th className="p-2">ID Ronda</th>
                <th className="p-2">Punto de Crash</th>
                <th className="p-2">Pozo Total</th>
                <th className="p-2">Ganancia Neta</th>
                <th className="p-2">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {roundHistory.length === 0 && (
                <tr>
                  <td className="p-4 text-center text-gray-500" colSpan={5}>
                    No hay rondas registradas.
                  </td>
                </tr>
              )}
              {roundHistory.map((round) => {
                const crashPoint = Number(round?.crashPoint ?? 0);
                const totalPot = Number(round?.totalPot ?? 0);
                const netProfit = Number(round?.netProfit ?? 0);
                return (
                  <tr key={round.id} className="border-t border-white/10 hover:bg-white/5">
                    <td className="p-2 font-mono text-xs text-gray-500">#{round.id}</td>
                    <td className={`p-2 font-bold ${crashPoint < 2 ? 'text-red-400' : 'text-green-400'}`}>
                      {crashPoint.toFixed(2)}x
                    </td>
                    <td className="p-2">{totalPot.toFixed(2)} Bs.</td>
                    <td className={`p-2 font-bold ${netProfit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {netProfit.toFixed(2)} Bs.
                    </td>
                    <td className="p-2 text-gray-400">{formatDateTime(round?.timestamp)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
export default CrashAdminPanel;