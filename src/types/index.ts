export type RolUsuario = 'cliente' | 'vendedor' | 'admin_comercio' | 'superadmin';

export interface Usuario {
  uid: string;
  email: string;
  nombre: string;
  rol: RolUsuario;
  comercioId?: string; // Solo para vendedores o admin_comercio
  createdAt: number;
}

export type TipoRegla = 
  | 'POR_COMPRA' // Cualquier compra activa una cantidad fija
  | 'POR_MONTO'  // Depende del monto (ej. 1 punto por cada $10)
  | 'POR_PRODUCTO'; // Productos específicos dan puntos específicos

export interface RangoMonto {
  min: number;
  max: number;
  puntos: number;
}

export interface ReglaPunto {
  id: string;
  tipo: TipoRegla;
  puntosAOtorgar?: number; // Opcional, ya no se usa en POR_MONTO
  rangos?: RangoMonto[]; // Para POR_MONTO
  productoId?: string; // Para POR_PRODUCTO
  nombreProducto?: string;
  activa: boolean;
}

export interface Premio {
  id: string;
  nombre: string;
  descripcion: string;
  puntosRequeridos: number;
  imagenUrl?: string;
  activo: boolean;
}

export interface Comercio {
  id: string;
  nombre: string;
  nit_rut: string;
  logoUrl?: string;
  reglas: ReglaPunto[];
  premios: Premio[];
  createdAt: number;
}

export interface SaldoPunto {
  id: string; // userId_comercioId
  clienteId: string;
  comercioId: string;
  saldoTotal: number;
  updatedAt: number;
}

export type TipoTransaccion = 'ACUMULACION' | 'CANJE';

export interface Transaccion {
  id: string;
  fechaHora: number;
  clienteId: string;
  clienteAlias?: string; // Nombre antes del @
  comercioId: string;
  vendedorId: string;
  vendedorAlias?: string; // Nombre antes del @
  montoFactura: number;
  nroFactura: string;
  puntos: number;
  tipo: TipoTransaccion;
  premioId?: string; // Solo en caso de CANJE
  reglaAplicadaId?: string;
}

export interface SesionQR {
  id: string; // Hash único
  tipo: TipoTransaccion;
  creadorId: string; // Vendedor (Acumulación) o Cliente (Canje)
  creadorAlias?: string; // Nombre antes del @
  comercioId: string;
  estado: 'PENDIENTE' | 'USADO' | 'EXPIRADO';
  createdAt: number;
  
  // Datos para Acumulación (generado por vendedor)
  montoFactura?: number;
  nroFactura?: string;
  puntosCalculados?: number;
  reglaAplicadaId?: string; // Guardar la regla que se seleccionó
  
  // Datos para Canje (generado por cliente)
  premioId?: string;
}
