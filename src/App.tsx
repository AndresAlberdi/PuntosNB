import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate, useLocation, Link } from 'react-router-dom';
import type { RolUsuario, Comercio } from './types';
import { AuthProvider } from './contexts/AuthContext';
import { useAuth } from './contexts/useAuth';
import { LoadingProvider } from './contexts/LoadingContext';
import Login from './pages/Login';
import AdminDashboard from './pages/AdminDashboard';
import VendedorDashboard from './pages/VendedorDashboard';
import ClienteDashboard from './pages/ClienteDashboard';
import SuperAdminDashboard from './pages/SuperAdminDashboard';
import ContadorDashboard from './pages/ContadorDashboard';
import Reportes from './pages/Reportes';
import { InfluencerDashboard } from './pages/InfluencerDashboard';
import { ChangePasswordModal } from './components/ChangePasswordModal';
import { doc, getDoc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import { COLOR_PALETTES, CLIENT_AVATARS, getPaletteStyle } from './utils/theme';
import { LoadingScreen } from './components/LoadingScreen';
import { isStaging, APP_TITLE, APP_VERSION, VERSION_VISIBLE } from './utils/env';
import { checkComercioPrepagoStatus } from './utils/reports';

const ProtectedRoute = ({ children, allowedRoles }: { children: React.ReactNode, allowedRoles?: RolUsuario[] }) => {
  const { userData, loading, logout } = useAuth();
  const [commerceBlocked, setCommerceBlocked] = React.useState(false);
  const [commerceImpago, setCommerceImpago] = React.useState(false);
  const [checkingCommerce, setCheckingCommerce] = React.useState(true);

  React.useEffect(() => {
    const verificarComercio = async () => {
      if (userData?.comercioId && (userData.rol === 'admin_comercio' || userData.rol === 'vendedor')) {
        const snap = await getDoc(doc(db, 'comercios', userData.comercioId));
        if (snap.exists()) {
          const com = snap.data() as Comercio;
          if (com.estado === 'bloqueado') {
            setCommerceBlocked(true);
          } else {
            const prepagoStatus = checkComercioPrepagoStatus(com);
            if (!prepagoStatus.puedeOperar) {
              setCommerceImpago(true);
            }
          }
        }
      }
      setCheckingCommerce(false);
    };
    verificarComercio();
  }, [userData]);

  if (loading || checkingCommerce) return <LoadingScreen />;
  
  if (!userData) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(userData.rol)) {
    return <Navigate to="/" replace />;
  }

  if (userData.estado === 'bloqueado' || commerceBlocked) {
    const isUserBlocked = userData.estado === 'bloqueado';
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
        <div className="bg-white p-8 rounded-xl shadow-lg max-w-md w-full text-center border-t-4 border-red-500">
          <div className="w-16 h-16 mx-auto bg-red-100 text-red-600 rounded-full flex items-center justify-center mb-4">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">
            {isUserBlocked ? 'Acceso Denegado' : 'Comercio Deshabilitado'}
          </h2>
          <p className="text-gray-600 mb-6">
            {isUserBlocked 
              ? 'Tu usuario ha sido bloqueado administrativamente por la plataforma.' 
              : 'El comercio ha sido deshabilitado temporalmente por un bloqueo administrativo.'}
          </p>
          <button 
            onClick={() => logout()}
            className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-4 rounded-lg transition"
          >
            Cerrar Sesión
          </button>
        </div>
      </div>
    );
  }

  if (commerceImpago) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
        <div className="bg-white p-8 rounded-xl shadow-lg max-w-md w-full text-center border-t-4 border-amber-500">
          <div className="w-16 h-16 mx-auto bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mb-4 text-2xl font-black">
            💳
          </div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">Comercio Deshabilitado Temporalmente</h2>
          <p className="text-gray-600 mb-6 text-sm">
            Comercio deshabilitado temporalmente por falta de pago. Por favor realiza tu depósito para reactivar el servicio.
          </p>
          <button 
            onClick={() => logout()}
            className="w-full bg-gray-800 hover:bg-gray-900 text-white font-bold py-3 px-4 rounded-lg transition text-sm"
          >
            Cerrar Sesión
          </button>
        </div>
      </div>
    );
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
          const c = d.data() as Comercio;
          const saldo = sMap[c.id] || 0;
          if (saldo > 0) {
             const canAfford = (c.premios || []).filter(p => p.activo && p.puntosRequeridos <= saldo).length;
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
    <Link to="/cliente/premios" className="relative p-2 text-gray-600 hover:text-brand-primary transition" title="Premios disponibles">
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"></path>
      </svg>
      {count > 0 && (
        <span className="absolute top-1 right-1 bg-brand-primary text-white text-[10px] font-black w-4 h-4 rounded-full flex items-center justify-center animate-pulse">
          {count > 9 ? '9+' : count}
        </span>
      )}
    </Link>
  );
};

