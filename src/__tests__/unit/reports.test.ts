import { describe, it, expect } from 'vitest';
import type { Transaccion, Comercio } from '../../types';
import {
  getDateRangeForMonth,
  getDateRangeBetween,
  filterTransactionsByTimeRange,
  calculateAdminComercioReport,
  calculateSuperAdminReport,
  checkComercioPrepagoStatus,
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
      vendedorAlias: 'VendedorUno',
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
      vendedorAlias: 'VendedorUno',
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
      vendedorAlias: 'VendedorDos',
      montoFactura: 0,
      nroFactura: '',
      puntos: 50,
      tipo: 'CANJE',
      premioId: 'prem1',
    },
    {
      id: 'tx_inf',
      fechaHora: new Date(2026, 6, 22, 10, 0).getTime(), // July 22, 2026
      clienteId: 'cli4',
      clienteAlias: 'AnaSeguidora',
      comercioId: 'com1',
      vendedorId: 'inf_nat',
      vendedorAlias: 'INFLUENCER',
      influencerId: 'inf_nat',
      codigoId: 'NATGOLD',
      montoFactura: 0,
      nroFactura: 'CÓDIGO INF',
      puntos: 15,
      tipo: 'ACUMULACION',
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

  it('Debe calcular correctamente el rango de fechas para un mes', () => {
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
    expect(filtradas).toHaveLength(4); // tx1, tx2, tx3, tx_inf
  });

  it('Debe calcular correctamente el reporte para Admin Comercio (Top Clientes, Vendedores e Influencers)', () => {
    const { startMs, endMs } = getDateRangeForMonth(2026, 6);
    const transCom1 = filterTransactionsByTimeRange(mockTransacciones, startMs, endMs).filter(
      t => t.comercioId === 'com1'
    );

    const report = calculateAdminComercioReport(transCom1);

    expect(report.usuariosUnicos).toBe(3); // cli1, cli2, cli4
    expect(report.puntosGenerados).toBe(50); // 10 + 25 + 15
    expect(report.premiosCanjeadosCount).toBe(1); // tx3
    expect(report.puntosCanjeados).toBe(50); // tx3 puntos
    expect(report.montoFacturadoTotal).toBe(350); // 100 + 250

    // Top Vendedores
    expect(report.topVendedores).toHaveLength(2);
    expect(report.topVendedores[0].vendedorId).toBe('vend1');
    expect(report.topVendedores[0].totalMonto).toBe(350);
    expect(report.topVendedores[0].totalPuntos).toBe(35);
    expect(report.topVendedores[0].cantidadTransacciones).toBe(2);

    // Top Influencers
    expect(report.topInfluencers).toHaveLength(1);
    expect(report.topInfluencers[0].influencerId).toBe('inf_nat');
    expect(report.topInfluencers[0].codigoId).toBe('NATGOLD');
    expect(report.topInfluencers[0].puntosOtorgados).toBe(15);
    expect(report.topInfluencers[0].cantidadCanjes).toBe(1);
  });

  it('Debe validar correctamente el estado de prepago de un comercio', () => {
    const comPiloto: Comercio = {
      id: 'com_p',
      nombre: 'Piloto',
      nit_rut: '00',
      reglas: [],
      premios: [],
      createdAt: 0,
      modalidadPago: 'PILOTO',
    };

    const statusPiloto = checkComercioPrepagoStatus(comPiloto);
    expect(statusPiloto.puedeOperar).toBe(true);
    expect(statusPiloto.puedeCanjearPremios).toBe(true);

    const comPrepago: Comercio = {
      id: 'com_pre',
      nombre: 'Prepago',
      nit_rut: '01',
      reglas: [],
      premios: [],
      createdAt: 0,
      modalidadPago: 'PREPAGO',
      mensualidadBs: 25,
      costoPorPremioBs: 1.25,
      mesesPagados: ['2026-08'],
      saldoPremiosBs: 25, // 20 premios
    };

    // Caso: Mes actual pagado solo 1 mes y faltan 2 días para fin de mes
    const statusPrepagoFinMes = checkComercioPrepagoStatus(comPrepago, new Date(2026, 7, 29)); // Agosto 29, 2026
    expect(statusPrepagoFinMes.puedeOperar).toBe(true);
    expect(statusPrepagoFinMes.alertaAmarillaMensualidad).toBe(true);
    expect(statusPrepagoFinMes.diasRestantesMes).toBeLessThanOrEqual(3);

    // Caso: Prepago de 2 meses (Agosto y Septiembre 2026) en Agosto 29
    const comPrepago2Meses: Comercio = {
      ...comPrepago,
      mesesPagados: ['2026-08', '2026-09']
    };
    const statusPrepagoMulti = checkComercioPrepagoStatus(comPrepago2Meses, new Date(2026, 7, 29));
    expect(statusPrepagoMulti.puedeOperar).toBe(true);
    expect(statusPrepagoMulti.alertaAmarillaMensualidad).toBe(false); // NO debe mostrar alerta porque Septiembre está cubierto
    expect(statusPrepagoMulti.diasRestantesMes).toBeGreaterThan(20);

    // Caso: Mes siguiente impago
    const fechaOct = new Date(2026, 9, 1); // Oct 1, 2026
    const statusOct = checkComercioPrepagoStatus(comPrepago2Meses, fechaOct);
    expect(statusOct.puedeOperar).toBe(false);
    expect(statusOct.alertaRojaMensualidad).toBe(true);
  });

  it('Debe calcular correctamente totalComerciosActivos excluyendo comercios bloqueados en SuperAdminReport', () => {
    const comerciosList: Comercio[] = [
      { id: 'com1', nombre: 'Comercio 1', nit_rut: '111', estado: 'activo', reglas: [], premios: [], createdAt: 0 },
      { id: 'com2', nombre: 'Comercio 2', nit_rut: '222', estado: 'bloqueado', reglas: [], premios: [], createdAt: 0 },
      { id: 'com3', nombre: 'Comercio 3', nit_rut: '333', estado: 'activo', reglas: [], premios: [], createdAt: 0 },
    ];

    const report = calculateSuperAdminReport(mockTransacciones, comerciosList);
    expect(report.totalComercios).toBe(3);
    expect(report.totalComerciosActivos).toBe(2); // com1 y com3 (excluye com2 bloqueado)
    
    const com2Report = report.comerciosActividad.find(c => c.comercioId === 'com2');
    expect(com2Report?.estado).toBe('bloqueado');
  });
});
