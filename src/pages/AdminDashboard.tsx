import React, { useEffect, useState } from 'react';
import { doc, getDoc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import type { Comercio, ReglaPunto, Premio, RangoMonto } from '../types';

const AdminDashboard: React.FC = () => {
  const { userData } = useAuth();
  const [comercio, setComercio] = useState<Comercio | null>(null);
  const [loading, setLoading] = useState(true);

  // Modals state
  const [showReglaModal, setShowReglaModal] = useState(false);
  const [showPremioModal, setShowPremioModal] = useState(false);

  // Form states
  const [nuevaRegla, setNuevaRegla] = useState<Partial<ReglaPunto>>({ tipo: 'POR_COMPRA', activa: true, puntosAOtorgar: 10 });
  const [rangosMonto, setRangosMonto] = useState<RangoMonto[]>([{ min: 0, max: 100, puntos: 1 }]);
  const [nuevoPremio, setNuevoPremio] = useState<Partial<Premio>>({ activo: true, puntosRequeridos: 100 });

  const fetchComercio = async () => {
    if (userData?.comercioId) {
      try {
        const docRef = doc(db, 'comercios', userData.comercioId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setComercio(docSnap.data() as Comercio);
        }
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

  const agregarRango = () => {
    setRangosMonto([...rangosMonto, { min: 0, max: 0, puntos: 0 }]);
  };

  const updateRango = (index: number, field: keyof RangoMonto, value: number) => {
    const newRangos = [...rangosMonto];
    newRangos[index][field] = value;
    setRangosMonto(newRangos);
  };

  const eliminarRango = (index: number) => {
    setRangosMonto(rangosMonto.filter((_, i) => i !== index));
  };

  const validarSolapamientoRangos = (rangos: RangoMonto[]) => {
    // Ordenar por mínimo
    const sorted = [...rangos].sort((a, b) => a.min - b.min);
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i].max >= sorted[i+1].min) {
        return false;
      }
    }
    return true;
  };

  const handleCrearRegla = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!comercio || !userData?.comercioId) return;

    if (nuevaRegla.tipo === 'POR_MONTO') {
      if (!validarSolapamientoRangos(rangosMonto)) {
        alert("Los rangos de montos se solapan o son inválidos. Por favor, asegúrate de que no haya cruces (ej: 0-10 y 10-20). Usa 0-9.99 y 10-20.");
        return;
      }
    }
    
    const reglaFinal: ReglaPunto = {
      id: `regla_${Date.now()}`,
      tipo: nuevaRegla.tipo as any,
      activa: true,
      ...(nuevaRegla.tipo === 'POR_COMPRA' ? { puntosAOtorgar: Number(nuevaRegla.puntosAOtorgar) || 0 } : {}),
      ...(nuevaRegla.tipo === 'POR_PRODUCTO' ? { 
          nombreProducto: nuevaRegla.nombreProducto || '', 
          puntosAOtorgar: Number(nuevaRegla.puntosAOtorgar) || 0 
      } : {}),
      ...(nuevaRegla.tipo === 'POR_MONTO' ? { rangos: rangosMonto } : {})
    };

    try {
      const docRef = doc(db, 'comercios', userData.comercioId);
      await updateDoc(docRef, {
        reglas: arrayUnion(reglaFinal)
      });
      setShowReglaModal(false);
      setNuevaRegla({ tipo: 'POR_COMPRA', activa: true, puntosAOtorgar: 10 });
      setRangosMonto([{ min: 0, max: 100, puntos: 1 }]);
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

  if (loading) return <div className="p-8 text-center">Cargando datos del comercio...</div>;
  if (!comercio) return <div className="p-8 text-center text-red-500">Error: No se encontró el comercio asociado.</div>;

  const hasReglaCompra = comercio.reglas.some(r => r.tipo === 'POR_COMPRA');
  const hasReglaMonto = comercio.reglas.some(r => r.tipo === 'POR_MONTO');

  return (
    <div className="p-6 space-y-6">
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <h2 className="text-2xl font-bold text-gray-800 mb-2">Comercio: {comercio.nombre}</h2>
        <p className="text-gray-500 text-sm">NIT/RUT: {comercio.nit_rut}</p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Reglas de Puntos */}
        <div className="bg-blue-50 p-6 rounded-xl shadow-sm border border-blue-100">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-xl font-bold text-blue-900">Reglas de Asignación</h3>
            <button onClick={() => setShowReglaModal(true)} className="text-sm bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 transition">+ Nueva Regla</button>
          </div>
          {comercio.reglas.length === 0 ? (
            <p className="text-gray-500 text-sm">No hay reglas configuradas.</p>
          ) : (
            <ul className="space-y-3">
              {comercio.reglas.map(regla => (
                <li key={regla.id} className="bg-white p-3 rounded shadow-sm flex flex-col border border-gray-100 relative">
                  <button onClick={() => handleEliminarRegla(regla)} className="absolute top-2 right-2 text-red-500 hover:text-red-700 text-sm font-bold">✕</button>
                  <span className="font-semibold text-gray-800 pr-6">
                    {regla.tipo === 'POR_COMPRA' && 'Regla General por Compra'}
                    {regla.tipo === 'POR_MONTO' && 'Regla por Rangos de Monto'}
                    {regla.tipo === 'POR_PRODUCTO' && `Regla para Producto: ${regla.nombreProducto}`}
                  </span>
                  
                  <div className="text-sm text-gray-600 mt-1">
                    {regla.tipo !== 'POR_MONTO' && (
                      <>Otorga: <strong className="text-blue-600">{regla.puntosAOtorgar} pts</strong></>
                    )}
                    
                    {regla.tipo === 'POR_MONTO' && regla.rangos && (
                      <ul className="mt-2 text-xs border-l-2 border-blue-200 pl-2 space-y-1">
                        {regla.rangos.map((r, i) => (
                          <li key={i}>De {r.min} Bs. a {r.max} Bs. ➔ <strong className="text-blue-600">{r.puntos} pts</strong></li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Premios */}
        <div className="bg-yellow-50 p-6 rounded-xl shadow-sm border border-yellow-100">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-xl font-bold text-yellow-900">Catálogo de Premios</h3>
            <button onClick={() => setShowPremioModal(true)} className="text-sm bg-yellow-600 text-white px-3 py-1 rounded hover:bg-yellow-700 transition">+ Nuevo Premio</button>
          </div>
          {comercio.premios.length === 0 ? (
            <p className="text-gray-500 text-sm">No hay premios configurados.</p>
          ) : (
            <ul className="space-y-3">
              {comercio.premios.map(premio => (
                <li key={premio.id} className="bg-white p-3 rounded shadow-sm flex flex-col border border-gray-100 relative">
                  <button onClick={() => handleEliminarPremio(premio)} className="absolute top-2 right-2 text-red-500 hover:text-red-700 text-sm font-bold">✕</button>
                  <span className="font-semibold text-gray-800 pr-6">{premio.nombre}</span>
                  <span className="text-xs text-gray-500 mt-1">{premio.descripcion}</span>
                  <span className="text-sm font-bold text-yellow-600 mt-2">Costo: {premio.puntosRequeridos} pts</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Regla Modal */}
      {showReglaModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold mb-4">Nueva Regla</h3>
            <form onSubmit={handleCrearRegla} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de Regla</label>
                <select 
                  className="w-full border border-gray-300 rounded px-3 py-2"
                  value={nuevaRegla.tipo}
                  onChange={(e) => setNuevaRegla({...nuevaRegla, tipo: e.target.value as any})}
                >
                  {!hasReglaCompra && <option value="POR_COMPRA">Puntos fijos por compra general</option>}
                  {!hasReglaMonto && <option value="POR_MONTO">Puntos según rangos de monto</option>}
                  <option value="POR_PRODUCTO">Puntos por producto específico</option>
                </select>
                {hasReglaCompra && nuevaRegla.tipo !== 'POR_COMPRA' && <p className="text-xs text-gray-500 mt-1">Ya existe una regla por compra general. Solo puedes tener una.</p>}
                {hasReglaMonto && nuevaRegla.tipo !== 'POR_MONTO' && <p className="text-xs text-gray-500 mt-1">Ya existe una regla por rangos. Solo puedes tener una.</p>}
              </div>

              {(nuevaRegla.tipo === 'POR_COMPRA' || nuevaRegla.tipo === 'POR_PRODUCTO') && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Puntos a Otorgar</label>
                  <input type="number" required min="1" className="w-full border border-gray-300 rounded px-3 py-2" value={nuevaRegla.puntosAOtorgar || ''} onChange={(e) => setNuevaRegla({...nuevaRegla, puntosAOtorgar: Number(e.target.value)})} />
                </div>
              )}

              {nuevaRegla.tipo === 'POR_PRODUCTO' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nombre del Producto</label>
                  <input type="text" required className="w-full border border-gray-300 rounded px-3 py-2" value={nuevaRegla.nombreProducto || ''} onChange={(e) => setNuevaRegla({...nuevaRegla, nombreProducto: e.target.value})} />
                </div>
              )}

              {nuevaRegla.tipo === 'POR_MONTO' && (
                <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                  <div className="flex justify-between items-center mb-2">
                    <label className="block text-sm font-bold text-gray-700">Rangos de Montos (Bs.)</label>
                    <button type="button" onClick={agregarRango} className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded font-bold">+ Rango</button>
                  </div>
                  <div className="space-y-3">
                    {rangosMonto.map((r, idx) => (
                      <div key={idx} className="flex gap-2 items-center bg-white p-2 rounded border border-gray-200">
                        <div className="flex-1">
                          <input type="number" step="0.1" required placeholder="Min" className="w-full border border-gray-300 rounded px-2 py-1 text-sm" value={r.min} onChange={(e) => updateRango(idx, 'min', Number(e.target.value))} />
                        </div>
                        <span className="text-gray-400">-</span>
                        <div className="flex-1">
                          <input type="number" step="0.1" required placeholder="Max" className="w-full border border-gray-300 rounded px-2 py-1 text-sm" value={r.max} onChange={(e) => updateRango(idx, 'max', Number(e.target.value))} />
                        </div>
                        <span className="text-gray-600 font-bold">➔</span>
                        <div className="flex-1">
                          <input type="number" required placeholder="Pts" className="w-full border border-gray-300 rounded px-2 py-1 text-sm" value={r.puntos} onChange={(e) => updateRango(idx, 'puntos', Number(e.target.value))} />
                        </div>
                        <button type="button" onClick={() => eliminarRango(idx)} className="text-red-500 hover:bg-red-50 rounded px-2 py-1 font-bold">✕</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-3 justify-end pt-4 border-t">
                <button type="button" onClick={() => setShowReglaModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded">Cancelar</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Guardar Regla</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Premio Modal */}
      {showPremioModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md">
            <h3 className="text-xl font-bold mb-4">Nuevo Premio</h3>
            <form onSubmit={handleCrearPremio} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nombre del Premio</label>
                <input type="text" required className="w-full border border-gray-300 rounded px-3 py-2" value={nuevoPremio.nombre || ''} onChange={(e) => setNuevoPremio({...nuevoPremio, nombre: e.target.value})} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Descripción Breve</label>
                <input type="text" required className="w-full border border-gray-300 rounded px-3 py-2" value={nuevoPremio.descripcion || ''} onChange={(e) => setNuevoPremio({...nuevoPremio, descripcion: e.target.value})} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Puntos Requeridos</label>
                <input type="number" required min="1" className="w-full border border-gray-300 rounded px-3 py-2" value={nuevoPremio.puntosRequeridos || ''} onChange={(e) => setNuevoPremio({...nuevoPremio, puntosRequeridos: Number(e.target.value)})} />
              </div>

              <div className="flex gap-3 justify-end pt-4 border-t">
                <button type="button" onClick={() => setShowPremioModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded">Cancelar</button>
                <button type="submit" className="px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700">Guardar Premio</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;
