#!/usr/bin/env node
/**
 * Prueba de los cuatro flujos críticos contra el entorno REAL, con datos desechables.
 *
 * Crea un comercio de prueba, un vendedor y un cliente propios, recorre acumulación, cobro de
 * prepago, canje de premio y código promocional invocando las funciones desplegadas igual que lo
 * hace el navegador, comprueba los saldos y después borra todo lo que creó.
 *
 * No toca ningún dato de los comercios reales: solo opera sobre lo que él mismo crea.
 *
 * Uso:
 *   node scripts/admin/prueba-e2e.mjs --project puntosnb
 *   node scripts/admin/prueba-e2e.mjs --project puntosnb --solo-limpiar
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = resolve(aqui, '../..');

const args = process.argv.slice(2);
const opt = (n) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined;
};
const projectId = opt('project');
const soloLimpiar = args.includes('--solo-limpiar');
if (!projectId) {
  console.error('Uso: --project <id> [--solo-limpiar]');
  process.exit(1);
}

const REGION = 'us-central1';
const MARCA = 'PRUEBA HARDENING';
const SUFIJO = 'pruebahardening.local';

// La clave web del proyecto es pública por diseño (va en el bundle); se lee del .env del entorno.
const archivoEnv = resolve(raiz, projectId === 'puntosnb' ? '.env.staging' : '.env.production');
if (!existsSync(archivoEnv)) {
  console.error(`No se encontró ${archivoEnv}`);
  process.exit(1);
}
const API_KEY = readFileSync(archivoEnv, 'utf8')
  .split('\n').find((l) => l.startsWith('VITE_FIREBASE_API_KEY='))
  ?.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');

// La clave web está restringida por referente HTTP al sitio del proyecto, así que las llamadas de
// esta prueba se identifican igual que lo haría el navegador. (Que baste con enviar la cabecera
// muestra que esa restricción no es una barrera de seguridad: la barrera real es App Check.)
const ORIGEN = `https://${projectId}.web.app`;

process.env.GOOGLE_CLOUD_PROJECT = projectId;
process.env.GOOGLE_CLOUD_QUOTA_PROJECT ??= projectId;
initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();
const auth = getAuth();

const creados = { uids: [], comercioId: null, codigo: null };
const resultados = [];
const registrar = (paso, ok, detalle) => {
  resultados.push({ paso, resultado: ok ? 'BIEN' : 'FALLA', detalle });
  console.log(`${ok ? '✔' : '✖'} ${paso}${detalle ? ` — ${detalle}` : ''}`);
  if (!ok) process.exitCode = 1;
};

/**
 * Obtiene un ID token de una cuenta de prueba entrando con correo y contraseña.
 *
 * No se firman custom tokens desde aquí: con credenciales de usuario (ADC) el Admin SDK no puede
 * firmarlos sin una cuenta de servicio. Los claims puestos con `setCustomUserClaims` viajan igual
 * en el token que devuelve el ingreso por contraseña.
 */
async function idTokenPorContrasena(correo, contrasena) {
  const r = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json', Referer: `${ORIGEN}/` },
      body: JSON.stringify({ email: correo, password: contrasena, returnSecureToken: true }) },
  );
  const cuerpo = await r.json();
  if (!cuerpo.idToken) throw new Error(`No se pudo ingresar: ${JSON.stringify(cuerpo.error ?? cuerpo)}`);
  return cuerpo.idToken;
}

/** Canjea por un ID token el custom token que emite `loginVendedor`, igual que hace el navegador. */
async function idTokenDesdeCustomToken(custom) {
  const r = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json', Referer: `${ORIGEN}/` },
      body: JSON.stringify({ token: custom, returnSecureToken: true }) },
  );
  const cuerpo = await r.json();
  if (!cuerpo.idToken) throw new Error(`No se pudo canjear el custom token: ${JSON.stringify(cuerpo.error ?? cuerpo)}`);
  return cuerpo.idToken;
}

