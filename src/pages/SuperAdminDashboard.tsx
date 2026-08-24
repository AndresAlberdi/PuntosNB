import React, { useState, useEffect } from 'react';
import { collection, doc, setDoc, getDocs, query, where, deleteDoc, updateDoc } from 'firebase/firestore';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { QRCodeSVG } from 'qrcode.react';
import { db } from '../firebase';
import { secondaryAuth } from '../secondaryApp';
import type { Comercio, Usuario } from '../types';
import { COLOR_PALETTES } from '../utils/theme';

const RESERVED_DOMAINS = ['influencer', 'hiinfluencer', 'hiinfluencer.io', 'admin', 'superadmin', 'hipatia', 'puntosnb'];

const SuperAdminDashboard: React.FC = () => {
  const [comercios, setComercios] = useState<Comercio[]>([]);
  const [loading, setLoading] = useState(true);
  
  // States for new Comercio
  const [nombreComercio, setNombreComercio] = useState('');
  const [nitRut, setNitRut] = useState('');
  const [dominioComercio, setDominioComercio] = useState('');
  const [logoBase64, setLogoBase64] = useState('');
  const [paletteId, setPaletteId] = useState('ocean');
  const [planComercio, setPlanComercio] = useState<'regular' | 'premium'>('regular');
  
  // States for new User
  const [usuarioPrefix, setUsuarioPrefix] = useState('');
  const [emailReal, setEmailReal] = useState('');
  const [pinVendedor, setPinVendedor] = useState('');
  const [password, setPassword] = useState('');
  const [nombreUsuario, setNombreUsuario] = useState('');
  const [telefonoUsuario, setTelefonoUsuario] = useState('');
  const [countryCode, setCountryCode] = useState('+591');
  const [rol, setRol] = useState<'admin_comercio' | 'vendedor' | 'influencer'>('vendedor');
  const [comercioId, setComercioId] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [prefijoCodigo, setPrefijoCodigo] = useState('');
  
  // States for influencer campaigns forced renewal
  const [, setInfluencerCodes] = useState<any[]>([]);

  const [mensaje, setMensaje] = useState<{ texto: string; tipo: 'success' | 'error' } | null>(null);

  // States for listing users
  const [selectedComercioToList, setSelectedComercioToList] = useState('');
  const [comercioUsers, setComercioUsers] = useState<Usuario[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [globalUsers, setGlobalUsers] = useState<Usuario[]>([]);
  const [globalSearchTerm, setGlobalSearchTerm] = useState('');
  const [editingComercio, setEditingComercio] = useState<Comercio | null>(null);
  const [editComercioNombre, setEditComercioNombre] = useState('');
  const [editComercioDominio, setEditComercioDominio] = useState('');
  const [editComercioPlan, setEditComercioPlan] = useState<'regular' | 'premium'>('regular');
  const [editComercioNit, setEditComercioNit] = useState('');

  // States for QR Simulator
  const [qrSimTipo, setQrSimTipo] = useState<'ACUMULACION' | 'CANJE'>('ACUMULACION');
  const [qrSimMonto, setQrSimMonto] = useState('');
  const [qrSimCodeResult, setQrSimCodeResult] = useState('');

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

  const fetchGlobalUsers = async () => {
    try {
      const snap = await getDocs(collection(db, 'users'));
      const users: Usuario[] = [];
      snap.forEach(d => users.push(d.data() as Usuario));
      setGlobalUsers(users);
    } catch (err) {}
  };

  useEffect(() => {
    cargarComercios();
    fetchGlobalUsers();
    const fetchCodes = async () => {
      try {
        const snap = await getDocs(collection(db, 'codigos_influencer'));
        const codes: any[] = [];
        snap.forEach(d => codes.push(d.data()));
        setInfluencerCodes(codes);
      } catch (err) {}
    };
    fetchCodes();
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

  // Sugerencia automática de dominio al escribir nombre de comercio
  const handleNombreComercioChange = (val: string) => {
    setNombreComercio(val);
    const suggested = val.toLowerCase().replace(/[^a-z0-9]/g, '') + '.io';
    setDominioComercio(suggested);
  };

  const selectedComercio = comercios.find(c => c.id === comercioId);
  const comercioDominio = selectedComercio?.dominio || (selectedComercio ? selectedComercio.nombre.toLowerCase().replace(/[^a-z0-9]/g, '') + '.io' : '');

  const computedUsuarioSintetico = () => {
    const cleanUser = usuarioPrefix.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
    if (!cleanUser) return '';
    if (rol === 'influencer') {
      return `${cleanUser}@hiinfluencer.io`;
    }
    if (comercioDominio) {
      return `${cleanUser}@${comercioDominio}`;
    }
    return cleanUser;
  };

  const handleCrearComercio = async (e: React.FormEvent) => {
    e.preventDefault();
    setMensaje(null);

    const cleanDominio = dominioComercio.trim().toLowerCase().replace(/^@+/, '');
    const isReserved = RESERVED_DOMAINS.some(res => cleanDominio === res || cleanDominio.startsWith(res + '.'));
    if (isReserved) {
      setMensaje({ texto: `El dominio "${cleanDominio}" está reservado por el sistema y no puede ser usado por un comercio.`, tipo: 'error' });
      return;
    }
    if (!cleanDominio.includes('.')) {
      setMensaje({ texto: 'El dominio asignado debe tener una extensión válida (ej: mitienda.io).', tipo: 'error' });
      return;
    }

    try {
      const comercioRef = doc(collection(db, 'comercios'));
      const nuevoComercio: Comercio = {
        id: comercioRef.id,
        nombre: nombreComercio.trim(),
        nit_rut: nitRut.trim(),
        dominio: cleanDominio,
        reglas: [],
        premios: [],
        productos: [],
        createdAt: Date.now(),
        logoUrl: logoBase64 || '',
        paletteId: paletteId,
        plan: planComercio
      };
      await setDoc(comercioRef, nuevoComercio);
      setMensaje({ texto: 'Comercio creado exitosamente con dominio ' + cleanDominio, tipo: 'success' });
      setNombreComercio('');
      setNitRut('');
      setDominioComercio('');
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

  const handleGuardarEdicionComercio = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingComercio) return;

    const cleanDominio = editComercioDominio.trim().toLowerCase().replace(/^@+/, '');
    const isReserved = RESERVED_DOMAINS.some(res => cleanDominio === res || cleanDominio.startsWith(res + '.'));
    if (isReserved) {
      setMensaje({ texto: `El dominio "${cleanDominio}" está reservado por el sistema.`, tipo: 'error' });
      return;
    }

    try {
      await updateDoc(doc(db, 'comercios', editingComercio.id), {
        nombre: editComercioNombre.trim(),
        nit_rut: editComercioNit.trim(),
        dominio: cleanDominio,
        plan: editComercioPlan
      });
      setEditingComercio(null);
      setMensaje({ texto: 'Comercio actualizado correctamente.', tipo: 'success' });
      cargarComercios();
    } catch (err: any) {
      setMensaje({ texto: 'Error al actualizar comercio: ' + err.message, tipo: 'error' });
    }
  };

  const handleCrearUsuario = async (e: React.FormEvent) => {
    e.preventDefault();
    setMensaje(null);

    const syntheticUser = computedUsuarioSintetico();
    if (!syntheticUser) {
      setMensaje({ texto: 'Ingresa un identificador de usuario válido.', tipo: 'error' });
      return;
    }

    if (!comercioId && rol !== 'influencer') {
      setMensaje({ texto: 'Debes seleccionar un comercio.', tipo: 'error' });
      return;
    }

    if (rol === 'influencer' && (!prefijoCodigo || prefijoCodigo.length > 10)) {
      setMensaje({ texto: 'El influencer debe tener un prefijo de código válido (máx 10 caracteres).', tipo: 'error' });
      return;
    }

    try {
      // 1. CASO VENDEDOR: No se crea en Firebase Auth (0 MAU). Se valida PIN y se guarda en Firestore.
      if (rol === 'vendedor') {
        if (!/^\d{6}$/.test(pinVendedor)) {
          setMensaje({ texto: 'El PIN del vendedor debe ser exactamente de 6 dígitos numéricos.', tipo: 'error' });
          return;
        }

        // Verificar si ya existe este usuario
        const qExists = query(collection(db, 'users'), where('email', '==', syntheticUser));
        const existsSnap = await getDocs(qExists);
        if (!existsSnap.empty) {
          setMensaje({ texto: `El usuario "${syntheticUser}" ya se encuentra registrado.`, tipo: 'error' });
          return;
        }

        const newUid = 'vend_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
        const userData: Usuario = {
          uid: newUid,
          email: syntheticUser,
          usuario: syntheticUser,
          nombre: nombreUsuario.trim(),
          rol: 'vendedor',
          comercioId: comercioId,
          pin: pinVendedor.trim(),
          createdAt: Date.now(),
          ...(telefonoUsuario ? { telefono: `${countryCode}${telefonoUsuario}` } : {})
        };

        await setDoc(doc(db, 'users', newUid), userData);
        setMensaje({ texto: `Vendedor creado exitosamente. Usuario de acceso: ${syntheticUser} (PIN: ${pinVendedor})`, tipo: 'success' });
      } 
      // 2. CASO ADMIN / INFLUENCER: Se crea en Firebase Auth con usuario sintético y guarda emailReal en Firestore
      else {
        if (!emailReal || !emailReal.includes('@')) {
          setMensaje({ texto: 'Debes ingresar un correo electrónico real válido para administración.', tipo: 'error' });
          return;
        }

        if (!password || password.length < 6) {
          setMensaje({ texto: 'La contraseña debe tener al menos 6 caracteres.', tipo: 'error' });
          return;
        }

        let userUid: string | null = null;
        try {
          const userCred = await createUserWithEmailAndPassword(secondaryAuth, syntheticUser, password);
          userUid = userCred.user.uid;
        } catch (authErr: any) {
          if (authErr.code === 'auth/email-already-in-use') {
            // Intentar recuperar el UID si el usuario ya existe en Auth
            try {
              const { signInWithEmailAndPassword } = await import('firebase/auth');
              const signInCred = await signInWithEmailAndPassword(secondaryAuth, syntheticUser, password);
              userUid = signInCred.user.uid;
            } catch (signInErr) {
              setMensaje({ texto: `El usuario "${syntheticUser}" ya existe en Firebase Auth. Si olvidaste la clave o falló el guardado previo, elimínalo primero de Auth o usa la misma contraseña.`, tipo: 'error' });
              return;
            }
          } else {
            throw authErr;
          }
        }

        if (userUid) {
          const userDocRef = doc(db, 'users', userUid);
          const userData: Usuario = {
            uid: userUid,
            email: syntheticUser,
            usuario: syntheticUser,
            emailReal: emailReal.trim().toLowerCase(),
            nombre: nombreUsuario.trim(),
            rol,
            createdAt: Date.now(),
            ...(rol !== 'influencer' && comercioId ? { comercioId } : {}),
            ...(telefonoUsuario ? { telefono: `${countryCode}${telefonoUsuario}` } : {}),
            ...(rol === 'influencer' && prefijoCodigo ? { prefijoCodigo: prefijoCodigo.toUpperCase() } : {})
          };
          await setDoc(userDocRef, userData);

          setMensaje({ texto: `Usuario ${rol} creado exitosamente. Usuario de login: ${syntheticUser}`, tipo: 'success' });
        }
      }

      // Limpiar formulario
      setUsuarioPrefix('');
      setEmailReal('');
      setPassword('');
      setPinVendedor('');
      setNombreUsuario('');
      setTelefonoUsuario('');
      setPrefijoCodigo('');
      fetchGlobalUsers();

      if (selectedComercioToList === comercioId) {
        setSelectedComercioToList('');
        setTimeout(() => setSelectedComercioToList(comercioId), 100);
      }
    } catch (error: any) {
      console.error(error);
      setMensaje({ texto: 'Error al crear usuario: ' + error.message, tipo: 'error' });
    }
  };

  const handleRecrearClave = async (usuario: Usuario) => {
    if (usuario.rol === 'vendedor') {
      const nuevoPin = window.prompt("Ingresa el nuevo PIN de 6 dígitos para este vendedor:", usuario.pin || "123456");
      if (!nuevoPin || !/^\d{6}$/.test(nuevoPin)) {
        alert("El PIN debe ser exactamente de 6 dígitos numéricos.");
        return;
      }
      await updateDoc(doc(db, 'users', usuario.uid), { pin: nuevoPin });
      setMensaje({ texto: `PIN del vendedor actualizado a: ${nuevoPin}`, tipo: 'success' });
      fetchGlobalUsers();
      return;
    }

    const comercio = comercios.find(c => c.id === usuario.comercioId);
    const nombreLimpio = comercio ? comercio.nombre.replace(/\s+/g, '') : 'Hipatia';
    const nuevaClave = `${nombreLimpio}*123`;

    const confirmacion = window.confirm(
      `ATENCIÓN: Para recrear a este usuario, PRIMERO debes ir a Firebase Console -> Authentication -> Users y BORRAR manualmente el usuario ${usuario.email}.\n\n` +
      `Si ya lo borraste, presiona Aceptar.\n` +
      `La nueva clave será exactamente: ${nuevaClave}`
    );

    if (!confirmacion) return;

    setMensaje(null);
    try {
      const userCred = await createUserWithEmailAndPassword(secondaryAuth, usuario.email, nuevaClave);
      const newUid = userCred.user.uid;

      const newUserData = { ...usuario, uid: newUid, updatedAt: Date.now() };
      await setDoc(doc(db, 'users', newUid), newUserData);
      await deleteDoc(doc(db, 'users', usuario.uid));

      setMensaje({ texto: `Usuario recreado. Su nueva clave es: ${nuevaClave}`, tipo: 'success' });
      
      setSelectedComercioToList('');
      setTimeout(() => setSelectedComercioToList(usuario.comercioId || ''), 100);
      fetchGlobalUsers();

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

      const q = query(collection(db, 'users'), where('comercioId', '==', comercio.id));
      const usersSnap = await getDocs(q);
      usersSnap.forEach(userDoc => {
        batch.delete(userDoc.ref);
      });

      batch.delete(doc(db, 'comercios', comercio.id));
      await batch.commit();

      setMensaje({ texto: `Comercio "${comercio.nombre}" y sus usuarios eliminados exitosamente.`, tipo: 'success' });
      cargarComercios();
      setSelectedComercioToList('');
      fetchGlobalUsers();
    } catch (err: any) {
      console.error(err);
      setMensaje({ texto: 'Error al borrar comercio: ' + err.message, tipo: 'error' });
    }
  };

  const handleToggleEstadoComercio = async (comercio: Comercio) => {
    const nuevoEstado = comercio.estado === 'bloqueado' ? 'activo' : 'bloqueado';
    try {
      await updateDoc(doc(db, 'comercios', comercio.id), { estado: nuevoEstado });
      setComercios(comercios.map(c => c.id === comercio.id ? { ...c, estado: nuevoEstado } : c));
      setMensaje({ texto: `Comercio ${nuevoEstado === 'bloqueado' ? 'bloqueado' : 'desbloqueado'} con éxito.`, tipo: 'success' });
    } catch (err: any) {
      setMensaje({ texto: 'Error al cambiar estado del comercio: ' + err.message, tipo: 'error' });
    }
  };

  const handleToggleEstadoUsuario = async (usuario: Usuario) => {
    const nuevoEstado = usuario.estado === 'bloqueado' ? 'activo' : 'bloqueado';
    try {
      await updateDoc(doc(db, 'users', usuario.uid), { estado: nuevoEstado });
      setComercioUsers(comercioUsers.map(u => u.uid === usuario.uid ? { ...u, estado: nuevoEstado } : u));
      setGlobalUsers(globalUsers.map(u => u.uid === usuario.uid ? { ...u, estado: nuevoEstado } : u));
      setMensaje({ texto: `Usuario ${nuevoEstado === 'bloqueado' ? 'bloqueado' : 'activado'} con éxito.`, tipo: 'success' });
    } catch (err: any) {
      setMensaje({ texto: 'Error al cambiar estado del usuario: ' + err.message, tipo: 'error' });
    }
  };

  const handleBorrarUsuario = async (usuario: Usuario) => {
    const confirmacion = window.confirm(`¿Estás seguro de que deseas eliminar permanentemente al usuario "${usuario.nombre}" (${usuario.email})?`);
    if (!confirmacion) return;

    try {
      await deleteDoc(doc(db, 'users', usuario.uid));
      setComercioUsers(comercioUsers.filter(u => u.uid !== usuario.uid));
      setGlobalUsers(globalUsers.filter(u => u.uid !== usuario.uid));
      setMensaje({ texto: 'Usuario eliminado de Firestore.', tipo: 'success' });
    } catch (err: any) {
      setMensaje({ texto: 'Error al eliminar usuario: ' + err.message, tipo: 'error' });
    }
  };

  const handleSimularQrGenerar = async () => {
    if (!comercioId) {
      setMensaje({ texto: 'Selecciona un comercio en el paso 2 para simular el QR.', tipo: 'error' });
      return;
    }
    try {
      const { generarCodigoUnicoQR } = await import('../utils/qr');
      const codigo = await generarCodigoUnicoQR(db);
      const sesionRef = doc(db, 'sesiones_qr', codigo);
      await setDoc(sesionRef, {
        id: codigo,
        tipo: qrSimTipo,
        comercioId,
        montoFactura: Number(qrSimMonto) || 100,
        nroFactura: 'SIM-' + Math.floor(Math.random() * 10000),
        puntosCalculados: Number(qrSimMonto) || 10,
        estado: 'PENDIENTE',
        createdAt: Date.now()
      });
      setQrSimCodeResult(codigo);
      setMensaje({ texto: `QR generado exitosamente: ${codigo}`, tipo: 'success' });
    } catch (err: any) {
      setMensaje({ texto: 'Error al generar QR simulado: ' + err.message, tipo: 'error' });
    }
  };

  if (loading) return <div className="p-8 text-center" style={{color: 'var(--text-main)', backgroundColor: 'var(--bg-main)'}}>Cargando panel de superadmin...</div>;

  const filteredUsers = comercioUsers.filter(u => 
    u.nombre.toLowerCase().includes(searchTerm.toLowerCase()) || 
    u.email.toLowerCase().includes(searchTerm.toLowerCase()) || 
    (u.emailReal && u.emailReal.toLowerCase().includes(searchTerm.toLowerCase())) ||
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
          <button className="float-right font-black cursor-pointer" onClick={() => setMensaje(null)}>✕</button>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-8">
        
        {/* 1. Crear Comercio */}
        <div className="sa-card">
          <h3 className="sa-subtitle">1. Crear Nuevo Comercio</h3>
          <form onSubmit={handleCrearComercio} className="space-y-4">
            <div>
              <label className="sa-label">Nombre Comercial</label>
              <input type="text" required className="sa-input" value={nombreComercio} onChange={e => handleNombreComercioChange(e.target.value)} placeholder="Ej: Mi Mercado" />
            </div>
            <div>
              <label className="sa-label">Dominio Asignado (.io)</label>
              <input type="text" required className="sa-input" value={dominioComercio} onChange={e => setDominioComercio(e.target.value)} placeholder="Ej: mimercado.io" />
              <p className="text-xs text-[var(--text-muted)] mt-1">Este dominio formará los usuarios de acceso del comercio (ej: admin@mimercado.io).</p>
            </div>
            <div>
              <label className="sa-label">NIT / RUT</label>
              <input type="text" required className="sa-input" value={nitRut} onChange={e => setNitRut(e.target.value)} placeholder="Ej: 123456789" />
            </div>
            <div>
              <label className="sa-label">Paleta de Colores</label>
              <select className="sa-input" value={paletteId} onChange={e => setPaletteId(e.target.value)}>
                {COLOR_PALETTES.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="sa-label">Plan del Comercio</label>
              <select className="sa-input" value={planComercio} onChange={e => setPlanComercio(e.target.value as 'regular' | 'premium')}>
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
          <ul className="space-y-4 max-h-96 overflow-y-auto pr-2">
            {comercios.map(c => (
              <li key={c.id} className="sa-card bg-gray-50 flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  {c.logoUrl ? (
                    <img src={c.logoUrl} alt="Logo" className="w-12 h-12 object-contain rounded border bg-white flex-shrink-0" />
                  ) : (
                    <div className="w-12 h-12 bg-gray-200 rounded flex items-center justify-center font-bold text-gray-400 text-sm flex-shrink-0">NB</div>
                  )}
                  <div className="min-w-0 flex-1">
                    <strong className="block truncate text-[var(--text-main)] text-lg">{c.nombre} {c.estado === 'bloqueado' && <span className="text-xs bg-red-500 text-white px-2 py-0.5 rounded ml-2">BLOQUEADO</span>}</strong>
                    <span className="text-sm text-[var(--text-muted)] block truncate">
                      Dominio: <span className="font-mono text-brand-primary">{c.dominio || '-'}</span> | NIT: {c.nit_rut} | Plan: <span className="font-bold text-brand-primary uppercase">{c.plan || 'regular'}</span>
                    </span>
                  </div>
                </div>
                
                {editingComercio?.id === c.id ? (
                  <form onSubmit={handleGuardarEdicionComercio} className="border-t pt-3 mt-2 space-y-3 bg-white p-3 rounded shadow-inner">
                    <h5 className="font-bold text-sm">Editar Comercio</h5>
                    <input className="sa-input" value={editComercioNombre} onChange={e=>setEditComercioNombre(e.target.value)} required placeholder="Nombre" />
                    <input className="sa-input" value={editComercioDominio} onChange={e=>setEditComercioDominio(e.target.value)} required placeholder="Dominio (ej: tienda.io)" />
                    <input className="sa-input" value={editComercioNit} onChange={e=>setEditComercioNit(e.target.value)} required placeholder="NIT/RUT" />
                    <select className="sa-input" value={editComercioPlan} onChange={e=>setEditComercioPlan(e.target.value as any)}>
                      <option value="regular">Regular</option>
                      <option value="premium">Premium</option>
                    </select>
                    <div className="flex gap-2">
                      <button type="submit" className="sa-btn-primary text-sm">Guardar</button>
                      <button type="button" onClick={() => setEditingComercio(null)} className="sa-btn-secondary text-sm">Cancelar</button>
                    </div>
                  </form>
                ) : (
                  <div className="flex flex-wrap gap-2 border-t pt-3 mt-2">
                    <button onClick={() => { setEditingComercio(c); setEditComercioNombre(c.nombre); setEditComercioDominio(c.dominio || ''); setEditComercioNit(c.nit_rut); setEditComercioPlan(c.plan || 'regular'); }} className="text-xs bg-gray-200 text-gray-800 font-bold px-3 py-1.5 rounded hover:bg-gray-300 transition border cursor-pointer">Editar</button>
                    <button onClick={() => handleToggleEstadoComercio(c)} className={`text-xs font-bold px-3 py-1.5 rounded transition border cursor-pointer ${c.estado === 'bloqueado' ? 'bg-green-500 text-white hover:bg-green-600 border-green-700' : 'bg-orange-500 text-white hover:bg-orange-600 border-orange-700'}`}>
                      {c.estado === 'bloqueado' ? 'Desbloquear' : 'Bloquear'}
                    </button>
                    <button onClick={() => handleBorrarComercio(c)} className="text-xs bg-red-500 text-white font-bold px-3 py-1.5 rounded hover:bg-red-600 transition border border-red-700 ml-auto cursor-pointer">Borrar</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>

        {/* 2. Crear Usuarios */}
        <div className="sa-card">
          <h3 className="sa-subtitle">2. Crear Usuarios</h3>
          <form onSubmit={handleCrearUsuario} className="space-y-4">
            {rol !== 'influencer' && (
              <div>
                <label className="sa-label">Comercio Asignado</label>
                <select required className="sa-input" value={comercioId} onChange={e => setComercioId(e.target.value)}>
                  <option value="">-- Selecciona un Comercio --</option>
                  {comercios.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.nombre} ({c.dominio || 'sin dominio'})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="sa-label">Rol</label>
                <select className="sa-input" value={rol} onChange={e => setRol(e.target.value as any)}>
                  <option value="vendedor">Vendedor (Cajero - PIN)</option>
                  <option value="admin_comercio">Administrador del Comercio</option>
                  <option value="influencer">Influencer</option>
                </select>
              </div>
              <div>
                <label className="sa-label">Nombre Completo</label>
                <input type="text" required className="sa-input" value={nombreUsuario} onChange={e => setNombreUsuario(e.target.value)} placeholder="Ej: Juan Pérez" />
              </div>
            </div>

            {/* Identificador de Usuario */}
            <div>
              <label className="sa-label">Identificador de Usuario (Login)</label>
              <div className="flex items-center gap-2">
                <input 
                  type="text" 
                  required 
                  className="sa-input flex-1" 
                  value={usuarioPrefix} 
                  onChange={e => setUsuarioPrefix(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))} 
                  placeholder={rol === 'influencer' ? 'ej: carlos' : 'ej: admin o caja1'} 
                />
                <span className="text-xs font-mono bg-gray-100 p-2 rounded border text-gray-700 whitespace-nowrap">
                  {rol === 'influencer' ? '@hiinfluencer.io' : (comercioDominio ? `@${comercioDominio}` : '@dominio.io')}
                </span>
              </div>
              {computedUsuarioSintetico() && (
                <p className="text-xs text-brand-primary mt-1 font-semibold">
                  Usuario final de acceso: <span className="font-mono">{computedUsuarioSintetico()}</span>
                </p>
              )}
            </div>

            {/* Correo Real (Solo Admin e Influencer) */}
            {rol !== 'vendedor' && (
              <div>
                <label className="sa-label">Correo Electrónico Real (Administrativo)</label>
                <input 
                  type="email" 
                  required 
                  className="sa-input" 
                  value={emailReal} 
                  onChange={e => setEmailReal(e.target.value)} 
                  placeholder="ej: correo.personal@gmail.com" 
                />
                <p className="text-xs text-[var(--text-muted)] mt-1">Este correo NO se envía a autenticación; queda guardado internamente para contacto y notificaciones.</p>
              </div>
            )}

            {/* PIN de 6 dígitos para Vendedor */}
            {rol === 'vendedor' && (
              <div>
                <label className="sa-label">PIN de Acceso (6 dígitos)</label>
                <input 
                  type="password" 
                  maxLength={6} 
                  pattern="\d{6}" 
                  required 
                  className="sa-input tracking-widest text-center text-lg font-bold" 
                  value={pinVendedor} 
                  onChange={e => setPinVendedor(e.target.value.replace(/\D/g, ''))} 
                  placeholder="123456" 
                />
                <p className="text-xs text-[var(--text-muted)] mt-1">Los vendedores ingresan con su usuario y este PIN numérico sin sobrecargar cuentas de Firebase.</p>
              </div>
            )}

            {/* Teléfono */}
            <div>
              <label className="sa-label">Teléfono (WhatsApp)</label>
              <div className="flex gap-2">
                <select 
                  className="sa-input flex-shrink-0" 
                  style={{ width: '130px', flexShrink: 0 }} 
                  value={countryCode} 
                  onChange={e => setCountryCode(e.target.value)}
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
                  className="sa-input flex-1 min-w-0" 
                  value={telefonoUsuario} 
                  onChange={e => setTelefonoUsuario(e.target.value.replace(/\D/g, ''))} 
                  placeholder="Ej: 71234567" 
                />
              </div>
            </div>

            {/* Contraseña para Admin e Influencer */}
            {rol !== 'vendedor' && (
              <div>
                <label className="sa-label">Contraseña de Acceso (Temporal)</label>
                <div className="relative">
                  <input type={showPassword ? "text" : "password"} required minLength={6} className="sa-input" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••" />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 transform -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-main)] focus:outline-none text-xs font-medium cursor-pointer">
                    {showPassword ? 'Ocultar' : 'Ver'}
                  </button>
                </div>
              </div>
            )}

            {/* Prefijo para Influencer */}
            {rol === 'influencer' && (
              <div>
                <label className="sa-label">Prefijo de Código (Ej. NAT)</label>
                <input type="text" maxLength={10} required className="sa-input uppercase" value={prefijoCodigo} onChange={e => setPrefijoCodigo(e.target.value)} placeholder="NAT" />
              </div>
            )}

            <button type="submit" className="sa-btn-secondary">Crear Usuario</button>
          </form>
        </div>

      </div>

      {/* 3. Listar y Administrar Usuarios por Comercio */}
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
              <input type="text" className="sa-input max-w-md" placeholder="Buscar por nombre, usuario, correo real o teléfono..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
            </div>
            <div className="overflow-x-auto">
              <table className="sa-table">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Usuario (Login)</th>
                    <th>Correo Real</th>
                    <th>WhatsApp</th>
                    <th>Rol</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-4 text-center text-[var(--text-muted)]">No hay usuarios asignados a este comercio.</td>
                    </tr>
                  ) : (
                    filteredUsers.map(u => (
                      <tr key={u.uid}>
                        <td className="font-medium">{u.nombre}</td>
                        <td className="font-mono text-xs">{u.email}</td>
                        <td className="text-xs text-gray-500">{u.emailReal || (u.rol === 'vendedor' ? 'PIN: ' + (u.pin || '******') : '-')}</td>
                        <td>{u.telefono || '-'}</td>
                        <td><span className="sa-badge">{u.rol.replace('_', ' ')}</span></td>
                        <td className="flex gap-2">
                          <button onClick={() => handleRecrearClave(u)} className="text-xs bg-[var(--accent-primary)] text-black font-bold px-3 py-1 rounded hover:opacity-80 transition cursor-pointer border border-black">
                            {u.rol === 'vendedor' ? 'Cambiar PIN' : 'Recrear Contraseña'}
                          </button>
                          <button onClick={() => handleBorrarUsuario(u)} className="text-xs bg-red-500 text-white font-bold px-3 py-1 rounded hover:bg-red-600 transition cursor-pointer border border-red-700">Borrar</button>
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

      {/* 4. Directorio Global de Todos los Usuarios (Incluyendo Influencers y Clientes) */}
      <div className="sa-card">
        <h3 className="sa-subtitle">4. Directorio Global de Usuarios ({globalUsers.length})</h3>
        <div className="mb-4">
          <input type="text" className="sa-input max-w-md" placeholder="Buscar en todos los usuarios (nombre, usuario, correo real)..." value={globalSearchTerm} onChange={e => setGlobalSearchTerm(e.target.value)} />
        </div>
        <div className="overflow-x-auto max-h-96">
          <table className="sa-table">
            <thead className="sticky top-0 bg-[var(--bg-surface)]">
              <tr>
                <th>Nombre</th>
                <th>Usuario (Login)</th>
                <th>Correo Real</th>
                <th>WhatsApp</th>
                <th>Rol</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {globalUsers
                .filter(u => 
                  u.nombre.toLowerCase().includes(globalSearchTerm.toLowerCase()) || 
                  u.email.toLowerCase().includes(globalSearchTerm.toLowerCase()) || 
                  (u.emailReal && u.emailReal.toLowerCase().includes(globalSearchTerm.toLowerCase())) ||
                  (u.telefono && u.telefono.includes(globalSearchTerm))
                )
                .map(u => (
                  <tr key={u.uid} className={u.estado === 'bloqueado' ? 'opacity-60' : ''}>
                    <td className="font-medium">{u.nombre}</td>
                    <td className="font-mono text-xs">{u.email}</td>
                    <td className="text-xs text-gray-500">{u.emailReal || (u.rol === 'vendedor' ? 'PIN: ' + (u.pin || '******') : '-')}</td>
                    <td>{u.telefono || '-'}</td>
                    <td><span className="sa-badge">{u.rol.replace('_', ' ')}</span></td>
                    <td>
                      {u.estado === 'bloqueado' ? (
                        <span className="text-xs bg-red-100 text-red-800 px-2 py-1 rounded font-bold border border-red-200">BLOQUEADO</span>
                      ) : (
                        <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded font-bold border border-green-200">ACTIVO</span>
                      )}
                    </td>
                    <td className="flex gap-2">
                      <button onClick={() => handleToggleEstadoUsuario(u)} className={`text-xs font-bold px-3 py-1 rounded transition border cursor-pointer ${u.estado === 'bloqueado' ? 'bg-green-500 text-white' : 'bg-orange-500 text-white'}`}>
                        {u.estado === 'bloqueado' ? 'Activar' : 'Bloquear'}
                      </button>
                      <button onClick={() => handleBorrarUsuario(u)} className="text-xs bg-red-500 text-white font-bold px-3 py-1 rounded hover:bg-red-600 transition cursor-pointer border border-red-700">
                        Borrar
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 5. Simulador QR */}
      <div className="sa-card">
        <h3 className="sa-subtitle">5. Simulador QR</h3>
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
            <button onClick={handleSimularQrGenerar} className="sa-btn-primary">Generar QR en Firebase</button>
            {qrSimCodeResult && (
              <div className="mt-4 p-4 bg-white border rounded text-center flex flex-col items-center justify-center">
                <QRCodeSVG value={qrSimCodeResult} size={200} level="H" />
                <p className="mt-4 text-sm font-bold text-gray-500">ID QR:</p>
                <div className="text-xl font-mono select-all tracking-widest text-black">{qrSimCodeResult}</div>
                <p className="mt-2 text-xs text-red-500">Este QR no es válido para usuarios reales.</p>
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  );
};

export default SuperAdminDashboard;
