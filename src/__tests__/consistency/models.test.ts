import { describe, it, expect } from 'vitest';
import type { Usuario, Comercio, Transaccion, SesionQR, ReglaPunto, Premio } from '../../types';

describe('Consistencia de Modelos y Tipos', () => {
  it('Debe validar la estructura correcta de un Usuario', () => {
    const mockUser: Usuario = {
      uid: 'user123',
      email: 'test@example.com',
      nombre: 'Test User',
      rol: 'cliente',
      createdAt: Date.now(),
      termsAccepted: true,
      termsAcceptedAt: Date.now(),
    };

    expect(mockUser).toHaveProperty('uid');
    expect(mockUser).toHaveProperty('email');
    expect(mockUser).toHaveProperty('rol', 'cliente');
  });

  it('Debe validar la estructura correcta de un Comercio', () => {
    const regla: ReglaPunto = {
      id: 'regla1',
      tipo: 'POR_COMPRA',
      puntosAOtorgar: 10,
      activa: true,
    };
    
    const premio: Premio = {
      id: 'premio1',
      nombre: 'Premio Test',
      descripcion: 'Premio de prueba',
      puntosRequeridos: 100,
      activo: true,
    };

    const mockComercio: Comercio = {
      id: 'comercio123',
      nombre: 'Comercio Test',
      nit_rut: '123456789',
      reglas: [regla],
      premios: [premio],
      createdAt: Date.now(),
    };

    expect(mockComercio.reglas).toHaveLength(1);
    expect(mockComercio.premios[0].puntosRequeridos).toBe(100);
  });

  it('Debe validar la estructura de una Transacción y Sesión QR', () => {
    const mockTx: Transaccion = {
      id: 'tx1',
      fechaHora: Date.now(),
      clienteId: 'cliente1',
      comercioId: 'comercio1',
      vendedorId: 'vendedor1',
      montoFactura: 100,
      nroFactura: 'F-001',
      puntos: 10,
      tipo: 'ACUMULACION',
    };

    const mockQR: SesionQR = {
      id: 'qr1',
      tipo: 'ACUMULACION',
      creadorId: 'vendedor1',
      comercioId: 'comercio1',
      estado: 'PENDIENTE',
      createdAt: Date.now(),
    };

    expect(mockTx.tipo).toBe('ACUMULACION');
    expect(mockQR.estado).toBe('PENDIENTE');
  });
});