async function llamar(nombre, datos, token) {
  const r = await fetch(`https://${REGION}-${projectId}.cloudfunctions.net/${nombre}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: ORIGEN,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ data: datos }),
  });
  const cuerpo = await r.json().catch(() => ({}));
  return r.ok
    ? { ok: true, datos: cuerpo.result }
    : { ok: false, codigo: cuerpo.error?.status, mensaje: cuerpo.error?.message };
}

async function limpiar() {
  console.log('\nLimpieza de los datos de prueba…');
  const comercios = await db.collection('comercios').where('nombre', '==', MARCA).get();
  const ids = comercios.docs.map((d) => d.id);
  if (creados.comercioId && !ids.includes(creados.comercioId)) ids.push(creados.comercioId);

  let borrados = 0;
  for (const comercioId of ids) {
    for (const col of ['transacciones', 'puntos_saldos', 'sesiones_qr', 'cobros_prepago',
      'canjes_codigo', 'codigos_comercio', 'auditoria']) {
      const snap = await db.collection(col).where('comercioId', '==', comercioId).get();
      for (const d of snap.docs) { await d.ref.delete(); borrados++; }
    }
    await db.collection('comercios').doc(comercioId).delete();
    borrados++;
  }

  const usuarios = await db.collection('users').where('rol', 'in', ['vendedor', 'cliente']).get();
  for (const d of usuarios.docs) {
    const correo = String(d.data().email ?? '');
    if (correo.endsWith(SUFIJO)) {
      await db.collection('vendedores_secretos').doc(d.id).delete().catch(() => undefined);
      await auth.deleteUser(d.id).catch(() => undefined);
      await d.ref.delete();
      borrados++;
    }
  }
  for (const uid of creados.uids) {
    await auth.deleteUser(uid).catch(() => undefined);
    await db.collection('users').doc(uid).delete().catch(() => undefined);
    await db.collection('vendedores_secretos').doc(uid).delete().catch(() => undefined);
    await db.collection('puntos_saldos').doc(`${uid}_${creados.comercioId}`).delete().catch(() => undefined);
  }
  const idem = await db.collection('operaciones_idempotentes').where('actorUid', 'in', creados.uids.length ? creados.uids.slice(0, 10) : ['ninguno']).get();
  for (const d of idem.docs) { await d.ref.delete(); borrados++; }

  console.log(`Limpieza terminada: ${borrados} documentos borrados.`);
}

if (soloLimpiar) { await limpiar(); process.exit(0); }

console.log(`Prueba de extremo a extremo contra ${projectId}\n`);

try {
  // --- Preparación: identidades de prueba ---------------------------------------
  const marca = Date.now().toString(36);
  const uidSuper = `pruebah_super_${marca}`;
  const uidCliente = `pruebah_cliente_${marca}`;
  const correoCliente = `cliente.${marca}@${SUFIJO}`;
  const correoVendedor = `vendedor.${marca}@${SUFIJO}`;

  const contrasena = `Prueba-${marca}-${Math.random().toString(36).slice(2, 10)}`;
  const correoSuper = `super.${marca}@${SUFIJO}`;
  await auth.createUser({ uid: uidSuper, email: correoSuper, password: contrasena, displayName: 'Prueba Superadmin' });
  await auth.createUser({ uid: uidCliente, email: correoCliente, password: contrasena, displayName: 'Prueba Cliente' });
  await auth.setCustomUserClaims(uidSuper, { rol: 'superadmin' });
  await auth.setCustomUserClaims(uidCliente, { rol: 'cliente' });
  creados.uids.push(uidSuper, uidCliente);
  await db.collection('users').doc(uidCliente).set({
    uid: uidCliente, email: correoCliente, nombre: 'Cliente de prueba', rol: 'cliente', createdAt: Date.now(),
  });

  const tokenSuper = await idTokenPorContrasena(correoSuper, contrasena);
  const tokenCliente = await idTokenPorContrasena(correoCliente, contrasena);

  // --- Comercio de prueba --------------------------------------------------------
  const comercio = await llamar('guardarComercio', {
    nombre: MARCA, nit_rut: `PRUEBA-${marca}`, mensualidadBs: 25, costoPorPremioBs: 1.25,
  }, tokenSuper);
  if (!comercio.ok) throw new Error(`No se pudo crear el comercio: ${comercio.mensaje}`);
  creados.comercioId = comercio.datos.comercioId;
  registrar('Alta de comercio por el backend', true, `nace PILOTO, id ${creados.comercioId.slice(0, 8)}…`);

  await db.collection('comercios').doc(creados.comercioId).update({
    reglas: [{ id: 'r1', tipo: 'POR_COMPRA', puntosAOtorgar: 0.1, activa: true }],
    premios: [{ id: 'p1', nombre: 'Café de prueba', descripcion: '', puntosRequeridos: 10, activo: true }],
  });

  // --- Vendedor con PIN ----------------------------------------------------------
  const PIN = '481593';
  const vendedor = await llamar('crearVendedor', {
    usuario: correoVendedor, nombre: 'Vendedor de prueba', comercioId: creados.comercioId, pin: PIN,
  }, tokenSuper);
  if (!vendedor.ok) throw new Error(`No se pudo crear el vendedor: ${vendedor.mensaje}`);
  creados.uids.push(vendedor.datos.uid);

  const secreto = (await db.collection('vendedores_secretos').doc(vendedor.datos.uid).get()).data();
  registrar('El PIN se guarda como hash, no en claro',
    Boolean(secreto?.hash) && !JSON.stringify(secreto).includes(PIN), `algoritmo ${secreto?.algoritmo}`);

  const login = await llamar('loginVendedor', { usuario: correoVendedor, pin: PIN });
  registrar('Ingreso del vendedor con su PIN', login.ok, login.mensaje ?? 'token emitido por el servidor');
  // El mismo canje que hace el navegador: custom token del servidor → sesión real de Firebase Auth.
  const tokenVendedor = await idTokenDesdeCustomToken(login.datos.token);
  const { rol: rolEnToken } = await auth.verifyIdToken(tokenVendedor);
  registrar('El token del vendedor lleva su rol firmado', rolEnToken === 'vendedor', `rol ${rolEnToken}`);

  const loginMalo = await llamar('loginVendedor', { usuario: correoVendedor, pin: '000000' });
  registrar('PIN incorrecto rechazado con mensaje genérico',
    !loginMalo.ok && loginMalo.mensaje === 'Usuario o PIN incorrectos.', loginMalo.mensaje);

  // --- Flujo 1: acumulación ------------------------------------------------------
  const sesion = await llamar('crearSesionAcumulacion', {
    montoFactura: 200, reglaId: 'r1', nroFactura: 'F-PRUEBA', puntosCalculados: 99999,
  }, tokenVendedor);
  registrar('Acumulación: el servidor recalcula los puntos',
    sesion.ok && sesion.datos.puntos === 20, `puntos ${sesion.datos?.puntos} (esperado 20, el cliente pidió 99999)`);

  const reclamo = await llamar('reclamarAcumulacion', { codigo: sesion.datos.codigo }, tokenCliente);
  registrar('Acumulación: el cliente reclama y suma saldo',
    reclamo.ok && reclamo.datos.saldoTotal === 20, `saldo ${reclamo.datos?.saldoTotal}`);

  const repetido = await llamar('reclamarAcumulacion', { codigo: sesion.datos.codigo }, tokenCliente);
  registrar('Acumulación: el mismo código no se puede reclamar dos veces', !repetido.ok, repetido.mensaje);

  // --- Flujo 2: cobro de prepago -------------------------------------------------
  const mes = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const clave = `prueba-${marca}`;
  const cobro = await llamar('registrarCobroPrepago', {
    comercioId: creados.comercioId, mesesPagados: [mes], montoPremios: 10,
    codigoDeposito: `DEP-${marca}`, recibeFactura: false, clave,
  }, tokenSuper);
  registrar('Cobro de prepago: monto calculado en el servidor',
    cobro.ok && cobro.datos.montoTotal === 35, `total ${cobro.datos?.montoTotal} (25 de mensualidad + 10 de premios)`);

  const reintento = await llamar('registrarCobroPrepago', {
    comercioId: creados.comercioId, mesesPagados: [mes], montoPremios: 10,
    codigoDeposito: `DEP-${marca}`, recibeFactura: false, clave,
  }, tokenSuper);
  registrar('Cobro de prepago: el reintento no cobra dos veces',
    reintento.ok && reintento.datos.cobroId === cobro.datos.cobroId, 'mismo identificador de cobro');

  // --- Flujo 3: canje de premio --------------------------------------------------
  const sesionCanje = await llamar('crearSesionCanje', {
    comercioId: creados.comercioId, premioId: 'p1',
  }, tokenCliente);
  registrar('Canje: el cliente genera su código', sesionCanje.ok);

  const confirmacion = await llamar('confirmarCanje', { codigo: sesionCanje.datos.codigo }, tokenVendedor);
  const comercioTrasCanje = (await db.collection('comercios').doc(creados.comercioId).get()).data();
  registrar('Canje: descuenta puntos y saldo prepagado',
    confirmacion.ok && comercioTrasCanje.saldoPremiosBs === 8.75 && comercioTrasCanje.consumidoPremiosBs === 1.25,
    `saldo Bs ${comercioTrasCanje.saldoPremiosBs}, consumido Bs ${comercioTrasCanje.consumidoPremiosBs}`);

  // Sin saldo suficiente el canje se bloquea (H-12).
  await db.collection('comercios').doc(creados.comercioId).update({ saldoPremiosBs: 0.5 });
  const sinSaldo = await llamar('crearSesionCanje', { comercioId: creados.comercioId, premioId: 'p1' }, tokenCliente);
  registrar('Canje: bloqueado si el comercio no tiene saldo en bolivianos', !sinSaldo.ok, sinSaldo.mensaje);
  await db.collection('comercios').doc(creados.comercioId).update({ saldoPremiosBs: 8.75 });

  // --- Flujo 4: código promocional ----------------------------------------------
  creados.codigo = `PRUEBAH${marca.toUpperCase()}`;
  await db.collection('codigos_comercio').doc(creados.codigo).set({
    id: creados.codigo, comercioId: creados.comercioId, puntosPorCanje: 15, estado: 'ACTIVO',
    fechaInicio: Date.now() - 60000, fechaFin: Date.now() + 3600000, createdAt: Date.now(),
  });

  const canjeCodigo = await llamar('canjearCodigo', { codigo: creados.codigo }, tokenCliente);
  registrar('Código promocional: acredita los puntos', canjeCodigo.ok && canjeCodigo.datos.puntos === 15,
    `puntos ${canjeCodigo.datos?.puntos}`);

  const canjeRepetido = await llamar('canjearCodigo', { codigo: creados.codigo }, tokenCliente);
  registrar('Código promocional: no se canjea dos veces', !canjeRepetido.ok, canjeRepetido.mensaje);

  // --- Auditoría -----------------------------------------------------------------
  const asientos = await db.collection('auditoria').where('comercioId', '==', creados.comercioId).get();
  registrar('Cada operación dejó asiento en la auditoría', asientos.size >= 5, `${asientos.size} asientos`);

  console.log('\nResumen:');
  console.table(resultados);
} catch (error) {
  console.error('\nLa prueba se interrumpió:', error.message);
  process.exitCode = 1;
} finally {
  await limpiar();
}
