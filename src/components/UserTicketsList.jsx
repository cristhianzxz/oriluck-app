import React, { useState, useEffect } from 'react';
import { getUserSupportTickets } from '../firestoreService';

const UserTicketsList = ({ currentUser, onTicketSelect }) => {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadTickets = async () => {
      const userTickets = await getUserSupportTickets(currentUser.uid);
      setTickets(userTickets);
      setLoading(false);
    };
    loadTickets();
  }, [currentUser.uid]);

  const getStatusColor = (status) => {
    switch(status) {
      case 'abierto': return 'text-yellow-400 bg-yellow-400/20 border-yellow-400/30';
      case 'en_proceso': return 'text-blue-400 bg-blue-400/20 border-blue-400/30';
      case 'resuelto': return 'text-green-400 bg-green-400/20 border-green-400/30';
      case 'cerrado': return 'text-gray-400 bg-gray-400/20 border-gray-400/30';
      default: return 'text-gray-400 bg-gray-400/20 border-gray-400/30';
    }
  };

  const getStatusText = (status) => {
    switch(status) {
      case 'abierto': return 'Abierto';
      case 'en_proceso': return 'En Proceso';
      case 'resuelto': return 'Resuelto';
      case 'cerrado': return 'Cerrado';
      default: return status;
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
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-2xl font-bold text-white">📋 Mis Tickets de Soporte</h3>
        <div className="text-white/70">
          {tickets.length} ticket{tickets.length !== 1 ? 's' : ''}
        </div>
      </div>
      
      {tickets.length === 0 ? (
        <div className="text-center py-12 bg-white/5 rounded-2xl border border-white/10">
          <div className="text-6xl mb-4">📭</div>
          <p className="text-white/70 text-lg mb-2">No tienes tickets de soporte</p>
          <p className="text-white/50">¿Necesitas ayuda? Crea tu primer ticket de soporte</p>
        </div>
      ) : (
        <div className="space-y-4">
          {tickets.map(ticket => (
            <div 
              key={ticket.id} 
              className="bg-white/5 rounded-xl p-6 border border-white/10 hover:bg-white/10 transition-all cursor-pointer"
              onClick={() => onTicketSelect(ticket)}
            >
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h4 className="text-white font-semibold text-lg">{ticket.subject}</h4>
                  <p className="text-white/70 text-sm mt-1">{ticket.message.substring(0, 100)}...</p>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${getStatusColor(ticket.status)}`}>
                  {getStatusText(ticket.status)}
                </span>
              </div>
              
              <div className="flex justify-between items-center text-sm text-white/60">
                <div className="flex space-x-4">
                  <span>#{ticket.ticketId}</span>
                  <span>Categoría: {ticket.category}</span>
                  <span>Mensajes: {ticket.messages?.length || 1}</span>
                </div>
                <span>
                  {ticket.createdAt?.toDate?.()?.toLocaleDateString() || 'Fecha no disponible'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default UserTicketsList;