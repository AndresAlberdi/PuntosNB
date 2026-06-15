import React, { useState, useEffect } from 'react';
import { collection, doc, setDoc, getDocs, query, where, deleteDoc } from 'firebase/firestore';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { db } from '../firebase';
import { secondaryAuth } from '../secondaryApp';
import type { Comercio, Usuario } from '../types';

const SuperAdminDashboard: React.FC = () => {
  const [comercios, setComercios] = useState<Comercio[]>([]);
  const [loading, setLoading] = useState(true);
  
  // States for new Comercio
  const [nombreComercio, setNombreComercio] = useState('');
  const [nitRut, setNitRut] = useState('');
  
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
        createdAt: Date.now()
      };
      await setDoc(comercioRef, nuevoComercio);
      setMensaje({ texto: 'Comercio creado exitosamente', tipo: 'success' });
      setNombreComercio('');
      setNitRut('');
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

  if (loading) return <div className="p-8 text-center">Cargando panel de superadmin...</div>;

  return (
    <div className="p-6 space-y-8">
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
          <h3 className="text-lg font-bold mb-4 text-blue-900">1. Crear Nuevo Comercio</h3>
          <form onSubmit={handleCrearComercio} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nombre Comercial</label>
              <input 
                type="text" required 
                className="w-full border border-gray-300 px-3 py-2 rounded focus:ring-2 focus:ring-blue-500"
                value={nombreComercio} onChange={e => setNombreComercio(e.target.value)} 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">NIT / RUT</label>
              <input 
                type="text" required 
                className="w-full border border-gray-300 px-3 py-2 rounded focus:ring-2 focus:ring-blue-500"
                value={nitRut} onChange={e => setNitRut(e.target.value)} 
              />
            </div>
            <button type="submit" className="w-full bg-blue-600 text-white font-medium py-2 rounded hover:bg-blue-700">
              Registrar Comercio
            </button>
          </form>

          <h4 className="mt-6 mb-2 font-bold text-gray-700 text-sm uppercase">Comercios Existentes ({comercios.length})</h4>
          <ul className="space-y-2 max-h-48 overflow-y-auto">
            {comercios.map(c => (
              <li key={c.id} className="text-sm bg-gray-50 p-2 rounded border border-gray-100">
                <strong>{c.nombre}</strong> (NIT: {c.nit_rut})
              </li>
            ))}
          </ul>
        </div>

        {/* Crear Usuarios */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-bold mb-4 text-purple-900">2. Crear Usuarios (Admins/Vendedores)</h3>
          <form onSubmit={handleCrearUsuario} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Asignar al Comercio</label>
              <select 
                required 
                className="w-full border border-gray-300 px-3 py-2 rounded focus:ring-2 focus:ring-purple-500"
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
                  className="w-full border border-gray-300 px-3 py-2 rounded focus:ring-2 focus:ring-purple-500"
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
                  className="w-full border border-gray-300 px-3 py-2 rounded focus:ring-2 focus:ring-purple-500"
                  value={nombreUsuario} onChange={e => setNombreUsuario(e.target.value)} 
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Correo Electrónico</label>
              <input 
                type="email" required 
                className="w-full border border-gray-300 px-3 py-2 rounded focus:ring-2 focus:ring-purple-500"
                value={email} onChange={e => setEmail(e.target.value)} 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Contraseña (Temporal)</label>
              <div className="relative">
                <input 
                  type={showPassword ? "text" : "password"} required minLength={6}
                  className="w-full border border-gray-300 px-3 py-2 rounded focus:ring-2 focus:ring-purple-500"
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
            <button type="submit" className="w-full bg-purple-600 text-white font-medium py-2 rounded hover:bg-purple-700">
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
                      <td className="p-3">
                        <button 
                          onClick={() => handleRecrearClave(u)}
                          className="text-xs bg-red-100 text-red-700 font-bold px-3 py-1 rounded hover:bg-red-200 transition"
                        >
                          Recrear Contraseña
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
