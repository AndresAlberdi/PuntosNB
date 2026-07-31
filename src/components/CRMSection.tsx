import React, { useEffect, useState } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import type { Transaccion } from '../types';
import { 
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer 
} from 'recharts';
import { format } from 'date-fns';

interface CRMSectionProps {
  comercioId: string;
}

export const CRMSection: React.FC<CRMSectionProps> = ({ comercioId }) => {
  const [transacciones, setTransacciones] = useState<Transaccion[]>([]);
  const [loading, setLoading] = useState(true);
  const [agrupacion, setAgrupacion] = useState<'dia' | 'semana' | 'mes'>('dia');

  useEffect(() => {
    const fetchTransacciones = async () => {
      setLoading(true);
      try {
        const q = query(
          collection(db, 'transacciones'),
          where('comercioId', '==', comercioId)
        );
        const snapshot = await getDocs(q);
        const data = snapshot.docs.map(doc => doc.data() as Transaccion).sort((a, b) => a.fechaHora - b.fechaHora);
        setTransacciones(data);
      } catch (err) {
        console.error("Error fetching CRM data:", err);
      }
      setLoading(false);
    };

    if (comercioId) {
      fetchTransacciones();
    }
  }, [comercioId]);

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Cargando métricas CRM...</div>;
  }

  // --- Calculations ---
  let totalPuntosEmitidos = 0;
  let totalPremiosEntregados = 0;

  const sellersMap: Record<string, { alias: string, puntos: number }> = {};
  const clientsMap: Record<string, { alias: string, puntos: number, canjes: number }> = {};

  transacciones.forEach(t => {
    if (t.tipo === 'ACUMULACION') {
      totalPuntosEmitidos += (t.puntos || 0);

      if (t.vendedorId) {
        if (!sellersMap[t.vendedorId]) sellersMap[t.vendedorId] = { alias: t.vendedorAlias || t.vendedorId, puntos: 0 };
        sellersMap[t.vendedorId].puntos += (t.puntos || 0);
      }

      if (t.clienteId) {
        if (!clientsMap[t.clienteId]) clientsMap[t.clienteId] = { alias: t.clienteAlias || t.clienteId, puntos: 0, canjes: 0 };
        clientsMap[t.clienteId].puntos += (t.puntos || 0);
      }
    } else if (t.tipo === 'CANJE') {
      totalPremiosEntregados += 1;
      
      if (t.clienteId) {
        if (!clientsMap[t.clienteId]) clientsMap[t.clienteId] = { alias: t.clienteAlias || t.clienteId, puntos: 0, canjes: 0 };
        clientsMap[t.clienteId].canjes += 1;
      }
    }
  });

  const topSellers = Object.values(sellersMap).sort((a, b) => b.puntos - a.puntos).slice(0, 3);
  const topClients = Object.values(clientsMap).sort((a, b) => b.puntos - a.puntos).slice(0, 5);

  // Chart Data preparation
  const chartDataMap: Record<string, { date: string, label: string, Puntos: number, Canjes: number }> = {};

  transacciones.forEach(t => {
    const dateObj = new Date(t.fechaHora);
    let key = '';
    let label = '';

    if (agrupacion === 'dia') {
      key = format(dateObj, 'yyyy-MM-dd');
      label = format(dateObj, 'dd MMM');
    } else if (agrupacion === 'semana') {
      key = format(dateObj, 'yyyy-ww');
      label = `Semana ${format(dateObj, 'ww')}`;
    } else {
      key = format(dateObj, 'yyyy-MM');
      label = format(dateObj, 'MMM yyyy');
    }

    if (!chartDataMap[key]) {
      chartDataMap[key] = { date: key, label, Puntos: 0, Canjes: 0 };
    }

    if (t.tipo === 'ACUMULACION') {
      chartDataMap[key].Puntos += (t.puntos || 0);
    } else if (t.tipo === 'CANJE') {
      chartDataMap[key].Canjes += 1;
    }
  });

  const chartData = Object.values(chartDataMap).sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center text-center">
          <span className="text-sm text-gray-500 font-medium">Puntos Emitidos</span>
          <span className="text-3xl font-bold text-blue-600 mt-2">{totalPuntosEmitidos}</span>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center text-center">
          <span className="text-sm text-gray-500 font-medium">Premios Entregados</span>
          <span className="text-3xl font-bold text-yellow-600 mt-2">{totalPremiosEntregados}</span>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center text-center">
          <span className="text-sm text-gray-500 font-medium">Top Vendedor</span>
          <span className="text-xl font-bold text-gray-800 mt-2 truncate w-full" title={topSellers[0]?.alias || '-'}>
            {topSellers[0]?.alias || '-'}
          </span>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center text-center">
          <span className="text-sm text-gray-500 font-medium">Top Cliente</span>
          <span className="text-xl font-bold text-gray-800 mt-2 truncate w-full" title={topClients[0]?.alias || '-'}>
            {topClients[0]?.alias || '-'}
          </span>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Top Sellers */}
        <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-bold text-gray-800 mb-4 border-b pb-2">🏆 Top 3 Vendedores</h3>
          {topSellers.length === 0 ? (
            <p className="text-gray-500 text-sm">Sin datos aún.</p>
          ) : (
            <ul className="space-y-3">
              {topSellers.map((s, idx) => (
                <li key={idx} className="flex justify-between items-center bg-gray-50 p-2 rounded">
                  <span className="font-medium text-gray-700">{idx + 1}. {s.alias}</span>
                  <span className="text-blue-600 font-bold">{s.puntos} pts</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Top Clients */}
        <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-bold text-gray-800 mb-4 border-b pb-2">🌟 Top 5 Clientes</h3>
          {topClients.length === 0 ? (
            <p className="text-gray-500 text-sm">Sin datos aún.</p>
          ) : (
            <ul className="space-y-3">
              {topClients.map((c, idx) => (
                <li key={idx} className="flex justify-between items-center bg-gray-50 p-2 rounded">
                  <span className="font-medium text-gray-700">{idx + 1}. {c.alias}</span>
                  <span className="text-green-600 font-bold text-sm text-right">
                    {c.puntos} pts <br/> <span className="text-xs text-gray-500">{c.canjes} canjes</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Chart */}
      <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-lg font-bold text-gray-800">📈 Actividad del Comercio</h3>
          <select 
            className="border-gray-300 rounded-md text-sm border p-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
            value={agrupacion}
            onChange={(e) => setAgrupacion(e.target.value as any)}
          >
            <option value="dia">Diaria</option>
            <option value="semana">Semanal</option>
            <option value="mes">Mensual</option>
          </select>
        </div>
        
        {chartData.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-gray-500">No hay actividad registrada.</div>
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={chartData}
                margin={{ top: 20, right: 20, bottom: 20, left: 20 }}
              >
                <CartesianGrid stroke="#f5f5f5" />
                <XAxis dataKey="label" scale="band" />
                <YAxis yAxisId="left" orientation="left" stroke="#2563eb" label={{ value: 'Puntos', angle: -90, position: 'insideLeft' }} />
                <YAxis yAxisId="right" orientation="right" stroke="#d97706" label={{ value: 'Canjes', angle: 90, position: 'insideRight' }} />
                <Tooltip />
                <Legend />
                <Bar yAxisId="left" dataKey="Puntos" barSize={20} fill="#3b82f6" />
                <Line yAxisId="right" type="monotone" dataKey="Canjes" stroke="#f59e0b" strokeWidth={3} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
};
