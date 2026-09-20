/**
 * Pruebas de integración de lo que la Fase 2 movió al servidor: códigos del comercio, campañas de
 * influencer, anulación de cobros y la división del comercio en parte pública y privada.
 */
import { describe, it, beforeEach, expect } from 'vitest';
import { db, limpiar, limpiarCuentas, llamar, sesionComo } from '../pruebas/util';

const COMERCIO = 'comercio_epico';
const OTRO = 'comercio_pizza';
const INFLUENCER = 'influencer_1';
const OTRO_INFLUENCER = 'influencer_2';

const mesActual = (): string => {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
};

async function sembrar(saldo = 100): Promise<void> {
  await db.collection('comercios').doc(COMERCIO).set({
    id: COMERCIO, nombre: 'Epico', reglas: [], premios: [], productos: [],
    modalidadPago: 'PREPAGO', estado: 'activo', createdAt: 1,
  });
  await db.collection('comercios_privado').doc(COMERCIO).set({
    id: COMERCIO, nit_rut: '123', modalidadPago: 'PREPAGO', mesesPagados: [mesActual()],
    saldoPremiosBs: saldo, consumidoPremiosBs: 0, costoPorPremioBs: 1.25, costoPorCodigoComercio: 10,
    mensualidadBs: 25,
  });
  await db.collection('comercios').doc(OTRO).set({
    id: OTRO, nombre: 'Pizza NB', reglas: [], premios: [], productos: [],
    modalidadPago: 'PILOTO', estado: 'activo', createdAt: 1,
  });
  await db.collection('users').doc(INFLUENCER).set({
    uid: INFLUENCER, email: 'nat@hipatia.io', nombre: 'Nat', rol: 'influencer', prefijoCodigo: 'NAT', createdAt: 1,
  });
}

const comoAdmin = (): Promise<string> => sesionComo('admin_epico', { rol: 'admin_comercio', comercioId: COMERCIO });
const comoAdminAjeno = (): Promise<string> => sesionComo('admin_pizza', { rol: 'admin_comercio', comercioId: OTRO });
const comoInfluencer = (): Promise<string> => sesionComo(INFLUENCER, { rol: 'influencer' });

beforeEach(async () => {
  await limpiar('users', 'comercios', 'comercios_privado', 'influencers_publico', 'codigos_comercio',
    'codigos_influencer', 'asignaciones_influencer', 'cobros_prepago', 'auditoria', 'transacciones',
    'puntos_saldos', 'canjes_codigo', 'operaciones_idempotentes');
  await limpiarCuentas();
  await sembrar();
});

describe('Códigos promocionales del comercio', () => {
  it('cobra el costo configurado del saldo prepagado', async () => {
    const idToken = await comoAdmin();
    const res = await llamar<{ costoBs: number }>('crearCodigoComercio', {
      codigo: 'ANIVERSARIO', puntosPorCanje: 20, comercioId: COMERCIO,
    }, { idToken });

    expect(res.ok).toBe(true);
    expect(res.datos?.costoBs).toBe(10);

    const privado = (await db.collection('comercios_privado').doc(COMERCIO).get()).data();
    expect(privado?.saldoPremiosBs).toBe(90);
  });

  it('rechaza el código si no alcanza el saldo', async () => {
    await db.collection('comercios_privado').doc(COMERCIO).update({ saldoPremiosBs: 3 });
    const idToken = await comoAdmin();
    const res = await llamar('crearCodigoComercio', { codigo: 'CARO', puntosPorCanje: 20, comercioId: COMERCIO }, { idToken });
    expect(res.ok).toBe(false);
    expect(res.mensaje).toContain('faltan');
  });

  it('no permite pisar un código existente, ni de comercio ni de influencer', async () => {
    const idToken = await comoAdmin();
    await llamar('crearCodigoComercio', { codigo: 'REPETIDO', puntosPorCanje: 20, comercioId: COMERCIO }, { idToken });
    const segundo = await llamar('crearCodigoComercio', { codigo: 'REPETIDO', puntosPorCanje: 20, comercioId: COMERCIO }, { idToken });
    expect(segundo.ok).toBe(false);
    expect(segundo.mensaje).toContain('ya está en uso');

    await db.collection('codigos_influencer').doc('DEINFLU').set({ id: 'DEINFLU', influencerId: INFLUENCER, comercioId: COMERCIO });
    const choque = await llamar('crearCodigoComercio', { codigo: 'DEINFLU', puntosPorCanje: 20, comercioId: COMERCIO }, { idToken });
    expect(choque.ok).toBe(false);
  });

  it('un administrador no crea códigos en un comercio ajeno', async () => {
    const idToken = await comoAdminAjeno();
    const res = await llamar('crearCodigoComercio', { codigo: 'INTRUSO', puntosPorCanje: 20, comercioId: COMERCIO }, { idToken });
    expect(res.ok).toBe(false);
    expect(res.codigo).toBe('PERMISSION_DENIED');
  });
});

