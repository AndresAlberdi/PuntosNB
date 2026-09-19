/**
 * Pruebas de las reglas de Firestore (Fase 0 del hardening).
 *
 * Requieren el emulador de Firestore: se ejecutan con `npm run test:rules`,
 * que levanta el emulador con `firebase emulators:exec`. Si el emulador no
 * está disponible, las pruebas FALLAN; nunca se omiten (H-15).
 */
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const aquí = dirname(fileURLToPath(import.meta.url));
const REGLAS = readFileSync(resolve(aquí, '../../../firestore.rules'), 'utf8');

const HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
const [host, puerto] = HOST.split(':');

let testEnv: RulesTestEnvironment;

// Identidades de prueba
const UID_CLIENTE = 'cliente_1';
const UID_CLIENTE_2 = 'cliente_2';
const UID_ADMIN = 'admin_epico';
const UID_ADMIN_OTRO = 'admin_pizza';
const UID_CONTADOR = 'contador_1';
const UID_SUPER = 'super_1';
const UID_VENDEDOR = 'vendedor_epico';
const COMERCIO = 'comercio_epico';
const COMERCIO_OTRO = 'comercio_pizza';

const como = (uid: string, token: Record<string, unknown> = {}) =>
  testEnv.authenticatedContext(uid, token).firestore();

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-hipatia-reglas',
    firestore: { host, port: Number(puerto), rules: REGLAS },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', UID_CLIENTE), {
      uid: UID_CLIENTE, email: 'ana@gmail.com', nombre: 'Ana', rol: 'cliente', createdAt: 1,
    });
    await setDoc(doc(db, 'users', UID_CLIENTE_2), {
      uid: UID_CLIENTE_2, email: 'beto@gmail.com', nombre: 'Beto', rol: 'cliente', createdAt: 1,
    });
    await setDoc(doc(db, 'users', UID_ADMIN), {
      uid: UID_ADMIN, email: 'admin@epico.com', nombre: 'Admin Épico', rol: 'admin_comercio',
      comercioId: COMERCIO, createdAt: 1,
    });
    await setDoc(doc(db, 'users', UID_ADMIN_OTRO), {
      uid: UID_ADMIN_OTRO, email: 'admin@pizza.com', nombre: 'Admin Pizza', rol: 'admin_comercio',
      comercioId: COMERCIO_OTRO, createdAt: 1,
    });
    await setDoc(doc(db, 'users', UID_CONTADOR), {
      uid: UID_CONTADOR, email: 'contador@hipatia.io', nombre: 'Contador', rol: 'contador', createdAt: 1,
    });
    await setDoc(doc(db, 'users', UID_SUPER), {
      uid: UID_SUPER, email: 'super@hipatia.io', nombre: 'Super', rol: 'superadmin', createdAt: 1,
    });
    await setDoc(doc(db, 'users', UID_VENDEDOR), {
      uid: UID_VENDEDOR, email: 'ventas@epico.com', nombre: 'Ventas', rol: 'vendedor',
      comercioId: COMERCIO, estado: 'activo', createdAt: 1,
    });
    await setDoc(doc(db, 'comercios', COMERCIO), {
      nombre: 'Epico', nit_rut: '123', reglas: [], premios: [], productos: [],
      modalidadPago: 'PREPAGO', plan: 'regular', saldoPremiosBs: 190, mensualidadBs: 25,
      costoPorPremioBs: 1.25, mesesPagados: ['2026-09'], estado: 'activo', createdAt: 1,
    });
    await setDoc(doc(db, 'comercios', COMERCIO_OTRO), {
      nombre: 'Pizza NB', nit_rut: '456', reglas: [], premios: [], productos: [],
      modalidadPago: 'PILOTO', plan: 'regular', saldoPremiosBs: 0, createdAt: 1,
    });
  });
});

describe('Acceso anónimo', () => {
  it('rechaza leer usuarios sin autenticación (flujo de PIN del vendedor, H-04)', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'users', UID_VENDEDOR)));
  });

  it('rechaza leer comercios sin autenticación', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'comercios', COMERCIO)));
  });
});

