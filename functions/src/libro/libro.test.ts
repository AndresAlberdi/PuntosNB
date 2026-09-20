/**
 * Pruebas de integración del libro mayor (Fase 1): acumulación, canje, códigos y cobranza.
 * Requieren los emuladores: `npm run test:functions`.
 */
import { describe, it, beforeEach, expect } from 'vitest';
import { db, limpiar, limpiarCuentas, llamar, sesionComo } from '../pruebas/util';

const COMERCIO = 'comercio_epico';
const OTRO = 'comercio_pizza';
const CLIENTE = 'cliente_1';
const VENDEDOR = 'vendedor_epico';
const VENDEDOR_AJENO = 'vendedor_pizza';
const CONTADOR = 'contador_1';
const SUPER = 'super_1';

const REGLA_COMPRA = { id: 'r_compra', tipo: 'POR_COMPRA', puntosAOtorgar: 0.1, activa: true };
const REGLA_BIENVENIDA = { id: 'r_bienvenida', tipo: 'POR_REGISTRO', puntosAOtorgar: 50, activa: true };
const PREMIO = { id: 'p_cafe', nombre: 'Café', descripcion: '', puntosRequeridos: 100, activo: true };

interface Sesion { codigo: string; puntos: number; expiraEn: number }

async function sembrar(comercio: Partial<Record<string, unknown>> = {}): Promise<void> {
  await db.collection('comercios').doc(COMERCIO).set({
    id: COMERCIO, nombre: 'Epico', nit_rut: '123',
    reglas: [REGLA_COMPRA, REGLA_BIENVENIDA], premios: [PREMIO], productos: [],
    modalidadPago: 'PILOTO', estado: 'activo', mensualidadBs: 25, costoPorPremioBs: 1.25,
    saldoPremiosBs: 0, consumidoPremiosBs: 0, mesesPagados: [], createdAt: 1, ...comercio,
  });
  await db.collection('comercios').doc(OTRO).set({
    id: OTRO, nombre: 'Pizza NB', nit_rut: '456', reglas: [], premios: [], productos: [],
    modalidadPago: 'PILOTO', estado: 'activo', createdAt: 1,
  });
}

const comoVendedor = (): Promise<string> => sesionComo(VENDEDOR, { rol: 'vendedor', comercioId: COMERCIO });
const comoCliente = (): Promise<string> => sesionComo(CLIENTE, { rol: 'cliente' });

beforeEach(async () => {
  await limpiar('users', 'comercios', 'sesiones_qr', 'transacciones', 'puntos_saldos', 'auditoria',
    'canjes_codigo', 'codigos_influencer', 'codigos_comercio', 'asignaciones_influencer',
    'cobros_prepago', 'operaciones_idempotentes');
  await limpiarCuentas();
  await sembrar();
});

