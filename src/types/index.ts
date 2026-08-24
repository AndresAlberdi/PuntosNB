export type RolUsuario = 'cliente' | 'vendedor' | 'admin_comercio' | 'superadmin' | 'influencer';

export interface Usuario {
  uid: string;
  email: string;
  emailReal?: string; // Correo administrativo real para Admin/Influencer
  usuario?: string; // Identificador de acceso sintético (ej: admin@dominio.io)
  pin?: string; // PIN de 6 dígitos para vendedores (sin Firebase Auth)
  nombre: string;
  rol: RolUsuario;
  comercioId?: string; // Solo para vendedores o admin_comercio
  createdAt: number;
  paletteId?: string; // Paleta de colores elegida por el cliente
  avatarUrl?: string; // Logo/avatar elegido por el cliente
  telefono?: string; // Para WhatsApp
  termsAccepted?: boolean;
  termsAcceptedAt?: number;
  estado?: 'activo' | 'bloqueado';
  
  // Datos específicos para influencers
  redesSociales?: string[]; // ej: ["https://instagram.com/user", ...]
  seguidores?: number;
  descripcion?: string;
  prefijoCodigo?: string; // Ej: NAT (max 3 chars por convención general)
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
  dominio?: string; // ej: "elcorte.io", "marca.io" (asignado por superadmin)
  logoUrl?: string;
  reglas: ReglaPunto[];
  premios: Premio[];
  productos?: ProductoCatalogo[]; // Added
  createdAt: number;
  paletteId?: string; // Paleta de colores para todos los usuarios del comercio
  plan?: 'regular' | 'premium';
  estado?: 'activo' | 'bloqueado';
}

export interface SaldoPunto {
  id: string; // userId_comercioId
  clienteId: string;
  comercioId: string;
  saldoTotal: number;
  updatedAt: number;
}

export type TipoTransaccion = 'ACUMULACION' | 'CANJE' | 'CODIGO_INFLUENCER';

export interface Transaccion {
  id: string;
  fechaHora: number;
  clienteId: string;
  clienteAlias?: string; // Nombre antes del @
  comercioId: string;
  vendedorId?: string; // Optional for CODIGO_INFLUENCER
  vendedorAlias?: string; // Nombre antes del @
  montoFactura?: number; // Optional for CODIGO_INFLUENCER
  nroFactura?: string; // Optional for CODIGO_INFLUENCER
  puntos: number;
  tipo: TipoTransaccion;
  premioId?: string; // Solo en caso de CANJE
  reglaAplicadaId?: string;
  influencerId?: string; // Para CODIGO_INFLUENCER
  codigoId?: string; // Para CODIGO_INFLUENCER
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

// --- INFLUENCERS ---

export interface AsignacionInfluencer {
  id: string; // comercioId_influencerId
  comercioId: string;
  influencerId: string;
  puntosParaClientes: number; // Bolsa de puntos disponibles para los usuarios
  ratio: {
    cliente: number;
    influencer: number;
  };
  estado: 'PENDIENTE' | 'ACEPTADO' | 'RECHAZADO' | 'BLOQUEADO';
  iniciadoPor: 'COMERCIO' | 'INFLUENCER';
  bloqueadoPor?: 'COMERCIO' | 'INFLUENCER';
  createdAt: number;
  updatedAt: number;
}

export interface CodigoInfluencer {
  id: string; // ej: NATGOLD
  influencerId: string;
  comercioId: string;
  puntosPorCanje: number;
  estado: 'ACTIVO' | 'INACTIVO';
  createdAt: number;
  fechaUltimaRenovacion: number;
}

export interface CanjeCodigo {
  id: string; // clienteId_codigoId_fecha (si se requiere histórico, o solo clienteId_codigoId si se sobrescribe/borra cada 30 días, aunque por requerimiento es bloquear por 30 días, veremos la implementación)
  clienteId: string;
  codigoId: string;
  comercioId: string;
  fechaCanje: number;
}

