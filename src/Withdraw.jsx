import React, { useState, useEffect, useContext } from "react";
import { useNavigate } from "react-router-dom";
import { AuthContext } from "./App";
import { getExchangeRate, createTransaction, createWithdrawRequest } from "./firestoreService";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "./firebase";

const BANKS_VENEZUELA = [
  { code: "0102", name: "Banco de Venezuela" },
  { code: "0104", name: "Venezolano de Crédito" },
  { code: "0105", name: "Banco Mercantil" },
  { code: "0108", name: "Banco Provincial" },
  { code: "0114", name: "Banco Banesco" },
  { code: "0128", name: "Banco Caroní" },
  { code: "0134", name: "Banco Sofitasa" },
  { code: "0137", name: "Banco Occidental de Descuento" },
  { code: "0146", name: "Banco de la Gente Emprendedora" },
  { code: "0156", name: "100% Banco" },
  { code: "0163", name: "Banco del Tesoro" },
  { code: "0166", name: "Banco Agrícola de Venezuela" },
  { code: "0171", name: "Banco Activo" },
  { code: "0172", name: "Bancamiga" },
  { code: "0174", name: "Banplus" },
  { code: "0175", name: "Banco Bicentenario" },
  { code: "0191", name: "Banco Nacional de Crédito (BNC)" },
  { code: "0177", name: "Banco de la Fuerza Armada Nacional Bolivariana" },
  { code: "0196", name: "Banco Agropecuario de Venezuela" }
];

