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
  findTransactionByRequestId,  // ← NUEVO
  updateTransactionStatus,     // ← NUEVO
  getAllUsers,                 // ← NUEVO PARA ADMIN USUARIOS
  setUserBalance,              // ← NUEVO PARA ADMIN USUARIOS
  deleteUserFromFirestore,     // ← NUEVO PARA ADMIN USUARIOS
  suspendUser                  // ← NUEVO PARA ADMIN USUARIOS
} from "./firestoreService";

const AdminPanel = () => {
  const navigate = useNavigate();
  const { currentUser } = useContext(AuthContext);
  const [activeTab, setActiveTab] = useState("recharges");
  const [exchangeRate, setExchangeRate] = useState(100);
  const [rechargeRequests, setRechargeRequests] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [allRequests, setAllRequests] = useState([]); // ← AGREGADO
  const [historyFilter, setHistoryFilter] = useState("all"); // ← AGREGADO

  // Verificar si es admin
  const isAdmin = currentUser?.email === "cristhianzxz@hotmail.com" || currentUser?.email === "admin@oriluck.com";

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
      // Cargar solicitudes pendientes
      console.log("🔍 Llamando a getPendingRechargeRequests...");
      const requests = await getPendingRechargeRequests();
      console.log("🔍 Solicitudes obtenidas:", requests);
      console.log("🔍 Número de solicitudes:", requests.length);
      
      // Verificar cada solicitud
      requests.forEach((req, index) => {
        console.log(`🔍 Solicitud ${index + 1}:`, {
          id: req.id,
          status: req.status,
          username: req.username,
          amountUSD: req.amountUSD
        });
      });
      
      setRechargeRequests(requests);
      
      // 🔥 NUEVO: Cargar TODAS las solicitudes para el historial
      const allRechargeRequests = await getAllRechargeRequests();
      setAllRequests(allRechargeRequests);
      
      // Cargar tasa de cambio
      console.log("🔍 Llamando a getExchangeRate...");
      const rate = await getExchangeRate();
      console.log("🔍 Tasa de cambio obtenida:", rate);
      
            setExchangeRate(rate);

      // 🔥 Cargar usuarios
      const usersList = await getAllUsers();
      setUsers(usersList);

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

    // Buscar transacción existente por requestId
    const existingTransaction = await findTransactionByRequestId(request.id);

    if (action === "approved") {
      // Actualizar transacción existente o crear si no existe
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

      // Actualizar saldo del usuario
      const success = await updateUserBalance(request.userId, request.amountBS);
      if (!success) {
        alert("❌ Error al actualizar el saldo");
        return;
      }

      // Marcar solicitud como aprobada
      await updateRechargeRequest(request.id, "approved", currentUser.email);
      alert(`✅ Recarga de $${request.amountUSD} USD aprobada para ${request.username}`);

    } else {
      // Acción: rechazado
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

      // Marcar solicitud como rechazada
      await updateRechargeRequest(request.id, "rejected", currentUser.email);
      alert(`❌ Solicitud de recarga rechazada`);
    }

    // Recargar datos
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

  const handleBackToLobby = () => {
    navigate('/lobby');
  };

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
      {/* Efectos de fondo */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-transparent via-black/20 to-black/60"></div>
      
      

     <header className="relative z-10 bg-black/40 backdrop-blur-lg border-b border-red-500/30 shadow-2xl">
  <div className="container mx-auto px-6 py-4">
    <div className="flex justify-between items-center">
      <div className="flex items-center space-x-4">
        {/* Botón volver al lobby */}
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
          <div className="text-sm opacity-60">Administrador: {currentUser?.email}</div>
          <div className="font-light text-red-200">Solicitudes pendientes: {rechargeRequests.filter(r => r.status === "pending").length}</div>
        </div>
      </div>
    </div>
  </div>
</header>

      <main className="relative z-10 container mx-auto px-6 py-8">
        <div className="max-w-7xl mx-auto">
          {/* Tabs de navegación */}
          <div className="flex space-x-4 mb-8">
            {["recharges", "history", "settings", "users"].map((tab) => (
  <button
    key={tab}
    onClick={() => setActiveTab(tab)}
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
  </button>
))}
          </div>

          {/* Contenido de las tabs */}
          <div className="bg-white/10 rounded-2xl p-8 backdrop-blur-lg border border-white/20">
            {activeTab === "recharges" && (
              <div>
                <h3 className="text-2xl font-bold text-white mb-6">
                  📋 Solicitudes Pendientes ({rechargeRequests.filter(r => r.status === "pending").length})
                </h3>
                
                {rechargeRequests.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="text-6xl mb-4">📭</div>
                    <p className="text-white/70 text-lg">No hay solicitudes de recarga pendientes</p>
                    <p className="text-white/50 text-sm mt-2">Total de solicitudes en sistema: {rechargeRequests.length}</p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {rechargeRequests.map((request) => (
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

            {/* 🔥 NUEVO TAB: HISTORIAL */}
            {activeTab === "history" && (
              <div>
                <h3 className="text-2xl font-bold text-white mb-6">📊 Historial Completo de Solicitudes</h3>
                
                {/* Estadísticas */}
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

                {/* Filtros */}
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
                
                {/* Lista de solicitudes */}
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
    <div className="overflow-x-auto">
      <table className="min-w-full bg-white/10 rounded-xl text-white">
        <thead>
          <tr>
            <th className="px-4 py-2">Usuario</th>
            <th className="px-4 py-2">Correo</th>
            <th className="px-4 py-2">Teléfono</th>
            <th className="px-4 py-2">Saldo</th>
            <th className="px-4 py-2">Estado</th>
            <th className="px-4 py-2">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {users.map(user => (
            <tr key={user.id} className="border-b border-white/10">
              <td className="px-4 py-2">{user.username}</td>
              <td className="px-4 py-2">{user.email}</td>
              <td className="px-4 py-2">{user.phone}</td>
              <td className="px-4 py-2">
                <input
                  type="number"
                  value={user.balance}
                  onChange={e => {
                    const newBalance = Number(e.target.value);
                    setUsers(users.map(u => u.id === user.id ? { ...u, balance: newBalance } : u));
                  }}
                  className="w-24 p-1 rounded bg-white/20 text-white"
                />
                <button
                  onClick={async () => {
                    const ok = await setUserBalance(user.id, user.balance);
                    if (ok) alert("Saldo actualizado");
                    else alert("Error actualizando saldo");
                  }}
                  className="ml-2 px-2 py-1 bg-green-600 rounded text-xs"
                >
                  Guardar
                </button>
              </td>
              <td className="px-4 py-2">
                {user.suspended ? (
                  <span className="text-red-400">Suspendido</span>
                ) : (
                  <span className="text-green-400">Activo</span>
                )}
              </td>
              <td className="px-4 py-2 space-x-2">
                <button
                  onClick={async () => {
                    const ok = await suspendUser(user.id, !user.suspended);
                    if (ok) {
                      setUsers(users.map(u => u.id === user.id ? { ...u, suspended: !user.suspended } : u));
                      alert(user.suspended ? "Usuario reactivado" : "Usuario suspendido");
                    } else {
                      alert("Error actualizando estado");
                    }
                  }}
                  className={`px-2 py-1 rounded text-xs ${user.suspended ? "bg-green-600" : "bg-yellow-600"}`}
                >
                  {user.suspended ? "Reactivar" : "Suspender"}
                </button>
                <button
                  onClick={async () => {
                    if (window.confirm("¿Seguro que deseas eliminar este usuario? Esta acción es irreversible.")) {
                      const ok = await deleteUserFromFirestore(user.id);
                      if (ok) setUsers(users.filter(u => u.id !== user.id));
                      else alert("Error eliminando usuario");
                    }
                  }}
                  className="px-2 py-1 bg-red-600 rounded text-xs"
                >
                  Eliminar
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
)}
          </div>
        </div>
      </main>

      {/* Efectos decorativos */}
      <div className="absolute top-20 left-10 w-32 h-32 bg-red-500/10 rounded-full blur-xl"></div>
      <div className="absolute bottom-20 right-10 w-48 h-48 bg-purple-500/10 rounded-full blur-2xl"></div>
    </div>
  );
};

export default AdminPanel;