describe('Acumulación', () => {
  it('el servidor recalcula los puntos y no acepta los que mande el cliente', async () => {
    const idToken = await comoVendedor();
    const res = await llamar<Sesion>('crearSesionAcumulacion', {
      montoFactura: 250, reglaId: REGLA_COMPRA.id, puntosCalculados: 99999,
    }, { idToken });

    expect(res.ok).toBe(true);
    expect(res.datos?.puntos).toBe(25); // 250 × 0,1
    expect(res.datos?.codigo).toMatch(/^\d{6}$/);

    const sesion = (await db.collection('sesiones_qr').doc(res.datos!.codigo).get()).data();
    expect(sesion?.puntosCalculados).toBe(25);
    expect(sesion?.expiresAt).toBeGreaterThan(Date.now());
  });

  it('acredita los puntos al cliente una sola vez', async () => {
    const tokenVendedor = await comoVendedor();
    const { datos } = await llamar<Sesion>('crearSesionAcumulacion', { montoFactura: 100, reglaId: REGLA_COMPRA.id }, { idToken: tokenVendedor });

    const tokenCliente = await comoCliente();
    const primero = await llamar<{ saldoTotal: number }>('reclamarAcumulacion', { codigo: datos!.codigo }, { idToken: tokenCliente });
    expect(primero.ok).toBe(true);
    expect(primero.datos?.saldoTotal).toBe(10);

    const segundo = await llamar('reclamarAcumulacion', { codigo: datos!.codigo }, { idToken: tokenCliente });
    expect(segundo.ok).toBe(false);
    expect(segundo.codigo).toBe('FAILED_PRECONDITION');

    const saldo = (await db.collection('puntos_saldos').doc(`${CLIENTE}_${COMERCIO}`).get()).data();
    expect(saldo?.saldoTotal).toBe(10);
    const transacciones = await db.collection('transacciones').get();
    expect(transacciones.size).toBe(1);
  });

  it('rechaza un código expirado', async () => {
    const tokenVendedor = await comoVendedor();
    const { datos } = await llamar<Sesion>('crearSesionAcumulacion', { montoFactura: 100, reglaId: REGLA_COMPRA.id }, { idToken: tokenVendedor });
    await db.collection('sesiones_qr').doc(datos!.codigo).update({ expiresAt: Date.now() - 1000 });

    const tokenCliente = await comoCliente();
    const res = await llamar('reclamarAcumulacion', { codigo: datos!.codigo }, { idToken: tokenCliente });
    expect(res.ok).toBe(false);
    expect(res.mensaje).toContain('expiró');

    const sesion = (await db.collection('sesiones_qr').doc(datos!.codigo).get()).data();
    expect(sesion?.estado).toBe('EXPIRADO');
  });

  it('entrega el bono de bienvenida una sola vez por comercio', async () => {
    const tokenVendedor = await comoVendedor();
    const tokenCliente = await comoCliente();

    const primera = await llamar<Sesion>('crearSesionAcumulacion', { reglaId: REGLA_BIENVENIDA.id }, { idToken: tokenVendedor });
    const reclamo1 = await llamar('reclamarAcumulacion', { codigo: primera.datos!.codigo }, { idToken: tokenCliente });
    expect(reclamo1.ok).toBe(true);

    const segunda = await llamar<Sesion>('crearSesionAcumulacion', { reglaId: REGLA_BIENVENIDA.id }, { idToken: tokenVendedor });
    const reclamo2 = await llamar('reclamarAcumulacion', { codigo: segunda.datos!.codigo }, { idToken: tokenCliente });
    expect(reclamo2.ok).toBe(false);
    expect(reclamo2.mensaje).toContain('bono de bienvenida');
  });

  it('dos reclamos simultáneos del mismo código acreditan una sola vez', async () => {
    const tokenVendedor = await comoVendedor();
    const { datos } = await llamar<Sesion>('crearSesionAcumulacion', { montoFactura: 100, reglaId: REGLA_COMPRA.id }, { idToken: tokenVendedor });
    const tokenCliente = await comoCliente();

    const [a, b] = await Promise.all([
      llamar('reclamarAcumulacion', { codigo: datos!.codigo }, { idToken: tokenCliente }),
      llamar('reclamarAcumulacion', { codigo: datos!.codigo }, { idToken: tokenCliente }),
    ]);

    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const saldo = (await db.collection('puntos_saldos').doc(`${CLIENTE}_${COMERCIO}`).get()).data();
    expect(saldo?.saldoTotal).toBe(10);
  });

  it('bloquea la acumulación si el comercio PREPAGO no pagó el mes', async () => {
    await sembrar({ modalidadPago: 'PREPAGO', mesesPagados: [], saldoPremiosBs: 100 });
    const idToken = await comoVendedor();
    const res = await llamar('crearSesionAcumulacion', { montoFactura: 100, reglaId: REGLA_COMPRA.id }, { idToken });
    expect(res.ok).toBe(false);
    expect(res.mensaje).toContain('mensualidad');
  });

  it('un cliente no puede crear sesiones de acumulación', async () => {
    const idToken = await comoCliente();
    const res = await llamar('crearSesionAcumulacion', { montoFactura: 100, reglaId: REGLA_COMPRA.id }, { idToken });
    expect(res.ok).toBe(false);
    expect(res.codigo).toBe('PERMISSION_DENIED');
  });
});

