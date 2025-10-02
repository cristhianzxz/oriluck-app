import React, { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../../App';
import { doc, onSnapshot, collection, getDocs, addDoc, runTransaction, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../../firebase';

function SlotsAdmin() {
  const navigate = useNavigate();
  const { currentUser } = useContext(AuthContext);

  // Estados del componente
  const [machine, setMachine] = useState(null);
  const [exchangeRate, setExchangeRate] = useState(0); // Tasa de cambio que se usará para los slots
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState([]);
  
  // Estados para las acciones del admin
  const [resetPrizeLoading, setResetPrizeLoading] = useState(false);
  const [addFundAmount, setAddFundAmount] = useState('');
  const [addFundLoading, setAddFundLoading] = useState(false);

  // Efecto para cargar todos los datos necesarios
  useEffect(() => {
    // 1. Listener para los datos de la máquina de tragamonedas (bolsa, ganancias, etc.)
    const machineRef = doc(db, 'slotsMachines', 'main_machine');
    const unsubscribeMachine = onSnapshot(machineRef, (snap) => {
      if (snap.exists()) {
        setMachine({ id: snap.id, ...snap.data() });
      }
      if (loading) setLoading(false);
    });

    // --- INICIO DE LA CORRECCIÓN ---
    // 2. Listener para la TASA DE CAMBIO que tu index.js utiliza.
    // Apuntamos al documento 'exchangeRate' (singular) y leemos el campo 'rate'.
    const ratesRef = doc(db, 'appSettings', 'exchangeRate');
    const unsubscribeRates = onSnapshot(ratesRef, (snap) => {
      if (snap.exists()) {
        setExchangeRate(snap.data().rate || 0); // Leemos el campo 'rate'
      }
    });
    // --- FIN DE LA CORRECCIÓN ---

    // 3. Carga inicial de transacciones
    loadRecentTransactions();

    // Función de limpieza para desmontar los listeners
    return () => {
      unsubscribeMachine();
      unsubscribeRates();
    };
  }, [loading]); // Se mantiene 'loading' para evitar que se ejecute en cada re-render.

  // Carga las transacciones más recientes relacionadas con slots
  const loadRecentTransactions = async () => {
    try {
      const transactionsRef = collection(db, 'transactions');
      const q = query(
        transactionsRef, 
        orderBy('createdAt', 'desc'), 
        limit(20)
      );
      const querySnapshot = await getDocs(q);
      const transactionsData = querySnapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(tx => ['chips_purchase', 'slots_win', 'slots_fund', 'slots_reset'].includes(tx.type));

      setTransactions(transactionsData);
    } catch (error) {
      console.error('Error loading transactions:', error);
    }
  };

  // El resto de las funciones (resetPrizePool, addToPrizePool) no necesitan cambios.
  const resetPrizePool = async () => {
    if (!window.confirm('¿Estás seguro de que quieres resetear la bolsa de premios? Esto transferirá todo el saldo a ganancias de la casa.')) {
      return;
    }

    setResetPrizeLoading(true);
    const machineRef = doc(db, 'slotsMachines', 'main_machine');
    
    try {
      const prizePoolToReset = machine?.prizePool || 0;

      await runTransaction(db, async (transaction) => {
        const machineDoc = await transaction.get(machineRef);
        if (!machineDoc.exists()) throw new Error("La máquina no existe.");

        const currentData = machineDoc.data();
        const currentPrizePool = currentData.prizePool || 0;
        
        transaction.update(machineRef, {
          prizePool: 0,
          houseEarnings: (currentData.houseEarnings || 0) + currentPrizePool
        });
      });

      await addDoc(collection(db, 'transactions'), {
        type: 'slots_reset',
        amount: prizePoolToReset,
        description: `Reset de bolsa de premios transferido a ganancias`,
        admin: currentUser?.email,
        createdAt: new Date()
      });

      alert('✅ Bolsa de premios reseteada exitosamente.');
      await loadRecentTransactions();
    } catch (error) {
      console.error('Error resetting prize pool:', error);
      alert('❌ Error al resetear la bolsa de premios: ' + error.message);
    }
    setResetPrizeLoading(false);
  };

  const addToPrizePool = async () => {
    const amount = parseFloat(addFundAmount);
    if (!addFundAmount || isNaN(amount) || amount <= 0) {
      alert('Por favor ingresa un monto numérico válido y mayor a 0.');
      return;
    }

    setAddFundLoading(true);
    const machineRef = doc(db, 'slotsMachines', 'main_machine');

    try {
      await runTransaction(db, async (transaction) => {
        const machineDoc = await transaction.get(machineRef);
        if (!machineDoc.exists()) throw new Error("La máquina no existe.");

        transaction.update(machineRef, {
          prizePool: (machineDoc.data().prizePool || 0) + amount
        });
      });

      await addDoc(collection(db, 'transactions'), {
        type: 'slots_fund',
        amount: amount,
        description: `Fondo agregado a bolsa de premios por admin`,
        admin: currentUser?.email,
        createdAt: new Date()
      });

      alert(`✅ Se agregaron Bs. ${amount.toLocaleString('es-VE')} a la bolsa de premios.`);
      setAddFundAmount('');
      await loadRecentTransactions();
    } catch (error) {
      console.error('Error adding to prize pool:', error);
      alert('❌ Error al agregar fondos: ' + error.message);
    }
    setAddFundLoading(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 text-white">
        <div className="text-xl">Cargando panel de administración...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 text-white font-sans">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-center mb-8 bg-white/5 rounded-xl p-6">
          <div>
            <h1 className="text-4xl font-bold mb-2">🎰 ADMINISTRACIÓN DE TRAGAMONEDAS</h1>
            <p className="text-white/60">Gestión de la máquina y visualización de datos.</p>
          </div>
          <button 
            onClick={() => navigate('/admin')}
            className="bg-gray-600 hover:bg-gray-500 px-6 py-3 rounded-xl font-semibold transition-all mt-4 md:mt-0"
          >
            ← Volver al Panel Principal
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Columna Izquierda: Datos y Acciones */}
          <div className="space-y-6">
            <div className="bg-white/5 rounded-xl p-6 border border-purple-500/30">
              <h3 className="text-xl font-semibold mb-4 text-purple-300">📊 Estado Actual de la Máquina</h3>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-white/70">Bolsa de Premios:</span>
                  <span className="text-2xl font-bold text-green-400">
                    Bs. {machine?.prizePool?.toLocaleString('es-VE', {minimumFractionDigits: 2}) || '0.00'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-white/70">Ganancias de la Casa:</span>
                  <span className="text-xl font-bold text-blue-400">
                    Bs. {machine?.houseEarnings?.toLocaleString('es-VE', {minimumFractionDigits: 2}) || '0.00'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-white/70">Total Recaudado (Revenue):</span>
                  <span className="text-xl font-bold text-yellow-400">
                    Bs. {machine?.totalRevenue?.toLocaleString('es-VE', {minimumFractionDigits: 2}) || '0.00'}
                  </span>
                </div>
                {/* ESTE VALOR AHORA ES EL CORRECTO Y CONSISTENTE */}
                <div className="flex justify-between items-center pt-2 border-t border-white/10">
                  <span className="text-white/70">Tasa de Cambio (Slots):</span>
                  <span className="text-xl font-bold text-orange-400">
                    1 Ficha = {exchangeRate.toLocaleString('es-VE')} Bs.
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-white/5 rounded-xl p-6 border border-yellow-500/30">
              <h3 className="text-xl font-semibold mb-4 text-yellow-300">💰 Gestión de Bolsa</h3>
              <div className="space-y-4">
                <button
                  onClick={resetPrizePool}
                  disabled={resetPrizeLoading}
                  className="w-full bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold py-3 px-4 rounded-lg transition-all"
                >
                  {resetPrizeLoading ? '🔄 Procesando...' : 'Resetear Bolsa de Premios'}
                </button>
                <div className="flex gap-2">
                  <input
                    type="number"
                    placeholder="Monto en Bs."
                    value={addFundAmount}
                    onChange={(e) => setAddFundAmount(e.target.value)}
                    disabled={addFundLoading}
                    className="flex-1 p-3 rounded-lg bg-white/10 border border-white/20 text-white focus:outline-none focus:border-yellow-500 disabled:bg-gray-700"
                  />
                  <button
                    onClick={addToPrizePool}
                    disabled={addFundLoading}
                    className="bg-green-600 hover:bg-green-500 text-white font-bold py-3 px-4 rounded-lg transition-all disabled:opacity-50"
                  >
                    {addFundLoading ? '...' : 'Agregar'}
                  </button>
                </div>
                <p className="text-xs text-white/60">
                  Agrega fondos a la bolsa de premios manualmente (ej: por promociones).
                </p>
              </div>
            </div>
          </div>

          {/* Columna Derecha: Precios y Transacciones */}
          <div className="space-y-6">
            <div className="bg-white/5 rounded-xl p-6 border border-blue-500/30">
              <h3 className="text-xl font-semibold mb-4 text-blue-300">🎯 Precios de Fichas (Calculado)</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {[1, 5, 10, 20, 50, 100].map(value => {
                  const bsValue = value * exchangeRate; // Usa la tasa correcta
                  const chipColors = {
                    1: 'bg-blue-600', 5: 'bg-red-600', 10: 'bg-green-600',
                    20: 'bg-purple-600', 50: 'bg-orange-600', 100: 'bg-yellow-600'
                  };
                  return (
                    <div key={value} className={`${chipColors[value]} text-white rounded-lg p-3 text-center shadow-lg`}>
                      <div className="font-bold text-lg">{value} Fichas</div>
                      <div className="text-sm">Bs. {bsValue.toLocaleString('es-VE')}</div>
                    </div>
                  );
                })}
              </div>
            </div>
            
            <div className="bg-white/5 rounded-xl p-6 border border-cyan-500/30">
              <h3 className="text-xl font-semibold mb-4 text-cyan-300">📈 Transacciones Recientes</h3>
              <div className="overflow-y-auto max-h-80 pr-2">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/20">
                      <th className="text-left p-2">Tipo</th>
                      <th className="text-left p-2">Descripción</th>
                      <th className="text-right p-2">Monto (Bs)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((tx) => (
                      <tr key={tx.id} className="border-b border-white/10 hover:bg-white/5">
                        <td className="p-2">
                          <span className={`px-2 py-1 rounded text-xs font-semibold ${
                            tx.type === 'slots_win' ? 'bg-green-500/20 text-green-300' :
                            tx.type === 'chips_purchase' ? 'bg-blue-500/20 text-blue-300' :
                            tx.type === 'slots_fund' ? 'bg-yellow-500/20 text-yellow-300' :
                            'bg-red-500/20 text-red-300'
                          }`}>
                            {tx.type.replace('slots_', '').replace('_', ' ')}
                          </span>
                        </td>
                        <td className="p-2 text-white/80">{tx.description}</td>
                        <td className={`p-2 text-right font-mono ${tx.amount > 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {tx.amount > 0 ? '+' : ''}{tx.amount?.toLocaleString('es-VE', {minimumFractionDigits: 2})}
                        </td>
                      </tr>
                    ))}
                    {transactions.length === 0 && (
                      <tr>
                        <td colSpan="3" className="p-4 text-center text-white/60">
                          No hay transacciones de slots recientes.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SlotsAdmin;