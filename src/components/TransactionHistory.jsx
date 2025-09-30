import React, { useState, useEffect, useContext } from "react";
import { useNavigate } from "react-router-dom";
import { AuthContext } from "../App";
import { listenUserTransactions } from "../firestoreService";

const TransactionHistory = () => {
  const navigate = useNavigate();
  const { currentUser } = useContext(AuthContext);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState("all");

  useEffect(() => {
    if (!currentUser?.uid) return;
    setLoading(true);

    // Escuchar en tiempo real las transacciones del usuario
    const unsub = listenUserTransactions(currentUser.uid, (userTransactions) => {
      setTransactions(userTransactions);
      setLoading(false);
    });

    return () => {
      if (unsub) unsub();
    };
  }, [currentUser]);

  const filteredTransactions = transactions.filter(transaction => {
    if (activeFilter === "all") return true;
    if (activeFilter === "approved") {
      return transaction.status === "approved" || transaction.status === "completed";
    }
    return transaction.status === activeFilter;
  });

  const formatDate = (timestamp) => {
    if (!timestamp) return "Fecha no disponible";
    try {
      return timestamp.toDate().toLocaleDateString('es-VE', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (error) {
      return "Fecha no disponible";
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case "completed": return "text-green-400 bg-green-400/20 border-green-400/30";
      case "approved": return "text-green-400 bg-green-400/20 border-green-400/30";
      case "pending": return "text-yellow-400 bg-yellow-400/20 border-yellow-400/30";
      case "rejected": return "text-red-400 bg-red-400/20 border-red-400/30";
      default: return "text-gray-400 bg-gray-400/20 border-gray-400/30";
    }
  };

  const getStatusText = (status) => {
    switch (status) {
      case "completed": return "✅ Completada";
      case "approved": return "✅ Aprobada";
      case "pending": return "⏳ Pendiente";
      case "rejected": return "❌ Rechazada";
      default: return status;
    }
  };

  const getTypeIcon = (type) => {
    switch (type) {
      case "recharge_request": return "💳";
      case "recharge": return "💰";
      case "withdrawal": return "🏧";
      case "transfer": return "🔄";
      default: return "📊";
    }
  };

  const getAmountColor = (type, status) => {
    if (status === "rejected") return "text-red-400";
    if (type === "recharge" || type === "recharge_request") return "text-green-400";
    return "text-white";
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 flex items-center justify-center">
        <div className="text-white text-xl">Cargando historial...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 relative overflow-hidden">
      {/* Efectos de fondo */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-transparent via-black/20 to-black/60"></div>
      
      {/* Header */}
      <header className="relative z-10 bg-black/40 backdrop-blur-lg border-b border-blue-500/30 shadow-2xl">
        <div className="container mx-auto px-6 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-4">
              {/* Botón volver al lobby */}
              <button 
                onClick={() => navigate('/lobby')}
                className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-xl transition-all duration-300 mr-4"
              >
                ← Volver al Lobby
              </button>
              <div className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-blue-200 bg-clip-text text-transparent">
                📊 HISTORIAL DE TRANSACCIONES
              </div>
              <div className="text-white/60 text-sm">
                {transactions.length} transacciones registradas
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 container mx-auto px-6 py-8">
        <div className="max-w-4xl mx-auto">
          
          {/* Debug info para administradores */}
          {currentUser?.email === "cristhianzxz@hotmail.com" && (
            <div className="bg-blue-500/20 rounded-xl p-4 mb-6 border border-blue-500/30">
              <h4 className="font-bold text-blue-300 mb-2">🐛 Info Debug (Solo Admin)</h4>
              <div className="text-blue-200 text-sm space-y-1">
                <div>• User ID: {currentUser.uid}</div>
                <div>• Transacciones cargadas: {transactions.length}</div>
                <div>• Filtro activo: {activeFilter}</div>
                <div>• Mostrando: {filteredTransactions.length} transacciones</div>
              </div>
            </div>
          )}

          {/* Estadísticas rápidas */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="bg-white/10 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-white">{transactions.length}</div>
              <div className="text-white/70 text-sm">Total</div>
            </div>
            <div className="bg-yellow-500/20 rounded-lg p-4 text-center border border-yellow-500/30">
              <div className="text-2xl font-bold text-yellow-400">
                {transactions.filter(t => t.status === 'pending').length}
              </div>
              <div className="text-yellow-400/70 text-sm">Pendientes</div>
            </div>
            <div className="bg-green-500/20 rounded-lg p-4 text-center border border-green-500/30">
              <div className="text-2xl font-bold text-green-400">
                {transactions.filter(t => t.status === 'approved' || t.status === 'completed').length}
              </div>
              <div className="text-green-400/70 text-sm">Completadas</div>
            </div>
            <div className="bg-red-500/20 rounded-lg p-4 text-center border border-red-500/30">
              <div className="text-2xl font-bold text-red-400">
                {transactions.filter(t => t.status === 'rejected').length}
              </div>
              <div className="text-red-400/70 text-sm">Rechazadas</div>
            </div>
          </div>

          {/* Filtros */}
          <div className="flex space-x-4 mb-6 flex-wrap gap-2">
            {["all", "pending", "approved", "rejected"].map((filter) => (
              <button
                key={filter}
                onClick={() => setActiveFilter(filter)}
                className={`px-4 py-2 rounded-lg font-semibold transition-all ${
                  activeFilter === filter
                    ? "bg-blue-500 text-white"
                    : "bg-white/10 text-white hover:bg-white/20"
                }`}
              >
                {filter === "all" ? "📋 Todas" : 
                 filter === "pending" ? "⏳ Pendientes" :
                 filter === "approved" ? "✅ Completadas" : "❌ Rechazadas"}
                <span className="ml-2 text-xs opacity-70">
                  ({filter === "all" ? transactions.length : 
                    filter === "approved" ? transactions.filter(t => t.status === "approved" || t.status === "completed").length :
                    transactions.filter(t => t.status === filter).length})
                </span>
              </button>
            ))}
          </div>

          {/* Lista de transacciones */}
          <div className="bg-white/10 rounded-2xl p-6 backdrop-blur-lg border border-white/20">
            {filteredTransactions.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-6xl mb-4">📭</div>
                <p className="text-white/70 text-lg">No hay transacciones registradas</p>
                <p className="text-white/50 text-sm mt-2">
                  {activeFilter !== "all" 
                    ? `No hay transacciones ${activeFilter === "pending" ? "pendientes" : activeFilter === "approved" ? "completadas" : "rechazadas"}`
                    : "Tus transacciones aparecerán aquí después de realizar recargas"}
                </p>
              </div>
            ) : (
              <div className="space-y-4 max-h-96 overflow-y-auto">
                {filteredTransactions.map((transaction) => (
                  <div key={transaction.id} className="bg-white/5 rounded-xl p-4 border border-white/10 hover:bg-white/10 transition-all">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center space-x-3 mb-2">
                          <span className="text-2xl">{getTypeIcon(transaction.type)}</span>
                          <div>
                            <div className="text-white font-semibold">{transaction.description}</div>
                            <div className="text-white/70 text-sm">{formatDate(transaction.createdAt)}</div>
                            {transaction.admin && (
                              <div className="text-white/50 text-xs mt-1">
                                Procesado por: {transaction.admin}
                              </div>
                            )}
                            {transaction.method && (
                              <div className="text-white/50 text-xs mt-1">
                                Método: {transaction.method} {transaction.reference && `- Ref: ${transaction.reference}`}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`text-lg font-bold ${getAmountColor(transaction.type, transaction.status)}`}>
                          Bs. {transaction.amount?.toLocaleString()}
                        </div>
                        <div className={`text-sm px-3 py-1 rounded-full border ${getStatusColor(transaction.status)} mt-2`}>
                          {getStatusText(transaction.status)}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Información adicional */}
          <div className="mt-6 text-center text-white/60 text-sm">
            <p>💡 Las transacciones incluyen solicitudes de recarga y movimientos de saldo</p>
          </div>
        </div>
      </main>

      {/* Efectos decorativos */}
      <div className="absolute top-20 left-10 w-32 h-32 bg-blue-500/10 rounded-full blur-xl"></div>
      <div className="absolute bottom-20 right-10 w-48 h-48 bg-purple-500/10 rounded-full blur-2xl"></div>
    </div>
  );
};

export default TransactionHistory;