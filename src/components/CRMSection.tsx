import React, { useEffect, useState } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import type { Transaccion, InfluencerPublico } from '../types';
import { isTransaccionInfluencer } from '../utils/reports';
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend } from 'recharts';
import { format } from 'date-fns';

/** Granularidad del eje temporal del grafico de actividad. */
type Agrupacion = 'dia' | 'semana' | 'mes';

interface CRMSectionProps {
  comercioId: string;
}

export const CRMSection: React.FC<CRMSectionProps> = ({ comercioId }) => {
  const [transacciones, setTransacciones] = useState<Transaccion[]>([]);
  const [influencersMapData, setInfluencersMapData] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [agrupacion, setAgrupacion] = useState<Agrupacion>('dia');

  useEffect(() => {
    const fetchTransacciones = async () => {
      try {
        const q = query(collection(db, 'transacciones'), where('comercioId', '==', comercioId));
        const snap = await getDocs(q);
        const data: Transaccion[] = [];
        snap.forEach(doc => data.push({ id: doc.id, ...doc.data() } as Transaccion));
        setTransacciones(data);

        // Cargar nombres de influencers para mapeo
        // Los nombres salen del perfil público del influencer: el documento completo de `users`
        // ya no es legible para el comercio (H-16).
        const snapUsers = await getDocs(collection(db, 'influencers_publico'));
        const uMap: Record<string, string> = {};
        snapUsers.forEach(d => {
          const u = d.data() as InfluencerPublico;
          uMap[u.uid] = u.nombre || u.uid.slice(0, 6);
        });
        setInfluencersMapData(uMap);

      } catch (err) {
        console.error("Error cargando transacciones para CRM:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchTransacciones();
  }, [comercioId]);

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Cargando métricas CRM...</div>;
  }

  // --- Calculations ---
  let totalPuntosEmitidos = 0;
  let totalPremiosEntregados = 0;

  const sellersMap: Record<string, { alias: string, puntos: number, monto: number, txs: number }> = {};
  const influencersMap: Record<string, { alias: string, codigoId?: string, puntos: number, canjes: number }> = {};
  const clientsMap: Record<string, { alias: string, puntos: number, canjes: number }> = {};

  transacciones.forEach(t => {
    const esInfluencer = isTransaccionInfluencer(t);

    if (t.tipo === 'ACUMULACION') {
      totalPuntosEmitidos += (t.puntos || 0);

      // Separación Vendedores vs Influencers
      if (esInfluencer) {
        const infId = t.influencerId || t.vendedorId || 'inf_desconocido';
        const realName = influencersMapData[infId];
        const infAlias = realName || ((t.vendedorAlias && t.vendedorAlias !== 'INFLUENCER') ? t.vendedorAlias : (t.influencerId ? t.influencerId.slice(0, 6) : 'Influencer'));
        if (!influencersMap[infId]) {
          influencersMap[infId] = { alias: infAlias, codigoId: t.codigoId, puntos: 0, canjes: 0 };
        }
        influencersMap[infId].puntos += (t.puntos || 0);
        influencersMap[infId].canjes += 1;
        if (t.codigoId) influencersMap[infId].codigoId = t.codigoId;
      } else if (t.vendedorId) {
        if (!sellersMap[t.vendedorId]) {
          sellersMap[t.vendedorId] = { alias: t.vendedorAlias || t.vendedorId, puntos: 0, monto: 0, txs: 0 };
        }
        sellersMap[t.vendedorId].puntos += (t.puntos || 0);
        sellersMap[t.vendedorId].monto += (t.montoFactura || 0);
        sellersMap[t.vendedorId].txs += 1;
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
  const topInfluencers = Object.values(influencersMap).sort((a, b) => b.canjes - a.canjes || b.puntos - a.puntos).slice(0, 3);
  const topClients = Object.values(clientsMap).sort((a, b) => b.puntos - a.puntos).slice(0, 5);

  // Chart Data preparation
  const chartDataMap: Record<string, { date: string, label: string, Puntos: number, Canjes: number }> = {};

  transacciones.forEach(t => {
    const dateObj = new Date(t.fechaHora);
    let key: string;
    let label: string;

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
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Puntos Emitidos</span>
          <span className="text-3xl font-black text-blue-600 mt-1">{totalPuntosEmitidos}</span>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center text-center">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Premios Entregados</span>
          <span className="text-3xl font-black text-amber-600 mt-1">{totalPremiosEntregados}</span>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center text-center">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Top Vendedor</span>
          <span className="text-lg font-black text-gray-800 mt-1 truncate w-full" title={topSellers[0]?.alias || '-'}>
            {topSellers[0]?.alias || '-'}
          </span>
          <span className="text-[10px] text-gray-400">{topSellers[0] ? `${topSellers[0].puntos} pts (${topSellers[0].txs} ventas)` : 'Sin ventas'}</span>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center text-center">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Top Influencer</span>
          <span className="text-lg font-black text-purple-700 mt-1 truncate w-full" title={topInfluencers[0]?.alias || '-'}>
            {topInfluencers[0]?.alias || '-'}
          </span>
          <span className="text-[10px] text-gray-400">{topInfluencers[0] ? `${topInfluencers[0].canjes} canjes (${topInfluencers[0].puntos} pts)` : 'Sin canjes'}</span>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        {/* Top 3 Sellers */}
        <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 flex flex-col justify-between">
          <div>
            <h3 className="text-base font-extrabold text-gray-800 mb-3 border-b pb-2 flex items-center gap-1.5">
              <span>🏆</span> Top 3 Vendedores
            </h3>
            {topSellers.length === 0 ? (
              <p className="text-gray-400 text-xs py-4 text-center">Sin transacciones de vendedores aún.</p>
            ) : (
              <ul className="space-y-2">
                {topSellers.map((s, idx) => (
                  <li key={idx} className="flex justify-between items-center bg-gray-50 p-2.5 rounded-lg text-xs">
                    <div>
                      <span className="font-bold text-gray-800 block">{idx + 1}. {s.alias}</span>
                      <span className="text-[10px] text-gray-500">${s.monto.toLocaleString()} facturados ({s.txs} ventas)</span>
                    </div>
                    <span className="text-blue-600 font-black text-sm">+{s.puntos} pts</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Top 3 Influencers */}
        <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 flex flex-col justify-between">
          <div>
            <h3 className="text-base font-extrabold text-purple-900 mb-3 border-b pb-2 flex items-center gap-1.5">
              <span>🌟</span> Top 3 Influencers
            </h3>
            {topInfluencers.length === 0 ? (
              <p className="text-gray-400 text-xs py-4 text-center">Sin canjes de influencers aún.</p>
            ) : (
              <ul className="space-y-2">
                {topInfluencers.map((inf, idx) => (
                  <li key={idx} className="flex justify-between items-center bg-purple-50/60 p-2.5 rounded-lg text-xs border border-purple-100">
                    <div>
                      <span className="font-bold text-purple-900 block">{idx + 1}. {inf.alias}</span>
                      <span className="text-[10px] text-purple-700 font-mono">CÓD: {inf.codigoId || 'ACTIVO'} ({inf.canjes} seguidores)</span>
                    </div>
                    <span className="text-purple-700 font-black text-sm">{inf.puntos} pts</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Top 5 Clients */}
        <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 flex flex-col justify-between">
          <div>
            <h3 className="text-base font-extrabold text-gray-800 mb-3 border-b pb-2 flex items-center gap-1.5">
              <span>👥</span> Top Clientes
            </h3>
            {topClients.length === 0 ? (
              <p className="text-gray-400 text-xs py-4 text-center">Sin actividad de clientes aún.</p>
            ) : (
              <ul className="space-y-2">
                {topClients.map((c, idx) => (
                  <li key={idx} className="flex justify-between items-center bg-gray-50 p-2.5 rounded-lg text-xs">
                    <span className="font-medium text-gray-700">{idx + 1}. {c.alias}</span>
                    <span className="text-green-600 font-bold text-right">
                      +{c.puntos} pts <span className="text-[10px] text-gray-400 block">{c.canjes} canjes</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h3 className="text-base font-bold text-gray-800">📈 Actividad del Comercio</h3>
            <p className="text-xs text-gray-400">Puntos emitidos (Barras) y Canjes de Premios (Línea)</p>
          </div>
          <select 
            className="border-gray-300 rounded-md text-xs font-semibold border p-1 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
            value={agrupacion}
            onChange={(e) => setAgrupacion(e.target.value as Agrupacion)}
          >
            <option value="dia">Por Día</option>
            <option value="semana">Por Semana</option>
            <option value="mes">Por Mes</option>
          </select>
        </div>
        
        <div className="h-64 w-full">
          {chartData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-gray-400 text-sm">
              No hay datos suficientes para graficar.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData}>
                <XAxis dataKey="label" fontSize={12} tickLine={false} />
                <YAxis yAxisId="left" fontSize={12} tickLine={false} />
                <YAxis yAxisId="right" orientation="right" fontSize={12} tickLine={false} />
                <Tooltip />
                <Legend />
                <Bar yAxisId="left" dataKey="Puntos" fill="#3B82F6" radius={[4, 4, 0, 0]} name="Puntos Emitidos" />
                <Line yAxisId="right" type="monotone" dataKey="Canjes" stroke="#EAB308" strokeWidth={3} dot={{ fill: '#EAB308', r: 4 }} activeDot={{ r: 6 }} name="Canjes de Premios" />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
};
