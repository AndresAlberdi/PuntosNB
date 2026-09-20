import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { QRCodeSVG } from 'qrcode.react';
import { db } from '../firebase';
import { invocar, mensajeDeError } from '../utils/backend';
import { useAuth } from '../contexts/useAuth';
import type { AsignacionInfluencer, CodigoInfluencer, Comercio, Transaccion } from '../types';

export const InfluencerDashboard: React.FC = () => {
  const { userData } = useAuth();
  const [asignaciones, setAsignaciones] = useState<AsignacionInfluencer[]>([]);
  const [codigos, setCodigos] = useState<CodigoInfluencer[]>([]);
  const [todosComercios, setTodosComercios] = useState<Comercio[]>([]);
  const [comerciosMap, setComerciosMap] = useState<Record<string, Comercio>>({});
  const [transaccionesInfluencer, setTransaccionesInfluencer] = useState<Transaccion[]>([]);
  const [loading, setLoading] = useState(true);

  // State for proposing to a new commerce
  const [selectedComercioAInvitar, setSelectedComercioAInvitar] = useState('');
  const [modalQR, setModalQR] = useState<{ codigo: string; nombreComercio: string; logoUrl?: string } | null>(null);

  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

  const fetchData = async () => {
    if (!userData) return;
    try {
      // 1. Comercios
      const snapComercios = await getDocs(collection(db, 'comercios'));
      const comerciosList: Comercio[] = [];
      const map: Record<string, Comercio> = {};
      snapComercios.forEach(d => {
        const c = d.data() as Comercio;
        comerciosList.push(c);
        map[c.id] = c;
      });
      setTodosComercios(comerciosList);
      setComerciosMap(map);

      // 2. Asignaciones
      const qAsign = query(collection(db, 'asignaciones_influencer'), where('influencerId', '==', userData.uid));
      const snapAsign = await getDocs(qAsign);
      const asigs: AsignacionInfluencer[] = [];
      snapAsign.forEach(d => asigs.push(d.data() as AsignacionInfluencer));
      setAsignaciones(asigs);

      // 3. Códigos
      const qCodigos = query(collection(db, 'codigos_influencer'), where('influencerId', '==', userData.uid));
      const snapCodigos = await getDocs(qCodigos);
      const cods: CodigoInfluencer[] = [];
      snapCodigos.forEach(d => cods.push(d.data() as CodigoInfluencer));
      setCodigos(cods);

      // 4. Transacciones de este influencer
      const qTxs = query(collection(db, 'transacciones'), where('vendedorId', '==', userData.uid));
      const snapTxs = await getDocs(qTxs);
      const txList: Transaccion[] = [];
      snapTxs.forEach(d => txList.push(d.data() as Transaccion));
      setTransaccionesInfluencer(txList);

    } catch (err) {
      console.error("Error fetching influencer data:", err);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [userData]);

  // Enviar propuesta de colaboración a un comercio
  const handleEnviarPropuestaAComercio = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedComercioAInvitar || !userData) return;

    const existing = asignaciones.find(a => a.comercioId === selectedComercioAInvitar);
    if (existing && existing.estado !== 'RECHAZADO') {
      alert("Ya tienes una propuesta o alianza activa con este comercio.");
      return;
    }

    try {
      await invocar('gestionarAsignacionInfluencer', {
        accion: 'proponer',
        comercioId: selectedComercioAInvitar,
        influencerId: userData.uid,
      });
      alert("Propuesta de colaboración enviada al comercio exitosamente.");
      setSelectedComercioAInvitar('');
      fetchData();
    } catch (err) {
      console.error(err);
      alert(mensajeDeError(err));
    }
  };

  // Modal para Crear/Editar Código de Campaña
  const [modalConfigCodigo, setModalConfigCodigo] = useState<{
    asig: AsignacionInfluencer;
    sufijo: string;
    puntosSeguidor: number;
    codigoExistenteId?: string;
  } | null>(null);

  const abrirModalCodigo = (asig: AsignacionInfluencer) => {
    const comercioNombre = comerciosMap[asig.comercioId]?.nombre || 'COMERCIO';
    const cleanComercioName = comercioNombre.replace(/\s+/g, '').toUpperCase().substring(0, 5);
    const prefijo = userData?.prefijoCodigo ? userData.prefijoCodigo.trim().toUpperCase() : 'INF';
    
    const codigoExistente = codigos.find(c => c.comercioId === asig.comercioId);
    let sufijoInicial = cleanComercioName;
    if (codigoExistente && codigoExistente.id.startsWith(prefijo)) {
      sufijoInicial = codigoExistente.id.substring(prefijo.length);
    }

    setModalConfigCodigo({
      asig,
      sufijo: sufijoInicial,
      puntosSeguidor: codigoExistente?.puntosPorCanje || asig.ratio?.cliente || 10,
      codigoExistenteId: codigoExistente?.id
    });
  };

  const handleGuardarCodigoModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalConfigCodigo || !userData) return;

    try {
      const prefijo = userData.prefijoCodigo ? userData.prefijoCodigo.trim().toUpperCase() : 'INF';
      const cleanSufijo = modalConfigCodigo.sufijo.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!cleanSufijo) {
        alert("Debes ingresar un nombre o sufijo para tu código.");
        return;
      }

      const fullCode = `${prefijo}${cleanSufijo}`;
      const pts = Number(modalConfigCodigo.puntosSeguidor);
      if (isNaN(pts) || pts <= 0) {
        alert("Los puntos para el seguidor deben ser un número mayor a 0.");
        return;
      }

      if (pts > modalConfigCodigo.asig.puntosParaClientes) {
        alert(`No puedes asignar ${pts} pts por canje porque tu bolsa restante en este comercio es de ${modalConfigCodigo.asig.puntosParaClientes} pts.`);
        return;
      }

      // Validación de duplicidad / código no vencido en otros influencers o activo
      const checkSnap = await getDocs(query(collection(db, 'codigos_influencer'), where('id', '==', fullCode)));
      if (!checkSnap.empty) {
        const docEncontrado = checkSnap.docs[0].data() as CodigoInfluencer;
        if (docEncontrado.influencerId !== userData.uid) {
          alert("Este código ya está en uso por otro influencer. Por favor, elige otra combinación.");
          return;
        } else if (docEncontrado.comercioId !== modalConfigCodigo.asig.comercioId) {
          const tiempoUso = Date.now() - (docEncontrado.fechaUltimaRenovacion || docEncontrado.createdAt);
          if (tiempoUso < THIRTY_DAYS_MS) {
            alert(`No puedes reasignar el código "${fullCode}" porque está activo en otra campaña y aún no ha vencido.`);
            return;
          }
        }
      }

      // El servidor comprueba que el código esté libre, que la campaña esté aceptada y lo deja
      // listo; si el influencer cambió de código, borra el anterior.
      if (modalConfigCodigo.codigoExistenteId && modalConfigCodigo.codigoExistenteId !== fullCode) {
        await invocar('gestionarCodigoInfluencer', { accion: 'eliminar', codigo: modalConfigCodigo.codigoExistenteId });
      }

      await invocar('gestionarCodigoInfluencer', {
        accion: 'configurar',
        codigo: fullCode,
        comercioId: modalConfigCodigo.asig.comercioId,
        puntosPorCanje: pts,
      });

      alert(`¡Código "${fullCode}" configurado con éxito con ${pts} puntos para tus seguidores!`);
      setModalConfigCodigo(null);
      fetchData();
    } catch (err) {
      console.error(err);
      alert(mensajeDeError(err));
    }
  };

  const handleCopiarCodigo = (codeStr: string) => {
    navigator.clipboard.writeText(codeStr);
    alert(`¡Código "${codeStr}" copiado al portapapeles!`);
  };

  const handleEliminarAlianza = async (asig: AsignacionInfluencer) => {
    if (!window.confirm("¿Estás seguro de eliminar esta alianza? Se borrará la colaboración y los códigos asociados.")) return;
    try {
      // Al eliminar la campaña, el servidor borra también los códigos asociados.
      await invocar('gestionarAsignacionInfluencer', {
        accion: 'eliminar', comercioId: asig.comercioId, influencerId: asig.influencerId,
      });
      alert("Alianza eliminada con éxito.");
      fetchData();
    } catch (err) {
      alert(mensajeDeError(err));
    }
  };

  const handleAceptarInvitacion = async (asig: AsignacionInfluencer) => {
    try {
      const prefijo = userData?.prefijoCodigo ? userData.prefijoCodigo.trim().toUpperCase() : 'INF';
      const comercioNombre = comerciosMap[asig.comercioId]?.nombre || 'COMERCIO';
      const cleanComercioName = comercioNombre.replace(/\s+/g, '').toUpperCase().substring(0, 5);
      const codigoBase = `${prefijo}${cleanComercioName}`;
      
      const codigoId = window.prompt(`Ingresa tu código único para ${comercioNombre} (Debe iniciar con "${prefijo}"):`, codigoBase);
      if (!codigoId) return;

      const cleanCode = codigoId.trim().toUpperCase();
      if (!cleanCode.startsWith(prefijo)) {
        alert(`❌ ERROR: El código debe comenzar con tu prefijo "${prefijo}".`);
        return;
      }

      await invocar('gestionarAsignacionInfluencer', {
        accion: 'aceptar', comercioId: asig.comercioId, influencerId: userData!.uid,
      });
      await invocar('gestionarCodigoInfluencer', {
        accion: 'configurar',
        codigo: cleanCode,
        comercioId: asig.comercioId,
        puntosPorCanje: asig.ratio?.cliente || 10,
      });

      alert("¡Invitación aceptada y código activado!");
      fetchData();
    } catch (err) {
      alert(mensajeDeError(err));
    }
  };

  const handleRechazarInvitacion = async (asig: AsignacionInfluencer) => {
    if (!window.confirm("¿Seguro que deseas rechazar esta invitación?")) return;
    try {
      await invocar('gestionarAsignacionInfluencer', {
        accion: 'rechazar', comercioId: asig.comercioId, influencerId: userData!.uid,
      });
      fetchData();
    } catch (err) {
      alert(mensajeDeError(err));
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Cargando panel de influencer...</div>;
  }

  const invitacionesRecibidas = asignaciones.filter(a => a.estado === 'PENDIENTE' && a.iniciadoPor === 'COMERCIO');
  const propuestasEnviadas = asignaciones.filter(a => a.estado === 'PENDIENTE' && a.iniciadoPor === 'INFLUENCER');
  const asignacionesActivas = asignaciones.filter(a => a.estado === 'ACEPTADO');

  // Comercios disponibles para proponer
  const idsAsignados = asignaciones.filter(a => a.estado !== 'RECHAZADO').map(a => a.comercioId);
  const comerciosDisponibles = todosComercios.filter(c => !idsAsignados.includes(c.id));

  // Cálculos Globales de Rendimiento
  let puntosTotalesRepartidos = 0;
  let canjesTotales = 0;

  transaccionesInfluencer.forEach(t => {
    puntosTotalesRepartidos += (t.puntos || 0);
    canjesTotales += 1;
  });

  return (
    <div className="w-full max-w-7xl mx-auto p-4 sm:p-6 space-y-8">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm flex flex-wrap justify-between items-center gap-4">
        <div>
          <h2 className="text-2xl font-black text-gray-800 dark:text-white flex items-center gap-2">
            <span>🌟</span> Panel de Influencer & Campañas
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Gestiona tus alianzas comerciales bilaterales, códigos de campaña y monitorea los puntos generados por comercio.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs bg-purple-100 text-purple-800 font-mono font-bold px-3 py-1.5 rounded-full border border-purple-200">
            PREFIJO: {userData?.prefijoCodigo || 'INF'}
          </span>
          <span className="text-xs font-bold text-gray-500">{userData?.email}</span>
        </div>
      </div>

      {/* KPIs Globales */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800 p-5 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm text-center">
          <p className="text-xs font-extrabold text-purple-600 uppercase tracking-wider mb-1">Puntos a Seguidores</p>
          <p className="text-3xl font-black text-purple-600">+{puntosTotalesRepartidos}</p>
          <p className="text-[11px] text-gray-400 mt-1">repartidos en total</p>
        </div>

        <div className="bg-white dark:bg-gray-800 p-5 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm text-center">
          <p className="text-xs font-extrabold text-blue-600 uppercase tracking-wider mb-1">Canjes de Códigos</p>
          <p className="text-3xl font-black text-blue-600">{canjesTotales}</p>
          <p className="text-[11px] text-gray-400 mt-1">seguidores alcanzados</p>
        </div>

        <div className="bg-white dark:bg-gray-800 p-5 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm text-center">
          <p className="text-xs font-extrabold text-green-600 uppercase tracking-wider mb-1">Alianzas Activas</p>
          <p className="text-3xl font-black text-green-600">{asignacionesActivas.length}</p>
          <p className="text-[11px] text-gray-400 mt-1">comercios asociados</p>
        </div>

        <div className="bg-white dark:bg-gray-800 p-5 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm text-center">
          <p className="text-xs font-extrabold text-amber-600 uppercase tracking-wider mb-1">Invitaciones</p>
          <p className="text-3xl font-black text-amber-600">{invitacionesRecibidas.length}</p>
          <p className="text-[11px] text-gray-400 mt-1">pendientes de respuesta</p>
        </div>
      </div>

      {/* Invitaciones Recibidas */}
      {invitacionesRecibidas.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-2xl p-6 shadow-sm">
          <h3 className="text-base font-bold text-amber-900 dark:text-amber-200 mb-2 flex items-center gap-2">
            <span>🎁</span> Invitaciones de Comercios Pendientes ({invitacionesRecibidas.length})
          </h3>
          <div className="grid gap-4 mt-4">
            {invitacionesRecibidas.map(inv => {
              const c = comerciosMap[inv.comercioId];
              return (
                <div key={inv.id} className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-amber-200 dark:border-amber-700 flex flex-wrap items-center justify-between gap-4 text-xs">
                  <div>
                    <h4 className="font-bold text-gray-800 dark:text-white text-base">{c?.nombre || 'Comercio'}</h4>
                    <p className="text-gray-600 dark:text-gray-300">
                      Bolsa asignada: <strong className="text-purple-600 font-bold">{inv.puntosParaClientes} pts</strong> para tus seguidores.
                    </p>
                    <p className="text-gray-400 mt-0.5">Ratio: {inv.ratio.cliente} pts seguidores / {inv.ratio.influencer} pts para ti.</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => handleRechazarInvitacion(inv)} className="px-3 py-1.5 text-red-600 font-bold hover:bg-red-50 rounded-lg transition cursor-pointer">Rechazar</button>
                    <button onClick={() => handleAceptarInvitacion(inv)} className="px-4 py-1.5 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg transition shadow cursor-pointer">Aceptar y Crear Código</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Propuestas Enviadas */}
      {propuestasEnviadas.length > 0 && (
        <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm space-y-3">
          <h3 className="text-base font-bold text-gray-800 dark:text-white">Tus Propuestas Enviadas a Comercios ({propuestasEnviadas.length})</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 dark:bg-gray-700 text-gray-500 uppercase">
                <tr>
                  <th className="p-3">Comercio</th>
                  <th className="p-3">Fecha</th>
                  <th className="p-3">Estado</th>
                  <th className="p-3 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {propuestasEnviadas.map(asig => {
                  const c = comerciosMap[asig.comercioId];
                  return (
                    <tr key={asig.id}>
                      <td className="p-3 font-bold text-gray-800 dark:text-white">{c?.nombre || asig.comercioId}</td>
                      <td className="p-3 text-gray-400">{new Date(asig.createdAt).toLocaleDateString()}</td>
                      <td className="p-3"><span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">Esperando respuesta</span></td>
                      <td className="p-3 text-right">
                        <button onClick={() => handleEliminarAlianza(asig)} className="text-red-500 font-bold hover:underline">Cancelar</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Campañas y Alianzas Activas (Desglose por Comercio) */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm space-y-6">
        <div className="flex justify-between items-center border-b pb-4">
          <h3 className="text-lg font-bold text-gray-800 dark:text-white">Mis Campañas Activas por Comercio ({asignacionesActivas.length})</h3>
        </div>

        {asignacionesActivas.length === 0 ? (
          <div className="p-8 text-center text-gray-400 bg-gray-50 dark:bg-gray-700/30 rounded-xl border">
            No tienes campañas activas en este momento. Acepta invitaciones o envía propuestas a comercios disponibles abajo.
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-6">
            {asignacionesActivas.map(asig => {
              const c = comerciosMap[asig.comercioId];
              const codigo = codigos.find(cod => cod.comercioId === asig.comercioId);

              // Métricas de este comercio específico
              const txsComercio = transaccionesInfluencer.filter(t => t.comercioId === asig.comercioId);
              let ptsRepartidosCom = 0;
              const canjesCom = txsComercio.length;
              txsComercio.forEach(t => ptsRepartidosCom += (t.puntos || 0));

              const msSinceRenovation = codigo ? Date.now() - codigo.fechaUltimaRenovacion : 0;
              const daysLeft = codigo ? Math.max(0, Math.ceil((THIRTY_DAYS_MS - msSinceRenovation) / (1000 * 60 * 60 * 24))) : 0;

              return (
                <div key={asig.id} className="border border-gray-200 dark:border-gray-700 rounded-2xl overflow-hidden shadow-sm flex flex-col justify-between bg-white dark:bg-gray-800 text-xs">
                  <div className="bg-gray-50 dark:bg-gray-700/50 p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                      {c?.logoUrl ? (
                        <img src={c.logoUrl} alt="Logo" className="w-9 h-9 object-contain rounded-lg border bg-white" />
                      ) : (
                        <div className="w-9 h-9 bg-purple-100 text-purple-700 rounded-lg flex items-center justify-center font-bold">NB</div>
                      )}
                      <div>
                        <h4 className="font-bold text-gray-800 dark:text-white text-base">{c?.nombre || 'Comercio'}</h4>
                        <span className="text-[10px] text-gray-400">NIT: {c?.nit_rut}</span>
                      </div>
                    </div>
                    <span className="text-[10px] bg-green-100 text-green-800 font-bold px-2 py-0.5 rounded border border-green-200">
                      ALIANZA ACTIVA
                    </span>
                  </div>

                  <div className="p-4 space-y-3">
                    {/* Tarjeta de Código */}
                    <div className="bg-purple-50 dark:bg-purple-950/40 p-3 rounded-xl border border-purple-100 dark:border-purple-800 flex justify-between items-center">
                      <div>
                        <span className="text-[10px] text-purple-700 dark:text-purple-300 uppercase font-bold block">Código de Canje Activo:</span>
                        <span className="text-lg font-mono font-black text-purple-900 dark:text-purple-200 tracking-wider">
                          {codigo ? codigo.id : 'SIN CÓDIGO'}
                        </span>
                        {codigo && <p className="text-[10px] text-gray-400 mt-0.5">Vigencia: {daysLeft} días restantes</p>}
                      </div>
                      
                      {codigo ? (
                        <div className="flex gap-1.5">
                          <button 
                            onClick={() => handleCopiarCodigo(codigo.id)}
                            className="bg-white dark:bg-gray-800 hover:bg-gray-100 border border-purple-200 text-purple-800 px-2.5 py-1.5 rounded-lg font-bold text-xs transition cursor-pointer"
                            title="Copiar Código"
                          >
                            📋 Copiar
                          </button>
                          <button 
                            onClick={() => setModalQR({ codigo: codigo.id, nombreComercio: c?.nombre || 'Comercio', logoUrl: c?.logoUrl })}
                            className="bg-purple-600 hover:bg-purple-700 text-white px-2.5 py-1.5 rounded-lg font-bold text-xs transition cursor-pointer flex items-center gap-1"
                            title="Descargar QR para Historias"
                          >
                            📱 QR
                          </button>
                        </div>
                      ) : (
                        <button 
                          onClick={() => abrirModalCodigo(asig)}
                          className="bg-purple-600 hover:bg-purple-700 text-white px-3 py-1.5 rounded-lg font-bold text-xs transition cursor-pointer"
                        >
                          Generar Código
                        </button>
                      )}
                    </div>

                    {/* Métricas por Comercio */}
                    <div className="grid grid-cols-3 gap-2 text-center pt-2">
                      <div className="p-2 bg-gray-50 dark:bg-gray-700/30 rounded-lg">
                        <span className="text-[10px] text-gray-400 uppercase font-bold block">Canjes</span>
                        <span className="text-sm font-black text-blue-600">{canjesCom}</span>
                      </div>
                      <div className="p-2 bg-gray-50 dark:bg-gray-700/30 rounded-lg">
                        <span className="text-[10px] text-gray-400 uppercase font-bold block">Pts Repartidos</span>
                        <span className="text-sm font-black text-purple-600">{ptsRepartidosCom}</span>
                      </div>
                      <div className="p-2 bg-gray-50 dark:bg-gray-700/30 rounded-lg">
                        <span className="text-[10px] text-gray-400 uppercase font-bold block">Bolsa Restante</span>
                        <span className="text-sm font-black text-emerald-600">{asig.puntosParaClientes} pts</span>
                      </div>
                    </div>
                  </div>

                  <div className="p-3 bg-gray-50 dark:bg-gray-700/30 border-t border-gray-100 dark:border-gray-700 flex justify-between items-center">
                    <button 
                      onClick={() => abrirModalCodigo(asig)}
                      className="text-xs text-blue-600 hover:text-blue-800 font-bold cursor-pointer"
                    >
                      ✏️ Configurar Código / Puntos
                    </button>
                    <button 
                      onClick={() => handleEliminarAlianza(asig)}
                      className="text-xs text-red-500 hover:text-red-700 font-bold cursor-pointer"
                    >
                      Desvincular
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Proponer Alianza a Nuevo Comercio */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm space-y-4">
        <h3 className="text-base font-bold text-gray-800 dark:text-white">Explorar y Enviar Propuestas a Nuevos Comercios</h3>
        {comerciosDisponibles.length === 0 ? (
          <p className="text-xs text-gray-400">Ya tienes alianzas o solicitudes en curso con todos los comercios disponibles.</p>
        ) : (
          <form onSubmit={handleEnviarPropuestaAComercio} className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[260px]">
              <label className="block text-xs font-bold text-gray-600 dark:text-gray-300 mb-1">Seleccionar Comercio Disponible</label>
              <select 
                required 
                className="w-full bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-xs font-semibold"
                value={selectedComercioAInvitar} 
                onChange={e => setSelectedComercioAInvitar(e.target.value)}
              >
                <option value="">-- Elige un Comercio --</option>
                {comerciosDisponibles.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.nombre} (NIT: {c.nit_rut})
                  </option>
                ))}
              </select>
            </div>
            <button 
              type="submit" 
              className="bg-brand-primary hover:bg-brand-primary-hover text-white font-bold px-4 py-2 rounded-xl transition text-xs cursor-pointer shadow"
            >
              Enviar Propuesta de Alianza
            </button>
          </form>
        )}
      </div>

      {/* Modal QR Compartible para Redes Sociales */}
      {modalQR && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl space-y-4 text-center">
            <div className="flex justify-between items-center border-b pb-2">
              <h3 className="font-bold text-gray-800 text-sm">QR de Campaña para Historias</h3>
              <button onClick={() => setModalQR(null)} className="text-gray-400 font-bold hover:text-black">✕</button>
            </div>

            <div id="qr-canvas-card" className="bg-gradient-to-b from-purple-50 to-white p-6 rounded-2xl border border-purple-200 flex flex-col items-center space-y-3">
              {modalQR.logoUrl && (
                <img src={modalQR.logoUrl} alt="Logo" className="w-12 h-12 object-contain rounded-full border bg-white p-1" />
              )}
              <h4 className="font-black text-gray-800 text-base">{modalQR.nombreComercio}</h4>
              <p className="text-xs text-purple-700 font-bold">¡Escanea para ganar puntos de bienvenida!</p>

              <div className="p-3 bg-white rounded-xl shadow-md border">
                <QRCodeSVG value={modalQR.codigo} size={180} level="H" />
              </div>

              <div className="pt-2">
                <span className="text-[10px] text-gray-400 font-bold uppercase block">Código de Canje</span>
                <span className="text-xl font-mono font-black text-purple-800 tracking-widest">{modalQR.codigo}</span>
              </div>
            </div>

            <div className="flex gap-2">
              <button 
                onClick={() => {
                  const svgEl = document.querySelector('#qr-canvas-card svg');
                  if (!svgEl) return;
                  const svgData = new XMLSerializer().serializeToString(svgEl);
                  const canvas = document.createElement("canvas");
                  const ctx = canvas.getContext("2d");
                  const img = new Image();
                  img.onload = () => {
                    canvas.width = 400;
                    canvas.height = 400;
                    if (ctx) {
                      ctx.fillStyle = "#ffffff";
                      ctx.fillRect(0, 0, 400, 400);
                      ctx.drawImage(img, 50, 50, 300, 300);
                    }
                    const a = document.createElement("a");
                    a.download = `QR_Influencer_${modalQR.codigo}.png`;
                    a.href = canvas.toDataURL("image/png");
                    a.click();
                  };
                  img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgData)));
                }}
                className="flex-1 bg-purple-600 hover:bg-purple-700 text-white font-bold py-2.5 rounded-xl text-xs transition cursor-pointer flex items-center justify-center gap-1 shadow"
              >
                📥 Descargar QR (PNG)
              </button>
              <button 
                onClick={() => setModalQR(null)}
                className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold py-2.5 rounded-xl text-xs transition cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal para Configurar Código y Puntos de Campaña */}
      {modalConfigCodigo && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-5 text-xs">
            <div className="flex justify-between items-center border-b pb-3">
              <div>
                <h3 className="font-black text-gray-800 dark:text-white text-base">Configurar Código de Campaña</h3>
                <p className="text-gray-400 text-[11px]">{comerciosMap[modalConfigCodigo.asig.comercioId]?.nombre || 'Comercio'}</p>
              </div>
              <button onClick={() => setModalConfigCodigo(null)} className="text-gray-400 font-bold hover:text-black">✕</button>
            </div>

            <form onSubmit={handleGuardarCodigoModal} className="space-y-4">
              {/* Prefijo Inmutable + Sufijo */}
              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                  Código de Campaña (Prefijo Oficial Fijo)
                </label>
                <div className="flex rounded-xl overflow-hidden border border-purple-300 dark:border-purple-700 focus-within:ring-2 focus-within:ring-purple-500">
                  <span className="bg-purple-100 dark:bg-purple-900/60 text-purple-800 dark:text-purple-200 font-mono font-black px-3 py-2.5 flex items-center select-none text-sm border-r border-purple-200 dark:border-purple-800">
                    {userData?.prefijoCodigo || 'INF'}
                  </span>
                  <input 
                    type="text" 
                    required
                    placeholder="PROMO26" 
                    value={modalConfigCodigo.sufijo} 
                    onChange={e => setModalConfigCodigo({
                      ...modalConfigCodigo,
                      sufijo: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')
                    })}
                    className="flex-1 px-3 py-2.5 font-mono font-black text-sm uppercase bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none"
                  />
                </div>
                <p className="text-[10px] text-gray-400 mt-1">
                  Código final: <strong className="font-mono text-purple-700 dark:text-purple-300">{userData?.prefijoCodigo || 'INF'}{modalConfigCodigo.sufijo || '...'}</strong> (El prefijo oficial es asignado por SuperAdmin y no puede ser alterado).
                </p>
              </div>

              {/* Puntos para el usuario seguidor */}
              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                  Puntos a Entregar al Seguidor por Canje
                </label>
                <input 
                  type="number" 
                  required 
                  min="1" 
                  max={modalConfigCodigo.asig.puntosParaClientes}
                  value={modalConfigCodigo.puntosSeguidor} 
                  onChange={e => setModalConfigCodigo({
                    ...modalConfigCodigo,
                    puntosSeguidor: Number(e.target.value)
                  })}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-2 text-sm font-black text-purple-700 dark:text-purple-300 bg-white dark:bg-gray-700"
                />
                <span className="text-[10px] text-gray-400 block mt-0.5">
                  Bolsa disponible en este comercio: {modalConfigCodigo.asig.puntosParaClientes} pts.
                </span>
              </div>

              {/* Cálculo automático de puntos para el influencer */}
              <div className="bg-purple-50 dark:bg-purple-950/40 p-3.5 rounded-xl border border-purple-100 dark:border-purple-800 space-y-1">
                <span className="text-[10px] font-bold text-purple-800 dark:text-purple-300 uppercase block">Rendimiento Estimado por Canje:</span>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600 dark:text-gray-300">Puntos para el Seguidor:</span>
                  <strong className="text-purple-700 dark:text-purple-300 font-black">+{modalConfigCodigo.puntosSeguidor || 0} pts</strong>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600 dark:text-gray-300">Tus Puntos Ganados (Ratio {modalConfigCodigo.asig.ratio.cliente}:{modalConfigCodigo.asig.ratio.influencer}):</span>
                  <strong className="text-green-600 dark:text-green-400 font-black">
                    +{modalConfigCodigo.asig.ratio.cliente > 0 ? Math.floor((modalConfigCodigo.puntosSeguidor || 0) * (modalConfigCodigo.asig.ratio.influencer / modalConfigCodigo.asig.ratio.cliente)) : 0} pts
                  </strong>
                </div>
              </div>

              <div className="flex gap-2 pt-2 border-t">
                <button 
                  type="button" 
                  onClick={() => setModalConfigCodigo(null)} 
                  className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold py-2.5 rounded-xl transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  className="flex-1 bg-purple-600 hover:bg-purple-700 text-white font-bold py-2.5 rounded-xl transition cursor-pointer shadow"
                >
                  Guardar y Activar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};

export default InfluencerDashboard;