const Layout = ({ children }: { children: React.ReactNode }) => {
  const { userData, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);
  const [showPasswordModal, setShowPasswordModal] = React.useState(false);
  const [showProfileModal, setShowProfileModal] = React.useState(false);
  const [selectedAvatar, setSelectedAvatar] = React.useState(userData?.avatarUrl || CLIENT_AVATARS[0]);
  const [selectedPalette, setSelectedPalette] = React.useState(userData?.paletteId || 'ocean');
  const [telefonoNumber, setTelefonoNumber] = React.useState('');
  const [telefonoCountry, setTelefonoCountry] = React.useState('+591');
  const [commercePlan, setCommercePlan] = React.useState<'regular' | 'premium'>('regular');
  const [savingProfile, setSavingProfile] = React.useState(false);

  // El formulario del perfil se llena al abrirlo, no desde un efecto: así muestra siempre el
  // teléfono vigente y no se reinicia solo porque el perfil del usuario se vuelva a leer.
  const abrirPerfil = () => {
    if (userData?.telefono) {
      const match = userData.telefono.match(/^(\+\d{1,4})(\d+)$/);
      if (match) {
        setTelefonoCountry(match[1]);
        setTelefonoNumber(match[2]);
      } else {
        setTelefonoNumber(userData.telefono);
      }
    }
    setShowProfileModal(true);
  };

  React.useEffect(() => {
    if (userData?.comercioId && (userData.rol === 'admin_comercio' || userData.rol === 'vendedor')) {
      getDoc(doc(db, 'comercios', userData.comercioId)).then(snap => {
        if (snap.exists()) {
          setCommercePlan(snap.data().plan || 'regular');
        }
      });
    }
  }, [userData]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const handleSaveProfile = async () => {
    if (!userData) return;
    setSavingProfile(true);
    try {
      const fullTelefono = telefonoNumber.trim() ? `${telefonoCountry}${telefonoNumber.trim()}` : null;
      await updateDoc(doc(db, 'users', userData.uid), {
        avatarUrl: selectedAvatar,
        paletteId: selectedPalette,
        telefono: fullTelefono
      });
      // No se retoca el objeto que entrega el contexto: `AuthProvider` escucha el documento
      // del usuario con `onSnapshot` y ya recibió estos mismos valores al escribirlos.
      setShowProfileModal(false);
    } catch (e) {
      console.error(e);
      alert("Error al actualizar perfil");
    } finally {
      setSavingProfile(false);
    }
  };

  const isGoogleUser = userData?.email?.includes('@') && !userData?.usuario;

  return (
    <div style={getPaletteStyle(userData?.paletteId || 'ocean')} className="min-h-screen bg-[var(--bg-main)] text-[var(--text-main)] transition-colors duration-300">
      {isStaging && (
        <div className="bg-brand-primary text-white text-xs font-black py-1 px-4 text-center tracking-widest uppercase shadow-inner z-50">
          Entorno de Pruebas (Staging) - Puntos Hipatia
        </div>
      )}

      <header className="bg-white border-b border-gray-100 sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="flex items-center gap-2.5">
              <img 
                src="/logo-hipatia.png" 
                alt="Logo Hipatia" 
                className="h-9 w-auto max-h-9 object-contain"
                onError={(e) => {
                  // Fallback si la imagen no carga
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
              <span className="font-black text-xl text-gray-800 tracking-tight flex items-center gap-1.5">
                Hipatia <span className="text-brand-primary font-bold">Puntos</span>
                {isStaging ? (
                  <span className="text-[11px] font-black text-purple-700 bg-purple-100 px-2 py-0.5 rounded-full border border-purple-200 uppercase tracking-tight">
                    (pruebas {APP_VERSION})
                  </span>
                ) : (
                  // En producción la versión va discreta, pero visible: permite saber qué está
                  // corriendo un comercio sin preguntar nada.
                  <span className="text-[10px] font-medium text-gray-400 tracking-tight" title={`Compilado el ${VERSION_VISIBLE}`}>
                    {APP_VERSION}
                  </span>
                )}
              </span>
            </Link>
          </div>

          {userData && (
            <div className="flex items-center gap-3">
              <NotificationBell />

              {/* Botón Hamburguesa Móvil */}
              <button 
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="sm:hidden p-2 text-gray-600 hover:text-gray-900 rounded-lg hover:bg-gray-100 focus:outline-none"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {isMobileMenuOpen ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"></path>
                  )}
                </svg>
              </button>

              {/* Menú Desktop */}
              <div className="hidden sm:flex items-center gap-4">
                {userData.rol === 'cliente' && (
                  <button
                    onClick={abrirPerfil}
                    className="flex items-center gap-2 text-xs font-semibold text-gray-600 hover:text-brand-primary transition py-1 px-2 rounded-lg hover:bg-gray-50 border border-gray-200"
                  >
                    <img 
                      src={userData.avatarUrl || CLIENT_AVATARS[0]} 
                      alt="Avatar" 
                      className="w-6 h-6 rounded-full border bg-white object-contain" 
                    />
                    <span>Perfil</span>
                  </button>
                )}

                {userData?.rol === 'superadmin' && (
                  <div className="flex gap-2">
                    <Link 
                      to="/superadmin" 
                      className={`text-sm font-medium px-3 py-1 rounded transition border ${location.pathname.startsWith('/superadmin') ? 'bg-brand-bg-light text-brand-primary border-brand-border font-bold' : 'text-gray-600 hover:bg-gray-100 border-transparent'}`}
                    >
                      Panel Sistema
                    </Link>
                    <button 
                      onClick={() => navigate('/reportes')}
                      className={`text-sm font-medium px-3 py-1 rounded transition border ${location.pathname === '/reportes' ? 'bg-brand-bg-light text-brand-primary border-brand-border font-bold' : 'text-gray-600 hover:bg-gray-100 border-transparent'}`}
                    >
                      Reportes
                    </button>
                  </div>
                )}

                {userData?.rol === 'contador' && (
                  <div className="flex gap-2">
                    <Link 
                      to="/contador" 
                      className={`text-sm font-medium px-3 py-1 rounded transition border ${location.pathname.startsWith('/contador') ? 'bg-brand-bg-light text-brand-primary border-brand-border font-bold' : 'text-gray-600 hover:bg-gray-100 border-transparent'}`}
                    >
                      Cobranzas Prepago
                    </Link>
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
                  className="text-sm font-medium text-red-600 hover:text-red-700 font-semibold cursor-pointer"
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
                onClick={() => { abrirPerfil(); setIsMobileMenuOpen(false); }}
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

            {userData?.rol === 'contador' && (
              <Link to="/contador" onClick={() => setIsMobileMenuOpen(false)} className="block w-full text-left text-sm font-medium text-brand-primary py-2">Cobranzas Prepago</Link>
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

      <main className="w-full max-w-7xl mx-auto mt-6 px-4 sm:px-6 lg:px-8">
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
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => setShowProfileModal(false)}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSaveProfile}
                  disabled={savingProfile}
                  className="px-4 py-2 bg-brand-primary text-white font-medium rounded-lg hover:bg-brand-primary-hover transition text-sm"
                >
                  {savingProfile ? 'Guardando...' : 'Guardar Cambios'}
                </button>
              </div>
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

      <Route path="/contador/*" element={
        <ProtectedRoute allowedRoles={['contador', 'superadmin']}>
          <ContadorDashboard />
        </ProtectedRoute>
      } />

      <Route path="/influencer/*" element={
        <ProtectedRoute allowedRoles={['influencer']}>
          <InfluencerDashboard />
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
        userData.rol === 'contador' ? <Navigate to="/contador" replace /> :
        userData.rol === 'influencer' ? <Navigate to="/influencer" replace /> :
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
    <LoadingProvider>
      <AuthProvider>
        <Router>
          <Layout>
            <AppRoutes />
          </Layout>
        </Router>
      </AuthProvider>
    </LoadingProvider>
  );
}

export default App;
