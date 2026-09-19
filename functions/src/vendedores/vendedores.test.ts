/**
 * Pruebas de integración del ingreso y la gestión de vendedores (Fase 1).
 * Requieren los emuladores: `npm run test:functions`.
 */
import { describe, it, beforeEach, expect } from 'vitest';
import { auth, db, limpiar, limpiarCuentas, llamar, sesionComo, idTokenDesdeCustomToken } from '../pruebas/util';

const COMERCIO = 'comercio_epico';
const OTRO_COMERCIO = 'comercio_pizza';
const PIN = '481593';

interface RespuestaLogin {
  token: string;
  vendedor: { uid: string; nombre: string; comercioId: string; rotacionRequerida: boolean };
}

async function sembrarComercios(): Promise<void> {
  await db.collection('comercios').doc(COMERCIO).set({ nombre: 'Epico', nit_rut: '123', reglas: [], premios: [] });
  await db.collection('comercios').doc(OTRO_COMERCIO).set({ nombre: 'Pizza NB', nit_rut: '456', reglas: [], premios: [] });
}

async function crearVendedorDePrueba(usuario = 'ventas@epico.com'): Promise<string> {
  const idToken = await sesionComo('super_1', { rol: 'superadmin' });
  const res = await llamar<{ uid: string }>('crearVendedor', {
    usuario, nombre: 'Ventas Épico', comercioId: COMERCIO, pin: PIN,
  }, { idToken });
  if (!res.ok) throw new Error(`No se pudo crear el vendedor: ${res.mensaje}`);
  return res.datos!.uid;
}

beforeEach(async () => {
  await limpiar('users', 'vendedores_secretos', 'intentos_login_ip', 'auditoria', 'comercios');
  await limpiarCuentas();
  await sembrarComercios();
});

describe('crearVendedor', () => {
  it('crea la cuenta en Auth, el perfil y el secreto, sin guardar el PIN en claro', async () => {
    const uid = await crearVendedorDePrueba();

    const perfil = (await db.collection('users').doc(uid).get()).data();
    expect(perfil?.rol).toBe('vendedor');
    expect(perfil?.comercioId).toBe(COMERCIO);
    expect(perfil?.pin).toBeUndefined();

    const secreto = (await db.collection('vendedores_secretos').doc(uid).get()).data();
    expect(secreto?.algoritmo).toBe('scrypt');
    expect(secreto?.hash).not.toContain(PIN);
    expect(JSON.stringify(secreto)).not.toContain(PIN);

    const cuenta = await auth.getUser(uid);
    expect(cuenta.customClaims?.rol).toBe('vendedor');
    expect(cuenta.customClaims?.comercioId).toBe(COMERCIO);
  });

  it('rechaza un PIN demasiado obvio', async () => {
    const idToken = await sesionComo('super_1', { rol: 'superadmin' });
    const res = await llamar('crearVendedor', {
      usuario: 'otro@epico.com', nombre: 'Otro', comercioId: COMERCIO, pin: '111111',
    }, { idToken });
    expect(res.ok).toBe(false);
    expect(res.codigo).toBe('FAILED_PRECONDITION');
  });

  it('rechaza un PIN que no tiene 6 dígitos', async () => {
    const idToken = await sesionComo('super_1', { rol: 'superadmin' });
    const res = await llamar('crearVendedor', {
      usuario: 'otro@epico.com', nombre: 'Otro', comercioId: COMERCIO, pin: 'abc123',
    }, { idToken });
    expect(res.ok).toBe(false);
    expect(res.codigo).toBe('INVALID_ARGUMENT');
  });

  it('impide que un admin cree vendedores en un comercio ajeno', async () => {
    const idToken = await sesionComo('admin_pizza', { rol: 'admin_comercio', comercioId: OTRO_COMERCIO });
    const res = await llamar('crearVendedor', {
      usuario: 'intruso@epico.com', nombre: 'Intruso', comercioId: COMERCIO, pin: PIN,
    }, { idToken });
    expect(res.ok).toBe(false);
    expect(res.codigo).toBe('PERMISSION_DENIED');
  });

  it('impide que un cliente cree vendedores', async () => {
    const idToken = await sesionComo('cliente_1', { rol: 'cliente' });
    const res = await llamar('crearVendedor', {
      usuario: 'falso@epico.com', nombre: 'Falso', comercioId: COMERCIO, pin: PIN,
    }, { idToken });
    expect(res.ok).toBe(false);
    expect(res.codigo).toBe('PERMISSION_DENIED');
  });

  it('exige sesión', async () => {
    const res = await llamar('crearVendedor', {
      usuario: 'anonimo@epico.com', nombre: 'Anónimo', comercioId: COMERCIO, pin: PIN,
    });
    expect(res.ok).toBe(false);
    expect(res.codigo).toBe('UNAUTHENTICATED');
  });
});

