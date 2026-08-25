export type RolUsuario = 'cliente' | 'vendedor' | 'admin_comercio' | 'superadmin' | 'influencer' | 'contador';

export interface Usuario {
  uid: string;
  email: string;
  emailReal?: string; // Correo administrativo real para Admin/Influencer/Contador
  usuario?: string; // Identificador de acceso sintético (ej: admin@dominio.io o contador@hipatia.io)
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
  prefijoCodigo?: string; // Ej: NAT (único por influencer)
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
  imagenUrl?: string; // Fotografía opcional del producto
  rangoDesde?: number; // Para POR_RANGO
  rangoHasta?: number; // Para POR_RANGO
  activa: boolean;
}

export interface ProductoCatalogo {
  id: string;
  nombre: string;
  imagenUrl?: string; // Fotografía opcional optimizada
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

export type ModalidadPagoComercio = 'PREPAGO' | 'PILOTO';

export interface Comercio {
  id: string;
  nombre: string;
  nit_rut: string;
  razonSocial?: string; // Razón Social opcional
  dominio?: string; // ej: "elcorte.io", "marca.io" (asignado por superadmin)
  logoUrl?: string;
  reglas: ReglaPunto[];
  premios: Premio[];
  productos?: ProductoCatalogo[];
  createdAt: number;
  paletteId?: string; // Paleta de colores para todos los usuarios del comercio
  plan?: 'regular' | 'premium';
  estado?: 'activo' | 'bloqueado';

  // --- FACTURACIÓN & PREPAGO ---
  modalidadPago?: ModalidadPagoComercio; // 'PREPAGO' | 'PILOTO' (default: PILOTO)
  mensualidadBs?: number; // Ej: 25.00
  costoPorPremioBs?: number; // Ej: 1.25
  recibeFactura?: boolean; // Booleano
  mesesPagados?: string[]; // Meses pagados en formato 'YYYY-MM' (ej: ['2026-08', '2026-09'])
  saldoPremiosBs?: number; // Saldo prepagado disponible para premios (ej: 60.00)
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
  nroFactura?: string; // Optional for CODIGO_INFLUENCER (ej: 'S/F' o 'F-123')
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
  id: string;
  clienteId: string;
  codigoId: string;
  comercioId: string;
  fechaCanje: number;
}

// --- FACTURACIÓN & PREPAGO ---

export interface CobroPrepago {
  id: string;
  comercioId: string;
  nombreComercio: string;
  nitRut: string;
  razonSocial?: string;
  recibeFactura: boolean;
  
  contadorId: string;
  contadorAlias: string;
  fechaHora: number;
  
  montoTotal: number;
  montoMensualidad: number;
  mesesPagados: string[]; // ['2026-08', '2026-09']
  montoPremios: number;
  cantidadPremiosEquivalentes: number;
  
  codigoDeposito: string;
  comprobanteUrl: string; // Data URL Base64 optimizada o URL
  
  estado: 'PENDIENTE_VERIFICACION' | 'VERIFICADO' | 'RECHAZADO';
  verificadoPor?: string;
  fechaVerificacion?: number;
  
  consumidoPremiosBs?: number; // Saldo de premios de este depósito ya consumido por canjes
}
