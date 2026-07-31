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
import { doc, getDoc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import { COLOR_PALETTES, CLIENT_AVATARS, getPaletteStyle } from './utils/theme';
import { LoadingScreen } from './components/LoadingScreen';
import { isStaging, APP_TITLE } from './utils/env';


const ProtectedRoute = ({ children, allowedRoles }: { children: React.ReactNode, allowedRoles?: RolUsuario[] }) => {
  const { currentUser, userData, loading } = useAuth();

  if (loading) return <LoadingScreen />;
  
  if (!currentUser || !userData) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(userData.rol)) {
    return <Navigate to="/" replace />; // Or unauthorized page
  }

  return <>{children}</>;
};

const NotificationBell = () => {
  const { userData } = useAuth();
  const [count, setCount] = React.useState(0);

  React.useEffect(() => {
    if (!userData || userData.rol !== 'cliente') return;
    const fetchPremios = async () => {
      try {
        const saldosQ = query(collection(db, 'puntos_saldos'), where('clienteId', '==', userData.uid));
        const saldosSnap = await getDocs(saldosQ);
        const sMap: Record<string, number> = {};
        saldosSnap.forEach(d => {
          const s = d.data();
          sMap[s.comercioId] = s.saldoTotal;
        });

        const comerciosSnap = await getDocs(collection(db, 'comercios'));
        let totalPrizes = 0;
        comerciosSnap.forEach(d => {
          const c = d.data();
          const saldo = sMap[c.id] || 0;
          if (saldo > 0) {
             const canAfford = (c.premios || []).filter((p: any) => p.activo && p.puntosRequeridos <= saldo).length;
             totalPrizes += canAfford;
          }
        });
        setCount(totalPrizes);
      } catch (e) {
        console.error(e);
      }
    };
    fetchPremios();
  }, [userData]);

  if (!userData || userData.rol !== 'cliente') return null;

  return (
    <Link to="/cliente/premios" className="relative p-2 text-gray-500 hover:text-brand-primary transition">
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
      {count > 0 && (
        <span className="absolute top-1 right-1 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full flex items-center justify-center transform translate-x-1/2 -translate-y-1/2">
          {count}
        </span>
      )}
    </Link>
  );
};

