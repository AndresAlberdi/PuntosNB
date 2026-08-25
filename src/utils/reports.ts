import type { Transaccion, Comercio } from '../types';

export interface TopUsuarioConsumo {
  clienteId: string;
  clienteAlias: string;
  totalMonto: number;
  totalPuntos: number;
  cantidadTransacciones: number;
}

export interface TopUsuarioCanje {
  clienteId: string;
  clienteAlias: string;
  totalCanjes: number;
  totalPuntosCanjeados: number;
}

export interface TopVendedorReport {
  vendedorId: string;
  vendedorAlias: string;
  totalMonto: number;
  totalPuntos: number;
  cantidadTransacciones: number;
  premiosEntregados: number;
}

export interface TopInfluencerReport {
  influencerId: string;
  influencerAlias: string;
  codigoId?: string;
  puntosOtorgados: number; // Puntos repartidos a clientes
  cantidadCanjes: number; // Cantidad de veces que se canjeó su código
  puntosGanadosInfluencer?: number;
}

export interface AdminComercioReport {
  usuariosUnicos: number;
  puntosGenerados: number;
  premiosCanjeadosCount: number;
  puntosCanjeados: number;
  montoFacturadoTotal: number;
  topUsuariosConsumo: TopUsuarioConsumo[];
  topUsuariosCanje: TopUsuarioCanje[];
  topVendedores: TopVendedorReport[];
  topInfluencers: TopInfluencerReport[];
}

export interface VendedorReport {
  puntosGenerados: number;
  montoFacturado: number;
  premiosCanjeadosCount: number;
  puntosCanjeados: number;
  cantidadAcumulaciones: number;
  cantidadCanjes: number;
  transaccionesVendedor: Transaccion[];
}

export interface ResumenComercioActividad {
  comercioId: string;
  nombreComercio: string;
  nitRut: string;
  puntosOtorgados: number;
  premiosCanjeadosCount: number;
  puntosCanjeados: number;
  transaccionesCount: number;
  usuariosUnicos: number;
  tieneActividad: boolean;
}

export interface SuperAdminReport {
  totalComercios: number;
  totalComerciosActivos: number;
  totalPuntosOtorgados: number;
  totalPremiosCanjeadosCount: number;
  totalPuntosCanjeados: number;
  comerciosActividad: ResumenComercioActividad[];
  topUsuariosConsumoGlobal: TopUsuarioConsumo[];
  topUsuariosCanjeGlobal: TopUsuarioCanje[];
}

/**
 * Retorna las marcas de tiempo de inicio (00:00:00.000) y fin (23:59:59.999) para un mes especificado.
 * @param year Año (ej: 2026)
 * @param month Mes de 0 a 11 (0 = Enero, 11 = Diciembre)
 */
export const getDateRangeForMonth = (year: number, month: number): { startMs: number; endMs: number } => {
  const start = new Date(year, month, 1, 0, 0, 0, 0);
  const end = new Date(year, month + 1, 0, 23, 59, 59, 999);
  return { startMs: start.getTime(), endMs: end.getTime() };
};

/**
 * Convierte strings de fecha en formato YYYY-MM-DD a marcas de tiempo de inicio de día y fin de día.
 */
export const getDateRangeBetween = (startDateStr: string, endDateStr: string): { startMs: number; endMs: number } => {
  const [startYear, startMonth, startDay] = startDateStr.split('-').map(Number);
  const [endYear, endMonth, endDay] = endDateStr.split('-').map(Number);

  const start = new Date(startYear, startMonth - 1, startDay, 0, 0, 0, 0);
  const end = new Date(endYear, endMonth - 1, endDay, 23, 59, 59, 999);

  return { startMs: start.getTime(), endMs: end.getTime() };
};

/**
 * Filtra un array de transacciones por un rango de tiempo en ms.
 */
export const filterTransactionsByTimeRange = (
  transacciones: Transaccion[],
  startMs: number,
  endMs: number
): Transaccion[] => {
  return transacciones.filter(t => t.fechaHora >= startMs && t.fechaHora <= endMs);
};

/**
 * Determina si una transacción proviene de un código de influencer.
 */
export const isTransaccionInfluencer = (t: Transaccion): boolean => {
  return (
    t.tipo === 'CODIGO_INFLUENCER' ||
    t.vendedorAlias === 'INFLUENCER' ||
    t.nroFactura === 'CÓDIGO INF' ||
    Boolean(t.influencerId) ||
    Boolean(t.codigoId)
  );
};

/**
 * Calcula métricas y rankings Top 20 para el Administrador de Comercio.
 */
export const calculateAdminComercioReport = (transacciones: Transaccion[]): AdminComercioReport => {
  const clientesSet = new Set<string>();
  let puntosGenerados = 0;
  let premiosCanjeadosCount = 0;
  let puntosCanjeados = 0;
  let montoFacturadoTotal = 0;

  const consumoMap = new Map<string, { alias: string; monto: number; puntos: number; count: number }>();
  const canjeMap = new Map<string, { alias: string; canjes: number; puntos: number }>();
  
  const vendedorMap = new Map<string, { alias: string; monto: number; puntos: number; count: number; canjes: number }>();
  const influencerMap = new Map<string, { alias: string; codigoId?: string; puntos: number; canjes: number }>();

  for (const t of transacciones) {
    if (t.clienteId) clientesSet.add(t.clienteId);

    const clienteAlias = t.clienteAlias || t.clienteId.slice(0, 6);
    const esInfluencer = isTransaccionInfluencer(t);

    if (t.tipo === 'ACUMULACION') {
      puntosGenerados += t.puntos || 0;
      montoFacturadoTotal += t.montoFactura || 0;

      // Ranking Clientes por Consumo
      const currCli = consumoMap.get(t.clienteId) || { alias: clienteAlias, monto: 0, puntos: 0, count: 0 };
      currCli.monto += t.montoFactura || 0;
      currCli.puntos += t.puntos || 0;
      currCli.count += 1;
      if (t.clienteAlias) currCli.alias = t.clienteAlias;
      consumoMap.set(t.clienteId, currCli);

      // Ranking Vendedores vs Influencers
      if (esInfluencer) {
        const infId = t.influencerId || t.vendedorId || 'inf_desconocido';
        const infAlias = (t.vendedorAlias && t.vendedorAlias !== 'INFLUENCER') ? t.vendedorAlias : (t.influencerId ? t.influencerId.slice(0, 6) : 'Influencer');
        const currInf = influencerMap.get(infId) || { alias: infAlias, codigoId: t.codigoId, puntos: 0, canjes: 0 };
        currInf.puntos += t.puntos || 0;
        currInf.canjes += 1;
        if (t.codigoId) currInf.codigoId = t.codigoId;
        influencerMap.set(infId, currInf);
      } else if (t.vendedorId) {
        const vendAlias = t.vendedorAlias || t.vendedorId.slice(0, 6);
        const currVend = vendedorMap.get(t.vendedorId) || { alias: vendAlias, monto: 0, puntos: 0, count: 0, canjes: 0 };
        currVend.monto += t.montoFactura || 0;
        currVend.puntos += t.puntos || 0;
        currVend.count += 1;
        if (t.vendedorAlias) currVend.alias = t.vendedorAlias;
        vendedorMap.set(t.vendedorId, currVend);
      }
    } else if (t.tipo === 'CANJE') {
      premiosCanjeadosCount += 1;
      puntosCanjeados += t.puntos || 0;

      // Ranking Clientes por Canje
      const currCli = canjeMap.get(t.clienteId) || { alias: clienteAlias, canjes: 0, puntos: 0 };
      currCli.canjes += 1;
      currCli.puntos += t.puntos || 0;
      if (t.clienteAlias) currCli.alias = t.clienteAlias;
      canjeMap.set(t.clienteId, currCli);

      // Si el vendedor validó el canje
      if (t.vendedorId && !esInfluencer) {
        const vendAlias = t.vendedorAlias || t.vendedorId.slice(0, 6);
        const currVend = vendedorMap.get(t.vendedorId) || { alias: vendAlias, monto: 0, puntos: 0, count: 0, canjes: 0 };
        currVend.canjes += 1;
        vendedorMap.set(t.vendedorId, currVend);
      }
    }
  }

  const topUsuariosConsumo: TopUsuarioConsumo[] = Array.from(consumoMap.entries())
    .map(([clienteId, data]) => ({
      clienteId,
      clienteAlias: data.alias,
      totalMonto: data.monto,
      totalPuntos: data.puntos,
      cantidadTransacciones: data.count,
    }))
    .sort((a, b) => b.totalMonto - a.totalMonto || b.totalPuntos - a.totalPuntos)
    .slice(0, 20);

  const topUsuariosCanje: TopUsuarioCanje[] = Array.from(canjeMap.entries())
    .map(([clienteId, data]) => ({
      clienteId,
      clienteAlias: data.alias,
      totalCanjes: data.canjes,
      totalPuntosCanjeados: data.puntos,
    }))
    .sort((a, b) => b.totalCanjes - a.totalCanjes || b.totalPuntosCanjeados - a.totalPuntosCanjeados)
    .slice(0, 20);

  const topVendedores: TopVendedorReport[] = Array.from(vendedorMap.entries())
    .map(([vendedorId, data]) => ({
      vendedorId,
      vendedorAlias: data.alias,
      totalMonto: data.monto,
      totalPuntos: data.puntos,
      cantidadTransacciones: data.count,
      premiosEntregados: data.canjes,
    }))
    .sort((a, b) => b.totalMonto - a.totalMonto || b.totalPuntos - a.totalPuntos)
    .slice(0, 20);

  const topInfluencers: TopInfluencerReport[] = Array.from(influencerMap.entries())
    .map(([influencerId, data]) => ({
      influencerId,
      influencerAlias: data.alias,
      codigoId: data.codigoId,
      puntosOtorgados: data.puntos,
      cantidadCanjes: data.canjes,
    }))
    .sort((a, b) => b.cantidadCanjes - a.cantidadCanjes || b.puntosOtorgados - a.puntosOtorgados)
    .slice(0, 20);

  return {
    usuariosUnicos: clientesSet.size,
    puntosGenerados,
    premiosCanjeadosCount,
    puntosCanjeados,
    montoFacturadoTotal,
    topUsuariosConsumo,
    topUsuariosCanje,
    topVendedores,
    topInfluencers,
  };
};

/**
 * Calcula métricas del vendedor para un período.
 */
export const calculateVendedorReport = (transacciones: Transaccion[], vendedorId: string): VendedorReport => {
  const vTrans = transacciones.filter(t => t.vendedorId === vendedorId && !isTransaccionInfluencer(t));

  let puntosGenerados = 0;
  let montoFacturado = 0;
  let premiosCanjeadosCount = 0;
  let puntosCanjeados = 0;
  let cantidadAcumulaciones = 0;
  let cantidadCanjes = 0;

  for (const t of vTrans) {
    if (t.tipo === 'ACUMULACION') {
      puntosGenerados += t.puntos || 0;
      montoFacturado += t.montoFactura || 0;
      cantidadAcumulaciones += 1;
    } else if (t.tipo === 'CANJE') {
      premiosCanjeadosCount += 1;
      puntosCanjeados += t.puntos || 0;
      cantidadCanjes += 1;
    }
  }

  return {
    puntosGenerados,
    montoFacturado,
    premiosCanjeadosCount,
    puntosCanjeados,
    cantidadAcumulaciones,
    cantidadCanjes,
    transaccionesVendedor: vTrans.sort((a, b) => b.fechaHora - a.fechaHora),
  };
};

/**
 * Calcula métricas globales para el SuperAdmin.
 */
export const calculateSuperAdminReport = (
  transacciones: Transaccion[],
  comercios: Comercio[]
): SuperAdminReport => {
  const comerciosMap = new Map<string, ResumenComercioActividad>();

  for (const c of comercios) {
    comerciosMap.set(c.id, {
      comercioId: c.id,
      nombreComercio: c.nombre,
      nitRut: c.nit_rut,
      puntosOtorgados: 0,
      premiosCanjeadosCount: 0,
      puntosCanjeados: 0,
      transaccionesCount: 0,
      usuariosUnicos: 0,
      tieneActividad: false,
    });
  }

  const clientesPorComercio = new Map<string, Set<string>>();
  const consumoMapGlobal = new Map<string, { alias: string; monto: number; puntos: number; count: number }>();
  const canjeMapGlobal = new Map<string, { alias: string; canjes: number; puntos: number }>();

  let totalPuntosOtorgados = 0;
  let totalPremiosCanjeadosCount = 0;
  let totalPuntosCanjeados = 0;

  for (const t of transacciones) {
    const alias = t.clienteAlias || t.clienteId.slice(0, 6);
    let resumenCom = comerciosMap.get(t.comercioId);

    if (!resumenCom) {
      resumenCom = {
        comercioId: t.comercioId,
        nombreComercio: `Comercio (${t.comercioId.slice(0, 6)})`,
        nitRut: '-',
        puntosOtorgados: 0,
        premiosCanjeadosCount: 0,
        puntosCanjeados: 0,
        transaccionesCount: 0,
        usuariosUnicos: 0,
        tieneActividad: false,
      };
      comerciosMap.set(t.comercioId, resumenCom);
    }

    resumenCom.tieneActividad = true;
    resumenCom.transaccionesCount += 1;

    let setClientes = clientesPorComercio.get(t.comercioId);
    if (!setClientes) {
      setClientes = new Set<string>();
      clientesPorComercio.set(t.comercioId, setClientes);
    }
    if (t.clienteId) setClientes.add(t.clienteId);

    if (t.tipo === 'ACUMULACION') {
      totalPuntosOtorgados += t.puntos || 0;
      resumenCom.puntosOtorgados += t.puntos || 0;

      const curr = consumoMapGlobal.get(t.clienteId) || { alias, monto: 0, puntos: 0, count: 0 };
      curr.monto += t.montoFactura || 0;
      curr.puntos += t.puntos || 0;
      curr.count += 1;
      if (t.clienteAlias) curr.alias = t.clienteAlias;
      consumoMapGlobal.set(t.clienteId, curr);
    } else if (t.tipo === 'CANJE') {
      totalPremiosCanjeadosCount += 1;
      totalPuntosCanjeados += t.puntos || 0;
      resumenCom.premiosCanjeadosCount += 1;
      resumenCom.puntosCanjeados += t.puntos || 0;

      const curr = canjeMapGlobal.get(t.clienteId) || { alias, canjes: 0, puntos: 0 };
      curr.canjes += 1;
      curr.puntos += t.puntos || 0;
      if (t.clienteAlias) curr.alias = t.clienteAlias;
      canjeMapGlobal.set(t.clienteId, curr);
    }
  }

  for (const [comercioId, setClientes] of clientesPorComercio.entries()) {
    const resCom = comerciosMap.get(comercioId);
    if (resCom) {
      resCom.usuariosUnicos = setClientes.size;
    }
  }

  const comerciosActividad = Array.from(comerciosMap.values()).sort((a, b) => {
    if (a.tieneActividad && !b.tieneActividad) return -1;
    if (!a.tieneActividad && b.tieneActividad) return 1;
    return b.puntosOtorgados - a.puntosOtorgados;
  });

  const totalComerciosActivos = comerciosActividad.filter(c => c.tieneActividad).length;

  const topUsuariosConsumoGlobal: TopUsuarioConsumo[] = Array.from(consumoMapGlobal.entries())
    .map(([clienteId, data]) => ({
      clienteId,
      clienteAlias: data.alias,
      totalMonto: data.monto,
      totalPuntos: data.puntos,
      cantidadTransacciones: data.count,
    }))
    .sort((a, b) => b.totalMonto - a.totalMonto || b.totalPuntos - a.totalPuntos)
    .slice(0, 20);

  const topUsuariosCanjeGlobal: TopUsuarioCanje[] = Array.from(canjeMapGlobal.entries())
    .map(([clienteId, data]) => ({
      clienteId,
      clienteAlias: data.alias,
      totalCanjes: data.canjes,
      totalPuntosCanjeados: data.puntos,
    }))
    .sort((a, b) => b.totalCanjes - a.totalCanjes || b.totalPuntosCanjeados - a.totalPuntosCanjeados)
    .slice(0, 20);

  return {
    totalComercios: comercios.length,
    totalComerciosActivos,
    totalPuntosOtorgados,
    totalPremiosCanjeadosCount,
    totalPuntosCanjeados,
    comerciosActividad,
    topUsuariosConsumoGlobal,
    topUsuariosCanjeGlobal,
  };
};

/**
 * Helper para verificar el estado de prepago de un comercio.
 * Retorna si el comercio puede operar, si puede canjear premios y los estados de alerta.
 */
export const checkComercioPrepagoStatus = (
  comercio: Comercio,
  currentDate: Date = new Date()
): {
  puedeOperar: boolean;
  puedeCanjearPremios: boolean;
  alertaAmarillaMensualidad: boolean;
  alertaRojaMensualidad: boolean;
  alertaAmarillaPremios: boolean;
  alertaRojaPremios: boolean;
  diasRestantesMes: number;
  premiosDisponibles: number;
  mesActualKey: string;
} => {
  const mesActualKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
  
  // Si está en modo PILOTO, tiene acceso libre sin bloqueos
  if (!comercio.modalidadPago || comercio.modalidadPago === 'PILOTO') {
    return {
      puedeOperar: true,
      puedeCanjearPremios: true,
      alertaAmarillaMensualidad: false,
      alertaRojaMensualidad: false,
      alertaAmarillaPremios: false,
      alertaRojaPremios: false,
      diasRestantesMes: 30,
      premiosDisponibles: 9999,
      mesActualKey,
    };
  }

  // Modo PREPAGO:
  const mesesPagados = comercio.mesesPagados || [];
  const mesPagado = mesesPagados.includes(mesActualKey);

  // Calcular días restantes en el mes actual
  const finDeMes = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
  const diasRestantesMes = Math.max(0, finDeMes.getDate() - currentDate.getDate());

  // Mensualidad
  const puedeOperar = mesPagado;
  const alertaRojaMensualidad = !mesPagado;
  const alertaAmarillaMensualidad = mesPagado && diasRestantesMes <= 7;

  // Premios
  const costoPremio = comercio.costoPorPremioBs && comercio.costoPorPremioBs > 0 ? comercio.costoPorPremioBs : 1.25;
  const saldoPremiosBs = comercio.saldoPremiosBs || 0;
  const premiosDisponibles = Math.floor(saldoPremiosBs / costoPremio);

  const puedeCanjearPremios = puedeOperar && premiosDisponibles > 0;
  const alertaRojaPremios = premiosDisponibles === 0;
  const alertaAmarillaPremios = premiosDisponibles > 0 && premiosDisponibles < 10;

  return {
    puedeOperar,
    puedeCanjearPremios,
    alertaAmarillaMensualidad,
    alertaRojaMensualidad,
    alertaAmarillaPremios,
    alertaRojaPremios,
    diasRestantesMes,
    premiosDisponibles,
    mesActualKey,
  };
};
