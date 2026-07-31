import React, { useState, useEffect } from 'react';
import { collection, doc, setDoc, getDocs, query, where, deleteDoc } from 'firebase/firestore';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { db } from '../firebase';
import { secondaryAuth } from '../secondaryApp';
import type { Comercio, Usuario } from '../types';
import { COLOR_PALETTES } from '../utils/theme';

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
  const [telefonoUsuario, setTelefonoUsuario] = useState('');
  const [countryCode, setCountryCode] = useState('+591');
  const [rol, setRol] = useState<'admin_comercio' | 'vendedor'>('vendedor');
  const [comercioId, setComercioId] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [planComercio, setPlanComercio] = useState<'regular' | 'premium'>('regular');

  const [mensaje, setMensaje] = useState<{texto: string, tipo: 'success'|'error'} | null>(null);

  // States for listing users
  const [selectedComercioToList, setSelectedComercioToList] = useState('');
  const [comercioUsers, setComercioUsers] = useState<Usuario[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  // States for QR Simulator
  const [qrSimTipo, setQrSimTipo] = useState<'ACUMULACION'|'CANJE'>('ACUMULACION');
  const [qrSimMonto, setQrSimMonto] = useState('');
  const [qrSimCodeResult, setQrSimCodeResult] = useState('');
  const [qrSimReadInput, setQrSimReadInput] = useState('');

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
        paletteId: paletteId,
        plan: planComercio
      };
      await setDoc(comercioRef, nuevoComercio);
      setMensaje({ texto: 'Comercio creado exitosamente', tipo: 'success' });
      setNombreComercio('');
      setNitRut('');
      setLogoBase64('');
      setPaletteId('ocean');
      setPlanComercio('regular');
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
        telefono: telefonoUsuario ? `${countryCode}${telefonoUsuario}` : undefined,
        createdAt: Date.now()
      };
      await setDoc(userDocRef, userData);

      setMensaje({ texto: `Usuario ${rol} creado exitosamente.`, tipo: 'success' });
      setEmail('');
      setPassword('');
      setNombreUsuario('');
      setTelefonoUsuario('');
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

  const handleTogglePlan = async (comercio: Comercio) => {
    const nuevoPlan = comercio.plan === 'premium' ? 'regular' : 'premium';
    const confirmacion = window.confirm(`¿Cambiar el plan de "${comercio.nombre}" a ${nuevoPlan.toUpperCase()}?`);
    if (!confirmacion) return;

    try {
      const { updateDoc } = await import('firebase/firestore');
      await updateDoc(doc(db, 'comercios', comercio.id), { plan: nuevoPlan });
      setMensaje({ texto: `Plan de "${comercio.nombre}" cambiado a ${nuevoPlan.toUpperCase()}`, tipo: 'success' });
      cargarComercios();
    } catch (e: any) {
      setMensaje({ texto: 'Error al cambiar plan: ' + e.message, tipo: 'error' });
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

  const handleSimularQrGenerar = async () => {
    if (!comercios.length) {
      setMensaje({ texto: 'Debe existir al menos un comercio', tipo: 'error' });
      return;
    }
    const comercioIdSim = comercios[0].id;
    const { generarCodigoUnicoQR } = await import('../utils/qr');
    const codigo = await generarCodigoUnicoQR(db);
    
    const sesionData: any = {
      id: codigo,
      tipo: qrSimTipo,
      creadorId: 'superadmin_sim',
      creadorAlias: 'Simulador',
      comercioId: comercioIdSim,
      estado: 'PENDIENTE',
      createdAt: Date.now()
    };
    
    if (qrSimTipo === 'ACUMULACION') {
      sesionData.montoFactura = parseFloat(qrSimMonto) || 100;
      sesionData.puntosCalculados = 10;
    } else {
      sesionData.premioId = 'sim_premio';
    }

    try {
      await setDoc(doc(db, 'sesiones_qr', codigo), sesionData);
      setQrSimCodeResult(codigo);
      setMensaje({ texto: 'Código QR de prueba generado', tipo: 'success' });
    } catch (e: any) {
      setMensaje({ texto: 'Error al generar: ' + e.message, tipo: 'error' });
    }
  };

  const handleSimularQrLeer = async () => {
    if (!qrSimReadInput) return;
    try {
      const { getDoc } = await import('firebase/firestore');
      const docSnap = await getDoc(doc(db, 'sesiones_qr', qrSimReadInput));
      if (docSnap.exists()) {
        const data = docSnap.data();
        setMensaje({ texto: `Leído exitosamente! Tipo: ${data.tipo}, Estado: ${data.estado}`, tipo: 'success' });
      } else {
        setMensaje({ texto: 'El QR no existe o es inválido', tipo: 'error' });
      }
    } catch (e: any) {
      setMensaje({ texto: 'Error al leer: ' + e.message, tipo: 'error' });
    }
  };

  if (loading) return <div className="p-8 text-center" style={{color: 'var(--text-main)', backgroundColor: 'var(--bg-main)'}}>Cargando panel de superadmin...</div>;

  const filteredUsers = comercioUsers.filter(u => 
    u.nombre.toLowerCase().includes(searchTerm.toLowerCase()) || 
    u.email.toLowerCase().includes(searchTerm.toLowerCase()) || 
    (u.telefono && u.telefono.includes(searchTerm))
  );

  return (
    <div className="sa-container p-6 space-y-8 transition-colors duration-300">
      <style>{`
        .sa-container { background-color: var(--bg-main); color: var(--text-main); min-height: calc(100vh - 60px); }
        .sa-card { background-color: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 0.75rem; padding: 1.5rem; }
        .sa-input { background-color: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 0.375rem; padding: 0.5rem 0.75rem; width: 100%; outline: none; }
        .sa-input:focus { border-color: var(--accent-primary); box-shadow: 0 0 0 2px var(--accent-primary); }
        .sa-label { display: block; font-size: 0.875rem; font-weight: 600; margin-bottom: 0.25rem; color: var(--text-muted); }
        .sa-btn-primary { background-color: var(--accent-primary); color: #000; font-weight: 600; padding: 0.5rem 1rem; border-radius: 0.375rem; transition: opacity 0.2s; width: 100%; cursor: pointer; }
        .sa-btn-primary:hover { opacity: 0.8; }
        .sa-btn-secondary { background-color: var(--accent-secondary); color: #000; font-weight: 600; padding: 0.5rem 1rem; border-radius: 0.375rem; transition: opacity 0.2s; width: 100%; cursor: pointer; }
        .sa-btn-secondary:hover { opacity: 0.8; }
        .sa-title { font-size: 1.5rem; font-weight: 700; color: var(--text-main); }
        .sa-subtitle { font-size: 1.125rem; font-weight: 700; color: var(--accent-primary); margin-bottom: 1rem; }
        .sa-list-item { background-color: var(--bg-main); border: 1px solid var(--border-color); border-radius: 0.375rem; padding: 0.5rem; display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; margin-bottom: 0.5rem;}
        .sa-table { width: 100%; border-collapse: collapse; }
        .sa-table th { padding: 0.75rem; border-bottom: 2px solid var(--border-color); color: var(--text-muted); font-weight: 600; text-align: left; }
        .sa-table td { padding: 0.75rem; border-bottom: 1px solid var(--border-color); color: var(--text-main); }
        .sa-badge { background-color: var(--bg-main); border: 1px solid var(--border-color); padding: 0.25rem 0.5rem; border-radius: 0.25rem; font-size: 0.75rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted); }
      `}</style>
      
      <div className="flex justify-between items-center">
        <h2 className="sa-title">Panel de Administración del Sistema</h2>
      </div>

      {mensaje && (
        <div className={`p-4 rounded-lg font-bold border ${mensaje.tipo === 'success' ? 'bg-[var(--accent-tertiary)] text-black border-black' : 'bg-red-500 text-white border-red-700'}`}>
          {mensaje.texto}
          <button className="float-right font-black" onClick={() => setMensaje(null)}>✕</button>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-8">
        
        {/* Crear Comercio */}
        <div className="sa-card">
          <h3 className="sa-subtitle">1. Crear Nuevo Comercio</h3>
          <form onSubmit={handleCrearComercio} className="space-y-4">
            <div>
              <label className="sa-label">Nombre Comercial</label>
              <input type="text" required className="sa-input" value={nombreComercio} onChange={e => setNombreComercio(e.target.value)} />
            </div>
            <div>
              <label className="sa-label">NIT / RUT</label>
              <input type="text" required className="sa-input" value={nitRut} onChange={e => setNitRut(e.target.value)} />
            </div>
            <div>
              <label className="sa-label">Paleta de Colores</label>
              <select className="sa-input" value={paletteId} onChange={e => setPaletteId(e.target.value)}>
                {COLOR_PALETTES.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="sa-label">Plan del Comercio</label>
              <select className="sa-input" value={planComercio} onChange={e => setPlanComercio(e.target.value as 'regular'|'premium')}>
                <option value="regular">Regular (Solo mini CRM)</option>
                <option value="premium">Premium (Reportes y mini CRM)</option>
              </select>
            </div>
            <div>
              <label className="sa-label">Logo del Comercio (Máx 1MB)</label>
              <input id="comercio-logo-file" type="file" accept="image/*" className="sa-input"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) {
                    if (file.size > 1024 * 1024) { alert("El archivo supera el límite de 1MB."); e.target.value = ''; return; }
                    const reader = new FileReader(); reader.onloadend = () => setLogoBase64(reader.result as string); reader.readAsDataURL(file);
                  }
                }}
              />
              {logoBase64 && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs text-[var(--text-muted)]">Vista previa:</span>
                  <img src={logoBase64} alt="Preview" className="h-8 w-8 object-contain border rounded" />
                </div>
              )}
            </div>
            <button type="submit" className="sa-btn-primary">Registrar Comercio</button>
          </form>

          <h4 className="mt-6 mb-2 font-bold text-[var(--text-muted)] text-sm uppercase">Comercios Existentes ({comercios.length})</h4>
          <ul className="space-y-2 max-h-48 overflow-y-auto">
            {comercios.map(c => (
              <li key={c.id} className="sa-list-item">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  {c.logoUrl ? (
                    <img src={c.logoUrl} alt="Logo" className="w-8 h-8 object-contain rounded border bg-white flex-shrink-0" />
                  ) : (
                    <div className="w-8 h-8 bg-gray-200 rounded flex items-center justify-center font-bold text-gray-400 text-xs flex-shrink-0">NB</div>
                  )}
                  <div className="min-w-0 flex-1">
                    <strong className="block truncate text-[var(--text-main)]">{c.nombre}</strong>
                    <span className="text-xs text-[var(--text-muted)] block truncate">NIT: {c.nit_rut} | Paleta: {COLOR_PALETTES.find(p => p.id === c.paletteId)?.name || 'Default'} | Plan: <span className="font-bold text-brand-primary uppercase">{c.plan || 'regular'}</span></span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => handleTogglePlan(c)} className="text-xs bg-blue-500 text-white font-bold px-2.5 py-1 rounded hover:bg-blue-600 transition flex-shrink-0 cursor-pointer border border-blue-700">
                    Cambiar Plan
                  </button>
                  <button onClick={() => handleBorrarComercio(c)} className="text-xs bg-red-500 text-white font-bold px-2.5 py-1 rounded hover:bg-red-600 transition flex-shrink-0 cursor-pointer border border-red-700">Borrar</button>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Crear Usuarios */}
        <div className="sa-card">
          <h3 className="sa-subtitle">2. Crear Usuarios (Admins/Vendedores)</h3>
          <form onSubmit={handleCrearUsuario} className="space-y-4">
            <div>
              <label className="sa-label">Asignar al Comercio</label>
              <select required className="sa-input" value={comercioId} onChange={e => setComercioId(e.target.value)}>
                <option value="">-- Selecciona un Comercio --</option>
                {comercios.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="sa-label">Rol</label>
                <select className="sa-input" value={rol} onChange={e => setRol(e.target.value as any)}>
                  <option value="vendedor">Vendedor (Cajero)</option>
                  <option value="admin_comercio">Administrador del Comercio</option>
                </select>
              </div>
              <div>
                <label className="sa-label">Nombre</label>
                <input type="text" required className="sa-input" value={nombreUsuario} onChange={e => setNombreUsuario(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="sa-label">Correo Electrónico</label>
              <input type="email" required className="sa-input" value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div>
              <label className="sa-label">Teléfono (WhatsApp)</label>
              <div className="flex gap-2">
                <select className="sa-input w-24" value={countryCode} onChange={e => setCountryCode(e.target.value)}>
                  <option value="+591">+591</option>
                  <option value="+54">+54</option>
                  <option value="+55">+55</option>
                  <option value="+56">+56</option>
                  <option value="+57">+57</option>
                  <option value="+593">+593</option>
                  <option value="+34">+34</option>
                  <option value="+52">+52</option>
                  <option value="+51">+51</option>
                  <option value="+598">+598</option>
                  <option value="+1">+1</option>
                </select>
                <input type="tel" className="sa-input flex-1" value={telefonoUsuario} onChange={e => setTelefonoUsuario(e.target.value.replace(/\D/g, ''))} placeholder="Ej: 71234567" required />
              </div>
            </div>
            <div>
              <label className="sa-label">Contraseña (Temporal)</label>
              <div className="relative">
                <input type={showPassword ? "text" : "password"} required minLength={6} className="sa-input" value={password} onChange={e => setPassword(e.target.value)} />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 transform -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-main)] focus:outline-none text-xs font-medium cursor-pointer">
                  {showPassword ? 'Ocultar' : 'Ver'}
                </button>
              </div>
            </div>
            <button type="submit" className="sa-btn-secondary">Crear Usuario</button>
          </form>
        </div>

      </div>

      {/* Listar Usuarios */}
      <div className="sa-card">
        <h3 className="sa-subtitle">3. Gestionar Usuarios por Comercio</h3>
        <div className="mb-4">
          <label className="sa-label">Selecciona el Comercio para ver sus usuarios</label>
          <select className="sa-input max-w-md" value={selectedComercioToList} onChange={e => setSelectedComercioToList(e.target.value)}>
            <option value="">-- Selecciona un Comercio --</option>
            {comercios.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </div>

        {selectedComercioToList && (
          <>
            <div className="mb-4">
              <input type="text" className="sa-input max-w-md" placeholder="Buscar por nombre, correo o teléfono..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
            </div>
            <div className="overflow-x-auto">
              <table className="sa-table">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Correo</th>
                    <th>WhatsApp</th>
                    <th>Rol</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-4 text-center text-[var(--text-muted)]">No hay usuarios que coincidan.</td>
                    </tr>
                  ) : (
                    filteredUsers.map(u => (
                      <tr key={u.uid}>
                        <td className="font-medium">{u.nombre}</td>
                        <td>{u.email}</td>
                        <td>{u.telefono || '-'}</td>
                        <td><span className="sa-badge">{u.rol.replace('_', ' ')}</span></td>
                        <td className="flex gap-2">
                          <button onClick={() => handleRecrearClave(u)} className="text-xs bg-[var(--accent-primary)] text-black font-bold px-3 py-1 rounded hover:opacity-80 transition cursor-pointer border border-black">Recrear Contraseña</button>
                          <button onClick={() => handleBorrarUsuario(u)} className="text-xs bg-red-500 text-white font-bold px-3 py-1 rounded hover:bg-red-600 transition cursor-pointer border border-red-700">Borrar Usuario</button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Simulador QR */}
      <div className="sa-card">
        <h3 className="sa-subtitle">4. Simulador QR</h3>
        <div className="grid md:grid-cols-2 gap-8">
          <div className="space-y-4">
            <h4 className="font-bold text-sm text-[var(--text-muted)]">Generar QR de Prueba</h4>
            <select className="sa-input" value={qrSimTipo} onChange={e => setQrSimTipo(e.target.value as any)}>
              <option value="ACUMULACION">Acumulación (Vendedor)</option>
              <option value="CANJE">Canje (Cliente)</option>
            </select>
            {qrSimTipo === 'ACUMULACION' && (
              <input type="number" placeholder="Monto simulado (ej: 100)" className="sa-input" value={qrSimMonto} onChange={e => setQrSimMonto(e.target.value)} />
            )}
            <button onClick={handleSimularQrGenerar} className="sa-btn-primary">Generar Sesión en Firebase</button>
            {qrSimCodeResult && (
              <div className="mt-2 p-3 bg-gray-100 rounded text-center">
                <p className="text-sm font-bold text-gray-500">ID Sesión QR:</p>
                <div className="text-xl font-mono select-all tracking-widest text-black">{qrSimCodeResult}</div>
              </div>
            )}
          </div>
          <div className="space-y-4">
            <h4 className="font-bold text-sm text-[var(--text-muted)]">Leer QR de Prueba</h4>
            <input type="text" placeholder="Pega el ID de Sesión QR..." className="sa-input" value={qrSimReadInput} onChange={e => setQrSimReadInput(e.target.value)} />
            <button onClick={handleSimularQrLeer} className="sa-btn-secondary">Consultar Estado de Sesión</button>
          </div>
        </div>
      </div>

    </div>
  );
};

export default SuperAdminDashboard;
