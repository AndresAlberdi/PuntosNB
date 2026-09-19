import React, { useState, useEffect } from 'react';
import { collection, doc, setDoc, getDocs, deleteDoc, updateDoc } from 'firebase/firestore';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { QRCodeSVG } from 'qrcode.react';
import { db } from '../firebase';
import { secondaryAuth } from '../secondaryApp';
import type { Comercio, Usuario, CobroPrepago, ModalidadPagoComercio } from '../types';
import { COLOR_PALETTES } from '../utils/theme';
import { checkComercioPrepagoStatus } from '../utils/reports';
import { optimizeImage } from '../utils/imageOptimizer';
import { invocar, mensajeDeError } from '../utils/backend';

const RESERVED_DOMAINS = ['influencer', 'hiinfluencer', 'hiinfluencer.io', 'admin', 'superadmin', 'hipatia', 'puntosnb'];

const SuperAdminDashboard: React.FC = () => {
  const [comercios, setComercios] = useState<Comercio[]>([]);
  const [loading, setLoading] = useState(true);
  
  // States for new Comercio
  const [nombreComercio, setNombreComercio] = useState('');
  const [nitRut, setNitRut] = useState('');
  const [razonSocial, setRazonSocial] = useState('');
  const [dominioComercio, setDominioComercio] = useState('');
  const [logoBase64, setLogoBase64] = useState('');
  const [paletteId, setPaletteId] = useState('ocean');
  const [planComercio, setPlanComercio] = useState<'regular' | 'premium'>('regular');
  
  // Parámetros Prepago Nuevo Comercio
  const [modalidadPago, setModalidadPago] = useState<ModalidadPagoComercio>('PILOTO');
  const [mensualidadBs, setMensualidadBs] = useState<string>('25.00');
  const [costoPorPremioBs, setCostoPorPremioBs] = useState<string>('1.25');
  const [costoPorCodigoComercio, setCostoPorCodigoComercio] = useState<string>('10.00');
  const [recibeFactura, setRecibeFactura] = useState<boolean>(true);
  
  // States for new User
  const [usuarioPrefix, setUsuarioPrefix] = useState('');
  const [emailReal, setEmailReal] = useState('');
  const [pinVendedor, setPinVendedor] = useState('');
  const [password, setPassword] = useState('');
  const [nombreUsuario, setNombreUsuario] = useState('');
  const [telefonoUsuario, setTelefonoUsuario] = useState('');
  const [countryCode, setCountryCode] = useState('+591');
  const [rol, setRol] = useState<'admin_comercio' | 'vendedor' | 'influencer' | 'contador'>('vendedor');
  const [comercioId, setComercioId] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [prefijoCodigo, setPrefijoCodigo] = useState('');
  
  // Inline feedback messages per card
  const [msgCard1, setMsgCard1] = useState<{ texto: string; tipo: 'success' | 'error' } | null>(null);
  const [msgCard2, setMsgCard2] = useState<{ texto: string; tipo: 'success' | 'error' } | null>(null);
  const [msgCard4, setMsgCard4] = useState<{ texto: string; tipo: 'success' | 'error' } | null>(null);
  const [msgCard5, setMsgCard5] = useState<{ texto: string; tipo: 'success' | 'error' } | null>(null);
  const [msgCardCobranzas, setMsgCardCobranzas] = useState<{ texto: string; tipo: 'success' | 'error' } | null>(null);
  const [msgCardSimulador, setMsgCardSimulador] = useState<{ texto: string; tipo: 'success' | 'error' } | null>(null);

  // States for listing users
  const [globalUsers, setGlobalUsers] = useState<Usuario[]>([]);
  const [globalSearchTerm, setGlobalSearchTerm] = useState('');
  
  // Editing Comercio
  const [editingComercio, setEditingComercio] = useState<Comercio | null>(null);
  const [editComercioNombre, setEditComercioNombre] = useState('');
  const [editComercioDominio, setEditComercioDominio] = useState('');
  const [editComercioPlan, setEditComercioPlan] = useState<'regular' | 'premium'>('regular');
  const [editComercioNit, setEditComercioNit] = useState('');
  const [editComercioRazonSocial, setEditComercioRazonSocial] = useState('');
  const [editModalidadPago, setEditModalidadPago] = useState<ModalidadPagoComercio>('PILOTO');
  const [editMensualidadBs, setEditMensualidadBs] = useState('25.00');
  const [editCostoPorPremioBs, setEditCostoPorPremioBs] = useState('1.25');
  const [editCostoPorCodigoComercio, setEditCostoPorCodigoComercio] = useState('10.00');
  const [editRecibeFactura, setEditRecibeFactura] = useState(true);
  const [editComercioMsg, setEditComercioMsg] = useState<{ texto: string; tipo: 'success' | 'error' } | null>(null);
  const [guardandoEditComercio, setGuardandoEditComercio] = useState(false);

  // States for Influencer ABM
  const [editingInfluencer, setEditingInfluencer] = useState<Usuario | null>(null);
  const [editInfNombre, setEditInfNombre] = useState('');
  const [editInfEmailReal, setEditInfEmailReal] = useState('');
  const [editInfTelefono, setEditInfTelefono] = useState('');
  const [editInfPrefijo, setEditInfPrefijo] = useState('');
  const [allAsignaciones, setAllAsignaciones] = useState<any[]>([]);

  // States for QR Simulator
  const [qrSimComercioId, setQrSimComercioId] = useState('');
  const [qrSimTipo, setQrSimTipo] = useState<'ACUMULACION' | 'CANJE'>('ACUMULACION');
  const [qrSimMonto, setQrSimMonto] = useState('100');
  const [qrSimCodeResult, setQrSimCodeResult] = useState('');

  // States for Navigation Tabs in SuperAdmin
  const [activeTab, setActiveTab] = useState<'COBRANZAS' | 'CREAR_COMERCIO' | 'COMERCIOS_EXISTENTES' | 'USUARIOS' | 'INFLUENCERS' | 'SIMULADOR'>('COBRANZAS');

  // States for Facturación & Cobros Prepago
  const [cobros, setCobros] = useState<CobroPrepago[]>([]);
  const [filtroPrepago, setFiltroPrepago] = useState<'TODOS' | 'AL_DIA' | 'POR_VENCER' | 'VENCIDOS' | 'PILOTO'>('TODOS');
  const [modalComprobante, setModalComprobante] = useState<CobroPrepago | null>(null);

  // Filtros avanzados para el Dashboard de Cobranzas
  const [filtroCobranzasPeriodo, setFiltroCobranzasPeriodo] = useState<'HOY' | 'SEMANA' | 'MES' | 'RANGO' | 'TODOS'>('MES');
  const [filtroCobranzasEstado, setFiltroCobranzasEstado] = useState<'TODOS' | 'VERIFICADOS' | 'PENDIENTES' | 'RECHAZADOS'>('TODOS');
  const hoyStr = new Date().toISOString().split('T')[0];
  const primerDiaMesStr = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
  const [fechaDesdeCobro, setFechaDesdeCobro] = useState<string>(primerDiaMesStr);
  const [fechaHastaCobro, setFechaHastaCobro] = useState<string>(hoyStr);
  const [busquedaComercioExistente, setBusquedaComercioExistente] = useState<string>('');

  const cargarComercios = async () => {
    try {
      const snap = await getDocs(collection(db, 'comercios'));
      const data: Comercio[] = [];
      snap.forEach(docSnap => data.push(docSnap.data() as Comercio));
      setComercios(data);
      if (data.length > 0 && !qrSimComercioId) {
        setQrSimComercioId(data[0].id);
      }
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

  const fetchAsignaciones = async () => {
    try {
      const snap = await getDocs(collection(db, 'asignaciones_influencer'));
      const asigs: any[] = [];
      snap.forEach(d => asigs.push(d.data()));
      setAllAsignaciones(asigs);
    } catch (err) {}
  };

  const fetchCobros = async () => {
    try {
      const snap = await getDocs(collection(db, 'cobros_prepago'));
      const list: CobroPrepago[] = [];
      snap.forEach(d => list.push(d.data() as CobroPrepago));
      list.sort((a, b) => b.fechaHora - a.fechaHora);
      setCobros(list);
    } catch (err) {}
  };

  useEffect(() => {
    cargarComercios();
    fetchGlobalUsers();
    fetchAsignaciones();
    fetchCobros();
  }, []);

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
    if (rol === 'contador') {
      return `${cleanUser}@hipatia.io`;
    }
    if (comercioDominio) {
      return `${cleanUser}@${comercioDominio}`;
    }
    return cleanUser;
  };

  const parseDecimal = (val: string, defaultVal: number): number => {
    if (!val) return defaultVal;
    const normalized = val.trim().replace(',', '.');
    const parsed = parseFloat(normalized);
    return isNaN(parsed) ? defaultVal : parsed;
  };

  const handleCrearComercio = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsgCard1(null);

    const cleanDominio = dominioComercio.trim().toLowerCase().replace(/^@+/, '');
    const isReserved = RESERVED_DOMAINS.some(res => cleanDominio === res || cleanDominio.startsWith(res + '.'));
    if (isReserved) {
      setMsgCard1({ texto: `El dominio "${cleanDominio}" está reservado por el sistema y no puede ser usado por un comercio.`, tipo: 'error' });
      return;
    }
    if (!cleanDominio.includes('.')) {
      setMsgCard1({ texto: 'El dominio asignado debe tener una extensión válida (ej: mitienda.io).', tipo: 'error' });
      return;
    }

    const dominioRepetido = comercios.some(c => c.dominio?.toLowerCase() === cleanDominio);
    if (dominioRepetido) {
      setMsgCard1({ texto: `El dominio "${cleanDominio}" ya pertenece a otro comercio registrado. Elige un dominio único.`, tipo: 'error' });
      return;
    }

    try {
      // El alta la hace el servidor: es la única vía para fijar plan, modalidad y costos (H-07).
      await invocar('guardarComercio', {
        nombre: nombreComercio.trim(),
        nit_rut: nitRut.trim(),
        razonSocial: razonSocial.trim() || undefined,
        dominio: cleanDominio,
        plan: planComercio,
        modalidadPago: modalidadPago,
        mensualidadBs: parseDecimal(mensualidadBs, 25.00),
        costoPorPremioBs: parseDecimal(costoPorPremioBs, 1.25),
        costoPorCodigoComercio: parseDecimal(costoPorCodigoComercio, 10.00),
        recibeFactura: recibeFactura,
        logoUrl: logoBase64 || undefined,
        paletteId: paletteId,
      });
      setMsgCard1({ texto: `Comercio "${nombreComercio}" creado exitosamente con dominio ${cleanDominio}`, tipo: 'success' });
      setNombreComercio('');
      setNitRut('');
      setRazonSocial('');
      setDominioComercio('');
      setLogoBase64('');
      setPaletteId('ocean');
      setPlanComercio('regular');
      setModalidadPago('PILOTO');
      setMensualidadBs('25.00');
      setCostoPorPremioBs('1.25');
      setCostoPorCodigoComercio('10.00');
      setRecibeFactura(true);
      const fileInput = document.getElementById('comercio-logo-file') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
      cargarComercios();
    } catch (error: any) {
      console.error(error);
      setMsgCard1({ texto: mensajeDeError(error), tipo: 'error' });
    }
  };

  const handleGuardarEdicionComercio = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingComercio) return;
    setEditComercioMsg(null);
    setGuardandoEditComercio(true);

    const cleanDominio = editComercioDominio.trim().toLowerCase().replace(/^@+/, '');
    const isReserved = RESERVED_DOMAINS.some(res => cleanDominio === res || cleanDominio.startsWith(res + '.'));
    if (isReserved) {
      setEditComercioMsg({ texto: `El dominio "${cleanDominio}" está reservado por el sistema.`, tipo: 'error' });
      setGuardandoEditComercio(false);
      return;
    }
    if (!cleanDominio.includes('.')) {
      setEditComercioMsg({ texto: 'El dominio asignado debe tener una extensión válida (ej: mitienda.io).', tipo: 'error' });
      setGuardandoEditComercio(false);
      return;
    }

    const dominioRepetido = comercios.some(c => c.id !== editingComercio.id && c.dominio?.toLowerCase() === cleanDominio);
    if (dominioRepetido) {
      setEditComercioMsg({ texto: `El dominio "${cleanDominio}" ya pertenece a otro comercio registrado.`, tipo: 'error' });
      setGuardandoEditComercio(false);
      return;
    }

    try {
      await invocar('guardarComercio', {
        comercioId: editingComercio.id,
        nombre: editComercioNombre.trim(),
        nit_rut: editComercioNit.trim(),
        razonSocial: editComercioRazonSocial.trim() || undefined,
        dominio: cleanDominio,
        plan: editComercioPlan,
        modalidadPago: editModalidadPago,
        mensualidadBs: parseDecimal(editMensualidadBs, 25.00),
        costoPorPremioBs: parseDecimal(editCostoPorPremioBs, 1.25),
        costoPorCodigoComercio: parseDecimal(editCostoPorCodigoComercio, 10.00),
        recibeFactura: editRecibeFactura,
      });
      setEditComercioMsg({ texto: '✓ ¡Cambios guardados con éxito!', tipo: 'success' });
      await cargarComercios();
      setTimeout(() => {
        setEditingComercio(null);
        setEditComercioMsg(null);
      }, 1500);
    } catch (err: any) {
      console.error(err);
      setEditComercioMsg({ texto: mensajeDeError(err), tipo: 'error' });
    } finally {
      setGuardandoEditComercio(false);
    }
  };

  const handleCrearUsuario = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsgCard2(null);

    const syntheticUser = computedUsuarioSintetico();
    if (!syntheticUser) {
      setMsgCard2({ texto: 'Ingresa un identificador de usuario válido.', tipo: 'error' });
      return;
    }

    if (!comercioId && rol !== 'influencer' && rol !== 'contador') {
      setMsgCard2({ texto: 'Debes seleccionar un comercio para este rol.', tipo: 'error' });
      return;
    }

    // Validación de Prefijo Único para Influencer
    if (rol === 'influencer') {
      const cleanPrefijo = prefijoCodigo.trim().toUpperCase();
      if (!cleanPrefijo || cleanPrefijo.length > 10) {
        setMsgCard2({ texto: 'El influencer debe tener un prefijo de código válido (máx 10 caracteres).', tipo: 'error' });
        return;
      }
      const existePrefijo = globalUsers.some(
        u => u.rol === 'influencer' && u.prefijoCodigo?.toUpperCase() === cleanPrefijo
      );
      if (existePrefijo) {
        setMsgCard2({ texto: `El prefijo "${cleanPrefijo}" ya está siendo utilizado por otro influencer. Elige un prefijo diferente.`, tipo: 'error' });
        return;
      }
    }

    try {
      // 1. Vendedor: lo crea el servidor. Da de alta su cuenta en Firebase Auth, guarda el PIN
      // como hash en una colección cerrada al cliente y deja el rol en el token (H-04, H-22).
      if (rol === 'vendedor') {
        if (!/^\d{6}$/.test(pinVendedor)) {
          setMsgCard2({ texto: 'El PIN del vendedor debe ser exactamente de 6 dígitos numéricos.', tipo: 'error' });
          return;
        }
        if (!comercioId) {
          setMsgCard2({ texto: 'Selecciona el comercio al que pertenece el vendedor.', tipo: 'error' });
          return;
        }

        await invocar('crearVendedor', {
          usuario: syntheticUser,
          nombre: nombreUsuario.trim(),
          comercioId,
          pin: pinVendedor.trim(),
          ...(telefonoUsuario ? { telefono: `${countryCode}${telefonoUsuario}` } : {}),
        });
        setMsgCard2({ texto: `Vendedor creado exitosamente: ${syntheticUser}`, tipo: 'success' });
      }
      // 2. Admin / Influencer / Contador (Firebase Auth)
      else {
        if (!emailReal || !emailReal.includes('@')) {
          setMsgCard2({ texto: 'Debes ingresar un correo electrónico real válido para administración.', tipo: 'error' });
          return;
        }

        if (!password || password.length < 6) {
          setMsgCard2({ texto: 'La contraseña debe tener al menos 6 caracteres.', tipo: 'error' });
          return;
        }

        let userUid: string | null = null;
        try {
          const userCred = await createUserWithEmailAndPassword(secondaryAuth, syntheticUser, password);
          userUid = userCred.user.uid;
        } catch (authErr: any) {
          if (authErr.code === 'auth/email-already-in-use') {
            try {
              const { signInWithEmailAndPassword } = await import('firebase/auth');
              const signInCred = await signInWithEmailAndPassword(secondaryAuth, syntheticUser, password);
              userUid = signInCred.user.uid;
            } catch (signInErr) {
              setMsgCard2({ texto: `El usuario "${syntheticUser}" ya existe en Firebase Auth.`, tipo: 'error' });
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
            rol: 'cliente',
            createdAt: Date.now(),
            ...(telefonoUsuario ? { telefono: `${countryCode}${telefonoUsuario}` } : {}),
            ...(rol === 'influencer' && prefijoCodigo ? { prefijoCodigo: prefijoCodigo.trim().toUpperCase() } : {})
          };
          await setDoc(userDocRef, userData);
          // El rol y el comercio los fija el servidor, que además los graba en el token y deja
          // asiento en la auditoría. El cliente nunca decide un rol (H-01, H-09).
          await invocar('asignarRol', {
            uid: userUid,
            rol,
            ...(rol === 'admin_comercio' && comercioId ? { comercioId } : {}),
          });
          setMsgCard2({ texto: `Usuario ${rol} creado exitosamente: ${syntheticUser}`, tipo: 'success' });
        }
      }

      setUsuarioPrefix('');
      setEmailReal('');
      setPassword('');
      setPinVendedor('');
      setNombreUsuario('');
      setTelefonoUsuario('');
      setPrefijoCodigo('');
      fetchGlobalUsers();
    } catch (error: any) {
      console.error(error);
      setMsgCard2({ texto: mensajeDeError(error), tipo: 'error' });
    }
  };

  const handleGuardarEdicionInfluencer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingInfluencer) return;
    setMsgCard4(null);

    // Validación de prefijo único al editar
    const cleanPrefijo = editInfPrefijo.trim().toUpperCase();
    if (cleanPrefijo) {
      const snapUsers = await getDocs(collection(db, 'users'));
      const prefijoEnUso = snapUsers.docs.some(d => {
        const u = d.data() as Usuario;
        return u.uid !== editingInfluencer.uid && u.rol === 'influencer' && u.prefijoCodigo?.trim().toUpperCase() === cleanPrefijo;
      });

      if (prefijoEnUso) {
        setMsgCard4({ texto: `El prefijo "${cleanPrefijo}" ya está en uso por otro influencer. Elige uno diferente.`, tipo: 'error' });
        return;
      }
    }

    try {
      await updateDoc(doc(db, 'users', editingInfluencer.uid), {
        nombre: editInfNombre,
        emailReal: editInfEmailReal || null,
        telefono: editInfTelefono || null,
        prefijoCodigo: cleanPrefijo || null,
      });

      setMsgCard4({ texto: 'Influencer actualizado con éxito.', tipo: 'success' });
      setEditingInfluencer(null);
      fetchGlobalUsers();
    } catch (err: any) {
      console.error(err);
      setMsgCard4({ texto: 'Error al actualizar influencer: ' + err.message, tipo: 'error' });
    }
  };

  const handleGenerarQRPrueba = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsgCardSimulador(null);
    if (!qrSimComercioId) {
      setMsgCardSimulador({ texto: 'Selecciona un comercio en este recuadro para generar el QR.', tipo: 'error' });
      return;
    }
    try {
      const { generarCodigoUnicoQR } = await import('../utils/qr');
      const codigo = await generarCodigoUnicoQR(db);
      const sesionRef = doc(db, 'sesiones_qr', codigo);
      await setDoc(sesionRef, {
        id: codigo,
        tipo: qrSimTipo,
        comercioId: qrSimComercioId,
        montoFactura: Number(qrSimMonto) || 100,
        nroFactura: 'SIM-' + Math.floor(Math.random() * 10000),
        puntosCalculados: Number(qrSimMonto) || 10,
        estado: 'PENDIENTE',
        createdAt: Date.now()
      });
      setQrSimCodeResult(codigo);
      setMsgCardSimulador({ texto: `QR simulado generado con éxito: ${codigo}`, tipo: 'success' });
    } catch (err: any) {
      setMsgCardSimulador({ texto: 'Error al generar QR simulado: ' + err.message, tipo: 'error' });
    }
  };

  // Conciliación de Depósito por SuperAdmin
  const handleConciliarDeposito = async (cobro: CobroPrepago) => {
    const confirm = window.confirm(`¿Confirmas que has verificado el depósito bancario de Bs. ${cobro.montoTotal.toLocaleString()} con código "${cobro.codigoDeposito}"?`);
    if (!confirm) return;

    try {
      await updateDoc(doc(db, 'cobros_prepago', cobro.id), {
        estado: 'VERIFICADO',
        verificadoPor: 'SuperAdmin',
        fechaVerificacion: Date.now()
      });

      setMsgCardCobranzas({ texto: `Cobro con código "${cobro.codigoDeposito}" marcado como VERIFICADO / CONCILIADO.`, tipo: 'success' });
      fetchCobros();
      setModalComprobante(null);
    } catch (err: any) {
      setMsgCardCobranzas({ texto: 'Error al verificar cobro: ' + err.message, tipo: 'error' });
    }
  };

  const handleToggleEstadoComercio = async (comercio: Comercio) => {
    const nuevoEstado = comercio.estado === 'bloqueado' ? 'activo' : 'bloqueado';
    try {
      await updateDoc(doc(db, 'comercios', comercio.id), { estado: nuevoEstado });
      setComercios(comercios.map(c => c.id === comercio.id ? { ...c, estado: nuevoEstado } : c));
      setMsgCard1({ texto: `Comercio ${nuevoEstado === 'bloqueado' ? 'bloqueado' : 'desbloqueado'} con éxito.`, tipo: 'success' });
    } catch (err: any) {
      setMsgCard1({ texto: 'Error: ' + err.message, tipo: 'error' });
    }
  };

  const handleToggleEstadoUsuario = async (usuario: Usuario) => {
    const nuevoEstado = usuario.estado === 'bloqueado' ? 'activo' : 'bloqueado';
    if (!confirm(`¿Seguro que quieres ${nuevoEstado === 'bloqueado' ? 'bloquear' : 'desbloquear'} a "${usuario.nombre}"?`)) return;
    try {
      // Bloquear revoca además las sesiones abiertas del usuario.
      await invocar('cambiarEstadoUsuario', { uid: usuario.uid, bloquear: nuevoEstado === 'bloqueado' });
      fetchGlobalUsers();
    } catch (err) {
      alert(mensajeDeError(err));
    }
  };

  const handleBorrarUsuario = async (usuario: Usuario) => {
    const confirmacion = window.confirm(`¿Estás seguro de que deseas eliminar al usuario "${usuario.nombre}" (${usuario.email})?`);
    if (!confirmacion) return;

    try {
      await deleteDoc(doc(db, 'users', usuario.uid));
      setGlobalUsers(globalUsers.filter(u => u.uid !== usuario.uid));
      setMsgCard5({ texto: 'Usuario eliminado con éxito.', tipo: 'success' });
    } catch (err: any) {
      setMsgCard5({ texto: 'Error al eliminar usuario: ' + err.message, tipo: 'error' });
    }
  };

  if (loading) return <div className="p-8 text-center" style={{color: 'var(--text-main)', backgroundColor: 'var(--bg-main)'}}>Cargando panel de superadmin...</div>;

  // Filtrado de comercios por estado de prepago
  const currentDate = new Date();
  const comerciosFiltradosPrepago = comercios.filter(c => {
    const status = checkComercioPrepagoStatus(c, currentDate);
    if (filtroPrepago === 'PILOTO') return c.modalidadPago === 'PILOTO' || !c.modalidadPago;
    if (filtroPrepago === 'AL_DIA') return c.modalidadPago === 'PREPAGO' && status.puedeOperar && !status.alertaAmarillaMensualidad;
    if (filtroPrepago === 'POR_VENCER') return c.modalidadPago === 'PREPAGO' && status.alertaAmarillaMensualidad;
    if (filtroPrepago === 'VENCIDOS') return c.modalidadPago === 'PREPAGO' && !status.puedeOperar;
    return true;
  });

  return (
    <div className="w-full max-w-7xl mx-auto p-4 sm:p-6 space-y-8 transition-colors duration-300">
      <style>{`
        .sa-card { background-color: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 0.75rem; padding: 1.5rem; }
        .sa-input { background-color: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 0.375rem; padding: 0.5rem 0.75rem; width: 100%; outline: none; }
        .sa-input:focus { border-color: var(--accent-primary); box-shadow: 0 0 0 2px var(--accent-primary); }
        .sa-label { display: block; font-size: 0.875rem; font-weight: 600; margin-bottom: 0.25rem; color: var(--text-muted); }
        .sa-btn-primary { background-color: var(--accent-primary); color: #000; font-weight: 600; padding: 0.5rem 1rem; border-radius: 0.375rem; transition: opacity 0.2s; width: 100%; cursor: pointer; text-align: center; }
        .sa-btn-primary:hover { opacity: 0.85; }
        .sa-btn-secondary { background-color: var(--accent-secondary); color: #000; font-weight: 600; padding: 0.5rem 1rem; border-radius: 0.375rem; transition: opacity 0.2s; width: 100%; cursor: pointer; }
        .sa-title { font-size: 1.5rem; font-weight: 700; color: var(--text-main); }
        .sa-subtitle { font-size: 1.125rem; font-weight: 700; color: var(--accent-primary); margin-bottom: 1rem; }
        .sa-table { width: 100%; border-collapse: collapse; }
        .sa-table th { padding: 0.75rem; border-bottom: 2px solid var(--border-color); color: var(--text-muted); font-weight: 600; text-align: left; }
        .sa-table td { padding: 0.75rem; border-bottom: 1px solid var(--border-color); color: var(--text-main); }
        .sa-badge { background-color: var(--bg-main); border: 1px solid var(--border-color); padding: 0.25rem 0.5rem; border-radius: 0.25rem; font-size: 0.75rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted); }
      `}</style>
      
      <div className="flex flex-wrap justify-between items-center gap-4">
        <div>
          <h2 className="sa-title">Panel de Administración del Sistema</h2>
          <p className="text-xs text-[var(--text-muted)]">Gestión Global de Comercios, Prepago, Usuarios, Influencers y Contadores</p>
        </div>
      </div>

      {/* NAVBAR DE PESTAÑAS EN SUPERADMIN */}
      <div className="flex flex-wrap gap-2 border-b border-[var(--border-color)] pb-3">
        <button
          onClick={() => setActiveTab('COBRANZAS')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
            activeTab === 'COBRANZAS'
              ? 'bg-emerald-600 text-white shadow'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200'
          }`}
        >
          <span>💳</span> Dashboard de Cobranzas
        </button>

        <button
          onClick={() => setActiveTab('CREAR_COMERCIO')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
            activeTab === 'CREAR_COMERCIO'
              ? 'bg-brand-primary text-white shadow'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200'
          }`}
        >
          <span>➕</span> Crear Nuevo Comercio
        </button>

        <button
          onClick={() => setActiveTab('COMERCIOS_EXISTENTES')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
            activeTab === 'COMERCIOS_EXISTENTES'
              ? 'bg-purple-600 text-white shadow'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200'
          }`}
        >
          <span>🏢</span> Comercios Existentes ({comercios.length})
        </button>

        <button
          onClick={() => setActiveTab('USUARIOS')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
            activeTab === 'USUARIOS'
              ? 'bg-blue-600 text-white shadow'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200'
          }`}
        >
          <span>👥</span> Gestión de Usuarios
        </button>

        <button
          onClick={() => setActiveTab('INFLUENCERS')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
            activeTab === 'INFLUENCERS'
              ? 'bg-pink-600 text-white shadow'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200'
          }`}
        >
          <span>🌟</span> Directorio Influencers
        </button>

        <button
          onClick={() => setActiveTab('SIMULADOR')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
            activeTab === 'SIMULADOR'
              ? 'bg-gray-800 text-white shadow'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200'
          }`}
        >
          <span>📱</span> Simulador QR
        </button>
      </div>

      {/* ========================================================================= */}
      {/* 1. DASHBOARD ESPECÍFICO DE COBRANZAS */}
      {/* ========================================================================= */}
      {activeTab === 'COBRANZAS' && (() => {
        // Filtrado avanzado de Cobros
        const now = new Date();
        const cobrosFiltrados = cobros.filter(cobro => {
          // Filtro Estado
          if (filtroCobranzasEstado === 'VERIFICADOS' && cobro.estado !== 'VERIFICADO') return false;
          if (filtroCobranzasEstado === 'PENDIENTES' && cobro.estado !== 'PENDIENTE_VERIFICACION') return false;
          if (filtroCobranzasEstado === 'RECHAZADOS' && cobro.estado !== 'RECHAZADO') return false;

          // Filtro Tiempo
          const f = new Date(cobro.fechaHora);
          if (filtroCobranzasPeriodo === 'HOY') {
            return f.toDateString() === now.toDateString();
          } else if (filtroCobranzasPeriodo === 'SEMANA') {
            const haceSieteDias = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            return f >= haceSieteDias;
          } else if (filtroCobranzasPeriodo === 'MES') {
            return f.getFullYear() === now.getFullYear() && f.getMonth() === now.getMonth();
          } else if (filtroCobranzasPeriodo === 'RANGO') {
            if (!fechaDesdeCobro || !fechaHastaCobro) return true;
            const startMs = new Date(fechaDesdeCobro + 'T00:00:00.000').getTime();
            const endMs = new Date(fechaHastaCobro + 'T23:59:59.999').getTime();
            return cobro.fechaHora >= startMs && cobro.fechaHora <= endMs;
          }
          return true;
        });

        const totalRecaudadoTotal = cobrosFiltrados.reduce((sum, c) => sum + (c.montoTotal || 0), 0);
        const totalMensualidades = cobrosFiltrados.reduce((sum, c) => sum + (c.montoMensualidad || 0), 0);
        const totalPremios = cobrosFiltrados.reduce((sum, c) => sum + (c.montoPremios || 0), 0);
        const totalPendientesVerif = cobrosFiltrados.filter(c => c.estado === 'PENDIENTE_VERIFICACION');
        const montoPendienteVerif = totalPendientesVerif.reduce((sum, c) => sum + (c.montoTotal || 0), 0);
        const totalVerificados = cobrosFiltrados.filter(c => c.estado === 'VERIFICADO');
        const montoVerificado = totalVerificados.reduce((sum, c) => sum + (c.montoTotal || 0), 0);

        return (
          <div className="space-y-6">
            {msgCardCobranzas && (
              <div className={`p-4 rounded-xl text-xs font-bold flex justify-between items-center shadow-sm ${
                msgCardCobranzas.tipo === 'success' ? 'bg-green-100 text-green-800 border border-green-200' : 'bg-red-100 text-red-800 border border-red-200'
              }`}>
                <span>{msgCardCobranzas.texto}</span>
                <button onClick={() => setMsgCardCobranzas(null)} className="font-black text-sm ml-2">✕</button>
              </div>
            )}

            {/* Filtros de Cobranzas */}
            <div className="bg-white dark:bg-gray-800 p-5 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm space-y-4">
              <div className="flex flex-wrap justify-between items-center gap-3">
                <div>
                  <h3 className="text-base font-black text-gray-800 dark:text-white flex items-center gap-2">
                    <span>💳</span> Dashboard Financiero de Cobranzas
                  </h3>
                  <p className="text-xs text-gray-400">Ingresos totales, desglose de mensualidades y saldos de premios recaudados.</p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <select 
                    value={filtroCobranzasPeriodo} 
                    onChange={e => setFiltroCobranzasPeriodo(e.target.value as any)}
                    className="sa-input text-xs font-bold bg-white dark:bg-gray-700"
                    style={{ width: 'auto' }}
                  >
                    <option value="HOY">Por Día (Hoy)</option>
                    <option value="SEMANA">Últimos 7 Días</option>
                    <option value="MES">Este Mes ({new Date().toLocaleString('es-ES', { month: 'long' })})</option>
                    <option value="RANGO">Entre Fechas (Personalizado)</option>
                    <option value="TODOS">Histórico Completo</option>
                  </select>

                  <select 
                    value={filtroCobranzasEstado} 
                    onChange={e => setFiltroCobranzasEstado(e.target.value as any)}
                    className="sa-input text-xs font-bold bg-white dark:bg-gray-700"
                    style={{ width: 'auto' }}
                  >
                    <option value="TODOS">Todos los Estados</option>
                    <option value="VERIFICADOS">Solo Verificados / Conciliados</option>
                    <option value="PENDIENTES">Solo Pendientes de Verificación</option>
                    <option value="RECHAZADOS">Rechazados</option>
                  </select>
                </div>
              </div>

              {filtroCobranzasPeriodo === 'RANGO' && (
                <div className="flex flex-wrap items-center gap-3 pt-2 border-t text-xs">
                  <span className="font-bold text-gray-500">Rango de fechas:</span>
                  <div className="flex items-center gap-2">
                    <label className="text-gray-400">Desde:</label>
                    <input type="date" value={fechaDesdeCobro} onChange={e => setFechaDesdeCobro(e.target.value)} className="sa-input text-xs" style={{ width: 'auto' }} />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-gray-400">Hasta:</label>
                    <input type="date" value={fechaHastaCobro} onChange={e => setFechaHastaCobro(e.target.value)} className="sa-input text-xs" style={{ width: 'auto' }} />
                  </div>
                </div>
              )}
            </div>

            {/* KPIs Financieros */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white dark:bg-gray-800 p-5 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm text-center">
                <p className="text-xs font-extrabold text-emerald-600 uppercase tracking-wider mb-1">Total Cobrado (Filtro)</p>
                <p className="text-3xl font-black text-emerald-600">Bs. {totalRecaudadoTotal.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</p>
                <p className="text-[11px] text-gray-400 mt-1">{cobrosFiltrados.length} depósitos (Verificados: Bs. {montoVerificado.toFixed(2)})</p>
              </div>

              <div className="bg-white dark:bg-gray-800 p-5 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm text-center">
                <p className="text-xs font-extrabold text-blue-600 uppercase tracking-wider mb-1">Mensualidades</p>
                <p className="text-3xl font-black text-blue-600">Bs. {totalMensualidades.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</p>
                <p className="text-[11px] text-gray-400 mt-1">mantenimiento de plataforma</p>
              </div>

              <div className="bg-white dark:bg-gray-800 p-5 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm text-center">
                <p className="text-xs font-extrabold text-purple-600 uppercase tracking-wider mb-1">Bolsa de Premios</p>
                <p className="text-3xl font-black text-purple-600">Bs. {totalPremios.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</p>
                <p className="text-[11px] text-gray-400 mt-1">fondos para canjes</p>
              </div>

              <div className="bg-white dark:bg-gray-800 p-5 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm text-center">
                <p className="text-xs font-extrabold text-amber-600 uppercase tracking-wider mb-1">Por Conciliar</p>
                <p className="text-3xl font-black text-amber-600">Bs. {montoPendienteVerif.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</p>
                <p className="text-[11px] text-gray-400 mt-1">{totalPendientesVerif.length} depósitos pendientes</p>
              </div>
            </div>

            {/* Monitoreo del Estado Prepago de los Comercios */}
            <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm space-y-4">
              <div className="flex flex-wrap justify-between items-center gap-3 border-b pb-3">
                <div>
                  <h4 className="font-black text-gray-800 dark:text-white text-sm">Estado Prepago de los Comercios ({comerciosFiltradosPrepago.length})</h4>
                  <p className="text-xs text-gray-400">Verifica mensualidades vigentes, saldos de premios restantes y facturación.</p>
                </div>
                
                <div className="flex flex-wrap gap-1 bg-gray-100 dark:bg-gray-700 p-1 rounded-xl text-xs font-bold">
                  <button onClick={() => setFiltroPrepago('TODOS')} className={`px-3 py-1 rounded-lg transition ${filtroPrepago === 'TODOS' ? 'bg-white dark:bg-gray-800 shadow text-emerald-600' : 'text-gray-500'}`}>Todos</button>
                  <button onClick={() => setFiltroPrepago('AL_DIA')} className={`px-3 py-1 rounded-lg transition ${filtroPrepago === 'AL_DIA' ? 'bg-white dark:bg-gray-800 shadow text-green-600' : 'text-gray-500'}`}>Al Día</button>
                  <button onClick={() => setFiltroPrepago('POR_VENCER')} className={`px-3 py-1 rounded-lg transition ${filtroPrepago === 'POR_VENCER' ? 'bg-white dark:bg-gray-800 shadow text-amber-600' : 'text-gray-500'}`}>Por Vencer</button>
                  <button onClick={() => setFiltroPrepago('VENCIDOS')} className={`px-3 py-1 rounded-lg transition ${filtroPrepago === 'VENCIDOS' ? 'bg-white dark:bg-gray-800 shadow text-red-600' : 'text-gray-500'}`}>Vencidos</button>
                  <button onClick={() => setFiltroPrepago('PILOTO')} className={`px-3 py-1 rounded-lg transition ${filtroPrepago === 'PILOTO' ? 'bg-white dark:bg-gray-800 shadow text-blue-600' : 'text-gray-500'}`}>Piloto</button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50 dark:bg-gray-700 text-gray-500 uppercase">
                    <tr>
                      <th className="p-3">Comercio</th>
                      <th className="p-3">Modalidad</th>
                      <th className="p-3">Mensualidad</th>
                      <th className="p-3">Estado Mes Actual</th>
                      <th className="p-3">Saldo Premios</th>
                      <th className="p-3">Premios Disp.</th>
                      <th className="p-3">Factura</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {comerciosFiltradosPrepago.map(c => {
                      const status = checkComercioPrepagoStatus(c, currentDate);
                      return (
                        <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                          <td className="p-3 font-bold text-gray-800 dark:text-white">
                            {c.nombre} 
                            <span className="text-[10px] font-mono text-gray-400 block">{c.nit_rut} {c.razonSocial ? `(${c.razonSocial})` : ''}</span>
                          </td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${c.modalidadPago === 'PREPAGO' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'}`}>
                              {c.modalidadPago || 'PILOTO'}
                            </span>
                          </td>
                          <td className="p-3 font-semibold">Bs. {(c.mensualidadBs || 25).toFixed(2)}</td>
                          <td className="p-3">
                            {c.modalidadPago !== 'PREPAGO' ? (
                              <span className="text-blue-600 font-bold">Ilimitado (Piloto)</span>
                            ) : status.puedeOperar ? (
                              <span className={`font-bold ${status.alertaAmarillaMensualidad ? 'text-amber-600' : 'text-green-600'}`}>
                                Al Día {status.alertaAmarillaMensualidad && `(Vence en ${status.diasRestantesMes}d)`}
                              </span>
                            ) : (
                              <span className="text-red-600 font-bold">IMPAGO (Deshabilitado)</span>
                            )}
                          </td>
                          <td className="p-3 font-mono font-bold">Bs. {(c.saldoPremiosBs || 0).toFixed(2)}</td>
                          <td className="p-3">
                            {c.modalidadPago !== 'PREPAGO' ? (
                              <span className="text-blue-600">Ilimitado</span>
                            ) : (
                              <span className={`font-bold ${status.alertaRojaPremios ? 'text-red-600 font-black' : status.alertaAmarillaPremios ? 'text-amber-600' : 'text-gray-800 dark:text-gray-200'}`}>
                                {status.premiosDisponibles} premios
                              </span>
                            )}
                          </td>
                          <td className="p-3">{c.recibeFactura ? '✅ Sí' : '❌ No'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Historial Transaccional de Cobros Registrados */}
            <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm space-y-4">
              <div className="flex justify-between items-center border-b pb-3">
                <h4 className="font-black text-gray-800 dark:text-white text-sm">Historial de Cobros y Depósitos ({cobrosFiltrados.length})</h4>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50 dark:bg-gray-700 text-gray-500 uppercase">
                    <tr>
                      <th className="p-3">Fecha / Hora</th>
                      <th className="p-3">Comercio</th>
                      <th className="p-3">Monto Total</th>
                      <th className="p-3">Meses Cubiertos</th>
                      <th className="p-3">Bolsa Premios</th>
                      <th className="p-3">N° Depósito</th>
                      <th className="p-3">Contador</th>
                      <th className="p-3">Estado</th>
                      <th className="p-3 text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {cobrosFiltrados.length === 0 ? (
                      <tr><td colSpan={9} className="text-center py-6 text-gray-400">No hay cobros registrados con los filtros seleccionados.</td></tr>
                    ) : (
                      cobrosFiltrados.map(cobro => (
                        <tr key={cobro.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                          <td className="p-3">{new Date(cobro.fechaHora).toLocaleString()}</td>
                          <td className="p-3 font-bold text-gray-800 dark:text-white">{cobro.nombreComercio}</td>
                          <td className="p-3 font-black text-green-700">Bs. {cobro.montoTotal.toFixed(2)}</td>
                          <td className="p-3">{cobro.mesesPagados.join(', ') || '-'}</td>
                          <td className="p-3 font-semibold">Bs. {cobro.montoPremios.toFixed(2)} ({cobro.cantidadPremiosEquivalentes} premios)</td>
                          <td className="p-3 font-mono font-bold text-blue-600">{cobro.codigoDeposito}</td>
                          <td className="p-3">{cobro.contadorAlias}</td>
                          <td className="p-3">
                            {cobro.estado === 'VERIFICADO' ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-800">VERIFICADO</span>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">PENDIENTE</span>
                            )}
                          </td>
                          <td className="p-3 text-right">
                            <button 
                              onClick={() => setModalComprobante(cobro)}
                              className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg font-bold transition cursor-pointer"
                            >
                              Ver / Conciliar
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ========================================================================= */}
      {/* 2. CREAR NUEVO COMERCIO (SEPARADO) */}
      {/* ========================================================================= */}
      {activeTab === 'CREAR_COMERCIO' && (
        <div className="max-w-2xl mx-auto sa-card space-y-6">
          <div className="border-b pb-3">
            <h3 className="sa-subtitle mb-0">Crear Nuevo Comercio</h3>
            <p className="text-xs text-[var(--text-muted)]">Registra un nuevo comercio afiliado con su subdominio exclusivo, plan y condiciones comerciales.</p>
          </div>

          {msgCard1 && (
            <div className={`p-3 rounded mb-4 text-xs font-bold ${msgCard1.tipo === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
              {msgCard1.texto}
            </div>
          )}

          <form onSubmit={handleCrearComercio} className="space-y-4">
            <div>
              <label className="sa-label">Nombre Comercial</label>
              <input type="text" required className="sa-input" value={nombreComercio} onChange={e => handleNombreComercioChange(e.target.value)} placeholder="Ej: Mi Mercado" />
            </div>

            <div>
              <label className="sa-label">Razón Social (Opcional)</label>
              <input type="text" className="sa-input" value={razonSocial} onChange={e => setRazonSocial(e.target.value)} placeholder="Ej: Mi Mercado S.R.L." />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="sa-label">NIT</label>
                <input type="text" required className="sa-input" value={nitRut} onChange={e => setNitRut(e.target.value)} placeholder="Ej: 123456789" />
              </div>
              <div>
                <label className="sa-label">Dominio Asignado (.io)</label>
                <input type="text" required className="sa-input" value={dominioComercio} onChange={e => setDominioComercio(e.target.value)} placeholder="Ej: mimercado.io" />
              </div>
            </div>

            {/* Configuración Comercial & Prepago */}
            <div className="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-xl border border-gray-200 dark:border-gray-700 space-y-3">
              <h4 className="font-bold text-xs text-emerald-600 uppercase tracking-wider">Parámetros Comerciales & Facturación</h4>
              
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="sa-label">Categoría / Plan</label>
                  <select className="sa-input font-bold" value={planComercio} onChange={e => setPlanComercio(e.target.value as any)}>
                    <option value="regular">Regular</option>
                    <option value="premium">Premium (Acceso a Reportes y CRM)</option>
                  </select>
                </div>

                <div>
                  <label className="sa-label">Modalidad Comercial</label>
                  <select className="sa-input" value={modalidadPago} onChange={e => setModalidadPago(e.target.value as ModalidadPagoComercio)}>
                    <option value="PILOTO">Modo Piloto (Sin cobro)</option>
                    <option value="PREPAGO">Prepago (Mensualidad + Premios)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="sa-label">Emisión de Factura</label>
                  <select className="sa-input" value={recibeFactura ? 'SI' : 'NO'} onChange={e => setRecibeFactura(e.target.value === 'SI')}>
                    <option value="SI">Sí recibe Factura</option>
                    <option value="NO">No recibe Factura</option>
                  </select>
                </div>

                <div>
                  <label className="sa-label">Mensualidad (Bs)</label>
                  <input type="text" inputMode="decimal" className="sa-input" value={mensualidadBs} onChange={e => setMensualidadBs(e.target.value)} placeholder="Ej: 25.00 o 25,00" />
                  <span className="text-[10px] text-gray-400 block mt-0.5">Usa punto o coma</span>
                </div>

                <div>
                  <label className="sa-label">Costo x Premio (Bs)</label>
                  <input type="text" inputMode="decimal" className="sa-input" value={costoPorPremioBs} onChange={e => setCostoPorPremioBs(e.target.value)} placeholder="Ej: 1.25 o 1,25" />
                  <span className="text-[10px] text-gray-400 block mt-0.5">Usa punto o coma</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div>
                  <label className="sa-label">Costo x Código Promocional (Bs)</label>
                  <input type="text" inputMode="decimal" className="sa-input" value={costoPorCodigoComercio} onChange={e => setCostoPorCodigoComercio(e.target.value)} placeholder="Ej: 10.00 o 10,00" />
                  <span className="text-[10px] text-gray-400 block mt-0.5">Usa punto o coma</span>
                </div>
              </div>
            </div>

            {/* Identidad Visual */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="sa-label">Paleta de Colores</label>
                <select className="sa-input" value={paletteId} onChange={e => setPaletteId(e.target.value)}>
                  {COLOR_PALETTES.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="sa-label">Logo del Comercio</label>
                <input 
                  type="file" 
                  accept="image/*" 
                  className="sa-input text-xs" 
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      try {
                        const compressed = await optimizeImage(file, 200, 0.75);
                        setLogoBase64(compressed);
                      } catch (err) {
                        alert("Error al procesar el logo.");
                      }
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
            </div>

            <button type="submit" className="sa-btn-primary py-3">Registrar y Crear Comercio</button>
          </form>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 3. COMERCIOS EXISTENTES Y EDICIÓN (SEPARADO) */}
      {/* ========================================================================= */}
      {activeTab === 'COMERCIOS_EXISTENTES' && (
        <div className="sa-card space-y-6">
          <div className="flex flex-wrap justify-between items-center gap-4 border-b pb-3">
            <div>
              <h3 className="sa-subtitle mb-0">Comercios Registrados ({comercios.length})</h3>
              <p className="text-xs text-[var(--text-muted)]">Consulta, edita parámetros comerciales o bloquea el acceso de comercios.</p>
            </div>

            <div className="w-72">
              <input 
                type="text" 
                placeholder="🔍 Buscar por nombre o NIT..." 
                value={busquedaComercioExistente} 
                onChange={e => setBusquedaComercioExistente(e.target.value)}
                className="sa-input text-xs"
              />
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            {comercios
              .filter(c => 
                !busquedaComercioExistente || 
                c.nombre.toLowerCase().includes(busquedaComercioExistente.toLowerCase()) || 
                c.nit_rut.includes(busquedaComercioExistente)
              )
              .map(c => (
                <div key={c.id} className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/40 flex flex-col justify-between space-y-3">
                  <div className="flex items-center gap-3">
                    {c.logoUrl ? (
                      <img src={c.logoUrl} alt="Logo" className="w-12 h-12 object-contain rounded border bg-white flex-shrink-0" />
                    ) : (
                      <div className="w-12 h-12 bg-gray-200 dark:bg-gray-700 rounded flex items-center justify-center font-bold text-gray-400 text-sm flex-shrink-0">NB</div>
                    )}
                    <div className="min-w-0 flex-1">
                      <strong className="block truncate text-[var(--text-main)] text-base">
                        {c.nombre} 
                        <span className={`text-xs px-2 py-0.5 rounded ml-2 font-bold uppercase ${c.plan === 'premium' ? 'bg-purple-100 text-purple-800 border border-purple-300' : 'bg-gray-100 text-gray-700 border border-gray-200'}`}>
                          {c.plan === 'premium' ? '★ Premium' : 'Regular'}
                        </span>
                        {c.estado === 'bloqueado' && <span className="text-xs bg-red-500 text-white px-2 py-0.5 rounded ml-2 font-bold">BLOQUEADO</span>}
                      </strong>
                      <span className="text-xs text-[var(--text-muted)] block truncate mt-0.5">
                        Dominio: <span className="font-mono text-brand-primary">{c.dominio || '-'}</span> | NIT: {c.nit_rut} | Modalidad: <span className="font-bold uppercase text-emerald-600">{c.modalidadPago || 'PILOTO'}</span>
                      </span>
                    </div>
                  </div>

                  {editingComercio?.id === c.id ? (
                    <form onSubmit={handleGuardarEdicionComercio} className="border-t pt-3 space-y-3 bg-white dark:bg-gray-800 p-4 rounded-xl shadow-inner text-xs">
                      <h5 className="font-bold text-sm text-gray-800 dark:text-white">Editar Comercio</h5>
                      
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="sa-label">Nombre Comercial</label>
                          <input className="sa-input" value={editComercioNombre} onChange={e=>setEditComercioNombre(e.target.value)} required />
                        </div>
                        <div>
                          <label className="sa-label">Razón Social (Opcional)</label>
                          <input className="sa-input" value={editComercioRazonSocial} onChange={e=>setEditComercioRazonSocial(e.target.value)} />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="sa-label">Dominio Asignado (.io)</label>
                          <input className="sa-input" value={editComercioDominio} onChange={e=>setEditComercioDominio(e.target.value)} required />
                        </div>
                        <div>
                          <label className="sa-label">NIT</label>
                          <input className="sa-input" value={editComercioNit} onChange={e=>setEditComercioNit(e.target.value)} required />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="sa-label">Categoría / Plan del Comercio</label>
                          <select className="sa-input font-bold" value={editComercioPlan} onChange={e=>setEditComercioPlan(e.target.value as any)}>
                            <option value="regular">Regular</option>
                            <option value="premium">Premium</option>
                          </select>
                        </div>
                        <div>
                          <label className="sa-label">Modalidad Comercial</label>
                          <select className="sa-input" value={editModalidadPago} onChange={e=>setEditModalidadPago(e.target.value as any)}>
                            <option value="PILOTO">Piloto</option>
                            <option value="PREPAGO">Prepago</option>
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="sa-label">Emisión de Factura</label>
                          <select className="sa-input" value={editRecibeFactura ? 'SI' : 'NO'} onChange={e=>setEditRecibeFactura(e.target.value === 'SI')}>
                            <option value="SI">Sí recibe</option>
                            <option value="NO">No recibe</option>
                          </select>
                        </div>
                        <div>
                          <label className="sa-label">Mensualidad (Bs)</label>
                          <input type="text" inputMode="decimal" className="sa-input" value={editMensualidadBs} onChange={e=>setEditMensualidadBs(e.target.value)} />
                        </div>
                        <div>
                          <label className="sa-label">Costo x Premio (Bs)</label>
                          <input type="text" inputMode="decimal" className="sa-input" value={editCostoPorPremioBs} onChange={e=>setEditCostoPorPremioBs(e.target.value)} />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        <div>
                          <label className="sa-label">Costo x Código Prom. (Bs)</label>
                          <input type="text" inputMode="decimal" className="sa-input" value={editCostoPorCodigoComercio} onChange={e=>setEditCostoPorCodigoComercio(e.target.value)} />
                        </div>
                      </div>

                      <div className="space-y-2 pt-2">
                        <div className="flex gap-2 items-center">
                          <button type="submit" disabled={guardandoEditComercio} className="sa-btn-primary text-xs flex-1 cursor-pointer">
                            {guardandoEditComercio ? 'Guardando...' : 'Guardar Cambios'}
                          </button>
                          <button 
                            type="button" 
                            onClick={() => { 
                              setEditingComercio(null); 
                              setEditComercioMsg(null); 
                            }} 
                            className="sa-btn-secondary text-xs flex-1 cursor-pointer"
                          >
                            Cancelar
                          </button>
                        </div>

                        {/* Mensaje adyacente a los botones de acción */}
                        {editComercioMsg && (
                          <div className={`p-2.5 rounded-xl border text-xs font-bold animate-fade-in ${
                            editComercioMsg.tipo === 'success' ? 'bg-green-100 text-green-800 border-green-300' : 'bg-red-100 text-red-800 border-red-300'
                          }`}>
                            {editComercioMsg.texto}
                          </div>
                        )}
                      </div>
                    </form>
                  ) : (
                    <div className="flex flex-wrap gap-2 border-t pt-3">
                      <button onClick={() => { 
                        setEditingComercio(c); 
                        setEditComercioMsg(null);
                        setEditComercioNombre(c.nombre); 
                        setEditComercioRazonSocial(c.razonSocial || '');
                        setEditComercioDominio(c.dominio || ''); 
                        setEditComercioNit(c.nit_rut); 
                        setEditComercioPlan(c.plan || 'regular'); 
                        setEditModalidadPago(c.modalidadPago || 'PILOTO');
                        setEditMensualidadBs((c.mensualidadBs || 25).toString());
                        setEditCostoPorPremioBs((c.costoPorPremioBs || 1.25).toString());
                        setEditCostoPorCodigoComercio((c.costoPorCodigoComercio || 10.00).toString());
                        setEditRecibeFactura(c.recibeFactura ?? true);
                      }} className="text-xs bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-white font-bold px-3 py-1.5 rounded hover:bg-gray-300 transition cursor-pointer">
                        ✏️ Editar
                      </button>
                      <button onClick={() => handleToggleEstadoComercio(c)} className={`text-xs font-bold px-3 py-1.5 rounded transition cursor-pointer ${c.estado === 'bloqueado' ? 'bg-green-500 text-white' : 'bg-orange-500 text-white'}`}>
                        {c.estado === 'bloqueado' ? 'Desbloquear' : 'Bloquear'}
                      </button>
                    </div>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 4. GESTIÓN DE USUARIOS */}
      {/* ========================================================================= */}
      {activeTab === 'USUARIOS' && (
        <div className="grid md:grid-cols-2 gap-8">
          {/* Crear Usuarios */}
          <div className="sa-card">
            <h3 className="sa-subtitle">Crear Usuarios (Admins, Vendedores, Influencers y Contadores)</h3>
            {msgCard2 && (
              <div className={`p-3 rounded mb-4 text-xs font-bold ${msgCard2.tipo === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                {msgCard2.texto}
              </div>
            )}
            <form onSubmit={handleCrearUsuario} className="space-y-4 text-xs">
              <div>
                <label className="sa-label">Rol del Usuario</label>
                <select className="sa-input font-bold" value={rol} onChange={e => setRol(e.target.value as any)}>
                  <option value="vendedor">Vendedor de Tienda (PIN de 6 dígitos)</option>
                  <option value="admin_comercio">Administrador del Comercio</option>
                  <option value="influencer">Influencer (@hiinfluencer.io)</option>
                  <option value="contador">Contador del Sistema (@hipatia.io)</option>
                </select>
              </div>

              {rol !== 'influencer' && rol !== 'contador' && (
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

              <div>
                <label className="sa-label">Nombre Completo</label>
                <input type="text" required className="sa-input" value={nombreUsuario} onChange={e => setNombreUsuario(e.target.value)} placeholder="Ej: Carlos Mendoza" />
              </div>

              <div>
                <label className="sa-label">Identificador de Usuario (Login)</label>
                <div className="flex items-center gap-2">
                  <input 
                    type="text" 
                    required 
                    className="sa-input flex-1 font-mono" 
                    value={usuarioPrefix} 
                    onChange={e => setUsuarioPrefix(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))} 
                    placeholder={rol === 'influencer' ? 'ej: carlos' : rol === 'contador' ? 'ej: contabilidad' : 'ej: admin o caja1'} 
                  />
                  <span className="text-xs font-mono bg-gray-100 dark:bg-gray-800 p-2 rounded border text-gray-700 dark:text-gray-300 whitespace-nowrap">
                    {rol === 'influencer' ? '@hiinfluencer.io' : rol === 'contador' ? '@hipatia.io' : (comercioDominio ? `@${comercioDominio}` : '@dominio.io')}
                  </span>
                </div>
                {computedUsuarioSintetico() && (
                  <p className="text-xs text-brand-primary mt-1 font-semibold">
                    Login final: <span className="font-mono">{computedUsuarioSintetico()}</span>
                  </p>
                )}
              </div>

              {rol !== 'vendedor' && (
                <div>
                  <label className="sa-label">Correo Electrónico Real (Para Notificaciones / Notif. Cobros)</label>
                  <input 
                    type="email" 
                    required 
                    className="sa-input" 
                    value={emailReal} 
                    onChange={e => setEmailReal(e.target.value)} 
                    placeholder="ej: correo.personal@gmail.com" 
                  />
                </div>
              )}

              {rol === 'vendedor' && (
                <div>
                  <label className="sa-label">PIN de Acceso (6 dígitos numéricos)</label>
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
                </div>
              )}

              <div>
                <label className="sa-label">Teléfono (WhatsApp)</label>
                <div className="flex gap-2">
                  <select 
                    className="sa-input" 
                    style={{ width: '110px', flexShrink: 0 }} 
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

              {rol !== 'vendedor' && (
                <div>
                  <label className="sa-label">Contraseña de Acceso</label>
                  <div className="relative">
                    <input type={showPassword ? "text" : "password"} required minLength={6} className="sa-input" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••" />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 transform -translate-y-1/2 text-xs font-medium cursor-pointer">
                      {showPassword ? 'Ocultar' : 'Ver'}
                    </button>
                  </div>
                </div>
              )}

              {rol === 'influencer' && (
                <div>
                  <label className="sa-label">Prefijo de Código Único (Ej. NAT)</label>
                  <input type="text" maxLength={10} required className="sa-input uppercase font-mono font-bold" value={prefijoCodigo} onChange={e => setPrefijoCodigo(e.target.value)} placeholder="NAT" />
                  <p className="text-xs text-[var(--text-muted)] mt-1">Este prefijo identifica únicamente todas las campañas de este influencer.</p>
                </div>
              )}

              <button type="submit" className="sa-btn-secondary">Crear Usuario</button>
            </form>
          </div>

          {/* Listado de Usuarios Registrados */}
          <div className="sa-card space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="sa-subtitle mb-0">Usuarios en el Sistema ({globalUsers.length})</h3>
              <input 
                type="text" 
                placeholder="🔍 Filtrar usuarios..." 
                value={globalSearchTerm} 
                onChange={e => setGlobalSearchTerm(e.target.value)}
                className="sa-input text-xs"
                style={{ width: '180px' }}
              />
            </div>

            {msgCard5 && (
              <div className={`p-3 rounded mb-4 text-xs font-bold ${msgCard5.tipo === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                {msgCard5.texto}
              </div>
            )}

            <div className="overflow-x-auto max-h-[500px]">
              <table className="sa-table text-xs">
                <thead>
                  <tr>
                    <th>Usuario</th>
                    <th>Rol</th>
                    <th>Comercio</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {globalUsers
                    .filter(u => !globalSearchTerm || u.nombre?.toLowerCase().includes(globalSearchTerm.toLowerCase()) || u.email?.toLowerCase().includes(globalSearchTerm.toLowerCase()))
                    .map(u => (
                      <tr key={u.uid}>
                        <td>
                          <strong>{u.nombre}</strong>
                          <span className="text-[10px] text-gray-400 block font-mono">{u.email}</span>
                        </td>
                        <td>
                          <span className="sa-badge">{u.rol}</span>
                        </td>
                        <td>{comercios.find(c => c.id === u.comercioId)?.nombre || '-'}</td>
                        <td>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${u.estado === 'bloqueado' ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
                            {u.estado || 'activo'}
                          </span>
                        </td>
                        <td>
                          <div className="flex gap-1">
                            <button onClick={() => handleToggleEstadoUsuario(u)} className="text-[10px] bg-gray-200 px-2 py-1 rounded font-bold hover:bg-gray-300">
                              {u.estado === 'bloqueado' ? 'Activar' : 'Bloquear'}
                            </button>
                            <button onClick={() => handleBorrarUsuario(u)} className="text-[10px] bg-red-100 text-red-700 px-2 py-1 rounded font-bold hover:bg-red-200">
                              Eliminar
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 5. DIRECTORIO DE INFLUENCERS */}
      {/* ========================================================================= */}
      {activeTab === 'INFLUENCERS' && (
        <div className="sa-card space-y-4">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h3 className="sa-subtitle mb-0">Directorio y Gestión de Influencers (ABM)</h3>
              <p className="text-xs text-[var(--text-muted)]">Visualiza y administra todos los influencers creados, su prefijo oficial y alianzas.</p>
            </div>
            <span className="sa-badge bg-purple-100 text-purple-800 font-bold px-3 py-1">
              {globalUsers.filter(u => u.rol === 'influencer').length} Influencers Registrados
            </span>
          </div>

          {msgCard4 && (
            <div className={`p-3 rounded mb-4 text-xs font-bold ${msgCard4.tipo === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
              {msgCard4.texto}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="sa-table text-xs">
              <thead>
                <tr>
                  <th>Nombre / Prefijo</th>
                  <th>Contacto Real</th>
                  <th>Alianzas Activas</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {globalUsers.filter(u => u.rol === 'influencer').length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-4 text-gray-400">No hay influencers registrados.</td></tr>
                ) : (
                  globalUsers.filter(u => u.rol === 'influencer').map(inf => {
                    const asigsCount = allAsignaciones.filter(a => a.influencerId === inf.uid && a.estado === 'ACEPTADO').length;
                    return (
                      <tr key={inf.uid}>
                        <td>
                          <strong>{inf.nombre}</strong>
                          <span className="text-[10px] text-purple-700 block font-mono font-bold">Prefijo Oficial: {inf.prefijoCodigo || 'INF'}</span>
                        </td>
                        <td>
                          <div>{inf.emailReal || inf.email}</div>
                          <div className="text-gray-400">{inf.telefono || '-'}</div>
                        </td>
                        <td className="font-bold text-purple-700">{asigsCount} comercios</td>
                        <td>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${inf.estado === 'bloqueado' ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
                            {inf.estado || 'activo'}
                          </span>
                        </td>
                        <td>
                          <div className="flex gap-1.5">
                            <button onClick={() => {
                              setEditingInfluencer(inf);
                              setEditInfNombre(inf.nombre);
                              setEditInfEmailReal(inf.emailReal || '');
                              setEditInfTelefono(inf.telefono || '');
                              setEditInfPrefijo(inf.prefijoCodigo || '');
                            }} className="text-xs bg-blue-100 text-blue-800 font-bold px-2.5 py-1 rounded hover:bg-blue-200">
                              Editar
                            </button>
                            <button onClick={() => handleToggleEstadoUsuario(inf)} className="text-xs bg-gray-200 font-bold px-2.5 py-1 rounded hover:bg-gray-300">
                              {inf.estado === 'bloqueado' ? 'Activar' : 'Bloquear'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 6. SIMULADOR QR */}
      {/* ========================================================================= */}
      {activeTab === 'SIMULADOR' && (
        <div className="sa-card max-w-xl mx-auto space-y-4">
          <h3 className="sa-subtitle">Simulador de Códigos QR para Pruebas</h3>
          <p className="text-xs text-[var(--text-muted)]">Genera sesiones QR válidas para simular acumulaciones o canjes de clientes.</p>
          
          {msgCardSimulador && (
            <div className={`p-3 rounded mb-4 text-xs font-bold flex justify-between items-center ${msgCardSimulador.tipo === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
              <span>{msgCardSimulador.texto}</span>
              <button onClick={() => setMsgCardSimulador(null)} className="font-black text-sm ml-2">✕</button>
            </div>
          )}

          <form onSubmit={handleGenerarQRPrueba} className="space-y-4 text-xs">
            <div>
              <label className="sa-label">Comercio Objetivo</label>
              <select className="sa-input" value={qrSimComercioId} onChange={e => setQrSimComercioId(e.target.value)}>
                {comercios.map(c => (
                  <option key={c.id} value={c.id}>{c.nombre} ({c.id})</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="sa-label">Tipo de Sesión</label>
                <select className="sa-input" value={qrSimTipo} onChange={e => setQrSimTipo(e.target.value as any)}>
                  <option value="ACUMULACION">Acumular Puntos (Venta)</option>
                  <option value="CANJE">Canje de Premio</option>
                </select>
              </div>
              <div>
                <label className="sa-label">Monto de Factura (Bs)</label>
                <input type="number" className="sa-input" value={qrSimMonto} onChange={e => setQrSimMonto(e.target.value)} />
              </div>
            </div>

            <button type="submit" className="sa-btn-primary py-2.5">Generar Código de Prueba</button>
          </form>

          {qrSimCodeResult && (
            <div className="flex flex-col items-center justify-center p-6 bg-gray-50 dark:bg-gray-800/40 rounded-xl border border-gray-200 dark:border-gray-700 text-center space-y-2">
              <QRCodeSVG value={qrSimCodeResult} size={180} level="H" />
              <p className="text-xs font-bold text-gray-500 uppercase mt-2">CÓDIGO DE 6 DÍGITOS:</p>
              <div className="text-3xl font-mono font-black select-all tracking-widest text-emerald-600">{qrSimCodeResult}</div>
            </div>
          )}
        </div>
      )}

      {/* Modal de Comprobante / Conciliación */}
      {modalComprobante && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto text-xs">
            <div className="flex justify-between items-center border-b pb-2">
              <h3 className="text-base font-bold text-[var(--text-main)]">Detalle de Cobro & Comprobante</h3>
              <button onClick={() => setModalComprobante(null)} className="text-gray-400 font-black hover:text-black">✕</button>
            </div>

            <div className="space-y-2">
              <p><strong>Comercio:</strong> {modalComprobante.nombreComercio} (NIT: {modalComprobante.nitRut})</p>
              {modalComprobante.razonSocial && <p><strong>Razón Social:</strong> {modalComprobante.razonSocial}</p>}
              <p><strong>Monto Total Depositado:</strong> <span className="font-black text-green-700 text-sm">Bs. {modalComprobante.montoTotal.toFixed(2)}</span></p>
              <p><strong>Desglose Mensualidad:</strong> Bs. {modalComprobante.montoMensualidad.toFixed(2)} ({modalComprobante.mesesPagados.join(', ') || '0 meses'})</p>
              <p><strong>Desglose Premios:</strong> Bs. {modalComprobante.montoPremios.toFixed(2)} ({modalComprobante.cantidadPremiosEquivalentes} premios)</p>
              <p><strong>Código de Depósito:</strong> <span className="font-mono font-bold text-blue-600">{modalComprobante.codigoDeposito}</span></p>
              <p><strong>Registrado por:</strong> {modalComprobante.contadorAlias} ({new Date(modalComprobante.fechaHora).toLocaleString()})</p>
              <p><strong>Estado:</strong> {modalComprobante.estado}</p>
            </div>

            {modalComprobante.comprobanteUrl ? (
              <div className="border rounded p-2 bg-gray-50 dark:bg-gray-800 text-center">
                <p className="text-[10px] text-gray-500 mb-1">Comprobante Bancario Adjunto:</p>
                <img src={modalComprobante.comprobanteUrl} alt="Comprobante" className="max-h-72 mx-auto rounded shadow border" />
              </div>
            ) : (
              <p className="text-gray-400 italic">No se adjuntó comprobante fotográfico.</p>
            )}

            <div className="flex justify-end gap-2 pt-3 border-t">
              <button onClick={() => setModalComprobante(null)} className="px-3 py-1.5 bg-gray-200 text-gray-800 rounded font-bold cursor-pointer">Cerrar</button>
              {modalComprobante.estado !== 'VERIFICADO' && (
                <button onClick={() => handleConciliarDeposito(modalComprobante)} className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-bold cursor-pointer">
                  ✅ Verificar y Conciliar Depósito
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal para Editar Influencer (ABM) */}
      {editingInfluencer && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4 text-xs">
            <h3 className="text-sm font-bold text-[var(--text-main)]">Editar Datos del Influencer</h3>
            <form onSubmit={handleGuardarEdicionInfluencer} className="space-y-3">
              <div>
                <label className="sa-label">Nombre Completo</label>
                <input type="text" required className="sa-input" value={editInfNombre} onChange={e => setEditInfNombre(e.target.value)} />
              </div>
              <div>
                <label className="sa-label">Correo Electrónico Real</label>
                <input type="email" required className="sa-input" value={editInfEmailReal} onChange={e => setEditInfEmailReal(e.target.value)} />
              </div>
              <div>
                <label className="sa-label">Teléfono</label>
                <input type="tel" className="sa-input" value={editInfTelefono} onChange={e => setEditInfTelefono(e.target.value)} />
              </div>
              <div>
                <label className="sa-label">Prefijo de Código Único</label>
                <input type="text" maxLength={10} className="sa-input uppercase font-mono font-bold" value={editInfPrefijo} onChange={e => setEditInfPrefijo(e.target.value)} />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t">
                <button type="button" onClick={() => setEditingInfluencer(null)} className="px-3 py-1.5 bg-gray-200 text-gray-800 rounded font-bold cursor-pointer">Cancelar</button>
                <button type="submit" className="sa-btn-primary">Guardar</button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};

export default SuperAdminDashboard;
