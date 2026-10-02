/**
 * Pruebas de la lógica pura de respaldos y de las salvaguardas de `gcp.mjs`.
 * Corren con el ejecutor integrado de Node, sin dependencias y sin tocar la nube:
 *   node --test scripts/admin/lib/respaldos-test.mjs
 *
 * El nombre termina en `-test` (no en `.test.`) a propósito: así Vitest, que recorre todo el
 * repositorio buscando `*.test.*`, no intenta correrlas.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planificarCambios, evaluarVerificacion, esDeEsteScript, segundos, PROGRAMACIONES,
  PITR_ACTIVO, PITR_INACTIVO, PROTECCION_ACTIVA, PROTECCION_INACTIVA,
} from './respaldos.mjs';
import {
  analizarArgumentos, crearClienteGcp, esperarOperacion, enmascarar,
  enmascararCuentaFacturacion, sanearTexto, ErrorUso, ErrorGcp,
} from './gcp.mjs';

const DIARIA = { name: 'projects/p/databases/(default)/backupSchedules/d1', retention: '604800s', dailyRecurrence: {} };
const SEMANAL = {
  name: 'projects/p/databases/(default)/backupSchedules/s1', retention: '4838400s',
  weeklyRecurrence: { day: 'SUNDAY' },
};

const apagado = () => ({ base: { pitr: false, proteccion: false, earliestVersionTime: null }, programaciones: [] });
const encendido = () => ({
  base: { pitr: true, proteccion: true, earliestVersionTime: '2026-10-02T00:00:00Z' },
  programaciones: [{ ...DIARIA }, { ...SEMANAL }],
});

/** Aplica un plan sobre el estado simulado, como lo haría la API real. */
function aplicarEnMemoria(estado, cambios) {
  const nuevo = structuredClone(estado);
  let n = 0;
  for (const c of cambios) {
    if (c.tipo === 'actualizarBase') {
      if ('pointInTimeRecoveryEnablement' in c.campos) {
        nuevo.base.pitr = c.campos.pointInTimeRecoveryEnablement === PITR_ACTIVO;
        nuevo.base.earliestVersionTime = nuevo.base.pitr ? '2026-10-02T00:00:00Z' : null;
      }
      if ('deleteProtectionState' in c.campos) {
        nuevo.base.proteccion = c.campos.deleteProtectionState === PROTECCION_ACTIVA;
      }
    } else if (c.tipo === 'crearProgramacion') {
      nuevo.programaciones.push({ name: `creada/${n++}`, ...c.cuerpo });
    } else if (c.tipo === 'borrarProgramacion') {
      nuevo.programaciones = nuevo.programaciones.filter((p) => p.name !== c.name);
    }
  }
  return nuevo;
}

test('segundos interpreta el formato de la API', () => {
  assert.equal(segundos('604800s'), 604800);
  assert.equal(segundos('604800.000s'), 604800);
  assert.ok(Number.isNaN(segundos('7d')));
  assert.ok(Number.isNaN(segundos(undefined)));
});

test('aplicar con todo apagado: activa la base y crea las dos programaciones', () => {
  const { cambios, conflictos } = planificarCambios(apagado(), 'aplicar');
  assert.deepEqual(conflictos, []);
  assert.equal(cambios.length, 3);
  assert.deepEqual(cambios[0].campos, {
    pointInTimeRecoveryEnablement: PITR_ACTIVO,
    deleteProtectionState: PROTECCION_ACTIVA,
  });
  assert.deepEqual(cambios[1].cuerpo, { retention: '604800s', dailyRecurrence: {} });
  assert.deepEqual(cambios[2].cuerpo, { retention: '4838400s', weeklyRecurrence: { day: 'SUNDAY' } });
});

test('aplicar con todo encendido: no cambia nada', () => {
  assert.deepEqual(planificarCambios(encendido(), 'aplicar'), { cambios: [], conflictos: [] });
});

test('aplicar a medias: solo agrega lo que falta', () => {
  const estado = encendido();
  estado.base.proteccion = false;
  estado.programaciones = [{ ...SEMANAL }];
  const { cambios } = planificarCambios(estado, 'aplicar');
  assert.equal(cambios.length, 2);
  assert.deepEqual(cambios[0].campos, { deleteProtectionState: PROTECCION_ACTIVA });
  assert.equal(cambios[1].tipo, 'crearProgramacion');
  assert.equal(cambios[1].clave, 'diaria');
});

