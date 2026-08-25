import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import type { Transaccion, Comercio } from '../types';
import {
  getDateRangeForMonth,
  getDateRangeBetween,
  filterTransactionsByTimeRange,
  calculateAdminComercioReport,
  calculateVendedorReport,
  calculateSuperAdminReport,
  isTransaccionInfluencer,
} from '../utils/reports';

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

const Reportes: React.FC = () => {
  const { userData } = useAuth();
  const [transaccionesRaw, setTransaccionesRaw] = useState<Transaccion[]>([]);
  const [comercios, setComercios] = useState<Comercio[]>([]);
  const [loading, setLoading] = useState(true);
  const [accesoDenegado, setAccesoDenegado] = useState(false);

  // Tipo de Filtro: 'MENSUAL' | 'RANGO'
  const [tipoFiltro, setTipoFiltro] = useState<'MENSUAL' | 'RANGO'>('MENSUAL');

  // Filtros de Fecha
  const hoy = new Date();
  const [selectedYear, setSelectedYear] = useState<number>(hoy.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(hoy.getMonth());

  const primerDiaMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0];
  const diaHoyStr = hoy.toISOString().split('T')[0];

  const [fechaInicioStr, setFechaInicioStr] = useState<string>(primerDiaMes);
  const [fechaFinStr, setFechaFinStr] = useState<string>(diaHoyStr);

  // Filtro de Comercio para SuperAdmin
  const [selectedComercioId, setSelectedComercioId] = useState<string>('TODOS');

  // Pestaña activa para Ránkings Top 20 en Admin Comercio
  const [topTab, setTopTab] = useState<'CONSUMO' | 'CANJE' | 'VENDEDORES' | 'INFLUENCERS'>('CONSUMO');

  // Modal de Detalle de Transacciones
  const [modalDetalle, setModalDetalle] = useState<{
    titulo: string;
    subtitulo: string;
    transacciones: Transaccion[];
  } | null>(null);

  const aniosDisponibles = useMemo(() => {
    const current = new Date().getFullYear();
    return [current - 2, current - 1, current, current + 1];
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      if (!userData) return;
      setLoading(true);
      try {
        if (userData.rol === 'superadmin') {
          const comSnap = await getDocs(collection(db, 'comercios'));
          const comsData: Comercio[] = comSnap.docs.map(doc => doc.data() as Comercio);
          setComercios(comsData);

          let q = collection(db, 'transacciones');
          if (selectedComercioId !== 'TODOS') {
            const txQuery = query(q, where('comercioId', '==', selectedComercioId));
            const txSnap = await getDocs(txQuery);
            setTransaccionesRaw(txSnap.docs.map(doc => doc.data() as Transaccion));
          } else {
            const txSnap = await getDocs(q);
            setTransaccionesRaw(txSnap.docs.map(doc => doc.data() as Transaccion));
          }
        } else if (userData.comercioId) {
          const comSnap = await getDocs(query(collection(db, 'comercios'), where('id', '==', userData.comercioId)));
          if (!comSnap.empty) {
            const comData = comSnap.docs[0].data() as Comercio;
            if (comData.plan !== 'premium') {
              setAccesoDenegado(true);
              setLoading(false);
              return;
            }
          }

          const q = query(
            collection(db, 'transacciones'),
            where('comercioId', '==', userData.comercioId)
          );
          const snapshot = await getDocs(q);
          const data = snapshot.docs.map(doc => doc.data() as Transaccion);
          setTransaccionesRaw(data);
        }
      } catch (error) {
        console.error("Error al cargar reportes:", error);
      }
      setLoading(false);
    };

    fetchData();
  }, [userData, selectedComercioId]);

  const transaccionesFiltradas = useMemo(() => {
    let range: { startMs: number; endMs: number };
    if (tipoFiltro === 'MENSUAL') {
      range = getDateRangeForMonth(selectedYear, selectedMonth);
    } else {
      if (!fechaInicioStr || !fechaFinStr) return transaccionesRaw;
      range = getDateRangeBetween(fechaInicioStr, fechaFinStr);
    }
    return filterTransactionsByTimeRange(transaccionesRaw, range.startMs, range.endMs);
  }, [transaccionesRaw, tipoFiltro, selectedYear, selectedMonth, fechaInicioStr, fechaFinStr]);

  const adminReport = useMemo(() => {
    return calculateAdminComercioReport(transaccionesFiltradas);
  }, [transaccionesFiltradas]);

  const vendedorReport = useMemo(() => {
    return calculateVendedorReport(transaccionesFiltradas, userData?.uid || '');
  }, [transaccionesFiltradas, userData]);

  const superAdminReport = useMemo(() => {
    return calculateSuperAdminReport(transaccionesFiltradas, comercios);
  }, [transaccionesFiltradas, comercios]);

  const exportarCSV = () => {
    const headers = ["ID", "Fecha", "Tipo", "Puntos", "Monto Factura", "Nro Factura", "Cliente", "Vendedor", "Comercio ID"];
    const rows = transaccionesFiltradas.map(t => [
      t.id,
      new Date(t.fechaHora).toLocaleString(),
      t.tipo,
      t.puntos,
      t.montoFactura || 0,
      t.nroFactura || '-',
      t.clienteAlias || t.clienteId,
      t.vendedorAlias || t.vendedorId,
      t.comercioId
    ]);

    const csvContent = "data:text/csv;charset=utf-8," 
      + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `reporte_puntosnb_${tipoFiltro.toLowerCase()}_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleAbrirDetalle = (tipo: 'CLIENTE' | 'VENDEDOR' | 'INFLUENCER', id: string, nombre: string) => {
    let txs: Transaccion[] = [];
    if (tipo === 'CLIENTE') {
      txs = transaccionesFiltradas.filter(t => t.clienteId === id);
    } else if (tipo === 'VENDEDOR') {
      txs = transaccionesFiltradas.filter(t => t.vendedorId === id && !isTransaccionInfluencer(t));
    } else if (tipo === 'INFLUENCER') {
      txs = transaccionesFiltradas.filter(t => (t.influencerId === id || t.vendedorId === id) && isTransaccionInfluencer(t));
    }
    txs.sort((a, b) => b.fechaHora - a.fechaHora);
    setModalDetalle({
      titulo: `Detalle de Transacciones: ${nombre}`,
      subtitulo: `${txs.length} transacciones registradas en este periodo`,
      transacciones: txs
    });
  };

  if (loading) {
    return (
      <div className="p-12 text-center text-gray-500 font-medium animate-pulse">
        Cargando reportes y procesando información...
      </div>
    );
  }

  if (accesoDenegado) {
    return (
      <div className="p-12 text-center max-w-lg mx-auto bg-white rounded-2xl border p-8 shadow-sm">
        <div className="w-16 h-16 mx-auto bg-purple-100 text-purple-600 rounded-full flex items-center justify-center mb-4 text-2xl font-black">
          💎
        </div>
        <h2 className="text-2xl font-bold text-gray-800 mb-2">Acceso Premium Requerido</h2>
        <p className="text-gray-600 mb-6 text-sm">El acceso a los reportes avanzados está disponible únicamente para comercios con plan Premium.</p>
        <p className="text-xs text-gray-400">Contacta a administración para activar las analíticas avanzadas.</p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Encabezado y Filtros */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100 pb-4">
          <div>
            <h2 className="text-2xl font-black text-gray-800 tracking-tight flex items-center gap-2">
              📊 Reportes y Estadísticas
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              {userData?.rol === 'admin_comercio' && 'Panel exclusivo de análisis y ránkings Top 20 con desglose transaccional.'}
              {userData?.rol === 'vendedor' && 'Resumen de puntos y premios gestionados por ti.'}
              {userData?.rol === 'superadmin' && 'Estadísticas globales del sistema y rendimiento por comercio.'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="px-3 py-1 rounded-full text-xs font-extrabold uppercase tracking-wider bg-brand-bg-light text-brand-primary border border-brand-border">
              {userData?.rol === 'admin_comercio' ? 'Admin Comercio' : userData?.rol === 'vendedor' ? 'Vendedor' : 'Superadmin'}
            </span>

            <button
              onClick={exportarCSV}
              className="px-3.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs rounded-lg transition flex items-center gap-1.5 cursor-pointer"
            >
              📥 Exportar CSV
            </button>
          </div>
        </div>

        {/* Barra de Filtros */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
          <div className="md:col-span-4 space-y-1">
            <label className="text-xs font-bold text-gray-600 uppercase tracking-wider block">Filtro Temporal</label>
            <div className="flex bg-gray-100 p-1 rounded-xl">
              <button
                onClick={() => setTipoFiltro('MENSUAL')}
                className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition ${
                  tipoFiltro === 'MENSUAL' ? 'bg-white text-brand-primary shadow-sm' : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                Resumen Mensual
              </button>
              <button
                onClick={() => setTipoFiltro('RANGO')}
                className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition ${
                  tipoFiltro === 'RANGO' ? 'bg-white text-brand-primary shadow-sm' : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                Entre Fechas
              </button>
            </div>
          </div>

          {tipoFiltro === 'MENSUAL' ? (
            <div className="md:col-span-5 grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-bold text-gray-600 uppercase tracking-wider block mb-1">Mes</label>
                <select
                  value={selectedMonth}
                  onChange={e => setSelectedMonth(Number(e.target.value))}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 text-sm font-semibold text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-primary"
                >
                  {MESES.map((mes, idx) => (
                    <option key={idx} value={idx}>{mes}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-gray-600 uppercase tracking-wider block mb-1">Año</label>
                <select
                  value={selectedYear}
                  onChange={e => setSelectedYear(Number(e.target.value))}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 text-sm font-semibold text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-primary"
                >
                  {aniosDisponibles.map(anio => (
                    <option key={anio} value={anio}>{anio}</option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <div className="md:col-span-5 grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-bold text-gray-600 uppercase tracking-wider block mb-1">Desde</label>
                <input
                  type="date"
                  value={fechaInicioStr}
                  onChange={e => setFechaInicioStr(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 text-sm font-semibold text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-primary"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-gray-600 uppercase tracking-wider block mb-1">Hasta</label>
                <input
                  type="date"
                  value={fechaFinStr}
                  onChange={e => setFechaFinStr(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 text-sm font-semibold text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-primary"
                />
              </div>
            </div>
          )}

          {userData?.rol === 'superadmin' && (
            <div className="md:col-span-3">
              <label className="text-xs font-bold text-gray-600 uppercase tracking-wider block mb-1">Comercio</label>
              <select
                value={selectedComercioId}
                onChange={e => setSelectedComercioId(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 text-sm font-semibold text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-primary"
              >
                <option value="TODOS">Todos los Comercios</option>
                {comercios.map(c => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* VISTA 1: ADMIN DE COMERCIO */}
      {/* ========================================================================= */}
      {userData?.rol === 'admin_comercio' && (
        <div className="space-y-6">
          {/* Tarjetas KPI */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm text-center">
              <p className="text-xs font-extrabold text-blue-600 uppercase tracking-wider mb-1">Usuarios Activos</p>
              <p className="text-3xl font-black text-gray-800">{adminReport.usuariosUnicos}</p>
              <p className="text-[11px] text-gray-400 mt-1">accedieron a puntos</p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm text-center">
              <p className="text-xs font-extrabold text-green-600 uppercase tracking-wider mb-1">Puntos Generados</p>
              <p className="text-3xl font-black text-green-600">+{adminReport.puntosGenerados}</p>
              <p className="text-[11px] text-gray-400 mt-1">${adminReport.montoFacturadoTotal.toLocaleString()} facturados</p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm text-center">
              <p className="text-xs font-extrabold text-purple-600 uppercase tracking-wider mb-1">Premios Canjeados</p>
              <p className="text-3xl font-black text-purple-600">{adminReport.premiosCanjeadosCount}</p>
              <p className="text-[11px] text-gray-400 mt-1">{adminReport.puntosCanjeados} pts consumidos</p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm text-center">
              <p className="text-xs font-extrabold text-amber-600 uppercase tracking-wider mb-1">Monto Facturado</p>
              <p className="text-3xl font-black text-amber-600">${adminReport.montoFacturadoTotal.toLocaleString()}</p>
              <p className="text-[11px] text-gray-400 mt-1">en ventas registradas</p>
            </div>
          </div>

          {/* Ránkings Top 20 con 4 Pestañas */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-4 bg-gray-50 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-extrabold text-gray-800 text-base">Ránkings y Analítica Top 20</h3>
              <div className="flex flex-wrap bg-gray-200 p-0.5 rounded-lg text-xs font-bold gap-1">
                <button
                  onClick={() => setTopTab('CONSUMO')}
                  className={`px-3 py-1.5 rounded-md transition ${topTab === 'CONSUMO' ? 'bg-white text-brand-primary shadow-sm' : 'text-gray-600'}`}
                >
                  Top Clientes (Consumo)
                </button>
                <button
                  onClick={() => setTopTab('CANJE')}
                  className={`px-3 py-1.5 rounded-md transition ${topTab === 'CANJE' ? 'bg-white text-brand-primary shadow-sm' : 'text-gray-600'}`}
                >
                  Top Clientes (Canjes)
                </button>
                <button
                  onClick={() => setTopTab('VENDEDORES')}
                  className={`px-3 py-1.5 rounded-md transition ${topTab === 'VENDEDORES' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600'}`}
                >
                  🏆 Top 20 Vendedores
                </button>
                <button
                  onClick={() => setTopTab('INFLUENCERS')}
                  className={`px-3 py-1.5 rounded-md transition ${topTab === 'INFLUENCERS' ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-600'}`}
                >
                  🌟 Top 20 Influencers
                </button>
              </div>
            </div>

            {/* TAB 1: TOP CONSUMO */}
            {topTab === 'CONSUMO' && (
              adminReport.topUsuariosConsumo.length === 0 ? (
                <div className="p-8 text-center text-gray-400 text-sm">No hay transacciones de consumo en este periodo.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 text-gray-500 text-xs font-bold uppercase tracking-wider">
                      <tr>
                        <th className="px-4 py-3 text-center">#</th>
                        <th className="px-4 py-3">Cliente</th>
                        <th className="px-4 py-3">Monto Facturado</th>
                        <th className="px-4 py-3">Puntos Acumulados</th>
                        <th className="px-4 py-3">Compras</th>
                        <th className="px-4 py-3 text-right">Detalle</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {adminReport.topUsuariosConsumo.map((usr, idx) => (
                        <tr key={usr.clienteId} className="hover:bg-gray-50 transition">
                          <td className="px-4 py-3 text-center font-black text-gray-400">{idx + 1}</td>
                          <td className="px-4 py-3 font-bold text-gray-800">{usr.clienteAlias}</td>
                          <td className="px-4 py-3 font-black text-green-700">${usr.totalMonto.toLocaleString()}</td>
                          <td className="px-4 py-3 font-semibold text-gray-700">+{usr.totalPuntos} pts</td>
                          <td className="px-4 py-3 text-gray-500">{usr.cantidadTransacciones} tx</td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => handleAbrirDetalle('CLIENTE', usr.clienteId, usr.clienteAlias)}
                              className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-2.5 py-1 rounded font-bold transition cursor-pointer"
                            >
                              Ver Detalle
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}

            {/* TAB 2: TOP CANJES */}
            {topTab === 'CANJE' && (
              adminReport.topUsuariosCanje.length === 0 ? (
                <div className="p-8 text-center text-gray-400 text-sm">No hay canjes de premios en este periodo.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 text-gray-500 text-xs font-bold uppercase tracking-wider">
                      <tr>
                        <th className="px-4 py-3 text-center">#</th>
                        <th className="px-4 py-3">Cliente</th>
                        <th className="px-4 py-3">Premios Canjeados</th>
                        <th className="px-4 py-3">Puntos Consumidos</th>
                        <th className="px-4 py-3 text-right">Detalle</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {adminReport.topUsuariosCanje.map((usr, idx) => (
                        <tr key={usr.clienteId} className="hover:bg-gray-50 transition">
                          <td className="px-4 py-3 text-center font-black text-gray-400">{idx + 1}</td>
                          <td className="px-4 py-3 font-bold text-gray-800">{usr.clienteAlias}</td>
                          <td className="px-4 py-3 font-black text-purple-700">{usr.totalCanjes} canjes</td>
                          <td className="px-4 py-3 font-semibold text-gray-700">{usr.totalPuntosCanjeados} pts</td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => handleAbrirDetalle('CLIENTE', usr.clienteId, usr.clienteAlias)}
                              className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-2.5 py-1 rounded font-bold transition cursor-pointer"
                            >
                              Ver Detalle
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}

            {/* TAB 3: TOP 20 VENDEDORES */}
            {topTab === 'VENDEDORES' && (
              adminReport.topVendedores.length === 0 ? (
                <div className="p-8 text-center text-gray-400 text-sm">No hay transacciones registradas por vendedores en este periodo.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-blue-50 text-blue-900 text-xs font-bold uppercase tracking-wider">
                      <tr>
                        <th className="px-4 py-3 text-center">#</th>
                        <th className="px-4 py-3">Vendedor</th>
                        <th className="px-4 py-3">Monto Facturado</th>
                        <th className="px-4 py-3">Puntos Emitidos</th>
                        <th className="px-4 py-3">Ventas</th>
                        <th className="px-4 py-3">Premios Validados</th>
                        <th className="px-4 py-3 text-right">Detalle</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {adminReport.topVendedores.map((vend, idx) => (
                        <tr key={vend.vendedorId} className="hover:bg-blue-50/40 transition">
                          <td className="px-4 py-3 text-center font-black text-blue-400">{idx + 1}</td>
                          <td className="px-4 py-3 font-bold text-gray-800">{vend.vendedorAlias}</td>
                          <td className="px-4 py-3 font-black text-green-700">${vend.totalMonto.toLocaleString()}</td>
                          <td className="px-4 py-3 font-bold text-blue-600">+{vend.totalPuntos} pts</td>
                          <td className="px-4 py-3 text-gray-600">{vend.cantidadTransacciones} ventas</td>
                          <td className="px-4 py-3 text-purple-600 font-semibold">{vend.premiosEntregados} canjes</td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => handleAbrirDetalle('VENDEDOR', vend.vendedorId, vend.vendedorAlias)}
                              className="text-xs bg-blue-100 hover:bg-blue-200 text-blue-800 px-2.5 py-1 rounded font-bold transition cursor-pointer"
                            >
                              Ver Detalle
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}

            {/* TAB 4: TOP 20 INFLUENCERS */}
            {topTab === 'INFLUENCERS' && (
              adminReport.topInfluencers.length === 0 ? (
                <div className="p-8 text-center text-gray-400 text-sm">No hay canjes de códigos de influencers en este periodo.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-purple-50 text-purple-900 text-xs font-bold uppercase tracking-wider">
                      <tr>
                        <th className="px-4 py-3 text-center">#</th>
                        <th className="px-4 py-3">Influencer</th>
                        <th className="px-4 py-3">Código de Campaña</th>
                        <th className="px-4 py-3">Canjes de Seguidores</th>
                        <th className="px-4 py-3">Puntos Repartidos</th>
                        <th className="px-4 py-3 text-right">Detalle</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {adminReport.topInfluencers.map((inf, idx) => (
                        <tr key={inf.influencerId} className="hover:bg-purple-50/40 transition">
                          <td className="px-4 py-3 text-center font-black text-purple-400">{idx + 1}</td>
                          <td className="px-4 py-3 font-bold text-gray-800">{inf.influencerAlias}</td>
                          <td className="px-4 py-3 font-mono font-bold text-purple-700">{inf.codigoId || 'CÓDIGO ACTIVO'}</td>
                          <td className="px-4 py-3 font-black text-purple-700">{inf.cantidadCanjes} canjes</td>
                          <td className="px-4 py-3 font-semibold text-gray-700">{inf.puntosOtorgados} pts</td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => handleAbrirDetalle('INFLUENCER', inf.influencerId, inf.influencerAlias)}
                              className="text-xs bg-purple-100 hover:bg-purple-200 text-purple-800 px-2.5 py-1 rounded font-bold transition cursor-pointer"
                            >
                              Ver Detalle
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}

          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* VISTA 2: VENDEDOR DE COMERCIO */}
      {/* ========================================================================= */}
      {userData?.rol === 'vendedor' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm text-center">
              <p className="text-xs font-extrabold text-blue-600 uppercase tracking-wider mb-1">Puntos Otorgados</p>
              <p className="text-3xl font-black text-blue-600">+{vendedorReport.puntosGenerados}</p>
              <p className="text-[11px] text-gray-400 mt-1">{vendedorReport.cantidadAcumulaciones} operaciones</p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm text-center">
              <p className="text-xs font-extrabold text-green-600 uppercase tracking-wider mb-1">Monto Facturado</p>
              <p className="text-3xl font-black text-green-600">${vendedorReport.montoFacturado.toLocaleString()}</p>
              <p className="text-[11px] text-gray-400 mt-1">en ventas registradas</p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm text-center">
              <p className="text-xs font-extrabold text-purple-600 uppercase tracking-wider mb-1">Premios Entregados</p>
              <p className="text-3xl font-black text-purple-600">{vendedorReport.premiosCanjeadosCount}</p>
              <p className="text-[11px] text-gray-400 mt-1">{vendedorReport.puntosCanjeados} pts canjeados</p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm text-center">
              <p className="text-xs font-extrabold text-amber-600 uppercase tracking-wider mb-1">Total Operaciones</p>
              <p className="text-3xl font-black text-amber-600">{vendedorReport.transaccionesVendedor.length}</p>
              <p className="text-[11px] text-gray-400 mt-1">en este periodo</p>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* VISTA 3: SUPERADMIN */}
      {/* ========================================================================= */}
      {userData?.rol === 'superadmin' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm text-center">
              <p className="text-xs font-extrabold text-blue-600 uppercase tracking-wider mb-1">Comercios Activos</p>
              <p className="text-3xl font-black text-gray-800">{superAdminReport.totalComerciosActivos} / {superAdminReport.totalComercios}</p>
              <p className="text-[11px] text-gray-400 mt-1">con actividad registrada</p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm text-center">
              <p className="text-xs font-extrabold text-green-600 uppercase tracking-wider mb-1">Puntos Globales</p>
              <p className="text-3xl font-black text-green-600">+{superAdminReport.totalPuntosOtorgados}</p>
              <p className="text-[11px] text-gray-400 mt-1">emitidos en el periodo</p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm text-center">
              <p className="text-xs font-extrabold text-purple-600 uppercase tracking-wider mb-1">Premios Globales</p>
              <p className="text-3xl font-black text-purple-600">{superAdminReport.totalPremiosCanjeadosCount}</p>
              <p className="text-[11px] text-gray-400 mt-1">{superAdminReport.totalPuntosCanjeados} pts canjeados</p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm text-center">
              <p className="text-xs font-extrabold text-amber-600 uppercase tracking-wider mb-1">Transacciones</p>
              <p className="text-3xl font-black text-amber-600">{transaccionesFiltradas.length}</p>
              <p className="text-[11px] text-gray-400 mt-1">en total registradas</p>
            </div>
          </div>

          {/* Desglose Detallado de Actividad por Comercio */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden p-6 space-y-4">
            <div className="flex justify-between items-center border-b pb-3">
              <div>
                <h3 className="text-base font-black text-gray-800">Detalle de Actividad por Comercio</h3>
                <p className="text-xs text-gray-500">Métricas transaccionales y de emisión de cada comercio registrado</p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 text-gray-500 font-bold uppercase">
                  <tr>
                    <th className="px-4 py-3">Comercio</th>
                    <th className="px-4 py-3">NIT</th>
                    <th className="px-4 py-3 text-center">Clientes Únicos</th>
                    <th className="px-4 py-3 text-center">Transacciones</th>
                    <th className="px-4 py-3 text-center">Puntos Emitidos</th>
                    <th className="px-4 py-3 text-center">Premios Entregados</th>
                    <th className="px-4 py-3 text-right">Detalle</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {superAdminReport.comerciosActividad.map((ca) => (
                    <tr key={ca.comercioId} className="hover:bg-gray-50 transition">
                      <td className="px-4 py-3 font-bold text-gray-800 flex items-center gap-2">
                        {ca.nombreComercio}
                        {!ca.tieneActividad && (
                          <span className="text-[10px] bg-gray-100 text-gray-400 px-2 py-0.5 rounded font-normal">Sin actividad</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-gray-500">{ca.nitRut}</td>
                      <td className="px-4 py-3 text-center font-bold text-gray-700">{ca.usuariosUnicos}</td>
                      <td className="px-4 py-3 text-center font-bold text-gray-700">{ca.transaccionesCount}</td>
                      <td className="px-4 py-3 text-center font-black text-green-600">+{ca.puntosOtorgados}</td>
                      <td className="px-4 py-3 text-center font-black text-purple-600">{ca.premiosCanjeadosCount}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          disabled={!ca.tieneActividad}
                          onClick={() => {
                            const txsCom = transaccionesFiltradas.filter(t => t.comercioId === ca.comercioId);
                            txsCom.sort((a, b) => b.fechaHora - a.fechaHora);
                            setModalDetalle({
                              titulo: `Detalle de Comercio: ${ca.nombreComercio}`,
                              subtitulo: `${txsCom.length} transacciones registradas en este periodo`,
                              transacciones: txsCom
                            });
                          }}
                          className={`text-xs px-2.5 py-1 rounded font-bold transition cursor-pointer ${ca.tieneActividad ? 'bg-brand-primary text-white hover:bg-brand-primary-hover' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
                        >
                          Ver Transacciones
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Detalle Transaccional */}
      {modalDetalle && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-gray-100 max-w-2xl w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b pb-3">
              <div>
                <h3 className="text-lg font-black text-gray-800">{modalDetalle.titulo}</h3>
                <p className="text-xs text-gray-500">{modalDetalle.subtitulo}</p>
              </div>
              <button 
                onClick={() => setModalDetalle(null)}
                className="text-gray-400 font-bold hover:text-black p-1"
              >
                ✕
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 text-gray-500 font-bold uppercase">
                  <tr>
                    <th className="px-3 py-2">Fecha / Hora</th>
                    <th className="px-3 py-2">Tipo</th>
                    <th className="px-3 py-2">Factura</th>
                    <th className="px-3 py-2">Monto ($)</th>
                    <th className="px-3 py-2">Puntos</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {modalDetalle.transacciones.map(t => (
                    <tr key={t.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium text-gray-700">{new Date(t.fechaHora).toLocaleString()}</td>
                      <td className="px-3 py-2">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${t.tipo === 'ACUMULACION' ? 'bg-green-100 text-green-800' : 'bg-purple-100 text-purple-800'}`}>
                          {t.tipo}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-gray-600">{t.nroFactura || '-'}</td>
                      <td className="px-3 py-2 font-bold">${(t.montoFactura || 0).toLocaleString()}</td>
                      <td className={`px-3 py-2 font-black ${t.tipo === 'ACUMULACION' ? 'text-green-600' : 'text-red-600'}`}>
                        {t.tipo === 'ACUMULACION' ? '+' : '-'}{t.puntos} pts
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end pt-3 border-t">
              <button
                onClick={() => setModalDetalle(null)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold text-xs rounded-lg transition"
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

export default Reportes;
