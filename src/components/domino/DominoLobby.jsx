/*
* filepath: DominoLobby.jsx
*/
import React, { useContext, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../../App';
import { db, functions } from '../../firebase';
import { collection, query, orderBy, onSnapshot, getDocs, where, limit, doc } from "firebase/firestore";
import { httpsCallable } from 'firebase/functions';

const formatCurrency = (value) => {
    const number = Number(value) || 0;
    return new Intl.NumberFormat('es-VE', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(number);
};

const Header = ({ balance }) => {
    const navigate = useNavigate();
    const { userData } = useContext(AuthContext);

    return (
        <header className="bg-gray-900 border-b border-gray-700/50 p-3 shadow-lg flex-shrink-0">
            <div className="flex items-center">
                <div className="flex-1">
                    <button onClick={() => navigate('/lobby')} className="bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-2 px-6 rounded-lg transition-colors">Lobby Principal</button>
                </div>
                <div className="flex-1 text-center">
                    <h1 className="text-2xl font-bold tracking-widest uppercase text-cyan-400" style={{ textShadow: '0 0 5px rgba(34,211,238,0.5)' }}>LOBBY DE DOMINÓ</h1>
                </div>
                <div className="flex-1 flex justify-end items-center gap-6">
                    <div className="text-right">
                        <p className="text-gray-400 text-sm">Saldo</p>
                        <p className="text-xl font-bold text-green-400">{formatCurrency(balance || 0)} VES</p>
                    </div>
                    {userData?.role === 'admin' && (
                        <button
                            onClick={() => navigate('/admin/domino')}
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

const TournamentCard = ({ tournament, liveGameData, userActiveGameId, onBuyEntry, onRefund, onSpectate, loadingState }) => {
    const navigate = useNavigate();
    const [selectedTeam, setSelectedTeam] = useState(null);
    const [teamCounts, setTeamCounts] = useState({ team1: 0, team2: 0 });

    const gameId = liveGameData?.id || userActiveGameId;
    const playersCount = liveGameData?.playerCount || 0;
    const playersDisplay = `${playersCount}/4`;
    const isFull = playersCount >= 4;
    const hasJoinedThis = !!userActiveGameId;
    const isLoadingAction = loadingState[tournament.id] || loadingState[`spectate-${tournament.id}`];
    const is2v2 = tournament.type === '2v2';
    
    // (Petición 5) Indicador visual de si hay una partida activa
    const hasActiveGame = !!liveGameData;

    // Listener for team counts if it's a 2v2 game and we have a gameId
    useEffect(() => {
        if (!is2v2 || !gameId) {
            setTeamCounts({ team1: 0, team2: 0 }); // Reset if not applicable
            return;
        }

        const playersQuery = query(collection(db, `domino_tournament_games/${gameId}/players`));
        const unsubscribe = onSnapshot(playersQuery, (snapshot) => {
            let t1 = 0;
            let t2 = 0;
            snapshot.forEach(doc => {
                if (doc.data().team === 'team1') t1++;
                if (doc.data().team === 'team2') t2++;
            });
            setTeamCounts({ team1: t1, team2: t2 });
        });

        return () => unsubscribe();
    }, [is2v2, gameId]);

    const handleSelectTeam = (team) => {
        if (teamCounts[team] < 2) {
            setSelectedTeam(team);
        }
    };

    const canBuy = (!is2v2 || (selectedTeam && teamCounts[selectedTeam] < 2)) && !isFull && !isLoadingAction;

    return (
        <div className={`grid grid-cols-1 md:grid-cols-5 items-center gap-4 p-4 bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors ${!hasActiveGame && !hasJoinedThis ? 'opacity-60' : ''}`}>
            {/* Tournament Info */}
            <div className="col-span-1 md:col-span-2">
                <p className="text-lg font-semibold text-cyan-400">{tournament.name}</p>
                <p className="text-sm text-gray-400">{tournament.type === '2v2' ? 'Parejas' : 'Individual'}</p>
                {is2v2 && !hasJoinedThis && (
                    <div className="mt-2 flex gap-2">
                        <button
                            onClick={() => handleSelectTeam('team1')}
                            disabled={teamCounts.team1 >= 2}
                            className={`px-3 py-1 rounded text-xs ${selectedTeam === 'team1' ? 'bg-blue-600' : 'bg-gray-600'} ${teamCounts.team1 >= 2 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-blue-700'}`}
                        >
                            Equipo 1 ({teamCounts.team1}/2)
                        </button>
                        <button
                            onClick={() => handleSelectTeam('team2')}
                            disabled={teamCounts.team2 >= 2}
                            className={`px-3 py-1 rounded text-xs ${selectedTeam === 'team2' ? 'bg-red-600' : 'bg-gray-600'} ${teamCounts.team2 >= 2 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-red-700'}`}
                        >
                            Equipo 2 ({teamCounts.team2}/2)
                        </button>
                    </div>
                )}
            </div>
            {/* Player Count */}
            <div>
                <p className="text-sm text-gray-400">Jugadores</p>
                <p className="text-lg font-bold">{playersDisplay}</p>
            </div>
            {/* Entry Fee */}
            <div>
                <p className="text-sm text-gray-400">Entrada</p>
                <p className="text-lg font-bold">{tournament.entryFeeVES} VES</p>
            </div>
            {/* Action Buttons */}
            <div className="col-span-1 md:col-span-1 flex flex-col md:flex-row justify-end items-center gap-2">
                {hasJoinedThis ? (
                    <>
                        <button
                            onClick={() => navigate(`/domino/game/${userActiveGameId}`)}
                            className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg text-sm w-full md:w-auto"
                            disabled={isLoadingAction}
                        >
                            {isLoadingAction ? '...' : 'Entrar a la sala'}
                        </button>
                        <button
                            onClick={() => onRefund(tournament.id)}
                            className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg text-sm w-full md:w-auto"
                            disabled={isLoadingAction}
                        >
                            {isLoadingAction ? '...' : 'Reembolsar'}
                        </button>
                    </>
                ) : (
                    <>
                        <button
                            onClick={() => onSpectate(tournament.id)}
                            className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-lg text-sm w-full md:w-auto"
                            disabled={isLoadingAction || !hasActiveGame} // (Petición 5) Deshabilitado si no hay juego
                        >
                            {loadingState[`spectate-${tournament.id}`] ? '...' : 'Ver'}
                        </button>
                        <button
                            onClick={() => onBuyEntry(tournament.id, selectedTeam)}
                            className={`font-bold py-2 px-4 rounded-lg text-sm w-full md:w-auto ${!canBuy ? 'bg-gray-600 cursor-not-allowed opacity-50' : 'bg-cyan-600 hover:bg-cyan-700'}`}
                            disabled={!canBuy}
                        >
                            {loadingState[tournament.id] ? '...' : (isFull ? 'Llena' : 'Comprar entrada')}
                        </button>
                    </>
                )}
            </div>
        </div>
    );
};


const DominoLobby = () => {
    const navigate = useNavigate();
    const { currentUser } = useContext(AuthContext);
    const [tournaments, setTournaments] = useState([]);
    const [liveGames, setLiveGames] = useState({}); // Stores game data keyed by templateId
    const [userActiveGames, setUserActiveGames] = useState({}); // Stores { templateId: gameId } for the current user
    const [balance, setBalance] = useState(0);
    const [loading, setLoading] = useState({});

    // Fetch tournament templates
    useEffect(() => {
        const q = query(collection(db, "domino_tournaments"), orderBy("createdAt", "asc"));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const tournamentList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setTournaments(tournamentList.filter(t => t.status === 'open'));
        }, (error) => {
            console.error("Error fetching tournament templates:", error);
        });
        return () => unsubscribe();
    }, []);

    // Listen to user data (balance, active games) and live game data (player counts)
    useEffect(() => {
        if (!currentUser?.uid) return;

        // User data listener
        const userDocRef = doc(db, "users", currentUser.uid);
        const unsubscribeUser = onSnapshot(userDocRef, (doc) => {
            if (doc.exists()) {
                const data = doc.data();
                setBalance(data.balance || 0);
                const activeGamesMap = {};
                (data.activeDominoGames || []).forEach(game => {
                    activeGamesMap[game.templateId] = game.gameId;
                });
                setUserActiveGames(activeGamesMap);
            } else {
                setBalance(0);
                setUserActiveGames({});
            }
        }, (error) => {
            console.error("Error fetching user data:", error);
        });

        // Live game data listener (for player counts)
        // Listen only to games relevant to the displayed tournaments
        const templateIds = tournaments.map(t => t.id);
        if (templateIds.length === 0) {
            setLiveGames({}); // Clear if no templates
            return () => { unsubscribeUser(); }; // Only unsubscribe user listener
        }

        const gamesQuery = query(
            collection(db, "domino_tournament_games"),
            where("tournamentTemplateId", "in", templateIds),
            where("status", "in", ["waiting", "full"]) // Only interested in joinable/full games for counts
        );
        const unsubscribeGames = onSnapshot(gamesQuery, (snapshot) => {
            const gamesMap = {};
            snapshot.docs.forEach((doc) => {
                gamesMap[doc.data().tournamentTemplateId] = { id: doc.id, ...doc.data() };
            });
            setLiveGames(gamesMap);
        }, (error) => {
            console.error("Error fetching live game data:", error);
        });

        return () => {
            unsubscribeUser();
            unsubscribeGames();
        };
    }, [currentUser, tournaments]); // Rerun when tournaments list changes

    const handleBuyEntry = async (templateId, selectedTeam) => {
        if (!currentUser) return alert('Debes iniciar sesión para unirte.');
        const tournament = tournaments.find(t => t.id === templateId);
        if (tournament?.type === '2v2' && !selectedTeam) {
            return alert('Debes seleccionar un equipo para un torneo de parejas.');
        }

        setLoading(prev => ({ ...prev, [templateId]: true }));
        try {
            const buyEntryFunc = httpsCallable(functions, 'buyTournamentEntry');
            // Backend will now handle finding/creating game and adding player
            await buyEntryFunc({ tournamentTemplateId: templateId, selectedTeam: selectedTeam });
            // No navigation here, UI updates via listeners
        } catch (error) {
            console.error("Error al comprar entrada:", error);
            alert(`Error: ${error.message}`);
        } finally {
            setLoading(prev => ({ ...prev, [templateId]: false }));
        }
    };

    const handleRefund = async (templateId) => {
        const gameId = userActiveGames[templateId];
        if (!currentUser || !gameId) return;
        setLoading(prev => ({ ...prev, [templateId]: true }));
        try {
            const refundFunc = httpsCallable(functions, 'refundTournamentEntry');
            await refundFunc({ gameId: gameId });
            // UI updates via listeners
        } catch (error) {
            console.error("Error al reembolsar:", error);
            alert(`Error: ${error.message}`);
        } finally {
            setLoading(prev => ({ ...prev, [templateId]: false }));
        }
    };

    const handleSpectate = async (templateId) => {
        setLoading(prev => ({ ...prev, [`spectate-${templateId}`]: true }));
        try {
            // Find the most recent game (active or finished) for this template to spectate
            const gamesCollectionRef = collection(db, 'domino_tournament_games');
            const q = query(gamesCollectionRef,
                where('tournamentTemplateId', '==', templateId),
                orderBy('createdAt', 'desc'),
                limit(1));
            const gameSnapshot = await getDocs(q);

            if (!gameSnapshot.empty) {
                const gameToSpectate = gameSnapshot.docs[0];
                navigate(`/domino/game/${gameToSpectate.id}?spectate=true`);
            } else {
                // If no game exists yet, maybe check liveGames map?
                const liveGame = liveGames[templateId];
                if (liveGame) {
                     navigate(`/domino/game/${liveGame.id}?spectate=true`);
                } else {
                    // (Petición 5) Mensaje de error mejorado
                    alert("No hay partidas activas o finalizadas para observar en este torneo. Inténtalo más tarde.");
                }
            }
        } catch (error) {
            console.error("Error finding game to spectate:", error);
            alert("Error al intentar observar la partida.");
        } finally {
            setLoading(prev => ({ ...prev, [`spectate-${templateId}`]: false }));
        }
    };

    return (
        <div className="bg-gray-900 text-white flex flex-col h-screen overflow-hidden">
            <Header balance={balance} />
            <main className="flex-grow p-6 overflow-y-auto">
                <div className="max-w-7xl mx-auto">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-3xl font-bold text-white">Torneos Disponibles</h2>
                    </div>

                    <div className="panel p-4 rounded-xl" style={{ backgroundColor: 'rgba(22, 27, 34, 0.7)', border: '1px solid rgba(255, 255, 255, 0.1)', backdropFilter: 'blur(10px)' }}>
                        <div className="space-y-4">
                            {tournaments.length === 0 && <p className="text-center text-gray-500 py-4">No hay torneos abiertos en este momento.</p>}
                            {tournaments.map((tournament) => (
                                <TournamentCard
                                    key={tournament.id}
                                    tournament={tournament}
                                    liveGameData={liveGames[tournament.id]} // Pass live game data if available
                                    userActiveGameId={userActiveGames[tournament.id]} // Pass specific gameId if user joined
                                    onBuyEntry={handleBuyEntry}
                                    onRefund={handleRefund}
                                    onSpectate={handleSpectate}
                                    loadingState={loading}
                                />
                            ))}
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
};

export default DominoLobby;