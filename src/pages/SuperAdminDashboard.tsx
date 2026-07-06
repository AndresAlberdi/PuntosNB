import React, { useState, useEffect } from 'react';
import { collection, doc, setDoc, getDocs, query, where, deleteDoc } from 'firebase/firestore';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { db } from '../firebase';
import { secondaryAuth } from '../secondaryApp';
import type { Comercio, Usuario } from '../types';
import { COLOR_PALETTES, getPaletteStyle } from '../utils/theme';

const SuperAdminDashboard: React.FC = () => {
  const [comercios, setComercios] = useState<Comercio[]>([]);
  const [loading, setLoading] = useState(true);
  
  // States for new Comercio
  const [nombreComercio, setNombreComercio] = useState('');
  const [nitRut, setNitRut] = useState('');
  const [logoBase64, setLogoBase64] = useState('');
  const [paletteId, setPaletteId] = useState('ocean');
  
  // States for new User
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nombreUsuario, setNombreUsuario] = useState('');
  const [rol, setRol] = useState<'admin_comercio' | 'vendedor'>('vendedor');
  const [comercioId, setComercioId] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [mensaje, setMensaje] = useState<{texto: string, tipo: 'success'|'error'} | null>(null);

  // States for listing users
  const [selectedComercioToList, setSelectedComercioToList] = useState('');
  const [comercioUsers, setComercioUsers] = useState<Usuario[]>([]);

  const cargarComercios = async () => {
    try {
      const snap = await getDocs(collection(db, 'comercios'));
      const data: Comercio[] = [];
      snap.forEach(docSnap => data.push(docSnap.data() as Comercio));
      setComercios(data);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  useEffect(() => {
    cargarComercios();
  }, []);

  useEffect(() => {
    const fetchUsers = async () => {
      if (!selectedComercioToList) {
        setComercioUsers([]);
        return;
      }
      try {
        const q = query(collection(db, 'users'), where('comercioId', '==', selectedComercioToList));
        const snap = await getDocs(q);
        const users: Usuario[] = [];
        snap.forEach(d => users.push(d.data() as Usuario));
        setComercioUsers(users);
      } catch (err) {
        console.error("Error fetching users:", err);
      }
    };
    fetchUsers();
  }, [selectedComercioToList]);

  const handleCrearComercio = async (e: React.FormEvent) => {
    e.preventDefault();
    setMensaje(null);
    try {
      const comercioRef = doc(collection(db, 'comercios'));
      const nuevoComercio: Comercio = {
        id: comercioRef.id,
        nombre: nombreComercio,
        nit_rut: nitRut,
        reglas: [],
        premios: [],
        productos: [],
        createdAt: Date.now(),
        logoUrl: logoBase64 || '',
        paletteId: paletteId
      };
      await setDoc(comercioRef, nuevoComercio);
      setMensaje({ texto: 'Comercio creado exitosamente', tipo: 'success' });
      setNombreComercio('');
      setNitRut('');
      setLogoBase64('');
      setPaletteId('ocean');
      const fileInput = document.getElementById('comercio-logo-file') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
      cargarComercios();
    } catch (error: any) {
      console.error(error);
      setMensaje({ texto: 'Error al crear comercio: ' + error.message, tipo: 'error' });
    }
  };

  const handleCrearUsuario = async (e: React.FormEvent) => {
    e.preventDefault();
    setMensaje(null);
    if (!comercioId) {
      setMensaje({ texto: 'Debes seleccionar un comercio.', tipo: 'error' });
      return;
    }
    try {
      // Create user using secondary app so the current superadmin is not signed out
      const userCred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
      
      const userDocRef = doc(db, 'users', userCred.user.uid);
      const userData: Usuario = {
        uid: userCred.user.uid,
        email,
        nombre: nombreUsuario,
        rol,
        comercioId,
        createdAt: Date.now()
      };
      await setDoc(userDocRef, userData);

      setMensaje({ texto: `Usuario ${rol} creado exitosamente.`, tipo: 'success' });
      setEmail('');
      setPassword('');
      setNombreUsuario('');
      if (selectedComercioToList === comercioId) {
        setSelectedComercioToList(''); // trigger refresh manually or just clear
      }
    } catch (error: any) {
      console.error(error);
      setMensaje({ texto: 'Error al crear usuario: ' + error.message, tipo: 'error' });
    }
  };

  const handleRecrearClave = async (usuario: Usuario) => {
    const comercio = comercios.find(c => c.id === usuario.comercioId);
    if (!comercio) return;

    const nombreLimpio = comercio.nombre.replace(/\s+/g, '');
    const nuevaClave = `${nombreLimpio}*123`;

    const confirmacion = window.confirm(
      `ATENCIÓN: Para recrear a este usuario, PRIMERO debes ir a Firebase Console -> Authentication -> Users y BORRAR manualmente el correo ${usuario.email}.\n\n` +
      `Si ya lo borraste, presiona Aceptar.\n` +
      `La nueva clave será exactamente: ${nuevaClave}`
    );

    if (!confirmacion) return;

    setMensaje(null);
    try {
      // 1. Recreate the user in Firebase Auth
      const userCred = await createUserWithEmailAndPassword(secondaryAuth, usuario.email, nuevaClave);
      const newUid = userCred.user.uid;

      // 2. Save new doc in Firestore with old data
      const newUserData = { ...usuario, uid: newUid, updatedAt: Date.now() };
      await setDoc(doc(db, 'users', newUid), newUserData);

      // 3. Delete old doc in Firestore
      await deleteDoc(doc(db, 'users', usuario.uid));

      setMensaje({ texto: `Usuario recreado. Su nueva clave es: ${nuevaClave}`, tipo: 'success' });
      
      // Refresh list
      setSelectedComercioToList('');
      setTimeout(() => setSelectedComercioToList(usuario.comercioId!), 100);

    } catch (err: any) {
      console.error(err);
      if (err.code === 'auth/email-already-in-use') {
        setMensaje({ texto: 'ERROR: El usuario aún existe en Firebase Auth. Por favor bórralo manualmente primero.', tipo: 'error' });
      } else {
        setMensaje({ texto: 'Error al recrear usuario: ' + err.message, tipo: 'error' });
      }
    }
  };

  const handleBorrarComercio = async (comercio: Comercio) => {
    const confirmacion = window.confirm(
      `ATENCIÓN: ¿Estás seguro de que deseas borrar el comercio "${comercio.nombre}"? \n\n` +
      `Esta acción NO TIENE MARCHA ATRÁS y eliminará permanentemente:\n` +
      `- El comercio de la base de datos\n` +
      `- Todas las reglas, productos y premios configurados\n` +
      `- Todos los perfiles de usuarios (administradores y vendedores) asociados.\n\n` +
      `¿Deseas continuar?`
    );
    if (!confirmacion) return;

    setMensaje(null);
    try {
      const { writeBatch } = await import('firebase/firestore');
      const batch = writeBatch(db);

      // 1. Delete associated users from Firestore
      const q = query(collection(db, 'users'), where('comercioId', '==', comercio.id));
      const usersSnap = await getDocs(q);
      usersSnap.forEach(userDoc => {
        batch.delete(userDoc.ref);
      });

      // 2. Delete commerce document
      batch.delete(doc(db, 'comercios', comercio.id));

      await batch.commit();

      setMensaje({ texto: `Comercio "${comercio.nombre}" y sus usuarios asociados fueron eliminados exitosamente de la base de datos.`, tipo: 'success' });
      cargarComercios();
      if (selectedComercioToList === comercio.id) {
        setSelectedComercioToList('');
      }
    } catch (err: any) {
      console.error(err);
      setMensaje({ texto: 'Error al borrar comercio: ' + err.message, tipo: 'error' });
    }
  };

  const handleBorrarUsuario = async (usuario: Usuario) => {
    const confirmacion = window.confirm(
      `¿Seguro que deseas borrar al usuario "${usuario.nombre}" (${usuario.email}) de la base de datos?\n\n` +
      `Esta acción no se puede deshacer y el usuario perderá su perfil.`
    );
    if (!confirmacion) return;

    setMensaje(null);
    try {
      await deleteDoc(doc(db, 'users', usuario.uid));
      setMensaje({ texto: `Usuario "${usuario.nombre}" eliminado exitosamente de la base de datos.`, tipo: 'success' });
      
      // Refresh list
      const q = query(collection(db, 'users'), where('comercioId', '==', usuario.comercioId));
      const snap = await getDocs(q);
      const users: Usuario[] = [];
      snap.forEach(d => users.push(d.data() as Usuario));
      setComercioUsers(users);
    } catch (err: any) {
      console.error(err);
      setMensaje({ texto: 'Error al borrar usuario: ' + err.message, tipo: 'error' });
    }
  };

  if (loading) return <div className="p-8 text-center">Cargando panel de superadmin...</div>;

  return (
    <div style={getPaletteStyle('charcoal')} className="p-6 space-y-8">
      <h2 className="text-2xl font-bold text-gray-800">Panel de Administración del Sistema</h2>

      {mensaje && (
        <div className={`p-4 rounded-lg font-medium ${mensaje.tipo === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
          {mensaje.texto}
          <button className="float-right" onClick={() => setMensaje(null)}>✕</button>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-8">
        
        {/* Crear Comercio */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-bold mb-4 text-brand-text-dark">1. Crear Nuevo Comercio</h3>
          <form onSubmit={handleCrearComercio} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nombre Comercial</label>
              <input 
                type="text" required 
                className="w-full border border-gray-300 px-3 py-2 rounded focus:ring-2 focus:ring-brand-primary"
                value={nombreComercio} onChange={e => setNombreComercio(e.target.value)} 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">NIT / RUT</label>
              <input 
                type="text" required 
                className="w-full border border-gray-300 px-3 py-2 rounded focus:ring-2 focus:ring-brand-primary"
                value={nitRut} onChange={e => setNitRut(e.target.value)} 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Paleta de Colores</label>
              <select 
                className="w-full border border-gray-300 px-3 py-2 rounded focus:ring-2 focus:ring-brand-primary"
                value={paletteId} onChange={e => setPaletteId(e.target.value)}
              >
                {COLOR_PALETTES.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Logo del Comercio (Máx 1MB)</label>
              <input 
                id="comercio-logo-file"
                type="file" accept="image/*"
                className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-brand-bg-light file:text-brand-primary hover:file:bg-brand-bg-light"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) {
                    if (file.size > 1024 * 1024) {
                      alert("El archivo supera el límite de 1MB. Por favor selecciona una imagen más pequeña.");
                      e.target.value = '';
                      return;
                    }
                    const reader = new FileReader();
                    reader.onloadend = () => {
                      setLogoBase64(reader.result as string);
                    };
                    reader.readAsDataURL(file);
                  }
                }}
              />
              {logoBase64 && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs text-gray-500">Vista previa:</span>
                  <img src={logoBase64} alt="Preview" className="h-8 w-8 object-contain border rounded" />
                </div>
              )}
            </div>
            <button type="submit" className="w-full bg-brand-primary text-white font-medium py-2 rounded hover:bg-brand-primary-hover">
              Registrar Comercio
            </button>
          </form>

          <h4 className="mt-6 mb-2 font-bold text-gray-700 text-sm uppercase">Comercios Existentes ({comercios.length})</h4>
          <ul className="space-y-2 max-h-48 overflow-y-auto">
            {comercios.map(c => (
              <li key={c.id} className="text-sm bg-gray-50 p-2 rounded border border-gray-100 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  {c.logoUrl ? (
                    <img src={c.logoUrl} alt="Logo" className="w-8 h-8 object-contain rounded border bg-white flex-shrink-0" />
                  ) : (
                    <div className="w-8 h-8 bg-gray-200 rounded flex items-center justify-center font-bold text-gray-400 text-xs flex-shrink-0">NB</div>
                  )}
                  <div className="min-w-0 flex-1">
                    <strong className="block text-gray-800 truncate">{c.nombre}</strong>
                    <span className="text-xs text-gray-500 block truncate">NIT: {c.nit_rut} | Paleta: {COLOR_PALETTES.find(p => p.id === c.paletteId)?.name || 'Default'}</span>
                  </div>
                </div>
                <button
                  onClick={() => handleBorrarComercio(c)}
                  className="text-xs bg-red-100 text-red-700 font-bold px-2.5 py-1 rounded hover:bg-red-200 transition flex-shrink-0"
                >
                  Borrar
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Crear Usuarios */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-bold mb-4 text-brand-text-dark">2. Crear Usuarios (Admins/Vendedores)</h3>
          <form onSubmit={handleCrearUsuario} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Asignar al Comercio</label>
              <select 
                required 
                className="w-full border border-gray-300 px-3 py-2 rounded focus:ring-2 focus:ring-brand-secondary"
                value={comercioId} onChange={e => setComercioId(e.target.value)}
              >
                <option value="">-- Selecciona un Comercio --</option>
                {comercios.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Rol</label>
                <select 
                  className="w-full border border-gray-300 px-3 py-2 rounded focus:ring-2 focus:ring-brand-secondary"
                  value={rol} onChange={e => setRol(e.target.value as any)}
                >
                  <option value="vendedor">Vendedor (Cajero)</option>
                  <option value="admin_comercio">Administrador del Comercio</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
                <input 
                  type="text" required 
                  className="w-full border border-gray-300 px-3 py-2 rounded focus:ring-2 focus:ring-brand-secondary"
                  value={nombreUsuario} onChange={e => setNombreUsuario(e.target.value)} 
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Correo Electrónico</label>
              <input 
                type="email" required 
                className="w-full border border-gray-300 px-3 py-2 rounded focus:ring-2 focus:ring-brand-secondary"
                value={email} onChange={e => setEmail(e.target.value)} 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Contraseña (Temporal)</label>
              <div className="relative">
                <input 
                  type={showPassword ? "text" : "password"} required minLength={6}
                  className="w-full border border-gray-300 px-3 py-2 rounded focus:ring-2 focus:ring-brand-secondary"
                  value={password} onChange={e => setPassword(e.target.value)} 
                />
                <button 
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700 focus:outline-none text-xs font-medium"
                >
                  {showPassword ? 'Ocultar' : 'Ver'}
                </button>
              </div>
            </div>
            <button type="submit" className="w-full bg-brand-secondary text-white font-medium py-2 rounded hover:opacity-90">
              Crear Usuario
            </button>
          </form>
        </div>

      </div>

      {/* Listar Usuarios */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 mt-8">
        <h3 className="text-lg font-bold mb-4 text-green-900">3. Gestionar Usuarios por Comercio</h3>
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Selecciona el Comercio para ver sus usuarios</label>
          <select 
            className="w-full max-w-md border border-gray-300 px-3 py-2 rounded focus:ring-2 focus:ring-green-500"
            value={selectedComercioToList} onChange={e => setSelectedComercioToList(e.target.value)}
          >
            <option value="">-- Selecciona un Comercio --</option>
            {comercios.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </div>

        {selectedComercioToList && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-sm text-gray-600">
                  <th className="p-3">Nombre</th>
                  <th className="p-3">Correo</th>
                  <th className="p-3">Rol</th>
                  <th className="p-3">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {comercioUsers.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="p-4 text-center text-gray-500">No hay usuarios registrados en este comercio.</td>
                  </tr>
                ) : (
                  comercioUsers.map(u => (
                    <tr key={u.uid} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="p-3 font-medium text-gray-800">{u.nombre}</td>
                      <td className="p-3 text-gray-600">{u.email}</td>
                      <td className="p-3 text-xs">
                        <span className="bg-gray-100 px-2 py-1 rounded text-gray-600 font-bold uppercase">{u.rol.replace('_', ' ')}</span>
                      </td>
                      <td className="p-3 flex gap-2">
                        <button 
                          onClick={() => handleRecrearClave(u)}
                          className="text-xs bg-yellow-100 text-yellow-700 font-bold px-3 py-1 rounded hover:bg-yellow-200 transition"
                        >
                          Recrear Contraseña
                        </button>
                        <button 
                          onClick={() => handleBorrarUsuario(u)}
                          className="text-xs bg-red-100 text-red-700 font-bold px-3 py-1 rounded hover:bg-red-200 transition"
                        >
                          Borrar Usuario
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
};

export default SuperAdminDashboard;
