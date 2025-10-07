import React, { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from './App'; // Asumiendo que AuthContext está en './App'
import AdminSupportPanel from './components/AdminSupportPanel';

const AdminSupportPage = () => {
    const { currentUser, userData: currentUserData } = useContext(AuthContext);
    const navigate = useNavigate();

    // >>>>> REEMPLAZA EL BLOQUE DE ACCESO CON ESTA VERSIÓN MEJORADA <<<<<
    // --- INICIO DE LA CORRECCIÓN DE ACCESO ---
    // 1. Define todos los roles que pueden acceder a esta página.
    const allowedRoles = ['support_agent', 'moderator', 'supervisor', 'admin'];

    // 2. Comprueba si el rol del usuario actual está en la lista de roles permitidos.
    const hasPermission = allowedRoles.includes(currentUserData?.role);

    useEffect(() => {
        // Si los datos del usuario aún no han cargado, no hagas nada.
        if (currentUser === undefined || currentUserData === null) return;

        // Si el usuario NO tiene permiso, redirígelo al lobby.
        if (!hasPermission) {
            console.warn(`Acceso denegado a /admin/support para el rol: ${currentUserData?.role}`);
            navigate('/lobby', { replace: true });
        }
    }, [hasPermission, currentUser, currentUserData, navigate]);

    // Lógica de carga y renderizado seguro
    if (currentUser === undefined || currentUserData === null) {
        return <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">Cargando credenciales...</div>;
    }

    if (!hasPermission) {
        // Muestra null mientras la redirección de useEffect hace su trabajo.
        return null; 
    }
    // --- FIN DE LA CORRECCIÓN DE ACCESO ---

    // El resto de tu componente...
    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 relative overflow-hidden">
            {/* Efectos de fondo */}
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-transparent via-black/20 to-black/60"></div>

            {/* Header */}
            <header className="relative z-10 bg-black/40 backdrop-blur-lg border-b border-green-500/30 shadow-2xl">
                <div className="container mx-auto px-6 py-4">
                    <div className="flex justify-between items-center">
                        <div className="flex items-center space-x-4">
                            <button
                                onClick={() => navigate('/admin')}
                                className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-xl transition-all duration-300 mr-4"
                            >
                                ← Panel Principal
                            </button>
                            <div className="text-3xl font-bold bg-gradient-to-r from-green-400 to-green-200 bg-clip-text text-transparent">
                                🎫 SOPORTE - PANEL ADMIN
                            </div>
                        </div>

                        <div className="text-white/80">
                            <div className="text-sm opacity-60">Administrador: {currentUser?.email}</div>
                        </div>
                    </div>
                </div>
            </header>

            <main className="relative z-10 container mx-auto px-6 py-8">
                <AdminSupportPanel currentUser={currentUser} />
            </main>
        </div>
    );
};

export default AdminSupportPage;