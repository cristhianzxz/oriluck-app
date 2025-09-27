import React, { useState, useEffect } from 'react';
import { addMessageToTicket, updateTicketData } from '../firestoreService';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

const SupportChat = ({ ticket, currentUser, onBack }) => {
  // 🔥 CORRECCIÓN 1: Usaremos un solo estado para el ticket, que se actualiza en tiempo real.
  const [currentTicket, setCurrentTicket] = useState(ticket);
  const [newMessage, setNewMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!ticket?.id) return;

    const ticketRef = doc(db, 'supportTickets', ticket.id);

    const unsubscribe = onSnapshot(ticketRef, (docSnap) => {
      if (docSnap.exists()) {
        const ticketData = docSnap.data();
        // Actualizamos el estado del ticket completo. Esto disparará la re-renderización.
        setCurrentTicket({ id: docSnap.id, ...ticketData });

        // Marcar como leído por el usuario al ver el chat
        if (ticketData.hasUnreadForUser) {
          updateTicketData(ticket.id, { hasUnreadForUser: false });
        }
      }
    });

    return () => unsubscribe();
  }, [ticket.id]);

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || isSubmitting) return;

    setIsSubmitting(true);
    
    try {
      const messageData = {
        sender: currentUser.uid,
        senderType: 'user',
        message: newMessage.trim()
      };
      
      // Al enviar, marcamos que ahora el admin tiene un mensaje sin leer.
      // onSnapshot se encargará de actualizar la UI automáticamente.
      const success = await addMessageToTicket(ticket.id, messageData, { hasUnreadForAdmin: true });
      
      if (success) {
        setNewMessage('');
      } else {
        alert('❌ Error al enviar el mensaje');
      }
    } catch (error) {
      console.error('Error enviando mensaje:', error);
      alert('❌ Error al enviar el mensaje');
    }
    
    setIsSubmitting(false);
  };

  const formatTime = (timestamp) => {
    if (!timestamp?.toDate) return '';
    return timestamp.toDate().toLocaleTimeString('es-VE', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  const formatDate = (timestamp) => {
    if (!timestamp?.toDate) return '';
    return timestamp.toDate().toLocaleDateString('es-VE');
  };

  return (
    <div className="bg-white/10 rounded-2xl border border-white/20">
      {/* Header del chat */}
      <div className="p-6 border-b border-white/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <button
              onClick={onBack}
              className="bg-gray-600 hover:bg-gray-500 text-white p-2 rounded-lg transition-all"
            >
              ←
            </button>
            <div>
              <h3 className="text-xl font-bold text-white">{currentTicket.subject}</h3>
              <div className="flex items-center space-x-4 text-sm text-white/70">
                <span>Ticket #{currentTicket.ticketId}</span>
                <span>Categoría: {currentTicket.category}</span>
                <span className={`px-2 py-1 rounded-full text-xs ${
                  currentTicket.status === 'abierto' ? 'bg-yellow-500/20 text-yellow-300' :
                  currentTicket.status === 'en_proceso' ? 'bg-blue-500/20 text-blue-300' :
                  'bg-green-500/20 text-green-300'
                }`}>
                  {currentTicket.status}
                </span>
              </div>
            </div>
          </div>
          <div className="text-white/60 text-sm">
            Creado: {formatDate(currentTicket.createdAt)}
          </div>
        </div>
      </div>

      {/* Mostrar admin asignado */}
      {currentTicket.status === 'en_proceso' && currentTicket.assignedAdmin && (
        <div className="p-2 bg-blue-500/20 text-center text-sm text-blue-300">
          Estás siendo atendido por: {currentTicket.assignedAdmin}
        </div>
      )}

      {/* Área de mensajes */}
      <div className="h-96 overflow-y-auto p-6 space-y-4">
        {/* 🔥 CORRECCIÓN 2: Mapear directamente desde currentTicket.messages */}
        {(currentTicket.messages || []).map((message, index) => (
          <div
            key={index}
            className={`flex ${message.senderType === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-md rounded-2xl p-4 ${
                message.senderType === 'user'
                  ? 'bg-blue-500/20 border border-blue-500/30 rounded-br-none'
                  : 'bg-gray-500/20 border border-gray-500/30 rounded-bl-none'
              }`}
            >
              <p className="text-white text-sm">{message.message}</p>
              <div className="flex justify-between items-center mt-2">
                <span className="text-xs text-white/50">
                  {message.senderType === 'user' ? 'Tú' : 'Soporte'}
                </span>
                <span className="text-xs text-white/50">
                  {formatTime(message.timestamp)}
                </span>
              </div>
            </div>
          </div>
        ))}
        
        {(!currentTicket.messages || currentTicket.messages.length === 0) && (
          <div className="text-center py-12 text-white/60">
            <div className="text-4xl mb-2">💬</div>
            <p>No hay mensajes aún</p>
            <p className="text-sm">Sé el primero en escribir</p>
          </div>
        )}
      </div>

      {/* Formulario de mensaje */}
      <div className="p-6 border-t border-white/10">
        {currentTicket.status === 'resuelto' ? (
          <div className="text-center p-4 bg-green-500/20 rounded-lg text-green-300">
            Este ticket ha sido resuelto. Si tienes otra consulta, por favor crea un nuevo ticket.
          </div>
        ) : (
          <form onSubmit={handleSendMessage} className="flex space-x-4">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Escribe tu mensaje..."
              className="flex-1 p-4 rounded-xl bg-white/10 border border-white/20 text-white focus:outline-none focus:border-blue-500"
              disabled={isSubmitting}
            />
            <button
              type="submit"
              disabled={isSubmitting || !newMessage.trim()}
              className="bg-blue-600 hover:bg-blue-500 text-white px-6 rounded-xl font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {isSubmitting ? '🔄' : '📤'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default SupportChat;