describe('Canje de premios', () => {
  async function darPuntos(puntos: number): Promise<void> {
    await db.collection('puntos_saldos').doc(`${CLIENTE}_${COMERCIO}`).set({
      id: `${CLIENTE}_${COMERCIO}`, clienteId: CLIENTE, comercioId: COMERCIO, saldoTotal: puntos, updatedAt: 1,
    });
  }

  it('rechaza el canje si al cliente le faltan puntos', async () => {
    await darPuntos(40);
    const idToken = await comoCliente();
    const res = await llamar('crearSesionCanje', { comercioId: COMERCIO, premioId: PREMIO.id }, { idToken });
    expect(res.ok).toBe(false);
    expect(res.mensaje).toContain('faltan 60 puntos');
  });

  it('descuenta puntos y saldo en bolivianos al confirmar en PREPAGO', async () => {
    const mes = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    await sembrar({ modalidadPago: 'PREPAGO', mesesPagados: [mes], saldoPremiosBs: 10, costoPorPremioBs: 1.25 });
    await darPuntos(150);

    const tokenCliente = await comoCliente();
    const sesion = await llamar<Sesion>('crearSesionCanje', { comercioId: COMERCIO, premioId: PREMIO.id }, { idToken: tokenCliente });
    expect(sesion.ok).toBe(true);

    const tokenVendedor = await comoVendedor();
    const confirmacion = await llamar<{ costoBs: number }>('confirmarCanje', { codigo: sesion.datos!.codigo }, { idToken: tokenVendedor });
    expect(confirmacion.ok).toBe(true);
    expect(confirmacion.datos?.costoBs).toBe(1.25);

    const comercio = (await db.collection('comercios').doc(COMERCIO).get()).data();
    expect(comercio?.saldoPremiosBs).toBe(8.75);
    expect(comercio?.consumidoPremiosBs).toBe(1.25);

    const saldo = (await db.collection('puntos_saldos').doc(`${CLIENTE}_${COMERCIO}`).get()).data();
    expect(saldo?.saldoTotal).toBe(50);
  });

  it('bloquea el canje cuando el comercio PREPAGO se quedó sin saldo en bolivianos (H-12)', async () => {
    const mes = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    await sembrar({ modalidadPago: 'PREPAGO', mesesPagados: [mes], saldoPremiosBs: 0.5, costoPorPremioBs: 1.25 });
    await darPuntos(150);

    const tokenCliente = await comoCliente();
    const res = await llamar('crearSesionCanje', { comercioId: COMERCIO, premioId: PREMIO.id }, { idToken: tokenCliente });
    expect(res.ok).toBe(false);
    expect(res.mensaje).toContain('saldo para entregar premios');
  });

  it('un vendedor de otro comercio no puede confirmar el canje', async () => {
    await darPuntos(150);
    const tokenCliente = await comoCliente();
    const sesion = await llamar<Sesion>('crearSesionCanje', { comercioId: COMERCIO, premioId: PREMIO.id }, { idToken: tokenCliente });

    const tokenAjeno = await sesionComo(VENDEDOR_AJENO, { rol: 'vendedor', comercioId: OTRO });
    const res = await llamar('confirmarCanje', { codigo: sesion.datos!.codigo }, { idToken: tokenAjeno });
    expect(res.ok).toBe(false);
    expect(res.mensaje).toContain('otro comercio');
  });

  it('no permite confirmar dos veces el mismo canje', async () => {
    await darPuntos(250);
    const tokenCliente = await comoCliente();
    const sesion = await llamar<Sesion>('crearSesionCanje', { comercioId: COMERCIO, premioId: PREMIO.id }, { idToken: tokenCliente });
    const tokenVendedor = await comoVendedor();

    const primera = await llamar('confirmarCanje', { codigo: sesion.datos!.codigo }, { idToken: tokenVendedor });
    const segunda = await llamar('confirmarCanje', { codigo: sesion.datos!.codigo }, { idToken: tokenVendedor });
    expect(primera.ok).toBe(true);
    expect(segunda.ok).toBe(false);
  });
});

describe('Códigos promocionales', () => {
  it('canjea un código de comercio una sola vez y rechaza el vencido', async () => {
    await db.collection('codigos_comercio').doc('ANIVERSARIO').set({
      id: 'ANIVERSARIO', comercioId: COMERCIO, puntosPorCanje: 20, estado: 'ACTIVO',
      fechaInicio: Date.now() - 1000, fechaFin: Date.now() + 86400000, createdAt: 1,
    });
    await db.collection('codigos_comercio').doc('VIEJO').set({
      id: 'VIEJO', comercioId: COMERCIO, puntosPorCanje: 20, estado: 'ACTIVO',
      fechaInicio: Date.now() - 86400000, fechaFin: Date.now() - 1000, createdAt: 1,
    });

    const idToken = await comoCliente();
    const primero = await llamar<{ puntos: number }>('canjearCodigo', { codigo: 'ANIVERSARIO' }, { idToken });
    expect(primero.ok).toBe(true);
    expect(primero.datos?.puntos).toBe(20);

    const repetido = await llamar('canjearCodigo', { codigo: 'ANIVERSARIO' }, { idToken });
    expect(repetido.ok).toBe(false);
    expect(repetido.mensaje).toContain('Ya canjeaste');

    const vencido = await llamar('canjearCodigo', { codigo: 'VIEJO' }, { idToken });
    expect(vencido.ok).toBe(false);
    expect(vencido.mensaje).toContain('venció');
  });

  it('descuenta la bolsa del influencer y la respeta como tope', async () => {
    await db.collection('codigos_influencer').doc('NATGOLD').set({
      id: 'NATGOLD', influencerId: 'inf_1', comercioId: COMERCIO, puntosPorCanje: 30,
      estado: 'ACTIVO', fechaUltimaRenovacion: Date.now() - 86400000, createdAt: 1,
    });
    await db.collection('asignaciones_influencer').doc(`${COMERCIO}_inf_1`).set({
      id: `${COMERCIO}_inf_1`, comercioId: COMERCIO, influencerId: 'inf_1',
      puntosParaClientes: 50, ratio: { cliente: 10, influencer: 5 }, estado: 'ACEPTADO',
      iniciadoPor: 'COMERCIO', createdAt: 1, updatedAt: 1,
    });

    const idToken = await comoCliente();
    const primero = await llamar<{ puntos: number }>('canjearCodigo', { codigo: 'NATGOLD' }, { idToken });
    expect(primero.ok).toBe(true);
    expect(primero.datos?.puntos).toBe(30);

    const asignacion = (await db.collection('asignaciones_influencer').doc(`${COMERCIO}_inf_1`).get()).data();
    expect(asignacion?.puntosParaClientes).toBe(20);

    // Otro cliente agota la bolsa: quedan 20 y el código entrega 30.
    const otroToken = await sesionComo('cliente_2', { rol: 'cliente' });
    const sinBolsa = await llamar('canjearCodigo', { codigo: 'NATGOLD' }, { idToken: otroToken });
    expect(sinBolsa.ok).toBe(false);
    expect(sinBolsa.mensaje).toContain('agotó');
  });

  it('rechaza el código de una campaña que no está aceptada', async () => {
    await db.collection('codigos_influencer').doc('PENDIENTE1').set({
      id: 'PENDIENTE1', influencerId: 'inf_2', comercioId: COMERCIO, puntosPorCanje: 10,
      estado: 'ACTIVO', fechaUltimaRenovacion: 1, createdAt: 1,
    });
    await db.collection('asignaciones_influencer').doc(`${COMERCIO}_inf_2`).set({
      id: `${COMERCIO}_inf_2`, comercioId: COMERCIO, influencerId: 'inf_2',
      puntosParaClientes: 500, ratio: { cliente: 10 }, estado: 'PENDIENTE', createdAt: 1, updatedAt: 1,
    });

    const idToken = await comoCliente();
    const res = await llamar('canjearCodigo', { codigo: 'PENDIENTE1' }, { idToken });
    expect(res.ok).toBe(false);
    expect(res.mensaje).toContain('no está activa');
  });
});

