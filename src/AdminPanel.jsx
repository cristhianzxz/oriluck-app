import React, { useState, useEffect, useContext } from "react";
import { useNavigate } from "react-router-dom";
import { AuthContext } from "./App";
import { 
  getPendingRechargeRequests, 
  updateRechargeRequest, 
  updateUserBalance, 
  getExchangeRate, 
  updateExchangeRate,
  createTransaction,
  getAllRechargeRequests,
  findTransactionByRequestId,
  updateTransactionStatus,
  getAllUsers,
  setUserBalance,
  deleteUserFromFirestore,
  suspendUser,
  updateUserRole // <-- añadido
} from "./firestoreService";

// ================== NUEVO: Definición de roles y lista de administradores ==================
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
// ===========================================================================================

const AdminPanel = () => {
  const navigate = useNavigate();
  const { currentUser } = useContext(AuthContext);
  const [activeTab, setActiveTab] = useState("recharges");
  const [exchangeRate, setExchangeRate] = useState(100);
  const [rechargeRequests, setRechargeRequests] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [allRequests, setAllRequests] = useState([]);
  const [historyFilter, setHistoryFilter] = useState("all");
  const [isUsersSectionUnlocked, setIsUsersSectionUnlocked] = useState(false);
  const [userSearch, setUserSearch] = useState(""); // <-- NUEVO estado búsqueda

  // Reemplazado: ahora se valida contra lista de correos
  const isAdmin = adminEmails.includes(currentUser?.email);

  useEffect(() => {
    console.log("🔍 useEffect ejecutándose. isAdmin:", isAdmin);
    console.log("🔍 currentUser:", currentUser?.email);
    
    if (!isAdmin) {
      console.log("❌ No es admin, redirigiendo...");
      navigate('/lobby');
      return;
    }
    
    console.log("✅ Es admin, cargando datos...");
    loadData();
  }, [isAdmin, navigate]);

  const loadData = async () => {
    setLoading(true);
    try {
      console.log("🔍 Llamando a getPendingRechargeRequests...");
      const requests = await getPendingRechargeRequests();
      console.log("🔍 Solicitudes obtenidas:", requests);
      console.log("🔍 Número de solicitudes:", requests.length);
      
      requests.forEach((req, index) => {
        console.log(`🔍 Solicitud ${index + 1}:`, {
          id: req.id,
            status: req.status,
            username: req.username,
            amountUSD: req.amountUSD
        });
      });
      
      setRechargeRequests(requests);
      
      const allRechargeRequests = await getAllRechargeRequests();
      setAllRequests(allRechargeRequests);
      
      console.log("🔍 Llamando a getExchangeRate...");
      const rate = await getExchangeRate();
      console.log("🔍 Tasa de cambio obtenida:", rate);
      setExchangeRate(rate);

      // Asignar rol por defecto si no existe
      const usersList = await getAllUsers();
      setUsers(usersList.map(u => ({ ...u, role: u.role || 'user' })));

    } catch (error) {
      console.error("❌ Error cargando datos:", error);
      console.error("❌ Error details:", error.message);
      console.error("❌ Error stack:", error.stack);
    }

    setLoading(false);
    console.log("🔍 loadData finalizado");
  };

  const handleRechargeAction = async (requestId, action) => {
    try {
      console.log("🔍 Procesando solicitud:", requestId, "Acción:", action);
      
      const request = rechargeRequests.find(req => req.id === requestId);
      if (!request) {
        console.log("❌ Solicitud no encontrada");
        return;
      }

      const existingTransaction = await findTransactionByRequestId(request.id);

      if (action === "approved") {
        if (existingTransaction) {
          await updateTransactionStatus(existingTransaction.id, "approved", currentUser.email);
          console.log("✅ Transacción existente actualizada:", existingTransaction.id);
        } else {
          console.log("⚠️ No se encontró transacción existente, creando nueva...");
          await createTransaction({
            userId: request.userId,
            username: request.username,
            type: "recharge",
            amount: request.amountBS,
            description: `Recarga aprobada - ${request.amountUSD} USD`,
            status: "approved",
            requestId: request.id,
            admin: currentUser.email,
            method: request.method,
            reference: request.reference
          });
        }

        const success = await updateUserBalance(request.userId, request.amountBS);
        if (!success) {
          alert("❌ Error al actualizar el saldo");
          return;
        }

        await updateRechargeRequest(request.id, "approved", currentUser.email);
        alert(`✅ Recarga de $${request.amountUSD} USD aprobada para ${request.username}`);

      } else {
        if (existingTransaction) {
          await updateTransactionStatus(existingTransaction.id, "rejected", currentUser.email);
          console.log("✅ Transacción existente actualizada:", existingTransaction.id);
        } else {
          console.log("⚠️ No se encontró transacción existente, creando nueva...");
            await createTransaction({
            userId: request.userId,
            username: request.username,
            type: "recharge",
            amount: request.amountBS,
            description: `Recarga rechazada - ${request.amountUSD} USD`,
            status: "rejected",
            requestId: request.id,
            admin: currentUser.email,
            method: request.method,
            reference: request.reference
          });
        }

        await updateRechargeRequest(request.id, "rejected", currentUser.email);
        alert(`❌ Solicitud de recarga rechazada`);
      }

      await loadData();
      
    } catch (error) {
      console.error("❌ Error procesando solicitud:", error);
      alert("❌ Error al procesar la solicitud");
    }
  };

  const handleSaveExchangeRate = async () => {
    try {
      console.log("🔍 Guardando tasa de cambio:", exchangeRate);
      await updateExchangeRate(exchangeRate);
      alert("✅ Tasa de cambio actualizada correctamente");
    } catch (error) {
      console.error("❌ Error actualizando tasa:", error);
      alert("❌ Error al actualizar la tasa");
    }
  };

  // ================== NUEVO: cambiar rol de usuario ==================
  const handleUserRoleChange = async (userId, newRole) => {
    const userToChange = users.find(u => u.id === userId);
    if (!userToChange) return;
    const roleName = ROLES.find(r => r.id === newRole)?.name || newRole;
    if (!window.confirm(`¿Cambiar rol de "${userToChange.username}" a "${roleName}"?`)) return;
    try {
      await updateUserRole(userId, newRole);
      setUsers(users.map(u => u.id === userId ? { ...u, role: newRole } : u));
      alert("Rol actualizado");
    } catch (e) {
      console.error("Error actualizando rol", e);
      alert("Error actualizando rol");
    }
  };
  // ===================================================================

  const handleBackToLobby = () => {
    navigate('/lobby');
  };

  // ================== NUEVO: filtrado de usuarios ==================
  const filteredUsers = users.filter(u =>
    (u.username || "").toLowerCase().includes(userSearch.toLowerCase()) ||
    (u.email || "").toLowerCase().includes(userSearch.toLowerCase())
  );
  // =================================================================

  if (!isAdmin) {
    console.log("🔍 No es admin, renderizando null");
    return null;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 flex items-center justify-center">
        <div className="text-white text-xl">Cargando panel de administración...</div>
      </div>
    );
  }

  console.log("🔍 Renderizando AdminPanel. Solicitudes:", rechargeRequests.length);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-transparent via-black/20 to-black/60"></div>
      
      <header className="relative z-10 bg-black/40 backdrop-blur-lg border-b border-red-500/30 shadow-2xl">
        <div className="container mx-auto px-6 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-4">
              <button 
                onClick={handleBackToLobby}
                className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-xl transition-all duration-300 mr-4"
              >
                ← Volver al Lobby
              </button>
              <div className="text-3xl font-bold bg-gradient-to-r from-red-400 to-red-200 bg-clip-text text-transparent">
                ⚙️ PANEL DE ADMINISTRACIÓN
              </div>
              <div className="text-white/80">
                <div className="text-sm opacity-60">
                  Administrador: {currentUser?.email}
                  {users.find(u => u.email === currentUser?.email)?.role && (
                    <span className="ml-2 px-2 py-0.5 rounded bg-white/10 text-xs">
                      {ROLES.find(r => r.id === users.find(u => u.email === currentUser?.email)?.role)?.name}
                    </span>
                  )}
                </div>
                <div className="font-light text-red-200">
                  Solicitudes pendientes: {rechargeRequests.filter(r => r.status === "pending").length}
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 container mx-auto px-6 py-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex space-x-4 mb-8">
            {["recharges", "history", "settings", "users", "support"].map((tab) => {
              const handleTabClick = () => {
                if (tab === 'users') {
                  if (isUsersSectionUnlocked) {
                    setActiveTab('users');
                  } else {
                    const password = prompt("Para acceder a la sección de usuarios, ingresa la contraseña:");
                    if (password === "casino3127") {
                      alert("✅ Acceso concedido.");
                      setIsUsersSectionUnlocked(true);
                      setActiveTab('users');
                    } else if (password !== null) {
                      alert("❌ Contraseña incorrecta.");
                    }
                  }
                } else {
                  setActiveTab(tab);
                }
              };

              return (
                <button
                  key={tab}
                  onClick={handleTabClick}
                  className={`px-8 py-4 rounded-xl font-semibold text-lg transition-all duration-300 transform hover:scale-105 ${
                    activeTab === tab
                      ? "bg-red-500 text-white shadow-lg shadow-red-500/30"
                      : "bg-white/10 text-white hover:bg-white/20 border border-white/20"
                  }`}
                >
                  {tab === "recharges" && "💳 Solicitudes de Recarga"}
                  {tab === "history" && "📊 Historial"}
                  {tab === "settings" && "⚙️ Configuración General"}
                  {tab === "users" && "👥 Usuarios"}
                  {tab === "support" && "🎫 Soporte"}
                </button>
              );
            })}
          </div>

          <div className="bg-white/10 rounded-2xl p-8 backdrop-blur-lg border border-white/20">
            {activeTab === "recharges" && (
              <div>
                <h3 className="text-2xl font-bold text-white mb-6">
                  📋 Solicitudes Pendientes ({rechargeRequests.filter(r => r.status === "pending").length})
                </h3>
                
                {rechargeRequests.filter(r => r.status === "pending").length === 0 ? (
                  <div className="text-center py-12">
                    <div className="text-6xl mb-4">📭</div>
                    <p className="text-white/70 text-lg">No hay solicitudes de recarga pendientes</p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {rechargeRequests.filter(r => r.status === "pending").map((request) => (
                      <div key={request.id} className="bg-white/5 rounded-xl p-6 border border-white/10">
                        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-center">
                          <div>
                            <div className="font-bold text-white text-lg">{request.username}</div>
                            <div className="text-white/70 text-sm">{request.email}</div>
                            <div className="text-white/50 text-xs mt-1">ID: {request.userId}</div>
                            <div className={`text-xs mt-1 ${
                              request.status === "pending" ? "text-yellow-400" : 
                              request.status === "approved" ? "text-green-400" : "text-red-400"
                            }`}>
                              Estado: {request.status?.toUpperCase()}
                            </div>
                          </div>
                          
                          <div>
                            <div className="text-white font-bold text-xl">${request.amountUSD} USD</div>
                            <div className="text-white/70 text-sm">Bs. {request.amountBS?.toLocaleString()}</div>
                            <div className="text-white/50 text-xs mt-1 capitalize">{request.method}</div>
                          </div>
                          
                          <div>
                            <div className="text-white text-sm">Ref: {request.reference}</div>
                            <div className="text-white/70 text-sm">{request.date}</div>
                            <div className="text-white/50 text-xs mt-1">{request.bank}</div>
                          </div>
                          
                          <div>
                            <div className="text-white/70 text-sm">Solicitado:</div>
                            <div className="text-white text-sm">
                              {request.createdAt?.toDate?.()?.toLocaleDateString() || 'Fecha no disponible'}
                            </div>
                          </div>
                          
                          <div className="flex space-x-3">
                            {request.status === "pending" ? (
                              <>
                                <button
                                  onClick={() => handleRechargeAction(request.id, "approved")}
                                  className="bg-green-600 hover:bg-green-500 text-white font-semibold px-6 py-3 rounded-lg transition-all duration-300 transform hover:scale-105 flex-1"
                                >
                                  ✅ Aprobar
                                </button>
                                <button
                                  onClick={() => handleRechargeAction(request.id, "rejected")}
                                  className="bg-red-600 hover:bg-red-500 text-white font-semibold px-6 py-3 rounded-lg transition-all duration-300 transform hover:scale-105 flex-1"
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

            {activeTab === "history" && (
              <div>
                <h3 className="text-2xl font-bold text-white mb-6">📊 Historial Completo de Solicitudes</h3>
                
                <div className="grid grid-cols-4 gap-4 mb-6">
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

                <div className="mb-6 flex space-x-4">
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
                
                {allRequests.filter(request => historyFilter === "all" || request.status === historyFilter).length === 0 ? (
                  <div className="text-center py-12">
                    <div className="text-6xl mb-4">📭</div>
                    <p className="text-white/70 text-lg">No hay solicitudes en el historial</p>
                  </div>
                ) : (
                  <div className="space-y-4 max-h-96 overflow-y-auto">
                    {allRequests
                      .filter(request => historyFilter === "all" || request.status === historyFilter)
                      .map((request) => (
                      <div key={request.id} className="bg-white/5 rounded-xl p-4 border border-white/10 hover:bg-white/10 transition-all">
                        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-center">
                          <div>
                            <div className="font-bold text-white">{request.username}</div>
                            <div className="text-white/70 text-sm">{request.email}</div>
                            <div className="text-white/50 text-xs">ID: {request.userId}</div>
                          </div>
                          
                          <div>
                            <div className="text-white font-bold text-xl">${request.amountUSD} USD</div>
                            <div className="text-white/70 text-sm">Bs. {request.amountBS?.toLocaleString()}</div>
                            <div className="text-white/50 text-xs capitalize">{request.method}</div>
                          </div>
                          
                          <div>
                            <div className="text-white text-sm">Ref: {request.reference}</div>
                            <div className="text-white/70 text-sm">{request.date}</div>
                            <div className="text-white/50 text-xs">{request.bank}</div>
                          </div>
                          
                          <div>
                            <div className="text-white/70 text-sm">Solicitado:</div>
                            <div className="text-white text-sm">
                              {request.createdAt?.toDate?.()?.toLocaleDateString() || 'Fecha no disponible'}
                            </div>
                            {request.processedAt && (
                              <div className="text-white/50 text-xs">
                                Procesado: {request.processedAt?.toDate?.()?.toLocaleDateString()}
                              </div>
                            )}
                          </div>
                          
                          <div className={`text-center font-semibold px-3 py-2 rounded-full border ${
                            request.status === "approved" ? "text-green-400 bg-green-400/20 border-green-400/30" : 
                            request.status === "rejected" ? "text-red-400 bg-red-400/20 border-red-400/30" : 
                            "text-yellow-400 bg-yellow-400/20 border-yellow-400/30"
                          }`}>
                            {request.status === "approved" ? "✅ APROBADA" : 
                             request.status === "rejected" ? "❌ RECHAZADA" : "⏳ PENDIENTE"}
                            {request.processedBy && (
                              <div className="text-xs text-white/60 mt-1">Por: {request.processedBy}</div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === "settings" && (
              <div>
                <h3 className="text-2xl font-bold text-white mb-6">⚙️ Configuración General</h3>
                <div className="space-y-6 max-w-md">
                  <div>
                    <label className="block text-white font-semibold mb-3 text-lg">
                      💱 Tasa de Cambio (USD a Bs)
                    </label>
                    <input
                      type="number"
                      value={exchangeRate}
                      onChange={(e) => setExchangeRate(Number(e.target.value))}
                      className="w-full p-4 rounded-xl bg-white/10 border-2 border-white/20 text-white text-lg focus:outline-none focus:border-red-500 transition-all"
                    />
                    <div className="text-white/70 text-sm mt-2">1 USD = {exchangeRate} Bs</div>
                  </div>
                  <button 
                    onClick={handleSaveExchangeRate}
                    className="bg-red-600 hover:bg-red-500 text-white font-bold py-4 px-8 rounded-xl text-lg transition-all duration-300 transform hover:scale-105 w-full"
                  >
                    💾 Guardar Configuración
                  </button>
                  <div className="bg-yellow-500/20 rounded-xl p-4 border border-yellow-500/30">
                    <h4 className="font-bold text-yellow-300 mb-2">📊 Estadísticas</h4>
                    <div className="text-white/80 space-y-1 text-sm">
                      <div>• Solicitudes pendientes: {rechargeRequests.filter(r => r.status === "pending").length}</div>
                      <div>• Solicitudes aprobadas: {rechargeRequests.filter(r => r.status === "approved").length}</div>
                      <div>• Solicitudes rechazadas: {rechargeRequests.filter(r => r.status === "rejected").length}</div>
                      <div>• Total de solicitudes: {rechargeRequests.length}</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "users" && (
              <div>
                <h3 className="text-2xl font-bold text-white mb-6">👥 Gestión de Usuarios</h3>

                {/* Buscador */}
                <div className="mb-6">
                  <input
                    type="text"
                    placeholder="🔍 Buscar por nombre o correo..."
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    className="w-full p-4 rounded-xl bg-white/10 border-2 border-white/20 text-white text-lg focus:outline-none focus:border-purple-500 transition-all"
                  />
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full bg-transparent text-white">
                    <thead className="bg-white/10">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Usuario</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Correo / Teléfono</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Rol</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Saldo</th>
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
                              className="bg-white/20 border border-white/30 rounded px-2 py-1 text-sm"
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
                              defaultValue={user.balance}
                              onBlur={async (e) => {
                                const newBalance = Number(e.target.value);
                                const ok = await setUserBalance(user.id, newBalance);
                                if (ok) {
                                  setUsers(users.map(u => u.id === user.id ? { ...u, balance: newBalance } : u));
                                  alert("Saldo actualizado");
                                } else {
                                  alert("Error");
                                }
                              }}
                              className="w-24 p-1 rounded bg-white/20 text-sm"
                            />
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${user.suspended ? "bg-red-500/30 text-red-300" : "bg-green-500/30 text-green-300"}`}>
                              {user.suspended ? "Suspendido" : "Activo"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center space-x-2">
                            <button
                              onClick={async () => {
                                const ok = await suspendUser(user.id, !user.suspended);
                                if (ok) setUsers(users.map(u => u.id === user.id ? { ...u, suspended: !user.suspended } : u));
                              }}
                              className={`px-2 py-1 rounded text-xs ${user.suspended ? "bg-green-600" : "bg-yellow-600"}`}
                            >
                              {user.suspended ? "Reactivar" : "Suspender"}
                            </button>
                            <button
                              onClick={async () => {
                                if (window.confirm("¿Eliminar usuario permanentemente?")) {
                                  const ok = await deleteUserFromFirestore(user.id);
                                  if (ok) setUsers(users.filter(u => u.id !== user.id));
                                }
                              }}
                              className="px-2 py-1 bg-red-600 rounded text-xs"
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

            {activeTab === "support" && (
              <div className="bg-gradient-to-br from-green-900/20 to-emerald-800/20 rounded-2xl p-8 backdrop-blur-lg border border-green-500/30">
                <div className="text-center py-8">
                  <div className="text-6xl mb-6">🎫</div>
                  <h3 className="text-3xl font-bold text-white mb-4">Panel de Soporte Administrativo</h3>
                  <p className="text-white/80 text-lg mb-6 max-w-2xl mx-auto">
                    Gestiona todos los tickets de soporte de los usuarios. Revisa, responde y resuelve 
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
      </main>

      <div className="absolute top-20 left-10 w-32 h-32 bg-red-500/10 rounded-full blur-xl"></div>
      <div className="absolute bottom-20 right-10 w-48 h-48 bg-purple-500/10 rounded-full blur-2xl"></div>
    </div>
  );
};

export default AdminPanel;