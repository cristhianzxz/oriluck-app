import React, { useEffect, useState, useContext } from "react";
import { useNavigate } from "react-router-dom";
import { AuthContext } from "../App"; 
import {
    setBingoHousePercent,
    getBingoHouseConfig,
    logAdminMovement,
    logEditHouseFund
} from "../firestoreService";
import {
    doc,
    onSnapshot,
    collection,
    query,
    orderBy,
    updateDoc,
    increment,
    getDocs,
    where,
    getDoc
} from "firebase/firestore";
import { db } from "../firebase";

const ROLES_ADMIN = [
    "support_agent",
    "moderator",
    "supervisor",
    "admin",
    "owner"
];

const OwnerPanel = () => {
    const navigate = useNavigate();
    const { currentUser, userData } = useContext(AuthContext);

    const [showBolsa, setShowBolsa] = useState(false);
    const [showMovements, setShowMovements] = useState(false);
    const [showGainsHistory, setShowGainsHistory] = useState(false);
    const [houseFund, setHouseFund] = useState(0);
    const [housePercent, setHousePercent] = useState(30);
    const [editPercent, setEditPercent] = useState(false);
    const [newPercent, setNewPercent] = useState(30);
    const [loading, setLoading] = useState(true);
    const [editFundAmount, setEditFundAmount] = useState("");
    const [fundLoading, setFundLoading] = useState(false);
    const [verifyingAccess, setVerifyingAccess] = useState(true);

    const [adminMovements, setAdminMovements] = useState([]);
    const [movementsLoading, setMovementsLoading] = useState(false);
    const [searchMovement, setSearchMovement] = useState("");

    const [gainsHistory, setGainsHistory] = useState([]);
    const [gainsLoading, setGainsLoading] = useState(false);
    const [searchGains, setSearchGains] = useState("");

    useEffect(() => {
        const timer = setTimeout(() => {
            const hasAccess = localStorage.getItem("ownerAccess") === "true";
            if (!hasAccess) {
                navigate("/admin", { replace: true });
            } else {
                setVerifyingAccess(false);
            }
        }, 300);

        const handleUnload = () => {
            localStorage.removeItem("ownerAccess");
        };
        window.addEventListener("beforeunload", handleUnload);

        return () => {
            clearTimeout(timer);
            window.removeEventListener("beforeunload", handleUnload);
        };
    }, [navigate]);

    useEffect(() => {
        if (localStorage.getItem('ownerAccess') !== 'true') return;

        let bingoFundValue = 0;
        let slotsFundValue = 0;
        let crashFundValue = 0;

        const updateCombinedFund = () => {
            setHouseFund(bingoFundValue + slotsFundValue + crashFundValue);
        };

        const bingoRef = doc(db, "houseFunds", "bingo");
        const unsubBingo = onSnapshot(bingoRef, (snap) => {
            if (snap.exists()) {
                const d = snap.data();
                bingoFundValue = d.totalForHouse || 0;
                setHousePercent(d.percentageHouse || 30);
                if (!editPercent) setNewPercent(d.percentageHouse || 30);
            } else {
                bingoFundValue = 0;
            }
            updateCombinedFund();
            setLoading(false);
        });

        const slotsRef = doc(db, "houseFunds", "slots");
        const unsubSlots = onSnapshot(slotsRef, (snap) => {
            slotsFundValue = snap.exists() ? snap.data().totalForHouse || 0 : 0;
            updateCombinedFund();
        });

        const crashRef = doc(db, "houseFunds", "crash");
        const unsubCrash = onSnapshot(crashRef, (snap) => {
            crashFundValue = snap.exists() ? snap.data().totalForHouse || 0 : 0;
            updateCombinedFund();
        });

        return () => {
            unsubBingo();
            unsubSlots();
            unsubCrash();
        };
    }, [editPercent]);

    useEffect(() => {
        let unsub = null;
        if (showMovements) {
            setMovementsLoading(true);
            const q = query(
                collection(db, "adminMovements"),
                orderBy("timestamp", "desc")
            );
            unsub = onSnapshot(q, (snap) => {
                setAdminMovements(
                    snap.docs.map(doc => ({
                        id: doc.id,
                        ...doc.data()
                    }))
                );
                setMovementsLoading(false);
            }, (error) => {
                console.error("Error al leer movimientos admin:", error);
                setMovementsLoading(false);
            });
        }
        return () => {
            if (unsub) unsub();
        };
    }, [showMovements]);

    useEffect(() => {
        let unsub = null;
        if (showGainsHistory) {
            setGainsLoading(true);
            const q = query(
                collection(db, "houseGainsHistory"),
                orderBy("timestamp", "desc")
            );
            unsub = onSnapshot(q, (snap) => {
                setGainsHistory(
                    snap.docs.map(doc => ({
                        id: doc.id,
                        ...doc.data()
                    }))
                );
                setGainsLoading(false);
            }, (error) => {
                console.error("Error al leer historial de ganancias:", error);
                setGainsLoading(false);
            });
        }
        return () => {
            if (unsub) unsub();
        };
    }, [showGainsHistory]);

    const handleSavePercent = async () => {
        const newP = Number(newPercent);
        if (newP < 1 || newP > 30) {
            alert("❌ El porcentaje debe estar entre 1% y 30%");
            return;
        }

        try {
            const oldPercent = housePercent; 

            await setBingoHousePercent(newP);

            const q = query(
                collection(db, 'bingoTournaments'),
                where('status', 'in', ['waiting', 'active'])
            );
            const snapshot = await getDocs(q);
            const updates = [];
            snapshot.forEach(docSnap => {
                updates.push(
                    updateDoc(doc(db, 'bingoTournaments', docSnap.id), {
                        percentageHouse: newP
                    })
                );
            });
            await Promise.all(updates);

            await logAdminMovement({
                actionType: "cambiar_porcentaje_casa",
                adminData: {
                    id: currentUser?.uid || '',
                    name: userData?.username || '',
                    email: currentUser?.email || '',
                    role: userData?.role || 'owner'
                },
                targetType: "configuracion_bingo",
                details: {
                    valorAnterior: oldPercent,
                    valorNuevo: newP
                },
                description: `Cambió el porcentaje de la casa de ${oldPercent}% a ${newP}%`
            });

            setEditPercent(false);
            alert("✅ Comisión de la casa actualizada correctamente (y aplicada a todos los torneos activos)");
        } catch (error) {
            console.error("❌ Error actualizando comisión:", error);
            alert("❌ Error al actualizar la comisión");
        }
    };

    const handleFundEdit = async (type) => {
        if (!editFundAmount || isNaN(Number(editFundAmount)) || Number(editFundAmount) === 0) {
            alert("Ingresa un monto válido mayor a cero.");
            return;
        }
        setFundLoading(true);
        try {
            const amount = Number(editFundAmount);
            const beforeUpdate = houseFund;
            const afterUpdate = type === "add" ? beforeUpdate + amount : beforeUpdate - amount;

            await updateDoc(doc(db, "houseFunds", "bingo"), {
                totalForHouse: increment(type === "add" ? amount : -amount)
            });

            await logAdminMovement({
                actionType: "ajustar_bolsa_casa",
                adminData: {
                    id: currentUser?.uid || '',
                    name: userData?.username || '',
                    email: currentUser?.email || '',
                    role: userData?.role || 'owner'
                },
                targetType: "fondos_casa",
                details: {
                    montoAntes: beforeUpdate,
                    montoDespues: afterUpdate,
                    tipoCambio: type,
                    monto: amount
                },
                description: `Ajustó la bolsa de la casa: ${type === 'add' ? 'sumó' : 'restó'} ${amount} Bs (de ${beforeUpdate} Bs a ${afterUpdate} Bs)`
            });

            setEditFundAmount("");
            alert(`✅ Monto ${type === "add" ? "sumado" : "restado"} correctamente`);
        } catch (e) {
            alert("❌ Error al actualizar la bolsa de la casa");
        }
        setFundLoading(false);
    };

    if (verifyingAccess) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-black to-yellow-900 text-yellow-300 text-xl">
                Verificando acceso...
            </div>
        );
    }

    const filteredMovements = adminMovements.filter(mov => {
        if (!searchMovement.trim()) return true;
        const search = searchMovement.trim().toLowerCase();
        return (
            (mov.adminName || "").toLowerCase().includes(search) ||
            (mov.adminEmail || "").toLowerCase().includes(search) ||
            (mov.adminUsername || "").toLowerCase().includes(search)
        );
    });

    const filteredGains = gainsHistory.filter(gain => {
        if (!searchGains.trim()) return true;
        const search = searchGains.trim().toLowerCase();
        return (
            (gain.game || "").toLowerCase().includes(search)
        );
    });

    return (
        <div className="min-h-screen bg-gradient-to-br from-black via-gray-900 to-yellow-900 flex flex-col">
            <header className="relative z-10 bg-black/60 backdrop-blur-xl border-b border-yellow-500/30 shadow-2xl">
                <div className="container mx-auto px-4 py-6 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <div className="text-2xl font-bold bg-gradient-to-r from-yellow-400 to-yellow-200 bg-clip-text text-transparent tracking-wider">
                            🦾 OWNER PANEL
                        </div>
                        <span className="ml-3 px-3 py-1 rounded bg-yellow-500/10 text-yellow-200 text-xs font-semibold">
                            Acceso propietario
                        </span>
                    </div>
                    <div className="text-white/80 text-right">
                        <div className="text-sm opacity-60">
                            Propietario: {currentUser?.email}
                            {userData?.role && (
                                <span className="ml-2 px-2 py-0.5 rounded bg-white/10 text-xs">
                                    {userData?.role}
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            </header>

            <main className="flex-1 flex items-center justify-center">
                <div className="w-full flex flex-col items-center justify-center py-16">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-12 w-full max-w-4xl mt-12">
                        <button
                            onClick={() => setShowBolsa(true)}
                            className="bg-gradient-to-br from-yellow-500 to-yellow-600 hover:from-yellow-400 hover:to-yellow-500 text-black font-bold py-12 px-8 rounded-2xl shadow-xl text-3xl flex flex-col items-center justify-center transition-all transform hover:scale-105"
                            style={{ minHeight: "220px" }}
                        >
                            💰 Bolsa de la Casa
                        </button>
                        <button
                            onClick={() => {
                                setMovementsLoading(true);
                                setShowMovements(true);
                            }}
                            className="bg-gradient-to-br from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white font-bold py-12 px-8 rounded-2xl shadow-xl text-3xl flex flex-col items-center justify-center transition-all transform hover:scale-105"
                            style={{ minHeight: "220px" }}
                        >
                            📜 Historial de Movimientos
                        </button>
                        <button
                            onClick={() => setShowGainsHistory(true)}
                            className="bg-gradient-to-br from-purple-600 to-purple-700 hover:from-purple-500 hover:to-purple-600 text-white font-bold py-12 px-8 rounded-2xl shadow-xl text-3xl flex flex-col items-center justify-center transition-all transform hover:scale-105"
                            style={{ minHeight: "220px" }}
                        >
                            📈 Historial de Ganancias
                        </button>
                        <button
                            disabled
                            className="bg-gradient-to-br from-gray-700 to-gray-800 text-white font-bold py-12 px-8 rounded-2xl shadow-xl text-3xl flex flex-col items-center justify-center opacity-70 cursor-not-allowed"
                            style={{ minHeight: "220px" }}
                        >
                            🛠️ Función 4
                            <span className="text-lg mt-5 font-medium">En construcción</span>
                        </button>
                    </div>
                    <button
                        onClick={() => navigate("/admin")}
                        className="mt-16 bg-gradient-to-r from-gray-700 to-gray-800 hover:from-gray-600 hover:to-gray-700 text-yellow-200 px-8 py-4 rounded-xl text-2xl shadow-lg transition-all transform hover:scale-105"
                    >
                        ← Volver al Panel Admin
                    </button>
                </div>
            </main>

            {showBolsa && (
                <div className="fixed inset-0 flex items-center justify-center z-50 bg-black/70 backdrop-blur-sm">
                    <div className="bg-gradient-to-br from-gray-900 to-black rounded-3xl p-8 shadow-2xl border border-yellow-500/30 max-w-lg w-full relative">
                        <button
                            onClick={() => setShowBolsa(false)}
                            className="absolute top-4 right-4 text-yellow-200 hover:text-yellow-400 text-2xl font-bold"
                            title="Cerrar"
                        >×</button>
                        <h2 className="text-2xl font-bold text-yellow-200 mb-6 text-center">💰 Bolsa de la Casa</h2>
                        {loading ? (
                            <div className="text-yellow-300 text-center">Cargando...</div>
                        ) : (
                            <>
                                <div className="mb-4 text-center">
                                    <div className="text-4xl font-bold text-yellow-400 mb-2">{houseFund.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs</div>
                                    <div className="text-yellow-100 mb-2">Acumulado total de la casa (Slots, Bingo, Crash, etc.)</div>
                                </div>
                                <div className="flex items-center justify-center gap-4 my-4">
                                    <div className="font-semibold text-yellow-300">Porcentaje para la casa (Solo Bingo):</div>
                                    {editPercent ? (
                                        <input
                                            type="number"
                                            min={1}
                                            max={30}
                                            value={newPercent}
                                            onChange={e => setNewPercent(e.target.value)}
                                            className="w-20 p-2 rounded bg-yellow-200 text-black text-lg text-center"
                                        />
                                    ) : (
                                        <span className="text-yellow-200 text-xl font-bold">{housePercent}%</span>
                                    )}
                                    {editPercent ? (
                                        <>
                                            <button
                                                className="bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded ml-2"
                                                onClick={handleSavePercent}
                                                disabled={newPercent === housePercent}
                                            >Guardar</button>
                                            <button
                                                className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded ml-2"
                                                onClick={() => { setEditPercent(false); setNewPercent(housePercent); }}
                                            >Cancelar</button>
                                        </>
                                    ) : (
                                        <button
                                            className="bg-yellow-600 hover:bg-yellow-500 text-white px-4 py-2 rounded ml-2"
                                            onClick={() => setEditPercent(true)}
                                        >Editar %</button>
                                    )}
                                </div>
                                <div className="mt-8 text-center">
                                    <h3 className="text-lg font-bold text-yellow-300 mb-3">Modificar Monto de la Bolsa (Manual)</h3>
                                    <div className="flex flex-col sm:flex-row items-center justify-center gap-2 mb-2">
                                        <input
                                            type="number"
                                            value={editFundAmount}
                                            onChange={e => setEditFundAmount(e.target.value)}
                                            className="w-32 p-2 rounded bg-yellow-200 text-black text-lg text-center mb-2 sm:mb-0"
                                            placeholder="Monto Bs"
                                            min="1"
                                            step="1"
                                        />
                                        <button
                                            onClick={() => handleFundEdit("add")}
                                            className="bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded font-bold"
                                            disabled={fundLoading}
                                        >
                                            Sumar
                                        </button>
                                        <button
                                            onClick={() => handleFundEdit("subtract")}
                                            className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded font-bold"
                                            disabled={fundLoading}
                                        >
                                            Restar
                                        </button>
                                    </div>
                                    <div className="text-xs text-yellow-200 mt-2">Puedes sumar o restar dinero manualmente para reflejar movimientos con la cuenta bancaria real.</div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {showMovements && (
                <div className="fixed inset-0 flex items-center justify-center z-50 bg-black/60 backdrop-blur-sm">
                    <div className="bg-gradient-to-br from-gray-900 to-black rounded-3xl p-8 shadow-2xl border border-blue-500/30 max-w-2xl w-full relative">
                        <button
                            onClick={() => setShowMovements(false)}
                            className="absolute top-4 right-4 text-blue-200 hover:text-blue-400 text-2xl font-bold"
                            title="Cerrar"
                        >×</button>
                        <h2 className="text-2xl font-bold text-blue-300 mb-2 text-center">📜 Historial de Movimientos Administrativos</h2>
                        <div className="mb-2 flex justify-center">
                            <input
                                type="text"
                                placeholder="Buscar por nombre, correo, usuario..."
                                value={searchMovement}
                                onChange={e => setSearchMovement(e.target.value)}
                                className="w-72 p-2 rounded bg-blue-100 text-black text-lg text-center"
                            />
                        </div>
                        <div className="mb-3 text-xs text-blue-200 text-center">
                            Solo se muestran movimientos de roles administrativos (Agente de Soporte, Moderador, Supervisor, Administrador)
                        </div>
                        {movementsLoading ? (
                            <div className="text-blue-300 text-center py-8">Cargando movimientos...</div>
                        ) : (
                            <div className="max-h-[52vh] overflow-y-auto scrollbar-thin scrollbar-thumb-blue-500/40 scrollbar-track-transparent">
                                {filteredMovements.length === 0 ? (
                                    <div className="text-center py-8 text-blue-300/70">No se encontraron movimientos para este filtro.</div>
                                ) : (
                                    <div className="space-y-3">
                                        {filteredMovements.map(mov => (
                                            <div key={mov.id} className="bg-blue-900/20 rounded-xl p-4 border border-blue-500/10 flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
                                                <div>
                                                    <div className="font-bold text-blue-300">{mov.adminName}</div>
                                                    <div className="text-xs text-blue-100">{mov.adminRole}</div>
                                                    <div className="text-xs text-blue-200">{mov.adminEmail || mov.adminUsername || ""}</div>
                                                </div>
                                                <div>
                                                    <div className="font-bold text-yellow-300">
                                                        {mov.actionType === "ajustar_bolsa_casa" ? (
                                                            <>
                                                                {mov.details?.tipoCambio === "add" ? "+" : "-"}{mov.details?.monto?.toLocaleString()} Bs
                                                            </>
                                                        ) : mov.actionType === "cambiar_porcentaje_casa" ? (
                                                            <>
                                                                Cambió comisión de {mov.details?.valorAnterior}% a {mov.details?.valorNuevo}%
                                                            </>
                                                        ) : mov.actionType === "cambiar_tasa_cambio" ? (
                                                            <>
                                                                Cambió tasa de {mov.details?.valorAnterior} Bs a {mov.details?.valorNuevo} Bs
                                                            </>
                                                        ) : (
                                                            "Acción registrada"
                                                        )}
                                                    </div>
                                                    <div className="text-xs text-blue-100">{mov.description}</div>
                                                </div>
                                                <div className="text-xs text-blue-200 text-right">
                                                    {mov.timestamp?.toDate?.()?.toLocaleString?.() || new Date(mov.timestamp).toLocaleString()}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {showGainsHistory && (
                <div className="fixed inset-0 flex items-center justify-center z-50 bg-black/60 backdrop-blur-sm">
                    <div className="bg-gradient-to-br from-gray-900 to-black rounded-3xl p-8 shadow-2xl border border-purple-500/30 max-w-2xl w-full relative">
                        <button
                            onClick={() => setShowGainsHistory(false)}
                            className="absolute top-4 right-4 text-purple-200 hover:text-purple-400 text-2xl font-bold"
                            title="Cerrar"
                        >×</button>
                        <h2 className="text-2xl font-bold text-purple-300 mb-2 text-center">📈 Historial de Ganancias de la Casa</h2>
                        <div className="mb-2 flex justify-center">
                            <input
                                type="text"
                                placeholder="Buscar por juego (Crash, Bingo...)"
                                value={searchGains}
                                onChange={e => setSearchGains(e.target.value)}
                                className="w-72 p-2 rounded bg-purple-100 text-black text-lg text-center"
                            />
                        </div>
                        <div className="mb-3 text-xs text-purple-200 text-center">
                            Registros automáticos de ganancias netas positivas de los juegos.
                        </div>
                        {gainsLoading ? (
                            <div className="text-purple-300 text-center py-8">Cargando historial de ganancias...</div>
                        ) : (
                            <div className="max-h-[52vh] overflow-y-auto scrollbar-thin scrollbar-thumb-purple-500/40 scrollbar-track-transparent">
                                {filteredGains.length === 0 ? (
                                    <div className="text-center py-8 text-purple-300/70">No se encontraron ganancias para este filtro.</div>
                                ) : (
                                    <div className="space-y-3">
                                        {filteredGains.map(gain => (
                                            <div key={gain.id} className="bg-purple-900/20 rounded-xl p-4 border border-purple-500/10 flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
                                                <div>
                                                    <div className="font-bold text-purple-300 text-xl">{gain.game}</div>
                                                    <div className="text-xs text-purple-200">ID de Ronda: {gain.roundId || 'N/A'}</div>
                                                </div>
                                                <div className="font-bold text-green-400 text-lg text-right">
                                                    + {gain.amount?.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs
                                                </div>
                                                <div className="text-xs text-purple-200 text-right">
                                                    {gain.timestamp?.toDate?.()?.toLocaleString?.('es-VE') || 'Fecha inválida'}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            <div className="absolute top-20 left-10 w-32 h-32 bg-yellow-500/10 rounded-full blur-xl"></div>
            <div className="absolute bottom-20 right-10 w-48 h-48 bg-yellow-500/10 rounded-full blur-2xl"></div>
            <style>{`
                .panel-content:empty {
                    display: none !important;
                }
                .scrollbar-thin::-webkit-scrollbar {
                    width: 6px;
                    background: transparent;
                }
                .scrollbar-thin::-webkit-scrollbar-thumb {
                    border-radius: 6px;
                }
            `}</style>
        </div>
    );
};

export default OwnerPanel;