test('aplicar con una programación duplicada: conserva una y borra la copia', () => {
  const estado = encendido();
  estado.programaciones.push({ ...DIARIA, name: 'projects/p/databases/(default)/backupSchedules/d2' });
  const { cambios } = planificarCambios(estado, 'aplicar');
  assert.equal(cambios.length, 1);
  assert.equal(cambios[0].tipo, 'borrarProgramacion');
  assert.equal(cambios[0].name, 'projects/p/databases/(default)/backupSchedules/d2');
});

test('aplicar con una diaria ajena (otra retención): informa conflicto y no crea ni borra', () => {
  const estado = encendido();
  estado.programaciones = [
    { name: 'ajena', retention: '86400s', dailyRecurrence: {} },
    { ...SEMANAL },
  ];
  const { cambios, conflictos } = planificarCambios(estado, 'aplicar');
  assert.deepEqual(cambios, []);
  assert.equal(conflictos.length, 1);
  assert.match(conflictos[0], /diaria/);
});

test('una semanal en otro día es ajena: conflicto, no duplicado', () => {
  const estado = encendido();
  estado.programaciones = [{ ...DIARIA }, { name: 'lunes', retention: '4838400s', weeklyRecurrence: { day: 'MONDAY' } }];
  const { cambios, conflictos } = planificarCambios(estado, 'aplicar');
  assert.deepEqual(cambios, []);
  assert.equal(conflictos.length, 1);
});

test('es idempotente: aplicar dos veces no cambia nada la segunda', () => {
  for (const inicial of [apagado(), encendido(), { ...apagado(), programaciones: [{ ...DIARIA }] }]) {
    const primero = planificarCambios(inicial, 'aplicar');
    const despues = aplicarEnMemoria(inicial, primero.cambios);
    assert.deepEqual(planificarCambios(despues, 'aplicar'), { cambios: [], conflictos: [] });
  }
});

test('revertir con todo encendido: borra las dos programaciones y apaga la base', () => {
  const { cambios } = planificarCambios(encendido(), 'revertir');
  assert.equal(cambios.length, 3);
  assert.deepEqual(cambios[0].campos, {
    pointInTimeRecoveryEnablement: PITR_INACTIVO,
    deleteProtectionState: PROTECCION_INACTIVA,
  });
  assert.deepEqual(cambios.slice(1).map((c) => c.tipo), ['borrarProgramacion', 'borrarProgramacion']);
});

test('revertir con todo apagado: no cambia nada', () => {
  assert.deepEqual(planificarCambios(apagado(), 'revertir'), { cambios: [], conflictos: [] });
});

test('revertir no toca las programaciones ajenas', () => {
  const estado = encendido();
  estado.programaciones.push({ name: 'ajena', retention: '86400s', dailyRecurrence: {} });
  const { cambios } = planificarCambios(estado, 'revertir');
  const borradas = cambios.filter((c) => c.tipo === 'borrarProgramacion').map((c) => c.name);
  assert.ok(!borradas.includes('ajena'));
  assert.equal(borradas.length, 2);
});

test('revertir borra también las copias duplicadas y es idempotente', () => {
  const estado = encendido();
  estado.programaciones.push({ ...DIARIA, name: 'copia' });
  const primero = planificarCambios(estado, 'revertir');
  assert.equal(primero.cambios.filter((c) => c.tipo === 'borrarProgramacion').length, 3);
  const despues = aplicarEnMemoria(estado, primero.cambios);
  assert.deepEqual(planificarCambios(despues, 'revertir'), { cambios: [], conflictos: [] });
});

test('esDeEsteScript distingue por retención y recurrencia', () => {
  const [diaria, semanal] = PROGRAMACIONES;
  assert.ok(esDeEsteScript(DIARIA, diaria));
  assert.ok(!esDeEsteScript(DIARIA, semanal));
  assert.ok(!esDeEsteScript({ ...DIARIA, retention: '86400s' }, diaria));
});

test('verificar: el estado apagado falla en los cinco puntos', () => {
  const r = evaluarVerificacion(apagado());
  assert.equal(r.length, 5);
  assert.ok(r.every((x) => !x.pasa));
});

test('verificar: el estado encendido pasa en los cinco puntos', () => {
  assert.ok(evaluarVerificacion(encendido()).every((x) => x.pasa));
});

test('verificar: sin earliestVersionTime falla solo ese punto', () => {
  const estado = encendido();
  estado.base.earliestVersionTime = null;
  const fallan = evaluarVerificacion(estado).filter((x) => !x.pasa);
  assert.deepEqual(fallan.map((x) => x.punto), ['earliestVersionTime presente']);
});