describe('H-01 · Autoescalada de rol', () => {
  it('un cliente NO puede convertirse en superadmin', async () => {
    const db = como(UID_CLIENTE);
    await assertFails(updateDoc(doc(db, 'users', UID_CLIENTE), { rol: 'superadmin' }));
  });

  it('un cliente NO puede asignarse un comercio', async () => {
    const db = como(UID_CLIENTE);
    await assertFails(updateDoc(doc(db, 'users', UID_CLIENTE), { comercioId: COMERCIO }));
  });

  it('un cliente NO puede desbloquearse a sí mismo', async () => {
    const db = como(UID_CLIENTE);
    await assertFails(updateDoc(doc(db, 'users', UID_CLIENTE), { estado: 'activo' }));
  });

  it('un cliente NO puede ponerse un PIN de vendedor', async () => {
    const db = como(UID_CLIENTE);
    await assertFails(updateDoc(doc(db, 'users', UID_CLIENTE), { pin: '123456' }));
  });

  it('un cliente SÍ puede editar su nombre y su teléfono', async () => {
    const db = como(UID_CLIENTE);
    await assertSucceeds(updateDoc(doc(db, 'users', UID_CLIENTE), { nombre: 'Ana María', telefono: '+59170000000' }));
  });

  it('un cliente NO puede modificar el documento de otro usuario', async () => {
    const db = como(UID_CLIENTE);
    await assertFails(updateDoc(doc(db, 'users', UID_CLIENTE_2), { nombre: 'Secuestrado' }));
  });

  it('un admin_comercio NO puede escribir usuarios de otro comercio', async () => {
    const db = como(UID_ADMIN_OTRO);
    await assertFails(updateDoc(doc(db, 'users', UID_VENDEDOR), { nombre: 'Ajeno' }));
  });

  it('un admin_comercio NO puede cambiar el rol de su vendedor', async () => {
    const db = como(UID_ADMIN);
    await assertFails(updateDoc(doc(db, 'users', UID_VENDEDOR), { rol: 'superadmin' }));
  });

  it('un admin_comercio SÍ puede bloquear a su propio vendedor', async () => {
    const db = como(UID_ADMIN);
    await assertSucceeds(updateDoc(doc(db, 'users', UID_VENDEDOR), { estado: 'bloqueado' }));
  });
});

describe('H-02 · Toma de cuenta por coincidencia de correo', () => {
  it('un usuario con el mismo correo NO puede leer el documento ajeno', async () => {
    const db = como('uid_nuevo', { email: 'admin@epico.com', email_verified: true });
    await assertFails(getDoc(doc(db, 'users', UID_ADMIN)));
  });

  it('un usuario con el mismo correo NO puede escribir el documento ajeno', async () => {
    const db = como('uid_nuevo', { email: 'admin@epico.com', email_verified: true });
    await assertFails(updateDoc(doc(db, 'users', UID_ADMIN), { nombre: 'Heredado' }));
  });
});

describe('H-03 · Autoaprovisionamiento y alta propia', () => {
  it('un usuario nuevo SÍ puede crearse a sí mismo como cliente', async () => {
    const db = como('uid_nuevo', { email: 'nuevo@gmail.com' });
    await assertSucceeds(setDoc(doc(db, 'users', 'uid_nuevo'), {
      uid: 'uid_nuevo', email: 'nuevo@gmail.com', nombre: 'Nuevo', rol: 'cliente',
      termsAccepted: true, termsAcceptedAt: 2, createdAt: 2,
    }));
  });

  it('un usuario nuevo NO puede crearse como admin_comercio', async () => {
    const db = como('uid_nuevo', { email: 'admin@epico-falso.com' });
    await assertFails(setDoc(doc(db, 'users', 'uid_nuevo'), {
      uid: 'uid_nuevo', email: 'admin@epico-falso.com', nombre: 'Falso', rol: 'admin_comercio',
      comercioId: COMERCIO, createdAt: 2,
    }));
  });

  it('un usuario nuevo NO puede crearse como vendedor de un comercio', async () => {
    const db = como('uid_nuevo', { email: 'ventas@epico.com' });
    await assertFails(setDoc(doc(db, 'users', 'uid_nuevo'), {
      uid: 'uid_nuevo', email: 'ventas@epico.com', nombre: 'Falso', rol: 'vendedor',
      comercioId: COMERCIO, createdAt: 2,
    }));
  });

  it('un usuario nuevo NO puede crearse como superadmin', async () => {
    const db = como('uid_nuevo', { email: 'quiensea@gmail.com' });
    await assertFails(setDoc(doc(db, 'users', 'uid_nuevo'), {
      uid: 'uid_nuevo', email: 'quiensea@gmail.com', nombre: 'Falso', rol: 'superadmin', createdAt: 2,
    }));
  });

  it('un cliente NO puede borrar su documento para recrearlo con otro rol', async () => {
    const db = como(UID_CLIENTE);
    await assertFails(deleteDoc(doc(db, 'users', UID_CLIENTE)));
  });
});

