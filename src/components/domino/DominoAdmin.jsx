import React, { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { functions, db } from '../../firebase';
import { httpsCallable } from 'firebase/functions';
import { collection, onSnapshot, doc, getDoc, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { AuthContext } from '../../App';

const AdminHeader = () => {
    const navigate = useNavigate();
    return (
        <header className="bg-gray-900 border-b border-gray-700/50 p-3 shadow-lg flex-shrink-0">
            <div className="flex items-center">
                <div className="flex-1">
                    <button onClick={() => navigate('/admin')} className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-6 rounded-lg transition-colors">Volver a Admin</button>
                </div>
                <div className="flex-1 text-center">
                    <h1 className="text-2xl font-bold tracking-widest uppercase text-red-500">ADMIN: DOMINÓ</h1>
                </div>
                <div className="flex-1 flex justify-end">
                    <button onClick={() => navigate('/domino')} className="bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-2 px-6 rounded-lg transition-colors">Ir al Lobby</button>
                </div>
            </div>
        </header>
    );
};

const Panel = ({ children, className = '' }) => (
    <div className={`p-6 rounded-xl ${className}`} style={{ backgroundColor: 'rgba(22, 27, 34, 0.7)', border: '1px solid rgba(255, 255, 255, 0.1)', backdropFilter: 'blur(10px)' }}>
        {children}
    </div>
);

const DominoAdmin = () => {
    const { currentUser } = useContext(AuthContext);
    const navigate = useNavigate();
    const [commission, setCommission] = useState(5);
    const [minBet, setMinBet] = useState(20);
    const [tournamentName, setTournamentName] = useState('');
    const [tournamentType, setTournamentType] = useState('1v1v1v1');
    const [entryFee, setEntryFee] = useState(1);
    const [activeTournaments, setActiveTournaments] = useState([]);
    const [liveGames, setLiveGames] = useState({});
    const [loading, setLoading] = useState({});
    const [liveStats, setLiveStats] = useState({ tables: 0, players: 0, totalBet: 0, commissionToday: 0 });

    useEffect(() => {
        const fetchSettings = async () => {
            const settingsRef = doc(db, 'domino_settings', 'config');
            const docSnap = await getDoc(settingsRef);
            if (docSnap.exists()) {
                const data = docSnap.data();
                setCommission(data.commissionPercent || 5);
                setMinBet(data.minBet || 20);
            }
        };
        fetchSettings();

        const templatesQuery = query(collection(db, 'domino_tournaments'), orderBy("createdAt", "asc"));
        const unsubscribeTemplates = onSnapshot(templatesQuery, (snapshot) => {
            const templatesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setActiveTournaments(templatesData);
        }, (error) => {
            console.error("Error al leer plantillas de torneos:", error);
        });

        const gamesQuery = query(collection(db, "domino_tournament_games"), where("status", "in", ["waiting", "full", "playing"]));
        const unsubscribeGames = onSnapshot(gamesQuery, (snapshot) => {
            const gamesMap = {};
            let totalPlayers = 0;
            snapshot.docs.forEach((doc) => {
                const game = doc.data();
                if (!gamesMap[game.tournamentTemplateId]) {
                    gamesMap[game.tournamentTemplateId] = [];
                }
                gamesMap[game.tournamentTemplateId].push({ id: doc.id, ...game });
                totalPlayers += game.playerCount || 0;
            });
            setLiveGames(gamesMap);
            setLiveStats(prev => ({ ...prev, tables: snapshot.size, players: totalPlayers }));
        });

        // Placeholder para cargar estadísticas de comisión/total jugado (requeriría otra query)
        // Ejemplo: const todayStart = new Date(); todayStart.setHours(0,0,0,0);
        // const commissionQuery = query(collection(db, 'domino_commissions'), where('timestamp', '>=', todayStart));
        // ... y luego sumar los amounts

        return () => {
            unsubscribeTemplates();
            unsubscribeGames();
        };

    }, []);

    const handleSaveSettings = async () => {
        if (!currentUser) return alert('Debes estar autenticado.');
        try {
            const updateSettingsFunc = httpsCallable(functions, 'updateDominoSettings');
            await updateSettingsFunc({ commissionPercent: Number(commission), minBet: Number(minBet) });
            alert('Configuración guardada.');
        } catch (error) {
            console.error("Error al guardar configuración:", error);
            alert(`Error: ${error.message}`);
        }
    };

    const handleCreateTournament = async (e) => {
        e.preventDefault();
        if (!currentUser) return alert('Debes estar autenticado.');
        if (!tournamentName.trim()) return alert('El nombre del torneo es requerido.');

        try {
            const createTemplateFunc = httpsCallable(functions, 'createTournamentTemplate');
            const result = await createTemplateFunc({
                name: tournamentName,
                type: tournamentType,
                entryFeeUSD: Number(entryFee)
            });
            alert(`Plantilla de torneo creada con ID: ${result.data.templateId}`);
            setTournamentName(''); // Limpiar campo después de crear
        } catch (error) {
            console.error("Error al crear torneo:", error);
            alert(`Error: ${error.message}`);
        }
    };

    const handleSpectateAdmin = async (gameId) => {
        if (!gameId) {
            alert("No hay partidas activas para observar para este tipo de torneo.");
            return;
        }
        navigate(`/domino/game/${gameId}?spectate=true`);
    };

    const handleDeleteTemplate = async (templateId, templateName) => {
        if (!window.confirm(`¿Seguro que quieres borrar el torneo "${templateName}"? ESTA ACCIÓN NO SE PUEDE DESHACER. Se borrarán todas las partidas asociadas.`)) return;
        setLoading(prev => ({ ...prev, [`delete-${templateId}`]: true }));
        try {
            const deleteFunc = httpsCallable(functions, 'deleteTournamentTemplate');
            await deleteFunc({ templateId: templateId });
            alert('Torneo borrado exitosamente.');
        } catch (error) {
            console.error("Error al borrar torneo:", error);
            alert(`Error: ${error.message}`);
        } finally {
            setLoading(prev => ({ ...prev, [`delete-${templateId}`]: false }));
        }
    };

    const renderTableRows = () => {
        if (activeTournaments.length === 0) {
            return (
                <tr>
                    <td colSpan="5" className="p-3 text-center text-gray-500">No hay plantillas de torneo creadas.</td>
                </tr>
            );
        }

        return activeTournaments.map((tournament) => {
            const gamesForTemplate = liveGames[tournament.id] || [];
            const currentGame = gamesForTemplate.find(g => g.status !== 'finished') || gamesForTemplate[0];
            const playerCount = currentGame?.playerCount || 0;
            const gameStatus = currentGame?.status || tournament.status;
            const gameId = currentGame?.id;
            const maxPlayers = tournament.maxPlayers || 4;

            return (
                <tr key={tournament.id} className="hover:bg-gray-800/50">
                    <td className="p-3">{tournament.name || tournament.id.substring(0, 8)}</td>
                    <td className="p-3">{`${playerCount} / ${maxPlayers}`}</td>
                    <td className="p-3">{tournament.entryFeeVES ?? 'N/A'} VES</td>
                    <td className={`p-3 ${gameStatus === 'playing' ? 'text-green-400' : (gameStatus === 'waiting' || gameStatus === 'full' ? 'text-yellow-400' : 'text-gray-400')}`}>
                        {gameStatus}
                    </td>
                    <td className="p-3 space-x-2">
                        <button
                            onClick={() => handleSpectateAdmin(gameId)}
                            className="text-yellow-500 hover:text-yellow-400 text-sm"
                            disabled={!gameId}
                        >
                            Observar
                        </button>
                        <button
                            onClick={() => handleDeleteTemplate(tournament.id, tournament.name)}
                            className="text-red-500 hover:text-red-400 text-sm"
                            disabled={loading[`delete-${tournament.id}`]}
                        >
                            {loading[`delete-${tournament.id}`] ? '...' : 'Borrar'}
                        </button>
                    </td>
                </tr>
            );
        });
    };


    return (
        <div className="bg-gray-900 text-white flex flex-col h-screen">
            <AdminHeader />
            <main className="flex-grow p-6 overflow-y-auto">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <Panel>
                        <h2 className="text-xl font-bold mb-4 border-b border-gray-700 pb-2 text-cyan-400">Crear Plantilla de Torneo</h2>
                        <form onSubmit={handleCreateTournament} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-1">Nombre del Torneo</label>
                                <input
                                    type="text"
                                    value={tournamentName}
                                    onChange={(e) => setTournamentName(e.target.value)}
                                    maxLength={50}
                                    className="bg-gray-900 border border-gray-700 rounded-lg w-full py-2 px-3"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-1">Tipo</label>
                                <select
                                    value={tournamentType}
                                    onChange={(e) => setTournamentType(e.target.value)}
                                    className="bg-gray-900 border border-gray-700 rounded-lg w-full py-2 px-3"
                                >
                                    <option value="1v1v1v1">Individual (4 Jugadores)</option>
                                    <option value="2v2">Parejas (2 vs 2)</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-1">Tarifa de Entrada (USD)</label>
                                <select
                                    value={entryFee}
                                    onChange={(e) => setEntryFee(e.target.value)}
                                    className="bg-gray-900 border border-gray-700 rounded-lg w-full py-2 px-3"
                                >
                                    <option value="1">$1.00</option>
                                    <option value="2.5">$2.50</option>
                                    <option value="5">$5.00</option>
                                    <option value="10">$10.00</option>
                                    <option value="20">$20.00</option>
                                </select>
                            </div>
                            <button type="submit" className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg">
                                Crear Plantilla
                            </button>
                        </form>
                    </Panel>

                    <Panel>
                        <h2 className="text-xl font-bold mb-4 border-b border-gray-700 pb-2 text-cyan-400">Configuración General</h2>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-1">Comisión por Partida (%)</label>
                                <input
                                    type="number"
                                    value={commission}
                                    onChange={(e) => setCommission(e.target.value)}
                                    min="0" max="50" step="0.5"
                                    className="bg-gray-900 border border-gray-700 rounded-lg w-full py-2 px-3"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-1">Apuesta Mínima (Mesas Libres)</label>
                                <input
                                    type="number"
                                    value={minBet}
                                    onChange={(e) => setMinBet(e.target.value)}
                                    min="0" step="1"
                                    className="bg-gray-900 border border-gray-700 rounded-lg w-full py-2 px-3"
                                />
                            </div>
                            <button onClick={handleSaveSettings} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg">
                                Guardar Cambios
                            </button>
                        </div>
                    </Panel>

                    <Panel>
                        <h2 className="text-xl font-bold mb-4 border-b border-gray-700 pb-2 text-cyan-400">Estadísticas en Vivo</h2>
                        <div className="grid grid-cols-2 gap-4">
                            <div><p className="text-sm text-gray-400">Mesas Activas</p><p className="text-3xl font-bold">{liveStats.tables}</p></div>
                            <div><p className="text-sm text-gray-400">Jugadores en Línea</p><p className="text-3xl font-bold">{liveStats.players}</p></div>
                            <div><p className="text-sm text-gray-400">Total Jugado (Hoy)</p><p className="text-3xl font-bold">{liveStats.totalBet} VES</p></div>
                            <div><p className="text-sm text-gray-400">Comisión (Hoy)</p><p className="text-3xl font-bold text-green-500">{liveStats.commissionToday} VES</p></div>
                        </div>
                    </Panel>

                    <Panel className="col-span-1 md:col-span-3">
                        <h2 className="text-xl font-bold mb-4 border-b border-gray-700 pb-2 text-cyan-400">Mesas/Torneos Activos</h2>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead>
                                    <tr className="bg-gray-800">
                                        <th className="p-3">Nombre/ID Torneo</th>
                                        <th className="p-3">Jugadores</th>
                                        <th className="p-3">Entrada (VES)</th>
                                        <th className="p-3">Estado</th>
                                        <th className="p-3">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-700">
                                    {renderTableRows()}
                                </tbody>
                            </table>
                        </div>
                    </Panel>

                </div>
            </main>
        </div>
    );
};

export default DominoAdmin;