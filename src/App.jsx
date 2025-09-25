import React, { useState, useEffect, createContext, useContext } from "react";
import { Routes, Route, useNavigate, Navigate } from "react-router-dom";
import { auth } from "./firebase";
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from "firebase/auth";
import { createUserDocument, checkUsernameAvailability, getUserData } from "./firestoreService";
import fondo from "./assets/fondo.png";
import GameLobby from "./components/GameLobby";
import Recharge from "./Recharge";
import AdminPanel from "./AdminPanel";
import TransactionHistory from "./components/TransactionHistory";
import BingoLobby from './components/bingo/BingoLobby';
import BingoGame from './components/bingo/BingoGame';
import BingoAdmin from './components/bingo/BingoAdmin';

// 🔥 NUEVAS IMPORTACIONES - Agregar estas líneas
import SupportPage from "./SupportPage";
import AdminSupportPage from "./AdminSupportPage";

export const AuthContext = createContext(null);

const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          const userDoc = await getUserData(user.uid);
          setUserData(userDoc);
          setCurrentUser(user);
        } catch (error) {
          console.error("Error cargando datos del usuario:", error);
          setCurrentUser(user);
        }
      } else {
        setCurrentUser(null);
        setUserData(null);
      }
      setLoading(false);
    });
    
    return unsubscribe;
  }, []);

  const value = { 
    currentUser, 
    userData,
    loading 
  };
  
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

const ProtectedRoute = ({ children }) => {
  const { currentUser, userData, loading } = useContext(AuthContext);
  
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <div className="text-xl text-gray-700">Cargando...</div>
      </div>
    );
  }
  
  if (!currentUser || userData?.suspended) {
    return <Navigate to="/" replace />;
  }
  
  return children;
};