describe('Campañas de influencer', () => {
  it('el comercio invita, el influencer acepta y la bolsa la pone el comercio', async () => {
    const tokenAdmin = await comoAdmin();
    const invitacion = await llamar('gestionarAsignacionInfluencer', {
      accion: 'invitar', comercioId: COMERCIO, influencerId: INFLUENCER, ratioCliente: 10,
    }, { idToken: tokenAdmin });
    expect(invitacion.ok).toBe(true);

    const tokenInf = await comoInfluencer();
    // El influencer acepta, pero no puede fijarse la bolsa a sí mismo.
    const aceptar = await llamar<{ puntosParaClientes: number }>('gestionarAsignacionInfluencer', {
      accion: 'aceptar', comercioId: COMERCIO, influencerId: INFLUENCER, puntosParaClientes: 999999,
    }, { idToken: tokenInf });
    expect(aceptar.ok).toBe(true);
    expect(aceptar.datos?.puntosParaClientes).toBe(0);

    const recarga = await llamar<{ puntosParaClientes: number }>('gestionarAsignacionInfluencer', {
      accion: 'recargarBolsa', comercioId: COMERCIO, influencerId: INFLUENCER, puntosParaClientes: 500,
    }, { idToken: tokenAdmin });
    expect(recarga.datos?.puntosParaClientes).toBe(500);
  });

  it('el influencer no puede recargar su propia bolsa', async () => {
    const tokenAdmin = await comoAdmin();
    await llamar('gestionarAsignacionInfluencer', { accion: 'invitar', comercioId: COMERCIO, influencerId: INFLUENCER }, { idToken: tokenAdmin });

    const tokenInf = await comoInfluencer();
    const res = await llamar('gestionarAsignacionInfluencer', {
      accion: 'recargarBolsa', comercioId: COMERCIO, influencerId: INFLUENCER, puntosParaClientes: 1000,
    }, { idToken: tokenInf });
    expect(res.ok).toBe(false);
    expect(res.codigo).toBe('PERMISSION_DENIED');
  });

  it('un tercero no puede tocar la campaña de otros', async () => {
    const tokenAdmin = await comoAdmin();
    await llamar('gestionarAsignacionInfluencer', { accion: 'invitar', comercioId: COMERCIO, influencerId: INFLUENCER }, { idToken: tokenAdmin });

    const tokenAjeno = await sesionComo(OTRO_INFLUENCER, { rol: 'influencer' });
    const res = await llamar('gestionarAsignacionInfluencer', {
      accion: 'aceptar', comercioId: COMERCIO, influencerId: INFLUENCER,
    }, { idToken: tokenAjeno });
    expect(res.ok).toBe(false);
    expect(res.codigo).toBe('PERMISSION_DENIED');
  });

  it('eliminar la campaña borra también sus códigos', async () => {
    const tokenAdmin = await comoAdmin();
    await llamar('gestionarAsignacionInfluencer', { accion: 'invitar', comercioId: COMERCIO, influencerId: INFLUENCER }, { idToken: tokenAdmin });
    await llamar('gestionarAsignacionInfluencer', { accion: 'aceptar', comercioId: COMERCIO, influencerId: INFLUENCER, puntosParaClientes: 100 }, { idToken: tokenAdmin });

    const tokenInf = await comoInfluencer();
    const codigo = await llamar('gestionarCodigoInfluencer', {
      accion: 'configurar', codigo: 'NATEPICO', comercioId: COMERCIO, puntosPorCanje: 30,
    }, { idToken: tokenInf });
    expect(codigo.ok).toBe(true);

    await llamar('gestionarAsignacionInfluencer', { accion: 'eliminar', comercioId: COMERCIO, influencerId: INFLUENCER }, { idToken: tokenAdmin });

    expect((await db.collection('codigos_influencer').doc('NATEPICO').get()).exists).toBe(false);
    expect((await db.collection('asignaciones_influencer').doc(`${COMERCIO}_${INFLUENCER}`).get()).exists).toBe(false);
  });

  it('el influencer no configura códigos sin campaña aceptada', async () => {
    const tokenInf = await comoInfluencer();
    const res = await llamar('gestionarCodigoInfluencer', {
      accion: 'configurar', codigo: 'NATSOLO', comercioId: COMERCIO, puntosPorCanje: 30,
    }, { idToken: tokenInf });
    expect(res.ok).toBe(false);
    expect(res.mensaje).toContain('colaboración aceptada');
  });
});

