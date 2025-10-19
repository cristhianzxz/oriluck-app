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
    getAllUsers,
    setUserBalance,
    deleteUserFromFirestore,
    suspendUser,
    updateUserRole,
    logAdminMovement,
    logUserBalanceChange,
    updateSlotsExchangeRate
} from "./firestoreService";
import { doc, onSnapshot, updateDoc, getDocs, collection, deleteDoc, query, where } from "firebase/firestore";
import { db } from "./firebase";
import { writeBatch } from "firebase/firestore";

const ROLES = [
    { id: 'user', name: 'Usuario' },
    { id: 'support_agent', name: 'Agente de Soporte' },
    { id: 'moderator', name: 'Moderador' },
    { id: 'supervisor', name: 'Supervisor' },
    { id: 'admin', name: 'Administrador' }
];

const USERS_PASSWORD = import.meta.env.VITE_USERS_PASSWORD;
const OWNER_PASSWORD = import.meta.env.VITE_OWNER_PASSWORD;

const AdminPanel = () => {
    const navigate = useNavigate();
    const { currentUser, userData } = useContext(AuthContext);

    const [activeTab, setActiveTab] = useState("");
    const [exchangeRate, setExchangeRate] = useState(100);
    const [originalExchangeRate, setOriginalExchangeRate] = useState(100);
    const [requests, setRequests] = useState([]);
    const [users, setUsers] = useState([]);
    const [allRequests, setAllRequests] = useState([]);
    const [historyFilter, setHistoryFilter] = useState("all");
    const [isUsersSectionUnlocked, setIsUsersSectionUnlocked] = useState(false);
    const [userSearch, setUserSearch] = useState("");
    const [selectedRequest, setSelectedRequest] = useState(null);
    const [newRequestNotification, setNewRequestNotification] = useState(false);
    const [rechargeSearch, setRechargeSearch] = useState("");
    const [withdrawSearch, setWithdrawSearch] = useState("");
    const [showPasswordModal, setShowPasswordModal] = useState(false);
    const [passwordInput, setPasswordInput] = useState("");
    const [passwordError, setPasswordError] = useState("");
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [deleteLoading, setDeleteLoading] = useState(false);
    const [showOwnerModal, setShowOwnerModal] = useState(false);
    const [ownerPasswordInput, setOwnerPasswordInput] = useState("");
    const [ownerPasswordError, setOwnerPasswordError] = useState("");

    const [verifyingAccess, setVerifyingAccess] = useState(true);
    const [permissions, setPermissions] = useState({});

    const handleOwnerAccess = () => {
        if (ownerPasswordInput === OWNER_PASSWORD) {
            localStorage.setItem('ownerAccess', 'true');
            setShowOwnerModal(false);
            setOwnerPasswordInput("");
            setOwnerPasswordError("");
            window.location.href = '/owner-panel';
        } else {
            setOwnerPasswordError("❌ Contraseña incorrecta.");
        }
    };

    useEffect(() => {
        if (userData === undefined) {
            setVerifyingAccess(true);
            return;
        }

        if (!userData || !userData.role) {
            navigate("/lobby", { replace: true });
            return;
        }

        const role = userData.role;
        
        const userPermissions = {
            canViewPanel: ['support_agent', 'moderator', 'supervisor', 'admin', 'owner'].includes(role),
            canViewRechargesTab: ['supervisor', 'admin', 'owner'].includes(role),
            canViewHistoryTab: ['supervisor', 'admin', 'owner'].includes(role),
            canViewSettingsTab: ['moderator', 'supervisor', 'admin', 'owner'].includes(role),
            canViewUsersTab: ['moderator', 'supervisor', 'admin', 'owner'].includes(role),
            canViewSupportTab: ['support_agent', 'moderator', 'supervisor', 'admin', 'owner'].includes(role),
            canAccessOwnerZone: ['admin', 'owner'].includes(role),
            canApprovePayments: ['supervisor', 'admin', 'owner'].includes(role),
            canSuspendUsers: ['moderator', 'supervisor', 'admin', 'owner'].includes(role),
            canEditBalances: ['admin', 'owner'].includes(role),
            canEditRoles: ['admin', 'owner'].includes(role),
            canDeleteUsers: ['admin', 'owner'].includes(role)
        };
        
        setPermissions(userPermissions);

        if (!userPermissions.canViewPanel) {
            navigate("/lobby", { replace: true });
        } else {
            if (role === 'support_agent') setActiveTab("support");
            else if (role === 'moderator') setActiveTab("users");
            else if (role === 'supervisor') setActiveTab("recharges");
            else setActiveTab("recharges");

            loadData();
            setVerifyingAccess(false);
        }
    }, [userData, navigate]);

    useEffect(() => {
        if (!permissions.canViewRechargesTab) return;

        const qRecharge = query(collection(db, "rechargeRequests"), where("status", "==", "pending"));
        const unsubRecharge = onSnapshot(qRecharge, (snap) => {
            const rechargeReqs = snap.docs.map(doc => ({ id: doc.id, ...doc.data(), requestType: "recharge" }));
            
            setRequests(currentRequests => {
                const otherRequests = currentRequests.filter(r => r.requestType !== "recharge");
                return [...otherRequests, ...rechargeReqs];
            });
        });

        const qWithdraw = query(collection(db, "withdrawRequests"), where("status", "==", "pending"));
        const unsubWithdraw = onSnapshot(qWithdraw, (snap) => {
            const withdrawReqs = snap.docs.map(doc => ({ id: doc.id, ...doc.data(), requestType: "withdraw" }));

            setRequests(currentRequests => {
                const otherRequests = currentRequests.filter(r => r.requestType !== "withdraw");
                return [...otherRequests, ...withdrawReqs];
            });
        });

        return () => {
            unsubRecharge();
            unsubWithdraw();
        };
    }, [permissions.canViewRechargesTab]);


    useEffect(() => {
        if (!permissions.canViewRechargesTab) return;

        const setupListener = (collectionName) => {
            const q = query(collection(db, collectionName), where("status", "==", "pending"));
            return onSnapshot(q, (snap) => {
                if (snap.docChanges().some(change => change.type === "added")) {
                    setNewRequestNotification(true);
                    const audio = new window.Audio("/notification.mp3");
                    audio.play().catch(() => {});
                    setTimeout(() => setNewRequestNotification(false), 3000);
                }
            });
        };
        const unsubRecharge = setupListener("rechargeRequests");
        const unsubWithdraw = setupListener("withdrawRequests");
        return () => {
            unsubRecharge();
            unsubWithdraw();
        };
    }, [permissions.canViewRechargesTab]);

    const loadData = async () => {
        try {
            const [
                rechargeReqs,
                withdrawReqs,
                allRechargeRequests,
                allWithdrawRequests,
                rate,
                usersList
            ] = await Promise.all([
                getPendingRechargeRequests(),
                getPendingWithdrawRequests(),
                getAllRechargeRequests(),
                getAllWithdrawRequests(),
                getExchangeRate(),
                getAllUsers()
            ]);

            const requestsWithType = [
                ...rechargeReqs.map(r => ({ ...r, requestType: "recharge" })),
                ...withdrawReqs.map(r => ({ ...r, requestType: "withdraw" }))
            ];
            setRequests(requestsWithType);

            const allRequestsWithType = [
                ...allRechargeRequests.map(r => ({ ...r, requestType: "recharge" })),
                ...allWithdrawRequests.map(r => ({ ...r, requestType: "withdraw" }))
            ];
            setAllRequests(allRequestsWithType);

            setExchangeRate(rate);
            setOriginalExchangeRate(rate);

            setUsers(usersList.map(u => ({
                ...u,
                id: u.id,
                role: u.role || 'user',
                suspended: !!u.suspended,
                active: !!u.active,
                lastActive: u.lastActive
            })));

        } catch (error) {
            console.error("❌ Error cargando datos del panel:", error);
        }
    };


    const handleRequestAction = async (requestId, action) => {
        if (!permissions.canApprovePayments) {
            alert("❌ No tienes permiso para aprobar o rechazar pagos.");
            return;
        }
        try {
            const request = requests.find(req => req.id === requestId);
            if (!request) return;

            const adminEmail = currentUser?.email || 'Admin Desconocido';

            const q = query(
                collection(db, "transactions"),
                where("requestId", "==", request.id),
                where("status", "==", "pending")
            );
            const snapshot = await getDocs(q);
            for (const pendingDoc of snapshot.docs) {
                await deleteDoc(doc(db, "transactions", pendingDoc.id));
            }

            if (request.requestType === "recharge") {
                if (action === "approved") {
                    await createTransaction({
                        userId: request.userId,
                        username: request.username,
                        type: "recharge",
                        amount: request.amountBS,
                        description: `Recarga aprobada - ${request.amountUSD} USD`,
                        status: "approved",
                        requestId: request.id,
                        admin: adminEmail,
                        method: request.method,
                        reference: request.reference
                    });
                    const success = await updateUserBalance(request.userId, request.amountBS);
                    if (!success) { alert("❌ Error al actualizar el saldo"); return; }
                    await updateRechargeRequest(request.id, "approved", adminEmail);
                    await logAdminMovement({
                        actionType: "aprobar_recarga",
                        adminData: {
                            id: currentUser?.uid || '',
                            name: userData?.username || '',
                            email: currentUser?.email || '',
                            role: userData?.role || ''
                        },
                        targetId: request.id,
                        targetType: "solicitud_recarga",
                        details: {
                            usuario: request.username,
                            userId: request.userId,
                            monto: request.amountBS,
                            ...(request.reference && { referencia: request.reference })
                        },
                        description: `Aprobó recarga de ${request.amountBS} Bs para ${request.username} (${request.email})`
                    });
                    alert(`✅ Recarga de $${request.amountUSD} USD aprobada para ${request.username}`);
                } else {
                    await createTransaction({
                        userId: request.userId,
                        username: request.username,
                        type: "recharge",
                        amount: request.amountBS,
                        description: `Recarga rechazada - ${request.amountUSD} USD`,
                        status: "rejected",
                        requestId: request.id,
                        admin: adminEmail,
                        method: request.method,
                        reference: request.reference
                    });
                    await updateRechargeRequest(request.id, "rejected", adminEmail);
                    await logAdminMovement({
                        actionType: "rechazar_recarga",
                        adminData: {
                            id: currentUser?.uid || '',
                            name: userData?.username || '',
                            email: currentUser?.email || '',
                            role: userData?.role || ''
                        },
                        targetId: request.id,
                        targetType: "solicitud_recarga",
                        details: {
                            usuario: request.username,
                            userId: request.userId,
                            monto: request.amountBS,
                            ...(request.reference && { referencia: request.reference })
                        },
                        description: `Rechazó recarga de ${request.amountBS} Bs para ${request.username} (${request.email})`
                    });
                    alert(`❌ Solicitud de recarga rechazada`);
                }
            }

            if (request.requestType === "withdraw") {
                if (action === "approved") {
                    await createTransaction({
                        userId: request.userId,
                        username: request.username,
                        type: "withdraw",
                        amount: request.amountBS,
                        description: `Retiro aprobado - ${request.amountUSD} USD`,
                        status: "approved",
                        requestId: request.id,
                        admin: adminEmail,
                        method: request.method
                    });
                    const success = await updateUserBalance(request.userId, -Math.abs(request.amountBS));
                    if (!success) {
                        alert("❌ Error al descontar el saldo del usuario");
                        return;
                    }
                    await updateWithdrawRequest(request.id, "approved", adminEmail);
                    alert(`✅ Retiro de $${request.amountUSD} USD aprobado para ${request.username}`);
                    await logAdminMovement({
                        actionType: "aprobar_retiro",
                        adminData: {
                            id: currentUser?.uid || '',
                            name: userData?.username || '',
                            email: currentUser?.email || '',
                            role: userData?.role || ''
                        },
                        targetId: request.id,
                        targetType: "solicitud_retiro",
                        details: {
                            usuario: request.username,
                            userId: request.userId,
                            monto: request.amountBS,
                            ...(request.reference && { referencia: request.reference })
                        },
                        description: `Aprobó retiro de ${request.amountBS} Bs para ${request.username} (${request.email})`
                    });
                } else {
                    await createTransaction({
                        userId: request.userId,
                        username: request.username,
                        type: "withdraw",
                        amount: request.amountBS,
                        description: `Retiro rechazado - ${request.amountUSD} USD`,
                        status: "rejected",
                        requestId: request.id,
                        admin: adminEmail,
                        method: request.method
                    });
                    await updateWithdrawRequest(request.id, "rejected", adminEmail);
                    await logAdminMovement({
                        actionType: "rechazar_retiro",
                        adminData: {
                            id: currentUser?.uid || '',
                            name: userData?.username || '',
                            email: currentUser?.email || '',
                            role: userData?.role || ''
                        },
                        targetId: request.id,
                        targetType: "solicitud_retiro",
                        details: {
                            usuario: request.username,
                            userId: request.userId,
                            monto: request.amountBS,
                            ...(request.reference && { referencia: request.reference })
                        },
                        description: `Rechazó retiro de ${request.amountBS} Bs para ${request.username} (${request.email})`
                    });
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
            const oldRate = originalExchangeRate;
            await updateExchangeRate(exchangeRate);

            const q = query(
                collection(db, 'bingoTournaments'),
                where('status', 'in', ['waiting', 'active'])
            );
            const snapshot = await getDocs(q);
            const batch = writeBatch(db);
            snapshot.forEach(docSnap => {
                batch.update(doc(db, 'bingoTournaments', docSnap.id), {
                    pricePerCard: exchangeRate
                });
            });
            await batch.commit();

            await updateSlotsExchangeRate(exchangeRate);

            await logAdminMovement({
                actionType: "cambiar_tasa_cambio",
                adminData: {
                    id: currentUser?.uid || '',
                    name: userData?.username || '',
                    email: currentUser?.email || '',
                    role: userData?.role || ''
                },
                targetType: "configuracion_general",
                details: {
                    valorAnterior: oldRate,
                    valorNuevo: exchangeRate
                },
                description: `Cambió la tasa de ${oldRate} Bs a ${exchangeRate} Bs y actualizó la configuración de slots`
            });

            setOriginalExchangeRate(exchangeRate);

            alert("✅ Tasa de cambio general actualizada correctamente (y aplicada a torneos de bingo y configuración de slots)");
        } catch (error) {
            console.error("❌ Error actualizando tasa:", error);
            alert("❌ Error al actualizar la tasa general y de slots");
        }
    };

    const handleUserRoleChange = async (userId, newRole) => {
        if (!permissions.canEditRoles) {
            alert("❌ No tienes permiso para cambiar roles.");
            return;
        }
        const userToChange = users.find(u => u.id === userId);
        if (!userToChange) return;

        const roleName = ROLES.find(r => r.id === newRole)?.name || newRole;
        if (!window.confirm(`¿Cambiar rol de "${userToChange.username || userToChange.email}" a "${roleName}"?`)) return;

        const oldRole = userToChange.role;
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

            await logAdminMovement({
                actionType: "cambiar_rol_usuario",
                adminData: {
                    id: currentUser?.uid || '',
                    name: userData?.username || '',
                    email: currentUser?.email || '',
                    role: userData?.role || ''
                },
                targetId: userId,
                targetType: "usuario",
                details: {
                    usuario: userToChange.username || userToChange.email,
                    rolAnterior: oldRole,
                    rolNuevo: newRole
                },
                description: `Cambió el rol de "${userToChange.username || userToChange.email}" de "${oldRole}" a "${newRole}"`
            });

            alert("Rol actualizado");
        } catch (e) {
            console.error("Error actualizando rol", e);
            alert("Error actualizando rol");
        }
    };

    const handleToggleSuspension = async (userId, isSuspended) => {
        if (!permissions.canSuspendUsers) {
            alert("❌ No tienes permiso para suspender o reactivar usuarios.");
            return;
        }
        const userToChange = users.find(u => u.id === userId);
        if (!userToChange) return;

        const action = isSuspended ? "Reactivar" : "Suspender";
        if (!window.confirm(`¿Está seguro de ${action.toLowerCase()} al usuario "${userToChange.username || userToChange.email}"?`)) return;

        try {
            const ok = await suspendUser(userId, !isSuspended);
            if (ok) {
                setUsers(users.map(u => u.id === userId ? { ...u, suspended: !isSuspended } : u));

                await logAdminMovement({
                    actionType: isSuspended ? "reactivar_usuario" : "suspender_usuario",
                    adminData: {
                        id: currentUser?.uid || '',
                        name: userData?.username || '',
                        email: currentUser?.email || '',
                        role: userData?.role || ''
                    },
                    targetId: userId,
                    targetType: "usuario",
                    details: {
                        usuario: userToChange.username || userToChange.email,
                        estado: isSuspended ? "reactivado" : "suspendido"
                    },
                    description: `${action} al usuario "${userToChange.username || userToChange.email}"`
                });

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
        if (!permissions.canDeleteUsers) {
            alert("❌ No tienes permiso para eliminar usuarios.");
            return;
        }
        const userToChange = users.find(u => u.id === userId);
        if (!userToChange) return;

        if (!window.confirm(`⚠️ ADVERTENCIA: Esta acción es permanente. ¿Eliminar usuario "${userToChange.username || userToChange.email}" y sus datos?`)) return;

        try {
            const ok = await deleteUserFromFirestore(userId);
            if (ok) {
                setUsers(users.filter(u => u.id !== userId));

                await logAdminMovement({
                    actionType: "eliminar_usuario",
                    adminData: {
                        id: currentUser?.uid || '',
                        name: userData?.username || '',
                        email: currentUser?.email || '',
                        role: userData?.role || ''
                    },
                    targetId: userId,
                    targetType: "usuario",
                    details: {
                        usuario: userToChange.username || userToChange.email
                    },
                    description: `Eliminó permanentemente al usuario "${userToChange.username || userToChange.email}"`
                });

                alert("Usuario eliminado permanentemente.");
            } else {
                alert("Error al eliminar el usuario.");
            }
        } catch (e) {
            console.error("Error al eliminar usuario", e);
            alert("Error al eliminar usuario.");
        }
    };

    const handleDeleteAllTransactions = async () => {
        setDeleteLoading(true);
        try {
            const querySnapshot = await getDocs(collection(db, "transactions"));
            for (const document of querySnapshot.docs) {
                await deleteDoc(doc(db, "transactions", document.id));
            }
            await logAdminMovement({
                actionType: "eliminar_todas_transacciones",
                adminData: {
                    id: currentUser?.uid || '',
                    name: userData?.username || '',
                    email: currentUser?.email || '',
                    role: userData?.role || ''
                },
                targetType: "transacciones",
                details: {
                    totalEliminadas: querySnapshot.size
                },
                description: `Eliminó ${querySnapshot.size} registros de transacciones`
            });
            setDeleteLoading(false);
            setShowDeleteModal(false);
            alert("Todos los registros de transactions han sido eliminados.");
        } catch (error) {
            setDeleteLoading(false);
            setShowDeleteModal(false);
            alert("Error eliminando registros: " + error.message);
        }
    };

    const usersActive = users.filter(u =>
        !u.suspended &&
        u.active &&
        (
            u.lastActive && typeof u.lastActive === "object" && typeof u.lastActive.toMillis === "function"
                ? (Date.now() - u.lastActive.toMillis() < 10 * 60 * 1000)
                : true
        )
    );

    const filteredUsers = users.filter(u =>
        (u.username || "").toLowerCase().includes(userSearch.toLowerCase()) ||
        (u.email || "").toLowerCase().includes(userSearch.toLowerCase()) ||
        (u.phone || "").includes(userSearch)
    );

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


    if (verifyingAccess) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">
                <div className="text-xl animate-pulse">Verificando credenciales...</div>
            </div>
        );
    }

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
                                    {userData?.role && (
                                        <span className="ml-2 px-2 py-0.5 rounded bg-white/10 text-xs">
                                            {ROLES.find(r => r.id === userData?.role)?.name || userData?.role}
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

            <div className="flex flex-wrap sm:flex-row gap-2 sm:gap-4 mb-8 px-4 sm:px-6 pt-6">
                {permissions.canViewRechargesTab && (
                    <button
                        onClick={() => setActiveTab("recharges")}
                        className={`w-full sm:w-auto px-4 py-3 sm:px-8 sm:py-4 rounded-xl font-semibold text-base sm:text-lg transition-all duration-300 transform hover:scale-105 ${activeTab === "recharges" ? "bg-red-500 text-white shadow-lg shadow-red-500/30" : "bg-white/10 text-white hover:bg-white/20 border border-white/20"}`}
                    >
                        💳 Solicitudes
                    </button>
                )}
                {permissions.canViewHistoryTab && (
                    <button
                        onClick={() => setActiveTab("history")}
                        className={`w-full sm:w-auto px-4 py-3 sm:px-8 sm:py-4 rounded-xl font-semibold text-base sm:text-lg transition-all duration-300 transform hover:scale-105 ${activeTab === "history" ? "bg-red-500 text-white shadow-lg shadow-red-500/30" : "bg-white/10 text-white hover:bg-white/20 border border-white/20"}`}
                    >
                        📊 Historial
                    </button>
                )}
                {permissions.canViewSettingsTab && (
                    <button
                        onClick={() => setActiveTab("settings")}
                        className={`w-full sm:w-auto px-4 py-3 sm:px-8 sm:py-4 rounded-xl font-semibold text-base sm:text-lg transition-all duration-300 transform hover:scale-105 ${activeTab === "settings" ? "bg-red-500 text-white shadow-lg shadow-red-500/30" : "bg-white/10 text-white hover:bg-white/20 border border-white/20"}`}
                    >
                        ⚙️ Configuración
                    </button>
                )}
                {permissions.canViewUsersTab && (
                    <button
                        onClick={() => isUsersSectionUnlocked ? setActiveTab('users') : setShowPasswordModal(true)}
                        className={`w-full sm:w-auto px-4 py-3 sm:px-8 sm:py-4 rounded-xl font-semibold text-base sm:text-lg transition-all duration-300 transform hover:scale-105 ${activeTab === "users" ? "bg-red-500 text-white shadow-lg shadow-red-500/30" : "bg-white/10 text-white hover:bg-white/20 border border-white/20"}`}
                    >
                        👥 Usuarios
                    </button>
                )}
                {permissions.canViewSupportTab && (
                    <button
                        onClick={() => setActiveTab("support")}
                        className={`w-full sm:w-auto px-4 py-3 sm:px-8 sm:py-4 rounded-xl font-semibold text-base sm:text-lg transition-all duration-300 transform hover:scale-105 ${activeTab === "support" ? "bg-red-500 text-white shadow-lg shadow-red-500/30" : "bg-white/10 text-white hover:bg-white/20 border border-white/20"}`}
                    >
                        🎫 Soporte
                    </button>
                )}
                {permissions.canAccessOwnerZone && (
                    <button
                        onClick={() => setShowOwnerModal(true)}
                        className="w-full sm:w-auto px-4 py-3 sm:px-8 sm:py-4 rounded-xl font-semibold text-base sm:text-lg transition-all duration-300 transform hover:scale-105 bg-black/60 text-yellow-300 border border-yellow-500/30"
                    >
                        🦾 La Zona
                    </button>
                )}
            </div>

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
                            className="bg-purple-600 hover:bg-purple-500 text-white font-bold py-2 px-6 rounded-xl transition-all"
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

            {showOwnerModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
                    <div className="bg-gray-900 rounded-2xl p-8 max-w-xs w-full border-2 border-yellow-500 shadow-2xl relative">
                        <button
                            className="absolute top-4 right-4 text-white text-2xl hover:text-red-400"
                            onClick={() => {
                                setShowOwnerModal(false);
                                setOwnerPasswordInput("");
                                setOwnerPasswordError("");
                            }}
                        >×</button>
                        <h3 className="text-xl font-bold mb-4 text-yellow-300 text-center">🦾 Acceso a La Zona (Owner)</h3>
                        <label className="block text-white/80 mb-2 text-sm">Ingresa la contraseña:</label>
                        <input
                            type="password"
                            value={ownerPasswordInput}
                            onChange={e => setOwnerPasswordInput(e.target.value)}
                            className="w-full p-3 rounded-lg bg-white/20 border border-yellow-500/30 text-white text-lg focus:outline-none mb-2"
                            autoFocus
                        />
                        {ownerPasswordError && (
                            <div className="text-red-400 text-xs mb-2">{ownerPasswordError}</div>
                        )}
                        <button
                            className="bg-yellow-600 hover:bg-yellow-500 text-white font-bold py-2 px-6 rounded-xl transition-all duration-300 w-full"
                            onClick={handleOwnerAccess}
                        >
                            Acceder
                        </button>
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
                        
                        {activeTab === "recharges" && permissions.canViewRechargesTab && (
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

                        {activeTab === "settings" && permissions.canViewSettingsTab && (
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

                        {activeTab === "history" && permissions.canViewHistoryTab && (
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

                        {activeTab === "support" && permissions.canViewSupportTab && (
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

                        {activeTab === "users" && permissions.canViewUsersTab && (
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
                                                            disabled={!permissions.canEditRoles}
                                                            className={`bg-white/20 border border-white/30 rounded px-2 py-1 text-sm focus:outline-none ${!permissions.canEditRoles ? "cursor-not-allowed opacity-60" : ""}`}
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
                                                            readOnly={!permissions.canEditBalances}
                                                            onBlur={async (e) => {
                                                                if (!permissions.canEditBalances) return;
                                                                const newBalance = Number(e.target.value);
                                                                const oldBalance = user.balance || 0;
                                                                const difference = newBalance - oldBalance;
                                                                const ok = await setUserBalance(user.id, newBalance);
                                                                if (ok) {
                                                                    setUsers(users.map(u => u.id === user.id ? { ...u, balance: newBalance } : u));
                                                                    await createTransaction({
                                                                        userId: user.id,
                                                                        username: user.username || user.email,
                                                                        type: "admin_adjustment",
                                                                        amount: difference,
                                                                        description: `Ajuste administrativo: ${difference > 0 ? 'Sumó' : 'Restó'} ${Math.abs(difference)} Bs`,
                                                                        status: "completed",
                                                                        admin: currentUser?.email || "Admin Desconocido",
                                                                        balanceBefore: oldBalance,
                                                                        balanceAfter: newBalance
                                                                    });
                                                                    await logUserBalanceChange({
                                                                        adminData: {
                                                                            id: currentUser?.uid || '',
                                                                            name: userData?.username || '',
                                                                            email: currentUser?.email || '',
                                                                            role: userData?.role || ''
                                                                        },
                                                                        userId: user.id,
                                                                        userEmail: user.email,
                                                                        saldoAntes: oldBalance,
                                                                        saldoDespues: newBalance,
                                                                        monto: difference,
                                                                        motivo: "Cambio manual de saldo en panel de usuarios"
                                                                    });
                                                                    alert("Saldo actualizado");
                                                                } else {
                                                                    alert("Error al actualizar saldo");
                                                                }
                                                            }}
                                                            className={`w-24 p-1 rounded bg-white/20 text-sm focus:outline-none ${!permissions.canEditBalances ? "cursor-not-allowed opacity-60" : "focus:ring-1 ring-purple-500"}`}
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
                                                            disabled={!permissions.canSuspendUsers}
                                                            className={`px-2 py-1 rounded text-xs font-semibold transition ${user.suspended ? "bg-green-600 hover:bg-green-500" : "bg-yellow-600 hover:bg-yellow-500"} ${!permissions.canSuspendUsers ? "opacity-50 cursor-not-allowed" : ""}`}
                                                        >
                                                            {user.suspended ? "Reactivar" : "Suspender"}
                                                        </button>
                                                        <button
                                                            onClick={() => handleDeleteUser(user.id)}
                                                            disabled={!permissions.canDeleteUsers}
                                                            className={`px-2 py-1 bg-red-600 hover:bg-red-500 rounded text-xs font-semibold transition ${!permissions.canDeleteUsers ? "opacity-50 cursor-not-allowed" : ""}`}
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
                    </div>
                </div>
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