describe('loginVendedor', () => {
  it('entrega un token con los claims del vendedor cuando el PIN es correcto', async () => {
    const uid = await crearVendedorDePrueba();
    const res = await llamar<RespuestaLogin>('loginVendedor', { usuario: 'ventas@epico.com', pin: PIN });

    expect(res.ok).toBe(true);
    expect(res.datos?.vendedor.uid).toBe(uid);

    const idToken = await idTokenDesdeCustomToken(res.datos!.token);
    const decodificado = await auth.verifyIdToken(idToken);
    expect(decodificado.rol).toBe('vendedor');
    expect(decodificado.comercioId).toBe(COMERCIO);
  });

  it('rechaza el PIN incorrecto con el mismo mensaje que un usuario inexistente', async () => {
    await crearVendedorDePrueba();
    const malPin = await llamar('loginVendedor', { usuario: 'ventas@epico.com', pin: '999999' });
    const inexistente = await llamar('loginVendedor', { usuario: 'nadie@epico.com', pin: '999999' });

    expect(malPin.ok).toBe(false);
    expect(inexistente.ok).toBe(false);
    expect(malPin.mensaje).toBe(inexistente.mensaje);
    expect(malPin.codigo).toBe('PERMISSION_DENIED');
  });

  it('bloquea la cuenta tras cinco intentos fallidos y no acepta el PIN correcto durante el bloqueo', async () => {
    const uid = await crearVendedorDePrueba();

    for (let i = 0; i < 5; i++) {
      await llamar('loginVendedor', { usuario: 'ventas@epico.com', pin: '000001' });
    }

    const secreto = (await db.collection('vendedores_secretos').doc(uid).get()).data();
    expect(secreto?.intentosFallidos).toBeGreaterThanOrEqual(5);
    expect(secreto?.bloqueadoHasta).toBeTruthy();

    const conPinBueno = await llamar('loginVendedor', { usuario: 'ventas@epico.com', pin: PIN });
    expect(conPinBueno.ok).toBe(false);
    expect(conPinBueno.codigo).toBe('RESOURCE_EXHAUSTED');

    const asientos = await db.collection('auditoria').where('accion', '==', 'vendedor.bloqueado_por_intentos').get();
    expect(asientos.size).toBeGreaterThanOrEqual(1);
  });

  it('rechaza a un vendedor bloqueado por su administrador', async () => {
    const uid = await crearVendedorDePrueba();
    const idToken = await sesionComo('super_1', { rol: 'superadmin' });
    const bloqueo = await llamar('bloquearVendedor', { uid, bloquear: true }, { idToken });
    expect(bloqueo.ok).toBe(true);

    const res = await llamar('loginVendedor', { usuario: 'ventas@epico.com', pin: PIN });
    expect(res.ok).toBe(false);
    expect(res.codigo).toBe('FAILED_PRECONDITION');
  });

  it('deja rastro del ingreso en la auditoría', async () => {
    await crearVendedorDePrueba();
    await llamar('loginVendedor', { usuario: 'ventas@epico.com', pin: PIN });
    const asientos = await db.collection('auditoria').where('accion', '==', 'vendedor.login').get();
    expect(asientos.size).toBe(1);
  });
});

describe('rotarPinVendedor', () => {
  it('cambia el PIN, invalida el anterior y limpia el bloqueo', async () => {
    const uid = await crearVendedorDePrueba();
    const idToken = await sesionComo('super_1', { rol: 'superadmin' });

    const res = await llamar('rotarPinVendedor', { uid, pin: '735219' }, { idToken });
    expect(res.ok).toBe(true);

    const viejo = await llamar('loginVendedor', { usuario: 'ventas@epico.com', pin: PIN });
    expect(viejo.ok).toBe(false);

    const nuevo = await llamar<RespuestaLogin>('loginVendedor', { usuario: 'ventas@epico.com', pin: '735219' });
    expect(nuevo.ok).toBe(true);
  });

  it('impide rotar el PIN de un vendedor de otro comercio', async () => {
    const uid = await crearVendedorDePrueba();
    const idToken = await sesionComo('admin_pizza', { rol: 'admin_comercio', comercioId: OTRO_COMERCIO });
    const res = await llamar('rotarPinVendedor', { uid, pin: '735219' }, { idToken });
    expect(res.ok).toBe(false);
    expect(res.codigo).toBe('PERMISSION_DENIED');
  });
});
