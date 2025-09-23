import React, { useState, useEffect, useContext } from "react";
import { useNavigate } from "react-router-dom";
import { AuthContext } from "./App";
import { createRechargeRequest, getExchangeRate, createTransaction, getUserData } from "./firestoreService";

const Recharge = () => {
  const navigate = useNavigate();
  const { currentUser } = useContext(AuthContext);
  const [selectedMethod, setSelectedMethod] = useState(null);
  const [amountUSD, setAmountUSD] = useState("");
  const [reference, setReference] = useState("");
  const [date, setDate] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exchangeRate, setExchangeRate] = useState(100);
  const [showPaymentDetails, setShowPaymentDetails] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      if (currentUser) {
        try {
          console.log("🔍 Cargando datos del usuario y tasa...");
          
          const [userDataFromFirestore, currentExchangeRate] = await Promise.all([
            getUserData(currentUser.uid),
            getExchangeRate()
          ]);
          
          if (userDataFromFirestore) {
            setUserData({
              username: userDataFromFirestore.username || currentUser.email?.split('@')[0] || "Usuario",
              balance: userDataFromFirestore.balance || 0,
              email: currentUser.email
            });
            console.log("✅ Datos del usuario cargados:", userDataFromFirestore.balance);
          } else {
            setUserData({
              username: currentUser.email?.split('@')[0] || "Usuario",
              balance: 0,
              email: currentUser.email
            });
          }
          
          setExchangeRate(currentExchangeRate);
          console.log("✅ Tasa de cambio cargada:", currentExchangeRate);
          
        } catch (error) {
          console.error("❌ Error cargando datos:", error);
          setUserData({
            username: currentUser.email?.split('@')[0] || "Usuario",
            balance: 0,
            email: currentUser.email
          });
          setExchangeRate(100);
        }
      }
      setLoading(false);
    };

    loadData();
  }, [currentUser]);

  const calculateBs = () => {
    return amountUSD ? (parseFloat(amountUSD) * exchangeRate).toFixed(2) : "0.00";
  };

  const paymentMethods = [
    {
      id: "pago_movil",
      name: "Pago Móvil",
      icon: "📱",
      description: "Transferencia rápida desde tu móvil",
      instructions: "Realiza el pago móvil con los siguientes datos:",
      details: {
        banco: "Banco Nacional de Crédito (BNC)",
        telefono: "0414-9588211",
        cedula: "V-29670610",
        nombre: "Oriluck C.A.",
      }
    },
    {
      id: "transferencia", 
      name: "Transferencia Bancaria",
      icon: "🏦",
      description: "Transferencia desde tu banco",
      instructions: "Realiza la transferencia con los siguientes datos:",
      details: {
        banco: "Banco Nacional de Crédito (BNC)",
        tipoCuenta: "Cuenta Ahorro",
        numeroCuenta: "0191-2345-67-8901234567",
        titular: "Oriluck C.A.",
        cedula: "V-29670610"
      }
    },
    {
      id: "binance",
      name: "Binance",
      icon: "₿",
      description: "Pago con criptomonedas",
      instructions: "Realiza el pago con los siguientes datos:",
      details: {
        plataforma: "Binance",
        wallet: "Cristhianzxz@hotmail.com",
        red: "USDT - BEP20",
        memo: "Incluir referencia en el memo"
      }
    }
  ];

  const handleMethodSelect = (methodId) => {
    setSelectedMethod(methodId);
    setShowPaymentDetails(true);
    // Reset form when changing method
    setAmountUSD("");
    setReference("");
    setDate("");
  };

  const handleBackToMethods = () => {
    setShowPaymentDetails(false);
    setSelectedMethod(null);
  };

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
        console.log("✅ Solicitud creada con ID:", requestId);
        
        // 🔥 CREAR TRANSACCIÓN PENDIENTE PARA EL USUARIO
        const transactionData = {
          userId: currentUser.uid,
          username: userData.username,
          type: "recharge_request",
          amount: parseFloat(amountUSD) * exchangeRate,
          description: `Solicitud de recarga - ${amountUSD} USD`,
          status: "pending",
          requestId: requestId,
          admin: "Sistema",
          method: selectedMethod,
          reference: reference
        };
        
        console.log("💾 Creando transacción pendiente:", transactionData);
        await createTransaction(transactionData);
        
        alert("✅ Solicitud de recarga enviada. Será verificada por administración.");
        setAmountUSD("");
        setReference("");
        setDate("");
        handleBackToMethods();
      } else {
        alert("❌ Error al enviar la solicitud");
      }
    } catch (error) {
      console.error("Error:", error);
      alert("❌ Error al enviar la solicitud");
    }
    setIsSubmitting(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 flex items-center justify-center">
        <div className="text-white text-xl">Cargando...</div>
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 relative overflow-hidden">
      {/* Efectos de fondo */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-transparent via-black/20 to-black/60"></div>
      
      {/* Header */}
      <header className="relative z-10 bg-black/40 backdrop-blur-lg border-b border-green-500/30 shadow-2xl">
        <div className="container mx-auto px-6 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => navigate('/lobby')}
                className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-xl transition-all duration-300 mr-4"
              >
                ← Volver al Lobby
              </button>
              <div className="text-3xl font-bold bg-gradient-to-r from-green-400 to-green-200 bg-clip-text text-transparent">
                💳 RECARGAR SALDO
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 container mx-auto px-6 py-8">
        <div className="max-w-4xl mx-auto">
          {!showPaymentDetails ? (
            /* Selección de Métodos de Pago */
            <div className="mb-8">
              <h3 className="text-2xl font-bold text-white mb-6 text-center">Selecciona Método de Pago</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {paymentMethods.map((method) => (
                  <div
                    key={method.id}
                    onClick={() => handleMethodSelect(method.id)}
                    className="p-6 rounded-2xl cursor-pointer transition-all duration-300 transform hover:scale-105 bg-white/5 border border-white/20 hover:bg-white/10"
                  >
                    <div className="text-4xl mb-3 text-center">{method.icon}</div>
                    <h4 className="font-bold text-white text-center mb-2">{method.name}</h4>
                    <p className="text-white/70 text-sm text-center mb-3">{method.description}</p>
                    <div className="text-center">
                      <button className="bg-green-600 hover:bg-green-500 text-white font-semibold py-2 px-4 rounded-lg transition-all">
                        Seleccionar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* Detalles del Pago y Formulario */
            <div className="bg-white/10 rounded-2xl p-8 backdrop-blur-lg border border-white/20">
              {/* Header del método seleccionado */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center space-x-4">
                  <button
                    onClick={handleBackToMethods}
                    className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-xl transition-all duration-300"
                  >
                    ← Volver
                  </button>
                  <div className="text-4xl">
                    {paymentMethods.find(m => m.id === selectedMethod)?.icon}
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-white">
                      {paymentMethods.find(m => m.id === selectedMethod)?.name}
                    </h2>
                    <p className="text-white/70">
                      {paymentMethods.find(m => m.id === selectedMethod)?.description}
                    </p>
                  </div>
                </div>
              </div>

              {/* Instrucciones y Datos del Pago */}
              <div className="bg-yellow-500/20 rounded-xl p-6 border border-yellow-500/30 mb-6">
                <h4 className="font-bold text-white mb-4 text-lg flex items-center">
                  💡 {paymentMethods.find(m => m.id === selectedMethod)?.instructions}
                </h4>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                  {Object.entries(paymentMethods.find(m => m.id === selectedMethod)?.details || {}).map(([key, value]) => (
                    <div key={key} className="bg-black/30 rounded-lg p-3">
                      <div className="text-yellow-300 text-sm font-semibold capitalize">
                        {key.replace(/([A-Z])/g, ' $1').trim()}:
                      </div>
                      <div className="text-white font-medium">{value}</div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 p-3 bg-green-500/20 rounded-lg border border-green-500/30">
                  <div className="text-green-300 text-sm font-semibold">💡 Importante:</div>
                  <div className="text-white/80 text-sm">
                    • Después de realizar el pago, completa el formulario a continuación
                    <br />
                    • Incluye la referencia exacta del pago
                    <br />
                    • Tu recarga será verificada en 1-2 horas
                  </div>
                </div>
              </div>

              {/* Formulario de Recarga */}
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-white font-semibold mb-3 text-lg">
                      💵 Monto a Recargar (USD)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="1"
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
                      <div className="text-yellow-300 text-xs mt-1">💰 Tasa actualizada desde BCV</div>
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

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 text-white font-bold py-4 rounded-xl text-lg transition-all duration-300 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-green-500/25"
                >
                  {isSubmitting ? "🔄 ENVIANDO SOLICITUD..." : "✅ ENVIAR SOLICITUD DE RECARGA"}
                </button>
              </form>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default Recharge;