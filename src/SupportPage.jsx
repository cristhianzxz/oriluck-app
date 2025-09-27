import React, { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from './App'; // Corregida la ruta de importación
import SupportTicketForm from './components/SupportTicketForm';
import SupportChat from './components/SupportChat';
import { db } from './firebase';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';

const SupportPage = () => {
  const { currentUser } = useContext(AuthContext);
  const navigate = useNavigate();
  const [view, setView] = useState('list'); // 'list', 'form', 'chat'
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);

  // Escuchar los tickets del usuario en tiempo real
  useEffect(() => {
    if (!currentUser) return;

    setLoading(true);
    const ticketsQuery = query(
      collection(db, 'supportTickets'),
      where('userId', '==', currentUser.uid),
      orderBy('updatedAt', 'desc')
    );

    const unsubscribe = onSnapshot(ticketsQuery, (snapshot) => {
      const userTickets = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setTickets(userTickets);
      setLoading(false);
    }, (error) => {
      console.error("Error escuchando tickets:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser]);

  const handleViewChat = (ticket) => {
    setSelectedTicket(ticket);
    setView('chat');
  };

  const getStatusClass = (status) => {
    switch (status) {
      case 'abierto': return 'bg-yellow-500/20 text-yellow-300';
      case 'en_proceso': return 'bg-blue-500/20 text-blue-300';
      case 'resuelto': return 'bg-green-500/20 text-green-300';
      default: return 'bg-gray-500/20 text-gray-300';
    }
  };

  if (!currentUser) {
    return <div className="min-h-screen bg-gray-900 flex items-center justify-center text-white">Cargando...</div>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 text-white p-8">
      <div className="container mx-auto">
        {view === 'list' && (
          <div className="bg-white/10 rounded-2xl p-8 border border-white/20">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-3xl font-bold">Centro de Soporte</h2>
              <div className="flex space-x-4">
                <button onClick={() => navigate('/lobby')} className="bg-gray-600 hover:bg-gray-500 text-white font-bold py-3 px-6 rounded-xl">
                  ← Volver al Lobby
                </button>
                <button onClick={() => setView('form')} className="bg-green-600 hover:bg-green-500 text-white font-bold py-3 px-6 rounded-xl">
                  ✉️ Nuevo Ticket
                </button>
              </div>
            </div>

            {loading ? (
              <p>Cargando tus tickets...</p>
            ) : tickets.length === 0 ? (
              <div className="text-center py-12 text-white/60">
                <div className="text-5xl mb-4">📭</div>
                <p className="text-xl">No tienes tickets abiertos.</p>
                <p>Crea uno nuevo si necesitas ayuda.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {tickets.map(ticket => (
                  <div
                    key={ticket.id}
                    onClick={() => handleViewChat(ticket)}
                    className="bg-gray-800/50 hover:bg-gray-700/50 p-6 rounded-xl cursor-pointer transition-all flex justify-between items-center relative"
                  >
                    {/* Notificación de mensaje no leído para el usuario */}
                    {ticket.hasUnreadForUser && (
                      <span className="absolute top-3 right-3 w-3 h-3 bg-blue-400 rounded-full animate-pulse"></span>
                    )}
                    <div>
                      <p className="font-bold text-lg">{ticket.subject}</p>
                      <p className="text-sm text-white/70">Ticket #{ticket.ticketId} • Categoría: {ticket.category}</p>
                    </div>
                    <div className="flex items-center space-x-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusClass(ticket.status)}`}>
                        {ticket.status.replace('_', ' ')}
                      </span>
                      <span className="text-2xl">›</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {view === 'form' && (
          <SupportTicketForm
            currentUser={currentUser}
            onTicketCreated={() => setView('list')}
            onCancel={() => setView('list')}
          />
        )}
        {view === 'chat' && selectedTicket && (
          <SupportChat
            ticket={selectedTicket}
            currentUser={currentUser}
            onBack={() => setView('list')}
          />
        )}
      </div>
    </div>
  );
};

export default SupportPage;