// src/components/AdminPanel.jsx
import React, { useState, useEffect } from "react";

const AdminPanel = () => {
  const [activeTab, setActiveTab] = useState("recharges");
  const [exchangeRate, setExchangeRate] = useState(100);
  const [rechargeRequests, setRechargeRequests] = useState([]);
  const [users, setUsers] = useState([]);

  // Datos de ejemplo
  useEffect(() => {
    // Simular carga de datos
    setRechargeRequests([
      {
        id: 1,
        user: "juanperez",
        email: "juan@email.com",
        amountUSD: 50,
        amountBS: 5000,
        method: "pago_movil",
        reference: "PM123456",
        date: "2024-01-15",
        status: "pending",
        bank: "Banesco"
      },
      {
        id: 2, 
        user: "maria23",
        email: "maria@email.com",
        amountUSD: 25,
        amountBS: 2500,
        method: "binance",
        reference: "BIN789012",
        date: "2024-01-15", 
        status: "pending",
        bank: "USDT"
      }
    ]);

    setUsers([
      {
        id: 1,
        username: "juanperez",
        email: "juan@email.com",
        balance: 1500,
        registrationDate: "2024-01-10",
        status: "active"
      },
      {
        id: 2,
        username: "maria23", 
        email: "maria@email.com",
        balance: 500,
        registrationDate: "2024-01-12",
        status: "active"
      }
    ]);
  }, []);

  const handleRechargeAction = (requestId, action) => {
    setRechargeRequests(requests =>
      requests.map(req =>
        req.id === requestId ? { ...req, status: action } : req
      )
    );
    
    if (action === "approved") {
      alert(`✅ Recarga aprobada para el usuario`);
      // Aquí actualizarías el saldo del usuario en la base de datos
    }
  };

  const updateUserBalance = (userId, newBalance) => {
    setUsers(users =>
      users.map(user =>
        user.id === userId ? { ...user, balance: newBalance } : user
      )
    );
    alert(`✅ Saldo actualizado correctamente`);
  };

  return (
    <div className="max-w-7xl mx-auto">
      <h2 className="text-4xl font-bold text-white text-center mb-8">
        ⚙️ PANEL DE ADMINISTRACIÓN
      </h2>

      {/* Tabs de Navegación */}
      <div className="flex space-x-2 mb-6">
        {["recharges", "users", "settings"].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-6 py-3 rounded-lg font-semibold transition ${
              activeTab === tab
                ? "bg-yellow-500 text-black"
                : "bg-white bg-opacity-10 text-white hover:bg-opacity-20"
            }`}
          >
            {tab === "recharges" && "💳 Solicitudes de Recarga"}
            {tab === "users" && "👥 Gestión de Usuarios"} 
            {tab === "settings" && "⚙️ Configuración"}
          </button>
        ))}
      </div>

      {/* Contenido de las Tabs */}
      <div className="bg-white bg-opacity-10 rounded-2xl p-6">
        {/* SOLICITUDES DE RECARGA */}
        {activeTab === "recharges" && (
          <div>
            <h3 className="text-2xl font-bold text-white mb-4">
              Solicitudes Pendientes ({rechargeRequests.filter(r => r.status === "pending").length})
            </h3>
            
            <div className="space-y-4">
              {rechargeRequests.map((request) => (
                <div key={request.id} className="bg-white bg-opacity-5 rounded-lg p-4">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-center">
                    <div>
                      <div className="font-bold text-white">{request.user}</div>
                      <div className="text-white text-opacity-70 text-sm">{request.email}</div>
                    </div>
                    
                    <div>
                      <div className="text-white">
                        <span className="font-bold">${request.amountUSD} USD</span>
                        <span className="text-opacity-70"> (Bs. {request.amountBS})</span>
                      </div>
                      <div className="text-white text-opacity-70 text-sm capitalize">
                        {request.method} • {request.bank}
                      </div>
                    </div>
                    
                    <div>
                      <div className="text-white text-sm">Ref: {request.reference}</div>
                      <div className="text-white text-opacity-70 text-sm">{request.date}</div>
                    </div>
                    
                    <div className="flex space-x-2">
                      {request.status === "pending" ? (
                        <>
                          <button
                            onClick={() => handleRechargeAction(request.id, "approved")}
                            className="bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600 transition"
                          >
                            ✅ Aprobar
                          </button>
                          <button
                            onClick={() => handleRechargeAction(request.id, "rejected")}
                            className="bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600 transition"
                          >
                            ❌ Rechazar
                          </button>
                        </>
                      ) : (
                        <span className={`px-3 py-1 rounded-full text-sm ${
                          request.status === "approved" 
                            ? "bg-green-500 text-white" 
                            : "bg-red-500 text-white"
                        }`}>
                          {request.status === "approved" ? "APROBADO" : "RECHAZADO"}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* GESTIÓN DE USUARIOS */}
        {activeTab === "users" && (
          <div>
            <h3 className="text-2xl font-bold text-white mb-4">
              Usuarios Registrados ({users.length})
            </h3>
            
            <div className="space-y-4">
              {users.map((user) => (
                <div key={user.id} className="bg-white bg-opacity-5 rounded-lg p-4">
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-center">
                    <div>
                      <div className="font-bold text-white">{user.username}</div>
                      <div className="text-white text-opacity-70 text-sm">{user.email}</div>
                    </div>
                    
                    <div className="text-white">
                      Registro: {user.registrationDate}
                    </div>
                    
                    <div className="text-white font-bold">
                      Bs. {user.balance.toLocaleString()}
                    </div>
                    
                    <div>
                      <span className={`px-2 py-1 rounded text-sm ${
                        user.status === "active" 
                          ? "bg-green-500 text-white" 
                          : "bg-red-500 text-white"
                      }`}>
                        {user.status.toUpperCase()}
                      </span>
                    </div>
                    
                    <div className="flex space-x-2">
                      <button
                        onClick={() => {
                          const newBalance = prompt("Nuevo saldo (Bs):", user.balance);
                          if (newBalance) updateUserBalance(user.id, parseFloat(newBalance));
                        }}
                        className="bg-blue-500 text-white px-3 py-1 rounded text-sm hover:bg-blue-600 transition"
                      >
                        Editar Saldo
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* CONFIGURACIÓN */}
        {activeTab === "settings" && (
          <div>
            <h3 className="text-2xl font-bold text-white mb-4">Configuración General</h3>
            
            <div className="space-y-4 max-w-md">
              <div>
                <label className="block text-white font-semibold mb-2">
                  Tasa de Cambio (USD a Bs)
                </label>
                <input
                  type="number"
                  value={exchangeRate}
                  onChange={(e) => setExchangeRate(e.target.value)}
                  className="w-full p-3 rounded-lg bg-white bg-opacity-10 border border-white border-opacity-20 text-white"
                />
                <div className="text-white text-opacity-70 text-sm mt-1">
                  1 USD = {exchangeRate} Bs
                </div>
              </div>
              
              <button className="bg-yellow-500 text-black px-6 py-3 rounded-lg font-semibold hover:bg-yellow-600 transition">
                💾 Guardar Configuración
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminPanel;