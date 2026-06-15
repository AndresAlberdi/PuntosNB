import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import type { Transaccion } from '../types';

const Reportes: React.FC = () => {
  const { userData } = useAuth();
  const [transacciones, setTransacciones] = useState<Transaccion[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTransacciones = async () => {
      if (!userData?.comercioId) return;
      try {
        const q = query(
          collection(db, 'transacciones'), 
          where('comercioId', '==', userData.comercioId)
        );
        const snapshot = await getDocs(q);
        const data = snapshot.docs.map(doc => doc.data() as Transaccion);
        // Order locally if index is not created
        data.sort((a, b) => b.fechaHora - a.fechaHora);
        setTransacciones(data);
      } catch (error) {
        console.error("Error fetching reportes:", error);
      }
      setLoading(false);
    };

    fetchTransacciones();
  }, [userData]);

  if (loading) return <div className="p-8 text-center">Cargando reportes...</div>;

  const totalPuntosEmitidos = transacciones.filter(t => t.tipo === 'ACUMULACION').reduce((acc, t) => acc + t.puntos, 0);
  const totalPuntosCanjeados = transacciones.filter(t => t.tipo === 'CANJE').reduce((acc, t) => acc + t.puntos, 0);

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Reportes y Estadísticas</h2>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-8">
        <div className="bg-green-50 border border-green-100 p-6 rounded-xl text-center">
          <p className="text-sm font-bold text-green-800 uppercase mb-1">Total Puntos Emitidos</p>
          <p className="text-3xl font-black text-green-600">{totalPuntosEmitidos}</p>
        </div>
        <div className="bg-purple-50 border border-purple-100 p-6 rounded-xl text-center">
          <p className="text-sm font-bold text-purple-800 uppercase mb-1">Total Puntos Canjeados</p>
          <p className="text-3xl font-black text-purple-600">{totalPuntosCanjeados}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <h3 className="text-lg font-bold p-4 bg-gray-50 border-b border-gray-100">Historial de Transacciones</h3>
        
        {transacciones.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No hay transacciones registradas.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-gray-600 font-medium">
                <tr>
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3">Puntos</th>
                  <th className="px-4 py-3">Cliente</th>
                  <th className="px-4 py-3">Vendedor</th>
                  <th className="px-4 py-3">Factura</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {transacciones.map(t => (
                  <tr key={t.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">{new Date(t.fechaHora).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded text-xs font-bold ${t.tipo === 'ACUMULACION' ? 'bg-green-100 text-green-800' : 'bg-purple-100 text-purple-800'}`}>
                        {t.tipo}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-bold">{t.puntos}</td>
                    <td className="px-4 py-3 font-medium text-gray-800">{t.clienteAlias || t.clienteId.slice(0, 5) + '...'}</td>
                    <td className="px-4 py-3 font-medium text-gray-800">{t.vendedorAlias || t.vendedorId.slice(0, 5) + '...'}</td>
                    <td className="px-4 py-3">{t.nroFactura || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default Reportes;