describe('H-07 · Campos de facturación del comercio', () => {
  it('un admin_comercio NO puede acreditarse saldo de premios', async () => {
    const db = como(UID_ADMIN);
    await assertFails(updateDoc(doc(db, 'comercios', COMERCIO), { saldoPremiosBs: 99999 }));
  });

  it('un admin_comercio NO puede pasarse a plan premium', async () => {
    const db = como(UID_ADMIN);
    await assertFails(updateDoc(doc(db, 'comercios', COMERCIO), { plan: 'premium' }));
  });

  it('un admin_comercio NO puede cambiar su modalidad de pago a PILOTO', async () => {
    const db = como(UID_ADMIN);
    await assertFails(updateDoc(doc(db, 'comercios', COMERCIO), { modalidadPago: 'PILOTO' }));
  });

  it('un admin_comercio NO puede marcarse meses como pagados', async () => {
    const db = como(UID_ADMIN);
    await assertFails(updateDoc(doc(db, 'comercios', COMERCIO), { mesesPagados: ['2026-01', '2026-02'] }));
  });

  it('un admin_comercio NO puede desbloquear su comercio', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'comercios', COMERCIO), { estado: 'bloqueado' });
    });
    const db = como(UID_ADMIN);
    await assertFails(updateDoc(doc(db, 'comercios', COMERCIO), { estado: 'activo' }));
  });

  it('un admin_comercio SÍ puede editar sus reglas, premios y productos', async () => {
    const db = como(UID_ADMIN);
    await assertSucceeds(updateDoc(doc(db, 'comercios', COMERCIO), {
      reglas: [{ id: 'r1', tipo: 'POR_COMPRA', puntosAOtorgar: 10, activa: true }],
      premios: [{ id: 'p1', nombre: 'Café', descripcion: '', puntosRequeridos: 100, activo: true }],
    }));
  });

  it('un admin_comercio NO puede tocar el comercio ajeno', async () => {
    const db = como(UID_ADMIN_OTRO);
    await assertFails(updateDoc(doc(db, 'comercios', COMERCIO), { reglas: [] }));
  });

  it('un cliente NO puede modificar ningún comercio', async () => {
    const db = como(UID_CLIENTE);
    await assertFails(updateDoc(doc(db, 'comercios', COMERCIO), { saldoPremiosBs: 1000 }));
  });

  it('un contador SÍ puede acreditar un cobro de prepago', async () => {
    const db = como(UID_CONTADOR);
    await assertSucceeds(updateDoc(doc(db, 'comercios', COMERCIO), {
      saldoPremiosBs: 250, mesesPagados: ['2026-09', '2026-10'], modalidadPago: 'PREPAGO',
    }));
  });

  it('un contador NO puede cambiar el plan ni la mensualidad', async () => {
    const db = como(UID_CONTADOR);
    await assertFails(updateDoc(doc(db, 'comercios', COMERCIO), { plan: 'premium', mensualidadBs: 0 }));
  });

  it('un contador NO puede crear ni borrar comercios', async () => {
    const db = como(UID_CONTADOR);
    await assertFails(setDoc(doc(db, 'comercios', 'comercio_nuevo'), { nombre: 'Nuevo', nit_rut: '1', reglas: [], premios: [], createdAt: 1 }));
    await assertFails(deleteDoc(doc(db, 'comercios', COMERCIO_OTRO)));
  });
});

describe('H-07 · Consumo del saldo de premios al canjear', () => {
  it('un admin_comercio SÍ puede descontar el saldo de premios de su comercio', async () => {
    const db = como(UID_ADMIN);
    await assertSucceeds(updateDoc(doc(db, 'comercios', COMERCIO), { saldoPremiosBs: 188.75 }));
  });

  it('un admin_comercio NO puede subir el saldo de premios ni un céntimo', async () => {
    const db = como(UID_ADMIN);
    await assertFails(updateDoc(doc(db, 'comercios', COMERCIO), { saldoPremiosBs: 190.01 }));
  });

  it('un admin_comercio NO puede descontar el saldo de un comercio ajeno', async () => {
    const db = como(UID_ADMIN_OTRO);
    await assertFails(updateDoc(doc(db, 'comercios', COMERCIO), { saldoPremiosBs: 100 }));
  });

  it('un vendedor NO puede tocar el saldo de premios (H-26: rompe el canje en PREPAGO)', async () => {
    const db = como(UID_VENDEDOR);
    await assertFails(updateDoc(doc(db, 'comercios', COMERCIO), { saldoPremiosBs: 188.75 }));
  });
});

describe('Flujos críticos del negocio (siguen operando)', () => {
  it('acumulación: el vendedor crea la sesión y el cliente la reclama', async () => {
    const vendedor = como(UID_VENDEDOR);
    await assertSucceeds(setDoc(doc(vendedor, 'sesiones_qr', 'sesion_acum'), {
      id: 'sesion_acum', tipo: 'ACUMULACION', creadorId: UID_VENDEDOR, comercioId: COMERCIO,
      estado: 'PENDIENTE', createdAt: Date.now(), montoFactura: 100, puntosCalculados: 10,
    }));

    const cliente = como(UID_CLIENTE);
    await assertSucceeds(updateDoc(doc(cliente, 'sesiones_qr', 'sesion_acum'), { estado: 'USADO' }));
    await assertSucceeds(setDoc(doc(cliente, 'transacciones', 'tx_acum'), {
      id: 'tx_acum', fechaHora: Date.now(), clienteId: UID_CLIENTE, comercioId: COMERCIO,
      vendedorId: UID_VENDEDOR, puntos: 10, tipo: 'ACUMULACION',
    }));
    await assertSucceeds(setDoc(doc(cliente, 'puntos_saldos', `${UID_CLIENTE}_${COMERCIO}`), {
      id: `${UID_CLIENTE}_${COMERCIO}`, clienteId: UID_CLIENTE, comercioId: COMERCIO,
      saldoTotal: 10, updatedAt: Date.now(),
    }));
  });

  it('canje: el cliente crea la sesión y el vendedor la aprueba', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'puntos_saldos', `${UID_CLIENTE}_${COMERCIO}`), {
        id: `${UID_CLIENTE}_${COMERCIO}`, clienteId: UID_CLIENTE, comercioId: COMERCIO,
        saldoTotal: 100, updatedAt: 1,
      });
    });

    const cliente = como(UID_CLIENTE);
    await assertSucceeds(setDoc(doc(cliente, 'sesiones_qr', 'sesion_canje'), {
      id: 'sesion_canje', tipo: 'CANJE', creadorId: UID_CLIENTE, comercioId: COMERCIO,
      estado: 'PENDIENTE', createdAt: Date.now(), premioId: 'p1', puntosCalculados: 50,
    }));

    const vendedor = como(UID_VENDEDOR);
    await assertSucceeds(updateDoc(doc(vendedor, 'sesiones_qr', 'sesion_canje'), { estado: 'USADO' }));
    await assertSucceeds(setDoc(doc(vendedor, 'transacciones', 'tx_canje'), {
      id: 'tx_canje', fechaHora: Date.now(), clienteId: UID_CLIENTE, comercioId: COMERCIO,
      vendedorId: UID_VENDEDOR, puntos: -50, tipo: 'CANJE',
    }));
    await assertSucceeds(updateDoc(doc(vendedor, 'puntos_saldos', `${UID_CLIENTE}_${COMERCIO}`), {
      saldoTotal: 50, updatedAt: Date.now(),
    }));
  });

  it('código promocional del comercio: el admin lo crea y el cliente lo canjea', async () => {
    const admin = como(UID_ADMIN);
    await assertSucceeds(setDoc(doc(admin, 'codigos_comercio', 'ANIVERSARIO'), {
      id: 'ANIVERSARIO', comercioId: COMERCIO, puntosPorCanje: 20,
      fechaInicio: Date.now(), fechaFin: Date.now() + 86400000, estado: 'ACTIVO', createdAt: Date.now(),
    }));

    const cliente = como(UID_CLIENTE);
    await assertSucceeds(setDoc(doc(cliente, 'canjes_codigos', 'canje_1'), {
      id: 'canje_1', clienteId: UID_CLIENTE, comercioId: COMERCIO, codigoId: 'ANIVERSARIO', fechaHora: Date.now(),
    }));
    await assertSucceeds(setDoc(doc(cliente, 'transacciones', 'tx_codigo'), {
      id: 'tx_codigo', fechaHora: Date.now(), clienteId: UID_CLIENTE, comercioId: COMERCIO,
      puntos: 20, tipo: 'CODIGO_COMERCIO',
    }));
  });

  it('cobro de prepago: el contador lo registra y acredita el saldo', async () => {
    const contador = como(UID_CONTADOR);
    await assertSucceeds(setDoc(doc(contador, 'cobros_prepago', 'cobro_1'), {
      id: 'cobro_1', comercioId: COMERCIO, nombreComercio: 'Epico', nitRut: '123', recibeFactura: false,
      contadorId: UID_CONTADOR, contadorAlias: 'contador', fechaHora: Date.now(),
      montoTotal: 75, montoMensualidad: 25, mesesPagados: ['2026-10'], montoPremios: 50,
      cantidadPremiosEquivalentes: 40, codigoDeposito: 'D-1', comprobanteUrl: '',
    }));
    await assertSucceeds(updateDoc(doc(contador, 'comercios', COMERCIO), {
      saldoPremiosBs: 240, mesesPagados: ['2026-09', '2026-10'], modalidadPago: 'PREPAGO',
    }));
  });
});

describe('Superadministrador', () => {
  it('SÍ puede asignar roles y comercios', async () => {
    const db = como(UID_SUPER);
    await assertSucceeds(updateDoc(doc(db, 'users', UID_CLIENTE), { rol: 'contador' }));
  });

  it('SÍ puede acreditar saldo y cambiar el plan de un comercio', async () => {
    const db = como(UID_SUPER);
    await assertSucceeds(updateDoc(doc(db, 'comercios', COMERCIO), { saldoPremiosBs: 500, plan: 'premium' }));
  });
});
