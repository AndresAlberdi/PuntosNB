import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs, updateDoc, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import type { AsignacionInfluencer, CodigoInfluencer, Comercio } from '../types';

export const InfluencerDashboard: React.FC = () => {
  const { userData } = useAuth();
  const [asignaciones, setAsignaciones] = useState<AsignacionInfluencer[]>([]);
  const [codigos, setCodigos] = useState<CodigoInfluencer[]>([]);
  const [todosComercios, setTodosComercios] = useState<Comercio[]>([]);
  const [comerciosMap, setComerciosMap] = useState<Record<string, Comercio>>({});
  const [loading, setLoading] = useState(true);

  // State for proposing to a new commerce
  const [selectedComercioAInvitar, setSelectedComercioAInvitar] = useState('');

  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

  const fetchData = async () => {
    if (!userData) return;
    try {
      // 1. Fetch all comercios for directory & exploration
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

      // 2. Fetch asignaciones of this influencer
      const qAsign = query(collection(db, 'asignaciones_influencer'), where('influencerId', '==', userData.uid));
      const snapAsign = await getDocs(qAsign);
      const asigs: AsignacionInfluencer[] = [];
      snapAsign.forEach(d => asigs.push(d.data() as AsignacionInfluencer));
      setAsignaciones(asigs);

      // 3. Fetch codigos of this influencer
      const qCodigos = query(collection(db, 'codigos_influencer'), where('influencerId', '==', userData.uid));
      const snapCodigos = await getDocs(qCodigos);
      const cods: CodigoInfluencer[] = [];
      snapCodigos.forEach(d => cods.push(d.data() as CodigoInfluencer));
      setCodigos(cods);

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
        puntosParaClientes: 0, // El comercio configurará los puntos al aceptar
        ratio: {
          cliente: 10,
          influencer: 5
        },
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

  // Aceptar invitación recibida de un comercio
  const handleAceptarInvitacion = async (asig: AsignacionInfluencer) => {
    try {
      const comercioNombre = comerciosMap[asig.comercioId]?.nombre || 'COMERCIO';
      const cleanComercioName = comercioNombre.replace(/\s+/g, '').toUpperCase().substring(0, 5);
      const codigoBase = `${userData?.prefijoCodigo || 'INF'}${cleanComercioName}`;
      
      const codigoId = window.prompt("Ingresa el código que deseas usar para esta campaña (Ej. NATGOLD):", codigoBase);
      if (!codigoId) return;

      const cleanCode = codigoId.trim().toUpperCase();

      // Check if code already exists
      const checkSnap = await getDocs(query(collection(db, 'codigos_influencer'), where('id', '==', cleanCode)));
      if (!checkSnap.empty) {
        alert("Este código ya está en uso por otro influencer. Por favor, elige otro.");
        return;
      }

      // Create Codigo
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

      // Update Asignacion
      await updateDoc(doc(db, 'asignaciones_influencer', asig.id), {
        estado: 'ACEPTADO',
        updatedAt: Date.now()
      });

      alert("¡Invitación aceptada y código generado exitosamente!");
      fetchData();
    } catch (err) {
      console.error(err);
      alert("Error al aceptar la invitación.");
    }
  };

  // Rechazar invitación recibida de un comercio
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

  // Bloquear / Desbloquear alianza por parte del Influencer
  const handleToggleBloqueo = async (asig: AsignacionInfluencer) => {
    const isBloqueado = asig.estado === 'BLOQUEADO';
    const accion = isBloqueado ? "desbloquear" : "bloquear";
    if (!window.confirm(`¿Estás seguro de que deseas ${accion} la alianza con este comercio?`)) return;

    try {
      await updateDoc(doc(db, 'asignaciones_influencer', asig.id), {
        estado: isBloqueado ? 'ACEPTADO' : 'BLOQUEADO',
        bloqueadoPor: isBloqueado ? null : 'INFLUENCER',
        updatedAt: Date.now()
      });
      fetchData();
    } catch (err) {
      console.error(err);
      alert(`Error al ${accion} la alianza.`);
    }
  };

  // Desvincular / Eliminar alianza por parte del Influencer
  const handleEliminarAlianza = async (asig: AsignacionInfluencer) => {
    if (!window.confirm("ATENCIÓN: ¿Deseas eliminar permanentemente esta alianza? Se borrará la colaboración y los códigos asociados quedarán inactivos.")) return;

    try {
      await deleteDoc(doc(db, 'asignaciones_influencer', asig.id));
      
      const qCodigos = query(collection(db, 'codigos_influencer'), 
        where('influencerId', '==', userData!.uid), 
        where('comercioId', '==', asig.comercioId)
      );
      const snapCodigos = await getDocs(qCodigos);
      for (const d of snapCodigos.docs) {
        await deleteDoc(d.ref);
      }

      alert("Alianza eliminada con éxito.");
      fetchData();
    } catch (err) {
      console.error(err);
      alert("Error al eliminar la alianza.");
    }
  };

  // Crear o editar código de campaña para una alianza activa
  const handleCrearOEditarCodigo = async (asig: AsignacionInfluencer) => {
    try {
      const comercioNombre = comerciosMap[asig.comercioId]?.nombre || 'COMERCIO';
      const cleanComercioName = comercioNombre.replace(/\s+/g, '').toUpperCase().substring(0, 5);
      const codigoBase = `${userData?.prefijoCodigo || 'INF'}${cleanComercioName}`;
      
      const codigoExistente = codigos.find(c => c.comercioId === asig.comercioId);
      
      const codigoId = window.prompt(
        codigoExistente 
          ? `Modifica tu código único de campaña para ${comercioNombre}:` 
          : `Ingresa el código que deseas usar para la campaña en ${comercioNombre} (Ej. ${codigoBase}):`, 
        codigoExistente ? codigoExistente.id : codigoBase
      );
      if (!codigoId) return;

      const cleanCode = codigoId.trim().toUpperCase();

      if (!codigoExistente || codigoExistente.id !== cleanCode) {
        // Verificar si el nuevo código ya existe
        const checkSnap = await getDocs(query(collection(db, 'codigos_influencer'), where('id', '==', cleanCode)));
        if (!checkSnap.empty) {
          alert("Este código ya está en uso por otro influencer. Por favor, elige otro.");
          return;
        }

        if (codigoExistente) {
          // Eliminar el código anterior
          await deleteDoc(doc(db, 'codigos_influencer', codigoExistente.id));
        }
      }

      // Guardar nuevo código
      const nuevoCodigo: CodigoInfluencer = {
        id: cleanCode,
        influencerId: userData!.uid,
        comercioId: asig.comercioId,
        puntosPorCanje: asig.ratio?.cliente || 10,
        estado: 'ACTIVO',
        createdAt: codigoExistente ? codigoExistente.createdAt : Date.now(),
        fechaUltimaRenovacion: codigoExistente ? codigoExistente.fechaUltimaRenovacion : Date.now(),
      };

      await setDoc(doc(db, 'codigos_influencer', cleanCode), nuevoCodigo);
      alert(`¡Código "${cleanCode}" configurado con éxito!`);
      fetchData();
    } catch (err) {
      console.error(err);
      alert("Error al configurar el código.");
    }
  };

  // Renovar campaña cada 30 días
  const handleRenovarCampana = async (codigo: CodigoInfluencer) => {
    try {
      await updateDoc(doc(db, 'codigos_influencer', codigo.id), {
        fechaUltimaRenovacion: Date.now()
      });
      alert("¡Campaña renovada! Los clientes podrán volver a usar este código por los próximos 30 días.");
      fetchData();
    } catch (err) {
      alert("Error al renovar campaña");
    }
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Cargando panel de influencer...</div>;

  const invitacionesRecibidas = asignaciones.filter(a => a.estado === 'PENDIENTE' && a.iniciadoPor === 'COMERCIO');
  const propuestasEnviadas = asignaciones.filter(a => a.estado === 'PENDIENTE' && a.iniciadoPor === 'INFLUENCER');
  const asignacionesActivas = asignaciones.filter(a => a.estado === 'ACEPTADO');
  const asignacionesBloqueadas = asignaciones.filter(a => a.estado === 'BLOQUEADO');

  // Comercios disponibles para postularse
  const comerciosDisponibles = todosComercios.filter(c => 
    !asignaciones.some(a => a.comercioId === c.id && a.estado !== 'RECHAZADO')
  );

  return (
    <div className="p-6 space-y-8 max-w-5xl mx-auto">
      {/* Encabezado */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Hola, {userData?.nombre}</h2>
          <p className="text-gray-500 text-sm">
            Panel de Influencer • Prefijo de Código: <strong className="text-brand-primary font-mono">{userData?.prefijoCodigo || 'No asignado'}</strong> • Correo: <span>{userData?.emailReal || userData?.email}</span>
          </p>
        </div>
        <div className="bg-brand-primary/10 text-brand-primary font-bold px-4 py-2 rounded-lg text-sm">
          {asignacionesActivas.length} Alianzas Activas
        </div>
      </div>

      {/* 1. Explorar Comercios y Proponer Colaboración */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <h3 className="text-xl font-bold text-gray-800 mb-2">Proponer Colaboración a un Comercio</h3>
        <p className="text-sm text-gray-500 mb-4">
          Explora los comercios de la plataforma y envíales una propuesta para asociarte con ellos.
        </p>

        {comerciosDisponibles.length === 0 ? (
          <div className="p-4 bg-gray-50 text-gray-500 text-sm rounded-lg border">
            Ya tienes alianzas o invitaciones en curso con todos los comercios disponibles.
          </div>
        ) : (
          <form onSubmit={handleEnviarPropuestaAComercio} className="flex flex-wrap gap-4 items-end bg-gray-50 p-4 rounded-lg border">
            <div className="flex-1 min-w-[240px]">
              <label className="block text-sm font-medium text-gray-700 mb-1">Seleccionar Comercio</label>
              <select 
                required 
                className="w-full border border-gray-300 rounded px-3 py-2 bg-white" 
                value={selectedComercioAInvitar} 
                onChange={e => setSelectedComercioAInvitar(e.target.value)}
              >
                <option value="">-- Elige un Comercio --</option>
                {comerciosDisponibles.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.nombre} ({c.dominio || c.id})
                  </option>
                ))}
              </select>
            </div>
            <button 
              type="submit" 
              className="bg-brand-primary hover:bg-brand-primary-hover text-white font-bold px-5 py-2 rounded-lg transition cursor-pointer"
            >
              Enviar Propuesta de Alianza
            </button>
          </form>
        )}
      </div>

      {/* 2. Invitaciones Recibidas de Comercios (Pendientes de Aceptación) */}
      {invitacionesRecibidas.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xl">🎁</span>
            <h3 className="text-xl font-bold text-yellow-900">
              Invitaciones Recibidas de Comercios ({invitacionesRecibidas.length})
            </h3>
          </div>
          <p className="text-sm text-yellow-800 mb-4">
            Los siguientes comercios te han invitado a ser parte de su red. Revisa sus condiciones y acepta para generar tu código de campaña.
          </p>

          <div className="grid gap-4">
            {invitacionesRecibidas.map(inv => {
              const c = comerciosMap[inv.comercioId];
              return (
                <div key={inv.id} className="bg-white p-5 rounded-lg shadow-sm border border-yellow-200 flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h4 className="font-bold text-gray-800 text-lg">{c?.nombre || 'Comercio'}</h4>
                    <p className="text-sm text-gray-600">
                      Bolsa asignada: <strong className="text-brand-primary font-bold">{inv.puntosParaClientes} pts</strong> para tus seguidores.
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      Ratio: {inv.ratio.cliente} pts para cada cliente / {inv.ratio.influencer} pts para ti por canje.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => handleRechazarInvitacion(inv)} 
                      className="px-4 py-2 text-red-600 font-bold hover:bg-red-50 rounded-lg transition cursor-pointer"
                    >
                      Rechazar
                    </button>
                    <button 
                      onClick={() => handleAceptarInvitacion(inv)} 
                      className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg shadow transition cursor-pointer"
                    >
                      Aceptar y Crear Código
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 3. Propuestas Enviadas por el Influencer (Pendientes de Aprobación por el Comercio) */}
      {propuestasEnviadas.length > 0 && (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-bold text-gray-700 mb-3">
            Tus Propuestas Enviadas a Comercios ({propuestasEnviadas.length})
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <th className="p-3 border-b">Comercio</th>
                  <th className="p-3 border-b">Fecha de Solicitud</th>
                  <th className="p-3 border-b">Estado</th>
                  <th className="p-3 border-b">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {propuestasEnviadas.map(asig => {
                  const c = comerciosMap[asig.comercioId];
                  return (
                    <tr key={asig.id}>
                      <td className="p-3 border-b font-medium">{c?.nombre || asig.comercioId}</td>
                      <td className="p-3 border-b text-xs text-gray-500">{new Date(asig.createdAt).toLocaleDateString()}</td>
                      <td className="p-3 border-b">
                        <span className="text-xs bg-amber-100 text-amber-800 font-bold px-2 py-1 rounded">
                          Esperando respuesta del comercio
                        </span>
                      </td>
                      <td className="p-3 border-b">
                        <button 
                          onClick={() => handleEliminarAlianza(asig)} 
                          className="text-xs text-red-600 hover:text-red-800 font-semibold cursor-pointer"
                        >
                          Cancelar Propuesta
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 4. Alianzas y Códigos Activos */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <h3 className="text-xl font-bold text-gray-800 mb-6">Mis Campañas y Códigos Activos</h3>
        
        {asignacionesActivas.length === 0 ? (
          <div className="p-8 text-center text-gray-400 bg-gray-50 rounded-lg border">
            No tienes campañas activas en este momento. Acepta invitaciones de comercios o envíales una propuesta.
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-6">
            {asignacionesActivas.map(asig => {
              const c = comerciosMap[asig.comercioId];
              const codigo = codigos.find(cod => cod.comercioId === asig.comercioId);

              const msSinceRenovation = codigo ? Date.now() - codigo.fechaUltimaRenovacion : 0;
              const canRenew = codigo ? msSinceRenovation >= THIRTY_DAYS_MS : false;
              const daysLeft = codigo ? Math.ceil((THIRTY_DAYS_MS - msSinceRenovation) / (1000 * 60 * 60 * 24)) : 0;

              return (
                <div key={asig.id} className="border border-gray-200 rounded-xl overflow-hidden shadow-sm flex flex-col justify-between">
                  <div className="bg-gray-50 p-4 border-b flex justify-between items-center">
                    <h4 className="font-bold text-gray-800 text-lg">{c?.nombre || 'Comercio'}</h4>
                    <span className="text-xs bg-green-100 text-green-800 font-bold px-2 py-0.5 rounded border border-green-200">
                      ALIANZA ACTIVA
                    </span>
                  </div>

                  <div className="p-5 space-y-4">
                    {codigo ? (
                      <div className="text-center p-4 bg-purple-50/50 rounded-lg border-2 border-dashed border-purple-300">
                        <p className="text-xs text-purple-700 font-medium mb-1">CÓDIGO PARA TUS SEGUIDORES</p>
                        <p className="text-2xl font-black text-brand-primary tracking-widest font-mono select-all">{codigo.id}</p>
                        <div className="mt-2 flex justify-center gap-2">
                          <button 
                            onClick={() => {
                              navigator.clipboard.writeText(codigo.id);
                              alert(`Código "${codigo.id}" copiado al portapapeles.`);
                            }}
                            className="text-xs bg-white text-purple-700 hover:bg-purple-100 border border-purple-300 px-3 py-1 rounded font-bold transition cursor-pointer"
                          >
                            📋 Copiar Código
                          </button>
                          <button 
                            onClick={() => handleCrearOEditarCodigo(asig)}
                            className="text-xs bg-white text-gray-700 hover:bg-gray-100 border border-gray-300 px-3 py-1 rounded font-medium transition cursor-pointer"
                          >
                            ✏️ Cambiar Código
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center p-5 bg-amber-50 rounded-lg border-2 border-dashed border-amber-300">
                        <p className="text-sm font-bold text-amber-900 mb-1">Código de Campaña Pendiente</p>
                        <p className="text-xs text-amber-700 mb-3">La alianza está aprobada por el comercio. Debes generar tu código único para que tus clientes puedan canjearlo.</p>
                        <button 
                          onClick={() => handleCrearOEditarCodigo(asig)}
                          className="bg-brand-primary hover:bg-brand-primary-hover text-white font-bold px-4 py-2 rounded-lg text-sm transition shadow cursor-pointer"
                        >
                          ✨ Generar Código de Campaña
                        </button>
                      </div>
                    )}
                    
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Bolsa restante:</span>
                      <span className="font-bold font-mono text-brand-primary">{asig.puntosParaClientes} pts</span>
                    </div>

                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Ratio de Ganancia:</span>
                      <span className="font-medium text-xs">{asig.ratio.cliente} pts (Cli) / {asig.ratio.influencer} pts (Ti)</span>
                    </div>

                    <div className="pt-4 border-t space-y-3">
                      {codigo && (
                        canRenew ? (
                          <div className="space-y-2">
                            <p className="text-xs text-green-600 font-medium">¡Han pasado 30 días! Puedes renovar tu campaña para que tus seguidores vuelvan a canjear.</p>
                            <button 
                              onClick={() => handleRenovarCampana(codigo)} 
                              className="w-full bg-brand-primary hover:bg-brand-primary-hover text-white font-bold py-2 rounded-lg transition cursor-pointer"
                            >
                              Renovar Campaña
                            </button>
                          </div>
                        ) : (
                          <div className="text-center">
                            <p className="text-xs text-orange-600 font-medium bg-orange-50 p-2 rounded">
                              Faltan {daysLeft} días para que puedas renovar y volver a repartir puntos a los mismos clientes.
                            </p>
                          </div>
                        )
                      )}

                      {/* Botones de Bloqueo y Desvinculación */}
                      <div className="flex gap-2 pt-2">
                        <button 
                          onClick={() => handleToggleBloqueo(asig)} 
                          className="flex-1 text-xs bg-orange-50 hover:bg-orange-100 text-orange-700 font-bold py-2 rounded border border-orange-200 transition cursor-pointer"
                        >
                          Bloquear Alianza
                        </button>
                        <button 
                          onClick={() => handleEliminarAlianza(asig)} 
                          className="flex-1 text-xs bg-red-50 hover:bg-red-100 text-red-700 font-bold py-2 rounded border border-red-200 transition cursor-pointer"
                        >
                          Desvincular
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 5. Alianzas Bloqueadas */}
      {asignacionesBloqueadas.length > 0 && (
        <div className="bg-red-50/50 p-6 rounded-xl shadow-sm border border-red-200">
          <h3 className="text-lg font-bold text-red-800 mb-3">
            Alianzas Bloqueadas ({asignacionesBloqueadas.length})
          </h3>
          <p className="text-xs text-red-700 mb-4">Tus códigos en estos comercios están temporalmente pausados y no generarán puntos hasta que se desbloqueen.</p>
          <div className="overflow-x-auto bg-white rounded-lg border border-red-200">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-red-100/50 text-red-900 text-xs uppercase">
                  <th className="p-3 border-b">Comercio</th>
                  <th className="p-3 border-b">Bloqueado Por</th>
                  <th className="p-3 border-b">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {asignacionesBloqueadas.map(asig => {
                  const c = comerciosMap[asig.comercioId];
                  return (
                    <tr key={asig.id}>
                      <td className="p-3 border-b font-medium">{c?.nombre || asig.comercioId}</td>
                      <td className="p-3 border-b text-xs font-semibold">
                        {asig.bloqueadoPor === 'INFLUENCER' ? 'Bloqueado por ti' : 'Bloqueado por el comercio'}
                      </td>
                      <td className="p-3 border-b">
                        <div className="flex gap-2">
                          <button 
                            onClick={() => handleToggleBloqueo(asig)} 
                            className="text-xs bg-green-600 hover:bg-green-700 text-white font-bold px-3 py-1 rounded transition cursor-pointer"
                          >
                            Desbloquear
                          </button>
                          <button 
                            onClick={() => handleEliminarAlianza(asig)} 
                            className="text-xs bg-red-600 hover:bg-red-700 text-white font-bold px-3 py-1 rounded transition cursor-pointer"
                          >
                            Eliminar
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
