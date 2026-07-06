import React, { useEffect, useState } from 'react';
import { doc, getDoc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import type { Comercio, ReglaPunto, Premio, ProductoCatalogo } from '../types';

const AdminDashboard: React.FC = () => {
  const { userData } = useAuth();
  const [comercio, setComercio] = useState<Comercio | null>(null);
  const [loading, setLoading] = useState(true);

  // Modals state
  const [showReglaModal, setShowReglaModal] = useState(false);
  const [showPremioModal, setShowPremioModal] = useState(false);
  const [showProductoModal, setShowProductoModal] = useState(false);

  // Form states
  const [nuevaRegla, setNuevaRegla] = useState<Partial<ReglaPunto>>({ tipo: 'POR_COMPRA', activa: true, puntosAOtorgar: 10 });
  const [nuevoPremio, setNuevoPremio] = useState<Partial<Premio>>({ activo: true, puntosRequeridos: 100 });
  const [nuevoProducto, setNuevoProducto] = useState<Partial<ProductoCatalogo>>({ activo: true, nombre: '' });

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

  const handleToggleRegla = async (regla: ReglaPunto) => {
    if (!comercio || !userData?.comercioId) return;
    try {
      const docRef = doc(db, 'comercios', userData.comercioId);
      // Replace the entire array with the updated rule
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

  // Rangos de montos removidos

  const handleCrearRegla = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!comercio || !userData?.comercioId) return;

    let nombreProd = '';
    if (nuevaRegla.tipo === 'POR_PRODUCTO' && nuevaRegla.productoId) {
      const prod = comercio.productos?.find(p => p.id === nuevaRegla.productoId);
      if (prod) nombreProd = prod.nombre;
    }

    const reglaFinal: ReglaPunto = {
      id: `regla_${Date.now()}`,
      tipo: nuevaRegla.tipo as any,
      activa: true,
      ...(nuevaRegla.tipo === 'POR_COMPRA' ? { puntosAOtorgar: Number(nuevaRegla.puntosAOtorgar) || 0 } : {}),
      ...(nuevaRegla.tipo === 'POR_PRODUCTO' ? { 
          productoId: nuevaRegla.productoId || '',
          nombreProducto: nombreProd, 
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

    const prodFinal: ProductoCatalogo = {
      id: `prod_${Date.now()}`,
      nombre: nuevoProducto.nombre || 'Nuevo Producto',
      activo: true
    };

    try {
      const docRef = doc(db, 'comercios', userData.comercioId);
      await updateDoc(docRef, {
        productos: arrayUnion(prodFinal)
      });
      setShowProductoModal(false);
      setNuevoProducto({ activo: true, nombre: '' });
      fetchComercio();
    } catch (err) {
      console.error(err);
      alert('Error al crear producto');
    }
  };

  if (loading) return <div className="p-8 text-center">Cargando datos del comercio...</div>;
  if (!comercio) return <div className="p-8 text-center text-red-500">Error: No se encontró el comercio asociado.</div>;

  const productosCatalog = comercio.productos || [];

  return (
    <div className="p-6 space-y-6">
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <h2 className="text-2xl font-bold text-gray-800 mb-2">Comercio: {comercio.nombre}</h2>
        <p className="text-gray-500 text-sm">NIT/RUT: {comercio.nit_rut}</p>
      </div>

      <div className="grid lg:grid-cols-3 md:grid-cols-2 gap-6">
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
                  <div className="absolute top-2 right-2 flex items-center gap-2">
                    <button 
                      onClick={() => handleToggleRegla(regla)} 
                      className={`text-xs px-2 py-0.5 rounded font-bold ${regla.activa ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}
                    >
                      {regla.activa ? 'Activa' : 'Inactiva'}
                    </button>
                    <button onClick={() => handleEliminarRegla(regla)} className="text-red-500 hover:text-red-700 text-sm font-bold">✕</button>
                  </div>
                  <span className={`font-semibold pr-24 ${regla.activa ? 'text-gray-800' : 'text-gray-400'}`}>
                    {regla.tipo === 'POR_COMPRA' && 'Regla General por Compra'}
                    {regla.tipo === 'POR_PRODUCTO' && `Regla para Producto: ${regla.nombreProducto}`}
                    {regla.tipo === 'POR_RANGO' && `Regla por Rango: $${regla.rangoDesde} a $${regla.rangoHasta}`}
                    {regla.tipo === 'POR_REGISTRO' && 'Regalo por Primer Registro'}
                  </span>
                  
                  <div className="text-sm text-gray-600 mt-1">
                    <>Otorga: <strong className="text-blue-600">{regla.puntosAOtorgar} pts</strong></>
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

        {/* Productos */}
        <div className="bg-purple-50 p-6 rounded-xl shadow-sm border border-purple-100">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-xl font-bold text-purple-900">Productos Especiales</h3>
            <button onClick={() => setShowProductoModal(true)} className="text-sm bg-purple-600 text-white px-3 py-1 rounded hover:bg-purple-700 transition">+ Nuevo Producto</button>
          </div>
          {productosCatalog.length === 0 ? (
            <p className="text-gray-500 text-sm">No hay productos en el catálogo.</p>
          ) : (
            <ul className="space-y-3">
              {productosCatalog.map(prod => (
                <li key={prod.id} className="bg-white p-3 rounded shadow-sm flex items-center justify-between border border-gray-100">
                  <div className="flex flex-col">
                    <span className={`font-semibold ${prod.activo ? 'text-gray-800' : 'text-gray-400'}`}>{prod.nombre}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => handleToggleProducto(prod)} 
                      className={`text-xs px-2 py-0.5 rounded font-bold ${prod.activo ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}
                    >
                      {prod.activo ? 'Activo' : 'Inactivo'}
                    </button>
                    <button onClick={() => handleEliminarProducto(prod)} className="text-red-500 hover:text-red-700 text-sm font-bold ml-1">✕</button>
                  </div>
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
                  <option value="POR_COMPRA">Puntos fijos por compra general</option>
                  <option value="POR_PRODUCTO">Puntos por producto específico</option>
                  <option value="POR_RANGO">Puntos por rango de monto</option>
                  <option value="POR_REGISTRO">Puntos regalados por registro</option>
                </select>
              </div>

              {(nuevaRegla.tipo === 'POR_COMPRA' || nuevaRegla.tipo === 'POR_PRODUCTO' || nuevaRegla.tipo === 'POR_RANGO' || nuevaRegla.tipo === 'POR_REGISTRO') && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Puntos a Otorgar</label>
                  <input type="number" required min="1" className="w-full border border-gray-300 rounded px-3 py-2" value={nuevaRegla.puntosAOtorgar || ''} onChange={(e) => setNuevaRegla({...nuevaRegla, puntosAOtorgar: Number(e.target.value)})} />
                </div>
              )}

              {nuevaRegla.tipo === 'POR_RANGO' && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Monto Desde</label>
                    <input type="number" required min="0" className="w-full border border-gray-300 rounded px-3 py-2" value={nuevaRegla.rangoDesde ?? ''} onChange={(e) => setNuevaRegla({...nuevaRegla, rangoDesde: Number(e.target.value)})} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Monto Hasta</label>
                    <input type="number" required min="0" className="w-full border border-gray-300 rounded px-3 py-2" value={nuevaRegla.rangoHasta ?? ''} onChange={(e) => setNuevaRegla({...nuevaRegla, rangoHasta: Number(e.target.value)})} />
                  </div>
                </div>
              )}

              {nuevaRegla.tipo === 'POR_PRODUCTO' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Seleccionar Producto</label>
                  {productosCatalog.length === 0 ? (
                    <p className="text-red-500 text-sm">No hay productos en el catálogo. Por favor crea uno primero.</p>
                  ) : (
                    <select 
                      className="w-full border border-gray-300 rounded px-3 py-2"
                      value={nuevaRegla.productoId || ''}
                      onChange={(e) => setNuevaRegla({...nuevaRegla, productoId: e.target.value})}
                      required
                    >
                      <option value="">-- Elige un producto --</option>
                      {productosCatalog.filter(p => p.activo).map(p => (
                        <option key={p.id} value={p.id}>{p.nombre}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {/* Rangos de monto eliminados */}

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
      {/* Producto Modal */}
      {showProductoModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md">
            <h3 className="text-xl font-bold mb-4">Nuevo Producto</h3>
            <form onSubmit={handleCrearProducto} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nombre del Producto</label>
                <input type="text" required className="w-full border border-gray-300 rounded px-3 py-2" value={nuevoProducto.nombre || ''} onChange={(e) => setNuevoProducto({...nuevoProducto, nombre: e.target.value})} />
              </div>

              <div className="flex gap-3 justify-end pt-4 border-t">
                <button type="button" onClick={() => setShowProductoModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded">Cancelar</button>
                <button type="submit" className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700">Guardar Producto</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;
