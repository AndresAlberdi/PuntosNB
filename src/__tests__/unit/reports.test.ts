import { describe, it, expect } from 'vitest';
import type { Transaccion, Comercio } from '../../types';
import {
  getDateRangeForMonth,
  getDateRangeBetween,
  filterTransactionsByTimeRange,
  calculateAdminComercioReport,
  calculateVendedorReport,
  calculateSuperAdminReport,
} from '../../utils/reports';

describe('Pruebas del Módulo de Reportes', () => {
  const mockTransacciones: Transaccion[] = [
    {
      id: 'tx1',
      fechaHora: new Date(2026, 6, 10, 12, 0).getTime(), // July 10, 2026
      clienteId: 'cli1',
      clienteAlias: 'JuanPerez',
      comercioId: 'com1',
      vendedorId: 'vend1',
      montoFactura: 100,
      nroFactura: 'F-001',
      puntos: 10,
      tipo: 'ACUMULACION',
    },
    {
      id: 'tx2',
      fechaHora: new Date(2026, 6, 15, 14, 0).getTime(), // July 15, 2026
      clienteId: 'cli1',
      clienteAlias: 'JuanPerez',
      comercioId: 'com1',
      vendedorId: 'vend1',
      montoFactura: 250,
      nroFactura: 'F-002',
      puntos: 25,
      tipo: 'ACUMULACION',
    },
    {
      id: 'tx3',
      fechaHora: new Date(2026, 6, 20, 16, 0).getTime(), // July 20, 2026
      clienteId: 'cli2',
      clienteAlias: 'MariaGomez',
      comercioId: 'com1',
      vendedorId: 'vend2',
      montoFactura: 0,
      nroFactura: '',
      puntos: 50,
      tipo: 'CANJE',
      premioId: 'prem1',
    },
    {
      id: 'tx4',
      fechaHora: new Date(2026, 5, 25, 10, 0).getTime(), // June 25, 2026 (Different month)
      clienteId: 'cli3',
      clienteAlias: 'CarlosRuiz',
      comercioId: 'com2',
      vendedorId: 'vend3',
      montoFactura: 500,
      nroFactura: 'F-003',
      puntos: 50,
      tipo: 'ACUMULACION',
    },
  ];

  const mockComercios: Comercio[] = [
    { id: 'com1', nombre: 'Comercio Alpha', nit_rut: '111', reglas: [], premios: [], createdAt: 0 },
    { id: 'com2', nombre: 'Comercio Beta', nit_rut: '222', reglas: [], premios: [], createdAt: 0 },
  ];

  it('Debe calcular correctamente el rango de fechas para un mes', () => {
    // Julio 2026 (Mes index 6)
    const { startMs, endMs } = getDateRangeForMonth(2026, 6);
    expect(new Date(startMs).getDate()).toBe(1);
    expect(new Date(startMs).getMonth()).toBe(6);
    expect(new Date(endMs).getMonth()).toBe(6);
    expect(new Date(endMs).getHours()).toBe(23);
  });

  it('Debe calcular el rango de fechas entre dos fechas en formato YYYY-MM-DD', () => {
    const { startMs, endMs } = getDateRangeBetween('2026-07-01', '2026-07-31');
    expect(new Date(startMs).getDate()).toBe(1);
    expect(new Date(endMs).getDate()).toBe(31);
  });

  it('Debe filtrar transacciones por rango de tiempo', () => {
    const { startMs, endMs } = getDateRangeForMonth(2026, 6); // Julio 2026
    const filtradas = filterTransactionsByTimeRange(mockTransacciones, startMs, endMs);
    expect(filtradas).toHaveLength(3); // tx1, tx2, tx3
  });

  it('Debe calcular correctamente el reporte para Admin Comercio', () => {
    const { startMs, endMs } = getDateRangeForMonth(2026, 6);
    const transCom1 = filterTransactionsByTimeRange(mockTransacciones, startMs, endMs).filter(
      t => t.comercioId === 'com1'
    );

    const report = calculateAdminComercioReport(transCom1);

    expect(report.usuariosUnicos).toBe(2); // cli1, cli2
    expect(report.puntosGenerados).toBe(35); // 10 + 25
    expect(report.premiosCanjeadosCount).toBe(1); // tx3
    expect(report.puntosCanjeados).toBe(50); // tx3 puntos
    expect(report.montoFacturadoTotal).toBe(350); // 100 + 250

    expect(report.topUsuariosConsumo).toHaveLength(1);
    expect(report.topUsuariosConsumo[0].clienteAlias).toBe('JuanPerez');
    expect(report.topUsuariosConsumo[0].totalMonto).toBe(350);

    expect(report.topUsuariosCanje).toHaveLength(1);
    expect(report.topUsuariosCanje[0].clienteAlias).toBe('MariaGomez');
    expect(report.topUsuariosCanje[0].totalCanjes).toBe(1);
  });

  it('Debe calcular correctamente el reporte para Vendedor', () => {
    const reportVend1 = calculateVendedorReport(mockTransacciones, 'vend1');
    expect(reportVend1.puntosGenerados).toBe(35);
    expect(reportVend1.montoFacturado).toBe(350);
    expect(reportVend1.cantidadAcumulaciones).toBe(2);

    const reportVend2 = calculateVendedorReport(mockTransacciones, 'vend2');
    expect(reportVend2.premiosCanjeadosCount).toBe(1);
    expect(reportVend2.puntosCanjeados).toBe(50);
  });

  it('Debe calcular correctamente el reporte para SuperAdmin', () => {
    const report = calculateSuperAdminReport(mockTransacciones, mockComercios);

    expect(report.totalComercios).toBe(2);
    expect(report.totalComerciosActivos).toBe(2);
    expect(report.totalPuntosOtorgados).toBe(85); // 10 + 25 + 50
    expect(report.totalPremiosCanjeadosCount).toBe(1);

    expect(report.comerciosActividad).toHaveLength(2);
    const com1Res = report.comerciosActividad.find(c => c.comercioId === 'com1');
    expect(com1Res?.puntosOtorgados).toBe(35);
    expect(com1Res?.premiosCanjeadosCount).toBe(1);

    expect(report.topUsuariosConsumoGlobal[0].clienteAlias).toBe('CarlosRuiz');
    expect(report.topUsuariosConsumoGlobal[0].totalMonto).toBe(500);
  });
});
