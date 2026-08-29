import { describe, it, expect } from 'vitest';
import { isTransaccionInfluencer } from '../../utils/reports';
import type { Transaccion } from '../../types';

describe('Códigos de Comercio y Reportes', () => {
  it('debe identificar transacciones de influencer correctamente', () => {
    const txInfluencer: Transaccion = {
      id: 'tx1',
      fechaHora: Date.now(),
      clienteId: 'c1',
      comercioId: 'com1',
      puntos: 10,
      tipo: 'ACUMULACION',
      influencerId: 'inf1',
      codigoId: 'PROMO10'
    };
    
    expect(isTransaccionInfluencer(txInfluencer)).toBe(true);
  });

  it('NO debe identificar transacciones de códigos de comercio como de influencer', () => {
    const txComercio: Transaccion = {
      id: 'tx2',
      fechaHora: Date.now(),
      clienteId: 'c1',
      comercioId: 'com1',
      puntos: 10,
      tipo: 'ACUMULACION', // El canje de código de comercio genera ACUMULACION
      codigoId: 'COMERCIO50',
      vendedorId: 'com1', // Vendedor es el propio comercio
      vendedorAlias: 'Mi Comercio'
    };
    
    expect(isTransaccionInfluencer(txComercio)).toBe(false);
  });

  it('debe rechazar transacciones explicitamente marcadas como CODIGO_COMERCIO', () => {
    const txComercioExplicito: Transaccion = {
      id: 'tx3',
      fechaHora: Date.now(),
      clienteId: 'c1',
      comercioId: 'com1',
      puntos: 10,
      tipo: 'CODIGO_COMERCIO',
      codigoId: 'NAVIDAD'
    };
    
    expect(isTransaccionInfluencer(txComercioExplicito)).toBe(false);
  });
});
