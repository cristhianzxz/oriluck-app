import React, { useState, useEffect } from 'react';
import { addMessageToTicket, updateTicketData, getUserData } from '../firestoreService';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

const AdminSupportPanel = ({ currentUser }) => {
  const [tickets, setTickets] = useState([]);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [replyMessage, setReplyMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState('all');
  const [adminUserData, setAdminUserData] = useState(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const loadAdminData = async () => {
      if (currentUser) {
        const data = await getUserData(currentUser.uid);
        setAdminUserData(data);
      }
    };
    loadAdminData();
  }, [currentUser]);

  useEffect(() => {
    setLoading(true);
    const ticketsQuery = query(collection(db, 'supportTickets'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(ticketsQuery, (snapshot) => {
      const allTickets = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setTickets(allTickets);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (selectedTicket) {
      const updatedTicket = tickets.find(t => t.id === selectedTicket.id);
      if (updatedTicket) setSelectedTicket(updatedTicket);
    }
  }, [tickets]);

  const handleSelectTicket = async (ticket) => {
    setSelectedTicket(ticket);
    if (ticket.hasUnreadForAdmin) {
      await updateTicketData(ticket.id, { hasUnreadForAdmin: false });
    }
  };

  const handleReply = async () => {
    if (!selectedTicket || !replyMessage.trim() || sending) return;
    setSending(true);
    try {
      const messageData = {
        sender: currentUser.uid,
        senderType: 'admin',
        message: replyMessage.trim()
      };
      await addMessageToTicket(selectedTicket.id, messageData, { hasUnreadForUser: true });
      setReplyMessage('');
    } catch (error) {
      console.error('Error enviando mensaje:', error);
      alert('❌ Error al enviar el mensaje');
    }
    setSending(false);
  };

  const handleStatusChange = async (newStatus) => {
    if (!selectedTicket) return;
    const updateData = { status: newStatus };

    if (newStatus === 'en_proceso') {
      updateData.assignedAdmin = adminUserData?.username || currentUser.email;
      updateData.resolvedByAdmin = null; // permitimos reabrir, borramos resolvedByAdmin
    } else if (newStatus === 'abierto') {
      updateData.assignedAdmin = null;
      updateData.resolvedByAdmin = null;
    } else if (newStatus === 'resuelto') {
      updateData.resolvedByAdmin = adminUserData?.username || currentUser.email;
    }

    const success = await updateTicketData(selectedTicket.id, updateData);
    if (!success) {
      alert('❌ Error al actualizar el estado');
    }
  };

  const filteredTickets = tickets.filter(ticket => {
    if (activeFilter === 'all') return true;
    return ticket.status === activeFilter;
  });

  const formatTime = (timestamp) => {
    if (!timestamp?.toDate) return '';
    const date = timestamp.toDate();
    return `${date.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: '2-digit' })} ${date.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}`;
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-2 sm:p-6">
      <h1 className="text-2xl sm:text-3xl font-bold mb-4 sm:mb-6 text-center sm:text-left">Panel de Soporte Administrativo</h1>
      <div className="flex flex-col lg:flex-row gap-6 sm:gap-8 max-w-7xl mx-auto">
        {/* Lista de Tickets */}
        <section className="lg:w-[32%] w-full bg-gray-800 p-3 sm:p-6 rounded-lg flex-shrink-0">
          <h2 className="text-xl font-semibold mb-4 text-center sm:text-left">Tickets de Soporte</h2>
          <div className="flex flex-wrap gap-2 justify-center sm:justify-start mb-4">
            <button onClick={() => setActiveFilter('all')} className={`px-3 py-1 rounded-full text-sm transition ${activeFilter === 'all' ? 'bg-blue-500' : 'bg-gray-700 hover:bg-gray-600'}`}>Todos</button>
            <button onClick={() => setActiveFilter('abierto')} className={`px-3 py-1 rounded-full text-sm transition ${activeFilter === 'abierto' ? 'bg-yellow-500' : 'bg-gray-700 hover:bg-gray-600'}`}>Abiertos</button>
            <button onClick={() => setActiveFilter('en_proceso')} className={`px-3 py-1 rounded-full text-sm transition ${activeFilter === 'en_proceso' ? 'bg-blue-500' : 'bg-gray-700 hover:bg-gray-600'}`}>En Proceso</button>
            <button onClick={() => setActiveFilter('resuelto')} className={`px-3 py-1 rounded-full text-sm transition ${activeFilter === 'resuelto' ? 'bg-green-500' : 'bg-gray-700 hover:bg-gray-600'}`}>Resueltos</button>
          </div>
          {loading ? <p className="text-center text-gray-400">Cargando tickets...</p> : (
            <div className="space-y-3 max-h-[60vh] overflow-y-auto scrollbar-thin scrollbar-thumb-blue-500/20 scrollbar-track-transparent">
              {filteredTickets.length === 0 ? (
                <div className="py-12 text-center text-gray-500">No hay tickets para este filtro.</div>
              ) : (
                filteredTickets.map(ticket => (
                  <div key={ticket.id}
                    onClick={() => handleSelectTicket(ticket)}
                    className={`p-4 rounded-lg cursor-pointer relative transition ${
                      selectedTicket?.id === ticket.id ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'
                    }`}>
                    {ticket.hasUnreadForAdmin && (
                      <span className="absolute top-2 right-2 w-3 h-3 bg-blue-400 rounded-full animate-pulse"></span>
                    )}
                    <div className="flex flex-col gap-1">
                      <p className="font-bold truncate">{ticket.subject}</p>
                      <p className="text-xs text-gray-400 truncate">Usuario: {ticket.userName}</p>
                      <p className="text-xs text-gray-500">{formatTime(ticket.createdAt)}</p>
                    </div>
                    <span className={`absolute bottom-2 right-2 text-xs px-2 py-0.5 rounded-full ${
                      ticket.status === 'abierto' ? 'bg-yellow-500/20 text-yellow-300' :
                      ticket.status === 'en_proceso' ? 'bg-blue-500/20 text-blue-300' :
                      'bg-green-500/20 text-green-300'
                    }`}>{ticket.status}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </section>

        {/* Detalle del Ticket y Chat */}
        <section className="lg:w-[68%] w-full bg-gray-800 p-3 sm:p-6 rounded-lg flex-grow min-h-[60vh] flex flex-col">
          {selectedTicket ? (
            <div className="flex flex-col h-full">
              <h2 className="text-xl sm:text-2xl font-bold mb-2">{selectedTicket.subject}</h2>
              <div className="text-gray-400 mb-4 text-xs sm:text-sm">
                <p>Usuario: <b>{selectedTicket.userName}</b> ({selectedTicket.email})</p>
                <p>Categoría: {selectedTicket.category}</p>
              </div>
              
              {(selectedTicket.status === 'en_proceso' && selectedTicket.assignedAdmin) && (
                <div className="mb-4 p-2 bg-blue-500/20 rounded-lg text-center text-sm text-blue-300">
                  Atendido por: <b>{selectedTicket.assignedAdmin}</b>
                </div>
              )}

              {selectedTicket.status === 'resuelto' && (
                <div className="mb-4 p-2 bg-green-500/20 rounded-lg text-center text-sm text-green-300">
                  Ticket resuelto por: <b>{selectedTicket.resolvedByAdmin || selectedTicket.assignedAdmin || "Admin"}</b>
                </div>
              )}

              <div className="mb-4 flex items-center space-x-4">
                <span className="font-semibold">Estado:</span>
                <select
                  value={selectedTicket.status}
                  onChange={(e) => handleStatusChange(e.target.value)}
                  className="bg-gray-700 p-2 rounded"
                >
                  <option value="abierto">Abierto</option>
                  <option value="en_proceso">En Proceso</option>
                  <option value="resuelto">Resuelto</option>
                </select>
              </div>

              <div className="flex-1 h-80 bg-gray-900 rounded p-2 sm:p-4 overflow-y-auto mb-4 space-y-4">
                {selectedTicket.messages?.length > 0 ? selectedTicket.messages.map((msg, index) => (
                  <div key={index} className={`flex ${msg.senderType === 'admin' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`p-3 rounded-lg max-w-xs sm:max-w-md ${msg.senderType === 'admin' ? 'bg-blue-600' : 'bg-gray-700'}`}>
                      <p className="text-sm break-words">{msg.message}</p>
                      <p className="text-xs text-gray-400 text-right mt-1">{formatTime(msg.timestamp)}</p>
                    </div>
                  </div>
                )) : (
                  <div className="text-center text-gray-500 py-8">No hay mensajes en este ticket.</div>
                )}
              </div>

              {selectedTicket.status === 'resuelto' ? (
                <div className="text-center p-4 bg-green-500/20 rounded-lg text-green-300">
                  Este ticket ha sido resuelto y cerrado.
                </div>
              ) : (
                <form className="flex flex-col sm:flex-row gap-2" onSubmit={e => { e.preventDefault(); handleReply(); }}>
                  <input 
                    type="text" 
                    value={replyMessage}
                    onChange={(e) => setReplyMessage(e.target.value)}
                    placeholder="Escribe tu respuesta..."
                    className="flex-1 bg-gray-700 p-3 rounded"
                    disabled={sending}
                  />
                  <button
                    onClick={handleReply}
                    disabled={!replyMessage.trim() || sending}
                    type="submit"
                    className="bg-blue-600 hover:bg-blue-500 px-6 py-3 rounded font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Enviar
                  </button>
                </form>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-gray-500">Selecciona un ticket para ver los detalles.</p>
            </div>
          )}
        </section>
      </div>
      <style>{`
        .scrollbar-thin::-webkit-scrollbar { width: 6px; background: transparent; }
        .scrollbar-thin::-webkit-scrollbar-thumb { border-radius: 6px; }
      `}</style>
    </div>
  );
};

export default AdminSupportPanel;