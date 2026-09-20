/**
 * Matriz de pruebas de las reglas de Firestore (Fase 2).
 *
 * Se ejecutan con `npm run test:rules`, que levanta el emulador. Si no hay emulador, fallan.
 *
 * La primera parte es una matriz rol × colección × operación generada de forma tabular, para que
 * agregar una colección sea agregar una fila. La segunda comprueba, caso por caso, las listas
 * blancas de campos y las fronteras entre comercios.
 */
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const aquí = dirname(fileURLToPath(import.meta.url));
const REGLAS = readFileSync(resolve(aquí, '../../../firestore.rules'), 'utf8');
const [host, puerto] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');

let testEnv: RulesTestEnvironment;

const COMERCIO = 'comercio_epico';
const OTRO = 'comercio_pizza';

/** Identidades de prueba, con el rol y el comercio en el token, como en producción. */
const IDENTIDADES = {
  anonimo: null,
  cliente: { uid: 'cliente_1', claims: { rol: 'cliente' } },
  otroCliente: { uid: 'cliente_2', claims: { rol: 'cliente' } },
  vendedor: { uid: 'vendedor_epico', claims: { rol: 'vendedor', comercioId: COMERCIO } },
  vendedorAjeno: { uid: 'vendedor_pizza', claims: { rol: 'vendedor', comercioId: OTRO } },
  admin: { uid: 'admin_epico', claims: { rol: 'admin_comercio', comercioId: COMERCIO } },
  adminAjeno: { uid: 'admin_pizza', claims: { rol: 'admin_comercio', comercioId: OTRO } },
  contador: { uid: 'contador_1', claims: { rol: 'contador' } },
  influencer: { uid: 'influencer_1', claims: { rol: 'influencer' } },
  otroInfluencer: { uid: 'influencer_2', claims: { rol: 'influencer' } },
  superadmin: { uid: 'super_1', claims: { rol: 'superadmin' } },
} as const;

type Quien = keyof typeof IDENTIDADES;

const db = (quien: Quien) => {
  const identidad = IDENTIDADES[quien];
  return identidad === null
    ? testEnv.unauthenticatedContext().firestore()
    : testEnv.authenticatedContext(identidad.uid, identidad.claims).firestore();
};

const TODOS = Object.keys(IDENTIDADES) as Quien[];

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-hipatia-reglas',
    firestore: { host, port: Number(puerto), rules: REGLAS },
  });
});

