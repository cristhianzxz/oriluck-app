// En SupportTicketForm.jsx - CORREGIR el select
import React, { useState } from 'react';
import { createSupportTicket } from '../firestoreService';

const SupportTicketForm = ({ currentUser, onTicketCreated, onCancel }) => {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [category, setCategory] = useState('recargas');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const categories = [
    { value: 'recargas', label: '💰 Problemas con Recargas' },
    { value: 'retiros', label: '💳 Problemas con Retiros' },
    { value: 'tecnicos', label: '🔧 Problemas Técnicos' },
    { value: 'cuentas', label: '👤 Problemas de Cuenta' },
    { value: 'sugerencias', label: '💡 Sugerencias' },
    { value: 'otros', label: '❓ Otros' }
  ];

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) return;
    
    setIsSubmitting(true);
    
    try {
      const ticketData = {
        userId: currentUser.uid,
        username: currentUser.displayName || currentUser.email.split('@')[0],
        email: currentUser.email,
        subject: subject.trim(),
        message: message.trim(),
        category,
        priority: category === 'recargas' ? 'alto' : 'medio'
      };
      
      await createSupportTicket(ticketData);
      onTicketCreated();
      setSubject('');
      setMessage('');
      alert('✅ Ticket creado exitosamente');
    } catch (error) {
      console.error('Error creando ticket:', error);
      alert('❌ Error al crear el ticket');
    }
    
    setIsSubmitting(false);
  };

  return (
    <div className="bg-white/10 rounded-2xl p-8 border border-white/20">
      <h3 className="text-2xl font-bold text-white mb-6">✉️ Crear Nuevo Ticket</h3>
      
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-white mb-3 font-semibold">Categoría</label>
          {/* 🔥 CORRECCIÓN: Agregar estilo para texto blanco en las opciones */}
          <select 
            value={category} 
            onChange={(e) => setCategory(e.target.value)}
            className="w-full p-4 rounded-xl bg-white/10 border border-white/20 text-white focus:outline-none focus:border-blue-500"
          >
            {categories.map(cat => (
              <option 
                key={cat.value} 
                value={cat.value}
                className="bg-gray-800 text-white" // ← Estilo para las opciones
              >
                {cat.label}
              </option>
            ))}
          </select>
        </div>
        
        <div>
          <label className="block text-white mb-3 font-semibold">Asunto</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Ej: Recarga no acreditada después de 3 horas"
            className="w-full p-4 rounded-xl bg-white/10 border border-white/20 text-white focus:outline-none focus:border-blue-500"
            required
          />
        </div>
        
        <div>
          <label className="block text-white mb-3 font-semibold">Descripción Detallada</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Describe tu problema en detalle. Incluye fechas, montos, números de referencia, etc."
            rows="6"
            className="w-full p-4 rounded-xl bg-white/10 border border-white/20 text-white focus:outline-none focus:border-blue-500"
            required
          />
        </div>

        <div className="bg-blue-500/20 rounded-xl p-4 border border-blue-500/30">
          <h4 className="font-bold text-blue-300 mb-2">💡 Para una atención más rápida:</h4>
          <ul className="text-white/80 text-sm space-y-1">
            <li>• Incluye número de referencia si es una recarga</li>
            <li>• Especifica fecha y hora del problema</li>
            <li>• Adjunta capturas de pantalla si es posible</li>
            <li>• Tu ticket será atendido en 1-2 horas hábiles</li>
          </ul>
        </div>
        
        <div className="flex space-x-4">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 bg-gray-600 hover:bg-gray-500 text-white font-bold py-4 rounded-xl transition-all"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex-1 bg-green-600 hover:bg-green-500 text-white font-bold py-4 rounded-xl transition-all disabled:opacity-50"
          >
            {isSubmitting ? '🔄 Enviando...' : '📤 Enviar Ticket'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default SupportTicketForm;