describe('Cobro de prepago', () => {
  it('cobra y acredita en una sola operación, con el monto calculado en el servidor', async () => {
    const idToken = await sesionComo(CONTADOR, { rol: 'contador' });
    const res = await llamar<{ montoTotal: number; saldoPremiosBs: number }>('registrarCobroPrepago', {
      comercioId: COMERCIO, mesesPagados: ['2026-10', '2026-11'], montoPremios: 50,
      codigoDeposito: 'DEP-1', montoTotal: 1, recibeFactura: false,
    }, { idToken });

    expect(res.ok).toBe(true);
    expect(res.datos?.montoTotal).toBe(100); // 25 × 2 meses + 50 de premios
    expect(res.datos?.saldoPremiosBs).toBe(50);

    const comercio = (await db.collection('comercios').doc(COMERCIO).get()).data();
    expect(comercio?.modalidadPago).toBe('PREPAGO');
    expect(comercio?.mesesPagados).toEqual(['2026-10', '2026-11']);
  });

  it('el reintento con la misma clave no cobra dos veces', async () => {
    const idToken = await sesionComo(CONTADOR, { rol: 'contador' });
    const datos = {
      comercioId: COMERCIO, mesesPagados: ['2026-10'], montoPremios: 25,
      codigoDeposito: 'DEP-2', recibeFactura: false, clave: 'clave-unica-1',
    };

    const primero = await llamar<{ cobroId: string }>('registrarCobroPrepago', datos, { idToken });
    const reintento = await llamar<{ cobroId: string; reintento?: boolean }>('registrarCobroPrepago', datos, { idToken });

    expect(primero.ok).toBe(true);
    expect(reintento.ok).toBe(true);
    expect(reintento.datos?.cobroId).toBe(primero.datos?.cobroId);
    expect(reintento.datos?.reintento).toBe(true);

    const cobros = await db.collection('cobros_prepago').get();
    expect(cobros.size).toBe(1);
    const comercio = (await db.collection('comercios').doc(COMERCIO).get()).data();
    expect(comercio?.saldoPremiosBs).toBe(25);
  });

  it('rechaza cobrar dos veces el mismo mes', async () => {
    const idToken = await sesionComo(CONTADOR, { rol: 'contador' });
    const base = { comercioId: COMERCIO, mesesPagados: ['2026-10'], montoPremios: 0, codigoDeposito: 'DEP-3', recibeFactura: false };

    const primero = await llamar('registrarCobroPrepago', base, { idToken });
    const repetido = await llamar('registrarCobroPrepago', { ...base, codigoDeposito: 'DEP-4' }, { idToken });

    expect(primero.ok).toBe(true);
    expect(repetido.ok).toBe(false);
    expect(repetido.mensaje).toContain('ya figuran pagados');
  });

  it('un admin de comercio no puede registrar cobros', async () => {
    const idToken = await sesionComo('admin_epico', { rol: 'admin_comercio', comercioId: COMERCIO });
    const res = await llamar('registrarCobroPrepago', {
      comercioId: COMERCIO, mesesPagados: ['2026-12'], montoPremios: 500, codigoDeposito: 'X', recibeFactura: false,
    }, { idToken });
    expect(res.ok).toBe(false);
    expect(res.codigo).toBe('PERMISSION_DENIED');
  });
});

describe('Administración de cuentas', () => {
  it('solo el superadministrador asigna roles, y el cambio llega al token', async () => {
    await db.collection('users').doc(CLIENTE).set({ uid: CLIENTE, email: 'ana@gmail.com', nombre: 'Ana', rol: 'cliente', createdAt: 1 });
    await sesionComo(CLIENTE, { rol: 'cliente' });

    const tokenCliente = await sesionComo('otro_cliente', { rol: 'cliente' });
    const intento = await llamar('asignarRol', { uid: CLIENTE, rol: 'superadmin' }, { idToken: tokenCliente });
    expect(intento.ok).toBe(false);
    expect(intento.codigo).toBe('PERMISSION_DENIED');

    const tokenSuper = await sesionComo(SUPER, { rol: 'superadmin' });
    const asignado = await llamar('asignarRol', { uid: CLIENTE, rol: 'contador' }, { idToken: tokenSuper });
    expect(asignado.ok).toBe(true);

    const { auth } = await import('../pruebas/util');
    const cuenta = await auth.getUser(CLIENTE);
    expect(cuenta.customClaims?.rol).toBe('contador');

    const perfil = (await db.collection('users').doc(CLIENTE).get()).data();
    expect(perfil?.claimsUpdatedAt).toBeTruthy();
  });

  it('exige comercio al asignar un rol que lo necesita', async () => {
    await db.collection('users').doc(CLIENTE).set({ uid: CLIENTE, email: 'ana@gmail.com', nombre: 'Ana', rol: 'cliente', createdAt: 1 });
    await sesionComo(CLIENTE, { rol: 'cliente' });
    const tokenSuper = await sesionComo(SUPER, { rol: 'superadmin' });

    const res = await llamar('asignarRol', { uid: CLIENTE, rol: 'admin_comercio' }, { idToken: tokenSuper });
    expect(res.ok).toBe(false);
    expect(res.mensaje).toContain('necesita un comercio');
  });

  it('un comercio nuevo nace PILOTO y sin saldo', async () => {
    const tokenSuper = await sesionComo(SUPER, { rol: 'superadmin' });
    const res = await llamar<{ comercioId: string }>('guardarComercio', {
      nombre: 'Nuevo Comercio', nit_rut: '999',
    }, { idToken: tokenSuper });

    expect(res.ok).toBe(true);
    const comercio = (await db.collection('comercios').doc(res.datos!.comercioId).get()).data();
    expect(comercio?.modalidadPago).toBe('PILOTO');
    expect(comercio?.saldoPremiosBs).toBe(0);
    expect(comercio?.estado).toBe('activo');
  });
});
