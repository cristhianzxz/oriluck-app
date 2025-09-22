import React, { useState, useEffect, useContext } from "react";
import { useNavigate } from "react-router-dom";
import { AuthContext } from "./App";
import { getPendingRechargeRequests, updateRechargeRequest, updateUserBalance, getExchangeRate, updateExchangeRate } from "./firestoreService";

const AdminPanel = () => {
  const navigate = useNavigate();
  const { currentUser } = useContext(AuthContext);
  const [activeTab, setActiveTab] = useState("recharges");
  const [exchangeRate, setExchangeRate] = useState(100);
  const [rechargeRequests, setRechargeRequests] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  // Verificar si es admin
  const isAdmin = currentUser?.email === "cristhianzxz@hotmail.com";

  useEffect(() => {
    if (!isAdmin) {
      navigate('/lobby');
      return;
    }
    loadData();
  }, [isAdmin, navigate]);

  const loadData = async () => {
    setLoading(true);
    try {
      // Cargar solicitudes pendientes
      const requests = await getPendingRechargeRequests();
      setRechargeRequests(requests);
      
      // Cargar tasa de cambio
      const rate = await getExchangeRate();
      setExchangeRate(rate);
      
    } catch (error) {
      console.error("Error cargando datos:", error);
    }
    setLoading(false);
  };

  const handleRechargeAction = async (requestId, action) => {
    try {
      // Encontrar la solicitud
      const request = rechargeRequests.find(req => req.id === requestId);
      if (!request) return;

      if (action === "approved") {
        // Actualizar saldo del usuario
        const success = await updateUserBalance(request.userId, request.amountBS);
        if (success) {
          // Marcar solicitud como aprobada
          await updateRechargeRequest(requestId, "approved");
          alert(`✅ Recarga de $${request.amountUSD} USD aprobada para ${request.username}`);
        } else {
          alert("❌ Error al actualizar el saldo");
          return;
        }
      } else {
        // Marcar solicitud como rechazada
        await updateRechargeRequest(requestId, "rejected");
        alert(`❌ Solicitud de recarga rechazada`);
      }

      // Recargar datos
      await loadData();
      
    } catch (error) {
      console.error("Error procesando solicitud:", error);
      alert("❌ Error al procesar la solicitud");
    }
  };

  const handleSaveExchangeRate = async () => {
    try {
      await updateExchangeRate(exchangeRate);
      alert("✅ Tasa de cambio actualizada correctamente");
    } catch (error) {
      console.error("Error actualizando tasa:", error);
      alert("❌ Error al actualizar la tasa");
    }
  };

  const handleBackToLobby = () => {
    navigate('/lobby');
  };

  if (!isAdmin) {
    return null;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 flex items-center justify-center">
        <div className="text-white text-xl">Cargando panel de administración...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 relative overflow-hidden">
      {/* Efectos de fondo */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-transparent via-black/20 to-black/60"></div>
      
      {/* Botón volver */}
      <button 
        onClick={handleBackToLobby}
        className="absolute top-6 left-6 z-20 bg-gray-600 hover:bg-gray-700 text-white font-bold py-3 px-6 rounded-xl transition-all duration-300 transform hover:scale-105"
      >
        ← Volver al Lobby
      </button>

      {/* Header */}
      <header className="relative z-10 bg-black/40 backdrop-blur-lg border-b border-red-500/30 shadow-2xl">
        <div className="container mx-auto px-6 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-4">
              <div className="text-3xl font-bold bg-gradient-to-r from-red-400 to-red-200 bg-clip-text text-transparent">
                ⚙️ PANEL DE ADMINISTRACIÓN
              </div>
              <div className="text-white/80">
                <div className="text-sm opacity-60">Administrador: {currentUser?.email}</div>
                <div className="font-light text-red-200">Solicitudes pendientes: {rechargeRequests.length}</div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 container mx-auto px-6 py-8">
        <div className="max-w-7xl mx-auto">
          {/* Tabs de navegación */}
          <div className="flex space-x-4 mb-8">
            {["recharges", "settings"].map((tab) => (
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
                {tab === "settings" && "⚙️ Configuración General"}
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
                    </div>
                  </div>
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