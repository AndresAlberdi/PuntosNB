import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs, updateDoc, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { QRCodeSVG } from 'qrcode.react';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
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
      const asignId = `${selectedComercioAInvitar}_${userData.uid}`;
      const nuevaAsig: AsignacionInfluencer = {
        id: asignId,
        comercioId: selectedComercioAInvitar,
        influencerId: userData.uid,
        puntosParaClientes: 0,
        ratio: { cliente: 10, influencer: 5 },
        estado: 'PENDIENTE',
        iniciadoPor: 'INFLUENCER',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      await setDoc(doc(db, 'asignaciones_influencer', asignId), nuevaAsig);
      alert("Propuesta de colaboración enviada al comercio exitosamente.");
      setSelectedComercioAInvitar('');
      fetchData();
    } catch (err) {
      console.error(err);
      alert("Error al enviar la propuesta al comercio.");
    }
  };

  // Crear o editar código con validación de prefijo y no duplicidad vigente
  const handleCrearOEditarCodigo = async (asig: AsignacionInfluencer) => {
    try {
      const prefijo = userData?.prefijoCodigo ? userData.prefijoCodigo.trim().toUpperCase() : 'INF';
      const comercioNombre = comerciosMap[asig.comercioId]?.nombre || 'COMERCIO';
      const cleanComercioName = comercioNombre.replace(/\s+/g, '').toUpperCase().substring(0, 5);
      const codigoSugerido = `${prefijo}${cleanComercioName}`;
      
      const codigoExistente = codigos.find(c => c.comercioId === asig.comercioId);
      
      const codigoId = window.prompt(
        codigoExistente 
          ? `Modifica tu código único de campaña para ${comercioNombre} (Debe iniciar con "${prefijo}"):` 
          : `Ingresa el código que deseas usar para la campaña en ${comercioNombre} (Debe iniciar con "${prefijo}", Ej. ${codigoSugerido}):`, 
        codigoExistente ? codigoExistente.id : codigoSugerido
      );
      if (!codigoId) return;

      const cleanCode = codigoId.trim().toUpperCase();

      // 1. Validación de Prefijo Obligatorio
      if (!cleanCode.startsWith(prefijo)) {
        alert(`❌ ERROR: Tu código de campaña debe comenzar estrictamente con tu prefijo oficial "${prefijo}". Ejemplo válido: ${prefijo}PROMO`);
        return;
      }

      // 2. Validación de duplicidad / código no vencido en otros influencers o activo
      const checkSnap = await getDocs(query(collection(db, 'codigos_influencer'), where('id', '==', cleanCode)));
      if (!checkSnap.empty) {
        const docEncontrado = checkSnap.docs[0].data() as CodigoInfluencer;
        if (docEncontrado.influencerId !== userData?.uid) {
          alert("Este código ya está en uso por otro influencer. Por favor, elige otro.");
          return;
        } else if (docEncontrado.comercioId !== asig.comercioId) {
          // Ya lo tiene en otro comercio y no ha vencido
          const tiempoUso = Date.now() - (docEncontrado.fechaUltimaRenovacion || docEncontrado.createdAt);
          if (tiempoUso < THIRTY_DAYS_MS) {
            alert(`No puedes reasignar el código "${cleanCode}" porque está activo en otra campaña y aún no ha vencido.`);
            return;
          }
        }
      }

      if (codigoExistente && codigoExistente.id !== cleanCode) {
        await deleteDoc(doc(db, 'codigos_influencer', codigoExistente.id));
      }

      // Guardar nuevo código
      const nuevoCodigo: CodigoInfluencer = {
        id: cleanCode,
        influencerId: userData!.uid,
        comercioId: asig.comercioId,
        puntosPorCanje: asig.ratio?.cliente || 10,
        estado: 'ACTIVO',
        createdAt: codigoExistente ? codigoExistente.createdAt : Date.now(),
        fechaUltimaRenovacion: Date.now(),
      };

      await setDoc(doc(db, 'codigos_influencer', cleanCode), nuevoCodigo);
      alert(`¡Código "${cleanCode}" configurado con éxito!`);
      fetchData();
    } catch (err) {
      console.error(err);
      alert("Error al configurar el código.");
    }
  };

  const handleCopiarCodigo = (codeStr: string) => {
    navigator.clipboard.writeText(codeStr);
    alert(`¡Código "${codeStr}" copiado al portapapeles!`);
  };

  const handleEliminarAlianza = async (asig: AsignacionInfluencer) => {
    if (!window.confirm("¿Estás seguro de eliminar esta alianza? Se borrará la colaboración y los códigos asociados.")) return;
    try {
      await deleteDoc(doc(db, 'asignaciones_influencer', asig.id));
      const cod = codigos.find(c => c.comercioId === asig.comercioId);
      if (cod) {
        await deleteDoc(doc(db, 'codigos_influencer', cod.id));
      }
      alert("Alianza eliminada con éxito.");
      fetchData();
    } catch (err) {
      alert("Error al eliminar alianza.");
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

      const checkSnap = await getDocs(query(collection(db, 'codigos_influencer'), where('id', '==', cleanCode)));
      if (!checkSnap.empty) {
        alert("Este código ya está en uso por otro influencer.");
        return;
      }

      const nuevoCodigo: CodigoInfluencer = {
        id: cleanCode,
        influencerId: userData!.uid,
        comercioId: asig.comercioId,
        puntosPorCanje: asig.ratio?.cliente || 10,
        estado: 'ACTIVO',
        createdAt: Date.now(),
        fechaUltimaRenovacion: Date.now(),
      };

      await setDoc(doc(db, 'codigos_influencer', cleanCode), nuevoCodigo);
      await updateDoc(doc(db, 'asignaciones_influencer', asig.id), {
        estado: 'ACEPTADO',
        updatedAt: Date.now()
      });

      alert("¡Invitación aceptada y código activado!");
      fetchData();
    } catch (err) {
      alert("Error al aceptar invitación.");
    }
  };

  const handleRechazarInvitacion = async (asig: AsignacionInfluencer) => {
    if (!window.confirm("¿Seguro que deseas rechazar esta invitación?")) return;
    try {
      await updateDoc(doc(db, 'asignaciones_influencer', asig.id), {
        estado: 'RECHAZADO',
        updatedAt: Date.now()
      });
      fetchData();
    } catch (err) {
      alert("Error al rechazar invitación");
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
              let canjesCom = txsComercio.length;
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
                          onClick={() => handleCrearOEditarCodigo(asig)}
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
                      onClick={() => handleCrearOEditarCodigo(asig)}
                      className="text-xs text-blue-600 hover:text-blue-800 font-bold cursor-pointer"
                    >
                      ✏️ Cambiar Código
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

    </div>
  );
};

export default InfluencerDashboard;
