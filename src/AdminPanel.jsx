import React, { useState, useEffect, useContext } from "react";
import { useNavigate } from "react-router-dom";
import { AuthContext } from "./App";
import {
    getPendingRechargeRequests,
    getPendingWithdrawRequests,
    updateRechargeRequest,
    updateWithdrawRequest,
    updateUserBalance,
    getExchangeRate,
    updateExchangeRate,
    createTransaction,
    getAllRechargeRequests,
    getAllWithdrawRequests,
    findTransactionByRequestId,
    updateTransactionStatus,
    getAllUsers,
    setUserBalance,
    deleteUserFromFirestore,
    suspendUser,
    updateUserRole
} from "./firestoreService";
import { doc, onSnapshot, updateDoc, getDocs, collection, deleteDoc, query, where } from "firebase/firestore";
import { db } from "./firebase";

const ROLES = [
    { id: 'user', name: 'Usuario' },
    { id: 'support_agent', name: 'Agente de Soporte' },
    { id: 'moderator', name: 'Moderador' },
    { id: 'supervisor', name: 'Supervisor' },
    { id: 'admin', name: 'Administrador' }
];

const adminEmails = [
    "cristhianzxz@hotmail.com",
    "admin@oriluck.com",
    "correo.nuevo.admin1@example.com",
    "correo.nuevo.admin2@example.com"
];

const USERS_PASSWORD = import.meta.env.VITE_USERS_PASSWORD;

