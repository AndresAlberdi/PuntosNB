import { describe, it, expect } from 'vitest';
import { validateCodeRedemption } from '../../utils/influencers';
import type { CodigoInfluencer, AsignacionInfluencer, CanjeCodigo } from '../../types';

describe('Pruebas del Módulo de Influencers', () => {
  const baseCodigo: CodigoInfluencer = {
    id: 'SUPERCODE',
    influencerId: 'inf1',
    comercioId: 'com1',
    puntosPorCanje: 10,
    estado: 'ACTIVO',
    createdAt: Date.now() - 100000,
    fechaUltimaRenovacion: Date.now() - 50000
  };

  const baseAsig: AsignacionInfluencer = {
    id: 'asig1',
    influencerId: 'inf1',
    comercioId: 'com1',
    estado: 'ACEPTADO',
    iniciadoPor: 'COMERCIO',
    ratio: { cliente: 10, influencer: 5 },
    puntosParaClientes: 100,
    createdAt: Date.now() - 200000,
    updatedAt: Date.now()
  };

  it('Debe permitir el canje si cumple todas las reglas', () => {
    const result = validateCodeRedemption(baseCodigo, baseAsig, []);
    expect(result.success).toBe(true);
    expect(result.puntosAEntregarCliente).toBe(10);
    expect(result.puntosRestantesCampaña).toBe(90);
  });

  it('Debe rechazar el canje si el usuario ya lo usó en esta campaña', () => {
    const canjeReciente: CanjeCodigo = {
      id: 'canje1',
      clienteId: 'cli1',
      codigoId: 'codigo1',
      comercioId: 'com1',
      fechaCanje: Date.now() - 10000 // después de la última renovación
    };
    const result = validateCodeRedemption(baseCodigo, baseAsig, [canjeReciente]);
    expect(result.success).toBe(false);
    expect(result.errorMsg).toContain('Ya has utilizado este código');
  });

  it('Debe permitir el canje si el usuario lo usó en una campaña anterior', () => {
    const canjeAntiguo: CanjeCodigo = {
      id: 'canje1',
      clienteId: 'cli1',
      codigoId: 'codigo1',
      comercioId: 'com1',
      fechaCanje: Date.now() - 60000 // antes de la última renovación
    };
    const result = validateCodeRedemption(baseCodigo, baseAsig, [canjeAntiguo]);
    expect(result.success).toBe(true);
  });

  it('Debe rechazar el canje si la campaña está en estado RECHAZADO o PENDIENTE', () => {
    const asigRechazada: AsignacionInfluencer = { ...baseAsig, estado: 'RECHAZADO' };
    expect(validateCodeRedemption(baseCodigo, asigRechazada, []).success).toBe(false);

    const asigPendiente: AsignacionInfluencer = { ...baseAsig, estado: 'PENDIENTE' };
    expect(validateCodeRedemption(baseCodigo, asigPendiente, []).success).toBe(false);
  });

  it('Debe rechazar el canje si la alianza fue BLOQUEADA por el comercio o por el influencer', () => {
    const asigBloqueadaComercio: AsignacionInfluencer = { 
      ...baseAsig, 
      estado: 'BLOQUEADO', 
      bloqueadoPor: 'COMERCIO' 
    };
    const resCom = validateCodeRedemption(baseCodigo, asigBloqueadaComercio, []);
    expect(resCom.success).toBe(false);
    expect(resCom.errorMsg).toContain('no está activa');

    const asigBloqueadaInfluencer: AsignacionInfluencer = { 
      ...baseAsig, 
      estado: 'BLOQUEADO', 
      bloqueadoPor: 'INFLUENCER' 
    };
    const resInf = validateCodeRedemption(baseCodigo, asigBloqueadaInfluencer, []);
    expect(resInf.success).toBe(false);
    expect(resInf.errorMsg).toContain('no está activa');
  });

  it('Debe respetar los puntos definidos por el influencer en el código sobre el ratio de la alianza', () => {
    const codigoPersonalizado: CodigoInfluencer = {
      ...baseCodigo,
      puntosPorCanje: 25
    };
    const result = validateCodeRedemption(codigoPersonalizado, baseAsig, []);
    expect(result.success).toBe(true);
    expect(result.puntosAEntregarCliente).toBe(25);
    expect(result.puntosRestantesCampaña).toBe(75);
  });

  it('Debe rechazar el canje si los puntos personalizados superan la bolsa restante', () => {
    const codigoPersonalizado: CodigoInfluencer = {
      ...baseCodigo,
      puntosPorCanje: 150
    };
    const result = validateCodeRedemption(codigoPersonalizado, baseAsig, []);
    expect(result.success).toBe(false);
    expect(result.errorMsg).toContain('superado su límite de puntos');
  });
});