test('argumentos: solo se admiten los dos proyectos, y producción exige confirmación', () => {
  assert.equal(analizarArgumentos(['--project', 'puntosnb', '--dry-run']).simular, true);
  assert.equal(
    analizarArgumentos(['--project', 'hipatia-puntos', '--confirmar-produccion', '--verificar']).verificar,
    true
  );
  assert.throws(() => analizarArgumentos(['--project', 'encuentramebo-1']), ErrorUso);
  assert.throws(() => analizarArgumentos(['--project', 'hipatia-puntos', '--dry-run']), /confirmar-produccion/);
  assert.throws(() => analizarArgumentos(['--dry-run']), /--project/);
  assert.throws(() => analizarArgumentos(['--project']), ErrorUso);
});

test('argumentos: una bandera desconocida aborta y --verificar no se combina con --revertir', () => {
  assert.throws(() => analizarArgumentos(['--project', 'puntosnb', '--dryrun']), /no reconocido/);
  assert.throws(() => analizarArgumentos(['--project', 'puntosnb', '--verificar', '--revertir']), ErrorUso);
});

test('enmascarado: identificadores, cuentas de facturación y tokens', () => {
  assert.equal(enmascarar('abcdefghij'), 'ab******ij');
  assert.equal(enmascarar('abc'), '***');
  assert.equal(enmascararCuentaFacturacion('billingAccounts/0123AB-4567CD-89EFAB'), 'billingAccounts/****AB-****CD-****AB');
  const limpio = sanearTexto('fallo con Bearer ya29.a0AbCdEf-ghi y ya29.zzz.yyy');
  assert.ok(!limpio.includes('ya29'));
});

function respuesta(estado, cuerpo) {
  const texto = cuerpo === undefined ? '' : JSON.stringify(cuerpo);
  return { ok: estado >= 200 && estado < 300, status: estado, text: async () => texto, clone() { return this; } };
}

test('cliente: envía las cabeceras, reintenta 429/503 y no imprime el cuerpo del error', async () => {
  const llamadas = [];
  const respuestas = [respuesta(429, {}), respuesta(503, {}), respuesta(200, { ok: true })];
  const esperas = [];
  const cliente = crearClienteGcp({
    project: 'puntosnb',
    obtenerToken: () => 'ya29.token-de-prueba',
    fetchImpl: async (url, init) => { llamadas.push({ url, init }); return respuestas.shift(); },
    esperar: async (ms) => { esperas.push(ms); },
  });
  assert.deepEqual(await cliente.solicitar('GET', 'https://x/y'), { ok: true });
  assert.deepEqual(esperas, [1000, 2000]);
  assert.equal(llamadas[0].init.headers['X-Goog-User-Project'], 'puntosnb');
  assert.match(llamadas[0].init.headers.Authorization, /^Bearer /);

  const malo = crearClienteGcp({
    project: 'puntosnb',
    obtenerToken: () => 'ya29.token-de-prueba',
    fetchImpl: async () => respuesta(403, { error: { status: 'PERMISSION_DENIED', message: 'secreto 0123AB-4567CD-89EFAB' } }),
    esperar: async () => {},
  });
  await assert.rejects(malo.solicitar('GET', 'https://x/y'), (e) => {
    assert.ok(e instanceof ErrorGcp);
    assert.equal(e.estado, 403);
    assert.equal(e.codigo, 'PERMISSION_DENIED');
    assert.ok(!e.message.includes('secreto'));
    assert.ok(!e.message.includes('ya29'));
    return true;
  });
});

test('cliente: no pide el token hasta la primera llamada', async () => {
  let pidio = false;
  crearClienteGcp({ project: 'puntosnb', obtenerToken: () => { pidio = true; return 't'; } });
  assert.equal(pidio, false);
});

test('esperarOperacion: sondea hasta que termine y propaga el error de la operación', async () => {
  const pendientes = [{ name: 'op/1', done: false }, { name: 'op/1', done: true }];
  const cliente = { solicitar: async () => pendientes.shift() };
  const fin = await esperarOperacion(cliente, 'https://x', { name: 'op/1', done: false }, { esperar: async () => {} });
  assert.equal(fin.done, true);

  const conError = { solicitar: async () => ({ name: 'op/2', done: true, error: { code: 7, message: 'datos' } }) };
  await assert.rejects(
    esperarOperacion(conError, 'https://x', { name: 'op/2', done: false }, { esperar: async () => {} }),
    (e) => e instanceof ErrorGcp && !e.message.includes('datos')
  );
});
