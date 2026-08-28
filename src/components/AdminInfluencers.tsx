import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs, setDoc, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { Comercio, Usuario, AsignacionInfluencer } from '../types';

interface AdminInfluencersProps {
  comercio: Comercio;
}

export const AdminInfluencers: React.FC<AdminInfluencersProps> = ({ comercio }) => {
  const [influencers, setInfluencers] = useState<Usuario[]>([]);
  const [asignaciones, setAsignaciones] = useState<AsignacionInfluencer[]>([]);
  const [loading, setLoading] = useState(true);

  // Form states for new invitation
  const [selectedInfluencer, setSelectedInfluencer] = useState('');
  const [puntosAsignar, setPuntosAsignar] = useState(100);
  const [ratioCliente, setRatioCliente] = useState(10);
  const [ratioInfluencer, setRatioInfluencer] = useState(5);

  // Modal state for accepting proposal from influencer
  const [acceptingAsig, setAcceptingAsig] = useState<AsignacionInfluencer | null>(null);
  const [acceptPuntos, setAcceptPuntos] = useState(100);
  const [acceptRatioCli, setAcceptRatioCli] = useState(10);
  const [acceptRatioInf, setAcceptRatioInf] = useState(5);

  const fetchData = async () => {
    if (!comercio) return;
    try {
      // Get all influencers
      const qInfluencers = query(collection(db, 'users'), where('rol', '==', 'influencer'));
      const snapInf = await getDocs(qInfluencers);
      const infs: Usuario[] = [];
      snapInf.forEach(d => infs.push(d.data() as Usuario));
      setInfluencers(infs);

      // Get assignments for this commerce
      const qAsign = query(collection(db, 'asignaciones_influencer'), where('comercioId', '==', comercio.id));
      const snapAsign = await getDocs(qAsign);
      const asigs: AsignacionInfluencer[] = [];
      snapAsign.forEach(d => asigs.push(d.data() as AsignacionInfluencer));
      setAsignaciones(asigs);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [comercio]);

  // Invitar a un influencer
  const handleInvitar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedInfluencer || !comercio) return;

    const existing = asignaciones.find(a => a.influencerId === selectedInfluencer);
    if (existing && existing.estado !== 'RECHAZADO') {
      alert("Este influencer ya tiene una alianza o invitación activa o pendiente.");
      return;
    }

    try {
      const asignId = `${comercio.id}_${selectedInfluencer}`;
      const nuevaAsig: AsignacionInfluencer = {
        id: asignId,
        comercioId: comercio.id,
        influencerId: selectedInfluencer,
        puntosParaClientes: Number(puntosAsignar),
        ratio: {
          cliente: Number(ratioCliente),
          influencer: Number(ratioInfluencer)
        },
        estado: 'PENDIENTE',
        iniciadoPor: 'COMERCIO',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      await setDoc(doc(db, 'asignaciones_influencer', asignId), nuevaAsig);
      alert("Invitación enviada al influencer con éxito.");
      setSelectedInfluencer('');
      fetchData();
    } catch (err) {
      console.error(err);
      alert("Error al enviar la invitación.");
    }
  };

  // Aceptar propuesta iniciada por el Influencer
  const handleConfirmarAceptarPropuesta = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!acceptingAsig) return;

    try {
      await updateDoc(doc(db, 'asignaciones_influencer', acceptingAsig.id), {
        puntosParaClientes: Number(acceptPuntos),
        ratio: {
          cliente: Number(acceptRatioCli),
          influencer: Number(acceptRatioInf)
        },
        estado: 'ACEPTADO',
        updatedAt: Date.now()
      });
      alert("Propuesta aceptada. La alianza ahora está ACTIVA.");
      setAcceptingAsig(null);
      fetchData();
    } catch (err) {
      console.error(err);
      alert("Error al aceptar la propuesta.");
    }
  };

  // Rechazar propuesta recibida o cancelar
  const handleRechazarPropuesta = async (asig: AsignacionInfluencer) => {
    if (!window.confirm("¿Seguro que deseas rechazar esta solicitud de colaboración?")) return;
    try {
      await updateDoc(doc(db, 'asignaciones_influencer', asig.id), {
        estado: 'RECHAZADO',
        updatedAt: Date.now()
      });
      fetchData();
    } catch (err) {
      console.error(err);
      alert("Error al rechazar propuesta.");
    }
  };

  // Bloquear / Desbloquear alianza
  const handleToggleBloqueo = async (asig: AsignacionInfluencer) => {
    const isBloqueado = asig.estado === 'BLOQUEADO';
    const accion = isBloqueado ? "desbloquear" : "bloquear";
    if (!window.confirm(`¿Estás seguro de que deseas ${accion} la alianza con este influencer?`)) return;

    try {
      await updateDoc(doc(db, 'asignaciones_influencer', asig.id), {
        estado: isBloqueado ? 'ACEPTADO' : 'BLOQUEADO',
        bloqueadoPor: isBloqueado ? null : 'COMERCIO',
        updatedAt: Date.now()
      });
      fetchData();
    } catch (err) {
      console.error(err);
      alert(`Error al ${accion} la alianza.`);
    }
  };

  // Eliminar / Desvincular alianza permanentemente
  const handleEliminarAlianza = async (asig: AsignacionInfluencer) => {
    if (!window.confirm("ATENCIÓN: ¿Deseas eliminar permanentemente esta alianza? Se borrará el vínculo comercial y sus códigos asociados quedarán inactivos.")) return;

    try {
      await deleteDoc(doc(db, 'asignaciones_influencer', asig.id));
      
      // Buscar y desactivar/borrar códigos asociados
      const qCodigos = query(collection(db, 'codigos_influencer'), 
        where('influencerId', '==', asig.influencerId), 
        where('comercioId', '==', comercio.id)
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

  // Aumentar bolsa de puntos
  const handleAumentarPuntos = async (asig: AsignacionInfluencer) => {
    const aumento = window.prompt("¿Cuántos puntos adicionales deseas asignar a la bolsa de clientes?", "100");
    if (!aumento || isNaN(Number(aumento))) return;

    try {
      await updateDoc(doc(db, 'asignaciones_influencer', asig.id), {
        puntosParaClientes: asig.puntosParaClientes + Number(aumento),
        updatedAt: Date.now()
      });
      fetchData();
    } catch (err) {
      alert("Error al aumentar puntos");
    }
  };

  if (loading) return <div className="p-4 text-gray-500">Cargando directorio de influencers...</div>;

  const alianzasActivas = asignaciones.filter(a => a.estado === 'ACEPTADO');
  const propuestasRecibidas = asignaciones.filter(a => a.estado === 'PENDIENTE' && a.iniciadoPor === 'INFLUENCER');
  const invitacionesEnviadas = asignaciones.filter(a => a.estado === 'PENDIENTE' && a.iniciadoPor === 'COMERCIO');
  const alianzasBloqueadas = asignaciones.filter(a => a.estado === 'BLOQUEADO');

  // Influencers disponibles para invitar
  const influencersDisponibles = influencers.filter(inf => 
    !asignaciones.some(a => a.influencerId === inf.uid && a.estado !== 'RECHAZADO')
  );

  return (
    <div className="space-y-8">
      {/* 1. Formulario para Invitar a un Influencer */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <h3 className="text-xl font-bold text-gray-800 mb-2">Invitar a un Influencer</h3>
        <p className="text-sm text-gray-500 mb-4">Selecciona un influencer registrado para enviarle una propuesta de colaboración.</p>
        
        {influencersDisponibles.length === 0 ? (
          <div className="p-4 bg-gray-50 text-gray-500 text-sm rounded-lg border">
            Todos los influencers registrados ya cuentan con una invitación o alianza con tu comercio.
          </div>
        ) : (
          <form onSubmit={handleInvitar} className="flex flex-wrap gap-4 items-end bg-gray-50 p-4 rounded-lg border">
            <div className="flex-1 min-w-[220px]">
              <label className="block text-sm font-medium text-gray-700 mb-1">Seleccionar Influencer</label>
              <select 
                required 
                className="w-full border border-gray-300 rounded px-3 py-2 bg-white" 
                value={selectedInfluencer} 
                onChange={e => setSelectedInfluencer(e.target.value)}
              >
                <option value="">-- Elige un Influencer --</option>
                {influencersDisponibles.map(inf => (
                  <option key={inf.uid} value={inf.uid}>
                    {inf.nombre} (Prefijo: {inf.prefijoCodigo || 'INF'})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bolsa Pts. Clientes</label>
              <input 
                type="number" 
                required 
                min="1" 
                className="w-36 border border-gray-300 rounded px-3 py-2 bg-white" 
                value={puntosAsignar} 
                onChange={e => setPuntosAsignar(Number(e.target.value))} 
              />
            </div>
            <div className="flex gap-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Pts. Cliente</label>
                <input 
                  type="number" 
                  required 
                  min="1" 
                  className="w-24 border border-gray-300 rounded px-3 py-2 bg-white" 
                  value={ratioCliente} 
                  onChange={e => setRatioCliente(Number(e.target.value))} 
                />
              </div>
              <div className="flex items-end pb-2 font-bold text-gray-400">:</div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Pts. Influencer</label>
                <input 
                  type="number" 
                  required 
                  min="0" 
                  className="w-24 border border-gray-300 rounded px-3 py-2 bg-white" 
                  value={ratioInfluencer} 
                  onChange={e => setRatioInfluencer(Number(e.target.value))} 
                />
              </div>
            </div>
            <button 
              type="submit" 
              className="bg-brand-primary hover:bg-brand-primary-hover text-white font-bold px-5 py-2 rounded-lg transition cursor-pointer"
            >
              Enviar Invitación
            </button>
          </form>
        )}
      </div>

      {/* 2. Solicitudes Recibidas de Influencers (Pendientes de Aprobación por el Comercio) */}
      {propuestasRecibidas.length > 0 && (
        <div className="bg-amber-50 p-6 rounded-xl shadow-sm border border-amber-200">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xl">📩</span>
            <h3 className="text-xl font-bold text-amber-900">
              Solicitudes Recibidas de Influencers ({propuestasRecibidas.length})
            </h3>
          </div>
          <p className="text-sm text-amber-800 mb-4">
            Los siguientes influencers han solicitado colaborar con tu comercio. Puedes aceptar su solicitud configurando su bolsa de puntos o rechazarla.
          </p>

          <div className="overflow-x-auto bg-white rounded-lg border border-amber-200">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-amber-100/50 text-amber-900 text-xs uppercase">
                  <th className="p-3 border-b">Influencer</th>
                  <th className="p-3 border-b">Contacto</th>
                  <th className="p-3 border-b">Fecha Solicitud</th>
                  <th className="p-3 border-b">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {propuestasRecibidas.map(asig => {
                  const inf = influencers.find(i => i.uid === asig.influencerId);
                  return (
                    <tr key={asig.id} className="hover:bg-amber-50/50">
                      <td className="p-3 border-b">
                        <div className="font-bold text-gray-800">{inf?.nombre || asig.influencerId}</div>
                        <span className="text-xs text-gray-500 font-mono">Prefijo: {inf?.prefijoCodigo || 'INF'}</span>
                      </td>
                      <td className="p-3 border-b text-sm">
                        <div>{inf?.emailReal || inf?.email}</div>
                        <div className="text-xs text-gray-500">{inf?.telefono || '-'}</div>
                      </td>
                      <td className="p-3 border-b text-xs text-gray-500">
                        {new Date(asig.createdAt).toLocaleDateString()}
                      </td>
                      <td className="p-3 border-b">
                        <div className="flex gap-2">
                          <button 
                            onClick={() => {
                              setAcceptingAsig(asig);
                              setAcceptPuntos(100);
                              setAcceptRatioCli(10);
                              setAcceptRatioInf(5);
                            }} 
                            className="text-xs bg-green-600 hover:bg-green-700 text-white font-bold px-3 py-1.5 rounded transition cursor-pointer"
                          >
                            Aceptar Alianza
                          </button>
                          <button 
                            onClick={() => handleRechazarPropuesta(asig)} 
                            className="text-xs bg-red-100 hover:bg-red-200 text-red-700 font-bold px-3 py-1.5 rounded transition cursor-pointer"
                          >
                            Rechazar
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

      {/* 3. Alianzas Activas */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-bold text-gray-800">
            Alianzas Comerciales Activas ({alianzasActivas.length})
          </h3>
          <span className="text-xs bg-green-100 text-green-800 font-bold px-2.5 py-1 rounded">
            Operando
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 text-gray-600 text-xs uppercase">
                <th className="p-3 border-b">Influencer</th>
                <th className="p-3 border-b">Bolsa Pts. Restante</th>
                <th className="p-3 border-b">Ratio (Cliente : Influencer)</th>
                <th className="p-3 border-b">Estado</th>
                <th className="p-3 border-b">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {alianzasActivas.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-gray-400">
                    No tienes alianzas activas en este momento. Invita a un influencer o acepta solicitudes pendientes.
                  </td>
                </tr>
              ) : (
                alianzasActivas.map(asig => {
                  const inf = influencers.find(i => i.uid === asig.influencerId);
                  return (
                    <tr key={asig.id} className="hover:bg-gray-50/50">
                      <td className="p-3 border-b">
                        <div className="font-bold text-gray-800">{inf?.nombre || asig.influencerId}</div>
                        <div className="text-xs text-gray-500 font-mono">Prefijo: {inf?.prefijoCodigo || 'INF'} • {inf?.emailReal || inf?.email}</div>
                      </td>
                      <td className="p-3 border-b font-mono font-bold text-brand-primary">
                        {asig.puntosParaClientes} pts
                      </td>
                      <td className="p-3 border-b font-medium text-sm">
                        {asig.ratio.cliente} pts (Cli) : {asig.ratio.influencer} pts (Inf)
                      </td>
                      <td className="p-3 border-b">
                        <span className="text-xs px-2.5 py-1 rounded font-bold bg-green-100 text-green-800 border border-green-200">
                          ACTIVO
                        </span>
                      </td>
                      <td className="p-3 border-b">
                        <div className="flex flex-wrap gap-2">
                          <button 
                            onClick={() => handleAumentarPuntos(asig)} 
                            className="text-xs bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold px-2.5 py-1 rounded border border-blue-200 transition cursor-pointer"
                          >
                            + Puntos
                          </button>
                          <button 
                            onClick={() => handleToggleBloqueo(asig)} 
                            className="text-xs bg-orange-50 hover:bg-orange-100 text-orange-700 font-bold px-2.5 py-1 rounded border border-orange-200 transition cursor-pointer"
                            title="Pausar canjes temporalmente"
                          >
                            Bloquear
                          </button>
                          <button 
                            onClick={() => handleEliminarAlianza(asig)} 
                            className="text-xs bg-red-50 hover:bg-red-100 text-red-700 font-bold px-2.5 py-1 rounded border border-red-200 transition cursor-pointer"
                            title="Desvincular definitivamente"
                          >
                            Desvincular
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

      {/* 4. Invitaciones Enviadas Pendientes */}
      {invitacionesEnviadas.length > 0 && (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-bold text-gray-700 mb-3">
            Invitaciones Enviadas Pendientes ({invitacionesEnviadas.length})
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <th className="p-3 border-b">Influencer</th>
                  <th className="p-3 border-b">Bolsa Ofertada</th>
                  <th className="p-3 border-b">Ratio Ofertado</th>
                  <th className="p-3 border-b">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {invitacionesEnviadas.map(asig => {
                  const inf = influencers.find(i => i.uid === asig.influencerId);
                  return (
                    <tr key={asig.id}>
                      <td className="p-3 border-b font-medium">{inf?.nombre || asig.influencerId}</td>
                      <td className="p-3 border-b">{asig.puntosParaClientes} pts</td>
                      <td className="p-3 border-b">{asig.ratio.cliente}:{asig.ratio.influencer}</td>
                      <td className="p-3 border-b">
                        <button 
                          onClick={() => handleEliminarAlianza(asig)} 
                          className="text-xs text-red-600 hover:text-red-800 font-semibold cursor-pointer"
                        >
                          Cancelar Invitación
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

      {/* 5. Alianzas Bloqueadas */}
      {alianzasBloqueadas.length > 0 && (
        <div className="bg-red-50/50 p-6 rounded-xl shadow-sm border border-red-200">
          <h3 className="text-lg font-bold text-red-800 mb-3">
            Alianzas Bloqueadas ({alianzasBloqueadas.length})
          </h3>
          <p className="text-xs text-red-700 mb-4">Los códigos de estos influencers no pueden canjearse mientras se encuentren bloqueados.</p>
          <div className="overflow-x-auto bg-white rounded-lg border border-red-200">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-red-100/50 text-red-900 text-xs uppercase">
                  <th className="p-3 border-b">Influencer</th>
                  <th className="p-3 border-b">Bloqueado Por</th>
                  <th className="p-3 border-b">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {alianzasBloqueadas.map(asig => {
                  const inf = influencers.find(i => i.uid === asig.influencerId);
                  return (
                    <tr key={asig.id}>
                      <td className="p-3 border-b font-medium">{inf?.nombre || asig.influencerId}</td>
                      <td className="p-3 border-b text-xs font-semibold">
                        {asig.bloqueadoPor === 'COMERCIO' ? 'Bloqueado por tu comercio' : 'Bloqueado por el influencer'}
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

      {/* Modal para Aceptar Solicitud de Influencer */}
      {acceptingAsig && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-gray-800">Aceptar Solicitud de Colaboración</h3>
            <p className="text-xs text-gray-500">
              Influencer: <span className="font-bold text-gray-800">{influencers.find(i => i.uid === acceptingAsig.influencerId)?.nombre}</span>
            </p>

            <form onSubmit={handleConfirmarAceptarPropuesta} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Bolsa Inicial de Puntos para Clientes</label>
                <input 
                  type="number" 
                  required 
                  min="1" 
                  className="w-full border border-gray-300 rounded px-3 py-2" 
                  value={acceptPuntos} 
                  onChange={e => setAcceptPuntos(Number(e.target.value))} 
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Puntos x Cliente</label>
                  <input 
                    type="number" 
                    required 
                    min="1" 
                    className="w-full border border-gray-300 rounded px-3 py-2" 
                    value={acceptRatioCli} 
                    onChange={e => setAcceptRatioCli(Number(e.target.value))} 
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Puntos x Influencer</label>
                  <input 
                    type="number" 
                    required 
                    min="0" 
                    className="w-full border border-gray-300 rounded px-3 py-2" 
                    value={acceptRatioInf} 
                    onChange={e => setAcceptRatioInf(Number(e.target.value))} 
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t">
                <button 
                  type="button" 
                  onClick={() => setAcceptingAsig(null)} 
                  className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded font-medium text-sm transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded font-bold text-sm transition cursor-pointer"
                >
                  Confirmar y Activar Alianza
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