const AuthPage = () => {
  const navigate = useNavigate();
  const { currentUser, userData, loading } = useContext(AuthContext);
  
  // ✅ TODOS LOS HOOKS PRIMERO - SIN INTERRUPCIONES
  const [initialScreen, setInitialScreen] = useState(true);
  const [showLogin, setShowLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [username, setUsername] = useState("");
  const [phone, setPhone] = useState("");
  const [countryCode, setCountryCode] = useState("+58");
  const [message, setMessage] = useState("");
  const [formLoading, setFormLoading] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState(null);
  const [passwordStrength, setPasswordStrength] = useState("");
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [justRegistered, setJustRegistered] = useState(false);
  const [registering, setRegistering] = useState(false);

  // ✅ CONSTANTES Y FUNCIONES AUXILIARES DESPUÉS DE LOS HOOKS
  const countryCodes = [
    { value: "+58", label: "+58 Venezuela", maxLength: 10, example: "4123456789" },
    { value: "+57", label: "+57 Colombia", maxLength: 10, example: "3001234567" },
    { value: "+56", label: "+56 Chile", maxLength: 9, example: "912345678" },
    { value: "+55", label: "+55 Brasil", maxLength: 11, example: "11912345678" },
    { value: "+54", label: "+54 Argentina", maxLength: 10, example: "91123456789" },
    { value: "+52", label: "+52 México", maxLength: 10, example: "5512345678" },
    { value: "+51", label: "+51 Perú", maxLength: 9, example: "912345678" },
    { value: "+34", label: "+34 España", maxLength: 9, example: "612345678" },
    { value: "+1", label: "+1 USA/Canadá", maxLength: 10, example: "2015550123" }
  ];

  const getCurrentCountryConfig = () => {
    return countryCodes.find(country => country.value === countryCode) || countryCodes[0];
  };

  const currentCountry = getCurrentCountryConfig();

  const handlePhoneChange = (e) => {
    const value = e.target.value.replace(/\D/g, '');
    const countryConfig = getCurrentCountryConfig();
    if (value.length <= countryConfig.maxLength) {
      setPhone(value);
    }
  };

  // ✅ USEEFFECT DESPUÉS DE LAS FUNCIONES QUE USA
  useEffect(() => {
    if (loading) return;
    
    if (currentUser && userData && !userData.suspended && !justRegistered && !registering) {
      navigate('/lobby', { replace: true });
    }
  }, [currentUser, userData, loading, navigate, justRegistered, registering]);

  useEffect(() => {
    const verifyUsername = async () => {
      if (username.length >= 3) {
        setCheckingUsername(true);
        try {
          const isAvailable = await checkUsernameAvailability(username);
          setUsernameAvailable(isAvailable);
        } catch (error) {
          console.error("Error verificando username:", error);
          setUsernameAvailable(true);
        }
        setCheckingUsername(false);
      } else {
        setUsernameAvailable(null);
      }
    };

    const timeoutId = setTimeout(verifyUsername, 500);
    return () => clearTimeout(timeoutId);
  }, [username]);

  useEffect(() => {
    if (password.length > 0) {
      let strength = "";
      if (password.length < 6) {
        strength = "❌ Muy débil";
      } else if (password.length < 8) {
        strength = "⚠️ Débil";
      } else if (password.length < 10) {
        strength = "✅ Buena";
      } else {
        strength = "💪 Excelente";
      }
      setPasswordStrength(strength);
    } else {
      setPasswordStrength("");
    }
  }, [password]);

  // ✅ FUNCIONES DE MANEJO DE EVENTOS
  const handleLogin = async (e) => {
    e.preventDefault();
    setFormLoading(true);
    setMessage("");
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
      setFormLoading(false);
      setMessage("❌ Usuario o contraseña incorrectos");
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    
    if (!acceptedTerms) {
      setMessage("❌ Debes aceptar los Términos y Condiciones");
      return;
    }

    if (usernameAvailable === false) {
      setMessage("❌ Este nombre de usuario ya está en uso");
      return;
    }

    if (password !== confirmPassword) {
      setMessage("❌ Las contraseñas no coinciden");
      return;
    }

    if (password.length < 6) {
      setMessage("❌ La contraseña debe tener al menos 6 caracteres");
      return;
    }

    const countryConfig = getCurrentCountryConfig();
    if (!/^\d+$/.test(phone)) {
      setMessage("❌ El número de teléfono debe contener solo números");
      return;
    }

    if (phone.length !== countryConfig.maxLength) {
      setMessage(`❌ El número debe tener ${countryConfig.maxLength} dígitos para ${countryConfig.label}`);
      return;
    }

    setFormLoading(true);
    setRegistering(true);
    setMessage("");
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;
      
      const userCreated = await createUserDocument(user, {
        username: username,
        phone: countryCode + phone
      });
      
      if (userCreated) {
        await signOut(auth);

        setJustRegistered(true);
        setMessage("✅ ¡Cuenta creada exitosamente! Serás redirigido al login...");

        setTimeout(() => {
          setJustRegistered(false);
          setRegistering(false);
          setEmail("");
          setPassword("");
          setConfirmPassword("");
          setUsername("");
          setPhone("");
          setAcceptedTerms(false);
          setShowLogin(true);
          setInitialScreen(true);
          setMessage("");
        }, 3000);

        return;
      } else {
        setMessage("❌ Error al crear perfil de usuario");
        setFormLoading(false);
        setRegistering(false);
        return;
      }
      
    } catch (error) {
      setFormLoading(false);
      setRegistering(false);
      if (error.code === "auth/email-already-in-use") {
        setMessage("❌ Este correo ya está registrado");
      } else if (error.code === "auth/weak-password") {
        setMessage("❌ La contraseña es demasiado débil");
      } else {
        setMessage("❌ Error al registrarse, intenta nuevamente");
      }
    }
  };

  // ✅ RETURN CONDICIONALES SOLO AL FINAL
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <div className="text-xl text-gray-700">Cargando...</div>
      </div>
    );
  }

  if (currentUser && userData?.suspended) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen relative bg-cover bg-no-repeat"
        style={{ backgroundImage: `url(${fondo})`, backgroundPosition: "center 98%", backgroundSize: "cover" }}>
        <div className="glass-effect p-8 rounded-2xl shadow-2xl w-full max-w-md z-10 border border-white/30">
          <div className="bg-red-600 text-white p-6 rounded-xl text-center font-bold">
            <div className="text-2xl mb-2">🚫 Cuenta Suspendida</div>
            <div className="text-lg mb-4">
              Tu cuenta ha sido suspendida por la administración de Oriluck.
            </div>
            <div className="text-sm opacity-90">
              Si deseas apelar, comunícate con soporte.
            </div>
          </div>
          
          <button 
            onClick={async () => {
              await signOut(auth);
              window.location.reload();
            }}
            className="w-full mt-4 bg-gray-600 text-white py-3 rounded-xl font-semibold hover:bg-gray-700 transition-all"
          >
            Volver al Login
          </button>
        </div>
        
        <style>{`
          .glass-effect {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.2);
          }
        `}</style>
      </div>
    );
  }

  // ✅ RETURN PRINCIPAL AL FINAL
  return (
    <div
      className="flex flex-col items-center justify-center min-h-screen relative bg-cover bg-no-repeat"
      style={{ backgroundImage: `url(${fondo})`, backgroundPosition: "center 98%", backgroundSize: "cover" }}
    >
      <h1 className="text-7xl font-extrabold uppercase mb-28 text-center">
        <span className="text-yellow-400 neon-gold">ORI</span>
        <span className="text-green-400 neon-green">LUCK</span>
      </h1>
      
      <style>{`
        .neon-gold {
          text-shadow: 0 0 10px #ffd700, 0 0 20px #ffd700, 0 0 30px #ff6b00, 0 0 40px #ff6b00;
        }
        .neon-green {
          text-shadow: 0 0 10px #00ff00, 0 0 20px #00ff00, 0 0 30px #00cc00, 0 0 40px #00cc00;
        }
        .glass-effect {
          background: rgba(255, 255, 255, 0.95);
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.2);
        }
      `}</style>

      <img
        src="https://upload.wikimedia.org/wikipedia/commons/0/06/Flag_of_Venezuela.svg"
        alt="Bandera de Venezuela"
        className="absolute bottom-4 right-4 w-30 h-38 object-contain"
      />

      <div className="glass-effect p-8 rounded-2xl shadow-2xl w-full max-w-md z-10 border border-white/30">
        {initialScreen ? (
          <div className="flex flex-col space-y-4">
            <button 
              onClick={() => { setShowLogin(true); setInitialScreen(false); }}
              className="w-full bg-gradient-to-r from-blue-600 to-blue-500 text-white py-4 rounded-xl font-semibold hover:from-blue-500 hover:to-blue-400 transition-all duration-300 transform hover:scale-105 shadow-lg"
            >
              🚀 Iniciar Sesión
            </button>
            <button 
              onClick={() => { setShowLogin(false); setInitialScreen(false); }}
              className="w-full bg-gradient-to-r from-green-600 to-green-500 text-white py-4 rounded-xl font-semibold hover:from-green-500 hover:to-green-400 transition-all duration-300 transform hover:scale-105 shadow-lg"
            >
              ✨ Crear Cuenta
            </button>
          </div>
        ) : showLogin ? (
          <>
            <h2 className="text-3xl font-bold text-center text-gray-800 mb-6">Iniciar Sesión</h2>
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <input
                  type="email"
                  placeholder="📧 Correo electrónico"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full p-4 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 bg-white text-black transition-all"
                />
              </div>
              
              <div>
                <input
                  type="password"
                  placeholder="🔒 Contraseña"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full p-4 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 bg-white text-black transition-all"
                />
              </div>
              
              <button
                type="submit"
                disabled={formLoading}
                className="w-full bg-gradient-to-r from-blue-600 to-blue-500 text-white py-4 rounded-xl font-semibold hover:from-blue-500 hover:to-blue-400 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-105 shadow-lg"
              >
                {formLoading ? "⏳ Ingresando..." : "🎯 Ingresar a mi Cuenta"}
              </button>
            </form>
            <p className="mt-4 text-center text-gray-600">
              ¿No tienes cuenta?{" "}
              <button
                onClick={() => setShowLogin(false)}
                className="text-blue-600 hover:underline font-semibold"
              >
                Regístrate aquí
              </button>
            </p>
          </>
        ) : (
          <>
            <h2 className="text-3xl font-bold text-center text-gray-800 mb-6">Crear Cuenta</h2>
            <form onSubmit={handleRegister} className="space-y-4">
              <div>
                <input
                  type="text"
                  placeholder="👤 Nombre de usuario"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  className="w-full p-4 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 bg-white text-black transition-all"
                />
                {checkingUsername && (
                  <p className="text-blue-600 text-sm mt-1">🔍 Verificando disponibilidad...</p>
                )}
                {usernameAvailable !== null && !checkingUsername && (
                  <p className={`text-sm mt-1 font-medium ${usernameAvailable ? 'text-green-600' : 'text-red-600'}`}>
                    {usernameAvailable ? '✅ Nombre de usuario disponible' : '❌ Este nombre de usuario ya está en uso'}
                  </p>
                )}
              </div>

              <div>
                <input
                  type="email"
                  placeholder="📧 Correo electrónico"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full p-4 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 bg-white text-black transition-all"
                />
              </div>

              <div className="space-y-2">
                <div className="flex space-x-2">
                  <select
                    value={countryCode}
                    onChange={(e) => {
                      setCountryCode(e.target.value);
                      setPhone("");
                    }}
                    className="p-4 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 bg-white text-black transition-all"
                  >
                    {countryCodes.map((code) => (
                      <option key={code.value} value={code.value}>
                        {code.label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    placeholder={`📱 Teléfono (${currentCountry.maxLength} dígitos)`}
                    value={phone}
                    onChange={handlePhoneChange}
                    maxLength={currentCountry.maxLength}
                    required
                    className="flex-1 p-4 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 bg-white text-black transition-all"
                  />
                </div>
                <p className="text-xs text-gray-600 bg-yellow-50 p-2 rounded-lg">
                  💡 <strong>Formato correcto:</strong> {currentCountry.example} 
                </p>
                {phone.length > 0 && phone.length !== currentCountry.maxLength && (
                  <p className="text-red-600 text-xs">❌ Debe tener {currentCountry.maxLength} dígitos</p>
                )}
              </div>

              <div>
                <input
                  type="password"
                  placeholder="🔒 Contraseña"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full p-4 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 bg-white text-black transition-all"
                />
                {passwordStrength && (
                  <p className={`text-sm mt-1 ${
                    passwordStrength.includes("Excelente") ? 'text-green-600' : 
                    passwordStrength.includes("Buena") ? 'text-blue-600' : 
                    passwordStrength.includes("Débil") ? 'text-orange-600' : 'text-red-600'
                  }`}>
                    {passwordStrength}
                  </p>
                )}
              </div>

              <div>
                <input
                  type="password"
                  placeholder="🔒 Confirmar contraseña"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className="w-full p-4 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 bg-white text-black transition-all"
                />
                {confirmPassword && password !== confirmPassword && (
                  <p className="text-red-600 text-sm mt-1">❌ Las contraseñas no coinciden</p>
                )}
              </div>

              <div className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg">
                <input
                  type="checkbox"
                  checked={acceptedTerms}
                  onChange={(e) => setAcceptedTerms(e.target.checked)}
                  required
                  className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500"
                />
                <span className="text-gray-700 text-sm">
                  Acepto los{" "}
                  <button
                    type="button"
                    className="text-blue-600 hover:underline font-semibold"
                    onClick={() => setShowTermsModal(true)}
                  >
                    Términos y Condiciones
                  </button>
                </span>
              </div>

              <button
                type="submit"
                disabled={formLoading || !acceptedTerms || usernameAvailable === false}
                className="w-full bg-gradient-to-r from-green-600 to-green-500 text-white py-4 rounded-xl font-semibold hover:from-green-500 hover:to-green-400 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-105 shadow-lg"
              >
                {formLoading ? "⏳ Creando cuenta..." : "🎰 Crear Cuenta"}
              </button>
            </form>
            <p className="mt-4 text-center text-gray-600">
              ¿Ya tienes cuenta?{" "}
              <button
                onClick={() => setShowLogin(true)}
                className="text-blue-600 hover:underline font-semibold"
              >
                Inicia sesión aquí
              </button>
            </p>
          </>
        )}

        {message && (
          <div className={`mt-4 p-3 rounded-lg text-center font-semibold ${
            message.includes("✅") ? 'bg-green-100 text-green-800 border border-green-200' : 
            'bg-red-100 text-red-800 border border-red-200'
          }`}>
            {message}
          </div>
        )}
      </div>

      {showTermsModal && (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
          <div className="bg-white p-6 rounded-2xl w-11/12 max-w-2xl max-h-[80vh] overflow-y-auto">
            <h2 className="text-2xl font-bold mb-4 text-gray-800">📜 Términos y Condiciones</h2>
            <div className="space-y-3 text-gray-700">
              <p><strong>1. Edad mínima:</strong> Oriluck es exclusivamente para personas mayores de 18 años.</p>
              <p><strong>2. Registro y cuenta:</strong> Información veraz y completa requerida.</p>
              <p><strong>3. Uso de la plataforma:</strong> Solo para entretenimiento responsable.</p>
              <p><strong>4. Premios y comisiones:</strong> 30% comisión, 70% destinado al ganador.</p>
              <p><strong>5. Responsabilidad:</strong> Juega de forma responsable.</p>
            </div>
            <button
              className="absolute top-4 right-4 text-gray-500 hover:text-gray-700 text-2xl font-bold"
              onClick={() => setShowTermsModal(false)}
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// En App.jsx - Agregar después de las rutas existentes
function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<AuthPage />} />
        <Route path="/lobby" element={<ProtectedRoute><GameLobby /></ProtectedRoute>} />
        <Route path="/recharge" element={<ProtectedRoute><Recharge /></ProtectedRoute>} />
        <Route path="/admin" element={<ProtectedRoute><AdminPanel /></ProtectedRoute>} />
        <Route path="/history" element={<ProtectedRoute><TransactionHistory /></ProtectedRoute>} />
        
        {/* 🔥 NUEVAS RUTAS DE SOPORTE */}
        <Route path="/support" element={<ProtectedRoute><SupportPage /></ProtectedRoute>} />
        <Route path="/admin/support" element={<ProtectedRoute><AdminSupportPage /></ProtectedRoute>} />
        
        {/* 🎯 NUEVAS RUTAS DE BINGO CON PROTECCIÓN */}
        <Route path="/bingo" element={<ProtectedRoute><BingoLobby /></ProtectedRoute>} />
        <Route path="/bingo/game" element={<ProtectedRoute><BingoGame /></ProtectedRoute>} />
        <Route path="/admin/bingo" element={<ProtectedRoute><BingoAdmin /></ProtectedRoute>} />
      </Routes>
    </AuthProvider>
  );
}

export default App;