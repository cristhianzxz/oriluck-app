// 📌 App.jsx
import React, { useState } from "react";
import axios from "axios";
import fondo from "./assets/fondo.png"; // tu fondo PNG

function App() {
  const [initialScreen, setInitialScreen] = useState(true);
  const [showLogin, setShowLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [phone, setPhone] = useState("");
  const [countryCode, setCountryCode] = useState("+58");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false); // ✅ Checkbox Términos
  const [showTermsModal, setShowTermsModal] = useState(false); // ✅ Modal Términos
  const [token, setToken] = useState(localStorage.getItem('token'));

  // ✅ Login
  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      const res = await axios.post('/api/auth/login', { email, password });
      localStorage.setItem('token', res.data.token);
      setToken(res.data.token);
      setMessage("Inicio de sesión exitoso ✅");
      setLoading(false);
      // Here you would typically redirect the user or update the UI
    } catch (error) {
      setLoading(false);
      const errorMsg = error.response?.data?.msg || "Error al iniciar sesión";
      setMessage(`❌ ${errorMsg}`);
    }
  };

  // ✅ Registro
  const handleRegister = async (e) => {
    e.preventDefault();

    if (!acceptedTerms) {
      setMessage("❌ Debes aceptar los Términos y Condiciones");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const res = await axios.post('/api/auth/register', { name: username, email, password });
      setSuccess(true);
      setMessage("Te has registrado exitosamente ✅. Serás redirigido al login.");
      setLoading(false);

      // ⏳ Espera 4 segundos y redirige al login
      setTimeout(() => {
        setSuccess(false);
        setShowLogin(true);
        setMessage("");
        setAcceptedTerms(false);
      }, 4000);
    } catch (error) {
      setLoading(false);
      const errorMsg = error.response?.data?.msg || "Error al registrarse, intenta nuevamente";
      setMessage(`❌ ${errorMsg}`);
    }
  };

  // A simple logged-in view
  if (token) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white">
        <h1 className="text-4xl">Bienvenido a Oriluck</h1>
        <p>Próximamente: la interfaz de juegos.</p>
        <button
          onClick={() => {
            localStorage.removeItem('token');
            setToken(null);
          }}
          className="mt-4 bg-red-600 text-white py-2 px-4 rounded-lg hover:bg-red-700 transition"
        >
          Cerrar Sesión
        </button>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col items-center justify-center min-h-screen relative bg-cover bg-no-repeat"
      style={{ backgroundImage: `url(${fondo})`, backgroundPosition: "center 98%", backgroundSize: "cover" }}
    >
      {/* 🌟 Título ORILUCK estilo neón */}
      <h1 className="text-7xl font-extrabold uppercase mb-28 text-center">
        <span className="text-yellow-400 neon-glow">ORI</span>
        <span className="text-green-500 neon-glow">LUCK</span>
      </h1>

      {/* CSS Tailwind extendido */}
      <style>
      {`
        .neon-glow {
          text-shadow:
            0 0 5px #fff,
            0 0 10px #fff,
            0 0 20px #ffd700,
            0 0 30px #ffd700,
            0 0 40px #00ff00,
            0 0 55px #00ff00,
            0 0 75px #00ff00;
        }
      `}
      </style>

      {/* 🌟 Bandera de Venezuela */}
      <img
        src="https://upload.wikimedia.org/wikipedia/commons/0/06/Flag_of_Venezuela.svg"
        alt="Bandera de Venezuela"
        className="absolute bottom-4 right-4 w-30 h-38 object-contain"
      />

      {/* 🌟 Cuadro principal */}
      <div className="bg-white bg-opacity-90 p-8 rounded-2xl shadow-xl w-full max-w-md z-10">
        {initialScreen ? (
          <div className="flex flex-col space-y-4">
            <button
              onClick={() => { setShowLogin(true); setInitialScreen(false); }}
              className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 transition"
            >
              Iniciar Sesión
            </button>
            <button
              onClick={() => { setShowLogin(false); setInitialScreen(false); }}
              className="w-full bg-green-600 text-white py-3 rounded-lg hover:bg-green-700 transition"
            >
              Registrarme
            </button>
          </div>
        ) : showLogin ? (
          <>
            <h2 className="text-2xl font-bold text-center text-gray-800 mb-6">
              Iniciar Sesión
            </h2>
            <form onSubmit={handleLogin} className="space-y-4">
              <input
                type="email"
                placeholder="Correo"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full p-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-black"
              />
              <input
                type="password"
                placeholder="Contraseña"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full p-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-black"
              />
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 transition"
              >
                {loading ? "Ingresando..." : "Iniciar Sesión"}
              </button>
            </form>
            <p className="mt-4 text-center text-gray-600">
              ¿No tienes cuenta?{" "}
              <button
                onClick={() => setShowLogin(false)}
                className="text-blue-600 hover:underline"
              >
                Regístrate
              </button>
            </p>
          </>
        ) : success ? (
          <div className="text-green-600 font-bold text-center text-lg">
            {message}
          </div>
        ) : (
          <>
            <h2 className="text-2xl font-bold text-center text-gray-800 mb-6">
              Registro
            </h2>
            <form onSubmit={handleRegister} className="space-y-4">
              <input
                type="text"
                placeholder="Usuario"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="w-full p-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-black"
              />
              <input
                type="email"
                placeholder="Correo"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full p-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-black"
              />

              {/* 🌍 Código de país + Número */}
              <div className="flex space-x-2">
                <select
                  value={countryCode}
                  onChange={(e) => setCountryCode(e.target.value)}
                  className="p-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-black"
                >
                  <option value="+58">+58 Venezuela</option>
                  <option value="+51">+51 Perú</option>
                  <option value="+1">+1 USA</option>
                  <option value="+52">+52 México</option>
                  <option value="+52">+23 Atlantida</option>
                </select>
                <input
                  type="text"
                  placeholder="Número de teléfono"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                  className="flex-1 p-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-black"
                />
              </div>

              {/* ✅ Checkbox Términos y Condiciones */}
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={acceptedTerms}
                  onChange={(e) => setAcceptedTerms(e.target.checked)}
                  required
                />
                <span className="text-gray-700 text-sm">
                  Acepto los{" "}
                  <button
                    type="button"
                    className="text-blue-600 hover:underline"
                    onClick={() => setShowTermsModal(true)}
                  >
                    Términos y Condiciones
                  </button>
                </span>
              </div>

              <input
                type="password"
                placeholder="Contraseña"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full p-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-black"
              />
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-green-600 text-white py-3 rounded-lg hover:bg-green-700 transition"
              >
                {loading ? "Registrando..." : "Registrarme"}
              </button>
            </form>
            <p className="mt-4 text-center text-gray-600">
              ¿Ya tienes cuenta?{" "}
              <button
                onClick={() => setShowLogin(true)}
                className="text-blue-600 hover:underline"
              >
                Inicia sesión
              </button>
            </p>
          </>
        )}

        {/* ✅ Mensajes de error */}
        {message && !success && (
          <p
            className={`mt-4 text-center font-medium ${
              message.includes("✅") ? "text-green-600" : "text-red-600"
            }`}
          >
            {message}
          </p>
        )}
      </div>

      {/* ✅ Modal de Términos y Condiciones */}
      {showTermsModal && (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
          <div className="bg-white p-6 rounded-lg w-11/12 max-w-lg relative">
            <h2 className="text-xl font-bold mb-4">Términos y Condiciones</h2>
            <div className="h-64 overflow-y-auto text-gray-700 mb-4 space-y-2">
              <p><strong>1. Edad mínima:</strong> Oriluck es exclusivamente para personas mayores de 18 años. Al registrarte, confirmas que cumples con esta edad.</p>
              <p><strong>2. Registro y cuenta:</strong> Para participar, debes crear una cuenta válida proporcionando información veraz y completa. Eres responsable de mantener la confidencialidad de tus credenciales.</p>
              <p><strong>3. Uso de la plataforma:</strong> La plataforma está destinada únicamente para entretenimiento y participación en torneos y juegos ofrecidos por Oriluck.</p>
              <p><strong>4. Premios y comisiones:</strong> En cada torneo o juego con premio monetario, Oriluck retendrá un 30% como comisión de la casa y el 70% restante será destinado al ganador o ganadores.</p>
              <p><strong>5. Responsabilidad:</strong> Participar en Oriluck implica aceptar los riesgos asociados. Oriluck no se responsabiliza por pérdidas ocasionadas durante el uso de la plataforma.</p>
              <p><strong>6. Privacidad y datos personales:</strong> Al registrarte, aceptas que Oriluck pueda utilizar tu información personal para fines administrativos, de seguridad y legales.</p>
              <p><strong>7. Modificaciones:</strong> Oriluck se reserva el derecho de modificar estos términos y condiciones en cualquier momento, notificando a los usuarios cuando sea necesario.</p>
              <p><strong>8. Contacto:</strong> Para cualquier consulta sobre estos términos, puedes comunicarte a través del correo oficial de Oriluck.</p>
            </div>
            <button
              className="absolute top-2 right-2 text-red-500 font-bold text-lg"
              onClick={() => setShowTermsModal(false)}
            >
              ✖
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