const AdminPanel = () => {
    const navigate = useNavigate();
    const { currentUser } = useContext(AuthContext);
    const [currentUserData, setCurrentUserData] = useState(undefined);
    const [activeTab, setActiveTab] = useState("recharges");
    const [exchangeRate, setExchangeRate] = useState(100);
    const [requests, setRequests] = useState([]);
    const [users, setUsers] = useState([]);
    const [loadingData, setLoadingData] = useState(false);
    const [allRequests, setAllRequests] = useState([]);
    const [historyFilter, setHistoryFilter] = useState("all");
    const [isUsersSectionUnlocked, setIsUsersSectionUnlocked] = useState(false);
    const [userSearch, setUserSearch] = useState("");
    const [selectedRequest, setSelectedRequest] = useState(null);
    const [newRequestNotification, setNewRequestNotification] = useState(false);

    // Nuevos estados para búsqueda en historial
    const [rechargeSearch, setRechargeSearch] = useState("");
    const [withdrawSearch, setWithdrawSearch] = useState("");

    // Modal de contraseña
    const [showPasswordModal, setShowPasswordModal] = useState(false);
    const [passwordInput, setPasswordInput] = useState("");
    const [passwordError, setPasswordError] = useState("");

    // Modal de confirmación para eliminar transactions
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [deleteLoading, setDeleteLoading] = useState(false);

    const isAdmin = currentUserData?.role === "admin" || adminEmails.includes(currentUser?.email);

    useEffect(() => {
        if (!currentUser?.uid) {
            if (currentUserData === undefined) setCurrentUserData(null);
            return;
        }
        const userRef = doc(db, "users", currentUser.uid);
        const unsub = onSnapshot(userRef, (snap) => {
            if (snap.exists()) {
                setCurrentUserData(snap.data());
            } else {
                setCurrentUserData({ role: 'user' });
            }
        });
        return () => unsub();
    }, [currentUser?.uid]);

    useEffect(() => {
        if (currentUserData === undefined) return;
        if (!isAdmin) {
            navigate('/lobby');
            return;
        }
        loadData();
    }, [isAdmin, navigate, currentUserData]);

    useEffect(() => {
        if (activeTab !== "recharges") return; // Solo cuando está en el panel de solicitudes
        const qRecharge = query(collection(db, "rechargeRequests"), where("status", "==", "pending"));
        const unsubRecharge = onSnapshot(qRecharge, (snap) => {
            if (snap.docChanges().some(change => change.type === "added")) {
                setNewRequestNotification(true);
                const audio = new window.Audio("/notification.mp3");
                audio.play().catch(() => {});
                setTimeout(() => setNewRequestNotification(false), 3000);
            }
        });
        const qWithdraw = query(collection(db, "withdrawRequests"), where("status", "==", "pending"));
        const unsubWithdraw = onSnapshot(qWithdraw, (snap) => {
            if (snap.docChanges().some(change => change.type === "added")) {
                setNewRequestNotification(true);
                const audio = new window.Audio("/notification.mp3");
                audio.play().catch(() => {});
                setTimeout(() => setNewRequestNotification(false), 3000);
            }
        });
        return () => {
            unsubRecharge();
            unsubWithdraw();
        };
    }, [activeTab]);

    useEffect(() => {
        if (!isAdmin) return;
        if (activeTab !== "recharges") return;

        const qRecharge = query(collection(db, "rechargeRequests"), where("status", "==", "pending"));
        const qWithdraw = query(collection(db, "withdrawRequests"), where("status", "==", "pending"));

        const unsubRecharge = onSnapshot(qRecharge, (snap) => {
            const rechargeReqs = snap.docs.map(doc => ({ id: doc.id, ...doc.data(), requestType: "recharge" }));
            setRequests(prev => {
                const withdraws = prev.filter(r => r.requestType === "withdraw");
                return [...rechargeReqs, ...withdraws];
            });
        });

        const unsubWithdraw = onSnapshot(qWithdraw, (snap) => {
            const withdrawReqs = snap.docs.map(doc => ({ id: doc.id, ...doc.data(), requestType: "withdraw" }));
            setRequests(prev => {
                const recharges = prev.filter(r => r.requestType === "recharge");
                return [...recharges, ...withdrawReqs];
            });
        });

        return () => {
            unsubRecharge();
            unsubWithdraw();
        };
    }, [activeTab, isAdmin]);

    useEffect(() => {
        const unsub = onSnapshot(collection(db, "users"), (snap) => {
            setUsers(snap.docs.map(doc => ({
                ...doc.data(),
                id: doc.id,
                role: doc.data().role || 'user',
                suspended: !!doc.data().suspended,
                active: !!doc.data().active, // ← importante para el filtro de usuarios activos
                lastActive: doc.data().lastActive // ← para detectar timestamp si lo quieres usar
            })));
        });
        return () => unsub();
    }, []);

    const loadData = async () => {
        setLoadingData(true);
        try {
            const rechargeReqs = await getPendingRechargeRequests();
            const withdrawReqs = await getPendingWithdrawRequests();
            const requestsWithType = [
                ...rechargeReqs.map(r => ({ ...r, requestType: "recharge" })),
                ...withdrawReqs.map(r => ({ ...r, requestType: "withdraw" }))
            ];
            setRequests(requestsWithType);

            const allRechargeRequests = await getAllRechargeRequests();
            const allWithdrawRequests = await getAllWithdrawRequests();
            const allRequestsWithType = [
                ...allRechargeRequests.map(r => ({ ...r, requestType: "recharge" })),
                ...allWithdrawRequests.map(r => ({ ...r, requestType: "withdraw" }))
            ];
            setAllRequests(allRequestsWithType);

            const rate = await getExchangeRate();
            setExchangeRate(rate);

            const usersList = await getAllUsers();
            setUsers(usersList.map(u => ({
                ...u,
                role: u.role || 'user',
                suspended: !!u.suspended,
                active: !!u.active,
                lastActive: u.lastActive
            })));
        } catch (error) {
            console.error("❌ Error cargando datos del panel:", error);
        }
        setLoadingData(false);
    };

    // Usuarios activos: sólo los que tienen active=true y NO están suspendidos
    // Opcional: solo si el último timestamp de lastActive es menor a 10 minutos
    const usersActive = users.filter(u =>
        !u.suspended &&
        u.active &&
        (
            u.lastActive && typeof u.lastActive === "object" && typeof u.lastActive.toMillis === "function"
                ? (Date.now() - u.lastActive.toMillis() < 10 * 60 * 1000)
                : true // Si no tienes lastActive, sólo verifica active
        )
    );

    const handleRequestAction = async (requestId, action) => {
        try {
            const request = requests.find(req => req.id === requestId);
            if (!request) return;
            const adminEmail = currentUser?.email || 'Admin Desconocido';
            const existingTransaction = await findTransactionByRequestId(request.id);

            if (request.requestType === "recharge") {
                if (action === "approved") {
                    if (existingTransaction) {
                        await updateTransactionStatus(existingTransaction.id, "approved", adminEmail);
                    } else {
                        await createTransaction({
                            userId: request.userId, username: request.username, type: "recharge", amount: request.amountBS,
                            description: `Recarga aprobada - ${request.amountUSD} USD`, status: "approved",
                            requestId: request.id, admin: adminEmail, method: request.method, reference: request.reference
                        });
                    }
                    const success = await updateUserBalance(request.userId, request.amountBS);
                    if (!success) { alert("❌ Error al actualizar el saldo"); return; }
                    await updateRechargeRequest(request.id, "approved", adminEmail);
                    alert(`✅ Recarga de $${request.amountUSD} USD aprobada para ${request.username}`);
                } else {
                    if (existingTransaction) {
                        await updateTransactionStatus(existingTransaction.id, "rejected", adminEmail);
                    } else {
                        await createTransaction({
                            userId: request.userId, username: request.username, type: "recharge", amount: request.amountBS,
                            description: `Recarga rechazada - ${request.amountUSD} USD`, status: "rejected",
                            requestId: request.id, admin: adminEmail, method: request.method, reference: request.reference
                        });
                    }
                    await updateRechargeRequest(request.id, "rejected", adminEmail);
                    alert(`❌ Solicitud de recarga rechazada`);
                }
            }

            if (request.requestType === "withdraw") {
                if (action === "approved") {
                    if (existingTransaction) {
                        await updateTransactionStatus(existingTransaction.id, "approved", adminEmail);
                    } else {
                        await createTransaction({
                            userId: request.userId, username: request.username, type: "withdraw", amount: request.amountBS,
                            description: `Retiro aprobado - ${request.amountUSD} USD`, status: "approved",
                            requestId: request.id, admin: adminEmail, method: request.method
                        });
                    }
                    const success = await updateUserBalance(request.userId, -Math.abs(request.amountBS));
                    if (!success) {
                        alert("❌ Error al descontar el saldo del usuario");
                        return;
                    }
                    await updateWithdrawRequest(request.id, "approved", adminEmail);
                    alert(`✅ Retiro de $${request.amountUSD} USD aprobado para ${request.username}`);
                } else {
                    if (existingTransaction) {
                        await updateTransactionStatus(existingTransaction.id, "rejected", adminEmail);
                    } else {
                        await createTransaction({
                            userId: request.userId, username: request.username, type: "withdraw", amount: request.amountBS,
                            description: `Retiro rechazado - ${request.amountUSD} USD`, status: "rejected",
                            requestId: request.id, admin: adminEmail, method: request.method
                        });
                    }
                    await updateWithdrawRequest(request.id, "rejected", adminEmail);
                    alert(`❌ Solicitud de retiro rechazada`);
                }
            }

            await loadData();
        } catch (error) {
            console.error("❌ Error procesando solicitud:", error);
            alert("❌ Error al procesar la solicitud");
        }
    };

    const handleSaveExchangeRate = async () => {
        try {
            await updateExchangeRate(exchangeRate);
            alert("✅ Tasa de cambio actualizada correctamente");
        } catch (error) {
            console.error("❌ Error actualizando tasa:", error);
            alert("❌ Error al actualizar la tasa");
        }
    };

    const handleUserRoleChange = async (userId, newRole) => {
        const userToChange = users.find(u => u.id === userId);
        if (!userToChange) return;
        const roleName = ROLES.find(r => r.id === newRole)?.name || newRole;
        if (!window.confirm(`¿Cambiar rol de "${userToChange.username || userToChange.email}" a "${roleName}"?`)) return;

        try {
            await updateUserRole(userId, newRole);
            const isAdminStatus = newRole === "admin";
            const userRef = doc(db, "users", userId);

            if (isAdminStatus) {
                await setUserBalance(userId, userToChange.balance);
                await updateDoc(userRef, { isAdmin: true });
            } else {
                await updateDoc(userRef, { isAdmin: false });
            }
            setUsers(users.map(u => u.id === userId ? { ...u, role: newRole, isAdmin: isAdminStatus } : u));
            alert("Rol actualizado");
        } catch (e) {
            console.error("Error actualizando rol", e);
            alert("Error actualizando rol");
        }
    };

    const handleToggleSuspension = async (userId, isSuspended) => {
        const userToChange = users.find(u => u.id === userId);
        if (!userToChange) return;
        const action = isSuspended ? "Reactivar" : "Suspender";
        if (!window.confirm(`¿Está seguro de ${action.toLowerCase()} al usuario "${userToChange.username || userToChange.email}"?`)) return;

        try {
            const ok = await suspendUser(userId, !isSuspended);
            if (ok) {
                setUsers(users.map(u => u.id === userId ? { ...u, suspended: !isSuspended } : u));
                alert(`${action} exitosa.`);
            } else {
                alert(`Error al ${action.toLowerCase()} el usuario.`);
            }
        } catch (e) {
            console.error(`Error al ${action.toLowerCase()} el usuario`, e);
            alert(`Error al ${action.toLowerCase()} el usuario.`);
        }
    };

    const handleDeleteUser = async (userId) => {
        const userToChange = users.find(u => u.id === userId);
        if (!userToChange) return;
        if (!window.confirm(`⚠️ ADVERTENCIA: Esta acción es permanente. ¿Eliminar usuario "${userToChange.username || userToChange.email}" y sus datos?`)) return;

        try {
            const ok = await deleteUserFromFirestore(userId);
            if (ok) {
                setUsers(users.filter(u => u.id !== userId));
                alert("Usuario eliminado permanentemente.");
            } else {
                alert("Error al eliminar el usuario.");
            }
        } catch (e) {
            console.error("Error al eliminar usuario", e);
            alert("Error al eliminar usuario.");
        }
    };

    const filteredUsers = users.filter(u =>
        (u.username || "").toLowerCase().includes(userSearch.toLowerCase()) ||
        (u.email || "").toLowerCase().includes(userSearch.toLowerCase()) ||
        (u.phone || "").includes(userSearch)
    );

    // Historial agrupado y ordenado + búsqueda
    const rechargeHistory = allRequests
        .filter(r =>
            r.requestType === "recharge" &&
            (historyFilter === "all" || r.status === historyFilter) &&
            (
                rechargeSearch.trim() === "" ||
                (r.username || "").toLowerCase().includes(rechargeSearch.toLowerCase()) ||
                (r.email || "").toLowerCase().includes(rechargeSearch.toLowerCase()) ||
                (r.reference || "").toLowerCase().includes(rechargeSearch.toLowerCase()) ||
                (r.bank || "").toLowerCase().includes(rechargeSearch.toLowerCase())
            )
        )
        .sort((a, b) => {
            const aMillis = a.createdAt?.toMillis?.() || 0;
            const bMillis = b.createdAt?.toMillis?.() || 0;
            return bMillis - aMillis;
        });

    const withdrawHistory = allRequests
        .filter(r =>
            r.requestType === "withdraw" &&
            (historyFilter === "all" || r.status === historyFilter) &&
            (
                withdrawSearch.trim() === "" ||
                (r.username || "").toLowerCase().includes(withdrawSearch.toLowerCase()) ||
                (r.email || "").toLowerCase().includes(withdrawSearch.toLowerCase()) ||
                (r.bank || "").toLowerCase().includes(withdrawSearch.toLowerCase()) ||
                (r.cedula || "").toLowerCase().includes(withdrawSearch.toLowerCase())
            )
        )
        .sort((a, b) => {
            const aMillis = a.createdAt?.toMillis?.() || 0;
            const bMillis = b.createdAt?.toMillis?.() || 0;
            return bMillis - aMillis;
        });

    // Eliminar todos los registros de transactions
    const handleDeleteAllTransactions = async () => {
        setDeleteLoading(true);
        try {
            const querySnapshot = await getDocs(collection(db, "transactions"));
            for (const document of querySnapshot.docs) {
                await deleteDoc(doc(db, "transactions", document.id));
            }
            setDeleteLoading(false);
            setShowDeleteModal(false);
            alert("Todos los registros de transactions han sido eliminados.");
        } catch (error) {
            setDeleteLoading(false);
            setShowDeleteModal(false);
            alert("Error eliminando registros: " + error.message);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 relative overflow-hidden">
            <header className="relative z-10 bg-black/40 backdrop-blur-lg border-b border-red-500/30 shadow-2xl">
                <div className="container mx-auto px-4 sm:px-6 py-4">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 sm:gap-4">
                        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4 w-full">
                            <button
                                onClick={() => navigate('/lobby')}
                                className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-xl transition-all duration-300 w-full sm:w-auto"
                            >
                                ← Volver al Lobby
                            </button>
                            <div className="text-xl sm:text-3xl font-bold bg-gradient-to-r from-red-400 to-red-200 bg-clip-text text-transparent w-full sm:w-auto text-left sm:text-center">
                                ⚙️ PANEL DE ADMINISTRACIÓN
                            </div>
                        </div>
                        <div className="flex flex-row items-center gap-4 w-full sm:w-auto justify-end">
                            <div className="text-white/80 text-left sm:text-right">
                                <div className="text-sm opacity-60 break-words">
                                    Administrador: {currentUser?.email}
                                    {currentUserData?.role && (
                                        <span className="ml-2 px-2 py-0.5 rounded bg-white/10 text-xs">
                                            {ROLES.find(r => r.id === currentUserData?.role)?.name || currentUserData?.role}
                                        </span>
                                    )}
                                </div>
                                <div className="font-light text-red-200">
                                    Solicitudes pendientes: {requests.filter(r => r.status === "pending").length}
                                </div>
                            </div>
                            <div className="flex flex-col items-end">
                                <div className="bg-green-700/80 text-white px-3 py-1 rounded-xl text-xs shadow-lg">
                                    Usuarios activos: {usersActive.length}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </header>

{/* BOTONES DE PESTAÑAS */}
<div className="flex flex-col sm:flex-row gap-2 sm:gap-4 mb-8 px-4 sm:px-6 pt-6">
    {["recharges", "history", "settings", "users", "support"].map((tab) => {
        const handleTabClick = () => {
            if (tab === 'users') {
                if (isUsersSectionUnlocked) {
                    setActiveTab('users');
                } else {
                    setShowPasswordModal(true);
                }
            } else {
                setActiveTab(tab);
            }
        };

        return (
            <button
                key={tab}
                onClick={handleTabClick}
                className={`w-full sm:w-auto px-4 py-3 sm:px-8 sm:py-4 rounded-xl font-semibold text-base sm:text-lg transition-all duration-300 transform hover:scale-105 ${
                    activeTab === tab
                        ? "bg-red-500 text-white shadow-lg shadow-red-500/30"
                        : "bg-white/10 text-white hover:bg-white/20 border border-white/20"
                }`}
            >
                {tab === "recharges" && "💳 Solicitudes de Recarga/Retiro"}
                {tab === "history" && "📊 Historial"}
                {tab === "settings" && "⚙️ Configuración General"}
                {tab === "users" && "👥 Usuarios"}
                {tab === "support" && "🎫 Soporte"}
            </button>
        );
    })}
</div>

            {/* MODAL DE CONTRASEÑA */}
            {showPasswordModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
                    <div className="bg-gray-900 rounded-2xl p-8 max-w-xs w-full border-2 border-purple-500 shadow-2xl relative">
                        <button
                            className="absolute top-4 right-4 text-white text-2xl hover:text-red-400"
                            onClick={() => {
                                setShowPasswordModal(false);
                                setPasswordInput("");
                                setPasswordError("");
                            }}
                        >×</button>
                        <h3 className="text-xl font-bold mb-4 text-purple-300 text-center">🔒 Acceso a Usuarios</h3>
                        <label className="block text-white/80 mb-2 text-sm">Ingresa la contraseña:</label>
                        <input
                            type="password"
                            value={passwordInput}
                            onChange={e => setPasswordInput(e.target.value)}
                            className="w-full p-3 rounded-lg bg-white/20 border border-purple-500/30 text-white text-lg focus:outline-none mb-2"
                            autoFocus
                        />
                        {passwordError && (
                            <div className="text-red-400 text-xs mb-2">{passwordError}</div>
                        )}
                        <button
                            className="bg-purple-600 hover:bg-purple-500 text-white font-bold py-2 px-6 rounded-xl transition-all duration-300 w-full"
                            onClick={() => {
                                if (passwordInput === USERS_PASSWORD) {
    setIsUsersSectionUnlocked(true);
    setActiveTab('users');
    setShowPasswordModal(false);
    setPasswordInput("");
    setPasswordError("");
    alert("✅ Acceso concedido.");
} else {
    setPasswordError("❌ Contraseña incorrecta.");
}
                            }}
                        >
                            Acceder
                        </button>
                    </div>
                </div>
            )}

            {/* MODAL DE CONFIRMACIÓN PARA ELIMINAR TRANSACTIONS */}
            {showDeleteModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
                    <div className="bg-gray-900 rounded-2xl p-8 max-w-md w-full border-2 border-red-500 shadow-2xl relative">
                        <button
                            className="absolute top-4 right-4 text-white text-2xl hover:text-red-400"
                            onClick={() => setShowDeleteModal(false)}
                        >×</button>
                        <h3 className="text-xl font-bold mb-4 text-red-400 text-center">🗑️ Eliminar TODOS los registros</h3>
                        <p className="text-white/80 mb-4 text-center">
                            ¿Seguro que quieres eliminar <b>TODOS</b> los registros de <span className="text-red-400 font-bold">transactions</span>?<br />
                            <span className="text-yellow-400">Esta acción es irreversible.</span>
                        </p>
                        <div className="flex gap-4">
                            <button
                                className="bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 px-6 rounded-xl w-full"
                                onClick={() => setShowDeleteModal(false)}
                                disabled={deleteLoading}
                            >
                                Cancelar
                            </button>
                            <button
                                className="bg-red-600 hover:bg-red-500 text-white font-bold py-2 px-6 rounded-xl w-full"
                                onClick={handleDeleteAllTransactions}
                                disabled={deleteLoading}
                            >
                                {deleteLoading ? "Eliminando..." : "Eliminar"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

{activeTab === "recharges" && newRequestNotification && (
    <div className="fixed top-25 right-4 bg-green-600 text-white px-4 py-2 rounded-xl shadow-lg z-50">
        ¡Nueva solicitud recibida!
    </div>
)}

<main className="relative z-10 container mx-auto px-2 sm:px-6 py-8">
    <div className="max-w-7xl mx-auto">
        <div className="bg-white/10 rounded-2xl p-2 sm:p-8 backdrop-blur-lg border border-white/20 panel-content">

            {/* PESTAÑA: RECARGAS Y RETIROS PENDIENTES */}
            {activeTab === "recharges" && (
                <div>
                    <h3 className="text-xl sm:text-2xl font-bold text-white mb-6">
                        💳 Solicitudes Pendientes ({requests.filter(r => r.status === "pending").length})
                    </h3>
                    {requests.filter(r => r.status === "pending").length === 0 ? (
                        <div className="text-center py-12">
                            <div className="text-6xl mb-4">📭</div>
                            <p className="text-white/70 text-lg">No hay solicitudes pendientes</p>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {requests.filter(r => r.status === "pending").map((request) => (
                                <div key={request.id} className="bg-white/5 rounded-xl p-4 sm:p-6 border border-white/10">
                                    <div className="flex flex-col lg:grid lg:grid-cols-5 gap-4 lg:gap-6 items-center">
                                        <div>
                                            <div className="font-bold text-white text-base sm:text-lg">{request.username}</div>
                                            <div className="text-white/70 text-sm">{request.email}</div>
                                            <div className="text-white/50 text-xs mt-1">ID: {request.userId}</div>
                                            <div className="text-xs mt-1 capitalize text-yellow-400">
                                                {request.requestType === "withdraw" ? "Retiro" : "Recarga"}
                                            </div>
                                            <div className={`text-xs mt-1 ${
                                                request.status === "pending" ? "text-yellow-400" :
                                                    request.status === "approved" ? "text-green-400" : "text-red-400"
                                            }`}>
                                                Estado: {request.status?.toUpperCase()}
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-white font-bold text-lg">${request.amountUSD} USD</div>
                                            <div className="text-white/70 text-sm">Bs. {request.amountBS?.toLocaleString()}</div>
                                            <div className="text-white/50 text-xs mt-1 capitalize">{request.method}</div>
                                        </div>
                                        <div>
                                            {request.requestType === "recharge" ? (
                                                <>
                                                    <div className="text-white text-sm">Ref: {request.reference}</div>
                                                    <div className="text-white/70 text-sm">{request.date}</div>
                                                    <div className="text-white/50 text-xs">{request.bank}</div>
                                                </>
                                            ) : (
                                                <>
                                                    <div className="text-white text-sm">Banco: {request.bank}</div>
                                                    <div className="text-white/70 text-sm">Cédula: {request.cedula}</div>
                                                    <div className="text-white/50 text-xs">Teléfono: {request.phone}</div>
                                                </>
                                            )}
                                        </div>
                                        <div>
                                            <div className="text-white/70 text-sm">Solicitado:</div>
                                            <div className="text-white text-sm">
                                                {request.createdAt?.toDate?.()?.toLocaleDateString() || request.fecha || 'Fecha no disponible'}
                                            </div>
                                        </div>
                                        <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-3 w-full">
                                            {request.status === "pending" ? (
                                                <>
                                                    <button
                                                        onClick={() => handleRequestAction(request.id, "approved")}
                                                        className="bg-green-600 hover:bg-green-500 text-white font-semibold px-4 py-2 sm:px-6 sm:py-3 rounded-lg transition-all duration-300 transform hover:scale-105 flex-1"
                                                    >
                                                        ✅ Aprobar
                                                    </button>
                                                    <button
                                                        onClick={() => handleRequestAction(request.id, "rejected")}
                                                        className="bg-red-600 hover:bg-red-500 text-white font-semibold px-4 py-2 sm:px-6 sm:py-3 rounded-lg transition-all duration-300 transform hover:scale-105 flex-1"
                                                    >
                                                        ❌ Rechazar
                                                    </button>
                                                </>
                                            ) : (
                                                <span className={`px-4 py-2 rounded-full text-sm font-semibold w-full text-center ${
                                                    request.status === "approved"
                                                        ? "bg-green-500/20 text-green-300 border border-green-500/30"
                                                        : "bg-red-500/20 text-red-300 border border-red-500/30"
                                                }`}>
                                                    {request.status === "approved" ? "APROBADO" : "RECHAZADO"}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

{/* PESTAÑA: CONFIGURACIÓN GENERAL */}
{activeTab === "settings" && (
    <div>
        <h3 className="text-2xl font-bold text-white mb-6">⚙️ Configuración General</h3>
        <div className="bg-white/10 rounded-xl p-6 mb-8 border border-white/20 max-w-md mx-auto">
            <div className="mb-4">
                <label className="block text-white/80 font-semibold mb-2">
                    Tasa del dólar (BCV)
                </label>
                <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={exchangeRate}
                    onChange={e => setExchangeRate(Number(e.target.value))}
                    className="w-full p-3 rounded-lg bg-white/20 border border-purple-500/30 text-white text-lg focus:outline-none"
                />
                <div className="text-xs text-white/50 mt-2">
                    Ejemplo: 36.50 (actualiza la tasa para todas las operaciones)
                </div>
            </div>
            <button
                onClick={handleSaveExchangeRate}
                className="bg-purple-600 hover:bg-purple-500 text-white font-bold py-3 px-6 rounded-xl transition-all duration-300 mt-4 w-full"
            >
                💾 Guardar Tasa
            </button>
        </div>
    </div>
)}

{/* PESTAÑA: HISTORIAL */}
{activeTab === "history" && (
    <div>
        <h3 className="text-2xl font-bold text-white mb-6">📊 Historial de Solicitudes</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            <div className="bg-white/10 rounded-lg p-4 text-center">
                <div className="text-2xl font-bold text-white">{allRequests.length}</div>
                <div className="text-white/70 text-sm">Total</div>
            </div>
            <div className="bg-yellow-500/20 rounded-lg p-4 text-center border border-yellow-500/30">
                <div className="text-2xl font-bold text-yellow-400">{allRequests.filter(r => r.status === 'pending').length}</div>
                <div className="text-yellow-400/70 text-sm">Pendientes</div>
            </div>
            <div className="bg-green-500/20 rounded-lg p-4 text-center border border-green-500/30">
                <div className="text-2xl font-bold text-green-400">{allRequests.filter(r => r.status === 'approved').length}</div>
                <div className="text-green-400/70 text-sm">Aprobadas</div>
            </div>
            <div className="bg-red-500/20 rounded-lg p-4 text-center border border-red-500/30">
                <div className="text-2xl font-bold text-red-400">{allRequests.filter(r => r.status === 'rejected').length}</div>
                <div className="text-red-400/70 text-sm">Rechazadas</div>
            </div>
        </div>
        <div className="mb-6 flex flex-wrap gap-2">
            {["all", "pending", "approved", "rejected"].map((filter) => (
                <button
                    key={filter}
                    onClick={() => setHistoryFilter(filter)}
                    className={`px-4 py-2 rounded-lg font-semibold transition-all ${
                        historyFilter === filter
                            ? "bg-purple-500 text-white"
                            : "bg-white/10 text-white hover:bg-white/20"
                    }`}
                >
                    {filter === "all" ? "📋 Todas" :
                        filter === "pending" ? "⏳ Pendientes" :
                            filter === "approved" ? "✅ Aprobadas" : "❌ Rechazadas"}
                    <span className="ml-2 text-xs opacity-70">
                        ({filter === "all" ? allRequests.length : allRequests.filter(r => r.status === filter).length})
                    </span>
                </button>
            ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* RECARGAS */}
            <div>
                <h4 className="text-xl font-bold text-green-300 mb-4 flex items-center gap-2">
                    💳 Recargas ({rechargeHistory.length})
                </h4>
                <input
                    type="text"
                    placeholder="Buscar recarga por usuario, email, referencia, banco..."
                    value={rechargeSearch}
                    onChange={e => setRechargeSearch(e.target.value)}
                    className="w-full mb-2 p-2 rounded bg-white/10 border border-green-500/30 text-white text-sm focus:outline-none"
                />
                <div className="max-h-[400px] sm:max-h-[600px] overflow-y-auto scrollbar-thin scrollbar-thumb-green-500/30 scrollbar-track-transparent">
                    {rechargeHistory.length === 0 ? (
                        <div className="text-center py-8 text-white/60">No hay recargas para este filtro</div>
                    ) : (
                        <div className="space-y-3">
                            {rechargeHistory.map(request => (
                                <button
                                    key={request.id}
                                    className={`w-full text-left bg-white/5 hover:bg-green-500/10 border border-green-500/20 rounded-xl p-4 transition-all shadow-sm`}
                                    onClick={() => setSelectedRequest(request)}
                                >
                                    <div className="flex justify-between items-center flex-wrap gap-2">
                                        <div>
                                            <div className="font-bold text-white">{request.username}</div>
                                            <div className="text-white/70 text-xs">{request.email}</div>
                                            <div className="text-xs text-green-400 mt-1">Recarga</div>
                                        </div>
                                        <div className="text-right">
                                            <div className="font-bold text-green-300 text-lg">${request.amountUSD} USD</div>
                                            <div className="text-white/70 text-xs">Bs. {request.amountBS?.toLocaleString()}</div>
                                            <div className="text-xs text-white/50">{request.method}</div>
                                        </div>
                                    </div>
                                    <div className="flex justify-between items-center mt-2 flex-wrap gap-2">
                                        <div className="text-xs text-white/60">Ref: {request.reference}</div>
                                        <div className="text-xs text-white/60">{request.createdAt?.toDate?.()?.toLocaleDateString() || request.fecha}</div>
                                        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                                            request.status === "approved"
                                                ? "bg-green-500/20 text-green-300 border border-green-500/30"
                                                : request.status === "rejected"
                                                    ? "bg-red-500/20 text-red-300 border border-red-500/30"
                                                    : "bg-yellow-500/20 text-yellow-300 border border-yellow-500/30"
                                        }`}>
                                            {request.status === "approved" ? "APROBADA" :
                                                request.status === "rejected" ? "RECHAZADA" : "PENDIENTE"}
                                        </span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
            {/* RETIROS */}
            <div>
                <h4 className="text-xl font-bold text-yellow-300 mb-4 flex items-center gap-2">
                    🏧 Retiros ({withdrawHistory.length})
                </h4>
                <input
                    type="text"
                    placeholder="Buscar retiro por usuario, email, banco, cédula..."
                    value={withdrawSearch}
                    onChange={e => setWithdrawSearch(e.target.value)}
                    className="w-full mb-2 p-2 rounded bg-white/10 border border-yellow-500/30 text-white text-sm focus:outline-none"
                />
                <div className="max-h-[400px] sm:max-h-[600px] overflow-y-auto scrollbar-thin scrollbar-thumb-yellow-500/30 scrollbar-track-transparent">
                    {withdrawHistory.length === 0 ? (
                        <div className="text-center py-8 text-white/60">No hay retiros para este filtro</div>
                    ) : (
                        <div className="space-y-3">
                            {withdrawHistory.map(request => (
                                <button
                                    key={request.id}
                                    className={`w-full text-left bg-white/5 hover:bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-4 transition-all shadow-sm`}
                                    onClick={() => setSelectedRequest(request)}
                                >
                                    <div className="flex justify-between items-center flex-wrap gap-2">
                                        <div>
                                            <div className="font-bold text-white">{request.username}</div>
                                            <div className="text-white/70 text-xs">{request.email}</div>
                                            <div className="text-xs text-yellow-400 mt-1">Retiro</div>
                                        </div>
                                        <div className="text-right">
                                            <div className="font-bold text-yellow-300 text-lg">${request.amountUSD} USD</div>
                                            <div className="text-white/70 text-xs">Bs. {request.amountBS?.toLocaleString()}</div>
                                            <div className="text-xs text-white/50">{request.method}</div>
                                        </div>
                                    </div>
                                    <div className="flex justify-between items-center mt-2 flex-wrap gap-2">
                                        <div className="text-xs text-white/60">Banco: {request.bank}</div>
                                        <div className="text-xs text-white/60">{request.createdAt?.toDate?.()?.toLocaleDateString() || request.fecha}</div>
                                        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                                            request.status === "approved"
                                                ? "bg-green-500/20 text-green-300 border border-green-500/30"
                                                : request.status === "rejected"
                                                    ? "bg-red-500/20 text-red-300 border border-red-500/30"
                                                    : "bg-yellow-500/20 text-yellow-300 border border-yellow-500/30"
                                        }`}>
                                            {request.status === "approved" ? "APROBADA" :
                                                request.status === "rejected" ? "RECHAZADA" : "PENDIENTE"}
                                        </span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
        {/* MODAL DE DETALLE */}
        {selectedRequest && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
                <div className="bg-gray-900 rounded-2xl p-8 max-w-lg w-full border-2 border-purple-500 shadow-2xl relative">
                    <button
                        className="absolute top-4 right-4 text-white text-2xl hover:text-red-400"
                        onClick={() => setSelectedRequest(null)}
                    >×</button>
                    <h3 className="text-2xl font-bold mb-4 text-purple-300">
                        {selectedRequest.requestType === "withdraw" ? "🏧 Detalle de Retiro" : "💳 Detalle de Recarga"}
                    </h3>
                    <div className="space-y-2 text-white">
                        <div><b>Usuario:</b> {selectedRequest.username}</div>
                        <div><b>Email:</b> {selectedRequest.email}</div>
                        <div><b>ID Usuario:</b> {selectedRequest.userId}</div>
                        <div><b>Estado:</b> <span className={
                            selectedRequest.status === "approved" ? "text-green-400" :
                            selectedRequest.status === "rejected" ? "text-red-400" : "text-yellow-400"
                        }>
                            {selectedRequest.status.toUpperCase()}
                        </span></div>
                        <div><b>Fecha Solicitud:</b> {selectedRequest.createdAt?.toDate?.()?.toLocaleString() || selectedRequest.fecha}</div>
                        {selectedRequest.processedAt && (
                            <div><b>Procesado:</b> {selectedRequest.processedAt?.toDate?.()?.toLocaleString()}</div>
                        )}
                        {selectedRequest.processedBy && (
                            <div><b>Procesado por:</b> {selectedRequest.processedBy}</div>
                        )}
                        <div><b>Monto:</b> ${selectedRequest.amountUSD} USD / Bs. {selectedRequest.amountBS?.toLocaleString()}</div>
                        <div><b>Método:</b> {selectedRequest.method}</div>
                        {selectedRequest.requestType === "recharge" ? (
                            <>
                                <div><b>Referencia:</b> {selectedRequest.reference}</div>
                                <div><b>Banco:</b> {selectedRequest.bank}</div>
                            </>
                        ) : (
                            <>
                                <div><b>Banco:</b> {selectedRequest.bank}</div>
                                <div><b>Cédula:</b> {selectedRequest.cedula}</div>
                                <div><b>Teléfono:</b> {selectedRequest.phone}</div>
                                <div><b>Nombre:</b> {selectedRequest.nombre}</div>
                                <div><b>Tipo de Cuenta:</b> {selectedRequest.accountType}</div>
                                <div><b>Número de Cuenta:</b> {selectedRequest.accountNumber}</div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        )}
    </div>
)}

                        {/* PESTAÑA: SOPORTE */}
                        {activeTab === "support" && (
                            <div className="bg-gradient-to-br from-green-900/20 to-emerald-800/20 rounded-2xl p-8 backdrop-blur-lg border border-green-500/30">
                                <div className="text-center py-8">
                                    <div className="text-6xl mb-6">🎫</div>
                                    <h3 className="text-3xl font-bold text-white mb-4">Panel de Soporte Administrativo</h3>
                                    <p className="text-white/80 text-lg mb-6 max-w-2xl mx-auto">
                                        Gestiona todos los <b>tickets de soporte</b> de los usuarios. Revisa, responde y resuelve
                                        consultas técnicas, problemas de pagos y solicitudes de asistencia.
                                    </p>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                                        <div className="bg-white/10 rounded-xl p-4 border border-white/20">
                                            <div className="text-2xl mb-2">📊</div>
                                            <h4 className="font-bold text-white mb-2">Estadísticas en Tiempo Real</h4>
                                            <p className="text-white/70 text-sm">Monitorea tickets abiertos, pendientes y resueltos</p>
                                        </div>
                                        <div className="bg-white/10 rounded-xl p-4 border border-white/20">
                                            <div className="text-2xl mb-2">💬</div>
                                            <h4 className="font-bold text-white mb-2">Chat en Directo</h4>
                                            <p className="text-white/70 text-sm">Comunícate directamente con los usuarios</p>
                                        </div>
                                        <div className="bg-white/10 rounded-xl p-4 border border-white/20">
                                            <div className="text-2xl mb-2">⚡</div>
                                            <h4 className="font-bold text-white mb-2">Respuesta Rápida</h4>
                                            <p className="text-white/70 text-sm">Plantillas y respuestas predefinidas</p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => navigate("/admin/support")}
                                        className="bg-gradient-to-r from-green-600 to-emerald-500 hover:from-green-500 hover:to-emerald-400 text-white font-bold py-4 px-8 rounded-xl transition-all duration-300 transform hover:scale-105 text-lg shadow-lg"
                                    >
                                        🚀 Ir al Panel Completo de Soporte
                                    </button>
                                    <div className="mt-6 text-white/60 text-sm">
                                        <p>Acceso completo al sistema de gestión de tickets de soporte</p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
                
                {activeTab === "users" && (
                    
                            <div>
                                <h3 className="text-2xl font-bold text-white mb-6">👥 Gestión de Usuarios</h3>
                                <div className="mb-6 flex flex-col gap-4">
                                    <input
                                        type="text"
                                        placeholder="🔍 Buscar por nombre, correo o teléfono..."
                                        value={userSearch}
                                        onChange={(e) => setUserSearch(e.target.value)}
                                        className="w-full p-4 rounded-xl bg-white/10 border-2 border-white/20 text-white text-lg focus:outline-none focus:border-purple-500 transition-all"
                                    />
                                    {/* Botón para eliminar todos los transactions */}
                                    <button
                                        onClick={() => setShowDeleteModal(true)}
                                        className="bg-red-600 hover:bg-red-500 text-white font-bold py-3 px-6 rounded-xl transition-all duration-300 w-full"
                                    >
                                        🗑️ Eliminar TODOS los registros de transactions
                                    </button>
                                </div>
                                <div className="overflow-x-auto max-h-96">
                                    <table className="min-w-full bg-transparent text-white">
                                        <thead className="bg-white/10 sticky top-0">
                                            <tr>
                                                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Usuario</th>
                                                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Correo / Teléfono</th>
                                                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Rol</th>
                                                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Saldo (Bs)</th>
                                                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider">Estado</th>
                                                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider">Acciones</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredUsers.map(user => (
                                                <tr key={user.id} className="border-b border-white/10 hover:bg-white/5 transition">
                                                    <td className="px-4 py-3 font-medium">{user.username}</td>
                                                    <td className="px-4 py-3 text-white/80">
                                                        <div>{user.email}</div>
                                                        <div className="text-xs text-white/50">{user.phone}</div>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <select
                                                            value={user.role || 'user'}
                                                            onChange={(e) => handleUserRoleChange(user.id, e.target.value)}
                                                            className="bg-white/20 border border-white/30 rounded px-2 py-1 text-sm focus:outline-none"
                                                        >
                                                            {ROLES.map(r => (
                                                                <option key={r.id} value={r.id} className="bg-gray-800">
                                                                    {r.name}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <input
                                                            type="number"
                                                            defaultValue={user.balance || 0}
                                                            onBlur={async (e) => {
                                                                const newBalance = Number(e.target.value);
                                                                const ok = await setUserBalance(user.id, newBalance);
                                                                if (ok) {
                                                                    setUsers(users.map(u => u.id === user.id ? { ...u, balance: newBalance } : u));
                                                                    alert("Saldo actualizado");
                                                                } else {
                                                                    alert("Error al actualizar saldo");
                                                                }
                                                            }}
                                                            className="w-24 p-1 rounded bg-white/20 text-sm focus:outline-none focus:ring-1 ring-purple-500"
                                                        />
                                                    </td>
                                                    <td className="px-4 py-3 text-center">
                                                        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${user.suspended ? "bg-red-500/30 text-red-300" : "bg-green-500/30 text-green-300"}`}>
                                                            {user.suspended ? "Suspendido" : "Activo"}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-center space-x-2">
                                                        <button
                                                            onClick={() => handleToggleSuspension(user.id, user.suspended)}
                                                            className={`px-2 py-1 rounded text-xs font-semibold transition ${user.suspended ? "bg-green-600 hover:bg-green-500" : "bg-yellow-600 hover:bg-yellow-500"}`}
                                                        >
                                                            {user.suspended ? "Reactivar" : "Suspender"}
                                                        </button>
                                                        <button
                                                            onClick={() => handleDeleteUser(user.id)}
                                                            className="px-2 py-1 bg-red-600 hover:bg-red-500 rounded text-xs font-semibold transition"
                                                        >
                                                            Eliminar
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                            {filteredUsers.length === 0 && (
                                                <tr>
                                                    <td colSpan="6" className="px-4 py-6 text-center text-white/60 text-sm">
                                                        No hay usuarios que coincidan con la búsqueda
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
            </main>

<style>{`
    .panel-content:empty {
        display: none !important;
    }
`}</style>

            <div className="absolute top-20 left-10 w-32 h-32 bg-red-500/10 rounded-full blur-xl"></div>
            <div className="absolute bottom-20 right-10 w-48 h-48 bg-purple-500/10 rounded-full blur-2xl"></div>
            <style>{`
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


export default AdminPanel;