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

  // Cargar los datos del admin (como el username)
  useEffect(() => {
    const loadAdminData = async () => {
      if (currentUser) {
        const data = await getUserData(currentUser.uid);
        setAdminUserData(data);
      }
    };
    loadAdminData();
  }, [currentUser]);

  // Listener principal para la colección de tickets
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

  // Sincronizar selectedTicket con la lista principal
  useEffect(() => {
    if (selectedTicket) {
      const updatedTicket = tickets.find(t => t.id === selectedTicket.id);
      if (updatedTicket) {
        setSelectedTicket(updatedTicket);
      }
    }
  }, [tickets]);

  // Marcar ticket como leído por el admin
  const handleSelectTicket = async (ticket) => {
    setSelectedTicket(ticket);
    if (ticket.hasUnreadForAdmin) {
      await updateTicketData(ticket.id, { hasUnreadForAdmin: false });
    }
  };

  const handleReply = async () => {
    if (!selectedTicket || !replyMessage.trim()) return;
  
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
  };

  const handleStatusChange = async (newStatus) => {
    if (!selectedTicket) return;

    const updateData = { status: newStatus };

    if (newStatus === 'en_proceso') {
      // Usar el nombre de usuario del admin en lugar del email
      updateData.assignedAdmin = adminUserData?.username || currentUser.email;
    } else if (newStatus === 'abierto') {
      updateData.assignedAdmin = null;
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
    return timestamp.toDate().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <h1 className="text-3xl font-bold mb-6">Panel de Soporte</h1>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Lista de Tickets */}
        <div className="lg:col-span-1 bg-gray-800 p-6 rounded-lg">
          <h2 className="text-xl font-semibold mb-4">Tickets de Soporte</h2>
          <div className="flex space-x-2 mb-4">
            <button onClick={() => setActiveFilter('all')} className={`px-3 py-1 rounded-full text-sm ${activeFilter === 'all' ? 'bg-blue-500' : 'bg-gray-700'}`}>Todos</button>
            <button onClick={() => setActiveFilter('abierto')} className={`px-3 py-1 rounded-full text-sm ${activeFilter === 'abierto' ? 'bg-yellow-500' : 'bg-gray-700'}`}>Abiertos</button>
            <button onClick={() => setActiveFilter('en_proceso')} className={`px-3 py-1 rounded-full text-sm ${activeFilter === 'en_proceso' ? 'bg-blue-500' : 'bg-gray-700'}`}>En Proceso</button>
            <button onClick={() => setActiveFilter('resuelto')} className={`px-3 py-1 rounded-full text-sm ${activeFilter === 'resuelto' ? 'bg-green-500' : 'bg-gray-700'}`}>Resueltos</button>
          </div>
          {loading ? <p>Cargando tickets...</p> : (
            <div className="space-y-3 max-h-[60vh] overflow-y-auto">
              {filteredTickets.map(ticket => (
                <div key={ticket.id} onClick={() => handleSelectTicket(ticket)} className={`p-4 rounded-lg cursor-pointer relative ${selectedTicket?.id === ticket.id ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
                  {ticket.hasUnreadForAdmin && (
                    <span className="absolute top-2 right-2 w-3 h-3 bg-blue-400 rounded-full animate-pulse"></span>
                  )}
                  <p className="font-bold">{ticket.subject}</p>
                  <p className="text-sm text-gray-400">Usuario: {ticket.userName}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${ticket.status === 'abierto' ? 'bg-yellow-500/20 text-yellow-300' : ticket.status === 'en_proceso' ? 'bg-blue-500/20 text-blue-300' : 'bg-green-500/20 text-green-300'}`}>{ticket.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Detalle del Ticket y Chat */}
        <div className="lg:col-span-2 bg-gray-800 p-6 rounded-lg">
          {selectedTicket ? (
            <div>
              <h2 className="text-2xl font-bold mb-2">{selectedTicket.subject}</h2>
              <div className="text-gray-400 mb-4">
                <p>Usuario: {selectedTicket.userName} ({selectedTicket.email})</p>
                <p>Categoría: {selectedTicket.category}</p>
              </div>
              
              {selectedTicket.status === 'en_proceso' && selectedTicket.assignedAdmin && (
                <div className="mb-4 p-2 bg-blue-500/20 rounded-lg text-center text-sm text-blue-300">
                  Atendido por: {selectedTicket.assignedAdmin}
                </div>
              )}

              <div className="mb-4 flex items-center space-x-4">
                <span className="font-semibold">Estado:</span>
                <select value={selectedTicket.status} onChange={(e) => handleStatusChange(e.target.value)} className="bg-gray-700 p-2 rounded">
                  <option value="abierto">Abierto</option>
                  <option value="en_proceso">En Proceso</option>
                  <option value="resuelto">Resuelto</option>
                </select>
              </div>

              <div className="h-80 bg-gray-900 rounded p-4 overflow-y-auto mb-4 space-y-4">
                {selectedTicket.messages?.map((msg, index) => (
                  <div key={index} className={`flex ${msg.senderType === 'admin' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`p-3 rounded-lg max-w-md ${msg.senderType === 'admin' ? 'bg-blue-600' : 'bg-gray-700'}`}>
                      <p className="text-sm">{msg.message}</p>
                      <p className="text-xs text-gray-400 text-right mt-1">{formatTime(msg.timestamp)}</p>
                    </div>
                  </div>
                ))}
              </div>

              {selectedTicket.status === 'resuelto' ? (
                <div className="text-center p-4 bg-green-500/20 rounded-lg text-green-300">
                  Este ticket ha sido resuelto y cerrado.
                </div>
              ) : (
                <div className="flex space-x-4">
                  <input 
                    type="text" 
                    value={replyMessage}
                    onChange={(e) => setReplyMessage(e.target.value)}
                    placeholder="Escribe tu respuesta..."
                    className="flex-1 bg-gray-700 p-3 rounded"
                  />
                  <button onClick={handleReply} className="bg-blue-600 hover:bg-blue-500 px-6 py-3 rounded font-semibold">Enviar</button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-gray-500">Selecciona un ticket para ver los detalles.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminSupportPanel;