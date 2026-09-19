/**
 * Reglas de negocio que antes vivían en el navegador y ahora decide el servidor.
 *
 * Son la misma aritmética que `src/utils/reports.ts` y `VendedorDashboard`, con una diferencia
 * de fondo: aquí el cliente no puede alterarlas ni saltárselas.
 */

export type TipoRegla = 'POR_COMPRA' | 'POR_PRODUCTO' | 'POR_RANGO' | 'POR_REGISTRO';

export interface ReglaPunto {
  id: string;
  tipo: TipoRegla;
  puntosAOtorgar?: number;
  productoId?: string;
  rangoDesde?: number;
  rangoHasta?: number;
  activa: boolean;
}

export interface Comercio {
  nombre?: string;
  reglas?: ReglaPunto[];
  premios?: { id: string; nombre?: string; puntosRequeridos?: number; activo?: boolean }[];
  estado?: 'activo' | 'bloqueado';
  modalidadPago?: 'PREPAGO' | 'PILOTO';
  mesesPagados?: string[];
  saldoPremiosBs?: number;
  consumidoPremiosBs?: number;
  costoPorPremioBs?: number;
  costoPorCodigoComercio?: number;
}

export interface ProductoSolicitado {
  reglaId: string;
  cantidad: number;
}

export const claveDelMes = (fecha: Date): string =>
  `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`;

export interface EstadoPrepago {
  puedeOperar: boolean;
  puedeCanjearPremios: boolean;
  premiosDisponibles: number;
}

/**
 * Un comercio PILOTO opera sin restricciones. Uno PREPAGO necesita el mes corriente pagado para
 * acumular, y saldo suficiente para entregar un premio más.
 */
export function estadoPrepago(comercio: Comercio, ahora = new Date()): EstadoPrepago {
  if (comercio.estado === 'bloqueado') {
    return { puedeOperar: false, puedeCanjearPremios: false, premiosDisponibles: 0 };
  }
  if (!comercio.modalidadPago || comercio.modalidadPago === 'PILOTO') {
    return { puedeOperar: true, puedeCanjearPremios: true, premiosDisponibles: Number.MAX_SAFE_INTEGER };
  }

  const mesPagado = (comercio.mesesPagados ?? []).includes(claveDelMes(ahora));
  const costo = comercio.costoPorPremioBs && comercio.costoPorPremioBs > 0 ? comercio.costoPorPremioBs : 1.25;
  const saldo = comercio.saldoPremiosBs ?? 0;
  const premiosDisponibles = Math.floor(saldo / costo);

  return {
    puedeOperar: mesPagado,
    puedeCanjearPremios: mesPagado && saldo >= costo,
    premiosDisponibles,
  };
}

/** Costo en bolivianos de entregar un premio en este comercio. */
export const costoPorPremio = (comercio: Comercio): number =>
  comercio.modalidadPago === 'PREPAGO'
    ? comercio.costoPorPremioBs && comercio.costoPorPremioBs > 0
      ? comercio.costoPorPremioBs
      : 1.25
    : 0;

/**
 * Recalcula los puntos de una acumulación desde las reglas del comercio.
 * Nunca se confía en el número que manda el cliente (H-06).
 */
export function calcularPuntos(
  comercio: Comercio,
  reglaId: string | undefined,
  productos: ProductoSolicitado[],
  montoFactura: number,
): { puntos: number; regla?: ReglaPunto } {
  const reglas = comercio.reglas ?? [];
  const activa = (id: string): ReglaPunto | undefined => reglas.find((r) => r.id === id && r.activa);

  let puntosProductos = 0;
  for (const solicitado of productos) {
    const regla = activa(solicitado.reglaId);
    if (regla?.tipo === 'POR_PRODUCTO') {
      puntosProductos += Math.max(0, Math.floor(solicitado.cantidad)) * (regla.puntosAOtorgar ?? 0);
    }
  }

  const regla = reglaId ? activa(reglaId) : undefined;
  if (!regla) return { puntos: puntosProductos };

  switch (regla.tipo) {
    case 'POR_COMPRA':
      return { puntos: Math.floor(montoFactura * (regla.puntosAOtorgar ?? 0)) + puntosProductos, regla };
    case 'POR_RANGO': {
      const desde = regla.rangoDesde ?? 0;
      const hasta = regla.rangoHasta ?? Number.MAX_SAFE_INTEGER;
      if (montoFactura < desde || montoFactura > hasta) return { puntos: puntosProductos, regla };
      return { puntos: (regla.puntosAOtorgar ?? 0) + puntosProductos, regla };
    }
    case 'POR_REGISTRO':
      return { puntos: (regla.puntosAOtorgar ?? 0) + puntosProductos, regla };
    case 'POR_PRODUCTO':
      return { puntos: puntosProductos, regla };
  }
}