afterAll(async () => { await testEnv.cleanup(); });

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    await setDoc(doc(d, 'users', IDENTIDADES.cliente.uid), { uid: IDENTIDADES.cliente.uid, email: 'ana@gmail.com', nombre: 'Ana', rol: 'cliente', telefono: '+59170000000', createdAt: 1 });
    await setDoc(doc(d, 'users', IDENTIDADES.otroCliente.uid), { uid: IDENTIDADES.otroCliente.uid, email: 'beto@gmail.com', nombre: 'Beto', rol: 'cliente', createdAt: 1 });
    await setDoc(doc(d, 'users', IDENTIDADES.vendedor.uid), { uid: IDENTIDADES.vendedor.uid, email: 'ventas@epico.com', nombre: 'Ventas', rol: 'vendedor', comercioId: COMERCIO, estado: 'activo', createdAt: 1 });
    await setDoc(doc(d, 'users', IDENTIDADES.influencer.uid), { uid: IDENTIDADES.influencer.uid, email: 'nat@hipatia.io', nombre: 'Nat', rol: 'influencer', telefono: '+59171111111', prefijoCodigo: 'NAT', createdAt: 1 });
    await setDoc(doc(d, 'comercios', COMERCIO), { id: COMERCIO, nombre: 'Epico', reglas: [], premios: [], productos: [], estado: 'activo', modalidadPago: 'PREPAGO', operativoHasta: Date.now() + 86400000, puedeCanjearPremios: true, createdAt: 1 });
    await setDoc(doc(d, 'comercios', OTRO), { id: OTRO, nombre: 'Pizza NB', reglas: [], premios: [], productos: [], estado: 'activo', modalidadPago: 'PILOTO', createdAt: 1 });
    await setDoc(doc(d, 'comercios_privado', COMERCIO), { id: COMERCIO, nit_rut: '123', razonSocial: 'Epico SRL', plan: 'regular', mensualidadBs: 25, costoPorPremioBs: 1.25, saldoPremiosBs: 200, consumidoPremiosBs: 3, mesesPagados: ['2026-09'] });
    await setDoc(doc(d, 'influencers_publico', IDENTIDADES.influencer.uid), { uid: IDENTIDADES.influencer.uid, nombre: 'Nat', prefijoCodigo: 'NAT', seguidores: 1000 });
    await setDoc(doc(d, 'transacciones', 'tx1'), { id: 'tx1', clienteId: IDENTIDADES.cliente.uid, comercioId: COMERCIO, vendedorId: IDENTIDADES.vendedor.uid, puntos: 10, tipo: 'ACUMULACION', fechaHora: 1 });
    await setDoc(doc(d, 'puntos_saldos', `${IDENTIDADES.cliente.uid}_${COMERCIO}`), { id: `${IDENTIDADES.cliente.uid}_${COMERCIO}`, clienteId: IDENTIDADES.cliente.uid, comercioId: COMERCIO, saldoTotal: 100, updatedAt: 1 });
    await setDoc(doc(d, 'sesiones_qr', '123456'), { id: '123456', tipo: 'ACUMULACION', creadorId: IDENTIDADES.vendedor.uid, comercioId: COMERCIO, estado: 'PENDIENTE', createdAt: 1, expiresAt: Date.now() + 300000, puntosCalculados: 10 });
    await setDoc(doc(d, 'cobros_prepago', 'cobro1'), { id: 'cobro1', comercioId: COMERCIO, contadorId: IDENTIDADES.contador.uid, montoTotal: 35, montoPremios: 10, mesesPagados: ['2026-09'], fechaHora: 1 });
    await setDoc(doc(d, 'asignaciones_influencer', `${COMERCIO}_${IDENTIDADES.influencer.uid}`), { id: `${COMERCIO}_${IDENTIDADES.influencer.uid}`, comercioId: COMERCIO, influencerId: IDENTIDADES.influencer.uid, puntosParaClientes: 500, ratio: { cliente: 10 }, estado: 'ACEPTADO', createdAt: 1, updatedAt: 1 });
    await setDoc(doc(d, 'codigos_influencer', 'NATGOLD'), { id: 'NATGOLD', influencerId: IDENTIDADES.influencer.uid, comercioId: COMERCIO, puntosPorCanje: 30, estado: 'ACTIVO', fechaUltimaRenovacion: 1, createdAt: 1 });
    await setDoc(doc(d, 'codigos_comercio', 'ANIVERSARIO'), { id: 'ANIVERSARIO', comercioId: COMERCIO, puntosPorCanje: 20, estado: 'ACTIVO', fechaInicio: 1, fechaFin: Date.now() + 86400000, createdAt: 1 });
    await setDoc(doc(d, 'canjes_codigo', 'canje1'), { id: 'canje1', clienteId: IDENTIDADES.cliente.uid, comercioId: COMERCIO, codigoId: 'ANIVERSARIO', fechaCanje: 1 });
    await setDoc(doc(d, 'vendedores_secretos', IDENTIDADES.vendedor.uid), { algoritmo: 'scrypt', hash: 'x', sal: 'y' });
    await setDoc(doc(d, 'auditoria', 'a1'), { accion: 'prueba', comercioId: COMERCIO });
    await setDoc(doc(d, 'intentos_login_ip', 'i1'), { intentosFallidos: 1 });
    await setDoc(doc(d, 'operaciones_idempotentes', 'o1'), { operacion: 'prueba' });
  });
});

// --- Matriz: quién puede leer cada colección ---------------------------------
// Cada fila declara el documento de referencia y quiénes deben poder leerlo. El resto de las
// identidades tiene que recibir un rechazo. La escritura directa se prueba en bloque más abajo:
// salvo las listas blancas, ninguna colección admite escritura desde el cliente.

