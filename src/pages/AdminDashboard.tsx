import React, { useEffect, useState } from 'react';
import { doc, updateDoc, arrayUnion, arrayRemove, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { cargarComercioCompleto } from '../utils/comercios';
import { useAuth } from '../contexts/AuthContext';
import type { Comercio, ReglaPunto, Premio, ProductoCatalogo, CobroPrepago } from '../types';
import { CRMSection } from '../components/CRMSection';
import { AdminInfluencers } from '../components/AdminInfluencers';
import { AdminCodigosComercio } from '../components/AdminCodigosComercio';
import { checkComercioPrepagoStatus } from '../utils/reports';
import { optimizeImage } from '../utils/imageOptimizer';

const AdminDashboard: React.FC = () => {
  const { userData } = useAuth();
  const [comercio, setComercio] = useState<Comercio | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'config' | 'influencers' | 'prepago' | 'codigos'>('config');

  // Modals state
  const [showReglaModal, setShowReglaModal] = useState(false);
  const [showPremioModal, setShowPremioModal] = useState(false);
  const [showProductoModal, setShowProductoModal] = useState(false);

  // Form states
  const [nuevaRegla, setNuevaRegla] = useState<Partial<ReglaPunto>>({ tipo: 'POR_COMPRA', activa: true, puntosAOtorgar: 10 });
  const [nuevoPremio, setNuevoPremio] = useState<Partial<Premio>>({ activo: true, puntosRequeridos: 100 });
  const [nuevoProducto, setNuevoProducto] = useState<Partial<ProductoCatalogo>>({ activo: true, nombre: '' });
  const [productoFotoBase64, setProductoFotoBase64] = useState<string>('');

  // Prepago history
  const [cobrosComercio, setCobrosComercio] = useState<CobroPrepago[]>([]);

  const fetchComercio = async () => {
    if (userData?.comercioId) {
      try {
        // Vista combinada: el catálogo público más los montos de `comercios_privado`,
        // que este administrador sí puede leer para su propio comercio.
        const completo = await cargarComercioCompleto(userData.comercioId);
        if (completo) setComercio(completo);

        // Cargar cobros registrados para este comercio
        const qCobros = query(collection(db, 'cobros_prepago'), where('comercioId', '==', userData.comercioId));
        const snapCobros = await getDocs(qCobros);
        const list: CobroPrepago[] = [];
        snapCobros.forEach(d => list.push(d.data() as CobroPrepago));
        list.sort((a, b) => b.fechaHora - a.fechaHora);
        setCobrosComercio(list);

      } catch (error) {
        console.error("Error fetching comercio:", error);
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchComercio();
  }, [userData]);

  const handleEliminarRegla = async (regla: ReglaPunto) => {
    if (!comercio || !userData?.comercioId) return;
    if (window.confirm('¿Seguro que deseas eliminar esta regla?')) {
      try {
        const docRef = doc(db, 'comercios', userData.comercioId);
        await updateDoc(docRef, { reglas: arrayRemove(regla) });
        fetchComercio();
      } catch (err) {
        console.error(err);
        alert('Error al eliminar regla');
      }
    }
  };

  const handleToggleRegla = async (regla: ReglaPunto) => {
    if (!comercio || !userData?.comercioId) return;
    try {
      const docRef = doc(db, 'comercios', userData.comercioId);
      const nuevasReglas = comercio.reglas.map(r => 
        r.id === regla.id ? { ...r, activa: !r.activa } : r
      );
      await updateDoc(docRef, { reglas: nuevasReglas });
      fetchComercio();
    } catch (err) {
      console.error(err);
      alert('Error al cambiar estado de la regla');
    }
  };

  const handleEliminarPremio = async (premio: Premio) => {
    if (!comercio || !userData?.comercioId) return;
    if (window.confirm('¿Seguro que deseas eliminar este premio?')) {
      try {
        const docRef = doc(db, 'comercios', userData.comercioId);
        await updateDoc(docRef, { premios: arrayRemove(premio) });
        fetchComercio();
      } catch (err) {
        console.error(err);
        alert('Error al eliminar premio');
      }
    }
  };

  const handleToggleProducto = async (producto: ProductoCatalogo) => {
    if (!comercio || !userData?.comercioId) return;
    try {
      const docRef = doc(db, 'comercios', userData.comercioId);
      const nuevosProductos = (comercio.productos || []).map(p => 
        p.id === producto.id ? { ...p, activo: !p.activo } : p
      );
      await updateDoc(docRef, { productos: nuevosProductos });
      fetchComercio();
    } catch (err) {
      console.error(err);
      alert('Error al cambiar estado del producto');
    }
  };

  const handleEliminarProducto = async (producto: ProductoCatalogo) => {
    if (!comercio || !userData?.comercioId) return;
    if (window.confirm('¿Seguro que deseas eliminar este producto?')) {
      try {
        const docRef = doc(db, 'comercios', userData.comercioId);
        await updateDoc(docRef, { productos: arrayRemove(producto) });
        fetchComercio();
      } catch (err) {
        console.error(err);
        alert('Error al eliminar producto');
      }
    }
  };

  const handleCrearRegla = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!comercio || !userData?.comercioId) return;

    let nombreProd = '';
    let fotoProd = '';
    if (nuevaRegla.tipo === 'POR_PRODUCTO' && nuevaRegla.productoId) {
      const prod = comercio.productos?.find(p => p.id === nuevaRegla.productoId);
      if (prod) {
        nombreProd = prod.nombre;
        fotoProd = prod.imagenUrl || '';
      }
    }

    if (nuevaRegla.tipo === 'POR_RANGO') {
      const desde = Number(nuevaRegla.rangoDesde);
      const hasta = Number(nuevaRegla.rangoHasta);
      
      if (isNaN(desde) || isNaN(hasta) || desde < 0 || hasta <= 0) {
        alert("Por favor ingresa montos válidos mayores o iguales a 0.");
        return;
      }

      if (desde >= hasta) {
        alert("El monto 'Desde' ($" + desde + ") debe ser estrictamente menor al monto 'Hasta' ($" + hasta + ").");
        return;
      }

      // Validar si existe solapamiento con otra regla activa por rango
      const solapa = (comercio.reglas || []).some(r => {
        if (!r.activa || r.tipo !== 'POR_RANGO' || r.rangoDesde === undefined || r.rangoHasta === undefined) return false;
        // Solapamiento: (desde < r.rangoHasta) && (hasta > r.rangoDesde)
        return (desde < r.rangoHasta && hasta > r.rangoDesde);
      });

      if (solapa) {
        alert("El rango de montos ($" + desde + " - $" + hasta + ") se solapa con otra regla por rango ya activa.");
        return;
      }
    }

    const reglaFinal: ReglaPunto = {
      id: `regla_${Date.now()}`,
      tipo: nuevaRegla.tipo as any,
      activa: true,
      ...(nuevaRegla.tipo === 'POR_COMPRA' ? { puntosAOtorgar: Number(nuevaRegla.puntosAOtorgar) || 0 } : {}),
      ...(nuevaRegla.tipo === 'POR_PRODUCTO' ? { 
          productoId: nuevaRegla.productoId || '',
          nombreProducto: nombreProd,
          imagenUrl: fotoProd,
          puntosAOtorgar: Number(nuevaRegla.puntosAOtorgar) || 0 
      } : {}),
      ...(nuevaRegla.tipo === 'POR_RANGO' ? {
          rangoDesde: Number(nuevaRegla.rangoDesde) || 0,
          rangoHasta: Number(nuevaRegla.rangoHasta) || 0,
          puntosAOtorgar: Number(nuevaRegla.puntosAOtorgar) || 0
      } : {}),
      ...(nuevaRegla.tipo === 'POR_REGISTRO' ? { puntosAOtorgar: Number(nuevaRegla.puntosAOtorgar) || 0 } : {})
    };

    try {
      const docRef = doc(db, 'comercios', userData.comercioId);
      await updateDoc(docRef, {
        reglas: arrayUnion(reglaFinal)
      });
      setShowReglaModal(false);
      setNuevaRegla({ tipo: 'POR_COMPRA', activa: true, puntosAOtorgar: 10 });
      fetchComercio();
    } catch (err) {
      console.error(err);
      alert('Error al crear regla');
    }
  };

  const handleCrearPremio = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!comercio || !userData?.comercioId) return;

    const premioFinal: Premio = {
      id: `premio_${Date.now()}`,
      nombre: nuevoPremio.nombre || 'Nuevo Premio',
      descripcion: nuevoPremio.descripcion || '',
      puntosRequeridos: Number(nuevoPremio.puntosRequeridos) || 0,
      activo: true
    };

    try {
      const docRef = doc(db, 'comercios', userData.comercioId);
      await updateDoc(docRef, {
        premios: arrayUnion(premioFinal)
      });
      setShowPremioModal(false);
      setNuevoPremio({ activo: true, puntosRequeridos: 100 });
      fetchComercio();
    } catch (err) {
      console.error(err);
      alert('Error al crear premio');
    }
  };

  const handleCrearProducto = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!comercio || !userData?.comercioId) return;

    const productoFinal: ProductoCatalogo = {
      id: `prod_${Date.now()}`,
      nombre: nuevoProducto.nombre || 'Nuevo Producto',
      imagenUrl: productoFotoBase64 || undefined,
      activo: true
    };

    try {
      const docRef = doc(db, 'comercios', userData.comercioId);
      await updateDoc(docRef, {
        productos: arrayUnion(productoFinal)
      });
      setShowProductoModal(false);
      setNuevoProducto({ activo: true, nombre: '' });
      setProductoFotoBase64('');
      fetchComercio();
    } catch (err) {
      console.error(err);
      alert('Error al crear producto');
    }
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Cargando panel del comercio...</div>;
  if (!comercio) return <div className="p-8 text-center text-red-500">No se encontró información del comercio.</div>;

  const prepagoStatus = checkComercioPrepagoStatus(comercio);
  const productosCatalog = comercio.productos || [];

  const reglasOrdenadas = [...comercio.reglas].sort((a, b) => {
    const order = { 'POR_COMPRA': 1, 'POR_PRODUCTO': 2, 'POR_RANGO': 3, 'POR_REGISTRO': 4 };
    const aOrder = order[a.tipo] || 99;
    const bOrder = order[b.tipo] || 99;
    
    if (aOrder !== bOrder) {
      return aOrder - bOrder;
    }
    if (a.tipo === 'POR_PRODUCTO' && b.tipo === 'POR_PRODUCTO') {
      return (a.nombreProducto || '').localeCompare(b.nombreProducto || '');
    }
    return 0;
  });

  return (
    <div className="w-full max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
      
      {/* Banner de Alerta de Prepago (Amarilla o Roja) */}
      {comercio.modalidadPago === 'PREPAGO' && (
        <>
          {prepagoStatus.alertaRojaMensualidad && (
            <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-xl shadow-sm text-red-800 flex items-center justify-between">
              <div>
                <strong className="font-black text-sm block">⚠️ Servicio Deshabilitado por Falta de Prepago</strong>
                <span className="text-xs">La mensualidad correspondiente a este mes no ha sido prepagada. Contacta a administración para reactivar la plataforma.</span>
              </div>
            </div>
          )}

          {prepagoStatus.alertaAmarillaMensualidad && !prepagoStatus.alertaRojaMensualidad && (
            <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-xl shadow-sm text-amber-900 flex items-center justify-between">
              <div>
                <strong className="font-black text-sm block">⏳ Aviso Preventivo: Mensualidad por Vencer</strong>
                <span className="text-xs">Tu prepago mensual vence en {prepagoStatus.diasRestantesMes} días. Recuerda realizar tu depósito con anticipación.</span>
              </div>
            </div>
          )}

          {prepagoStatus.alertaAmarillaPremios && (
            <div className="bg-purple-50 border-l-4 border-purple-500 p-4 rounded-xl shadow-sm text-purple-900 flex items-center justify-between">
              <div>
                <strong className="font-black text-sm block">🎁 Saldo Bajo de Premios</strong>
                <span className="text-xs">Te quedan solo {prepagoStatus.premiosDisponibles} premios disponibles. Recarga saldo de premios para asegurar los canjes de tus clientes.</span>
              </div>
            </div>
          )}
        </>
      )}

      {/* Header Comercio & Tabs */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-wrap justify-between items-center gap-4">
        <div>
          <h2 className="text-2xl font-black text-gray-800 dark:text-white mb-1">Comercio: {comercio.nombre}</h2>
          <p className="text-gray-500 text-xs">NIT/RUT: {comercio.nit_rut} {comercio.razonSocial ? `| Razón Social: ${comercio.razonSocial}` : ''}</p>
        </div>
        <div className="flex flex-wrap gap-2 bg-gray-100 dark:bg-gray-700 p-1 rounded-xl text-xs font-bold">
          <button 
            onClick={() => setActiveTab('config')} 
            className={`px-4 py-2 rounded-lg transition-colors cursor-pointer ${activeTab === 'config' ? 'bg-white dark:bg-gray-800 shadow text-brand-primary' : 'text-gray-500 hover:text-gray-700 dark:text-gray-300'}`}
          >
            Configuración & CRM
          </button>
          <button 
            onClick={() => setActiveTab('influencers')} 
            className={`px-4 py-2 rounded-lg transition-colors cursor-pointer ${activeTab === 'influencers' ? 'bg-white dark:bg-gray-800 shadow text-purple-600' : 'text-gray-500 hover:text-gray-700 dark:text-gray-300'}`}
          >
            Alianzas Influencers
          </button>
          <button 
            onClick={() => setActiveTab('codigos')} 
            className={`px-4 py-2 rounded-lg transition-colors cursor-pointer ${activeTab === 'codigos' ? 'bg-white dark:bg-gray-800 shadow text-blue-600' : 'text-gray-500 hover:text-gray-700 dark:text-gray-300'}`}
          >
            Códigos Promocionales
          </button>
          <button 
            onClick={() => setActiveTab('prepago')} 
            className={`px-4 py-2 rounded-lg transition-colors cursor-pointer ${activeTab === 'prepago' ? 'bg-white dark:bg-gray-800 shadow text-emerald-600' : 'text-gray-500 hover:text-gray-700 dark:text-gray-300'}`}
          >
            💳 Estado de Cuenta & Prepago
          </button>
        </div>
      </div>

      {activeTab === 'influencers' && (
        <AdminInfluencers comercio={comercio} />
      )}

      {activeTab === 'codigos' && (
        <AdminCodigosComercio comercio={comercio} />
      )}

      {activeTab === 'prepago' && (
        <div className="space-y-6">
          {/* Tarjetas Estado Prepago */}
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">Modalidad</span>
              <p className="text-xl font-black text-gray-800 mt-1 uppercase text-purple-700">{comercio.modalidadPago || 'PILOTO'}</p>
              <span className="text-[11px] text-gray-400">Tarifa: Bs. {(comercio.mensualidadBs || 25).toFixed(2)} / mes</span>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">Estado Mensualidad</span>
              <p className={`text-xl font-black mt-1 ${prepagoStatus.puedeOperar ? 'text-green-600' : 'text-red-600'}`}>
                {prepagoStatus.puedeOperar ? 'Al Día' : 'Impago'}
              </p>
              <span className="text-[11px] text-gray-400">
                {comercio.mesesPagados && comercio.mesesPagados.length > 0 ? `Pagado: ${comercio.mesesPagados.join(', ')}` : 'Sin meses prepagados'}
              </span>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">Fondo de Premios</span>
              <p className="text-xl font-black text-emerald-600 mt-1">Bs. {(comercio.saldoPremiosBs || 0).toFixed(2)}</p>
              <span className="text-[11px] text-gray-400">Equivale a <strong>{prepagoStatus.premiosDisponibles}</strong> premios</span>
            </div>
          </div>

          {/* Historial de Cobros y Depósitos Registrados */}
          <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
            <h3 className="text-base font-bold text-gray-800 border-b pb-3">Historial de Depósitos y Prepagos Registrados ({cobrosComercio.length})</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 text-gray-500 font-bold uppercase">
                  <tr>
                    <th className="px-4 py-3">Fecha / Hora</th>
                    <th className="px-4 py-3">Monto Total</th>
                    <th className="px-4 py-3">Meses Cubiertos</th>
                    <th className="px-4 py-3">Monto Premios</th>
                    <th className="px-4 py-3">N° Depósito</th>
                    <th className="px-4 py-3">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {cobrosComercio.length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-6 text-gray-400">No hay pagos registrados para este comercio aún.</td></tr>
                  ) : (
                    cobrosComercio.map(cob => (
                      <tr key={cob.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">{new Date(cob.fechaHora).toLocaleString()}</td>
                        <td className="px-4 py-3 font-black text-green-700">Bs. {cob.montoTotal.toFixed(2)}</td>
                        <td className="px-4 py-3">{cob.mesesPagados.join(', ') || '0 meses'}</td>
                        <td className="px-4 py-3">Bs. {cob.montoPremios.toFixed(2)} ({cob.cantidadPremiosEquivalentes} pts)</td>
                        <td className="px-4 py-3 font-mono font-bold text-blue-600">{cob.codigoDeposito}</td>
                        <td className="px-4 py-3">
                          {cob.estado === 'VERIFICADO' ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-800">VERIFICADO</span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">PENDIENTE</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'config' && (
        <>
          {/* Mini CRM Section (Top 3 Vendedores & Top 3 Influencers) */}
          <CRMSection comercioId={comercio.id} />

          <div className="grid lg:grid-cols-3 md:grid-cols-2 gap-6">
            {/* Reglas de Puntos */}
            <div className="bg-blue-50 p-6 rounded-2xl shadow-sm border border-blue-100 space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-bold text-blue-900">Reglas de Asignación</h3>
                <button onClick={() => setShowReglaModal(true)} className="text-xs bg-blue-600 text-white font-bold px-3 py-1.5 rounded-lg hover:bg-blue-700 transition cursor-pointer">+ Nueva Regla</button>
              </div>
              {reglasOrdenadas.length === 0 ? (
                <p className="text-gray-400 text-xs text-center py-4">No hay reglas configuradas.</p>
              ) : (
                <ul className="space-y-2.5">
                  {reglasOrdenadas.map(regla => (
                    <li key={regla.id} className="bg-white p-3 rounded-xl shadow-sm flex flex-col border border-gray-100 relative text-xs">
                      <div className="absolute top-2 right-2 flex items-center gap-1.5">
                        <button 
                          onClick={() => handleToggleRegla(regla)} 
                          className={`text-[10px] px-2 py-0.5 rounded font-bold ${regla.activa ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}
                        >
                          {regla.activa ? 'Activa' : 'Inactiva'}
                        </button>
                        <button onClick={() => handleEliminarRegla(regla)} className="text-red-500 hover:text-red-700 text-xs font-bold">✕</button>
                      </div>
                      <span className={`font-bold pr-20 ${regla.activa ? 'text-gray-800' : 'text-gray-400'}`}>
                        {regla.tipo === 'POR_COMPRA' && 'Regla General por Compra'}
                        {regla.tipo === 'POR_PRODUCTO' && `Producto Especial: ${regla.nombreProducto}`}
                        {regla.tipo === 'POR_RANGO' && `Rango: $${regla.rangoDesde} a $${regla.rangoHasta}`}
                        {regla.tipo === 'POR_REGISTRO' && 'Bono de Bienvenida / Registro'}
                      </span>
                      <div className="text-gray-500 mt-1">
                        Otorga: <strong className="text-blue-600">{regla.puntosAOtorgar} pts</strong>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Catálogo de Productos Especiales */}
            <div className="bg-purple-50 p-6 rounded-2xl shadow-sm border border-purple-100 space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-bold text-purple-900">Productos Especiales</h3>
                <button onClick={() => setShowProductoModal(true)} className="text-xs bg-purple-600 text-white font-bold px-3 py-1.5 rounded-lg hover:bg-purple-700 transition cursor-pointer">+ Nuevo Producto</button>
              </div>
              {productosCatalog.length === 0 ? (
                <p className="text-gray-400 text-xs text-center py-4">No hay productos en el catálogo.</p>
              ) : (
                <ul className="space-y-2.5">
                  {productosCatalog.map(prod => (
                    <li key={prod.id} className="bg-white p-3 rounded-xl shadow-sm flex items-center justify-between border border-gray-100 text-xs">
                      <div className="flex items-center gap-3">
                        {prod.imagenUrl ? (
                          <img src={prod.imagenUrl} alt="Foto" className="w-10 h-10 object-cover rounded-lg border" />
                        ) : (
                          <div className="w-10 h-10 bg-purple-100 text-purple-700 rounded-lg flex items-center justify-center font-bold text-xs">📦</div>
                        )}
                        <span className={`font-bold ${prod.activo ? 'text-gray-800' : 'text-gray-400'}`}>{prod.nombre}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button 
                          onClick={() => handleToggleProducto(prod)} 
                          className={`text-[10px] px-2 py-0.5 rounded font-bold ${prod.activo ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}
                        >
                          {prod.activo ? 'Activo' : 'Inactivo'}
                        </button>
                        <button onClick={() => handleEliminarProducto(prod)} className="text-red-500 hover:text-red-700 text-xs font-bold">✕</button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Premios Disponibles */}
            <div className="bg-amber-50 p-6 rounded-2xl shadow-sm border border-amber-100 space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-bold text-amber-900">Premios de Canje</h3>
                <button onClick={() => setShowPremioModal(true)} className="text-xs bg-amber-600 text-white font-bold px-3 py-1.5 rounded-lg hover:bg-amber-700 transition cursor-pointer">+ Nuevo Premio</button>
              </div>
              {comercio.premios.length === 0 ? (
                <p className="text-gray-400 text-xs text-center py-4">No hay premios configurados.</p>
              ) : (
                <ul className="space-y-2.5">
                  {comercio.premios.map(premio => (
                    <li key={premio.id} className="bg-white p-3 rounded-xl shadow-sm flex flex-col border border-gray-100 relative text-xs">
                      <button onClick={() => handleEliminarPremio(premio)} className="absolute top-2 right-2 text-red-500 hover:text-red-700 font-bold">✕</button>
                      <strong className="text-gray-800 text-sm">{premio.nombre}</strong>
                      <span className="text-gray-500 text-[11px] mt-0.5">{premio.descripcion}</span>
                      <span className="font-bold text-amber-600 mt-1">{premio.puntosRequeridos} pts requeridos</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

          </div>
        </>
      )}

      {/* Modal Regla */}
      {showReglaModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md space-y-4 text-xs">
            <h3 className="text-base font-bold text-gray-800">Nueva Regla de Puntos</h3>
            <form onSubmit={handleCrearRegla} className="space-y-3">
              <div>
                <label className="block font-bold text-gray-700 mb-1">Tipo de Regla</label>
                <select 
                  className="w-full border rounded-lg px-3 py-2 bg-white font-semibold"
                  value={nuevaRegla.tipo} 
                  onChange={(e) => setNuevaRegla({...nuevaRegla, tipo: e.target.value as any})}
                >
                  <option value="POR_COMPRA">Por Compra General</option>
                  <option value="POR_PRODUCTO">Por Producto Especial</option>
                  <option value="POR_RANGO">Por Rango de Monto</option>
                  <option value="POR_REGISTRO">Bono de Bienvenida / Registro</option>
                </select>
              </div>

              {nuevaRegla.tipo === 'POR_PRODUCTO' && (
                <div>
                  <label className="block font-bold text-gray-700 mb-1">Seleccionar Producto</label>
                  <select 
                    className="w-full border rounded-lg px-3 py-2 bg-white"
                    value={nuevaRegla.productoId || ''}
                    onChange={(e) => setNuevaRegla({...nuevaRegla, productoId: e.target.value})}
                    required
                  >
                    <option value="">-- Elige un producto --</option>
                    {productosCatalog.filter(p => p.activo).map(p => (
                      <option key={p.id} value={p.id}>{p.nombre}</option>
                    ))}
                  </select>
                </div>
              )}

              {nuevaRegla.tipo === 'POR_RANGO' && (
                <div className="space-y-2 bg-blue-50/60 p-3 rounded-xl border border-blue-100">
                  <span className="text-[11px] font-extrabold text-blue-800 uppercase tracking-wide block">Rango de Monto de Compra ($)</span>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block font-bold text-gray-700 mb-1 text-[11px]">Monto Desde ($)</label>
                      <input 
                        type="number" 
                        required 
                        min="0" 
                        step="0.01" 
                        placeholder="Ej: 50" 
                        className="w-full border rounded-lg px-3 py-2 bg-white font-bold" 
                        value={nuevaRegla.rangoDesde !== undefined ? nuevaRegla.rangoDesde : ''} 
                        onChange={(e) => setNuevaRegla({...nuevaRegla, rangoDesde: parseFloat(e.target.value) || 0})} 
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-gray-700 mb-1 text-[11px]">Monto Hasta ($)</label>
                      <input 
                        type="number" 
                        required 
                        min="0" 
                        step="0.01" 
                        placeholder="Ej: 200" 
                        className="w-full border rounded-lg px-3 py-2 bg-white font-bold" 
                        value={nuevaRegla.rangoHasta !== undefined ? nuevaRegla.rangoHasta : ''} 
                        onChange={(e) => setNuevaRegla({...nuevaRegla, rangoHasta: parseFloat(e.target.value) || 0})} 
                      />
                    </div>
                  </div>
                  <span className="text-[10px] text-blue-600 block">El monto 'Desde' debe ser estrictamente menor al monto 'Hasta'.</span>
                </div>
              )}

              <div>
                <label className="block font-bold text-gray-700 mb-1">Puntos a Otorgar</label>
                <input type="number" required min="1" className="w-full border rounded-lg px-3 py-2 font-bold text-blue-600" value={nuevaRegla.puntosAOtorgar || ''} onChange={(e) => setNuevaRegla({...nuevaRegla, puntosAOtorgar: Number(e.target.value)})} />
              </div>

              <div className="flex gap-2 justify-end pt-3 border-t">
                <button type="button" onClick={() => setShowReglaModal(false)} className="px-3 py-1.5 bg-gray-100 rounded-lg text-gray-700 font-bold">Cancelar</button>
                <button type="submit" className="px-4 py-1.5 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700">Guardar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Producto con Foto Optimizada */}
      {showProductoModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md space-y-4 text-xs">
            <h3 className="text-base font-bold text-gray-800">Nuevo Producto Especial</h3>
            <form onSubmit={handleCrearProducto} className="space-y-3">
              <div>
                <label className="block font-bold text-gray-700 mb-1">Nombre del Producto</label>
                <input type="text" required placeholder="Ej: Pizza Suprema Grande" className="w-full border rounded-lg px-3 py-2" value={nuevoProducto.nombre || ''} onChange={(e) => setNuevoProducto({...nuevoProducto, nombre: e.target.value})} />
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">Fotografía del Producto (Opcional - Optimizada)</label>
                <input 
                  type="file" 
                  accept="image/*"
                  className="w-full text-xs text-gray-500 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      try {
                        const compressed = await optimizeImage(file, 300, 0.75);
                        setProductoFotoBase64(compressed);
                      } catch (err) {
                        alert("Error al comprimir la foto");
                      }
                    }
                  }}
                />
              </div>

              {productoFotoBase64 && (
                <div className="flex items-center gap-3 p-2 bg-gray-50 rounded-lg border">
                  <img src={productoFotoBase64} alt="Preview" className="w-12 h-12 object-cover rounded-lg border" />
                  <span className="text-[11px] text-gray-500">Fotografía lista y optimizada (&lt;30KB)</span>
                </div>
              )}

              <div className="flex gap-2 justify-end pt-3 border-t">
                <button type="button" onClick={() => setShowProductoModal(false)} className="px-3 py-1.5 bg-gray-100 rounded-lg text-gray-700 font-bold">Cancelar</button>
                <button type="submit" className="px-4 py-1.5 bg-purple-600 text-white font-bold rounded-lg hover:bg-purple-700">Guardar Producto</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Premio */}
      {showPremioModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md space-y-4 text-xs">
            <h3 className="text-base font-bold text-gray-800">Nuevo Premio</h3>
            <form onSubmit={handleCrearPremio} className="space-y-3">
              <div>
                <label className="block font-bold text-gray-700 mb-1">Nombre del Premio</label>
                <input type="text" required placeholder="Ej: Vale de $50 en consumo" className="w-full border rounded-lg px-3 py-2" value={nuevoPremio.nombre || ''} onChange={(e) => setNuevoPremio({...nuevoPremio, nombre: e.target.value})} />
              </div>
              <div>
                <label className="block font-bold text-gray-700 mb-1">Descripción</label>
                <input type="text" required placeholder="Breve descripción del premio" className="w-full border rounded-lg px-3 py-2" value={nuevoPremio.descripcion || ''} onChange={(e) => setNuevoPremio({...nuevoPremio, descripcion: e.target.value})} />
              </div>
              <div>
                <label className="block font-bold text-gray-700 mb-1">Puntos Requeridos</label>
                <input type="number" required min="1" className="w-full border rounded-lg px-3 py-2 font-bold text-amber-600" value={nuevoPremio.puntosRequeridos || ''} onChange={(e) => setNuevoPremio({...nuevoPremio, puntosRequeridos: Number(e.target.value)})} />
              </div>

              <div className="flex gap-2 justify-end pt-3 border-t">
                <button type="button" onClick={() => setShowPremioModal(false)} className="px-3 py-1.5 bg-gray-100 rounded-lg text-gray-700 font-bold">Cancelar</button>
                <button type="submit" className="px-4 py-1.5 bg-amber-600 text-white font-bold rounded-lg hover:bg-amber-700">Guardar Premio</button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};

export default AdminDashboard;
