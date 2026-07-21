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

  // Tipo de Filtro: 'MENSUAL' | 'RANGO'
  const [tipoFiltro, setTipoFiltro] = useState<'MENSUAL' | 'RANGO'>('MENSUAL');

  // Filtros de Fecha
  const hoy = new Date();
  const [selectedYear, setSelectedYear] = useState<number>(hoy.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(hoy.getMonth());

  // Formato YYYY-MM-DD
  const primerDiaMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0];
  const diaHoyStr = hoy.toISOString().split('T')[0];

  const [fechaInicioStr, setFechaInicioStr] = useState<string>(primerDiaMes);
  const [fechaFinStr, setFechaFinStr] = useState<string>(diaHoyStr);

  // Filtro de Comercio para SuperAdmin
  const [selectedComercioId, setSelectedComercioId] = useState<string>('TODOS');

  // Pestaña activa para Ránkings Top 20
  const [topTab, setTopTab] = useState<'CONSUMO' | 'CANJE'>('CONSUMO');

  // Años disponibles para selector
  const aniosDisponibles = useMemo(() => {
    const current = new Date().getFullYear();
    return [current - 2, current - 1, current, current + 1];
  }, []);

  // Carga inicial de datos de Firestore
  useEffect(() => {
    const fetchData = async () => {
      if (!userData) return;
      setLoading(true);
      try {
        if (userData.rol === 'superadmin') {
          // Superadmin lee todos los comercios
          const comSnap = await getDocs(collection(db, 'comercios'));
          const comsData: Comercio[] = comSnap.docs.map(doc => doc.data() as Comercio);
          setComercios(comsData);

          // Carga transacciones segun filtro de comercio
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
          // Admin Comercio o Vendedor
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

  // Transacciones filtradas por Fecha
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

  // Cálculos específicos por Rol
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

  if (loading) {
    return (
      <div className="p-12 text-center text-gray-500 font-medium animate-pulse">
        Cargando reportes y procesando información...
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-6xl mx-auto">
      {/* Encabezado y Filtros */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100 pb-4">
          <div>
            <h2 className="text-2xl font-black text-gray-800 tracking-tight flex items-center gap-2">
              📊 Reportes y Estadísticas
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              {userData?.rol === 'admin_comercio' && 'Panel exclusivo de análisis del comercio.'}
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
              className="px-3.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs rounded-lg transition flex items-center gap-1.5"
            >
              📥 Exportar CSV
            </button>
          </div>
        </div>

        {/* Barra de Filtros */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
          {/* Selector Tipo de Filtro */}
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

          {/* Selector por Mes/Año */}
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
                  {aniosDisponibles.map(year => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            /* Selector por Rango de Fechas */
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

          {/* Filtro Comercio para SuperAdmin */}
          {userData?.rol === 'superadmin' && (
            <div className="md:col-span-3 space-y-1">
              <label className="text-xs font-bold text-gray-600 uppercase tracking-wider block">Comercio</label>
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
              <p className="text-xs font-extrabold text-amber-600 uppercase tracking-wider mb-1">Monto Total</p>
              <p className="text-3xl font-black text-amber-600">${adminReport.montoFacturadoTotal.toLocaleString()}</p>
              <p className="text-[11px] text-gray-400 mt-1">en ventas registratdas</p>
            </div>
          </div>

          {/* Ránkings Top 20 */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-4 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-extrabold text-gray-800 text-base">Top 20 Clientes del Comercio</h3>
              <div className="flex bg-gray-200 p-0.5 rounded-lg text-xs font-bold">
                <button
                  onClick={() => setTopTab('CONSUMO')}
                  className={`px-3 py-1 rounded-md transition ${topTab === 'CONSUMO' ? 'bg-white text-brand-primary shadow-sm' : 'text-gray-600'}`}
                >
                  Por Consumo ($)
                </button>
                <button
                  onClick={() => setTopTab('CANJE')}
                  className={`px-3 py-1 rounded-md transition ${topTab === 'CANJE' ? 'bg-white text-brand-primary shadow-sm' : 'text-gray-600'}`}
                >
                  Por Canje de Premios
                </button>
              </div>
            </div>

            {topTab === 'CONSUMO' ? (
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
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : (
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
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {adminReport.topUsuariosCanje.map((usr, idx) => (
                        <tr key={usr.clienteId} className="hover:bg-gray-50 transition">
                          <td className="px-4 py-3 text-center font-black text-gray-400">{idx + 1}</td>
                          <td className="px-4 py-3 font-bold text-gray-800">{usr.clienteAlias}</td>
                          <td className="px-4 py-3 font-black text-purple-700">{usr.totalCanjes} canjes</td>
                          <td className="px-4 py-3 font-semibold text-gray-700">{usr.totalPuntosCanjeados} pts</td>
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
          {/* Tarjetas KPI Vendedor */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm text-center">
              <p className="text-xs font-extrabold text-green-600 uppercase tracking-wider mb-1">Puntos Generados</p>
              <p className="text-3xl font-black text-green-600">+{vendedorReport.puntosGenerados}</p>
              <p className="text-[11px] text-gray-400 mt-1">en {vendedorReport.cantidadAcumulaciones} ventas registradas</p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm text-center">
              <p className="text-xs font-extrabold text-blue-600 uppercase tracking-wider mb-1">Monto Facturado</p>
              <p className="text-3xl font-black text-gray-800">${vendedorReport.montoFacturado.toLocaleString()}</p>
              <p className="text-[11px] text-gray-400 mt-1">procesado por ti</p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm text-center">
              <p className="text-xs font-extrabold text-purple-600 uppercase tracking-wider mb-1">Premios Entregados</p>
              <p className="text-3xl font-black text-purple-600">{vendedorReport.premiosCanjeadosCount}</p>
              <p className="text-[11px] text-gray-400 mt-1">canjes validados ({vendedorReport.puntosCanjeados} pts)</p>
            </div>
          </div>

          {/* Historial Vendedor */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <h3 className="font-extrabold text-gray-800 text-base p-4 bg-gray-50 border-b border-gray-100">
              Mis Transacciones Registradas
            </h3>

            {vendedorReport.transaccionesVendedor.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">No has registrado transacciones en este periodo.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 text-gray-500 text-xs font-bold uppercase tracking-wider">
                    <tr>
                      <th className="px-4 py-3">Fecha</th>
                      <th className="px-4 py-3">Tipo</th>
                      <th className="px-4 py-3">Cliente</th>
                      <th className="px-4 py-3">Monto</th>
                      <th className="px-4 py-3">Puntos</th>
                      <th className="px-4 py-3">N° Factura</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {vendedorReport.transaccionesVendedor.map(t => (
                      <tr key={t.id} className="hover:bg-gray-50 transition">
                        <td className="px-4 py-3 text-xs font-semibold text-gray-500">{new Date(t.fechaHora).toLocaleString()}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-md text-[11px] font-extrabold ${
                            t.tipo === 'ACUMULACION' ? 'bg-green-100 text-green-800' : 'bg-purple-100 text-purple-800'
                          }`}>
                            {t.tipo}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-semibold text-gray-800">{t.clienteAlias || t.clienteId.slice(0, 6)}</td>
                        <td className="px-4 py-3 text-gray-700 font-medium">${(t.montoFactura || 0).toLocaleString()}</td>
                        <td className="px-4 py-3 font-bold text-gray-800">{t.puntos}</td>
                        <td className="px-4 py-3 text-xs text-gray-400">{t.nroFactura || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* VISTA 3: SUPERADMIN */}
      {/* ========================================================================= */}
      {userData?.rol === 'superadmin' && (
        <div className="space-y-6">
          {/* Tarjetas KPI SuperAdmin */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm text-center">
              <p className="text-xs font-extrabold text-blue-600 uppercase tracking-wider mb-1">Comercios Activos</p>
              <p className="text-3xl font-black text-gray-800">{superAdminReport.totalComerciosActivos} / {superAdminReport.totalComercios}</p>
              <p className="text-[11px] text-gray-400 mt-1">con transacciones en el periodo</p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm text-center">
              <p className="text-xs font-extrabold text-green-600 uppercase tracking-wider mb-1">Total Puntos Otorgados</p>
              <p className="text-3xl font-black text-green-600">+{superAdminReport.totalPuntosOtorgados}</p>
              <p className="text-[11px] text-gray-400 mt-1">emitidos a clientes</p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm text-center">
              <p className="text-xs font-extrabold text-purple-600 uppercase tracking-wider mb-1">Total Canjes de Premios</p>
              <p className="text-3xl font-black text-purple-600">{superAdminReport.totalPremiosCanjeadosCount}</p>
              <p className="text-[11px] text-gray-400 mt-1">{superAdminReport.totalPuntosCanjeados} pts en premios</p>
            </div>
          </div>

          {/* Tabla de Actividad por Comercio */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-4 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-extrabold text-gray-800 text-base">Actividad y Canjes por Comercio</h3>
              <span className="text-xs font-bold text-gray-500">{superAdminReport.comerciosActividad.length} comercios</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs font-bold uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3">Comercio</th>
                    <th className="px-4 py-3">NIT / RUT</th>
                    <th className="px-4 py-3">Puntos Otorgados</th>
                    <th className="px-4 py-3">Premios Canjeados</th>
                    <th className="px-4 py-3">Transacciones</th>
                    <th className="px-4 py-3">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {superAdminReport.comerciosActividad.map(com => (
                    <tr key={com.comercioId} className="hover:bg-gray-50 transition">
                      <td className="px-4 py-3 font-bold text-gray-800">{com.nombreComercio}</td>
                      <td className="px-4 py-3 text-xs text-gray-500 font-mono">{com.nitRut}</td>
                      <td className="px-4 py-3 font-black text-green-700">+{com.puntosOtorgados} pts</td>
                      <td className="px-4 py-3 font-bold text-purple-700">{com.premiosCanjeadosCount} ({com.puntosCanjeados} pts)</td>
                      <td className="px-4 py-3 font-semibold text-gray-700">{com.transaccionesCount}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-extrabold ${
                          com.tieneActividad ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'
                        }`}>
                          {com.tieneActividad ? 'Activo' : 'Sin Actividad'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Ránkings Globales Top 20 */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-4 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-extrabold text-gray-800 text-base">Top 20 Clientes Globales (Todos los Comercios)</h3>
              <div className="flex bg-gray-200 p-0.5 rounded-lg text-xs font-bold">
                <button
                  onClick={() => setTopTab('CONSUMO')}
                  className={`px-3 py-1 rounded-md transition ${topTab === 'CONSUMO' ? 'bg-white text-brand-primary shadow-sm' : 'text-gray-600'}`}
                >
                  Por Consumo ($)
                </button>
                <button
                  onClick={() => setTopTab('CANJE')}
                  className={`px-3 py-1 rounded-md transition ${topTab === 'CANJE' ? 'bg-white text-brand-primary shadow-sm' : 'text-gray-600'}`}
                >
                  Por Canje de Premios
                </button>
              </div>
            </div>

            {topTab === 'CONSUMO' ? (
              superAdminReport.topUsuariosConsumoGlobal.length === 0 ? (
                <div className="p-8 text-center text-gray-400 text-sm">No hay registro de consumo en este periodo.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 text-gray-500 text-xs font-bold uppercase tracking-wider">
                      <tr>
                        <th className="px-4 py-3 text-center">#</th>
                        <th className="px-4 py-3">Cliente</th>
                        <th className="px-4 py-3">Monto Consumido Global</th>
                        <th className="px-4 py-3">Puntos Totales</th>
                        <th className="px-4 py-3">Transacciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {superAdminReport.topUsuariosConsumoGlobal.map((usr, idx) => (
                        <tr key={usr.clienteId} className="hover:bg-gray-50 transition">
                          <td className="px-4 py-3 text-center font-black text-gray-400">{idx + 1}</td>
                          <td className="px-4 py-3 font-bold text-gray-800">{usr.clienteAlias}</td>
                          <td className="px-4 py-3 font-black text-green-700">${usr.totalMonto.toLocaleString()}</td>
                          <td className="px-4 py-3 font-semibold text-gray-700">+{usr.totalPuntos} pts</td>
                          <td className="px-4 py-3 text-gray-500">{usr.cantidadTransacciones} tx</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : (
              superAdminReport.topUsuariosCanjeGlobal.length === 0 ? (
                <div className="p-8 text-center text-gray-400 text-sm">No hay registro de canjes en este periodo.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 text-gray-500 text-xs font-bold uppercase tracking-wider">
                      <tr>
                        <th className="px-4 py-3 text-center">#</th>
                        <th className="px-4 py-3">Cliente</th>
                        <th className="px-4 py-3">Premios Canjeados</th>
                        <th className="px-4 py-3">Puntos Consumidos</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {superAdminReport.topUsuariosCanjeGlobal.map((usr, idx) => (
                        <tr key={usr.clienteId} className="hover:bg-gray-50 transition">
                          <td className="px-4 py-3 text-center font-black text-gray-400">{idx + 1}</td>
                          <td className="px-4 py-3 font-bold text-gray-800">{usr.clienteAlias}</td>
                          <td className="px-4 py-3 font-black text-purple-700">{usr.totalCanjes} canjes</td>
                          <td className="px-4 py-3 font-semibold text-gray-700">{usr.totalPuntosCanjeados} pts</td>
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

      {/* Historial General de Transacciones Filtradas */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <h3 className="font-extrabold text-gray-800 text-base p-4 bg-gray-50 border-b border-gray-100">
          Detalle del Historial de Transacciones del Periodo ({transaccionesFiltradas.length})
        </h3>

        {transaccionesFiltradas.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">No existen transacciones en las fechas seleccionadas.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs font-bold uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">Fecha y Hora</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3">Puntos</th>
                  <th className="px-4 py-3">Cliente</th>
                  <th className="px-4 py-3">Vendedor</th>
                  <th className="px-4 py-3">Factura</th>
                  <th className="px-4 py-3">Monto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {transaccionesFiltradas.map(t => (
                  <tr key={t.id} className="hover:bg-gray-50 transition">
                    <td className="px-4 py-3 text-xs font-medium text-gray-500">{new Date(t.fechaHora).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-[11px] font-extrabold ${
                        t.tipo === 'ACUMULACION' ? 'bg-green-100 text-green-800' : 'bg-purple-100 text-purple-800'
                      }`}>
                        {t.tipo}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-bold text-gray-800">{t.puntos}</td>
                    <td className="px-4 py-3 font-semibold text-gray-700">{t.clienteAlias || t.clienteId.slice(0, 6)}</td>
                    <td className="px-4 py-3 text-gray-600">{t.vendedorAlias || t.vendedorId.slice(0, 6)}</td>
                    <td className="px-4 py-3 text-xs text-gray-400">{t.nroFactura || '-'}</td>
                    <td className="px-4 py-3 font-medium text-gray-700">${(t.montoFactura || 0).toLocaleString()}</td>
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