const MATRIZ: { coleccion: string; documento: string; leen: Quien[] }[] = [
  { coleccion: 'comercios', documento: COMERCIO, leen: ['cliente', 'otroCliente', 'vendedor', 'vendedorAjeno', 'admin', 'adminAjeno', 'contador', 'influencer', 'otroInfluencer', 'superadmin'] },
  { coleccion: 'comercios_privado', documento: COMERCIO, leen: ['admin', 'contador', 'superadmin'] },
  { coleccion: 'influencers_publico', documento: IDENTIDADES.influencer.uid, leen: ['cliente', 'otroCliente', 'vendedor', 'vendedorAjeno', 'admin', 'adminAjeno', 'contador', 'influencer', 'otroInfluencer', 'superadmin'] },
  { coleccion: 'transacciones', documento: 'tx1', leen: ['cliente', 'vendedor', 'admin', 'superadmin'] },
  { coleccion: 'puntos_saldos', documento: `${IDENTIDADES.cliente.uid}_${COMERCIO}`, leen: ['cliente', 'vendedor', 'admin', 'superadmin'] },
  { coleccion: 'sesiones_qr', documento: '123456', leen: ['vendedor', 'admin', 'superadmin'] },
  { coleccion: 'cobros_prepago', documento: 'cobro1', leen: ['admin', 'contador', 'superadmin'] },
  { coleccion: 'asignaciones_influencer', documento: `${COMERCIO}_${IDENTIDADES.influencer.uid}`, leen: ['admin', 'influencer', 'superadmin'] },
  { coleccion: 'codigos_influencer', documento: 'NATGOLD', leen: ['admin', 'influencer', 'superadmin'] },
  { coleccion: 'codigos_comercio', documento: 'ANIVERSARIO', leen: ['vendedor', 'admin', 'superadmin'] },
  { coleccion: 'canjes_codigo', documento: 'canje1', leen: ['cliente', 'vendedor', 'admin', 'superadmin'] },
  { coleccion: 'vendedores_secretos', documento: IDENTIDADES.vendedor.uid, leen: [] },
  { coleccion: 'auditoria', documento: 'a1', leen: [] },
  { coleccion: 'intentos_login_ip', documento: 'i1', leen: [] },
  { coleccion: 'operaciones_idempotentes', documento: 'o1', leen: [] },
];

describe('Matriz de lectura por rol', () => {
  for (const fila of MATRIZ) {
    for (const quien of TODOS) {
      const permitido = (fila.leen as Quien[]).includes(quien);
      it(`${quien} ${permitido ? 'SÍ' : 'NO'} puede leer ${fila.coleccion}`, async () => {
        const lectura = getDoc(doc(db(quien), fila.coleccion, fila.documento));
        await (permitido ? assertSucceeds(lectura) : assertFails(lectura));
      });
    }
  }
});

describe('Matriz de escritura: el libro mayor es del servidor', () => {
  for (const fila of MATRIZ) {
    // `comercios` tiene su propia lista blanca y se prueba aparte.
    if (fila.coleccion === 'comercios') continue;
    for (const quien of TODOS) {
      it(`${quien} NO puede escribir ${fila.coleccion}`, async () => {
        await assertFails(updateDoc(doc(db(quien), fila.coleccion, fila.documento), { alterado: true }));
      });
    }
  }
});

describe('Perfil propio: lista blanca de campos', () => {
  it('el cliente edita su nombre y su teléfono', async () => {
    await assertSucceeds(updateDoc(doc(db('cliente'), 'users', IDENTIDADES.cliente.uid), { nombre: 'Ana María', telefono: '+59171234567' }));
  });

  for (const campo of ['rol', 'comercioId', 'estado', 'pin', 'email'] as const) {
    it(`el cliente NO puede cambiar su ${campo}`, async () => {
      const valor = campo === 'rol' ? 'superadmin' : campo === 'comercioId' ? COMERCIO : 'algo';
      await assertFails(updateDoc(doc(db('cliente'), 'users', IDENTIDADES.cliente.uid), { [campo]: valor }));
    });
  }

  it('un usuario nuevo se crea como cliente', async () => {
    const nuevo = testEnv.authenticatedContext('uid_nuevo', { rol: 'cliente' }).firestore();
    await assertSucceeds(setDoc(doc(nuevo, 'users', 'uid_nuevo'), {
      uid: 'uid_nuevo', email: 'nuevo@gmail.com', nombre: 'Nuevo', rol: 'cliente',
      termsAccepted: true, termsAcceptedAt: 2, createdAt: 2,
    }));
  });

  it('un usuario nuevo NO puede crearse con otro rol', async () => {
    const nuevo = testEnv.authenticatedContext('uid_nuevo', { rol: 'cliente' }).firestore();
    await assertFails(setDoc(doc(nuevo, 'users', 'uid_nuevo'), {
      uid: 'uid_nuevo', email: 'nuevo@gmail.com', nombre: 'Nuevo', rol: 'admin_comercio',
      comercioId: COMERCIO, createdAt: 2,
    }));
  });

  it('un token sin rol no puede leer nada ajeno', async () => {
    const sinRol = testEnv.authenticatedContext('uid_sin_rol', {}).firestore();
    await assertFails(getDoc(doc(sinRol, 'comercios_privado', COMERCIO)));
    await assertFails(getDoc(doc(sinRol, 'transacciones', 'tx1')));
  });

  it('nadie lee el perfil de otro usuario', async () => {
    await assertFails(getDoc(doc(db('cliente'), 'users', IDENTIDADES.otroCliente.uid)));
    await assertFails(getDoc(doc(db('influencer'), 'users', IDENTIDADES.cliente.uid)));
    await assertFails(getDoc(doc(db('contador'), 'users', IDENTIDADES.cliente.uid)));
  });

  it('el teléfono del influencer deja de estar a la vista de todos (H-16)', async () => {
    await assertFails(getDoc(doc(db('admin'), 'users', IDENTIDADES.influencer.uid)));
    await assertSucceeds(getDoc(doc(db('admin'), 'influencers_publico', IDENTIDADES.influencer.uid)));
  });

  it('el administrador SÍ ve a los vendedores de su comercio', async () => {
    await assertSucceeds(getDoc(doc(db('admin'), 'users', IDENTIDADES.vendedor.uid)));
    await assertFails(getDoc(doc(db('adminAjeno'), 'users', IDENTIDADES.vendedor.uid)));
  });
});

