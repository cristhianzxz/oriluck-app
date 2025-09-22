import React, { useState, useContext } from "react";
import { useNavigate } from "react-router-dom";
import { AuthContext } from "./App";
import { createRechargeRequest } from "./firestoreService"; // Importar la función

const Recharge = () => {
  const navigate = useNavigate();
  const { currentUser } = useContext(AuthContext);
  const [selectedMethod, setSelectedMethod] = useState("pago_movil");
  const [amountUSD, setAmountUSD] = useState("");
  const [reference, setReference] = useState("");
  const [date, setDate] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const userData = {
    username: currentUser?.email?.split('@')[0] || "Usuario",
    balance: 1000,
  };

  const exchangeRate = 100;

  const calculateBs = () => {
    return amountUSD ? (parseFloat(amountUSD) * exchangeRate).toFixed(2) : "0.00";
  };

  const paymentMethods = [
    {
      id: "pago_movil",
      name: "Pago Móvil",
      icon: "📱",
      description: "Transferencia rápida desde tu móvil",
      instructions: "Realiza el pago móvil al número 0414-9588211 (C.I. 29670610)"
    },
    {
      id: "transferencia", 
      name: "Transferencia Bancaria",
      icon: "🏦",
      description: "Transferencia desde tu banco",
      instructions: "Banco Nacional de Crédito (BNC) - Cuenta: 0191-2345-67-8901234567"
    },
    {
      id: "binance",
      name: "Binance",
      icon: "₿",
      description: "Pago con criptomonedas",
      instructions: "Wallet: Cristhianzxz@hotmail.com (USDT - BEP20)"
    }
  ];

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      // Crear solicitud en Firestore
      const requestData = {
        userId: currentUser.uid,
        username: userData.username,
        email: currentUser.email,
        amountUSD: parseFloat(amountUSD),
        amountBS: parseFloat(amountUSD) * exchangeRate,
        method: selectedMethod,
        reference: reference,
        date: date,
        bank: paymentMethods.find(m => m.id === selectedMethod)?.name || selectedMethod
      };

      const requestId = await createRechargeRequest(requestData);
      
      if (requestId) {
        alert("✅ Solicitud de recarga enviada. Será verificada por administración.");
        setAmountUSD("");
        setReference("");
        setDate("");
      } else {
        alert("❌ Error al enviar la solicitud");
      }
    } catch (error) {
      console.error("Error:", error);
      alert("❌ Error al enviar la solicitud");
    }
    setIsSubmitting(false);
  };

  const handleBackToLobby = () => {
    navigate('/lobby');
  };

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
      <header className="relative z-10 bg-black/40 backdrop-blur-lg border-b border-gold-500/30 shadow-2xl">
        <div className="container mx-auto px-6 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-4">
              <div className="text-3xl font-bold bg-gradient-to-r from-yellow-400 to-yellow-200 bg-clip-text text-transparent">
                💰 RECARGAR SALDO
              </div>
              <div className="text-white/80">
                <div className="text-sm opacity-60">Usuario: {userData.username}</div>
                <div className="font-light text-gold-200">Saldo actual: Bs. {userData.balance.toLocaleString()}</div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 container mx-auto px-6 py-8">
        <div className="max-w-4xl mx-auto">
          {/* Métodos de Pago */}
          <div className="mb-8">
            <h3 className="text-2xl font-bold text-white mb-6 text-center">Selecciona Método de Pago</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {paymentMethods.map((method) => (
                <div
                  key={method.id}
                  onClick={() => setSelectedMethod(method.id)}
                  className={`p-6 rounded-2xl cursor-pointer transition-all duration-300 transform hover:scale-105 ${
                    selectedMethod === method.id
                      ? "bg-yellow-500/20 border-2 border-yellow-400 shadow-lg shadow-yellow-500/30"
                      : "bg-white/5 border border-white/20 hover:bg-white/10"
                  }`}
                >
                  <div className="text-4xl mb-3 text-center">{method.icon}</div>
                  <h4 className="font-bold text-white text-center mb-2">{method.name}</h4>
                  <p className="text-white/70 text-sm text-center mb-3">{method.description}</p>
                  <p className="text-yellow-300 text-xs text-center">{method.instructions}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Formulario de Recarga */}
          <div className="bg-white/10 rounded-2xl p-8 backdrop-blur-lg border border-white/20">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-white font-semibold mb-3 text-lg">
                    💵 Monto a Recargar (USD)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={amountUSD}
                    onChange={(e) => setAmountUSD(e.target.value)}
                    placeholder="Ej: 10.00"
                    className="w-full p-4 rounded-xl bg-white/10 border-2 border-white/20 text-white text-lg focus:outline-none focus:border-yellow-500 transition-all"
                    required
                  />
                </div>

                <div>
                  <label className="block text-white font-semibold mb-3 text-lg">
                    💰 Equivalente en Bolívares
                  </label>
                  <div className="p-4 rounded-xl bg-white/10 border-2 border-white/20">
                    <div className="text-white text-3xl font-bold">Bs. {calculateBs()}</div>
                    <div className="text-white/70 text-sm mt-2">Tasa del día: 1 USD = {exchangeRate} Bs</div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-white font-semibold mb-3 text-lg">
                    🔢 Número de Referencia
                  </label>
                  <input
                    type="text"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="Número de referencia del pago"
                    className="w-full p-4 rounded-xl bg-white/10 border-2 border-white/20 text-white text-lg focus:outline-none focus:border-yellow-500 transition-all"
                    required
                  />
                </div>

                <div>
                  <label className="block text-white font-semibold mb-3 text-lg">
                    📅 Fecha del Pago
                  </label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full p-4 rounded-xl bg-white/10 border-2 border-white/20 text-white text-lg focus:outline-none focus:border-yellow-500 transition-all"
                    required
                  />
                </div>
              </div>

              {/* Información Adicional */}
              <div className="bg-yellow-500/20 rounded-xl p-6 border border-yellow-500/30">
                <h4 className="font-bold text-white mb-3 text-lg flex items-center">
                  💡 Información Importante
                </h4>
                <ul className="text-white/80 space-y-2">
                  <li>• Tu recarga será verificada en un plazo de 1-2 horas</li>
                  <li>• Mantén el comprobante de pago a la mano</li>
                  <li>• Para consultas: soporte@oriluck.com</li>
                  <li>• Las recargas se acreditan de lunes a domingo de 8:00 AM a 10:00 PM</li>
                </ul>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 text-white font-bold py-4 rounded-xl text-lg transition-all duration-300 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-green-500/25"
              >
                {isSubmitting ? "🔄 ENVIANDO SOLICITUD..." : "✅ ENVIAR SOLICITUD DE RECARGA"}
              </button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Recharge;