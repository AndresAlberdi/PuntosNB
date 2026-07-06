export type RolUsuario = 'cliente' | 'vendedor' | 'admin_comercio' | 'superadmin';

export interface Usuario {
  uid: string;
  email: string;
  nombre: string;
  rol: RolUsuario;
  comercioId?: string; // Solo para vendedores o admin_comercio
  createdAt: number;
  paletteId?: string; // Paleta de colores elegida por el cliente
  avatarUrl?: string; // Logo/avatar elegido por el cliente
  telefono?: string; // Para WhatsApp
  termsAccepted?: boolean;
  termsAcceptedAt?: number;
}

export type TipoRegla = 
  | 'POR_COMPRA' // Cualquier compra activa una cantidad fija
  | 'POR_PRODUCTO' // Productos específicos dan puntos específicos
  | 'POR_RANGO'    // Puntos fijos si el monto está en un rango
  | 'POR_REGISTRO'; // Puntos regalados la primera vez que se registra/escanea

export interface ReglaPunto {
  id: string;
  tipo: TipoRegla;
  puntosAOtorgar?: number; // Opcional
  productoId?: string; // Para POR_PRODUCTO
  nombreProducto?: string;
  rangoDesde?: number; // Para POR_RANGO
  rangoHasta?: number; // Para POR_RANGO
  activa: boolean;
}

export interface ProductoCatalogo {
  id: string;
  nombre: string;
  activo: boolean;
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
  productos?: ProductoCatalogo[]; // Added
  createdAt: number;
  paletteId?: string; // Paleta de colores para todos los usuarios del comercio
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
