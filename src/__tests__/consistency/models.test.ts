import { describe, it, expect } from 'vitest';
import type { 
  Usuario, 
  Comercio, 
  Transaccion, 
  SesionQR, 
  ReglaPunto, 
  Premio, 
  ProductoCatalogo, 
  CobroPrepago, 
  CodigoInfluencer, 
  AsignacionInfluencer 
} from '../../types';

describe('Consistencia de Modelos y Tipos', () => {
  it('Debe validar la estructura correcta de un Usuario (incluyendo rol contador e influencer)', () => {
    const mockUserCliente: Usuario = {
      uid: 'user123',
      email: 'test@example.com',
      nombre: 'Test User',
      rol: 'cliente',
      createdAt: Date.now(),
      termsAccepted: true,
      termsAcceptedAt: Date.now(),
    };

    const mockUserContador: Usuario = {
      uid: 'cont123',
      email: 'cobranzas@hipatia.io',
      nombre: 'Contador General',
      rol: 'contador',
      emailReal: 'contador@gmail.com',
      createdAt: Date.now(),
    };

    const mockUserInfluencer: Usuario = {
      uid: 'inf123',
      email: 'natalia@hiinfluencer.io',
      nombre: 'Natalia Ramos',
      rol: 'influencer',
      prefijoCodigo: 'NAT',
      emailReal: 'natalia@gmail.com',
      telefono: '+59171234567',
      createdAt: Date.now(),
    };

    expect(mockUserCliente.rol).toBe('cliente');
    expect(mockUserContador.rol).toBe('contador');
    expect(mockUserInfluencer.prefijoCodigo).toBe('NAT');
  });

  it('Debe validar la estructura correcta de un Comercio con prepago, reglas y catálogo con imágenes', () => {
    const regla: ReglaPunto = {
      id: 'regla1',
      tipo: 'POR_PRODUCTO',
      productoId: 'prod_1',
      nombreProducto: 'Pizza Especial',
      imagenUrl: 'data:image/webp;base64,xxxx',
      puntosAOtorgar: 15,
      activa: true,
    };
    
    const premio: Premio = {
      id: 'premio1',
      nombre: 'Premio Test',
      descripcion: 'Premio de prueba',
      puntosRequeridos: 100,
      activo: true,
    };

    const producto: ProductoCatalogo = {
      id: 'prod_1',
      nombre: 'Pizza Especial',
      imagenUrl: 'data:image/webp;base64,xxxx',
      activo: true
    };

    const mockComercio: Comercio = {
      id: 'comercio123',
      nombre: 'Comercio Test',
      razonSocial: 'Comercio Test S.R.L.',
      nit_rut: '123456789',
      modalidadPago: 'PREPAGO',
      mensualidadBs: 25.0,
      costoPorPremioBs: 1.25,
      recibeFactura: true,
      mesesPagados: ['2026-08', '2026-09'],
      saldoPremiosBs: 50.0,
      reglas: [regla],
      premios: [premio],
      productos: [producto],
      createdAt: Date.now(),
    };

    expect(mockComercio.modalidadPago).toBe('PREPAGO');
    expect(mockComercio.mesesPagados).toHaveLength(2);
    expect(mockComercio.productos?.[0].imagenUrl).toBeDefined();
    expect(mockComercio.reglas[0].imagenUrl).toBeDefined();
  });

  it('Debe validar la estructura de CobroPrepago para control contable', () => {
    const cobro: CobroPrepago = {
      id: 'cobro_001',
      comercioId: 'comercio123',
      nombreComercio: 'Comercio Test',
      nitRut: '123456789',
      recibeFactura: true,
      contadorId: 'cont123',
      contadorAlias: 'Contador General',
      fechaHora: Date.now(),
      montoTotal: 100.0,
      mesesPagados: ['2026-08', '2026-09'],
      montoMensualidad: 50.0,
      montoPremios: 50.0,
      cantidadPremiosEquivalentes: 40,
      codigoDeposito: 'DEP-88492',
      comprobanteUrl: 'data:image/webp;base64,comprobante_data',
      estado: 'PENDIENTE_VERIFICACION',
      consumidoPremiosBs: 0
    };

    expect(cobro.montoTotal).toBe(100.0);
    expect(cobro.montoMensualidad + cobro.montoPremios).toBe(cobro.montoTotal);
    expect(cobro.cantidadPremiosEquivalentes).toBe(40);
    expect(cobro.estado).toBe('PENDIENTE_VERIFICACION');
  });

  it('Debe validar la estructura de Transacción, Sesión QR y Campaña de Influencer', () => {
    const mockTx: Transaccion = {
      id: 'tx1',
      fechaHora: Date.now(),
      clienteId: 'cliente1',
      comercioId: 'comercio1',
      vendedorId: 'vendedor1',
      montoFactura: 0,
      nroFactura: 'S/F',
      puntos: 10,
      tipo: 'ACUMULACION',
      influencerId: 'inf123',
      codigoId: 'NATGOLD'
    };

    const mockQR: SesionQR = {
      id: 'qr1',
      tipo: 'ACUMULACION',
      creadorId: 'vendedor1',
      comercioId: 'comercio1',
      estado: 'PENDIENTE',
      createdAt: Date.now(),
      nroFactura: 'S/F'
    };

    const mockCodigo: CodigoInfluencer = {
      id: 'NATGOLD',
      influencerId: 'inf123',
      comercioId: 'comercio1',
      puntosPorCanje: 10,
      estado: 'ACTIVO',
      createdAt: Date.now(),
      fechaUltimaRenovacion: Date.now()
    };

    const mockAsig: AsignacionInfluencer = {
      id: 'asig1',
      influencerId: 'inf123',
      comercioId: 'comercio1',
      estado: 'ACEPTADO',
      iniciadoPor: 'INFLUENCER',
      ratio: { cliente: 10, influencer: 5 },
      puntosParaClientes: 200,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    expect(mockTx.nroFactura).toBe('S/F');
    expect(mockQR.nroFactura).toBe('S/F');
    expect(mockCodigo.id).toBe('NATGOLD');
    expect(mockAsig.ratio.cliente).toBe(10);
  });
});
