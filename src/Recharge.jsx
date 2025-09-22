// src/components/Recharge.jsx
import React, { useState } from "react";

const Recharge = ({ userData }) => {
  const [selectedMethod, setSelectedMethod] = useState("pago_movil");
  const [amountUSD, setAmountUSD] = useState("");
  const [reference, setReference] = useState("");
  const [date, setDate] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Tasa del día (ejemplo)
  const exchangeRate = 100; // 1 USD = 100 Bs

  const calculateBs = () => {
    return amountUSD ? (parseFloat(amountUSD) * exchangeRate).toFixed(2) : "0.00";
  };

  const paymentMethods = [
    {
      id: "pago_movil",
      name: "Pago Móvil",
      icon: "📱",
      description: "Transferencia rápida desde tu móvil",
      banks: ["Banesco", "Mercantil", "Venezuela", "Bancaribe"]
    },
    {
      id: "transferencia",
      name: "Transferencia Bancaria", 
      icon: "🏦",
      description: "Transferencia desde tu banco",
      banks: ["Todos los bancos nacionales"]
    },
    {
      id: "binance",
      name: "Binance",
      icon: "₿",
      description: "Pago con criptomonedas",
      banks: ["USDT", "BTC", "ETH"]
    }
  ];

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    // Simular envío de solicitud
    setTimeout(() => {
      alert("✅ Solicitud de recarga enviada. Será verificada por administración.");
      setAmountUSD("");
      setReference("");
      setDate("");
      setIsSubmitting(false);
    }, 2000);
  };

  return (
    <div className="max-w-4xl mx-auto">
      <h2 className="text-4xl font-bold text-white text-center mb-8">
        💰 RECARGAR SALDO
      </h2>

      <div className="bg-white bg-opacity-10 rounded-2xl p-8">
        {/* Métodos de Pago */}
        <div className="mb-8">
          <h3 className="text-2xl font-bold text-white mb-4">Selecciona Método de Pago</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {paymentMethods.map((method) => (
              <div
                key={method.id}
                onClick={() => setSelectedMethod(method.id)}
                className={`p-4 rounded-lg cursor-pointer transition ${
                  selectedMethod === method.id
                    ? "bg-yellow-500 bg-opacity-30 border-2 border-yellow-400"
                    : "bg-white bg-opacity-5 border border-white border-opacity-20 hover:bg-opacity-10"
                }`}
              >
                <div className="text-3xl mb-2">{method.icon}</div>
                <h4 className="font-bold text-white">{method.name}</h4>
                <p className="text-white text-opacity-70 text-sm">{method.description}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Formulario de Recarga */}
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Monto en USD */}
            <div>
              <label className="block text-white font-semibold mb-2">
                Monto a Recargar (USD)
              </label>
              <input
                type="number"
                step="0.01"
                value={amountUSD}
                onChange={(e) => setAmountUSD(e.target.value)}
                placeholder="Ej: 10.00"
                className="w-full p-3 rounded-lg bg-white bg-opacity-10 border border-white border-opacity-20 text-white"
                required
              />
            </div>

            {/* Equivalente en Bs */}
            <div>
              <label className="block text-white font-semibold mb-2">
                Equivalente en Bolívares
              </label>
              <div className="p-3 rounded-lg bg-white bg-opacity-10 border border-white border-opacity-20">
                <div className="text-white text-2xl font-bold">Bs. {calculateBs()}</div>
                <div className="text-white text-opacity-70 text-sm">
                  Tasa del día: 1 USD = {exchangeRate} Bs
                </div>
              </div>
            </div>
          </div>

          {/* Información del Pago */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-white font-semibold mb-2">
                Número de Referencia
              </label>
              <input
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Número de referencia del pago"
                className="w-full p-3 rounded-lg bg-white bg-opacity-10 border border-white border-opacity-20 text-white"
                required
              />
            </div>

            <div>
              <label className="block text-white font-semibold mb-2">
                Fecha del Pago
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full p-3 rounded-lg bg-white bg-opacity-10 border border-white border-opacity-20 text-white"
                required
              />
            </div>
          </div>

          {/* Información Adicional */}
          <div className="bg-yellow-500 bg-opacity-20 rounded-lg p-4">
            <h4 className="font-bold text-white mb-2">💡 Información Importante</h4>
            <ul className="text-white text-opacity-80 text-sm space-y-1">
              <li>• Tu recarga será verificada en un plazo de 1-2 horas</li>
              <li>• Mantén el comprobante de pago a la mano</li>
              <li>• Para consultas: soporte@oriluck.com</li>
            </ul>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-green-500 text-white py-4 rounded-lg font-bold text-lg hover:bg-green-600 transition disabled:opacity-50"
          >
            {isSubmitting ? "🔄 ENVIANDO SOLICITUD..." : "✅ ENVIAR SOLICITUD DE RECARGA"}
          </button>
        </form>
      </div>
    </div>
  );
};

export default Recharge;