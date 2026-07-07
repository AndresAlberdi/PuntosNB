import React, { useState } from 'react';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, sendPasswordResetEmail, fetchSignInMethodsForEmail } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { LoadingScreen } from '../components/LoadingScreen';

const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nombre, setNombre] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [mensaje, setMensaje] = useState<{texto: string, tipo: 'success'|'error'} | null>(null);
  const [loading, setLoading] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [aceptoTerminos, setAceptoTerminos] = useState(false);
  const [showTerminosModal, setShowTerminosModal] = useState(false);
  const navigate = useNavigate();
  const { currentUser, userData, loading: authLoading } = useAuth();

  React.useEffect(() => {
    if (currentUser && userData) {
      navigate('/');
    }
  }, [currentUser, userData, navigate]);

  if (authLoading) {
    return <LoadingScreen />;
  }

  if (currentUser && !userData) {
    return (
      <div className="flex flex-col justify-center items-center min-h-[calc(100vh-60px)] space-y-4 p-4 text-center">
        <div className="text-xl text-blue-600 font-medium mb-2">Cargando perfil o perfil no encontrado...</div>
        <p className="text-gray-500 max-w-sm text-sm mb-4">Si esta pantalla no desaparece, es probable que tu cuenta no tenga un perfil asignado en la base de datos.</p>
        <button 
          onClick={() => {
            import('firebase/auth').then(({ signOut }) => {
              signOut(auth);
            });
          }}
          className="text-red-600 font-medium hover:underline"
        >
          Cerrar Sesión para reintentar
        </button>
      </div>
    );
  }

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMensaje(null);
    setLoading(true);

    if (isRegistering && !aceptoTerminos) {
      setError('Debes aceptar los Términos y Condiciones para registrarte.');
      setLoading(false);
      return;
    }

    try {
      if (isRegistering) {
        // Validar fuerza de contraseña
        const isStrong = password.length >= 8 && /[A-Z]/.test(password) && /[0-9]/.test(password);
        if (!isStrong) {
          setError('La contraseña debe tener al menos 8 caracteres, una letra mayúscula y un número.');
          setLoading(false);
          return;
        }

        const userCred = await createUserWithEmailAndPassword(auth, email, password);
        const isAdmin = userCred.user.email === 'andresalberdi@gmail.com';
        await setDoc(doc(db, 'users', userCred.user.uid), {
          uid: userCred.user.uid,
          email: userCred.user.email,
          nombre: nombre || userCred.user.email?.split('@')[0],
          rol: isAdmin ? 'superadmin' : 'cliente',
          termsAccepted: true,
          termsAcceptedAt: Date.now(),
          createdAt: Date.now()
        });
      } else {
        try {
          const methods = await fetchSignInMethodsForEmail(auth, email);
          if (methods.includes('google.com') && !methods.includes('password')) {
            setError('Parece que te registraste usando Google. Por favor, haz clic en "Continuar con Google" abajo.');
            setLoading(false);
            return;
          }
        } catch (e) {
          // Si falla fetchSignInMethodsForEmail (ej. por protección de enumeración), continuamos
        }
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err: any) {
      if (err.code === 'auth/email-already-in-use') setError('El correo ya está en uso.');
      else if (err.code === 'auth/weak-password') setError('La contraseña es muy débil.');
      else setError('Credenciales incorrectas o error al autenticar.');
      console.error(err);
    }
    setLoading(false);
  };

  const handleRecuperarClave = async () => {
    if (!email) {
      setError('Por favor, ingresa tu correo electrónico arriba para poder enviarte el enlace de recuperación.');
      return;
    }
    setError('');
    setMensaje(null);
    try {
      await sendPasswordResetEmail(auth, email);
      setMensaje({ texto: 'Se ha enviado un enlace de recuperación a tu correo electrónico.', tipo: 'success' });
    } catch (err: any) {
      if (err.code === 'auth/user-not-found') {
        setError('No existe ninguna cuenta registrada con este correo.');
      } else {
        setError('Error al intentar enviar el correo: ' + err.message);
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
          import('firebase/auth').then(async ({ signOut }) => {
            await signOut(auth);
          });
          setError('Para registrarte con Google por primera vez, marca la casilla de aceptación de Términos y Condiciones (active la opción "Regístrate aquí" abajo para marcarla).');
          setLoading(false);
          return;
        }
        const isAdmin = userCred.user.email === 'andresalberdi@gmail.com';
        await setDoc(userDocRef, {
          uid: userCred.user.uid,
          email: userCred.user.email,
          nombre: userCred.user.displayName || userCred.user.email?.split('@')[0],
          rol: isAdmin ? 'superadmin' : 'cliente',
          termsAccepted: true,
          termsAcceptedAt: Date.now(),
          createdAt: Date.now()
        });
      }
    } catch (err: any) {
      if (err.code === 'auth/account-exists-with-different-credential') {
        setError('Ya te has registrado previamente con correo y contraseña. Por favor inicia sesión con tu correo (puedes recuperar tu clave si la olvidaste).');
      } else {
        setError('Error al iniciar sesión con Google: ' + err.message);
      }
      console.error(err);
    }
    setLoading(false);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-60px)] p-4">
      <div className="bg-white shadow-xl rounded-xl p-8 w-full max-w-sm border border-gray-100">
        <div className="flex items-center justify-center gap-2 mb-6 text-brand-primary">
          <img src="/logo-hipatia.png" alt="Hipatia Logo" className="w-10 h-10 object-contain" />
          <h2 className="text-2xl font-bold tracking-tight">Hipatia</h2>
        </div>
        
        {error && <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4 text-sm font-medium">{error}</div>}
        {mensaje && (
          <div className={`px-4 py-3 rounded mb-4 text-sm font-medium ${mensaje.tipo === 'success' ? 'bg-green-100 border-green-400 text-green-700' : 'bg-red-100 border-red-400 text-red-700'}`}>
            {mensaje.texto}
          </div>
        )}

        <form onSubmit={handleAuth} className="space-y-4">
          {isRegistering && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nombre Completo</label>
              <input 
                type="text" 
                required={isRegistering}
                className="w-full border border-gray-300 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-brand-primary"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Juan Pérez"
              />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Correo Electrónico</label>
            <input 
              type="email" 
              required
              className="w-full border border-gray-300 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-brand-primary"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="correo@ejemplo.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Contraseña</label>
            <div className="relative">
              <input 
                type={showPassword ? "text" : "password"} 
                className="w-full border border-gray-300 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-brand-primary"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••"
              />
              <button 
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700 focus:outline-none text-xs font-medium"
              >
                {showPassword ? 'Ocultar' : 'Ver'}
              </button>
            </div>
            {!isRegistering && (
              <div className="text-right mt-1">
                <button 
                  type="button" 
                  onClick={handleRecuperarClave}
                  className="text-sm text-brand-primary hover:underline"
                >
                  ¿Olvidaste tu contraseña?
                </button>
              </div>
            )}
          </div>

          {isRegistering && (
            <div className="flex items-start gap-2 text-sm text-gray-600 mb-2">
              <input 
                type="checkbox" 
                id="terminos" 
                checked={aceptoTerminos} 
                onChange={(e) => setAceptoTerminos(e.target.checked)}
                className="mt-1 h-4 w-4 text-brand-primary border-gray-300 rounded focus:ring-brand-primary" 
              />
              <label htmlFor="terminos" className="leading-tight">
                Acepto los{' '}
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
          )}

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-brand-primary text-white font-medium py-2 rounded hover:bg-brand-primary-hover transition disabled:opacity-50"
          >
            {loading ? 'Cargando...' : (isRegistering ? 'Crear Cuenta' : 'Iniciar Sesión')}
          </button>
        </form>

        <div className="mt-4">
          <button 
            type="button" 
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="w-full bg-white border border-gray-300 text-gray-700 font-medium py-2 rounded hover:bg-gray-50 transition flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
            Continuar con Google
          </button>
        </div>

        <div className="mt-6 text-center text-sm text-gray-600">
          {isRegistering ? '¿Ya tienes una cuenta?' : '¿Eres nuevo (cliente)?'}
          <button 
            type="button" 
            onClick={() => {
              setIsRegistering(!isRegistering);
              setError('');
            }} 
            className="ml-1 text-brand-primary font-medium hover:underline"
          >
            {isRegistering ? 'Inicia sesión' : 'Regístrate aquí'}
          </button>
        </div>
      </div>

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
                <strong>3. Responsabilidad sobre Reglas y Premios:</strong> Las reglas de asignación de puntos, montos requeridos, vigencia de los puntos y catálogo de premios son definidas de manera autónoma y exclusiva por cada comercio. Hipatia actúa únicamente como proveedor de la plataforma tecnológica y no asume responsabilidad alguna por modificaciones en las reglas de acumulación, cancelaciones de premios o el cese de participación de un comercio en la red.
              </p>
              <p>
                <strong>4. Uso de la Cuenta y Seguridad:</strong> El usuario es responsable de mantener la confidencialidad de sus credenciales de acceso y del uso exclusivo de su cuenta. Cualquier actividad realizada desde su cuenta se considerará autorizada por el usuario.
              </p>
              <p>
                <strong>5. Modificaciones y Suspensión:</strong> Hipatia se reserva el derecho de actualizar los presentes términos, así como de suspender o dar de baja de forma temporal o definitiva aquellas cuentas en las que se detecten actividades sospechosas de fraude, suplantación o manipulación de códigos QR.
              </p>
            </div>
            <div className="mt-6 flex justify-end">
              <button 
                onClick={() => {
                  setAceptoTerminos(true);
                  setShowTerminosModal(false);
                }} 
                className="bg-brand-primary text-white font-medium px-4 py-2 rounded hover:bg-brand-primary-hover transition mr-2"
              >
                Aceptar y Cerrar
              </button>
              <button 
                onClick={() => setShowTerminosModal(false)} 
                className="bg-gray-100 text-gray-700 font-medium px-4 py-2 rounded hover:bg-gray-200 transition"
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
