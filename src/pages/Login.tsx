import React, { useState, useEffect } from 'react';
import { signInWithEmailAndPassword, signInWithCustomToken, signInWithPopup, GoogleAuthProvider, sendPasswordResetEmail } from 'firebase/auth';
import type { User as FirebaseUser } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { LoadingScreen } from '../components/LoadingScreen';
import { isStaging, APP_VERSION } from '../utils/env';
import { initRecaptcha, executeRecaptcha } from '../utils/recaptcha';
import { invocar, errorFirebase, type RespuestaLoginVendedor } from '../utils/backend';

const Login: React.FC = () => {
  const [usuario, setUsuario] = useState('');
  const [passwordOrPin, setPasswordOrPin] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showLoginTraditional, setShowLoginTraditional] = useState(false);
  const [error, setError] = useState('');
  const [mensaje, setMensaje] = useState<{ texto: string; tipo: 'success' | 'error' } | null>(null);
  const [loading, setLoading] = useState(false);
  const [aceptoTerminos, setAceptoTerminos] = useState(false);
  const [showTerminosModal, setShowTerminosModal] = useState(false);
  const [pendingGoogleUser, setPendingGoogleUser] = useState<FirebaseUser | null>(null);
  const navigate = useNavigate();
  const { currentUser, userData, loading: authLoading, logout } = useAuth();

  const [welcomePhone, setWelcomePhone] = useState('');
  const [welcomeCountryCode, setWelcomeCountryCode] = useState('+591');
  const [welcomeError, setWelcomeError] = useState('');

  useEffect(() => {
    initRecaptcha();
  }, []);

  useEffect(() => {
    if (userData && (userData.telefono || userData.rol !== 'cliente')) {
      navigate('/');
    }
  }, [userData, navigate]);

  if (authLoading) {
    return <LoadingScreen />;
  }

  if (currentUser && !userData && !pendingGoogleUser) {
    return (
      <div className="flex flex-col justify-center items-center min-h-[calc(100vh-60px)] space-y-4 p-4 text-center">
        <div className="text-xl text-brand-primary font-bold mb-2">Comprobando estado de usuario...</div>
        <p className="text-gray-500 max-w-sm text-sm mb-4">Si esta pantalla no desaparece, es probable que tu comercio esté deshabilitado temporalmente por falta de pago o tu usuario requiera activación.</p>
        <button 
          onClick={() => logout()}
          className="bg-brand-primary text-white text-xs font-bold py-2 px-4 rounded-lg hover:bg-brand-primary-hover transition cursor-pointer"
        >
          Cerrar Sesión para reintentar
        </button>
      </div>
    );
  }

  if (currentUser && userData && !userData.telefono && userData.rol === 'cliente') {
    const handleSaveWelcomePhone = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!welcomePhone) {
        setWelcomeError('Por favor ingresa un número de teléfono válido.');
        return;
      }
      setWelcomeError('');
      setLoading(true);
      try {
        const fullPhoneNumber = `${welcomeCountryCode}${welcomePhone}`;
        await updateDoc(doc(db, 'users', currentUser.uid), { telefono: fullPhoneNumber });
        navigate('/');
      } catch (err) {
        console.error("Error saving phone to user profile", err);
        setWelcomeError("Error guardando el número. Intenta de nuevo.");
      }
      setLoading(false);
    };

    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-60px)] p-4">
        <div className="bg-white p-8 rounded-xl shadow-xl max-w-md w-full border border-gray-100">
          <div className="flex justify-center mb-4">
            <img src="/logo-hipatia.png" alt="Hipatia Logo" className="w-12 h-12 object-contain" />
          </div>
          <h2 className="text-xl font-bold text-center mb-2 text-gray-800">¡Bienvenido a Hipatia!</h2>
          <p className="text-sm text-gray-600 text-center mb-6">
            Ingresa tu número de Whatsapp. Lo usaremos solamente para temas relacionados con Hipatia Puntos y otros productos de Hipatia, no compartiremos tus datos con nadie, ni siquiera con terceros. La ventaja es que podrás recuperar tu cuenta por teléfono si lo pierdes o te lo roban.
          </p>

          {welcomeError && (
            <div className="bg-red-50 border border-red-200 text-red-600 p-3 rounded text-sm mb-4">
              {welcomeError}
            </div>
          )}

          <form onSubmit={handleSaveWelcomePhone} className="space-y-4">
            <div className="flex gap-2">
              <select
                value={welcomeCountryCode}
                onChange={(e) => setWelcomeCountryCode(e.target.value)}
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
                value={welcomePhone}
                onChange={(e) => setWelcomePhone(e.target.value.replace(/\D/g, ''))}
                placeholder="Ej: 71234567"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-primary"
                required
              />
            </div>
            
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-brand-primary hover:bg-brand-primary-hover text-white font-medium py-2 px-4 rounded-md transition-colors disabled:opacity-70"
            >
              {loading ? 'Guardando...' : 'Aceptar y Finalizar'}
            </button>
            
            <button
              type="button"
              onClick={() => logout()}
              className="w-full mt-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium py-2 px-4 rounded-md transition-colors"
            >
              Cancelar y Cerrar Sesión
            </button>
          </form>
        </div>
      </div>
    );
  }

  const handleTraditionalAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMensaje(null);
    setLoading(true);

    try {
      // 1. Ejecutar reCAPTCHA Enterprise en producción
      await executeRecaptcha('LOGIN');

      const userInput = usuario.trim().toLowerCase();
      const passOrPin = passwordOrPin.trim();

      // 2. Vendedor: el PIN se valida en el servidor, que devuelve un custom token con su rol
      // y su comercio. El navegador ya no compara PIN ni guarda una "sesión" en localStorage (H-04).
      if (/^\d{6}$/.test(passOrPin)) {
        try {
          const respuesta = await invocar<{ usuario: string; pin: string }, RespuestaLoginVendedor>(
            'loginVendedor',
            { usuario: userInput, pin: passOrPin },
          );
          await signInWithCustomToken(auth, respuesta.token);
          navigate('/');
          setLoading(false);
          return;
        } catch (errVendedor) {
          // Si el identificador no corresponde a un vendedor, se sigue con el acceso por
          // contraseña: hay administradores cuya contraseña también es de seis dígitos.
          const mensaje = errVendedor instanceof Error ? errVendedor.message : '';
          if (!mensaje.includes('Usuario o PIN incorrectos')) {
            setError(mensaje || 'No se pudo iniciar sesión.');
            setLoading(false);
            return;
          }
        }
      }

      // 3. Acceso administrativo por Firebase Auth. Ya no se consulta qué métodos tiene el
      // correo: esa llamada revelaba si una cuenta existe y es incompatible con la protección
      // contra enumeración de correos (H-19). Si la cuenta es de Google, el error lo dice.
      await signInWithEmailAndPassword(auth, userInput, passwordOrPin);
    } catch (err) {
      console.error(err);
      if (errorFirebase(err).code === 'auth/invalid-credential' || errorFirebase(err).code === 'auth/wrong-password' || errorFirebase(err).code === 'auth/user-not-found') {
        setError('Usuario o contraseña incorrectos. Si te registraste con Google, usa el botón "Continuar con Google".');
      } else if (errorFirebase(err).code === 'auth/too-many-requests') {
        setError('Demasiados intentos fallidos. Intenta más tarde.');
      } else {
        setError(errorFirebase(err).message || 'Error al autenticar.');
      }
    }
    setLoading(false);
  };

  const handleRecuperarClave = async () => {
    if (!usuario) {
      setError('Por favor, ingresa tu identificador de usuario arriba para poder procesar la solicitud.');
      return;
    }
    setError('');
    setMensaje(null);
    try {
      await sendPasswordResetEmail(auth, usuario.trim());
      setMensaje({ texto: 'Se ha enviado un enlace de recuperación si la cuenta está asociada a un acceso administrado.', tipo: 'success' });
    } catch (err) {
      if (errorFirebase(err).code === 'auth/user-not-found') {
        setError('No existe ninguna cuenta de autenticación registrada con este identificador.');
      } else {
        setError('Error al intentar enviar el correo: ' + errorFirebase(err).message);
      }
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      const userCred = await signInWithPopup(auth, provider);
      
      const userDocRef = doc(db, 'users', userCred.user.uid);
      const userDoc = await getDoc(userDocRef);
      
      if (!userDoc.exists()) {
        if (!aceptoTerminos) {
          setPendingGoogleUser(userCred.user);
          setLoading(false);
          return;
        }
        await setDoc(userDocRef, {
          uid: userCred.user.uid,
          email: userCred.user.email,
          nombre: userCred.user.displayName || userCred.user.email?.split('@')[0],
          rol: 'cliente',
          termsAccepted: true,
          termsAcceptedAt: Date.now(),
          createdAt: Date.now()
        });
      }
    } catch (err) {
      if (errorFirebase(err).code === 'auth/account-exists-with-different-credential') {
        setError('Ya te has registrado previamente con otro método. Por favor intenta de nuevo.');
      } else {
        setError('Error al iniciar sesión con Google: ' + errorFirebase(err).message);
      }
      console.error(err);
    }
    setLoading(false);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-60px)] p-4">
      {pendingGoogleUser ? (
        <div className="bg-white shadow-xl rounded-xl p-8 w-full max-w-md border border-gray-100">
           <div className="flex items-center justify-center gap-2 mb-4 text-brand-primary">
              <img src="/logo-hipatia.png" alt="Hipatia Logo" className="w-12 h-12 object-contain" />
           </div>
           <h2 className="text-2xl font-bold tracking-tight text-gray-800 mb-2">¡Bienvenido a Hipatia!</h2>
           <p className="text-gray-600 mb-6 text-sm">
             Como es tu primer ingreso con Google, necesitamos que aceptes nuestros Términos y Condiciones para crear tu perfil de cliente.
           </p>
           <div className="flex items-start gap-2 text-sm text-gray-600 mb-6 text-left bg-gray-50 p-4 rounded-lg border">
              <input 
                type="checkbox" 
                id="terminos-google" 
                checked={aceptoTerminos} 
                onChange={(e) => setAceptoTerminos(e.target.checked)}
                className="mt-1 h-4 w-4 text-brand-primary border-gray-300 rounded focus:ring-brand-primary" 
              />
              <label htmlFor="terminos-google" className="leading-tight">
                He leído y acepto los{' '}
                <button 
                  type="button" 
                  onClick={() => setShowTerminosModal(true)} 
                  className="text-brand-primary font-semibold hover:underline"
                >
                  Términos y Condiciones
                </button>{' '}
                de Hipatia.
              </label>
           </div>
           {error && <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4 text-sm font-medium">{error}</div>}
           <div className="flex gap-3">
             <button 
               onClick={() => {
                 logout();
                 setPendingGoogleUser(null);
               }}
               className="flex-1 bg-gray-100 text-gray-700 font-medium py-2 rounded hover:bg-gray-200 transition"
             >
               Cancelar
             </button>
             <button 
               onClick={async () => {
                 if (!aceptoTerminos) return;
                 setLoading(true);
                 setError('');
                 try {
                   const userDocRef = doc(db, 'users', pendingGoogleUser.uid);
                   await setDoc(userDocRef, {
                     uid: pendingGoogleUser.uid,
                     email: pendingGoogleUser.email,
                     nombre: pendingGoogleUser.displayName || pendingGoogleUser.email?.split('@')[0],
                     rol: 'cliente',
                     termsAccepted: true,
                     termsAcceptedAt: Date.now(),
                     createdAt: Date.now()
                   });
                 } catch (e) {
                   console.error(e);
                   setError('Error al crear el perfil: ' + errorFirebase(e).message);
                 }
                 setLoading(false);
               }}
               disabled={!aceptoTerminos || loading}
               className="flex-1 bg-brand-primary text-white font-medium py-2 rounded hover:bg-brand-primary-hover transition disabled:opacity-50"
             >
               {loading ? 'Guardando...' : 'Aceptar y Finalizar'}
             </button>
           </div>
        </div>
      ) : (
      <div className="bg-white shadow-xl rounded-xl p-8 w-full max-w-sm border border-gray-100">
        <div className="flex items-center justify-center gap-2 mb-6 text-brand-primary">
          <img src="/logo-hipatia.png" alt="Hipatia Logo" className="w-10 h-10 object-contain" />
          <h2 className="text-2xl font-bold tracking-tight">Hipatia{isStaging ? ` (pruebas ${APP_VERSION})` : ''}</h2>
        </div>
        
        {error && <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4 text-sm font-medium">{error}</div>}
        {mensaje && (
          <div className={`px-4 py-3 rounded mb-4 text-sm font-medium ${mensaje.tipo === 'success' ? 'bg-green-100 border-green-400 text-green-700' : 'bg-red-100 border-red-400 text-red-700'}`}>
            {mensaje.texto}
          </div>
        )}

        {/* 1. Acceso Principal para Clientes con Google */}
        <div className="space-y-4">
          <button 
            type="button" 
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="w-full bg-white border border-gray-300 text-gray-700 font-semibold py-3 px-4 rounded-xl hover:bg-gray-50 transition shadow-sm flex items-center justify-center gap-3 cursor-pointer"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continuar con Google
          </button>
        </div>

        {/* Separador */}
        <div className="relative my-6 text-center">
          <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200"></div></div>
          <span className="relative bg-white px-3 text-xs text-gray-400 uppercase font-medium">O</span>
        </div>

        {/* 2. Botón 'Ingreso con login' */}
        {!showLoginTraditional ? (
          <button 
            type="button" 
            onClick={() => {
              setShowLoginTraditional(true);
              setError('');
            }} 
            className="w-full bg-gray-50 hover:bg-gray-100 text-gray-700 border border-gray-300 font-medium py-2.5 px-4 rounded-xl transition flex items-center justify-center gap-2 text-sm cursor-pointer"
          >
            <span>Ingreso con login</span>
            <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
          </button>
        ) : (
          <div className="pt-2 border-t border-gray-100">
            <div className="flex justify-between items-center mb-3">
              <span className="text-xs font-bold text-gray-600 uppercase tracking-wider">Ingreso con login</span>
              <button 
                type="button" 
                onClick={() => setShowLoginTraditional(false)} 
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                Ocultar
              </button>
            </div>

            <form onSubmit={handleTraditionalAuth} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Usuario</label>
                <input 
                  type="text" 
                  required
                  className="w-full border border-gray-300 px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary"
                  value={usuario}
                  onChange={(e) => setUsuario(e.target.value)}
                  placeholder="ej: admin@comercio.io o usuario"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Contraseña / PIN (6 dígitos)</label>
                <div className="relative">
                  <input 
                    type={showPassword ? "text" : "password"} 
                    className="w-full border border-gray-300 px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary"
                    value={passwordOrPin}
                    onChange={(e) => setPasswordOrPin(e.target.value)}
                    required
                    placeholder="••••••"
                  />
                  <button 
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none text-xs font-medium"
                  >
                    {showPassword ? 'Ocultar' : 'Ver'}
                  </button>
                </div>
                <div className="text-right mt-1">
                  <button 
                    type="button" 
                    onClick={handleRecuperarClave}
                    className="text-xs text-brand-primary hover:underline"
                  >
                    ¿Olvidaste tu contraseña?
                  </button>
                </div>
              </div>

              <button 
                type="submit" 
                disabled={loading}
                className="w-full bg-brand-primary text-white font-medium py-2 rounded-lg hover:bg-brand-primary-hover transition text-sm disabled:opacity-50 cursor-pointer"
              >
                {loading ? 'Validando...' : 'Iniciar Sesión'}
              </button>
            </form>
          </div>
        )}
      </div>
      )}

      {/* Modal de Términos y Condiciones */}
      {showTerminosModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[9999]">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg max-h-[80vh] overflow-y-auto">
            <h3 className="text-xl font-bold text-gray-800 mb-4 border-b pb-2">Términos y Condiciones Generales de Hipatia</h3>
            <div className="space-y-3 text-sm text-gray-600 leading-relaxed">
              <p>
                <strong>1. Descripción del Servicio:</strong> Hipatia es una plataforma digital de fidelización multi-marca que permite a los usuarios clientes acumular puntos por sus compras realizadas en los comercios adheridos y canjearlos por premios vigentes dentro del catálogo específico de cada comercio.
              </p>
              <p>
                <strong>2. Acumulación y Exclusividad de Puntos:</strong> Los puntos se acumulan y registran de forma independiente para cada comercio. Los puntos acumulados en un comercio <em>no son transferibles</em> ni utilizables en otros comercios, ni se pueden consolidar, vender, cambiar por dinero en efectivo o traspasar a otras cuentas de usuario.
              </p>
              <p>
                <strong>3. Auditoría y Registro Fiscal Obligatorio:</strong> Para evitar colusiones o acumulaciones sin consumo real, el flujo operativo exige el registro obligatorio del número y monto de la factura fiscal en la plataforma. Cada transacción registra de forma inmutable la fecha, hora, identificador del vendedor y detalle del cliente.
              </p>
              <p>
                <strong>4. Tolerancia Cero al Fraude y Clonación de Códigos QR:</strong> Queda estrictamente prohibida la clonación, uso de capturas de pantalla o reutilización maliciosa de códigos QR. La plataforma implementa validación dinámica de caducidad por tiempo (TOTP). Hipatia se reserva el derecho de cancelar puntos e inhabilitar permanentemente cualquier cuenta sospechosa de fraude.
              </p>
              <p>
                <strong>5. Privacidad, Perfilamiento e Inteligencia Artificial:</strong> El usuario autoriza el procesamiento de datos de comportamiento de compra para perfilamiento, modelos predictivos de Inteligencia Artificial para la personalización de la experiencia y publicidad in-app. Toda monetización o entrega de analíticas a terceros se realizará estrictamente con información agregada y anonimizada.
              </p>
              <p>
                <strong>6. Nivel de Servicio (SLA) e Integraciones:</strong> Hipatia garantiza estándares de disponibilidad tecnológica para sus conectores y APIs RESTful de integración con sistemas ERP/CRM/POS del comercio, promoviendo la automatización operativa sin fricción en puntos de venta.
              </p>
              <p>
                <strong>7. Uso del Número Telefónico:</strong> Lo usaremos solamente para temas relacionados con Hipatia Puntos y otros productos de Hipatia, no compartiremos sus datos con nadie, ni siquiera con terceros. La ventaja es que podría recuperar su cuenta por teléfono si lo pierde y se lo roban.
              </p>
            </div>
            <div className="mt-6 flex justify-end">
              <button 
                onClick={() => {
                  setAceptoTerminos(true);
                  setShowTerminosModal(false);
                }} 
                className="bg-brand-primary text-white font-medium px-4 py-2 rounded hover:bg-brand-primary-hover transition mr-2 cursor-pointer"
              >
                Aceptar y Cerrar
              </button>
              <button 
                onClick={() => setShowTerminosModal(false)} 
                className="bg-gray-100 text-gray-700 font-medium px-4 py-2 rounded hover:bg-gray-200 transition cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Login;
