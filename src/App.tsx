import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate, useLocation, Link } from 'react-router-dom';
import type { RolUsuario } from './types';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Login from './pages/Login';
import AdminDashboard from './pages/AdminDashboard';
import VendedorDashboard from './pages/VendedorDashboard';
import ClienteDashboard from './pages/ClienteDashboard';
import SuperAdminDashboard from './pages/SuperAdminDashboard';
import Reportes from './pages/Reportes';
import { ChangePasswordModal } from './components/ChangePasswordModal';

const ProtectedRoute = ({ children, allowedRoles }: { children: React.ReactNode, allowedRoles?: RolUsuario[] }) => {
  const { currentUser, userData, loading } = useAuth();

  if (loading) return <div className="flex justify-center items-center h-screen">Cargando...</div>;
  
  if (!currentUser || !userData) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(userData.rol)) {
    return <Navigate to="/" replace />; // Or unauthorized page
  }

  return <>{children}</>;
};

const Layout = ({ children }: { children: React.ReactNode }) => {
  const { userData } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [showPasswordModal, setShowPasswordModal] = React.useState(false);

  const handleLogout = () => {
    import('firebase/auth').then(({ signOut }) => {
      import('./firebase').then(({ auth }) => {
        signOut(auth);
      });
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 font-sans">
      <header className="bg-white shadow-sm border-b border-gray-100">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
          <h1 className="text-xl font-black text-blue-600 tracking-tight">PuntosNB</h1>
          {userData && (
            <div className="flex items-center gap-2 sm:gap-4 flex-wrap justify-end">
              <span className="text-sm font-medium text-gray-700 truncate max-w-[120px] sm:max-w-xs">Hola, {userData.nombre}</span>
              {userData?.rol === 'superadmin' && (
                <Link to="/superadmin" className="text-sm font-medium text-blue-600 hover:text-blue-800">Panel Sistema</Link>
              )}
              {(userData?.rol === 'admin_comercio' || userData?.rol === 'vendedor') && (
                <div className="flex gap-2">
                  <button 
                    onClick={() => navigate(`/${userData.rol === 'cliente' ? 'cliente' : userData.rol === 'vendedor' ? 'vendedor' : 'admin'}`)}
                    className={`text-sm font-medium px-3 py-1 rounded ${location.pathname.startsWith('/admin') || location.pathname.startsWith('/vendedor') ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
                  >
                    Operación
                  </button>
                  <button 
                    onClick={() => navigate('/reportes')}
                    className={`text-sm font-medium px-3 py-1 rounded ${location.pathname === '/reportes' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
                  >
                    Reportes
                  </button>
                </div>
              )}
              <span className="text-sm font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded-full uppercase tracking-wider">{userData?.rol}</span>
              
              <button 
                onClick={() => setShowPasswordModal(true)}
                className="text-sm font-medium text-gray-600 hover:text-gray-900"
              >
                Cambiar Clave
              </button>

              <button 
                onClick={handleLogout}
                className="text-sm font-medium text-red-600 hover:text-red-700"
              >
                Salir
              </button>
            </div>
          )}
        </div>
      </header>
      <main className="max-w-4xl mx-auto mt-6 px-4">
        {children}
      </main>

      {showPasswordModal && <ChangePasswordModal onClose={() => setShowPasswordModal(false)} />}
    </div>
  );
};

const AppRoutes = () => {
  const { userData } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      
      <Route path="/cliente/*" element={
        <ProtectedRoute allowedRoles={['cliente']}>
          <ClienteDashboard />
        </ProtectedRoute>
      } />

      <Route path="/vendedor/*" element={
        <ProtectedRoute allowedRoles={['vendedor', 'admin_comercio']}>
          <VendedorDashboard />
        </ProtectedRoute>
      } />

      <Route path="/admin/*" element={
        <ProtectedRoute allowedRoles={['admin_comercio', 'superadmin']}>
          <AdminDashboard />
        </ProtectedRoute>
      } />

      <Route path="/superadmin/*" element={
        <ProtectedRoute allowedRoles={['superadmin']}>
          <SuperAdminDashboard />
        </ProtectedRoute>
      } />

      <Route path="/reportes" element={
        <ProtectedRoute allowedRoles={['admin_comercio', 'superadmin', 'vendedor']}>
          <Reportes />
        </ProtectedRoute>
      } />

      <Route path="/" element={
        !userData ? <Navigate to="/login" replace /> :
        userData.rol === 'cliente' ? <Navigate to="/cliente" replace /> :
        userData.rol === 'vendedor' ? <Navigate to="/vendedor" replace /> :
        userData.rol === 'superadmin' ? <Navigate to="/superadmin" replace /> :
        <Navigate to="/admin" replace />
      } />
    </Routes>
  );
};

function App() {
  return (
    <AuthProvider>
      <Router>
        <Layout>
          <AppRoutes />
        </Layout>
      </Router>
    </AuthProvider>
  );
}

export default App;
