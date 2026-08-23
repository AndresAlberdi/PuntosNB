import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs, setDoc, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';

import type { Comercio, Usuario, AsignacionInfluencer } from '../types';

interface AdminInfluencersProps {
  comercio: Comercio;
}

export const AdminInfluencers: React.FC<AdminInfluencersProps> = ({ comercio }) => {
  const [influencers, setInfluencers] = useState<Usuario[]>([]);
  const [asignaciones, setAsignaciones] = useState<AsignacionInfluencer[]>([]);
  const [loading, setLoading] = useState(true);

  // Form states for new assignment
  const [selectedInfluencer, setSelectedInfluencer] = useState('');
  const [puntosAsignar, setPuntosAsignar] = useState(100);
  const [ratioCliente, setRatioCliente] = useState(1);
  const [ratioInfluencer, setRatioInfluencer] = useState(1);

  const fetchData = async () => {
    if (!comercio) return;
    try {
      // Get all influencers (in a real app with many users, we'd search, but here we fetch all for simplicity)
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

  const handleInvitar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedInfluencer || !comercio) return;
    
    // Check if assignment already exists
    const existing = asignaciones.find(a => a.influencerId === selectedInfluencer);
    if (existing) {
      alert("Este influencer ya tiene una asignación o invitación pendiente.");
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
      alert("Invitación enviada correctamente.");
      setSelectedInfluencer('');
      fetchData();
    } catch (err) {
      console.error(err);
      alert("Error al invitar al influencer.");
    }
  };

  const handleAumentarPuntos = async (asig: AsignacionInfluencer) => {
    const aumento = window.prompt("¿Cuántos puntos adicionales deseas asignar a la bolsa de clientes?", "100");
    if (!aumento || isNaN(Number(aumento))) return;
    
    try {
      await updateDoc(doc(db, 'asignaciones_influencer', asig.id), {
        puntosParaClientes: asig.puntosParaClientes + Number(aumento),
        updatedAt: Date.now()
      });
      fetchData();
    } catch(err) {
      alert("Error al aumentar puntos");
    }
  };

  if (loading) return <div className="p-4 text-gray-500">Cargando directorio de influencers...</div>;

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <h3 className="text-xl font-bold text-gray-800 mb-4">Directorio e Invitaciones</h3>
        <form onSubmit={handleInvitar} className="flex flex-wrap gap-4 items-end bg-gray-50 p-4 rounded-lg border">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium text-gray-700 mb-1">Seleccionar Influencer</label>
            <select required className="w-full border border-gray-300 rounded px-3 py-2" value={selectedInfluencer} onChange={e => setSelectedInfluencer(e.target.value)}>
              <option value="">-- Elige un Influencer --</option>
              {influencers.map(inf => (
                <option key={inf.uid} value={inf.uid}>{inf.nombre} ({inf.prefijoCodigo || 'Sin prefijo'})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Puntos a Repartir</label>
            <input type="number" required min="1" className="w-32 border border-gray-300 rounded px-3 py-2" value={puntosAsignar} onChange={e => setPuntosAsignar(Number(e.target.value))} />
          </div>
          <div className="flex gap-2">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Ratio Cli.</label>
              <input type="number" required min="1" className="w-20 border border-gray-300 rounded px-3 py-2" value={ratioCliente} onChange={e => setRatioCliente(Number(e.target.value))} />
            </div>
            <div className="flex items-end pb-2 font-bold text-gray-400">:</div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Ratio Inf.</label>
              <input type="number" required min="1" className="w-20 border border-gray-300 rounded px-3 py-2" value={ratioInfluencer} onChange={e => setRatioInfluencer(Number(e.target.value))} />
            </div>
          </div>
          <button type="submit" className="bg-brand-primary text-white font-bold px-4 py-2 rounded hover:bg-brand-primary-hover">
            Invitar Influencer
          </button>
        </form>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <h3 className="text-xl font-bold text-gray-800 mb-4">Influencers Asignados</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr>
                <th className="p-2 border-b">Influencer</th>
                <th className="p-2 border-b">Estado</th>
                <th className="p-2 border-b">Bolsa (Pts Cli.)</th>
                <th className="p-2 border-b">Ratio (C:I)</th>
                <th className="p-2 border-b">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {asignaciones.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-4 text-center text-gray-500">No hay influencers invitados.</td>
                </tr>
              ) : (
                asignaciones.map(asig => {
                  const inf = influencers.find(i => i.uid === asig.influencerId);
                  return (
                    <tr key={asig.id}>
                      <td className="p-2 border-b font-medium">{inf?.nombre || asig.influencerId}</td>
                      <td className="p-2 border-b">
                        <span className={`text-xs px-2 py-1 rounded font-bold ${asig.estado === 'ACEPTADO' ? 'bg-green-100 text-green-700' : asig.estado === 'RECHAZADO' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>
                          {asig.estado}
                        </span>
                      </td>
                      <td className="p-2 border-b">{asig.puntosParaClientes} pts</td>
                      <td className="p-2 border-b">{asig.ratio.cliente}:{asig.ratio.influencer}</td>
                      <td className="p-2 border-b">
                        {asig.estado === 'ACEPTADO' && (
                          <button onClick={() => handleAumentarPuntos(asig)} className="text-xs bg-blue-100 text-blue-700 font-bold px-2 py-1 rounded hover:bg-blue-200">
                            + Puntos
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      
      {comercio.plan === 'premium' ? (
        <div className="bg-gradient-to-r from-gray-900 to-gray-800 p-6 rounded-xl shadow-lg text-white">
          <h3 className="text-xl font-bold mb-2 flex items-center gap-2">
            <span className="text-yellow-400">★</span> Dashboard Premium de Influencers
          </h3>
          <p className="text-gray-300 text-sm mb-4">Aquí podrás ver el detalle de cada campaña, desglose de puntos por cliente y KPIs avanzados de rendimiento.</p>
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-gray-800/50 p-4 rounded border border-gray-700 text-center">
              <div className="text-3xl font-black text-brand-primary">KPIs</div>
              <div className="text-xs text-gray-400 uppercase mt-1">Total Clientes Atraídos</div>
            </div>
            <div className="bg-gray-800/50 p-4 rounded border border-gray-700 text-center">
              <div className="text-3xl font-black text-green-400">Avanzados</div>
              <div className="text-xs text-gray-400 uppercase mt-1">Puntos Generados</div>
            </div>
            <div className="bg-gray-800/50 p-4 rounded border border-gray-700 text-center">
              <div className="text-3xl font-black text-yellow-400">En Desarrollo</div>
              <div className="text-xs text-gray-400 uppercase mt-1">Conversión de Códigos</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-xl font-bold text-gray-800 mb-4">Dashboard Básico de Influencers</h3>
          <p className="text-gray-500 text-sm mb-4">Listado de los mejores influencers por cantidad de puntos obtenidos.</p>
          <div className="bg-gray-50 border p-8 text-center text-gray-400 rounded">
            Las estadísticas estarán disponibles pronto. (Mejora a Premium para reportes avanzados)
          </div>
        </div>
      )}
    </div>
  );
};
