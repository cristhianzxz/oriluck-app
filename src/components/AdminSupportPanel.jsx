import React, { useState, useEffect } from 'react';
import { getAllSupportTickets, addMessageToTicket, updateTicketStatus } from '../firestoreService';

const AdminSupportPanel = ({ currentUser }) => {
  const [tickets, setTickets] = useState([]);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [replyMessage, setReplyMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState('all');

  useEffect(() => {
    loadTickets();
  }, []);

  const loadTickets = async () => {
    const allTickets = await getAllSupportTickets();
    setTickets(allTickets);
    setLoading(false);
  };

  const handleStatusChange = async (ticketId, newStatus) => {
    await updateTicketStatus(ticketId, newStatus, currentUser.uid);
    await loadTickets();

    // Actualizar el ticket seleccionado si es el mismo
    if (selectedTicket && selectedTicket.id === ticketId) {
      setSelectedTicket(prev => ({ ...prev, status: newStatus }));
    }
  };

  // ✅ Nueva función corregida
  const handleReply = async () => {
    if (!selectedTicket || !replyMessage.trim()) return;
  
    try {
      const messageData = {
        sender: currentUser.uid,
        senderType: 'admin',
        message: replyMessage.trim()
      };

      const success = await addMessageToTicket(selectedTicket.id, messageData);

      if (success) {
        // 🔥 ACTUALIZAR LOCALMENTE
        const newMessage = {
          sender: currentUser.uid,
          senderType: 'admin',
          message: replyMessage.trim(),
          timestamp: { toDate: () => new Date() }
        };

        const updatedMessages = [...(selectedTicket.messages || []), newMessage];

        // Actualizar el ticket seleccionado
        setSelectedTicket(prev => ({
          ...prev,
          messages: updatedMessages,
          status: 'en_proceso'
        }));

        // Actualizar la lista de tickets
        setTickets(prev => prev.map(ticket => 
          ticket.id === selectedTicket.id 
            ? { ...ticket, messages: updatedMessages, status: 'en_proceso' }
            : ticket
        ));

        setReplyMessage('');
        alert('✅ Mensaje enviado correctamente');
      } else {
        alert('❌ Error al enviar el mensaje');
      }
    } catch (error) {
      console.error('Error enviando mensaje:', error);
      alert('❌ Error al enviar el mensaje');
    }
  };

  const filteredTickets = tickets.filter(ticket => {
    if (activeFilter === 'all') return true;
    return ticket.status === activeFilter;
  });

  const getStatusColor = (status) => {
    switch(status) {
      case 'abierto': return 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30';
      case 'en_proceso': return 'bg-blue-500/20 text-blue-300 border-blue-500/30';
      case 'resuelto': return 'bg-green-500/20 text-green-300 border-green-500/30';
      case 'cerrado': return 'bg-gray-500/20 text-gray-300 border-gray-500/30';
      default: return 'bg-gray-500/20 text-gray-300 border-gray-500/30';
    }
  };

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="text-white text-xl">Cargando tickets...</div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Lista de Tickets */}
      <div className="lg:col-span-1">
        <div className="bg-white/10 rounded-2xl p-6 border border-white/20">
          <h3 className="text-2xl font-bold text-white mb-4">🎫 Tickets de Soporte</h3>
          
          {/* Filtros */}
          <div className="flex space-x-2 mb-4 overflow-x-auto">
            {['all', 'abierto', 'en_proceso', 'resuelto', 'cerrado'].map((filter) => (
              <button
                key={filter}
                onClick={() => setActiveFilter(filter)}
                className={`px-3 py-1 rounded-lg text-sm whitespace-nowrap transition-all ${
                  activeFilter === filter
                    ? 'bg-purple-600 text-white'
                    : 'bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                {filter === 'all' ? 'Todos' : 
                 filter === 'abierto' ? 'Abiertos' :
                 filter === 'en_proceso' ? 'En Proceso' :
                 filter === 'resuelto' ? 'Resueltos' : 'Cerrados'}
                <span className="ml-1 opacity-70">
                  ({filter === 'all' ? tickets.length : tickets.filter(t => t.status === filter).length})
                </span>
              </button>
            ))}
          </div>

          {/* Lista */}
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {filteredTickets.map((ticket) => (
              <div 
                key={ticket.id}
                className={`p-4 rounded-lg cursor-pointer transition-all ${
                  selectedTicket?.id === ticket.id 
                    ? 'bg-blue-500/20 border border-blue-500' 
                    : 'bg-white/5 border border-white/10 hover:bg-white/10'
                }`}
                onClick={() => setSelectedTicket(ticket)}
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1 min-w-0">
                    <h4 className="text-white font-semibold text-sm truncate">{ticket.subject}</h4>
                    <p className="text-white/70 text-xs truncate">{ticket.username}</p>
                    <p className="text-white/50 text-xs mt-1">#{ticket.ticketId}</p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded border ${getStatusColor(ticket.status)}`}>
                    {ticket.status}
                  </span>
                </div>
                <div className="text-white/50 text-xs mt-2">
                  Mensajes: {ticket.messages?.length || 1}
                </div>
              </div>
            ))}
            
            {filteredTickets.length === 0 && (
              <div className="text-center py-8 text-white/50">
                No hay tickets {activeFilter !== 'all' ? `con estado "${activeFilter}"` : ''}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Detalles del Ticket */}
      <div className="lg:col-span-2">
        {selectedTicket ? (
          <div className="bg-white/10 rounded-2xl p-6 border border-white/20">
            {/* Header del Ticket */}
            <div className="flex justify-between items-start mb-6">
              <div>
                <h3 className="text-xl font-bold text-white">{selectedTicket.subject}</h3>
                <div className="flex items-center space-x-4 text-white/70 text-sm mt-2">
                  <span>De: {selectedTicket.username} ({selectedTicket.email})</span>
                  <span>Ticket: #{selectedTicket.ticketId}</span>
                  <span>Categoría: {selectedTicket.category}</span>
                </div>
              </div>
              
              <div className="flex items-center space-x-2">
                <select 
                  value={selectedTicket.status}
                  onChange={(e) => handleStatusChange(selectedTicket.id, e.target.value)}
                  className="bg-black/30 text-white px-3 py-1 rounded border border-white/20"
                >
                  <option value="abierto">Abierto</option>
                  <option value="en_proceso">En Proceso</option>
                  <option value="resuelto">Resuelto</option>
                  <option value="cerrado">Cerrado</option>
                </select>
              </div>
            </div>

            {/* Mensajes */}
            <div className="space-y-4 mb-6 max-h-80 overflow-y-auto">
              {selectedTicket.messages?.map((msg, index) => (
                <div 
                  key={index} 
                  className={`p-4 rounded-lg ${
                    msg.senderType === 'admin' 
                      ? 'bg-blue-500/20 ml-8 border border-blue-500/30' 
                      : 'bg-gray-500/20 mr-8 border border-gray-500/30'
                  }`}
                >
                  <p className="text-white text-sm">{msg.message}</p>
                  <div className="flex justify-between items-center mt-2">
                    <span className="text-xs text-white/50">
                      {msg.senderType === 'admin' ? 'Soporte' : selectedTicket.username}
                    </span>
                    <span className="text-xs text-white/50">
                      {msg.timestamp?.toDate?.()?.toLocaleString('es-VE') || 'Fecha no disponible'}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Respuesta del Admin */}
            <div>
              <textarea
                value={replyMessage}
                onChange={(e) => setReplyMessage(e.target.value)}
                placeholder="Escribe tu respuesta..."
                rows="3"
                className="w-full p-4 rounded-xl bg-white/10 border border-white/20 text-white focus:outline-none focus:border-green-500"
              />
              <div className="flex justify-between items-center mt-3">
                <span className="text-white/50 text-sm">
                  Respondiendo como: {currentUser.email}
                </span>
                <button
                  onClick={handleReply}
                  disabled={!replyMessage.trim()}
                  className="bg-green-600 hover:bg-green-500 text-white px-6 py-2 rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  📤 Enviar Respuesta
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white/10 rounded-2xl p-12 border border-white/20 text-center">
            <div className="text-6xl mb-4">💬</div>
            <h3 className="text-xl font-bold text-white mb-2">Selecciona un ticket</h3>
            <p className="text-white/70">Elige un ticket de la lista para ver los detalles y responder</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminSupportPanel;
