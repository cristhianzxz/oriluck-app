import React, { useState, useEffect, useRef } from 'react';
import { addMessageToTicket, updateTicketData, getUserData } from '../firestoreService';
import { collection, query, orderBy, onSnapshot, where, doc, updateDoc, arrayUnion, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

const AdminSupportPanel = ({ currentUser }) => {
  const [tickets, setTickets] = useState([]);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [replyMessage, setReplyMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState('all');
  const [adminUserData, setAdminUserData] = useState(null);
  const [sending, setSending] = useState(false);

  const [assignedTickets, setAssignedTickets] = useState([]);
  const [activeList, setActiveList] = useState('all');
  const [notificationMessage, setNotificationMessage] = useState('');
  const [isReassignModalOpen, setIsReassignModalOpen] = useState(false);
  const [selectedTicketUserData, setSelectedTicketUserData] = useState(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');

  const [internalNote, setInternalNote] = useState('');

  // NUEVO: estado para controlar el panel lateral de notas
  const [isNotesPanelOpen, setIsNotesPanelOpen] = useState(false);

  const isInitialAssignedLoad = useRef(true);
  const messagesScrollRef = useRef(null);

  const [notificationSound] = useState(new Audio('/notification.mp3'));

  const ROLE_HIERARCHY = {
    support_agent: 1,
    moderator: 2,
    supervisor: 3,
    admin: 4,
  };

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
    if (!adminUserData?.role) return;

    setLoading(true);

    const allTicketsQuery = query(collection(db, 'supportTickets'), orderBy('createdAt', 'desc'));
    const unsubscribeAll = onSnapshot(allTicketsQuery, (snapshot) => {
      setTickets(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });

    const assignedQuery = query(
      collection(db, 'supportTickets'),
      where('assignedRole', '==', adminUserData.role),
      orderBy('createdAt', 'desc')
    );

    const unsubscribeAssigned = onSnapshot(assignedQuery, (snapshot) => {
      const assignedTicketsData = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      const changes = snapshot.docChanges();

      if (isInitialAssignedLoad.current) {
        setAssignedTickets(assignedTicketsData);
        isInitialAssignedLoad.current = false;
      } else {
        if (changes.some((c) => c.type === 'added')) {
          notificationSound.play().catch((e) => console.log('Error al reproducir sonido:', e));
          const newTicket = changes.find((c) => c.type === 'added')?.doc.data();
          if (newTicket?.subject) {
            setNotificationMessage(`¡Nuevo ticket asignado!: "${newTicket.subject}"`);
            setTimeout(() => setNotificationMessage(''), 5000);
          }
        }
        setAssignedTickets(assignedTicketsData);
      }
      setLoading(false);
    });

    return () => {
      unsubscribeAll();
      unsubscribeAssigned();
      isInitialAssignedLoad.current = true;
    };
  }, [adminUserData, notificationSound]);

  useEffect(() => {
    if (selectedTicket) {
      const updated = tickets.find((t) => t.id === selectedTicket.id);
      if (updated) setSelectedTicket(updated);
    }
  }, [tickets, selectedTicket?.id]);

  const handleSelectTicket = async (ticket) => {
    setSelectedTicket(ticket);
    setSelectedTicketUserData(null);

    if (ticket.hasUnreadForAdmin) {
      await updateTicketData(ticket.id, { hasUnreadForAdmin: false });
    }

    if (ticket.userId) {
      try {
        const userData = await getUserData(ticket.userId);
        setSelectedTicketUserData(userData);
      } catch (error) {
        console.error('Error al cargar los datos del usuario del ticket:', error);
        setSelectedTicketUserData({ error: 'No se pudo cargar la información del usuario.' });
      }
    }
  };

  useEffect(() => {
    if (!selectedTicket) setSelectedTicketUserData(null);
  }, [selectedTicket]);

  const handleReply = async () => {
    if (!selectedTicket || !replyMessage.trim() || sending) return;
    setSending(true);
    try {
      const messageData = {
        sender: currentUser.uid,
        senderType: 'admin',
        message: replyMessage.trim(),
      };
      await addMessageToTicket(selectedTicket.id, messageData, { hasUnreadForUser: true });
      setReplyMessage('');
      requestAnimationFrame(() => {
        messagesScrollRef.current?.scrollTo({ top: messagesScrollRef.current.scrollHeight, behavior: 'smooth' });
      });
    } catch (error) {
      console.error('Error enviando mensaje:', error);
      alert('❌ Error al enviar el mensaje');
    } finally {
      setSending(false);
    }
  };

  const handleAddInternalNote = async () => {
    if (!selectedTicket || !internalNote.trim() || !adminUserData) {
      alert('No se puede añadir una nota vacía.');
      return;
    }

    const noteData = {
      authorId: currentUser.uid,
      authorName: adminUserData.username,
      authorRole: adminUserData.role,
      text: internalNote.trim(),
      timestamp: new Date(),
    };

    try {
      setSending(true);
      const ticketRef = doc(db, 'supportTickets', selectedTicket.id);
      await updateDoc(ticketRef, {
        internalNotes: arrayUnion(noteData),
        updatedAt: serverTimestamp(),
      });
      setInternalNote('');
    } catch (error) {
      console.error('Error añadiendo nota interna:', error);
      alert('❌ Error al guardar la nota interna.');
    } finally {
      setSending(false);
    }
  };

  const handleTakeTicket = async () => {
    if (!selectedTicket || !adminUserData?.username) return;

    const newAdminName = adminUserData.username;

    if (selectedTicket.assignedAdmin === newAdminName) {
      alert('Ya estás atendiendo este ticket.');
      return;
    }

    if (!window.confirm('¿Estás seguro de que quieres tomar este ticket? Será reasignado a ti.')) return;

    const historyEntry = {
      adminName: newAdminName,
      role: adminUserData.role,
      action: `Ticket tomado por ${newAdminName} (antes atendido por ${selectedTicket.assignedAdmin || 'nadie'})`,
      timestamp: new Date(),
    };

    const updateData = {
      assignedAdmin: newAdminName,
      handlingHistory: [...(selectedTicket.handlingHistory || []), historyEntry],
    };

    await updateTicketData(selectedTicket.id, updateData);
  };

  const handleReassignRole = async (newRole) => {
    if (!selectedTicket || !adminUserData?.role || !newRole) return;

    setIsReassignModalOpen(false);

    if (selectedTicket.assignedRole === newRole) {
      alert('El ticket ya está asignado a ese rol.');
      return;
    }

    if (!window.confirm(`¿Seguro que quieres reasignar este ticket al nivel de "${newRole}"?`)) return;

    const adminName = adminUserData?.username || currentUser.email;
    const currentRoleLevel = ROLE_HIERARCHY[selectedTicket.assignedRole] || 1;
    const newRoleLevel = ROLE_HIERARCHY[newRole];
    const actionText = newRoleLevel > currentRoleLevel ? 'Escalado' : 'Degradado';

    const historyEntry = {
      adminName,
      role: adminUserData.role,
      action: `${actionText} a ${newRole}`,
      timestamp: new Date(),
    };

    const updateData = {
      assignedRole: newRole,
      handlingHistory: [...(selectedTicket.handlingHistory || []), historyEntry],
    };

    await updateTicketData(selectedTicket.id, updateData);
  };

  const handleStatusChange = async (newStatus) => {
    if (!selectedTicket || !adminUserData?.role) return;

    const adminName = adminUserData?.username || currentUser.email;
    let updateData = { status: newStatus };
    let historyAction = '';

    if (newStatus === 'en_proceso' && selectedTicket.status === 'abierto') {
      updateData.assignedAdmin = adminName;
      historyAction = `Ticket tomado por ${adminName}`;
    } else if (newStatus === 'resuelto') {
      updateData.resolvedByAdmin = adminName;
      historyAction = `Ticket resuelto por ${adminName}`;
    } else {
      historyAction = `Estado cambiado a ${newStatus} por ${adminName}`;
    }

    const historyEntry = {
      adminName,
      role: adminUserData.role,
      action: historyAction,
      timestamp: new Date(),
    };
    updateData.handlingHistory = [...(selectedTicket.handlingHistory || []), historyEntry];

    const success = await updateTicketData(selectedTicket.id, updateData);
    if (!success) {
      alert('❌ Error al actualizar el estado');
    }
  };

  const applyFilters = (ticketsToFilter) => {
    return ticketsToFilter.filter((ticket) => {
      const statusMatch = activeFilter === 'all' || ticket.status === activeFilter;
      const categoryMatch = categoryFilter === 'all' || ticket.category === categoryFilter;
      const searchMatch =
        !searchTerm ||
        (ticket.subject && ticket.subject.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (ticket.userName && ticket.userName.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (ticket.email && ticket.email.toLowerCase().includes(searchTerm.toLowerCase()));
      return statusMatch && categoryMatch && searchMatch;
    });
  };

  const filteredTickets = applyFilters(tickets);
  const filteredAssignedTickets = applyFilters(assignedTickets);

  const formatTime = (timestamp) => {
    let date = null;
    if (!timestamp) return '';
    if (typeof timestamp.toDate === 'function') {
      date = timestamp.toDate();
    } else if (timestamp instanceof Date) {
      date = timestamp;
    } else if (timestamp?.seconds) {
      date = new Date(timestamp.seconds * 1000);
    }
    if (!date) return '';
    return `${date.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: '2-digit' })} ${date.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}`;
  };

  useEffect(() => {
    if (!messagesScrollRef.current) return;
    messagesScrollRef.current.scrollTop = messagesScrollRef.current.scrollHeight;
  }, [selectedTicket?.messages?.length, selectedTicket?.id]);

  return (
    <div className="h-screen flex flex-col bg-gray-900 text-white">
      {notificationMessage && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 bg-blue-600 text-white px-6 py-3 rounded-lg shadow-lg animate-bounce">
          {notificationMessage}
        </div>
      )}

      <header className="p-2 sm:p-6 flex-shrink-0 border-b border-gray-700/50">
        <h1 className="text-2xl sm:text-3xl font-bold text-center sm:text-left">Panel de Soporte Administrativo</h1>
      </header>

      <main className="flex-grow flex flex-col lg:flex-row gap-4 sm:gap-8 w-full p-4 sm:p-6 overflow-hidden">
        <section className="lg:w-[32%] w-full bg-gray-800 p-3 sm:p-6 rounded-lg flex flex-col overflow-hidden">
          <div className="flex border-b border-gray-700 mb-4 flex-shrink-0">
            <button
              onClick={() => setActiveList('all')}
              className={`flex-1 py-2 text-center font-semibold transition ${activeList === 'all' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400 hover:text-white'}`}
            >
              Todos los Tickets
            </button>
            <button
              onClick={() => setActiveList('assigned')}
              className={`flex-1 py-2 text-center font-semibold transition relative ${activeList === 'assigned' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400 hover:text-white'}`}
            >
              Asignados a Mí
              {assignedTickets.some((t) => t.hasUnreadForAdmin) && <span className="absolute top-2 right-2 w-2.5 h-2.5 bg-blue-400 rounded-full animate-ping"></span>}
            </button>
          </div>

          <h2 className="text-xl font-semibold mb-4 text-center sm:text-left flex-shrink-0">{activeList === 'all' ? 'Todos los Tickets' : 'Tickets Asignados'}</h2>

          <div className="space-y-4 mb-4 flex-shrink-0">
            <input
              type="text"
              placeholder="🔍 Buscar por asunto, usuario, email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-gray-700 p-2 rounded-lg border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex flex-wrap gap-2 justify-center sm:justify-start">
              <span className="text-sm text-gray-400 self-center">Categoría:</span>
              <button onClick={() => setCategoryFilter('all')} className={`px-3 py-1 rounded-full text-xs transition ${categoryFilter === 'all' ? 'bg-blue-500' : 'bg-gray-700 hover:bg-gray-600'}`}>
                Todas
              </button>
              <button onClick={() => setCategoryFilter('recargas')} className={`px-3 py-1 rounded-full text-xs transition ${categoryFilter === 'recargas' ? 'bg-yellow-500' : 'bg-gray-700 hover:bg-gray-600'}`}>
                Recargas
              </button>
              <button onClick={() => setCategoryFilter('retiros')} className={`px-3 py-1 rounded-full text-xs transition ${categoryFilter === 'retiros' ? 'bg-green-500' : 'bg-gray-700 hover:bg-gray-600'}`}>
                Retiros
              </button>
              <button onClick={() => setCategoryFilter('tecnicos')} className={`px-3 py-1 rounded-full text-xs transition ${categoryFilter === 'tecnicos' ? 'bg-red-500' : 'bg-gray-700 hover:bg-gray-600'}`}>
                Técnicos
              </button>
              <button onClick={() => setCategoryFilter('cuentas')} className={`px-3 py-1 rounded-full text-xs transition ${categoryFilter === 'cuentas' ? 'bg-purple-500' : 'bg-gray-700 hover:bg-gray-600'}`}>
                Cuentas
              </button>
              <button onClick={() => setCategoryFilter('sugerencias')} className={`px-3 py-1 rounded-full text-xs transition ${categoryFilter === 'sugerencias' ? 'bg-blue-500' : 'bg-gray-700 hover:bg-gray-600'}`}>
                Sugerencias
              </button>
              <button onClick={() => setCategoryFilter('otros')} className={`px-3 py-1 rounded-full text-xs transition ${categoryFilter === 'otros' ? 'bg-gray-500' : 'bg-gray-700 hover:bg-gray-600'}`}>
                Otros
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 justify-center sm:justify-start mb-4 flex-shrink-0">
            <button onClick={() => setActiveFilter('all')} className={`px-3 py-1 rounded-full text-sm transition ${activeFilter === 'all' ? 'bg-blue-500' : 'bg-gray-700 hover:bg-gray-600'}`}>
              Todos
            </button>
            <button onClick={() => setActiveFilter('abierto')} className={`px-3 py-1 rounded-full text-sm transition ${activeFilter === 'abierto' ? 'bg-yellow-500' : 'bg-gray-700 hover:bg-gray-600'}`}>
              Abiertos
            </button>
            <button onClick={() => setActiveFilter('en_proceso')} className={`px-3 py-1 rounded-full text-sm transition ${activeFilter === 'en_proceso' ? 'bg-blue-500' : 'bg-gray-700 hover:bg-gray-600'}`}>
              En Proceso
            </button>
            <button onClick={() => setActiveFilter('resuelto')} className={`px-3 py-1 rounded-full text-sm transition ${activeFilter === 'resuelto' ? 'bg-green-500' : 'bg-gray-700 hover:bg-gray-600'}`}>
              Resueltos
            </button>
          </div>

          <div className="flex-grow space-y-3 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600 -mr-2 pr-2">
            {loading ? (
              <p className="text-center text-gray-400 pt-12">Cargando tickets...</p>
            ) : (activeList === 'all' ? filteredTickets : filteredAssignedTickets).length === 0 ? (
              <div className="py-12 text-center text-gray-500">No hay tickets para esta vista.</div>
            ) : (
              (activeList === 'all' ? filteredTickets : filteredAssignedTickets).map((ticket) => (
                <div
                  key={ticket.id}
                  onClick={() => handleSelectTicket(ticket)}
                  className={`p-4 rounded-lg cursor-pointer relative transition ${selectedTicket?.id === ticket.id ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'}`}
                >
                  {ticket.hasUnreadForAdmin && <span className="absolute top-2 right-2 w-3 h-3 bg-blue-400 rounded-full animate-pulse"></span>}
                  <div className="flex flex-col gap-1">
                    <p className="font-bold truncate">{ticket.subject}</p>
                    <p className="text-xs text-gray-400 truncate">Usuario: {ticket.userName}</p>
                    <p className="text-xs text-gray-400">
                      Rol Asignado: <span className="font-semibold">{ticket.assignedRole || 'support_agent'}</span>
                    </p>
                    <p className="text-xs text-gray-500">{formatTime(ticket.createdAt)}</p>
                  </div>
                  <span
                    className={`absolute bottom-2 right-2 text-xs px-2 py-0.5 rounded-full ${
                      ticket.status === 'abierto' ? 'bg-yellow-500/20 text-yellow-300' : ticket.status === 'en_proceso' ? 'bg-blue-500/20 text-blue-300' : 'bg-green-500/20 text-green-300'
                    }`}
                  >
                    {ticket.status}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Columna derecha: relative para posicionar el sidebar de Notas */}
        <section className="lg:w-[68%] w-full bg-gray-800 p-3 sm:p-6 rounded-lg overflow-hidden relative">
          <div className="flex flex-col h-full">
            {selectedTicket ? (
              <>
                <div className="flex justify-between items-start mb-4 flex-shrink-0">
                  <div>
                    <h2 className="text-xl sm:text-2xl font-bold mb-1">{selectedTicket.subject}</h2>
                    <div className="text-gray-400 text-xs sm:text-sm">
                      <p>
                        Usuario: <b>{selectedTicket.userName}</b> ({selectedTicket.email})
                      </p>
                      <p>Categoría: {selectedTicket.category}</p>
                    </div>
                  </div>
                  {selectedTicketUserData ? (
                    <div className="bg-gray-900/50 p-3 rounded-lg text-right text-sm border border-gray-700 flex-shrink-0">
                      {selectedTicketUserData.error ? (
                        <p className="text-red-400">{selectedTicketUserData.error}</p>
                      ) : (
                        <>
                          <p className="font-bold text-blue-400">{selectedTicketUserData.username}</p>
                          <p>
                            Saldo: <span className="font-semibold text-yellow-400">{selectedTicketUserData.balance?.toLocaleString() || 0} Bs.</span>
                          </p>
                          <p>
                            Rol: <span className="font-semibold">{selectedTicketUserData.role}</span>
                          </p>
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="bg-gray-900/50 p-3 rounded-lg text-right text-sm border border-gray-700 flex-shrink-0">
                      <p className="text-gray-500">Cargando perfil...</p>
                    </div>
                  )}
                </div>

                <div className="mb-4 flex items-center justify-between flex-wrap gap-4 bg-gray-900/50 p-3 rounded-lg flex-shrink-0">
                  <div className="flex items-center space-x-4">
                    <span className="font-semibold">Estado:</span>
                    <select
                      value={selectedTicket.status}
                      onChange={(e) => handleStatusChange(e.target.value)}
                      className="bg-gray-700 p-2 rounded disabled:opacity-70"
                      disabled={selectedTicket.status === 'resuelto'}
                    >
                      <option value="abierto">Abierto</option>
                      <option value="en_proceso">En Proceso</option>
                      <option value="resuelto">Resuelto</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* NUEVO: botón para abrir el panel de notas */}
                    <button
                      onClick={() => setIsNotesPanelOpen(true)}
                      className="bg-amber-600 hover:bg-amber-500 px-4 py-2 rounded font-semibold transition text-sm"
                    >
                      📝 Ver Notas
                    </button>

                    {selectedTicket.status === 'en_proceso' && selectedTicket.assignedAdmin !== adminUserData?.username && (
                      <button onClick={handleTakeTicket} className="bg-green-600 hover:bg-green-500 px-4 py-2 rounded font-semibold transition text-sm">
                        📥 Tomar Ticket
                      </button>
                    )}
                    {selectedTicket.status !== 'resuelto' && (
                      <button onClick={() => setIsReassignModalOpen(true)} className="bg-purple-600 hover:bg-purple-500 px-4 py-2 rounded font-semibold transition text-sm">
                        ⇅ Reasignar Rol
                      </button>
                    )}
                  </div>
                </div>

                {selectedTicket.handlingHistory && selectedTicket.handlingHistory.length > 0 && (
                  <div className="mb-4 flex-shrink-0">
                    <h3 className="font-semibold text-gray-400 mb-2 text-sm">Historial del Ticket:</h3>
                    <div className="space-y-1 text-xs text-gray-500 max-h-24 overflow-y-auto pr-2">
                      {selectedTicket.handlingHistory.map((entry, index) => (
                        <p key={index}>• {formatTime(entry.timestamp)} - {entry.action}</p>
                      ))}
                    </div>
                  </div>
                )}

                {/* Eliminadas las Notas Internas del flujo principal para liberar espacio al chat */}

                {/* Chat: ocupa el espacio restante */}
                <div
                  ref={messagesScrollRef}
                  className="flex-grow min-h-0 overflow-y-auto pr-3 -mr-3 scrollbar-thin scrollbar-thumb-gray-600 space-y-4"
                >
                  {selectedTicket.messages?.length > 0 ? (
                    selectedTicket.messages.map((msg, index) => (
                      <div key={index} className={`flex ${msg.senderType === 'admin' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`p-3 rounded-lg max-w-xs sm:max-w-md ${msg.senderType === 'admin' ? 'bg-blue-600' : 'bg-gray-700'}`}>
                          <p className="text-sm break-words">{msg.message}</p>
                          <p className="text-xs text-gray-300/80 text-right mt-1">{formatTime(msg.timestamp)}</p>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center text-gray-500 py-8">No hay mensajes en este ticket.</div>
                  )}
                </div>

                {/* Formulario de respuesta: fijo inferior y hermano directo del chat */}
                <div className="flex-shrink-0 pt-4 border-t border-gray-700">
                  {selectedTicket.status === 'resuelto' ? (
                    <div className="text-center p-4 bg-green-500/20 rounded-lg text-green-300">Este ticket ha sido resuelto y cerrado.</div>
                  ) : (
                    <form
                      className="flex flex-col sm:flex-row gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleReply();
                      }}
                    >
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
              </>
            ) : (
              <div className="flex items-center justify-center h-full">
                <p className="text-gray-500">Selecciona un ticket para ver los detalles.</p>
              </div>
            )}
          </div>

          {/* Sidebar de Notas Internas */}
          {isNotesPanelOpen && selectedTicket && (
            <div className="absolute inset-y-0 right-0 z-20 w-full sm:w-[420px] bg-gray-900/95 backdrop-blur-sm border-l border-yellow-500/30 shadow-2xl rounded-r-lg flex flex-col">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
                <h3 className="text-lg font-semibold text-yellow-300">📝 Notas Internas</h3>
                <button
                  onClick={() => setIsNotesPanelOpen(false)}
                  className="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 text-sm text-white"
                  aria-label="Cerrar notas"
                >
                  ✕
                </button>
              </div>

              <div className="p-4 space-y-3 overflow-y-auto scrollbar-thin scrollbar-thumb-yellow-500/30">
                {selectedTicket.internalNotes && selectedTicket.internalNotes.length > 0 ? (
                  selectedTicket.internalNotes.map((note, index) => (
                    <div key={index} className="bg-gray-800/70 p-3 rounded-md border border-gray-700">
                      <p className="text-sm text-white/90">{note.text}</p>
                      <p className="text-xs text-yellow-400/80 text-right mt-2">
                        - {note.authorName} ({note.authorRole}) el {formatTime(note.timestamp)}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-gray-500 text-center py-4">No hay notas internas en este ticket.</p>
                )}
              </div>

              {selectedTicket.status !== 'resuelto' && (
                <form
                  className="p-4 border-t border-gray-700 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleAddInternalNote();
                  }}
                >
                  <input
                    type="text"
                    value={internalNote}
                    onChange={(e) => setInternalNote(e.target.value)}
                    placeholder="Añadir una nota para el equipo..."
                    className="flex-1 bg-gray-700 p-2 rounded text-sm focus:outline-none"
                    disabled={sending}
                  />
                  <button
                    type="submit"
                    disabled={!internalNote.trim() || sending}
                    className="bg-amber-600 hover:bg-amber-500 px-4 py-2 rounded font-semibold transition text-sm disabled:opacity-50"
                  >
                    Añadir
                  </button>
                </form>
              )}
            </div>
          )}
        </section>
      </main>

      {isReassignModalOpen && selectedTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-gray-800 rounded-2xl p-6 max-w-sm w-full border border-gray-700 shadow-2xl">
            <h3 className="text-lg font-bold mb-4 text-white text-center">Reasignar Ticket</h3>
            <p className="text-sm text-gray-400 mb-4 text-center">
              Asignación actual: <span className="font-semibold text-blue-400">{selectedTicket.assignedRole || 'support_agent'}</span>
            </p>
            <div className="grid grid-cols-2 gap-3">
              {Object.keys(ROLE_HIERARCHY).map(
                (role) =>
                  (selectedTicket.assignedRole || 'support_agent') !== role && (
                    <button
                      key={role}
                      onClick={() => handleReassignRole(role)}
                      className="w-full p-3 rounded-lg bg-gray-700 hover:bg-blue-600 text-white font-semibold transition-colors"
                    >
                      {role.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                    </button>
                  )
              )}
            </div>
            <button onClick={() => setIsReassignModalOpen(false)} className="w-full mt-4 bg-gray-600 text-white py-2 rounded-lg hover:bg-gray-500 transition-colors">
              Cancelar
            </button>
          </div>
        </div>
      )}

      <style>{`
        .scrollbar-thin::-webkit-scrollbar { width: 6px; background: transparent; }
        .scrollbar-thin::-webkit-scrollbar-thumb { border-radius: 6px; background-color: rgba(75, 85, 99, 0.6); }
        .scrollbar-thin::-webkit-scrollbar-thumb:hover { background-color: rgba(75, 85, 99, 0.8); }
        .scrollbar-thin::-webkit-scrollbar-corner { background: transparent; }
      `}</style>
    </div>
  );
};

export default AdminSupportPanel;