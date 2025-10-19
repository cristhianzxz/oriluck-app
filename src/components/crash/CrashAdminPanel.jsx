import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { db, functions } from '../../firebase';
import { collection, doc, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

const formatCurrency = (value) => {
    const number = Number(value) || 0;
    return new Intl.NumberFormat('es-VE', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(number);
};

const CrashAdminPanel = () => {
    const [liveGameData, setLiveGameData] = useState(null);
    const [livePlayers, setLivePlayers] = useState([]);
    const [roundHistory, setRoundHistory] = useState([]);
    const [engineStatus, setEngineStatus] = useState('loading');
    const [loading, setLoading] = useState(true);
    const [isToggling, setIsToggling] = useState(false);
    
    const [limits, setLimits] = useState({ minBet: 0, maxBet: 0, maxProfit: 0, recoveryModeMaxBet: 0 });
    const [isSavingLimits, setIsSavingLimits] = useState(false);

    const [liveMetrics, setLiveMetrics] = useState({ pot: 0, payout: 0, profit: 0 });
    const [globalMetrics, setGlobalMetrics] = useState({ totalProfit: 0, rtp: 0 });

    const toggleCrashEngineCallable = httpsCallable(functions, 'toggleCrashEngine');
    const startCrashEngineLoopCallable = httpsCallable(functions, 'startCrashEngineLoop');
    const updateCrashLimitsCallable = httpsCallable(functions, 'updateCrashLimits');

    const gameConfig = {
        houseEdge: 5.0, // <-- CAMBIADO DE 3.0 a 5.0
        instantCrashProb: 1.0, // Esto parece referirse a la probabilidad base de 1.00x, que depende del hash
    };

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
                result = await toggleCrashEngineCallable({ status: 'disabled' });
            } else {
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
    
    const handleLimitsChange = (e) => {
        const { name, value } = e.target;
        // Permitir entrada con coma o punto, convertir a número
        let numericValue = 0;
        if (value) {
             const cleanedValue = value.replace(',', '.');
             numericValue = parseFloat(cleanedValue);
             if (isNaN(numericValue)) numericValue = 0; // Asegurar que sea número
        }
        setLimits(prev => ({ ...prev, [name]: numericValue }));
    };

     const formatInputForDisplay = (value) => {
          // Formatear el número para mostrarlo con coma decimal si es necesario
          if (value === null || value === undefined || isNaN(value)) return '';
          return value.toString().replace('.', ',');
     };


    const handleSaveLimits = async () => {
        const numericLimits = {
            minBet: Number(limits.minBet),
            maxBet: Number(limits.maxBet),
            maxProfit: Number(limits.maxProfit),
            recoveryModeMaxBet: Number(limits.recoveryModeMaxBet),
        };

        if(numericLimits.minBet >= numericLimits.maxBet) {
            alert('❌ Error: La apuesta mínima no puede ser mayor o igual a la máxima.');
            return;
        }
         if(numericLimits.recoveryModeMaxBet < numericLimits.minBet || numericLimits.recoveryModeMaxBet > numericLimits.maxBet) {
              alert('❌ Error: La apuesta máxima en recuperación debe estar entre la mínima y la máxima general.');
              return;
         }
         if(numericLimits.minBet <= 0 || numericLimits.maxBet <= 0 || numericLimits.maxProfit <= 0 || numericLimits.recoveryModeMaxBet <=0) {
              alert('❌ Error: Todos los límites deben ser mayores a cero.');
              return;
         }

        setIsSavingLimits(true);
        try {
            const result = await updateCrashLimitsCallable(numericLimits);
            alert(`✅ Éxito: ${result.data.message}`);
        } catch(error) {
            console.error("Error al guardar los límites:", error);
            alert(`❌ Error: ${error.message}`);
        } finally {
            setIsSavingLimits(false);
        }
    };

    useEffect(() => {
        const unsubLiveGame = onSnapshot(doc(db, 'game_crash', 'live_game'), (snap) => {
            if (snap.exists()) setLiveGameData(snap.data());
        });
        const unsubPlayers = onSnapshot(collection(db, 'game_crash', 'live_game', 'players'), (snap) => {
            const playersData = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
            setLivePlayers(playersData);
        });
        const unsubEngineConfig = onSnapshot(doc(db, 'game_crash', 'engine_config'), (snap) => {
            if (snap.exists()) setEngineStatus(snap.data().status || 'disabled');
            else setEngineStatus('disabled');
        });
        const historyQuery = query(collection(db, 'game_crash_history'), orderBy('timestamp', 'desc'), limit(100));
        const unsubHistory = onSnapshot(historyQuery, (snap) => {
            const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
            setRoundHistory(data);
            setLoading(false); // Marcar como cargado después de obtener historial
        }, err => {
             console.error("Error fetching history:", err);
             setLoading(false); // Marcar como cargado incluso si hay error
        });
        const unsubLimits = onSnapshot(doc(db, 'appSettings', 'crashLimits'), (snap) => {
            if (snap.exists()) {
                 setLimits(snap.data());
            } else {
                 // Establecer valores predeterminados o indicar que no existen
                 setLimits({ minBet: 0, maxBet: 0, maxProfit: 0, recoveryModeMaxBet: 0 });
            }
        }, err => {
            console.error("Error fetching limits:", err);
             // Manejar error de lectura de límites
             setLimits({ minBet: 0, maxBet: 0, maxProfit: 0, recoveryModeMaxBet: 0 });
        });


        return () => {
            unsubLiveGame();
            unsubPlayers();
            unsubEngineConfig();
            unsubHistory();
            unsubLimits();
        };
    }, []);

    useEffect(() => {
        const totalPot = livePlayers.reduce((sum, p) => sum + Number(p?.bet || 0), 0);
        const totalPayout = livePlayers.filter((p) => p.status === 'cashed_out').reduce((sum, p) => sum + Number(p.winnings || 0), 0);
        setLiveMetrics({ pot: totalPot, payout: totalPayout, profit: totalPot - totalPayout });

        const now = Date.now();
        const last24hRounds = roundHistory.filter(r => {
             const roundDate = toDate(r.timestamp);
             return roundDate && (now - roundDate.getTime()) <= 24 * 60 * 60 * 1000;
        });


        if (last24hRounds.length > 0) {
            const totalNetProfit = last24hRounds.reduce((sum, r) => sum + Number(r?.netProfit || 0), 0);
            const totalBet = last24hRounds.reduce((sum, r) => sum + Number(r?.totalPot || 0), 0);
            const rtp = totalBet > 0 ? ((totalBet - totalNetProfit) / totalBet) * 100 : 0; // RTP = (TotalPagado / TotalApostado) * 100 = ((TotalApostado - GananciaNeta) / TotalApostado) * 100
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
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-3xl font-bold text-cyan-400">🚀 Panel de Administrador - Ascenso Estelar</h1>
                <Link to="/crash" className="bg-blue-500 hover:bg-blue-400 text-white font-bold py-2 px-4 rounded-lg transition-colors">Volver al Juego</Link>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="md:col-span-2 bg-gray-800 p-6 rounded-lg border border-white/10">
                    <h2 className="text-xl font-semibold mb-4">Ronda Actual: #{liveGameData?.roundId ?? '...'}</h2>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                        <div>
                            <p className="text-sm text-gray-400">Estado</p>
                            <p className={`text-lg font-bold ${(liveGameData?.gameState === 'running') ? 'text-green-400' : 'text-yellow-400'}`}>{stateLabel(liveGameData?.gameState)}</p>
                        </div>
                        <div>
                            <p className="text-sm text-gray-400">Pozo Actual</p>
                            <p className="text-lg font-bold">{formatCurrency(liveMetrics.pot)} Bs.</p>
                        </div>
                        <div>
                            <p className="text-sm text-gray-400">Jugadores</p>
                            <p className="text-lg font-bold">{livePlayers.length}</p>
                        </div>
                        <div>
                            <p className="text-sm text-gray-400">Ganancia/Pérdida</p>
                            <p className={`text-lg font-bold ${liveMetrics.profit >= 0 ? 'text-green-500' : 'text-red-500'}`}>{formatCurrency(liveMetrics.profit)} Bs.</p>
                        </div>
                    </div>
                </div>

                <div className="md:col-span-1 bg-gray-800 p-6 rounded-lg border border-white/10 flex flex-col justify-between">
                    <div>
                        <h2 className="text-xl font-semibold mb-4">Control del Motor y Métricas</h2>
                        <div className="space-y-3">
                            <div className="flex justify-between text-sm">
                                <span className="text-gray-400">Margen de la Casa Objetivo:</span>
                                <span className="font-mono bg-blue-500/20 text-blue-300 px-2 rounded">{formatCurrency(gameConfig.houseEdge)}%</span>
                            </div>
                            <div className="flex justify-between text-sm pt-2 border-t border-white/10">
                                <span className="text-gray-400">Ganancia Neta (24h):</span>
                                <span className={`font-bold ${globalMetrics.totalProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatCurrency(globalMetrics.totalProfit)} Bs.</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-gray-400">RTP % (24h):</span>
                                <span className="font-bold">{formatCurrency(globalMetrics.rtp)}%</span>
                            </div>
                        </div>
                    </div>

                    <div className="mt-6">
                        <div className="text-center mb-3">
                            <p className="text-gray-400">Estado del Motor</p>
                            {engineStatus === 'loading' ? (<p className="font-bold text-lg text-yellow-400">Cargando...</p>) :
                            (<p className={`font-bold text-lg ${engineStatus === 'enabled' ? 'text-green-400' : 'text-red-400'}`}>{engineStatus === 'enabled' ? '● ACTIVADO' : '● DESACTIVADO'}</p>)}
                        </div>
                        <button onClick={handleToggleEngine} disabled={isToggling || engineStatus === 'loading'} className={`w-full font-bold py-3 rounded-lg shadow-lg transition-all transform hover:scale-105 disabled:opacity-50 disabled:cursor-wait ${engineStatus === 'enabled' ? 'bg-red-600 hover:bg-red-500' : 'bg-green-600 hover:bg-green-500'}`}>
                            {isToggling ? 'Cambiando...' : (engineStatus === 'enabled' ? 'Apagar Motor' : 'Encender Motor')}
                        </button>
                    </div>
                </div>
            </div>

             <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                  <div className="bg-gray-800 p-6 rounded-lg border border-white/10">
                      <h2 className="text-xl font-semibold mb-4">Configuración de Apuestas</h2>
                      <div className="space-y-4">
                          <div>
                              <label className="block text-sm text-gray-400 mb-1">Apuesta Mínima (Bs.)</label>
                              <input type="text" inputMode="decimal" name="minBet" value={formatInputForDisplay(limits.minBet)} onChange={handleLimitsChange} className="w-full bg-gray-900 p-2 rounded border border-white/20" />
                          </div>
                          <div>
                              <label className="block text-sm text-gray-400 mb-1">Apuesta Máxima (Bs.)</label>
                              <input type="text" inputMode="decimal" name="maxBet" value={formatInputForDisplay(limits.maxBet)} onChange={handleLimitsChange} className="w-full bg-gray-900 p-2 rounded border border-white/20" />
                          </div>
                          <div>
                              <label className="block text-sm text-gray-400 mb-1">Ganancia Máxima por Apuesta (Bs.)</label>
                              <input type="text" inputMode="decimal" name="maxProfit" value={formatInputForDisplay(limits.maxProfit)} onChange={handleLimitsChange} className="w-full bg-gray-900 p-2 rounded border border-white/20" />
                          </div>
                           <div>
                               <label className="block text-sm text-gray-400 mb-1">Apuesta Máx. en Modo Recuperación (Bs.)</label>
                               <input type="text" inputMode="decimal" name="recoveryModeMaxBet" value={formatInputForDisplay(limits.recoveryModeMaxBet)} onChange={handleLimitsChange} className="w-full bg-gray-900 p-2 rounded border border-white/20" />
                           </div>
                          <button onClick={handleSaveLimits} disabled={isSavingLimits} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 rounded-lg transition-colors disabled:opacity-50">
                              {isSavingLimits ? 'Guardando...' : 'Guardar Cambios'}
                          </button>
                      </div>
                  </div>

                  <div className="bg-gray-800 p-6 rounded-lg border border-white/10">
                        <h2 className="text-xl font-semibold mb-4">Historial de Rondas Recientes</h2>
                            <div className="overflow-x-auto max-h-96"> {/* Added max-h-96 for scroll */}
                                <table className="w-full text-sm">
                                    <thead className="text-left text-gray-400 sticky top-0 bg-gray-800"> {/* Sticky header */}
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
                                            <tr><td className="p-4 text-center text-gray-500" colSpan={5}>No hay rondas registradas.</td></tr>
                                        )}
                                        {roundHistory.map((round) => {
                                            const crashPoint = Number(round?.crashPoint ?? 0);
                                            const totalPot = Number(round?.totalPot ?? 0);
                                            const netProfit = Number(round?.netProfit ?? 0);
                                            return (
                                                <tr key={round.id} className="border-t border-white/10 hover:bg-white/5">
                                                    <td className="p-2 font-mono text-xs text-gray-500">#{round.id}</td>
                                                    <td className={`p-2 font-bold ${crashPoint < 2 ? 'text-red-400' : 'text-green-400'}`}>{formatCurrency(crashPoint)}x</td>
                                                    <td className="p-2">{formatCurrency(totalPot)} Bs.</td>
                                                    <td className={`p-2 font-bold ${netProfit >= 0 ? 'text-green-500' : 'text-red-500'}`}>{formatCurrency(netProfit)} Bs.</td>
                                                    <td className="p-2 text-gray-400">{formatDateTime(round?.timestamp)}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                    </div>
             </div>
        </div>
    );
};

export default CrashAdminPanel;