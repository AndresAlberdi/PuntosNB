import React, { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebase';
import { useNavigate } from 'react-router-dom';
import { seedDatabase } from '../utils/seedDatabase';
import { useAuth } from '../contexts/AuthContext';

const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { currentUser, userData, loading: authLoading } = useAuth();

  React.useEffect(() => {
    if (currentUser && userData) {
      navigate('/');
    }
  }, [currentUser, userData, navigate]);

  if (authLoading) {
    return <div className="flex justify-center items-center min-h-[calc(100vh-60px)]"><div className="text-xl">Cargando perfil...</div></div>;
  }

  if (currentUser && !userData) {
    return (
      <div className="flex flex-col justify-center items-center min-h-[calc(100vh-60px)] space-y-4">
        <div className="text-xl text-blue-600 font-medium">Cargando...</div>
      </div>
    );
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      // El useEffect se encargará de redirigir cuando el perfil cargue
    } catch (err: any) {
      setError('Credenciales incorrectas o error al iniciar sesión.');
      console.error(err);
    }
    setLoading(false);
  };

  const handleSeed = async () => {
    if (window.confirm("¿Estás seguro de poblar la base de datos? Esto creará usuarios y comercios de prueba.")) {
      setLoading(true);
      const res = await seedDatabase();
      if (res.success) {
        alert(res.message + " Ahora puedes iniciar sesión con admin@puntosnb.com / 123456");
      } else {
        alert("Error: " + res.message);
      }
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-60px)] p-4">
      <div className="bg-white shadow-xl rounded-xl p-8 w-full max-w-sm border border-gray-100">
        <h2 className="text-2xl font-bold text-center text-blue-600 mb-6">PuntosNB</h2>
        
        {error && <div className="bg-red-50 text-red-600 p-3 rounded mb-4 text-sm">{error}</div>}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Correo Electrónico</label>
            <input 
              type="email" 
              required
              className="w-full border border-gray-300 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="correo@ejemplo.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Contraseña</label>
            <input 
              type="password" 
              required
              className="w-full border border-gray-300 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••"
            />
          </div>
          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-blue-600 text-white font-medium py-2 rounded hover:bg-blue-700 transition disabled:opacity-50"
          >
            {loading ? 'Cargando...' : 'Iniciar Sesión'}
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-gray-100 text-center">
          <p className="text-sm text-gray-500 mb-2">¿Entorno de desarrollo?</p>
          <button 
            onClick={handleSeed}
            disabled={loading}
            className="text-xs bg-gray-200 text-gray-700 px-3 py-1 rounded hover:bg-gray-300 transition"
          >
            Poblar Base de Datos (Seeding)
          </button>
          <div className="text-left mt-4 text-xs text-gray-400">
            <p>Admin: admin@puntosnb.com</p>
            <p>Vendedor: vendedor@puntosnb.com</p>
            <p>Cliente: cliente@puntosnb.com</p>
            <p>Clave genérica: 123456</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