describe('Anulación de cobros', () => {
  async function cobrar(montoPremios: number): Promise<string> {
    const idToken = await sesionComo('contador_1', { rol: 'contador' });
    const res = await llamar<{ cobroId: string }>('registrarCobroPrepago', {
      comercioId: COMERCIO, mesesPagados: ['2026-12'], montoPremios,
      codigoDeposito: 'DEP-1', recibeFactura: false,
    }, { idToken });
    if (!res.ok) throw new Error(res.mensaje);
    return res.datos!.cobroId;
  }

  it('devuelve el saldo y quita los meses', async () => {
    const cobroId = await cobrar(40);
    const idToken = await sesionComo('contador_1', { rol: 'contador' });

    const antes = (await db.collection('comercios_privado').doc(COMERCIO).get()).data();
    expect(antes?.saldoPremiosBs).toBe(140);

    const res = await llamar('anularCobroPrepago', { cobroId }, { idToken });
    expect(res.ok).toBe(true);

    const despues = (await db.collection('comercios_privado').doc(COMERCIO).get()).data();
    expect(despues?.saldoPremiosBs).toBe(100);
    expect(despues?.mesesPagados).not.toContain('2026-12');
    expect((await db.collection('cobros_prepago').doc(cobroId).get()).exists).toBe(false);
  });

  it('se niega a anular si el comercio ya gastó ese saldo', async () => {
    const cobroId = await cobrar(40);
    await db.collection('comercios_privado').doc(COMERCIO).update({ saldoPremiosBs: 20 });

    const idToken = await sesionComo('contador_1', { rol: 'contador' });
    const res = await llamar('anularCobroPrepago', { cobroId }, { idToken });
    expect(res.ok).toBe(false);
    expect(res.mensaje).toContain('ya consumió');
  });

  it('un contador no anula el cobro de otro contador', async () => {
    const cobroId = await cobrar(40);
    const idToken = await sesionComo('contador_2', { rol: 'contador' });
    const res = await llamar('anularCobroPrepago', { cobroId }, { idToken });
    expect(res.ok).toBe(false);
    expect(res.codigo).toBe('PERMISSION_DENIED');
  });

  it('un cobro conciliado ya no se anula', async () => {
    const cobroId = await cobrar(40);
    const tokenSuper = await sesionComo('super_1', { rol: 'superadmin' });
    await llamar('conciliarCobroPrepago', { cobroId }, { idToken: tokenSuper });

    const idToken = await sesionComo('contador_1', { rol: 'contador' });
    const res = await llamar('anularCobroPrepago', { cobroId }, { idToken });
    expect(res.ok).toBe(false);
    expect(res.mensaje).toContain('conciliado');
  });
});

describe('Perfil público del influencer', () => {
  it('se crea y se actualiza junto con el perfil real', async () => {
    const tokenSuper = await sesionComo('super_1', { rol: 'superadmin' });
    await sesionComo(INFLUENCER, { rol: 'influencer' });

    await llamar('asignarRol', { uid: INFLUENCER, rol: 'influencer' }, { idToken: tokenSuper });
    const espejo = (await db.collection('influencers_publico').doc(INFLUENCER).get()).data();
    expect(espejo?.nombre).toBe('Nat');
    expect(espejo?.telefono).toBeUndefined();

    await llamar('actualizarPerfilInfluencer', { uid: INFLUENCER, nombre: 'Nat Estrella', seguidores: 5000 }, { idToken: tokenSuper });
    const actualizado = (await db.collection('influencers_publico').doc(INFLUENCER).get()).data();
    expect(actualizado?.nombre).toBe('Nat Estrella');
    expect(actualizado?.seguidores).toBe(5000);
  });

  it('desaparece cuando la cuenta deja de ser influencer', async () => {
    const tokenSuper = await sesionComo('super_1', { rol: 'superadmin' });
    await sesionComo(INFLUENCER, { rol: 'influencer' });
    await llamar('asignarRol', { uid: INFLUENCER, rol: 'influencer' }, { idToken: tokenSuper });
    expect((await db.collection('influencers_publico').doc(INFLUENCER).get()).exists).toBe(true);

    await llamar('asignarRol', { uid: INFLUENCER, rol: 'cliente' }, { idToken: tokenSuper });
    expect((await db.collection('influencers_publico').doc(INFLUENCER).get()).exists).toBe(false);
  });
});