describe('Catálogo del comercio: lista blanca de campos', () => {
  it('el administrador edita reglas, premios y productos de su comercio', async () => {
    await assertSucceeds(updateDoc(doc(db('admin'), 'comercios', COMERCIO), {
      reglas: [{ id: 'r1', tipo: 'POR_COMPRA', puntosAOtorgar: 10, activa: true }],
      premios: [{ id: 'p1', nombre: 'Café', puntosRequeridos: 100, activo: true }],
      logoUrl: 'data:image/png;base64,xx',
    }));
  });

  for (const [campo, valor] of [['estado', 'bloqueado'], ['modalidadPago', 'PILOTO'], ['nombre', 'Otro'], ['operativoHasta', 99999999999], ['puedeCanjearPremios', false]] as const) {
    it(`el administrador NO puede cambiar ${campo} de su comercio`, async () => {
      await assertFails(updateDoc(doc(db('admin'), 'comercios', COMERCIO), { [campo]: valor }));
    });
  }

  it('el administrador NO puede tocar el comercio ajeno', async () => {
    await assertFails(updateDoc(doc(db('adminAjeno'), 'comercios', COMERCIO), { reglas: [] }));
  });

  it('el vendedor NO edita el catálogo', async () => {
    await assertFails(updateDoc(doc(db('vendedor'), 'comercios', COMERCIO), { premios: [] }));
  });

  it('nadie crea ni borra comercios desde el cliente', async () => {
    for (const quien of ['superadmin', 'admin', 'contador'] as Quien[]) {
      await assertFails(setDoc(doc(db(quien), 'comercios', 'comercio_nuevo'), { nombre: 'Nuevo' }));
      await assertFails(deleteDoc(doc(db(quien), 'comercios', OTRO)));
    }
  });

  it('el saldo prepagado no se toca desde el cliente, ni para bajarlo', async () => {
    await assertFails(updateDoc(doc(db('admin'), 'comercios_privado', COMERCIO), { saldoPremiosBs: 199 }));
    await assertFails(updateDoc(doc(db('contador'), 'comercios_privado', COMERCIO), { saldoPremiosBs: 500 }));
    await assertFails(updateDoc(doc(db('superadmin'), 'comercios_privado', COMERCIO), { plan: 'premium' }));
  });
});

describe('Fronteras entre comercios', () => {
  it('el vendedor ajeno no ve la sesión, la transacción ni el saldo de otro comercio', async () => {
    await assertFails(getDoc(doc(db('vendedorAjeno'), 'sesiones_qr', '123456')));
    await assertFails(getDoc(doc(db('vendedorAjeno'), 'transacciones', 'tx1')));
    await assertFails(getDoc(doc(db('vendedorAjeno'), 'puntos_saldos', `${IDENTIDADES.cliente.uid}_${COMERCIO}`)));
  });

  it('el influencer ajeno no ve la campaña ni el código de otro', async () => {
    await assertFails(getDoc(doc(db('otroInfluencer'), 'asignaciones_influencer', `${COMERCIO}_${IDENTIDADES.influencer.uid}`)));
    await assertFails(getDoc(doc(db('otroInfluencer'), 'codigos_influencer', 'NATGOLD')));
  });

  it('el cliente no ve las transacciones de otro cliente', async () => {
    await assertFails(getDoc(doc(db('otroCliente'), 'transacciones', 'tx1')));
    await assertFails(getDoc(doc(db('otroCliente'), 'puntos_saldos', `${IDENTIDADES.cliente.uid}_${COMERCIO}`)));
  });
});

describe('Colección desconocida', () => {
  it('una colección que nadie declaró queda cerrada', async () => {
    for (const quien of ['superadmin', 'cliente', 'anonimo'] as Quien[]) {
      await assertFails(getDoc(doc(db(quien), 'coleccion_nueva', 'x')));
      await assertFails(setDoc(doc(db(quien), 'coleccion_nueva', 'x'), { a: 1 }));
    }
  });
});