const Withdraw = () => {
  const navigate = useNavigate();
  const { currentUser } = useContext(AuthContext);
  const [selectedMethod, setSelectedMethod] = useState(null);
  const [amountBs, setAmountBs] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exchangeRate, setExchangeRate] = useState(100);
  const [showPaymentDetails, setShowPaymentDetails] = useState(false);

  // Datos que el usuario debe ingresar para retiro
  const [userBank, setUserBank] = useState("");
  const [userPhone, setUserPhone] = useState("");
  const [userCedula, setUserCedula] = useState("");
  const [userName, setUserName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountType, setAccountType] = useState("Ahorro");
  const [showLegalModal, setShowLegalModal] = useState(false);

  // Fecha y hora en vivo
  const [liveDate, setLiveDate] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setLiveDate(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Listener en vivo para el usuario
  useEffect(() => {
    if (!currentUser?.uid) return;
    const userRef = doc(db, "users", currentUser.uid);
    const unsub = onSnapshot(userRef, (snap) => {
      if (snap.exists()) {
        setUserData({
          username: snap.data().username || currentUser.email?.split('@')[0] || "Usuario",
          balance: snap.data().balance || 0,
          email: currentUser.email
        });
      } else {
        setUserData({
          username: currentUser.email?.split('@')[0] || "Usuario",
          balance: 0,
          email: currentUser.email
        });
      }
      setLoading(false);
    });
    return () => unsub();
  }, [currentUser]);

  // Listener en vivo para la tasa
  useEffect(() => {
    const fetchRate = async () => {
      const rate = await getExchangeRate();
      setExchangeRate(rate);
    };
    fetchRate();
  }, []);

  // Calcula el equivalente en dólares
  const calculateUSD = () => {
    return amountBs ? (parseFloat(amountBs) / exchangeRate).toFixed(2) : "0.00";
  };

  const paymentMethods = [
    {
      id: "pago_movil",
      name: "Pago Móvil",
      icon: "📱",
      description: "Retiro por pago móvil",
      instructions: "Completa tus datos para el retiro por pago móvil."
    },
    {
      id: "transferencia",
      name: "Transferencia Bancaria",
      icon: "🏦",
      description: "Retiro por transferencia bancaria",
      instructions: "Completa tus datos para el retiro por transferencia."
    }
  ];

  const handleMethodSelect = (methodId) => {
    setSelectedMethod(methodId);
    setShowPaymentDetails(true);
    setAmountBs("");
    setUserBank("");
    setUserPhone("");
    setUserCedula("");
    setUserName("");
    setAccountNumber("");
    setAccountType("Ahorro");
  };

  const handleBackToMethods = () => {
    setShowPaymentDetails(false);
    setSelectedMethod(null);
  };

  // Validación para solo números en teléfono y cuenta
  const handlePhoneChange = (e) => {
    const value = e.target.value.replace(/[^0-9]/g, "");
    setUserPhone(value);
  };
  const handleAccountNumberChange = (e) => {
    const value = e.target.value.replace(/[^0-9-]/g, "");
    setAccountNumber(value);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Validación de saldo
    const saldoDisponible = userData.balance || 0;
    const montoRetiro = parseFloat(amountBs);

    if (montoRetiro <= 0) {
      alert("❌ El monto debe ser mayor a 0");
      return;
    }

    if (montoRetiro > saldoDisponible) {
      alert("❌ No tienes saldo suficiente para retirar ese monto.");
      return;
    }

    // Validaciones de campos numéricos
    if (
  selectedMethod === "transferencia" &&
  !/^[0-9-]+$/.test(accountNumber)
) {
  alert("❌ El número de cuenta solo puede contener números y guiones.");
  return;
}
    if (selectedMethod === "pago_movil" && !/^\d{11}$/.test(userPhone)) {
      alert("❌ El teléfono debe tener 11 dígitos y solo números.");
      return;
    }

    // Mostrar modal legal antes de enviar
    setShowLegalModal(true);
  };

  const confirmLegalAndSend = async () => {
    setIsSubmitting(true);
    setShowLegalModal(false);

    const fechaSolicitud = liveDate.toLocaleDateString("es-VE");
    const horaSolicitud = liveDate.toLocaleTimeString("es-VE");

    try {
      // Datos de retiro
      const withdrawRequest = {
        userId: currentUser.uid,
        username: userData.username,
        email: userData.email,
        type: "withdraw",
        amountBS: parseFloat(amountBs),
        amountUSD: parseFloat(calculateUSD()),
        method: selectedMethod,
        bank: userBank,
        phone: userPhone,
        cedula: userCedula,
        nombre: userName,
        accountNumber: selectedMethod === "transferencia" ? accountNumber : "",
        accountType: selectedMethod === "transferencia" ? accountType : "",
        fecha: fechaSolicitud,
        hora: horaSolicitud,
        status: "pending"
      };

// Guarda la solicitud en la colección de retiros y obtén el ID
const withdrawDocRef = await createWithdrawRequest(withdrawRequest);
// Si tu función createWithdrawRequest no retorna el docRef, debes modificarla en firestoreService.js para que lo haga.
// Ejemplo: return docRef.id; al final de la función.

// Crea la transacción pendiente usando ese ID como requestId
await createTransaction({
  ...withdrawRequest,
  requestId: withdrawDocRef, // <<--- AQUÍ VA EL ID
  description: `Solicitud de retiro - Bs. ${amountBs}`,
  admin: "Sistema"
});

      alert("✅ Solicitud de retiro enviada. Será verificada por administración.");
      setAmountBs("");
      setUserBank("");
      setUserPhone("");
      setUserCedula("");
      setUserName("");
      setAccountNumber("");
      setAccountType("Ahorro");
      setShowPaymentDetails(false);
      setSelectedMethod(null);
    } catch (error) {
      alert("❌ Error al enviar la solicitud");
    }
    setIsSubmitting(false);
  };

  if (loading || userData === null) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 flex items-center justify-center">
        <div className="text-white text-xl">Cargando...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-transparent via-black/20 to-black/60"></div>
      <header className="relative z-10 bg-black/40 backdrop-blur-lg border-b border-yellow-500/30 shadow-2xl">
        <div className="container mx-auto px-6 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => navigate('/lobby')}
                className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-xl transition-all duration-300 mr-4"
              >
                ← Volver al Lobby
              </button>
              <div className="text-3xl font-bold bg-gradient-to-r from-yellow-400 to-yellow-200 bg-clip-text text-transparent">
                💸 RETIRAR SALDO
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 container mx-auto px-6 py-8">
        <div className="max-w-4xl mx-auto">
          {!showPaymentDetails ? (
            <div className="mb-8">
              <h3 className="text-2xl font-bold text-white mb-6 text-center">Selecciona Método de Retiro</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                      <button className="bg-yellow-600 hover:bg-yellow-500 text-white font-semibold py-2 px-4 rounded-lg transition-all">
                        Seleccionar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="bg-white/10 rounded-2xl p-8 backdrop-blur-lg border border-white/20">
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

              <div className="bg-yellow-500/20 rounded-xl p-6 border border-yellow-500/30 mb-6">
                <h4 className="font-bold text-white mb-4 text-lg flex items-center">
                  💡 {paymentMethods.find(m => m.id === selectedMethod)?.instructions}
                </h4>
                <div className="mt-4 p-3 bg-yellow-500/20 rounded-lg border border-yellow-500/30">
                  <div className="text-yellow-300 text-sm font-semibold">💡 Importante:</div>
                  <div className="text-white/80 text-sm">
                    • El retiro será procesado por administración en 1-2 horas<br />
                    • Asegúrate de que tus datos sean correctos<br />
                    • El monto será debitado de tu saldo al aprobarse el retiro
                  </div>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-white font-semibold mb-3 text-lg">
                      💵 Monto a Retirar (Bolívares)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="1"
                      value={amountBs}
                      onChange={(e) => setAmountBs(e.target.value.replace(/[^0-9.]/g, ""))}
                      placeholder="Ej: 100.00"
                      className="w-full p-4 rounded-xl bg-white/10 border-2 border-white/20 text-white text-lg focus:outline-none focus:border-yellow-500 transition-all"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-white font-semibold mb-3 text-lg">
                      💲 Equivalente en Dólares
                    </label>
                    <div className="p-4 rounded-xl bg-white/10 border-2 border-white/20">
                      <div className="text-white text-3xl font-bold">$ {calculateUSD()}</div>
                      <div className="text-white/70 text-sm mt-2">Tasa del día: 1 USD = {exchangeRate} Bs</div>
                      <div className="text-yellow-300 text-xs mt-1">💰 Tasa actualizada desde BCV</div>
                      <div className="text-green-400 text-sm mt-2">Saldo disponible: Bs. {userData.balance?.toLocaleString()}</div>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-white font-semibold mb-3 text-lg">
                      📅 Fecha y Hora de Solicitud
                    </label>
                    <div className="p-4 rounded-xl bg-white/10 border-2 border-white/20 text-white text-lg">
                      {liveDate.toLocaleDateString("es-VE")} {liveDate.toLocaleTimeString("es-VE")}
                    </div>
                  </div>
                </div>
                {/* Campos para datos del usuario */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-white font-semibold mb-3 text-lg">
                      🏦 Banco destino
                    </label>
                    <select
                      value={userBank}
                      onChange={(e) => setUserBank(e.target.value)}
                      className="w-full p-4 rounded-xl bg-white/10 border-2 border-white/20 text-black text-lg focus:outline-none focus:border-yellow-500 transition-all"
                      style={{ color: "#222" }}
                      required
                    >
                      <option value="" style={{ color: "#222" }}>Selecciona tu banco</option>
                      {BANKS_VENEZUELA.map(b => (
                        <option key={b.code} value={`${b.code} - ${b.name}`} style={{ color: "#222" }}>
                          {b.name} ({b.code})
                        </option>
                      ))}
                    </select>
                  </div>
                  {selectedMethod === "transferencia" && (
                    <>
                      <div>
                        <label className="block text-white font-semibold mb-3 text-lg">
                          🏦 Número de cuenta
                        </label>
                        <input
                          type="text"
                          value={accountNumber}
                          onChange={handleAccountNumberChange}
                          placeholder="Ej: 0123-4567-8901-23456789"
                          className="w-full p-4 rounded-xl bg-white/10 border-2 border-white/20 text-white text-lg focus:outline-none focus:border-yellow-500 transition-all"
                          required
                          maxLength={23}
                        />
                      </div>
                      <div>
                        <label className="block text-white font-semibold mb-3 text-lg">
                          🏦 Tipo de cuenta
                        </label>
                        <select
                          value={accountType}
                          onChange={(e) => setAccountType(e.target.value)}
                          className="w-full p-4 rounded-xl bg-white/10 border-2 border-white/20 text-black text-lg focus:outline-none focus:border-yellow-500 transition-all"
                          style={{ color: "#222" }}
                          required
                        >
                          <option value="Ahorro" style={{ color: "#222" }}>Ahorro</option>
                          <option value="Corriente" style={{ color: "#222" }}>Corriente</option>
                        </select>
                      </div>
                    </>
                  )}
                  {selectedMethod === "pago_movil" && (
                    <div>
                      <label className="block text-white font-semibold mb-3 text-lg">
                        📱 Teléfono
                      </label>
                      <input
                        type="text"
                        value={userPhone}
                        onChange={handlePhoneChange}
                        placeholder="Ej: 04141234567"
                        className="w-full p-4 rounded-xl bg-white/10 border-2 border-white/20 text-white text-lg focus:outline-none focus:border-yellow-500 transition-all"
                        required
                        maxLength={11}
                      />
                    </div>
                  )}
                  <div>
                    <label className="block text-white font-semibold mb-3 text-lg">
                      🆔 Cédula del titular
                    </label>
                    <input
                      type="text"
                      value={userCedula}
                      onChange={(e) => setUserCedula(e.target.value.replace(/[^0-9VvEe-]/g, ""))}
                      placeholder="Ej: V-12345678"
                      className="w-full p-4 rounded-xl bg-white/10 border-2 border-white/20 text-white text-lg focus:outline-none focus:border-yellow-500 transition-all"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-white font-semibold mb-3 text-lg">
                      👤 Nombre del titular
                    </label>
                    <input
                      type="text"
                      value={userName}
                      onChange={(e) => setUserName(e.target.value)}
                      placeholder="Ej: Juan Pérez"
                      className="w-full p-4 rounded-xl bg-white/10 border-2 border-white/20 text-white text-lg focus:outline-none focus:border-yellow-500 transition-all"
                      required
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={isSubmitting || parseFloat(amountBs) > (userData.balance || 0)}
                  className="w-full bg-gradient-to-r from-yellow-600 to-yellow-500 hover:from-yellow-500 hover:to-yellow-400 text-white font-bold py-4 rounded-xl text-lg transition-all duration-300 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-yellow-500/25"
                >
                  {isSubmitting ? "🔄 ENVIANDO SOLICITUD..." : "✅ ENVIAR SOLICITUD DE RETIRO"}
                </button>
              </form>
            </div>
          )}
        </div>
        {/* Modal legal */}
        {showLegalModal && (
          <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-8 max-w-lg w-full shadow-2xl">
              <h2 className="text-xl font-bold mb-4 text-gray-900">Confirmación Legal</h2>
              <p className="text-gray-800 mb-6">
                Al enviar esta solicitud de retiro, usted declara y acepta que los datos proporcionados son correctos y verídicos. 
                Usted asume total responsabilidad legal sobre la información suministrada y autoriza a Oriluck C.A. a procesar el retiro con base en estos datos. 
                Cualquier error, falsedad o incongruencia en los datos será responsabilidad exclusiva del solicitante. 
                El retiro será procesado según las políticas y tiempos establecidos por la empresa.
              </p>
              <div className="flex justify-end space-x-4">
                <button
                  onClick={() => setShowLegalModal(false)}
                  className="bg-gray-400 hover:bg-gray-500 text-white font-semibold px-6 py-2 rounded-lg"
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmLegalAndSend}
                  className="bg-yellow-600 hover:bg-yellow-500 text-white font-semibold px-6 py-2 rounded-lg"
                >
                  Acepto y Enviar Solicitud
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default Withdraw;