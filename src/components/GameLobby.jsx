import React, { useContext, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../firebase';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { AuthContext } from '../App';
import { getUserData } from "../firestoreService";

const GameLobby = () => {
    const navigate = useNavigate();
    const { currentUser } = useContext(AuthContext);
    const [userData, setUserData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [hasUnreadSupport, setHasUnreadSupport] = useState(false);
    // Estado para manejar la visibilidad del menú en móvil
    const [isMenuOpen, setIsMenuOpen] = useState(false);

    useEffect(() => {
        const loadUserData = async () => {
            if (currentUser) {
                try {
                    const userDataFromFirestore = await getUserData(currentUser.uid);
                    
                    if (userDataFromFirestore) {
                        setUserData({
                            username: userDataFromFirestore.username || currentUser.email?.split('@')[0] || "Usuario",
                            balance: userDataFromFirestore.balance || 0,
                            isAdmin: userDataFromFirestore.role === "admin",
                            email: currentUser.email
                        });
                    } else {
                        setUserData({
                            username: currentUser.email?.split('@')[0] || "Usuario",
                            balance: 0,
                            isAdmin: currentUser.email === "cristhianzxz@hotmail.com",
                            email: currentUser.email
                        });
                    }
                } catch (error) {
                    console.error("❌ Error cargando datos del usuario:", error);
                    setUserData({
                        username: currentUser.email?.split('@')[0] || "Usuario",
                        balance: 0,
                        isAdmin: currentUser.email === "cristhianzxz@hotmail.com",
                        email: currentUser.email
                    });
                }
            }
            setLoading(false);
        };

        loadUserData();
    }, [currentUser]);

    useEffect(() => {
        if (!currentUser) return;

        const ticketsQuery = query(
            collection(db, 'supportTickets'),
            where('userId', '==', currentUser.uid),
            where('hasUnreadForUser', '==', true)
        );

        const unsubscribe = onSnapshot(ticketsQuery, (snapshot) => {
            setHasUnreadSupport(!snapshot.empty);
        });

        return () => unsubscribe();
    }, [currentUser]);

    const handleLogout = async () => {
        try {
            await signOut(auth);
        } catch (error) {
            console.error("Error signing out: ", error);
        }
    };

    const handleRechargeClick = () => {
        navigate('/recharge');
    };

    const handleWithdrawClick = () => {
        navigate('/withdraw');
    };

    const handleAdminClick = () => {
        navigate('/admin');
    };
    
    // Función para manejar la navegación y cerrar el menú móvil si está abierto
    const handleNavigation = (path) => {
        navigate(path);
        setIsMenuOpen(false); // Cierra el menú al navegar
    };


    const games = [
        {
            id: 1,
            name: "BINGO",
            icon: "🎯",
            status: "active",
            description: "Juega al clásico Bingo con premios millonarios",
            color: "from-red-500 to-pink-500",
            glow: "shadow-lg shadow-red-500/30"
        },
        {
            id: 2,
            name: "TRAGAMONEDAS",
            icon: "🎰",
            status: "construction",
            description: "Próximamente - Máquinas exclusivas de alta gama",
            color: "from-blue-500 to-purple-500",
            glow: "shadow-lg shadow-blue-500/20"
        },
        {
            id: 3,
            name: "RULETA",
            icon: "🎡",
            status: "construction", 
            description: "Próximamente - Ruleta europea premium",
            color: "from-green-500 to-teal-500",
            glow: "shadow-lg shadow-green-500/20"
        },
        {
            id: 4,
            name: "PÓKER",
            icon: "🎴",
            status: "construction",
            description: "Próximamente - Texas Hold'em VIP",
            color: "from-yellow-500 to-orange-500",
            glow: "shadow-lg shadow-yellow-500/20"
        },
        {
            id: 5,
            name: "BLACKJACK",
            icon: "🃏",
            status: "construction",
            description: "Próximamente - 21 contra crupieres expertos",
            color: "from-indigo-500 to-blue-500",
            glow: "shadow-lg shadow-indigo-500/20"
        },
        {
            id: 6,
            name: "LOTERÍA",
            icon: "🎫",
            status: "construction",
            description: "Próximamente - Sorteos millonarios exclusivos",
            color: "from-purple-500 to-pink-500",
            glow: "shadow-lg shadow-purple-500/20"
        }
    ];

    const handleGameClick = (game) => {
        if (game.status === "active" && game.name === "BINGO") {
            navigate('/bingo');
        } else if (game.status === "construction") {
            alert("🚧 Este juego premium estará disponible próximamente");
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 flex items-center justify-center">
                <div className="text-white text-xl">Cargando sala VIP...</div>
            </div>
        );
    }

    if (!userData) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 flex items-center justify-center">
                <div className="text-white text-xl">Error cargando datos del usuario</div>
            </div>
        );
    }

    // Array de botones de acción para renderizado dinámico (PC)
    const actionButtons = (
        <>
            {/* Retirar Saldo - NUEVO BOTÓN */}
            <button 
                onClick={handleWithdrawClick}
                className="bg-gradient-to-r from-yellow-600 to-yellow-500 hover:from-yellow-500 hover:to-yellow-400 text-white font-semibold px-4 py-2 rounded-xl transition-all duration-300 transform hover:scale-105 shadow-lg shadow-yellow-500/25 text-sm"
            >
                💸 Retirar
            </button>
            {/* Recargar */}
            <button 
                onClick={handleRechargeClick}
                className="bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 text-white font-semibold px-4 py-2 rounded-xl transition-all duration-300 transform hover:scale-105 shadow-lg shadow-green-500/25 text-sm"
            >
                💰 Recargar
            </button>
            {/* Soporte */}
            <button 
                onClick={() => handleNavigation('/support')}
                className="relative bg-blue-600 hover:bg-blue-500 text-white font-semibold px-4 py-2 rounded-xl transition-all duration-300 transform hover:scale-105 shadow-lg shadow-blue-500/25 text-sm"
            >
                🆘 Soporte
                {hasUnreadSupport && (
                    <span className="absolute -top-1 -right-1 flex h-4 w-4">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-4 w-4 bg-sky-500 justify-center items-center text-xs text-white font-bold">!</span>
                    </span>
                )}
            </button>
            {/* Historial */}
            <button 
                onClick={() => handleNavigation('/history')}
                className="bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-semibold px-4 py-2 rounded-xl transition-all duration-300 transform hover:scale-105 shadow-lg shadow-blue-500/25 text-sm"
            >
                📊 Historial
            </button>
            {/* Admin (solo si es admin) */}
            {userData.isAdmin && (
                <button 
                    onClick={handleAdminClick}
                    className="bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 text-white font-semibold px-4 py-2 rounded-xl transition-all duration-300 transform hover:scale-105 shadow-lg shadow-red-500/25 text-sm"
                >
                    ⚙️ Admin
                </button>
            )}
            {/* Salir */}
            <button
                onClick={handleLogout}
                className="bg-gradient-to-r from-gray-600 to-gray-500 hover:from-gray-500 hover:to-gray-400 text-white font-semibold px-4 py-2 rounded-xl transition-all duration-300 transform hover:scale-105 text-sm"
            >
                🚪 Salir
            </button>
        </>
    );

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 relative overflow-hidden">
            {/* Efectos de fondo */}
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-transparent via-black/20 to-black/60"></div>
            <div className="absolute top-20 left-10 w-32 h-32 bg-yellow-500/10 rounded-full blur-xl"></div>
            <div className="absolute bottom-20 right-10 w-48 h-48 bg-purple-500/10 rounded-full blur-2xl"></div>
            
            {/* Header */}
            <header className="sticky top-0 z-50 bg-black/40 backdrop-blur-lg border-b border-gold-500/30 shadow-2xl">
                <div className="container mx-auto px-4 sm:px-6 py-3">
                    <div className="flex justify-between items-center">
                        {/* Logo y Info de Usuario */}
                        <div className="flex items-center space-x-2 sm:space-x-4">
                            <div className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-yellow-400 to-yellow-200 bg-clip-text text-transparent min-w-max">
                                🎩 ORI<span className="text-green-400">LUCK</span>
                            </div>
                            {/* Saldo - Visible en todas las pantallas */}
                            <div className="bg-gradient-to-r from-yellow-500/10 to-yellow-600/10 border border-yellow-500/30 rounded-xl px-3 py-2 sm:px-4 sm:py-2 backdrop-blur-sm hidden sm:block">
                                <div className="text-xs text-yellow-300/80 font-medium">SALDO</div>
                                <div className="text-lg sm:text-xl font-bold text-yellow-300 flex items-center">
                                    💎 Bs. {userData.balance.toLocaleString()}
                                </div>
                            </div>
                        </div>

                        {/* Botones de acción - PC */}
                        <div className="hidden lg:flex items-center space-x-3">
                            {actionButtons}
                        </div>

                        {/* Menú Móvil - Botón de Hamburguesa */}
                        <div className="flex items-center lg:hidden">
                            {/* Saldo Móvil */}
                            <div className="bg-gradient-to-r from-yellow-500/10 to-yellow-600/10 border border-yellow-500/30 rounded-xl px-3 py-1.5 backdrop-blur-sm mr-4">
                                <div className="text-xs text-yellow-300/80 font-medium">SALDO</div>
                                <div className="text-base font-bold text-yellow-300 flex items-center">
                                    Bs. {userData.balance.toLocaleString()}
                                </div>
                            </div>
                            <button
                                onClick={() => setIsMenuOpen(!isMenuOpen)}
                                className="text-white focus:outline-none p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
                            >
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                    {isMenuOpen ? (
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                                    ) : (
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16m-7 6h7"></path>
                                    )}
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>

                {/* Menú de Botones Móvil (Dropdown) */}
                <div className={`lg:hidden transition-all duration-300 ease-in-out ${isMenuOpen ? 'max-h-96 opacity-100 py-3' : 'max-h-0 opacity-0 overflow-hidden'}`}>
                    <div className="flex flex-col space-y-3 px-4 sm:px-6">
                        {/* Renderizado de botones optimizados para columna */}
                        <button 
                            onClick={handleWithdrawClick}
                            className="bg-gradient-to-r from-yellow-600 to-yellow-500 text-white font-semibold px-4 py-2 rounded-xl text-center shadow-lg shadow-yellow-500/25"
                        >
                            💸 Retirar Saldo
                        </button>
                        <button 
                            onClick={handleRechargeClick}
                            className="bg-gradient-to-r from-green-600 to-green-500 text-white font-semibold px-4 py-2 rounded-xl text-center shadow-lg shadow-green-500/25"
                        >
                            💰 Recargar
                        </button>
                        <button 
                            onClick={() => handleNavigation('/support')}
                            className="relative bg-blue-600 text-white font-semibold px-4 py-2 rounded-xl text-center shadow-lg shadow-blue-500/25"
                        >
                            🆘 Soporte
                            {hasUnreadSupport && (
                                <span className="absolute right-3 top-1/2 -translate-y-1/2 flex h-3 w-3">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-3 w-3 bg-sky-500"></span>
                                </span>
                            )}
                        </button>
                        <button 
                            onClick={() => handleNavigation('/history')}
                            className="bg-gradient-to-r from-blue-600 to-blue-500 text-white font-semibold px-4 py-2 rounded-xl text-center shadow-lg shadow-blue-500/25"
                        >
                            📊 Historial
                        </button>
                        {userData.isAdmin && (
                            <button 
                                onClick={handleAdminClick}
                                className="bg-gradient-to-r from-red-600 to-red-500 text-white font-semibold px-4 py-2 rounded-xl text-center shadow-lg shadow-red-500/25"
                            >
                                ⚙️ Admin
                            </button>
                        )}
                        <button
                            onClick={handleLogout}
                            className="bg-gradient-to-r from-gray-600 to-gray-500 text-white font-semibold px-4 py-2 rounded-xl text-center"
                        >
                            🚪 Salir
                        </button>
                    </div>
                </div>
            </header>

            {/* Contenido principal */}
            <main className="relative z-10 container mx-auto px-4 sm:px-6 py-8 sm:py-12">
                {/* Título */}
                <div className="text-center mb-10 sm:mb-16">
                    <h1 className="text-4xl sm:text-6xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent mb-2 sm:mb-4">
                        SALA DE JUEGOS VIP
                    </h1>
                    <p className="text-md sm:text-xl text-gray-300/80 font-light">
                        Bienvenido, **{userData.username}**. Experimenta la excelencia en gaming.
                    </p>
                </div>

                {/* Grid de juegos responsive */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8 max-w-7xl mx-auto">
                    {games.map((game) => (
                        <div
                            key={game.id}
                            onClick={() => handleGameClick(game)}
                            className={`group relative bg-gradient-to-br ${game.color} rounded-2xl p-6 sm:p-8 text-white cursor-pointer transform transition-all duration-500 hover:scale-[1.02] hover:rotate-0 sm:hover:rotate-1 ${game.glow} border border-white/10 overflow-hidden`}
                        >
                            {/* Efecto de brillo */}
                            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent transform -skew-x-12 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000"></div>
                            
                            <div className="text-5xl sm:text-6xl mb-4 sm:mb-6 text-center filter drop-shadow-2xl">
                                {game.icon}
                            </div>
                            
                            <div className="relative z-10 text-center">
                                <h3 className="text-xl sm:text-2xl font-bold mb-1 sm:mb-2">{game.name}</h3>
                                <p className="text-white/80 text-sm mb-3 font-light">{game.description}</p>
                                
                                <div className={`inline-flex items-center px-3 py-1 sm:px-4 sm:py-2 rounded-full text-xs font-semibold ${
                                    game.status === "active" 
                                        ? "bg-green-500/20 text-green-300 border border-green-500/30" 
                                        : "bg-gray-500/20 text-gray-300 border border-gray-500/30"
                                }`}>
                                    {game.status === "active" ? "🟢 DISPONIBLE" : "🕐 PRÓXIMAMENTE"}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Footer */}
                <div className="text-center mt-12 sm:mt-16 pt-6 border-t border-white/10">
                    <p className="text-gray-400/60 text-xs sm:text-sm font-light">
                        🎩 ORI LUCK VIP - Donde la elegancia se encuentra con la fortuna • 2024
                    </p>
                </div>
            </main>
        </div>
    );
};

export default GameLobby;