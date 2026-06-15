import React, { useState, useEffect } from 'react';
import { collection, doc, setDoc, getDocs } from 'firebase/firestore';
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

  const [mensaje, setMensaje] = useState<{texto: string, tipo: 'success'|'error'} | null>(null);

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
    } catch (error: any) {
      console.error(error);
      setMensaje({ texto: 'Error al crear usuario: ' + error.message, tipo: 'error' });
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
              <input 
                type="password" required minLength={6}
                className="w-full border border-gray-300 px-3 py-2 rounded focus:ring-2 focus:ring-purple-500"
                value={password} onChange={e => setPassword(e.target.value)} 
              />
            </div>
            <button type="submit" className="w-full bg-purple-600 text-white font-medium py-2 rounded hover:bg-purple-700">
              Crear Usuario
            </button>
          </form>
        </div>

      </div>
    </div>
  );
};

export default SuperAdminDashboard;
