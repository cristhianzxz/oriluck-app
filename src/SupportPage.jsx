import React, { useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from './App';
import SupportTicketForm from './components/SupportTicketForm';
import UserTicketsList from './components/UserTicketsList';
import SupportChat from './components/SupportChat';

const SupportPage = () => {
  const navigate = useNavigate();
  const { currentUser } = useContext(AuthContext);
  const [activeView, setActiveView] = useState('list'); // 'list', 'create', 'chat'
  const [selectedTicket, setSelectedTicket] = useState(null);

  const handleTicketCreated = () => {
    setActiveView('list');
  };

  const handleTicketSelect = (ticket) => {
    setSelectedTicket(ticket);
    setActiveView('chat');
  };

  const handleBackToList = () => {
    setSelectedTicket(null);
    setActiveView('list');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 relative overflow-hidden">
      {/* Efectos de fondo */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-transparent via-black/20 to-black/60"></div>
      
      {/* Header */}
      <header className="relative z-10 bg-black/40 backdrop-blur-lg border-b border-blue-500/30 shadow-2xl">
        <div className="container mx-auto px-6 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => navigate('/lobby')}
                className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-xl transition-all duration-300 mr-4"
              >
                ← Volver al Lobby
              </button>
              <div className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-blue-200 bg-clip-text text-transparent">
                🆘 CENTRO DE SOPORTE
              </div>
            </div>
            
            <div className="flex space-x-3">
              <button
                onClick={() => setActiveView('list')}
                className={`px-4 py-2 rounded-lg transition-all ${
                  activeView === 'list' 
                    ? 'bg-blue-600 text-white' 
                    : 'bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                📋 Mis Tickets
              </button>
              <button
                onClick={() => setActiveView('create')}
                className={`px-4 py-2 rounded-lg transition-all ${
                  activeView === 'create' 
                    ? 'bg-green-600 text-white' 
                    : 'bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                ✉️ Nuevo Ticket
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 container mx-auto px-6 py-8">
        <div className="max-w-4xl mx-auto">
          {activeView === 'create' && (
            <SupportTicketForm 
              currentUser={currentUser} 
              onTicketCreated={handleTicketCreated}
              onCancel={() => setActiveView('list')}
            />
          )}
          
          {activeView === 'list' && (
            <UserTicketsList 
              currentUser={currentUser}
              onTicketSelect={handleTicketSelect}
            />
          )}
          
          {activeView === 'chat' && selectedTicket && (
            <SupportChat 
              ticket={selectedTicket}
              currentUser={currentUser}
              onBack={handleBackToList}
            />
          )}
        </div>
      </main>
    </div>
  );
};

export default SupportPage;