const Layout = ({ children }: { children: React.ReactNode }) => {
  const { currentUser, userData } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [showPasswordModal, setShowPasswordModal] = React.useState(false);
  const [showProfileModal, setShowProfileModal] = React.useState(false);
  const [commercePaletteId, setCommercePaletteId] = React.useState<string | undefined>(undefined);
  const [commercePlan, setCommercePlan] = React.useState<'regular' | 'premium'>('premium');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);

  const [isDarkMode, setIsDarkMode] = React.useState(() => {
    return localStorage.getItem('theme') === 'dark';
  });

  React.useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  // States for Profile Modal form
  const [selectedPalette, setSelectedPalette] = React.useState('ocean');
  const [selectedAvatar, setSelectedAvatar] = React.useState('');
  const [telefonoCountry, setTelefonoCountry] = React.useState('+591');
  const [telefonoNumber, setTelefonoNumber] = React.useState('');

  React.useEffect(() => {
    if (userData?.comercioId) {
      getDoc(doc(db, 'comercios', userData.comercioId)).then(snap => {
        if (snap.exists()) {
          const data = snap.data();
          setCommercePaletteId(data.paletteId);
          setCommercePlan(data.plan || 'regular');
        }
      });
    } else {
      setCommercePaletteId(undefined);
      setCommercePlan('premium');
    }

    if (userData?.rol === 'cliente') {
      setSelectedPalette(userData.paletteId || 'ocean');
      setSelectedAvatar(userData.avatarUrl || CLIENT_AVATARS[0]);
      if (userData.telefono) {
        // Attempt to parse country code and number. Assuming typical format +XXX NNNNN
        const match = userData.telefono.match(/^(\+\d{1,3})\s?(.*)$/);
        if (match) {
          setTelefonoCountry(match[1]);
          setTelefonoNumber(match[2].replace(/\D/g, ''));
        } else {
          setTelefonoNumber(userData.telefono.replace(/\D/g, ''));
        }
      } else {
        setTelefonoNumber('');
      }
    }
  }, [userData]);

  const handleLogout = () => {
    import('firebase/auth').then(({ signOut }) => {
      import('./firebase').then(({ auth }) => {
        signOut(auth);
      });
    });
  };

  const handleSaveProfile = async () => {
    if (userData?.uid) {
      try {
        const fullPhone = telefonoNumber ? `${telefonoCountry}${telefonoNumber}` : '';
        await updateDoc(doc(db, 'users', userData.uid), {
          paletteId: selectedPalette,
          avatarUrl: selectedAvatar,
          telefono: fullPhone
        });
        setShowProfileModal(false);
      } catch (err) {
        console.error("Error saving profile", err);
        alert("Error al guardar cambios de perfil.");
      }
    }
  };

  let activePaletteId: string | undefined = undefined;
  if (userData?.rol === 'cliente') {
    activePaletteId = userData.paletteId;
  } else if (userData?.rol === 'superadmin') {
    activePaletteId = 'charcoal';
  } else if (userData?.rol === 'admin_comercio' || userData?.rol === 'vendedor') {
    activePaletteId = commercePaletteId;
  }

  const isGoogleUser = currentUser?.providerData?.some(p => p.providerId === 'google.com');

  return (
    <div style={getPaletteStyle(activePaletteId)} className="min-h-screen bg-[var(--bg-main)] font-sans text-[var(--text-main)] transition-colors duration-300">
      <header className="bg-[var(--bg-surface)] shadow-sm border-b border-[var(--border-color)]">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-1.5 text-xl font-black text-brand-primary tracking-tight hover:opacity-80 transition z-10">
            <img src="/logo-hipatia.png" alt="Hipatia Logo" className="w-8 h-8 object-contain" />
            <span>Hipatia{isStaging ? ' (pruebas)' : ''}</span>
          </Link>
          
          {userData && (
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setIsDarkMode(!isDarkMode)}
                className="p-2 text-gray-500 hover:text-[var(--accent-primary)] transition rounded-full hover:bg-[var(--bg-main)]"
                title={isDarkMode ? "Cambiar a Modo Día" : "Cambiar a Modo Noche"}
              >
                {isDarkMode ? '☀️' : '🌙'}
              </button>
              <NotificationBell />
              
              {/* Botón menú móvil */}
              <button 
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="p-2 -mr-2 text-gray-600 sm:hidden hover:text-gray-900 focus:outline-none"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={isMobileMenuOpen ? "M6 18L18 6M6 6l12 12" : "M4 6h16M4 12h16M4 18h16"} />
                </svg>
              </button>

              {/* Menú Desktop */}
              <div className="hidden sm:flex items-center gap-4">
                {userData?.rol === 'cliente' ? (
                  <button 
                    onClick={() => setShowProfileModal(true)}
                    className="flex items-center gap-2 hover:bg-brand-bg-light p-1.5 rounded-lg transition border border-transparent hover:border-brand-border"
                  >
                    <img 
                      src={userData.avatarUrl || CLIENT_AVATARS[0]} 
                      alt="Avatar" 
                      className="w-8 h-8 rounded-full border bg-white object-contain" 
                    />
                    <span className="text-sm font-medium text-gray-700 truncate max-w-[120px]">
                      Hola, {userData.nombre}
                    </span>
                  </button>
                ) : (
                  <span className="text-sm font-medium text-gray-700 truncate max-w-[150px]">
                    Hola, {userData.nombre}
                  </span>
                )}
                
                {userData?.rol === 'superadmin' && (
                  <div className="flex gap-2">
                    <Link to="/superadmin" className={`text-sm font-medium px-3 py-1 rounded transition border ${location.pathname.startsWith('/superadmin') ? 'bg-brand-bg-light text-brand-primary border-brand-border font-bold' : 'text-gray-600 hover:bg-gray-100 border-transparent'}`}>Panel Sistema</Link>
                    <button 
                      onClick={() => navigate('/reportes')}
                      className={`text-sm font-medium px-3 py-1 rounded transition border ${location.pathname === '/reportes' ? 'bg-brand-bg-light text-brand-primary border-brand-border font-bold' : 'text-gray-600 hover:bg-gray-100 border-transparent'}`}
                    >
                      Reportes
                    </button>
                  </div>
                )}
                
                {(userData?.rol === 'admin_comercio' || userData?.rol === 'vendedor') && (
                  <div className="flex gap-2">
                    <button 
                      onClick={() => navigate(`/${userData.rol === 'vendedor' ? 'vendedor' : 'admin'}`)}
                      className={`text-sm font-medium px-3 py-1 rounded transition border ${location.pathname.startsWith('/admin') || location.pathname.startsWith('/vendedor') ? 'bg-brand-bg-light text-brand-primary border-brand-border font-bold' : 'text-gray-600 hover:bg-gray-100 border-transparent'}`}
                    >
                      Operación
                    </button>
                    {commercePlan === 'premium' && (
                      <button 
                        onClick={() => navigate('/reportes')}
                        className={`text-sm font-medium px-3 py-1 rounded transition border ${location.pathname === '/reportes' ? 'bg-brand-bg-light text-brand-primary border-brand-border font-bold' : 'text-gray-600 hover:bg-gray-100 border-transparent'}`}
                      >
                        Reportes
                      </button>
                    )}
                  </div>
                )}
                
                <span className="text-xs font-bold text-brand-primary bg-brand-bg-light border border-brand-border px-2.5 py-1 rounded-full uppercase tracking-wider">
                  {userData?.rol}
                </span>
                
                {userData.rol !== 'cliente' && !isGoogleUser && (
                  <button 
                    onClick={() => setShowPasswordModal(true)}
                    className="text-sm font-medium text-gray-600 hover:text-gray-900"
                  >
                    Clave
                  </button>
                )}

                <button 
                  onClick={handleLogout}
                  className="text-sm font-medium text-red-600 hover:text-red-700 font-semibold"
                >
                  Salir
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Menú Móvil Desplegable */}
        {userData && isMobileMenuOpen && (
          <div className="sm:hidden border-t border-gray-100 bg-white px-4 pt-2 pb-4 space-y-3 shadow-inner">
            <div className="flex items-center gap-3 mb-4 pb-3 border-b border-gray-100">
              {userData.rol === 'cliente' && (
                <img 
                  src={userData.avatarUrl || CLIENT_AVATARS[0]} 
                  alt="Avatar" 
                  className="w-10 h-10 rounded-full border bg-white object-contain" 
                />
              )}
              <div className="flex-1">
                <p className="text-sm font-bold text-gray-800">Hola, {userData.nombre}</p>
                <p className="text-xs font-bold text-brand-primary uppercase mt-0.5">{userData.rol}</p>
              </div>
            </div>

            {userData.rol === 'cliente' && (
              <button 
                onClick={() => { setShowProfileModal(true); setIsMobileMenuOpen(false); }}
                className="block w-full text-left text-sm font-medium text-gray-700 py-2"
              >
                Mi Perfil y Configuraciones
              </button>
            )}

            {userData?.rol === 'superadmin' && (
              <>
                <Link to="/superadmin" onClick={() => setIsMobileMenuOpen(false)} className="block w-full text-left text-sm font-medium text-brand-primary py-2">Panel Sistema</Link>
                <button 
                  onClick={() => { navigate('/reportes'); setIsMobileMenuOpen(false); }}
                  className="block w-full text-left text-sm font-medium text-gray-700 py-2"
                >
                  Reportes
                </button>
              </>
            )}

            {(userData?.rol === 'admin_comercio' || userData?.rol === 'vendedor') && (
              <>
                <button 
                  onClick={() => { navigate(`/${userData.rol === 'vendedor' ? 'vendedor' : 'admin'}`); setIsMobileMenuOpen(false); }}
                  className="block w-full text-left text-sm font-medium text-gray-700 py-2"
                >
                  Operación
                </button>
                {commercePlan === 'premium' && (
                  <button 
                    onClick={() => { navigate('/reportes'); setIsMobileMenuOpen(false); }}
                    className="block w-full text-left text-sm font-medium text-gray-700 py-2"
                  >
                    Reportes
                  </button>
                )}
              </>
            )}

            {userData.rol !== 'cliente' && !isGoogleUser && (
              <button 
                onClick={() => { setShowPasswordModal(true); setIsMobileMenuOpen(false); }}
                className="block w-full text-left text-sm font-medium text-gray-700 py-2"
              >
                Cambiar Clave
              </button>
            )}

            <button 
              onClick={handleLogout}
              className="block w-full text-left text-sm font-bold text-red-600 py-2"
            >
              Cerrar Sesión
            </button>
          </div>
        )}
      </header>
      <main className="max-w-4xl mx-auto mt-6 px-4">
        {children}
      </main>

      {showPasswordModal && <ChangePasswordModal onClose={() => setShowPasswordModal(false)} />}

      {/* Modal de Edición de Perfil de Cliente */}
      {showProfileModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold text-gray-800 mb-4 border-b pb-2">Configuración de Perfil</h3>
            
            <div className="space-y-6">
              {/* Selector de Avatar */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Elige tu Avatar</label>
                <div className="grid grid-cols-5 gap-3">
                  {CLIENT_AVATARS.map((avatar, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setSelectedAvatar(avatar)}
                      className={`p-1 rounded-full border-2 transition hover:scale-105 ${selectedAvatar === avatar ? 'border-brand-primary bg-brand-bg-light shadow-md' : 'border-gray-200 hover:border-gray-400 bg-white'}`}
                    >
                      <img src={avatar} alt={`Avatar ${idx+1}`} className="w-12 h-12 rounded-full object-contain" />
                    </button>
                  ))}
                </div>
              </div>

              {/* Selector de Paleta */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Elige tu Paleta de Colores</label>
                <div className="grid grid-cols-2 gap-2">
                  {COLOR_PALETTES.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelectedPalette(p.id)}
                      className={`p-2.5 rounded-lg border text-left text-sm font-medium transition flex items-center gap-2 ${selectedPalette === p.id ? 'border-brand-primary bg-brand-bg-light font-bold text-brand-primary' : 'border-gray-200 hover:bg-gray-50 text-gray-700'}`}
                    >
                      <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: p.primary }}></span>
                      <span className="truncate">{p.name}</span>
                    </button>
                  ))}
                </div>
              </div>
              {/* Teléfono */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Número de WhatsApp (Opcional)</label>
                <div className="flex gap-2">
                  <select
                    value={telefonoCountry}
                    onChange={(e) => setTelefonoCountry(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-primary w-28 bg-white"
                  >
                    <option value="+591">🇧🇴 +591</option>
                    <option value="+54">🇦🇷 +54</option>
                    <option value="+55">🇧🇷 +55</option>
                    <option value="+56">🇨🇱 +56</option>
                    <option value="+57">🇨🇴 +57</option>
                    <option value="+593">🇪🇨 +593</option>
                    <option value="+34">🇪🇸 +34</option>
                    <option value="+52">🇲🇽 +52</option>
                    <option value="+51">🇵🇪 +51</option>
                    <option value="+598">🇺🇾 +598</option>
                    <option value="+1">🇺🇸 +1</option>
                  </select>
                  <input 
                    type="tel"
                    value={telefonoNumber}
                    onChange={(e) => setTelefonoNumber(e.target.value.replace(/\D/g, ''))}
                    placeholder="Ej: 71234567"
                    className="flex-1 border border-gray-300 px-3 py-2 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-primary"
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">Regístralo para poder acceder a futuras funciones integradas con WhatsApp.</p>
              </div>

              {/* Botón Cambiar Clave Integrado */}
              {!isGoogleUser && (
                <div className="pt-4 border-t">
                  <button 
                    type="button"
                    onClick={() => { setShowProfileModal(false); setShowPasswordModal(true); }}
                    className="w-full py-2 bg-gray-100 text-gray-700 font-semibold rounded-lg hover:bg-gray-200 transition text-sm flex items-center justify-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
                    Cambiar Contraseña
                  </button>
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-3 border-t pt-4">
              <button 
                onClick={() => setShowProfileModal(false)} 
                className="px-4 py-2 border rounded-lg text-gray-600 hover:bg-gray-50 text-sm font-medium"
              >
                Cancelar
              </button>
              <button 
                onClick={handleSaveProfile} 
                className="px-4 py-2 bg-brand-primary hover:bg-brand-primary-hover text-white rounded-lg text-sm font-semibold transition"
              >
                Guardar Cambios
              </button>
            </div>
          </div>
        </div>
      )}
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
  const [showSplash, setShowSplash] = React.useState(true);

  React.useEffect(() => {
    document.title = APP_TITLE;
    const timer = setTimeout(() => {
      setShowSplash(false);
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  if (showSplash) {
    return <LoadingScreen isSplash={true} />;
  }

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
