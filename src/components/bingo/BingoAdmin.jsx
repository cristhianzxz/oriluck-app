import React, { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../../App';
import {
    collection, doc, getDocs, getDoc, addDoc, updateDoc,
    onSnapshot, serverTimestamp, arrayRemove, writeBatch, increment,
    query, orderBy, runTransaction
} from 'firebase/firestore';
import { db } from '../../firebase';

const BingoAdmin = () => {
    const navigate = useNavigate();
    const { currentUser, userData: currentUserData } = useContext(AuthContext); // Asumo que userData contiene el rol
    const [tournaments, setTournaments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('tournaments');
    const [newTournament, setNewTournament] = useState({
        name: '',
        startTime: ''
    });

    // --- Estados para la nueva sección de Estadísticas ---
    const [selectedStatTournament, setSelectedStatTournament] = useState(null);
    const [selectedStatPlayer, setSelectedStatPlayer] = useState(null);
    const [expandedCardNumber, setExpandedCardNumber] = useState(null); // Estado para el acordeón

    // ========================================================
    // MODIFICACIÓN 1: Usar 'currentUserData' (asumiendo que se obtiene del AuthContext)
    // Agrego una comprobación de correo como respaldo.
    // ========================================================
    const isRoleAdmin = currentUserData?.role === "admin";
    const isHardcodedAdmin = currentUser?.email === "cristhianzxz@hotmail.com" || currentUser?.email === "admin@oriluck.com";
    const isAdmin = isRoleAdmin || isHardcodedAdmin;
    // ========================================================

    useEffect(() => {
        // Si currentUser es null, esperamos que se cargue para obtener currentUserData.
        if (currentUser === undefined) return;

        // ========================================================
        // MODIFICACIÓN 3: Redirigir a '/lobby' si no es admin
        // ========================================================
        if (!isAdmin) {
            navigate('/lobby');
            return;
        }

        const q = query(collection(db, 'bingoTournaments'), orderBy('createdAt', 'desc'));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const tournamentsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setTournaments(tournamentsData);
            setLoading(false);
        });
        return () => unsubscribe();
    }, [isAdmin, navigate, currentUser]);

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
            alert('✅ Torneo creado exitosamente!');
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
                startedAt: serverTimestamp(),
                startedBy: currentUser.uid
            });
            alert('🎮 Torneo iniciado!');
        } catch (error) {
            console.error('Error iniciando torneo:', error);
            alert('❌ Error al iniciar el torneo');
        }
    };

    const finishTournament = async (tournamentId) => {
        try {
            await updateDoc(doc(db, 'bingoTournaments', tournamentId), {
                status: 'finished',
                manualStop: true,
                finishedAt: serverTimestamp()
            });
            alert('🏆 Torneo finalizado manualmente!');
        } catch (error) {
            console.error('Error finalizando torneo:', error);
            alert('❌ Error al finalizar el torneo');
        }
    };

    const callNumberManually = async () => {
        alert("El llamado de números ahora es 100% automático desde el servidor.");
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

    // --- Componente para la tarjeta de un cartón en Estadísticas (Sin cambios) ---
    const StatCardDetail = ({ cardMatrix, calledNumbers }) => {
        const calledSet = new Set(calledNumbers || []);
        const flatMatrix = Array.isArray(cardMatrix) ? cardMatrix.flat() : [];

        return (
            <div className="grid grid-cols-5 gap-1 bg-gray-900 p-2 rounded-md">
                {flatMatrix.map((num, index) => (
                    <div
                        key={index}
                        className={`flex items-center justify-center h-10 w-10 rounded ${
                            calledSet.has(num) || num === 'FREE'
                                ? 'bg-green-500 text-white font-bold'
                                : 'bg-gray-700 text-white/80'
                            }`}
                    >
                        {num}
                    </div>
                ))}
            </div>
        );
    };

    // --- Lógica para la nueva sección de Estadísticas (Sin cambios) ---
    const renderStatsContent = () => {
        // Nivel 3: Vista de un jugador específico y sus cartones
        if (selectedStatTournament && selectedStatPlayer) {
            const tournament = selectedStatTournament;
            const player = selectedStatPlayer;
            const calledNumbers = tournament.calledNumbers || [];

            return (
                <div>
                    <button
                        onClick={() => {
                            setSelectedStatPlayer(null);
                            setExpandedCardNumber(null); // Reiniciar estado al volver
                        }}
                        className="bg-gray-600 hover:bg-gray-500 text-white px-4 py-2 rounded-lg mb-4 text-sm"
                    >
                        ← Volver a '{tournament.name}'
                    </button>
                    <h3 className="text-2xl font-bold text-white mb-2">
                        Cartones de <span className="text-yellow-400">{player.userName}</span>
                    </h3>
                    <p className="text-white/70 mb-6">Torneo: {tournament.name}</p>
                    <div className="space-y-2">
                        {player.cards.map(card => {
                            const isExpanded = expandedCardNumber === card.cardNumber;
                            return (
                                <div key={card.cardNumber} className="bg-white/5 rounded-lg overflow-hidden">
                                    <div
                                        onClick={() => setExpandedCardNumber(isExpanded ? null : card.cardNumber)}
                                        className="p-4 cursor-pointer flex justify-between items-center hover:bg-white/10 transition-colors"
                                    >
                                        <h4 className="text-lg font-bold text-white">Cartón #{card.cardNumber}</h4>
                                        <span className={`text-white/70 transition-transform transform ${isExpanded ? 'rotate-180' : 'rotate-0'}`}>
                                            ▼
                                        </span>
                                    </div>
                                    {isExpanded && (
                                        <div className="p-4 border-t border-white/10">
                                            <StatCardDetail cardMatrix={card.cardNumbers} calledNumbers={calledNumbers} />
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            );
        }

        // Nivel 2: Vista de un torneo específico
        if (selectedStatTournament) {
            const tournament = selectedStatTournament;
            const players = Object.values(
                Object.entries(tournament.soldCards || {}).reduce((acc, [key, cardData]) => {
                    if (!cardData.userId) return acc; // Ignorar si no hay userId
                    const userId = cardData.userId;
                    if (!acc[userId]) {
                        acc[userId] = {
                            userId: userId,
                            userName: cardData.userName,
                            email: cardData.userEmail, // Añadir email
                            phoneNumber: cardData.userPhone, // Añadir teléfono
                            cards: [],
                        };
                    }
                    acc[userId].cards.push({
                        cardNumber: key.replace('carton_', ''),
                        cardNumbers: cardData.cardNumbers,
                    });
                    return acc;
                }, {})
            );

            return (
                <div>
                    <button
                        onClick={() => {
                            setSelectedStatTournament(null);
                            setSelectedStatPlayer(null);
                            setExpandedCardNumber(null);
                        }}
                        className="bg-gray-600 hover:bg-gray-500 text-white px-4 py-2 rounded-lg mb-4 text-sm"
                    >
                        ← Volver a la lista de torneos
                    </button>
                    <h3 className="text-3xl font-bold text-white mb-4">{tournament.name}</h3>

                    {/* Ganadores */}
                    <div className="bg-green-500/20 border border-green-500/30 rounded-xl p-6 mb-6">
                        <h4 className="text-2xl font-bold text-green-300 mb-3">🏆 Ganador(es)</h4>
                        {tournament.winners && tournament.winners.length > 0 ? (
                            <div className="space-y-2">
                                {tournament.winners.map((winner, index) => (
                                    <div key={index} className="text-white">
                                        <span className="font-bold text-lg">{winner.userName}</span> -
                                        Premio: <span className="text-yellow-400">Bs. {winner.prizeAmount?.toLocaleString()}</span> -
                                        Cartón Ganador: <span className="font-bold text-xl">#{winner.cards?.[0] || winner.cardNumber}</span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-white/70">Este torneo aún no tiene ganadores.</p>
                        )}
                    </div>

                    {/* Participantes */}
                    <div className="bg-white/5 rounded-xl p-6">
                        <h4 className="text-2xl font-bold text-white mb-4">👥 Participantes ({players.length})</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {players.map(player => (
                                <div
                                    key={player.userId}
                                    onClick={() => setSelectedStatPlayer(player)}
                                    className="bg-gray-800 p-4 rounded-lg cursor-pointer hover:bg-gray-700 transition-colors flex flex-col justify-between"
                                >
                                    <div>
                                        <p className="text-white font-bold text-lg">{player.userName}</p>
                                        <p className="text-blue-400 text-sm break-all">{player.email || 'No email'}</p>
                                        <p className="text-green-400 text-sm">{player.phoneNumber || 'No phone'}</p>
                                    </div>
                                    <p className="text-white/70 text-sm mt-2 pt-2 border-t border-white/10">{player.cards.length} cartón(es)</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            );
        }

        // Nivel 1: Lista de todos los torneos
        return (
            <div>
                <h2 className="text-2xl font-bold text-white mb-6">Selecciona un Torneo para ver sus Estadísticas</h2>
                <div className="space-y-3">
                    {tournaments
                        .filter(t => t.status !== 'deleted')
                        .sort((a, b) => (b.startTime?.toDate() || 0) - (a.startTime?.toDate() || 0))
                        .map(tournament => (
                            <div
                                key={tournament.id}
                                onClick={() => setSelectedStatTournament(tournament)}
                                className="bg-white/5 rounded-xl p-4 cursor-pointer hover:bg-white/10 transition-colors flex justify-between items-center"
                            >
                                <div>
                                    <h4 className="font-bold text-white">{tournament.name}</h4>
                                    <div className="text-white/70 text-sm">
                                        {tournament.startTime?.toDate().toLocaleString('es-VE')}
                                    </div>
                                </div>
                                <div className="text-right">
                                    <div className={`px-2 py-1 rounded text-xs ${
                                        tournament.status === 'finished' ? 'bg-red-500/20 text-red-400' :
                                            tournament.status === 'active' ? 'bg-green-500/20 text-green-400' :
                                                'bg-yellow-500/20 text-yellow-400'
                                        }`}>
                                        {tournament.status?.toUpperCase()}
                                    </div>
                                    <div className="text-white/80 mt-1">{Object.keys(tournament.soldCards || {}).length} cartones vendidos</div>
                                </div>
                            </div>
                        ))
                    }
                </div>
            </div>
        );
    };

    // ========================================================
    // MODIFICACIÓN 2: Lógica de Carga y Redirección
    // ========================================================
    if (currentUser === undefined) {
        return <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">Cargando credenciales...</div>;
    }

    if (!isAdmin) {
        // La redirección se maneja principalmente en el useEffect, pero esta es una capa de seguridad en el render.
        // Si no es admin y el user ya cargó, retornamos null o podríamos redirigir aquí también si la redirección de useEffect no es instantánea.
        // Dejamos que useEffect maneje el navigate para evitar un error de "demasiados renders"
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
                        <button onClick={() => navigate('/bingo')} className="bg-gray-600 hover:bg-gray-700 text-white px-6 py-3 rounded-lg">
                            ← Volver al Bingo
                        </button>
                        <button onClick={() => navigate('/admin')} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-lg">
                            ⚙️ Panel Principal
                        </button>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex space-x-4 mb-6">
                    {['tournaments', 'create', 'stats'].map(tab => (
                        <button
                            key={tab}
                            onClick={() => {
                                setActiveTab(tab);
                                // Reiniciar estados de estadísticas al cambiar de pestaña
                                setSelectedStatTournament(null);
                                setSelectedStatPlayer(null);
                                setExpandedCardNumber(null);
                            }}
                            className={`px-6 py-3 rounded-lg font-semibold transition-all ${
                                activeTab === tab
                                    ? 'bg-green-600 text-white shadow-lg'
                                    : 'bg-white/10 text-white hover:bg-white/20'
                                }`}
                        >
                            {tab === 'tournaments' && '🎮 Gestión'}
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
                                <div className="text-center py-12"><div className="text-6xl mb-4">📭</div><p className="text-white/70 text-lg">No hay torneos creados</p></div>
                            ) : (
                                <div className="space-y-4">
                                    {tournaments.filter(t => t.status !== 'deleted').map(tournament => (
                                        <div key={tournament.id} className="bg-white/5 rounded-xl p-6 border border-white/10">
                                            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-center">
                                                <div>
                                                    <h3 className="font-bold text-white text-lg">{tournament.name}</h3>
                                                    <div className="text-white/70 text-sm">{tournament.startTime?.toDate().toLocaleString('es-VE')}</div>
                                                    <span className={`px-2 py-1 rounded text-xs ${
                                                        tournament.status === 'active' ? 'bg-green-500/20 text-green-400' :
                                                            tournament.status === 'finished' ? 'bg-red-500/20 text-red-400' :
                                                                'bg-yellow-500/20 text-yellow-400'
                                                        }`}>{tournament.status?.toUpperCase()}</span>
                                                </div>
                                                <div>
                                                    <div className="text-white font-bold">{Object.keys(tournament.soldCards || {}).length}/100 cartones</div>
                                                    <div className="text-white/70 text-sm">Premio: Bs. {((Object.keys(tournament.soldCards || {}).length * (tournament.pricePerCard || 100)) * 0.7).toLocaleString()}</div>
                                                </div>
                                                <div>
                                                    <div className="text-white/70 text-sm">Números:</div>
                                                    <div className="text-white font-bold">{(tournament.calledNumbers || []).length}/75</div>
                                                    <div className="text-white/70 text-sm">Actual: {tournament.currentNumber || '--'}</div>
                                                </div>
                                                <div className="space-y-2">
                                                    {tournament.status === 'waiting' && (
                                                        <button onClick={() => startTournament(tournament.id)} className="w-full bg-green-600 hover:bg-green-500 text-white py-2 px-4 rounded text-sm">▶️ Iniciar Ahora</button>
                                                    )}
                                                    {tournament.status === 'active' && (
                                                        <>
                                                            <button onClick={() => callNumberManually()} className="w-full bg-blue-600 hover:bg-blue-500 text-white py-2 px-4 rounded text-sm">🔢 Llamar Número (Auto)</button>
                                                            <button onClick={() => finishTournament(tournament.id)} className="w-full bg-red-600 hover:bg-red-500 text-white py-2 px-4 rounded text-sm">⏹️ Finalizar Manual</button>
                                                        </>
                                                    )}
                                                    <button onClick={() => deleteTournament(tournament.id)} className="w-full bg-gray-600 hover:bg-gray-500 text-white py-2 px-4 rounded text-sm">🗑️ Eliminar</button>
                                                </div>
                                            </div>
                                            {tournament.winners && tournament.winners.length > 0 && (
                                                <div className="mt-4 p-3 bg-green-500/20 rounded-lg">
                                                    <h4 className="font-bold text-green-300 mb-2">🏆 Ganadores:</h4>
                                                    {tournament.winners.map((winner, index) => (
                                                        <div key={index} className="text-white text-sm">
                                                            {winner.userName} - Cartón #<span className="font-bold">{winner.cards?.[0] || winner.cardNumber}</span> - Bs. {winner.prizeAmount?.toLocaleString()}
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
                                    <input type="text" value={newTournament.name} onChange={(e) => setNewTournament({ ...newTournament, name: e.target.value })} className="w-full p-3 rounded-lg bg-white/10 border border-white/20 text-white" placeholder="Ej: Torneo VIP Nocturno" />
                                </div>
                                <div>
                                    <label className="block text-white font-semibold mb-2">⏰ Fecha y Hora de Inicio</label>
                                    <input type="datetime-local" value={newTournament.startTime} onChange={(e) => setNewTournament({ ...newTournament, startTime: e.target.value })} className="w-full p-3 rounded-lg bg-white/10 border border-white/20 text-white" />
                                </div>
                                <div className="bg-blue-500/20 rounded-lg p-4 border border-blue-500/30">
                                    <h4 className="font-bold text-blue-300 mb-2">💡 Información Automática</h4>
                                    <div className="text-white/80 text-sm space-y-1">
                                        <div>• Precio por cartón: Se ajusta automáticamente a la tasa BCV del día</div>
                                        <div>• Inicio: Automático a la hora programada</div>
                                        <div>• Compra: Se cierra automáticamente al iniciar</div>
                                    </div>
                                </div>
                                <button onClick={createTournament} className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-3 px-6 rounded-lg transition-all">🎯 Crear Torneo</button>
                            </div>
                        </div>
                    )}

                    {activeTab === 'stats' && renderStatsContent()}
                </div>
            </div>
        </div>
    );
};

export default BingoAdmin;